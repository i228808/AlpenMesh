use crate::state::{
    EconomyState, ProofBatchRecord, WalletConnection,
};
use chrono::{DateTime, Utc};
use mongodb::bson::{doc, Document};
use oxide_framework_core::{controller, ApiResponse, Data, Json, Path, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Default)]
pub struct EconomyController;

#[derive(Debug, Serialize)]
pub struct WorkerEarningsResponse {
    pub worker_id: String,
    pub payout_wallet: Option<String>,
    pub total_inferences: u64,
    pub total_reward_alpen: f64,
    pub pending_reward_alpen: f64,
    pub submitted_reward_alpen: f64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct WorkerProofsResponse {
    pub worker_id: String,
    pub proofs: Vec<ProofBatchRecord>,
}

#[derive(Debug, Serialize)]
pub struct DashboardSummaryResponse {
    pub total_workers: u64,
    pub total_inferences: u64,
    pub total_reward_alpen: f64,
    pub pending_reward_alpen: f64,
    pub submitted_reward_alpen: f64,
}

#[derive(Debug, Deserialize)]
pub struct BindWalletRequest {
    pub wallet_address: String,
}

#[derive(Debug, Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct ConnectWorkerRequest {
    pub worker_id: String,
    pub worker_secret: String,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConnectWalletRequest {
    pub wallet_address: String,
    pub network: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserPortfolioRequest {
    pub user_id: String,
}

#[derive(Debug, Deserialize)]
pub struct WorkerScopeRequest {
    pub worker_id: String,
}

#[derive(Debug, Deserialize)]
pub struct BindWorkerWalletRequest {
    pub worker_id: String,
    pub wallet_address: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterWorkerRequest {
    pub worker_id: String,
    pub worker_secret: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user_id: String,
    pub session_token: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
pub struct WorkerPortfolioItem {
    pub worker_id: String,
    pub label: String,
    pub payout_wallet: Option<String>,
    pub total_inferences: u64,
    pub total_reward_alpen: f64,
    pub submitted_reward_alpen: f64,
    pub pending_reward_alpen: f64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct UserPortfolioResponse {
    pub user_id: String,
    pub display_name: String,
    pub email: String,
    pub wallet: Option<WalletConnection>,
    pub workers: Vec<WorkerPortfolioItem>,
}

#[controller("/api/v1/economy")]
impl EconomyController {
    fn new(_state: &oxide_framework_core::AppState) -> Self {
        Self
    }

    #[get("/dashboard/summary")]
    async fn dashboard_summary(
        &self,
        Data(state): Data<EconomyState>,
    ) -> ApiResponse<DashboardSummaryResponse> {
        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };

        let coll = client.database("alpenmesh").collection::<Document>("worker_accounts");
        let mut cursor = match coll.find(doc! {}).await {
            Ok(c) => c,
            Err(_) => return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "query failed"),
        };

        let mut total_workers = 0u64;
        let mut total_inferences = 0u64;
        let mut total_reward = 0f64;
        let mut pending_reward = 0f64;
        let mut submitted_reward = 0f64;

        while cursor.advance().await.unwrap_or(false) {
            if let Ok(doc) = cursor.deserialize_current() {
                total_workers = total_workers.saturating_add(1);
                total_inferences = total_inferences
                    .saturating_add(doc.get_i64("total_inferences").unwrap_or(0).max(0) as u64);
                total_reward += doc.get_f64("total_reward_alpen").unwrap_or(0.0);
                pending_reward += doc.get_f64("pending_reward_alpen").unwrap_or(0.0);
                submitted_reward += doc.get_f64("submitted_reward_alpen").unwrap_or(0.0);
            }
        }

        ApiResponse::ok(DashboardSummaryResponse {
            total_workers,
            total_inferences,
            total_reward_alpen: total_reward,
            pending_reward_alpen: pending_reward,
            submitted_reward_alpen: submitted_reward,
        })
    }

    #[post("/auth/signup")]
    async fn signup(
        &self,
        Data(state): Data<EconomyState>,
        Json(body): Json<SignupRequest>,
    ) -> ApiResponse<AuthResponse> {
        if body.email.trim().is_empty() || body.password.trim().is_empty() {
            return ApiResponse::error(StatusCode::BAD_REQUEST, "email and password are required");
        }

        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };

        let db = client.database("alpenmesh");
        let users = db.collection::<Document>("economy_users");

        let email = body.email.trim().to_lowercase();
        if let Ok(Some(_)) = users.find_one(doc! { "email": &email }).await {
            return ApiResponse::error(StatusCode::CONFLICT, "email already registered");
        }

        let user_id = format!("usr_{}", Uuid::new_v4().simple());
        let session_token = format!("sess_{}", Uuid::new_v4().simple());
        let hash = hash_password(&body.password);
        let now = mongodb::bson::DateTime::now();

        let insert_res = users
            .insert_one(doc! {
                "user_id": &user_id,
                "email": &email,
                "password_hash": hash,
                "display_name": body.display_name.trim(),
                "session_token": &session_token,
                "created_at": now,
                "updated_at": now,
            })
            .await;

        if insert_res.is_err() {
            return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "failed creating user");
        }

        {
            let mut cache = state.session_cache.write().await;
            cache.insert(session_token.clone(), user_id.clone());
        }

        ApiResponse::ok(AuthResponse {
            user_id,
            session_token,
            email,
            display_name: body.display_name,
        })
    }

    #[post("/auth/login")]
    async fn login(
        &self,
        Data(state): Data<EconomyState>,
        Json(body): Json<LoginRequest>,
    ) -> ApiResponse<AuthResponse> {
        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };
        let users = client.database("alpenmesh").collection::<Document>("economy_users");

        let email = body.email.trim().to_lowercase();
        let user_doc = match users.find_one(doc! { "email": &email }).await {
            Ok(Some(d)) => d,
            _ => return ApiResponse::error(StatusCode::UNAUTHORIZED, "invalid credentials"),
        };

        let stored_hash = user_doc.get_str("password_hash").unwrap_or_default();
        if stored_hash != hash_password(&body.password) {
            return ApiResponse::error(StatusCode::UNAUTHORIZED, "invalid credentials");
        }

        let user_id = user_doc.get_str("user_id").unwrap_or_default().to_string();
        let display_name = user_doc
            .get_str("display_name")
            .unwrap_or("worker")
            .to_string();
        let session_token = format!("sess_{}", Uuid::new_v4().simple());

        let _ = users
            .update_one(
                doc! { "user_id": &user_id },
                doc! {
                    "$set": {
                        "session_token": &session_token,
                        "updated_at": mongodb::bson::DateTime::now(),
                    }
                },
            )
            .await;

        {
            let mut cache = state.session_cache.write().await;
            cache.insert(session_token.clone(), user_id.clone());
        }

        ApiResponse::ok(AuthResponse {
            user_id,
            session_token,
            email,
            display_name,
        })
    }

