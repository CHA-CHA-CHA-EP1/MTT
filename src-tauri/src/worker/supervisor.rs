use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::worker::protocol::{IncomingMessage, OutgoingMessage};

pub type MessageHandler = Arc<dyn Fn(OutgoingMessage) + Send + Sync>;
pub type CrashHandler  = Arc<dyn Fn() + Send + Sync>;

pub struct Worker {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    /// Saved on every Init send so the watchdog can re-send it after respawn.
    pub last_init_model: Arc<Mutex<Option<String>>>,
    /// Set to true on Drop so the supervisor loop does not respawn again.
    shutdown: Arc<AtomicBool>,
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        *self.stdin.lock().unwrap() = None; // next send() returns NotConnected
    }
}

impl Worker {
    /// Spawn the worker process.
    /// - Production: `binary` is the PyInstaller bundle, `extra_args` is empty.
    /// - Dev: `binary` is the Python interpreter, `extra_args` is `[script_path]`.
    ///
    /// `on_crash` is called each time Python exits unexpectedly, before the
    /// supervisor respawns. Use it to emit frontend events and reset DB state.
    pub fn spawn(
        binary: &str,
        extra_args: &[&str],
        on_message: MessageHandler,
        on_crash: CrashHandler,
    ) -> std::io::Result<Self> {
        let binary      = binary.to_string();
        let extra_args: Vec<String> = extra_args.iter().map(|s| s.to_string()).collect();
        let stdin           = Arc::new(Mutex::new(None::<ChildStdin>));
        let last_init_model = Arc::new(Mutex::new(None::<String>));
        let shutdown        = Arc::new(AtomicBool::new(false));

        let stdin_w    = Arc::clone(&stdin);
        let init_w     = Arc::clone(&last_init_model);
        let shutdown_w = Arc::clone(&shutdown);

        std::thread::spawn(move || {
            let mut first_start = true;

            loop {
                if shutdown_w.load(Ordering::Acquire) {
                    break;
                }

                if !first_start {
                    eprintln!("[worker] Python exited unexpectedly — calling on_crash");
                    on_crash();
                    eprintln!("[worker] respawning in 2s…");
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    if shutdown_w.load(Ordering::Acquire) { break; }
                }
                first_start = false;

                let mut child = match Command::new(&binary)
                    .args(&extra_args)
                    .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::inherit())
                    .spawn()
                {
                    Ok(c)  => c,
                    Err(e) => { eprintln!("[worker] spawn failed: {e}"); break; }
                };

                let mut new_stdin = child.stdin.take().expect("stdin");
                let new_stdout    = child.stdout.take().expect("stdout");

                // Re-send Init if we have a saved model (respawn case only —
                // first start is handled by the init_worker Tauri command).
                if let Some(model) = init_w.lock().unwrap().clone() {
                    let msg  = IncomingMessage::Init { whisper_model: model };
                    let json = serde_json::to_string(&msg).unwrap();
                    writeln!(new_stdin, "{json}").ok();
                    new_stdin.flush().ok();
                    eprintln!("[worker] re-sent Init after respawn");
                }

                // Make stdin available to send() — do this AFTER writing Init
                // so the first user-visible Init doesn't race with ours.
                *stdin_w.lock().unwrap() = Some(new_stdin);

                // Reader thread: parse JSON → channel (never blocks on DB)
                let (tx, rx) = mpsc::channel::<OutgoingMessage>();
                std::thread::spawn(move || {
                    let reader = BufReader::new(new_stdout);
                    for line in reader.lines() {
                        match line {
                            Ok(l) if l.trim().is_empty() => continue,
                            Ok(l) => match serde_json::from_str::<OutgoingMessage>(&l) {
                                Ok(msg) => { tx.send(msg).ok(); }
                                Err(e)  => eprintln!("[worker] parse error: {e} — line: {l}"),
                            },
                            Err(e) => {
                                eprintln!("[worker] stdout read error: {e}");
                                break;
                            }
                        }
                    }
                    // tx dropped → rx loop exits when channel is drained
                });

                // DB writer thread drains the channel — may block on db.get(),
                // which is fine because the reader thread never blocks.
                let handler = Arc::clone(&on_message);
                for msg in rx {
                    handler(msg);
                }

                // Reader exited — Python process finished or crashed.
                *stdin_w.lock().unwrap() = None;

                match child.try_wait() {
                    Ok(Some(status)) if status.success() => {
                        eprintln!("[worker] Python exited cleanly");
                        break; // intentional exit — don't respawn
                    }
                    Ok(Some(status)) => {
                        eprintln!("[worker] Python exited with {status} — will respawn");
                        // loop continues
                    }
                    Ok(None) => {
                        // stdout closed but process alive — kill it first
                        eprintln!("[worker] Python stdout closed while process alive — killing");
                        child.kill().ok();
                        child.wait().ok();
                        // loop continues
                    }
                    Err(e) => {
                        eprintln!("[worker] wait error: {e}");
                        break;
                    }
                }
            }
        });

        Ok(Self { stdin, last_init_model, shutdown })
    }

    pub fn send(&self, msg: &IncomingMessage) -> std::io::Result<()> {
        // Persist Init model so the watchdog can re-send it after respawn.
        if let IncomingMessage::Init { whisper_model } = msg {
            *self.last_init_model.lock().unwrap() = Some(whisper_model.clone());
        }
        let json  = serde_json::to_string(msg).unwrap();
        let mut guard = self.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotConnected, "worker not ready")
        })?;
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

    fn no_op_crash() -> CrashHandler {
        Arc::new(|| {})
    }

    #[test]
    fn test_worker_init_ready() {
        let received: Arc<Mutex<Vec<OutgoingMessage>>> = Arc::new(Mutex::new(vec![]));
        let received_clone = Arc::clone(&received);

        let (python, script) = fake_worker_path();
        let worker = Worker::spawn(&python, &[script.as_str()], Arc::new(move |msg| {
            received_clone.lock().unwrap().push(msg);
        }), no_op_crash()).unwrap();

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
        }), no_op_crash()).unwrap();

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
