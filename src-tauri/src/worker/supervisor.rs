use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::worker::protocol::{IncomingMessage, OutgoingMessage};

pub type MessageHandler = Arc<dyn Fn(OutgoingMessage) + Send + Sync>;

pub struct Worker {
    stdin: Mutex<ChildStdin>,
    _child: Mutex<Child>,
}

impl Worker {
    /// Spawn the worker process.
    /// - Production: `binary` is the PyInstaller bundle, `extra_args` is empty.
    /// - Dev: `binary` is the Python interpreter, `extra_args` is `[script_path]`.
    pub fn spawn(binary: &str, extra_args: &[&str], on_message: MessageHandler) -> std::io::Result<Self> {
        let mut child = Command::new(binary)
            .args(extra_args)
            // Ensure brew-installed tools (ffmpeg, etc.) are in PATH when bundled as .app
            .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        let stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");

        let handler = Arc::clone(&on_message);
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) if l.trim().is_empty() => continue,
                    Ok(l) => match serde_json::from_str::<OutgoingMessage>(&l) {
                        Ok(msg) => handler(msg),
                        Err(e) => eprintln!("[worker] parse error: {e} — line: {l}"),
                    },
                    Err(e) => {
                        eprintln!("[worker] stdout read error: {e}");
                        break;
                    }
                }
            }
        });

        Ok(Self {
            stdin: Mutex::new(stdin),
            _child: Mutex::new(child),
        })
    }

    pub fn send(&self, msg: &IncomingMessage) -> std::io::Result<()> {
        let json = serde_json::to_string(msg).unwrap();
        let mut stdin = self.stdin.lock().unwrap();
        writeln!(stdin, "{json}")?;
        stdin.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker::protocol::OutgoingMessage;
    use std::sync::{Arc, Mutex};

    fn fake_worker_path() -> (String, String) {
        use std::path::PathBuf;
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        let script = project_root.join("tests/fixtures/fake_worker.py");
        ("python3".into(), script.to_string_lossy().into_owned())
    }

    #[test]
    fn test_worker_init_ready() {
        let received: Arc<Mutex<Vec<OutgoingMessage>>> = Arc::new(Mutex::new(vec![]));
        let received_clone = Arc::clone(&received);

        let (python, script) = fake_worker_path();
        let worker = Worker::spawn(&python, &[script.as_str()], Arc::new(move |msg| {
            received_clone.lock().unwrap().push(msg);
        })).unwrap();

        worker.send(&IncomingMessage::Init { whisper_model: "large-v3".into() }).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));

        let msgs = received.lock().unwrap();
        assert!(msgs.iter().any(|m| matches!(m, OutgoingMessage::Ready)));
    }

    #[test]
    fn test_worker_transcribe_done() {
        let received: Arc<Mutex<Vec<OutgoingMessage>>> = Arc::new(Mutex::new(vec![]));
        let received_clone = Arc::clone(&received);

        let (python, script) = fake_worker_path();
        let worker = Worker::spawn(&python, &[script.as_str()], Arc::new(move |msg| {
            received_clone.lock().unwrap().push(msg);
        })).unwrap();

        worker.send(&IncomingMessage::Init { whisper_model: "large-v3".into() }).unwrap();
        worker.send(&IncomingMessage::TranscribeFile {
            id: "job-1".into(),
            file: "/tmp/test.mp4".into(),
            mode: "offline".into(),
            language: "th".into(),
        }).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));

        let msgs = received.lock().unwrap();
        assert!(msgs.iter().any(|m| matches!(m, OutgoingMessage::Ready)));
        assert!(msgs.iter().any(|m| matches!(m, OutgoingMessage::Total { .. })));
        assert!(msgs.iter().any(|m| matches!(m, OutgoingMessage::Chunk { .. })));
        assert!(msgs.iter().any(|m| matches!(m, OutgoingMessage::Done { .. })));
    }
}
