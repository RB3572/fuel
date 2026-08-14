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
                await self.setProgress(Double(done) / Double(total) * 0.85)
            }
            payload.tables.workoutSamples = try await recentWorkouts(days: days)
            await setProgress(0.92)
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

    // MARK: Workouts

    /// The actual logged sessions — a run, a lift, a swim — as opposed to the ambient
    /// walking distance and step count everyone accumulates just by moving through a
    /// day. Those two used to be conflated: with no real workout data coming from the
    /// device, the dashboard inferred a "workout" from any day with nonzero walking
    /// distance, which is every day, so the Coach congratulated a walk to the kitchen.
    ///
    /// This queries actual `HKWorkout` objects. There are a handful a day at most, so —
    /// unlike the per-second samples the old sync used to upload — sending them whole is
    /// no different a tradeoff than the daily totals already are.
    private func recentWorkouts(days: Int) async throws -> [WorkoutSample] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: today) else { return [] }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let workouts: [HKWorkout] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: .workoutType(), predicate: predicate,
                                      limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, results, error in
                if let error { continuation.resume(throwing: error); return }
                continuation.resume(returning: (results as? [HKWorkout]) ?? [])
            }
            healthStore.execute(query)
        }

        return workouts.map { workout in
            WorkoutSample(
                uuid: workout.uuid.uuidString,
                activityType: workout.workoutActivityType.wireName,
                start: iso.string(from: workout.startDate),
                end: iso.string(from: workout.endDate),
                duration: workout.duration,
                activeEnergy: energy(for: workout, .activeEnergyBurned),
                distance: distance(for: workout),
                elevation: nil,
                averageHeartRate: averageHeartRate(for: workout),
                source: workout.sourceRevision.source.name,
                route: nil
            )
        }
    }

    private func energy(for workout: HKWorkout, _ identifier: HKQuantityTypeIdentifier) -> Double? {
        guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return nil }
        return workout.statistics(for: type)?.sumQuantity()?.doubleValue(for: .kilocalorie())
    }

    /// Whichever distance the workout actually recorded — walking/running, cycling or
    /// swimming — since a workout only ever populates one.
    private func distance(for workout: HKWorkout) -> Double? {
        for identifier in [HKQuantityTypeIdentifier.distanceWalkingRunning, .distanceCycling, .distanceSwimming] {
            guard let type = HKObjectType.quantityType(forIdentifier: identifier),
                  let value = workout.statistics(for: type)?.sumQuantity()?.doubleValue(for: .meter()) else { continue }
            return value
        }
        return nil
    }

    private func averageHeartRate(for workout: HKWorkout) -> Double? {
        guard let type = HKObjectType.quantityType(forIdentifier: .heartRate) else { return nil }
        return workout.statistics(for: type)?.averageQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
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
        // Everything else, summarised the same way: one number per day. Sums where a
        // day's worth accumulates (daylight, falls), averages where it does not (power,
        // cadence, glucose). Nothing here is stored per-sample — a heart rate every
        // minute of the night answers no question this app asks.
        let extraMetrics: [(key: String, id: HKQuantityTypeIdentifier, options: HKStatisticsOptions, unit: HKUnit)] = [
            // Cardiac
            ("atrialFibrillationBurden", .atrialFibrillationBurden, .discreteAverage, .percent()),
            ("peripheralPerfusionIndex", .peripheralPerfusionIndex, .discreteAverage, .percent()),
            ("heartRateAverage", .heartRate, .discreteAverage, perMinute),
            ("heartRateMin", .heartRate, .discreteMin, perMinute),
            ("heartRateMax", .heartRate, .discreteMax, perMinute),
            ("bloodPressureSystolic", .bloodPressureSystolic, .discreteAverage, .millimeterOfMercury()),
            ("bloodPressureDiastolic", .bloodPressureDiastolic, .discreteAverage, .millimeterOfMercury()),
            ("bloodGlucose", .bloodGlucose, .discreteAverage, HKUnit(from: "mg/dL")),
            // Fitness
            ("cyclingPower", .cyclingPower, .discreteAverage, .watt()),
            ("cyclingCadence", .cyclingCadence, .discreteAverage, perMinute),
            ("cyclingFunctionalThresholdPower", .cyclingFunctionalThresholdPower, .discreteAverage, .watt()),
            ("runningPower", .runningPower, .discreteAverage, .watt()),
            ("runningSpeed", .runningSpeed, .discreteAverage, HKUnit.meter().unitDivided(by: .second())),
            ("runningGroundContactTime", .runningGroundContactTime, .discreteAverage, .secondUnit(with: .milli)),
            ("runningVerticalOscillation", .runningVerticalOscillation, .discreteAverage, .meterUnit(with: .centi)),
            ("stairAscentSpeed", .stairAscentSpeed, .discreteAverage, HKUnit.meter().unitDivided(by: .second())),
            ("stairDescentSpeed", .stairDescentSpeed, .discreteAverage, HKUnit.meter().unitDivided(by: .second())),
            ("sixMinuteWalkTestDistance", .sixMinuteWalkTestDistance, .discreteAverage, .meter()),
            ("physicalEffort", .physicalEffort, .discreteAverage, HKUnit(from: "kcal/(kg*hr)")),
            // Respiratory
            ("peakExpiratoryFlowRate", .peakExpiratoryFlowRate, .discreteAverage, HKUnit(from: "L/min")),
            ("forcedVitalCapacity", .forcedVitalCapacity, .discreteAverage, .liter()),
            ("forcedExpiratoryVolume1", .forcedExpiratoryVolume1, .discreteAverage, .liter()),
            ("inhalerUsage", .inhalerUsage, .cumulativeSum, .count()),
            // Body
            ("waistCircumference", .waistCircumference, .discreteAverage, .inch()),
            ("basalBodyTemperature", .basalBodyTemperature, .discreteAverage, .degreeCelsius()),
            ("bodyTemperature", .bodyTemperature, .discreteAverage, .degreeCelsius()),
            ("wristTemperature", .appleSleepingWristTemperature, .discreteAverage, .degreeCelsius()),
            // Environmental
            ("headphoneAudioExposure", .headphoneAudioExposure, .discreteAverage, .decibelAWeightedSoundPressureLevel()),
            ("environmentalSoundLevel", .environmentalAudioExposure, .discreteAverage, .decibelAWeightedSoundPressureLevel()),
            ("uvExposure", .uvExposure, .discreteMax, .count()),
            ("timeInDaylight", .timeInDaylight, .cumulativeSum, .minute()),
            // Mobility
            ("walkingSpeed", .walkingSpeed, .discreteAverage, HKUnit.meter().unitDivided(by: .second())),
            ("walkingAsymmetry", .walkingAsymmetryPercentage, .discreteAverage, .percent()),
            ("walkingStepLength", .walkingStepLength, .discreteAverage, .meterUnit(with: .centi)),
            ("walkingDoubleSupport", .walkingDoubleSupportPercentage, .discreteAverage, .percent()),
            ("walkingSteadiness", .appleWalkingSteadiness, .discreteAverage, .percent()),
            ("numberOfTimesFallen", .numberOfTimesFallen, .cumulativeSum, .count()),
        ]

        // +1 for sleep, which is a separate category query.
        let totalUnits = metrics.count + extraMetrics.count + 1

        // Sleep is a category query returning a different shape, so the group carries a
        // small enum rather than forcing both into one tuple type.
        enum MetricResult {
            case series(key: String, values: [Date: Double])
            case sleep([String: NightSummary])
        }

        var series: [String: [Date: Double]] = [:]
        var sleep: [String: Double] = [:]
        var sleepDetail: [String: NightSummary] = [:]
        var finished = 0
        try await withThrowingTaskGroup(of: MetricResult.self) { group in
            for metric in metrics {
                group.addTask {
                    .series(key: metric.key,
                            values: await self.statistics(metric.id, metric.options, metric.unit, from: start))
                }
            }
            for metric in extraMetrics {
                group.addTask {
                    .series(key: metric.key,
                            values: await self.statistics(metric.id, metric.options, metric.unit, from: start))
                }
            }
            group.addTask {
                let nights = try await self.sleepByDay(lastDays: min(days, 30))
                return .sleep(nights)
            }
            for try await result in group {
                switch result {
                case .series(let key, let values): series[key] = values
                case .sleep(let byDate):
                    sleep = byDate.mapValues { $0.values["sleepHours"] ?? 0 }
                    sleepDetail = byDate
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
                cardioRecovery: series["recovery"]?[key],
                extras: extrasFor(dateText, key, series: series, extraKeys: extraMetrics.map(\.key),
                                  sleepDetail: sleepDetail[dateText]),
                extraText: sleepDetail[dateText]?.hypnogram.map { ["sleepStages": $0] }
            )
            // Days with no data at all are skipped rather than uploaded as empty rows.
            if hasAnyValue(total) { totals.append(total) }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return totals
    }

    /// The day's extra metrics, plus the night's sleep breakdown, as one flat dictionary
    /// of numbers. Percent-unit readings are scaled to whole percents here so a value is
    /// the number a person would say out loud.
    private func extrasFor(_ dateText: String, _ key: Date, series: [String: [Date: Double]],
                           extraKeys: [String], sleepDetail: NightSummary?) -> [String: Double]? {
        var extras: [String: Double] = [:]
        let percentKeys: Set<String> = ["atrialFibrillationBurden", "peripheralPerfusionIndex",
                                        "walkingAsymmetry", "walkingDoubleSupport", "walkingSteadiness"]
        for name in extraKeys {
            guard let value = series[name]?[key] else { continue }
            extras[name] = percentKeys.contains(name) ? value * 100 : value
        }
        if let sleepDetail {
            for (name, value) in sleepDetail.values where name != "sleepHours" { extras[name] = value }
        }
        return extras.isEmpty ? nil : extras
    }

    private func hasAnyValue(_ total: DailyTotal) -> Bool {
        [total.activeEnergy, total.restingEnergy, total.exerciseMinutes, total.steps,
         total.walkingRunningDistanceMi, total.restingHeartRate, total.hrv, total.vo2Max,
         total.sleepHours, total.respiratoryRate, total.bloodOxygen, total.standMinutes,
         total.walkingHeartRateAverage, total.cyclingDistanceMi, total.flightsClimbed,
         total.swimmingStrokes, total.runningStrideLength, total.cardioRecovery,
         total.swimmingDistanceYd].contains { $0 != nil } || total.extras?.isEmpty == false
    }

    /// One HKStatisticsCollectionQuery per metric: HealthKit merges overlapping
    /// watch/phone sources correctly, which a server-side SUM over raw samples cannot.
    private func statistics(
        _ identifier: HKQuantityTypeIdentifier,
        _ options: HKStatisticsOptions,
        _ unit: HKUnit,
        from start: Date
    ) async -> [Date: Double] {
        guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return [:] }
        let calendar = Calendar.current
        let anchorDate = calendar.startOfDay(for: start)
        return await withCheckedContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: nil),
                options: options,
                anchorDate: anchorDate,
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                // A metric the person has not been asked about answers
                // errorAuthorizationNotDetermined, and a metric no device on this account
                // records answers nothing useful either. Neither is a reason to fail the
                // sync: one unread type used to abort the whole task group, so adding
                // thirty-five new metrics turned every sync into "Authorization not
                // determined" and stopped the eighteen that did work from arriving. An
                // unreadable metric is simply absent from the day.
                if error != nil { continuation.resume(returning: [:]); return }
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
    /// A night's sleep, summarised: how long in each stage, when it started and ended,
    /// how long it took to fall asleep, and how broken it was. Not a per-minute trace —
    /// the stages over the night and a handful of totals are what a person can actually
    /// read, and it is one small row rather than several hundred samples.
    ///
    /// Times of day are stored as minutes from midnight so the whole thing stays a
    /// dictionary of numbers. Bedtimes before midnight go negative (23:30 is -30), which
    /// keeps the arithmetic honest instead of wrapping to 1410 and reading as a lie-in.
    /// One night, reduced: the totals that go in `extras`, plus the run of stages that
    /// cannot be reduced to totals without losing the thing that makes it interesting.
    struct NightSummary {
        var values: [String: Double] = [:]
        /// `"D,-45,-20;C,-20,15;R,15,38"` — stage letter, start, end, in minutes around
        /// the midnight the night ended on, so a stage before midnight is negative. Kept
        /// as one short string rather than a table of its own: a night is forty segments
        /// at most, it is only ever read whole, and it rides along in the same jsonb
        /// column as everything else about the day.
        var hypnogram: String?
    }

    private func sleepByDay(lastDays: Int) async throws -> [String: NightSummary] {
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

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"

        // Everything about one night, gathered before it is reduced to numbers.
        struct Night {
            var stageMinutes: [String: Double] = [:]
            var asleepMinutes: Double = 0
            var inBedMinutes: Double = 0
            var awakeMinutes: Double = 0
            var awakenings: Double = 0
            var firstInBed: Date?
            var firstAsleep: Date?
            var lastAsleep: Date?
            /// Every stage sample of the night in the order it happened, for the
            /// hypnogram. `inBed` is not a stage and is left out.
            var segments: [(stage: String, start: Date, end: Date)] = []
        }
        var nights: [String: Night] = [:]

        for sample in samples.compactMap({ $0 as? HKCategorySample }).sorted(by: { $0.startDate < $1.startDate }) {
            // A night belongs to the morning you wake up on.
            let day = formatter.string(from: sample.endDate)
            var night = nights[day] ?? Night()
            let minutes = sample.endDate.timeIntervalSince(sample.startDate) / 60
            switch HKCategoryValueSleepAnalysis(rawValue: sample.value) {
            case .asleepREM:
                night.stageMinutes["sleepREMMinutes", default: 0] += minutes
                night.asleepMinutes += minutes
                night.segments.append(("R", sample.startDate, sample.endDate))
            case .asleepCore:
                night.stageMinutes["sleepCoreMinutes", default: 0] += minutes
                night.asleepMinutes += minutes
                night.segments.append(("C", sample.startDate, sample.endDate))
            case .asleepDeep:
                night.stageMinutes["sleepDeepMinutes", default: 0] += minutes
                night.asleepMinutes += minutes
                night.segments.append(("D", sample.startDate, sample.endDate))
            case .asleepUnspecified:
                night.stageMinutes["sleepUnspecifiedMinutes", default: 0] += minutes
                night.asleepMinutes += minutes
                night.segments.append(("U", sample.startDate, sample.endDate))
            case .awake:
                // Only the wakings inside the night count as interruptions; the final
                // one is getting up.
                night.awakeMinutes += minutes
                night.awakenings += 1
                night.segments.append(("A", sample.startDate, sample.endDate))
            case .inBed:
                night.inBedMinutes += minutes
                if night.firstInBed == nil || sample.startDate < night.firstInBed! { night.firstInBed = sample.startDate }
            default:
                break
            }
            if HKCategoryValueSleepAnalysis(rawValue: sample.value) != .awake,
               HKCategoryValueSleepAnalysis(rawValue: sample.value) != .inBed {
                if night.firstAsleep == nil || sample.startDate < night.firstAsleep! { night.firstAsleep = sample.startDate }
                if night.lastAsleep == nil || sample.endDate > night.lastAsleep! { night.lastAsleep = sample.endDate }
            }
            nights[day] = night
        }

        /// Minutes from the midnight that ends the night, so an 11:30pm bedtime is -30.
        func minutesFromMidnight(_ date: Date, night day: String) -> Double? {
            guard let midnight = formatter.date(from: day) else { return nil }
            return date.timeIntervalSince(midnight) / 60
        }

        var result: [String: NightSummary] = [:]
        for (day, night) in nights {
            guard night.asleepMinutes > 0 else { continue }
            var values = night.stageMinutes
            values["sleepHours"] = ((night.asleepMinutes / 60) * 100).rounded() / 100
            values["sleepAwakeMinutes"] = night.awakeMinutes.rounded()
            values["sleepAwakenings"] = max(0, night.awakenings - 1)
            let inBed = max(night.inBedMinutes, night.asleepMinutes + night.awakeMinutes)
            values["sleepInBedMinutes"] = inBed.rounded()
            // Time asleep as a share of time in bed — the standard definition.
            if inBed > 0 { values["sleepEfficiency"] = ((night.asleepMinutes / inBed) * 1000).rounded() / 10 }
            if let asleep = night.firstAsleep, let minutes = minutesFromMidnight(asleep, night: day) {
                values["sleepStartMinutes"] = minutes.rounded()
                if let inBedAt = night.firstInBed {
                    values["sleepLatencyMinutes"] = max(0, asleep.timeIntervalSince(inBedAt) / 60).rounded()
                }
            }
            if let woke = night.lastAsleep, let minutes = minutesFromMidnight(woke, night: day) {
                values["sleepEndMinutes"] = minutes.rounded()
            }

            // Segments shorter than half a minute are dropped: Apple emits a scattering
            // of them at stage boundaries, they cannot be drawn at this width, and thirty
            // of them would double the size of the string for nothing.
            let hypnogram = night.segments
                .sorted { $0.start < $1.start }
                .compactMap { segment -> String? in
                    guard let from = minutesFromMidnight(segment.start, night: day),
                          let to = minutesFromMidnight(segment.end, night: day),
                          to - from >= 0.5 else { return nil }
                    return "\(segment.stage),\(Int(from.rounded())),\(Int(to.rounded()))"
                }
                .joined(separator: ";")

            result[day] = NightSummary(values: values, hypnogram: hypnogram.isEmpty ? nil : hypnogram)
        }
        return result
    }

    /// Today's running totals, midnight to now — the intraday snapshot series.
    private func todaySnapshot() async throws -> SyncPayload.Snapshot {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        async let active = statistics(.activeEnergyBurned, .cumulativeSum, .kilocalorie(), from: start)
        async let resting = statistics(.basalEnergyBurned, .cumulativeSum, .kilocalorie(), from: start)
        let (activeByDay, restingByDay) = await (active, resting)
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
