import AVFoundation
import ScreenCaptureKit
import CoreMedia

@available(macOS 13.0, *)
final class Recorder: NSObject {
    private let lock = NSLock()
    private var stream: SCStream?
    private var videoHandler: VideoHandler?
    private var audioHandler: AudioHandler?

    // SCRecordingOutput (macOS 15+) — stored as AnyObject to avoid @available on property
    private var recordingOutput: AnyObject?
    private var videoFilePath = ""
    private var hasVideoOutput = false

    // chunk writer state (guarded by lock)
    private var writer: AVAssetWriter?
    private var audioInput: AVAssetWriterInput?
    private var chunkStartPTS: CMTime = .invalid
    private var sessionStarted = false

    // job state
    private(set) var isActive = false
    private var jobId = ""
    private var outputDir = URL(fileURLWithPath: "/tmp")
    private var chunkDuration: Double = 30
    private var chunkIndex = 0
    private var videoWidth = 1280
    private var videoHeight = 720

    func start(jobId: String, windowId: CGWindowID, chunkDuration: Int, outputDir: String) async {
        self.jobId = jobId
        self.chunkDuration = Double(chunkDuration)
        self.outputDir = URL(fileURLWithPath: outputDir)
        self.chunkIndex = 0
        self.hasVideoOutput = false
        self.videoFilePath = ""
        fputs("[swift] start job=\(jobId) windowId=\(windowId)\n", stderr)

        do {
            try FileManager.default.createDirectory(
                at: self.outputDir, withIntermediateDirectories: true, attributes: nil)

            let content = try await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: true)
            guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
                emitError(id: jobId, message: "Window \(windowId) not found")
                return
            }
            fputs("[swift] window found: \(window.title ?? "(no title)")\n", stderr)

            guard !Task.isCancelled else { return }

            let windowCenter = CGPoint(x: window.frame.midX, y: window.frame.midY)
            let display = content.displays.first(where: { $0.frame.contains(windowCenter) })
                ?? content.displays.first
            let scale = display.map { Double($0.width) / Double($0.frame.width) } ?? 2.0

            videoWidth  = min(3840, max(640,  Int(window.frame.width  * scale) & ~1))
            videoHeight = min(2160, max(360,  Int(window.frame.height * scale) & ~1))

            let config = SCStreamConfiguration()
            config.width = videoWidth
            config.height = videoHeight
            config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            config.capturesAudio = true
            // 48 kHz is valid on all macOS 13+ builds; 16 kHz can produce silent audio.
            // ffmpeg in the Python worker downsamples to 16 kHz mono for Whisper.
            config.sampleRate = 48_000
            config.channelCount = 2
            config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange

            let filter = SCContentFilter(desktopIndependentWindow: window)
            let captureStream = SCStream(filter: filter, configuration: config, delegate: nil)

            let vh = VideoHandler(recorder: self)
            let ah = AudioHandler(recorder: self)
            videoHandler = vh
            audioHandler = ah

            try captureStream.addStreamOutput(vh, type: .screen,
                sampleHandlerQueue: DispatchQueue(label: "mtt.video"))
            try captureStream.addStreamOutput(ah, type: .audio,
                sampleHandlerQueue: DispatchQueue(label: "mtt.audio"))

