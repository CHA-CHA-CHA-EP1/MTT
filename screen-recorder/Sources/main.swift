import Foundation

let sema = DispatchSemaphore(value: 0)

if #available(macOS 13.0, *) {
    Task {
        var recorder: Recorder? = nil

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
                Task {
                    await rec.start(
                        jobId: id, windowId: windowId,
                        chunkDuration: chunkDuration, outputDir: outputDir)
                }

            case .stop(let id):
                if let rec = recorder {
                    recorder = nil
                    await rec.stop()
                } else {
                    emitError(id: id, message: "no active recording")
                }
            }
        }
        sema.signal()
    }
    sema.wait()
} else {
    print(#"{"type":"error","id":"","message":"macOS 13.0+ required"}"#)
    fflush(stdout)
}
