// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "ScreenRecorder",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "screen-recorder",
            path: "Sources"
        )
    ]
)
