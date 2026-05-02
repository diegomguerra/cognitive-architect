import Foundation

public enum RingVendor: String, Codable, Sendable {
    case colmi
    case jstyle
    case unknown
}

/// Identifies the ring vendor from advertised data, then locks in a parser
/// for the whole session. Called once at `connect()` time by the BLE layer.
///
/// Detection signals (in priority order):
///  1. Primary GATT service UUID — JStyle = `FFF0`, Colmi = `6E400001-...`
///  2. Advertised local name — `JStyle*`, `R09*`, `R02*`, `Colmi*`, etc.
///
/// **Once detected, the choice is final**. Mid-session re-detection is not
/// supported — disconnect + reconnect to switch parser.
public final class RingDispatcher {
    public let vendor: RingVendor
    public let parser: RingParser

    public init(vendor: RingVendor) {
        self.vendor = vendor
        switch vendor {
        case .jstyle: self.parser = JStyleParser()
        case .colmi:  self.parser = ColmiParser()
        case .unknown: self.parser = JStyleParser() // safe default — will return unrecognized
        }
    }

    public static func detect(serviceUUIDs: [String], localName: String?) -> RingVendor {
        let uuids = serviceUUIDs.map { $0.uppercased() }
        if uuids.contains(where: { $0.hasPrefix("FFF0") || $0 == "FFF0" }) { return .jstyle }
        if uuids.contains(where: { $0.contains("6E400001") }) { return .colmi }
        if let n = localName?.uppercased() {
            if n.hasPrefix("JSTYLE") || n.contains("JC") { return .jstyle }
            if n.hasPrefix("R09") || n.hasPrefix("R02") || n.contains("COLMI") { return .colmi }
        }
        return .unknown
    }
}
