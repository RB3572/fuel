import Foundation
import HealthKit

// The heart of Health Logger: it computes one row per day from HealthKit and sends that.
//
// It used to replicate the entire HealthKit store — every individual sample, anchored
// and paged. That was enormously more data than anything ever read: a watch writes a
// heart-rate sample every few seconds, the raw tables grew to 481 MB, they hit the
// database's storage ceiling and broke every sync, and not one screen in the app or the
// website queried them. Everything on every screen comes from the per-day rollups.
//
// So the daily rollup is now the whole payload. What ships is exactly the question each
// figure answers — total steps walked that day, total swim strokes, total active
// calories — not the thousands of readings those totals were computed from.
//
// The totals are computed here with HKStatisticsCollectionQuery rather than summed
// server-side, because only HealthKit knows how to deduplicate a watch and a phone
// counting the same steps. That was the reason aggregates were device-side before, and
// it is why dropping the raw samples loses no accuracy: the numbers were never derived
// from them.
//
// The device keeps everything. HealthKit remains the complete record, so a future need
// for finer data is a re-read away rather than a permanent loss.

final class SyncEngine {
    static let shared = SyncEngine()
    let healthStore = HKHealthStore()

    private let iso = ISO8601DateFormatter()
    private var running = false

    // MARK: Authorization

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw NSError(domain: "HealthLogger", code: 1, userInfo: [NSLocalizedDescriptionKey: "Health data is not available on this device."])
        }
        try await healthStore.requestAuthorization(toShare: [], read: HealthKitCatalog.readTypes)
    }

    // MARK: The sync

    /// Runs one sync pass: every type's outstanding delta, daily aggregates, and an
    /// intraday snapshot. Safe to call from foreground, background refresh, or an
    /// observer callback — overlapping calls collapse into one.
    @discardableResult
    func sync(reason: String) async -> Bool {
        let store = await SyncStore.shared
        let (token, endpoint, isFuel) = await (store.token, store.endpoint, store.isFuelDestination)
        guard !isFuel || !token.isEmpty else {
            await setStatus(.failed("Add your Fuel sync token first."))
            return false
        }
        guard let api = try? FuelAPI(endpoint: endpoint, token: token) else {
            await setStatus(.failed("That destination URL is not valid."))
            return false
        }
        return await run(sink: ServerSink(api: api), fromScratch: false, reason: reason)
    }

    /// Writes the entire Health history to a file the user can keep or hand to another
    /// service. Deliberately ignores the anchors in both directions: it always reads
    /// everything, and it never advances them, so exporting cannot perturb a sync.
    func export() async -> URL? {
        guard let sink = try? FileExportSink() else {
            await setStatus(.failed("Could not create the export file."))
            return nil
        }
        let ok = await run(sink: sink, fromScratch: true, reason: "export")
        sink.finish()
        guard ok else { return nil }
        await MainActor.run { SyncStore.shared.lastSyncSummary = "exported \(sink.batches) batches" }
        return sink.url
    }

    /// One pass over everything, into whichever destination. `fromScratch` starts every
    /// type at a nil anchor (a complete read) without disturbing the stored ones.
    @discardableResult
    private func run(sink: SyncSink, fromScratch: Bool, reason: String) async -> Bool {
        if running { return true }
        running = true
        defer { running = false }

        do {
            // "Full" now only means how far back to recompute, not whether to replicate
            // history: there is no history to replicate.
            let alreadySynced = await SyncStore.shared.initialSyncComplete
            let isFullSync = fromScratch || !alreadySynced
            let days = isFullSync ? 1825 : 3   // five years on first sync, then a rolling window

            await setProgress(0)
            var payload = basePayload(fullSync: isFullSync)
            // The statistics queries are the only slow part, so they are what the
            // progress bar measures. The last tenth covers the snapshot and the upload.
            payload.tables.dailyTotals = try await dailyTotals(days: days) { done, total in
                await self.setProgress(Double(done) / Double(total) * 0.9)
            }
            payload.snapshot = try await todaySnapshot()
            await setProgress(0.95)
            try await sink.send(payload)
            await setProgress(1)

            let stamp = Date()
            let dayCount = payload.tables.dailyTotals.count
            await MainActor.run {
                if sink.advancesAnchors {
                    SyncStore.shared.lastSyncAt = stamp
                    SyncStore.shared.lastSyncSummary = "\(reason): \(dayCount) days"
                    SyncStore.shared.initialSyncComplete = true
                }
                SyncStore.shared.status = .idle
                SyncStore.shared.syncProgress = 0
            }
            return true
        } catch {
            await MainActor.run { SyncStore.shared.syncProgress = 0 }
            await setStatus(.failed(error.localizedDescription))
            return false
        }
    }

    // MARK: Daily aggregates

    /// One row per day. Every figure is that day's own total (steps walked, swim
    /// strokes, active calories) or its daily average for the rate-like metrics, straight
    /// from HealthKit's own bucketing.
    ///
    /// `onProgress` fires as each metric finishes. They run concurrently in a task group
    /// rather than as `async let` bindings specifically so completions can be counted —
    /// a progress bar that only moves at the start and end is not a progress bar.
    private func dailyTotals(days: Int, onProgress: @escaping @Sendable (Int, Int) async -> Void) async throws -> [DailyTotal] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: today) else { return [] }

        let perMinute = HKUnit.count().unitDivided(by: .minute())
        let metrics: [(key: String, id: HKQuantityTypeIdentifier, options: HKStatisticsOptions, unit: HKUnit)] = [
            ("activeEnergy", .activeEnergyBurned, .cumulativeSum, .kilocalorie()),
            ("restingEnergy", .basalEnergyBurned, .cumulativeSum, .kilocalorie()),
            ("steps", .stepCount, .cumulativeSum, .count()),
            ("exercise", .appleExerciseTime, .cumulativeSum, .minute()),
            ("stand", .appleStandTime, .cumulativeSum, .minute()),
            ("walkRun", .distanceWalkingRunning, .cumulativeSum, .meter()),
            ("cycling", .distanceCycling, .cumulativeSum, .meter()),
            ("swimming", .distanceSwimming, .cumulativeSum, .meter()),
            ("strokes", .swimmingStrokeCount, .cumulativeSum, .count()),
            ("flights", .flightsClimbed, .cumulativeSum, .count()),
            ("restingHR", .restingHeartRate, .discreteAverage, perMinute),
            ("hrv", .heartRateVariabilitySDNN, .discreteAverage, .secondUnit(with: .milli)),
            ("vo2", .vo2Max, .discreteAverage, HKUnit(from: "ml/kg*min")),
            ("respiratory", .respiratoryRate, .discreteAverage, perMinute),
            ("oxygen", .oxygenSaturation, .discreteAverage, .percent()),
            ("walkingHR", .walkingHeartRateAverage, .discreteAverage, perMinute),
            ("recovery", .heartRateRecoveryOneMinute, .discreteAverage, perMinute),
            ("stride", .runningStrideLength, .discreteAverage, .meter()),
        ]
        // +1 for sleep, which is a separate category query.
        let totalUnits = metrics.count + 1

        // Sleep is a category query returning a different shape, so the group carries a
        // small enum rather than forcing both into one tuple type.
        enum MetricResult {
            case series(key: String, values: [Date: Double])
            case sleep([String: Double])
        }

        var series: [String: [Date: Double]] = [:]
        var sleep: [String: Double] = [:]
        var finished = 0
        try await withThrowingTaskGroup(of: MetricResult.self) { group in
            for metric in metrics {
                group.addTask {
                    .series(key: metric.key,
                            values: try await self.statistics(metric.id, metric.options, metric.unit, from: start))
                }
            }
            group.addTask {
                .sleep(try await self.sleepHoursByDay(lastDays: min(days, 14)))
            }
            for try await result in group {
                switch result {
                case .series(let key, let values): series[key] = values
                case .sleep(let byDate): sleep = byDate
                }
                finished += 1
                await onProgress(finished, totalUnits)
            }
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = calendar

        var totals: [DailyTotal] = []
        var cursor = start
        while cursor <= today {
            let key = cursor
            let dateText = formatter.string(from: key)
            let total = DailyTotal(
                date: dateText,
                partialDay: calendar.isDate(key, inSameDayAs: Date()),
                activeEnergy: series["activeEnergy"]?[key],
                restingEnergy: series["restingEnergy"]?[key],
                totalExpenditure: nil,   // the server derives active + resting
                exerciseMinutes: series["exercise"]?[key],
                steps: series["steps"]?[key],
                walkingRunningDistanceMi: series["walkRun"]?[key].map { $0 / 1609.344 },
                swimmingDistanceYd: series["swimming"]?[key].map { $0 * 1.0936133 },
                restingHeartRate: series["restingHR"]?[key],
                hrv: series["hrv"]?[key],
                vo2Max: series["vo2"]?[key],
                sleepHours: sleep[dateText],
                respiratoryRate: series["respiratory"]?[key],
                bloodOxygen: series["oxygen"]?[key].map { $0 * 100 },
                standMinutes: series["stand"]?[key],
                walkingHeartRateAverage: series["walkingHR"]?[key],
                cyclingDistanceMi: series["cycling"]?[key].map { $0 / 1609.344 },
                flightsClimbed: series["flights"]?[key],
                swimmingStrokes: series["strokes"]?[key],
                runningStrideLength: series["stride"]?[key],
                cardioRecovery: series["recovery"]?[key]
            )
            // Days with no data at all are skipped rather than uploaded as empty rows.
            if hasAnyValue(total) { totals.append(total) }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return totals
    }

    private func hasAnyValue(_ total: DailyTotal) -> Bool {
        [total.activeEnergy, total.restingEnergy, total.exerciseMinutes, total.steps,
         total.walkingRunningDistanceMi, total.restingHeartRate, total.hrv, total.vo2Max,
         total.sleepHours, total.respiratoryRate, total.bloodOxygen, total.standMinutes,
         total.walkingHeartRateAverage, total.cyclingDistanceMi, total.flightsClimbed,
         total.swimmingStrokes, total.runningStrideLength, total.cardioRecovery,
         total.swimmingDistanceYd].contains { $0 != nil }
    }

    /// One HKStatisticsCollectionQuery per metric: HealthKit merges overlapping
    /// watch/phone sources correctly, which a server-side SUM over raw samples cannot.
    private func statistics(
        _ identifier: HKQuantityTypeIdentifier,
        _ options: HKStatisticsOptions,
        _ unit: HKUnit,
        from start: Date
    ) async throws -> [Date: Double] {
        guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return [:] }
        let calendar = Calendar.current
        let anchorDate = calendar.startOfDay(for: start)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: nil),
                options: options,
                anchorDate: anchorDate,
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if let error { continuation.resume(throwing: error); return }
                var byDay: [Date: Double] = [:]
                collection?.enumerateStatistics(from: start, to: Date()) { stats, _ in
                    let quantity = options.contains(.cumulativeSum) ? stats.sumQuantity() : stats.averageQuantity()
                    if let quantity { byDay[calendar.startOfDay(for: stats.startDate)] = quantity.doubleValue(for: unit) }
                }
                continuation.resume(returning: byDay)
            }
            healthStore.execute(query)
        }
    }

    /// Sleep is a category type, so daily hours are summed from the asleep stages.
    private func sleepHoursByDay(lastDays: Int) async throws -> [String: Double] {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return [:] }
        let calendar = Calendar.current
        guard let start = calendar.date(byAdding: .day, value: -lastDays, to: Date()) else { return [:] }
        let samples: [HKSample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type,
                                      predicate: HKQuery.predicateForSamples(withStart: start, end: nil),
                                      limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: samples ?? []) }
            }
            healthStore.execute(query)
        }
        let asleepValues: Set<Int> = Set([
            HKCategoryValueSleepAnalysis.asleepUnspecified, .asleepCore, .asleepDeep, .asleepREM,
        ].map(\.rawValue))
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        var hours: [String: Double] = [:]
        for sample in samples {
            guard let category = sample as? HKCategorySample, asleepValues.contains(category.value) else { continue }
            // A night is attributed to the day you wake up on.
            let day = formatter.string(from: category.endDate)
            hours[day, default: 0] += category.endDate.timeIntervalSince(category.startDate) / 3600
        }
        return hours.mapValues { (($0 * 100).rounded()) / 100 }
    }

    /// Today's running totals, midnight to now — the intraday snapshot series.
    private func todaySnapshot() async throws -> SyncPayload.Snapshot {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        async let active = statistics(.activeEnergyBurned, .cumulativeSum, .kilocalorie(), from: start)
        async let resting = statistics(.basalEnergyBurned, .cumulativeSum, .kilocalorie(), from: start)
        let (activeByDay, restingByDay) = try await (active, resting)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let activeToday = activeByDay[start]
        let restingToday = restingByDay[start]
        return SyncPayload.Snapshot(
            date: formatter.string(from: start),
            activeEnergy: activeToday,
            restingEnergy: restingToday,
            totalExpenditure: (activeToday ?? 0) + (restingToday ?? 0) > 0 ? (activeToday ?? 0) + (restingToday ?? 0) : nil
        )
    }

    // MARK: Plumbing

    private func basePayload(fullSync: Bool) -> SyncPayload {
        SyncPayload(
            fullSync: fullSync,
            device: .init(
                model: deviceModel(),
                iosVersion: ProcessInfo.processInfo.operatingSystemVersionString,
                timezone: TimeZone.current.identifier,
                lastSync: nil
            )
        )
    }

    private func deviceModel() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        return withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(validatingUTF8: $0) ?? "iPhone" }
        }
    }



    private func setStatus(_ status: SyncStore.SyncStatus) async {
        await MainActor.run { SyncStore.shared.status = status }
    }

    /// Monotonic within a pass: the metric queries finish in whatever order HealthKit
    /// returns them, and a bar that jumps backwards reads as a bug.
    private func setProgress(_ fraction: Double) async {
        await MainActor.run {
            let clamped = min(1, max(0, fraction))
            if clamped == 0 || clamped > SyncStore.shared.syncProgress {
                SyncStore.shared.syncProgress = clamped
            }
        }
    }
}

// Readable names for the workout activity types Fuel is likely to see; everything else
// keeps a stable "other-N" so no workout is ever dropped.
extension HKWorkoutActivityType {
    var wireName: String {
        switch self {
        case .running: return "running"
        case .walking: return "walking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .traditionalStrengthTraining: return "strengthTraining"
        case .functionalStrengthTraining: return "functionalStrength"
        case .highIntensityIntervalTraining: return "hiit"
        case .yoga: return "yoga"
        case .pilates: return "pilates"
        case .elliptical: return "elliptical"
        case .rowing: return "rowing"
        case .stairClimbing: return "stairClimbing"
        case .hiking: return "hiking"
        case .tennis: return "tennis"
        case .basketball: return "basketball"
        case .soccer: return "soccer"
        case .coreTraining: return "coreTraining"
        case .flexibility: return "flexibility"
        case .cooldown: return "cooldown"
        case .mindAndBody: return "mindAndBody"
        case .dance: return "dance"
        case .badminton: return "badminton"
        case .pickleball: return "pickleball"
        default: return "other-\(rawValue)"
        }
    }
}
