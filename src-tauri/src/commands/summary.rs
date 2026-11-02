use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio_util::sync::CancellationToken;

use crate::commands::settings::AiConfig;
use crate::db::{queries, DbPool};
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
    db: &DbPool,
    job_id: &str,
    config: &AiConfig,
    prompt: &str,
    transcript: &str,
    cancel_token: CancellationToken,
) -> Result<(), AppError> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

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
        let maybe_bytes = tokio::select! {
            result = resp.chunk() => result.map_err(|e| AppError::Other(e.to_string()))?,
            _ = cancel_token.cancelled() => {
                app.emit("summary:cancelled", serde_json::json!({ "job_id": job_id })).ok();
                return Ok(());
            }
            _ = tokio::time::sleep(Duration::from_secs(60)) => {
                return Err(AppError::Other("AI response timed out (no data for 60s)".to_string()));
            }
        };

        match maybe_bytes {
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
        let conn = db.get().map_err(|e| AppError::Db(e.to_string()))?;
        queries::set_job_summary(&conn, job_id, &full_text).ok();
    }

    app.emit("summary:done", serde_json::json!({ "job_id": job_id })).ok();
    Ok(())
}

#[tauri::command]
pub fn get_job_summary(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<Option<String>, AppError> {
    let conn = state.db.get()?;
    queries::get_job_summary(&conn, &job_id).map_err(|e| AppError::Db(e.to_string()))
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
        let conn = state.db.get()?;
        queries::get_segments_text(&conn, &job_id)
            .map_err(|e| AppError::Db(e.to_string()))?
    };

    if transcript.is_empty() {
        return Err(AppError::Other("No transcript found for this job".to_string()));
    }

    // Clone out of state to avoid holding State<'_> across .await
    let db = state.db.clone();
    let ai_cancels = Arc::clone(&state.ai_cancels);

    let cancel_token = CancellationToken::new();
    ai_cancels.lock().unwrap().insert(job_id.clone(), cancel_token.clone());

    let result = stream_ai(&app, &db, &job_id, &config, &prompt, &transcript, cancel_token).await;

    ai_cancels.lock().unwrap().remove(&job_id);

    result
}

/// Cancel an active summary or chat stream for the given job.
#[tauri::command]
pub fn cancel_ai_stream(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<(), AppError> {
    if let Some(token) = state.ai_cancels.lock().unwrap().get(&job_id) {
        token.cancel();
    }
    Ok(())
}
