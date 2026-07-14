import { sql } from './db.js'

const TIME_ZONE = 'America/Los_Angeles'
const DEFAULTS = {
  calories: 1950,
  protein: 112,
  carbs: 300,
  fat: 60,
  fiber: 30,
  move: 1000,
  exercise: 80,
  stand: 120,
  steps: 10000,
  sleepHours: 8,
}

export async function ensureGoalsTable() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS user_goals (
      user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      calories_kcal double precision,
      protein_g double precision,
      carbs_g double precision,
      fat_g double precision,
      fiber_g double precision,
      move_kcal double precision,
      exercise_minutes double precision,
      stand_minutes double precision,
      steps double precision,
      sleep_hours double precision,
      height_cm double precision,
      weight_kg double precision,
      age_years integer,
      objective text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
}

export async function getUserGoals(userId) {
  await ensureGoalsTable()
  const db = sql()
  const rows = await db`
    SELECT * FROM user_goals WHERE user_id = ${userId} LIMIT 1
  `
  return rows.length ? normalizeRow(rows[0]) : { ...DEFAULTS, profile: { heightIn: null, weightLb: null, age: null, objective: 'maintenance' } }
}

export async function saveUserGoals(userId, input) {
  await ensureGoalsTable()
  const current = await getUserGoals(userId)
  const goals = sanitizeGoals(input.goals || input, current)
  const profileInput = input.profile || input
  const heightIn = finite(profileInput.heightIn)
  const weightLb = finite(profileInput.weightLb)
  const age = integer(profileInput.age)
  const objective = normalizeObjective(profileInput.objective || current.profile?.objective)
  const heightCm = heightIn == null ? current.profile?.heightIn == null ? null : current.profile.heightIn * 2.54 : heightIn * 2.54
  const weightKg = weightLb == null ? current.profile?.weightLb == null ? null : current.profile.weightLb / 2.2046226218 : weightLb / 2.2046226218
  const db = sql()
  const rows = await db`
    INSERT INTO user_goals (
      user_id, calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
      move_kcal, exercise_minutes, stand_minutes, steps, sleep_hours,
      height_cm, weight_kg, age_years, objective, updated_at
    ) VALUES (
      ${userId}, ${goals.calories}, ${goals.protein}, ${goals.carbs}, ${goals.fat}, ${goals.fiber},
      ${goals.move}, ${goals.exercise}, ${goals.stand}, ${goals.steps}, ${goals.sleepHours},
      ${heightCm}, ${weightKg}, ${age}, ${objective}, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      calories_kcal = EXCLUDED.calories_kcal,
      protein_g = EXCLUDED.protein_g,
      carbs_g = EXCLUDED.carbs_g,
      fat_g = EXCLUDED.fat_g,
      fiber_g = EXCLUDED.fiber_g,
      move_kcal = EXCLUDED.move_kcal,
      exercise_minutes = EXCLUDED.exercise_minutes,
      stand_minutes = EXCLUDED.stand_minutes,
      steps = EXCLUDED.steps,
      sleep_hours = EXCLUDED.sleep_hours,
      height_cm = COALESCE(EXCLUDED.height_cm, user_goals.height_cm),
      weight_kg = COALESCE(EXCLUDED.weight_kg, user_goals.weight_kg),
      age_years = COALESCE(EXCLUDED.age_years, user_goals.age_years),
      objective = EXCLUDED.objective,
      updated_at = now()
    RETURNING *
  `
  return normalizeRow(rows[0])
}

