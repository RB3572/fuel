import { sql } from './db.js'

const TIME_ZONE = 'America/Los_Angeles'

export async function getNeonDashboard(userId) {
  if (!userId) throw new Error('Authenticated user ID is required')

  const db = sql()
  const today = dateKey(new Date())
  const [healthRows, foodRows, supplementRows] = await Promise.all([
    db`
      SELECT * FROM health_daily
      WHERE user_id = ${userId} AND date >= (${today}::date - interval '30 days')
      ORDER BY date ASC
    `,
    db`
      SELECT * FROM food_entries
      WHERE user_id = ${userId} AND occurred_at >= (${today}::date - interval '30 days')
      ORDER BY occurred_at ASC
    `,
    db`
      SELECT * FROM supplements
      WHERE user_id = ${userId} AND occurred_at >= (${today}::date - interval '30 days')
      ORDER BY occurred_at ASC
    `,
  ])

  // Neon may return a PostgreSQL DATE as either a string or a JavaScript Date.
  // String(row.date).slice(0, 10) is incorrect for Date objects (it produces "Sun Jul 12").
  const healthByDate = new Map(healthRows.map((row) => [databaseDateKey(row.date), row]))
  const foodsByDate = groupByDate(foodRows, 'occurred_at')
  const supplementsByDate = groupByDate(supplementRows, 'occurred_at')
  const todayHealth = healthByDate.get(today) || null
  const todayFoods = foodsByDate.get(today) || []
  const todaySupplements = supplementsByDate.get(today) || []
  const nutrition = sumFoods(todayFoods)

  const trends = []
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    const key = dateKey(date)
    const health = healthByDate.get(key) || null
    const foods = foodsByDate.get(key) || []
    const totals = sumFoods(foods)
    const expenditure = number(health?.total_expenditure_kcal)
    const calories = totals.calories || null
    trends.push({
      date: key,
      partialDay: Boolean(health?.partial_day),
      caloriesConsumed: calories,
      restingEnergy: number(health?.resting_energy_kcal),
      activeEnergy: number(health?.active_energy_kcal),
      totalExpenditure: expenditure,
      energyBalance: health?.partial_day || calories == null || expenditure == null ? null : calories - expenditure,
      protein: totals.protein || null,
      carbs: totals.carbs || null,
      fat: totals.fat || null,
      sleepHours: number(health?.sleep_hours),
      restingHeartRate: number(health?.resting_heart_rate_bpm),
      hrv: number(health?.hrv_ms),
      stepCount: number(health?.step_count),
      distanceMiles: number(health?.walking_running_distance_mi),
      swimmingDistanceYards: number(health?.swimming_distance_yd),
      exerciseMinutes: number(health?.exercise_minutes),
      vo2Max: number(health?.vo2_max),
      workoutCount: health ? Number(Boolean(number(health.exercise_minutes) || number(health.swimming_distance_yd))) : 0,
      fuelScore: null,
    })
  }

  const totalExpenditure = number(todayHealth?.total_expenditure_kcal)
  const summary = {
    date: today,
    partialDay: todayHealth ? Boolean(todayHealth.partial_day) : true,
    caloriesConsumed: nutrition.calories || null,
    restingEnergy: number(todayHealth?.resting_energy_kcal),
    activeEnergy: number(todayHealth?.active_energy_kcal),
    totalExpenditure,
    energyBalance: todayHealth?.partial_day || !nutrition.calories || !totalExpenditure
      ? null
      : nutrition.calories - totalExpenditure,
    protein: nutrition.protein || null,
    carbs: nutrition.carbs || null,
    fat: nutrition.fat || null,
    fiber: nutrition.fiber || null,
    fuelScore: null,
    sleepHours: number(todayHealth?.sleep_hours),
    sleepQuality: null,
    recoveryScore: null,
    restingHeartRate: number(todayHealth?.resting_heart_rate_bpm),
    hrv: number(todayHealth?.hrv_ms),
    respiratoryRate: number(todayHealth?.respiratory_rate),
    sleepCoreHours: null,
    sleepDeepHours: null,
    sleepRemHours: null,
    sleepAwakeHours: null,
    stepCount: number(todayHealth?.step_count),
    distanceMiles: number(todayHealth?.walking_running_distance_mi),
    swimmingDistanceYards: number(todayHealth?.swimming_distance_yd),
    exerciseMinutes: number(todayHealth?.exercise_minutes),
    vo2Max: number(todayHealth?.vo2_max),
  }

  return {
    spreadsheet: {
      id: 'neon',
      name: 'Fuel Database',
      webViewLink: null,
      modifiedTime: todayHealth?.updated_at || null,
    },
    generatedAt: new Date().toISOString(),
    today: {
      summary,
      foodEntries: todayFoods.map(normalizeFood),
      workouts: healthWorkouts(todayHealth),
      supplements: todaySupplements.map(normalizeSupplement),
    },
    goals: {
      protein: { minimum: 100, target: 112, maximum: null },
      calorieDeficit: { minimum: 200, target: 350, maximum: 500 },
      fat: { minimum: 48, target: 60, maximum: 75 },
      sleepHours: { minimum: 7, target: 8, maximum: 9 },
      fuelScore: { minimum: 70, target: 85, maximum: 100 },
      strengthSessions: { minimum: 1, target: 2, maximum: 3 },
    },
    trends,
    coverage: {
      startDate: healthRows.length ? databaseDateKey(healthRows[0].date) : null,
      endDate: healthRows.length ? databaseDateKey(healthRows.at(-1).date) : null,
      days: healthRows.length,
      healthDays: healthRows.length,
      foodEntries: foodRows.length,
      workouts: healthRows.filter((row) => number(row.exercise_minutes) || number(row.swimming_distance_yd)).length,
      recoveryDays: healthRows.filter((row) => number(row.sleep_hours) || number(row.resting_heart_rate_bpm)).length,
    },
    sheetStatus: [
      { title: 'Health', rows: healthRows.length },
      { title: 'Food', rows: foodRows.length },
      { title: 'Supplements', rows: supplementRows.length },
    ],
    storage: 'Neon Postgres',
  }
}

