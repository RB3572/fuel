import crypto from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

const HEALTH_HEADERS = [
  'Date', 'Active Energy (kcal)', 'Resting Energy (kcal)', 'Total Expenditure (kcal)',
  'Exercise Time (min)', 'Step Count', 'Distance (mi)', 'Resting HR (bpm)', 'HRV (ms)',
  'VO2 Max', 'Sleep (hr)', 'Respiratory Rate', 'Partial Day', 'Source',
]

const RECOVERY_HEADERS = [
  'Date', 'Sleep (hr)', 'Sleep Quality (1-10)', 'Energy (1-10)', 'Hunger (1-10)',
  'Soreness (1-10)', 'Resting HR', 'Notes', 'HRV', 'Respiratory Rate',
  'Sleep Core (hr)', 'Sleep Deep (hr)', 'Sleep REM (hr)',
]

const ENERGY_HEADERS = [
  'Date', 'Calories Consumed', 'Resting Energy', 'Active Energy', 'Total Expenditure',
  'Net Balance', 'Status', 'Running Net Balance', 'Assumptions / Notes', 'Protein (g)',
  'Sleep (hr)', 'Protein Score', 'Energy Balance Score', 'Sleep Score',
  'Training Fuel Score', 'Fuel Status',
]

export function verifyImportToken(req) {
  const expected = process.env.HEALTH_IMPORT_TOKEN
  if (!expected) return { ok: false, status: 503, error: 'Health import is not configured.' }

  const header = String(req.headers.authorization || '')
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!supplied || !safeEqual(supplied, expected)) {
    return { ok: false, status: 401, error: 'Invalid bearer token.' }
  }
  return { ok: true }
}

export async function importHealthPayload(payload) {
  const spreadsheetId = process.env.MLOG_SPREADSHEET_ID
  if (!spreadsheetId) throw new Error('MLOG_SPREADSHEET_ID is not configured')

  const records = normalizeEnvelope(payload)
  if (!records.length) {
    return { imported: 0, dates: [], warning: 'No recognizable daily health records were found.' }
  }

  const accessToken = await getGoogleAccessToken()
  const [healthRows, recoveryRows, energyRows] = await Promise.all([
    readValues(accessToken, spreadsheetId, "'Health Daily'!A1:N1000"),
    readValues(accessToken, spreadsheetId, "'Recovery'!A1:M1000"),
    readValues(accessToken, spreadsheetId, "'Energy Balance'!A1:P1000"),
  ])

  const normalized = records.map(normalizeRecord).filter((record) => record.date && hasHealthData(record))
  if (!normalized.length) {
    return { imported: 0, dates: [], warning: 'Records were present, but none contained usable health values.' }
  }

  const updates = []
  for (const record of dedupeByDate(normalized)) {
    updates.push(upsertRequest('Health Daily', HEALTH_HEADERS, healthRows, healthRow(record), true))
    updates.push(upsertRequest('Recovery', RECOVERY_HEADERS, recoveryRows, recoveryRow(record), true))
    updates.push(upsertRequest('Energy Balance', ENERGY_HEADERS, energyRows, energyRow(record), true))
  }

  await batchWrite(accessToken, spreadsheetId, updates.filter(Boolean))

  return {
    imported: dedupeByDate(normalized).length,
    dates: dedupeByDate(normalized).map((record) => record.date),
  }
}

function normalizeEnvelope(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []

  for (const key of ['records', 'days', 'data', 'entries', 'samples', 'results']) {
    if (Array.isArray(payload[key])) return payload[key]
  }

  const candidates = Object.values(payload).filter(Array.isArray)
  const likely = candidates.find((items) => items.some((item) => item && typeof item === 'object' && findValue(item, ['date', 'day', 'startDate', 'start_date'])))
  if (likely) return likely

  if (findValue(payload, ['date', 'day', 'startDate', 'start_date'])) return [payload]
  return []
}

function normalizeRecord(record) {
  const date = normalizeDate(findValue(record, ['date', 'day', 'startDate', 'start_date', 'calendarDate']))
  const active = numberValue(findValue(record, ['activeEnergy', 'active_energy', 'activeCalories', 'active_energy_kcal', 'activeEnergyBurned']))
  const resting = numberValue(findValue(record, ['restingEnergy', 'resting_energy', 'basalEnergy', 'basal_energy', 'restingCalories']))
  const total = numberValue(findValue(record, ['totalExpenditure', 'total_energy', 'totalEnergy', 'energyExpenditure'])) ?? sumNullable(active, resting)

  return {
    date,
    active,
    resting,
    total,
    exerciseMinutes: numberValue(findValue(record, ['exerciseTime', 'exerciseMinutes', 'appleExerciseTime', 'workoutMinutes'])),
    steps: numberValue(findValue(record, ['stepCount', 'steps', 'step_count'])),
    distanceMiles: distanceToMiles(findValue(record, ['walkingRunningDistance', 'distance', 'distanceMiles', 'walking_distance'])),
    restingHeartRate: numberValue(findValue(record, ['restingHeartRate', 'resting_hr', 'restingPulse'])),
    hrv: numberValue(findValue(record, ['heartRateVariability', 'hrv', 'hrvSdnn', 'heart_rate_variability'])),
    vo2Max: numberValue(findValue(record, ['vo2Max', 'vo2max', 'cardioFitness'])),
    respiratoryRate: numberValue(findValue(record, ['respiratoryRate', 'respirationRate', 'breathingRate'])),
    sleep: hoursValue(findValue(record, ['sleepTotal', 'sleepDuration', 'sleep', 'asleepDuration', 'timeAsleep'])),
    sleepCore: hoursValue(findValue(record, ['sleepCore', 'coreSleep', 'coreDuration'])),
    sleepDeep: hoursValue(findValue(record, ['sleepDeep', 'deepSleep', 'deepDuration'])),
    sleepRem: hoursValue(findValue(record, ['sleepREM', 'sleepRem', 'remSleep', 'remDuration'])),
    partial: booleanValue(findValue(record, ['partialDay', 'partial', 'isPartial', 'incomplete'])) ?? isToday(date),
  }
}

