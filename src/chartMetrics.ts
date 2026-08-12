// Catalog of every daily metric Fuel captures that can be plotted over time.
// Keys match the fields on a dashboard trend point.
export type ChartMetric = { key: string; label: string; unit: string; decimals: number; group: string }

export const CHART_GROUPS = ['Energy', 'Nutrition', 'Activity', 'Vitals & recovery'] as const

export const CHART_METRICS: ChartMetric[] = [
  // Energy
  { key: 'energyBalance', label: 'Surplus / deficit', unit: 'kcal', decimals: 0, group: 'Energy' },
  { key: 'caloriesConsumed', label: 'Calories eaten', unit: 'kcal', decimals: 0, group: 'Energy' },
  { key: 'totalExpenditure', label: 'Total burned', unit: 'kcal', decimals: 0, group: 'Energy' },
  { key: 'activeEnergy', label: 'Active energy', unit: 'kcal', decimals: 0, group: 'Energy' },
  { key: 'restingEnergy', label: 'Resting energy', unit: 'kcal', decimals: 0, group: 'Energy' },
  // Nutrition
  { key: 'protein', label: 'Protein', unit: 'g', decimals: 0, group: 'Nutrition' },
  { key: 'carbs', label: 'Carbohydrates', unit: 'g', decimals: 0, group: 'Nutrition' },
  { key: 'fat', label: 'Fat', unit: 'g', decimals: 0, group: 'Nutrition' },
  { key: 'fiber', label: 'Fiber', unit: 'g', decimals: 0, group: 'Nutrition' },
  { key: 'sugars', label: 'Sugars', unit: 'g', decimals: 0, group: 'Nutrition' },
  { key: 'addedSugars', label: 'Added sugars', unit: 'g', decimals: 0, group: 'Nutrition' },
  { key: 'sodium', label: 'Sodium', unit: 'mg', decimals: 0, group: 'Nutrition' },
  { key: 'caffeine', label: 'Caffeine', unit: 'mg', decimals: 0, group: 'Nutrition' },
  // Activity
  { key: 'stepCount', label: 'Steps', unit: 'steps', decimals: 0, group: 'Activity' },
  { key: 'exerciseMinutes', label: 'Exercise minutes', unit: 'min', decimals: 0, group: 'Activity' },
  { key: 'standMinutes', label: 'Stand minutes', unit: 'min', decimals: 0, group: 'Activity' },
  { key: 'flightsClimbed', label: 'Flights climbed', unit: 'flights', decimals: 0, group: 'Activity' },
  { key: 'distanceMiles', label: 'Walk + run distance', unit: 'mi', decimals: 2, group: 'Activity' },
  { key: 'cyclingDistanceMiles', label: 'Cycling distance', unit: 'mi', decimals: 2, group: 'Activity' },
  { key: 'swimmingDistanceYards', label: 'Swimming distance', unit: 'yd', decimals: 0, group: 'Activity' },
  { key: 'runningStrideLength', label: 'Running stride length', unit: 'm', decimals: 2, group: 'Activity' },
  { key: 'workoutCount', label: 'Workout days', unit: '', decimals: 0, group: 'Activity' },
  // Vitals & recovery
  { key: 'restingHeartRate', label: 'Resting heart rate', unit: 'bpm', decimals: 0, group: 'Vitals & recovery' },
  { key: 'hrv', label: 'HRV (SDNN)', unit: 'ms', decimals: 0, group: 'Vitals & recovery' },
  { key: 'walkingHeartRateAverage', label: 'Walking heart rate', unit: 'bpm', decimals: 0, group: 'Vitals & recovery' },
  { key: 'respiratoryRate', label: 'Respiratory rate', unit: '/min', decimals: 1, group: 'Vitals & recovery' },
  { key: 'bloodOxygen', label: 'Blood oxygen', unit: '%', decimals: 1, group: 'Vitals & recovery' },
  { key: 'cardioRecovery', label: 'Cardio recovery', unit: 'bpm', decimals: 0, group: 'Vitals & recovery' },
  { key: 'vo2Max', label: 'VO₂ max', unit: 'mL/kg/min', decimals: 1, group: 'Vitals & recovery' },
  { key: 'sleepHours', label: 'Sleep', unit: 'h', decimals: 1, group: 'Vitals & recovery' },
]

export const METRIC_BY_KEY = new Map(CHART_METRICS.map((m) => [m.key, m]))

// Distinct, colour-blind-friendly-ish palette. Series colours are assigned by
// selection order so a given series keeps its colour while others are toggled.
export const SERIES_COLORS = ['#111111', '#e5734f', '#2f8f6b', '#3f76b5', '#b7791f', '#8b5cf6', '#d92d20', '#0e8ea3']
export const MAX_SERIES = SERIES_COLORS.length
