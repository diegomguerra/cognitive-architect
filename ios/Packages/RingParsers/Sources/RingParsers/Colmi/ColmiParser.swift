import Foundation

/// Parser for Colmi R02/R09-class rings (GATT 6E40 service).
///
/// Currently a stub — the legacy Colmi parsing logic still lives in
/// `QRingPlugin.swift`. This will be extracted in a follow-up pass once we
/// have a Colmi-vendor user with captured fixtures. The placeholder keeps the
/// dispatcher symmetric and ensures the interface is exercised by tests.
///
/// **DO NOT CALL FROM JSTYLE PATHS.** The dispatcher is responsible for
/// vendor selection at `connect()` time.
public final class ColmiParser: RingParser {
    public static let vendor = "colmi"
    public static let parserVersion = "colmi-stub-0.1.0"

    public init() {}
    public func reset() {}

    public func parse(bytes: [UInt8], channel: PacketChannel, nowMs: Int64) -> ParseResult {
        ParseResult(unrecognized: ["colmi-parser-stub"])
    }
}
