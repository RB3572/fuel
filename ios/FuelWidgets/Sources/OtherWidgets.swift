import SwiftUI
import WidgetKit

// The rest of the Today dashboard, one card per widget: the deficit strip with its
// averages, nutrition, vitals, and the smaller readings that are worth a glance on
// their own — steps, activity, sleep, heart, macros, and what is left to eat.

// MARK: - Deficit and surplus history

struct BalanceHistoryView: View {
    var entry: FuelEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let s = entry.snapshot, p = s.palette
        let days = Array(s.days.suffix(family == .systemLarge ? 10 : 5))
        Bubble(palette: p) {
            VStack(alignment: .leading, spacing: 7) {
                WidgetTitle(text: "Daily deficit and surplus", palette: p,
                            trailing: entry.stale ? "not synced" : nil)
                HStack(spacing: 10) {
                    stat("Burned", s.avgBurned, p.accent, p)
                    stat("Resting", s.avgResting, p.restingColor, p)
                    stat("Active", s.avgActive, p.activeColor, p)
                    stat(avgBalanceLabel(s.avgBalance), s.avgBalance.map(abs),
                         (s.avgBalance ?? 0) > 0 ? p.surplusColor : p.deficitColor, p)
                }
                if days.count > 1 {
                    BalanceStrip(days: days, palette: p)
                } else {
                    Text("A few more synced days fills this in")
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                }
            }
        }
    }

    /// The averages panel names the direction rather than always saying "deficit", so a
    /// stretch of surplus days is not labelled as its opposite.
    private func avgBalanceLabel(_ value: Double?) -> String {
        guard let value else { return "Avg" }
        return value > 0 ? "Avg surplus" : "Avg deficit"
    }

    private func stat(_ label: String, _ value: Double?, _ color: Color, _ p: FuelWidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.system(size: 8)).foregroundStyle(.secondary).lineLimit(1)
            Text(FuelWidgetFormat.whole(value)).font(.system(size: 15, weight: .bold))
                .foregroundStyle(color).minimumScaleFactor(0.6).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Nutrition

struct NutritionView: View {
    var entry: FuelEntry

    var body: some View {
        let s = entry.snapshot
        let p = s.palette
        Bubble(palette: p) {
            VStack(alignment: .leading, spacing: 7) {
                WidgetTitle(text: "Nutrition", palette: p, trailing: loggedCaption(s))
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(FuelWidgetFormat.whole(s.consumed)).font(.system(size: 24, weight: .bold))
                    Text("kcal eaten").font(.system(size: 10)).foregroundStyle(.secondary)
                }
                macro("Protein", s.protein, s.proteinGoal ?? 150, p.accent)
                macro("Carbs", s.carbs, s.carbsGoal ?? 250, p.activeColor)
                macro("Fat", s.fat, s.fatGoal ?? 70, p.restingColor)
                macro("Fiber", s.fiber, s.fiberGoal ?? 30, p.surplusColor)
            }
        }
    }

    private func loggedCaption(_ s: FuelWidgetSnapshot) -> String? {
        guard let count = s.entriesLogged else { return nil }
        return "\(count) logged"
    }

    private func macro(_ label: String, _ value: Double?, _ goal: Double, _ color: Color) -> some View {
        BarRow(label: label, value: FuelWidgetFormat.grams(value),
               fraction: (value ?? 0) / max(1, goal), color: color)
    }
}

/// The compact form: three rings, no numbers to read unless you want them.
struct MacroRingsView: View {
    var entry: FuelEntry
    private var bands: [RingBand] {
        let s = entry.snapshot
        let p = s.palette
        return [
            .init(progress: (s.protein ?? 0) / max(1, s.proteinGoal ?? 150), color: p.accent),
            .init(progress: (s.carbs ?? 0) / max(1, s.carbsGoal ?? 250), color: p.activeColor),
            .init(progress: (s.fat ?? 0) / max(1, s.fatGoal ?? 70), color: p.restingColor),
        ]
    }

