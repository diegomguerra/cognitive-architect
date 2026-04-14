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
        CAPPluginMethod(name: "isAvailable",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan",    returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan",     returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect",   returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync",         returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableRealtime", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - Constants
    private static let serviceUUID = CBUUID(string: "6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E")
    private static let writeUUID   = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
    private static let notifyUUID  = CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E")

    // Standard Device Info Service
    private static let deviceInfoServiceUUID = CBUUID(string: "180A")
    private static let firmwareRevUUID       = CBUUID(string: "2A26")

    // Commands
    private static let CMD_SET_TIME:     UInt8 = 0x01
    private static let CMD_BATTERY:      UInt8 = 0x03
    private static let CMD_HR_HISTORY:   UInt8 = 0x15
    private static let CMD_HR_SETTINGS:  UInt8 = 0x16
    private static let CMD_SPO2_HISTORY: UInt8 = 0x2C
    private static let CMD_STRESS_HIST:  UInt8 = 0x37
    private static let CMD_HRV_HISTORY:  UInt8 = 0x39
    private static let CMD_STEPS_HIST:   UInt8 = 0x43
    private static let CMD_SLEEP_HIST:   UInt8 = 0x44
    private static let CMD_REALTIME:     UInt8 = 0x69
    private static let CMD_STOP_REALTIME: UInt8 = 0x6A

    private static let RT_TYPE_HR:   UInt8 = 0x01
    private static let RT_TYPE_SPO2: UInt8 = 0x03
    private static let RT_TYPE_HRV:  UInt8 = 0x0A

    private static let PACKET_SIZE = 16

    // MARK: - State
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?
    private var notifyChar: CBCharacteristic?
    private var firmwareRev: String?

    private var isScanning = false
    private var connectCall: CAPPluginCall?
    private var pendingSyncCall: CAPPluginCall?

    // Op queue (CoreBluetooth allows parallel writes w/o response, but we
    // still serialize for notify reliability).
    private var opQueue: [Data] = []
    private var opInFlight = false
    private let opLock = NSLock()

    // Sync buffers
    private var hrSamples: [[String: Any]] = []
    private var stepsSamples: [[String: Any]] = []
    private var sleepSamples: [[String: Any]] = []
    private var spo2Samples: [[String: Any]] = []
    private var hrvSamples: [[String: Any]] = []
    private var stressSamples: [[String: Any]] = []

    private var expectedHrPackets = -1
    private var receivedHrPackets = 0
    private var hrIntervalMinutes = 5
    private var hrDayEpoch: TimeInterval = 0

    private var expectedStepsPackets = -1
    private var receivedStepsPackets = 0

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
        call.resolve(["started": true])
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
        // CoreBluetooth requires retrievePeripherals to get a CBPeripheral
        // object for a given UUID (devices disappear from memory otherwise).
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
        central.connect(p, options: nil)
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
        hrSamples.removeAll()
        stepsSamples.removeAll()
        sleepSamples.removeAll()
        spo2Samples.removeAll()
        hrvSamples.removeAll()
        stressSamples.removeAll()
        expectedHrPackets = -1
        receivedHrPackets = 0
        expectedStepsPackets = -1
        receivedStepsPackets = 0

        // Sequence mirrors the Android plugin.
        sendSetTime()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self = self else { return }
            self.sendBattery()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.sendHRSettings(enable: true, intervalMinutes: 5) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.sendHRHistory(dayOffset: 0) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { self.sendStepsHistory(dayOffset: 0) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.sendSleepHistory(dayOffset: 0) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.sendSpo2History(dayOffset: 0) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { self.sendStressHistory(dayOffset: 0) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                if self.isHrvSupported() { self.sendHrvHistory(dayOffset: 0) }
            }
            // Resolve sync call after a quiet period
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) {
                if let c = self.pendingSyncCall {
                    c.resolve([
                        "hr_count": self.hrSamples.count,
                        "steps_count": self.stepsSamples.count,
                        "sleep_count": self.sleepSamples.count,
                        "spo2_count": self.spo2Samples.count,
                        "hrv_count": self.hrvSamples.count,
                        "stress_count": self.stressSamples.count,
                        "fw_version": self.firmwareRev ?? ""
                    ])
                    self.pendingSyncCall = nil
                }
                self.notifyListeners("syncEnd", data: ["type": "all"])
            }
        }
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
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_REALTIME
        pkt[1] = subType
        pkt[2] = 0x01
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
        call.resolve(["started": true])
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
        // Use .withoutResponse for speed — Colmi protocol doesn't ACK writes
        p.writeValue(data, for: wc, type: .withoutResponse)
        // Drain next after short delay (writeWithoutResponse has no callback)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.opLock.lock()
            self?.opInFlight = false
            self?.opLock.unlock()
            self?.drainQueue()
        }
    }

    // MARK: - Notify parser

    private func handleNotify(_ data: Data) {
        guard data.count >= 2 else { return }
        let bytes = [UInt8](data)
        let cmd = bytes[0]
        switch cmd {
        case Self.CMD_BATTERY:      parseBattery(bytes)
        case Self.CMD_HR_HISTORY:   parseHrHistory(bytes)
        case Self.CMD_HR_SETTINGS:  NSLog("[QRing] hr-settings ack")
        case Self.CMD_STEPS_HIST:   parseStepsHistory(bytes)
        case Self.CMD_SLEEP_HIST:   parseSleepHistory(bytes)
        case Self.CMD_SPO2_HISTORY: parseSpo2History(bytes)
        case Self.CMD_STRESS_HIST:  parseStressHistory(bytes)
        case Self.CMD_HRV_HISTORY:  parseHrvHistory(bytes)
        case Self.CMD_REALTIME:     parseRealtime(bytes)
        case Self.CMD_SET_TIME:     NSLog("[QRing] set-time ack")
        default:
            NSLog("[QRing] unhandled cmd 0x%02X", cmd)
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
            "ts": Date().timeIntervalSince1970 * 1000,
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
                "ts": Date().timeIntervalSince1970 * 1000,
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
                "ts": Date().timeIntervalSince1970 * 1000,
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
                "ts": Date().timeIntervalSince1970 * 1000,
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
        let type = b[1]
        let v = Int(b[2])
        switch type {
        case Self.RT_TYPE_HR:   notifyListeners("realtime", data: ["type": "hr_realtime",   "value": v])
        case Self.RT_TYPE_SPO2: notifyListeners("realtime", data: ["type": "spo2_realtime", "value": v])
        case Self.RT_TYPE_HRV:  notifyListeners("realtime", data: ["type": "hrv_realtime",  "value": v])
        default: break
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
            peripheral.discoverServices([Self.serviceUUID, Self.deviceInfoServiceUUID])
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
        for service in peripheral.services ?? [] {
            if service.uuid == Self.serviceUUID {
                peripheral.discoverCharacteristics([Self.writeUUID, Self.notifyUUID], for: service)
            } else if service.uuid == Self.deviceInfoServiceUUID {
                peripheral.discoverCharacteristics([Self.firmwareRevUUID], for: service)
            }
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil else { return }
        for char in service.characteristics ?? [] {
            switch char.uuid {
            case Self.writeUUID:
                writeChar = char
            case Self.notifyUUID:
                notifyChar = char
                peripheral.setNotifyValue(true, for: char)
            case Self.firmwareRevUUID:
                peripheral.readValue(for: char)
            default:
                break
            }
        }
        // If both chars on the UART service are present, we're good to go
        if writeChar != nil && notifyChar != nil {
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

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let data = characteristic.value else { return }
        if characteristic.uuid == Self.firmwareRevUUID {
            if let s = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
                firmwareRev = s
                NSLog("[QRing] firmware rev: \(s)")
            }
            return
        }
        if characteristic.uuid == Self.notifyUUID {
            handleNotify(data)
        }
    }
}

// Compatibility alias because `Boolean` doesn't exist in Swift — we want `Bool`
private typealias Boolean = Bool
