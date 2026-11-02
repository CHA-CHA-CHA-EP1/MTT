use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

use crate::commands::settings::AiConfig;
use crate::db::queries;
use crate::error::AppError;
use crate::state::AppState;

const BATCH_SIZE: usize = 20;

fn build_prompt(instruction: &str) -> String {
    let base = "You are a transcript correction assistant. Fix grammar, spelling, punctuation, and proper nouns.\n\nRules:\n- Return ONLY valid JSON: {\"corrections\": [{\"id\": <number>, \"corrected\": \"<text>\"}, ...]}\n- Same number of items as input\n- Keep the same language and meaning\n- Do not merge or split segments\n- Fix obvious transcription errors only";
    if instruction.trim().is_empty() {
        base.to_string()
    } else {
        format!("{}\n\nAdditional instructions: {}", base, instruction)
    }
}

async fn call_ai(
    client: &reqwest::Client,
    config: &AiConfig,
    system_prompt: &str,
    user_content: &str,
) -> Result<String, AppError> {
    let base = config.effective_base_url();
    let mut body = serde_json::json!({
        "model": config.model,
        "max_tokens": 4096,
        "messages": [
            { "role": "user", "content": format!("{}\n\nInput segments:\n{}", system_prompt, user_content) }
        ]
    });

    let req = if config.provider == "anthropic" {
        body["system"] = serde_json::json!("You are a helpful assistant that always responds with valid JSON.");
        client
            .post(format!("{base}/v1/messages"))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
    } else {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
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
    let text = resp.text().await.map_err(|e| AppError::Other(e.to_string()))?;

    if !status.is_success() {
        return Err(AppError::Other(format!("HTTP {}: {}", status.as_u16(), text)));
    }

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| AppError::Other(e.to_string()))?;

    let content = if config.provider == "anthropic" {
        json.pointer("/content/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        json.pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    Ok(content)
}

#[tauri::command]
pub async fn correct_transcript(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    job_id: String,
    model: String,
    instruction: String,
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

    let segments = {
        let conn = state.db.get()?;
        queries::get_segments(&conn, &job_id)
            .map_err(|e| AppError::Db(e.to_string()))?
    };

    if segments.is_empty() {
        return Err(AppError::Other("No segments found".to_string()));
    }

    let total_batches = (segments.len() + BATCH_SIZE - 1) / BATCH_SIZE;
    let system_prompt = build_prompt(&instruction);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let mut corrected_count = 0usize;

    for (batch_idx, batch) in segments.chunks(BATCH_SIZE).enumerate() {
        app.emit(
            "correction:progress",
            serde_json::json!({
                "job_id": job_id,
                "current": batch_idx + 1,
                "total": total_batches,
            }),
        )
        .ok();

        let input: Vec<serde_json::Value> = batch
            .iter()
            .map(|s| serde_json::json!({ "id": s.id, "text": s.corrected_text.as_ref().unwrap_or(&s.text) }))
            .collect();

        let user_content = serde_json::to_string(&input).unwrap();

        let raw = match call_ai(&client, &config, &system_prompt, &user_content).await {
            Ok(r) => r,
            Err(e) => {
                app.emit(
                    "correction:error",
                    serde_json::json!({ "job_id": job_id, "message": e.to_string() }),
                )
                .ok();
                return Err(e);
            }
        };

        // Parse JSON response
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(corrections) = parsed["corrections"].as_array() {
                let conn = state.db.get()?;
                for item in corrections {
                    let id = item["id"].as_i64().unwrap_or(-1);
                    let corrected = item["corrected"].as_str().unwrap_or("");
                    if id >= 0 && !corrected.is_empty() {
                        queries::set_segment_text(&conn, id, Some(corrected.to_string())).ok();
                        corrected_count += 1;
                    }
                }
            }
        }
    }

    app.emit(
        "correction:done",
        serde_json::json!({ "job_id": job_id, "corrected_count": corrected_count }),
    )
    .ok();

    Ok(())
}