    #[post("/users/{id}/workers")]
    async fn connect_worker(
        &self,
        Data(state): Data<EconomyState>,
        Path(id): Path<String>,
        Json(body): Json<ConnectWorkerRequest>,
    ) -> ApiResponse<serde_json::Value> {
        if body.worker_id.trim().is_empty() || body.worker_secret.trim().is_empty() {
            return ApiResponse::error(
                StatusCode::BAD_REQUEST,
                "worker_id and worker_secret are required",
            );
        }

        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };

        let db = client.database("alpenmesh");
        let registry = db.collection::<Document>("worker_registry");
        let bindings = db.collection::<Document>("worker_bindings");

        let registry_doc = match registry
            .find_one(doc! { "worker_id": body.worker_id.trim() })
            .await
        {
            Ok(Some(d)) => d,
            _ => {
                return ApiResponse::error(
                    StatusCode::NOT_FOUND,
                    "worker not registered from local install",
                )
            }
        };

        let expected_hash = registry_doc
            .get_str("worker_secret_hash")
            .unwrap_or_default()
            .to_string();
        if expected_hash.is_empty() || expected_hash != hash_password(body.worker_secret.trim()) {
            return ApiResponse::error(StatusCode::UNAUTHORIZED, "worker secret verification failed");
        }

