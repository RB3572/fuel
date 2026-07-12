import { decryptJson } from '../_lib/crypto.js'
import { refreshSession } from '../_lib/google.js'
import { importHealthPayload } from '../_lib/health-import.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const MLOG_SPREADSHEET_ID = '1XWOQPqQJ4pbN93tQty-jDuiqv7_8CgEfNPVTD0k8MIs'
const TOKEN_KIND = 'fuel-health-import'

const METRICS = [
  { key: 'activeEnergy', aliases: ['activeEnergy', 'active energy', 'activeCalories'], mode: 'sum' },
  { key: 'restingEnergy', aliases: ['restingEnergy', 'resting energy', 'basalEnergy'], mode: 'sum' },
  { key: 'exerciseMinutes', aliases: ['exerciseMinutes', 'exercise minutes', 'exerciseTime'], mode: 'sumMinutes' },
  { key: 'steps', aliases: ['steps', 'stepCount', 'step count'], mode: 'sum' },
  { key: 'walkingRunningDistance', aliases: ['walkingrunDistance', 'walkingRunningDistance', 'walking running distance'], mode: 'sumMiles' },
  { key: 'swimmingDistance', aliases: ['swimDistance', 'swimmingDistance', 'swim distance'], mode: 'sum' },
  { key: 'restingHeartRate', aliases: ['restingHeartRate', 'resting heart rate', 'restingHR'], mode: 'latest' },
  { key: 'heartRateVariability', aliases: ['HRV', 'heartRateVariability', 'heart rate variability'], mode: 'average' },
  { key: 'respiratoryRate', aliases: ['respiratoryRate', 'respiratory rate', 'breathingRate'], mode: 'average' },
  { key: 'vo2Max', aliases: ['cardioFitness', 'cardio fitness', 'vo2Max', 'VO2 Max'], mode: 'latest' },
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    sendJson(res, 401, { error: 'A Fuel health sync bearer token is required.' })
    return
  }

  let session
  try {
    const tokenPayload = decryptJson(token)
    if (tokenPayload?.kind !== TOKEN_KIND || !tokenPayload?.session?.tokens?.refreshToken) throw new Error('Invalid token')
    const refreshed = await refreshSession(tokenPayload.session)
    session = refreshed.session
  } catch {
    sendJson(res, 401, { error: 'Invalid or expired Fuel health sync token.' })
    return
  }

  try {
    const incoming = unwrapBody(req.body)
    const parsedInput = coercePayload(incoming)
    const normalized = normalizePayload(parsedInput)

    if (!hasHealthValues(normalized)) {
      sendJson(res, 422, {
        error: 'Fuel received text from the Shortcut but could not find health measurements. Make the payload field Text and select the populated orange Dictionary variable.',
        receivedType: Array.isArray(parsedInput) ? 'array' : typeof parsedInput,
        receivedCharacters: typeof incoming === 'string' ? incoming.length : null,
        receivedKeys: objectKeys(parsedInput),
      })
      return
    }

    process.env.MLOG_SPREADSHEET_ID = MLOG_SPREADSHEET_ID
    process.env.GOOGLE_REFRESH_TOKEN = session.tokens.refreshToken

    const result = await importHealthPayload(normalized)
    sendJson(res, 200, {
      ok: true,
      ...result,
      parsed: parsedSummary(normalized),
    })
  } catch (error) {
    console.error('Shortcut text health import failed', error instanceof Error ? error.message : 'Unknown error')
    sendJson(res, 500, { error: 'The Shortcut health text could not be imported.' })
  }
}

function unwrapBody(body) {
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      return parsed?.payload ?? parsed?.text ?? parsed?.data ?? parsed
    } catch {
      return body
    }
  }
  if (body && typeof body === 'object') return body.payload ?? body.text ?? body.data ?? body
  return body
}

function coercePayload(value) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return {}

  for (const candidate of [text, decodeMaybe(text)]) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Continue with the tolerant text parser.
    }
  }

  return parseDictionaryText(text)
}

