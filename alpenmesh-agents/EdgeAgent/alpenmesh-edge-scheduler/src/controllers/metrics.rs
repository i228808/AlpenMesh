use crate::state::SchedulerState;
use mongodb::bson::{doc, oid::ObjectId, DateTime as BsonDateTime};
use oxide_framework_core::{controller, ApiResponse, Data, Json, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, error, info, warn};

#[derive(Debug, Deserialize, Serialize)]
pub struct TrafficLightMetric {
    pub color: String,
    pub nearest_roi: String,
    pub confidence: f32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RoiTrafficMetrics {
    pub occupancy: u32,
    pub mean_dwell_sec: f32,
    pub stalled_count: u32,
    pub slow_throughput: u32,
    pub queue_growth_rate: f32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct WorkerMetricPayload {
    pub camera_name: String,
    pub vehicle_counts: HashMap<String, u32>,
    pub congestion_levels: HashMap<String, String>,
    pub total_vehicles: u32,
    #[serde(default)]
    pub traffic_lights: Vec<TrafficLightMetric>,
    #[serde(default)]
    pub latency: Option<u128>,
    #[serde(default)]
    pub tracked_vehicles: Option<u32>,
    #[serde(default)]
    pub traffic_metrics: Option<HashMap<String, RoiTrafficMetrics>>,
}

pub struct MetricsController;

#[controller("/api/v1")]
impl MetricsController {
    fn new(_state: &oxide_framework_core::AppState) -> Self {
        Self
    }

    #[post("/metrics")]
    async fn ingest_metrics(
        &self,
        Data(state): Data<SchedulerState>,
        Json(payload): Json<WorkerMetricPayload>,
    ) -> ApiResponse<serde_json::Value> {
        let camera_name = payload.camera_name.clone();
        let vehicle_roi_count = payload.vehicle_counts.len();
        let congestion_roi_count = payload.congestion_levels.len();
        let traffic_light_count = payload.traffic_lights.len();
        let total_vehicles = payload.total_vehicles;

        let mongo_client = match get_or_create_mongo_client(&state).await {
            Ok(client) => client,
            Err(e) => {
                error!(camera_name=%camera_name, error=%e, "Mongo client unavailable");
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("mongodb unavailable: {}", e),
                );
            }
        };

        let db = mongo_client.database("alpenmesh");
        let collection = db.collection::<mongodb::bson::Document>("traffic_metrics");

        let mut metrics_doc = doc! {
            "_id": ObjectId::new(),
            "camera_name": normalize_camera_name(&payload.camera_name),
            "timestamp": BsonDateTime::now(),
            "vehicle_counts": mongodb::bson::to_bson(&payload.vehicle_counts).unwrap_or(mongodb::bson::Bson::Document(doc! {})),
            "congestion_levels": mongodb::bson::to_bson(&payload.congestion_levels).unwrap_or(mongodb::bson::Bson::Document(doc! {})),
            "total_vehicles": payload.total_vehicles as i64,
            "traffic_lights": mongodb::bson::to_bson(&payload.traffic_lights).unwrap_or(mongodb::bson::Bson::Array(vec![])),
        };

        if let Some(latency) = payload.latency {
            metrics_doc.insert("latency", latency as i64);
        }

        if let Some(tracked_vehicles) = payload.tracked_vehicles {
            metrics_doc.insert("tracked_vehicles", tracked_vehicles as i64);
        }

        if let Some(traffic_metrics) = &payload.traffic_metrics {
            metrics_doc.insert("traffic_metrics", mongodb::bson::to_bson(traffic_metrics).unwrap_or(mongodb::bson::Bson::Document(doc! {})));
        }

        debug!(
            camera_name = %camera_name,
            vehicle_roi_count,
            congestion_roi_count,
            traffic_light_count,
            total_vehicles,
            "Attempting to store worker metrics"
        );

        match collection.insert_one(metrics_doc).await {
            Ok(res) => {
                info!(
                    camera_name = %camera_name,
                    inserted_id = %res.inserted_id,
                    total_vehicles,
                    "Stored worker metrics in MongoDB"
                );
                ApiResponse::ok(serde_json::json!({
                    "inserted_id": res.inserted_id,
                    "status": "stored"
                }))
            }
            Err(e) => {
                error!(
                    camera_name = %camera_name,
                    vehicle_roi_count,
                    congestion_roi_count,
                    traffic_light_count,
                    total_vehicles,
                    error = %e,
                    error_debug = ?e,
                    "Failed to store worker metrics in MongoDB"
                );
                if e.to_string().contains("Server selection timeout") {
                    let mut guard = state.mongo_client.write().await;
                    *guard = None;
                    warn!("Cleared cached MongoDB client after server selection timeout");
                }
                ApiResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to store metrics in alpenmesh: {}", e),
                )
            }
        }
    }