        if let Ok(owner) = registry_doc.get_str("claimed_by_user_id") {
            if owner != id {
                return ApiResponse::error(
                    StatusCode::FORBIDDEN,
                    "worker already claimed by another user",
                );
            }
        }

        let now = mongodb::bson::DateTime::now();
        let label = body
            .label
            .unwrap_or_else(|| format!("Worker {}", body.worker_id.trim()));

        let _ = registry
            .update_one(
                doc! { "worker_id": body.worker_id.trim() },
                doc! {
                    "$set": {
                        "claimed_by_user_id": &id,
                        "updated_at": now,
                    }
                },
            )
            .await;

        let update = bindings
            .update_one(
                doc! { "worker_id": body.worker_id.trim() },
                doc! {
                    "$set": {
                        "user_id": &id,
                        "worker_secret": body.worker_secret.trim(),
                        "label": label.clone(),
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "worker_id": body.worker_id.trim(),
                        "created_at": now,
                    }
                },
            )
            .upsert(true)
            .await;

        if update.is_err() {
            return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "failed to connect worker");
        }

        ApiResponse::ok(serde_json::json!({
            "status": "connected",
            "user_id": &id,
            "worker_id": body.worker_id.trim(),
            "label": label,
        }))
    }

    #[post("/workers/register")]
    async fn register_worker(
        &self,
        Data(state): Data<EconomyState>,
        Json(body): Json<RegisterWorkerRequest>,
    ) -> ApiResponse<serde_json::Value> {
        if body.worker_id.trim().is_empty() || body.worker_secret.trim().is_empty() {
            return ApiResponse::error(
                StatusCode::BAD_REQUEST,
                "worker_id and worker_secret are required",
            );
        }

        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };

        let registry = client
            .database("alpenmesh")
            .collection::<Document>("worker_registry");
        let now = mongodb::bson::DateTime::now();
        let hash = hash_password(body.worker_secret.trim());

        let up = registry
            .update_one(
                doc! { "worker_id": body.worker_id.trim() },
                doc! {
                    "$set": {
                        "worker_secret_hash": hash,
                        "status": "active",
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "worker_id": body.worker_id.trim(),
                        "created_at": now,
                    }
                },
            )
            .upsert(true)
            .await;

        if up.is_err() {
            return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "worker register failed");
        }

        ApiResponse::ok(serde_json::json!({
            "status": "registered",
            "worker_id": body.worker_id.trim(),
        }))
    }

    #[post("/users/{id}/wallet")]
    async fn connect_wallet(
        &self,
        Data(state): Data<EconomyState>,
        Path(id): Path<String>,
        Json(body): Json<ConnectWalletRequest>,
    ) -> ApiResponse<serde_json::Value> {
        if body.wallet_address.trim().is_empty() {
            return ApiResponse::error(StatusCode::BAD_REQUEST, "wallet_address is required");
        }

        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };

        let db = client.database("alpenmesh");
        let wallets = db.collection::<Document>("wallet_connections");

        let network = body.network.unwrap_or_else(|| "solana-localnet".to_string());
        let up = wallets
            .update_one(
                doc! { "user_id": &id },
                doc! {
                    "$set": {
                        "wallet_address": body.wallet_address.trim(),
                        "network": network.clone(),
                        "connected_at": mongodb::bson::DateTime::now(),
                    },
                    "$setOnInsert": {
                        "user_id": &id,
                    }
                },
            )
            .upsert(true)
            .await;

        if up.is_err() {
            return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "failed to connect wallet");
        }

        ApiResponse::ok(serde_json::json!({
            "status": "connected",
            "user_id": &id,
            "wallet_address": body.wallet_address.trim(),
            "network": network,
        }))
    }

    #[get("/users/{id}")]
    async fn user_portfolio(
        &self,
        Data(state): Data<EconomyState>,
        Path(id): Path<String>,
    ) -> ApiResponse<UserPortfolioResponse> {
        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };

        let db = client.database("alpenmesh");
        let users = db.collection::<Document>("economy_users");
        let bindings = db.collection::<Document>("worker_bindings");
        let accounts = db.collection::<Document>("worker_accounts");
        let wallets = db.collection::<Document>("wallet_connections");

        let user_doc = match users.find_one(doc! { "user_id": &id }).await {
            Ok(Some(d)) => d,
            _ => return ApiResponse::error(StatusCode::NOT_FOUND, "user not found"),
        };

        let mut worker_cursor = match bindings.find(doc! { "user_id": &id }).await {
            Ok(c) => c,
            Err(_) => return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "query failed"),
        };

        let mut workers = Vec::new();
        while worker_cursor.advance().await.unwrap_or(false) {
            let Ok(worker_doc) = worker_cursor.deserialize_current() else {
                continue;
            };
            let worker_id = worker_doc.get_str("worker_id").unwrap_or_default().to_string();
            let label = worker_doc.get_str("label").unwrap_or("Worker").to_string();

            let acc = accounts
                .find_one(doc! { "worker_id": &worker_id })
                .await
                .ok()
                .flatten();

            let (payout_wallet, total_inf, total_reward, submitted, pending, updated_at) =
                if let Some(acc_doc) = acc {
                    (
                        acc_doc.get_str("payout_wallet").ok().map(|v| v.to_string()),
                        acc_doc.get_i64("total_inferences").unwrap_or(0).max(0) as u64,
                        acc_doc.get_f64("total_reward_alpen").unwrap_or(0.0),
                        acc_doc.get_f64("submitted_reward_alpen").unwrap_or(0.0),
                        acc_doc.get_f64("pending_reward_alpen").unwrap_or(0.0),
                        acc_doc
                            .get_datetime("updated_at")
                            .map(to_utc)
                            .unwrap_or_else(|_| Utc::now()),
                    )
                } else {
                    (None, 0, 0.0, 0.0, 0.0, Utc::now())
                };

            workers.push(WorkerPortfolioItem {
                worker_id,
                label,
                payout_wallet,
                total_inferences: total_inf,
                total_reward_alpen: total_reward,
                submitted_reward_alpen: submitted,
                pending_reward_alpen: pending,
                updated_at,
            });
        }

        let wallet = wallets
            .find_one(doc! { "user_id": &id })
            .await
            .ok()
            .flatten()
            .map(map_wallet_doc);

        ApiResponse::ok(UserPortfolioResponse {
            user_id: id,
            display_name: user_doc
                .get_str("display_name")
                .unwrap_or("Worker")
                .to_string(),
            email: user_doc.get_str("email").unwrap_or_default().to_string(),
            wallet,
            workers,
        })
    }

    #[get("/workers/{id}")]
    async fn worker_earnings(
        &self,
        Data(state): Data<EconomyState>,
        Path(id): Path<String>,
    ) -> ApiResponse<WorkerEarningsResponse> {
        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };
        let coll = client.database("alpenmesh").collection::<Document>("worker_accounts");

        let doc = match coll.find_one(doc! { "worker_id": &id }).await {
            Ok(Some(d)) => d,
            Ok(None) => return ApiResponse::error(StatusCode::NOT_FOUND, "worker not found"),
            Err(_) => return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "query failed"),
        };

        let updated_at = doc
            .get_datetime("updated_at")
            .map(to_utc)
            .unwrap_or_else(|_| Utc::now());

        ApiResponse::ok(WorkerEarningsResponse {
            worker_id: id,
            payout_wallet: doc.get_str("payout_wallet").ok().map(|s| s.to_string()),
            total_inferences: doc.get_i64("total_inferences").unwrap_or(0).max(0) as u64,
            total_reward_alpen: doc.get_f64("total_reward_alpen").unwrap_or(0.0),
            pending_reward_alpen: doc.get_f64("pending_reward_alpen").unwrap_or(0.0),
            submitted_reward_alpen: doc.get_f64("submitted_reward_alpen").unwrap_or(0.0),
            updated_at,
        })
    }

    #[get("/workers/{id}/proofs")]
    async fn worker_proofs(
        &self,
        Data(state): Data<EconomyState>,
        Path(id): Path<String>,
    ) -> ApiResponse<WorkerProofsResponse> {
        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };
        let coll = client.database("alpenmesh").collection::<Document>("proof_batches");

        let mut cursor = match coll
            .find(doc! { "worker_id": &id })
            .sort(doc! { "timestamp": -1 })
            .limit(100)
            .await
        {
            Ok(c) => c,
            Err(_) => return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "query failed"),
        };

        let mut proofs = Vec::new();
        while cursor.advance().await.unwrap_or(false) {
            if let Ok(doc) = cursor.deserialize_current() {
                proofs.push(map_proof_doc(&doc));
            }
        }

        ApiResponse::ok(WorkerProofsResponse {
            worker_id: id,
            proofs,
        })
    }

    #[post("/workers/{id}")]
    async fn bind_worker_wallet(
        &self,
        Data(state): Data<EconomyState>,
        Path(id): Path<String>,
        Json(body): Json<BindWalletRequest>,
    ) -> ApiResponse<serde_json::Value> {
        if body.wallet_address.trim().is_empty() {
            return ApiResponse::error(StatusCode::BAD_REQUEST, "wallet_address is required");
        }

        let client = match state.get_or_create_mongo_client().await {
            Ok(c) => c,
            Err(_) => {
                return ApiResponse::error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "failed to connect MongoDB",
                )
            }
        };
        let coll = client.database("alpenmesh").collection::<Document>("worker_accounts");

        let result = coll
            .update_one(
                doc! { "worker_id": &id },
                doc! {
                    "$set": {
                        "payout_wallet": body.wallet_address.clone(),
                        "updated_at": mongodb::bson::DateTime::now(),
                    },
                    "$setOnInsert": {
                        "worker_id": &id,
                        "total_inferences": 0_i64,
                        "total_reward_alpen": 0.0_f64,
                        "pending_reward_alpen": 0.0_f64,
                        "submitted_reward_alpen": 0.0_f64,
                    }
                },
            )
            .upsert(true)
            .await;

        if result.is_err() {
            return ApiResponse::error(StatusCode::INTERNAL_SERVER_ERROR, "update failed");
        }

        ApiResponse::ok(serde_json::json!({
            "worker_id": &id,
            "wallet_address": body.wallet_address,
            "status": "bound"
        }))
    }
}

