use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;
use uuid::Uuid;

use crate::db::queries::{self, Job};
use crate::error::AppError;
use crate::state::AppState;
use crate::worker::recorder::RecorderCommand;

#[tauri::command]
pub fn list_windows(state: State<AppState>) -> Result<(), AppError> {
    let recorder = state.recorder.as_ref().ok_or_else(|| AppError::Other("screen recorder not available".into()))?;
    recorder.send(&RecorderCommand::ListWindows)?;
    Ok(())
}

#[tauri::command]
pub fn start_recording(
    state: State<AppState>,
    project_id: String,
    window_id: u32,
    window_title: String,
    whisper_model: String,
) -> Result<String, AppError> {
    let recorder = state.recorder.as_ref().ok_or_else(|| AppError::Other("screen recorder not available".into()))?;

    let id = Uuid::new_v4().to_string();
    let created_at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let output_dir = std::env::temp_dir().join("mtt").join(&id);

    let job = Job {
        id: id.clone(),
        project_id,
        file_path: String::new(),
        status: "recording".into(),
        whisper_model,
        created_at,
        recording_window: Some(window_title),
    };

    {
        let db = state.db.lock().unwrap();
        queries::insert_job(&db.conn, &job)?;
    }

    recorder.send(&RecorderCommand::Start {
        id: id.clone(),
        window_id,
        chunk_duration: 30,
        output_dir: output_dir.to_string_lossy().into_owned(),
    })?;

    Ok(id)
}

#[tauri::command]
pub fn stop_recording(state: State<AppState>, id: String) -> Result<(), AppError> {
    let recorder = state.recorder.as_ref().ok_or_else(|| AppError::Other("screen recorder not available".into()))?;
    recorder.send(&RecorderCommand::Stop { id })?;
    Ok(())
}

#[tauri::command]
pub fn capture_window_screenshot(state: State<AppState>, window_id: u32) -> Result<(), AppError> {
    let recorder = state.recorder.as_ref().ok_or_else(|| AppError::Other("screen recorder not available".into()))?;
    recorder.send(&RecorderCommand::Screenshot { window_id })?;
    Ok(())
}
