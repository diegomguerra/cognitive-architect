// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RingParsers",
    platforms: [.iOS(.v13), .macOS(.v12)],
    products: [
        .library(name: "RingParsers", targets: ["RingParsers"])
    ],
    targets: [
        .target(
            name: "RingParsers",
            path: "Sources/RingParsers"
        ),
        .testTarget(
            name: "RingParsersTests",
            dependencies: ["RingParsers"],
            path: "Tests/RingParsersTests",
            resources: [.copy("Fixtures")]
        )
    ]
)
