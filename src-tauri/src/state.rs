use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::db::Db;
use crate::worker::recorder::RecorderWorker;
use crate::worker::Worker;

pub struct ChunkInfo {
    pub parent_job_id: String,
    pub offset: f64,
    pub chunk_index: u32,
}

pub struct AppState {
    pub db: Arc<Mutex<Db>>,
    pub worker: Worker,
    pub recorder: Option<RecorderWorker>,
    /// chunk_job_id ("job-uuid:chunk:N") → ChunkInfo (shared with recorder event handler)
    pub chunk_info: Arc<Mutex<HashMap<String, ChunkInfo>>>,
    /// job_id → sorted (chunk_index, file_path) list (shared with recorder event handler)
    pub recording_chunks: Arc<Mutex<HashMap<String, Vec<(u32, String)>>>>,
}
