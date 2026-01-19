// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StackAuth",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
        .watchOS(.v8),
        .tvOS(.v15),
        .visionOS(.v1)
    ],
    products: [
        .library(
            name: "StackAuth",
            targets: ["StackAuth"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "StackAuth",
            dependencies: [],
            path: "Sources/StackAuth"
        ),
        .testTarget(
            name: "StackAuthTests",
            dependencies: ["StackAuth"],
            path: "Tests/StackAuthTests"
        ),
    ]
)
