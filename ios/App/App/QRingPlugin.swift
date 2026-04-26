/**
 * QRingPlugin — Native Capacitor plugin for QRing (Colmi R02) smart ring.
 *
 * BLE Protocol:
 *   Service:  6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E (Nordic UART)
 *   Write:    6E400002-B5A3-F393-E0A9-E50E24DCCA9E (RX)
 *   Notify:   6E400003-B5A3-F393-E0A9-E50E24DCCA9E (TX)
 *   Packets:  16 bytes, byte[15] = checksum (sum of bytes[0..14] & 0xFF)
 *
 * Commands:
 *   0x01 = Set time (returns device capabilities)
 *   0x03 = Battery
 *   0x15 = HR history (288 readings/day @ 5 min)
 *   0x16 = HR auto-measurement settings
 *   0x43 = Steps history (96 entries/day @ 15 min)
 *   0x69 = Start real-time (HR=1, SpO2=3, HRV=10)
 *   0x6A = Stop real-time
 */

import Foundation
import CoreBluetooth
import Capacitor

// MARK: - Constants

private let UART_SERVICE    = CBUUID(string: "6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E")
private let UART_RX         = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E")  // Write
private let UART_TX         = CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E")  // Notify
private let DEVICE_INFO_SVC = CBUUID(string: "180A")
private let FW_VERSION_CHR  = CBUUID(string: "2A26")
private let HW_VERSION_CHR  = CBUUID(string: "2A27")

private let CMD_SET_TIME:      UInt8 = 0x01
private let CMD_BATTERY:       UInt8 = 0x03
private let CMD_HR_LOG:        UInt8 = 0x15
private let CMD_HR_SETTINGS:   UInt8 = 0x16
private let CMD_STEPS:         UInt8 = 0x43
private let CMD_RT_START:      UInt8 = 0x69
private let CMD_RT_STOP:       UInt8 = 0x6A

private let RT_TYPE_HR:   UInt8 = 0x01
private let RT_TYPE_SPO2: UInt8 = 0x03
private let RT_TYPE_HRV:  UInt8 = 0x0A

private let SCAN_TIMEOUT: TimeInterval = 15.0
private let SCAN_PHASE2_TIMEOUT: TimeInterval = 10.0
private let KNOWN_RING_NAMES: [String] = ["QRing", "R02", "Colmi", "RING", "R06", "R03"]

// MARK: - Plugin

