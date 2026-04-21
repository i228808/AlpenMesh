use crate::state::{ChainSubmissionTask, SchedulerState};
use mongodb::bson::{doc, DateTime as BsonDateTime};
use mongodb::options::FindOptions;
use solana_rpc_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_instruction::Instruction;
use solana_keypair::{read_keypair_file, Keypair};
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signature::Signature;
use solana_signer::Signer;
use solana_system_interface::instruction as system_instruction;
use solana_transaction::Transaction;
use std::str::FromStr;
use std::thread;
use std::time::Duration;
use tracing::{error, info, warn};

const MAX_RETRIES: u32 = 5;
const LOOP_SLEEP_IDLE_MS: u64 = 500;
const LOOP_SLEEP_ERROR_MS: u64 = 1000;
const SOLANA_RPC_URL: &str = "http://127.0.0.1:8899";
const SOLANA_KEYPAIR_PATH: &str = "C:\\solana\\id.json";
const MEMO_PROGRAM_ID: &str = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const MIN_TRANSFER_LAMPORTS: u64 = 1_000;

pub fn start_chain_submitter_task(state: SchedulerState) {
    thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for chain submitter");

        rt.block_on(async move {
            match bootstrap_pending_proofs(&state).await {
                Ok(count) => info!(count, "Bootstrapped pending proof batches into chain queue"),
                Err(e) => error!(error = %e, "Failed bootstrapping pending proof batches"),
            }

            let rpc = RpcClient::new_with_commitment(
                SOLANA_RPC_URL.to_string(),
                CommitmentConfig::confirmed(),
            );
            let signer = match read_keypair_file(SOLANA_KEYPAIR_PATH) {
                Ok(kp) => kp,
                Err(e) => {
                    error!(error = %e, path = %SOLANA_KEYPAIR_PATH, "Failed to load scheduler signer keypair");
                    return;
                }
            };

            info!("Chain submitter loop started (native Solana RPC)");
            loop {
                let Some(task) = state.dequeue_chain_submission() else {
                    tokio::time::sleep(Duration::from_millis(LOOP_SLEEP_IDLE_MS)).await;
                    continue;
                };

                if let Err(e) = mark_chain_processing(&state, &task.proof_id).await {
                    warn!(proof_id = %task.proof_id, error = %e, "Failed to mark proof as processing");
                }

                if let Ok(true) = already_submitted(&state, &task.proof_id).await {
                    info!(proof_id = %task.proof_id, "Skipping already-submitted proof");
                    continue;
                }

                let submit_result = submit_to_chain(&rpc, &signer, &task);

                match submit_result {
                    Ok(signature) => {
                        if let Err(e) = mark_chain_success(&state, &task.proof_id, &signature.to_string()).await {
                            error!(proof_id = %task.proof_id, error = %e, "Failed to mark chain success in Mongo");
                        }
                        info!(proof_id = %task.proof_id, signature = %signature, "On-chain proof submission succeeded");
                    }
                    Err(err_msg) => {
                        warn!(proof_id = %task.proof_id, error = %err_msg, retries = task.retries, "On-chain proof submission failed");
                        if let Err(e) = mark_chain_error(&state, &task.proof_id, &err_msg, task.retries).await {
                            error!(proof_id = %task.proof_id, error = %e, "Failed to persist chain submission error");
                        }

                        if task.retries < MAX_RETRIES {
                            let mut retry_task = task.clone();
                            retry_task.retries += 1;
                            state.requeue_chain_submission(retry_task);
                            let q_len = state.chain_submission_queue_len();
                            info!(proof_id = %task.proof_id, queue_len = q_len, "Requeued proof for retry");
                        }

                        tokio::time::sleep(Duration::from_millis(LOOP_SLEEP_ERROR_MS)).await;
                    }
                }
            }
        });
    });
}

fn submit_to_chain(
    rpc: &RpcClient,
    signer: &Keypair,
    task: &ChainSubmissionTask,
) -> Result<Signature, String> {
    let memo_text = format!(
        "proof_id={}|worker_id={}|inferences={}|reward_alpen={:.6}|window_start_ms={}|window_end_ms={}",
        task.proof_id,
        task.worker_id,
        task.total_inferences,
        task.reward_alpen,
        task.window_start_ms,
        task.window_end_ms
    );

    let memo_program = Pubkey::from_str(MEMO_PROGRAM_ID).map_err(|e| e.to_string())?;
    let memo_ix = Instruction {
        program_id: memo_program,
        accounts: vec![],
        data: memo_text.as_bytes().to_vec(),
    };

    let transfer_ix = system_instruction::transfer(
        &signer.pubkey(),
        &signer.pubkey(),
        MIN_TRANSFER_LAMPORTS,
    );

    let recent_blockhash = rpc
        .get_latest_blockhash()
        .map_err(|e| format!("get_latest_blockhash failed: {}", e))?;

    let message = Message::new(&[memo_ix, transfer_ix], Some(&signer.pubkey()));
    let mut tx = Transaction::new_unsigned(message);
    tx.sign(&[signer], recent_blockhash);

    rpc.send_and_confirm_transaction_with_spinner(&tx)
        .map_err(|e| format!("send_and_confirm_transaction failed: {}", e))
}

