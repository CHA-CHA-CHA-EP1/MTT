pub mod commands;
pub mod db;
pub mod error;
pub mod state;
pub mod worker;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::db::{queries, Db};
use crate::state::{AppState, ChunkInfo};
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

            let db = Arc::new(Mutex::new(Db::new(db_path.to_str().unwrap())?));

            let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("repo root");
            let worker_script = repo_root.join("transcription-worker/main.py");
            let python_bin = repo_root.join("transcription-worker/.venv/bin/python");

            // Shared state between worker handler and recorder handler
            let chunk_info: Arc<Mutex<HashMap<String, ChunkInfo>>> =
                Arc::new(Mutex::new(HashMap::new()));
            let recording_chunks: Arc<Mutex<HashMap<String, Vec<(u32, String)>>>> =
                Arc::new(Mutex::new(HashMap::new()));

            // Spawn Python transcription worker
            let db_for_worker = Arc::clone(&db);
            let chunk_info_for_worker = Arc::clone(&chunk_info);
            let app_handle_w = app_handle.clone();

            // Channel: recorder handler → worker (avoids borrowing Worker in two closures)
            let (tx, rx) = std::sync::mpsc::channel::<crate::worker::protocol::IncomingMessage>();
            let tx = Arc::new(Mutex::new(tx));
            let tx_for_rec = Arc::clone(&tx);

            let worker = Worker::spawn(
                python_bin.to_str().unwrap(),
                worker_script.to_str().unwrap(),
                Arc::new(move |msg| {
                    handle_worker_message(
                        &app_handle_w,
                        &db_for_worker,
                        &chunk_info_for_worker,
                        msg,
                    );
                }),
            )?;

            // Spawn Swift screen recorder (optional)
            let recorder_bin = repo_root.join("screen-recorder/.build/release/screen-recorder");

            let recorder: Option<RecorderWorker> = if recorder_bin.exists() {
                let db_for_rec = Arc::clone(&db);
                let chunk_info_for_rec = Arc::clone(&chunk_info);
                let recording_chunks_for_rec = Arc::clone(&recording_chunks);
                let app_handle_rec = app_handle.clone();

                match RecorderWorker::spawn(
                    recorder_bin.to_str().unwrap(),
                    Arc::new(move |ev| {
                        handle_recorder_event(
                            &app_handle_rec,
                            &db_for_rec,
                            &chunk_info_for_rec,
                            &recording_chunks_for_rec,
                            &tx_for_rec,
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
                chunk_info,
                recording_chunks,
            });

            // Relay thread: forward IncomingMessages from recorder event handler → Python worker
            let app_handle_relay = app.handle().clone();
            std::thread::spawn(move || {
                for msg in rx {
                    let state: tauri::State<AppState> = app_handle_relay.state();
                    if let Err(e) = state.worker.send(&msg) {
                        eprintln!("[relay] worker send failed: {e}");
                    }
                }
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
            commands::segments::search_segments,
            commands::segments::search_segments_in_job,
            commands::segments::update_segment,
            commands::settings::get_ai_config,
            commands::settings::save_ai_config,
            commands::settings::get_summary_config,
            commands::settings::save_summary_config,
            commands::settings::list_ai_models,
            commands::settings::test_ai_connection,
            commands::chat::chat_with_transcript,
            commands::summary::get_job_summary,
            commands::summary::generate_summary,
            commands::correction::correct_transcript,
            commands::recording::list_windows,
            commands::recording::start_recording,
            commands::recording::stop_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn is_chunk_job(id: &str) -> bool {
    id.contains(":chunk:")
}

fn parent_job_id(chunk_job_id: &str) -> &str {
    chunk_job_id.splitn(2, ":chunk:").next().unwrap_or(chunk_job_id)
}

fn handle_worker_message(
    app: &tauri::AppHandle,
    db: &Arc<Mutex<Db>>,
    chunk_info: &Arc<Mutex<HashMap<String, ChunkInfo>>>,
    msg: OutgoingMessage,
) {

    match &msg {
        OutgoingMessage::Ready => {
            app.emit("worker:ready", ()).ok();
        }
        OutgoingMessage::Total { id, count } => {
            if !is_chunk_job(id) {
                app.emit("worker:total", serde_json::json!({ "id": id, "count": count })).ok();
            }
        }
        OutgoingMessage::Chunk { id, base_idx, index, segments } => {
            eprintln!("[worker] Chunk id={id} index={index} segs={}", segments.len());
            if is_chunk_job(id) {
                let (parent_id, offset, chunk_idx) = {
                    let ci = chunk_info.lock().unwrap();
                    match ci.get(id.as_str()) {
                        Some(info) => (info.parent_job_id.clone(), info.offset, info.chunk_index),
                        None => {
                            eprintln!("[worker] unknown chunk id: {id}");
                            return;
                        }
                    }
                };
                eprintln!("[worker] writing {} segs for parent={parent_id} offset={offset}", segments.len());
                let db_lock = db.lock().unwrap();
                for (i, seg) in segments.iter().enumerate() {
                    let db_seg = queries::Segment {
                        id: 0,
                        job_id: parent_id.clone(),
                        idx: (chunk_idx as i64) * 10_000 + (*base_idx as i64) + i as i64,
                        start: seg.start + offset,
                        end: seg.end + offset,
                        text: seg.text.clone(),
                        corrected_text: None,
                        suspect: seg.suspect,
                    };
                    queries::insert_segment(&db_lock.conn, &db_seg).ok();
                }
                drop(db_lock);
                app.emit("worker:chunk", serde_json::json!({ "id": parent_id, "index": index })).ok();
            } else {
                let db_lock = db.lock().unwrap();
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
                    queries::insert_segment(&db_lock.conn, &db_seg).ok();
                }
                drop(db_lock);
                app.emit("worker:chunk", serde_json::json!({ "id": id, "index": index })).ok();
            }
        }
        OutgoingMessage::Correction { id, start_idx, texts } => {
            let target_id = if is_chunk_job(id) {
                chunk_info.lock().unwrap().get(id).map(|i| i.parent_job_id.clone()).unwrap_or_default()
            } else {
                id.clone()
            };
            if !target_id.is_empty() {
                let db_lock = db.lock().unwrap();
                queries::update_segment_correction(&db_lock.conn, &target_id, *start_idx as i64, texts).ok();
                drop(db_lock);
                app.emit("worker:correction", serde_json::json!({ "id": target_id, "start_idx": start_idx })).ok();
            }
        }
        OutgoingMessage::Done { id } => {
            eprintln!("[worker] Done id={id}");
            if is_chunk_job(id) {
                chunk_info.lock().unwrap().remove(id.as_str());
            } else {
                let db_lock = db.lock().unwrap();
                queries::update_job_status(&db_lock.conn, id, "done").ok();
                drop(db_lock);
                app.emit("worker:done", serde_json::json!({ "id": id })).ok();
            }
        }
        OutgoingMessage::Error { id, message } => {
            if is_chunk_job(id) {
                chunk_info.lock().unwrap().remove(id.as_str());
            }
            let target_id = if is_chunk_job(id) { parent_job_id(id).to_owned() } else { id.clone() };
            let db_lock = db.lock().unwrap();
            queries::update_job_status(&db_lock.conn, &target_id, "error").ok();
            drop(db_lock);
            app.emit("worker:error", serde_json::json!({ "id": target_id, "message": message })).ok();
        }
        OutgoingMessage::Cancelled { id } => {
            if !is_chunk_job(id) {
                let db_lock = db.lock().unwrap();
                queries::update_job_status(&db_lock.conn, id, "cancelled").ok();
                drop(db_lock);
                app.emit("worker:cancelled", serde_json::json!({ "id": id })).ok();
            }
        }
    }
}

fn handle_recorder_event(
    app: &tauri::AppHandle,
    db: &Arc<Mutex<Db>>,
    chunk_info: &Arc<Mutex<HashMap<String, ChunkInfo>>>,
    recording_chunks: &Arc<Mutex<HashMap<String, Vec<(u32, String)>>>>,
    worker_tx: &Arc<Mutex<std::sync::mpsc::Sender<crate::worker::protocol::IncomingMessage>>>,
    ev: RecorderEvent,
) {
    match ev {
        RecorderEvent::Windows { windows } => {
            app.emit("recorder:windows", &windows).ok();
        }
        RecorderEvent::ChunkReady { id, path, offset, index } => {
            eprintln!("[recorder] ChunkReady job={id} index={index} path={path} offset={offset}");
            let chunk_job_id = format!("{id}:chunk:{index}");

            {
                let mut ci = chunk_info.lock().unwrap();
                ci.insert(chunk_job_id.clone(), ChunkInfo {
                    parent_job_id: id.clone(),
                    offset,
                    chunk_index: index,
                });
            }
            {
                let mut rc = recording_chunks.lock().unwrap();
                rc.entry(id.clone()).or_default().push((index, path.clone()));
            }

            let msg = crate::worker::protocol::IncomingMessage::TranscribeFile {
                id: chunk_job_id.clone(),
                file: path.clone(),
                mode: "offline".into(),
            };
            eprintln!("[recorder] sending TranscribeFile chunk_job_id={chunk_job_id} file={path}");
            if let Err(e) = worker_tx.lock().unwrap().send(msg) {
                eprintln!("[recorder] relay send failed: {e}");
            }

            app.emit("recorder:chunk_ready", serde_json::json!({ "id": id, "index": index })).ok();
        }
        RecorderEvent::RecordingStopped { id, file_path, duration } => {
            eprintln!("[recorder] RecordingStopped job={id} duration={duration} file_path={file_path}");
            let chunks = {
                let mut rc = recording_chunks.lock().unwrap();
                let mut v = rc.remove(&id).unwrap_or_default();
                v.sort_by_key(|(idx, _)| *idx);
                v
            };

            // If SCRecordingOutput already produced a complete video+audio file, use it directly.
            // Otherwise, attempt ffmpeg concat of audio-only chunks.
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

            {
                let db_lock = db.lock().unwrap();
                if !final_path.is_empty() {
                    queries::update_job_file_path(&db_lock.conn, &id, &final_path).ok();
                }
                queries::update_job_status(&db_lock.conn, &id, "done").ok();
            }
            app.emit("recorder:stopped", serde_json::json!({
                "id": id,
                "file_path": final_path,
                "duration": duration,
            })).ok();
        }
        RecorderEvent::Error { id, message } => {
            eprintln!("[recorder] job={id} error={message}");
            app.emit("recorder:error", serde_json::json!({ "id": id, "message": message })).ok();
            if !id.is_empty() {
                let db_lock = db.lock().unwrap();
                queries::update_job_status(&db_lock.conn, &id, "error").ok();
            }
        }
    }
}