@objc(QRingPlugin)
public class QRingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QRingPlugin"
    public let jsName = "QRingPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan",         returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan",          returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect",           returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect",        returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync",              returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableRealtime",    returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureAutoHR",   returnType: CAPPluginReturnPromise),
    ]

    private var centralManager: CBCentralManager!
    private var bleDelegate: QRingBLEDelegate!

    override public func load() {
        bleDelegate = QRingBLEDelegate(plugin: self)
        centralManager = CBCentralManager(delegate: bleDelegate, queue: DispatchQueue(label: "com.vyrlabs.qring.ble"))
    }

    // MARK: - Plugin Methods

    @objc func isAvailable(_ call: CAPPluginCall) {
        let state = centralManager.state
        call.resolve(["available": state == .poweredOn])
    }

    @objc func startScan(_ call: CAPPluginCall) {
        guard centralManager.state == .poweredOn else {
            call.reject("Bluetooth not available")
            return
        }
        bleDelegate.scanCall = call

        // Phase 1: scan by service UUID (finds unpaired rings)
        centralManager.scanForPeripherals(withServices: [UART_SERVICE], options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false
        ])

        // Phase 2: after phase 1 timeout, scan without service filter (finds rings connected to native app)
        DispatchQueue.main.asyncAfter(deadline: .now() + SCAN_TIMEOUT) { [weak self] in
            guard let self = self else { return }
            self.centralManager.stopScan()
            self.bleDelegate.scanPhase = .byName
            self.centralManager.scanForPeripherals(withServices: nil, options: [
                CBCentralManagerScanOptionAllowDuplicatesKey: false
            ])

            DispatchQueue.main.asyncAfter(deadline: .now() + SCAN_PHASE2_TIMEOUT) { [weak self] in
                self?.centralManager.stopScan()
                self?.bleDelegate.scanPhase = .byService
                if self?.bleDelegate.scanCall != nil {
                    self?.bleDelegate.scanCall?.resolve()
                    self?.bleDelegate.scanCall = nil
                }
            }
        }

        // Also try to reconnect to previously known peripherals
        bleDelegate.tryReconnectKnown(centralManager: centralManager)
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        centralManager.stopScan()
        bleDelegate.scanCall = nil
        call.resolve()
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let deviceId = call.getString("deviceId") else {
            call.reject("Missing deviceId")
            return
        }
        guard let peripheral = bleDelegate.discoveredPeripherals[deviceId] else {
            call.reject("Device not found. Scan first.")
            return
        }
        bleDelegate.connectCall = call
        bleDelegate.targetPeripheral = peripheral

        // Save device ID for future reconnection
        UserDefaults.standard.set(deviceId, forKey: "qring_last_device_id")

        centralManager.connect(peripheral, options: [
            CBConnectPeripheralOptionNotifyOnConnectionKey: true,
            CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
        ])

        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            if self?.bleDelegate.connectCall != nil {
                self?.centralManager.cancelPeripheralConnection(peripheral)
                self?.bleDelegate.connectCall?.reject("Connection timeout")
                self?.bleDelegate.connectCall = nil
            }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        if let p = bleDelegate.targetPeripheral {
            centralManager.cancelPeripheralConnection(p)
        }
        bleDelegate.cleanup()
        call.resolve()
    }

    @objc func sync(_ call: CAPPluginCall) {
        guard bleDelegate.isConnected else {
            call.reject("Not connected")
            return
        }
        let sinceStr = call.getString("since")
        bleDelegate.startSync(since: sinceStr, call: call)
    }

    @objc func enableRealtime(_ call: CAPPluginCall) {
        guard bleDelegate.isConnected else {
            call.reject("Not connected")
            return
        }
        guard let typeStr = call.getString("type") else {
            call.reject("Missing type")
            return
        }
        bleDelegate.startRealtime(type: typeStr, call: call)
    }

    @objc func configureAutoHR(_ call: CAPPluginCall) {
        guard bleDelegate.isConnected else {
            call.reject("Not connected")
            return
        }
        let interval = call.getInt("interval") ?? 5
        let enabled = call.getBool("enabled") ?? true
        bleDelegate.configureAutoHR(interval: interval, enabled: enabled, call: call)
    }
}

// MARK: - BLE Delegate

private enum ScanPhase {
    case byService
    case byName
}

