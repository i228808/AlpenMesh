//! AlpenMesh scheduler entry point.

use oxide_framework_core::App;
use crate::state::SchedulerState;
use tracing_subscriber::EnvFilter;

mod controllers;
mod chain_submitter;
mod liveness;
mod state;

fn main() {
    // 0. Load .env BEFORE logging so RUST_LOG / MONGODB_URI / etc. take effect.
    let _ = dotenvy::dotenv();

    // 1. Initialize logging EARLY to see startup logs from SchedulerState::new()
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    // 2. Initialize State (and load cameras.json)
    let state = SchedulerState::new();
    chain_submitter::start_chain_submitter_task(state.clone());
    liveness::start_liveness_task(state.clone());

    // 3. Start Oxide Server
    App::new()
        .config("app.yaml")
        .state(state)
        .rate_limit(1000, 1) // Allow high-rate internal worker metrics ingestion
        .controller::<controllers::HeartbeatController>()
        .controller::<controllers::InferenceController>()
        .controller::<controllers::MetricsController>()
        .controller::<controllers::ProofsController>()
        .run();
}
