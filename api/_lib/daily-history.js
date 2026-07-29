import { sql } from './db.js'

// Editing a day's overall stats. Burn figures live directly on health_daily, but
// calories consumed is DERIVED by summing that day's food entries — there is no
// stored column for it. So an edited intake is kept as an explicit override
// (calories_consumed_override) that the dashboard prefers when present, leaving the
// underlying food entries untouched. Clearing the field removes the override and the
// day falls back to the sum of its food again.

const TIME_ZONE = 'America/Los_Angeles'

let schemaReady = null
export function ensureHistorySchema() {
  if (!schemaReady) schemaReady = migrate().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}
async function migrate() {
  const db = sql()
  await db`ALTER TABLE health_daily ADD COLUMN IF NOT EXISTS calories_consumed_override double precision`
}

export async function listDailyHistory(userId, days = 30) {
  await ensureHistorySchema()
  const db = sql()
  const rows = await db`
    WITH bounds AS (
      SELECT ((now() AT TIME ZONE ${TIME_ZONE})::date - (${days}::int - 1)) AS start_date,
             (now() AT TIME ZONE ${TIME_ZONE})::date AS end_date
    ),
    days AS (SELECT generate_series((SELECT start_date FROM bounds), (SELECT end_date FROM bounds), interval '1 day')::date AS date),
    food AS (
      SELECT (occurred_at AT TIME ZONE ${TIME_ZONE})::date AS date,
             sum(calories_kcal)::double precision AS consumed
      FROM food_entries
      WHERE user_id = ${userId}
        AND occurred_at >= ((SELECT start_date FROM bounds)::timestamp AT TIME ZONE ${TIME_ZONE})
      GROUP BY 1
    )
    SELECT d.date,
      h.total_expenditure_kcal, h.resting_energy_kcal, h.active_energy_kcal,
      h.calories_consumed_override, f.consumed AS consumed_logged
    FROM days d
    LEFT JOIN health_daily h ON h.user_id = ${userId} AND h.date = d.date
    LEFT JOIN food f ON f.date = d.date
    ORDER BY d.date DESC
  `
  return rows.map((row) => ({
    date: dateKey(row.date),
    totalExpenditure: num(row.total_expenditure_kcal),
    restingEnergy: num(row.resting_energy_kcal),
    activeEnergy: num(row.active_energy_kcal),
    consumed: num(row.calories_consumed_override) ?? num(row.consumed_logged),
    consumedLogged: num(row.consumed_logged),
    consumedOverridden: num(row.calories_consumed_override) != null,
  }))
}

// Saves one day's overall stats. Fields absent from `values` are left alone; fields
// explicitly set to null are cleared (which, for consumed, restores the food-derived
// figure).
export async function saveDailyHistory(userId, date, values) {
  await ensureHistorySchema()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('A valid date (YYYY-MM-DD) is required.')
  const db = sql()
  const has = (key) => Object.prototype.hasOwnProperty.call(values || {}, key)
  const total = has('totalExpenditure') ? num(values.totalExpenditure) : undefined
  const resting = has('restingEnergy') ? num(values.restingEnergy) : undefined
  const active = has('activeEnergy') ? num(values.activeEnergy) : undefined
  const consumed = has('consumed') ? num(values.consumed) : undefined

  // A manual edit also clears partial_day. Apple Health flags a day "partial" while it
  // is still in progress, and the deficit/surplus chart suppresses partial days so a
  // half-finished today does not draw a huge fake deficit. But the flag is only ever
  // cleared by a later sync — so a day whose last sync landed mid-afternoon stays
  // partial forever, and correcting its numbers by hand moved every figure EXCEPT the
  // one chart the user was looking at. Opening the editor and saving a day is the user
  // asserting those are its final numbers, so the day is no longer in progress.
  const rows = await db`
    INSERT INTO health_daily (user_id, date, total_expenditure_kcal, resting_energy_kcal, active_energy_kcal, calories_consumed_override, partial_day, source, updated_at)
    VALUES (${userId}, ${date}::date,
      ${total === undefined ? null : total}, ${resting === undefined ? null : resting},
      ${active === undefined ? null : active}, ${consumed === undefined ? null : consumed},
      false, 'Manual edit', now())
    ON CONFLICT (user_id, date) DO UPDATE SET
      total_expenditure_kcal = CASE WHEN ${total !== undefined} THEN ${total ?? null} ELSE health_daily.total_expenditure_kcal END,
      resting_energy_kcal    = CASE WHEN ${resting !== undefined} THEN ${resting ?? null} ELSE health_daily.resting_energy_kcal END,
      active_energy_kcal     = CASE WHEN ${active !== undefined} THEN ${active ?? null} ELSE health_daily.active_energy_kcal END,
      calories_consumed_override = CASE WHEN ${consumed !== undefined} THEN ${consumed ?? null} ELSE health_daily.calories_consumed_override END,
      partial_day = false,
      updated_at = now()
    RETURNING date, total_expenditure_kcal, resting_energy_kcal, active_energy_kcal, calories_consumed_override, partial_day
  `
  const row = rows[0] || {}
  return {
    date: dateKey(row.date) || date,
    totalExpenditure: num(row.total_expenditure_kcal),
    restingEnergy: num(row.resting_energy_kcal),
    activeEnergy: num(row.active_energy_kcal),
    consumedOverride: num(row.calories_consumed_override),
    partialDay: Boolean(row.partial_day),
  }
}

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function dateKey(value) {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  return new Date(value).toISOString().slice(0, 10)
}
