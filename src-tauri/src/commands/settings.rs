use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::error::AppError;

const STORE_FILE: &str = "settings.json";
const AI_CONFIG_KEY: &str = "ai_config";
const SUMMARY_CONFIG_KEY: &str = "summary_config";

const DEFAULT_PROMPT: &str = "Please summarize this meeting transcript. Include:\n1. Key discussion points\n2. Decisions made\n3. Action items with owners (if mentioned)\n\nBe concise and use the same language as the transcript.";

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AiConfig {
    pub provider: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: String,
}

impl AiConfig {
    pub fn effective_base_url(&self) -> String {
        let url = match self.base_url.as_deref() {
            Some(u) if !u.is_empty() => u,
            _ => match self.provider.as_str() {
                "anthropic" => "https://api.anthropic.com",
                _ => "https://api.openai.com",
            },
        };
        // strip trailing /v1 so callers can safely append /v1/...
        url.trim_end_matches('/')
            .trim_end_matches("/v1")
            .to_string()
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SummaryConfig {
    pub prompt: String,
    pub model: String,
}

#[tauri::command]
pub fn get_summary_config(app: AppHandle) -> Result<SummaryConfig, AppError> {
    let store = app.store(STORE_FILE).map_err(|e| AppError::Other(e.to_string()))?;
    if let Some(v) = store.get(SUMMARY_CONFIG_KEY) {
        if let Ok(cfg) = serde_json::from_value::<SummaryConfig>(v) {
            return Ok(cfg);
        }
    }
    // default: use model from ai_config
    let model = store.get(AI_CONFIG_KEY)
        .and_then(|v| serde_json::from_value::<AiConfig>(v).ok())
        .map(|c| c.model)
        .unwrap_or_default();
    Ok(SummaryConfig { prompt: DEFAULT_PROMPT.to_string(), model })
}

#[tauri::command]
pub fn save_summary_config(app: AppHandle, config: SummaryConfig) -> Result<(), AppError> {
    let store = app.store(STORE_FILE).map_err(|e| AppError::Other(e.to_string()))?;
    store.set(SUMMARY_CONFIG_KEY, serde_json::to_value(&config).unwrap());
    store.save().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn get_ai_config(app: AppHandle) -> Result<Option<AiConfig>, AppError> {
    let store = app.store(STORE_FILE).map_err(|e| AppError::Other(e.to_string()))?;
    let config = store.get(AI_CONFIG_KEY).and_then(|v| serde_json::from_value(v).ok());
    Ok(config)
}

#[tauri::command]
pub fn save_ai_config(app: AppHandle, config: AiConfig) -> Result<(), AppError> {
    let store = app.store(STORE_FILE).map_err(|e| AppError::Other(e.to_string()))?;
    store.set(AI_CONFIG_KEY, serde_json::to_value(&config).unwrap());
    store.save().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn list_ai_models(config: AiConfig) -> Result<Vec<String>, AppError> {
    let client = reqwest::Client::new();
    let base = config.effective_base_url();

    let mut req = client.get(format!("{base}/v1/models"));
    req = if config.provider == "anthropic" {
        req.header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
    } else {
        req.bearer_auth(&config.api_key)
    };

    let resp = req.send().await.map_err(|e| AppError::Other(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let msg = body.pointer("/error/message").or_else(|| body.pointer("/message"))
            .and_then(|v| v.as_str()).unwrap_or("unknown error");
        return Err(AppError::Other(format!("HTTP {}: {}", status.as_u16(), msg)));
    }

    let text = resp.text().await.map_err(|e| AppError::Other(e.to_string()))?;
    let body: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| AppError::Other(format!("non-JSON response: {}", &text[..text.len().min(300)])))?;

    // OpenAI format: { "data": [{ "id": "..." }] }
    if let Some(arr) = body["data"].as_array() {
        let models = arr.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect();
        return Ok(models);
    }

    // Flat array format: [{ "id": "..." }]
    if let Some(arr) = body.as_array() {
        let models = arr.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect();
        return Ok(models);
    }

    Err(AppError::Other(format!("unexpected response format: {}", body)))
}

#[tauri::command]
pub async fn test_ai_connection(config: AiConfig) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let base = config.effective_base_url();

    // GET /v1/models — zero tokens, works for Anthropic + OpenAI-compatible (LiteLLM, Bifrost, etc.)
    let mut req = client.get(format!("{base}/v1/models"));
    req = if config.provider == "anthropic" {
        req.header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
    } else {
        req.bearer_auth(&config.api_key)
    };

    let resp = req.send().await.map_err(|e| AppError::Other(e.to_string()))?;

    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }

    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    let msg = body
        .pointer("/error/message")
        .or_else(|| body.pointer("/message"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error");

    Err(AppError::Other(format!("HTTP {}: {}", status.as_u16(), msg)))
}