export async function automaticallySetGoals(userId, input) {
  const heightIn = finite(input.heightIn)
  const weightLb = finite(input.weightLb)
  const age = integer(input.age)
  const objective = normalizeObjective(input.objective)
  if (!(heightIn > 36 && heightIn < 96)) throw new Error('Enter a valid height in inches.')
  if (!(weightLb > 60 && weightLb < 700)) throw new Error('Enter a valid weight in pounds.')
  if (!(age >= 16 && age <= 100)) throw new Error('Enter a valid age.')

  const db = sql()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
  const history = await db`
    SELECT
      avg(total_expenditure_kcal) AS avg_expenditure,
      avg(active_energy_kcal) AS avg_active,
      avg(exercise_minutes) AS avg_exercise,
      avg(stand_minutes) AS avg_stand,
      avg(step_count) AS avg_steps,
      count(*)::int AS days
    FROM (
      SELECT total_expenditure_kcal, active_energy_kcal, exercise_minutes, stand_minutes, step_count
      FROM health_daily
      WHERE user_id = ${userId}
        AND date < ${today}::date
        AND total_expenditure_kcal IS NOT NULL
        AND total_expenditure_kcal > 900
      ORDER BY date DESC
      LIMIT 7
    ) recent
  `
  const h = history[0] || {}
  const weightKg = weightLb / 2.2046226218
  const historyBurn = finite(h.avg_expenditure)
  const fallbackBurn = weightKg * 33
  const maintenance = clamp(historyBurn || fallbackBurn, 1400, 5000)
  const calories = objective === 'deficit'
    ? maintenance - clamp(maintenance * 0.15, 250, 500)
    : objective === 'gain'
      ? maintenance + 200
      : maintenance
  const proteinPerKg = objective === 'maintenance' ? 1.6 : 1.8
  const protein = weightKg * proteinPerKg
  const fat = Math.max(weightKg * 0.8, calories * 0.22 / 9)
  const carbs = Math.max(weightKg * 2.5, (calories - protein * 4 - fat * 9) / 4)
  const goals = {
    calories: roundTo(calories, 25),
    protein: roundTo(protein, 5),
    carbs: roundTo(carbs, 5),
    fat: roundTo(fat, 5),
    fiber: roundTo(Math.max(25, calories / 1000 * 14), 1),
    move: roundTo(clamp(finite(h.avg_active) || 500, 300, 1200), 50),
    exercise: roundTo(clamp(finite(h.avg_exercise) || 30, 30, 90), 5),
    stand: roundTo(clamp(finite(h.avg_stand) || 120, 60, 180), 15),
    steps: roundTo(clamp(finite(h.avg_steps) || 8000, 5000, 20000), 500),
    sleepHours: 8,
  }
  const saved = await saveUserGoals(userId, { goals, profile: { heightIn, weightLb, age, objective } })
  return {
    ...saved,
    autoSet: {
      objective,
      averageExpenditure: roundTo(maintenance, 1),
      historyDays: Number(h.days || 0),
      usedFallback: !historyBurn,
      note: historyBurn
        ? `Calorie target is based on ${Number(h.days || 0)} completed days of energy expenditure, excluding today.`
        : 'Not enough completed expenditure history was available, so a body-weight-based starting estimate was used.',
    },
  }
}

function normalizeRow(row) {
  return {
    calories: finite(row.calories_kcal) ?? DEFAULTS.calories,
    protein: finite(row.protein_g) ?? DEFAULTS.protein,
    carbs: finite(row.carbs_g) ?? DEFAULTS.carbs,
    fat: finite(row.fat_g) ?? DEFAULTS.fat,
    fiber: finite(row.fiber_g) ?? DEFAULTS.fiber,
    move: finite(row.move_kcal) ?? DEFAULTS.move,
    exercise: finite(row.exercise_minutes) ?? DEFAULTS.exercise,
    stand: finite(row.stand_minutes) ?? DEFAULTS.stand,
    steps: finite(row.steps) ?? DEFAULTS.steps,
    sleepHours: finite(row.sleep_hours) ?? DEFAULTS.sleepHours,
    profile: {
      heightIn: finite(row.height_cm) == null ? null : finite(row.height_cm) / 2.54,
      weightLb: finite(row.weight_kg) == null ? null : finite(row.weight_kg) * 2.2046226218,
      age: integer(row.age_years),
      objective: normalizeObjective(row.objective),
    },
    updatedAt: row.updated_at || null,
  }
}

function sanitizeGoals(input, fallback) {
  const ranges = {
    calories: [1000, 6000], protein: [20, 400], carbs: [20, 1000], fat: [15, 300], fiber: [5, 100],
    move: [100, 2500], exercise: [5, 240], stand: [15, 360], steps: [1000, 50000], sleepHours: [4, 12],
  }
  const result = {}
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = finite(input[key])
    result[key] = value == null ? fallback[key] : clamp(value, min, max)
  }
  return result
}

function normalizeObjective(value) {
  const normalized = String(value || 'maintenance').toLowerCase()
  if (normalized === 'deficit') return 'deficit'
  if (normalized === 'gain' || normalized === 'muscle' || normalized === 'gain muscle') return 'gain'
  return 'maintenance'
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function integer(value) {
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function roundTo(value, step) { return Math.round(value / step) * step }
