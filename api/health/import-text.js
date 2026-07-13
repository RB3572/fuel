import { decryptJson } from '../_lib/crypto.js'
import { refreshSession } from '../_lib/google.js'
import { importHealthPayload } from '../_lib/health-import.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const MLOG_SPREADSHEET_ID = '1XWOQPqQJ4pbN93tQty-jDuiqv7_8CgEfNPVTD0k8MIs'
const TOKEN_KIND = 'fuel-health-import'
const PARSER_VERSION = 5
const TIME_ZONE = 'America/Los_Angeles'

const METRICS = [
  { key: 'activeEnergy', aliases: ['activeEnergy', 'active energy', 'active calories', 'activeEnergyBurned'], mode: 'sum', kind: 'energy', datePolicy: 'day', min: 0, max: 6000, sampleMax: 2000 },
  { key: 'restingEnergy', aliases: ['restingEnergy', 'resting energy', 'restingEnergyBurned', 'basalEnergy', 'basal energy', 'basal energy burned'], mode: 'sum', kind: 'energy', datePolicy: 'day', min: 0, max: 6000, sampleMax: 2500 },
  { key: 'exerciseMinutes', aliases: ['exerciseMinutes', 'exercise minutes', 'exerciseTime', 'appleExerciseTime', 'apple exercise time'], mode: 'sum', kind: 'durationMinutes', datePolicy: 'day', min: 0, max: 1440, sampleMax: 1440 },
  { key: 'steps', aliases: ['steps', 'stepCount', 'step count'], mode: 'sum', kind: 'count', datePolicy: 'day', min: 0, max: 150000, sampleMax: 100000 },
  { key: 'walkingRunningDistance', aliases: ['walkingrunDistance', 'walkingRunningDistance', 'walking running distance', 'walking + running distance', 'distanceWalkingRunning'], mode: 'sum', kind: 'distanceMiles', datePolicy: 'day', min: 0, max: 150, sampleMax: 100 },
  { key: 'swimmingDistance', aliases: ['swimDistance', 'swimmingDistance', 'swim distance', 'swimming distance'], mode: 'sum', kind: 'distanceYards', datePolicy: 'day', min: 0, max: 50000, sampleMax: 50000 },
  { key: 'restingHeartRate', aliases: ['restingHeartRate', 'resting heart rate', 'restingHR'], mode: 'latest', kind: 'heartRate', datePolicy: 'day', min: 20, max: 250, sampleMax: 250 },
  { key: 'heartRateVariability', aliases: ['HRV', 'heartRateVariability', 'heart rate variability', 'heartRateVariabilitySDNN', 'heart rate variability sdnn'], mode: 'average', kind: 'milliseconds', datePolicy: 'day', min: 0, max: 1000, sampleMax: 1000 },
  { key: 'respiratoryRate', aliases: ['respiratoryRate', 'respiratory rate', 'breathingRate'], mode: 'average', kind: 'rate', datePolicy: 'day', min: 3, max: 80, sampleMax: 80 },
  { key: 'vo2Max', aliases: ['cardioFitness', 'cardio fitness', 'vo2Max', 'VO2 Max', 'vo₂ max'], mode: 'latest', kind: 'vo2', datePolicy: 'latestAny', min: 5, max: 100, sampleMax: 100 },
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const token = bearerToken(req)
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
    const incoming = unwrapBody(req.body)
    const parsedInput = coercePayload(incoming)
    const { normalized, diagnostics } = normalizePayload(parsedInput)

    if (!hasHealthValues(normalized)) {
      sendJson(res, 422, {
        error: 'Fuel received the Shortcut payload but found no usable health measurements.',
        parserVersion: PARSER_VERSION,
        receivedKeys: objectKeys(parsedInput),
        diagnostics,
      })
      return
    }

    process.env.MLOG_SPREADSHEET_ID = MLOG_SPREADSHEET_ID
    process.env.GOOGLE_REFRESH_TOKEN = session.tokens.refreshToken

    const result = await importHealthPayload(normalized)
    sendJson(res, 200, {
      ok: true,
      ...result,
      parserVersion: PARSER_VERSION,
      parsed: parsedSummary(normalized),
      missingMetrics: diagnostics.missingMetrics,
      rejectedMetrics: diagnostics.rejectedMetrics,
      sampleCounts: diagnostics.selectedSampleCounts,
      datedSampleCounts: diagnostics.datedSampleCounts,
      sectionDiagnostics: diagnostics.sectionDiagnostics,
    })
  } catch (error) {
    console.error('Shortcut text health import failed', error instanceof Error ? error.message : 'Unknown error')
    sendJson(res, 500, { error: 'The Shortcut health text could not be imported.' })
  }
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
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
    try { return JSON.parse(candidate) } catch { /* continue */ }
  }
  return parseDictionaryText(text)
}

