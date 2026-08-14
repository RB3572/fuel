import SwiftUI

// The website's Compare tab (src/ComparePage.tsx + src/compareReference.ts), ported
// whole: same published reference tables, same percentile method, same sources. Every
// number below is a population quartile from a cited source — see `source`/`note` on
// each metric, surfaced in the sources panel exactly as the website shows them.
//
// This is a wellness comparison, NOT a clinical reference: healthy individuals vary,
// and wearable measurements differ from lab ones (Apple Health HRV = SDNN; "cardio
// recovery" = 1-minute heart-rate recovery).

struct CompareRef { var p25: Double; var p50: Double; var p75: Double }
enum CompareSex: String { case male = "m", female = "f" }
enum CompareBetter { case up, down, neutral }
enum CompareGroup: String, CaseIterable { case energy = "Energy", cardiovascular = "Cardiovascular", fitness = "Fitness", activity = "Activity & sleep" }

struct CompareMetric {
    var key: String
    var label: String
    var unit: String
    var decimals: Int
    var group: CompareGroup
    var better: CompareBetter
    var source: String
    var note: String?
    /// Six entries, one per age band (18–29 … 70+). Sex-split metrics vary the answer
    /// by sex; age-stable ones (e.g. resting heart rate) ignore it.
    var table: (CompareSex) -> [CompareRef]
}

let compareAgeBands = ["18–29", "30–39", "40–49", "50–59", "60–69", "70+"]

func compareAgeBandIndex(_ age: Int?) -> Int {
    guard let age else { return -1 }
    if age <= 29 { return 0 }
    if age <= 39 { return 1 }
    if age <= 49 { return 2 }
    if age <= 59 { return 3 }
    if age <= 69 { return 4 }
    return 5
}

private func rep(_ r: CompareRef) -> [CompareRef] { Array(repeating: r, count: 6) }

