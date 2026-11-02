# MTT — TODO

## 🐛 Bug: Stop Recording ไม่ทำงาน

**อาการ:** กด Stop แล้ว job ค้างที่ status "recording" ไม่เปลี่ยน

**จุดที่ต้องดู:**
- `useRecording.ts` — `stop()` อาจ capture stale `state.jobId` (ควรใช้ `useRef` แทน)
- `main.swift` — `recorder` local var ใน Task อาจยังเป็น nil ถ้า `stop` มาถึงก่อน `start` setup เสร็จ (ScreenCaptureKit permission prompt blocking)
- `Recorder.swift` — `stop()` มี `guard isActive else { return }` ถ้า start ยังไม่เสร็จ จะ return ทันทีโดยไม่ emit `recording_stopped`
- ลอง log ใน Rust ว่า `RecorderCommand::Stop` ถูกส่งไป Swift จริงไหม และ `RecordingStopped` event กลับมาไหม

---

## ✨ Features ที่ยังไม่ได้ทำ (คุยไว้แล้ว)

### 1. Recording Settings Modal (Step 2 หลัง window picker)
เพิ่ม step ให้เลือก quality ก่อน start recording

**Settings:**
- Quality preset: Low / Medium / High
  - Low: H.264, 2Mbps, logical pixels, mono 16kHz
  - Medium: H.264, 5Mbps, logical pixels, stereo 48kHz
  - High: HEVC, 8Mbps, Retina pixels, stereo 48kHz
- Chunk duration: 30s / 60s
- Audio source: System only / Mic only / Both

**ไฟล์ที่ต้องแก้:**
- `screen-recorder/Sources/Protocol.swift` — เพิ่ม fields ใน Start message
- `screen-recorder/Sources/Recorder.swift` — รับ settings แทน hardcode
- `src-tauri/src/worker/recorder.rs` — เพิ่ม fields ใน `RecorderCommand::Start`
- `src-tauri/src/commands/recording.rs` — รับ settings params
- `src/modules/recording/WindowPickerModal.tsx` — เพิ่ม step 2

---

### 2. Microphone Support

**Approach:** AVAudioEngine capture mic → ring buffer → ผสมกับ system audio → AVAssetWriter

- SCStream จับ system audio → chunk.mp4
- AVAudioEngine จับ mic → continuous mic.m4a
- ต่อ chunk: ffmpeg amix system audio + mic segment → mixed audio → ส่ง Python worker
- Final MP4: เก็บ system audio (หรือ mixed)

**ไฟล์ที่ต้องแก้:**
- `screen-recorder/Sources/Recorder.swift` — เพิ่ม `AVAudioEngine` + ring buffer + per-chunk mix
- อาจต้องเพิ่ม `NSMicrophoneUsageDescription` ใน `src-tauri/Info.plist`

---

### 3. Audio Level Meter (dB indicator)

แสดงว่า audio ได้ยินจริงไหมขณะ record

**Implementation:**
- Swift: คำนวณ RMS dB จาก CMSampleBuffer audio ทุก ~100ms → emit `audio_level` event
- Rust: เพิ่ม `AudioLevel { id, system_db, mic_db }` ใน `RecorderEvent` → emit `recorder:audio_level`
- React: แสดง meter bars ใน recording indicator ที่ header

**ไฟล์ที่ต้องแก้:**
- `screen-recorder/Sources/Protocol.swift` — เพิ่ม `AudioLevel` event
- `screen-recorder/Sources/Recorder.swift` — คำนวณ + emit RMS dB
- `src-tauri/src/worker/recorder.rs` — เพิ่ม `AudioLevel` variant
- `src-tauri/src/lib.rs` — handle `AudioLevel` event
- `src/modules/library/LibraryPage.tsx` — แสดง meter bars

---

## 📋 Quality Improvements (คุยไว้แล้ว แต่ยัง hardcode)

ปัจจุบันยัง hardcode ใน `Recorder.swift`:
- Video: H.264, 2Mbps, logical pixels (ต่ำเกิน / blurry บน Retina)
- Audio: `sampleRate = 16_000` (อาจ silent ใน บาง macOS version)

จะแก้เมื่อทำ Recording Settings Modal
