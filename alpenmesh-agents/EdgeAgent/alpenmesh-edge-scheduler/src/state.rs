use chrono::{DateTime, Utc};
use mongodb::Client;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::RwLock as AsyncRwLock;
use tracing::{error, info};

pub type RoiMap = HashMap<String, Vec<[i32; 2]>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkerProofAccount {
    pub worker_id: String,
    pub total_inferences: u64,
    pub total_reward_alpen: f64,
    pub last_window_start_ms: u64,
    pub last_window_end_ms: u64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChainSubmissionTask {
    pub proof_id: String,
    pub worker_id: String,
    pub total_inferences: u64,
    pub reward_alpen: f64,
    pub window_start_ms: u64,
    pub window_end_ms: u64,
    pub retries: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum NodeStatus {
    Online,
    Offline,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderNode {
    pub id: String,
    pub ip_address: String,
    pub total_vram: u64,
    pub free_vram: u64,
    pub max_lanes: usize,
    pub active_streams: usize,
    pub status: NodeStatus,
    pub last_seen: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] // Match the Seattle dataset style
pub struct CameraStream {
    #[serde(rename = "cameraName")]
    pub id: String,

    // We use streamUrl for the video ingestion
    pub stream_url: String,

    #[serde(default)]
    pub assigned_to: Option<String>, // Internal tracking
}

#[derive(Clone)]
pub struct SchedulerState {
    pub nodes: Arc<RwLock<HashMap<String, ProviderNode>>>,
    pub cameras: Arc<RwLock<HashMap<String, CameraStream>>>,
    pub rois: Arc<HashMap<String, RoiMap>>,
    pub camera_to_roi_key: Arc<HashMap<String, String>>,
    pub mongo_uri: Arc<String>,
    pub mongo_client: Arc<AsyncRwLock<Option<Client>>>,
    pub stream_retry_after: Arc<RwLock<HashMap<String, DateTime<Utc>>>>,
    pub proof_accounts: Arc<RwLock<HashMap<String, WorkerProofAccount>>>,
    pub chain_submission_queue: Arc<Mutex<VecDeque<ChainSubmissionTask>>>,
    pub reporting_agent_url: Arc<String>,
}

impl SchedulerState {
    pub fn new() -> Self {
        let mut cameras = HashMap::new();
        let mut rois = HashMap::new();

        // 1. Load cameras from JSON file
        match fs::read_to_string("cameras.json") {
            Ok(content) => match serde_json::from_str::<Vec<CameraStream>>(&content) {
                Ok(list) => {
                    info!(
                        "🚀 MASTER REGISTRY: Loaded {} cameras from cameras.json",
                        list.len()
                    );
                    for cam in list {
                        cameras.insert(cam.id.clone(), cam);
                    }
                }
                Err(e) => {
                    error!("❌ CONFIG ERROR: Failed to parse cameras.json: {}", e);
                }
            },
            Err(e) => {
                error!("⚠️ CONFIG WARNING: cameras.json not found: {}", e);
            }
        }

        let roi_paths = ["../road_rois.json", "road_rois.json"];
        for path in roi_paths {
            match fs::read_to_string(path) {
                Ok(content) => match serde_json::from_str::<HashMap<String, RoiMap>>(&content) {
                    Ok(map) => {
                        info!("Loaded {} ROI camera definitions from {}", map.len(), path);
                        rois = map;
                        break;
                    }
                    Err(e) => {
                        error!("Failed to parse ROI file {}: {}", path, e);
                    }
                },
                Err(_) => {
                    // Try next path
                }
            }
        }

        let mut camera_to_roi_key = HashMap::new();
        let mut roi_index = HashMap::new();
        for roi_key in rois.keys() {
            roi_index.insert(Self::normalize_camera_name(roi_key), roi_key.clone());
        }

        for camera_name in cameras.keys() {
            let normalized = Self::normalize_camera_name(camera_name);
            if let Some(roi_key) = roi_index.get(&normalized) {
                camera_to_roi_key.insert(camera_name.clone(), roi_key.clone());
            }
        }

        let base_mongo_uri = std::env::var("MONGODB_URI")
            .unwrap_or_else(|_| "mongodb://127.0.0.1:27017".to_string());
        let auth_source =
            std::env::var("MONGODB_AUTH_SOURCE").unwrap_or_else(|_| "alpenmesh".to_string());
        let mongo_uri = Self::build_mongo_uri(&base_mongo_uri, &auth_source);
        info!("Prepared MongoDB URI for alpenmesh at {}", mongo_uri);

        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
            cameras: Arc::new(RwLock::new(cameras)),
            rois: Arc::new(rois),
            camera_to_roi_key: Arc::new(camera_to_roi_key),
            mongo_uri: Arc::new(mongo_uri),
            mongo_client: Arc::new(AsyncRwLock::new(None)),
            stream_retry_after: Arc::new(RwLock::new(HashMap::new())),
            proof_accounts: Arc::new(RwLock::new(HashMap::new())),
            chain_submission_queue: Arc::new(Mutex::new(VecDeque::new())),
            reporting_agent_url: Arc::new(std::env::var("REPORTING_AGENT_URL").unwrap_or_else(|_| "http://127.0.0.1:8001".to_string())),
        }
    }

    pub fn enqueue_chain_submission(&self, task: ChainSubmissionTask) {
        let mut queue = self.chain_submission_queue.lock().unwrap();
        queue.push_back(task);
    }

    pub fn dequeue_chain_submission(&self) -> Option<ChainSubmissionTask> {
        let mut queue = self.chain_submission_queue.lock().unwrap();
        queue.pop_front()
    }

    pub fn requeue_chain_submission(&self, task: ChainSubmissionTask) {
        let mut queue = self.chain_submission_queue.lock().unwrap();
        queue.push_back(task);
    }

    pub fn chain_submission_queue_len(&self) -> usize {
        let queue = self.chain_submission_queue.lock().unwrap();
        queue.len()
    }

    pub fn lookup_rois_for_camera(&self, camera_name: &str) -> Option<(String, RoiMap)> {
        if let Some(roi_key) = self.camera_to_roi_key.get(camera_name) {
            return self.rois.get(roi_key).map(|r| (roi_key.clone(), r.clone()));
        }

        let normalized_target = Self::normalize_camera_name(camera_name);
        for (roi_key, roi_map) in self.rois.iter() {
            if Self::normalize_camera_name(roi_key) == normalized_target {
                return Some((roi_key.clone(), roi_map.clone()));
            }
        }

        None
    }

    fn normalize_camera_name(name: &str) -> String {
        name.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    ' '
                }
            })
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn build_mongo_uri(base_uri: &str, auth_source: &str) -> String {
        let trimmed = base_uri.trim();

        // Split into the path (mongodb://user:pass@host:port[/db]) and the
        // existing option string so we can add defaults without mangling either.
        let (path_part, mut query_part) = match trimmed.split_once('?') {
            Some((p, q)) => (p.to_string(), q.to_string()),
            None => (trimmed.to_string(), String::new()),
        };

        // Ensure there is exactly one '/' between the authority (host[:port])
        // and the query string — that's required by the Mongo URI spec when
        // any options follow. Appending a slash at the end of an already-
        // present database name like "/alpenmesh" would make the driver read
        // "alpenmesh/" as the DB name and fail with "illegal character in
        // database name" — that was the previous bug.
        let scheme_stripped = path_part
            .strip_prefix("mongodb+srv://")
            .or_else(|| path_part.strip_prefix("mongodb://"))
            .unwrap_or(&path_part);
        let has_path_separator = scheme_stripped.contains('/');
        let normalized_path = if has_path_separator {
            path_part
        } else {
            format!("{}/", path_part)
        };

        let mut params: Vec<String> = if query_part.is_empty() {
            Vec::new()
        } else {
            // Drop any empty segments that can result from stray "&"s.
            std::mem::take(&mut query_part)
                .split('&')
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        };

        fn has_key(params: &[String], key: &str) -> bool {
            params.iter().any(|p| p.starts_with(key))
        }

        if !has_key(&params, "directConnection=") {
            params.push("directConnection=true".to_string());
        }
        if !has_key(&params, "serverSelectionTimeoutMS=") {
            params.push("serverSelectionTimeoutMS=3000".to_string());
        }
        if !has_key(&params, "authSource=") {
            params.push(format!("authSource={}", auth_source));
        }

        if params.is_empty() {
            normalized_path
        } else {
            format!("{}?{}", normalized_path, params.join("&"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SchedulerState;

    #[test]
    fn builds_uri_with_default_authdb_intact() {
        let out = SchedulerState::build_mongo_uri(
            "mongodb://admin:adminpassword@localhost:27017/alpenmesh",
            "admin",
        );
        assert_eq!(
            out,
            "mongodb://admin:adminpassword@localhost:27017/alpenmesh\
             ?directConnection=true&serverSelectionTimeoutMS=3000&authSource=admin"
        );
    }

    #[test]
    fn builds_uri_when_authority_only() {
        let out = SchedulerState::build_mongo_uri("mongodb://localhost:27017", "alpenmesh");
        assert_eq!(
            out,
            "mongodb://localhost:27017/\
             ?directConnection=true&serverSelectionTimeoutMS=3000&authSource=alpenmesh"
        );
    }

    #[test]
    fn preserves_existing_query_options() {
        let out = SchedulerState::build_mongo_uri(
            "mongodb://localhost:27017/mydb?retryWrites=true&authSource=admin",
            "ignored",
        );
        assert!(out.starts_with("mongodb://localhost:27017/mydb?retryWrites=true&authSource=admin"));
        assert!(out.contains("directConnection=true"));
        assert!(out.contains("serverSelectionTimeoutMS=3000"));
        // authSource already present → not duplicated
        assert_eq!(out.matches("authSource=").count(), 1);
    }

    #[test]
    fn srv_scheme_also_handled() {
        let out = SchedulerState::build_mongo_uri(
            "mongodb+srv://user:pw@cluster.example.com/myapp",
            "admin",
        );
        assert!(out.starts_with("mongodb+srv://user:pw@cluster.example.com/myapp?"));
        assert!(!out.contains("/myapp/?"));
    }
}