            // macOS 15+: use SCRecordingOutput for a complete video+audio file alongside audio chunks
            if #available(macOS 15.0, *) {
                let videoFile = self.outputDir.appendingPathComponent("recording.mp4")
                videoFilePath = videoFile.path
                let recConfig = SCRecordingOutputConfiguration()
                recConfig.outputURL = videoFile
                recConfig.outputFileType = .mp4
                let ro = SCRecordingOutput(configuration: recConfig, delegate: self)
                try captureStream.addRecordingOutput(ro)
                recordingOutput = ro
                hasVideoOutput = true
                fputs("[swift] SCRecordingOutput added → \(videoFilePath)\n", stderr)
            }

            self.stream = captureStream
            isActive = true
            startChunk()
            try await captureStream.startCapture()
        } catch {
            fputs("[swift] start error: \(error)\n", stderr)
            emitError(id: jobId, message: "start: \(error.localizedDescription)")
        }
    }

    func stop(id: String) async {
        guard isActive else {
            emitRecordingStopped(id: id.isEmpty ? jobId : id, filePath: "", duration: 0)
            return
        }
        isActive = false
        if let s = stream {
            stream = nil
            try? await s.stopCapture()
        }
        finishChunk(isFinal: true)
    }

    // MARK: - Private

    private func startChunk() {
        lock.lock()
        defer { lock.unlock() }

        let path = outputDir.appendingPathComponent("chunk_\(chunkIndex).mp4")
        guard let w = try? AVAssetWriter(url: path, fileType: .mp4) else {
            emitError(id: jobId, message: "AVAssetWriter init failed for chunk \(chunkIndex)")
            return
        }

        // Audio-only: Whisper only needs audio for transcription.
        // On macOS 15, the VideoToolbox hardware encoder (H.264/HEVC) fails asynchronously
        // after startWriting() with kVTVideoEncoderMalfunctionErr (-16122), which puts the
        // entire AVAssetWriter into a failed state and causes all appends to fail.
        // Omitting the video input eliminates the VT session entirely.
        // SCRecordingOutput (macOS 15+) handles video recording independently.
        let ai = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 192_000,
        ])
        ai.expectsMediaDataInRealTime = true
        if w.canAdd(ai) { w.add(ai) }

        guard w.startWriting() else {
            emitError(id: jobId, message: "startWriting failed for chunk \(chunkIndex): \(w.error?.localizedDescription ?? "?")")
            return
        }

        writer = w
        audioInput = ai
        chunkStartPTS = .invalid
        sessionStarted = false
    }

    private func finishChunk(isFinal: Bool) {
        lock.lock()
        guard let w = writer, sessionStarted else {
            lock.unlock()
            if isFinal && !hasVideoOutput {
                emitRecordingStopped(id: jobId, filePath: "", duration: Double(chunkIndex) * chunkDuration)
            }
            return
        }

        let idx = chunkIndex
        let offset = Double(idx) * chunkDuration
        let path = w.outputURL.path

        audioInput?.markAsFinished()
        writer = nil
        audioInput = nil
        sessionStarted = false
        if !isFinal { chunkIndex += 1 }
        lock.unlock()

        w.finishWriting { [weak self] in
            guard let self else { return }
            guard w.status == .completed else {
                emitError(id: self.jobId,
                    message: "chunk \(idx): \(w.error?.localizedDescription ?? "write failed")")
                return
            }
            emitChunkReady(id: self.jobId, path: path, offset: offset, index: idx)
            if !isFinal {
                self.startChunk()
            } else if !self.hasVideoOutput {
                // SCRecordingOutput delegate will emit recording_stopped with the video file path.
                // Only emit here (audio-only path) when no video output is active.
                emitRecordingStopped(id: self.jobId, filePath: "", duration: offset + self.chunkDuration)
            }
        }
    }

    func handleVideo(_ buffer: CMSampleBuffer) {
        guard isActive, CMSampleBufferDataIsReady(buffer) else { return }
        lock.lock()
        guard let w = writer else { lock.unlock(); return }

        let pts = CMSampleBufferGetPresentationTimeStamp(buffer)

        if !sessionStarted {
            w.startSession(atSourceTime: pts)
            chunkStartPTS = pts
            sessionStarted = true
        }

        let elapsed = CMTimeGetSeconds(CMTimeSubtract(pts, chunkStartPTS))
        if elapsed >= chunkDuration {
            lock.unlock()
            finishChunk(isFinal: false)
            return
        }
        // Video frames are used only for timing — not written (audio-only chunk mode).
        lock.unlock()
    }

    func handleAudio(_ buffer: CMSampleBuffer) {
        guard isActive, CMSampleBufferDataIsReady(buffer) else { return }
        lock.lock()
        if sessionStarted, audioInput?.isReadyForMoreMediaData == true {
            let audioPTS = CMSampleBufferGetPresentationTimeStamp(buffer)
            if CMTimeCompare(audioPTS, chunkStartPTS) >= 0 {
                audioInput?.append(buffer)
            }
        }
        lock.unlock()
    }
}

// MARK: - SCRecordingOutputDelegate (macOS 15+)

@available(macOS 15.0, *)
extension Recorder: SCRecordingOutputDelegate {
    func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        fputs("[swift] video recording started\n", stderr)
    }

    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        let duration = CMTimeGetSeconds(recordingOutput.recordedDuration)
        fputs("[swift] video recording finished → \(videoFilePath) (\(duration)s)\n", stderr)
        emitRecordingStopped(id: jobId, filePath: videoFilePath, duration: duration)
        self.recordingOutput = nil
        hasVideoOutput = false
    }

    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: any Error) {
        fputs("[swift] video recording error: \(error)\n", stderr)
        // Fall back to audio-only behavior: let finishChunk emit recording_stopped
        hasVideoOutput = false
        self.recordingOutput = nil
    }
}

// MARK: - Stream output handlers

@available(macOS 13.0, *)
private final class VideoHandler: NSObject, SCStreamOutput {
    weak var recorder: Recorder?
    init(recorder: Recorder) { self.recorder = recorder }
    func stream(_ s: SCStream, didOutputSampleBuffer buf: CMSampleBuffer, of t: SCStreamOutputType) {
        recorder?.handleVideo(buf)
    }
}

@available(macOS 13.0, *)
private final class AudioHandler: NSObject, SCStreamOutput {
    weak var recorder: Recorder?
    init(recorder: Recorder) { self.recorder = recorder }
    func stream(_ s: SCStream, didOutputSampleBuffer buf: CMSampleBuffer, of t: SCStreamOutputType) {
        recorder?.handleAudio(buf)
    }
}
