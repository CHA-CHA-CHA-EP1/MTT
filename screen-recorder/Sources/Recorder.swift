import AVFoundation
import ScreenCaptureKit
import CoreMedia

@available(macOS 13.0, *)
final class Recorder: NSObject {
    private let lock = NSLock()
    private var stream: SCStream?

    // chunk writer state (guarded by lock)
    private var writer: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
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

        do {
            try FileManager.default.createDirectory(
                at: self.outputDir, withIntermediateDirectories: true, attributes: nil)

            let content = try await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: true)
            guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
                emitError(id: jobId, message: "Window \(windowId) not found")
                return
            }

            videoWidth = min(1920, max(640, Int(window.frame.width)))
            videoHeight = min(1080, max(360, Int(window.frame.height)))

            let config = SCStreamConfiguration()
            config.width = videoWidth
            config.height = videoHeight
            config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            config.capturesAudio = true
            config.sampleRate = 16_000
            config.channelCount = 1

            let filter = SCContentFilter(desktopIndependentWindow: window)
            let captureStream = SCStream(filter: filter, configuration: config, delegate: nil)

            try captureStream.addStreamOutput(
                VideoHandler(recorder: self), type: .screen,
                sampleHandlerQueue: DispatchQueue(label: "mtt.video"))
            try captureStream.addStreamOutput(
                AudioHandler(recorder: self), type: .audio,
                sampleHandlerQueue: DispatchQueue(label: "mtt.audio"))

            self.stream = captureStream
            isActive = true
            startChunk()
            try await captureStream.startCapture()
        } catch {
            emitError(id: jobId, message: "start: \(error.localizedDescription)")
        }
    }

    func stop() async {
        guard isActive else { return }
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

        let vi = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: videoWidth,
            AVVideoHeightKey: videoHeight,
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 2_000_000],
        ])
        vi.expectsMediaDataInRealTime = true

        let ai = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
        ])
        ai.expectsMediaDataInRealTime = true

        if w.canAdd(vi) { w.add(vi) }
        if w.canAdd(ai) { w.add(ai) }

        writer = w
        videoInput = vi
        audioInput = ai
        chunkStartPTS = .invalid
        sessionStarted = false
    }

    private func finishChunk(isFinal: Bool) {
        lock.lock()
        guard let w = writer, sessionStarted else {
            lock.unlock()
            if isFinal {
                emitRecordingStopped(id: jobId, duration: Double(chunkIndex) * chunkDuration)
            }
            return
        }

        let idx = chunkIndex
        let offset = Double(idx) * chunkDuration
        let path = w.outputURL.path

        videoInput?.markAsFinished()
        audioInput?.markAsFinished()
        writer = nil
        videoInput = nil
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
            } else {
                emitRecordingStopped(id: self.jobId, duration: offset + self.chunkDuration)
            }
        }
    }

    func handleVideo(_ buffer: CMSampleBuffer) {
        guard isActive, CMSampleBufferDataIsReady(buffer) else { return }
        lock.lock()
        guard let w = writer else { lock.unlock(); return }

        let pts = CMSampleBufferGetPresentationTimeStamp(buffer)

        if !sessionStarted {
            w.startWriting()
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

        if videoInput?.isReadyForMoreMediaData == true {
            videoInput?.append(buffer)
        }
        lock.unlock()
    }

    func handleAudio(_ buffer: CMSampleBuffer) {
        guard isActive, CMSampleBufferDataIsReady(buffer) else { return }
        lock.lock()
        if sessionStarted, audioInput?.isReadyForMoreMediaData == true {
            audioInput?.append(buffer)
        }
        lock.unlock()
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
