use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;
use uuid::Uuid;

use crate::db::queries::{self, Folder};
use crate::error::AppError;
use crate::state::AppState;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, space_id: String, name: String) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    let folder = Folder { id: id.clone(), space_id, name, created_at: now() };
    let conn = state.db.get()?;
    queries::insert_folder(&conn, &folder)?;
    Ok(id)
}

#[tauri::command]
pub fn list_folders(state: State<AppState>, space_id: String) -> Result<Vec<Folder>, AppError> {
    let conn = state.db.get()?;
    Ok(queries::list_folders(&conn, &space_id)?)
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: String, name: String) -> Result<(), AppError> {
    let conn = state.db.get()?;
    Ok(queries::rename_folder(&conn, &id, &name)?)
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state.db.get()?;
    Ok(queries::delete_folder(&conn, &id)?)
}
