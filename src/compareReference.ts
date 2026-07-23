// Population reference values for comparing a user's metrics against their age group.
// Every table below is drawn from published sources (cited in SOURCES and surfaced in
// the UI). Values are approximate population quartiles — p50 is the typical (median)
// value and p25–p75 the interquartile range for that age band — reconstructed from the
// cited normative data so we can estimate a percentile. This is a wellness comparison,
// NOT a clinical reference: individual healthy values vary, and device measurements
// (especially Apple Health HRV = SDNN, and "cardio recovery" = 1-minute heart-rate
// recovery) differ from lab measurement.

export type Sex = 'm' | 'f'
export type Ref = { p25: number; p50: number; p75: number }
export type MetricTable = { m: Ref[]; f: Ref[] } | { all: Ref[] }
export type MetricDef = {
  key: string
  label: string
  unit: string
  decimals: number
  group: 'Energy' | 'Cardiovascular' | 'Fitness' | 'Activity & sleep'
  better: 'up' | 'down' | 'neutral'
  source: string
  note?: string
  table: MetricTable
}

// Age bands: 18–29, 30–39, 40–49, 50–59, 60–69, 70+
export const AGE_BANDS = ['18–29', '30–39', '40–49', '50–59', '60–69', '70+'] as const
export function ageBandIndex(age: number | null): number {
  if (age == null || !Number.isFinite(age)) return -1
  if (age <= 29) return 0
  if (age <= 39) return 1
  if (age <= 49) return 2
  if (age <= 59) return 3
  if (age <= 69) return 4
  return 5
}

const rep = (r: Ref): Ref[] => [r, r, r, r, r, r] // age-stable metric repeated across bands

