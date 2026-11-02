use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

// --- Protocol ---

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RecorderCommand {
    ListWindows,
    Start { id: String, window_id: u32, chunk_duration: u32, output_dir: String },
    Stop { id: String },
    Screenshot { window_id: u32 },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RecorderEvent {
    Windows { windows: Vec<WindowInfo> },
    LiveSegment { id: String, idx: i64, start: f64, end: f64, text: String },
    ChunkReady { id: String, path: String, offset: f64, index: u32 },
    RecordingStopped { id: String, file_path: String, duration: f64 },
    Screenshot { path: String },
    Error { id: String, message: String },
}

pub type RecorderHandler = Arc<dyn Fn(RecorderEvent) + Send + Sync>;

// --- Worker ---

pub struct RecorderWorker {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
}

impl Drop for RecorderWorker {
    fn drop(&mut self) {
        self.child.lock().unwrap().kill().ok();
    }
}

impl RecorderWorker {
    pub fn spawn(binary: &str, on_event: RecorderHandler) -> std::io::Result<Self> {
        let mut child = Command::new(binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        let stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");

        let handler = Arc::clone(&on_event);
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) if l.trim().is_empty() => continue,
                    Ok(l) => match serde_json::from_str::<RecorderEvent>(&l) {
                        Ok(ev) => handler(ev),
                        Err(e) => eprintln!("[recorder] parse error: {e} — {l}"),
                    },
                    Err(e) => {
                        eprintln!("[recorder] read error: {e}");
                        break;
                    }
                }
            }
        });

        Ok(Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
        })
    }

    pub fn send(&self, cmd: &RecorderCommand) -> std::io::Result<()> {
        let json = serde_json::to_string(cmd).unwrap();
        let mut stdin = self.stdin.lock().unwrap();
        writeln!(stdin, "{json}")?;
        stdin.flush()
    }
}