private class QRingBLEDelegate: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    weak var plugin: QRingPlugin?
    var scanCall: CAPPluginCall?
    var connectCall: CAPPluginCall?
    var syncCall: CAPPluginCall?
    var realtimeCall: CAPPluginCall?
    var configCall: CAPPluginCall?

    var discoveredPeripherals: [String: CBPeripheral] = [:]
    var targetPeripheral: CBPeripheral?
    var writeChar: CBCharacteristic?
    var notifyChar: CBCharacteristic?
    var fwVersion: String?
    var battery: Int = -1
    var scanPhase: ScanPhase = .byService

    var isConnected: Bool { targetPeripheral?.state == .connected && writeChar != nil }

    /// Try to reconnect to a previously saved peripheral
    func tryReconnectKnown(centralManager: CBCentralManager) {
        guard let savedId = UserDefaults.standard.string(forKey: "qring_last_device_id"),
              let uuid = UUID(uuidString: savedId) else { return }
        let known = centralManager.retrievePeripherals(withIdentifiers: [uuid])
        for peripheral in known {
            let id = peripheral.identifier.uuidString
            if discoveredPeripherals[id] == nil {
                discoveredPeripherals[id] = peripheral
                let name = peripheral.name ?? "QRing (saved)"
                plugin?.notifyListeners("deviceFound", data: [
                    "deviceId": id,
                    "name": name,
                    "rssi": 0,
                    "vendor": "colmi",
                    "model": "R02",
                    "saved": true,
                ])
            }
        }
    }

    // Sync state
    private var syncSince: Date?
    private var syncPhase: SyncPhase = .idle
    private var hrPacketsExpected: Int = 0
    private var hrPacketsReceived: Int = 0
    private var hrInterval: Int = 5
    private var hrReadings: [(Date, Int)] = []
    private var hrBaseTimestamp: Date?
    private var stepsNewCalorie: Bool = false
    private var stepsSamples: [[String: Any]] = []
    private var syncDaysProcessed: Int = 0
    private var currentSyncDay: Int = 0
    private var pendingSamples: [String: [[String: Any]]] = [:]

    private enum SyncPhase {
        case idle, battery, setTime, hrSettings, hrLog, steps, realtimeSpO2, realtimeHRV, done
    }

    init(plugin: QRingPlugin) {
        self.plugin = plugin
        super.init()
    }

    func cleanup() {
        targetPeripheral = nil
        writeChar = nil
        notifyChar = nil
        fwVersion = nil
        battery = -1
        syncPhase = .idle
    }

    // MARK: - Central Manager Delegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {}

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""

        // Phase 2 (byName): only accept devices whose name matches known ring names
        if scanPhase == .byName {
            let upper = name.uppercased()
            let isKnown = KNOWN_RING_NAMES.contains { upper.contains($0.uppercased()) }
            if !isKnown { return }
        }

        let id = peripheral.identifier.uuidString
        discoveredPeripherals[id] = peripheral

        let displayName = name.isEmpty ? "QRing" : name
        plugin?.notifyListeners("deviceFound", data: [
            "deviceId": id,
            "name": displayName,
            "rssi": RSSI.intValue,
            "vendor": "colmi",
            "model": "R02"
        ])
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([UART_SERVICE, DEVICE_INFO_SVC])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        connectCall?.reject("Connection failed: \(error?.localizedDescription ?? "unknown")")
        connectCall = nil
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        plugin?.notifyListeners("disconnected", data: ["deviceId": peripheral.identifier.uuidString])
        cleanup()
    }

    // MARK: - Peripheral Delegate

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else {
            connectCall?.reject("Service discovery failed")
            connectCall = nil
            return
        }
        for service in peripheral.services ?? [] {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for char in service.characteristics ?? [] {
            switch char.uuid {
            case UART_RX:
                writeChar = char
            case UART_TX:
                notifyChar = char
                peripheral.setNotifyValue(true, for: char)
            case FW_VERSION_CHR:
                peripheral.readValue(for: char)
            default:
                break
            }
        }

        if writeChar != nil && notifyChar != nil {
            // Read battery first
            sendPacket(command: CMD_BATTERY)

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                guard let self = self else { return }
                self.connectCall?.resolve([
                    "connected": true,
                    "name": peripheral.name ?? "QRing",
                    "mac": peripheral.identifier.uuidString,
                    "model": "R02",
                    "fwVersion": self.fwVersion ?? "unknown",
                    "battery": self.battery
                ])
                self.connectCall = nil
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }

        if characteristic.uuid == FW_VERSION_CHR {
            fwVersion = String(data: data, encoding: .utf8)
            return
        }

        guard data.count == 16 else { return }
        let bytes = [UInt8](data)
        let cmd = bytes[0]

        switch cmd {
        case CMD_BATTERY:
            handleBattery(bytes)
        case CMD_SET_TIME:
            handleSetTimeResponse(bytes)
        case CMD_HR_LOG:
            handleHRLog(bytes)
        case CMD_HR_SETTINGS:
            handleHRSettings(bytes)
        case CMD_STEPS:
            handleSteps(bytes)
        case CMD_RT_START:
            handleRealtime(bytes)
        default:
            break
        }
    }

    // MARK: - Packet Builder

    private func makePacket(command: UInt8, subData: [UInt8] = []) -> Data {
        var packet = [UInt8](repeating: 0, count: 16)
        packet[0] = command
        for (i, byte) in subData.prefix(14).enumerated() {
            packet[i + 1] = byte
        }
        var sum: UInt16 = 0
        for i in 0..<15 { sum += UInt16(packet[i]) }
        packet[15] = UInt8(sum & 0xFF)
        return Data(packet)
    }

    private func sendPacket(command: UInt8, subData: [UInt8] = []) {
        guard let char = writeChar, let peripheral = targetPeripheral else { return }
        let data = makePacket(command: command, subData: subData)
        peripheral.writeValue(data, for: char, type: .withResponse)
    }

    // MARK: - Sync Orchestration

    func startSync(since sinceStr: String?, call: CAPPluginCall) {
        syncCall = call
        pendingSamples = [:]

        if let s = sinceStr {
            let fmt = ISO8601DateFormatter()
            syncSince = fmt.date(from: s)
        } else {
            syncSince = Calendar.current.date(byAdding: .day, value: -7, to: Date())
        }

        syncPhase = .setTime
        sendSetTime()
    }

    private func sendSetTime() {
        let cal = Calendar.current
        let now = Date()
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        let year = toBCD(UInt8((comps.year ?? 2026) % 100))
        let month = toBCD(UInt8(comps.month ?? 1))
        let day = toBCD(UInt8(comps.day ?? 1))
        let hour = toBCD(UInt8(comps.hour ?? 0))
        let minute = toBCD(UInt8(comps.minute ?? 0))
        let second = toBCD(UInt8(comps.second ?? 0))
        sendPacket(command: CMD_SET_TIME, subData: [year, month, day, hour, minute, second, 0x01])
    }

    private func advanceSync() {
        switch syncPhase {
        case .setTime:
            syncPhase = .hrSettings
            // Configure auto HR at 5-min interval
            sendPacket(command: CMD_HR_SETTINGS, subData: [0x02, 0x01, 0x05])
        case .hrSettings:
            syncPhase = .hrLog
            currentSyncDay = 0
            requestHRLog(dayOffset: 0)
        case .hrLog:
            currentSyncDay += 1
            let maxDays = daysToSync()
            if currentSyncDay < maxDays {
                requestHRLog(dayOffset: currentSyncDay)
            } else {
                emitSamples(type: "hr")
                syncPhase = .steps
                currentSyncDay = 0
                requestSteps(dayOffset: 0)
            }
        case .steps:
            currentSyncDay += 1
            let maxDays = daysToSync()
            if currentSyncDay < maxDays {
                requestSteps(dayOffset: currentSyncDay)
            } else {
                emitSamples(type: "steps")
                syncPhase = .realtimeSpO2
                startRealtimeMeasurement(type: RT_TYPE_SPO2)
            }
        case .realtimeSpO2:
            emitSamples(type: "spo2")
            syncPhase = .realtimeHRV
            startRealtimeMeasurement(type: RT_TYPE_HRV)
        case .realtimeHRV:
            emitSamples(type: "hrv")
            finishSync()
        default:
            finishSync()
        }
    }

    private func finishSync() {
        syncPhase = .done
        syncCall?.resolve(["success": true])
        syncCall = nil
        syncPhase = .idle
    }

    private func daysToSync() -> Int {
        guard let since = syncSince else { return 7 }
        let days = Calendar.current.dateComponents([.day], from: since, to: Date()).day ?? 7
        return min(max(days, 1), 30)
    }

    // MARK: - HR Log

    private func requestHRLog(dayOffset: Int) {
        hrReadings = []
        hrPacketsExpected = 0
        hrPacketsReceived = 0

        let midnight = Calendar.current.startOfDay(for: Calendar.current.date(byAdding: .day, value: -dayOffset, to: Date())!)
        let ts = UInt32(midnight.timeIntervalSince1970)
        let b0 = UInt8(ts & 0xFF)
        let b1 = UInt8((ts >> 8) & 0xFF)
        let b2 = UInt8((ts >> 16) & 0xFF)
        let b3 = UInt8((ts >> 24) & 0xFF)
        sendPacket(command: CMD_HR_LOG, subData: [b0, b1, b2, b3])
    }

    private func handleHRLog(_ bytes: [UInt8]) {
        let subType = bytes[1]

        if subType == 0xFF {
            // Error / no data for this day
            advanceSync()
            return
        }

        if subType == 0x00 {
            // Metadata packet
            hrPacketsExpected = Int(bytes[2])
            hrInterval = Int(bytes[3])
            if hrInterval == 0 { hrInterval = 5 }
            hrPacketsReceived = 0
            return
        }

        if subType == 0x17 {
            // End-of-today marker — flush
            flushHRReadings()
            advanceSync()
            return
        }

        hrPacketsReceived += 1

        if subType == 0x01 {
            // First data packet: timestamp + 9 readings
            let ts = UInt32(bytes[2]) | (UInt32(bytes[3]) << 8) | (UInt32(bytes[4]) << 16) | (UInt32(bytes[5]) << 24)
            hrBaseTimestamp = Date(timeIntervalSince1970: TimeInterval(ts))
            for i in 6..<15 {
                let hr = Int(bytes[i])
                if hr > 0 {
                    let offset = (i - 6) * hrInterval * 60
                    let t = hrBaseTimestamp!.addingTimeInterval(TimeInterval(offset))
                    hrReadings.append((t, hr))
                }
            }
        } else {
            // Subsequent packets: 13 readings each
            let baseIndex = 9 + (Int(subType) - 2) * 13
            for i in 2..<15 {
                let hr = Int(bytes[i])
                if hr > 0, let base = hrBaseTimestamp {
                    let readingIndex = baseIndex + (i - 2)
                    let offset = readingIndex * hrInterval * 60
                    let t = base.addingTimeInterval(TimeInterval(offset))
                    hrReadings.append((t, hr))
                }
            }
        }

        if hrPacketsReceived >= hrPacketsExpected && hrPacketsExpected > 0 {
            flushHRReadings()
            advanceSync()
        }
    }

    private func flushHRReadings() {
        let fmt = ISO8601DateFormatter()
        var samples: [[String: Any]] = pendingSamples["hr"] ?? []
        for (ts, value) in hrReadings {
            samples.append([
                "type": "hr",
                "ts": fmt.string(from: ts),
                "value": value,
                "source": "qring_ble"
            ])
        }
        pendingSamples["hr"] = samples
        hrReadings = []
    }

    // MARK: - HR Settings

    func configureAutoHR(interval: Int, enabled: Bool, call: CAPPluginCall) {
        configCall = call
        let enableByte: UInt8 = enabled ? 0x01 : 0x02
        let intervalByte = UInt8(min(max(interval, 1), 60))
        sendPacket(command: CMD_HR_SETTINGS, subData: [0x02, enableByte, intervalByte])
    }

    private func handleHRSettings(_ bytes: [UInt8]) {
        if bytes[1] == 0x01 {
            // Read response
            let enabled = bytes[2] == 0x01
            let interval = Int(bytes[3])
            configCall?.resolve(["enabled": enabled, "interval": interval])
            configCall = nil
        }
        if syncPhase == .hrSettings {
            advanceSync()
        }
    }

    // MARK: - Steps

    private func requestSteps(dayOffset: Int) {
        stepsSamples = []
        stepsNewCalorie = false
        sendPacket(command: CMD_STEPS, subData: [UInt8(dayOffset), 0x0F, 0x00, 0x5F, 0x01])
    }

    private func handleSteps(_ bytes: [UInt8]) {
        if bytes[1] == 0xFF {
            advanceSync()
            return
        }

        if bytes[1] == 0xF0 {
            stepsNewCalorie = bytes[3] == 0x01
            return
        }

        let year = 2000 + fromBCD(bytes[1])
        let month = fromBCD(bytes[2])
        let day = fromBCD(bytes[3])
        let timeIndex = Int(bytes[4])
        let currentPkt = Int(bytes[5])
        let totalPkts = Int(bytes[6])

        var calories = Int(bytes[7]) | (Int(bytes[8]) << 8)
        if stepsNewCalorie { calories *= 10 }
        let steps = Int(bytes[9]) | (Int(bytes[10]) << 8)
        let distance = Int(bytes[11]) | (Int(bytes[12]) << 8)

        let hour = timeIndex / 4
        let minute = (timeIndex % 4) * 15

        var comps = DateComponents()
        comps.year = year; comps.month = month; comps.day = day
        comps.hour = hour; comps.minute = minute; comps.second = 0
        comps.timeZone = TimeZone.current

        if let ts = Calendar.current.date(from: comps), steps > 0 {
            let fmt = ISO8601DateFormatter()
            var samples: [[String: Any]] = pendingSamples["steps"] ?? []
            samples.append([
                "type": "steps",
                "ts": fmt.string(from: ts),
                "value": steps,
                "payload": ["calories": calories, "distance_m": distance],
                "source": "qring_ble"
            ])
            pendingSamples["steps"] = samples
        }

        if currentPkt >= totalPkts - 1 || totalPkts == 0 {
            advanceSync()
        }
    }

    // MARK: - Real-time Measurements

    private var realtimeType: UInt8 = 0
    private var realtimeReadings: [Int] = []
    private var realtimeTimer: DispatchWorkItem?
    private let REALTIME_READINGS_NEEDED = 6
    private let REALTIME_TIMEOUT: TimeInterval = 30.0

    func startRealtime(type: String, call: CAPPluginCall) {
        realtimeCall = call
        switch type {
        case "hr":   realtimeType = RT_TYPE_HR
        case "spo2": realtimeType = RT_TYPE_SPO2
        case "hrv":  realtimeType = RT_TYPE_HRV
        default:
            call.reject("Unknown type: \(type)")
            return
        }
        startRealtimeMeasurement(type: realtimeType)
    }

    private func startRealtimeMeasurement(type: UInt8) {
        realtimeType = type
        realtimeReadings = []
        sendPacket(command: CMD_RT_START, subData: [type, 0x01])

        let timer = DispatchWorkItem { [weak self] in
            self?.stopRealtimeMeasurement()
        }
        realtimeTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + REALTIME_TIMEOUT, execute: timer)
    }

    private func stopRealtimeMeasurement() {
        realtimeTimer?.cancel()
        realtimeTimer = nil
        sendPacket(command: CMD_RT_STOP, subData: [realtimeType])

        let fmt = ISO8601DateFormatter()
        let now = fmt.string(from: Date())

        if !realtimeReadings.isEmpty {
            let avg = realtimeReadings.reduce(0, +) / realtimeReadings.count
            let typeStr: String
            switch realtimeType {
            case RT_TYPE_HR:   typeStr = "hr"
            case RT_TYPE_SPO2: typeStr = "spo2"
            case RT_TYPE_HRV:  typeStr = "hrv"
            default:           typeStr = "unknown"
            }

            var samples: [[String: Any]] = pendingSamples[typeStr] ?? []
            samples.append([
                "type": typeStr,
                "ts": now,
                "value": avg,
                "source": "qring_ble_realtime"
            ])
            pendingSamples[typeStr] = samples
        }

        if syncPhase != .idle && syncPhase != .done {
            advanceSync()
        } else {
            realtimeCall?.resolve(["success": true])
            realtimeCall = nil
        }
    }

    private func handleRealtime(_ bytes: [UInt8]) {
        let type = bytes[1]
        let error = bytes[2]
        let value = Int(bytes[3])

        guard error == 0x00, value > 0 else { return }
        realtimeReadings.append(value)

        let typeStr: String
        switch type {
        case RT_TYPE_HR:   typeStr = "hr"
        case RT_TYPE_SPO2: typeStr = "spo2"
        case RT_TYPE_HRV:  typeStr = "hrv"
        default:           typeStr = "unknown"
        }

        plugin?.notifyListeners("realtimeReading", data: [
            "type": typeStr,
            "value": value
        ])

        if realtimeReadings.count >= REALTIME_READINGS_NEEDED {
            stopRealtimeMeasurement()
        }
    }

    // MARK: - Battery

    private func handleBattery(_ bytes: [UInt8]) {
        battery = Int(bytes[1])
        let charging = bytes[2] == 0x01

        plugin?.notifyListeners("battery", data: [
            "level": battery,
            "charging": charging
        ])
    }

    // MARK: - Set Time Response (Capabilities)

    private func handleSetTimeResponse(_ bytes: [UInt8]) {
        // bytes[13] bit 5 = HRV support, bit 4 = Pressure support
        if syncPhase == .setTime {
            advanceSync()
        }
    }

    // MARK: - Emit Samples to JS

    private func emitSamples(type: String) {
        guard let samples = pendingSamples[type], !samples.isEmpty else { return }
        plugin?.notifyListeners("syncData", data: [
            "type": type,
            "samples": samples
        ])
        plugin?.notifyListeners("syncEnd", data: ["type": type])
    }

    // MARK: - Helpers

    private func toBCD(_ val: UInt8) -> UInt8 {
        return ((val / 10) << 4) | (val % 10)
    }

    private func fromBCD(_ val: UInt8) -> Int {
        return Int((val >> 4) & 0x0F) * 10 + Int(val & 0x0F)
    }
}
