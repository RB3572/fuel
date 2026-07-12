import { decryptJson } from '../_lib/crypto.js'
import { refreshSession } from '../_lib/google.js'
import { importHealthPayload } from '../_lib/health-import.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const MLOG_SPREADSHEET_ID = '1XWOQPqQJ4pbN93tQty-jDuiqv7_8CgEfNPVTD0k8MIs'
const TOKEN_KIND = 'fuel-health-import'

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

  const contentType = String(req.headers['content-type'] || '')
  if (!contentType.includes('application/json')) {
    sendJson(res, 415, { error: 'Content-Type must be application/json.' })
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (!body || typeof body !== 'object') {
      sendJson(res, 400, { error: 'A JSON object or array is required.' })
      return
    }

    const shortcutPayload = body.payload ?? body.dictionary ?? body.health ?? body
    const receivedKeys = objectKeys(shortcutPayload)
    if (!receivedKeys.length) {
      sendJson(res, 422, {
        error: 'The Shortcut sent an empty JSON body. Add one JSON Dictionary field named payload and set it to the orange Dictionary variable.',
        receivedKeys: [],
      })
      return
    }

    const normalized = normalizeShortcutDictionary(shortcutPayload)
    if (!normalized || !hasHealthValues(normalized)) {
      sendJson(res, 422, {
        error: 'Fuel received the Shortcut dictionary but could not read any health values yet.',
        receivedKeys,
        receivedShape: describeShape(shortcutPayload),
      })
      return
    }

    process.env.MLOG_SPREADSHEET_ID = MLOG_SPREADSHEET_ID
    process.env.GOOGLE_REFRESH_TOKEN = session.tokens.refreshToken

    const result = await importHealthPayload(normalized)
    sendJson(res, 200, {
      ok: true,
      ...result,
      receivedKeys,
      parsed: parsedSummary(normalized),
    })
  } catch (error) {
    console.error('Health import failed', error instanceof Error ? error.message : 'Unknown error')
    sendJson(res, 500, {
      error: 'Health data could not be imported. Reconnect Fuel and generate a new health sync token.',
    })
  }
}

function normalizeShortcutDictionary(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload

  const active = sumMetric(get(payload, ['activeEnergy', 'activeCalories']))
  const resting = sumMetric(get(payload, ['restingEnergy', 'basalEnergy']))
  const sleep = sleepSummary(get(payload, ['sleep', 'sleepSamples']))

  return {
    date: dateValue(get(payload, ['date', 'day'])) || today(),
    activeEnergy: active,
    restingEnergy: resting,
    totalExpenditure: active == null || resting == null ? null : active + resting,
    exerciseMinutes: sumMetric(get(payload, ['exerciseMinutes', 'exerciseMins', 'exerciseTime']), durationToMinutes),
    steps: sumMetric(get(payload, ['steps', 'stepCount'])),
    walkingRunningDistance: sumMetric(get(payload, ['walkingrunDistance', 'walkingRunningDistance', 'distance']), distanceToMiles),
    swimmingDistance: sumMetric(get(payload, ['swimDistance', 'swimmingDistance'])),
    restingHeartRate: latestMetric(get(payload, ['restingHeartRate', 'restingHR'])),
    heartRateVariability: averageMetric(get(payload, ['HRV', 'hrv', 'heartRateVariability'])),
    respiratoryRate: averageMetric(get(payload, ['respiratoryRate', 'breathingRate'])),
    vo2Max: latestMetric(get(payload, ['cardioFitness', 'vo2Max'])),
    sleepTotal: sleep.total,
    sleepCore: sleep.core,
    sleepDeep: sleep.deep,
    sleepREM: sleep.rem,
    sleepAwake: sleep.awake,
    partialDay: true,
  }
}

function get(object, aliases) {
  if (!object || typeof object !== 'object') return null
  const wanted = new Set(aliases.map(normalizeKey))
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(normalizeKey(key))) return value
  }
  return null
}

function list(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value.flatMap(list)
  if (typeof value === 'object') {
    for (const alias of ['samples', 'values', 'items', 'data', 'results']) {
      const nested = get(value, [alias])
      if (Array.isArray(nested)) return list(nested)
    }
  }
  return [value]
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value && typeof value === 'object') {
    const nested = get(value, ['value', 'quantity', 'amount', 'sum', 'average', 'avg', 'doubleValue'])
    if (nested != null && nested !== value) return numeric(nested)
    return null
  }
  const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function unitOf(value) {
  if (!value || typeof value !== 'object') return ''
  return String(get(value, ['unit', 'measurementUnit', 'quantityTypeUnit']) || '').toLowerCase()
}

