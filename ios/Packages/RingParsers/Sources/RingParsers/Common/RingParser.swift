import Foundation

/// Common protocol for vendor-specific BLE packet parsers.
///
/// **Hard rule**: a parser of one vendor MUST NEVER be invoked with packets from
/// another vendor. The dispatcher in the Capacitor plugin chooses one parser at
/// `connect()` time based on the GATT service UUIDs / advertised name, and that
/// choice is locked for the session.
///
/// Parsers are pure functions of input bytes (+ tiny mutable state for multi-packet
/// streams like HR history). They never touch BLE, network, or persistence.
public protocol RingParser: AnyObject {
    /// Vendor identifier — must match the schema name in `vendors_raw.{vendor}_packets`.
    static var vendor: String { get }
    /// Increment this when parser logic changes; persisted alongside packets for replay/audit.
    static var parserVersion: String { get }

    /// Parse a single notification packet. `channel` distinguishes V1 (16-byte
    /// commands) from V2 (big-data assembled chunks) and other transports.
    func parse(bytes: [UInt8], channel: PacketChannel, nowMs: Int64) -> ParseResult

    /// Reset any cross-packet state (e.g. before a new sync session).
    func reset()
}

public enum PacketChannel: String, Codable, Sendable {
    case v1
    case v2
    case realtime
    case notify
    case write
}

/// Hex-string utilities. Used by tests + raw-packet ingestion to keep a fully
/// reproducible record of bytes.
public enum HexBytes {
    /// Parse "37 88 00 ..." or "378800..." into [UInt8]. Whitespace tolerant.
    public static func parse(_ hex: String) -> [UInt8] {
        let cleaned = hex.unicodeScalars.filter { CharacterSet.whitespacesAndNewlines.inverted.contains($0) }
        let str = String(String.UnicodeScalarView(cleaned))
        guard str.count % 2 == 0 else { return [] }
        var out: [UInt8] = []
        out.reserveCapacity(str.count / 2)
        var idx = str.startIndex
        while idx < str.endIndex {
            let next = str.index(idx, offsetBy: 2)
            guard let byte = UInt8(str[idx..<next], radix: 16) else { return [] }
            out.append(byte)
            idx = next
        }
        return out
    }

    public static func format(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02X", $0) }.joined(separator: " ")
    }
}
