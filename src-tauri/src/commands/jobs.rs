use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;
use uuid::Uuid;

use crate::db::queries::{self, Job};
use crate::error::AppError;
use crate::state::AppState;
use crate::worker::protocol::IncomingMessage;

#[tauri::command]
pub fn init_worker(state: State<AppState>, whisper_model: String) -> Result<(), AppError> {
    state.worker.send(&IncomingMessage::Init { whisper_model })?;
    Ok(())
}

#[tauri::command]
pub fn create_job(
    state: State<AppState>,
    project_id: String,
    file_path: String,
    whisper_model: String,
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let job = Job {
        id: id.clone(),
        project_id,
        file_path: file_path.clone(),
        status: "pending".into(),
        whisper_model: whisper_model.clone(),
        created_at,
        recording_window: None,
    };

    {
        let db = state.db.lock().unwrap();
        queries::insert_job(&db.conn, &job)?;
    }

    state.worker.send(&IncomingMessage::TranscribeFile {
        id: id.clone(),
        file: file_path,
        mode: "offline".into(),
    })?;

    Ok(id)
}

#[tauri::command]
pub fn cancel_job(state: State<AppState>, id: String) -> Result<(), AppError> {
    state.worker.send(&IncomingMessage::Cancel { id })?;
    Ok(())
}

#[tauri::command]
pub fn delete_job(state: State<AppState>, id: String) -> Result<(), AppError> {
    let db = state.db.lock().unwrap();
    Ok(queries::delete_job(&db.conn, &id)?)
}

#[tauri::command]
pub fn list_jobs_by_project(state: State<AppState>, project_id: String) -> Result<Vec<Job>, AppError> {
    let db = state.db.lock().unwrap();
    Ok(queries::list_jobs_by_project(&db.conn, &project_id)?)
}

#[tauri::command]
pub fn get_job(state: State<AppState>, id: String) -> Result<Job, AppError> {
    let db = state.db.lock().unwrap();
    queries::get_job(&db.conn, &id)?.ok_or(AppError::NotFound)
}
