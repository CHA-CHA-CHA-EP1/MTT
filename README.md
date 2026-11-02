# mtt — Meet-to-Text

Local-first desktop app for transcribing meeting videos and working with transcripts using AI.

Built with Tauri v2 · React · Rust · Python (mlx-whisper)

---

## Features

### Live Recording
- Record any window directly from the app (ScreenCaptureKit)
- Real-time transcription — each 30-second chunk is transcribed as it records
- Audio-only capture (AAC 48kHz stereo) piped to Whisper in real time
- Requires Screen Recording permission + Tauri app codesigned with `com.apple.security.screen-capture`

### Transcription
- Transcribe video files locally using mlx-whisper (Apple Silicon)
- VAD (Voice Activity Detection) via silero for accurate segment splitting
- Inline segment editing — double-click to correct text

### Transcript View
- Resizable split panel: video player + transcript side by side
- Segment scroll-highlight synced to video playback
- Custom video controls: play/pause, skip ±10s, seek, volume, speed (0.5×–2×)
- Closed Captions overlay with font size S/M/L
- Full transcript view with copy to clipboard
- Search transcript — full-text search with FTS5, click result to seek video

### AI Features (requires API key)
| Feature | Description |
|---|---|
| **✨ Summarize** | Summarize with preset prompts (General Summary / Action Items), streaming output, saved per job |
| **🪄 Improve text** | Batch-correct all segments via LLM using ID-based matching, with optional custom instruction |
| **💬 Chat** | Ask questions about the transcript in a streaming chat interface |

Supports **Anthropic**, **OpenAI**, and any **OpenAI-compatible** provider (LiteLLM, custom gateways).

---

## Architecture

### Overview

```mermaid
flowchart TD
    subgraph UI["React UI (TypeScript · Vite · Tailwind v4 · Zustand)"]
        direction TB
        PP["ProjectsPage\n+ SettingsModal"]
        LP["LibraryPage"]
        TP["TranscriptPage\n(Player · SegmentList · Search)"]
        SP["SummaryPanel"]
        CP["CorrectionPanel"]
        CH["ChatPanel"]
    end

    subgraph TAURI["Tauri v2 Core (Rust)"]
        direction TB
        CMD["Commands\nprojects · jobs · segments\nsettings · summary · correction · chat"]
        DB[("SQLite WAL\nprojects\njobs + summary\nsegments + FTS5")]
        STORE[("tauri-plugin-store\nAI config JSON")]
        WS["Worker Supervisor\n(stdin/stdout IPC)"]
        EV["Event Emitter\nworker:* · summary:*\nchat:* · correction:*"]
    end

    subgraph REC["Swift Screen Recorder (CLI)"]
        direction TB
        SCK["ScreenCaptureKit\nSCStream (audio)"]
        AW["AVAssetWriter\naudio-only AAC\nchunk_N.mp4"]
    end

    subgraph PY["Python Worker (mlx-whisper)"]
        direction TB
        MAIN["main.py\nmessage dispatcher"]
        VAD["Silero VAD\nspeech timestamps"]
        FF["ffmpeg\naudio extraction\n(mono · 16kHz · f32le)"]
        WH["mlx_whisper\ntranscribe()"]
        COR["corrector.py\nAnthropic Haiku\nbatch text correction"]
    end

    subgraph AI["External AI APIs"]
        ANT["Anthropic API\n/v1/messages (SSE)"]
        OAI["OpenAI-compatible API\n/v1/chat/completions (SSE)"]
    end

    PP -->|invoke| CMD
    LP -->|invoke| CMD
    TP -->|invoke| CMD
    SP -->|invoke| CMD
    CP -->|invoke| CMD
    CH -->|invoke| CMD

    CMD <-->|read/write| DB
    CMD <-->|read/write| STORE
    CMD --> WS
    CMD -->|HTTP reqwest streaming| AI
    EV -->|listen events| UI

    WS -->|stdin JSON| MAIN
    MAIN -->|stdout JSON| WS
    WS --> EV

    WS -->|stdin JSON: start/stop| SCK
    SCK --> AW
    AW -->|chunk_ready event| WS

    MAIN --> FF
    FF -->|numpy f32 array| VAD
    VAD -->|speech chunks| WH
    WH -->|segments| COR
    COR -->|ANTHROPIC_API_KEY| ANT
```

### Transcription Data Flow

```mermaid
sequenceDiagram
    participant R as React UI
    participant T as Tauri (Rust)
    participant P as Python Worker
    participant A as Anthropic API

    R->>T: invoke("create_job", {filePath})
    T->>T: INSERT job (status=pending)
    T->>P: stdin: TranscribeFile {id, file}

    P->>P: ffmpeg → numpy audio
    P->>P: Silero VAD → speech chunks
    P-->>T: stdout: Total {count}

    loop each chunk
        P->>P: mlx_whisper.transcribe()
        P-->>T: stdout: Chunk {index, segments[]}
        T->>T: INSERT segments to DB
        T-->>R: event: worker:chunk
    end

    loop every 15 segments
        P->>A: POST /v1/messages (Haiku)
        A-->>P: corrected JSON array
        P-->>T: stdout: Correction {start_idx, texts[]}
        T->>T: UPDATE segments.corrected_text
        T-->>R: event: worker:correction
    end

    P-->>T: stdout: Done
    T->>T: UPDATE job status=done
    T-->>R: event: worker:done
```

