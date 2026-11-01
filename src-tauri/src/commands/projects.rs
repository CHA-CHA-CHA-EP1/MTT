use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;
use uuid::Uuid;

use crate::db::queries::{self, Project};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn create_project(state: State<AppState>, name: String) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let project = Project { id: id.clone(), name, created_at };
    let db = state.db.lock().unwrap();
    queries::insert_project(&db.conn, &project)?;
    Ok(id)
}

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> Result<Vec<Project>, AppError> {
    let db = state.db.lock().unwrap();
    Ok(queries::list_projects(&db.conn)?)
}

#[tauri::command]
pub fn get_project(state: State<AppState>, id: String) -> Result<Project, AppError> {
    let db = state.db.lock().unwrap();
    queries::get_project(&db.conn, &id)?.ok_or(AppError::NotFound)
}

#[tauri::command]
pub fn rename_project(state: State<AppState>, id: String, name: String) -> Result<(), AppError> {
    let db = state.db.lock().unwrap();
    Ok(queries::rename_project(&db.conn, &id, &name)?)
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, id: String) -> Result<(), AppError> {
    let db = state.db.lock().unwrap();
    Ok(queries::delete_project(&db.conn, &id)?)
}
