import { sql } from './db.js'
import { getUserGoals } from './goals.js'

const TIME_ZONE = 'America/Los_Angeles'

export async function getNeonDashboard(userId) {
  if (!userId) throw new Error('Authenticated user ID is required')
  const db = sql()
  const today = dateKey(new Date())
  const [healthRows, foodRows, supplementRows, recipeRows, userGoals] = await Promise.all([
    db`SELECT * FROM health_daily WHERE user_id = ${userId} AND date >= (${today}::date - interval '30 days') ORDER BY date ASC`,
    db`SELECT * FROM food_entries WHERE user_id = ${userId} AND occurred_at >= (${today}::date - interval '30 days') ORDER BY occurred_at ASC`,
    db`SELECT * FROM supplements WHERE user_id = ${userId} AND occurred_at >= (${today}::date - interval '30 days') ORDER BY occurred_at ASC`,
    db`SELECT id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, notes, source, updated_at FROM recipes WHERE user_id = ${userId} ORDER BY name ASC`,
    getUserGoals(userId),
  ])

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
    const totals = sumFoods(foodsByDate.get(key) || [])
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
      fiber: totals.fiber || null,
      sleepHours: number(health?.sleep_hours),
      restingHeartRate: number(health?.resting_heart_rate_bpm),
      hrv: number(health?.hrv_ms),
      respiratoryRate: number(health?.respiratory_rate),
      bloodOxygen: number(health?.blood_oxygen_percent),
      walkingHeartRateAverage: number(health?.walking_heart_rate_avg_bpm),
      stepCount: number(health?.step_count),
      distanceMiles: number(health?.walking_running_distance_mi),
      cyclingDistanceMiles: number(health?.cycling_distance_mi),
      swimmingDistanceYards: number(health?.swimming_distance_yd),
      swimmingStrokes: number(health?.swimming_strokes),
      wristTemperature: number(health?.wrist_temperature),
      cardioRecovery: number(health?.cardio_recovery_bpm),
      standMinutes: number(health?.stand_minutes),
      flightsClimbed: number(health?.flights_climbed),
      exerciseMinutes: number(health?.exercise_minutes),
      vo2Max: number(health?.vo2_max),
      workoutCount: health ? Number(Boolean(number(health.exercise_minutes) || number(health.swimming_distance_yd) || number(health.cycling_distance_mi))) : 0,
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
    energyBalance: todayHealth?.partial_day || !nutrition.calories || !totalExpenditure ? null : nutrition.calories - totalExpenditure,
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
    bloodOxygen: number(todayHealth?.blood_oxygen_percent),
    walkingHeartRateAverage: number(todayHealth?.walking_heart_rate_avg_bpm),
    sleepCoreHours: null,
    sleepDeepHours: null,
    sleepRemHours: null,
    sleepAwakeHours: null,
    stepCount: number(todayHealth?.step_count),
    distanceMiles: number(todayHealth?.walking_running_distance_mi),
    cyclingDistanceMiles: number(todayHealth?.cycling_distance_mi),
    swimmingDistanceYards: number(todayHealth?.swimming_distance_yd),
    swimmingStrokes: number(todayHealth?.swimming_strokes),
    wristTemperature: number(todayHealth?.wrist_temperature),
    cardioRecovery: number(todayHealth?.cardio_recovery_bpm),
    standMinutes: number(todayHealth?.stand_minutes),
    flightsClimbed: number(todayHealth?.flights_climbed),
    exerciseMinutes: number(todayHealth?.exercise_minutes),
    vo2Max: number(todayHealth?.vo2_max),
  }

  return {
    spreadsheet: { id: 'neon', name: 'Fuel Database', webViewLink: null, modifiedTime: todayHealth?.updated_at || null },
    generatedAt: new Date().toISOString(),
    today: {
      summary,
      foodEntries: todayFoods.map(normalizeFood),
      workouts: healthWorkouts(todayHealth),
      supplements: todaySupplements.map(normalizeSupplement),
    },
    recipes: recipeRows.map(normalizeRecipe),
    goals: {
      calories: range(userGoals.calories),
      protein: range(userGoals.protein),
      carbs: range(userGoals.carbs),
      fat: range(userGoals.fat),
      fiber: range(userGoals.fiber),
      move: range(userGoals.move),
      exercise: range(userGoals.exercise),
      stand: range(userGoals.stand),
      steps: range(userGoals.steps),
      sleepHours: range(userGoals.sleepHours),
    },
    goalProfile: userGoals.profile,
    trends,
    coverage: {
      startDate: healthRows.length ? databaseDateKey(healthRows[0].date) : null,
      endDate: healthRows.length ? databaseDateKey(healthRows.at(-1).date) : null,
      days: healthRows.length,
      healthDays: healthRows.length,
      foodEntries: foodRows.length,
      workouts: healthRows.filter((row) => number(row.exercise_minutes) || number(row.swimming_distance_yd) || number(row.cycling_distance_mi)).length,
      recoveryDays: healthRows.filter((row) => number(row.sleep_hours) || number(row.resting_heart_rate_bpm)).length,
    },
    sheetStatus: [
      { title: 'Health', rows: healthRows.length },
      { title: 'Food', rows: foodRows.length },
      { title: 'Supplements', rows: supplementRows.length },
      { title: 'Recipes', rows: recipeRows.length },
    ],
    storage: 'Neon Postgres',
  }
}

