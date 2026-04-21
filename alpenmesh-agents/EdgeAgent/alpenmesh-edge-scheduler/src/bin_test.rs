use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] 
pub struct CameraStream {
    #[serde(rename = "cameraName")]
    pub id: String,
    
    pub stream_url: String,

    #[serde(default)]
    pub assigned_to: Option<String>,
}

fn main() {
    let content = std::fs::read_to_string("cameras.json").unwrap();
    match serde_json::from_str::<Vec<CameraStream>>(&content) {
        Ok(list) => println!("Loaded {} cameras", list.len()),
        Err(e) => println!("Error: {}", e),
    }
}
