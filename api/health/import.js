import { sql, userForSyncToken } from '../_lib/db.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const TIME_ZONE = 'America/Los_Angeles'
const PARSER_VERSION = 9

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  const user = await userForSyncToken(token).catch(() => null)
  if (!user) {
    sendJson(res, 401, { error: 'A valid Fuel health sync bearer token is required.' })
    return
  }

  try {
    const raw = unwrap(req.body)
    const payload = typeof raw === 'string' ? parseTextPayload(raw) : normalizeObject(raw)
    const record = normalize(payload)

    if (!hasHealthData(record)) {
      sendJson(res, 422, { error: 'No recognizable health measurements were found.', parserVersion: PARSER_VERSION, receivedKeys: Object.keys(payload || {}) })
      return
    }

    const db = sql()
    await db`
      ALTER TABLE health_daily
        ADD COLUMN IF NOT EXISTS blood_oxygen_percent double precision,
        ADD COLUMN IF NOT EXISTS stand_minutes double precision,
        ADD COLUMN IF NOT EXISTS walking_heart_rate_avg_bpm double precision,
        ADD COLUMN IF NOT EXISTS cycling_distance_mi double precision,
        ADD COLUMN IF NOT EXISTS flights_climbed double precision,
        ADD COLUMN IF NOT EXISTS swimming_strokes double precision
    `

    const rows = await db`
      INSERT INTO health_daily (
        user_id, date, active_energy_kcal, resting_energy_kcal, total_expenditure_kcal,
        exercise_minutes, step_count, walking_running_distance_mi, swimming_distance_yd,
        resting_heart_rate_bpm, hrv_ms, vo2_max, sleep_hours, respiratory_rate,
        blood_oxygen_percent, stand_minutes, walking_heart_rate_avg_bpm,
        cycling_distance_mi, flights_climbed, swimming_strokes,
        partial_day, source, raw_payload, updated_at
      ) VALUES (
        ${user.id}, ${record.date}, ${record.activeEnergy}, ${record.restingEnergy}, ${record.totalExpenditure},
        ${record.exerciseMinutes}, ${record.steps}, ${record.walkingRunningDistance}, ${record.swimmingDistance},
        ${record.restingHeartRate}, ${record.hrv}, ${record.vo2Max}, ${record.sleepHours}, ${record.respiratoryRate},
        ${record.bloodOxygen}, ${record.standMinutes}, ${record.walkingHeartRateAverage},
        ${record.cyclingDistance}, ${record.flightsClimbed}, ${record.swimmingStrokes},
        ${record.partialDay}, 'Apple Shortcuts', ${JSON.stringify(payload)}, now()
      )
      ON CONFLICT (user_id, date) DO UPDATE SET
        active_energy_kcal = COALESCE(EXCLUDED.active_energy_kcal, health_daily.active_energy_kcal),
        resting_energy_kcal = COALESCE(EXCLUDED.resting_energy_kcal, health_daily.resting_energy_kcal),
        total_expenditure_kcal = COALESCE(EXCLUDED.total_expenditure_kcal, health_daily.total_expenditure_kcal),
        exercise_minutes = COALESCE(EXCLUDED.exercise_minutes, health_daily.exercise_minutes),
        step_count = COALESCE(EXCLUDED.step_count, health_daily.step_count),
        walking_running_distance_mi = COALESCE(EXCLUDED.walking_running_distance_mi, health_daily.walking_running_distance_mi),
        swimming_distance_yd = COALESCE(EXCLUDED.swimming_distance_yd, health_daily.swimming_distance_yd),
        resting_heart_rate_bpm = COALESCE(EXCLUDED.resting_heart_rate_bpm, health_daily.resting_heart_rate_bpm),
        hrv_ms = COALESCE(EXCLUDED.hrv_ms, health_daily.hrv_ms),
        vo2_max = COALESCE(EXCLUDED.vo2_max, health_daily.vo2_max),
        sleep_hours = COALESCE(EXCLUDED.sleep_hours, health_daily.sleep_hours),
        respiratory_rate = COALESCE(EXCLUDED.respiratory_rate, health_daily.respiratory_rate),
        blood_oxygen_percent = COALESCE(EXCLUDED.blood_oxygen_percent, health_daily.blood_oxygen_percent),
        stand_minutes = COALESCE(EXCLUDED.stand_minutes, health_daily.stand_minutes),
        walking_heart_rate_avg_bpm = COALESCE(EXCLUDED.walking_heart_rate_avg_bpm, health_daily.walking_heart_rate_avg_bpm),
        cycling_distance_mi = COALESCE(EXCLUDED.cycling_distance_mi, health_daily.cycling_distance_mi),
        flights_climbed = COALESCE(EXCLUDED.flights_climbed, health_daily.flights_climbed),
        swimming_strokes = COALESCE(EXCLUDED.swimming_strokes, health_daily.swimming_strokes),
        partial_day = EXCLUDED.partial_day,
        source = EXCLUDED.source,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING date, active_energy_kcal, resting_energy_kcal, total_expenditure_kcal,
        exercise_minutes, step_count, walking_running_distance_mi, swimming_distance_yd,
        resting_heart_rate_bpm, hrv_ms, vo2_max, sleep_hours, respiratory_rate,
        blood_oxygen_percent, stand_minutes, walking_heart_rate_avg_bpm,
        cycling_distance_mi, flights_climbed, swimming_strokes, partial_day
    `

    sendJson(res, 200, {
      ok: true,
      mode: 'upsert',
      imported: 1,
      dates: [record.date],
      parserVersion: PARSER_VERSION,
      parsed: rows[0],
    })
  } catch (error) {
    console.error('Neon health import failed', error)
    sendJson(res, 500, { error: 'Health data could not be stored.' })
  }
}