function range(target) { return { minimum: null, target, maximum: null } }

function normalizeRecipe(row) {
  const name = row.name || 'Untitled recipe'
  const lower = name.toLowerCase()
  const category = lower.includes('creami') || lower.includes('ninja') ? 'Ninja Creami' : lower.includes('oat') ? 'Breakfast and oats' : lower.includes('smoothie') || lower.includes('shake') ? 'Drinks and smoothies' : lower.includes('dessert') || lower.includes('cookie') || lower.includes('ice cream') ? 'Desserts' : 'Other recipes'
  return {
    id: row.id,
    name,
    category,
    serving: row.serving || '',
    ingredients: splitList(row.ingredients),
    instructions: splitInstructions(row.notes),
    nutrition: {
      calories: number(row.calories_kcal),
      protein: number(row.protein_g),
      carbs: number(row.carbs_g),
      fat: number(row.fat_g),
      fiber: number(row.fiber_g),
    },
    source: row.source || '',
    updatedAt: row.updated_at || null,
  }
}

function splitList(value) {
  if (!value) return []
  return String(value).split(/\s*;\s*|\n+/).map(item => item.trim()).filter(Boolean)
}
function splitInstructions(value) {
  if (!value || /^saved recipe\.?$/i.test(String(value).trim())) return []
  return String(value).split(/\n+|(?<=\.)\s+(?=[A-Z0-9])/).map(item => item.trim()).filter(Boolean)
}

function healthWorkouts(health) {
  if (!health) return []
  const entries = []
  const swimDistance = number(health.swimming_distance_yd)
  const swimStrokes = number(health.swimming_strokes)
  if (swimDistance || swimStrokes) entries.push({
    time: '', activity: 'Swimming', durationMinutes: null, activeCalories: null, totalCalories: null,
    distanceMiles: null, averagePace: '', averageHeartRate: null, averageCadence: null, effort: '', location: '',
    swimmingDistanceYards: swimDistance, stepCount: null, strokeCount: swimStrokes, dataQuality: 'Apple Health',
    notes: 'Daily swimming totals synchronized from Apple Health.', source: 'Apple Shortcuts',
  })
  const cyclingDistance = number(health.cycling_distance_mi)
  if (cyclingDistance) entries.push({
    time: '', activity: 'Cycling', durationMinutes: null, activeCalories: null, totalCalories: null,
    distanceMiles: cyclingDistance, averagePace: '', averageHeartRate: null, averageCadence: null, effort: '', location: '',
    swimmingDistanceYards: null, stepCount: null, strokeCount: null, dataQuality: 'Apple Health',
    notes: 'Daily cycling distance synchronized from Apple Health.', source: 'Apple Shortcuts',
  })
  if (number(health.walking_running_distance_mi) || number(health.step_count)) entries.push({
    time: '', activity: 'Walking and running', durationMinutes: null, activeCalories: null, totalCalories: null,
    distanceMiles: number(health.walking_running_distance_mi), averagePace: '', averageHeartRate: null, averageCadence: null,
    effort: '', location: '', swimmingDistanceYards: null, stepCount: number(health.step_count), strokeCount: null,
    dataQuality: 'Apple Health', notes: 'Daily walking and running totals.', source: 'Apple Shortcuts',
  })
  return entries
}

function normalizeFood(row) {
  return {
    time: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE }).format(new Date(row.occurred_at)),
    meal: row.meal || '', food: row.description || '', portion: row.portion || '',
    calories: number(row.calories_kcal), protein: number(row.protein_g), carbs: number(row.carbs_g),
    fat: number(row.fat_g), fiber: number(row.fiber_g), confidence: row.confidence || '', notes: row.notes || '', source: row.source || '',
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
  return [parsed.getUTCFullYear(), String(parsed.getUTCMonth() + 1).padStart(2, '0'), String(parsed.getUTCDate()).padStart(2, '0')].join('-')
}
function dateKey(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date) }
function number(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
