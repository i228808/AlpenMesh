use crate::state::{SchedulerState, NodeStatus};
use oxide_framework_core::{controller, ApiResponse, AppState, Data, StatusCode};
use std::time::Duration;
use tracing::{info, warn, error};
use reqwest::multipart;

pub struct InferenceController {
    client: reqwest::Client,
}

#[controller("/api/v1")]
impl InferenceController {
    fn new(_state: &AppState) -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    #[post("/infer")]
    async fn infer(
        &self,
        Data(state): Data<SchedulerState>,
        headers: axum::http::HeaderMap,
        body: axum::body::Bytes,
    ) -> ApiResponse<serde_json::Value> {
        let camera_id = headers
            .get("X-Camera-ID")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("unknown")
            .to_string();

        if body.is_empty() {
            return ApiResponse::error(StatusCode::BAD_REQUEST, "missing frame body");
        }

        let frame_bytes = body.to_vec();

        // 1. Find an online node (simplistic load balancing)
        let selected_node = {
            let nodes = state.nodes.read().unwrap();
            
            // Just pick the first online node for now
            if let Some(node) = nodes.values().find(|n| n.status == NodeStatus::Online) {
                node.clone()
            } else {
                return ApiResponse::error(StatusCode::SERVICE_UNAVAILABLE, "no online gpu nodes available");
            }
        };

        info!("Routing ad-hoc frame from {} to node {}", camera_id, selected_node.id);

        let rois_json = match state.lookup_rois_for_camera(&camera_id) {
            Some((_, roi_map)) => serde_json::to_string(&roi_map).unwrap_or_else(|_| "{}".to_string()),
            None => "{}".to_string(),
        };

        let form = multipart::Form::new()
            .part(
                "frame",
                multipart::Part::bytes(frame_bytes)
                    .file_name("frame.jpg"),
            )
            .text("camera_name", camera_id.clone())
            .text("rois", rois_json);

        // 2. Forward frame + camera metadata
        let node_url = format!("http://{}/execute", selected_node.ip_address);
        
        let request_future = self.client
            .post(&node_url)
            .header("X-Camera-ID", &camera_id)
            .multipart(form)
            .send();

        let response_result = tokio::time::timeout(Duration::from_millis(1000), request_future).await;

        match response_result {
            Ok(Ok(response)) if response.status().is_success() => {
                match response.json::<serde_json::Value>().await {
                    Ok(payload) => ApiResponse::ok(payload),
                    Err(_) => ApiResponse::error(StatusCode::BAD_GATEWAY, "invalid response from node"),
                }
            }
            Ok(Ok(_)) => ApiResponse::error(StatusCode::BAD_GATEWAY, "node returned error status"),
            Ok(Err(e)) => {
                error!("Reqwest error: {}", e);
                ApiResponse::error(StatusCode::BAD_GATEWAY, "failed to route frame to node")
            }
            Err(_) => {
                warn!("Timeout routing to node {}", selected_node.id);
                ApiResponse::error(StatusCode::REQUEST_TIMEOUT, "request timeout")
            }
        }
    }
}
