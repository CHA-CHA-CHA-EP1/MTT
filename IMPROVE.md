# MTT — Improvement Backlog

ผลจาก architecture review (Nov 2026) แบ่งเป็น quick wins และ larger redesigns

---

## 🚨 Critical Bugs (ต้องแก้ก่อน)

### B4.4 — Metal GPU race condition (concurrent transcription)
**ไฟล์:** `transcription-worker/transcriber.py`  
MLX release GIL ระหว่าง Metal dispatch → ถ้า 2 jobs transcribe พร้อมกัน → undefined behavior หรือ GPU fault
```python
# แก้: เพิ่ม lock รอบ mlx_whisper.transcribe()
_mlx_lock = threading.Lock()

with _mlx_lock:
    result = mlx_whisper.transcribe(clip, ...)
```

### B4.3 — AI correction ทับ manual edit ของ user ✅ DONE (`fix/b43-guard-ai-correction`)
**ไฟล์:** `src-tauri/src/db/queries.rs` (`set_segment_correction_guarded` ใหม่), `src-tauri/src/commands/correction.rs`
ตัวที่ทับจริงคือ `correct_transcript` → `set_segment_text` (path เดียวกับ manual edit ของ user) — ไม่ใช่ `update_segment_correction` (dead code, Python corrector disabled)
แก้: query ใหม่ guarded `WHERE id = ?2 AND job_id = ?3 AND corrected_text IS NULL` ใช้เฉพาะ AI path + validate id ∈ batch (`HashSet`) + นับ `corrected_count` จาก rows affected จริง; `set_segment_text` คงเดิมให้ user
Trade-off: บล็อก AI re-run บน segment ที่เคยแก้แล้วด้วย (ดู QW13 สำหรับ provenance column)

### B4.2 — Race condition: startup recovery clobber new jobs
**ไฟล์:** `src-tauri/src/db/queries.rs::reset_interrupted_jobs`  
ถ้า user click Record ทันทีหลัง launch → job ใหม่ที่ status=`running` ถูก reset เป็น error
```sql
-- แก้: reset เฉพาะ jobs ที่เก่ากว่า 60 วินาที
WHERE status IN ('running', 'pending') 
  AND created_at < (unixepoch() - 60) * 1000
```

---

## ⚡ Quick Wins (S effort — ชั่วโมง)

### QW1 — Export SRT + TXT
**ไฟล์:** `src-tauri/src/commands/` (ไฟล์ใหม่ `export.rs`) + `src/modules/transcript/TranscriptPage.tsx`  
ทุก segment มี `start`, `end`, `text`/`corrected_text` ครบแล้ว — generate client-side หรือ Rust ก็ได้  
Format SRT:
```
1
00:00:01,000 --> 00:00:03,500
สวัสดีครับ ยินดีต้อนรับ
```

### QW2 — ปุ่ม Cancel ใน SummaryPanel / ChatPanel
**ไฟล์:** `src/modules/summary/SummaryPanel.tsx`, `src/modules/chat/ChatPanel.tsx`  
Backend `cancel_ai_stream()` พร้อมแล้วใน `tauri.ts:187` — แค่ต้อง wire ปุ่ม

### QW3 — Confirmation dialog ก่อน delete job/space
**ไฟล์:** `src/modules/shell/Sidebar.tsx`  
Trash icon fire `remove()` ทันที ไม่มี dialog — meeting 2 ชั่วโมงหายได้ด้วย misclick

### QW4 — Boot screen ที่ readable
**ไฟล์:** `src/App.tsx::WorkerBootstrap`  
แสดง app name + "กำลังโหลด Whisper model (~15 วินาที)" + readable error + retry button  
ถ้า model ยังไม่ได้ download → แสดง command ที่ต้องรัน + copy button

