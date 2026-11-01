pub mod commands;
pub mod db;
pub mod error;
pub mod state;
pub mod worker;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::db::{queries, Db};
use crate::state::AppState;
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
            let db_for_handler = Arc::clone(&db);

            let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("repo root");
            let worker_script = repo_root.join("transcription-worker/main.py");
            let python_bin = repo_root.join("transcription-worker/.venv/bin/python");

            let worker = Worker::spawn(
                python_bin.to_str().unwrap(),
                worker_script.to_str().unwrap(),
                Arc::new(move |msg| {
                    handle_worker_message(&app_handle, &db_for_handler, msg);
                }),
            )?;

            app.manage(AppState { db, worker });

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
            commands::segments::update_segment,
            commands::settings::get_ai_config,
            commands::settings::save_ai_config,
            commands::settings::get_summary_config,
            commands::settings::save_summary_config,
            commands::settings::list_ai_models,
            commands::settings::test_ai_connection,
            commands::summary::get_job_summary,
            commands::summary::generate_summary,
            commands::correction::correct_transcript,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn handle_worker_message(app: &tauri::AppHandle, db: &Arc<Mutex<Db>>, msg: OutgoingMessage) {
    match &msg {
        OutgoingMessage::Ready => {
            app.emit("worker:ready", ()).ok();
        }
        OutgoingMessage::Total { id, count } => {
            app.emit("worker:total", serde_json::json!({ "id": id, "count": count })).ok();
        }
        OutgoingMessage::Chunk { id, base_idx, index, segments } => {
            {
                let db = db.lock().unwrap();
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
                    queries::insert_segment(&db.conn, &db_seg).ok();
                }
            }
            app.emit("worker:chunk", serde_json::json!({ "id": id, "index": index })).ok();
        }
        OutgoingMessage::Correction { id, start_idx, texts } => {
            {
                let db = db.lock().unwrap();
                queries::update_segment_correction(&db.conn, id, *start_idx as i64, texts).ok();
            }
            app.emit("worker:correction", serde_json::json!({ "id": id, "start_idx": start_idx })).ok();
        }
        OutgoingMessage::Done { id } => {
            {
                let db = db.lock().unwrap();
                queries::update_job_status(&db.conn, id, "done").ok();
            }
            app.emit("worker:done", serde_json::json!({ "id": id })).ok();
        }
        OutgoingMessage::Error { id, message } => {
            {
                let db = db.lock().unwrap();
                queries::update_job_status(&db.conn, id, "error").ok();
            }
            app.emit("worker:error", serde_json::json!({ "id": id, "message": message })).ok();
        }
        OutgoingMessage::Cancelled { id } => {
            {
                let db = db.lock().unwrap();
                queries::update_job_status(&db.conn, id, "cancelled").ok();
            }
            app.emit("worker:cancelled", serde_json::json!({ "id": id })).ok();
        }
    }
}
