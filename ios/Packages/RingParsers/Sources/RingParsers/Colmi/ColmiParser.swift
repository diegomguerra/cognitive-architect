import Foundation

/// Parser for Colmi R02/R03/R06/R09 rings (sold as "QRing").
/// GATT service `6E40FFF0` Nordic-UART-like, 16-byte fixed packets with checksum at b[15].
///
/// Protocol source of truth (public reverse engineering — NOT vendor-supplied):
/// - colmi.puxtril.com — canonical command table
/// - Gadgetbridge PR #3896 — Java reference (GPL, algorithms only)
/// - tahnok/colmi_r02_client — Python reference
/// - smittytone/RingCLI — Go reference (sleep + SpO2)
///
/// **R09-specific findings** (from Daniele Faconi's debug_raw corpus 2026-04-14 to 2026-05-02):
/// - CMD 0x69 realtime: value at bytes[6-7] LE16 (NOT byte[2] as old R02 docs suggested).
///   For type=01 (HR), bytes[6-7] = RR interval in ms. Convert: `bpm = 60000 / rr_ms`.
/// - History sentinels: ring responds with `<CMD> FF 00 00 ... <cks>` when storage is empty
///   (typically because official QRing app drained it). Parser must NOT emit samples.
/// - Steps history (CMD 0x43): cumulative LE16 total at bytes[3-4], slot index at bytes[5-6],
///   then 0x81 tag at b[7], calories LE16 at b[8-9], distance LE16 at b[10-11].
/// - V2 temperature (CMD 0xBC 0x25): same format as JStyle — `temp_c = (byte/10)+20`.
public final class ColmiParser: RingParser {
    public static let vendor = "colmi"
    public static let parserVersion = "colmi-1.0.0"

    // Multi-packet HR history accumulator (CMD 0x15)
    private var hrDayEpochSec: TimeInterval = 0
    private var hrIntervalMinutes: Int = 5
    private var hrExpectedPackets: Int = 0
    private var hrReceivedPackets: Int = 0

    public init() {}

    public func reset() {
        hrDayEpochSec = 0
        hrIntervalMinutes = 5
        hrExpectedPackets = 0
        hrReceivedPackets = 0
    }

    public func parse(bytes b: [UInt8], channel: PacketChannel, nowMs: Int64) -> ParseResult {
        switch channel {
        case .v2: return parseV2(b, nowMs: nowMs)
        case .v1, .notify, .realtime: return parseV1(b, nowMs: nowMs)
        case .write: return ParseResult()
        }
    }

    // MARK: - V1 (16-byte command/notification packets)

    private func parseV1(_ b: [UInt8], nowMs: Int64) -> ParseResult {
        guard b.count >= 2 else { return ParseResult(errors: ["v1 too short: \(b.count) bytes"]) }
        let cmd = b[0]

        // Drain sentinel: `<CMD> FF 00 ...` means "no historical data" — silently skip
        if b[1] == 0xFF && (cmd == 0x15 || cmd == 0x37 || cmd == 0x39 || cmd == 0x44 || cmd == 0x2C) {
            return ParseResult(unrecognized: ["colmi-v1-cmd-\(String(format: "0x%02X", cmd))-no-data"])
        }
        // Special: 0x2C with all zeros after the cmd byte = no data variant
        if cmd == 0x2C && b.count >= 3 && b[1] == 0x00 && b[2] == 0x00 {
            return ParseResult(unrecognized: ["colmi-v1-cmd-0x2C-no-data"])
        }

        switch cmd {
        case 0x03: return parseBattery(b)
        case 0x15: return parseHrHistory(b)
        case 0x16: return ParseResult(unrecognized: ["colmi-v1-cmd-0x16-hr-settings-ack"])
        case 0x2C: return parseSpo2History(b)
        case 0x37: return parseStressHistory(b)
        case 0x39: return parseHrvHistory(b)
        case 0x43: return parseStepsHistory(b)
        case 0x44: return parseSleepHistory(b)
        case 0x69: return parseRealtime(b, nowMs: nowMs)
        case 0xBC: return parseV2(b, nowMs: nowMs) // small BC ack arrives on V1 sometimes
        default:
            return ParseResult(unrecognized: ["colmi-v1-cmd-\(String(format: "0x%02X", cmd))"])
        }
    }

