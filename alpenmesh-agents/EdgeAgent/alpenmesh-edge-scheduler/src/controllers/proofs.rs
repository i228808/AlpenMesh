use crate::state::{ChainSubmissionTask, SchedulerState, WorkerProofAccount};
use chrono::Utc;
use mongodb::bson::{doc, oid::ObjectId, DateTime as BsonDateTime};
use mongodb::options::IndexOptions;
use oxide_framework_core::{controller, ApiResponse, Data, Json, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{error, info, warn};

const REWARD_PER_100_INFERENCES: f64 = 0.5;

#[derive(Debug, Deserialize, Serialize)]
pub struct ProofBatchPayload {
    pub worker_id: String,
    pub window_start_ms: u64,
    pub window_end_ms: u64,
    pub total_inferences: u64,
    #[serde(default)]
    pub camera_inferences: HashMap<String, u64>,
}

pub struct ProofsController;

#[controller("/api/v1")]
impl ProofsController {
    fn new(_state: &oxide_framework_core::AppState) -> Self {
        Self
    }

    #[post("/proofs")]
    async fn ingest_proofs(
        &self,
        Data(state): Data<SchedulerState>,
        Json(payload): Json<ProofBatchPayload>,
    ) -> ApiResponse<serde_json::Value> {
        if let Err(e) = ensure_proof_indexes(&state).await {
            warn!(error = %e, "Failed to ensure proof indexes");
        }

        if payload.worker_id.trim().is_empty() {
            return ApiResponse::error(StatusCode::BAD_REQUEST, "worker_id is required");
        }

        let window_valid = payload.window_end_ms >= payload.window_start_ms;
        if !window_valid {
            return ApiResponse::error(StatusCode::BAD_REQUEST, "invalid proof window");
        }

        let reward_alpen = reward_for_inferences(payload.total_inferences);

        {
            let mut accounts = state.proof_accounts.write().unwrap();
            let entry = accounts
                .entry(payload.worker_id.clone())
                .or_insert(WorkerProofAccount {
                    worker_id: payload.worker_id.clone(),
                    total_inferences: 0,
                    total_reward_alpen: 0.0,
                    last_window_start_ms: payload.window_start_ms,
                    last_window_end_ms: payload.window_end_ms,
                    updated_at: Utc::now(),
                });

            entry.total_inferences = entry.total_inferences.saturating_add(payload.total_inferences);
            entry.total_reward_alpen += reward_alpen;
            entry.last_window_start_ms = payload.window_start_ms;
            entry.last_window_end_ms = payload.window_end_ms;
            entry.updated_at = Utc::now();
        }

        let proof_id = match write_proof_to_mongo(&state, &payload, reward_alpen).await {
            Ok(proof_id) => proof_id,
            Err(e) => {
                warn!(
                    worker_id = %payload.worker_id,
                    error = %e,
                    "Proof batch stored in memory but not persisted to MongoDB"
                );
                String::new()
            }
        };

        if !proof_id.is_empty() {
            state.enqueue_chain_submission(ChainSubmissionTask {
                proof_id: proof_id.clone(),
                worker_id: payload.worker_id.clone(),
                total_inferences: payload.total_inferences,
                reward_alpen,
                window_start_ms: payload.window_start_ms,
                window_end_ms: payload.window_end_ms,
                retries: 0,
            });
        }

        if proof_id.is_empty() {
            warn!(
                worker_id = %payload.worker_id,
                "Skipping chain queueing because proof did not persist"
            );
        }

        info!(
            worker_id = %payload.worker_id,
            total_inferences = payload.total_inferences,
            reward_alpen,
            "Accepted proof batch"
        );

        ApiResponse::ok(serde_json::json!({
            "status": "accepted",
            "proof_id": proof_id,
            "worker_id": payload.worker_id,
            "total_inferences": payload.total_inferences,
            "reward_alpen": reward_alpen,
            "window_start_ms": payload.window_start_ms,
            "window_end_ms": payload.window_end_ms
        }))
    }
}

fn reward_for_inferences(total_inferences: u64) -> f64 {
    (total_inferences as f64 / 100.0) * REWARD_PER_100_INFERENCES
}

async fn write_proof_to_mongo(
    state: &SchedulerState,
    payload: &ProofBatchPayload,
    reward_alpen: f64,
) -> Result<String, mongodb::error::Error> {
    let mongo_client = match get_or_create_mongo_client(state).await {
        Ok(client) => client,
        Err(e) => {
            error!(worker_id = %payload.worker_id, error = %e, "Mongo client unavailable for proofs");
            return Err(e);
        }
    };

    let db = mongo_client.database("alpenmesh");
    let proofs = db.collection::<mongodb::bson::Document>("proof_batches");
    let accounts = db.collection::<mongodb::bson::Document>("worker_accounts");

    let existing = proofs
        .find_one(doc! {
            "worker_id": &payload.worker_id,
            "window_start_ms": payload.window_start_ms as i64,
            "window_end_ms": payload.window_end_ms as i64,
        })
        .await?;
    if let Some(doc) = existing {
        if let Ok(existing_proof_id) = doc.get_str("proof_id") {
            info!(worker_id = %payload.worker_id, proof_id = %existing_proof_id, "Duplicate proof window accepted idempotently");
            return Ok(existing_proof_id.to_string());
        }
    }

    let proof_id = ObjectId::new().to_hex();

    let proof_doc = doc! {
        "proof_id": &proof_id,
        "worker_id": &payload.worker_id,
        "timestamp": BsonDateTime::now(),
        "updated_at": BsonDateTime::now(),
        "window_start_ms": payload.window_start_ms as i64,
        "window_end_ms": payload.window_end_ms as i64,
        "total_inferences": payload.total_inferences as i64,
        "camera_inferences": mongodb::bson::to_bson(&payload.camera_inferences).unwrap_or(mongodb::bson::Bson::Document(doc! {})),
        "reward_alpen": reward_alpen,
        "chain_status": "queued",
        "chain_attempts": 0,
    };

    proofs.insert_one(proof_doc).await?;

    accounts
        .update_one(
            doc! { "worker_id": &payload.worker_id },
            doc! {
                "$inc": {
                    "total_inferences": payload.total_inferences as i64,
                    "total_reward_alpen": reward_alpen,
                },
                "$set": {
                    "updated_at": BsonDateTime::now(),
                    "last_window_start_ms": payload.window_start_ms as i64,
                    "last_window_end_ms": payload.window_end_ms as i64,
                },
                "$setOnInsert": {
                    "worker_id": &payload.worker_id,
                }
            },
        )
        .upsert(true)
        .await?;

    Ok(proof_id)
}

async fn ensure_proof_indexes(state: &SchedulerState) -> Result<(), mongodb::error::Error> {
    use mongodb::IndexModel;

    let mongo_client = get_or_create_mongo_client(state).await?;
    let db = mongo_client.database("alpenmesh");
    let proofs = db.collection::<mongodb::bson::Document>("proof_batches");

    let proof_id_index = IndexModel::builder()
        .keys(doc! { "proof_id": 1 })
        .options(IndexOptions::builder().unique(true).name("uniq_proof_id".to_string()).build())
        .build();

    let proof_window_index = IndexModel::builder()
        .keys(doc! {
            "worker_id": 1,
            "window_start_ms": 1,
            "window_end_ms": 1,
        })
        .options(
            IndexOptions::builder()
                .unique(true)
                .name("uniq_worker_window".to_string())
                .build(),
        )
        .build();

    proofs.create_index(proof_id_index).await?;
    proofs.create_index(proof_window_index).await?;
    Ok(())
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
