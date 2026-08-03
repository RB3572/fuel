import HealthKit

// The catalog of everything Health Logger exports. Adding a new HealthKit type is a
// one-line change here — the sync engine, the payload and the backend all treat types
// generically, which is the whole point of the protocol design.

enum HealthKitCatalog {

    // MARK: Quantity types — (identifier, unit it is exported in)

    /// The wire name for a type strips the "HKQuantityTypeIdentifier" prefix, so the
    /// backend sees stable, readable names like "stepCount" and "heartRate".
    static let quantityTypes: [(HKQuantityTypeIdentifier, HKUnit)] = [
        // Activity
        (.stepCount, .count()),
        (.distanceWalkingRunning, .meter()),
        (.distanceCycling, .meter()),
        (.distanceSwimming, .meter()),
        (.swimmingStrokeCount, .count()),
        (.flightsClimbed, .count()),
        (.activeEnergyBurned, .kilocalorie()),
        (.basalEnergyBurned, .kilocalorie()),
        (.appleExerciseTime, .minute()),
        (.appleStandTime, .minute()),
        (.appleMoveTime, .minute()),
        // Heart
        (.heartRate, HKUnit.count().unitDivided(by: .minute())),
        (.restingHeartRate, HKUnit.count().unitDivided(by: .minute())),
        (.walkingHeartRateAverage, HKUnit.count().unitDivided(by: .minute())),
        (.heartRateRecoveryOneMinute, HKUnit.count().unitDivided(by: .minute())),
        (.heartRateVariabilitySDNN, .secondUnit(with: .milli)),
        (.vo2Max, HKUnit(from: "ml/kg*min")),
        // Body
        (.bodyMass, .gramUnit(with: .kilo)),
        (.bodyMassIndex, .count()),
        (.bodyFatPercentage, .percent()),
        (.leanBodyMass, .gramUnit(with: .kilo)),
        (.height, .meterUnit(with: .centi)),
        // Vitals
        (.oxygenSaturation, .percent()),
        (.respiratoryRate, HKUnit.count().unitDivided(by: .minute())),
        (.appleSleepingWristTemperature, .degreeCelsius()),
        (.bodyTemperature, .degreeCelsius()),
        // Clinical-adjacent measurements (regular quantity types, no special entitlement)
        (.bloodGlucose, HKUnit(from: "mg/dL")),
        (.bloodPressureSystolic, .millimeterOfMercury()),
        (.bloodPressureDiastolic, .millimeterOfMercury()),
        // Mobility
        (.walkingSpeed, HKUnit.meter().unitDivided(by: .second())),
        (.walkingAsymmetryPercentage, .percent()),
        (.walkingStepLength, .meterUnit(with: .centi)),
        (.walkingDoubleSupportPercentage, .percent()),
        (.runningStrideLength, .meter()),
    ]

    // MARK: Category types

    static let categoryTypes: [HKCategoryTypeIdentifier] = [
        .sleepAnalysis,
        .appleStandHour,
        .mindfulSession,
    ]

    // MARK: Assembled sets

    static var allSampleTypes: [HKSampleType] {
        var types: [HKSampleType] = quantityTypes.compactMap { HKObjectType.quantityType(forIdentifier: $0.0) }
        types.append(contentsOf: categoryTypes.compactMap { HKObjectType.categoryType(forIdentifier: $0) })
        types.append(HKObjectType.workoutType())
        types.append(HKSeriesType.workoutRoute())
        return types
    }

    static var readTypes: Set<HKObjectType> { Set(allSampleTypes) }

    static func unit(for identifier: HKQuantityTypeIdentifier) -> HKUnit {
        quantityTypes.first { $0.0 == identifier }?.1 ?? .count()
    }

    /// "HKQuantityTypeIdentifierStepCount" -> "stepCount"
    static func wireName(_ raw: String) -> String {
        for prefix in ["HKQuantityTypeIdentifier", "HKCategoryTypeIdentifier", "HKWorkoutTypeIdentifier"] where raw.hasPrefix(prefix) {
            let stripped = raw.dropFirst(prefix.count)
            return stripped.prefix(1).lowercased() + stripped.dropFirst()
        }
        return raw
    }

    /// Human-readable sleep stage names, matching what the backend stores in value_name.
    static func sleepStageName(_ value: Int) -> String {
        switch HKCategoryValueSleepAnalysis(rawValue: value) {
        case .inBed: return "inBed"
        case .asleepUnspecified: return "asleep"
        case .awake: return "awake"
        case .asleepCore: return "asleepCore"
        case .asleepDeep: return "asleepDeep"
        case .asleepREM: return "asleepREM"
        default: return "unknown"
        }
    }
}