    /// CMD 0x03 — Battery: b[1]=percent, b[2]=charging flag (0x01 charging)
    private func parseBattery(_ b: [UInt8]) -> ParseResult {
        guard b.count >= 3 else { return ParseResult() }
        // Battery is metadata, not a biomarker sample — surface via unrecognized for logging
        let pct = Int(b[1])
        let charging = b[2] == 0x01
        return ParseResult(unrecognized: ["colmi-battery-\(pct)pct-charging:\(charging)"])
    }

    /// CMD 0x69 — Realtime measurement.
    /// Layout (R09 verified from 553 debug_raw packets via Daniele 2026-04-27):
    ///   [0]=0x69 [1]=type (01=HR, 03=SpO2-channel-but-RR, 0A=HRV) [2]=err [3]=BPM_R02
    ///   [4-5]=? [6-7]=RR LE16 ms (R09 actual data) [8-14]=? [15]=cks
    /// HR derivation: prefer b[3] if in 30-220 (R02), else fallback b[2] (older R02),
    /// else compute from RR (R09 — most common in production).
    private func parseRealtime(_ b: [UInt8], nowMs: Int64) -> ParseResult {
        guard b.count >= 16 else { return ParseResult(errors: ["realtime short: \(b.count)"]) }
        var samples: [Sample] = []

        let rrMs = Int(b[6]) | (Int(b[7]) << 8)
        let rrValid = (300...2000).contains(rrMs)

        if rrValid {
            samples.append(Sample(
                type: .rr_interval, value: Double(rrMs), timestampMs: nowMs,
                mode: .realtime, metadata: ["metric": "rr_ms"]
            ))
        }

        let hrR02 = Int(b[3]); let hrR02Alt = Int(b[2])
        let hr: Int?
        if (30...220).contains(hrR02) { hr = hrR02 }
        else if (30...220).contains(hrR02Alt) { hr = hrR02Alt }
        else if rrValid { hr = Int((60000.0 / Double(rrMs)).rounded()) }
        else { hr = nil }  // warmup — both BPM bytes 0 and RR invalid → no sample

        if let hr {
            samples.append(Sample(
                type: .hr, value: Double(hr), timestampMs: nowMs,
                mode: .realtime,
                metadata: ["rr_ms": String(rrValid ? rrMs : 0), "type_byte": String(b[1])]
            ))
        }
        return ParseResult(samples: samples)
    }

    /// CMD 0x15 — HR History (Colmi multi-packet protocol).
    /// Packet 0 (subIdx=0): metadata — b[2]=total_data_packets, b[3]=interval_minutes
    /// Packet 1 (subIdx=1): b[2..5]=LE32 epoch, b[6..14]=first 9 HR values
    /// Packet N>=2: b[2..14]=13 HR values each
    /// Total: ~288 slots/day at 5-min intervals (9 + 22*13 = 295 capacity)
    private func parseHrHistory(_ b: [UInt8]) -> ParseResult {
        guard b.count >= 16 else { return ParseResult() }
        let subIdx = Int(b[1])

        if subIdx == 0 {
            hrExpectedPackets = Int(b[2])
            hrIntervalMinutes = Int(b[3])
            if !(1...120).contains(hrIntervalMinutes) { hrIntervalMinutes = 5 }
            hrReceivedPackets = 0
            return ParseResult(unrecognized: ["colmi-hr-history-meta-\(hrExpectedPackets)pkt-\(hrIntervalMinutes)min"])
        }

        var samples: [Sample] = []
        let startByte: Int
        let valuesPerFirstPacket = 9

        if subIdx == 1 {
            let epoch = UInt32(b[2]) | (UInt32(b[3]) << 8) | (UInt32(b[4]) << 16) | (UInt32(b[5]) << 24)
            if epoch > 0 { hrDayEpochSec = TimeInterval(epoch) }
            startByte = 6
        } else {
            startByte = 2
        }

        for i in startByte...14 {
            let v = Int(b[i])
            if v == 0 || !(30...220).contains(v) { continue }
            let slotInPkt = i - startByte
            let globalSlot = subIdx == 1
                ? slotInPkt
                : valuesPerFirstPacket + (subIdx - 2) * 13 + slotInPkt
            let tsSec = hrDayEpochSec + Double(globalSlot * hrIntervalMinutes * 60)
            samples.append(Sample(
                type: .hr, value: Double(v),
                timestampMs: Int64(tsSec * 1000),
                mode: .history,
                metadata: ["slot": String(globalSlot), "packet": String(subIdx)]
            ))
        }
        hrReceivedPackets += 1
        return ParseResult(samples: samples)
    }

