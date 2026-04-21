use crate::state::{SchedulerState, NodeStatus, ProviderNode};
use oxide_framework_core::{controller, ApiResponse, Data, Json};
use serde::{Deserialize, Serialize};
use tracing::{info, error};
use chrono::{Duration, Utc};

#[derive(Deserialize)]
pub struct HeartbeatPayload {
    pub id: String,
    pub ip_address: String,
    pub total_vram: u64,
    pub free_vram: u64,
    pub max_lanes: usize,
    pub active_streams: usize,
}

#[derive(Serialize)]
pub struct StreamAssignPayload {
    pub stream_id: String,
    pub camera_name: String,
    pub url: String,
    pub rois: serde_json::Value,
}

#[derive(Deserialize)]
pub struct StreamStatusPayload {
    pub worker_id: String,
    pub stream_id: String,
    pub status: String,
    #[serde(default)]
    pub reason: Option<String>,
}

pub struct HeartbeatController;

#[controller("/api/v1/nodes")]
impl HeartbeatController {
    fn new(_state: &oxide_framework_core::AppState) -> Self {
        Self
    }

    #[post("/heartbeat")]
    async fn heartbeat(
        &self,
        Data(state): Data<SchedulerState>,
        Json(payload): Json<HeartbeatPayload>,
    ) -> ApiResponse<()> {
        let (node_id, node_ip, max_lanes, active_streams) = {
            let mut nodes = state.nodes.write().unwrap();

            let now = chrono::Utc::now();
            let node = nodes
                .entry(payload.id.clone())
                .or_insert_with(|| ProviderNode {
                    id: payload.id.clone(),
                    ip_address: payload.ip_address.clone(),
                    total_vram: payload.total_vram,
                    free_vram: payload.free_vram,
                    max_lanes: payload.max_lanes,
                    active_streams: payload.active_streams,
                    status: NodeStatus::Online,
                    last_seen: now,
                });

            // A worker whose IP or capacity changed between restarts should be
            // reflected immediately, not left stale.
            node.ip_address = payload.ip_address.clone();
            node.max_lanes = payload.max_lanes;
            node.total_vram = payload.total_vram;
            node.free_vram = payload.free_vram;
            node.active_streams = payload.active_streams;
            node.last_seen = now;
            if node.status == NodeStatus::Offline {
                info!(worker_id = %node.id, "Worker heartbeat resumed; marking Online");
            }
            node.status = NodeStatus::Online;

            (
                node.id.clone(),
                node.ip_address.clone(),
                node.max_lanes,
                node.active_streams,
            )
        };

        // --- ALLOCATION LOGIC ---
        // Fill all currently available worker lanes, not just one per heartbeat.
        // Short-circuit when the worker reports itself full to avoid taking the
        // cameras write lock for nothing.
        if active_streams >= max_lanes {
            return ApiResponse::ok(());
        }

        let slots_available = max_lanes.saturating_sub(active_streams);
        let jobs: Vec<(String, String, serde_json::Value)> = {
            let mut cameras = state.cameras.write().unwrap();
            let retry_after = state.stream_retry_after.read().unwrap();
            let now = Utc::now();

            // Deterministic ordering: iterate cameras by id so allocation is
            // reproducible across restarts and doesn't depend on HashMap hash
            // randomization.
            let mut ordered_ids: Vec<String> = cameras.keys().cloned().collect();
            ordered_ids.sort();

            let mut jobs = Vec::with_capacity(slots_available);
            for cam_id in ordered_ids {
                if jobs.len() >= slots_available {
                    break;
                }
                let camera = match cameras.get_mut(&cam_id) {
                    Some(c) => c,
                    None => continue,
                };
                if camera.assigned_to.is_some() {
                    continue;
                }
                if let Some(deadline) = retry_after.get(&camera.id) {
                    if *deadline > now {
                        continue;
                    }
                }
                camera.assigned_to = Some(node_id.clone());
                let rois = match state.lookup_rois_for_camera(&camera.id) {
                    Some((_, roi_map)) => {
                        serde_json::to_value(roi_map).unwrap_or(serde_json::json!({}))
                    }
                    None => serde_json::json!({}),
                };
                jobs.push((camera.id.clone(), camera.stream_url.clone(), rois));
            }
            jobs
        };

        {
            for (stream_id, url, rois) in jobs {
                info!("Assigning camera {} to worker {}", stream_id, node_id);
                let assign_url = format!("http://{}/api/v1/streams/assign", node_ip);
                let client = reqwest::Client::new();
                let assign_payload = StreamAssignPayload {
                    stream_id: stream_id.clone(),
                    camera_name: stream_id.clone(),
                    url,
                    rois,
                };
                let state_for_revert = state.clone();
                let worker_id = node_id.clone();

                tokio::spawn(async move {
                    match client.post(&assign_url).json(&assign_payload).send().await {
                        Ok(res) if res.status().is_success() => {
                            info!("Successfully assigned {} to worker", stream_id);
                        }
                        Ok(res) => {
                            error!("Failed to assign stream {}: {}", stream_id, res.status());
                            let mut cams = state_for_revert.cameras.write().unwrap();
                            if let Some(cam) = cams.get_mut(&stream_id) {
                                if cam.assigned_to.as_deref() == Some(worker_id.as_str()) {
                                    cam.assigned_to = None;
                                }
                            }
                            let mut retry_after = state_for_revert.stream_retry_after.write().unwrap();
                            retry_after.insert(stream_id.clone(), Utc::now() + Duration::seconds(20));
                        }
                        Err(e) => {
                            error!("Error connecting to worker for assignment: {}", e);
                            let mut cams = state_for_revert.cameras.write().unwrap();
                            if let Some(cam) = cams.get_mut(&stream_id) {
                                if cam.assigned_to.as_deref() == Some(worker_id.as_str()) {
                                    cam.assigned_to = None;
                                }
                            }
                            let mut retry_after = state_for_revert.stream_retry_after.write().unwrap();
                            retry_after.insert(stream_id.clone(), Utc::now() + Duration::seconds(20));
                        }
                    }
                });
            }
        }

        ApiResponse::ok(())
    }

    #[post("/stream-status")]
    async fn stream_status(
        &self,
        Data(state): Data<SchedulerState>,
        Json(payload): Json<StreamStatusPayload>,
    ) -> ApiResponse<()> {
        if payload.status.eq_ignore_ascii_case("failed")
            || payload.status.eq_ignore_ascii_case("stopped")
            || payload.status.eq_ignore_ascii_case("eof")
        {
            let mut cameras = state.cameras.write().unwrap();
            if let Some(camera) = cameras.get_mut(&payload.stream_id) {
                if camera.assigned_to.as_deref() == Some(payload.worker_id.as_str()) {
                    camera.assigned_to = None;
                    let mut retry_after = state.stream_retry_after.write().unwrap();
                    retry_after.insert(payload.stream_id.clone(), Utc::now() + Duration::seconds(30));
                    info!(
                        "Unassigned stream {} from worker {} due to status={} reason={}",
                        payload.stream_id,
                        payload.worker_id,
                        payload.status,
                        payload.reason.unwrap_or_else(|| "n/a".to_string())
                    );
                }
            }
        }

        ApiResponse::ok(())
    }
}
