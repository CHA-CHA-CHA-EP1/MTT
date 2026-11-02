import CoreGraphics
import Foundation
import ImageIO

func listWindows() async {
    // CGWindowListCopyWindowInfo does not require Screen Recording permission —
    // it only returns metadata (title, app, ID), not pixel content.
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        emitError(id: "", message: "list_windows: CGWindowListCopyWindowInfo failed")
        return
    }

    var seen = Set<UInt32>()
    var windows: [WindowInfo] = []

    for info in list {
        guard
            let windowID   = info[kCGWindowNumber as String] as? UInt32,
            let ownerName  = info[kCGWindowOwnerName as String] as? String,
            let windowName = info[kCGWindowName as String] as? String,
            !windowName.isEmpty,
            !seen.contains(windowID)
        else { continue }
        seen.insert(windowID)
        windows.append(WindowInfo(id: windowID, title: windowName, app: ownerName))
    }

    emitWindows(windows)
}

func captureWindowScreenshot(windowId: UInt32) -> String? {
    guard let image = CGWindowListCreateImage(
        .null,
        .optionIncludingWindow,
        windowId,
        [.boundsIgnoreFraming, .bestResolution]
    ) else { return nil }

    let tempPath = NSTemporaryDirectory() + "mtt-preview-\(windowId).png"
    let url = URL(fileURLWithPath: tempPath)

    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return tempPath
}
