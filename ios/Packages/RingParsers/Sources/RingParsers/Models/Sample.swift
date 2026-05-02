import Foundation

public enum SampleType: String, Codable, Sendable {
    case hr
    case rr_interval
    case hrv
    case spo2
    case stress
    case temp
    case sleep
    case steps
}

public enum SampleMode: String, Codable, Sendable {
    case realtime
    case history
    case derived
    case streaming
    case initial
}

public struct Sample: Equatable, Sendable {
    public let type: SampleType
    public let value: Double
    public let timestampMs: Int64
    public let mode: SampleMode
    public let metadata: [String: String]

    public init(
        type: SampleType,
        value: Double,
        timestampMs: Int64,
        mode: SampleMode,
        metadata: [String: String] = [:]
    ) {
        self.type = type
        self.value = value
        self.timestampMs = timestampMs
        self.mode = mode
        self.metadata = metadata
    }
}

public struct ParseResult: Equatable, Sendable {
    public let samples: [Sample]
    public let unrecognized: [String]
    public let errors: [String]

    public init(samples: [Sample] = [], unrecognized: [String] = [], errors: [String] = []) {
        self.samples = samples
        self.unrecognized = unrecognized
        self.errors = errors
    }

    public func merging(_ other: ParseResult) -> ParseResult {
        ParseResult(
            samples: samples + other.samples,
            unrecognized: unrecognized + other.unrecognized,
            errors: errors + other.errors
        )
    }

    public func samples(of t: SampleType) -> [Sample] { samples.filter { $0.type == t } }
}