### QW5 — `np.memmap` แทน `np.fromfile` (RAM)
**ไฟล์:** `transcription-worker/transcriber.py:59-65`  
ประชุม 2 ชั่วโมง = 461 MB numpy array โหลดทั้งก้อนเข้า unified memory
```python
# แก้:
audio = np.memmap(tmp_path, dtype=np.float32, mode='r')
```

### QW6 — Token guard ก่อน AI summary
**ไฟล์:** `src-tauri/src/commands/summary.rs::generate_summary`  
ประชุม 4+ ชั่วโมง → exceed context window → HTTP 400 เงียบๆ ไม่มี error ที่ user เข้าใจ
```rust
let transcript = if transcript.len() > 100_000 {
    format!("{}\n\n[Transcript truncated — first ~60 min shown]", &transcript[..100_000])
} else { transcript };
```

### QW7 — Whisper advanced settings เป็น UI config
**ไฟล์:** `src-tauri/src/commands/settings.rs`, `transcription-worker/main.py` (InitMessage), `src/modules/settings/SettingsModal.tsx`

ตอนนี้ค่าพวกนี้ hardcode ใน `transcriber.py` ทั้งหมด — ควรให้ user ปรับได้จาก Settings

**Settings ที่ควรเพิ่ม:**
- `condition_on_previous_text: bool` (default: `false`) — ถ้า `true` Whisper ใช้ output chunk ก่อนเป็น context → error สะสมได้; `false` ปลอดภัยกว่าสำหรับ meeting
- `language: "th" | "en" | "auto"` (default: `"auto"`) — ตอนนี้ fix ที่ job level แต่ควรมี global default ด้วย
- `temperature: number` (default: `0`) — เพิ่มเมื่อต้องการ diversity สูงขึ้น

**Flow การแก้:**
1. เพิ่ม `whisper_config` ใน `settings.json` (tauri-plugin-store)
2. ส่งผ่าน `InitMessage` ไปยัง Python worker (เพิ่ม field ใน `protocol.rs` + `protocol.py`)
3. `transcriber.py` รับค่าจาก config แทน hardcode
4. เพิ่ม UI ใน SettingsModal ใต้ Whisper model selector

เพิ่ม post-processing hallucination denylist ด้วย: `["Thanks for watching", "Please subscribe", "สวัสดีครับ" (บน silent clip)]`

### QW8 — Batch INSERTs ใน transaction
**ไฟล์:** `src-tauri/src/lib.rs::handle_worker_message`  
~1032 individual INSERTs + FTS5 triggers ต่อ 1 ชั่วโมง → wrap ด้วย `BEGIN/COMMIT`

### QW9 — ffmpeg timeout guard
**ไฟล์:** `transcription-worker/transcriber.py`  
`subprocess.run()` ไม่มี timeout → ffmpeg hang → job ค้างตลอดไป
```python
subprocess.run([...], check=True, timeout=300)
```

### QW10 — Language picker ตอน record/import
**ไฟล์:** `src/modules/recording/WindowPickerModal.tsx`, `src/modules/library/`  
ตอนนี้ language fixed เป็น Thai ตลอด — ต้อง re-transcribe เพื่อเปลี่ยน  
เพิ่ม dropdown (Thai / English / Auto) ใน step 2 ของ WindowPickerModal

### QW11 — ปุ่ม "Open System Settings" เมื่อ Screen Recording permission denied
**ไฟล์:** `src/modules/recording/WindowPickerModal.tsx:193-199`  
```typescript
await open("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
```

### QW12 — Error handling บน segment update
**ไฟล์:** `src/modules/transcript/TranscriptPage.tsx::saveEdit`  
`updateSegment()` throw ได้ แต่ไม่มี try/catch → edit box ปิดเงียบๆ ไม่มี toast

