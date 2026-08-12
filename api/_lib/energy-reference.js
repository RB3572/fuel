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
      -- A personal resting-calories floor (Preferences > Goals) bumps an under-reported
      -- day's resting energy up to that floor, and carries the same delta into total
      -- expenditure (total is otherwise derived as active + resting — see
      -- health-sync.js normalizeDailyTotal) so the deficit/surplus this feeds stays
      -- consistent rather than only fixing the resting figure cosmetically. A scalar
      -- subquery rather than a join to user_goals: a user with no goals row yet must
      -- still get every other day here, not zero rows from an empty join.
      SELECT
        h.date,
        h.active_energy_kcal,
        h.calories_consumed_override,
        h.resting_energy_kcal
          + GREATEST(0, COALESCE((SELECT resting_calories_floor FROM user_goals WHERE user_id = ${userId}), 0) - COALESCE(h.resting_energy_kcal, 0)) AS resting_energy_kcal,
        h.total_expenditure_kcal
          + GREATEST(0, COALESCE((SELECT resting_calories_floor FROM user_goals WHERE user_id = ${userId}), 0) - COALESCE(h.resting_energy_kcal, 0)) AS total_expenditure_kcal
      FROM health_daily h
      WHERE h.user_id = ${userId}
        AND h.date < ${today}::date
        AND h.total_expenditure_kcal IS NOT NULL
        AND h.total_expenditure_kcal > 900
    )
    SELECT
      avg(b.total_expenditure_kcal)::double precision AS average_expenditure,
      avg(b.resting_energy_kcal)::double precision AS average_resting,
      avg(b.active_energy_kcal)::double precision AS average_active,
      -- A day's consumed override (set from the daily-history editor) wins over the raw
      -- food-entries sum here too, matching how neon-dashboard.js already treats today
      -- and trends — otherwise editing a day's intake moves that one day's bar on the
      -- chart but silently leaves the all-time average deficit/surplus unchanged.
      (avg(COALESCE(b.calories_consumed_override, f.calories_consumed) - b.total_expenditure_kcal)
        FILTER (WHERE COALESCE(b.calories_consumed_override, f.calories_consumed) IS NOT NULL))::double precision AS average_balance,
      count(*)::int AS expenditure_days,
      count(COALESCE(b.calories_consumed_override, f.calories_consumed))::int AS balance_days
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
