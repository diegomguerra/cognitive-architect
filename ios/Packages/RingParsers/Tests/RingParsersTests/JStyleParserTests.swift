import XCTest
@testable import RingParsers

final class JStyleParserTests: XCTestCase {

    // MARK: - Unit tests for individual packets

    func test_realtime_derives_hr_from_rr() {
        let p = JStyleParser()
        // RR LE16 at bytes [6][7] = 0x02FC = 764 ms → HR = round(60000/764) = 79
        let bytes = HexBytes.parse("69 01 00 00 00 00 FC 02 00 00 00 00 00 00 00 68")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        let hr = result.samples(of: .hr)
        let rr = result.samples(of: .rr_interval)
        XCTAssertEqual(hr.count, 1)
        XCTAssertEqual(hr.first?.value, 79)
        XCTAssertEqual(rr.count, 1)
        XCTAssertEqual(rr.first?.value, 764)
    }

    func test_stress_stream_does_NOT_emit_phantom_hr() {
        // The bug: previous parser read b[10]=0x88 as HR, producing HR=136
        // for every stress stream packet. Verify the new parser emits ZERO HR.
        let p = JStyleParser()
        let bytes = HexBytes.parse("37 88 00 11 01 4C 00 00 00 00 88 01 00 00 00 A6")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        XCTAssertEqual(result.samples(of: .hr).count, 0,
            "Stress stream packet must not produce HR samples — b[10]=0x88 is product header, not HR.")
        XCTAssertEqual(result.samples(of: .stress).count, 1)
        XCTAssertEqual(result.samples(of: .stress).first?.value, 76)
    }

    func test_initial_stress_extracts_b5() {
        let p = JStyleParser()
        let bytes = HexBytes.parse("37 99 42 B2 01 5F 00 19 00 00 00 00 00 00 00 3D")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        let s = result.samples(of: .stress)
        XCTAssertEqual(s.count, 1)
        XCTAssertEqual(s.first?.value, 95) // 0x5F
        XCTAssertEqual(s.first?.mode, .initial)
    }

    func test_v1_history_cmds_are_silently_ignored_NOT_parsed() {
        // These are the bytes that produced the 54 garbage HR samples for Lídia.
        // Parser must return ZERO samples — gate enforced by command whitelist.
        let p = JStyleParser()
        let badPackets = [
            "15 00 00 00 00 00 00 00 00 00 00 00 00 00 00 15", // 0x15 HR history ack
            "2C 02 01 1E 00 00 00 00 00 00 00 00 00 00 00 4D", // 0x2C SpO2 ack
            "39 00 00 00 00 00 00 00 00 00 00 00 00 00 00 39", // 0x39 HRV ack (synthetic — same shape)
            "16 02 01 00 00 00 00 00 00 00 00 00 00 00 00 19", // 0x16 ?
            "3A 03 02 01 00 00 00 00 00 00 00 00 00 00 00 40", // 0x3A ?
        ]
        for hex in badPackets {
            let result = p.parse(bytes: HexBytes.parse(hex), channel: .v1, nowMs: 0)
            XCTAssertEqual(result.samples.count, 0, "Bytes [\(hex)] must produce zero samples on JStyle.")
        }
    }

    func test_v2_temperature_decoding() {
        let p = JStyleParser()
        // Lídia 2026-04-30 captured payload.
        let hex = "BC 25 32 00 BB AE 00 1E 00 A2 A5 A3 A5 A7 AB A7 A6 A0 A0 A3 A6 A7 A8 A8 A7 A8 A8 A7 A9 A8 A9 A8 A9 A8 A8 A6 A7 A8 A9 A9 A9 A0 A1 00 A1 A1 A2 9F 9D 9D 9D 9E 9F 00 00 00"
        let result = p.parse(bytes: HexBytes.parse(hex), channel: .v2, nowMs: 1730000000_000)
        let temps = result.samples(of: .temp)
        XCTAssertGreaterThanOrEqual(temps.count, 30)
        for t in temps {
            XCTAssertGreaterThanOrEqual(t.value, 33.5)
            XCTAssertLessThanOrEqual(t.value, 38.0)
        }
        // Spot-check: 0xA2 = 162 → (162/10)+20 = 36.2°C
        XCTAssertEqual(temps.first?.value ?? 0, 36.2, accuracy: 0.05)
    }

    func test_v2_tiny_ack_no_data() {
        let p = JStyleParser()
        // BC 25 02 00 ... — length=2, just an ack with no day data.
        let result = p.parse(bytes: HexBytes.parse("BC 25 02 00 81 B8 00 1E"), channel: .v2, nowMs: 0)
        XCTAssertEqual(result.samples.count, 0)
    }

    // MARK: - Fixture-driven regression tests

    func test_fixture_lidia_realtime() throws {
        let f = try FixtureLoader.load("JStyle/lidia_realtime_2026-05-01")
        runFixture(f, parser: JStyleParser())
    }

    func test_fixture_diego_stress_stream() throws {
        let f = try FixtureLoader.load("JStyle/diego_stress_stream_2026-05-02")
        runFixture(f, parser: JStyleParser())
    }

    func test_fixture_diego_handshake() throws {
        let f = try FixtureLoader.load("JStyle/diego_handshake_2026-05-02")
        runFixture(f, parser: JStyleParser())
    }

    func test_fixture_lidia_temp_v2() throws {
        let f = try FixtureLoader.load("JStyle/lidia_temp_v2_2026-04-30")
        runFixture(f, parser: JStyleParser())
    }

    // MARK: - Vendor isolation guarantee

    func test_dispatcher_routes_jstyle_by_uuid() {
        let v = RingDispatcher.detect(serviceUUIDs: ["FFF0"], localName: nil)
        XCTAssertEqual(v, .jstyle)
    }

    func test_dispatcher_routes_colmi_by_uuid() {
        let v = RingDispatcher.detect(serviceUUIDs: ["6E400001-B5A3-F393-E0A9-E50E24DCCA9E"], localName: nil)
        XCTAssertEqual(v, .colmi)
    }

    func test_derived_hrv_from_rr_window() {
        let p = JStyleParser()
        // Feed a sequence of RR intervals via realtime packets.
        let rrs = [780, 800, 820, 790, 770, 760, 800, 810]
        for rr in rrs {
            let lo = UInt8(rr & 0xFF)
            let hi = UInt8((rr >> 8) & 0xFF)
            let hex = String(format: "69 01 00 00 00 00 %02X %02X 00 00 00 00 00 00 00 00", lo, hi)
            _ = p.parse(bytes: HexBytes.parse(hex), channel: .v1, nowMs: 0)
        }
        guard let hrv = p.deriveHRV(nowMs: 0) else { return XCTFail("expected HRV") }
        XCTAssertGreaterThan(hrv.value, 10)
        XCTAssertLessThan(hrv.value, 200)
        XCTAssertEqual(hrv.mode, .derived)
    }
}