    var body: some View {
        let s = entry.snapshot
        let p = s.palette
        Bubble(palette: p) {
            VStack(spacing: 5) {
                WidgetTitle(text: "Macros", palette: p)
                RingStack(bands: bands, thickness: 8, spacing: 3) {
                    VStack(spacing: -2) {
                        Text(FuelWidgetFormat.grams(s.protein)).font(.system(size: 15, weight: .bold))
                        Text("protein").font(.system(size: 7)).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

/// What is left of the calorie goal — the number people actually check before dinner.
struct RemainingView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        let goal = s.calorieGoal ?? s.burned
        let remaining = goal.map { $0 - (s.consumed ?? 0) }
        Bubble(palette: p) {
            VStack(spacing: 4) {
                WidgetTitle(text: "Left to eat", palette: p)
                ArcGauge(fraction: (s.consumed ?? 0) / max(1, goal ?? 1),
                         color: (remaining ?? 0) >= 0 ? p.accent : p.surplusColor) {
                    VStack(spacing: -2) {
                        Text(FuelWidgetFormat.whole(remaining.map(abs)))
                            .font(.system(size: 23, weight: .bold)).minimumScaleFactor(0.5)
                        Text((remaining ?? 0) >= 0 ? "kcal left" : "kcal over")
                            .font(.system(size: 8)).foregroundStyle(.secondary)
                    }
                }
                Text("of \(FuelWidgetFormat.whole(goal))")
                    .font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Vitals

struct VitalsWidgetView: View {
    var entry: FuelEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let s = entry.snapshot, p = s.palette
        let flagged = s.vitals.contains { $0.flagDirection != nil }
        Bubble(palette: p) {
            VStack(alignment: .leading, spacing: 6) {
                WidgetTitle(text: "Vitals", palette: p)
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text("\(s.vitalsScore ?? 0)").font(.system(size: 26, weight: .bold))
                        .foregroundStyle(flagged ? .red : p.accent)
                    Text("/10").font(.system(size: 11)).foregroundStyle(.secondary)
                    Spacer()
                    Text(flagged ? "unusual" : "typical")
                        .font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                }
                if family != .systemSmall {
                    ForEach(s.vitals.prefix(4), id: \.label) { vital in
                        HStack(spacing: 4) {
                            Circle()
                                .fill(vital.flagDirection == nil ? p.accent.opacity(0.4) : .red)
                                .frame(width: 5, height: 5)
                            Text(vital.label).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                            Spacer(minLength: 2)
                            Text("\(FuelWidgetFormat.decimal(vital.value, vital.decimals)) \(vital.unit)")
                                .font(.system(size: 10, weight: .semibold))
                            if let center = vital.center {
                                Text("~\(FuelWidgetFormat.decimal(center, vital.decimals))")
                                    .font(.system(size: 9)).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Heart alone, for people who watch resting rate and HRV rather than the whole panel.
struct HeartView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        let rhr = s.vitals.first { $0.label.lowercased().contains("resting") }
        let hrv = s.vitals.first { $0.label.uppercased().contains("HRV") }
        Bubble(palette: p) {
            VStack(alignment: .leading, spacing: 6) {
                WidgetTitle(text: "Heart", palette: p)
                bigNumber(rhr?.value, "bpm resting", p.accent, rhr?.center)
                Divider().opacity(0.3)
                bigNumber(hrv?.value, "ms HRV", p.activeColor, hrv?.center)
            }
        }
    }

    private func bigNumber(_ value: Double?, _ caption: String, _ color: Color, _ center: Double?) -> some View {
        VStack(alignment: .leading, spacing: -1) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(FuelWidgetFormat.whole(value)).font(.system(size: 21, weight: .bold))
                    .foregroundStyle(color)
                Text(caption).font(.system(size: 9)).foregroundStyle(.secondary)
            }
            if let center {
                Text("usually ~\(FuelWidgetFormat.whole(center))")
                    .font(.system(size: 8)).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Activity

struct StepsView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        let goal = s.stepGoal ?? 10000
        Bubble(palette: p) {
            VStack(spacing: 4) {
                WidgetTitle(text: "Steps", palette: p)
                ArcGauge(fraction: (s.steps ?? 0) / max(1, goal), color: p.accent) {
                    VStack(spacing: -2) {
                        Text(FuelWidgetFormat.whole(s.steps))
                            .font(.system(size: 22, weight: .bold)).minimumScaleFactor(0.5)
                        Text("of \(FuelWidgetFormat.whole(goal))")
                            .font(.system(size: 8)).foregroundStyle(.secondary)
                    }
                }
                Text("\(FuelWidgetFormat.decimal(s.distanceMiles, 1)) mi · \(FuelWidgetFormat.whole(s.flightsClimbed)) flights")
                    .font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
    }
}

struct ActivityRingsView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        Bubble(palette: p) {
            HStack(spacing: 10) {
                RingStack(bands: [
                    .init(progress: (s.active ?? 0) / 500, color: p.activeColor),
                    .init(progress: (s.exerciseMinutes ?? 0) / 30, color: p.accent),
                    .init(progress: (s.standMinutes ?? 0) / 12, color: p.restingColor),
                ], thickness: 8, spacing: 3) { EmptyView() }
                .frame(width: 74)
                VStack(alignment: .leading, spacing: 5) {
                    WidgetTitle(text: "Activity", palette: p)
                    KeyDot(color: p.activeColor, label: "Move", value: FuelWidgetFormat.whole(s.active))
                    KeyDot(color: p.accent, label: "Exercise", value: "\(FuelWidgetFormat.whole(s.exerciseMinutes))m")
                    KeyDot(color: p.restingColor, label: "Stand", value: "\(FuelWidgetFormat.whole(s.standMinutes))h")
                }
            }
        }
    }
}

struct SleepView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        Bubble(palette: p) {
            VStack(alignment: .leading, spacing: 6) {
                WidgetTitle(text: "Sleep", palette: p)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(FuelWidgetFormat.decimal(s.sleepHours, 1))
                        .font(.system(size: 30, weight: .bold)).foregroundStyle(p.accent)
                    Text("hours").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                CapsuleBar(fraction: (s.sleepHours ?? 0) / 8, color: p.accent, height: 8)
                Text("of an 8 hour night").font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
    }
}

/// The shape of the last stretch of days, with no axis and no numbers — just whether
/// the run is trending toward deficit or surplus.
struct BalanceTrendView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        let values = s.days.map(\.balance)
        Bubble(palette: p) {
            VStack(alignment: .leading, spacing: 5) {
                WidgetTitle(text: "\(s.days.count) day trend", palette: p)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(FuelWidgetFormat.whole(s.avgBalance.map(abs)))
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle((s.avgBalance ?? 0) > 0 ? p.surplusColor : p.deficitColor)
                    Text((s.avgBalance ?? 0) > 0 ? "avg surplus" : "avg deficit")
                        .font(.system(size: 9)).foregroundStyle(.secondary)
                }
                if values.count > 1 {
                    Sparkline(values: values, color: p.accent).frame(height: 34)
                }
            }
        }
    }
}

/// A shortcut, not a readout: one tap opens straight into the camera.
struct QuickLogView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        Bubble(palette: p) {
            VStack(spacing: 6) {
                ZStack {
                    Circle().fill(p.accent.opacity(0.18)).frame(width: 54, height: 54)
                    Image(systemName: "camera.fill").font(.system(size: 22)).foregroundStyle(p.accent)
                }
                Text("Log a meal").font(.system(size: 13, weight: .semibold))
                Text("\(FuelWidgetFormat.whole(s.consumed)) kcal so far")
                    .font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
    }
}
