use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio_util::sync::CancellationToken;

use crate::db::DbPool;
use crate::worker::recorder::RecorderWorker;
use crate::worker::Worker;

pub struct AppState {
    pub db: DbPool,
    pub worker: Worker,
    pub recorder: Option<RecorderWorker>,
    /// job_id → sorted (chunk_index, file_path) list — used for ffmpeg concat fallback
    pub recording_chunks: Arc<Mutex<HashMap<String, Vec<(u32, String)>>>>,
    /// job_id → cancellation token for active AI streaming (summary / chat)
    pub ai_cancels: Arc<Mutex<HashMap<String, CancellationToken>>>,
}
