import { sql } from './db.js'

// Rolling 24-hour energy balance, shared by the dashboard API (api/mlog.js) and the
// MCP server's get_energy_balance tool. Kept out of both so the midnight-crossing
// arithmetic below has exactly one implementation.

const TIME_ZONE = 'America/Los_Angeles'

// Rolling 24-hour energy balance: calories eaten minus calories burned across the
// trailing 24 hours from right now, rather than since local midnight. A negative
// balance is a deficit, matching the rest of the app.
export async function getRolling24h(userId) {
  try {
    return await readRolling24h(userId)
  } catch (error) {
    console.error('Rolling 24h energy unavailable', error)
    return null
  }
}

export async function readRolling24h(userId) {
  const db = sql()
  const tz = TIME_ZONE
  // Consumed is exact — food entries carry timestamps, so we just sum the window.
  const consumedRows = await db`
    SELECT coalesce(sum(calories_kcal), 0)::double precision AS consumed, count(calories_kcal)::int AS n
    FROM food_entries
    WHERE user_id = ${userId}
      AND occurred_at > now() - interval '24 hours'
      AND occurred_at <= now()
  `
  const consumed = Math.max(0, finite(consumedRows[0]?.consumed) || 0)
  const foodCount = consumedRows[0]?.n || 0

  // Burned is harder: expenditure accrues continuously and health_energy_snapshots
  // store the running WITHIN-DAY total (reset at local midnight). A 24h window crosses
  // one midnight, so burned = today's total so far + (yesterday's final − yesterday's
  // total at this same clock time). If snapshots are too sparse, fall back to
  // pro-rating the daily health_daily totals across the window.
  let burned = null
  let method = 'none'
  try {
    const snap = await db`
      WITH p AS (SELECT (now() AT TIME ZONE ${tz})::date AS today, ((now() AT TIME ZONE ${tz})::date - 1) AS yday)
      SELECT
        (SELECT s.total_expenditure_kcal FROM health_energy_snapshots s, p
           WHERE s.user_id = ${userId} AND s.date = p.today AND s.total_expenditure_kcal IS NOT NULL
           ORDER BY s.collected_at DESC LIMIT 1) AS today_latest,
        (SELECT s.total_expenditure_kcal FROM health_energy_snapshots s, p
           WHERE s.user_id = ${userId} AND s.date = p.yday AND s.total_expenditure_kcal IS NOT NULL
           ORDER BY s.collected_at DESC LIMIT 1) AS yday_final,
        (SELECT s.total_expenditure_kcal FROM health_energy_snapshots s, p
           WHERE s.user_id = ${userId} AND s.date = p.yday AND s.total_expenditure_kcal IS NOT NULL
           ORDER BY abs(extract(epoch FROM (s.collected_at - (now() - interval '24 hours')))) ASC LIMIT 1) AS yday_at_cutoff
    `
    const todayLatest = finite(snap[0]?.today_latest)
    const ydayFinal = finite(snap[0]?.yday_final)
    const ydayAtCutoff = finite(snap[0]?.yday_at_cutoff)
    if (todayLatest != null && ydayFinal != null && ydayAtCutoff != null) {
      burned = todayLatest + Math.max(0, ydayFinal - ydayAtCutoff)
      method = 'measured'
    }
  } catch (error) {
    // The snapshots table is optional; fall through to the daily-total estimate.
    console.warn('Rolling 24h snapshot path unavailable', error?.message || error)
  }

  if (burned == null) {
    const daily = await db`
      WITH p AS (SELECT (now() AT TIME ZONE ${tz})::date AS today, ((now() AT TIME ZONE ${tz})::date - 1) AS yday)
      SELECT
        (SELECT total_expenditure_kcal FROM health_daily h, p WHERE h.user_id = ${userId} AND h.date = p.today) AS today_total,
        (SELECT total_expenditure_kcal FROM health_daily h, p WHERE h.user_id = ${userId} AND h.date = p.yday) AS yday_total,
        extract(epoch FROM (now() - ((now() AT TIME ZONE ${tz})::date::timestamp AT TIME ZONE ${tz}))) AS secs_today
    `
    const todayTotal = finite(daily[0]?.today_total)
    const ydayTotal = finite(daily[0]?.yday_total)
    const fracToday = Math.min(1, Math.max(0, (finite(daily[0]?.secs_today) || 0) / 86400))
    if (todayTotal != null || ydayTotal != null) {
      // Today's total is the actual amount burned since midnight; yesterday's is
      // pro-rated to the portion of yesterday still inside the window.
      burned = (todayTotal || 0) + (ydayTotal || 0) * (1 - fracToday)
      method = 'estimated'
    }
  }

  if (burned == null) return { consumed, burned: null, balance: null, foodCount, method: 'none' }
  burned = Math.round(burned)
  return { consumed: Math.round(consumed), burned, balance: Math.round(consumed - burned), foodCount, method }
}

function finite(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