### AI Features Data Flow

```mermaid
sequenceDiagram
    participant R as React UI
    participant T as Tauri (Rust)
    participant A as AI API (Anthropic/OpenAI)

    note over R,A: Summary & Chat — streaming SSE

    R->>T: invoke("generate_summary" | "chat_with_transcript")
    T->>T: load transcript from DB (corrected_text or text)
    T->>A: POST /v1/messages or /v1/chat/completions\n{stream: true, system: transcript context}
    loop SSE stream
        A-->>T: data: {delta.text / choices[0].delta.content}
        T-->>R: event: summary:chunk / chat:chunk
        R->>R: accumulate + render Markdown
    end
    A-->>T: [DONE]
    T-->>R: event: summary:done / chat:done
    T->>T: persist summary to jobs.summary (summary only)

    note over R,A: Correction — batch non-streaming

    R->>T: invoke("correct_transcript")
    T->>T: load all segments, split into batches of 20
    loop each batch
        T->>A: POST /v1/messages\n[{"id": N, "text": "..."}]
        A-->>T: {"corrections": [{"id": N, "corrected": "..."}]}
        T->>T: UPDATE segments.corrected_text WHERE id=N
        T-->>R: event: correction:progress {current, total}
    end
    T-->>R: event: correction:done {corrected_count}
```

### SQLite Schema

```mermaid
erDiagram
    projects {
        TEXT id PK
        TEXT name
        INTEGER created_at
    }
    jobs {
        TEXT id PK
        TEXT project_id FK
        TEXT file_path
        TEXT status
        TEXT whisper_model
        TEXT summary
        INTEGER created_at
    }
    segments {
        INTEGER id PK
        TEXT job_id FK
        INTEGER idx
        REAL start
        REAL end
        TEXT text
        TEXT corrected_text
        INTEGER suspect
    }
    segments_fts {
        TEXT text
        TEXT corrected_text
    }

    projects ||--o{ jobs : "has"
    jobs ||--o{ segments : "has"
    segments ||--|| segments_fts : "synced via triggers"
```

## Setup

### Prerequisites
- macOS 13+ (Apple Silicon)
- Rust, Node.js, pnpm, Swift (Xcode CLI tools), ffmpeg
- Python 3.11+ with a venv at `transcription-worker/.venv`

```bash
brew install ffmpeg
xcode-select --install
```

### Install

```bash
make install   # installs Python deps + builds screen-recorder binary
pnpm install   # installs JS deps
```

### Dev

```bash
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

---

## AI Settings

Open Settings (⚙️ in Projects header) to configure:

- **Provider**: Anthropic / OpenAI / Custom (LiteLLM, internal gateways)
- **API Key**
- **Base URL** (Custom only — e.g. `https://your-gateway.com/v1`)
- **Model** — fetch available models with "Fetch models" button, or type manually
- **Test Connection** — validates key and endpoint before use

---

## Known Limitations

- Thai segment splitting not supported (`word_timestamps` causes syllable-level tokenization issues with mlx-whisper)
- Export (.srt / .txt) not yet implemented
- Whisper model selector not yet implemented (model hardcoded)
- CC settings (on/off, font size) do not persist across sessions
- Live recording saves video on **macOS 15+** via `SCRecordingOutput`; macOS 13/14 is audio-only (see Known Issues)

---

## Known Issues

### macOS 15 (Sequoia): VideoToolbox hardware encoder fails in subprocess context

**Symptom:** `AVAssetWriter.append()` fails immediately with `AVFoundationErrorDomain/-11800` wrapping `NSOSStatusErrorDomain/-16122` (`kVTVideoEncoderMalfunctionErr`). Both video and audio appends fail, even though `startWriting()` returns true.

**Root cause:** On macOS 15, the VideoToolbox HEVC/H.264 hardware encoder fails asynchronously immediately after `startWriting()` when called from a CLI subprocess (screen-recorder is spawned by the Tauri app with only `com.apple.security.screen-capture` entitlement). The writer transitions to `.failed` (status 3) before the first frame arrives, causing all subsequent appends to fail with the same error.

**Things that do NOT fix it:** switching codec (H.264 ↔ HEVC), changing pixel format (BGRA → 420v), rounding dimensions to even numbers, adding compression properties (`AVVideoExpectedSourceFrameRateKey`, etc.).

**Current fix (audio-only chunks):** Removed video input from `AVAssetWriter` entirely — no VT session, no async failure. AAC audio encoding works fine. The Whisper pipeline is unaffected since it only needs audio.

**Video recording (macOS 15+):** `SCRecordingOutput` is used alongside the audio-only chunk pipeline. Apple's framework handles all encoding internally, bypassing VideoToolbox entirely. This produces a complete `recording.mp4` (video+audio) saved at the end of the recording. On macOS 13/14, the fallback is audio-only chunks concatenated with ffmpeg.

**Architecture with SCRecordingOutput:**
```
SCStream
  ├── SCRecordingOutput → recording.mp4  (video+audio, for playback — macOS 15+)
  └── AudioHandler → AVAssetWriter → chunk_N.mp4 → Whisper  (real-time transcription)
```