function parseDictionaryText(text) {
  const result = {}
  const date = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
  if (date) result.date = date

  const markers = []
  const allAliases = [
    { key: 'sleep', aliases: ['sleep', 'sleep samples'] },
    ...METRICS,
  ]

  for (const metric of allAliases) {
    for (const alias of metric.aliases) {
      const regex = new RegExp(`(^|[\\n\\r,{;])\\s*["']?${escapeRegex(alias)}["']?\\s*[:=]`, 'ig')
      let match
      while ((match = regex.exec(text))) markers.push({ key: metric.key, start: match.index + match[0].length })
    }
  }

  markers.sort((a, b) => a.start - b.start)
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    const end = markers[index + 1]?.start ?? text.length
    const section = text.slice(marker.start, end)
    if (marker.key === 'sleep') result.sleep = section
    else result[marker.key] = section
  }

  return result
}

function normalizePayload(payload) {
  if (Array.isArray(payload)) payload = payload[0] || {}
  if (!payload || typeof payload !== 'object') payload = {}

  const active = metricValue(get(payload, ['activeEnergy', 'activeCalories']), 'sum')
  const resting = metricValue(get(payload, ['restingEnergy', 'basalEnergy']), 'sum')
  const sleep = sleepSummary(get(payload, ['sleep', 'sleepSamples']))

  return {
    date: dateValue(get(payload, ['date', 'day'])) || today(),
    activeEnergy: active,
    restingEnergy: resting,
    totalExpenditure: active == null || resting == null ? null : active + resting,
    exerciseMinutes: metricValue(get(payload, ['exerciseMinutes', 'exerciseMins', 'exerciseTime']), 'sumMinutes'),
    steps: metricValue(get(payload, ['steps', 'stepCount']), 'sum'),
    walkingRunningDistance: metricValue(get(payload, ['walkingrunDistance', 'walkingRunningDistance', 'distance']), 'sumMiles'),
    swimmingDistance: metricValue(get(payload, ['swimDistance', 'swimmingDistance']), 'sum'),
    restingHeartRate: metricValue(get(payload, ['restingHeartRate', 'restingHR']), 'latest'),
    heartRateVariability: metricValue(get(payload, ['HRV', 'hrv', 'heartRateVariability']), 'average'),
    respiratoryRate: metricValue(get(payload, ['respiratoryRate', 'breathingRate']), 'average'),
    vo2Max: metricValue(get(payload, ['cardioFitness', 'vo2Max']), 'latest'),
    sleepTotal: sleep.total,
    sleepCore: sleep.core,
    sleepDeep: sleep.deep,
    sleepREM: sleep.rem,
    sleepAwake: sleep.awake,
    partialDay: true,
  }
}

function metricValue(value, mode) {
  const measurements = collectMeasurements(value)
  if (!measurements.length) return null

  let numbers = measurements.map((item) => convert(item.number, item.unit, mode)).filter(Number.isFinite)
  if (!numbers.length) return null

  if (mode === 'latest') return numbers.at(-1)
  if (mode === 'average') return numbers.reduce((sum, number) => sum + number, 0) / numbers.length
  return numbers.reduce((sum, number) => sum + number, 0)
}

function collectMeasurements(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value.flatMap(collectMeasurements)

  if (typeof value === 'number') return [{ number: value, unit: '' }]

  if (typeof value === 'object') {
    for (const alias of ['samples', 'values', 'items', 'data', 'results']) {
      const nested = get(value, [alias])
      if (nested != null) return collectMeasurements(nested)
    }
    const nested = get(value, ['value', 'quantity', 'amount', 'sum', 'average', 'avg', 'doubleValue'])
    if (nested != null && nested !== value) {
      const items = collectMeasurements(nested)
      const unit = String(get(value, ['unit', 'measurementUnit', 'quantityTypeUnit']) || '')
      return items.map((item) => ({ ...item, unit: item.unit || unit }))
    }
    return []
  }

  const text = String(value)
  const matches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*(kcal|calories?|steps?|count|mi|miles?|km|kilometers?|m|meters?|yd|yards?|bpm|ms|hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)?/gi)]
  return matches
    .map((match) => ({ number: Number(match[1]), unit: String(match[2] || '').toLowerCase() }))
    .filter((item) => Number.isFinite(item.number) && plausibleMeasurement(item.number, item.unit))
}

