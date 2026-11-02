use tauri::State;

use crate::db::queries::{self, Segment};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn get_segments(state: State<AppState>, job_id: String) -> Result<Vec<Segment>, AppError> {
    let conn = state.db.get()?;
    Ok(queries::get_segments(&conn, &job_id)?)
}

#[tauri::command]
pub fn get_segments_since(state: State<AppState>, job_id: String, min_idx: i64) -> Result<Vec<Segment>, AppError> {
    let conn = state.db.get()?;
    Ok(queries::get_segments_since(&conn, &job_id, min_idx)?)
}

#[tauri::command]
pub fn search_segments(state: State<AppState>, query: String) -> Result<Vec<Segment>, AppError> {
    let conn = state.db.get()?;
    Ok(queries::search_segments(&conn, &query)?)
}

#[tauri::command]
pub fn search_segments_in_job(state: State<AppState>, job_id: String, query: String) -> Result<Vec<Segment>, AppError> {
    let conn = state.db.get()?;
    Ok(queries::search_segments_in_job(&conn, &job_id, &query)?)
}

#[tauri::command]
pub fn update_segment(state: State<AppState>, segment_id: i64, text: Option<String>) -> Result<(), AppError> {
    let conn = state.db.get()?;
    Ok(queries::set_segment_text(&conn, segment_id, text)?)
}
