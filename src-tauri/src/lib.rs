pub mod commands;
pub mod db;
pub mod error;
pub mod state;
pub mod worker;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::db::{queries, DbPool, new_pool};
use crate::state::AppState;
use crate::worker::recorder::{RecorderEvent, RecorderWorker};
use crate::worker::{protocol::OutgoingMessage, Worker};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let db_path = app
                .path()
                .app_data_dir()
                .expect("no app data dir")
                .join("mtt.db");
            std::fs::create_dir_all(db_path.parent().unwrap())?;

            let db = new_pool(db_path.to_str().unwrap())?;

            // Clean up orphaned tmp recording dirs on startup.
            cleanup_orphaned_tmp(&db);

            let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("repo root");

            // In a bundled .app, sidecars live next to the main executable.
            // In dev, fall back to repo paths.
            let exe_dir = std::env::current_exe().ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()));

            let (worker_bin, worker_args): (std::path::PathBuf, Vec<String>) = {
                let prod = exe_dir.as_ref().map(|d| d.join("mtt-worker"));
                if prod.as_ref().map(|p| p.exists()).unwrap_or(false) {
                    (prod.unwrap(), vec![])
                } else {
                    let python = repo_root.join("transcription-worker/.venv/bin/python");
                    let script = repo_root.join("transcription-worker/main.py");
                    (python, vec![script.to_string_lossy().into_owned()])
                }
            };

            let recording_chunks: Arc<Mutex<HashMap<String, Vec<(u32, String)>>>> =
                Arc::new(Mutex::new(HashMap::new()));

            let db_for_worker = db.clone();
            let app_handle_w = app_handle.clone();

            let worker_args_ref: Vec<&str> = worker_args.iter().map(|s| s.as_str()).collect();
            let worker = Worker::spawn(
                worker_bin.to_str().unwrap(),
                &worker_args_ref,
                Arc::new(move |msg| {
                    handle_worker_message(&app_handle_w, &db_for_worker, msg);
                }),
            )?;

            let recorder_bin = exe_dir.as_ref()
                .map(|d| d.join("screen-recorder"))
                .filter(|p| p.exists())
                .unwrap_or_else(|| repo_root.join("screen-recorder/.build/release/screen-recorder"));

            let recorder: Option<RecorderWorker> = if recorder_bin.exists() {
                let db_for_rec = db.clone();
                let recording_chunks_for_rec = Arc::clone(&recording_chunks);
                let app_handle_rec = app_handle.clone();

                match RecorderWorker::spawn(
                    recorder_bin.to_str().unwrap(),
                    Arc::new(move |ev| {
                        handle_recorder_event(
                            &app_handle_rec,
                            &db_for_rec,
                            &recording_chunks_for_rec,
                            ev,
                        );
                    }),
                ) {
                    Ok(rw) => Some(rw),
                    Err(e) => {
                        eprintln!("[setup] screen recorder spawn failed: {e}");
                        None
                    }
                }
            } else {
                eprintln!("[setup] screen-recorder binary not found, recording disabled");
                None
            };

            app.manage(AppState {
                db,
                worker,
                recorder,
                recording_chunks,
                ai_cancels: Arc::new(Mutex::new(HashMap::new())),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::rename_project,
            commands::projects::delete_project,
            commands::jobs::init_worker,
            commands::jobs::create_job,
            commands::jobs::cancel_job,
            commands::jobs::delete_job,
            commands::jobs::list_jobs_by_project,
            commands::jobs::get_job,
            commands::segments::get_segments,
            commands::segments::get_segments_since,
            commands::segments::search_segments,
            commands::segments::search_segments_in_job,
            commands::segments::update_segment,
            commands::settings::get_ai_config,
            commands::settings::save_ai_config,
            commands::settings::get_summary_config,
            commands::settings::save_summary_config,
            commands::settings::list_ai_models,
            commands::settings::test_ai_connection,
            commands::settings::get_whisper_model,
            commands::settings::save_whisper_model,
            commands::chat::chat_with_transcript,
            commands::summary::get_job_summary,
            commands::summary::generate_summary,
            commands::summary::cancel_ai_stream,
            commands::correction::correct_transcript,
            commands::recording::list_windows,
            commands::recording::start_recording,
            commands::recording::stop_recording,
            commands::recording::capture_window_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// On startup, delete any dirs in the mtt tmp folder not referenced by a job in DB.
fn cleanup_orphaned_tmp(db: &DbPool) {
    let tmp_dir = std::env::temp_dir().join("mtt");
    if !tmp_dir.exists() { return; }

    let known_paths: std::collections::HashSet<String> = {
        let conn = match db.get() {
            Ok(c) => c,
            Err(_) => return,
        };
        match queries::list_all_job_file_paths(&conn) {
            Ok(paths) => paths.into_iter().collect(),
            Err(_) => return,
        }
    };

    let entries = match std::fs::read_dir(&tmp_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        let dir_str = dir.to_string_lossy();
        // Keep if any known job file_path is inside this dir
        let in_use = known_paths.iter().any(|p| p.starts_with(dir_str.as_ref()));
        if !in_use {
            if let Err(e) = std::fs::remove_dir_all(&dir) {
                eprintln!("[cleanup] startup: failed to remove {}: {e}", dir.display());
            } else {
                eprintln!("[cleanup] startup: removed {}", dir.display());
            }
        }
    }
}

/// Start Pass 2: re-transcribe the full recording with Whisper offline pipeline.
/// Emits `recorder:refining`, clears live segments, then queues TranscribeFile.
fn start_pass2(app: &tauri::AppHandle, db: &DbPool, job_id: &str, file_path: &str) {
    if file_path.is_empty() {
        if let Ok(conn) = db.get() {
            queries::update_job_status(&conn, job_id, "done").ok();
        }
        app.emit("worker:done", serde_json::json!({ "id": job_id })).ok();
        eprintln!("[pass2] no file for job={job_id}, marking done");
        return;
    }

    app.emit("recorder:refining", serde_json::json!({ "id": job_id })).ok();

    if let Ok(conn) = db.get() {
        queries::delete_segments_for_job(&conn, job_id).ok();
    }

    let state: tauri::State<AppState> = app.state();
    state.worker.send(&crate::worker::protocol::IncomingMessage::TranscribeFile {
        id: job_id.to_owned(),
        file: file_path.to_owned(),
        mode: "offline".into(),
        language: "th".into(),
    }).ok();

    eprintln!("[pass2] started for job={job_id} file={file_path}");
}

fn handle_worker_message(
    app: &tauri::AppHandle,
    db: &DbPool,
    msg: OutgoingMessage,
) {
    match &msg {
        OutgoingMessage::Ready => {
            app.emit("worker:ready", ()).ok();
        }
        OutgoingMessage::Total { id, count } => {
            app.emit("worker:total", serde_json::json!({ "id": id, "count": count })).ok();
        }
        OutgoingMessage::Chunk { id, base_idx, index, segments } => {
            eprintln!("[worker] Chunk id={id} index={index} segs={}", segments.len());
            if let Ok(conn) = db.get() {
                for (i, seg) in segments.iter().enumerate() {
                    let db_seg = queries::Segment {
                        id: 0,
                        job_id: id.clone(),
                        idx: (*base_idx as i64) + i as i64,
                        start: seg.start,
                        end: seg.end,
                        text: seg.text.clone(),
                        corrected_text: None,
                        suspect: seg.suspect,
                    };
                    queries::insert_segment(&conn, &db_seg).ok();
                }
            }
            app.emit("worker:chunk", serde_json::json!({ "id": id, "index": index })).ok();
        }
        OutgoingMessage::Correction { id, start_idx, texts } => {
            if let Ok(conn) = db.get() {
                queries::update_segment_correction(&conn, id, *start_idx as i64, texts).ok();
            }
            app.emit("worker:correction", serde_json::json!({ "id": id, "start_idx": start_idx })).ok();
        }
        OutgoingMessage::Done { id } => {
            eprintln!("[worker] Done id={id}");
            if let Ok(conn) = db.get() {
                queries::update_job_status(&conn, id, "done").ok();
            }
            app.emit("worker:done", serde_json::json!({ "id": id })).ok();
        }
        OutgoingMessage::Error { id, message } => {
            eprintln!("[worker] Error id={id} message={message}");
            if let Ok(conn) = db.get() {
                queries::update_job_status(&conn, id, "error").ok();
            }
            app.emit("worker:error", serde_json::json!({ "id": id, "message": message })).ok();
        }
        OutgoingMessage::Cancelled { id } => {
            if let Ok(conn) = db.get() {
                queries::update_job_status(&conn, id, "cancelled").ok();
            }
            app.emit("worker:cancelled", serde_json::json!({ "id": id })).ok();
        }
    }
}

fn handle_recorder_event(
    app: &tauri::AppHandle,
    db: &DbPool,
    recording_chunks: &Arc<Mutex<HashMap<String, Vec<(u32, String)>>>>,
    ev: RecorderEvent,
) {
    match ev {
        RecorderEvent::Windows { windows } => {
            app.emit("recorder:windows", &windows).ok();
        }
        RecorderEvent::LiveSegment { id, idx, start, end, text } => {
            if let Ok(conn) = db.get() {
                queries::insert_segment(&conn, &queries::Segment {
                    id: 0,
                    job_id: id.clone(),
                    idx,
                    start,
                    end,
                    text,
                    corrected_text: None,
                    suspect: false,
                }).ok();
            }
            app.emit("worker:chunk", serde_json::json!({ "id": id })).ok();
        }
        RecorderEvent::ChunkReady { id, path, offset: _, index } => {
            eprintln!("[recorder] ChunkReady job={id} index={index}");
            recording_chunks.lock().unwrap()
                .entry(id.clone()).or_default().push((index, path.clone()));
            app.emit("recorder:chunk_ready", serde_json::json!({ "id": id, "index": index, "path": path })).ok();
        }
        RecorderEvent::RecordingStopped { id, file_path, duration } => {
            eprintln!("[recorder] RecordingStopped job={id} duration={duration}");
            let chunks = {
                let mut rc = recording_chunks.lock().unwrap();
                let mut v = rc.remove(&id).unwrap_or_default();
                v.sort_by_key(|(idx, _)| *idx);
                v
            };

            let final_path: String = if !file_path.is_empty() {
                eprintln!("[recorder] using SCRecordingOutput file: {file_path}");
                file_path
            } else {
                chunks
                    .first()
                    .and_then(|(_, p)| std::path::Path::new(p).parent().map(|d| d.to_path_buf()))
                    .and_then(|dir| {
                        let fp = dir.join("recording.mp4");
                        let list_path = dir.join("concat_list.txt");
                        let list_content: String = chunks
                            .iter()
                            .map(|(_, p)| format!("file '{}'\n", p.replace('\'', "'\\''")))
                            .collect();
                        let ok = std::fs::write(&list_path, &list_content).is_ok()
                            && std::process::Command::new("ffmpeg")
                                .args(["-y", "-f", "concat", "-safe", "0",
                                       "-i", list_path.to_str()?,
                                       "-c", "copy", fp.to_str()?])
                                .status()
                                .map(|s| s.success())
                                .unwrap_or(false);
                        ok.then(|| fp.to_string_lossy().into_owned())
                    })
                    .unwrap_or_default()
            };

            if let Ok(conn) = db.get() {
                if !final_path.is_empty() {
                    queries::update_job_file_path(&conn, &id, &final_path).ok();
                }
                queries::update_job_status(&conn, &id, "running").ok();
            }

            app.emit("recorder:stopped", serde_json::json!({
                "id": id,
                "file_path": final_path,
                "duration": duration,
            })).ok();

            // Start Pass 2 immediately — no chunk transcription to wait for
            start_pass2(app, db, &id, &final_path);
        }
        RecorderEvent::Screenshot { path } => {
            app.emit("recorder:screenshot", serde_json::json!({ "path": path })).ok();
        }
        RecorderEvent::Error { id, message } => {
            eprintln!("[recorder] job={id} error={message}");
            // Don't set job status to error for non-fatal recorder errors (e.g. chunk write failures).
            // The recording may still complete via SCRecordingOutput.
            app.emit("recorder:error", serde_json::json!({ "id": id, "message": message })).ok();
        }
    }
}
