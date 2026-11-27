# Implementation Plan: Live Transcription Toggle + Qwen Default

**Status:** pending approval  
**Date:** 2026-11-27  
**Scope:** Sequential live transcription during recording + Qwen3-ASR as default model

---

## Requirements Summary

1. Change default transcription model from Whisper Large v3 Turbo → Qwen3-ASR-1.7B-bf16
2. Add live transcription toggle in recording UI
3. During live mode: transcribe each 30s chunk sequentially as it arrives
4. Skip worker-busy chunks (no queue buildup)
5. After recording stops in live mode: skip full re-transcription pass
6. Existing non-live flow must remain 100% unchanged

---

## Acceptance Criteria

- [ ] Qwen3-ASR is selected by default for new installations (users who already saved a model keep theirs)
- [ ] Toggle button visible during active recording in TranscriptPage
- [ ] Segments appear in transcript list within ~30s of speech occurring (one chunk lag)
- [ ] Only one chunk transcribed at a time (sequential); if worker busy, chunk is skipped
- [ ] After stopping recording with live mode on: "Transcribe" button does NOT appear; job transitions running → done automatically
- [ ] After stopping recording with live mode off: existing flow unchanged (shows "Transcribe" button)
- [ ] Non-live recording+transcription flow: zero regressions

---

## Implementation Steps

### Step 1 — Qwen Default (1 file, ~2 min)
**File:** `src/lib/whisperConfig.ts:10-28`

Reorder `WHISPER_MODELS` array so Qwen3 is index 0:
```ts
export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: "mlx-community/Qwen3-ASR-1.7B-bf16",
    label: "Qwen3 ASR 1.7B",
    description: "Recommended — best Thai/multilingual quality",
  },
  {
    id: "mlx-community/whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo",
    description: "Fast & accurate",
  },
  {
    id: "mlx-community/whisper-large-v3-mlx",
    label: "Whisper Large v3",
    description: "Best Whisper quality, slower",
  },
];
```
`DEFAULT_MODEL = WHISPER_MODELS[0].id` already picks the first — no other change needed.  
**Note:** existing users with a saved model are unaffected (load() validates against list and falls back only if model no longer exists).

---

### Step 2 — Python: chunk_index offset support
**File:** `transcription-worker/protocol.py`

Add optional `chunk_index` to `TranscribeFileMessage`:
```python
class TranscribeFileMessage(BaseModel):
    id: str
    file: str
    mode: str = "offline"
    language: str = "th"
    chunk_index: Optional[int] = None  # ADD THIS
```

**File:** `transcription-worker/transcriber.py` (or `main.py` where `transcribe_file` is called)

After getting segments from Whisper/Qwen, apply offset if `chunk_index` is set:
```python
offset_secs = (chunk_index * 30.0) if chunk_index is not None else 0.0
# Apply to every segment before yielding/emitting:
segment.start += offset_secs
segment.end += offset_secs
```
Needs to be done before inserting segments via the ChunkMessage path.

---

### Step 3 — Rust protocol: add chunk_index field
**File:** `src-tauri/src/worker/protocol.rs`

```rust
TranscribeFile {
    id: String,
    file: String,
    mode: String,
    language: String,
    chunk_index: Option<u32>,   // ADD THIS
},
```

---

### Step 4 — Rust: new transcribe_live_chunk command
**File:** `src-tauri/src/commands/jobs.rs`

Add new command (does NOT delete existing segments, does NOT reset status):
```rust
#[tauri::command]
pub fn transcribe_live_chunk(
    state: State<AppState>,
    job_id: String,
    chunk_path: String,
    chunk_index: u32,
    language: String,
) -> Result<(), AppError> {
    // Set job to "running" if still "recording"
    if let Ok(conn) = state.db.get() {
        conn.execute(
            "UPDATE jobs SET status = 'running' WHERE id = ?1 AND status = 'recording'",
            rusqlite::params![job_id],
        ).ok();
    }
    state.worker.send(&IncomingMessage::TranscribeFile {
        id: job_id,
        file: chunk_path,
        mode: "stream".into(),
        language,
        chunk_index: Some(chunk_index),
    })?;
    Ok(())
}
```

Register in `src-tauri/src/lib.rs` invoke_handler (line ~159).

---

### Step 5 — Frontend: tauri binding
**File:** `src/lib/tauri.ts`

```ts
export const transcribeLiveChunk = (
  jobId: string,
  chunkPath: string,
  chunkIndex: number,
  language: string,
) => invoke<void>("transcribe_live_chunk", { jobId, chunkPath, chunkIndex, language });
```

---

### Step 6 — Frontend: live mode state + chunk handler
**File:** `src/modules/transcript/TranscriptPage.tsx`

**6a. Add state/ref (near line 197):**
```ts
const [liveTranscribeEnabled, setLiveTranscribeEnabled] = useState(false);
const liveTranscribeEnabledRef = useRef(false);  // for use inside event closure
const isWorkerBusyRef = useRef(false);            // sequential gate
const retranscribeLang = ...                      // already exists
```

**6b. Keep liveTranscribeEnabledRef in sync:**
```ts
useEffect(() => {
  liveTranscribeEnabledRef.current = liveTranscribeEnabled;
}, [liveTranscribeEnabled]);
```

