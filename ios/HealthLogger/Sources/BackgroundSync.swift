import Foundation
import HealthKit
import BackgroundTasks
import UIKit

// Keeps Fuel current through the day without the app being opened.
//
// Three overlapping mechanisms, because no single one is reliable on iOS:
//   1. HealthKit background delivery + HKObserverQuery — iOS wakes the app when new
//      samples land (hourly at most for quantity types; immediately for workouts and
//      sleep). This is the primary path: a workout ends, Fuel knows within minutes.
//   2. BGAppRefreshTask — an opportunistic top-up iOS schedules on its own rhythm,
//      catching anything the observers missed.
//   3. BGProcessingTask — a nightly catch-all with network access, for the long tail
//      (daily totals recomputation, anything a missed wake left behind).
// Every path funnels into the same SyncEngine.sync(), which is cheap when there is
// nothing new: each anchored query returns empty and no upload happens.

enum BackgroundSync {
    static let refreshTaskID = "com.rishib.HealthLogger.refresh"
    static let fullSyncTaskID = "com.rishib.HealthLogger.fullsync"

    // Must run before the app finishes launching (called from HealthLoggerApp.init).
    static func registerTasks() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTaskID, using: nil) { task in
            handle(task: task, reason: "background refresh")
            scheduleRefresh()
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: fullSyncTaskID, using: nil) { task in
            handle(task: task, reason: "nightly sync")
            scheduleNightly()
        }
    }

    static func scheduleAll() {
        scheduleRefresh()
        scheduleNightly()
    }

    private static func handle(task: BGTask, reason: String) {
        let work = Task {
            let ok = await SyncEngine.shared.sync(reason: reason)
            task.setTaskCompleted(success: ok)
        }
        task.expirationHandler = {
            // iOS is reclaiming the time. The engine commits after every page, so
            // cancelling loses at most one un-acked batch, which the next run replays.
            work.cancel()
            task.setTaskCompleted(success: false)
        }
    }

    private static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func scheduleNightly() {
        let request = BGProcessingTaskRequest(identifier: fullSyncTaskID)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 3600)
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: HealthKit-driven wakes

    /// Ask iOS to wake us when these types change, and keep long-lived observer
    /// queries running. Workouts and sleep get immediate delivery; the high-volume
    /// quantity types get hourly, which is the minimum iOS allows for them anyway.
    static func enableHealthKitDelivery() {
        let store = SyncEngine.shared.healthStore
        var wanted: [(HKSampleType, HKUpdateFrequency)] = [
            (HKObjectType.workoutType(), .immediate),
        ]
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { wanted.append((sleep, .immediate)) }
        for identifier in [HKQuantityTypeIdentifier.activeEnergyBurned, .basalEnergyBurned, .stepCount, .heartRate, .restingHeartRate, .heartRateVariabilitySDNN] {
            if let type = HKObjectType.quantityType(forIdentifier: identifier) { wanted.append((type, .hourly)) }
        }

        for (type, frequency) in wanted {
            store.enableBackgroundDelivery(for: type, frequency: frequency) { _, _ in }
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completionHandler, error in
                guard error == nil else { completionHandler(); return }
                Task {
                    await SyncEngine.shared.sync(reason: "health update")
                    completionHandler()
                }
            }
            store.execute(query)
        }
    }
}
