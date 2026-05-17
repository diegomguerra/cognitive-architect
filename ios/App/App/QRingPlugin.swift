import Foundation
import Capacitor
import CoreBluetooth
import RingParsers

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
        CAPPluginMethod(name: "setSensorAuto",   returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "measureNow",      returnType: CAPPluginReturnPromise),
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

    // JStyle X3/X5 Ring — FFF0 service, FFF6 write, FFF7 notify
    // Same CMD IDs as Colmi but variable-length responses
    private static let jstyleServiceUUID = CBUUID(string: "FFF0")
    private static let jstyleWriteUUID   = CBUUID(string: "FFF6")
    private static let jstyleNotifyUUID  = CBUUID(string: "FFF7")

    // Standard Device Info Service
    private static let deviceInfoServiceUUID = CBUUID(string: "180A")
    private static let firmwareRevUUID       = CBUUID(string: "2A26")

    private enum DeviceVendor: String { case colmi, jstyle, unknown }

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

    // JStyle X3/X5 Commands (different CMD IDs from Colmi)
    private static let JS_CMD_SET_TIME:      UInt8 = 0x01  // same as Colmi
    private static let JS_CMD_SET_USER:      UInt8 = 0x02
    // cmd 0x78 ppgWithMode — PPG/RR/PPI realtime stream.
    // Confirmed via disassembly of libBleSDK.a (vendor-sdks/X3 SDK) on 2026-05-05.
    // The previous 0x11 ("REALTIME_PPI") was a guess from a non-official source
    // and never produced data on the X5 firmware.
    // Layout: [0x78, mode, status, ...0..., crc]
    //   mode 1 = start, 2 = send result, 3 = stop, 4 = progress (status=pct), 5 = quit
    private static let JS_CMD_PPG: UInt8 = 0x78
    private static let JS_CMD_BATTERY:       UInt8 = 0x13
    // NOTE: removed phantom cmds that don't exist in official SDK X3:
    //   0x14 (was REALTIME_TEMP — only AutomaticTemperature 0x62 exists)
    //   0x55 (was GET_ONCE_HR — single HR not exposed in SDK X3)
    //   0x11 (was REALTIME_PPI — replaced by 0x78 ppgWithMode above)
    private static let JS_CMD_GET_VERSION:   UInt8 = 0x27
    private static let JS_CMD_MEASUREMENT:   UInt8 = 0x28  // manual HR/SpO2
    private static let JS_CMD_SET_AUTO:      UInt8 = 0x2A  // auto-monitoring config
    private static let JS_CMD_GET_AUTO:      UInt8 = 0x2B
    private static let JS_CMD_GET_TOTAL:     UInt8 = 0x51  // daily step totals
    private static let JS_CMD_GET_DETAIL:    UInt8 = 0x52  // 10-min activity detail
    private static let JS_CMD_GET_SLEEP:     UInt8 = 0x53  // sleep history
    private static let JS_CMD_GET_HR:        UInt8 = 0x54  // continuous HR history
    // 0x55 GET_ONCE_HR removed — phantom cmd, not in SDK
    private static let JS_CMD_GET_HRV:       UInt8 = 0x56  // HRV + stress + BP
    // SpO2 history — 2 cmds distintos no SDK X3 (decifrados via libBleSDK.a 2026-05-10):
    //   0x66 = GetAutomaticSpo2DataWithMode  → histórico das medições auto (pareadas com SetAuto dataType=2)
    //   0x57 = GetContinuousSpO2DataWithMode → histórico modo contínuo (apenas se ativado)
    // Build 370 troca o cmd primário 0x57 → 0x66, pois o que configuramos via SetAuto
    // é Automatic SpO2, não Continuous. Ambos vão na fila como fallback.
    private static let JS_CMD_GET_SPO2:      UInt8 = 0x66  // automatic SpO2 history (PRIMARY)
    private static let JS_CMD_GET_SPO2_CONT: UInt8 = 0x57  // continuous SpO2 history (fallback)
    private static let JS_CMD_GET_TEMP:      UInt8 = 0x62  // temperature history
    private static let JS_CMD_GET_PPI:       UInt8 = 0x63  // PPI/RRI history

    // V2 Commands
    private static let CMD_BIG_DATA_V2:         UInt8 = 0xBC
    private static let BIG_DATA_TYPE_TEMP:      UInt8 = 0x25
    private static let BIG_DATA_TYPE_SLEEP:     UInt8 = 0x27  // build 411: R09 sleep via Big Data V2

    private static let RT_TYPE_HR:   UInt8 = 0x01
    private static let RT_TYPE_SPO2: UInt8 = 0x03
    private static let RT_TYPE_HRV:  UInt8 = 0x0A

    private static let PACKET_SIZE = 16

    // Feature flags (runtime-configurable via sync options)
    // - historyEnabled: send V1 history commands (0x15 HR, 0x43 Steps, 0x44 Sleep,
    //   0x2C SpO2, 0x37 Stress, 0x39 HRV). ON by default — R09 history is the
    //   primary source for SpO2/HRV/Stress (realtime returns all zeros for these).
    // - debugRawEnabled: emit EVERY notify packet as a `debug_raw` sample. Always ON
    //   until parser is validated, so we keep a reverse-engineering corpus.
    private var historyEnabled = true
    private var debugRawEnabled = true

    // MARK: - State
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var deviceVendor: DeviceVendor = .unknown
    /// Vendor-specific parser from the RingParsers SPM package. Currently used
    /// for JStyle paths (realtime, stress stream). Colmi paths still use the
    /// in-file parsers below until ColmiParser is implemented in the package.
    private let jstyleParser = JStyleParser()
    private var writeChar: CBCharacteristic?
    private var notifyChar: CBCharacteristic?
    // V2 characteristics (temperature). Optional — not all rings have them.
    private var writeCharV2: CBCharacteristic?
    private var notifyCharV2: CBCharacteristic?
    private var firmwareRev: String?

    private var isScanning = false
    /// Retain discovered peripherals so CoreBluetooth does not GC them before connect
    private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
    private var connectCall: CAPPluginCall?
    /// Build 412: tracking pra auto-retry quando didDiscoverServices não dispara
    /// em 8s (sintoma de "pairing órfão" — anel tem stale bonding e ignora
    /// service discovery). Retry máximo 1x; após isso reject com mensagem clara.
    private var connectRetryCount: Int = 0
    private var connectStaleTimer: DispatchWorkItem?
    private var connectingDeviceId: String?
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

    // JStyle history pagination state
    private var jsPendingHistoryCmd: UInt8 = 0  // CMD awaiting continuation
    private var jsHistoryQueue: [UInt8] = []    // remaining history CMDs to request
    private var jsHistoryStepTimer: DispatchWorkItem?  // safety: skip stalled step after 12s
    private var jsPPGProgressTimer: Timer?             // 1Hz keepalive while measuring
    private var jsPPGStopTimer: Timer?                 // fires once at durationSec
    private var jsPPGStartedAt: Date?                  // measurement window start
    private var jsPPGDurationSec: Int = 60             // configured window length

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
        // State restoration keeps the BLE session alive when iOS suspends the
        // app (screen lock, backgrounding). Without it, `tela fecha = peripheral
        // stale = reconnect needs manual click`. The restore identifier must be
        // a stable string per-app. willRestoreState below rehydrates the
        // peripheral so a connect call right after wake works.
        central = CBCentralManager(
            delegate: self,
            queue: DispatchQueue.main,
            options: [CBCentralManagerOptionRestoreIdentifierKey: "VyrQRingCentral"]
        )
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
                "vendor": inferVendor(from: name).rawValue,
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
        // Try retained peripheral first, then system cache
        let p: CBPeripheral
        if let retained = discoveredPeripherals[uuid] {
            p = retained
        } else if let retrieved = central.retrievePeripherals(withIdentifiers: [uuid]).first {
            p = retrieved
        } else {
            call.reject("DEVICE_NOT_FOUND (scan again and try)")
            return
        }
        connectCall = call
        connectingDeviceId = deviceId
        connectRetryCount = 0
        if central.isScanning { central.stopScan() }
        isScanning = false
        peripheral = p
        p.delegate = self
        deviceVendor = inferVendor(from: p.name ?? "")
        UserDefaults.standard.set(deviceId, forKey: Self.LS_LAST_DEVICE_ID)
        attemptConnect(p)
    }

    /// Build 412: encapsula a connect+timeout logic pra suportar retry.
    /// Aciona retry automático após 8s sem didDiscoverServices (sintoma de
    /// "pairing órfão" — anel mantém bonding cache que o iOS está usando
    /// mas o anel não reconhece mais, então ignora service discovery).
    /// Retry máximo 1x; depois reject com mensagem clara.
    private func attemptConnect(_ p: CBPeripheral) {
        discoveredServices.removeAll()
        discoveredCharacteristics.removeAll()
        central.connect(p, options: [
            CBConnectPeripheralOptionNotifyOnConnectionKey: true,
            CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
        ])
        // Stale-bonding detection: se em 8s não tivermos discoveredServices, é
        // sintoma de pairing órfão. Tenta retry 1x antes de desistir.
        connectStaleTimer?.cancel()
        let staleWork = DispatchWorkItem { [weak self] in
            guard let self = self, self.connectCall != nil else { return }
            if self.discoveredServices.isEmpty && self.connectRetryCount == 0 {
                NSLog("[QRing] stale bonding detected (services=0 in 8s) — retrying once")
                self.connectRetryCount += 1
                self.central.cancelPeripheralConnection(p)
                // 2s pra liberar bonding cache no iOS antes do retry
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                    guard let self = self, self.connectCall != nil else { return }
                    self.attemptConnect(p)
                }
            }
        }
        connectStaleTimer = staleWork
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.0, execute: staleWork)

        // 20s hard timeout (somando retry). Reject com diagnóstico claro.
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self = self, self.connectCall != nil else { return }
            self.connectStaleTimer?.cancel()
            self.connectStaleTimer = nil
            self.central.cancelPeripheralConnection(p)
            let st = self.central.state.rawValue
            let retried = self.connectRetryCount > 0 ? " (após \(self.connectRetryCount) retry)" : ""
            self.lastError = "CONNECT_TIMEOUT 20s\(retried) (state=\(st), services=\(self.discoveredServices.count), chars=\(self.discoveredCharacteristics.count))"
            self.emitDebug()
            let errCode = self.discoveredServices.isEmpty
                ? "STALE_BONDING_OR_OUT_OF_RANGE: desligue Bluetooth do iPhone por 30s e tente de novo, ou coloque anel no carregador 2min"
                : "CONNECT_TIMEOUT"
            self.connectCall?.reject(errCode)
            self.connectCall = nil
            self.connectRetryCount = 0
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

    /// JS: setSensorAuto({ type: 'hr'|'spo2'|'temp'|'hrv', intervalMin: number, enable: bool })
    /// Configura auto-monitoring de um biomarker no JStyle (cmd 0x2A).
    /// HR=verde 5min, SpO2=vermelho 30min, Temp 30min, HRV=azul 30min.
    @objc func setSensorAuto(_ call: CAPPluginCall) {
        guard peripheral != nil, writeChar != nil else {
            call.reject("NOT_CONNECTED"); return
        }
        let typeStr = (call.getString("type") ?? "").lowercased()
        let intervalMin = call.getInt("intervalMin") ?? 30
        let enable = call.getBool("enable") ?? true

        let dataType: UInt8
        switch typeStr {
        case "hr":   dataType = 1
        case "spo2": dataType = 2
        case "temp": dataType = 3
        case "hrv":  dataType = 4
        default:
            call.reject("INVALID_TYPE: \(typeStr) — use hr|spo2|temp|hrv"); return
        }

        if deviceVendor == .jstyle {
            jsSendAutoMonitoring(dataType: dataType, intervalMin: enable ? intervalMin : 0)
            // intervalMin=0 efetivamente desativa (anel não dispara)
            call.resolve(["type": typeStr, "intervalMin": intervalMin, "enable": enable])
        } else {
            call.reject("NOT_JSTYLE: vendor=\(deviceVendor.rawValue)")
        }
    }

    /// JS: measureNow({ type: 'hr'|'spo2', durationSec: number })
    /// Dispara medição manual one-shot (cmd 0x28). dataType 2=HR, 3=SpO2.
    /// Min duration 30s. Resultado vem via notification handler já wired.
    @objc func measureNow(_ call: CAPPluginCall) {
        guard peripheral != nil, writeChar != nil else {
            call.reject("NOT_CONNECTED"); return
        }
        let typeStr = (call.getString("type") ?? "").lowercased()
        let durationSec = max(30, call.getInt("durationSec") ?? 30)

        let dataType: UInt8
        switch typeStr {
        case "hr":   dataType = 2  // SDK datatype
        case "spo2": dataType = 3
        default:
            call.reject("INVALID_TYPE: only hr or spo2 supported (use setSensorAuto for temp/hrv)"); return
        }

        if deviceVendor == .jstyle {
            var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
            pkt[0] = Self.JS_CMD_MEASUREMENT
            pkt[1] = dataType
            pkt[2] = 0x01  // openFlag = start
            pkt[4] = UInt8(durationSec & 0xFF)
            pkt[5] = UInt8((durationSec >> 8) & 0xFF)
            pkt[15] = checksum(pkt)
            queueWrite(Data(pkt))
            call.resolve(["type": typeStr, "durationSec": durationSec, "started": true])
        } else {
            call.reject("NOT_JSTYLE: vendor=\(deviceVendor.rawValue)")
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        if let p = peripheral {
            central.cancelPeripheralConnection(p)
        }
        peripheral = nil
        discoveredPeripherals.removeAll()
        deviceVendor = .unknown
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
        jsPendingHistoryCmd = 0
        jsHistoryQueue.removeAll()
        jsHistoryStepTimer?.cancel()
        jsHistoryStepTimer = nil
        jsStopPPGMeasurement(notify: false)

        // Late vendor detection: on reconnect from saved UUID, peripheral.name
        // may be nil at connect time. Re-check now that connection is established.
        if deviceVendor == .unknown || deviceVendor == .colmi {
            if let name = peripheral?.name, !name.isEmpty {
                let detected = inferVendor(from: name)
                if detected != .unknown && detected != deviceVendor {
                    deviceVendor = detected
                    NSLog("[QRing] Late vendor re-detection: '%@' -> %@", name, detected.rawValue)
                }
            }
        }

        // JStyle X3/X5 — use JStyle-specific sync sequence
        if deviceVendor == .jstyle {
            syncJStyle()
            return
        }

        // --- Colmi R09 sync: HISTORY FIRST, then REALTIME ---
        //
        // Phase 1: Setup + auto-measurement enables
        sendSetTime()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            self?.sendBattery()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.sendTemperaturePref(enable: true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            self?.sendHRSettings(enable: true, intervalMinutes: 5)
        }
        // Enable auto-measurements (persist on ring across disconnects).
        // Each CMD activates a different sensor channel + LED:
        //   CMD 0x16 (HR Settings, sent above) → green LED, every 5 min
        //   CMD 0x2C (SpO2 history WRITE) → red LED, every 30 min
        //   CMD 0x37 (Stress WRITE) → PPG-derived autonomic balance, 30 min
        //   CMD 0x39 (HRV WRITE) → blue/IR LED, 30 min (firmware >= 3.10)
        // Symmetric to JStyle Phase 2 (jsSendAutoMonitoring dataType=1/2/3/4).
        // Bug pre-build 359: Stress/HRV used intervalMinutes=0, which sets
        // pkt[3]=0 — ring interprets as "no continuous capture" so the LED
        // and sensor never activate. Fixed by using 30 min interval for both.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.sendAutoMeasurementEnable(cmd: Self.CMD_SPO2_HISTORY, intervalMinutes: 30)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.sendAutoMeasurementEnable(cmd: Self.CMD_STRESS_HIST, intervalMinutes: 30)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            if self?.isHrvSupported() == true {
                self?.sendAutoMeasurementEnable(cmd: Self.CMD_HRV_HISTORY, intervalMinutes: 30)
            }
        }

        // Phase 2: V2 Big Data history (Colmi only - JStyle has no V2 channel).
        // Build 411: alem de temp, pede Sleep via sub-id 0x27 (=39 decimal).
        // Cmd 0x44 V1 sleep history retorna erro no R09; Big Data V2 e o caminho.
        // Resposta vai pra debug_raw - parser virá em build 412+ apos inspecao bytes.
        if deviceVendor != .jstyle {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.sendTemperatureHistoryRequest()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                self?.sendSleepHistoryRequest()
            }
        }

        // Phase 3: V1 History commands — primary data source
        // Each command gets 2.5s window for multi-packet response
        if historyEnabled {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                self?.sendHRHistory(dayOffset: 0)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.5) { [weak self] in
                self?.sendStepsHistory(dayOffset: 0)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) { [weak self] in
                self?.sendSpo2History()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 8.5) { [weak self] in
                self?.sendStressHistory()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 9.0) { [weak self] in
                if self?.isHrvSupported() == true { self?.sendHrvHistory() }
            }
        }

        // Phase 4: Realtime HR for RR interval collection (AFTER history completes)
        DispatchQueue.main.asyncAfter(deadline: .now() + 11.0) { [weak self] in
            guard self?.pendingSyncCall != nil else { return }
            self?.sendRealtime(type: Self.RT_TYPE_HR)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25.0) { [weak self] in
            guard self?.pendingSyncCall != nil else { return }
            self?.sendRealtimeContinue(type: Self.RT_TYPE_HR)
        }

        // Phase 5: Resolve at t+32s — stop realtime, derive, flush
        DispatchQueue.main.asyncAfter(deadline: .now() + 32.0) { [weak self] in
            guard let self = self else { return }
            self.sendRealtimeStop(type: Self.RT_TYPE_HR)
            self.snapshotForDerive()
            self.flushRealtimeBatch(type: "hr", samples: &self.realtimeHrSamples)
            self.flushRealtimeBatch(type: "spo2", samples: &self.realtimeSpo2Samples)
            self.flushRealtimeBatch(type: "hrv", samples: &self.realtimeHrvSamples)
            // Build 409: força flush de history buffers Colmi (steps, spo2, sleep)
            // que dependiam do header packet subIdx==0 — anel R09 frequentemente
            // não emite o header, deixando samples no buffer pra sempre. Aqui
            // garantimos que qualquer dado acumulado vai pro upload.
            if !self.stepsSamples.isEmpty {
                self.notifyListeners("syncData", data: ["type": "steps", "samples": self.stepsSamples])
                self.stepsSamples.removeAll()
            }
            if !self.spo2Samples.isEmpty {
                self.notifyListeners("syncData", data: ["type": "spo2", "samples": self.spo2Samples])
                self.spo2Samples.removeAll()
            }
            if !self.sleepSamples.isEmpty {
                self.notifyListeners("syncData", data: ["type": "sleep", "samples": self.sleepSamples])
                self.sleepSamples.removeAll()
            }
            self.deriveBiomarkers()
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
                    "rr_count": self.realtimeRRIntervals.count,
                    "fw_version": self.firmwareRev ?? "",
                    "history_enabled": self.historyEnabled,
                    "debug_raw_enabled": self.debugRawEnabled,
                    "vendor": self.deviceVendor.rawValue,
                ])
                self.pendingSyncCall = nil
            }
            self.notifyListeners("syncEnd", data: ["type": "all"])
        }
    }

    // MARK: - JStyle Sync Sequence

    /// JStyle X3/X5 sync — uses JStyle-specific command IDs and pagination protocol.
    /// History uses mode-based pagination: b[1]=0x00 start, 0x02 continue, 0x99 delete.
    private func syncJStyle() {
        // Phase 1: Setup (t+0s)
        jsSendSetTime()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.jsSendBattery()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            self?.jsSendGetVersion()
        }

        // Phase 2: Configure auto-monitoring — ALL 4 sensor channels (each one
        // also activates the corresponding LED on the ring's optical sensor):
        //   dataType=1 → HR    (green LED, every 5 min)
        //   dataType=2 → SpO2  (red LED, every 30 min)
        //   dataType=3 → Temp  (skin temp probe, every 30 min)
        //   dataType=4 → HRV   (blue/IR LED, every 30 min) — fires PPI for variability
        // Persisting on the ring across disconnects, so even if the user closes
        // the app the X5 keeps logging continuously.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.jsSendAutoMonitoring(dataType: 1, intervalMin: 5)   // HR (green LED)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.3) { [weak self] in
            self?.jsSendAutoMonitoring(dataType: 2, intervalMin: 30)  // SpO2 (red LED)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in
            self?.jsSendAutoMonitoring(dataType: 3, intervalMin: 30)  // Temp
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.9) { [weak self] in
            self?.jsSendAutoMonitoring(dataType: 4, intervalMin: 30)  // HRV (blue LED)
        }

        // Phase 3: History retrieval (t+2s) — sequential via pagination queue
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            guard let self = self else { return }
            self.jsHistoryQueue = [
                Self.JS_CMD_GET_HR,     // 0x54 continuous HR
                Self.JS_CMD_GET_HRV,    // 0x56 HRV + stress
                Self.JS_CMD_GET_SPO2,      // 0x66 Automatic SpO2 history (primary)
                Self.JS_CMD_GET_SPO2_CONT, // 0x57 Continuous SpO2 (fallback)
                Self.JS_CMD_GET_TEMP,   // 0x62 temperature
                Self.JS_CMD_GET_TOTAL,  // 0x51 daily steps
                Self.JS_CMD_GET_SLEEP,  // 0x53 sleep
            ]
            self.jsRequestNextHistory()
        }

        // Phase 4: Auto-capture PPG 30s (build 405, ajustado em 406).
        // Build 405 colocou Phase 4 em t+45s, mas sync do Diego encerrou em 38s
        // (BLE disconnect prematuro após history dump) — Phase 4 não disparava
        // a tempo. Build 406 move pra t+5s, rodando em PARALELO com Phase 3
        // history queue. PPG (cmd 0x78) usa canal de notify independente da
        // pagination — BLE notify channel suporta interleave. Captura completa
        // de 30s termina em t+35s, bem antes do disconnect típico (~38s).
        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self] in
            guard let self = self else { return }
            NSLog("[QRing] JS sync Phase 4: auto-PPG capture 30s start (t+5s, parallel with history)")
            self.jsStartPPGMeasurement(durationSec: 30)
        }

        // Phase 6: Resolve (t+90s)
        // 35s → 75s em build 404, 75s → 90s em 405. Mantém 90s no 406 mesmo
        // com Phase 4 antecipada — buffer pra late history packets + PPG flush.
        DispatchQueue.main.asyncAfter(deadline: .now() + 90.0) { [weak self] in
            guard let self = self else { return }
            // Cancel remaining history queue + timer so late responses don't
            // leak into the next sync session.
            self.jsHistoryStepTimer?.cancel()
            self.jsHistoryStepTimer = nil
            self.jsHistoryQueue.removeAll()
            self.jsPendingHistoryCmd = 0
            // Idempotent stop — covers the case where a Medir Agora session is
            // still running concurrently with sync end.
            self.jsStopPPGMeasurement(notify: false)
            // Snapshot HR + RR for deriveBiomarkers BEFORE flush clears the arrays
            self.snapshotForDerive()
            // Flush any remaining history samples that arrived after their FF marker
            self.flushJStyleType("hr", &self.hrSamples)
            self.flushJStyleType("hrv", &self.hrvSamples)
            self.flushJStyleType("stress", &self.stressSamples)
            self.flushJStyleType("spo2", &self.spo2Samples)
            self.flushJStyleType("temp", &self.tempSamples)
            self.flushJStyleType("steps", &self.stepsSamples)
            self.flushJStyleType("sleep", &self.sleepSamples)
            self.flushRealtimeBatch(type: "hr", samples: &self.realtimeHrSamples)
            self.flushRealtimeBatch(type: "spo2", samples: &self.realtimeSpo2Samples)
            self.flushRealtimeBatch(type: "hrv", samples: &self.realtimeHrvSamples)
            self.deriveBiomarkers()
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
                    "rr_count": self.realtimeRRIntervals.count,
                    "fw_version": self.firmwareRev ?? "",
                    "vendor": self.deviceVendor.rawValue,
                    "history_enabled": self.historyEnabled,
                    "debug_raw_enabled": self.debugRawEnabled,
                ])
                self.pendingSyncCall = nil
            }
            self.notifyListeners("syncEnd", data: ["type": "all"])
        }
    }

    /// Request next history command from queue. Called after each history completes.
    /// Includes a 12s safety timeout per step — some firmwares don't emit a
    /// reliable end marker for every history type (e.g. HRV 0x56 sometimes never
    /// raises FF), which used to stall the queue and prevent downstream cmds
    /// (SpO2, Temp, Steps, Sleep) from ever running. The timer flushes whatever
    /// arrived for the stalled type and moves on.
    private func jsRequestNextHistory() {
        jsHistoryStepTimer?.cancel()
        jsHistoryStepTimer = nil
        guard !jsHistoryQueue.isEmpty else {
            NSLog("[QRing] JStyle history queue empty — all done")
            jsPendingHistoryCmd = 0
            return
        }
        let cmd = jsHistoryQueue.removeFirst()
        jsPendingHistoryCmd = cmd
        jsSendHistoryRequest(cmd: cmd, mode: 0x00) // mode 0x00 = start

        let timer = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            if self.jsPendingHistoryCmd == cmd {
                NSLog("[QRing] history step 0x%02X timed out after 12s — forcing next", cmd)
                switch cmd {
                case Self.JS_CMD_GET_HR:    self.flushJStyleType("hr", &self.hrSamples)
                case Self.JS_CMD_GET_HRV:
                    self.flushJStyleType("hrv", &self.hrvSamples)
                    self.flushJStyleType("stress", &self.stressSamples)
                case Self.JS_CMD_GET_SPO2, Self.JS_CMD_GET_SPO2_CONT:
                    self.flushJStyleType("spo2", &self.spo2Samples)
                case Self.JS_CMD_GET_TEMP:  self.flushJStyleType("temp", &self.tempSamples)
                case Self.JS_CMD_GET_TOTAL: self.flushJStyleType("steps", &self.stepsSamples)
                case Self.JS_CMD_GET_SLEEP: self.flushJStyleType("sleep", &self.sleepSamples)
                default: break
                }
                self.jsRequestNextHistory()
            }
        }
        jsHistoryStepTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + 12.0, execute: timer)
    }

    /// Send a JStyle history request with pagination mode.
    /// X3 SDK (libBleSDK.a disassembly 2026-05-16) shows ALL history GETs
    /// embed a startDate in BCD at pkt[4..9] when mode != 0x99. The ring
    /// tolerated zero-startDate for HR (0x54) / SpO2 (0x66) / Sleep (0x53)
    /// but silently dropped Temp (0x62) / Steps (0x51) / HRV (0x56) — Diego
    /// saw temp regress 2026-05-14, steps 2026-05-13. Encode last-7-days
    /// startDate uniformly to match SDK behavior.
    private func jsSendHistoryRequest(cmd: UInt8, mode: UInt8) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = cmd
        pkt[1] = mode  // 0x00=start, 0x02=continue, 0x99=delete-all
        if mode != 0x99 {
            let startDate = Date(timeIntervalSinceNow: -7 * 24 * 3600)
            let cal = Calendar(identifier: .gregorian)
            let c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: startDate)
            pkt[4] = toBCD(max(0, (c.year ?? 2026) - 2000))
            pkt[5] = toBCD(c.month ?? 1)
            pkt[6] = toBCD(c.day ?? 1)
            pkt[7] = toBCD(c.hour ?? 0)
            pkt[8] = toBCD(c.minute ?? 0)
            pkt[9] = toBCD(c.second ?? 0)
        }
        pkt[15] = checksum(pkt)
        NSLog("[QRing] JS history GET cmd=0x%02X mode=0x%02X bytes=%@", cmd, mode, pkt.map { String(format: "%02X", $0) }.joined())
        queueWrite(Data(pkt))
    }

    // MARK: - JStyle Command Builders

    /// Converte byte decimal pra BCD (binary-coded decimal). Ex: 26 → 0x26.
    /// O anel JStyle X3/X5 armazena data/hora em BCD e devolve nos packets de
    /// history nesse formato — se enviarmos decimal puro, o parser
    /// `bcd(b[i])` no Edge Function calcula errado (ex: 26 dec = 0x1A → bcd
    /// retorna 1*10+10=20 → year 2020). Confirmado 2026-05-10 via bytes
    /// debug_raw do Diego (history packets com year=0x26 = 2026 correto).
    private func toBCD(_ v: Int) -> UInt8 {
        let clamped = max(0, min(99, v))
        return UInt8(((clamped / 10) << 4) | (clamped % 10))
    }

    private func jsSendSetTime() {
        let now = Date()
        let cal = Calendar(identifier: .gregorian)
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.JS_CMD_SET_TIME
        pkt[1] = toBCD(max(0, (c.year ?? 2026) - 2000))
        pkt[2] = toBCD(c.month ?? 1)
        pkt[3] = toBCD(c.day ?? 1)
        pkt[4] = toBCD(c.hour ?? 0)
        pkt[5] = toBCD(c.minute ?? 0)
        pkt[6] = toBCD(c.second ?? 0)
        // b[7] = timezone offset (hours from UTC, signed) — não é BCD, é signed int
        let tzOffset = TimeZone.current.secondsFromGMT() / 3600
        pkt[7] = UInt8(bitPattern: Int8(tzOffset))
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func jsSendBattery() {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.JS_CMD_BATTERY
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func jsSendGetVersion() {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.JS_CMD_GET_VERSION
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    /// Configure auto-monitoring on JStyle ring (cmd 0x2A SetAutomaticMonitoring).
    /// Layout correto (corrigido 2026-05-10): dataType vai em pkt[1], NÃO pkt[9].
    /// Bug anterior: pkt[1]=0x01 fixo (enable) + dataType em pkt[9] fazia anel
    /// interpretar pkt[1]=0x01 como dataType=1 (HR) em TODAS as 4 chamadas. Por isso
    /// só LED verde acionava — vermelho (SpO2)/azul (HRV)/temp jamais foram ativados.
    /// Per project_jstyle_cmd_bytes.md: layout `[0x2A, dataType, intervalMin, ...]`.
    /// dataType: 1=HR (green), 2=SpO2 (red), 3=Temp, 4=HRV (blue).
    private func jsSendAutoMonitoring(dataType: UInt8, intervalMin: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.JS_CMD_SET_AUTO
        pkt[1] = dataType                              // 1=HR, 2=SpO2, 3=Temp, 4=HRV (CORRIGIDO)
        pkt[2] = UInt8(intervalMin & 0xFF)             // intervalo em minutos
        pkt[3] = 0x01                                  // enable flag
        pkt[4] = toBCD(0)                              // startHour BCD
        pkt[5] = toBCD(0)                              // startMin BCD
        pkt[6] = toBCD(23)                             // endHour BCD
        pkt[7] = toBCD(59)                             // endMin BCD
        pkt[8] = 0x7F                                  // all days (bit0-6 = Sun-Sat)
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    /// Send a single PPG protocol packet (cmd 0x78 ppgWithMode).
    /// Mode 1=start, 2=send result, 3=stop, 4=progress (status=pct), 5=quit.
    /// Confirmed via libBleSDK.a disassembly — see project_jstyle_cmd_bytes.md.
    private func jsSendPPG(mode: UInt8, status: UInt8) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.JS_CMD_PPG
        pkt[1] = mode
        pkt[2] = status
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
        NSLog("[QRing] PPG cmd: mode=%d status=%d", Int(mode), Int(status))
    }

    /// Start a PPG measurement (realtime PPG/RR/PPI stream from the ring).
    /// Spawns a 1Hz progress timer (the firmware needs the keepalive — without it,
    /// it stops emitting data after a few seconds) plus a stop timer at duration end.
    /// When the stop timer fires, emits a "measurementEnded" event so JS can flush.
    private func jsStartPPGMeasurement(durationSec: Int) {
        // Cancel any previous PPG run cleanly first
        jsStopPPGMeasurement(notify: false)

        // SDK demo uses 30+ seconds — enforce floor
        let dur = max(durationSec, 30)
        jsPPGDurationSec = dur
        jsPPGStartedAt = Date()

        jsSendPPG(mode: 1, status: 0)
        NSLog("[QRing] PPG measurement started (durationSec=%d)", dur)

        let progressTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self, let start = self.jsPPGStartedAt else { return }
            let elapsed = Date().timeIntervalSince(start)
            let pct = min(100, Int(elapsed / Double(self.jsPPGDurationSec) * 100))
            self.jsSendPPG(mode: 4, status: UInt8(pct & 0xFF))
        }
        jsPPGProgressTimer = progressTimer

        let stopTimer = Timer.scheduledTimer(withTimeInterval: Double(dur), repeats: false) { [weak self] _ in
            self?.jsStopPPGMeasurement(notify: true)
        }
        jsPPGStopTimer = stopTimer
    }

    /// Stop PPG measurement: invalidate timers, send stop packet, optionally notify JS.
    /// Idempotent — safe to call repeatedly. notify=false on disconnect/cleanup.
    private func jsStopPPGMeasurement(notify: Bool) {
        jsPPGProgressTimer?.invalidate()
        jsPPGProgressTimer = nil
        jsPPGStopTimer?.invalidate()
        jsPPGStopTimer = nil

        let wasActive = jsPPGStartedAt != nil
        jsPPGStartedAt = nil
        if wasActive {
            jsSendPPG(mode: 3, status: 0)  // stop
            NSLog("[QRing] PPG measurement stopped (notify=%@)", notify ? "true" : "false")
            if notify {
                notifyListeners("measurementEnded", data: ["type": "ppg"])
            }
        }
    }


    /// Start/stop manual measurement (HR, SpO2, etc.)
    /// type: 2=HR, 3=SpO2, 4=ContSpO2
    private func jsSendMeasurement(type: UInt8, enable: Bool, durationSec: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.JS_CMD_MEASUREMENT
        pkt[1] = type
        pkt[2] = enable ? 0x01 : 0x00
        pkt[4] = UInt8(durationSec & 0xFF)
        pkt[5] = UInt8((durationSec >> 8) & 0xFF)
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    // MARK: - JStyle Notify Parser

    private func handleJStyleNotify(_ b: [UInt8], hex: String) {
        let cmd = b[0]
        let endFlag = b.count >= 16 ? b[b.count - 2] : 0  // second-to-last byte before CRC

        switch cmd {
        case Self.JS_CMD_BATTERY:
            let pct = Int(b[1])
            NSLog("[QRing] JStyle battery: %d%%", pct)
            notifyListeners("battery", data: ["battery": pct, "charging": false])

        case Self.JS_CMD_GET_VERSION:
            // Version string in bytes 1..N
            let verBytes = Array(b[1..<min(b.count-1, 15)]).filter { $0 != 0 }
            if let ver = String(bytes: verBytes, encoding: .utf8) {
                firmwareRev = ver
                NSLog("[QRing] JStyle firmware: %@", ver)
                notifyListeners("firmwareRev", data: ["fwVersion": ver])
            }

        case Self.JS_CMD_SET_TIME:
            NSLog("[QRing] JStyle set-time ack")

        case Self.JS_CMD_SET_AUTO:
            NSLog("[QRing] JStyle auto-monitoring ack")

        case Self.JS_CMD_GET_HR:  // 0x54 — continuous HR history (multi-record, 25 bytes each)
            // FIX 2026-05-04: record size is 24 bytes (header 9 + 15 HR values),
            // not 25. Off-by-one was misaligning every record after the first
            // → cascade of invalid headers → all samples discarded silently.
            let hrRecordSize = 24
            var hrIdx = 0
            var hrEnded = false
            while hrIdx + hrRecordSize <= b.count {
                let rec = Array(b[hrIdx..<hrIdx+hrRecordSize])
                if rec[1] == 0xFF { hrEnded = true; break }
                parseJStyleHR(rec)
                hrIdx += hrRecordSize
            }
            // Check for short end marker (e.g. "54 FF" = 2 bytes)
            if !hrEnded && hrIdx < b.count && b[hrIdx] == Self.JS_CMD_GET_HR && hrIdx + 1 < b.count && b[hrIdx+1] == 0xFF {
                hrEnded = true
            }
            if hrEnded || endFlag == 1 {
                flushJStyleType("hr", &hrSamples)
                jsRequestNextHistory()
            } else if jsPendingHistoryCmd == Self.JS_CMD_GET_HR {
                jsSendHistoryRequest(cmd: Self.JS_CMD_GET_HR, mode: 0x02)
            }

        case Self.JS_CMD_GET_HRV:  // 0x56 — HRV + stress (multi-record, 15 bytes each)
            let hrvRecordSize = 15
            var hrvIdx = 0
            var hrvEnded = false
            while hrvIdx + hrvRecordSize <= b.count {
                let rec = Array(b[hrvIdx..<hrvIdx+hrvRecordSize])
                if rec[1] == 0xFF { hrvEnded = true; break }
                parseJStyleHRV(rec)
                hrvIdx += hrvRecordSize
            }
            // Check for short end marker (e.g. "56 FF" = 2 bytes)
            if !hrvEnded && hrvIdx < b.count && b[hrvIdx] == Self.JS_CMD_GET_HRV && hrvIdx + 1 < b.count && b[hrvIdx+1] == 0xFF {
                hrvEnded = true
            }
            if hrvEnded || endFlag == 1 {
                flushJStyleType("hrv", &hrvSamples)
                flushJStyleType("stress", &stressSamples)
                jsRequestNextHistory()
            } else if jsPendingHistoryCmd == Self.JS_CMD_GET_HRV {
                jsSendHistoryRequest(cmd: Self.JS_CMD_GET_HRV, mode: 0x02)
            }

        case Self.JS_CMD_GET_SPO2, Self.JS_CMD_GET_SPO2_CONT:  // 0x66 / 0x57
            parseJStyleSpO2(b)
            if endFlag == 1 || b[1] == 0xFF {
                flushJStyleType("spo2", &spo2Samples)
                jsRequestNextHistory()
            } else if jsPendingHistoryCmd == cmd {
                jsSendHistoryRequest(cmd: cmd, mode: 0x02)
            }

        case Self.JS_CMD_GET_TEMP:  // 0x62 (multi-record, 11 bytes each)
            let tempRecordSize = 11
            var tempIdx = 0
            var tempEnded = false
            while tempIdx + tempRecordSize <= b.count {
                let rec = Array(b[tempIdx..<tempIdx+tempRecordSize])
                if rec[1] == 0xFF { tempEnded = true; break }
                parseJStyleTemp(rec)
                tempIdx += tempRecordSize
            }
            if !tempEnded && tempIdx < b.count && b[tempIdx] == Self.JS_CMD_GET_TEMP && tempIdx + 1 < b.count && b[tempIdx+1] == 0xFF {
                tempEnded = true
            }
            if tempEnded || endFlag == 1 {
                flushJStyleType("temp", &tempSamples)
                jsRequestNextHistory()
            } else if jsPendingHistoryCmd == Self.JS_CMD_GET_TEMP {
                jsSendHistoryRequest(cmd: Self.JS_CMD_GET_TEMP, mode: 0x02)
            }

        case Self.JS_CMD_GET_TOTAL:  // 0x51 — daily steps (multi-record, 27 bytes each)
            let stepsRecordSize = 27
            var stepsIdx = 0
            var stepsEnded = false
            while stepsIdx + stepsRecordSize <= b.count {
                let rec = Array(b[stepsIdx..<stepsIdx+stepsRecordSize])
                if rec[1] == 0xFF { stepsEnded = true; break }
                parseJStyleSteps(rec)
                stepsIdx += stepsRecordSize
            }
            if !stepsEnded && stepsIdx < b.count && b[stepsIdx] == Self.JS_CMD_GET_TOTAL && stepsIdx + 1 < b.count && b[stepsIdx+1] == 0xFF {
                stepsEnded = true
            }
            if stepsEnded || endFlag == 1 {
                flushJStyleType("steps", &stepsSamples)
                jsRequestNextHistory()
            } else if jsPendingHistoryCmd == Self.JS_CMD_GET_TOTAL {
                jsSendHistoryRequest(cmd: Self.JS_CMD_GET_TOTAL, mode: 0x02)
            }

        case Self.JS_CMD_GET_SLEEP:  // 0x53
            parseJStyleSleep(b)
            if endFlag == 1 || b[1] == 0xFF {
                flushJStyleType("sleep", &sleepSamples)
                jsRequestNextHistory()
            } else if jsPendingHistoryCmd == Self.JS_CMD_GET_SLEEP {
                jsSendHistoryRequest(cmd: Self.JS_CMD_GET_SLEEP, mode: 0x02)
            }

        case Self.JS_CMD_PPG:  // 0x78 — PPG realtime stream + ack/progress/result
            // Bytes captured in debug_raw; server-side parser will decode the
            // various sub-types (ppgStartSucessed=71, realtimePPGData=70, ppgResult=73,
            // ppgMeasurementProgress=76, etc) once we have fixtures.
            NSLog("[QRing] PPG response received (%d bytes)", b.count)

        case Self.JS_CMD_MEASUREMENT:  // 0x28 — manual HR/SpO2 result
            parseJStyleMeasurement(b)

        default:
            NSLog("[QRing] JStyle unhandled cmd 0x%02X", cmd)
        }
    }

    private func flushJStyleType(_ type: String, _ samples: inout [[String: Any]]) {
        guard !samples.isEmpty else {
            notifyListeners("syncEnd", data: ["type": type])
            return
        }
        notifyListeners("syncData", data: ["type": type, "samples": samples])
        notifyListeners("syncEnd", data: ["type": type])
        NSLog("[QRing] JStyle flushed %d %@ samples", samples.count, type)
        samples.removeAll()
    }

    // MARK: - JStyle History Parsers

    /// Parse JStyle continuous HR (0x54). Record format:
    /// [0]=CMD(0x54), [1]=idx, [2]=0x00, [3]=YY, [4]=MM, [5]=DD, [6]=HH, [7]=mm, [8]=count, [9..23]=HR values
    /// Total record size: 25 bytes (up to 15 HR values per record).
    /// BCD decode: 0x26 → 26, 0x58 → 58 (each nibble is a decimal digit).
    /// JStyle ring encodes year/month/day/hour/minute as BCD bytes.
    /// Without this, parser interpreted 0x26 as 38 → year=2038 → invalid date → sample dropped.
    private static func bcd(_ byte: UInt8) -> Int {
        return Int((byte >> 4) & 0x0F) * 10 + Int(byte & 0x0F)
    }

    private func parseJStyleHR(_ b: [UInt8]) {
        guard b.count >= 10 else { return }
        if b[1] == 0xFF { return }  // empty/end marker

        let cal = Calendar(identifier: .gregorian)
        var comps = DateComponents()
        comps.year = 2000 + Self.bcd(b[3])
        comps.month = Self.bcd(b[4])
        comps.day = Self.bcd(b[5])
        comps.hour = Self.bcd(b[6])
        comps.minute = Self.bcd(b[7])
        comps.second = 0
        guard let baseDate = cal.date(from: comps) else { return }
        // Timestamp validation: discard dates before 2024 (garbage BCD from old ring memory) or future
        let minValidDate = DateComponents(calendar: cal, year: 2024, month: 1, day: 1).date!
        if baseDate < minValidDate { return }
        if baseDate.timeIntervalSinceNow > 86400 { return }
        let baseSec = baseDate.timeIntervalSince1970

        let count = Int(b[8])  // number of HR readings in this record
        let maxVals = min(count, 15)  // cap at 15

        // HR values start at b[9], each 1 byte = 1-min reading
        for i in 0..<maxVals {
            let idx = 9 + i
            if idx >= b.count { break }
            let hr = Int(b[idx])
            if hr == 0 || !(30...220).contains(hr) { continue }
            let tsSec = baseSec + Double(i) * 60  // 1-min intervals
            hrSamples.append([
                "type": "hr",
                "ts": tsSec * 1000,
                "value": hr,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_history", "packet": Int(b[1])],
            ])
        }
    }

    /// Parse JStyle HRV (0x56). Contains HRV, stress, HR, BP.
    private func parseJStyleHRV(_ b: [UInt8]) {
        guard b.count >= 15 else { return }
        if b[1] == 0xFF { return }

        // Record: [0]=CMD, [1]=idx, [2]=0x00, [3]=YY, [4]=MM, [5]=DD, [6]=HH, [7]=mm, [8]=duration, [9]=HRV, [10]=stress, [11]=SDNN_L, [12]=SDNN_H, [13]=RMSSD_L, [14]=RMSSD_H
        let cal = Calendar(identifier: .gregorian)
        var comps = DateComponents()
        comps.year = 2000 + Self.bcd(b[3])
        comps.month = Self.bcd(b[4])
        comps.day = Self.bcd(b[5])
        comps.hour = Self.bcd(b[6])
        comps.minute = Self.bcd(b[7])
        comps.second = 0
        guard let date = cal.date(from: comps) else { return }
        // Timestamp validation: discard dates before 2024 (garbage BCD) or future
        let minValidDate = DateComponents(calendar: cal, year: 2024, month: 1, day: 1).date!
        if date < minValidDate { return }
        if date.timeIntervalSinceNow > 86400 { return }
        let tsMs = date.timeIntervalSince1970 * 1000

        let hrv = Int(b[9])
        let stress = Int(b[10])
        let hr = Int(b[11])

        if (5...250).contains(hrv) {
            hrvSamples.append([
                "type": "hrv",
                "ts": tsMs,
                "value": hrv,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_history"],
            ])
        }
        if (1...100).contains(stress) {
            stressSamples.append([
                "type": "stress",
                "ts": tsMs + 1,
                "value": stress,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_history"],
            ])
        }
        if (30...220).contains(hr) {
            realtimeHrSamples.append([
                "type": "hr",
                "ts": tsMs + 2,
                "value": hr,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_hrv_record"],
            ])
        }
    }

    /// Parse JStyle SpO2 (0x57).
    private func parseJStyleSpO2(_ b: [UInt8]) {
        guard b.count >= 8 else { return }
        if b[1] == 0xFF { return }

        let cal = Calendar(identifier: .gregorian)
        var comps = DateComponents()
        comps.year = 2000 + Int(b[1])
        comps.month = Int(b[2])
        comps.day = Int(b[3])
        comps.hour = Int(b[4])
        comps.minute = Int(b[5])
        comps.second = Int(b[6])
        guard let date = cal.date(from: comps) else { return }

        let spo2 = Int(b[7])
        if (70...100).contains(spo2) {
            spo2Samples.append([
                "type": "spo2",
                "ts": date.timeIntervalSince1970 * 1000,
                "value": spo2,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_history"],
            ])
        }
    }

    /// Parse JStyle temperature history (0x62).
    private func parseJStyleTemp(_ b: [UInt8]) {
        guard b.count >= 11 else { return }
        if b[1] == 0xFF { return }

        // Record: [0]=CMD, [1]=idx, [2]=0x00, [3]=YY, [4]=MM, [5]=DD, [6]=HH, [7]=mm, [8]=ss, [9]=temp_raw, [10]=temp_flag
        let cal = Calendar(identifier: .gregorian)
        var comps = DateComponents()
        comps.year = 2000 + Self.bcd(b[3])
        comps.month = Self.bcd(b[4])
        comps.day = Self.bcd(b[5])
        comps.hour = Self.bcd(b[6])
        comps.minute = Self.bcd(b[7])
        comps.second = Int(b[8])
        guard let date = cal.date(from: comps) else { return }
        // Timestamp validation: discard dates before 2024 (garbage BCD) or future
        let minValidDate = DateComponents(calendar: cal, year: 2024, month: 1, day: 1).date!
        if date < minValidDate { return }
        if date.timeIntervalSinceNow > 86400 { return }

        // Temperature: byte[9] is raw value, byte[10] is decimal flag
        // Format: temp = b[9] + b[10]*0.01 if flag indicates decimals, or b[9]*0.5 + offset
        // Based on raw data (0x47=71, 0x48=72 with flag 0x01): temp = value / 2.0
        let rawTemp = Int(b[9]) | (Int(b[10]) << 8)
        let celsius = Double(rawTemp) / 10.0
        if (25.0...42.0).contains(celsius) {
            tempSamples.append([
                "type": "temp",
                "ts": date.timeIntervalSince1970 * 1000,
                "value": celsius,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_history"],
            ])
        }
    }

    /// Parse JStyle daily steps (0x51).
    private func parseJStyleSteps(_ b: [UInt8]) {
        guard b.count >= 27 else { return }
        if b[1] == 0xFF { return }

        // Record: [0]=CMD(0x51), [1]=idx, [2]=YY(BCD), [3]=MM(BCD), [4]=DD(BCD), [5..8]=steps_LE32
        // Steps uses BCD date encoding (0x26 = year 26 = 2026)
        let cal = Calendar(identifier: .gregorian)
        var comps = DateComponents()
        let bcdYear = Int(b[2] >> 4) * 10 + Int(b[2] & 0x0F)
        let bcdMonth = Int(b[3] >> 4) * 10 + Int(b[3] & 0x0F)
        let bcdDay = Int(b[4] >> 4) * 10 + Int(b[4] & 0x0F)
        comps.year = 2000 + bcdYear
        comps.month = bcdMonth
        comps.day = bcdDay
        comps.hour = 12  // noon — represents daily total
        guard let date = cal.date(from: comps) else { return }
        // Timestamp validation: discard future dates
        if date.timeIntervalSinceNow > 86400 * 2 { return }

        // Steps LE32 in b[5..8]
        let steps = Int(b[5]) | (Int(b[6]) << 8) | (Int(b[7]) << 16) | (Int(b[8]) << 24)
        if steps > 0 && steps < 100000 {
            stepsSamples.append([
                "type": "steps",
                "ts": date.timeIntervalSince1970 * 1000,
                "value": steps,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_daily_total"],
            ])
        }
    }

    /// Parse JStyle sleep data (0x53).
    private func parseJStyleSleep(_ b: [UInt8]) {
        guard b.count >= 8 else { return }
        if b[1] == 0xFF { return }

        let cal = Calendar(identifier: .gregorian)
        var comps = DateComponents()
        comps.year = 2000 + Int(b[1])
        comps.month = Int(b[2])
        comps.day = Int(b[3])
        comps.hour = Int(b[4])
        comps.minute = Int(b[5])
        guard let date = cal.date(from: comps) else { return }
        // Timestamp validation: discard dates before 2024 (garbage BCD) or future
        let minValidDate = DateComponents(calendar: cal, year: 2024, month: 1, day: 1).date!
        if date < minValidDate { return }
        if date.timeIntervalSinceNow > 86400 { return }

        // Sleep quality code: 1=deep, 2=light, 3=REM, other=awake
        let quality = Int(b[6])
        let qualityLabel: String
        switch quality {
        case 1: qualityLabel = "deep"
        case 2: qualityLabel = "light"
        case 3: qualityLabel = "rem"
        default: qualityLabel = "awake"
        }

        sleepSamples.append([
            "type": "sleep",
            "ts": date.timeIntervalSince1970 * 1000,
            "value": quality,
            "source": "qring_ble",
            "payload_json": ["mode": "jstyle_history", "quality": qualityLabel],
        ])
    }

    /// Parse JStyle manual measurement result (0x28).
    private func parseJStyleMeasurement(_ b: [UInt8]) {
        guard b.count >= 4 else { return }
        let mType = b[1]  // 2=HR, 3=SpO2
        let value = Int(b[3])

        if mType == 2 && (30...220).contains(value) {
            realtimeHrSamples.append([
                "type": "hr",
                "ts": nowMsUnique(),
                "value": value,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_measurement"],
            ])
            notifyListeners("realtime", data: ["type": "hr", "value": value])
        } else if mType == 3 && (70...100).contains(value) {
            realtimeSpo2Samples.append([
                "type": "spo2",
                "ts": nowMsUnique(),
                "value": value,
                "source": "qring_ble",
                "payload_json": ["mode": "jstyle_measurement"],
            ])
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
        let durationSec = call.getInt("durationSec") ?? 60

        // JStyle path: cmd 0x78 ppgWithMode for PPG/RR/PPI realtime streaming.
        // Native 1Hz progress timer keeps the ring transmitting; native stop timer
        // ends measurement at durationSec and emits a "measurementEnded" event so JS
        // can flush samples without relying on a JS setTimeout (iOS pauses JS timers
        // when the app is in background — that's why the previous build hung at
        // "Medindo..." indefinitely).
        // For SpO2, fall back to manualMeasurement (cmd 0x28) since SpO2 doesn't have
        // its own PPG path in the SDK demo.
        if deviceVendor == .jstyle {
            switch type {
            case "hr", "ppg", "ppi", "hrv":
                jsStartPPGMeasurement(durationSec: durationSec)
            case "spo2":
                let dur = max(durationSec, 30)
                jsSendMeasurement(type: 3, enable: true, durationSec: dur)
                DispatchQueue.main.asyncAfter(deadline: .now() + Double(dur)) { [weak self] in
                    self?.jsSendMeasurement(type: 3, enable: false, durationSec: 0)
                    self?.notifyListeners("measurementEnded", data: ["type": "spo2"])
                }
            default:
                call.reject("UNKNOWN_REALTIME_TYPE: \(type)")
                return
            }
            call.resolve(["started": true, "vendor": "jstyle", "durationSec": durationSec, "cmd": "0x78"])
            return
        }

        // Colmi path: cmd 0x69 generic realtime.
        // Build 370: when "hr" is requested (default Medir Agora), fire ALL THREE
        // streams simultaneously (HR + SpO2 + HRV) so a single 60s measurement
        // window captures everything. Each stream needs a CONTINUE keep-alive
        // every ~30s — schedule those too. Stop all at the end.
        if type == "hr" {
            sendRealtime(type: Self.RT_TYPE_HR)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.sendRealtime(type: Self.RT_TYPE_SPO2)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.sendRealtime(type: Self.RT_TYPE_HRV)
            }
            // Keep-alive at ~25s and ~50s mark
            for offset in [25.0, 50.0] {
                DispatchQueue.main.asyncAfter(deadline: .now() + offset) { [weak self] in
                    guard let self = self else { return }
                    self.sendRealtimeContinue(type: Self.RT_TYPE_HR)
                    self.sendRealtimeContinue(type: Self.RT_TYPE_SPO2)
                    self.sendRealtimeContinue(type: Self.RT_TYPE_HRV)
                }
            }
            // Stop at durationSec, then notify JS so the measuring UI can close
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(durationSec)) { [weak self] in
                guard let self = self else { return }
                self.sendRealtimeStop(type: Self.RT_TYPE_HR)
                self.sendRealtimeStop(type: Self.RT_TYPE_SPO2)
                self.sendRealtimeStop(type: Self.RT_TYPE_HRV)
                self.notifyListeners("measurementEnded", data: ["type": "all", "vendor": "colmi"])
            }
            call.resolve(["started": true, "vendor": "colmi", "streams": ["hr", "spo2", "hrv"], "durationSec": durationSec])
            return
        }

        // Single-stream fallback (caller pediu type específico)
        let subType: UInt8
        switch type {
        case "spo2": subType = Self.RT_TYPE_SPO2
        case "hrv":  subType = Self.RT_TYPE_HRV
        default:
            call.reject("UNKNOWN_REALTIME_TYPE: \(type)")
            return
        }
        sendRealtime(type: subType)
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(durationSec)) { [weak self] in
            self?.sendRealtimeStop(type: subType)
            self?.notifyListeners("measurementEnded", data: ["type": type, "vendor": "colmi"])
        }
        call.resolve(["started": true, "vendor": "colmi", "type": type])
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

    /// Send CONTINUE action to keep a realtime stream alive.
    /// R09 stops sending data after ~30-40s without this. Protocol: Action.CONTINUE = 3.
    private func sendRealtimeContinue(type: UInt8) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_REALTIME
        pkt[1] = type
        pkt[2] = 0x03  // Action.CONTINUE
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
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendSpo2History() {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_SPO2_HISTORY
        pkt[1] = 0x01   // READ sub-command
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendStressHistory() {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_STRESS_HIST
        pkt[1] = 0x01   // READ sub-command
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    private func sendHrvHistory() {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = Self.CMD_HRV_HISTORY
        pkt[1] = 0x01   // READ sub-command
        pkt[15] = checksum(pkt)
        queueWrite(Data(pkt))
    }

    /// Enable auto-measurement on the ring. Uses the same CMD as history
    /// but with sub-command 0x02 (WRITE) instead of 0x01 (READ).
    /// These settings persist on the ring across disconnects.
    private func sendAutoMeasurementEnable(cmd: UInt8, intervalMinutes: Int) {
        var pkt = [UInt8](repeating: 0, count: Self.PACKET_SIZE)
        pkt[0] = cmd
        pkt[1] = 0x02   // WRITE sub-command
        pkt[2] = 0x01   // enable
        if intervalMinutes > 0 {
            pkt[3] = UInt8(max(5, min(60, intervalMinutes)))
        }
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

    /// Request SLEEP history via V2 "big data" channel (build 411).
    /// Cmd 0x44 V1 sleep history retorna erro 0xC4 no R09 — Colmi documenta que
    /// sleep nesse firmware exige Big Data V2 com sub-id 0x27 (= 39 decimal).
    /// Mesmo wrapper que temp (BC 27 01 00 ...). Resposta cai em debug_raw
    /// (qring_ble) pra inspeção; parser dedicado virá em build 412+ após
    /// confirmar formato byte-level do response.
    private func sendSleepHistoryRequest() {
        guard writeCharV2 != nil, peripheral != nil else {
            NSLog("[QRing] skip sleep history — V2 write char not available")
            return
        }
        let pkt = Data([
            Self.CMD_BIG_DATA_V2,           // 0xBC
            Self.BIG_DATA_TYPE_SLEEP,       // 0x27
            0x01, 0x00,                     // length LE = 1 (placeholder, ajustar se anel exigir)
            0x3E, 0x81, 0x02                // payload (mesmo padrão de temp)
        ])
        NSLog("[QRing] sleep BigDataV2 request: BC 27 01 00 3E 81 02")
        queueWriteV2(pkt)
    }

    private func isHrvSupported() -> Bool {
        if deviceVendor == .jstyle { return true }
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

        // Vendor gate: V1 history commands (0x15/0x2C/0x39/0x43/0x44) use the
        // Colmi protocol layout. JStyle responds to these CMDs with generic
        // ack/error stubs (e.g. `15 00 00 ...`, `2C 02 01 1E 00 ...`) that DO
        // NOT carry data — running Colmi parsers on them produces garbage.
        // Verified bug: 54 bogus HR samples (values 34-242) appeared on
        // lilidoces@icloud.com between 2026-04-27 and 2026-04-30 from
        // exactly this cross-vendor parser leak.
        //
        // CMD_STRESS_HIST (0x37) is the exception — it has JStyle-specific
        // sub-types (b[1]=0x88/0x99/0xEA/0xFF) handled inside parseStressHistory.
        if deviceVendor == .jstyle {
            switch cmd {
            case Self.CMD_HR_HISTORY,
                 Self.CMD_SPO2_HISTORY,
                 Self.CMD_HRV_HISTORY,
                 Self.CMD_STEPS_HIST,
                 Self.CMD_SLEEP_HIST:
                NSLog("[QRing] gate: CMD 0x%02X is Colmi-only — JStyle response ignored", cmd)
                return
            case Self.CMD_STRESS_HIST: parseStressHistory(bytes); return
            default: break
            }
        }

        // Auto-measurement ack responses (sub-cmd 0x02) are always parsed
        // regardless of historyEnabled flag (Colmi path).
        switch cmd {
        case Self.CMD_SPO2_HISTORY: parseSpo2History(bytes); return
        case Self.CMD_STRESS_HIST:  parseStressHistory(bytes); return
        case Self.CMD_HRV_HISTORY:  parseHrvHistory(bytes); return
        default: break
        }

        // History data parsers (gated by historyEnabled flag) — Colmi only.
        if historyEnabled {
            switch cmd {
            case Self.CMD_HR_HISTORY:   parseHrHistory(bytes)
            case Self.CMD_STEPS_HIST:   parseStepsHistory(bytes)
            case Self.CMD_SLEEP_HIST:   parseSleepHistory(bytes)
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
        // JStyle returns 03 00 00... â battery not available via this CMD
        if deviceVendor == .jstyle && b[1] == 0 && b[2] == 0 {
            NSLog("[QRing] JStyle battery CMD not supported")
            return
        }
        let pct = Int(b[1])
        let charging = b[2] == 0x01
        notifyListeners("battery", data: ["battery": pct, "charging": charging])
    }

    private func parseHrHistory(_ b: [UInt8]) {
        // Colmi HR History multi-packet protocol (Python HeartRateLogParser):
        //   Packet 0 (subIdx=0): metadata — b[2]=total_data_packets, b[3]=interval_minutes
        //   Packet 1 (subIdx=1): b[2..5]=LE32 epoch (day start), b[6..14]=first 9 HR values
        //   Packet N (subIdx>=2): b[2..14]=13 HR values each
        //   Total: 288 slots/day at 5-min intervals (9 + 22*13 = 295 capacity)
        let subIdx = Int(b[1])
        if subIdx == 0 {
            expectedHrPackets = Int(b[2])
            hrIntervalMinutes = Int(b[3])
            if !(1...120).contains(hrIntervalMinutes) { hrIntervalMinutes = 5 }
            receivedHrPackets = 0
            NSLog("[QRing] HR history metadata: %d data packets, %d min interval", expectedHrPackets, hrIntervalMinutes)
            return
        }

        let startByte: Int
        let valuesPerFirstPacket = 9  // packet 1 has timestamp in [2..5], values in [6..14]
        let valuesPerPacket = 13      // packet 2+ has values in [2..14]

        if subIdx == 1 {
            // Extract day epoch from bytes[2..5] LE32 — use ring's timestamp, not request's
            let epoch = UInt32(b[2]) | (UInt32(b[3]) << 8) | (UInt32(b[4]) << 16) | (UInt32(b[5]) << 24)
            if epoch > 0 {
                hrDayEpoch = TimeInterval(epoch)
                NSLog("[QRing] HR history day epoch from ring: %d", epoch)
            }
            startByte = 6  // first 9 values start at byte 6
        } else {
            startByte = 2  // 13 values start at byte 2
        }

        for i in startByte...14 {
            let v = Int(b[i])
            if v == 0 || !(30...220).contains(v) { continue }
            let slotInPkt = i - startByte
            let globalSlot: Int
            if subIdx == 1 {
                globalSlot = slotInPkt
            } else {
                globalSlot = valuesPerFirstPacket + (subIdx - 2) * valuesPerPacket + slotInPkt
            }
            let tsSec = hrDayEpoch + Double(globalSlot * hrIntervalMinutes * 60)
            hrSamples.append([
                "type": "hr",
                "ts": tsSec * 1000,
                "value": v,
                "source": "qring_ble",
                "payload_json": ["mode": "history", "slot": globalSlot, "packet": subIdx],
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
        // Build 413: subIdx >= 0xF0 (=240) é END/TRAILER marker, não dado.
        // Antes parser tratava como sub-indice de dados, calculava slot=3107,
        // gerava samples com ts=hoje+32d (ex: 2026-06-18 11:45). Bug visível
        // como anchor day errado na grid de biomarcadores.
        if subIdx >= 0xF0 {
            flushStepsBatch()
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
                "value": v,
                "source": "qring_ble",
                "payload_json": ["mode": "history", "slot": slot],
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
        // R09 CMD 0x44 returns error (0xC4 = error bit set). Sleep data on R09
        // requires Big Data V2 (ID 39). We still capture raw for diagnostics.
        let hex = b.map { String(format: "%02X", $0) }.joined(separator: " ")
        NSLog("[QRing] sleep history raw (CMD 0x44 — may be error on R09): %@", hex)
        if b[0] & 0x80 != 0 {
            NSLog("[QRing] sleep history error response (bit 7 set) — R09 needs Big Data V2")
            return
        }
        sleepSamples.append([
            "type": "sleep",
            "ts": nowMsUnique(),
            "raw": hex,
            "source": "qring_ble",
        ])
        notifyListeners("syncData", data: ["type": "sleep", "samples": sleepSamples])
        notifyListeners("syncEnd", data: ["type": "sleep"])
        sleepSamples.removeAll()
    }

    private func parseSpo2History(_ b: [UInt8]) {
        // Sub-command in b[1]: 0x01=READ response, 0x02=WRITE ack
        if b[1] == 0x02 {
            NSLog("[QRing] SpO2 auto-measurement enable ack")
            return
        }
        let pct = Int(b[2])
        if (50...100).contains(pct) {
            spo2Samples.append([
                "type": "spo2",
                "ts": nowMsUnique(),
                "value": pct,
                "source": "qring_ble",
                "payload_json": ["mode": "history"],
            ])
        }
        if !spo2Samples.isEmpty {
            notifyListeners("syncData", data: ["type": "spo2", "samples": spo2Samples])
            notifyListeners("syncEnd", data: ["type": "spo2"])
            spo2Samples.removeAll()
        }
    }

    private func parseStressHistory(_ b: [UInt8]) {
        if b[1] == 0x02 {
            NSLog("[QRing] Stress auto-measurement enable ack")
            return
        }

        // JStyle paths (b[1] = 0x88 stream, 0x99 initial, 0xEA end, 0xFF no-data)
        // route through the package parser. Verified by 4 production fixtures
        // (Diego stress stream 2026-05-02, Diego handshake 2026-05-02, etc.) —
        // the package emits ZERO phantom HR (the bug that produced HR=136 ×75
        // for Diego on 2026-05-01 from the constant b[10]=0x88 byte).
        if deviceVendor == .jstyle {
            let result = jstyleParser.parse(bytes: b, channel: .v1, nowMs: Int64(nowMsUnique()))
            for sample in result.samples { absorbPackageSample(sample) }
            // End marker behavior: flush any accumulated stress samples
            if b[1] == 0xEA, !stressSamples.isEmpty {
                notifyListeners("syncData", data: ["type": "stress", "samples": stressSamples])
                notifyListeners("syncEnd", data: ["type": "stress"])
                stressSamples.removeAll()
            } else if stressSamples.count >= 10 {
                notifyListeners("syncData", data: ["type": "stress", "samples": stressSamples])
                stressSamples.removeAll()
            }
            return
        }

        // Colmi: value in b[2]
        let v = Int(b[2])
        if (1...100).contains(v) {
            stressSamples.append([
                "type": "stress",
                "ts": nowMsUnique(),
                "value": v,
                "source": "qring_ble",
                "payload_json": ["mode": "history"],
            ])
        }
        if !stressSamples.isEmpty {
            notifyListeners("syncData", data: ["type": "stress", "samples": stressSamples])
            notifyListeners("syncEnd", data: ["type": "stress"])
            stressSamples.removeAll()
        }
    }

    private func parseHrvHistory(_ b: [UInt8]) {
        if b[1] == 0x02 {
            NSLog("[QRing] HRV auto-measurement enable ack")
            return
        }
        let v = Int(b[2])
        if (5...250).contains(v) {
            hrvSamples.append([
                "type": "hrv",
                "ts": nowMsUnique(),
                "value": v,
                "source": "qring_ble",
                "payload_json": ["mode": "history"],
            ])
        }
        if !hrvSamples.isEmpty {
            notifyListeners("syncData", data: ["type": "hrv", "samples": hrvSamples])
            notifyListeners("syncEnd", data: ["type": "hrv"])
            hrvSamples.removeAll()
        }
    }

    /// Translate a RingParsers.Sample into the [String:Any] dict and append
    /// to the appropriate in-flight realtime arrays the existing emit code uses.
    /// Returns true if the sample was handled (used by package routing paths).
    private func absorbPackageSample(_ s: RingParsers.Sample) {
        let dict: [String: Any] = [
            "type": s.type.rawValue,
            "ts": s.timestampMs,
            "value": s.value,
            "source": "qring_ble",
            "payload_json": ["mode": s.mode.rawValue].merging(s.metadata, uniquingKeysWith: { a, _ in a }),
        ]
        switch s.type {
        case .hr:
            realtimeHrSamples.append(dict)
            notifyListeners("realtime", data: ["type": "hr", "value": Int(s.value)])
        case .rr_interval:
            let rrMs = Int(s.value)
            realtimeRRIntervals.append(rrMs)
            rrIntervalSamples.append(dict)
        case .stress:
            stressSamples.append(dict)
        case .hrv:
            realtimeHrvSamples.append(dict)
        case .spo2:
            realtimeSpo2Samples.append(dict)
        case .temp:
            tempSamples.append(dict)
        case .sleep, .steps:
            break // not emitted via realtime path
        }
    }

    private func parseRealtime(_ b: [UInt8]) {
        // JStyle: route through the package parser (verified by 13 fixture tests
        // including lidia_realtime_2026-05-01.json — same byte layout, same
        // RR-derived HR fallback, but logic lives in one place now).
        if deviceVendor == .jstyle {
            let result = jstyleParser.parse(bytes: b, channel: .v1, nowMs: Int64(nowMsUnique()))
            for sample in result.samples { absorbPackageSample(sample) }
            return
        }

        // R09 packet layout (verified from 553 debug_raw packets):
        //   [0]=0x69 (cmd), [1]=type, [2]=error_code (always 0 on R09)
        //   [3]=value (HR BPM; appears ~28s after start)
        //   [4-5]=unused
        //   [6-7]=RR interval LE 16-bit ms (appears ~10s after start)
        //   [8-14]=unused, [15]=checksum
        //
        // R02 compatibility: R02 may use [2]=value, [3]=unused — we check both
        // byte positions to handle either format transparently.
        let type = b[1]

        let now = nowMsUnique()
        switch type {
        case Self.RT_TYPE_HR:
            // Extract RR interval from bytes[6-7] LE (R09 confirmed format)
            let rrMs = Int(b[6]) | (Int(b[7]) << 8)
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

            // Extract HR BPM — try byte[3] first (R09), fallback to byte[2] (R02)
            let hrR09 = Int(b[3])
            let hrR02 = Int(b[2])
            let hr: Int
            if (30...220).contains(hrR09) {
                hr = hrR09
            } else if (30...220).contains(hrR02) {
                hr = hrR02
            } else if (300...2000).contains(rrMs) {
                // Derive HR from RR interval when no direct BPM yet
                hr = Int(round(60000.0 / Double(rrMs)))
            } else {
                return  // warmup — no usable data yet
            }

            realtimeHrSamples.append([
                "type": "hr",
                "ts": now,
                "value": hr,
                "source": "qring_ble",
                "payload_json": [
                    "mode": "realtime",
                    "rr_ms": rrMs > 0 ? rrMs as Any : 0 as Any,
                    "byte2": Int(b[2]),
                    "byte3": Int(b[3]),
                ],
            ])
            notifyListeners("realtime", data: ["type": "hr", "value": hr])

        case Self.RT_TYPE_SPO2:
            // R09 realtime SpO2 returns all zeros (confirmed). Still parse for
            // forward compatibility if future firmware fixes this.
            let v = max(Int(b[3]), Int(b[2]))
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
            // R09 realtime HRV returns all zeros (confirmed). Still parse for
            // forward compatibility.
            let v = max(Int(b[3]), Int(b[2]))
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

    /// Snapshot HR values + RR intervals before flush clears the arrays.
    private var deriveSavedHR: [Int] = []
    private var deriveSavedRR: [Int] = []

    private func snapshotForDerive() {
        deriveSavedHR.removeAll()
        deriveSavedRR.removeAll()
        for s in hrSamples {
            if let v = s["value"] as? Int, (30...220).contains(v) { deriveSavedHR.append(v) }
        }
        for s in realtimeHrSamples {
            if let v = s["value"] as? Int, (30...220).contains(v) { deriveSavedHR.append(v) }
        }
        deriveSavedRR = realtimeRRIntervals
    }

    private func deriveBiomarkers() {
        let now = nowMsUnique()

        // --- RHR: lowest 10th percentile of HR readings ---
        let allHR = deriveSavedHR
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
        if deriveSavedRR.count >= 3 {
            var sumSqDiff: Double = 0
            for i in 1..<deriveSavedRR.count {
                let diff = Double(deriveSavedRR[i] - deriveSavedRR[i - 1])
                sumSqDiff += diff * diff
            }
            let rmssd = sqrt(sumSqDiff / Double(deriveSavedRR.count - 1))
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
            || upper.contains("JSTYLE") || upper.contains("J-STYLE")
            || upper.contains("X3") || upper.contains("X5") || upper.contains("JCVITAL")

        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?.map { $0.uuidString } ?? []
        let overflow = (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID])?.map { $0.uuidString } ?? []
        let manufacturerData = (advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data)?.map { String(format: "%02X", $0) }.joined(separator: " ") ?? ""

        // Retain peripheral so it survives until connect() is called
        discoveredPeripherals[peripheral.identifier] = peripheral

        NSLog("[QRing] didDiscover name=%@ rssi=%@ services=%@ manuf=%@",
              name, RSSI, services.joined(separator: ","), manufacturerData)

        let id = peripheral.identifier.uuidString
        let ev: [String: Any] = [
            "deviceId": id,
            "name": name,
            "mac": id,
            "rssi": RSSI.intValue,
            "vendor": inferVendor(from: name).rawValue,
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
        if n.contains("X3")  { return "X3" }
        if n.contains("X5")  { return "X5" }
        if n.contains("JCVITAL") || n.contains("V5") { return "V5" }
        return "unknown"
    }

    private func inferVendor(from name: String) -> DeviceVendor {
        let n = name.uppercased()
        // JStyle FIRST — model-specific tokens (X3/X5/V5/JCVITAL/JCRING/J-STYLE)
        // are unambiguous JStyle hardware. Some Chinese white-label rings advertise
        // as "Colmi X5" or "ColmiRing X5" — the X5 token must win over COLMI brand.
        // Verified bug: Diego's X5 was registered as vendor=colmi on 2026-05-01
        // because old inferVendor matched COLMI substring first → sync took Colmi
        // path → CMDs 0x15/0x16/0x43 unsupported by JStyle firmware → silent fail.
        if n.contains("JSTYLE") || n.contains("J-STYLE") || n.contains("JCVITAL")
            || n.contains("JCRING") || n.contains("X3") || n.contains("X5")
            || n.contains("V5") || n.contains("V8") || n.contains("V10") {
            NSLog("[QRing] inferVendor: '%@' -> jstyle (model token match)", name)
            return .jstyle
        }
        // Colmi second — generic brand + R-series model tokens
        if n.contains("COLMI") || n.contains("QRING") || n.contains("R02")
            || n.contains("R03") || n.contains("R06") || n.contains("R09") || n.contains("R10") {
            NSLog("[QRing] inferVendor: '%@' -> colmi (brand/R-series match)", name)
            return .colmi
        }
        NSLog("[QRing] inferVendor: '%@' -> unknown (no token matched)", name)
        return .unknown
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        NSLog("[QRing] connected, discovering services…")
        // 1.5s settle before service discovery. Build 360 dropped this to 0.5s
        // chasing a phantom timeout race; that turned out to break JStyle X3/X5
        // service discovery silently (didConnect fires but discoverServices gets
        // an empty/incomplete tree → connect hangs until the 20s timeout). 1.5s
        // is the conservative middle ground vs the original 2.0s.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            // Discover ALL services (nil filter) so we can see R09's actual
            // GATT tree, not just the Nordic UART we expected. Some Colmi
            // variants expose their control characteristics on a proprietary
            // Colmi service UUID instead of Nordic UART 6E40FFF0.
            peripheral.discoverServices(nil)
        }
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        let msg = error?.localizedDescription ?? "unknown"
        let nsErr = error as NSError?
        let detail = nsErr.map { "code=\($0.code) domain=\($0.domain) — \(msg)" } ?? msg
        NSLog("[QRing] didFailToConnect: %@", detail)
        lastError = "didFailToConnect: \(detail)"
        emitDebug()
        connectCall?.reject("CONNECT_FAILED: \(detail)")
        connectCall = nil
    }

    /// Called by iOS when the app is relaunched and CoreBluetooth has restored
    /// state from a previous session. Rehydrate `discoveredPeripherals` so a
    /// follow-up `connect(deviceId:)` from JS works without a fresh scan.
    public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        guard let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] else { return }
        NSLog("[QRing] willRestoreState restored=%d peripherals", restored.count)
        for p in restored {
            discoveredPeripherals[p.identifier] = p
            p.delegate = self
        }
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        // If a sync was in progress, flush whatever we collected and resolve
        // instead of leaving the JS promise hanging forever.
        if let c = pendingSyncCall {
            NSLog("[QRing] disconnect during sync — flushing collected data")
            flushRealtimeBatch(type: "hr", samples: &realtimeHrSamples)
            flushRealtimeBatch(type: "spo2", samples: &realtimeSpo2Samples)
            flushRealtimeBatch(type: "hrv", samples: &realtimeHrvSamples)
            deriveBiomarkers()
            flushDebugRawBatch(force: true)
            c.resolve([
                "hr_count": hrSamples.count,
                "steps_count": stepsSamples.count,
                "sleep_count": sleepSamples.count,
                "spo2_count": spo2Samples.count,
                "hrv_count": hrvSamples.count,
                "stress_count": stressSamples.count,
                "temp_count": tempSamples.count,
                "rt_hr_count": realtimeHrSamples.count,
                "rr_count": realtimeRRIntervals.count,
                "fw_version": firmwareRev ?? "",
                "disconnected_early": true,
            ])
            pendingSyncCall = nil
        }
        // Stop PPG measurement if it was running — its native timers would
        // otherwise keep firing against a dead peripheral.
        jsStopPPGMeasurement(notify: true)

        deviceVendor = .unknown
        writeChar = nil
        writeCharV2 = nil
        notifyChar = nil
        notifyCharV2 = nil
        firmwareRev = nil
        opLock.lock()
        opQueue.removeAll()
        opInFlight = false
        opLock.unlock()
        opLockV2.lock()
        opQueueV2.removeAll()
        opInFlightV2 = false
        opLockV2.unlock()
        let reason = error?.localizedDescription ?? "clean"
        NSLog("[QRing] disconnected: %@", reason)
        lastError = "disconnected: \(reason)"
        emitDebug()

        // Notify the JS layer so the UI can transition out of "connected"
        // state. Without this, build 367/368 left the card showing "Anel
        // conectado" even after the ring was out of range — and the next
        // sync/measure attempt rejected with NOT_CONNECTED with no clue
        // for the user.
        let nsErr = error as NSError?
        notifyListeners("connectionLost", data: [
            "reason": reason,
            "code": nsErr?.code ?? 0,
            "domain": nsErr?.domain ?? "",
            "deviceId": peripheral.identifier.uuidString,
        ])
    }
}

// MARK: - CBPeripheralDelegate

extension QRingPlugin: CBPeripheralDelegate {
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        // Build 412: services discovered = connect saudável. Cancela stale timer.
        connectStaleTimer?.cancel()
        connectStaleTimer = nil
        connectRetryCount = 0
        guard error == nil else {
            let msg = error!.localizedDescription
            NSLog("[QRing] didDiscoverServices error: %@", msg)
            lastError = "SERVICE_DISCOVERY_FAILED: \(msg)"
            emitDebug()
            connectCall?.reject("SERVICE_DISCOVERY_FAILED: \(msg)")
            connectCall = nil
            return
        }
        // Track discovered services for debug UI
        discoveredServices = (peripheral.services ?? []).map { $0.uuid.uuidString }
        emitDebug()

        for service in peripheral.services ?? [] {
            if service.uuid == Self.serviceUUID {
                peripheral.discoverCharacteristics([Self.writeUUID, Self.notifyUUID], for: service)
            } else if service.uuid == Self.jstyleServiceUUID {
                // JStyle X3/X5 ring â FFF0 service with FFF6 write, FFF7 notify
                // IMPORTANT: Do NOT override .colmi detected by name â some Colmi rings
                // (R09) also expose a short FFF0 service but use the Colmi protocol.
                if deviceVendor == .unknown { deviceVendor = .jstyle }
                if deviceVendor == .jstyle {
                    NSLog("[QRing] FFF0 service found â vendor confirmed jstyle")
                    peripheral.discoverCharacteristics([Self.jstyleWriteUUID, Self.jstyleNotifyUUID], for: service)
                } else {
                    NSLog("[QRing] FFF0 service found but vendor is %@ â skipping JStyle chars", deviceVendor.rawValue)
                }
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
                NSLog("[QRing] V1 writeChar set (Colmi)")
            case Self.notifyUUID:
                notifyChar = char
                peripheral.setNotifyValue(true, for: char)
                NSLog("[QRing] V1 notifyChar set + subscribed (Colmi)")
            case Self.jstyleWriteUUID:
                writeChar = char
                NSLog("[QRing] writeChar set (JStyle FFF6)")
            case Self.jstyleNotifyUUID:
                notifyChar = char
                peripheral.setNotifyValue(true, for: char)
                NSLog("[QRing] notifyChar set + subscribed (JStyle FFF7)")
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
            // Re-detect vendor now that name is available post-connection
            if let pName = peripheral.name, !pName.isEmpty {
                let detected = inferVendor(from: pName)
                if detected != .unknown && deviceVendor != detected {
                    deviceVendor = detected
                    NSLog("[QRing] Vendor corrected post-connect: '%@' -> %@", pName, detected.rawValue)
                }
            }

            // Re-detect vendor now that name is available post-connection
            if let pName = peripheral.name, !pName.isEmpty {
                let detected = inferVendor(from: pName)
                if detected != .unknown && deviceVendor != detected {
                    deviceVendor = detected
                    NSLog("[QRing] Vendor corrected post-connect: '%@' -> %@", pName, detected.rawValue)
                }
            }

            connectCall?.resolve([
                "connected": true,
                "deviceId": id,
                "mac": id,
                "name": peripheral.name ?? "QRing",
                "model": inferModel(from: peripheral.name ?? ""),
                "vendor": self.deviceVendor.rawValue,
            ])
            connectCall = nil
            notifyListeners("connected", data: [
                "deviceId": id,
                "mac": id,
                "name": peripheral.name ?? "QRing"
            ])

            // SetDeviceTime no connect — desbloqueia parsing de history (cmd 0x54 etc).
            // Sem isso, o anel mantém data interna desatualizada e history packets vêm
            // com year inválido (rejeitados pelo isValidDate em parse-vendor-raw).
            // BCD format aplicado em jsSendSetTime (corrigido 2026-05-10).
            if self.deviceVendor == .jstyle {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                    self?.jsSendSetTime()
                }
            } else if self.deviceVendor == .colmi {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                    self?.sendSetTime()
                }
            }
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
        // Route V1 vs V2 vs JStyle notifications
        if characteristic.uuid == Self.notifyUUIDv2 || characteristic == notifyCharV2 {
            handleNotifyV2(data)
        } else if deviceVendor == .jstyle {
            let hex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
            lastNotifyHex = hex
            notifiesReceived += 1
            NSLog("[QRing] NOTIFY JStyle %@", hex)
            emitDebug()
            emitDebugRaw(channel: "v1", hex: hex)
            guard data.count >= 2 else { return }
            handleJStyleNotify([UInt8](data), hex: hex)
        } else {
            handleNotify(data)
        }
    }
}

// Compatibility alias because `Boolean` doesn't exist in Swift — we want `Bool`
private typealias Boolean = Bool