    /// CMD 0x43 — Steps History (R09 layout, verified from Daniele 2026-04-27 corpus).
    /// Packet 0 (b[1]=0xF0): metadata header (number of data packets in b[2])
    /// Packet N (b[1]=0x00):
    ///   b[2]=0x03 (constant), b[3]=0x31 (constant tag)
    ///   b[3-4] LE16 = cumulative steps total
    ///   b[5] = slot/packet index (0..N-1, single byte)
    ///   b[6] = agg marker (constant, equals total packet count from metadata)
    ///   b[7] = 0x81 (constant tag), b[8-9] LE16 = calories raw, b[10-11] LE16 = distance raw
    private func parseStepsHistory(_ b: [UInt8]) -> ParseResult {
        guard b.count >= 12 else { return ParseResult() }
        // Metadata header: 43 F0 ... — no samples to emit
        if b[1] == 0xF0 {
            let pktCount = Int(b[2])
            return ParseResult(unrecognized: ["colmi-steps-history-meta-\(pktCount)pkt"])
        }
        // Data packet: b[1]=0x00 indicates data
        guard b[1] == 0x00 else { return ParseResult(unrecognized: ["colmi-steps-history-unknown-sub-\(String(format: "0x%02X", b[1]))"]) }
        let stepsTotal = Int(b[3]) | (Int(b[4]) << 8)
        let slotIdx = Int(b[5])           // single-byte slot 0..N-1
        let aggMarker = Int(b[6])         // constant, matches metadata packet count
        let calories = Int(b[8]) | (Int(b[9]) << 8)
        let distance = Int(b[10]) | (Int(b[11]) << 8)

        // Only emit if steps total looks plausible
        guard (0...100_000).contains(stepsTotal) else { return ParseResult() }

        return ParseResult(samples: [
            Sample(
                type: .steps, value: Double(stepsTotal), timestampMs: 0,  // ts derived from slot externally
                mode: .history,
                metadata: [
                    "slot": String(slotIdx),
                    "agg_marker": String(aggMarker),
                    "calories_raw": String(calories),
                    "distance_raw": String(distance)
                ]
            )
        ])
    }

    /// CMD 0x44 — Sleep History.
    /// Format: walks 4-byte windows for `[start_min_lo][start_min_hi][duration_min][stage]`
    /// Stage: 1=light, 2=deep, 3=REM, 4=awake.
    private func parseSleepHistory(_ b: [UInt8]) -> ParseResult {
        guard b.count >= 16 else { return ParseResult() }
        var samples: [Sample] = []
        // Walk 4-byte blocks starting at b[2]
        var idx = 2
        while idx + 3 < b.count {
            let startMin = Int(b[idx]) | (Int(b[idx + 1]) << 8)
            let durationMin = Int(b[idx + 2])
            let stage = Int(b[idx + 3])
            if stage >= 1 && stage <= 4 && durationMin > 0 && durationMin < 600 {
                samples.append(Sample(
                    type: .sleep, value: Double(stage), timestampMs: 0,
                    mode: .history,
                    metadata: [
                        "start_minutes": String(startMin),
                        "duration_minutes": String(durationMin),
                        "stage": ["1": "light", "2": "deep", "3": "rem", "4": "awake"][String(stage)] ?? "unknown"
                    ]
                ))
            }
            idx += 4
        }
        return ParseResult(samples: samples)
    }

