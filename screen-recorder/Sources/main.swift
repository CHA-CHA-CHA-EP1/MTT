import Foundation

if #available(macOS 13.0, *) {
    Task {
        var recorder: Recorder? = nil
        var startTask: Task<Void, Never>? = nil

        for try await line in FileHandle.standardInput.bytes.lines {
            guard let data = line.data(using: .utf8),
                  let msg = try? JSONDecoder().decode(IncomingMessage.self, from: data) else {
                continue
            }

            switch msg {
            case .listWindows:
                await listWindows()

            case .start(let id, let windowId, let chunkDuration, let outputDir):
                let rec = Recorder()
                recorder = rec
                startTask = Task {
                    await rec.start(
                        jobId: id, windowId: windowId,
                        chunkDuration: chunkDuration, outputDir: outputDir)
                }

            case .screenshot(let windowId):
                if let path = captureWindowScreenshot(windowId: windowId) {
                    emitScreenshot(path: path)
                } else {
                    emitError(id: "", message: "Failed to capture screenshot for window \(windowId)")
                }

            case .stop(let id):
                if let rec = recorder {
                    // Cancel the start task if still in-flight, then wait for it to fully exit
                    // before calling stop — eliminates the isActive race condition.
                    startTask?.cancel()
                    await startTask?.value
                    startTask = nil
                    recorder = nil
                    await rec.stop(id: id)
                } else {
                    // Recording already stopped (or never started) — emit stopped so the
                    // frontend can reset its state instead of staying stuck on "Recording".
                    emitRecordingStopped(id: id, filePath: "", duration: 0)
                }
            }
        }
        exit(0)
    }
    // RunLoop keeps the main thread alive without blocking Swift Concurrency's executor.
    // (DispatchSemaphore.wait() on the main thread causes a deadlock in Swift 6.)
    RunLoop.main.run()
} else {
    fputs("{\"type\":\"error\",\"id\":\"\",\"message\":\"macOS 13.0+ required\"}\n", stdout)
    fflush(stdout)
}
