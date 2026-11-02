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
        let conn = state.db.get()?;
        queries::insert_job(&conn, &job)?;
    }

    state.worker.send(&IncomingMessage::TranscribeFile {
        id: id.clone(),
        file: file_path,
        mode: "offline".into(),
        language: "th".into(),
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
    let file_path = {
        let conn = state.db.get()?;
        let job = queries::get_job(&conn, &id)?;
        let path = job.map(|j| j.file_path).unwrap_or_default();
        queries::delete_job(&conn, &id)?;
        path
    };
    cleanup_recording_dir(&file_path);
    Ok(())
}

/// Delete the job's tmp recording directory if it lives under the mtt temp folder.
pub fn cleanup_recording_dir(file_path: &str) {
    if file_path.is_empty() { return; }
    let path = std::path::Path::new(file_path);
    // Only delete dirs we own: …/T/mtt/<uuid>/…
    let in_mtt_tmp = path.components().any(|c| c.as_os_str() == "mtt");
    if !in_mtt_tmp { return; }
    if let Some(dir) = path.parent() {
        if dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(dir) {
                eprintln!("[cleanup] failed to remove {}: {e}", dir.display());
            } else {
                eprintln!("[cleanup] removed {}", dir.display());
            }
        }
    }
}

#[tauri::command]
pub fn list_jobs_by_project(state: State<AppState>, project_id: String) -> Result<Vec<Job>, AppError> {
    let conn = state.db.get()?;
    Ok(queries::list_jobs_by_project(&conn, &project_id)?)
}

#[tauri::command]
pub fn get_job(state: State<AppState>, id: String) -> Result<Job, AppError> {
    let conn = state.db.get()?;
    queries::get_job(&conn, &id)?.ok_or(AppError::NotFound)
}