function parseDictionaryText(text) {
  const result = {}
  const directDate = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
  if (directDate) result.date = directDate

  const markers = []
  const definitions = [{ key: 'sleep', aliases: ['sleep', 'sleep samples', 'sleep analysis'] }, ...METRICS]
  for (const definition of definitions) {
    for (const alias of definition.aliases) {
      const patterns = [
        new RegExp(`(^|[\\n\\r,{;])\\s*["']?${escapeRegex(alias)}["']?\\s*[:=]`, 'ig'),
        new RegExp(`(^|[\\n\\r])\\s*${escapeRegex(alias)}\\s*(?:\\n|$)`, 'ig'),
      ]
      for (const regex of patterns) {
        let match
        while ((match = regex.exec(text))) {
          markers.push({ key: definition.key, markerStart: match.index, contentStart: match.index + match[0].length })
        }
      }
    }
  }

  markers.sort((a, b) => a.markerStart - b.markerStart || b.contentStart - a.contentStart)
  const unique = markers.filter((marker, index) => index === 0 || marker.markerStart !== markers[index - 1].markerStart)
  for (let index = 0; index < unique.length; index += 1) {
    const marker = unique[index]
    const end = unique[index + 1]?.markerStart ?? text.length
    const section = text.slice(marker.contentStart, end).trim().replace(/[},;]+\s*$/, '')
    if (section) result[marker.key] = section
  }
  return result
}

function normalizePayload(payload) {
  if (Array.isArray(payload)) payload = payload[0] || {}
  if (!payload || typeof payload !== 'object') payload = {}

  const targetDate = dateValue(get(payload, ['date', 'day'])) || today()
  const values = {}
  const rejectedMetrics = []
  const selectedSampleCounts = {}
  const datedSampleCounts = {}
  const sectionDiagnostics = {}

  for (const rule of METRICS) {
    const source = get(payload, rule.aliases)
    const all = collectMeasurements(source, rule)
    const selected = selectMeasurements(all, rule, targetDate)
    selectedSampleCounts[rule.key] = selected.length
    datedSampleCounts[rule.key] = all.filter((item) => item.time > 0).length
    sectionDiagnostics[rule.key] = describeSection(source)

    const rawValue = aggregate(selected, rule.mode)
    if (rawValue == null) values[rule.key] = null
    else if (rawValue < rule.min || rawValue > rule.max) {
      values[rule.key] = null
      rejectedMetrics.push({ metric: rule.key, value: round(rawValue), reason: `outside ${rule.min}-${rule.max}` })
    } else values[rule.key] = rawValue
  }

  const sleepSource = get(payload, ['sleep', 'sleepSamples'])
  const sleep = sleepSummary(sleepSource, targetDate)
  sectionDiagnostics.sleep = describeSection(sleepSource)

  const normalized = {
    date: targetDate,
    activeEnergy: values.activeEnergy,
    restingEnergy: values.restingEnergy,
    totalExpenditure: values.activeEnergy == null || values.restingEnergy == null ? null : values.activeEnergy + values.restingEnergy,
    exerciseMinutes: values.exerciseMinutes,
    steps: values.steps,
    walkingRunningDistance: values.walkingRunningDistance,
    swimmingDistance: values.swimmingDistance,
    restingHeartRate: values.restingHeartRate,
    heartRateVariability: values.heartRateVariability,
    respiratoryRate: values.respiratoryRate,
    vo2Max: values.vo2Max,
    sleepTotal: bounded(sleep.total, 0, 24),
    sleepCore: bounded(sleep.core, 0, 24),
    sleepDeep: bounded(sleep.deep, 0, 24),
    sleepREM: bounded(sleep.rem, 0, 24),
    sleepAwake: bounded(sleep.awake, 0, 24),
    partialDay: true,
  }

  const expected = ['activeEnergy', 'restingEnergy', 'exerciseMinutes', 'steps', 'walkingRunningDistance', 'restingHeartRate', 'heartRateVariability', 'respiratoryRate', 'vo2Max', 'sleepTotal']
  const missingMetrics = expected.filter((key) => !Number.isFinite(normalized[key]))
  return { normalized, diagnostics: { missingMetrics, rejectedMetrics, selectedSampleCounts, datedSampleCounts, sectionDiagnostics } }
}

