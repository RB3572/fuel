import Foundation
import HealthKit

// Writing Fuel's food back into Apple Health, so what you log here shows up in the
// Health app's nutrition and feeds anything else you use.
//
// Off by default and behind its own switch, because writing to Health is a separate
// permission with its own consent — Health treats read and write as different questions,
// and so should the app.
//
// Two rules keep this from corrupting anything:
//
//   1. Only food Fuel itself recorded is ever written. Nothing read from Health is
//      written back to Health, which is the loop that would otherwise inflate a number
//      a little more on every sync.
//   2. Only what was actually logged. A missing macro is a missing sample, not a zero —
//      a plate with no fibre figure must not tell Health you ate no fibre.
//
// Nothing derived goes back either: active energy, resting energy and total expenditure
// are Apple's own calculations, and writing them back would overwrite the source with a
// copy of itself.

@MainActor
final class HealthWriter {
    static let shared = HealthWriter()
    private let store = HKHealthStore()

    /// The one switch. Turning it on asks for write permission; turning it off stops at
    /// once and leaves everything already written in place, which is the honest thing to
    /// do with samples the user can see and delete in Health themselves.
    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: Self.enabledKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.enabledKey)
            if newValue { Task { await requestAuthorization() } }
        }
    }

    private static let enabledKey = "fuelHealthWriteEnabled"
    /// Entry ids already written, so re-syncing a day does not write a second copy of
    /// every meal in it.
    private static let writtenKey = "fuelHealthWrittenEntries"

    /// The dietary types Fuel can fill in, paired with the nutrient key it stores them
    /// under. Everything here is a real HealthKit dietary identifier — the app's own
    /// micronutrient list is wider than Health's, and the extras simply stay in Fuel.
    static let nutrientMap: [(nutrient: String, identifier: HKQuantityTypeIdentifier, unit: HKUnit)] = [
        ("sugarsG", .dietarySugar, .gram()),
        ("saturatedFatG", .dietaryFatSaturated, .gram()),
        ("monounsaturatedFatG", .dietaryFatMonounsaturated, .gram()),
        ("polyunsaturatedFatG", .dietaryFatPolyunsaturated, .gram()),
        ("cholesterolMg", .dietaryCholesterol, .gramUnit(with: .milli)),
        ("sodiumMg", .dietarySodium, .gramUnit(with: .milli)),
        ("potassiumMg", .dietaryPotassium, .gramUnit(with: .milli)),
        ("calciumMg", .dietaryCalcium, .gramUnit(with: .milli)),
        ("ironMg", .dietaryIron, .gramUnit(with: .milli)),
        ("magnesiumMg", .dietaryMagnesium, .gramUnit(with: .milli)),
        ("phosphorusMg", .dietaryPhosphorus, .gramUnit(with: .milli)),
        ("zincMg", .dietaryZinc, .gramUnit(with: .milli)),
        ("copperMg", .dietaryCopper, .gramUnit(with: .milli)),
        ("manganeseMg", .dietaryManganese, .gramUnit(with: .milli)),
        ("seleniumMcg", .dietarySelenium, .gramUnit(with: .micro)),
        ("iodineMcg", .dietaryIodine, .gramUnit(with: .micro)),
        ("vitaminAMcg", .dietaryVitaminA, .gramUnit(with: .micro)),
        ("vitaminCMg", .dietaryVitaminC, .gramUnit(with: .milli)),
        ("vitaminDMcg", .dietaryVitaminD, .gramUnit(with: .micro)),
        ("vitaminEMg", .dietaryVitaminE, .gramUnit(with: .milli)),
        ("vitaminKMcg", .dietaryVitaminK, .gramUnit(with: .micro)),
        ("thiaminMg", .dietaryThiamin, .gramUnit(with: .milli)),
        ("riboflavinMg", .dietaryRiboflavin, .gramUnit(with: .milli)),
        ("niacinMg", .dietaryNiacin, .gramUnit(with: .milli)),
        ("pantothenicAcidMg", .dietaryPantothenicAcid, .gramUnit(with: .milli)),
        ("vitaminB6Mg", .dietaryVitaminB6, .gramUnit(with: .milli)),
        ("biotinMcg", .dietaryBiotin, .gramUnit(with: .micro)),
        ("folateMcg", .dietaryFolate, .gramUnit(with: .micro)),
        ("vitaminB12Mcg", .dietaryVitaminB12, .gramUnit(with: .micro)),
        // Choline has no HealthKit dietary type; it stays in Fuel only.
        ("caffeineMg", .dietaryCaffeine, .gramUnit(with: .milli)),
        ("waterMl", .dietaryWater, .literUnit(with: .milli)),
    ]

    /// Calories and the four macros, which live on the entry itself rather than in its
    /// nutrient dictionary.
    private static let coreMap: [(path: (FoodEntry) -> Double?, identifier: HKQuantityTypeIdentifier, unit: HKUnit)] = [
        ({ $0.calories }, .dietaryEnergyConsumed, .kilocalorie()),
        ({ $0.protein }, .dietaryProtein, .gram()),
        ({ $0.carbs }, .dietaryCarbohydrates, .gram()),
        ({ $0.fat }, .dietaryFatTotal, .gram()),
        ({ $0.fiber }, .dietaryFiber, .gram()),
    ]

    static var shareTypes: Set<HKSampleType> {
        var types = Set(coreMap.compactMap { HKObjectType.quantityType(forIdentifier: $0.identifier) })
        types.formUnion(nutrientMap.compactMap { HKObjectType.quantityType(forIdentifier: $0.identifier) })
        return types
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        do {
            try await store.requestAuthorization(toShare: Self.shareTypes, read: [])
            return true
        } catch {
            return false
        }
    }

    /// Writes anything logged today that has not been written yet. Called after a food
    /// log and after each sync, so Health catches up without a separate action.
    func exportIfEnabled(entries: [FoodEntry], date: Date = Date()) async {
        guard enabled, HKHealthStore.isHealthDataAvailable() else { return }
        var written = Set(UserDefaults.standard.stringArray(forKey: Self.writtenKey) ?? [])
        var samples: [HKSample] = []

        for entry in entries where !written.contains(entry.id) {
            // Health data Fuel merely displays is never written back — only entries the
            // person actually logged here.
            guard entry.source?.lowercased().contains("health") != true else { continue }
            var made = false
            for core in Self.coreMap {
                guard let value = core.path(entry), value > 0,
                      let type = HKObjectType.quantityType(forIdentifier: core.identifier) else { continue }
                samples.append(sample(type, value, core.unit, entry, date))
                made = true
            }
            for nutrient in Self.nutrientMap {
                guard let value = entry.nutrients?[nutrient.nutrient], value > 0,
                      let type = HKObjectType.quantityType(forIdentifier: nutrient.identifier) else { continue }
                samples.append(sample(type, value, nutrient.unit, entry, date))
                made = true
            }
            if made { written.insert(entry.id) }
        }

        guard !samples.isEmpty else { return }
        do {
            try await store.save(samples)
            // Only remembered once Health has actually accepted them, so a failed write
            // is retried rather than silently skipped forever.
            UserDefaults.standard.set(Array(written.suffix(2000)), forKey: Self.writtenKey)
        } catch {
            // Permission refused or revoked. Nothing to report — the toggle is the
            // user's statement of intent, and Health owns the answer.
        }
    }

    private func sample(_ type: HKQuantityType, _ value: Double, _ unit: HKUnit,
                        _ entry: FoodEntry, _ date: Date) -> HKQuantitySample {
        HKQuantitySample(type: type,
                         quantity: HKQuantity(unit: unit, doubleValue: value),
                         start: date, end: date,
                         metadata: [HKMetadataKeyFoodType: entry.food ?? "Logged in Fuel"])
    }
}