function healthWorkouts(health) {
  if (!health) return []
  const entries = []
  const swim = number(health.swimming_distance_yd)
  if (swim) {
    entries.push({
      time: '', activity: 'Swimming', durationMinutes: number(health.exercise_minutes),
      activeCalories: number(health.active_energy_kcal), totalCalories: null,
      distanceMiles: null, averagePace: '', averageHeartRate: null,
      averageCadence: null, effort: '', location: '', swimmingDistanceYards: swim,
      stepCount: null, strokeCount: null, dataQuality: 'Apple Health',
      notes: 'Synchronized from Apple Health through Shortcuts.', source: 'Apple Shortcuts',
    })
  }
  if (number(health.walking_running_distance_mi) || number(health.step_count)) {
    entries.push({
      time: '', activity: 'Daily movement', durationMinutes: number(health.exercise_minutes),
      activeCalories: number(health.active_energy_kcal), totalCalories: null,
      distanceMiles: number(health.walking_running_distance_mi), averagePace: '', averageHeartRate: null,
      averageCadence: null, effort: '', location: '', swimmingDistanceYards: null,
      stepCount: number(health.step_count), strokeCount: null, dataQuality: 'Apple Health',
      notes: 'Daily walking and running totals.', source: 'Apple Shortcuts',
    })
  }
  return entries
}

function normalizeFood(row) {
  return {
    time: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE }).format(new Date(row.occurred_at)),
    meal: row.meal || '', food: row.description || '', portion: row.portion || '',
    calories: number(row.calories_kcal), protein: number(row.protein_g), carbs: number(row.carbs_g),
    fat: number(row.fat_g), fiber: number(row.fiber_g), confidence: row.confidence || '',
    notes: row.notes || '', source: row.source || '',
  }
}

function normalizeSupplement(row) {
  return {
    time: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE }).format(new Date(row.occurred_at)),
    name: row.name || '', dose: row.dose || '', calories: number(row.calories_kcal), notes: row.notes || '',
  }
}

function sumFoods(rows) {
  return rows.reduce((totals, row) => ({
    calories: totals.calories + (number(row.calories_kcal) || 0),
    protein: totals.protein + (number(row.protein_g) || 0),
    carbs: totals.carbs + (number(row.carbs_g) || 0),
    fat: totals.fat + (number(row.fat_g) || 0),
    fiber: totals.fiber + (number(row.fiber_g) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
}

function groupByDate(rows, field) {
  const map = new Map()
  for (const row of rows) {
    const key = dateKey(new Date(row[field]))
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return map
}

function databaseDateKey(value) {
  if (value == null) return ''
  if (typeof value === 'string') {
    const direct = value.match(/^(\d{4}-\d{2}-\d{2})/)
    if (direct) return direct[1]
  }
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  // PostgreSQL DATE values have no time zone. Using UTC preserves the literal date
  // when Neon materializes one as midnight UTC.
  return [parsed.getUTCFullYear(), String(parsed.getUTCMonth() + 1).padStart(2, '0'), String(parsed.getUTCDate()).padStart(2, '0')].join('-')
}

function dateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date)
}

function number(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
