import Foundation
import Capacitor
import CoreBluetooth

/**
 * QRingPlugin — Capacitor native plugin for Colmi R02/R03/R06 smart rings
 * (sold as "QRing"). Speaks the Nordic-UART-like protocol directly over BLE
 * via CoreBluetooth, bypassing the official QRing app.
 *
 * Protocol reference:
 *   - colmi.puxtril.com (canonical command table)
 *   - codeberg.org/Freeyourgadget/Gadgetbridge PR #3896 (Kotlin reference)
 *   - github.com/tahnok/colmi_r02_client (Python reference)
 *
 * BLE UUIDs:
 *   Service:  6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E
 *   Write:    6E400002-B5A3-F393-E0A9-E50E24DCCA9E  (app → ring)
 *   Notify:   6E400003-B5A3-F393-E0A9-E50E24DCCA9E  (ring → app)
 *
 * Packet format: 16 bytes fixed.
 *   byte[0]      = command id
 *   bytes[1..14] = payload
 *   byte[15]     = checksum = sum(bytes[0..14]) & 0xFF
 */
@objc(QRingPlugin)
public class QRingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QRingPlugin"
    public let jsName = "QRingPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable",     returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan",       returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan",        returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect",         returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync",            returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableRealtime",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureAutoHR", returnType: CAPPluginReturnPromise),
    ]

    private static let LS_LAST_DEVICE_ID = "qring_last_device_id"

    // MARK: - Constants

    // V1 framing — 16-byte fixed packets + checksum on byte[15]
    // Used by Colmi R02/R03/R06 + most R09 commands
    private static let serviceUUID = CBUUID(string: "6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E")
    private static let writeUUID   = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
    private static let notifyUUID  = CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E")

    // V2 "big data" framing — raw variable-length packets, NO pad, NO checksum.
    // Used by R09 for temperature history (and other big-data transfers).
    // Reference: Gadgetbridge Yawell Ring support (AGPL, algorithms only).
    private static let serviceUUIDv2 = CBUUID(string: "DE5BF728-D711-4E47-AF26-65E3012A5DC7")
    private static let writeUUIDv2   = CBUUID(string: "DE5BF72A-D711-4E47-AF26-65E3012A5DC7")
    private static let notifyUUIDv2  = CBUUID(string: "DE5BF729-D711-4E47-AF26-65E3012A5DC7")

    // Standard Device Info Service
    private static let deviceInfoServiceUUID = CBUUID(string: "180A")
    private static let firmwareRevUUID       = CBUUID(string: "2A26")

    // V1 Commands
    private static let CMD_SET_TIME:        UInt8 = 0x01
    private static let CMD_BATTERY:         UInt8 = 0x03
    private static let CMD_HR_HISTORY:      UInt8 = 0x15
    private static let CMD_HR_SETTINGS:     UInt8 = 0x16
    private static let CMD_SPO2_HISTORY:    UInt8 = 0x2C
    private static let CMD_STRESS_HIST:     UInt8 = 0x37
    private static let CMD_AUTO_TEMP_PREF:  UInt8 = 0x3A    // R09: enable continuous temperature
    private static let CMD_HRV_HISTORY:     UInt8 = 0x39
    private static let CMD_STEPS_HIST:      UInt8 = 0x43
    private static let CMD_SLEEP_HIST:      UInt8 = 0x44
    private static let CMD_REALTIME:        UInt8 = 0x69
    private static let CMD_STOP_REALTIME:   UInt8 = 0x6A

    // V2 Commands
    private static let CMD_BIG_DATA_V2:         UInt8 = 0xBC
    private static let BIG_DATA_TYPE_TEMP:      UInt8 = 0x25

    private static let RT_TYPE_HR:   UInt8 = 0x01
    private static let RT_TYPE_SPO2: UInt8 = 0x03
    private static let RT_TYPE_HRV:  UInt8 = 0x0A

    private static let PACKET_SIZE = 16

    // Feature flags (runtime-configurable via sync options)
    // - historyEnabled: send V1 history commands (0x15 HR, 0x43 Steps, 0x44 Sleep,
    //   0x2C SpO2, 0x37 Stress, 0x39 HRV). Currently OFF by default because the R09
    //   parser emits garbage for some of these. Re-enable after parser is validated.
    // - debugRawEnabled: emit EVERY notify packet as a `debug_raw` sample. Always ON
    //   until parser is validated, so we keep a reverse-engineering corpus.
    private var historyEnabled = false
    private var debugRawEnabled = true

    // MARK: - State
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?
    private var notifyChar: CBCharacteristic?
    // V2 characteristics (temperature). Optional — not all rings have them.
    private var writeCharV2: CBCharacteristic?
    private var notifyCharV2: CBCharacteristic?
    private var firmwareRev: String?

    private var isScanning = false
    private var connectCall: CAPPluginCall?
    private var pendingSyncCall: CAPPluginCall?

    // Op queue for V1 writes (CoreBluetooth allows parallel writes w/o response,
    // but we still serialize for notify reliability).
    private var opQueue: [Data] = []
    private var opInFlight = false
    private let opLock = NSLock()

    // Op queue for V2 writes (temperature "big data" channel). Separate queue
    // because it uses a different characteristic and different timing semantics.
    private var opQueueV2: [Data] = []
    private var opInFlightV2 = false
    private let opLockV2 = NSLock()

    // Sync buffers
    private var hrSamples: [[String: Any]] = []
    private var stepsSamples: [[String: Any]] = []
    private var sleepSamples: [[String: Any]] = []
    private var spo2Samples: [[String: Any]] = []
    private var hrvSamples: [[String: Any]] = []
    private var stressSamples: [[String: Any]] = []
    private var tempSamples: [[String: Any]] = []
    private var realtimeHrSamples: [[String: Any]] = []
    private var realtimeSpo2Samples: [[String: Any]] = []
    private var realtimeHrvSamples: [[String: Any]] = []
    private var realtimeRRIntervals: [Int] = []  // rr_ms from HR realtime packets
    private var rrIntervalSamples: [[String: Any]] = []
    private var debugRawSamples: [[String: Any]] = []

    // V2 temperature packet assembler. V2 responses can span multiple BLE notifications;
    // we accumulate until we have the declared payload length.
    private var tempBuffer = Data()
    private var tempExpectedLength = -1

    private var expectedHrPackets = -1
    private var receivedHrPackets = 0
    private var hrIntervalMinutes = 5
    private var hrDayEpoch: TimeInterval = 0

    private var expectedStepsPackets = -1
    private var receivedStepsPackets = 0

    // --- Debug counters surfaced to UI for remote diagnostics ---
    private var writesSent = 0
    private var notifiesReceived = 0
    private var lastWriteHex = ""
    private var lastNotifyHex = ""
    private var lastError = ""
    private var discoveredServices: [String] = []
    private var discoveredCharacteristics: [String] = []

    // Monotonic sample sequence — ensures each emitted sample has a unique
    // timestamp down to the sub-millisecond. The backend has a UNIQUE index
    // on (user_id, type, ts, source), so two samples with the same ms would
    // collide and fail ingestion. We nudge ts by the sequence number to
    // guarantee uniqueness even when multiple notify packets land in the
    // same millisecond.
    private var sampleSeq: Double = 0
    private func nowMsUnique() -> Double {
        sampleSeq += 1
        return Date().timeIntervalSince1970 * 1000 + sampleSeq
    }

    private func emitDebug() {
        notifyListeners("debug", data: [
            "writesSent": writesSent,
            "notifiesReceived": notifiesReceived,
            "lastWriteHex": lastWriteHex,
            "lastNotifyHex": lastNotifyHex,
            "lastError": lastError,
            "discoveredServices": discoveredServices,
            "discoveredCharacteristics": discoveredCharacteristics,
        ])
    }

    override public func load() {
        central = CBCentralManager(delegate: self, queue: DispatchQueue.main)
    }

    // MARK: - Capacitor API

    @objc func isAvailable(_ call: CAPPluginCall) {
        let available = central?.state == .poweredOn
        call.resolve(["available": available])
    }

    @objc func startScan(_ call: CAPPluginCall) {
        guard central.state == .poweredOn else {
            call.reject("BLUETOOTH_OFF")
            return
        }
        if isScanning {
            call.resolve(["alreadyScanning": true])
            return
        }
        // Unfiltered scan — the Colmi R09 (and possibly newer models) don't
        // always advertise the Nordic UART service UUID in their advertisement
        // packet, even though they support it after connect. Filtering by
        // UUID hides them. We scan everything and emit only devices whose
        // name looks ring-like, letting the UI list them for the user to
        // pick. The advertised service UUIDs are also emitted so we can
        // diagnose stack variants.
        central.scanForPeripherals(
            withServices: nil,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
        isScanning = true
        // Surface previously-paired ring(s) as deviceFound events so the UI can
        // offer one-tap reconnect even if the ring isn't advertising right now.
        tryReconnectKnown()
        call.resolve(["started": true])
    }

    /// Surface previously-paired peripherals (from CoreBluetooth's identifier
    /// store) as deviceFound events with `saved=true`.
    private func tryReconnectKnown() {
        guard let savedId = UserDefaults.standard.string(forKey: Self.LS_LAST_DEVICE_ID),
              let uuid = UUID(uuidString: savedId) else { return }
        let known = central.retrievePeripherals(withIdentifiers: [uuid])
        for p in known {
            let id = p.identifier.uuidString
            let name = p.name ?? "QRing (saved)"
            notifyListeners("deviceFound", data: [
                "deviceId": id,
                "name": name,
                "mac": id,
                "rssi": 0,
                "vendor": "colmi",
                "model": inferModel(from: name),
                "saved": true,
            ])
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        if central.isScanning { central.stopScan() }
        isScanning = false
        call.resolve(["stopped": true])
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let deviceId = call.getString("deviceId") else {
            call.reject("MISSING_DEVICE_ID")
            return
        }
        guard let uuid = UUID(uuidString: deviceId) else {
            call.reject("INVALID_DEVICE_ID (not a CBPeripheral UUID string)")
            return
        }
        let peripherals = central.retrievePeripherals(withIdentifiers: [uuid])
        guard let p = peripherals.first else {
            call.reject("DEVICE_NOT_FOUND (scan again and try)")
            return
        }
        connectCall = call
        if central.isScanning { central.stopScan() }
        isScanning = false
        peripheral = p
        p.delegate = self
        UserDefaults.standard.set(deviceId, forKey: Self.LS_LAST_DEVICE_ID)
        // autoConnect via NotifyOnConnection — keeps trying even if ring drops
        central.connect(p, options: [
            CBConnectPeripheralOptionNotifyOnConnectionKey: true,
            CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
        ])
        // 10s connection timeout — cancel + reject if didConnect never fires
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self = self, self.connectCall != nil else { return }
            self.central.cancelPeripheralConnection(p)
            self.connectCall?.reject("CONNECT_TIMEOUT")
            self.connectCall = nil
        }
    }

    @objc func configureAutoHR(_ call: CAPPluginCall) {
        guard peripheral != nil, writeChar != nil else {
            call.reject("NOT_CONNECTED")
            return
        }
        let interval = call.getInt("interval") ?? 5
        let enabled = call.getBool("enabled") ?? true
        sendHRSettings(enable: enabled, intervalMinutes: interval)
        call.resolve(["enabled": enabled, "interval": interval])
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        if let p = peripheral {
            central.cancelPeripheralConnection(p)
        }
        peripheral = nil
        writeChar = nil
        notifyChar = nil
        firmwareRev = nil
        opLock.lock()
        opQueue.removeAll()
        opInFlight = false
        opLock.unlock()
        call.resolve(["disconnected": true])
    }

    @objc func sync(_ call: CAPPluginCall) {
        guard peripheral != nil, writeChar != nil else {
            call.reject("NOT_CONNECTED")
            return
        }
        pendingSyncCall = call
        // Flags from JS layer override defaults (allows live enabling history from debug UI)
        if let hist = call.getBool("historyEnabled") { historyEnabled = hist }
        if let dr = call.getBool("debugRawEnabled") { debugRawEnabled = dr }

        // Reset buffers
        hrSamples.removeAll()
        stepsSamples.removeAll()
        sleepSamples.removeAll()
        spo2Samples.removeAll()
        hrvSamples.removeAll()
        stressSamples.removeAll()
        tempSamples.removeAll()
        realtimeHrSamples.removeAll()
        realtimeSpo2Samples.removeAll()
        realtimeHrvSamples.removeAll()
        realtimeRRIntervals.removeAll()
        rrIntervalSamples.removeAll()
        debugRawSamples.removeAll()
        tempBuffer.removeAll()
        tempExpectedLength = -1
        expectedHrPackets = -1
        receivedHrPackets = 0
        expectedStepsPackets = -1
        receivedStepsPackets = 0
        // Reset monotonic sample sequence so nudges stay bounded per sync
        sampleSeq = 0

        // --- Core sync sequence (realtime-first) ---
        // Phase 1: setup — SetTime + Battery + enable temp measurement on ring
        sendSetTime()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self = self else { return }
            self.sendBattery()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.sendTemperaturePref(enable: true)
        }

        // Phase 2: temperature history request on V2 channel (R09 supports; older
        // rings respond with nothing — harmless if writeCharV2 is nil, write is skipped)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.sendTemperatureHistoryRequest()
        }

        // Phase 3: realtime readings — HR/SpO2/HRV sequentially.
        // R09 needs ~30-45s warmup per type. We give 50s per type, stopping the
        // previous before starting the next to avoid firmware conflicts.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.sendRealtime(type: Self.RT_TYPE_HR)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 52.0) { [weak self] in
            guard let self = self else { return }
            // Stop HR, start SpO2
            self.sendRealtimeStop(type: Self.RT_TYPE_HR)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.sendRealtime(type: Self.RT_TYPE_SPO2)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 103.0) { [weak self] in
            guard let self = self else { return }
            // Stop SpO2, start HRV
            self.sendRealtimeStop(type: Self.RT_TYPE_SPO2)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                if self.isHrvSupported() {
                    self.sendRealtime(type: Self.RT_TYPE_HRV)
                }
            }
        }

        // Phase 4 (optional, gated): V1 history commands — only if flag enabled.
        // Parser is known broken for R09 on some types; keep off until validated.
        if historyEnabled {
            DispatchQueue.main.asyncAfter(deadline: .now() + 140.0) { [weak self] in
                guard let self = self else { return }
                self.sendHRSettings(enable: true, intervalMinutes: 5)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.sendHRHistory(dayOffset: 0) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.sendStepsHistory(dayOffset: 0) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.sendSleepHistory(dayOffset: 0) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.sendSpo2History(dayOffset: 0) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.sendStressHistory(dayOffset: 0) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
                    if self.isHrvSupported() { self.sendHrvHistory(dayOffset: 0) }
                }
            }
        }

        // Phase 5: resolve after quiet period. Must wait for all 3 realtime types (~150s).
        let quietDelay: TimeInterval = historyEnabled ? 165.0 : 155.0
        DispatchQueue.main.asyncAfter(deadline: .now() + quietDelay) { [weak self] in
            guard let self = self else { return }

            // Flush any buffered realtime samples as syncData events
            // Use standard types (hr/spo2/hrv) so edge function accepts them
            self.flushRealtimeBatch(type: "hr", samples: &self.realtimeHrSamples)
            self.flushRealtimeBatch(type: "spo2", samples: &self.realtimeSpo2Samples)
            self.flushRealtimeBatch(type: "hrv", samples: &self.realtimeHrvSamples)

            // Derive RHR and Stress from collected data
            self.deriveBiomarkers()
            // Debug raw is flushed continuously during sync as batches fill; flush any leftover
            self.flushDebugRawBatch(force: true)

            if let c = self.pendingSyncCall {
                c.resolve([
                    "hr_count": self.hrSamples.count,
                    "steps_count": self.stepsSamples.count,
                    "sleep_count": self.sleepSamples.count,
                    "spo2_count": self.spo2Samples.count,
                    "hrv_count": self.hrvSamples.count,
                    "stress_count": self.stressSamples.count,
                    "temp_count": self.tempSamples.count,
                    "rt_hr_count": self.realtimeHrSamples.count,
                    "rt_spo2_count": self.realtimeSpo2Samples.count,
                    "rt_hrv_count": self.realtimeHrvSamples.count,
                    "fw_version": self.firmwareRev ?? "",
                    "history_enabled": self.historyEnabled,
                    "debug_raw_enabled": self.debugRawEnabled,
                ])
                self.pendingSyncCall = nil
            }
            self.notifyListeners("syncEnd", data: ["type": "all"])
        }
    }

    private func flushRealtimeBatch(type: String, samples: inout [[String: Any]]) {
        guard !samples.isEmpty else { return }
        notifyListeners("syncData", data: ["type": type, "samples": samples])
        notifyListeners("syncEnd", data: ["type": type])
        samples.removeAll()
    }

    @objc func enableRealtime(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "hr"
        let subType: UInt8
        switch type {
        case "hr":   subType = Self.RT_TYPE_HR
        case "spo2": subType = Self.RT_TYPE_SPO2
        case "hrv":  subType = Self.RT_TYPE_HRV
        default:
            call.reject("UNKNOWN_REALTIME_TYPE: \(type)")
            return
        }
        sendRealtime(type: subType)
        call.resolve(["started": true])
    }

    /// Start realtime stream for a single biomarker type (0x69 request).
    /// Ring emits periodic readings until stopped or auto-stops after ~60s.
    private func sendRealtime(type: UInt8) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_REALTIME
        pkt[1] = type
        pkt[2] = 0x01
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    /// Stop realtime stream for a given type (0x6A).
    private func sendRealtimeStop(type: UInt8) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = 0x6A  // CMD_RT_STOP
        pkt[1] = type
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    // MARK: - Command builders

    private func checksum(_ pkt: [UInt8]) -> UInt8 {
        var sum = 0
        for i in 0..<(Self.PACKET_SIZE - 1) { sum += Int(pkt[i]) }
        return UInt8(sum & 0xFF)
    }

    private func sendSetTime() {
        let now = Date()
        let cal = Calendar(identifier: .gregorian)
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_SET_TIME
        pkt[1] = UInt8(max(0, (comps.year ?? 2026) - 2000))
        pkt[2] = UInt8(comps.month ?? 1)            // 1-indexed per Puxtril spec
        pkt[3] = UInt8(comps.day ?? 1)
        pkt[4] = UInt8(comps.hour ?? 0)
        pkt[5] = UInt8(comps.minute ?? 0)
        pkt[6] = UInt8(comps.second ?? 0)
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendBattery() {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_BATTERY
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendHRSettings(enable: Boolean, intervalMinutes: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_HR_SETTINGS
        pkt[1] = 0x02                               // "set" sub-op
        pkt[2] = enable ? 0x01 : 0x02               // 1=enable, 2=disable
        pkt[3] = UInt8(max(5, min(60, intervalMinutes)))
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendHRHistory(dayOffset: Int) {
        let cal = Calendar.current
        var comps = cal.dateComponents([.year, .month, .day], from: Date())
        // Use local midnight for day window
        let midnight = cal.date(from: comps) ?? Date()
        let target = cal.date(byAdding: .day, value: -dayOffset, to: midnight) ?? midnight
        hrDayEpoch = target.timeIntervalSince1970
        let epoch = UInt32(hrDayEpoch)
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_HR_HISTORY
        pkt[1] = UInt8(epoch & 0xFF)
        pkt[2] = UInt8((epoch >> 8) & 0xFF)
        pkt[3] = UInt8((epoch >> 16) & 0xFF)
        pkt[4] = UInt8((epoch >> 24) & 0xFF)
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
        _ = comps
    }

    private func sendStepsHistory(dayOffset: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_STEPS_HIST
        pkt[1] = UInt8(dayOffset & 0xFF)
        pkt[2] = 0x0F
        pkt[3] = 0x00
        pkt[4] = 0x5F
        pkt[5] = 0x01
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendSleepHistory(dayOffset: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_SLEEP_HIST
        pkt[1] = UInt8(dayOffset & 0xFF)
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendSpo2History(dayOffset: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_SPO2_HISTORY
        pkt[1] = UInt8(dayOffset & 0xFF)
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendStressHistory(dayOffset: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_STRESS_HIST
        pkt[1] = 0x01
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendHrvHistory(dayOffset: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_HRV_HISTORY
        pkt[1] = 0x01
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    /// Enable/disable automatic temperature measurement on the ring.
    /// Without this, the ring won't log temperature and history request returns empty.
    /// V1 framing, command 0x3A, subcommand 0x02 (write), payload[0] = 1/0.
    private func sendTemperaturePref(enable: Bool) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_AUTO_TEMP_PREF
        pkt[1] = 0x03              // length of subcommand section
        pkt[2] = 0x02              // PREF_WRITE (0x01 = read)
        pkt[3] = enable ? 0x01 : 0x00
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    /// Request temperature history via V2 "big data" channel.
    /// Packet format is RAW variable length — no pad, no checksum.
    /// Payload: `BC 25 01 00 3E 81 02` (7 bytes). Sent only if V2 writeChar is
    /// present (Colmi R09 has it; older rings do not — skipped silently).
    private func sendTemperatureHistoryRequest() {
        guard writeCharV2 != nil, peripheral != nil else {
            NSLog("[QRing] skip temperature history — V2 write char not available")
            return
        }
        let pkt = Data([
            Self.CMD_BIG_DATA_V2,           // 0xBC
            Self.BIG_DATA_TYPE_TEMP,        // 0x25
            0x01, 0x00,                     // length LE = 1
            0x3E, 0x81, 0x02                // payload
        ])
        queueWriteV2(pkt)
    }

    private func isHrvSupported() -> Bool {
        guard let fw = firmwareRev else { return false }
        let parts = fw.split(separator: ".").compactMap { Int($0) }
        guard parts.count >= 3 else { return false }
        let (maj, min, patch) = (parts[0], parts[1], parts[2])
        return (maj > 3) || (maj == 3 && (min > 0 || patch >= 10))
    }

    // MARK: - BLE op queue

    private func queueWrite(_ data: Data) {
        opLock.lock()
        opQueue.append(data)
        opLock.unlock()
        drainQueue()
    }

    private func drainQueue() {
        opLock.lock()
        if opInFlight {
            opLock.unlock()
            return
        }
        guard !opQueue.isEmpty, let p = peripheral, let wc = writeChar else {
            opLock.unlock()
            return
        }
        let data = opQueue.removeFirst()
        opInFlight = true
        opLock.unlock()

        // Choose write type based on characteristic properties. Some R-series
        // rings (like R09) only accept WithResponse even though tahnok's
        // Python client uses WithoutResponse for R02. Detect from char props.
        let writeType: CBCharacteristicWriteType =
            wc.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse

        let hex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
        lastWriteHex = hex
        writesSent += 1
        NSLog("[QRing] WRITE (%@) %@", writeType == .withoutResponse ? "no-resp" : "resp", hex)

        p.writeValue(data, for: wc, type: writeType)
        emitDebug()

        // With response: wait for didWriteValueFor callback. Without: fixed delay.
        if writeType == .withoutResponse {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.opLock.lock()
                self?.opInFlight = false
                self?.opLock.unlock()
                self?.drainQueue()
            }
        }
        // If withResponse, onWriteValue delegate will unblock the queue.
    }

    public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error = error {
            lastError = "write: \(error.localizedDescription)"
            NSLog("[QRing] WRITE ERROR: %@", error.localizedDescription)
        }
        if characteristic.uuid == Self.writeUUIDv2 || characteristic == writeCharV2 {
            opLockV2.lock()
            opInFlightV2 = false
            opLockV2.unlock()
            emitDebug()
            drainQueueV2()
        } else {
            opLock.lock()
            opInFlight = false
            opLock.unlock()
            emitDebug()
            drainQueue()
        }
    }

    // MARK: - V2 BLE op queue (big-data channel, raw variable-length)

    private func queueWriteV2(_ data: Data) {
        opLockV2.lock()
        opQueueV2.append(data)
        opLockV2.unlock()
        drainQueueV2()
    }

    private func drainQueueV2() {
        opLockV2.lock()
        if opInFlightV2 {
            opLockV2.unlock()
            return
        }
        guard !opQueueV2.isEmpty, let p = peripheral, let wc = writeCharV2 else {
            opLockV2.unlock()
            return
        }
        let data = opQueueV2.removeFirst()
        opInFlightV2 = true
        opLockV2.unlock()

        let writeType: CBCharacteristicWriteType =
            wc.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse

        let hex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
        lastWriteHex = "V2: \(hex)"
        writesSent += 1
        NSLog("[QRing] WRITE V2 (%@) %@", writeType == .withoutResponse ? "no-resp" : "resp", hex)

        p.writeValue(data, for: wc, type: writeType)
        emitDebug()

        if writeType == .withoutResponse {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.opLockV2.lock()
                self?.opInFlightV2 = false
                self?.opLockV2.unlock()
                self?.drainQueueV2()
            }
        }
    }

    // MARK: - Notify parser

    private func handleNotify(_ data: Data) {
        let hex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
        lastNotifyHex = hex
        notifiesReceived += 1
        NSLog("[QRing] NOTIFY V1 %@", hex)
        emitDebug()
        guard data.count >= 2 else { return }

        // Capture every V1 notify as debug_raw for reverse engineering
        emitDebugRaw(channel: "v1", hex: hex)

        let bytes = [UInt8](data)
        let cmd = bytes[0]

        // Always parse lightweight / well-known commands
        switch cmd {
        case Self.CMD_BATTERY:      parseBattery(bytes); return
        case Self.CMD_HR_SETTINGS:  NSLog("[QRing] hr-settings ack"); return
        case Self.CMD_SET_TIME:     NSLog("[QRing] set-time ack"); return
        case Self.CMD_AUTO_TEMP_PREF: NSLog("[QRing] auto-temp pref ack: \(bytes[3])"); return
        case Self.CMD_REALTIME:     parseRealtime(bytes); return
        default: break
        }

        // History commands are gated because their parsers are known-broken on R09.
        // When historyEnabled=false we still capture bytes via debug_raw above but
        // skip the buggy parsers. When flipped on (after parser rewrite), the
        // regular samples flow again.
        if historyEnabled {
            switch cmd {
            case Self.CMD_HR_HISTORY:   parseHrHistory(bytes)
            case Self.CMD_STEPS_HIST:   parseStepsHistory(bytes)
            case Self.CMD_SLEEP_HIST:   parseSleepHistory(bytes)
            case Self.CMD_SPO2_HISTORY: parseSpo2History(bytes)
            case Self.CMD_STRESS_HIST:  parseStressHistory(bytes)
            case Self.CMD_HRV_HISTORY:  parseHrvHistory(bytes)
            default:
                NSLog("[QRing] unhandled cmd 0x%02X", cmd)
            }
        } else {
            NSLog("[QRing] cmd 0x%02X received — parser gated off (historyEnabled=false)", cmd)
        }
    }

    /// Handle incoming V2 "big data" notification (temperature, etc.)
    /// Responses can span multiple packets; we assemble into tempBuffer until
    /// we've received the declared payload length.
    private func handleNotifyV2(_ data: Data) {
        let hex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
        lastNotifyHex = "V2: \(hex)"
        notifiesReceived += 1
        NSLog("[QRing] NOTIFY V2 %@", hex)
        emitDebug()

        // Always capture for reverse engineering
        emitDebugRaw(channel: "v2", hex: hex)

        // V2 header: BC <type> <len_lo> <len_hi> <?> <?> <payload...>
        // For temperature, type=0x25. We assemble until buffer has header(6) + len bytes.
        if data.count >= 4 && data[0] == Self.CMD_BIG_DATA_V2 && data[1] == Self.BIG_DATA_TYPE_TEMP {
            // Start of a new temperature response
            tempBuffer = data
            tempExpectedLength = Int(data[2]) | (Int(data[3]) << 8)
            NSLog("[QRing] V2 temp response start — declared length: \(tempExpectedLength), received \(data.count) so far")
        } else if tempExpectedLength > 0 {
            // Continuation
            tempBuffer.append(data)
        } else {
            // Unknown V2 notification
            NSLog("[QRing] V2 unknown framing — first bytes: %02X %02X", data.count > 0 ? data[0] : 0, data.count > 1 ? data[1] : 0)
            return
        }

        // If we have the full payload, parse it
        if tempBuffer.count >= 6 + tempExpectedLength {
            parseTemperatureV2(tempBuffer)
            tempBuffer.removeAll()
            tempExpectedLength = -1
        }
    }

    /// Emit a debug_raw sample — hex dump of a notify packet for reverse engineering.
    /// Batched internally (flushed when buffer reaches ~20 samples or at sync end).
    private func emitDebugRaw(channel: String, hex: String) {
        guard debugRawEnabled else { return }
        debugRawSamples.append([
            "type": "debug_raw",
            "ts": nowMsUnique(),
            "raw": hex,
            "channel": channel,    // "v1" or "v2"
        ])
        if debugRawSamples.count >= 20 {
            flushDebugRawBatch(force: false)
        }
    }

    private func flushDebugRawBatch(force: Bool) {
        guard !debugRawSamples.isEmpty else { return }
        // Always emit as syncData so the frontend accumulates them for upload
        notifyListeners("syncData", data: ["type": "debug_raw", "samples": debugRawSamples])
        debugRawSamples.removeAll()
        if force {
            notifyListeners("syncEnd", data: ["type": "debug_raw"])
        }
    }

    /// Parse assembled V2 temperature payload.
    /// Layout: `BC 25 <len_lo> <len_hi> <?> <?>` (6-byte header) followed by
    /// repeating day blocks: 1 byte days_ago + 1 byte separator (0x1E) + 48 bytes
    /// (24 hours × 2 half-hour samples). `temp_c = (unsigned_byte / 10) + 20`.
    /// A value of 0 means "no sample".
    private func parseTemperatureV2(_ data: Data) {
        guard data.count >= 6 else { return }
        let length = Int(data[2]) | (Int(data[3]) << 8)
        NSLog("[QRing] parsing V2 temperature payload — length \(length), buffer \(data.count)")
        var index = 6
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())

        while index < data.count, index - 6 < length {
            let daysAgo = Int(data[index]); index += 1
            if daysAgo == 0 && index > 7 {
                // Sentinel: some firmwares mark end of stream
                break
            }
            // Skip separator (should be 0x1E)
            if index < data.count { index += 1 }
            guard let dayStart = cal.date(byAdding: .day, value: -daysAgo, to: today) else { continue }
            let dayStartSec = dayStart.timeIntervalSince1970

            for slot in 0..<48 {
                guard index < data.count else { break }
                let rawByte = data[index]; index += 1
                if rawByte == 0 { continue } // no sample
                let celsius = (Double(rawByte) / 10.0) + 20.0
                // Skip physiologically impossible values (ring worn on finger: 28-40°C)
                guard (15.0...45.0).contains(celsius) else { continue }
                let tsSec = dayStartSec + Double(slot) * 30 * 60  // 30-min slots
                tempSamples.append([
                    "type": "temp",
                    "ts": tsSec * 1000,
                    "value": celsius,
                ])
            }
        }

        if !tempSamples.isEmpty {
            notifyListeners("syncData", data: ["type": "temp", "samples": tempSamples])
            notifyListeners("syncEnd", data: ["type": "temp"])
            NSLog("[QRing] emitted \(tempSamples.count) temperature samples")
            tempSamples.removeAll()
        } else {
            NSLog("[QRing] V2 temperature parse yielded 0 samples")
        }
    }

    private func parseBattery(_ b: [UInt8]) {
        let pct = Int(b[1])
        let charging = b[2] == 0x01
        notifyListeners("battery", data: ["battery": pct, "charging": charging])
    }

    private func parseHrHistory(_ b: [UInt8]) {
        let subIdx = Int(b[1])
        if subIdx == 0 {
            expectedHrPackets = Int(b[2])
            hrIntervalMinutes = Int(b[3])
            if !(1...120).contains(hrIntervalMinutes) { hrIntervalMinutes = 5 }
            receivedHrPackets = 0
            return
        }
        let startByte = 2
        let endByte = 14
        let valueCount = endByte - startByte + 1
        for i in startByte...endByte {
            let v = Int(b[i])
            if v == 0 { continue }
            let slotInPkt = i - startByte
            let globalSlot = (subIdx - 1) * valueCount + slotInPkt
            let tsSec = hrDayEpoch + Double(globalSlot * hrIntervalMinutes * 60)
            hrSamples.append([
                "type": "hr",
                "ts": tsSec * 1000,
                "value": v
            ])
        }
        receivedHrPackets += 1
        if expectedHrPackets > 0 && receivedHrPackets >= expectedHrPackets - 1 {
            flushHrBatch()
        }
    }

    private func flushHrBatch() {
        if hrSamples.isEmpty {
            notifyListeners("syncEnd", data: ["type": "hr"])
            return
        }
        notifyListeners("syncData", data: ["type": "hr", "samples": hrSamples])
        notifyListeners("syncEnd", data: ["type": "hr"])
        hrSamples.removeAll()
    }

    private func parseStepsHistory(_ b: [UInt8]) {
        let subIdx = Int(b[1])
        if subIdx == 0 {
            expectedStepsPackets = Int(b[2])
            receivedStepsPackets = 0
            return
        }
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month, .day], from: Date())
        let midnight = cal.date(from: comps) ?? Date()
        let dayStart = midnight.timeIntervalSince1970
        for i in 2...14 {
            let v = Int(b[i])
            if v == 0 { continue }
            let slot = (subIdx - 1) * 13 + (i - 2)
            let tsSec = dayStart + Double(slot * 15 * 60)
            stepsSamples.append([
                "type": "steps",
                "ts": tsSec * 1000,
                "value": v
            ])
        }
        receivedStepsPackets += 1
        if expectedStepsPackets > 0 && receivedStepsPackets >= expectedStepsPackets - 1 {
            flushStepsBatch()
        }
    }

    private func flushStepsBatch() {
        if stepsSamples.isEmpty {
            notifyListeners("syncEnd", data: ["type": "steps"])
            return
        }
        notifyListeners("syncData", data: ["type": "steps", "samples": stepsSamples])
        notifyListeners("syncEnd", data: ["type": "steps"])
        stepsSamples.removeAll()
    }

    private func parseSleepHistory(_ b: [UInt8]) {
        let hex = b.map { String(format: "%02X", $0) }.joined(separator: " ")
        sleepSamples.append([
            "type": "sleep",
            "ts": nowMsUnique(),
            "raw": hex
        ])
        notifyListeners("syncData", data: ["type": "sleep", "samples": sleepSamples])
        notifyListeners("syncEnd", data: ["type": "sleep"])
        sleepSamples.removeAll()
    }

    private func parseSpo2History(_ b: [UInt8]) {
        let pct = Int(b[2])
        if (50...100).contains(pct) {
            spo2Samples.append([
                "type": "spo2",
                "ts": nowMsUnique(),
                "value": pct
            ])
        }
        if !spo2Samples.isEmpty {
            notifyListeners("syncData", data: ["type": "spo2", "samples": spo2Samples])
            notifyListeners("syncEnd", data: ["type": "spo2"])
            spo2Samples.removeAll()
        }
    }

    private func parseStressHistory(_ b: [UInt8]) {
        let v = Int(b[2])
        if (1...100).contains(v) {
            stressSamples.append([
                "type": "stress",
                "ts": nowMsUnique(),
                "value": v
            ])
        }
        if !stressSamples.isEmpty {
            notifyListeners("syncData", data: ["type": "stress", "samples": stressSamples])
            notifyListeners("syncEnd", data: ["type": "stress"])
            stressSamples.removeAll()
        }
    }

    private func parseHrvHistory(_ b: [UInt8]) {
        let v = Int(b[2])
        if (5...250).contains(v) {
            hrvSamples.append([
                "type": "hrv",
                "ts": nowMsUnique(),
                "value": v
            ])
        }
        if !hrvSamples.isEmpty {
            notifyListeners("syncData", data: ["type": "hrv", "samples": hrvSamples])
            notifyListeners("syncEnd", data: ["type": "hrv"])
            hrvSamples.removeAll()
        }
    }

    private func parseRealtime(_ b: [UInt8]) {
        // Layout: [0]=0x69 (cmd), [1]=type, [2]=value (for HR/SpO2),
        // HRV uses bytes[2..3] LE 16-bit for RMSSD in ms (firmware ≥ 3.00.10).
        // HR also carries RR interval in bytes[3..4] (LE 16-bit ms).
        let type = b[1]
        let v = Int(b[2])

        // Skip "no reading" sentinels (0 or status codes). Ring emits these
        // during the warm-up before first real reading.
        guard v > 0 else { return }

        let now = nowMsUnique()
        switch type {
        case Self.RT_TYPE_HR:
            // Physiological range 30-220 bpm
            guard (30...220).contains(v) else { return }
            realtimeHrSamples.append([
                "type": "hr",
                "ts": now,
                "value": v,
                "source": "qring_ble",
                "payload_json": ["mode": "realtime"],
            ])
            notifyListeners("realtime", data: ["type": "hr", "value": v])

            // Extract RR interval from bytes[3..4] (LE 16-bit ms)
            let rrMs = Int(b[3]) | (Int(b[4]) << 8)
            if (300...2000).contains(rrMs) {
                realtimeRRIntervals.append(rrMs)
                rrIntervalSamples.append([
                    "type": "rr_interval",
                    "ts": nowMsUnique(),
                    "value": rrMs,
                    "source": "qring_ble",
                    "payload_json": ["mode": "realtime", "metric": "rr_ms"],
                ])
            }
        case Self.RT_TYPE_SPO2:
            // Physiological range 70-100%
            guard (70...100).contains(v) else { return }
            realtimeSpo2Samples.append([
                "type": "spo2",
                "ts": now,
                "value": v,
                "source": "qring_ble",
                "payload_json": ["mode": "realtime"],
            ])
            notifyListeners("realtime", data: ["type": "spo2", "value": v])
        case Self.RT_TYPE_HRV:
            // HRV RMSSD typically 15-200 ms. Byte layout may be single byte or LE 16-bit
            // depending on firmware — validate range.
            guard (5...250).contains(v) else { return }
            realtimeHrvSamples.append([
                "type": "hrv",
                "ts": now,
                "value": v,
                "source": "qring_ble",
                "payload_json": ["mode": "realtime"],
            ])
            notifyListeners("realtime", data: ["type": "hrv", "value": v])
        default: break
        }
    }

    // MARK: - Derived Biomarkers (RHR, Stress)

    private func deriveBiomarkers() {
        let now = nowMsUnique()

        // --- RHR: lowest 10th percentile of HR readings ---
        var allHR: [Int] = []
        for s in realtimeHrSamples {
            if let v = s["value"] as? Int, (30...220).contains(v) { allHR.append(v) }
        }
        for s in hrSamples {
            if let v = s["value"] as? Int, (30...220).contains(v) { allHR.append(v) }
        }
        if !allHR.isEmpty {
            let sorted = allHR.sorted()
            let rhr: Int
            if sorted.count >= 10 {
                let p10Count = max(1, sorted.count / 10)
                rhr = sorted.prefix(p10Count).reduce(0, +) / p10Count
            } else {
                rhr = sorted.first!
            }
            var rhrSamples: [[String: Any]] = []
            rhrSamples.append([
                "type": "rhr",
                "ts": now,
                "value": rhr,
                "source": "qring_ble",
                "payload_json": ["mode": "derived", "method": "p10_hr", "hr_count": allHR.count],
            ])
            notifyListeners("syncData", data: ["type": "rhr", "samples": rhrSamples])
            notifyListeners("syncEnd", data: ["type": "rhr"])
        }

        // --- Stress: derived from RMSSD of RR intervals ---
        if realtimeRRIntervals.count >= 3 {
            var sumSqDiff: Double = 0
            for i in 1..<realtimeRRIntervals.count {
                let diff = Double(realtimeRRIntervals[i] - realtimeRRIntervals[i - 1])
                sumSqDiff += diff * diff
            }
            let rmssd = sqrt(sumSqDiff / Double(realtimeRRIntervals.count - 1))
            // Stress index: inverse of RMSSD (high RMSSD = low stress)
            let stressValue = Int(max(0, min(100, 100 - rmssd * 1.5)))

            var stressSamples: [[String: Any]] = []
            stressSamples.append([
                "type": "stress",
                "ts": now,
                "value": stressValue,
                "source": "qring_ble",
                "payload_json": [
                    "mode": "derived",
                    "method": "rmssd_inverse",
                    "rmssd": round(rmssd * 10) / 10,
                    "rr_count": realtimeRRIntervals.count,
                ],
            ])
            notifyListeners("syncData", data: ["type": "stress", "samples": stressSamples])
            notifyListeners("syncEnd", data: ["type": "stress"])

            // If no direct HRV reading was captured, emit RMSSD as HRV
            if realtimeHrvSamples.isEmpty {
                var fallbackHrv: [[String: Any]] = []
                fallbackHrv.append([
                    "type": "hrv",
                    "ts": nowMsUnique(),
                    "value": Int(round(rmssd)),
                    "source": "qring_ble",
                    "payload_json": ["mode": "derived", "method": "rmssd_from_rr", "rr_count": realtimeRRIntervals.count],
                ])
                notifyListeners("syncData", data: ["type": "hrv", "samples": fallbackHrv])
                notifyListeners("syncEnd", data: ["type": "hrv"])
            }
        }
        // Fallback: derive stress from HRV value if no RR intervals
        else if let lastHRV = realtimeHrvSamples.last, let hrvVal = lastHRV["value"] as? Int {
            let stressValue = Int(max(0, min(100, 100 - Double(hrvVal) * 1.5)))
            var stressSamples: [[String: Any]] = []
            stressSamples.append([
                "type": "stress",
                "ts": now,
                "value": stressValue,
                "source": "qring_ble",
                "payload_json": ["mode": "derived", "method": "hrv_inverse", "hrv_value": hrvVal],
            ])
            notifyListeners("syncData", data: ["type": "stress", "samples": stressSamples])
            notifyListeners("syncEnd", data: ["type": "stress"])
        }

        // Flush RR interval samples
        if !rrIntervalSamples.isEmpty {
            notifyListeners("syncData", data: ["type": "rr_interval", "samples": rrIntervalSamples])
            notifyListeners("syncEnd", data: ["type": "rr_interval"])
            rrIntervalSamples.removeAll()
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension QRingPlugin: CBCentralManagerDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        NSLog("[QRing] central state: \(central.state.rawValue)")
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        // Skip anonymous devices — we only want things with a name so the
        // user can pick them from the list. Filters out AirPods/iPhones/
        // random BLE beacons that have no advertised name.
        let advName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        guard let name = advName ?? peripheral.name, !name.isEmpty else { return }

        // Prefer devices that look ring-like (Colmi/QRing/R0x) but still
        // emit others so the user can investigate unknown rings.
        let upper = name.uppercased()
        let looksLikeRing = upper.contains("R02") || upper.contains("R03")
            || upper.contains("R06") || upper.contains("R09") || upper.contains("R10")
            || upper.contains("COLMI") || upper.contains("QRING") || upper.contains("RING")

        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?.map { $0.uuidString } ?? []
        let overflow = (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID])?.map { $0.uuidString } ?? []
        let manufacturerData = (advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data)?.map { String(format: "%02X", $0) }.joined(separator: " ") ?? ""

        NSLog("[QRing] didDiscover name=%@ rssi=%@ services=%@ manuf=%@",
              name, RSSI, services.joined(separator: ","), manufacturerData)

        let id = peripheral.identifier.uuidString
        let ev: [String: Any] = [
            "deviceId": id,
            "name": name,
            "mac": id,
            "rssi": RSSI.intValue,
            "vendor": "colmi",
            "model": inferModel(from: name),
            "advertisedServices": services,
            "overflowServices": overflow,
            "manufacturerData": manufacturerData,
            "looksLikeRing": looksLikeRing
        ]
        notifyListeners("deviceFound", data: ev)
    }

    private func inferModel(from name: String) -> String {
        let n = name.uppercased()
        if n.contains("R02") { return "R02" }
        if n.contains("R03") { return "R03" }
        if n.contains("R06") { return "R06" }
        if n.contains("R09") { return "R09" }
        if n.contains("R10") { return "R10" }
        return "R02"
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        NSLog("[QRing] connected, discovering services…")
        // Gadgetbridge gotcha — let the ring settle 2s before discovering
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            // Discover ALL services (nil filter) so we can see R09's actual
            // GATT tree, not just the Nordic UART we expected. Some Colmi
            // variants expose their control characteristics on a proprietary
            // Colmi service UUID instead of Nordic UART 6E40FFF0.
            peripheral.discoverServices(nil)
        }
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        connectCall?.reject("CONNECT_FAILED: \(error?.localizedDescription ?? "unknown")")
        connectCall = nil
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        writeChar = nil
        notifyChar = nil
        firmwareRev = nil
        opLock.lock()
        opQueue.removeAll()
        opInFlight = false
        opLock.unlock()
        NSLog("[QRing] disconnected: \(error?.localizedDescription ?? "clean")")
    }
}

