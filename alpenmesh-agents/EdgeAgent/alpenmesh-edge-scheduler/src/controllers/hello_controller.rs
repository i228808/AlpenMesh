//! Example `#[controller]` — add routes with `oxide generate route`.

use oxide_framework_core::{controller, ApiResponse};
use serde::Serialize;

#[derive(Default)]
pub struct HelloController;

#[derive(Serialize)]
struct Msg {
    text: String,
}

#[controller("/api/hello")]
impl HelloController {
    #[get("/")]
    async fn index(&self) -> ApiResponse<Msg> {
        ApiResponse::ok(Msg {
            text: "Hello from HelloController".into(),
        })
    }

    // oxide-framework-cli:routes
}
