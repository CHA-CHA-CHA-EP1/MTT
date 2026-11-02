use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio_util::sync::CancellationToken;

use crate::commands::settings::AiConfig;
use crate::db::queries;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

fn extract_chunk_text(json: &serde_json::Value, provider: &str) -> Option<String> {
    if provider == "anthropic" {
        json.pointer("/delta/text").and_then(|v| v.as_str()).map(String::from)
    } else {
        json.pointer("/choices/0/delta/content").and_then(|v| v.as_str()).map(String::from)
    }
}

#[tauri::command]
pub async fn chat_with_transcript(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    job_id: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<(), AppError> {
    let ai_config = {
        let store = app.store("settings.json").map_err(|e| AppError::Other(e.to_string()))?;
        store
            .get("ai_config")
            .and_then(|v| serde_json::from_value::<AiConfig>(v).ok())
            .ok_or_else(|| AppError::Other("AI not configured".to_string()))?
    };

    let config = AiConfig { model, ..ai_config };

    let transcript = {
        let conn = state.db.get()?;
        queries::get_segments_text(&conn, &job_id).map_err(|e| AppError::Db(e.to_string()))?
    };

    // Clone out of state to avoid holding State<'_> across .await
    let ai_cancels = Arc::clone(&state.ai_cancels);

    let cancel_token = CancellationToken::new();
    ai_cancels.lock().unwrap().insert(job_id.clone(), cancel_token.clone());

    let result = do_chat_stream(&app, &job_id, &config, &transcript, messages, cancel_token).await;

    ai_cancels.lock().unwrap().remove(&job_id);

    result
}

async fn do_chat_stream(
    app: &AppHandle,
    job_id: &str,
    config: &AiConfig,
    transcript: &str,
    messages: Vec<ChatMessage>,
    cancel_token: CancellationToken,
) -> Result<(), AppError> {
    let system = format!(
        "You are a helpful assistant. Answer questions about the following meeting transcript.\n\n---TRANSCRIPT---\n{}\n---END TRANSCRIPT---\n\nAnswer concisely and in the same language as the user's question.",
        transcript
    );

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let base = config.effective_base_url();

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let mut body = serde_json::json!({
        "model": config.model,
        "max_tokens": 2048,
        "stream": true,
        "messages": api_messages,
    });

    let req = if config.provider == "anthropic" {
        body["system"] = serde_json::json!(system);
        client
            .post(format!("{base}/v1/messages"))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
    } else {
        // prepend system message for OpenAI-compatible
        let mut msgs = vec![serde_json::json!({ "role": "system", "content": system })];
        msgs.extend(api_messages);
        body["messages"] = serde_json::json!(msgs);
        client
            .post(format!("{base}/v1/chat/completions"))
            .bearer_auth(&config.api_key)
            .json(&body)
    };

    let resp = req
        .header("content-type", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Other(format!("HTTP {}: {}", status.as_u16(), text)));
    }

    let mut buffer = String::new();
    let mut resp = resp;

    loop {
        let maybe_bytes = tokio::select! {
            result = resp.chunk() => result.map_err(|e| AppError::Other(e.to_string()))?,
            _ = cancel_token.cancelled() => {
                app.emit("chat:cancelled", serde_json::json!({ "job_id": job_id })).ok();
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
                            if !line.starts_with("data: ") { continue; }
                            let data = &line[6..];
                            if data == "[DONE]" { break; }
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(text) = extract_chunk_text(&json, &config.provider) {
                                    app.emit("chat:chunk", serde_json::json!({ "job_id": job_id, "text": text })).ok();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    app.emit("chat:done", serde_json::json!({ "job_id": job_id })).ok();
    Ok(())
}
