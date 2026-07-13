import { decryptJson } from '../_lib/crypto.js'
import { googleFetch, refreshSession } from '../_lib/google.js'
import { importHealthPayload } from '../_lib/health-import.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const MLOG_SPREADSHEET_ID = '1XWOQPqQJ4pbN93tQty-jDuiqv7_8CgEfNPVTD0k8MIs'
const TOKEN_KIND = 'fuel-health-import'
const TIME_ZONE = 'America/Los_Angeles'
const PARSER_VERSION = 6

const fields = [
  ['activeEnergy', ['activeEnergy', 'active energy', 'active calories'], 'energy'],
  ['restingEnergy', ['restingEnergy', 'resting energy', 'basal energy'], 'energy'],
  ['exerciseMinutes', ['exerciseMinutes', 'exercise minutes', 'exercise time'], 'minutes'],
  ['steps', ['steps', 'step count'], 'number'],
  ['walkingRunningDistance', ['walkingRunningDistance', 'walkingrunDistance', 'walking running distance', 'walking + running distance'], 'miles'],
  ['swimmingDistance', ['swimmingDistance', 'swimDistance', 'swimming distance', 'swim distance'], 'yards'],
  ['restingHeartRate', ['restingHeartRate', 'resting heart rate', 'resting hr'], 'number'],
  ['heartRateVariability', ['heartRateVariability', 'HRV', 'heart rate variability'], 'milliseconds'],
  ['respiratoryRate', ['respiratoryRate', 'respiratory rate'], 'number'],
  ['vo2Max', ['vo2Max', 'cardioFitness', 'cardio fitness'], 'number'],
  ['sleepTotal', ['sleepTotal', 'sleep total', 'sleep'], 'hours'],
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) {
    sendJson(res, 401, { error: 'A Fuel health sync bearer token is required.' })
    return
  }

  let session
  try {
    const tokenPayload = decryptJson(token)
    if (tokenPayload?.kind !== TOKEN_KIND || !tokenPayload?.session?.tokens?.refreshToken) throw new Error('Invalid token')
    session = (await refreshSession(tokenPayload.session)).session
  } catch {
    sendJson(res, 401, { error: 'Invalid or expired Fuel health sync token.' })
    return
  }

  try {
    const payload = parsePayload(req.body)
    if (!Object.values(payload).some((value) => Number.isFinite(value))) {
      sendJson(res, 422, { error: 'No recognizable health measurements were found.', parserVersion: PARSER_VERSION })
      return
    }

    process.env.MLOG_SPREADSHEET_ID = MLOG_SPREADSHEET_ID
    process.env.GOOGLE_REFRESH_TOKEN = session.tokens.refreshToken

    const result = await importHealthPayload({ ...payload, partialDay: true })
    if (Number.isFinite(payload.swimmingDistance)) {
      await writeSwimmingDistance(session, payload.date, payload.swimmingDistance)
    }

    sendJson(res, 200, {
      ok: true,
      ...result,
      parserVersion: PARSER_VERSION,
      parsed: Object.fromEntries(Object.entries(payload).filter(([, value]) => Number.isFinite(value) || typeof value === 'boolean' || typeof value === 'string')),
    })
  } catch (error) {
    console.error('Health Shortcut import failed', error)
    sendJson(res, 500, { error: 'The Shortcut health data could not be imported.' })
  }
}

function parsePayload(body) {
  const unwrapped = unwrap(body)
  if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
    return normalizeObject(unwrapped)
  }

  const text = String(unwrapped || '')
  const output = { date: extractDate(text) || today() }
  for (const [key, aliases, kind] of fields) {
    const raw = findTextValue(text, aliases)
    const parsed = convert(raw?.number, raw?.unit, kind)
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
    } catch {
      return body
    }
  }
  if (body && typeof body === 'object') return body.payload ?? body.text ?? body.data ?? body
  return body
}

function normalizeObject(object) {
  const output = { date: extractDate(object.date || object.day) || today() }
  for (const [key, aliases, kind] of fields) {
    const entry = findObjectValue(object, aliases)
    const number = typeof entry === 'object' ? entry?.value ?? entry?.amount ?? entry?.quantity : entry
    const unit = typeof entry === 'object' ? entry?.unit : ''
    const parsed = convert(parseNumber(number), unit, kind)
    if (Number.isFinite(parsed)) output[key] = parsed
  }
  return output
}

function findObjectValue(object, aliases) {
  const wanted = new Set(aliases.map(normalizeKey))
  for (const [key, value] of Object.entries(object || {})) {
    if (wanted.has(normalizeKey(key))) return value
  }
  return null
}