function unwrap(body) {
  if (Buffer.isBuffer(body)) return unwrap(body.toString('utf8'))
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      return parsed?.payload ?? parsed?.dictionary ?? parsed?.health ?? parsed
    } catch {
      return body
    }
  }
  if (body && typeof body === 'object') return body.payload ?? body.dictionary ?? body.health ?? body
  return {}
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function parseTextPayload(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return {}
  try { return JSON.parse(trimmed) } catch { /* tolerant parsing below */ }
  const output = {}
  const keys = [
    'date', 'activeEnergy', 'restingEnergy', 'excersiseMinutes', 'exerciseMinutes', 'steps',
    'walkingrunDistance', 'walkingRunningDistance', 'swimDistance', 'swimmingDistance',
    'restingHeartRate', 'heartRateVariability', 'HRV', 'respiratoryRate', 'cardioFitness',
    'vo2Max', 'sleepTotal', 'bloodOx', 'bloodOxygen', 'standMins', 'standMinutes',
    'wlkHRAvg', 'walkingHeartRateAverage', 'BikeDist', 'cyclingDistance', 'flightsClimb',
    'flightsClimbed', 'swmStrokes', 'swimmingStrokes'
  ]
  for (const key of keys) {
    const match = trimmed.match(new RegExp(`(?:^|[\\n,{])\\s*["']?${key}["']?\\s*[:=]\\s*["']?([^,"'\\n}]+)`, 'i'))
    if (match) output[key] = match[1].trim()
  }
  return output
}

function normalize(payload) {
  const activeEnergy = number(value(payload, ['activeEnergy', 'active calories']))
  const restingEnergy = number(value(payload, ['restingEnergy', 'resting energy', 'basalEnergy']))
  const explicitTotal = number(value(payload, ['totalExpenditure', 'total energy']))
  return {
    date: dateValue(value(payload, ['date', 'day'])) || today(),
    activeEnergy,
    restingEnergy,
    totalExpenditure: explicitTotal ?? (activeEnergy != null && restingEnergy != null ? activeEnergy + restingEnergy : null),
    exerciseMinutes: number(value(payload, ['exerciseMinutes', 'excersiseMinutes', 'exerciseTime'])),
    steps: number(value(payload, ['steps', 'stepCount'])),
    walkingRunningDistance: number(value(payload, ['walkingrunDistance', 'walkingRunningDistance', 'distanceMiles'])),
    swimmingDistance: number(value(payload, ['swimDistance', 'swimmingDistance'])),
    restingHeartRate: number(value(payload, ['restingHeartRate', 'restingHR'])),
    hrv: number(value(payload, ['heartRateVariability', 'HRV', 'hrv'])),
    respiratoryRate: number(value(payload, ['respiratoryRate', 'breathingRate'])),
    vo2Max: number(value(payload, ['cardioFitness', 'vo2Max'])),
    sleepHours: number(value(payload, ['sleepTotal', 'sleepHours'])),
    bloodOxygen: normalizeBloodOxygen(number(value(payload, ['bloodOx', 'bloodOxygen', 'oxygenSaturation']))),
    standMinutes: number(value(payload, ['standMins', 'standMinutes'])),
    walkingHeartRateAverage: number(value(payload, ['wlkHRAvg', 'walkingHeartRateAverage', 'walkingHeartRate'])),
    cyclingDistance: number(value(payload, ['BikeDist', 'bikeDistance', 'cyclingDistance'])),
    flightsClimbed: number(value(payload, ['flightsClimb', 'flightsClimbed'])),
    swimmingStrokes: number(value(payload, ['swmStrokes', 'swimmingStrokes', 'swimStrokes'])),
    partialDay: booleanValue(value(payload, ['partialDay'])) ?? true,
  }
}

function value(object, aliases) {
  const wanted = new Set(aliases.map(normalizeKey))
  for (const [key, current] of Object.entries(object || {})) if (wanted.has(normalizeKey(key))) return current
  return null
}

function number(input) {
  if (input == null || input === '') return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  if (typeof input === 'object') return number(input.value ?? input.amount ?? input.quantity ?? input.sum)
  const normalized = String(input).replace(/[−–—]/g, '-').replace(/[\u00A0\u202F]/g, ' ').trim()
  const match = normalized.match(/[-+]?\d+(?:[,.]\d+)?/)
  if (!match) return null
  const parsed = Number(match[0].replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBloodOxygen(input) {
  if (input == null) return null
  return input > 0 && input <= 1 ? input * 100 : input
}

function booleanValue(input) {
  if (typeof input === 'boolean') return input
  if (/^(true|yes|1)$/i.test(String(input || ''))) return true
  if (/^(false|no|0)$/i.test(String(input || ''))) return false
  return null
}

function dateValue(input) {
  if (!input) return ''
  const direct = String(input).match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (direct) return direct[1]
  const parsed = new Date(String(input))
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(parsed)
}

function hasHealthData(record) {
  return Object.entries(record).some(([key, current]) => key !== 'date' && key !== 'partialDay' && Number.isFinite(current))
}

function normalizeKey(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}