export const METRICS: MetricDef[] = [
  // ---- Energy ------------------------------------------------------------------
  {
    key: 'caloriesConsumed', label: 'Calories eaten', unit: 'kcal/day', decimals: 0, group: 'Energy', better: 'neutral',
    source: 'USDA Dietary Guidelines for Americans 2020–2025, Estimated Energy Requirements (moderately active).',
    table: {
      m: [{ p25: 2400, p50: 2700, p75: 3000 }, { p25: 2200, p50: 2500, p75: 2800 }, { p25: 2200, p50: 2500, p75: 2800 }, { p25: 2000, p50: 2300, p75: 2600 }, { p25: 2000, p50: 2300, p75: 2600 }, { p25: 1800, p50: 2100, p75: 2400 }],
      f: [{ p25: 1800, p50: 2100, p75: 2400 }, { p25: 1800, p50: 2000, p75: 2200 }, { p25: 1800, p50: 2000, p75: 2200 }, { p25: 1600, p50: 1900, p75: 2100 }, { p25: 1600, p50: 1900, p75: 2100 }, { p25: 1500, p50: 1750, p75: 2000 }],
    },
  },
  {
    key: 'totalExpenditure', label: 'Total calories burned', unit: 'kcal/day', decimals: 0, group: 'Energy', better: 'neutral',
    source: 'USDA Estimated Energy Requirements (≈ total daily energy expenditure at a healthy weight), moderately active.',
    note: 'At a stable weight, total burn ≈ calories eaten.',
    table: {
      m: [{ p25: 2400, p50: 2700, p75: 3000 }, { p25: 2200, p50: 2500, p75: 2800 }, { p25: 2200, p50: 2500, p75: 2800 }, { p25: 2000, p50: 2300, p75: 2600 }, { p25: 2000, p50: 2300, p75: 2600 }, { p25: 1800, p50: 2100, p75: 2400 }],
      f: [{ p25: 1800, p50: 2100, p75: 2400 }, { p25: 1800, p50: 2000, p75: 2200 }, { p25: 1800, p50: 2000, p75: 2200 }, { p25: 1600, p50: 1900, p75: 2100 }, { p25: 1600, p50: 1900, p75: 2100 }, { p25: 1500, p50: 1750, p75: 2000 }],
    },
  },
  {
    key: 'restingEnergy', label: 'Resting energy (BMR)', unit: 'kcal/day', decimals: 0, group: 'Energy', better: 'neutral',
    source: 'Mifflin–St Jeor equation for reference body sizes (men ~80 kg/178 cm, women ~68 kg/164 cm).',
    note: 'Strongly depends on body size and muscle — treat as a rough anchor.',
    table: {
      m: [{ p25: 1650, p50: 1790, p75: 1950 }, { p25: 1600, p50: 1740, p75: 1900 }, { p25: 1550, p50: 1690, p75: 1850 }, { p25: 1500, p50: 1640, p75: 1800 }, { p25: 1450, p50: 1590, p75: 1740 }, { p25: 1400, p50: 1540, p75: 1690 }],
      f: [{ p25: 1300, p50: 1420, p75: 1550 }, { p25: 1250, p50: 1370, p75: 1500 }, { p25: 1200, p50: 1320, p75: 1450 }, { p25: 1150, p50: 1270, p75: 1400 }, { p25: 1110, p50: 1220, p75: 1340 }, { p25: 1060, p50: 1170, p75: 1290 }],
    },
  },
  // ---- Cardiovascular ----------------------------------------------------------
  {
    key: 'restingHeartRate', label: 'Resting heart rate', unit: 'bpm', decimals: 0, group: 'Cardiovascular', better: 'down',
    source: 'Population wearable data (Quer et al., Nature Medicine 2020, n≈92,000) and clinical normal 60–100 bpm.',
    note: 'Adult resting heart rate is largely age-stable; lower is generally fitter.',
    table: { all: rep({ p25: 57, p50: 63, p75: 70 }) },
  },
  {
    key: 'hrv', label: 'Heart rate variability (SDNN)', unit: 'ms', decimals: 0, group: 'Cardiovascular', better: 'up',
    source: 'Nunan et al. 2010 normative HRV review (SDNN) plus consumer-wearable distributions.',
    note: 'Apple Health reports HRV as SDNN. HRV falls with age and varies widely between people and devices.',
    table: {
      all: [{ p25: 45, p50: 62, p75: 82 }, { p25: 38, p50: 52, p75: 68 }, { p25: 32, p50: 44, p75: 58 }, { p25: 27, p50: 38, p75: 50 }, { p25: 23, p50: 32, p75: 43 }, { p25: 20, p50: 28, p75: 38 }],
    },
  },
  {
    key: 'respiratoryRate', label: 'Respiratory rate', unit: '/min', decimals: 1, group: 'Cardiovascular', better: 'neutral',
    source: 'Clinical normal resting respiratory rate 12–20 breaths/min (adult).',
    table: { all: rep({ p25: 13, p50: 15, p75: 17 }) },
  },
  {
    key: 'bloodOxygen', label: 'Blood oxygen (SpO₂)', unit: '%', decimals: 1, group: 'Cardiovascular', better: 'up',
    source: 'Healthy adult SpO₂ 95–100%; a small decline is typical with age.',
    table: {
      all: [{ p25: 96.5, p50: 98, p75: 99 }, { p25: 96.5, p50: 98, p75: 99 }, { p25: 96.5, p50: 98, p75: 99 }, { p25: 96, p50: 97.5, p75: 99 }, { p25: 95.5, p50: 97, p75: 98.5 }, { p25: 95.5, p50: 97, p75: 98.5 }],
    },
  },
  {
    key: 'cardioRecovery', label: 'Cardio recovery (1-min HRR)', unit: 'bpm', decimals: 0, group: 'Cardiovascular', better: 'up',
    source: 'Heart-rate recovery literature (Cole et al. 1999 and later); >12 bpm at 1 min is reassuring, higher is fitter.',
    table: {
      all: [{ p25: 24, p50: 32, p75: 42 }, { p25: 22, p50: 30, p75: 40 }, { p25: 20, p50: 28, p75: 37 }, { p25: 18, p50: 25, p75: 34 }, { p25: 16, p50: 23, p75: 31 }, { p25: 14, p50: 20, p75: 28 }],
    },
  },
  // ---- Fitness -----------------------------------------------------------------
  {
    key: 'vo2Max', label: 'VO₂ max', unit: 'mL/kg/min', decimals: 1, group: 'Fitness', better: 'up',
    source: 'Cooper Institute / ACSM FRIEND registry cardiorespiratory-fitness norms (sex- and age-specific).',
    table: {
      m: [{ p25: 42, p50: 48, p75: 55 }, { p25: 37, p50: 43, p75: 50 }, { p25: 34, p50: 40, p75: 46 }, { p25: 30, p50: 36, p75: 42 }, { p25: 26, p50: 32, p75: 38 }, { p25: 22, p50: 27, p75: 33 }],
      f: [{ p25: 33, p50: 38, p75: 44 }, { p25: 30, p50: 35, p75: 41 }, { p25: 27, p50: 32, p75: 37 }, { p25: 23, p50: 28, p75: 33 }, { p25: 20, p50: 25, p75: 30 }, { p25: 18, p50: 22, p75: 27 }],
    },
  },
  // ---- Activity & sleep --------------------------------------------------------
  {
    key: 'stepCount', label: 'Steps', unit: '/day', decimals: 0, group: 'Activity & sleep', better: 'up',
    source: 'NHANES accelerometer data and Tudor-Locke step-count research; daily steps decline with age.',
    table: {
      all: [{ p25: 4500, p50: 7000, p75: 10000 }, { p25: 4200, p50: 6500, p75: 9500 }, { p25: 3900, p50: 6000, p75: 8800 }, { p25: 3400, p50: 5300, p75: 7800 }, { p25: 2700, p50: 4300, p75: 6500 }, { p25: 2000, p50: 3200, p75: 5000 }],
    },
  },
  {
    key: 'sleepHours', label: 'Sleep', unit: 'h/night', decimals: 1, group: 'Activity & sleep', better: 'neutral',
    source: 'National Sleep Foundation recommendations (7–9 h adults, 7–8 h age 65+) and CDC average adult sleep.',
    table: {
      all: [{ p25: 6.5, p50: 7.2, p75: 8.0 }, { p25: 6.5, p50: 7.2, p75: 8.0 }, { p25: 6.5, p50: 7.1, p75: 7.9 }, { p25: 6.4, p50: 7.1, p75: 7.9 }, { p25: 6.3, p50: 7.0, p75: 7.8 }, { p25: 6.3, p50: 7.0, p75: 7.8 }],
    },
  },
]

