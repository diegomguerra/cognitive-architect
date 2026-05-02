import Foundation

/// Parser for JStyle X3/X5-class rings (GATT FFF0/FFF6/FFF7).
///
/// **Allowed inputs only**:
/// - V1 packets (16 bytes): `0x69` realtime HR/RR, `0x37 0x88` stress stream,
///   `0x37 0x99` initial stress, `0x37 0xEA` stress end marker, `0xBC 0x25 ...`
///   small V2 acks.
/// - V2 packets (assembled big-data): `0xBC 0x25 ...` temperature payload.
///
/// **Explicitly ignored**: `0x15` (HR history), `0x2C` (SpO2 history),
/// `0x39` (HRV history), `0x16`, `0x3A`, `0x2F`, `0x01`, `0x03` — JStyle responds
/// to these CMDs with ack/error stubs that DO NOT contain data. Letting
/// Colmi-shaped parsers run on them produces garbage (HR=242 etc.) — we observed
/// 54 bogus HR samples on user lilidoces@icloud.com from this exact bug.
///
/// Pure logic, no BLE / no I/O. Cross-packet state limited to the realtime RR
/// rolling window for HRV/stress derivation.
public final class JStyleParser: RingParser {
    public static let vendor = "jstyle"
    public static let parserVersion = "jstyle-1.0.0"

    // Rolling RR window for derived HRV/stress (RMSSD over the realtime burst).
    private var rrWindowMs: [Int] = []
    private static let rrWindowCap = 64

    public init() {}

    public func reset() {
        rrWindowMs.removeAll(keepingCapacity: true)
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
        switch cmd {
        case 0x69: return parseRealtime(b, nowMs: nowMs)
        case 0x37: return parseStress(b, nowMs: nowMs)
        // Explicitly recognized as not-data — silent no-op:
        case 0x01, 0x03, 0x15, 0x16, 0x2C, 0x2F, 0x39, 0x3A:
            return ParseResult(unrecognized: ["jstyle-v1-cmd-\(String(format: "0x%02X", cmd))-not-data"])
        case 0xBC: return parseV2(b, nowMs: nowMs) // tiny BC ack arrives on V1 sometimes
        default:
            return ParseResult(unrecognized: ["jstyle-v1-cmd-\(String(format: "0x%02X", cmd))"])
        }
    }