    #[post("/stalled")]
    async fn proxy_stalled_alert(
        &self,
        Data(state): Data<SchedulerState>,
        Json(payload): Json<serde_json::Value>,
    ) -> ApiResponse<serde_json::Value> {
        let agent_url = format!("{}/report", *state.reporting_agent_url);
        let client = reqwest::Client::new();

        match client.post(&agent_url).json(&payload).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    ApiResponse::ok(serde_json::json!({ "status": "forwarded to reporting agent" }))
                } else {
                    let err_text = resp.text().await.unwrap_or_default();
                    error!("Reporting agent rejected stalled vehicle alert: {}", err_text);
                    ApiResponse::error(StatusCode::BAD_GATEWAY, format!("Agent error: {}", err_text))
                }
            }
            Err(e) => {
                error!("Failed to reach reporting agent at {}: {}", agent_url, e);
                ApiResponse::error(StatusCode::BAD_GATEWAY, "Reporting agent unavailable".to_string())
            }
        }
    }

    #[post("/accidents")]
    async fn proxy_accident_alert(
        &self,
        Data(state): Data<SchedulerState>,
        Json(mut payload): Json<serde_json::Value>,
    ) -> ApiResponse<serde_json::Value> {
        // Swap "frame" to "image" for the legacy python agent
        if let Some(frame) = payload.get_mut("frame").map(|v| v.take()) {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("image".to_string(), frame);
                obj.remove("frame");
            }
        }

        let agent_url = format!("{}/report", *state.reporting_agent_url);
        let client = reqwest::Client::new();
        
        match client.post(&agent_url).json(&payload).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    ApiResponse::ok(serde_json::json!({ "status": "forwarded to reporting agent" }))
                } else {
                    let err_text = resp.text().await.unwrap_or_default();
                    error!("Reporting agent rejected accident alert: {}", err_text);
                    ApiResponse::error(StatusCode::BAD_GATEWAY, format!("Agent error: {}", err_text))
                }
            }
            Err(e) => {
                error!("Failed to reach reporting agent at {}: {}", agent_url, e);
                ApiResponse::error(StatusCode::BAD_GATEWAY, "Reporting agent unavailable".to_string())
            }
        }
    }

    #[post("/congestion")]
    async fn proxy_congestion_alert(
        &self,
        Data(state): Data<SchedulerState>,
        Json(mut payload): Json<serde_json::Value>,
    ) -> ApiResponse<serde_json::Value> {
        // Swap "frame" to "image" for the legacy python agent
        if let Some(frame) = payload.get_mut("frame").map(|v| v.take()) {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("image".to_string(), frame);
                obj.remove("frame");
            }
        }

        let agent_url = format!("{}/report-congestion", *state.reporting_agent_url);
        let client = reqwest::Client::new();
        
        match client.post(&agent_url).json(&payload).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    ApiResponse::ok(serde_json::json!({ "status": "forwarded to reporting agent" }))
                } else {
                    let err_text = resp.text().await.unwrap_or_default();
                    error!("Reporting agent rejected congestion alert: {}", err_text);
                    ApiResponse::error(StatusCode::BAD_GATEWAY, format!("Agent error: {}", err_text))
                }
            }
            Err(e) => {
                error!("Failed to reach reporting agent at {}: {}", agent_url, e);
                ApiResponse::error(StatusCode::BAD_GATEWAY, "Reporting agent unavailable".to_string())
            }
        }
    }
}

fn normalize_camera_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    let mut prev_was_sep = false;

    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_was_sep = false;
        } else if ch == '&' {
            if !out.ends_with('_') {
                out.push('_');
            }
            out.push('_');
            prev_was_sep = true;
        } else if ch.is_whitespace() || ch == '-' {
            if !prev_was_sep && !out.ends_with('_') {
                out.push('_');
            }
            prev_was_sep = true;
        }
    }

    while out.ends_with('_') {
        out.pop();
    }

    out
}

async fn get_or_create_mongo_client(
    state: &SchedulerState,
) -> Result<mongodb::Client, mongodb::error::Error> {
    {
        let guard = state.mongo_client.read().await;
        if let Some(client) = guard.as_ref() {
            return Ok(client.clone());
        }
    }

    let mut guard = state.mongo_client.write().await;
    if let Some(client) = guard.as_ref() {
        return Ok(client.clone());
    }

    let client = mongodb::Client::with_uri_str(state.mongo_uri.as_str()).await?;
    let db = client.database("alpenmesh");
    db.run_command(doc! { "ping": 1 }).await?;
    *guard = Some(client.clone());
    Ok(client)
}