    /// CMD 0x2C — SpO2 History (Colmi spec: byte[2]=value).
    private func parseSpo2History(_ b: [UInt8]) -> ParseResult {
        guard b.count >= 3 else { return ParseResult() }
        let v = Int(b[2])
        if (70...100).contains(v) {
            return ParseResult(samples: [
                Sample(type: .spo2, value: Double(v), timestampMs: 0,
                       mode: .history, metadata: [:])
            ])
        }
        return ParseResult()
    }

    /// CMD 0x37 — Stress History (Colmi spec: byte[2]=value, 1-100).
    private func parseStressHistory(_ b: [UInt8]) -> ParseResult {
        guard b.count >= 3 else { return ParseResult() }
        let v = Int(b[2])
        if (1...100).contains(v) {
            return ParseResult(samples: [
                Sample(type: .stress, value: Double(v), timestampMs: 0,
                       mode: .history, metadata: [:])
            ])
        }
        return ParseResult()
    }

    /// CMD 0x39 — HRV History (Colmi spec: byte[2]=value in ms; firmware 3.00.10+).
    private func parseHrvHistory(_ b: [UInt8]) -> ParseResult {
        guard b.count >= 3 else { return ParseResult() }
        let v = Int(b[2])
        if (5...250).contains(v) {
            return ParseResult(samples: [
                Sample(type: .hrv, value: Double(v), timestampMs: 0,
                       mode: .history, metadata: [:])
            ])
        }
        return ParseResult()
    }

    // MARK: - V2 big-data (assembled multi-packet payloads)

    /// CMD 0xBC 0x25 — V2 temperature. Same format as JStyle.
    /// Layout: `BC 25 <len_lo> <len_hi> <?> <?>` (6-byte header) +
    /// repeating day blocks `[days_ago][0x1E sep][48 half-hour bytes]`.
    /// `temp_c = (byte/10)+20`, 0=no sample.
    private func parseV2(_ b: [UInt8], nowMs: Int64) -> ParseResult {
        guard b.count >= 6, b[0] == 0xBC, b[1] == 0x25 else {
            return ParseResult(unrecognized: ["colmi-v2-not-bc25"])
        }
        let length = Int(b[2]) | (Int(b[3]) << 8)
        if length <= 4 { return ParseResult() } // tiny ack — no data
        var samples: [Sample] = []

        let dayMs: Int64 = 86_400_000
        let halfHourMs: Int64 = 30 * 60 * 1000
        let dayStartMs = (nowMs / dayMs) * dayMs

        var idx = 6
        while idx < b.count, idx - 6 < length {
            let daysAgo = Int(b[idx]); idx += 1
            if daysAgo == 0 && idx > 7 { break }
            if idx < b.count { idx += 1 } // separator (0x1E)
            let baseMs = dayStartMs - Int64(daysAgo) * dayMs
            for slot in 0..<48 {
                guard idx < b.count else { break }
                let raw = b[idx]; idx += 1
                if raw == 0 { continue }
                let celsius = (Double(raw) / 10.0) + 20.0
                guard (15.0...45.0).contains(celsius) else { continue }
                samples.append(Sample(
                    type: .temp, value: celsius,
                    timestampMs: baseMs + Int64(slot) * halfHourMs,
                    mode: .history,
                    metadata: ["slot": String(slot), "days_ago": String(daysAgo)]
                ))
            }
        }
        return ParseResult(samples: samples)
    }
}
