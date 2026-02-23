import Foundation
import Capacitor
import HealthKit

@objc(VYRHealthBridge)
public class VYRHealthBridge: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VYRHealthBridge"
    public let jsName = "VYRHealthBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeBodyTemperature", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeBloodPressure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeVO2Max", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeActiveEnergyBurned", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAuthorizationStatuses", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableBackgroundDelivery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerObserverQueries", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readAnchored", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()
    private var observerQueries: [HKObserverQuery] = []

    private func sampleType(for key: String) -> HKSampleType? {
        switch key {
        case "steps":
            return HKObjectType.quantityType(forIdentifier: .stepCount)
        case "bodyTemperature":
            return HKObjectType.quantityType(forIdentifier: .bodyTemperature)
        case "heartRate":
            return HKObjectType.quantityType(forIdentifier: .heartRate)
        case "heartRateVariability":
            return HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
        case "bloodPressureSystolic":
            return HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic)
        case "bloodPressureDiastolic":
            return HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic)
        case "vo2Max":
            return HKObjectType.quantityType(forIdentifier: .vo2Max)
        case "oxygenSaturation":
            return HKObjectType.quantityType(forIdentifier: .oxygenSaturation)
        case "activeEnergyBurned":
            return HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)
        case "sleep":
            return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
        case "restingHeartRate":
            return HKObjectType.quantityType(forIdentifier: .restingHeartRate)
        case "respiratoryRate":
            return HKObjectType.quantityType(forIdentifier: .respiratoryRate)
        default:
            return nil
        }
    }

    private func anchorFromString(_ raw: String?) -> HKQueryAnchor? {
        guard let raw else { return nil }
        guard let data = Data(base64Encoded: raw) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func anchorToString(_ anchor: HKQueryAnchor?) -> String? {
        guard let anchor else { return nil }
        guard let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) else {
            return nil
        }
        return data.base64EncodedString()
    }

    @objc func writeBodyTemperature(_ call: CAPPluginCall) {
        guard let value = call.getDouble("value"), let startISO = call.getString("startDate") else {
            call.reject("value and startDate are required")
            return
        }

        let startDate = ISO8601DateFormatter().date(from: startISO) ?? Date()
        let endDate = ISO8601DateFormatter().date(from: call.getString("endDate") ?? startISO) ?? startDate
        guard let type = HKObjectType.quantityType(forIdentifier: .bodyTemperature) else {
            call.reject("bodyTemperature type unavailable")
            return
        }

        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: HKUnit.degreeCelsius(), doubleValue: value), start: startDate, end: endDate)
        healthStore.save(sample) { success, error in
            if success { call.resolve(["success": true]) } else { call.reject(error?.localizedDescription ?? "HealthKit write error") }
        }
    }

    @objc func writeBloodPressure(_ call: CAPPluginCall) {
        guard let systolic = call.getDouble("systolic"), let diastolic = call.getDouble("diastolic"), let startISO = call.getString("startDate") else {
            call.reject("systolic, diastolic and startDate are required")
            return
        }

        let startDate = ISO8601DateFormatter().date(from: startISO) ?? Date()
        let endDate = ISO8601DateFormatter().date(from: call.getString("endDate") ?? startISO) ?? startDate
        guard let systolicType = HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic),
              let diastolicType = HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic),
              let bpType = HKObjectType.correlationType(forIdentifier: .bloodPressure) else {
            call.reject("bloodPressure type unavailable")
            return
        }

        let unit = HKUnit.millimeterOfMercury()
        let sysSample = HKQuantitySample(type: systolicType, quantity: HKQuantity(unit: unit, doubleValue: systolic), start: startDate, end: endDate)
        let diaSample = HKQuantitySample(type: diastolicType, quantity: HKQuantity(unit: unit, doubleValue: diastolic), start: startDate, end: endDate)
        let correlation = HKCorrelation(type: bpType, start: startDate, end: endDate, objects: [sysSample, diaSample])

        healthStore.save(correlation) { success, error in
            if success { call.resolve(["success": true]) } else { call.reject(error?.localizedDescription ?? "HealthKit write error") }
        }
    }

    @objc func writeVO2Max(_ call: CAPPluginCall) {
        guard let value = call.getDouble("value"), let startISO = call.getString("startDate") else {
            call.reject("value and startDate are required")
            return
        }

        let startDate = ISO8601DateFormatter().date(from: startISO) ?? Date()
        let endDate = ISO8601DateFormatter().date(from: call.getString("endDate") ?? startISO) ?? startDate
        guard let type = HKObjectType.quantityType(forIdentifier: .vo2Max) else {
            call.reject("vo2Max type unavailable")
            return
        }

        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: HKUnit(from: "mL/kg*min"), doubleValue: value), start: startDate, end: endDate)
        healthStore.save(sample) { success, error in
            if success { call.resolve(["success": true]) } else { call.reject(error?.localizedDescription ?? "HealthKit write error") }
        }
    }

    @objc func writeActiveEnergyBurned(_ call: CAPPluginCall) {
        guard let value = call.getDouble("value"), let startISO = call.getString("startDate") else {
            call.reject("value and startDate are required")
            return
        }

        let startDate = ISO8601DateFormatter().date(from: startISO) ?? Date()
        let endDate = ISO8601DateFormatter().date(from: call.getString("endDate") ?? startISO) ?? startDate
        guard let type = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else {
            call.reject("activeEnergyBurned type unavailable")
            return
        }

        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: HKUnit.kilocalorie(), doubleValue: value), start: startDate, end: endDate)
        healthStore.save(sample) { success, error in
            if success { call.resolve(["success": true]) } else { call.reject(error?.localizedDescription ?? "HealthKit write error") }
        }
    }

    @objc func getAuthorizationStatuses(_ call: CAPPluginCall) {
        guard let types = call.getArray("types", String.self) else {
            call.reject("types is required")
            return
        }

        var statuses: [String: String] = [:]
        for key in types {
            guard let type = sampleType(for: key) else {
                statuses[key] = "unknown"
                continue
            }

            switch healthStore.authorizationStatus(for: type) {
            case .notDetermined:
                statuses[key] = "notDetermined"
            case .sharingDenied:
                statuses[key] = "sharingDenied"
            case .sharingAuthorized:
                statuses[key] = "sharingAuthorized"
            @unknown default:
                statuses[key] = "unknown"
            }
        }

        call.resolve(["statuses": statuses])
    }

    @objc func enableBackgroundDelivery(_ call: CAPPluginCall) {
        guard let key = call.getString("type"), let type = sampleType(for: key) else {
            call.reject("type is required")
            return
        }

        let frequencyRaw = call.getString("frequency") ?? "hourly"
        let frequency: HKUpdateFrequency = frequencyRaw == "immediate" ? .immediate : (frequencyRaw == "daily" ? .daily : .hourly)

        healthStore.enableBackgroundDelivery(for: type, frequency: frequency) { success, error in
            if success { call.resolve(["success": true]) } else { call.reject(error?.localizedDescription ?? "Unable to enable background delivery") }
        }
    }

    @objc func registerObserverQueries(_ call: CAPPluginCall) {
        guard let keys = call.getArray("types", String.self) else {
            call.reject("types is required")
            return
        }

        observerQueries.forEach { healthStore.stop($0) }
        observerQueries.removeAll()

        for key in keys {
            guard let type = sampleType(for: key) else { continue }
            let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completionHandler, error in
                defer { completionHandler() }
                if let error {
                    self?.notifyListeners("healthkitObserverError", data: ["type": key, "error": error.localizedDescription])
                    return
                }
                self?.notifyListeners("healthkitObserverUpdated", data: ["type": key])
            }
            observerQueries.append(query)
            healthStore.execute(query)
        }

        call.resolve(["registered": observerQueries.count])
    }

    @objc func readAnchored(_ call: CAPPluginCall) {
        guard let key = call.getString("type"), let type = sampleType(for: key) else {
            call.reject("type is required")
            return
        }

        let limit = call.getInt("limit") ?? HKObjectQueryNoLimit
        let anchor = anchorFromString(call.getString("anchor"))

        let query = HKAnchoredObjectQuery(type: type, predicate: nil, anchor: anchor, limit: limit) { [weak self] _, samplesOrNil, _, newAnchor, error in
            if let error {
                call.reject(error.localizedDescription)
                return
            }

            let samples = samplesOrNil ?? []
            let mapped: [[String: Any]] = samples.compactMap { self?.serialize(sample: $0) }
            call.resolve([
                "samples": mapped,
                "newAnchor": self?.anchorToString(newAnchor) as Any,
            ])
        }

        healthStore.execute(query)
    }

    private func serialize(sample: HKSample) -> [String: Any]? {
        var data: [String: Any] = [
            "startDate": ISO8601DateFormatter().string(from: sample.startDate),
            "endDate": ISO8601DateFormatter().string(from: sample.endDate),
            "uuid": sample.uuid.uuidString,
        ]

        if let q = sample as? HKQuantitySample {
            data["value"] = q.quantity.doubleValue(for: HKUnit.count())
        }

        if let c = sample as? HKCategorySample {
            data["value"] = c.value
        }

        return data
    }
}
