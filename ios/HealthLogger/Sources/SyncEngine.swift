import Foundation
import HealthKit

// The heart of Health Logger: anchored, batched, resumable replication of the whole
// HealthKit store into Fuel.
//
// How it stays correct:
//   - One HKQueryAnchor per data type, persisted locally and mirrored server-side.
//     Each sync asks HealthKit "everything added or deleted since this anchor" — the
//     first sync (nil anchor) returns all history, later syncs return only the delta.
//   - History is drained page by page (PAGE_LIMIT per anchored query). Each page is
//     uploaded before the next is fetched, and the type's anchor is saved only after
//     the server acknowledges the page. A crash mid-sync therefore re-uploads at most
//     one page — and the server upserts by HealthKit UUID, so replays are free.
//   - Daily aggregates are computed here with HKStatisticsCollectionQuery, because only
//     HealthKit knows how to deduplicate a watch and a phone counting the same steps.

final class SyncEngine {
    static let shared = SyncEngine()
    let healthStore = HKHealthStore()

    private let PAGE_LIMIT = 5000
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

        let store = await SyncStore.shared

        do {
            var anchors = fromScratch ? [:] : await store.loadAnchors()
            let isFullSync = anchors.isEmpty

            // A reinstalled app adopts the destination's anchors instead of re-uploading
            // years of history it already sent.
            if isFullSync, !fromScratch {
                let remote = await sink.knownAnchors()
                if !remote.isEmpty {
                    anchors = remote
                    await store.replaceAnchors(anchors)
                }
            }

            var uploadedSamples = 0

            // ---- Quantity types -----------------------------------------------------
            for (identifier, unit) in HealthKitCatalog.quantityTypes {
                guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { continue }
                let wire = HealthKitCatalog.wireName(identifier.rawValue)
                uploadedSamples += try await drain(type: type, wireName: wire, sink: sink, fullSync: isFullSync, anchors: &anchors) { samples in
                    var tables = SyncPayload.Tables()
                    tables.quantitySamples = samples.compactMap { sample in
                        guard let quantity = sample as? HKQuantitySample, quantity.quantity.is(compatibleWith: unit) else { return nil }
                        return QuantitySample(
                            uuid: quantity.uuid.uuidString.lowercased(),
                            type: wire,
                            value: quantity.quantity.doubleValue(for: unit),
                            unit: unit.unitString,
                            start: self.iso.string(from: quantity.startDate),
                            end: self.iso.string(from: quantity.endDate),
                            source: quantity.sourceRevision.source.name,
                            device: quantity.device?.model
                        )
                    }
                    return tables
                }
            }

            // ---- Category types -----------------------------------------------------
            for identifier in HealthKitCatalog.categoryTypes {
                guard let type = HKObjectType.categoryType(forIdentifier: identifier) else { continue }
                let wire = HealthKitCatalog.wireName(identifier.rawValue)
                uploadedSamples += try await drain(type: type, wireName: wire, sink: sink, fullSync: isFullSync, anchors: &anchors) { samples in
                    var tables = SyncPayload.Tables()
                    tables.categorySamples = samples.compactMap { sample in
                        guard let category = sample as? HKCategorySample else { return nil }
                        return CategorySample(
                            uuid: category.uuid.uuidString.lowercased(),
                            type: wire,
                            value: category.value,
                            valueName: identifier == .sleepAnalysis ? HealthKitCatalog.sleepStageName(category.value) : nil,
                            start: self.iso.string(from: category.startDate),
                            end: self.iso.string(from: category.endDate),
                            source: category.sourceRevision.source.name,
                            device: category.device?.model
                        )
                    }
                    return tables
                }
            }

            // ---- Workouts (with routes) ---------------------------------------------
            uploadedSamples += try await drain(type: HKObjectType.workoutType(), wireName: "workout", sink: sink, fullSync: isFullSync, anchors: &anchors) { samples in
                var tables = SyncPayload.Tables()
                for sample in samples {
                    guard let workout = sample as? HKWorkout else { continue }
                    tables.workoutSamples.append(await self.convert(workout))
                }
                return tables
            }

            // ---- Daily aggregates + snapshot ----------------------------------------
            await setStatus(.running("Computing daily totals…"))
            let days = isFullSync ? 1825 : 3   // five years on first sync, then a rolling window
            var payload = basePayload(fullSync: isFullSync)
            payload.tables.dailyTotals = try await dailyTotals(days: days)
            payload.snapshot = try await todaySnapshot()
            payload.anchors = anchors
            try await sink.send(payload)

            let stamp = Date()
            // Snapshot the counter before crossing to the main actor: capturing the
            // mutable local directly is an error under Swift 6 concurrency.
            let total = uploadedSamples
            await MainActor.run {
                if sink.advancesAnchors {
                    SyncStore.shared.lastSyncAt = stamp
                    SyncStore.shared.lastSyncSummary = "\(reason): \(total) samples"
                    SyncStore.shared.initialSyncComplete = true
                }
                SyncStore.shared.status = .idle
            }
            return true
        } catch {
            await setStatus(.failed(error.localizedDescription))
            return false
        }
    }

    // MARK: Draining one type

    /// Pages through everything HealthKit has for `type` since its anchor, uploading
    /// each page and committing the anchor only after the server acknowledges it.
    private func drain(
        type: HKSampleType,
        wireName: String,
        sink: SyncSink,
        fullSync: Bool,
        anchors: inout [String: String],
        convert: ([HKSample]) async -> SyncPayload.Tables
    ) async throws -> Int {
        var anchor = decodeAnchor(anchors[wireName])
        var uploaded = 0
        var pageIndex = 0

        while true {
            let page = try await anchoredPage(type: type, anchor: anchor, limit: PAGE_LIMIT)
            let hasWork = !page.samples.isEmpty || !page.deleted.isEmpty
            if !hasWork { break }

            await setStatus(.running("Uploading \(wireName) (\(uploaded + page.samples.count))…"))
            var payload = basePayload(fullSync: fullSync)
            payload.batch = .init(index: pageIndex, count: 0)
            payload.tables = await convert(page.samples)
            if !page.deleted.isEmpty {
                let uuids = page.deleted.map { $0.uuid.uuidString.lowercased() }
                if type is HKQuantityType { payload.deleted.quantitySamples = uuids }
                else if type == HKObjectType.workoutType() { payload.deleted.workouts = uuids }
                else { payload.deleted.categorySamples = uuids }
            }
            if let next = page.newAnchor, let encoded = encodeAnchor(next) {
                payload.anchors = [wireName: encoded]
            }

            if !payload.tables.isEmpty || !payload.deleted.isEmpty {
                try await sink.send(payload)
            }

            // The destination has this page; only now does the anchor move forward.
            if let next = page.newAnchor, let encoded = encodeAnchor(next) {
                anchors[wireName] = encoded
                if sink.advancesAnchors { await SyncStore.shared.saveAnchor(encoded, for: wireName) }
                anchor = next
            }
            uploaded += page.samples.count
            pageIndex += 1
            if page.samples.count < PAGE_LIMIT && page.deleted.count < PAGE_LIMIT { break }
        }
        return uploaded
    }

    private func anchoredPage(type: HKSampleType, anchor: HKQueryAnchor?, limit: Int) async throws
        -> (samples: [HKSample], deleted: [HKDeletedObject], newAnchor: HKQueryAnchor?) {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(type: type, predicate: nil, anchor: anchor, limit: limit) { _, samples, deleted, newAnchor, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: (samples ?? [], deleted ?? [], newAnchor)) }
            }
            healthStore.execute(query)
        }
    }

    // MARK: Workout conversion

    private func convert(_ workout: HKWorkout) async -> WorkoutSample {
        let heartRateUnit = HKUnit.count().unitDivided(by: .minute())
        let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
        let distance = [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceSwimming)]
            .compactMap { workout.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meter()) }
            .first
        let averageHeartRate = workout.statistics(for: HKQuantityType(.heartRate))?.averageQuantity()?.doubleValue(for: heartRateUnit)
        let elevation = (workout.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity)?.doubleValue(for: .meter())

        return WorkoutSample(
            uuid: workout.uuid.uuidString.lowercased(),
            activityType: workout.workoutActivityType.wireName,
            start: iso.string(from: workout.startDate),
            end: iso.string(from: workout.endDate),
            duration: workout.duration,
            activeEnergy: energy,
            distance: distance,
            elevation: elevation,
            averageHeartRate: averageHeartRate,
            source: workout.sourceRevision.source.name,
            route: await route(for: workout)
        )
    }

    /// Route points, thinned to at most ~2000: a map does not need 1 Hz GPS.
    private func route(for workout: HKWorkout) async -> [[Double]]? {
        let routes: [HKSample] = (try? await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForObjects(from: workout)
            let query = HKSampleQuery(sampleType: HKSeriesType.workoutRoute(), predicate: predicate, limit: 1, sortDescriptors: nil) { _, samples, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: samples ?? []) }
            }
            healthStore.execute(query)
        }) ?? []
        guard let route = routes.first as? HKWorkoutRoute else { return nil }

        var points: [[Double]] = []
        let done: Bool = (try? await withCheckedThrowingContinuation { continuation in
            let query = HKWorkoutRouteQuery(route: route) { _, locations, finished, error in
                if let error { continuation.resume(throwing: error); return }
                for location in locations ?? [] {
                    points.append([location.coordinate.latitude, location.coordinate.longitude,
                                   location.timestamp.timeIntervalSince1970, location.altitude])
                }
                if finished { continuation.resume(returning: true) }
            }
            healthStore.execute(query)
        }) ?? false
        guard done, !points.isEmpty else { return nil }
        if points.count > 2000 {
            let stride = points.count / 2000 + 1
            points = points.enumerated().compactMap { $0.offset % stride == 0 ? $0.element : nil }
        }
        return points
    }

    // MARK: Daily aggregates

    private func dailyTotals(days: Int) async throws -> [DailyTotal] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: today) else { return [] }

        async let activeEnergy = statistics(.activeEnergyBurned, .cumulativeSum, .kilocalorie(), from: start)
        async let restingEnergy = statistics(.basalEnergyBurned, .cumulativeSum, .kilocalorie(), from: start)
        async let steps = statistics(.stepCount, .cumulativeSum, .count(), from: start)
        async let exercise = statistics(.appleExerciseTime, .cumulativeSum, .minute(), from: start)
        async let stand = statistics(.appleStandTime, .cumulativeSum, .minute(), from: start)
        async let walkRun = statistics(.distanceWalkingRunning, .cumulativeSum, .meter(), from: start)
        async let cycling = statistics(.distanceCycling, .cumulativeSum, .meter(), from: start)
        async let swimming = statistics(.distanceSwimming, .cumulativeSum, .meter(), from: start)
        async let strokes = statistics(.swimmingStrokeCount, .cumulativeSum, .count(), from: start)
        async let flights = statistics(.flightsClimbed, .cumulativeSum, .count(), from: start)
        async let restingHR = statistics(.restingHeartRate, .discreteAverage, HKUnit.count().unitDivided(by: .minute()), from: start)
        async let hrv = statistics(.heartRateVariabilitySDNN, .discreteAverage, .secondUnit(with: .milli), from: start)
        async let vo2 = statistics(.vo2Max, .discreteAverage, HKUnit(from: "ml/kg*min"), from: start)
        async let respiratory = statistics(.respiratoryRate, .discreteAverage, HKUnit.count().unitDivided(by: .minute()), from: start)
        async let oxygen = statistics(.oxygenSaturation, .discreteAverage, .percent(), from: start)
        async let walkingHR = statistics(.walkingHeartRateAverage, .discreteAverage, HKUnit.count().unitDivided(by: .minute()), from: start)
        async let recovery = statistics(.heartRateRecoveryOneMinute, .discreteAverage, HKUnit.count().unitDivided(by: .minute()), from: start)
        async let stride = statistics(.runningStrideLength, .discreteAverage, .meter(), from: start)
        let sleep = try await sleepHoursByDay(lastDays: min(days, 14))

        let series = try await (
            activeEnergy: activeEnergy, restingEnergy: restingEnergy, steps: steps, exercise: exercise,
            stand: stand, walkRun: walkRun, cycling: cycling, swimming: swimming, strokes: strokes,
            flights: flights, restingHR: restingHR, hrv: hrv, vo2: vo2, respiratory: respiratory,
            oxygen: oxygen, walkingHR: walkingHR, recovery: recovery, stride: stride
        )

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
                activeEnergy: series.activeEnergy[key],
                restingEnergy: series.restingEnergy[key],
                totalExpenditure: nil,   // the server derives active + resting
                exerciseMinutes: series.exercise[key],
                steps: series.steps[key],
                walkingRunningDistanceMi: series.walkRun[key].map { $0 / 1609.344 },
                swimmingDistanceYd: series.swimming[key].map { $0 * 1.0936133 },
                restingHeartRate: series.restingHR[key],
                hrv: series.hrv[key],
                vo2Max: series.vo2[key],
                sleepHours: sleep[dateText],
                respiratoryRate: series.respiratory[key],
                bloodOxygen: series.oxygen[key].map { $0 * 100 },
                standMinutes: series.stand[key],
                walkingHeartRateAverage: series.walkingHR[key],
                cyclingDistanceMi: series.cycling[key].map { $0 / 1609.344 },
                flightsClimbed: series.flights[key],
                swimmingStrokes: series.strokes[key],
                runningStrideLength: series.stride[key],
                cardioRecovery: series.recovery[key]
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

    private func encodeAnchor(_ anchor: HKQueryAnchor) -> String? {
        (try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true))?.base64EncodedString()
    }

    private func decodeAnchor(_ encoded: String?) -> HKQueryAnchor? {
        guard let encoded, let data = Data(base64Encoded: encoded) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func setStatus(_ status: SyncStore.SyncStatus) async {
        await MainActor.run { SyncStore.shared.status = status }
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
