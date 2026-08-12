import SwiftUI

// The website's daily vitals health signal (src/App.tsx's computeVitalsSignal +
// VitalsSignal), transcribed exactly: same statistics, same thresholds, same copy.
// Compares today's vitals against the user's OWN history and flags days that are
// statistically unusual — an early, personalized "are you coming down with something"
// signal. Method:
//  * Per vital: a modified z-score z = (today − median)/(1.4826·MAD). Median/MAD is the
//    Iglewicz–Hoaglin robust estimator, so one or two odd past days don't distort the
//    baseline the way mean/SD would. Falls back to mean/SD if MAD is 0.
//  * Two-tailed p = erfc(|z|/√2): the chance a normal day would look this extreme.
//  * A vital is flagged only when p < 0.05/N (Bonferroni across the N vitals tested).
//  * Score 1–10 from combined surprise −log10(p). 10 = typical, 1 = highly unusual.
// Informational only — this is not a medical diagnosis.

enum VitalKey: String, CaseIterable {
    case restingHeartRate, hrv, respiratoryRate, bloodOxygen, walkingHeartRateAverage, cardioRecovery

    var label: String {
        switch self {
        case .restingHeartRate: return "Resting heart rate"
        case .hrv: return "HRV"
        case .respiratoryRate: return "Respiratory rate"
        case .bloodOxygen: return "Blood oxygen"
        case .walkingHeartRateAverage: return "Walking heart rate"
        case .cardioRecovery: return "Cardio recovery"
        }
    }
    var unit: String {
        switch self {
        case .restingHeartRate, .walkingHeartRateAverage, .cardioRecovery: return "bpm"
        case .hrv: return "ms"
        case .respiratoryRate: return "/min"
        case .bloodOxygen: return "%"
        }
    }
    var decimals: Int { self == .respiratoryRate || self == .bloodOxygen ? 1 : 0 }

    /// The smallest change in this vital that is worth calling unusual, used as a floor
    /// under the MAD-derived sigma. Without it a vital that barely moves — a cardio
    /// recovery that reads the same number most days — gets a near-zero sigma, and then
    /// a difference far below the sensor's own precision divides out to a huge z. That
    /// is how a 44 bpm reading against a 44 bpm baseline came back as "Low, z 8.4".
    var minimumMeaningfulSpread: Double {
        switch self {
        case .restingHeartRate: return 2
        case .hrv: return 5
        case .respiratoryRate: return 0.5
        case .bloodOxygen: return 0.5
        case .walkingHeartRateAverage: return 3
        case .cardioRecovery: return 3
        }
    }

    func value(_ s: DaySummary) -> Double? {
        switch self {
        case .restingHeartRate: return s.restingHeartRate
        case .hrv: return s.hrv
        case .respiratoryRate: return s.respiratoryRate
        case .bloodOxygen: return s.bloodOxygen
        case .walkingHeartRateAverage: return s.walkingHeartRateAverage
        case .cardioRecovery: return s.cardioRecovery
        }
    }
}

struct VitalItem {
    var key: VitalKey
    var today: Double
    var center: Double?
    var z: Double?
    var p: Double?
    var direction: String?
    var insufficient = false
    var flagged = false
    var watch = false
}

enum VitalsStatus { case healthy, watch, flag, baseline }

struct VitalsSignalResult {
    var status: VitalsStatus
    var score: Int?
    var evaluated: Int
    var flags: [VitalItem]
    var items: [VitalItem]
}

private let vitalsMinHistory = 7

/// Abramowitz & Stegun 7.1.26 complementary error function (x >= 0).
private func erfc(_ x: Double) -> Double {
    let t = 1 / (1 + 0.3275911 * x)
    let y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    return y * exp(-x * x)
}

