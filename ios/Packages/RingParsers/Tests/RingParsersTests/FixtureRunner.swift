import Foundation
import XCTest
@testable import RingParsers

/// Loads JSON fixtures and runs them through a parser, asserting the captured
/// `expected` constraints. Acts as the regression-suite spine — every parser
/// change must keep all fixtures green.
struct Fixture: Decodable {
    let fixture_name: String
    let vendor: String
    let session_start_iso: String
    let expected: ExpectedSpec
    let packets: [Packet]

    struct Packet: Decodable {
        let ts_offset_ms: Int64
        let channel: String
        let raw_hex: String
    }

    struct ExpectedSpec: Decodable {
        let hr: TypeSpec?
        let rr_interval: TypeSpec?
        let hrv: TypeSpec?
        let spo2: TypeSpec?
        let stress: TypeSpec?
        let temp: TypeSpec?
        let hr_history: TypeSpec?
        let spo2_history: TypeSpec?
        let hrv_history: TypeSpec?
    }

    struct TypeSpec: Decodable {
        let min_count: Int?
        let max_count: Int?
        let value_range: [Double]?
        let value_range_bpm: [Double]?
        let value_range_ms: [Double]?
        let value_range_celsius: [Double]?
        let all_mode: String?
        let comment: String?

        var range: ClosedRange<Double>? {
            let r = value_range ?? value_range_bpm ?? value_range_ms ?? value_range_celsius
            guard let r, r.count == 2 else { return nil }
            return r[0]...r[1]
        }
    }
}

enum FixtureLoader {
    static func load(_ path: String) throws -> Fixture {
        guard let url = Bundle.module.url(forResource: path, withExtension: "json", subdirectory: "Fixtures") else {
            // Fallback to walking the resources bundle directly
            let candidates = Bundle.module.urls(forResourcesWithExtension: "json", subdirectory: nil) ?? []
            for c in candidates where c.path.contains(path) {
                return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: c))
            }
            throw NSError(domain: "FixtureLoader", code: 404,
                          userInfo: [NSLocalizedDescriptionKey: "Fixture not found: \(path)"])
        }
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    static func discover(in subdir: String) -> [URL] {
        let urls = Bundle.module.urls(forResourcesWithExtension: "json", subdirectory: subdir) ?? []
        return urls.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
}

extension XCTestCase {
    /// Replay all packets through `parser` and validate against `fixture.expected`.
    func runFixture(_ fixture: Fixture, parser: RingParser, file: StaticString = #filePath, line: UInt = #line) {
        parser.reset()
        var all = ParseResult()
        let baseMs: Int64 = 1730000000_000 // arbitrary fixed epoch for determinism

        for pkt in fixture.packets {
            let bytes = HexBytes.parse(pkt.raw_hex)
            XCTAssertFalse(bytes.isEmpty, "[\(fixture.fixture_name)] failed to parse hex: \(pkt.raw_hex)", file: file, line: line)
            let channel = PacketChannel(rawValue: pkt.channel) ?? .v1
            let result = parser.parse(bytes: bytes, channel: channel, nowMs: baseMs + pkt.ts_offset_ms)
            all = all.merging(result)
        }

        check(fixture: fixture, type: .hr, spec: fixture.expected.hr, in: all, file: file, line: line)
        check(fixture: fixture, type: .rr_interval, spec: fixture.expected.rr_interval, in: all, file: file, line: line)
        check(fixture: fixture, type: .hrv, spec: fixture.expected.hrv, in: all, file: file, line: line)
        check(fixture: fixture, type: .spo2, spec: fixture.expected.spo2, in: all, file: file, line: line)
        check(fixture: fixture, type: .stress, spec: fixture.expected.stress, in: all, file: file, line: line)
        check(fixture: fixture, type: .temp, spec: fixture.expected.temp, in: all, file: file, line: line)

        // History-only constraints — all of these MUST be 0 for JStyle. We assert
        // by checking the count of `.history`-mode samples of each type.
        if let hh = fixture.expected.hr_history, let max = hh.max_count {
            let n = all.samples(of: .hr).filter { $0.mode == .history }.count
            XCTAssertLessThanOrEqual(n, max,
                "[\(fixture.fixture_name)] HR history samples exceed max (\(max)): got \(n) — \(hh.comment ?? "")",
                file: file, line: line)
        }
        if let sh = fixture.expected.spo2_history, let max = sh.max_count {
            let n = all.samples(of: .spo2).filter { $0.mode == .history }.count
            XCTAssertLessThanOrEqual(n, max, "[\(fixture.fixture_name)] SpO2 history samples exceed max", file: file, line: line)
        }
        if let vh = fixture.expected.hrv_history, let max = vh.max_count {
            let n = all.samples(of: .hrv).filter { $0.mode == .history }.count
            XCTAssertLessThanOrEqual(n, max, "[\(fixture.fixture_name)] HRV history samples exceed max", file: file, line: line)
        }
    }

    private func check(fixture: Fixture, type: SampleType, spec: Fixture.TypeSpec?, in result: ParseResult,
                       file: StaticString, line: UInt) {
        guard let spec else { return }
        let samples = result.samples(of: type)
        let n = samples.count

        if let min = spec.min_count {
            XCTAssertGreaterThanOrEqual(n, min,
                "[\(fixture.fixture_name)] \(type.rawValue) count \(n) < min \(min). \(spec.comment ?? "")",
                file: file, line: line)
        }
        if let max = spec.max_count {
            XCTAssertLessThanOrEqual(n, max,
                "[\(fixture.fixture_name)] \(type.rawValue) count \(n) > max \(max). \(spec.comment ?? "")",
                file: file, line: line)
        }
        if let range = spec.range {
            for s in samples {
                XCTAssertTrue(range.contains(s.value),
                    "[\(fixture.fixture_name)] \(type.rawValue) value \(s.value) outside \(range). \(spec.comment ?? "")",
                    file: file, line: line)
            }
        }
        if let mode = spec.all_mode {
            for s in samples {
                XCTAssertEqual(s.mode.rawValue, mode,
                    "[\(fixture.fixture_name)] \(type.rawValue) sample mode \(s.mode.rawValue) != expected \(mode)",
                    file: file, line: line)
            }
        }
    }
}