function collectMeasurements(value, rule, inheritedUnit = '') {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return dedupeMeasurements(value.flatMap((item) => collectMeasurements(item, rule, inheritedUnit)))

  if (typeof value === 'number') {
    const converted = convert(value, inheritedUnit, rule.kind)
    return validSample(converted, rule) ? [{ number: converted, time: 0, fingerprint: `${converted}|${inheritedUnit}` }] : []
  }

  if (typeof value === 'object') {
    const unit = String(get(value, ['unit', 'measurementUnit', 'quantityTypeUnit']) || inheritedUnit || '')
    for (const alias of ['samples', 'values', 'items', 'data', 'results']) {
      const nested = get(value, [alias])
      if (nested != null) return collectMeasurements(nested, rule, unit)
    }
    const nested = get(value, ['value', 'quantity', 'amount', 'sum', 'average', 'avg', 'doubleValue', 'numericValue'])
    if (nested != null && nested !== value) {
      const measurements = collectMeasurements(nested, rule, unit)
      const start = String(get(value, ['startDate', 'start', 'from']) || '')
      const end = String(get(value, ['endDate', 'end', 'to']) || '')
      const source = String(get(value, ['source', 'sourceName', 'device']) || '')
      return measurements.map((item) => ({ ...item, time: parseTime(end || start) || item.time, fingerprint: `${item.number}|${unit}|${start}|${end}|${source}` }))
    }
    return parseTextMeasurements(JSON.stringify(value), rule)
  }

  return parseTextMeasurements(String(value), rule)
}