### QW13 — Provenance column สำหรับ corrected_text (ต่อยอด B4.3)
**ไฟล์:** `src-tauri/src/db/schema.rs`, `src-tauri/src/db/queries.rs`  
ตอนนี้ `corrected_text` เก็บทั้ง AI และ manual ปนกัน — guard `IS NULL` ของ B4.3 บล็อก AI re-run บน segment ที่ AI เคยแก้เองด้วย  
เพิ่ม `corrected_by TEXT` (`NULL` | `'ai'` | `'user'`) → guard เป็น `WHERE corrected_by IS NULL OR corrected_by = 'ai'` → AI re-correct ได้เฉพาะของตัวเอง, manual edit ยังถูกปกป้อง  
ต้อง migration + set provenance ในทั้ง user path (`set_segment_text`) และ AI path

### QW14 — Fix 6 pre-existing test failures (baseline `cargo test` is perma-red)
**ไฟล์:** `src-tauri/src/db/queries.rs` (test `setup()`), `src-tauri/src/worker/supervisor.rs` (fixture)  
`cargo test` มี 6 failures จาก baseline `7ff78c1` (ไม่ใช่ regression จาก diff ไหน):
- 4× `db::queries::tests`: `no such column: duration_secs` — `schema::CREATE_TABLES` ไม่มี column นี้ แต่ migrations เพิ่มทีหลัง; test `setup()` ใช้ `CREATE_TABLES` ตรงๆ ไม่รัน migrations → ต้องเพิ่ม `duration_secs` ใน `CREATE_TABLES` หรือให้ test `setup()` รัน migrations ตามหลัง
- 2× `worker::supervisor::tests`: `fake_worker` BrokenPipe (fixture start ไม่ทันก่อน test วิ่ง) — อาจต้องเพิ่ม retry หรือ sleep ใน fixture
การที่ `cargo test` แดงถาวรทำให้ catch regression ใน feature อื่นยาก — ควรแก้ให้กลับเขียวก่อนเพิ่ม test ใหม่

---

## 🏗️ Larger Redesigns (M-L effort — สัปดาห์)

### R1 — Python watchdog + auto-restart
**ไฟล์:** `src-tauri/src/worker/supervisor.rs`  
Python crash → `BufReader::lines()` break เงียบๆ ไม่มี React event ไม่มี restart  
เพิ่ม watchdog หลัง reader loop: `child.try_wait()` → emit `worker:crashed` → update jobs to error → respawn worker → re-send `Init`  
**Effort:** M

### R2 — IPC deadlock fix: handler ใช้ async channel
**ไฟล์:** `src-tauri/src/worker/supervisor.rs`, `src-tauri/src/lib.rs`  
Worker reader thread → `handle_worker_message` → `db.get()` block ถ้า pool exhausted → Python stdout pipe fill up → deadlock  
แก้: reader thread ส่งลง channel เท่านั้น; dedicated DB writer task consume จาก channel  
**Effort:** M

### R3 — Live chunk transcription (draft segments ระหว่าง record)
**ไฟล์:** `transcription-worker/main.py`, `transcription-worker/transcriber.py`, `src-tauri/src/lib.rs`, `src/modules/transcript/TranscriptPage.tsx`  
Infrastructure มีครบแล้ว: `ChunkReady` events ทุก 30s, `LiveSegment` protocol ใน Swift  
เพิ่ม `TranscribeChunk` incoming message ใน Python — transcribe 30s clip ทันที → draft segments แสดงระหว่าง meeting  
Full-pass หลัง stop replace drafts (accuracy สูงกว่า)  
**Effort:** L

### R4 — Correction diff review
**ไฟล์:** `src/modules/transcript/TranscriptPage.tsx`, segment item component  
AI แก้ segments แล้ว update ทันทีโดยไม่แสดงให้ user เห็นความต่าง  
เพิ่ม "review mode": original ~~strikethrough~~ + corrected highlighted + per-segment Accept/Revert  
`corrected_text` column มีอยู่แล้ว — ไม่ต้องแก้ backend  
**Effort:** M