export function refFor(metric: MetricDef, bandIdx: number, sex: Sex): Ref | null {
  if (bandIdx < 0) return null
  const table = metric.table
  const rows = 'all' in table ? table.all : table[sex]
  return rows[bandIdx] || null
}

// Approximate percentile of `value` within the reference band, modelling it as normal
// with mean = p50 and SD from the interquartile range (IQR ≈ 1.349·SD).
function erf(x: number) {
  const s = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}
export function percentile(value: number, ref: Ref): number {
  const sd = Math.max(1e-6, (ref.p75 - ref.p25) / 1.349)
  const z = (value - ref.p50) / sd
  return Math.max(1, Math.min(99, Math.round(50 * (1 + erf(z / Math.SQRT2)))))
}

// Where the user sits relative to the healthy direction of a metric.
export function standing(value: number, ref: Ref, better: MetricDef['better']): { pct: number; tone: 'good' | 'ok' | 'watch'; label: string } {
  const pct = percentile(value, ref)
  if (better === 'up') {
    if (pct >= 50) return { pct, tone: 'good', label: 'Above typical' }
    if (pct >= 25) return { pct, tone: 'ok', label: 'Around typical' }
    return { pct, tone: 'watch', label: 'Below typical' }
  }
  if (better === 'down') {
    if (pct <= 50) return { pct, tone: 'good', label: 'Below typical' }
    if (pct <= 75) return { pct, tone: 'ok', label: 'Around typical' }
    return { pct, tone: 'watch', label: 'Above typical' }
  }
  if (pct >= 25 && pct <= 75) return { pct, tone: 'good', label: 'Typical range' }
  return { pct, tone: 'ok', label: pct < 25 ? 'Below typical' : 'Above typical' }
}
