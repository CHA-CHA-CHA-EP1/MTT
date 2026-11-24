use tauri::State;

use crate::db::queries;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn get_job_notes(state: State<AppState>, id: String) -> Result<Option<String>, AppError> {
    let conn = state.db.get()?;
    Ok(queries::get_job_notes(&conn, &id)?)
}

#[tauri::command]
pub fn save_job_notes(state: State<AppState>, id: String, notes: String) -> Result<(), AppError> {
    let conn = state.db.get()?;
    Ok(queries::save_job_notes(&conn, &id, &notes)?)
}