function parseTextMeasurements(text, rule) {
  const source = normalizeText(String(text))
  const measurements = []
  const unitPattern = '(kilocalories?|kcal|calories?|cal|kilojoules?|kj|joules?|j|steps?|count(?:\\s*(?:/|per)\\s*min(?:ute)?)?|beats?\\s*(?:/|per)\\s*min(?:ute)?|breaths?\\s*(?:/|per)\\s*min(?:ute)?|bpm|milliseconds?|msecs?|ms|seconds?|secs?|sec|s|m[lL]\\s*(?:/|per|·)\\s*(?:kg|kilogram)(?:\\s*(?:/|per|·)\\s*min(?:ute)?)?|mi|miles?|km|kilometers?|metres?|meters?|m|yd|yards?|ft|feet|hours?|hrs?|hr|h|minutes?|mins?|min)'
  const numberPattern = '[-+−]?\\d{1,3}(?:[ ,\\u00A0\\u202F]\\d{3})*(?:[.,]\\d+)?|[-+−]?\\d+(?:[.,]\\d+)?'
  const after = new RegExp(`(${numberPattern})\\s*${unitPattern}`, 'gi')
  const before = new RegExp(`${unitPattern}\\s*[:=]?\\s*(${numberPattern})`, 'gi')

  for (const regex of [after, before]) {
    for (const match of source.matchAll(regex)) {
      const numberIndex = regex === after ? 1 : 2
      const unitIndex = regex === after ? 2 : 1
      const number = parseNumericText(match[numberIndex])
      const converted = convert(number, match[unitIndex], rule.kind)
      if (!validSample(converted, rule)) continue
      measurements.push({ number: converted, time: contextTime(source, match.index || 0), fingerprint: contextFingerprint(source, match.index || 0, converted, match[unitIndex]) })
    }
  }

  if (!measurements.length) {
    const labeled = new RegExp(`(?:value|quantity|amount|total|sum|doubleValue|numericValue)\\s*[:=]\\s*["']?(${numberPattern})`, 'gi')
    for (const match of source.matchAll(labeled)) {
      const converted = convert(parseNumericText(match[1]), '', rule.kind)
      if (validSample(converted, rule)) measurements.push({ number: converted, time: contextTime(source, match.index || 0), fingerprint: contextFingerprint(source, match.index || 0, converted, '') })
    }
  }

  if (!measurements.length) {
    const cleaned = stripTemporalNoise(source)
    for (const match of cleaned.matchAll(new RegExp(numberPattern, 'g'))) {
      const converted = convert(parseNumericText(match[0]), '', rule.kind)
      if (validSample(converted, rule)) measurements.push({ number: converted, time: 0, fingerprint: `${converted}|fallback|${match.index}` })
    }
  }
  return dedupeMeasurements(measurements)
}

function convert(number, rawUnit, kind) {
  if (!Number.isFinite(number)) return null
  const unit = normalizeUnit(rawUnit)

  if (kind === 'energy') {
    if (!unit || ['kcal', 'kilocalorie', 'kilocalories', 'calorie', 'calories', 'cal'].includes(unit)) return number
    if (unit === 'kj' || unit.startsWith('kilojoule')) return number / 4.184
    if (unit === 'j' || unit.startsWith('joule')) return number / 4184
    return null
  }
  if (kind === 'durationMinutes') {
    if (!unit || unit.startsWith('min')) return number
    if (unit === 's' || unit.startsWith('sec')) return number / 60
    if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit.startsWith('hour')) return number * 60
    return null
  }
  if (kind === 'count') return !unit || unit.startsWith('step') || unit === 'count' ? number : null
  if (kind === 'distanceMiles') {
    if (!unit || unit === 'mi' || unit.startsWith('mile')) return number
    if (unit === 'km' || unit.startsWith('kilometer')) return number * 0.621371
    if (unit === 'm' || unit.startsWith('meter') || unit.startsWith('metre')) return number / 1609.344
    if (unit === 'yd' || unit.startsWith('yard')) return number / 1760
    if (unit === 'ft' || unit === 'feet') return number / 5280
    return null
  }
  if (kind === 'distanceYards') {
    if (!unit || unit === 'yd' || unit.startsWith('yard')) return number
    if (unit === 'm' || unit.startsWith('meter') || unit.startsWith('metre')) return number * 1.09361
    if (unit === 'km' || unit.startsWith('kilometer')) return number * 1093.61
    if (unit === 'mi' || unit.startsWith('mile')) return number * 1760
    if (unit === 'ft' || unit === 'feet') return number / 3
    return null
  }
  if (kind === 'heartRate') return !unit || unit === 'bpm' || unit.includes('beat') || unit.includes('count') ? number : null
  if (kind === 'milliseconds') {
    if (!unit || unit === 'ms' || unit.startsWith('millisecond') || unit.startsWith('msec')) return number
    if (unit === 's' || unit.startsWith('sec')) return number * 1000
    return null
  }
  if (kind === 'rate') return !unit || unit === 'bpm' || unit.includes('breath') || unit.includes('count') ? number : null
  if (kind === 'vo2') return !unit || unit.includes('ml') ? number : null
  return number
}

