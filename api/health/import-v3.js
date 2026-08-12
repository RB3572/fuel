import { decryptJson } from '../_lib/crypto.js'
import { googleFetch, refreshSession } from '../_lib/google.js'
import { importHealthPayload } from '../_lib/health-import.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const MLOG_SPREADSHEET_ID = '1XWOQPqQJ4pbN93tQty-jDuiqv7_8CgEfNPVTD0k8MIs'
const TOKEN_KIND = 'fuel-health-import'
const TIME_ZONE = 'America/Los_Angeles'
const PARSER_VERSION = 7

const fields = [
  ['activeEnergy', ['activeEnergy', 'active energy', 'active calories'], 'number'],
  ['restingEnergy', ['restingEnergy', 'resting energy', 'basal energy'], 'number'],
  ['exerciseMinutes', ['exerciseMinutes', 'excersiseMinutes', 'exercise minutes', 'exercise time'], 'number'],
  ['steps', ['steps', 'step count'], 'number'],
  ['walkingRunningDistance', ['walkingRunningDistance', 'walkingrunDistance', 'walking running distance'], 'number'],
  ['swimmingDistance', ['swimmingDistance', 'swimDistance', 'swimming distance'], 'number'],
  ['restingHeartRate', ['restingHeartRate', 'resting heart rate'], 'number'],
  ['heartRateVariability', ['heartRateVariability', 'HRV', 'heart rate variability'], 'number'],
  ['respiratoryRate', ['respiratoryRate', 'respiratory rate'], 'number'],
  ['vo2Max', ['vo2Max', 'cardioFitness', 'cardio fitness'], 'number'],
  ['sleepTotal', ['sleepTotal', 'sleep total'], 'number'],
]

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return sendJson(res, 401, { error: 'A Fuel health sync bearer token is required.' })

  let session
  try {
    const tokenPayload = decryptJson(token)
    if (tokenPayload?.kind !== TOKEN_KIND || !tokenPayload?.session?.tokens?.refreshToken) throw new Error('Invalid token')
    session = (await refreshSession(tokenPayload.session)).session
  } catch {
    return sendJson(res, 401, { error: 'Invalid or expired Fuel health sync token.' })
  }

  try {
    const payload = parsePayload(req.body)
    if (!Object.values(payload).some(Number.isFinite)) {
      return sendJson(res, 422, { error: 'No recognizable health measurements were found.', parserVersion: PARSER_VERSION })
    }

    process.env.MLOG_SPREADSHEET_ID = MLOG_SPREADSHEET_ID
    process.env.GOOGLE_REFRESH_TOKEN = session.tokens.refreshToken
    const result = await importHealthPayload({ ...payload, partialDay: true })

    if (Number.isFinite(payload.swimmingDistance)) {
      await writeSwimmingDistance(session, payload.date, payload.swimmingDistance)
    }

    return sendJson(res, 200, {
      ok: true,
      ...result,
      parserVersion: PARSER_VERSION,
      parsed: payload,
    })
  } catch (error) {
    console.error('Health Shortcut import failed', error)
    return sendJson(res, 500, { error: 'The Shortcut health data could not be imported.' })
  }
}

function parsePayload(body) {
  const unwrapped = unwrap(body)
  let object = unwrapped
  if (typeof unwrapped === 'string') {
    try { object = JSON.parse(unwrapped) } catch { object = null }
  }

  if (object && typeof object === 'object' && !Array.isArray(object)) {
    const output = { date: extractDate(object.date || object.day) || today() }
    for (const [key, aliases] of fields) {
      const value = findObjectValue(object, aliases)
      const parsed = parseNumber(typeof value === 'object' ? value?.value ?? value?.amount ?? value?.quantity : value)
      if (Number.isFinite(parsed)) output[key] = parsed
    }
    return output
  }

  const text = String(unwrapped || '')
  const output = { date: extractDate(text) || today() }
  for (const [key, aliases] of fields) {
    const parsed = findTextNumber(text, aliases)
    if (Number.isFinite(parsed)) output[key] = parsed
  }
  return output
}

function unwrap(body) {
  if (Buffer.isBuffer(body)) return unwrap(body.toString('utf8'))
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      return parsed?.payload ?? parsed?.text ?? parsed?.data ?? parsed
    } catch { return body }
  }
  if (body && typeof body === 'object') return body.payload ?? body.text ?? body.data ?? body
  return body
}

function findObjectValue(object, aliases) {
  const wanted = new Set(aliases.map(normalizeKey))
  for (const [key, value] of Object.entries(object || {})) {
    if (wanted.has(normalizeKey(key))) return value
  }
  return null
}

function findTextNumber(text, aliases) {
  const normalized = String(text).replace(/[\u00A0\u202F]/g, ' ').replace(/[−–—]/g, '-')
  const aliasPattern = aliases.map(escapeRegex).join('|')
  const regex = new RegExp(`(?:${aliasPattern})["']?\\s*[:=]\\s*["']?([-+]?\\d+(?:[.,]\\d+)?)`, 'i')
  const match = normalized.match(regex)
  return match ? parseNumber(match[1]) : null
}

function parseNumber(value) {
  if (typeof value === 'number') return value
  const text = String(value ?? '').trim().replace(/[−–—]/g, '-').replace(/,/g, '')
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

async function writeSwimmingDistance(session, date, yards) {
  const range = "'Health Daily'!A1:O1000"
  const response = await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${MLOG_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`)
  const rows = response.values || []
  const header = rows[0] || []
  let swimIndex = header.findIndex((value) => normalizeKey(value) === 'swimmingdistanceyd')
  if (swimIndex < 0) swimIndex = 14
  const rowIndex = rows.findIndex((row, index) => index > 0 && normalizeSheetDate(row[0]) === date)
  const targetRow = rowIndex >= 0 ? rowIndex + 1 : rows.length + 1
  const data = []
  if (header[swimIndex] !== 'Swimming Distance (yd)') data.push({ range: `'Health Daily'!${columnLetter(swimIndex + 1)}1`, values: [['Swimming Distance (yd)']] })
  data.push({ range: `'Health Daily'!${columnLetter(swimIndex + 1)}${targetRow}`, values: [[Math.round(yards * 10) / 10]] })
  await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${MLOG_SPREADSHEET_ID}/values:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  })
}

function normalizeSheetDate(value) {
  if (typeof value === 'number' && value > 20000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10)
  return extractDate(value)
}
function extractDate(value) {
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(parsed)
}
function columnLetter(number) { let result = ''; for (let value = number; value > 0;) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26) } return result }
function normalizeKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '') }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date()) }
