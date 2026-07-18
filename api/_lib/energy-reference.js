import { sql } from './db.js'

const TIME_ZONE = 'America/Los_Angeles'

export async function getEnergyReference(userId) {
  const db = sql()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
  const rows = await db`
    WITH daily_food AS (
      SELECT
        (occurred_at AT TIME ZONE ${TIME_ZONE})::date AS date,
        sum(calories_kcal)::double precision AS calories_consumed
      FROM food_entries
      WHERE user_id = ${userId} AND calories_kcal IS NOT NULL
      GROUP BY 1
    ), completed_burn AS (
      SELECT date, total_expenditure_kcal, resting_energy_kcal, active_energy_kcal
      FROM health_daily
      WHERE user_id = ${userId}
        AND date < ${today}::date
        AND total_expenditure_kcal IS NOT NULL
        AND total_expenditure_kcal > 900
    )
    SELECT
      avg(b.total_expenditure_kcal)::double precision AS average_expenditure,
      avg(b.resting_energy_kcal)::double precision AS average_resting,
      avg(b.active_energy_kcal)::double precision AS average_active,
      (avg(f.calories_consumed - b.total_expenditure_kcal) FILTER (WHERE f.calories_consumed IS NOT NULL))::double precision AS average_balance,
      count(*)::int AS expenditure_days,
      count(f.calories_consumed)::int AS balance_days
    FROM completed_burn b
    LEFT JOIN daily_food f USING (date)
  `
  const row = rows[0] || {}
  return {
    averageExpenditure: finite(row.average_expenditure),
    averageRestingEnergy: finite(row.average_resting),
    averageActiveEnergy: finite(row.average_active),
    averageEnergyBalance: finite(row.average_balance),
    expenditureDays: Number(row.expenditure_days || 0),
    balanceDays: Number(row.balance_days || 0),
  }
}

export function calculateCalorieTarget(averageExpenditure, calorieBalancePercent, fallback = 2000) {
  const baseline = finite(averageExpenditure) ?? fallback
  const percentage = clamp(finite(calorieBalancePercent) ?? 0, -50, 50)
  return Math.round(baseline * (1 + percentage / 100))
}

function finite(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)) }