let compareMetrics: [CompareMetric] = [
    // ---- Energy ------------------------------------------------------------------
    CompareMetric(key: "caloriesConsumed", label: "Calories eaten", unit: "kcal/day", decimals: 0, group: .energy, better: .neutral,
        source: "USDA Dietary Guidelines for Americans 2020–2025, Estimated Energy Requirements (moderately active).", note: nil,
        table: { sex in sex == .male
            ? [.init(p25: 2400, p50: 2700, p75: 3000), .init(p25: 2200, p50: 2500, p75: 2800), .init(p25: 2200, p50: 2500, p75: 2800), .init(p25: 2000, p50: 2300, p75: 2600), .init(p25: 2000, p50: 2300, p75: 2600), .init(p25: 1800, p50: 2100, p75: 2400)]
            : [.init(p25: 1800, p50: 2100, p75: 2400), .init(p25: 1800, p50: 2000, p75: 2200), .init(p25: 1800, p50: 2000, p75: 2200), .init(p25: 1600, p50: 1900, p75: 2100), .init(p25: 1600, p50: 1900, p75: 2100), .init(p25: 1500, p50: 1750, p75: 2000)] }),
    CompareMetric(key: "totalExpenditure", label: "Total calories burned", unit: "kcal/day", decimals: 0, group: .energy, better: .neutral,
        source: "USDA Estimated Energy Requirements (≈ total daily energy expenditure at a healthy weight), moderately active.",
        note: "At a stable weight, total burn ≈ calories eaten.",
        table: { sex in sex == .male
            ? [.init(p25: 2400, p50: 2700, p75: 3000), .init(p25: 2200, p50: 2500, p75: 2800), .init(p25: 2200, p50: 2500, p75: 2800), .init(p25: 2000, p50: 2300, p75: 2600), .init(p25: 2000, p50: 2300, p75: 2600), .init(p25: 1800, p50: 2100, p75: 2400)]
            : [.init(p25: 1800, p50: 2100, p75: 2400), .init(p25: 1800, p50: 2000, p75: 2200), .init(p25: 1800, p50: 2000, p75: 2200), .init(p25: 1600, p50: 1900, p75: 2100), .init(p25: 1600, p50: 1900, p75: 2100), .init(p25: 1500, p50: 1750, p75: 2000)] }),
    CompareMetric(key: "restingEnergy", label: "Resting energy (BMR)", unit: "kcal/day", decimals: 0, group: .energy, better: .neutral,
        source: "Mifflin–St Jeor equation for reference body sizes (men ~80 kg/178 cm, women ~68 kg/164 cm).",
        note: "Strongly depends on body size and muscle — treat as a rough anchor.",
        table: { sex in sex == .male
            ? [.init(p25: 1650, p50: 1790, p75: 1950), .init(p25: 1600, p50: 1740, p75: 1900), .init(p25: 1550, p50: 1690, p75: 1850), .init(p25: 1500, p50: 1640, p75: 1800), .init(p25: 1450, p50: 1590, p75: 1740), .init(p25: 1400, p50: 1540, p75: 1690)]
            : [.init(p25: 1300, p50: 1420, p75: 1550), .init(p25: 1250, p50: 1370, p75: 1500), .init(p25: 1200, p50: 1320, p75: 1450), .init(p25: 1150, p50: 1270, p75: 1400), .init(p25: 1110, p50: 1220, p75: 1340), .init(p25: 1060, p50: 1170, p75: 1290)] }),
    // ---- Cardiovascular ------------------------------------------------------------
    CompareMetric(key: "restingHeartRate", label: "Resting heart rate", unit: "bpm", decimals: 0, group: .cardiovascular, better: .down,
        source: "Population wearable data (Quer et al., Nature Medicine 2020, n≈92,000) and clinical normal 60–100 bpm.",
        note: "Adult resting heart rate is largely age-stable; lower is generally fitter.",
        table: { _ in rep(.init(p25: 57, p50: 63, p75: 70)) }),
    CompareMetric(key: "hrv", label: "Heart rate variability (SDNN)", unit: "ms", decimals: 0, group: .cardiovascular, better: .up,
        source: "Nunan et al. 2010 normative HRV review (SDNN) plus consumer-wearable distributions.",
        note: "Apple Health reports HRV as SDNN. HRV falls with age and varies widely between people and devices.",
        table: { _ in [.init(p25: 45, p50: 62, p75: 82), .init(p25: 38, p50: 52, p75: 68), .init(p25: 32, p50: 44, p75: 58), .init(p25: 27, p50: 38, p75: 50), .init(p25: 23, p50: 32, p75: 43), .init(p25: 20, p50: 28, p75: 38)] }),
    CompareMetric(key: "respiratoryRate", label: "Respiratory rate", unit: "/min", decimals: 1, group: .cardiovascular, better: .neutral,
        source: "Clinical normal resting respiratory rate 12–20 breaths/min (adult).", note: nil,
        table: { _ in rep(.init(p25: 13, p50: 15, p75: 17)) }),
    CompareMetric(key: "bloodOxygen", label: "Blood oxygen (SpO₂)", unit: "%", decimals: 1, group: .cardiovascular, better: .up,
        source: "Healthy adult SpO₂ 95–100%; a small decline is typical with age.", note: nil,
        table: { _ in [.init(p25: 96.5, p50: 98, p75: 99), .init(p25: 96.5, p50: 98, p75: 99), .init(p25: 96.5, p50: 98, p75: 99), .init(p25: 96, p50: 97.5, p75: 99), .init(p25: 95.5, p50: 97, p75: 98.5), .init(p25: 95.5, p50: 97, p75: 98.5)] }),
    CompareMetric(key: "cardioRecovery", label: "Cardio recovery (1-min HRR)", unit: "bpm", decimals: 0, group: .cardiovascular, better: .up,
        source: "Heart-rate recovery literature (Cole et al. 1999 and later); >12 bpm at 1 min is reassuring, higher is fitter.", note: nil,
        table: { _ in [.init(p25: 24, p50: 32, p75: 42), .init(p25: 22, p50: 30, p75: 40), .init(p25: 20, p50: 28, p75: 37), .init(p25: 18, p50: 25, p75: 34), .init(p25: 16, p50: 23, p75: 31), .init(p25: 14, p50: 20, p75: 28)] }),
    // ---- Fitness ---------------------------------------------------------------
    CompareMetric(key: "vo2Max", label: "VO₂ max", unit: "mL/kg/min", decimals: 1, group: .fitness, better: .up,
        source: "Cooper Institute / ACSM FRIEND registry cardiorespiratory-fitness norms (sex- and age-specific).", note: nil,
        table: { sex in sex == .male
            ? [.init(p25: 42, p50: 48, p75: 55), .init(p25: 37, p50: 43, p75: 50), .init(p25: 34, p50: 40, p75: 46), .init(p25: 30, p50: 36, p75: 42), .init(p25: 26, p50: 32, p75: 38), .init(p25: 22, p50: 27, p75: 33)]
            : [.init(p25: 33, p50: 38, p75: 44), .init(p25: 30, p50: 35, p75: 41), .init(p25: 27, p50: 32, p75: 37), .init(p25: 23, p50: 28, p75: 33), .init(p25: 20, p50: 25, p75: 30), .init(p25: 18, p50: 22, p75: 27)] }),
    // ---- Activity & sleep --------------------------------------------------------
    CompareMetric(key: "stepCount", label: "Steps", unit: "/day", decimals: 0, group: .activity, better: .up,
        source: "NHANES accelerometer data and Tudor-Locke step-count research; daily steps decline with age.", note: nil,
        table: { _ in [.init(p25: 4500, p50: 7000, p75: 10000), .init(p25: 4200, p50: 6500, p75: 9500), .init(p25: 3900, p50: 6000, p75: 8800), .init(p25: 3400, p50: 5300, p75: 7800), .init(p25: 2700, p50: 4300, p75: 6500), .init(p25: 2000, p50: 3200, p75: 5000)] }),
    CompareMetric(key: "sleepHours", label: "Sleep", unit: "h/night", decimals: 1, group: .activity, better: .neutral,
        source: "National Sleep Foundation recommendations (7–9 h adults, 7–8 h age 65+) and CDC average adult sleep.", note: nil,
        table: { _ in [.init(p25: 6.5, p50: 7.2, p75: 8.0), .init(p25: 6.5, p50: 7.2, p75: 8.0), .init(p25: 6.5, p50: 7.1, p75: 7.9), .init(p25: 6.4, p50: 7.1, p75: 7.9), .init(p25: 6.3, p50: 7.0, p75: 7.8), .init(p25: 6.3, p50: 7.0, p75: 7.8)] }),
]

