use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::db::Db;
use crate::worker::recorder::RecorderWorker;
use crate::worker::Worker;

pub struct AppState {
    pub db: Arc<Mutex<Db>>,
    pub worker: Worker,
    pub recorder: Option<RecorderWorker>,
    /// job_id → sorted (chunk_index, file_path) list — used for ffmpeg concat fallback
    pub recording_chunks: Arc<Mutex<HashMap<String, Vec<(u32, String)>>>>,
}
