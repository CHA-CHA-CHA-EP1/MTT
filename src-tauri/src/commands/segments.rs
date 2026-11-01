use tauri::State;

use crate::db::queries::{self, Segment};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn get_segments(state: State<AppState>, job_id: String) -> Result<Vec<Segment>, AppError> {
    let db = state.db.lock().unwrap();
    Ok(queries::get_segments(&db.conn, &job_id)?)
}

#[tauri::command]
pub fn search_segments(state: State<AppState>, query: String) -> Result<Vec<Segment>, AppError> {
    let db = state.db.lock().unwrap();
    Ok(queries::search_segments(&db.conn, &query)?)
}

#[tauri::command]
pub fn update_segment(state: State<AppState>, segment_id: i64, text: Option<String>) -> Result<(), AppError> {
    let db = state.db.lock().unwrap();
    Ok(queries::set_segment_text(&db.conn, segment_id, text)?)
}
