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

    const shortcutPayload = body.payload || body.dictionary || body.health || body
    const normalized = normalizeShortcutDictionary(shortcutPayload)

    process.env.MLOG_SPREADSHEET_ID = MLOG_SPREADSHEET_ID
    process.env.GOOGLE_REFRESH_TOKEN = session.tokens.refreshToken

    const result = await importHealthPayload(normalized)
    sendJson(res, 200, {
      ok: true,
      ...result,
      receivedKeys: Object.keys(shortcutPayload || {}).slice(0, 30),
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

  const active = sum(payload.activeEnergy)
  const resting = sum(payload.restingEnergy)
  const sleep = sleepHours(payload.sleep)

  return {
    date: dateValue(payload.date) || today(),
    activeEnergy: active,
    restingEnergy: resting,
    totalExpenditure: active == null || resting == null ? null : active + resting,
    exerciseMinutes: sum(payload.exerciseMinutes || payload.exerciseMins),
    steps: sum(payload.steps),
    walkingRunningDistance: sum(payload.walkingrunDistance || payload.walkingRunningDistance),
    restingHeartRate: latest(payload.restingHeartRate),
    heartRateVariability: average(payload.HRV || payload.hrv),
    respiratoryRate: average(payload.respiratoryRate),
    vo2Max: latest(payload.cardioFitness),
    sleepTotal: sleep,
    partialDay: true,
  }
}

function list(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value.flatMap(list)
  if (typeof value === 'object') {
    for (const key of ['samples', 'values', 'items', 'data', 'results']) {
      if (Array.isArray(value[key])) return list(value[key])
    }
  }
  return [value]
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value && typeof value === 'object') {
    for (const key of ['value', 'quantity', 'amount', 'sum', 'average']) {
      if (value[key] != null) return numeric(value[key])
    }
    return null
  }
  const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function values(value) {
  return list(value).map(numeric).filter(Number.isFinite)
}

function sum(value) {
  const numbers = values(value)
  return numbers.length ? numbers.reduce((total, number) => total + number, 0) : null
}

function average(value) {
  const numbers = values(value)
  return numbers.length ? numbers.reduce((total, number) => total + number, 0) / numbers.length : null
}

function latest(value) {
  const numbers = values(value)
  return numbers.length ? numbers.at(-1) : null
}

function sleepHours(value) {
  let total = 0
  let found = false
  for (const sample of list(value)) {
    if (!sample || typeof sample !== 'object') continue
    const stage = String(sample.value || sample.stage || sample.category || '').toLowerCase()
    if (stage.includes('awake') || stage.includes('in bed')) continue
    const start = new Date(sample.startDate || sample.start || '')
    const end = new Date(sample.endDate || sample.end || '')
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
    total += (end.getTime() - start.getTime()) / 3600000
    found = true
  }
  return found ? total : null
}

function dateValue(value) {
  if (!value) return ''
  const direct = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct) return direct[1]
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date)
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}