function findTextValue(text, aliases) {
  const normalized = String(text).replace(/[\u00A0\u202F]/g, ' ').replace(/[−–—]/g, '-')
  const aliasPattern = aliases.map(escapeRegex).join('|')
  const number = '[-+]?\\d{1,3}(?:[ ,]\\d{3})*(?:[.,]\\d+)?|[-+]?\\d+(?:[.,]\\d+)?'
  const unit = '(?:kcal|cal|kilocalories?|kj|minutes?|mins?|min|hours?|hrs?|hr|h|seconds?|secs?|sec|s|steps?|mi|miles?|km|kilometers?|m|meters?|yd|yards?|ft|feet|bpm|ms|milliseconds?|breaths?\\s*(?:/|per)\\s*min(?:ute)?|ml\\s*(?:/|per)\\s*kg\\s*(?:/|per)\\s*min(?:ute)?)?'
  const regex = new RegExp(`(?:${aliasPattern})\\s*[:=]?\\s*(?:\\n\\s*)?(${number})\\s*(${unit})`, 'i')
  const match = normalized.match(regex)
  return match ? { number: parseNumber(match[1]), unit: match[2] || '' } : null
}

function convert(number, rawUnit, kind) {
  if (!Number.isFinite(number)) return null
  const unit = String(rawUnit || '').toLowerCase().replace(/\s+/g, '')
  if (kind === 'energy') {
    if (unit === 'kj') return number / 4.184
    return number
  }
  if (kind === 'minutes') {
    if (unit === 'h' || unit.startsWith('hr') || unit.startsWith('hour')) return number * 60
    if (unit === 's' || unit.startsWith('sec')) return number / 60
    return number
  }
  if (kind === 'hours') {
    if (unit.startsWith('min')) return number / 60
    if (unit === 's' || unit.startsWith('sec')) return number / 3600
    return number
  }
  if (kind === 'miles') {
    if (unit === 'km' || unit.startsWith('kilometer')) return number * 0.621371
    if (unit === 'm' || unit.startsWith('meter')) return number / 1609.344
    if (unit === 'yd' || unit.startsWith('yard')) return number / 1760
    if (unit === 'ft' || unit === 'feet') return number / 5280
    return number
  }
  if (kind === 'yards') {
    if (unit === 'm' || unit.startsWith('meter')) return number * 1.09361
    if (unit === 'km' || unit.startsWith('kilometer')) return number * 1093.61
    if (unit === 'mi' || unit.startsWith('mile')) return number * 1760
    if (unit === 'ft' || unit === 'feet') return number / 3
    return number
  }
  if (kind === 'milliseconds' && (unit === 's' || unit.startsWith('sec'))) return number * 1000
  return number
}

async function writeSwimmingDistance(session, date, yards) {
  const range = "'Health Daily'!A1:O1000"
  const response = await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${MLOG_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`)
  const rows = response.values || []
  const header = rows[0] || []
  const dateIndex = Math.max(0, header.findIndex((value) => normalizeKey(value) === 'date'))
  let swimIndex = header.findIndex((value) => normalizeKey(value) === 'swimmingdistanceyd')
  if (swimIndex < 0) swimIndex = 14

  const rowIndex = rows.findIndex((row, index) => index > 0 && normalizeSheetDate(row[dateIndex]) === date)
  const targetRow = rowIndex >= 0 ? rowIndex + 1 : rows.length + 1
  const data = []
  if (header[swimIndex] !== 'Swimming Distance (yd)') {
    data.push({ range: `'Health Daily'!${columnLetter(swimIndex + 1)}1`, values: [['Swimming Distance (yd)']] })
  }
  data.push({ range: `'Health Daily'!${columnLetter(swimIndex + 1)}${targetRow}`, values: [[Math.round(yards * 10) / 10]] })

  await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${MLOG_SPREADSHEET_ID}/values:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  })
}

function normalizeSheetDate(value) {
  if (typeof value === 'number' && value > 20000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10)
  return extractDate(value)
}

function extractDate(value) {
  const direct = String(value || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (direct) return direct[1]
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(parsed)
}

function parseNumber(value) {
  if (typeof value === 'number') return value
  let text = String(value || '').trim().replace(/[−–—]/g, '-').replace(/[\u00A0\u202F]/g, ' ')
  text = text.replace(/(?<=\d)[ ,](?=\d{3}(?:\D|$))/g, '')
  if (/^-?\d+,\d+$/.test(text) && !/^-?\d{1,3},\d{3}$/.test(text)) text = text.replace(',', '.')
  else text = text.replace(/,/g, '')
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function columnLetter(number) {
  let result = ''
  let value = number
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}
