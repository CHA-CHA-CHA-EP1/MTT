import ScreenCaptureKit

func listWindows() async {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let windows: [WindowInfo] = content.windows.compactMap { w in
            guard let title = w.title, !title.isEmpty else { return nil }
            return WindowInfo(
                id: w.windowID,
                title: title,
                app: w.owningApplication?.applicationName ?? "Unknown"
            )
        }
        emitWindows(windows)
    } catch {
        emitError(id: "", message: "list_windows: \(error.localizedDescription)")
    }
}
