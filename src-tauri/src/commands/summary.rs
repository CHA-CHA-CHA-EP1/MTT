use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

use crate::commands::settings::AiConfig;
use crate::db::{queries, Db};
use crate::error::AppError;
use crate::state::AppState;

fn extract_chunk_text(json: &serde_json::Value, provider: &str) -> Option<String> {
    if provider == "anthropic" {
        // {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
        json.pointer("/delta/text")
            .and_then(|v| v.as_str())
            .map(String::from)
    } else {
        // {"choices":[{"delta":{"content":"..."}}]}
        json.pointer("/choices/0/delta/content")
            .and_then(|v| v.as_str())
            .map(String::from)
    }
}

async fn stream_ai(
    app: &AppHandle,
    db: &Arc<Mutex<Db>>,
    job_id: &str,
    config: &AiConfig,
    prompt: &str,
    transcript: &str,
) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let base = config.effective_base_url();

    let messages = serde_json::json!([
        { "role": "user", "content": format!("{}\n\n---\n{}", prompt, transcript) }
    ]);

    let mut req = if config.provider == "anthropic" {
        client
            .post(format!("{base}/v1/messages"))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&serde_json::json!({
                "model": config.model,
                "max_tokens": 2048,
                "stream": true,
                "messages": messages,
            }))
    } else {
        client
            .post(format!("{base}/v1/chat/completions"))
            .bearer_auth(&config.api_key)
            .json(&serde_json::json!({
                "model": config.model,
                "max_tokens": 2048,
                "stream": true,
                "messages": messages,
            }))
    };

    req = req.header("content-type", "application/json");

    let resp = req.send().await.map_err(|e| AppError::Other(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Other(format!("HTTP {}: {}", status.as_u16(), text)));
    }

    let mut buffer = String::new();
    let mut full_text = String::new();
    let mut resp = resp;

    loop {
        match resp.chunk().await.map_err(|e| AppError::Other(e.to_string()))? {
            None => break,
            Some(bytes) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));

                loop {
                    match buffer.find('\n') {
                        None => break,
                        Some(pos) => {
                            let line = buffer[..pos].trim().to_string();
                            buffer = buffer[pos + 1..].to_string();

                            if !line.starts_with("data: ") {
                                continue;
                            }
                            let data = &line[6..];
                            if data == "[DONE]" {
                                break;
                            }
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(text) = extract_chunk_text(&json, &config.provider) {
                                    full_text.push_str(&text);
                                    app.emit(
                                        "summary:chunk",
                                        serde_json::json!({ "job_id": job_id, "text": text }),
                                    )
                                    .ok();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Save to DB
    {
        let db = db.lock().unwrap();
        queries::set_job_summary(&db.conn, job_id, &full_text).ok();
    }

    app.emit("summary:done", serde_json::json!({ "job_id": job_id })).ok();
    Ok(())
}

#[tauri::command]
pub fn get_job_summary(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<Option<String>, AppError> {
    let db = state.db.lock().unwrap();
    queries::get_job_summary(&db.conn, &job_id).map_err(|e| AppError::Db(e.to_string()))
}

#[tauri::command]
pub async fn generate_summary(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    job_id: String,
    prompt: String,
    model: String,
) -> Result<(), AppError> {
    let ai_config = {
        let store = app
            .store("settings.json")
            .map_err(|e| AppError::Other(e.to_string()))?;
        store
            .get("ai_config")
            .and_then(|v| serde_json::from_value::<AiConfig>(v).ok())
            .ok_or_else(|| AppError::Other("AI not configured".to_string()))?
    };

    let config = AiConfig { model, ..ai_config };

    let transcript = {
        let db = state.db.lock().unwrap();
        queries::get_segments_text(&db.conn, &job_id)
            .map_err(|e| AppError::Db(e.to_string()))?
    };

    if transcript.is_empty() {
        return Err(AppError::Other("No transcript found for this job".to_string()));
    }

    let db = Arc::clone(&state.db);
    stream_ai(&app, &db, &job_id, &config, &prompt, &transcript).await?;

    Ok(())
}
