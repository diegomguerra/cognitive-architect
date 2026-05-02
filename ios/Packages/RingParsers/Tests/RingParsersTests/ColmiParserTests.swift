import XCTest
@testable import RingParsers

final class ColmiParserTests: XCTestCase {

    // MARK: - Unit tests for individual packet types

    func test_realtime_derives_hr_from_rr_LE16() {
        // Daniele R09 verified packet: bytes[6-7]=0x046A = 1130 ms RR
        // → HR = round(60000/1130) = 53 BPM
        let p = ColmiParser()
        let bytes = HexBytes.parse("69 01 00 00 00 00 6A 04 00 00 00 00 00 00 00 D8")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        XCTAssertEqual(result.samples(of: .hr).count, 1)
        XCTAssertEqual(result.samples(of: .hr).first?.value, 53)
        XCTAssertEqual(result.samples(of: .rr_interval).count, 1)
        XCTAssertEqual(result.samples(of: .rr_interval).first?.value, 1130)
    }

    func test_realtime_warmup_zero_payload_emits_nothing() {
        // Ring sends 69 01 00 00 00 00 00 00 ... during warmup before sensor stabilizes.
        // Old parser would emit phantom HR=0 samples. Verify package emits zero.
        let p = ColmiParser()
        let bytes = HexBytes.parse("69 01 00 00 00 00 00 00 00 00 00 00 00 00 00 6A")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        XCTAssertEqual(result.samples.count, 0,
            "Zero-payload realtime must produce zero samples (warmup state)")
    }

    func test_history_drain_sentinels_silent() {
        // When official QRing app drained the ring, history queries return:
        // 15 FF 00... (HR), 2C 00 00... (SpO2), 37 FF 00... (Stress), 39 FF 00... (HRV)
        // Parser must NOT emit samples — these are "no data" signals.
        let p = ColmiParser()
        let drainPackets = [
            "15 FF 00 00 00 00 00 00 00 00 00 00 00 00 00 14",
            "2C 00 00 00 00 00 00 00 00 00 00 00 00 00 00 2C",
            "37 FF 00 00 00 00 00 00 00 00 00 00 00 00 00 36",
            "39 FF 00 00 00 00 00 00 00 00 00 00 00 00 00 38",
        ]
        for hex in drainPackets {
            let result = p.parse(bytes: HexBytes.parse(hex), channel: .v1, nowMs: 0)
            XCTAssertEqual(result.samples.count, 0,
                "Drain sentinel [\(hex)] must produce zero samples")
        }
    }

    func test_steps_history_packet_decodes_cumulative() {
        // 43 00 03 31 0C 00 0A 81 00 1B 00 16 00 00 00 3F
        //                 ^^^^^^^^                       data
        // bytes[3-4] = 0x310C (LE16) = 12556 cumulative steps? No — 0x0C31 = 3121 steps
        // Wait: bytes[3-4] = 0x31 0x0C → LE16 = 0x0C31 = 3121
        let p = ColmiParser()
        let bytes = HexBytes.parse("43 00 03 31 0C 00 0A 81 00 1B 00 16 00 00 00 3F")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        let steps = result.samples(of: .steps)
        XCTAssertEqual(steps.count, 1)
        XCTAssertEqual(steps.first?.value, 3121)  // 0x31 | (0x0C << 8) = 49 + 3072 = 3121
        XCTAssertEqual(steps.first?.metadata["slot"], "0")  // b[5] = packet index 0..N-1
        XCTAssertEqual(steps.first?.metadata["agg_marker"], "10")  // b[6] = 0x0A = 10 packets total
    }

    func test_steps_history_metadata_header_no_samples() {
        // 43 F0 0A 01 ... — metadata header (10 packets), no data
        let p = ColmiParser()
        let bytes = HexBytes.parse("43 F0 0A 01 00 00 00 00 00 00 00 00 00 00 00 3E")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        XCTAssertEqual(result.samples.count, 0)
    }

