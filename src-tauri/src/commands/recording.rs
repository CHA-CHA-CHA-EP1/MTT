use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, State};
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
    app: AppHandle,
    state: State<AppState>,
    space_id: String,
    window_id: u32,
    window_title: String,
    whisper_model: String,
    include_mic: bool,
    mic_device_label: String,
) -> Result<String, AppError> {
    let recorder = state.recorder.as_ref().ok_or_else(|| AppError::Other("screen recorder not available".into()))?;

    let id = Uuid::new_v4().to_string();
    let created_at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let recordings_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?
        .join("recordings");
    let output_dir = recordings_dir.join(&id);

    let job = Job {
        id: id.clone(),
        project_id: space_id.clone(),
        file_path: String::new(),
        status: "recording".into(),
        whisper_model,
        created_at,
        recording_window: Some(window_title),
        error_message: None,
        title: None,
        folder_id: None,
        notes: None,
        duration_secs: None,
    };

    {
        let conn = state.db.get()?;
        queries::insert_job(&conn, &job)?;
    }

    recorder.send(&RecorderCommand::Start {
        id: id.clone(),
        window_id,
        chunk_duration: 30,
        output_dir: output_dir.to_string_lossy().into_owned(),
        include_mic,
        mic_device_label,
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

#[tauri::command]
pub fn toggle_mic(state: State<AppState>, id: String, enabled: bool) -> Result<(), AppError> {
    let recorder = state.recorder.as_ref().ok_or_else(|| AppError::Other("screen recorder not available".into()))?;
    let _ = id; // reserved for future per-job targeting
    recorder.send(&RecorderCommand::ToggleMic { enabled })?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct StorageInfo {
    pub path: String,
    pub size_bytes: u64,
}

fn dir_size(path: &PathBuf) -> u64 {
    if !path.exists() { return 0; }
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, AppError> {
    let recordings_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?
        .join("recordings");
    let size_bytes = dir_size(&recordings_dir);
    Ok(StorageInfo {
        path: recordings_dir.to_string_lossy().into_owned(),
        size_bytes,
    })
}