// Approximate percentile of `value` within the band, modelling it as normal with
// mean = p50 and SD from the interquartile range (IQR ≈ 1.349·SD).
private func compareErf(_ x: Double) -> Double {
    let sign: Double = x < 0 ? -1 : 1
    let a = abs(x)
    let t = 1 / (1 + 0.3275911 * a)
    let y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a)
    return sign * y
}

func comparePercentile(_ value: Double, _ ref: CompareRef) -> Int {
    let sd = max(1e-6, (ref.p75 - ref.p25) / 1.349)
    let z = (value - ref.p50) / sd
    return max(1, min(99, Int((50 * (1 + compareErf(z / 2.0.squareRoot()))).rounded())))
}

enum CompareTone { case good, ok, watch }
struct CompareStanding { var pct: Int; var tone: CompareTone; var label: String }

func compareStanding(_ value: Double, _ ref: CompareRef, _ better: CompareBetter) -> CompareStanding {
    let pct = comparePercentile(value, ref)
    switch better {
    case .up:
        if pct >= 50 { return CompareStanding(pct: pct, tone: .good, label: "Above typical") }
        if pct >= 25 { return CompareStanding(pct: pct, tone: .ok, label: "Around typical") }
        return CompareStanding(pct: pct, tone: .watch, label: "Below typical")
    case .down:
        if pct <= 50 { return CompareStanding(pct: pct, tone: .good, label: "Below typical") }
        if pct <= 75 { return CompareStanding(pct: pct, tone: .ok, label: "Around typical") }
        return CompareStanding(pct: pct, tone: .watch, label: "Above typical")
    case .neutral:
        if pct >= 25 && pct <= 75 { return CompareStanding(pct: pct, tone: .good, label: "Typical range") }
        return CompareStanding(pct: pct, tone: .ok, label: pct < 25 ? "Below typical" : "Above typical")
    }
}

/// The user's own averages over the synced history window — same fields, same
/// energyAverages-first fallback the website's userValues memo uses.
struct CompareUserValues {
    var values: [String: Double?]

