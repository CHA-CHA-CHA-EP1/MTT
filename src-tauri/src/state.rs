use std::sync::{Arc, Mutex};

use crate::db::Db;
use crate::worker::Worker;

pub struct AppState {
    pub db: Arc<Mutex<Db>>,
    pub worker: Worker,
}