function sumMetric(value, transform = identity) {
  let total = 0
  let found = false
  for (const sample of list(value)) {
    const number = numeric(sample)
    if (number == null) continue
    const converted = transform(number, unitOf(sample))
    if (!Number.isFinite(converted)) continue
    total += converted
    found = true
  }
  return found ? total : null
}

function averageMetric(value) {
  const numbers = list(value).map(numeric).filter(Number.isFinite)
  return numbers.length ? numbers.reduce((total, number) => total + number, 0) / numbers.length : null
}

function latestMetric(value) {
  const samples = list(value)
    .map((sample, index) => ({ sample, index, number: numeric(sample), time: sampleTime(sample) }))
    .filter((item) => Number.isFinite(item.number))
    .sort((a, b) => a.time - b.time || a.index - b.index)
  return samples.length ? samples.at(-1).number : null
}

function sleepSummary(value) {
  const totals = { total: null, core: null, deep: null, rem: null, awake: null }
  const sums = { total: 0, core: 0, deep: 0, rem: 0, awake: 0 }
  let found = false

  for (const sample of list(value)) {
    const stage = String(get(sample, ['stage', 'category', 'value', 'sleepStage']) || '').toLowerCase()
    const hours = sampleDurationHours(sample)
    if (!Number.isFinite(hours) || hours < 0) continue
    found = true

    if (stage.includes('awake')) sums.awake += hours
    else if (stage.includes('deep')) { sums.deep += hours; sums.total += hours }
    else if (stage.includes('rem')) { sums.rem += hours; sums.total += hours }
    else if (stage.includes('core')) { sums.core += hours; sums.total += hours }
    else if (!stage.includes('in bed')) sums.total += hours
  }

  if (!found) return totals
  for (const key of Object.keys(totals)) totals[key] = sums[key] || null
  return totals
}

function sampleDurationHours(sample) {
  if (sample && typeof sample === 'object') {
    const start = dateObject(get(sample, ['startDate', 'start', 'from']))
    const end = dateObject(get(sample, ['endDate', 'end', 'to']))
    if (start && end) return (end.getTime() - start.getTime()) / 3600000
  }
  const number = numeric(sample)
  if (number == null) return null
  const unit = unitOf(sample)
  if (unit.includes('sec')) return number / 3600
  if (unit.includes('min')) return number / 60
  return number
}

function durationToMinutes(number, unit) {
  if (unit.includes('sec')) return number / 60
  if (unit.includes('hour') || unit === 'hr' || unit === 'h') return number * 60
  return number
}

function distanceToMiles(number, unit) {
  if (unit === 'km' || unit.includes('kilometer')) return number * 0.621371
  if (unit === 'm' || unit.includes('meter')) return number / 1609.344
  if (unit.includes('yard') || unit === 'yd') return number / 1760
  return number
}

function identity(number) {
  return number
}

function sampleTime(sample) {
  if (!sample || typeof sample !== 'object') return 0
  const date = dateObject(get(sample, ['startDate', 'endDate', 'date', 'start', 'end']))
  return date ? date.getTime() : 0
}

function dateObject(value) {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function dateValue(value) {
  if (!value) return ''
  const direct = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct) return direct[1]
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date)
}

function hasHealthValues(record) {
  return [
    record.activeEnergy, record.restingEnergy, record.exerciseMinutes, record.steps,
    record.walkingRunningDistance, record.swimmingDistance, record.restingHeartRate,
    record.heartRateVariability, record.respiratoryRate, record.vo2Max,
    record.sleepTotal, record.sleepCore, record.sleepDeep, record.sleepREM, record.sleepAwake,
  ].some((value) => Number.isFinite(value))
}

function parsedSummary(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => Number.isFinite(value) || typeof value === 'boolean'))
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 30) : []
}

function describeShape(value) {
  if (Array.isArray(value)) {
    const objectItems = value.filter((item) => item && typeof item === 'object').slice(0, 3)
    return { type: 'array', count: value.length, itemKeys: [...new Set(objectItems.flatMap((item) => Object.keys(item)))].slice(0, 30) }
  }
  if (value && typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value).slice(0, 30),
      fields: Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, field]) => [key, Array.isArray(field) ? `array(${field.length})` : typeof field])),
    }
  }
  return { type: typeof value }
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}