// MARK: - CBPeripheralDelegate

extension QRingPlugin: CBPeripheralDelegate {
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else {
            connectCall?.reject("SERVICE_DISCOVERY_FAILED: \(error!.localizedDescription)")
            connectCall = nil
            return
        }
        // Track discovered services for debug UI
        discoveredServices = (peripheral.services ?? []).map { $0.uuid.uuidString }
        emitDebug()

        for service in peripheral.services ?? [] {
            if service.uuid == Self.serviceUUID {
                peripheral.discoverCharacteristics([Self.writeUUID, Self.notifyUUID], for: service)
            } else if service.uuid == Self.serviceUUIDv2 {
                // V2 "big data" service (temperature on R09)
                peripheral.discoverCharacteristics([Self.writeUUIDv2, Self.notifyUUIDv2], for: service)
            } else if service.uuid == Self.deviceInfoServiceUUID {
                peripheral.discoverCharacteristics([Self.firmwareRevUUID], for: service)
            } else {
                // Unknown services still discovered so fallback heuristics can find
                // write/notify chars when the exact UUIDs don't match.
                peripheral.discoverCharacteristics(nil, for: service)
            }
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil else { return }
        let chars = service.characteristics ?? []
        let svcShort = String(service.uuid.uuidString.prefix(8))
        let charList = chars.map { c -> String in
            let cs = String(c.uuid.uuidString.prefix(8))
            return "\(svcShort)/\(cs)(\(propString(c.properties)))"
        }
        discoveredCharacteristics.append(contentsOf: charList)
        NSLog("[QRing] CHARS for service %@: %@", service.uuid.uuidString, charList.joined(separator: ", "))
        emitDebug()

        for char in chars {
            switch char.uuid {
            case Self.writeUUID:
                writeChar = char
                NSLog("[QRing] V1 writeChar set")
            case Self.notifyUUID:
                notifyChar = char
                peripheral.setNotifyValue(true, for: char)
                NSLog("[QRing] V1 notifyChar set + subscribed")
            case Self.writeUUIDv2:
                writeCharV2 = char
                NSLog("[QRing] V2 writeChar set (big-data / temperature)")
            case Self.notifyUUIDv2:
                notifyCharV2 = char
                peripheral.setNotifyValue(true, for: char)
                NSLog("[QRing] V2 notifyChar set + subscribed")
            case Self.firmwareRevUUID:
                peripheral.readValue(for: char)
            default:
                // Fallback heuristic — if exact UUIDs don't match (R09 variant),
                // pick the first write-capable characteristic as writeChar and
                // the first notify-capable one as notifyChar, skipping the
                // device info service.
                if service.uuid != Self.deviceInfoServiceUUID {
                    if writeChar == nil && (char.properties.contains(.write) || char.properties.contains(.writeWithoutResponse)) {
                        writeChar = char
                        NSLog("[QRing] fallback writeChar = %@", char.uuid.uuidString)
                    }
                    if notifyChar == nil && char.properties.contains(.notify) {
                        notifyChar = char
                        peripheral.setNotifyValue(true, for: char)
                        NSLog("[QRing] fallback notifyChar = %@", char.uuid.uuidString)
                    }
                }
            }
        }
        // If both chars are present (exact or fallback), we're good to go
        if writeChar != nil && notifyChar != nil && connectCall != nil {
            let id = peripheral.identifier.uuidString
            connectCall?.resolve([
                "connected": true,
                "deviceId": id,
                "mac": id,
                "name": peripheral.name ?? "QRing",
                "model": inferModel(from: peripheral.name ?? "")
            ])
            connectCall = nil
            notifyListeners("connected", data: [
                "deviceId": id,
                "mac": id,
                "name": peripheral.name ?? "QRing"
            ])
        }
    }

    private func propString(_ p: CBCharacteristicProperties) -> String {
        var parts: [String] = []
        if p.contains(.read)                 { parts.append("r") }
        if p.contains(.write)                { parts.append("w") }
        if p.contains(.writeWithoutResponse) { parts.append("W") }
        if p.contains(.notify)               { parts.append("n") }
        if p.contains(.indicate)             { parts.append("i") }
        return parts.joined()
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let data = characteristic.value else { return }
        if characteristic.uuid == Self.firmwareRevUUID {
            if let s = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
                firmwareRev = s
                NSLog("[QRing] firmware rev: \(s)")
                notifyListeners("firmwareRev", data: ["fwVersion": s])
            }
            return
        }
        // Route V1 vs V2 notifications — V2 uses big-data framing (temperature etc.)
        if characteristic.uuid == Self.notifyUUIDv2 || characteristic == notifyCharV2 {
            handleNotifyV2(data)
        } else {
            handleNotify(data)
        }
    }
}

// Compatibility alias because `Boolean` doesn't exist in Swift — we want `Bool`
private typealias Boolean = Bool