function hasHealthData(record) {
  return [
    record.active, record.resting, record.total, record.exerciseMinutes, record.steps,
    record.distanceMiles, record.restingHeartRate, record.hrv, record.vo2Max,
    record.respiratoryRate, record.sleep, record.sleepCore, record.sleepDeep, record.sleepRem,
  ].some((value) => Number.isFinite(value))
}

function healthRow(record) {
  return [
    record.date, record.active, record.resting, record.total, record.exerciseMinutes,
    record.steps, record.distanceMiles, record.restingHeartRate, record.hrv, record.vo2Max,
    record.sleep, record.respiratoryRate, record.partial ? 'Yes' : 'No', 'Apple Shortcuts API',
  ]
}

function recoveryRow(record) {
  return [
    record.date, record.sleep, '', '', '', '', record.restingHeartRate,
    'Automatically synchronized from Apple Shortcuts.', record.hrv, record.respiratoryRate,
    record.sleepCore, record.sleepDeep, record.sleepRem,
  ]
}

function energyRow(record) {
  return [
    record.date, '', record.resting, record.active, record.total, '', '', '',
    record.partial
      ? 'Apple Shortcuts sync. Current day is partial; balance is intentionally left blank.'
      : 'Apple Shortcuts sync.',
    '', record.sleep, '', '', '', '', '',
  ]
}

function upsertRequest(sheet, headers, existingRows, incoming, preserveExisting = false) {
  const rows = existingRows.length ? existingRows : [headers]
  const date = incoming[0]
  let index = rows.findIndex((row, rowIndex) => rowIndex > 0 && normalizeDate(row[0]) === date)
  if (index < 0) index = rows.length

  let values = incoming
  if (preserveExisting && rows[index]) {
    values = headers.map((_, columnIndex) => incoming[columnIndex] === '' || incoming[columnIndex] == null
      ? (rows[index][columnIndex] ?? '')
      : incoming[columnIndex])
  }

  return {
    range: `'${sheet}'!A${index + 1}:${columnLetter(headers.length)}${index + 1}`,
    majorDimension: 'ROWS',
    values: [values.map((value) => value ?? '')],
  }
}

async function getGoogleAccessToken() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return serviceAccountToken()
  if (process.env.GOOGLE_REFRESH_TOKEN) return refreshTokenAccess()
  throw new Error('Configure GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_REFRESH_TOKEN for unattended imports')
}

async function serviceAccountToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claim}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).end().sign(credentials.private_key)
  return exchangeAssertion(`${unsigned}.${base64url(signature)}`)
}

async function exchangeAssertion(assertion) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Service-account token exchange failed')
  return payload.access_token
}

async function refreshTokenAccess() {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google refresh-token exchange failed')
  return payload.access_token
}

async function readValues(token, spreadsheetId, range) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message || 'Unable to read MLog')
  return payload.values || []
}

async function batchWrite(token, spreadsheetId, data) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message || 'Unable to update MLog')
  return payload
}

function findValue(object, aliases) {
  const wanted = new Set(aliases.map(normalizeKey))
  const queue = [object]
  while (queue.length) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key))) return value
      if (value && typeof value === 'object' && !Array.isArray(value)) queue.push(value)
    }
  }
  return null
}

function numberValue(value) {
  if (value == null || value === '') return null
  if (typeof value === 'object') return numberValue(value.value ?? value.qty ?? value.quantity ?? value.amount ?? value.sum ?? value.avg)
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function hoursValue(value) {
  if (value == null) return null
  const amount = numberValue(value)
  if (amount == null) return null
  const unit = typeof value === 'object' ? String(value.unit || '').toLowerCase() : ''
  if (unit.includes('min')) return amount / 60
  if (unit.includes('sec')) return amount / 3600
  if (unit.includes('hour') || unit === 'hr' || unit === 'h') return amount
  return amount > 24 ? amount / 3600 : amount
}

function distanceToMiles(value) {
  const amount = numberValue(value)
  if (amount == null) return null
  const unit = typeof value === 'object' ? String(value.unit || '').toLowerCase() : ''
  if (unit === 'km' || unit.includes('kilometer')) return amount * 0.621371
  if (unit === 'm' || unit.includes('meter')) return amount / 1609.344
  return amount
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (/^(yes|true|1)$/i.test(value)) return true
    if (/^(no|false|0)$/i.test(value)) return false
  }
  return null
}

function normalizeDate(value) {
  if (!value) return ''
  const text = typeof value === 'object' ? String(value.value || value.date || '') : String(value)
  const direct = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct) return direct[1]
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function isToday(date) {
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  return date === now
}

function dedupeByDate(records) {
  const map = new Map()
  for (const record of records) map.set(record.date, record)
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function sumNullable(a, b) {
  return a == null || b == null ? null : a + b
}

function safeEqual(a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function columnLetter(count) {
  let result = ''
  let value = count
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}