async fn bootstrap_pending_proofs(state: &SchedulerState) -> Result<u64, mongodb::error::Error> {
    let mongo = get_or_create_mongo_client(state).await?;
    let db = mongo.database("alpenmesh");
    let proofs = db.collection::<mongodb::bson::Document>("proof_batches");

    let filter = doc! { "chain_status": { "$in": ["queued", "retrying", "processing"] } };
    let opts = FindOptions::builder().sort(doc! { "timestamp": 1 }).build();
    let mut cursor = proofs.find(filter).with_options(opts).await?;

    let mut count = 0u64;
    while cursor.advance().await? {
        let doc = cursor.deserialize_current()?;
        let proof_id = doc.get_str("proof_id").unwrap_or_default().to_string();
        let worker_id = doc
            .get_str("worker_id")
            .unwrap_or("gpu-worker-1")
            .to_string();
        if proof_id.is_empty() {
            continue;
        }

        let total_inferences = doc.get_i64("total_inferences").unwrap_or(0).max(0) as u64;
        let reward_alpen = doc.get_f64("reward_alpen").unwrap_or(0.0);
        let window_start_ms = doc.get_i64("window_start_ms").unwrap_or(0).max(0) as u64;
        let window_end_ms = doc.get_i64("window_end_ms").unwrap_or(0).max(0) as u64;
        let retries = doc.get_i32("chain_attempts").unwrap_or(0).max(0) as u32;

        state.enqueue_chain_submission(ChainSubmissionTask {
            proof_id,
            worker_id,
            total_inferences,
            reward_alpen,
            window_start_ms,
            window_end_ms,
            retries,
        });
        count = count.saturating_add(1);
    }

    Ok(count)
}

async fn mark_chain_success(
    state: &SchedulerState,
    proof_id: &str,
    signature: &str,
) -> Result<(), mongodb::error::Error> {
    let mongo = get_or_create_mongo_client(state).await?;
    let db = mongo.database("alpenmesh");
    let proofs = db.collection::<mongodb::bson::Document>("proof_batches");

    proofs
        .update_one(
            doc! { "proof_id": proof_id },
            doc! {
                "$set": {
                    "chain_status": "submitted",
                    "chain_signature": signature,
                    "chain_submitted_at": BsonDateTime::now(),
                    "updated_at": BsonDateTime::now(),
                }
            },
        )
        .await?;

    Ok(())
}

async fn mark_chain_processing(
    state: &SchedulerState,
    proof_id: &str,
) -> Result<(), mongodb::error::Error> {
    let mongo = get_or_create_mongo_client(state).await?;
    let db = mongo.database("alpenmesh");
    let proofs = db.collection::<mongodb::bson::Document>("proof_batches");

    proofs
        .update_one(
            doc! { "proof_id": proof_id },
            doc! {
                "$set": {
                    "chain_status": "processing",
                    "updated_at": BsonDateTime::now(),
                }
            },
        )
        .await?;

    Ok(())
}

async fn mark_chain_error(
    state: &SchedulerState,
    proof_id: &str,
    error_msg: &str,
    retries: u32,
) -> Result<(), mongodb::error::Error> {
    let mongo = get_or_create_mongo_client(state).await?;
    let db = mongo.database("alpenmesh");
    let proofs = db.collection::<mongodb::bson::Document>("proof_batches");

    proofs
        .update_one(
            doc! { "proof_id": proof_id },
            doc! {
                "$set": {
                    "chain_status": "retrying",
                    "chain_error": error_msg,
                    "updated_at": BsonDateTime::now(),
                },
                "$inc": {
                    "chain_attempts": 1,
                },
                "$max": {
                    "last_retry_number": retries as i32,
                }
            },
        )
        .await?;

    Ok(())
}

async fn already_submitted(
    state: &SchedulerState,
    proof_id: &str,
) -> Result<bool, mongodb::error::Error> {
    let mongo = get_or_create_mongo_client(state).await?;
    let db = mongo.database("alpenmesh");
    let proofs = db.collection::<mongodb::bson::Document>("proof_batches");

    let doc = proofs
        .find_one(doc! {
            "proof_id": proof_id,
            "chain_status": "submitted",
        })
        .await?;
    Ok(doc.is_some())
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
