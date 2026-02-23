import Capacitor
import HealthKit

/// Native Capacitor plugin for HealthKit operations not supported by @capgo/capacitor-health:
/// - Write: bodyTemperature, bloodPressure (correlation), vo2Max, activeEnergyBurned
/// - Background Delivery: enableBackgroundDelivery + HKObserverQuery
/// - Anchored queries (future: incremental sync)
@objc(VYRHealthBridge)
public class VYRHealthBridge: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VYRHealthBridge"
    public let jsName = "VYRHealthBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeBodyTemperature", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeBloodPressure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeVO2Max", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeActiveEnergy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableBackgroundDelivery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestWriteAuthorization", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()
    private let isoFormatter = ISO8601DateFormatter()

    // MARK: - Authorization for bridge-only types

    @objc func requestWriteAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available")
            return
        }

        let writeTypes: Set<HKSampleType> = [
            HKQuantityType(.bodyTemperature),
            HKQuantityType(.bloodPressureSystolic),
            HKQuantityType(.bloodPressureDiastolic),
            HKQuantityType(.vo2Max),
            HKQuantityType(.activeEnergyBurned),
        ]

        let readTypes: Set<HKObjectType> = [
            HKQuantityType(.bodyTemperature),
            HKCorrelationType(.bloodPressure),
            HKQuantityType(.vo2Max),
            HKQuantityType(.activeEnergyBurned),
            // Background delivery types
            HKQuantityType(.heartRate),
            HKQuantityType(.stepCount),
            HKQuantityType(.heartRateVariabilitySDNN),
            HKCategoryType(.sleepAnalysis),
            HKQuantityType(.oxygenSaturation),
        ]

        store.requestAuthorization(toShare: writeTypes, read: readTypes) { ok, err in
            if let err = err {
                call.reject(err.localizedDescription)
            } else {
                call.resolve(["granted": ok])
            }
        }
    }

    // MARK: - Write body temperature

    @objc func writeBodyTemperature(_ call: CAPPluginCall) {
        guard let value = call.getDouble("value") else {
            call.reject("value (degC) required")
            return
        }
        let date = parseDate(call.getString("date")) ?? Date()
        let type = HKQuantityType(.bodyTemperature)
        let qty = HKQuantity(unit: .degreeCelsius(), doubleValue: value)
        let sample = HKQuantitySample(type: type, quantity: qty, start: date, end: date)
        store.save(sample) { ok, err in
            ok ? call.resolve() : call.reject(err?.localizedDescription ?? "save failed")
        }
    }

    // MARK: - Write blood pressure (correlation)

    @objc func writeBloodPressure(_ call: CAPPluginCall) {
        guard let sys = call.getDouble("systolic"),
              let dia = call.getDouble("diastolic") else {
            call.reject("systolic and diastolic required")
            return
        }
        let date = parseDate(call.getString("date")) ?? Date()
        let mmHg = HKUnit.millimeterOfMercury()
        let sysType = HKQuantityType(.bloodPressureSystolic)
        let diaType = HKQuantityType(.bloodPressureDiastolic)
        let sysSample = HKQuantitySample(type: sysType, quantity: HKQuantity(unit: mmHg, doubleValue: sys), start: date, end: date)
        let diaSample = HKQuantitySample(type: diaType, quantity: HKQuantity(unit: mmHg, doubleValue: dia), start: date, end: date)
        let bpType = HKCorrelationType(.bloodPressure)
        let correlation = HKCorrelation(type: bpType, start: date, end: date, objects: [sysSample, diaSample])
        store.save(correlation) { ok, err in
            ok ? call.resolve() : call.reject(err?.localizedDescription ?? "save failed")
        }
    }

    // MARK: - Write VO2 Max

    @objc func writeVO2Max(_ call: CAPPluginCall) {
        guard let value = call.getDouble("value") else {
            call.reject("value (mL/kg/min) required")
            return
        }
        let date = parseDate(call.getString("date")) ?? Date()
        let type = HKQuantityType(.vo2Max)
        let unit = HKUnit(from: "mL/kg*min")
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: unit, doubleValue: value), start: date, end: date)
        store.save(sample) { ok, err in
            ok ? call.resolve() : call.reject(err?.localizedDescription ?? "save failed")
        }
    }

    // MARK: - Write active energy

    @objc func writeActiveEnergy(_ call: CAPPluginCall) {
        guard let kcal = call.getDouble("kcal") else {
            call.reject("kcal required")
            return
        }
        let start = parseDate(call.getString("startDate")) ?? Date()
        let end = parseDate(call.getString("endDate")) ?? start
        let type = HKQuantityType(.activeEnergyBurned)
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal), start: start, end: end)
        store.save(sample) { ok, err in
            ok ? call.resolve() : call.reject(err?.localizedDescription ?? "save failed")
        }
    }

    // MARK: - Background Delivery

    @objc func enableBackgroundDelivery(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available")
            return
        }

        let types: [HKObjectType] = [
            HKQuantityType(.heartRate),
            HKQuantityType(.stepCount),
            HKQuantityType(.heartRateVariabilitySDNN),
            HKCategoryType(.sleepAnalysis),
            HKQuantityType(.oxygenSaturation),
            HKQuantityType(.restingHeartRate),
            HKQuantityType(.respiratoryRate),
        ]

        let group = DispatchGroup()
        var errors: [String] = []

        for t in types {
            group.enter()
            store.enableBackgroundDelivery(for: t, frequency: .hourly) { ok, err in
                if !ok, let err = err {
                    errors.append("\(t): \(err.localizedDescription)")
                }
                group.leave()
            }
        }

        group.notify(queue: .main) {
            if errors.isEmpty {
                call.resolve(["enabled": true, "types": types.count])
            } else {
                call.resolve(["enabled": true, "errors": errors])
            }
        }
    }

    // MARK: - Helpers

    private func parseDate(_ str: String?) -> Date? {
        guard let str = str else { return nil }
        return isoFormatter.date(from: str)
    }
}
