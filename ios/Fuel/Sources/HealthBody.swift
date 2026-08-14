import Foundation
import HealthKit

// Body composition, read straight from HealthKit.
//
// Separate from SyncEngine on purpose: that replicates daily *totals* — steps, energy,
// distance — where one row per day is the right shape. A weigh-in is not a daily total.
// It happens at a moment, a scale can produce several in a morning, and the reading
// keeps its own identity so the same weigh-in arriving twice stays one measurement.

enum HealthBody {
    struct Sample {
        /// The HealthKit sample UUID, which is what keeps a re-read from duplicating.
        var id: String
        var date: Date
        var weightLb: Double?
        var bodyFatPercent: Double?
        var leanMassLb: Double?
    }

    static let readTypes: Set<HKObjectType> = {
        var types: Set<HKObjectType> = []
        for identifier in [HKQuantityTypeIdentifier.bodyMass,
                           .bodyFatPercentage,
                           .leanBodyMass,
                           .bodyMassIndex,
                           .waistCircumference] {
            if let type = HKObjectType.quantityType(forIdentifier: identifier) { types.insert(type) }
        }
        return types
    }()

    /// Weigh-ins first, then whatever fat/lean readings share their moment — a smart
    /// scale writes them as separate samples taken at the same instant, so they are
    /// matched back together by timestamp rather than assumed to arrive as one record.
    static func recentSamples(days: Int) async -> [Sample] {
        let store = HKHealthStore()
        guard HKHealthStore.isHealthDataAvailable(),
              let massType = HKObjectType.quantityType(forIdentifier: .bodyMass) else { return [] }
        let start = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)

        async let masses = quantities(store, massType, predicate, HKUnit.pound())
        async let fats = quantities(store, HKObjectType.quantityType(forIdentifier: .bodyFatPercentage), predicate, HKUnit.percent())
        async let leans = quantities(store, HKObjectType.quantityType(forIdentifier: .leanBodyMass), predicate, HKUnit.pound())

        let (weights, fatReadings, leanReadings) = await (masses, fats, leans)
        // Within a couple of minutes counts as the same weigh-in: a scale writes its
        // several samples in one burst, but not at literally the same timestamp.
        func near(_ date: Date, in readings: [(Date, Double)]) -> Double? {
            readings.first { abs($0.0.timeIntervalSince(date)) < 120 }?.1
        }
        return weights.map { entry in
            Sample(id: entry.2, date: entry.0, weightLb: entry.1,
                   bodyFatPercent: near(entry.0, in: fatReadings.map { ($0.0, $0.1 * 100) }),
                   leanMassLb: near(entry.0, in: leanReadings.map { ($0.0, $0.1) }))
        }
    }

    private static func quantities(_ store: HKHealthStore, _ type: HKQuantityType?,
                                   _ predicate: NSPredicate, _ unit: HKUnit) async -> [(Date, Double, String)] {
        guard let type else { return [] }
        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: 500,
                                      sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]) { _, samples, _ in
                let values = (samples as? [HKQuantitySample] ?? []).map {
                    ($0.startDate, $0.quantity.doubleValue(for: unit), $0.uuid.uuidString)
                }
                continuation.resume(returning: values)
            }
            store.execute(query)
        }
    }
}