function plausibleMeasurement(number, unit) {
  if (unit) return true
  // Exclude years, timestamps, and other large identifiers from plain-text exports.
  return Math.abs(number) < 100000 && !(number >= 2000 && number <= 2100)
}

function convert(number, unit, mode) {
  if (mode === 'sumMinutes') {
    if (unit.startsWith('sec')) return number / 60
    if (unit.startsWith('hour') || unit === 'hr' || unit === 'hrs') return number * 60
  }
  if (mode === 'sumMiles') {
    if (unit === 'km' || unit.startsWith('kilometer')) return number * 0.621371
    if (unit === 'm' || unit.startsWith('meter')) return number / 1609.344
    if (unit === 'yd' || unit.startsWith('yard')) return number / 1760
  }
  return number
}

function sleepSummary(value) {
  const output = { total: null, core: null, deep: null, rem: null, awake: null }
  if (value == null) return output

  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const sums = { total: 0, core: 0, deep: 0, rem: 0, awake: 0 }
  let found = false

  const intervalRegex = /(awake|core|deep|rem|asleep)?[^\n\r]{0,100}?(20\d{2}-\d{2}-\d{2}[T ][0-9:.+-Z]+)[^\n\r]{0,80}?(20\d{2}-\d{2}-\d{2}[T ][0-9:.+-Z]+)/gi
  for (const match of text.matchAll(intervalRegex)) {
    const start = new Date(match[2])
    const end = new Date(match[3])
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
    const hours = (end.getTime() - start.getTime()) / 3600000
    if (!(hours >= 0 && hours <= 24)) continue
    const stage = String(match[1] || 'asleep').toLowerCase()
    found = true
    if (stage === 'awake') sums.awake += hours
    else if (stage === 'deep') { sums.deep += hours; sums.total += hours }
    else if (stage === 'rem') { sums.rem += hours; sums.total += hours }
    else if (stage === 'core') { sums.core += hours; sums.total += hours }
    else sums.total += hours
  }

  if (!found) {
    const measurements = collectMeasurements(value)
    const hours = measurements.map((item) => convertDurationToHours(item.number, item.unit)).filter(Number.isFinite)
    if (hours.length) {
      sums.total = hours.reduce((sum, number) => sum + number, 0)
      found = true
    }
  }

  if (!found) return output
  for (const key of Object.keys(output)) output[key] = sums[key] || null
  return output
}

function convertDurationToHours(number, unit) {
  if (unit.startsWith('sec')) return number / 3600
  if (unit.startsWith('min')) return number / 60
  if (unit.startsWith('hour') || unit === 'hr' || unit === 'hrs') return number
  return null
}

function get(object, aliases) {
  if (!object || typeof object !== 'object') return null
  const wanted = new Set(aliases.map(normalizeKey))
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(normalizeKey(key))) return value
  }
  return null
}

function hasHealthValues(record) {
  return [
    record.activeEnergy, record.restingEnergy, record.exerciseMinutes, record.steps,
    record.walkingRunningDistance, record.swimmingDistance, record.restingHeartRate,
    record.heartRateVariability, record.respiratoryRate, record.vo2Max,
    record.sleepTotal, record.sleepCore, record.sleepDeep, record.sleepREM, record.sleepAwake,
  ].some(Number.isFinite)
}

function parsedSummary(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => Number.isFinite(value) || typeof value === 'boolean'))
}

function dateValue(value) {
  if (!value) return ''
  const direct = String(value).match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (direct) return direct[1]
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date)
}

function decodeMaybe(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 30) : []
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}