### R5 — ส่ง API key ผ่าน InitMessage ไปยัง Python worker
**ไฟล์:** `src-tauri/src/worker/protocol.rs`, `transcription-worker/protocol.py`, `transcription-worker/main.py`, `transcription-worker/corrector.py`  
`corrector.py` ต้องการ `ANTHROPIC_API_KEY` env var แต่ app เก็บ key ใน `settings.json` ผ่าน Rust  
→ Python corrector disabled ตลอดแม้ user ตั้ง key แล้ว (split-brain)  
**Effort:** M

### R6 — Speaker diarization
**ไฟล์:** `transcription-worker/transcriber.py`, `transcription-worker/protocol.py`, `src-tauri/src/worker/protocol.rs`, `src-tauri/src/db/schema.rs`, `src/modules/transcript/`  
pyannote.audio v4 บน MPS เร็วขึ้น 4.4× — viable แล้วบน Apple Silicon  
เพิ่ม `speaker: Optional[str]` ใน `Segment` → DB column → UI แสดง speaker label  
**Effort:** L

### R7 — projects/spaces schema cleanup
**ไฟล์:** `src-tauri/src/db/schema.rs`, `src-tauri/src/db/mod.rs`, `src-tauri/src/commands/`  
`projects` และ `spaces` เป็น parallel schema ที่ sync กันทุก DB connection — ghost rows สะสม  
Migration path: drop `jobs.project_id NOT NULL`, migrate FK ไป `space_id` เต็มๆ  
**Effort:** M

### R8 — Notarization
**ไฟล์:** `Makefile`, build pipeline  
ตอนนี้ user ต้องรัน `xattr -cr /Applications/mtt.app` — hard blocker สำหรับ non-developer  
Apple Developer Program $99/yr → notarize via `xcrun notarytool`  
**Effort:** M

### R9 — Storage management UI
**ไฟล์:** `src/modules/library/`, `src-tauri/src/commands/jobs.rs`  
Power user 5 meetings/day → ~2.5 GB/day → ~50 GB/เดือน ไม่มี auto-cleanup  
เพิ่ม per-job file size display + "delete video, keep transcript" + configurable auto-delete  
**Effort:** M

### R10 — API key → macOS Keychain
**ไฟล์:** `src-tauri/src/commands/settings.rs`  
`settings.json` ใน App Support อ่านได้โดย process อื่น, Time Machine, iCloud sync  
ใช้ `security-framework` crate หรือ `security add-generic-password` CLI  
**Effort:** M

---

## 📊 SSE duplication (small refactor)

**ไฟล์:** `src-tauri/src/commands/summary.rs`, `src-tauri/src/commands/chat.rs`  
`extract_chunk_text` function เหมือนกัน 100% ใน 2 ไฟล์ — SSE parsing loop copy-paste  
Extract เป็น `src-tauri/src/commands/ai_stream.rs` utility

---

## 🔭 Thai-specific Improvements

- ทดสอบ **Thonburian Whisper** หรือ **Typhoon Whisper** fine-tune สำหรับ Thai-English code-switching  
  (standard large-v3 มี WER สูงบน mixed Thai/English ตาม ACL 2024 paper)
- เพิ่ม hint บน language picker: "ใช้ Auto สำหรับ meeting ที่มีทั้ง Thai และ English"

---

## ✅ Decisions ที่ถูกแล้ว — ไม่ต้องแก้

| Decision | เหตุผล |
|----------|--------|
| Subprocess IPC แทน FFI/WASM | mlx-whisper, pyannote เป็น native extension — embed ไม่ได้จริง |
| Local-first transcription | Differentiator ชัด สำหรับ work meeting ที่ sensitive |
| reqwest SSE แทน WebSocket | Request-response with streaming — SSE simpler และ correct |
| SQLite + raw rusqlite queries | Explicit, testable, no migration tool needed |
| CancellationToken pattern | Clean, correct — เก็บไว้ |
| `corrected_text` nullable column | Non-destructive — เปิดทาง diff review โดยไม่ต้องแก้ schema |
| Tauri v2 + React (ไม่ใช่ Electron/SwiftUI) | Right decomposition สำหรับ problem นี้ |
