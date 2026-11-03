use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;
use uuid::Uuid;

use crate::db::queries::{self, Space};
use crate::error::AppError;
use crate::state::AppState;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

#[tauri::command]
pub fn create_space(state: State<AppState>, name: String) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    let space = Space { id: id.clone(), name, created_at: now() };
    let conn = state.db.get()?;
    queries::insert_space(&conn, &space)?;
    Ok(id)
}

#[tauri::command]
pub fn list_spaces(state: State<AppState>) -> Result<Vec<Space>, AppError> {
    let conn = state.db.get()?;
    Ok(queries::list_spaces(&conn)?)
}

#[tauri::command]
pub fn get_space(state: State<AppState>, id: String) -> Result<Space, AppError> {
    let conn = state.db.get()?;
    queries::get_space(&conn, &id)?.ok_or(AppError::NotFound)
}

#[tauri::command]
pub fn rename_space(state: State<AppState>, id: String, name: String) -> Result<(), AppError> {
    let conn = state.db.get()?;
    Ok(queries::rename_space(&conn, &id, &name)?)
}

#[tauri::command]
pub fn delete_space(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state.db.get()?;
    Ok(queries::delete_space(&conn, &id)?)
}