fn map_wallet_doc(doc: Document) -> WalletConnection {
    WalletConnection {
        user_id: doc.get_str("user_id").unwrap_or_default().to_string(),
        wallet_address: doc
            .get_str("wallet_address")
            .unwrap_or_default()
            .to_string(),
        network: doc
            .get_str("network")
            .unwrap_or("solana-localnet")
            .to_string(),
        connected_at: doc
            .get_datetime("connected_at")
            .map(to_utc)
            .unwrap_or_else(|_| Utc::now()),
    }
}

fn hash_password(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let output = hasher.finalize();
    hex::encode(output)
}

fn map_proof_doc(doc: &Document) -> ProofBatchRecord {
    let timestamp = doc
        .get_datetime("timestamp")
        .map(to_utc)
        .unwrap_or_else(|_| Utc::now());
    let updated_at = doc
        .get_datetime("updated_at")
        .map(to_utc)
        .unwrap_or_else(|_| Utc::now());

    ProofBatchRecord {
        proof_id: doc.get_str("proof_id").unwrap_or_default().to_string(),
        worker_id: doc.get_str("worker_id").unwrap_or_default().to_string(),
        window_start_ms: doc.get_i64("window_start_ms").unwrap_or(0).max(0) as u64,
        window_end_ms: doc.get_i64("window_end_ms").unwrap_or(0).max(0) as u64,
        total_inferences: doc.get_i64("total_inferences").unwrap_or(0).max(0) as u64,
        reward_alpen: doc.get_f64("reward_alpen").unwrap_or(0.0),
        chain_status: doc.get_str("chain_status").unwrap_or("queued").to_string(),
        chain_signature: doc.get_str("chain_signature").ok().map(|s| s.to_string()),
        chain_error: doc.get_str("chain_error").ok().map(|s| s.to_string()),
        timestamp,
        updated_at,
    }
}

fn to_utc(dt: &mongodb::bson::DateTime) -> DateTime<Utc> {
    dt.to_system_time().into()
}
