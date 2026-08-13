import { sql } from './db.js'
import { activityName, databaseDateKey } from './neon-dashboard.js'

// Deterministic pattern-mining for "Learn from me": the correlation math (which food
// clusters on which weekday, what a workout does to the next night's sleep, when a
// given activity usually happens) is computed here in plain JS over raw rows, not
// asked of the model — small on-device/BYOK models are unreliable at exact counting
// and averaging. The model's job (see OnDeviceAI.learnFromData / RemoteAI) is only to
// pick the most interesting of these candidates and phrase them in one sentence each.

const TIME_ZONE = 'America/Los_Angeles'

function localDateKey(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date) }
function localWeekday(date) { return new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'long' }).format(date) }
function localHour(date) { return Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hour12: false }).format(date)) }

function nextDateKey(key) {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function finite(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mean(values) {
  const v = values.filter((x) => x != null)
  if (!v.length) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

function timeOfDayLabel(hour) {
  if (hour < 6) return 'very early morning'
  if (hour < 11) return 'morning'
  if (hour < 14) return 'midday'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

/// Foods that cluster heavily on one weekday — "ice cream, mostly on Fridays" — rather
/// than being spread evenly across the week. Requires at least 3 logs on that weekday
/// and that weekday to account for at least half of all logs of that food.
function foodWeekdayPatterns(foodRows) {
  const byFood = new Map()
  for (const row of foodRows) {
    const label = (row.description || '').trim()
    if (!label) continue
    const norm = label.toLowerCase()
    const weekday = localWeekday(new Date(row.occurred_at))
    if (!byFood.has(norm)) byFood.set(norm, { label, total: 0, byWeekday: new Map() })
    const entry = byFood.get(norm)
    entry.total += 1
    entry.byWeekday.set(weekday, (entry.byWeekday.get(weekday) || 0) + 1)
  }
  const patterns = []
  for (const entry of byFood.values()) {
    if (entry.total < 3) continue
    let bestDay = null
    let bestCount = 0
    for (const [day, count] of entry.byWeekday) {
      if (count > bestCount) { bestCount = count; bestDay = day }
    }
    if (bestDay && bestCount / entry.total >= 0.5 && bestCount >= 3) {
      patterns.push({ food: entry.label, weekday: bestDay, timesOnWeekday: bestCount, timesTotal: entry.total })
    }
  }
  patterns.sort((a, b) => b.timesOnWeekday - a.timesOnWeekday)
  return patterns.slice(0, 6)
}

/// What a workout type does to the following night's sleep and HRV, versus the same
/// figures on days that followed no workout at all. Flags only a real gap, not noise —
/// at least 3 occurrences and a half-hour (sleep) or 5ms (HRV) difference from baseline.
function workoutAftereffects(workoutRows, healthByDate) {
  const datesByActivity = new Map()
  const workoutDates = new Set()
  for (const row of workoutRows) {
    const date = localDateKey(new Date(row.start_at))
    const activity = activityName(row.activity_type || '')
    if (!datesByActivity.has(activity)) datesByActivity.set(activity, new Set())
    datesByActivity.get(activity).add(date)
    workoutDates.add(date)
  }

  const baselineSleep = []
  const baselineHrv = []
  for (const date of healthByDate.keys()) {
    if (workoutDates.has(date)) continue
    const next = healthByDate.get(nextDateKey(date))
    if (!next) continue
    baselineSleep.push(finite(next.sleep_hours))
    baselineHrv.push(finite(next.hrv_ms))
  }
  const baseSleepAvg = mean(baselineSleep)
  const baseHrvAvg = mean(baselineHrv)

  const results = []
  for (const [activity, dates] of datesByActivity) {
    if (dates.size < 3) continue
    const sleeps = []
    const hrvs = []
    for (const date of dates) {
      const next = healthByDate.get(nextDateKey(date))
      if (!next) continue
      sleeps.push(finite(next.sleep_hours))
      hrvs.push(finite(next.hrv_ms))
    }
    const sleepAvg = mean(sleeps)
    const hrvAvg = mean(hrvs)
    if (sleepAvg != null && baseSleepAvg != null && Math.abs(sleepAvg - baseSleepAvg) >= 0.5) {
      results.push({ activity, metric: 'sleep', unit: 'h', afterAvg: sleepAvg, otherwiseAvg: baseSleepAvg, sampleSize: dates.size })
    }
    if (hrvAvg != null && baseHrvAvg != null && Math.abs(hrvAvg - baseHrvAvg) >= 5) {
      results.push({ activity, metric: 'HRV', unit: 'ms', afterAvg: hrvAvg, otherwiseAvg: baseHrvAvg, sampleSize: dates.size })
    }
  }
  return results
}

/// Which activities happen at a consistent time of day — a tight (<=4h) spread across
/// at least 3 sessions reads as a habit, not a coincidence.
function workoutTiming(workoutRows) {
  const hoursByActivity = new Map()
  for (const row of workoutRows) {
    const activity = activityName(row.activity_type || '')
    if (!hoursByActivity.has(activity)) hoursByActivity.set(activity, [])
    hoursByActivity.get(activity).push(localHour(new Date(row.start_at)))
  }
  const results = []
  for (const [activity, hours] of hoursByActivity) {
    if (hours.length < 3) continue
    const spread = Math.max(...hours) - Math.min(...hours)
    if (spread <= 4) {
      results.push({ activity, timeOfDay: timeOfDayLabel(mean(hours)), sampleSize: hours.length })
    }
  }
  return results
}

/// Weekdays that are notably more active than the person's own average (>=1.5x), not
/// just whichever day happens to be highest.
function activeWeekdayPattern(healthByDate) {
  const byWeekday = new Map()
  for (const [date, health] of healthByDate) {
    const weekday = localWeekday(new Date(`${date}T12:00:00Z`))
    if (!byWeekday.has(weekday)) byWeekday.set(weekday, [])
    byWeekday.get(weekday).push(finite(health.exercise_minutes) || 0)
  }
  const overall = mean([...byWeekday.values()].flat())
  if (overall == null || overall <= 0) return []
  const results = []
  for (const [weekday, values] of byWeekday) {
    if (values.length < 3) continue
    const avg = mean(values)
    if (avg != null && avg >= overall * 1.5) {
      results.push({ weekday, averageMinutes: avg, overallAverageMinutes: overall })
    }
  }
  results.sort((a, b) => b.averageMinutes - a.averageMinutes)
  return results.slice(0, 3)
}

/// Raw candidate patterns for "Learn from me" — deterministically mined, then handed to
/// the model to pick from and phrase. Every number here is real; the model may not
/// invent a pattern beyond what's in this payload.
export async function getLearningSignals(userId, days = 60) {
  const db = sql()
  const [foodRows, workoutRows, healthRows] = await Promise.all([
    db`SELECT description, occurred_at FROM food_entries
       WHERE user_id = ${userId} AND occurred_at >= now() - (${days} || ' days')::interval`,
    db`SELECT activity_type, start_at FROM hk_workouts
       WHERE user_id = ${userId} AND start_at >= now() - (${days} || ' days')::interval`
      .catch((error) => { console.error('Learning-signals workout load failed', error); return [] }),
    db`SELECT date, sleep_hours, hrv_ms, exercise_minutes FROM health_daily
       WHERE user_id = ${userId} AND date >= now() - (${days} || ' days')::interval`,
  ])

  const healthByDate = new Map(healthRows.map((row) => [databaseDateKey(row.date), row]))

  return {
    foodWeekdayPatterns: foodWeekdayPatterns(foodRows),
    workoutAftereffects: workoutAftereffects(workoutRows, healthByDate),
    workoutTiming: workoutTiming(workoutRows),
    activeWeekdays: activeWeekdayPattern(healthByDate),
  }
}
