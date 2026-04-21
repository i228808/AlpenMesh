use crate::state::EconomyState;
use oxide_framework_core::{ApiResponse, App, Config};
use serde::Serialize;
use tracing_subscriber::EnvFilter;

mod controllers;
mod state;

#[derive(Serialize)]
struct Message {
    text: String,
}

async fn index(Config(cfg): Config) -> ApiResponse<Message> {
    ApiResponse::ok(Message {
        text: format!("Welcome to {}!", cfg.app_name),
    })
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let state = EconomyState::new();

    App::new()
        .config("app.yaml")
        .state(state)
        .get("/", index)
        .controller::<controllers::EconomyController>()
        .run();
}
