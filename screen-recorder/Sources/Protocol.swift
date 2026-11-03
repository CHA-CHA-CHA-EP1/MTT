import Foundation

struct WindowInfo: Codable {
    let id: UInt32
    let title: String
    let app: String
}

// MARK: - Incoming (Rust → Swift)

enum IncomingMessage: Decodable {
    case listWindows
    case start(id: String, windowId: UInt32, chunkDuration: Int, outputDir: String, includeMic: Bool, micDeviceLabel: String)
    case stop(id: String)
    case screenshot(windowId: UInt32)
    case toggleMic(enabled: Bool)

    private enum CodingKeys: String, CodingKey {
        case type, id
        case windowId = "window_id"
        case chunkDuration = "chunk_duration"
        case outputDir = "output_dir"
        case includeMic = "include_mic"
        case micDeviceLabel = "mic_device_label"
        case toggleMic = "toggle_mic"
        case enabled
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "list_windows":
            self = .listWindows
        case "start":
            self = .start(
                id: try c.decode(String.self, forKey: .id),
                windowId: try c.decode(UInt32.self, forKey: .windowId),
                chunkDuration: try c.decode(Int.self, forKey: .chunkDuration),
                outputDir: try c.decode(String.self, forKey: .outputDir),
                includeMic: (try? c.decode(Bool.self, forKey: .includeMic)) ?? true,
                micDeviceLabel: (try? c.decode(String.self, forKey: .micDeviceLabel)) ?? ""
            )
        case "stop":
            self = .stop(id: try c.decode(String.self, forKey: .id))
        case "screenshot":
            self = .screenshot(windowId: try c.decode(UInt32.self, forKey: .windowId))
        case "toggle_mic":
            self = .toggleMic(enabled: try c.decode(Bool.self, forKey: .enabled))
        case let t:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown: \(t)")
        }
    }
}

// MARK: - Outgoing (Swift → Rust)

func emit(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let json = String(data: data, encoding: .utf8) else { return }
    print(json)
    fflush(stdout)
}

func emitWindows(_ windows: [WindowInfo]) {
    let arr = windows.map { ["id": $0.id, "title": $0.title, "app": $0.app] as [String: Any] }
    emit(["type": "windows", "windows": arr])
}

func emitChunkReady(id: String, path: String, offset: Double, index: Int) {
    emit(["type": "chunk_ready", "id": id, "path": path, "offset": offset, "index": index])
}

func emitRecordingStopped(id: String, filePath: String, duration: Double) {
    emit(["type": "recording_stopped", "id": id, "file_path": filePath, "duration": duration])
}

func emitError(id: String, message: String) {
    emit(["type": "error", "id": id, "message": message])
}

func emitScreenshot(path: String) {
    emit(["type": "screenshot", "path": path])
}

func emitLiveSegment(id: String, idx: Int, start: Double, end: Double, text: String) {
    emit(["type": "live_segment", "id": id, "idx": idx, "start": start, "end": end, "text": text])
}

func emitAudioLevel(id: String, systemLevel: Float, micLevel: Float) {
    emit(["type": "audio_level", "id": id, "system_level": systemLevel, "mic_level": micLevel])
}