private func median(_ values: [Double]) -> Double {
    let s = values.sorted()
    let n = s.count
    return n % 2 == 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

func computeVitalsSignal(trends: [DaySummary], summary: DaySummary?) -> VitalsSignalResult {
    guard let summary else { return VitalsSignalResult(status: .baseline, score: nil, evaluated: 0, flags: [], items: []) }
    let today = summary.date
    var items: [VitalItem] = []
    for key in VitalKey.allCases {
        guard let todayVal = key.value(summary) else { continue }
        let baseline = trends.filter { $0.date != today }.compactMap { key.value($0) }
        if baseline.count < vitalsMinHistory {
            items.append(VitalItem(key: key, today: todayVal, insufficient: true))
            continue
        }
        let m = median(baseline)
        let mad = median(baseline.map { abs($0 - m) })
        var sigma = 1.4826 * mad
        if !(sigma > 0) {
            let mean = baseline.reduce(0, +) / Double(baseline.count)
            let variance = baseline.reduce(0.0) { $0 + ($1 - mean) * ($1 - mean) } / Double(max(1, baseline.count - 1))
            sigma = variance.squareRoot()
        }
        sigma = max(sigma, key.minimumMeaningfulSpread)
        let z = (todayVal - m) / sigma
        let p = min(1, erfc(abs(z) / 2.0.squareRoot()))
        items.append(VitalItem(key: key, today: todayVal, center: m, z: z, p: p, direction: z >= 0 ? "up" : "down"))
    }
    var evaluated = items.filter { $0.z != nil }
    guard !evaluated.isEmpty else { return VitalsSignalResult(status: .baseline, score: nil, evaluated: 0, flags: [], items: items) }
    let alpha = 0.05 / Double(evaluated.count)
    for i in evaluated.indices {
        evaluated[i].flagged = (evaluated[i].p ?? 1) < alpha
        evaluated[i].watch = !evaluated[i].flagged && abs(evaluated[i].z ?? 0) >= 2
    }
    for i in items.indices where items[i].z != nil {
        if let idx = evaluated.firstIndex(where: { $0.key == items[i].key }) { items[i] = evaluated[idx] }
    }
    let surprises = evaluated.map { -log10(max($0.p ?? 1e-12, 1e-12)) }
    let primary = surprises.max() ?? 0
    let primaryIdx = surprises.firstIndex(of: primary) ?? 0
    var extra = 0.0
    for (idx, item) in evaluated.enumerated() where idx != primaryIdx && abs(item.z ?? 0) >= 2 {
        extra += -log10(max(item.p ?? 1e-12, 1e-12))
    }
    let combined = primary + 0.5 * extra
    let score = max(1, min(10, Int((10 - 2.2 * max(0, combined - 1)).rounded())))
    let flags = evaluated.filter { $0.flagged }.sorted { ($0.p ?? 1) < ($1.p ?? 1) }
    let status: VitalsStatus = !flags.isEmpty ? .flag : evaluated.contains { $0.watch } ? .watch : .healthy
    return VitalsSignalResult(status: status, score: score, evaluated: evaluated.count, flags: flags, items: items)
}

struct VitalsSignalBar: View {
    @Environment(\.colorScheme) private var scheme
    let trends: [DaySummary]
    let summary: DaySummary?
    @State private var open = false
    @State private var showingAll = false

    private var signal: VitalsSignalResult { computeVitalsSignal(trends: trends, summary: summary) }

    var body: some View {
        let s = signal
        if s.status == .baseline {
            HStack(spacing: 8) {
                Circle().fill(Palette.muted(scheme)).frame(width: 7, height: 7)
                Text("Building your vitals baseline — a few more days of synced history unlocks the daily health signal.")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            }
            .padding(12)
            .background(Palette.surface(scheme))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Button { withAnimation(.easeInOut(duration: 0.2)) { open.toggle() } } label: {
                    HStack(spacing: 10) {
                        Circle().fill(dotColor(s.status)).frame(width: 9, height: 9)
                        HStack(alignment: .firstTextBaseline, spacing: 1) {
                            Text("\(s.score ?? 0)").font(.system(size: 16, weight: .bold))
                            Text("/10").font(.system(size: 11)).opacity(0.7)
                        }
                        Text(headline(s)).font(.system(size: 13, weight: .medium)).lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 6)
                        Text(open ? "Hide" : "Details").font(.system(size: 12)).opacity(0.7)
                    }
                    .foregroundStyle(textColor(s.status))
                }
                .buttonStyle(.plain)

                if open {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(s.items, id: \.key) { item in vitalRow(item) }
                        Button { showingAll = true } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "chart.xyaxis.line")
                                Text("See all vitals and their trends")
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 11))
                            }
                            .font(.system(size: 13, weight: .medium))
                            .padding(.vertical, 9).padding(.horizontal, 11)
                            .background(Palette.surface(scheme), in: RoundedRectangle(cornerRadius: 9))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(DashboardTheme.shared.accent)
                        .padding(.top, 4)
                        Text("Today vs. your own history using a modified z-score (median/MAD), Bonferroni-corrected across \(s.evaluated) vital\(s.evaluated == 1 ? "" : "s"). 10 = typical for you, 1 = highly unusual. Informational only — not a medical diagnosis.")
                            .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
                            .padding(.top, 4)
                    }
                    .padding(.top, 10)
                }
            }
            .padding(12)
            .background(backgroundTint(s.status))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(borderColor(s.status), lineWidth: 1))
            .sheet(isPresented: $showingAll) {
                NavigationStack {
                    VitalsDetailView(trends: trends, summary: summary)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { showingAll = false }
                            }
                        }
                }
            }
        }
    }

    private func headline(_ s: VitalsSignalResult) -> String {
        switch s.status {
        case .flag:
            let parts = s.flags.prefix(3).map { "\($0.key.label.lowercased()) \($0.direction == "up" ? "↑" : "↓")" }
            return "Heads up — \(parts.joined(separator: ", ")) vs your usual"
        case .watch: return "Vitals mostly on track — one is drifting from your usual"
        default: return "Vitals aligned with your baseline"
        }
    }

    private func vitalRow(_ item: VitalItem) -> some View {
        HStack {
            Text(item.key.label).font(.system(size: 12)).foregroundStyle(Palette.ink(scheme))
            Spacer()
            if item.insufficient {
                Text("Not enough history yet").font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            } else {
                Text("\(Format.number(item.today, decimals: item.key.decimals)) \(item.key.unit)")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                Text("usually ~\(Format.number(item.center, decimals: item.key.decimals))")
                    .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                Text(item.flagged || item.watch
                     ? "\(item.direction == "up" ? "High ↑" : "Low ↓") · z \(Format.number(item.z.map(abs), decimals: 1))"
                     : "Typical")
                    .font(.system(size: 10, weight: .medium))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background((item.flagged ? Color.red : item.watch ? Color.orange : Palette.muted(scheme)).opacity(0.14),
                                in: Capsule())
                    .foregroundStyle(item.flagged ? .red : item.watch ? .orange : Palette.muted(scheme))
            }
        }
        .padding(.vertical, 2)
    }

    private func dotColor(_ status: VitalsStatus) -> Color {
        switch status { case .flag: return .red; case .watch: return .orange; default: return .green }
    }
    private func textColor(_ status: VitalsStatus) -> Color {
        switch status {
        case .flag: return Color(hex: 0x8a2317)
        case .watch: return Color(hex: 0x8a5a17)
        default: return Color(hex: 0x1c6b3f)
        }
    }
    private func backgroundTint(_ status: VitalsStatus) -> Color {
        switch status { case .flag: return .red.opacity(0.08); case .watch: return .orange.opacity(0.08); default: return .green.opacity(0.07) }
    }
    private func borderColor(_ status: VitalsStatus) -> Color {
        switch status { case .flag: return .red.opacity(0.25); case .watch: return .orange.opacity(0.25); default: return .green.opacity(0.22) }
    }
}
