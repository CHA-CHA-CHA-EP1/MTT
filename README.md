# mtt — Meet-to-Text

Local-first desktop app for transcribing meeting videos and working with transcripts using AI.

Built with Tauri v2 · React · Rust · Python (mlx-whisper)

---

## Features

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

### AI Features (requires API key)
| Feature | Description |
|---|---|
| **AI Summary** | Summarize transcript with editable prompt, streaming output, saved per job |
| **AI Correction** | Batch-correct all segments via LLM using ID-based matching |
| **Chat** | Ask questions about the transcript in a streaming chat interface |

Supports **Anthropic**, **OpenAI**, and any **OpenAI-compatible** provider (LiteLLM, custom gateways).

---

## Architecture

```
React + TypeScript (Vite, Tailwind v4, Zustand)
    ↕ Tauri v2 commands + events
Rust core (SQLite WAL+FTS5, job queue, worker supervision)
    ↕ stdio JSON protocol
Python worker (VAD + mlx-whisper)
```

## Setup

### Prerequisites
- macOS (Apple Silicon)
- Rust, Node.js, pnpm
- Python 3.11+ with a venv at `transcription-worker/.venv`

### Install

```bash
pnpm install
cd transcription-worker && python -m venv .venv && source .venv/bin/activate
pip install mlx-whisper silero-vad
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
- **Base URL** (Custom only — include `/v1` suffix if required by your gateway)
- **Model** — fetch available models with "Fetch models" button

---

## Known Limitations

- Thai segment splitting not supported (`word_timestamps` causes syllable-level tokenization issues with mlx-whisper)
- Export (.srt / .txt) not yet implemented
- Search transcript not yet implemented
