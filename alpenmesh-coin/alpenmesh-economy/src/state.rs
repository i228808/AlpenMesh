use chrono::{DateTime, Utc};
use mongodb::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletConnection {
    pub user_id: String,
    pub wallet_address: String,
    pub network: String,
    pub connected_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProofBatchRecord {
    pub proof_id: String,
    pub worker_id: String,
    pub window_start_ms: u64,
    pub window_end_ms: u64,
    pub total_inferences: u64,
    pub reward_alpen: f64,
    pub chain_status: String,
    pub chain_signature: Option<String>,
    pub chain_error: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct EconomyState {
    pub mongo_uri: Arc<String>,
    pub mongo_client: Arc<RwLock<Option<Client>>>,
    pub session_cache: Arc<RwLock<HashMap<String, String>>>,
}

impl EconomyState {
    pub fn new() -> Self {
        let base_uri =
            std::env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://127.0.0.1:27017".to_string());
        let mongo_uri = normalize_mongo_uri(&base_uri);
        info!(mongo_uri = %mongo_uri, "Economy service prepared MongoDB URI");

        Self {
            mongo_uri: Arc::new(mongo_uri),
            mongo_client: Arc::new(RwLock::new(None)),
            session_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_or_create_mongo_client(&self) -> Result<Client, mongodb::error::Error> {
        {
            let guard = self.mongo_client.read().await;
            if let Some(client) = guard.as_ref() {
                return Ok(client.clone());
            }
        }

        let mut guard = self.mongo_client.write().await;
        if let Some(client) = guard.as_ref() {
            return Ok(client.clone());
        }

        let client = Client::with_uri_str(self.mongo_uri.as_str()).await?;
        let db = client.database("alpenmesh");
        db.run_command(mongodb::bson::doc! { "ping": 1 }).await?;
        *guard = Some(client.clone());
        Ok(client)
    }
}

fn normalize_mongo_uri(base_uri: &str) -> String {
    let mut uri = base_uri.trim().to_string();
    if let Some((left, right)) = uri.split_once('?') {
        uri = format!("{}/?{}", left.trim_end_matches('/'), right);
    } else {
        uri = format!("{}/", uri.trim_end_matches('/'));
    }

    if !uri.contains("directConnection=") {
        uri = if uri.contains('?') {
            format!("{}&directConnection=true", uri)
        } else {
            format!("{}?directConnection=true", uri)
        };
    }
    if !uri.contains("serverSelectionTimeoutMS=") {
        uri = if uri.contains('?') {
            format!("{}&serverSelectionTimeoutMS=3000", uri)
        } else {
            format!("{}?serverSelectionTimeoutMS=3000", uri)
        };
    }
    uri
}