    init(trends: [DaySummary], energyAverages: EnergyAverages?) {
        func avg(_ pick: (DaySummary) -> Double?) -> Double? {
            let vals = trends.compactMap(pick)
            guard !vals.isEmpty else { return nil }
            return vals.reduce(0, +) / Double(vals.count)
        }
        values = [
            "caloriesConsumed": avg { $0.caloriesConsumed },
            "totalExpenditure": energyAverages?.totalExpenditure ?? avg { $0.totalExpenditure },
            "restingEnergy": energyAverages?.restingEnergy ?? avg { $0.restingEnergy },
            "restingHeartRate": avg { $0.restingHeartRate },
            "hrv": avg { $0.hrv },
            "respiratoryRate": avg { $0.respiratoryRate },
            "bloodOxygen": avg { $0.bloodOxygen },
            "cardioRecovery": avg { $0.cardioRecovery },
            "vo2Max": avg { $0.vo2Max },
            "stepCount": avg { $0.stepCount },
            "sleepHours": avg { $0.sleepHours },
        ]
    }

    func value(for key: String) -> Double? { values[key] ?? nil }
}

/// The full comparison, built to sit inside the Trends screen rather than behind its
/// own tab: same metric rows, same reference bands, same sources note. It used to be a
/// separate page with a summary card pointing at it, which meant two places showing the
/// same numbers at different levels of detail.
struct CompareSection: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    /// Local only until a sex is stored on the profile — see Preferences & context,
    /// where it is set once. A stored value wins, so the comparison lands on the right
    /// reference table without anyone having to remember this control exists.
    @State private var manualSex: CompareSex = UserDefaults.standard.string(forKey: "fuelCompareSex") == "f" ? .female : .male
    private var sex: CompareSex {
        switch store.dashboard?.goalProfile?.sex {
        case "f": return .female
        case "m": return .male
        default: return manualSex
        }
    }
    @State private var manualBand = 0

    private var trends: [DaySummary] { store.dashboard?.trends ?? [] }
    private var profileAge: Int? { store.dashboard?.goalProfile?.age }
    private var bandIdx: Int { profileAge != nil ? compareAgeBandIndex(profileAge) : manualBand }
    private var userValues: CompareUserValues { CompareUserValues(trends: trends, energyAverages: store.dashboard?.energyAverages) }

    var body: some View {
        // Four group panels, each holding several rows that measure themselves — built
        // only as they are reached rather than all at once the moment Trends appears.
        LazyVStack(spacing: 14) {
                header
                if profileAge == nil {
                    HStack(spacing: 8) {
                        Image(systemName: "info.circle").foregroundStyle(Palette.muted(scheme))
                        Text("Add your age in Goals for an exact age-group match. Showing the \(compareAgeBands[bandIdx]) band for now.")
                            .font(.caption).foregroundStyle(Palette.muted(scheme))
                    }
                    .padding(12)
                    .background(Palette.surface(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                ForEach(CompareGroup.allCases, id: \.self) { group in
                    let metrics = compareMetrics.filter { $0.group == group }
                    Panel(title: group.rawValue) {
                        ForEach(Array(metrics.enumerated()), id: \.element.key) { index, metric in
                            CompareMetricRow(metric: metric, value: userValues.value(for: metric.key),
                                             ref: bandIdx >= 0 ? metric.table(sex)[bandIdx] : nil)
                            if index < metrics.count - 1 { Divider() }
                        }
                    }
                }
                sourcesPanel
        }
        .onAppear { if profileAge == nil { manualBand = max(0, compareAgeBandIndex(profileAge)) } }
    }

    private var header: some View {
        Panel {
            Text("How you compare").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink(scheme))
            Text("Your recent averages next to published norms for \(profileAge != nil ? "\(profileAge!)-year-olds" : "the \(compareAgeBands[bandIdx]) age group").")
                .font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
            HStack(spacing: 10) {
                // Only when the profile has not answered it. Once a sex is stored in
                // Preferences & context, the reference table follows that and this
                // control has nothing left to decide.
                if store.dashboard?.goalProfile?.sex == nil {
                    Picker("Sex", selection: $manualSex) {
                        Text("Male").tag(CompareSex.male)
                        Text("Female").tag(CompareSex.female)
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 200)
                    .onChange(of: manualSex) { _, value in UserDefaults.standard.set(value.rawValue, forKey: "fuelCompareSex") }
                }
                if profileAge == nil {
                    Picker("Age group", selection: $manualBand) {
                        ForEach(Array(compareAgeBands.enumerated()), id: \.offset) { index, band in Text(band).tag(index) }
                    }
                    .pickerStyle(.menu)
                }
                Spacer()
            }
        }
    }

    private var sourcesPanel: some View {
        Panel(title: "Data sources & method") {
            Text("For each metric we estimate your percentile by modelling the reference band as a normal distribution (median = typical value, spread from the 25th–75th percentile range). Your value is a \(trends.count)-day average of your synced data. This is a wellness comparison, not a medical assessment — healthy individuals vary, and wearable measurements differ from clinical ones.")
                .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            ForEach(Array(Set(compareMetrics.map(\.source))).sorted(), id: \.self) { source in
                Text("• \(source)").font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            }
        }
    }
}

private struct CompareMetricRow: View {
    @Environment(\.colorScheme) private var scheme
    let metric: CompareMetric
    let value: Double?
    let ref: CompareRef?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(metric.label).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                    Text(metric.unit).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                }
                Spacer()
                if let value, let ref {
                    let st = compareStanding(value, ref, metric.better)
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(Format.number(value, decimals: metric.decimals)).font(.system(size: 15, weight: .semibold, design: .rounded))
                            .foregroundStyle(Palette.ink(scheme))
                        Text("\(ordinal(st.pct)) pct · \(st.label)").font(.system(size: 11)).foregroundStyle(tone(st.tone))
                    }
                } else {
                    Text(value == nil ? "No synced data yet" : "No age-group reference")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                }
            }
            if let value, let ref {
                CompareBar(value: value, ref: ref, tone: compareStanding(value, ref, metric.better).tone)
                HStack {
                    Text("Typical \(Format.number(ref.p50, decimals: metric.decimals)) (\(Format.number(ref.p25, decimals: metric.decimals))–\(Format.number(ref.p75, decimals: metric.decimals)))")
                        .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                    Spacer()
                    if let note = metric.note {
                        Text(note).font(.system(size: 10)).foregroundStyle(Palette.muted(scheme)).multilineTextAlignment(.trailing).lineLimit(2)
                    }
                }
            }
        }
        .padding(.vertical, 6)
    }

    private func tone(_ t: CompareTone) -> Color {
        switch t { case .good: return .green; case .ok: return DashboardTheme.shared.accent; case .watch: return .red }
    }
}

