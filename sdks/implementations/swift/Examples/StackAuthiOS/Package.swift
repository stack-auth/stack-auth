// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StackAuthiOS",
    platforms: [
        .iOS(.v17)
    ],
    dependencies: [
        .package(name: "StackAuth", path: "../..")
    ],
    targets: [
        .executableTarget(
            name: "StackAuthiOS",
            dependencies: [
                .product(name: "StackAuth", package: "StackAuth")
            ],
            path: "StackAuthiOS"
        )
    ]
)