**6c. Extend chunk_ready handler (line 327-335):**
```ts
const unlisten = listen<{ id: string; index: number; path: string; offset: number }>(
  "recorder:chunk_ready",
  async (ev) => {
    if (ev.payload.id !== jobId) return;
    // existing DVR update
    setLiveChunks((prev) => { ... });
    // NEW: live transcription
    if (liveTranscribeEnabledRef.current && !isWorkerBusyRef.current) {
      isWorkerBusyRef.current = true;
      try {
        await transcribeLiveChunk(jobId, ev.payload.path, ev.payload.index, retranscribeLang);
      } catch (e) {
        console.error("live chunk transcribe error:", e);
        isWorkerBusyRef.current = false;
      }
    }
  }
);
```

**6d. Reset busy flag on worker:done/error/cancelled** (extend existing useWorkerEvents handler):
```ts
onDone: ({ id }) => {
  if (id !== jobId) return;
  isWorkerBusyRef.current = false;   // ADD
  ...
},
onError: ({ id }) => {
  if (id !== jobId) return;
  isWorkerBusyRef.current = false;   // ADD
  ...
},
```

**6e. After recorder:stopped with live mode — skip "pending" state:**
In the existing `recorder:stopped` handler (line 295-304), extend:
```ts
const unlisten = listen<{ id: string; file_path: string }>("recorder:stopped", (ev) => {
  if (ev.payload.id !== jobId) return;
  setIsLiveRecording(false);
  setIsStopping(false);
  setLiveChunks([]);
  setMicLevel(0);
  setSystemLevel(0);
  if (ev.payload.file_path) setVideoSrc(convertFileSrc(ev.payload.file_path));
  // NEW: if live mode was on, job is already "running" → will auto-transition to "done"
  // Don't show Transcribe button — setJobStatus stays "running"
  if (!liveTranscribeEnabledRef.current) {
    setJobStatus("pending");   // existing behavior: show Transcribe button
  }
  // if live mode: jobStatus stays at "running", worker:done will set it to "done"
});
```

---

### Step 7 — Toggle UI
**File:** `src/modules/transcript/TranscriptPage.tsx`

Find the recording toolbar area (shown when `isLiveRecording`, near the Stop button). Add toggle button next to Stop:

```tsx
{isLiveRecording && (
  <button
    onClick={() => setLiveTranscribeEnabled(v => !v)}
    className={cn(
      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
      liveTranscribeEnabled
        ? "border-blue-500 bg-blue-500/10 text-blue-600"
        : "hover:bg-accent text-muted-foreground"
    )}
    title={liveTranscribeEnabled ? "Live transcription on" : "Live transcription off"}
  >
    <Captions className="h-3.5 w-3.5" />
    Live
  </button>
)}
```

Import `Captions` from `lucide-react` (or use `Subtitles`/`FileText` if unavailable).

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Python `chunk_index` field breaks existing `TranscribeFileMessage` parsing | Use `Optional[int] = None` — backward compatible |
| `isWorkerBusy` ref stale after worker restart/crash | Worker crash fires `worker:crashed` → reset flag; add to crash handler |
| Last live chunk arrives after `recorder:stopped` → `isWorkerBusy` still true when checking | Race is benign: chunk is skipped, full recording still exists for manual re-transcription if user wants |
| Qwen default breaks users who have saved Whisper model | `load()` already validates saved model and keeps it if valid |
| Time offset wrong (chunks not exactly 30s) | Use `ev.payload.offset` from `recorder:chunk_ready` instead of `chunk_index * 30` for more accurate offset |

**Note on offset accuracy:** `recorder:chunk_ready` already emits `offset` field (line 453 in lib.rs). Use this real offset instead of `chunk_index * 30`. Pass it as `chunk_offset_secs: Optional[float]` instead of `chunk_index`.

---

## Revised Step 2b (offset accuracy fix)

Use `offset` from the event (actual seconds) rather than `chunk_index * 30`:

**Protocol change:** Use `chunk_offset_secs: Optional[float] = None` instead of `chunk_index`  
**Command signature:** `transcribe_live_chunk(job_id, chunk_path, chunk_offset_secs, language)`  
**Frontend:** pass `ev.payload.offset` as `chunkOffsetSecs`

This is more accurate since Swift may produce chunks slightly longer/shorter than 30s.

---

## Verification Steps

1. `pnpm build` (or `make test`) — zero TypeScript errors
2. Start recording → toggle Live on → wait 30s → segment appears in transcript list
3. Toggle Live off mid-recording → no more segments update
4. Stop recording with Live on → no "Transcribe" button shown; job goes running → done
5. Stop recording with Live off → "Transcribe" button appears as before (regression check)
6. Settings modal shows Qwen as default for new installs
7. Existing saved model is preserved after update

---

## File Change Summary

| File | Change | Lines affected |
|------|--------|----------------|
| `src/lib/whisperConfig.ts` | Reorder WHISPER_MODELS array | 10-26 |
| `transcription-worker/protocol.py` | Add `chunk_offset_secs: Optional[float]` | ~TranscribeFileMessage class |
| `transcription-worker/transcriber.py` | Apply offset to segments | In transcribe_file output loop |
| `src-tauri/src/worker/protocol.rs` | Add `chunk_offset_secs: Option<f64>` to TranscribeFile | ~line 9 |
| `src-tauri/src/commands/jobs.rs` | Add `transcribe_live_chunk` command | New ~15 lines |
| `src-tauri/src/lib.rs` | Register new command in invoke_handler | ~line 159 |
| `src/lib/tauri.ts` | Add `transcribeLiveChunk` binding | +3 lines |
| `src/modules/transcript/TranscriptPage.tsx` | Live state, chunk handler extension, toggle button, stopped handler | ~6 locations |

**Total estimated lines changed:** ~80 lines across 8 files  
**Non-live flow impact:** Zero — all new paths gated behind `liveTranscribeEnabled` flag

