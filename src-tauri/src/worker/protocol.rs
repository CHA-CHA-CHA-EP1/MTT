use serde::{Deserialize, Serialize};

// --- Incoming (Rust → Python) ---

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    Init { whisper_model: String },
    TranscribeFile { id: String, file: String, mode: String },
    Cancel { id: String },
}

// --- Outgoing (Python → Rust) ---

#[derive(Debug, Deserialize, Clone)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub suspect: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    Ready,
    Total { id: String, count: u32 },
    Chunk { id: String, index: u32, base_idx: u32, segments: Vec<Segment> },
    Correction { id: String, start_idx: u32, texts: Vec<String> },
    Done { id: String },
    Error { id: String, message: String },
    Cancelled { id: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_init() {
        let msg = IncomingMessage::Init { whisper_model: "large-v3".into() };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"init","whisper_model":"large-v3"}"#);
    }

    #[test]
    fn test_serialize_transcribe_file() {
        let msg = IncomingMessage::TranscribeFile {
            id: "job-1".into(),
            file: "/tmp/test.mp4".into(),
            mode: "offline".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"transcribe_file""#));
        assert!(json.contains(r#""id":"job-1""#));
    }

    #[test]
    fn test_parse_ready() {
        let json = r#"{"type":"ready"}"#;
        let msg: OutgoingMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, OutgoingMessage::Ready));
    }

    #[test]
    fn test_parse_chunk() {
        let json = r#"{
            "type": "chunk",
            "id": "job-1",
            "index": 0,
            "base_idx": 0,
            "segments": [
                {"start": 0.0, "end": 2.5, "text": "สวัสดีครับ", "suspect": false}
            ]
        }"#;
        let msg: OutgoingMessage = serde_json::from_str(json).unwrap();
        if let OutgoingMessage::Chunk { id, segments, .. } = msg {
            assert_eq!(id, "job-1");
            assert_eq!(segments[0].text, "สวัสดีครับ");
        } else {
            panic!("expected Chunk");
        }
    }

    #[test]
    fn test_parse_correction() {
        let json = r#"{"type":"correction","id":"job-1","start_idx":0,"texts":["hello","world"]}"#;
        let msg: OutgoingMessage = serde_json::from_str(json).unwrap();
        if let OutgoingMessage::Correction { texts, .. } = msg {
            assert_eq!(texts, vec!["hello", "world"]);
        } else {
            panic!("expected Correction");
        }
    }

    #[test]
    fn test_parse_error() {
        let json = r#"{"type":"error","id":"job-1","message":"ffmpeg failed"}"#;
        let msg: OutgoingMessage = serde_json::from_str(json).unwrap();
        if let OutgoingMessage::Error { message, .. } = msg {
            assert_eq!(message, "ffmpeg failed");
        } else {
            panic!("expected Error");
        }
    }
}