private struct CompareBar: View {
    @Environment(\.colorScheme) private var scheme
    let value: Double
    let ref: CompareRef
    let tone: CompareTone

    var body: some View {
        GeometryReader { geo in
            let iqr = max(1e-6, ref.p75 - ref.p25)
            let dMin = min(ref.p25, value) - iqr * 0.9
            let dMax = max(ref.p75, value) + iqr * 0.9
            let span = max(1e-6, dMax - dMin)
            let width = geo.size.width
            let pos: (Double) -> CGFloat = { v in CGFloat(max(0, min(1, (v - dMin) / span))) * width }
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.surface(scheme)).frame(height: 6)
                Capsule().fill(Palette.muted(scheme).opacity(0.45))
                    .frame(width: max(2, pos(ref.p75) - pos(ref.p25)), height: 6)
                    .offset(x: pos(ref.p25))
                Rectangle().fill(Palette.ink(scheme)).frame(width: 2, height: 12).offset(x: pos(ref.p50) - 1)
                Circle().fill(toneColor).frame(width: 11, height: 11)
                    .overlay(Circle().stroke(Palette.panel(scheme), lineWidth: 1.5))
                    .offset(x: pos(value) - 5.5)
            }
        }
        .frame(height: 12)
    }

    private var toneColor: Color {
        switch tone { case .good: return .green; case .ok: return DashboardTheme.shared.accent; case .watch: return .red }
    }
}

private func ordinal(_ n: Int) -> String {
    let v = n % 100
    if (11...13).contains(v) { return "\(n)th" }
    switch n % 10 {
    case 1: return "\(n)st"
    case 2: return "\(n)nd"
    case 3: return "\(n)rd"
    default: return "\(n)th"
    }
}