function selectMeasurements(measurements, rule, targetDate) {
  if (!measurements.length || rule.datePolicy === 'latestAny') return measurements
  const dated = measurements.filter((item) => item.time > 0)
  if (!dated.length) return measurements
  return dated.filter((item) => localDate(item.time) === targetDate)
}

function aggregate(measurements, mode) {
  if (!measurements.length) return null
  const ordered = [...measurements].sort((a, b) => a.time - b.time)
  if (mode === 'latest') return ordered.at(-1).number
  if (mode === 'average') return ordered.reduce((sum, item) => sum + item.number, 0) / ordered.length
  return ordered.reduce((sum, item) => sum + item.number, 0)
}

function sleepSummary(value, targetDate) {
  const output = { total: null, core: null, deep: null, rem: null, awake: null }
  if (value == null) return output
  const text = typeof value === 'string' ? normalizeText(value) : JSON.stringify(value)
  let intervals = parseSleepIntervals(text)
  if (intervals.length) {
    const target = intervals.filter((item) => localDate(item.end) === targetDate)
    if (target.length) intervals = target
    const stages = ['awake', 'deep', 'rem', 'core']
    for (const stage of stages) output[stage] = durationHours(mergeIntervals(intervals.filter((item) => item.stage === stage)))
    output.total = durationHours(mergeIntervals(intervals.filter((item) => item.stage !== 'awake')))
    return output
  }

  const durationRegex = /([-+−]?\d+(?:[.,]\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|seconds?|secs?|sec|s)\b/gi
  const durations = []
  for (const match of stripTemporalNoise(text).matchAll(durationRegex)) {
    const unit = normalizeUnit(match[2])
    let amount = parseNumericText(match[1])
    if (unit === 's' || unit.startsWith('sec')) amount /= 3600
    else if (unit.startsWith('min')) amount /= 60
    if (amount >= 0 && amount <= 24) durations.push(amount)
  }
  if (durations.length) output.total = durations.reduce((sum, item) => sum + item, 0)
  return output
}

function parseSleepIntervals(text) {
  const intervals = []
  const chunks = String(text).split(/\n+|(?<=\})\s*,\s*(?=\{)/)
  for (const chunk of chunks) {
    const times = extractDateTimes(chunk)
    if (times.length < 2) continue
    const start = times[0].time
    const end = times[1].time
    if (end > start && end - start <= 24 * 3600000) intervals.push({ stage: detectSleepStage(chunk), start, end })
  }
  return dedupeIntervals(intervals)
}

function detectSleepStage(text) {
  const match = String(text).match(/\b(awake|core|deep|rem|asleep)\b/i)
  return match ? match[1].toLowerCase() : 'asleep'
}

function extractDateTimes(text) {
  const patterns = [
    /20\d{2}-\d{2}-\d{2}[T ][0-9:.+-Z]+/gi,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi,
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi,
  ]
  const found = []
  for (const pattern of patterns) {
    for (const match of String(text).matchAll(pattern)) {
      const time = parseTime(match[0].replace(/\sat\s/i, ' '))
      if (time) found.push({ raw: match[0], time, index: match.index || 0 })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

function contextTime(text, index) {
  const start = Math.max(0, index - 260)
  const times = extractDateTimes(text.slice(start, Math.min(text.length, index + 260)))
  if (!times.length) return 0
  const relative = index - start
  times.sort((a, b) => Math.abs(a.index - relative) - Math.abs(b.index - relative))
  return times[0].time
}

function describeSection(value) {
  if (value == null) return { present: false, length: 0, numberTokens: 0, unitTokens: [] }
  const text = typeof value === 'string' ? normalizeText(value) : JSON.stringify(value)
  const numberTokens = text.match(/[-+−]?\d+(?:[.,]\d+)?/g)?.length || 0
  const unitTokens = [...new Set((text.match(/\b(?:kcal|cal|kj|steps?|bpm|ms|mi|km|meters?|metres?|yards?|yd|minutes?|mins?|hours?|hrs?|breaths?|beats?)\b/gi) || []).map(normalizeUnit))].slice(0, 12)
  return { present: true, length: text.length, numberTokens, unitTokens }
}

function normalizeText(value) {
  return String(value)
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\u2212/g, '-')
}

function parseNumericText(value) {
  let text = normalizeText(value).trim().replace(/^\+/, '')
  text = text.replace(/(?<=\d)[ ,](?=\d{3}(?:\D|$))/g, '')
  if (/^[-+]?\d+,\d+$/.test(text) && !/^[-+]?\d{1,3},\d{3}$/.test(text)) text = text.replace(',', '.')
  else text = text.replace(/,/g, '')
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

function stripTemporalNoise(text) {
  return String(text)
    .replace(/20\d{2}-\d{2}-\d{2}[T ][0-9:.+-Z]+/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ' ')
}

function mergeIntervals(intervals) {
  const sorted = intervals.map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start || a.end - b.end)
  const merged = []
  for (const interval of sorted) {
    const last = merged.at(-1)
    if (!last || interval.start > last.end) merged.push({ ...interval })
    else last.end = Math.max(last.end, interval.end)
  }
  return merged
}

function dedupeIntervals(intervals) {
  return [...new Map(intervals.map((item) => [`${item.stage}|${item.start}|${item.end}`, item])).values()]
}

function durationHours(intervals) {
  if (!intervals.length) return null
  return intervals.reduce((sum, item) => sum + (item.end - item.start) / 3600000, 0)
}

function dedupeMeasurements(measurements) {
  return [...new Map(measurements.map((item) => [item.fingerprint || `${round(item.number)}|${item.time || 0}`, item])).values()]
}

function validSample(value, rule) {
  return Number.isFinite(value) && value >= 0 && value <= rule.sampleMax
}

function contextFingerprint(text, index, number, unit) {
  const window = text.slice(Math.max(0, index - 120), Math.min(text.length, index + 120)).replace(/\s+/g, ' ').trim()
  return `${round(number)}|${normalizeUnit(unit)}|${window}`
}

function normalizeUnit(value) {
  return normalizeText(value).trim().toLowerCase().replace(/\s+/g, '').replace(/per/g, '/').replace(/·/g, '/')
}

function get(object, aliases) {
  if (!object || typeof object !== 'object') return null
  const wanted = new Set(aliases.map(normalizeKey))
  for (const [key, value] of Object.entries(object)) if (wanted.has(normalizeKey(key))) return value
  return null
}

function parseTime(value) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function localDate(time) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date(time))
}

function dateValue(value) {
  if (!value) return ''
  const direct = String(value).match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (direct) return direct[1]
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date)
}

function hasHealthValues(record) {
  return ['activeEnergy', 'restingEnergy', 'exerciseMinutes', 'steps', 'walkingRunningDistance', 'swimmingDistance', 'restingHeartRate', 'heartRateVariability', 'respiratoryRate', 'vo2Max', 'sleepTotal', 'sleepCore', 'sleepDeep', 'sleepREM', 'sleepAwake'].some((key) => Number.isFinite(record[key]))
}

function parsedSummary(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => Number.isFinite(value) || typeof value === 'boolean').map(([key, value]) => [key, Number.isFinite(value) ? round(value) : value]))
}

function bounded(value, min, max) { return Number.isFinite(value) && value >= min && value <= max ? value : null }
function round(value) { return Math.round(value * 1000) / 1000 }
function decodeMaybe(value) { try { return decodeURIComponent(value) } catch { return value } }
function objectKeys(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 30) : [] }
function normalizeKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '') }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date()) }