    /// Realtime CMD 0x69 — verified layout (Lídia 2026-05-01 session, 51 packets):
    ///   [0]=0x69 [1]=type [2]=err [3]=HR_BPM_R09 [4-5]=? [6-7]=RR LE16 ms
    ///   [8-14]=? [15]=cks
    ///
    /// JStyle rings observed in production never fill b[3] — always 0. HR is
    /// derived from RR (`HR = round(60000/rr_ms)`) when RR is in physiological range.
    /// We also emit the rr_interval sample directly (used for HRV/stress derivation).
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
            rrWindowMs.append(rrMs)
            if rrWindowMs.count > Self.rrWindowCap {
                rrWindowMs.removeFirst(rrWindowMs.count - Self.rrWindowCap)
            }
        }

        let hrR09 = Int(b[3])
        let hrR02 = Int(b[2])
        let hr: Int?
        if (30...220).contains(hrR09) { hr = hrR09 }
        else if (30...220).contains(hrR02) { hr = hrR02 }
        else if rrValid { hr = Int((60000.0 / Double(rrMs)).rounded()) }
        else { hr = nil }

        if let hr {
            samples.append(Sample(
                type: .hr, value: Double(hr), timestampMs: nowMs,
                mode: .realtime,
                metadata: ["rr_ms": String(rrValid ? rrMs : 0), "byte2": String(b[2]), "byte3": String(b[3])]
            ))
        }
        return ParseResult(samples: samples)
    }

    /// CMD 0x37 family. Sub-type at b[1] disambiguates.
    private func parseStress(_ b: [UInt8], nowMs: Int64) -> ParseResult {
        guard b.count >= 2 else { return ParseResult() }
        switch b[1] {
        case 0x88: return parseStressStream(b, nowMs: nowMs)
        case 0x99: return parseInitialStress(b, nowMs: nowMs)
        case 0xEA, 0xFF: return ParseResult() // end / no-data marker
        case 0x02, 0x13: return ParseResult(unrecognized: ["jstyle-0x37-sub-\(String(format: "0x%02X", b[1]))-ack"])
        default:
            return ParseResult(unrecognized: ["jstyle-0x37-sub-\(String(format: "0x%02X", b[1]))"])
        }
    }

    /// Streaming stress: `37 88 00 [counter] 01 [stress] 00 00 00 00 88 01 00 00 00 [cks]`
    ///
    /// **Verified bug fix**: previous parser also emitted a HR sample reading
    /// `b[10]` — but that byte is a constant 0x88 (the same as b[1], a JStyle
    /// product/header marker), NOT heart rate. This produced HR=136 spammed
    /// for Diego across 51 samples on 2026-05-01. **HR is NOT in this packet.**
    private func parseStressStream(_ b: [UInt8], nowMs: Int64) -> ParseResult {
        guard b.count >= 6 else { return ParseResult() }
        let stress = Int(b[5])
        guard (1...200).contains(stress) else { return ParseResult() }
        let counter = b.count > 3 ? Int(b[3]) : 0
        return ParseResult(samples: [
            Sample(
                type: .stress, value: Double(stress), timestampMs: nowMs,
                mode: .streaming,
                metadata: ["counter": String(counter), "source": "jstyle_stress_stream"]
            )
        ])
    }

    /// Initial stress reading: `37 99 [b2] [b3] 01 [stress] 00 [b7] 00...`
    /// Bytes 2-3 and 7 are unknown without vendor docs — captured in metadata
    /// for forensic analysis but never emitted as samples.
    private func parseInitialStress(_ b: [UInt8], nowMs: Int64) -> ParseResult {
        guard b.count >= 6 else { return ParseResult() }
        let stress = Int(b[5])
        guard (1...200).contains(stress) else { return ParseResult() }
        return ParseResult(samples: [
            Sample(
                type: .stress, value: Double(stress), timestampMs: nowMs,
                mode: .initial,
                metadata: [
                    "byte2": String(b[2]),
                    "byte3": String(b[3]),
                    "byte7": String(b.count > 7 ? b[7] : 0),
                    "source": "jstyle_initial"
                ]
            )
        ])
    }

    // MARK: - V2 big-data (assembled multi-packet payloads)

    /// CMD 0xBC 0x25 — temperature history. Layout:
    ///   `BC 25 <len_lo> <len_hi> <?> <?>` (6-byte header)
    ///   then repeating day blocks: `[days_ago] [0x1E sep] [48 half-hour bytes]`
    ///   `temp_c = (unsigned_byte / 10.0) + 20.0`, 0 = no sample.
    ///
    /// Returns samples timestamped at `nowMs - days_ago_days + slot*30min` so
    /// fixtures are deterministic without needing a real Date dependency.
    private func parseV2(_ b: [UInt8], nowMs: Int64) -> ParseResult {
        guard b.count >= 6, b[0] == 0xBC, b[1] == 0x25 else {
            return ParseResult(unrecognized: ["jstyle-v2-not-bc25"])
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
            if idx < b.count { idx += 1 } // separator (should be 0x1E)
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

    // MARK: - Derived metrics (call after a realtime burst completes)

    /// Compute RMSSD from accumulated RR window. Returns nil if window too short.
    public func deriveHRV(nowMs: Int64) -> Sample? {
        guard rrWindowMs.count >= 5 else { return nil }
        var sumSq = 0.0
        for i in 1..<rrWindowMs.count {
            let d = Double(rrWindowMs[i] - rrWindowMs[i - 1])
            sumSq += d * d
        }
        let rmssd = sqrt(sumSq / Double(rrWindowMs.count - 1))
        return Sample(
            type: .hrv, value: rmssd, timestampMs: nowMs,
            mode: .derived,
            metadata: ["method": "rmssd_from_rr", "rr_count": String(rrWindowMs.count)]
        )
    }

    /// Stress proxy: inverse RMSSD scaled to 0-100. Higher RMSSD = lower stress.
    public func deriveStress(nowMs: Int64) -> Sample? {
        guard let hrv = deriveHRV(nowMs: nowMs) else { return nil }
        let stress = max(0.0, min(100.0, 100.0 - hrv.value * 1.35))
        return Sample(
            type: .stress, value: stress.rounded(), timestampMs: nowMs,
            mode: .derived,
            metadata: ["method": "rmssd_inverse", "rmssd": String(format: "%.1f", hrv.value),
                       "rr_count": String(rrWindowMs.count)]
        )
    }
}