    func test_v2_temperature_decodes_body_temps() {
        // Daniele R09 captured payload — partial day with sparse readings
        let p = ColmiParser()
        let hex = "BC 25 32 00 1C 30 00 1E 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 A6 00 A6 00 A5 00 A5 A7 00 A7 A7 A7 A7 A7 A7 A7 A7 A8 A8 A7 A8"
        let result = p.parse(bytes: HexBytes.parse(hex), channel: .v2, nowMs: 1730000000_000)
        let temps = result.samples(of: .temp)
        XCTAssertGreaterThanOrEqual(temps.count, 8)
        for t in temps {
            XCTAssertGreaterThanOrEqual(t.value, 35.5)
            XCTAssertLessThanOrEqual(t.value, 37.0)
        }
        // 0xA5 = 165 → (165/10)+20 = 36.5
        // 0xA6 = 166 → (166/10)+20 = 36.6
        // 0xA7 = 167 → (167/10)+20 = 36.7
        // 0xA8 = 168 → (168/10)+20 = 36.8
        let values = Set(temps.map { $0.value })
        XCTAssertTrue(values.contains(36.6), "Expected 36.6°C from byte 0xA6")
    }

    func test_battery_packet_recognized() {
        // 03 5A 01 ... = 90% charging
        let p = ColmiParser()
        let bytes = HexBytes.parse("03 5A 01 00 00 00 00 00 00 00 00 00 00 00 00 5E")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        // Battery is metadata, not biomarker — should not produce samples but should be recognized
        XCTAssertEqual(result.samples.count, 0)
        XCTAssertTrue(result.unrecognized.contains { $0.contains("colmi-battery-90pct-charging:true") })
    }

    func test_stress_history_byte2_value() {
        // CMD 0x37 with stress=42 at byte[2]
        let p = ColmiParser()
        let bytes = HexBytes.parse("37 02 2A 00 00 00 00 00 00 00 00 00 00 00 00 63")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        let stress = result.samples(of: .stress)
        XCTAssertEqual(stress.count, 1)
        XCTAssertEqual(stress.first?.value, 42)
    }

    func test_hrv_history_byte2_value() {
        // CMD 0x39 with HRV=45ms at byte[2]
        let p = ColmiParser()
        let bytes = HexBytes.parse("39 02 2D 00 00 00 00 00 00 00 00 00 00 00 00 68")
        let result = p.parse(bytes: bytes, channel: .v1, nowMs: 0)
        let hrv = result.samples(of: .hrv)
        XCTAssertEqual(hrv.count, 1)
        XCTAssertEqual(hrv.first?.value, 45)
    }

    func test_dispatcher_routes_colmi_by_uuid() {
        let v = RingDispatcher.detect(serviceUUIDs: ["6E400001-B5A3-F393-E0A9-E50E24DCCA9E"], localName: nil)
        XCTAssertEqual(v, .colmi)
    }

    func test_dispatcher_routes_colmi_by_name() {
        XCTAssertEqual(RingDispatcher.detect(serviceUUIDs: [], localName: "R09 ABC"), .colmi)
        XCTAssertEqual(RingDispatcher.detect(serviceUUIDs: [], localName: "R02-1234"), .colmi)
    }

    // MARK: - Fixture-driven regression tests

    func test_fixture_daniele_full_session() throws {
        let f = try FixtureLoader.load("Colmi/daniele_full_session_2026-04-27")
        runFixture(f, parser: ColmiParser())
    }

    func test_fixture_daniele_temp_v2() throws {
        let f = try FixtureLoader.load("Colmi/daniele_temp_v2_2026-04-27")
        runFixture(f, parser: ColmiParser())
    }

    func test_fixture_daniele_warmup() throws {
        let f = try FixtureLoader.load("Colmi/daniele_warmup_2026-05-02")
        runFixture(f, parser: ColmiParser())
    }
}
