import { decryptJson } from '../_lib/crypto.js'
import { refreshSession } from '../_lib/google.js'
import { importHealthPayload } from '../_lib/health-import.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const MLOG_SPREADSHEET_ID = '1XWOQPqQJ4pbN93tQty-jDuiqv7_8CgEfNPVTD0k8MIs'
const TOKEN_KIND = 'fuel-health-import'
const PARSER_VERSION = 4
const TIME_ZONE = 'America/Los_Angeles'

const METRICS = [
  { key: 'activeEnergy', aliases: ['activeEnergy', 'active energy', 'activeCalories'], mode: 'sum', kind: 'energy', datePolicy: 'day', min: 0, max: 6000, sampleMin: 0, sampleMax: 1500 },
  { key: 'restingEnergy', aliases: ['restingEnergy', 'resting energy', 'basalEnergy', 'basal energy burned'], mode: 'sum', kind: 'energy', datePolicy: 'day', min: 0, max: 6000, sampleMin: 0, sampleMax: 1500 },
  { key: 'exerciseMinutes', aliases: ['exerciseMinutes', 'exercise minutes', 'exerciseTime', 'apple exercise time'], mode: 'sum', kind: 'durationMinutes', datePolicy: 'day', min: 0, max: 1440, sampleMin: 0, sampleMax: 1440 },
  { key: 'steps', aliases: ['steps', 'stepCount', 'step count'], mode: 'sum', kind: 'count', datePolicy: 'day', min: 0, max: 150000, sampleMin: 0, sampleMax: 100000 },
  { key: 'walkingRunningDistance', aliases: ['walkingrunDistance', 'walkingRunningDistance', 'walking running distance', 'walking + running distance'], mode: 'sum', kind: 'distanceMiles', datePolicy: 'day', min: 0, max: 150, sampleMin: 0, sampleMax: 100 },
  { key: 'swimmingDistance', aliases: ['swimDistance', 'swimmingDistance', 'swim distance', 'swimming distance'], mode: 'sum', kind: 'distanceYards', datePolicy: 'day', min: 0, max: 50000, sampleMin: 0, sampleMax: 50000 },
  { key: 'restingHeartRate', aliases: ['restingHeartRate', 'resting heart rate', 'restingHR'], mode: 'latest', kind: 'heartRate', datePolicy: 'day', min: 20, max: 250, sampleMin: 20, sampleMax: 250 },
  { key: 'heartRateVariability', aliases: ['HRV', 'heartRateVariability', 'heart rate variability', 'heart rate variability sdnn'], mode: 'average', kind: 'milliseconds', datePolicy: 'day', min: 0, max: 1000, sampleMin: 0, sampleMax: 1000 },
  { key: 'respiratoryRate', aliases: ['respiratoryRate', 'respiratory rate', 'breathingRate'], mode: 'average', kind: 'rate', datePolicy: 'day', min: 3, max: 80, sampleMin: 3, sampleMax: 80 },
  { key: 'vo2Max', aliases: ['cardioFitness', 'cardio fitness', 'vo2Max', 'VO2 Max', 'vo₂ max'], mode: 'latest', kind: 'vo2', datePolicy: 'latestAny', min: 5, max: 100, sampleMin: 5, sampleMax: 100 },
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
    const { normalized, diagnostics } = normalizePayload(parsedInput)

    if (!hasHealthValues(normalized)) {
      sendJson(res, 422, {
        error: 'Fuel received text from the Shortcut but could not find health measurements. Keep the payload field as Text and select the populated orange Dictionary variable.',
        parserVersion: PARSER_VERSION,
        receivedType: Array.isArray(parsedInput) ? 'array' : typeof parsedInput,
        receivedCharacters: typeof incoming === 'string' ? incoming.length : null,
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
    { key: 'sleep', aliases: ['sleep', 'sleep samples', 'sleep analysis'] },
    ...METRICS,
  ]

  for (const metric of allAliases) {
    for (const alias of metric.aliases) {
      const regex = new RegExp(`(^|[\\n\\r,{;])\\s*["']?${escapeRegex(alias)}["']?\\s*[:=]`, 'ig')
      let match
      while ((match = regex.exec(text))) {
        markers.push({ key: metric.key, markerStart: match.index, contentStart: match.index + match[0].length })
      }
    }
  }

  markers.sort((a, b) => a.markerStart - b.markerStart || a.contentStart - b.contentStart)
  const uniqueMarkers = markers.filter((marker, index) => index === 0 || marker.markerStart !== markers[index - 1].markerStart)

  for (let index = 0; index < uniqueMarkers.length; index += 1) {
    const marker = uniqueMarkers[index]
    const end = uniqueMarkers[index + 1]?.markerStart ?? text.length
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
  const sectionCounts = {}
  const selectedSampleCounts = {}
  const datedSampleCounts = {}

  for (const rule of METRICS) {
    const source = get(payload, rule.aliases)
    const allMeasurements = collectMeasurements(source, rule)
    const selectedMeasurements = selectMeasurements(allMeasurements, rule, targetDate)
    sectionCounts[rule.key] = allMeasurements.length
    selectedSampleCounts[rule.key] = selectedMeasurements.length
    datedSampleCounts[rule.key] = allMeasurements.filter((item) => item.time > 0).length

    const rawValue = aggregate(selectedMeasurements, rule.mode)
    if (rawValue == null) {
      values[rule.key] = null
    } else if (rawValue < rule.min || rawValue > rule.max) {
      values[rule.key] = null
      rejectedMetrics.push({ metric: rule.key, value: round(rawValue), reason: `outside ${rule.min}-${rule.max}` })
    } else {
      values[rule.key] = rawValue
    }
  }

  const sleep = sleepSummary(get(payload, ['sleep', 'sleepSamples']), targetDate)
  const normalized = {
    date: targetDate,
    activeEnergy: values.activeEnergy,
    restingEnergy: values.restingEnergy,
    totalExpenditure: values.activeEnergy == null || values.restingEnergy == null
      ? null
      : values.activeEnergy + values.restingEnergy,
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

  const expected = [
    'activeEnergy', 'restingEnergy', 'exerciseMinutes', 'steps', 'walkingRunningDistance',
    'restingHeartRate', 'heartRateVariability', 'respiratoryRate', 'vo2Max', 'sleepTotal',
  ]
  const missingMetrics = expected.filter((key) => !Number.isFinite(normalized[key]))

  return {
    normalized,
    diagnostics: { missingMetrics, rejectedMetrics, sectionCounts, selectedSampleCounts, datedSampleCounts },
  }
}

function selectMeasurements(measurements, rule, targetDate) {
  if (!measurements.length || rule.datePolicy === 'latestAny') return measurements
  const dated = measurements.filter((item) => item.time > 0)
  if (!dated.length) return measurements
  return dated.filter((item) => localDate(item.time) === targetDate)
}

function collectMeasurements(value, rule, inheritedUnit = '') {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return dedupeMeasurements(value.flatMap((item) => collectMeasurements(item, rule, inheritedUnit)))

  if (typeof value === 'number') {
    const converted = convert(value, inheritedUnit, rule.kind)
    return validSample(converted, rule) ? [{ number: converted, time: 0, fingerprint: `${converted}|${inheritedUnit}` }] : []
  }

  if (typeof value === 'object') {
    const objectUnit = String(get(value, ['unit', 'measurementUnit', 'quantityTypeUnit']) || inheritedUnit || '')
    for (const alias of ['samples', 'values', 'items', 'data', 'results']) {
      const nested = get(value, [alias])
      if (nested != null) return collectMeasurements(nested, rule, objectUnit)
    }

    const nested = get(value, ['value', 'quantity', 'amount', 'sum', 'average', 'avg', 'doubleValue'])
    if (nested != null && nested !== value) {
      const measurements = collectMeasurements(nested, rule, objectUnit)
      const start = String(get(value, ['startDate', 'start', 'from']) || '')
      const end = String(get(value, ['endDate', 'end', 'to']) || '')
      const source = String(get(value, ['source', 'sourceName', 'device']) || '')
      return measurements.map((item) => ({
        ...item,
        time: parseTime(end || start) || item.time,
        fingerprint: `${item.number}|${objectUnit}|${start}|${end}|${source}`,
      }))
    }
    return []
  }

  return parseTextMeasurements(String(value), rule)
}

function parseTextMeasurements(text, rule) {
  const source = String(text)
  const measurements = []
  const unitPattern = '(kcal|calories?|cal|steps?|count(?:\\/min)?|breaths?(?:\\/min)?|bpm|ms|mL\\/kg\\/min|ml\\/kg\\/min|mi|miles?|km|kilometers?|m|meters?|yd|yards?|hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)'
  const regex = new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*${unitPattern}`, 'gi')

  for (const match of source.matchAll(regex)) {
    const converted = convert(Number(match[1]), String(match[2] || ''), rule.kind)
    if (!validSample(converted, rule)) continue
    measurements.push({
      number: converted,
      time: contextTime(source, match.index || 0),
      fingerprint: contextFingerprint(source, match.index || 0, converted, match[2]),
    })
  }

  if (!measurements.length) {
    const labeled = /(?:value|quantity|amount|total|sum)\s*[:=]\s*(-?\d+(?:\.\d+)?)/gi
    for (const match of source.matchAll(labeled)) {
      const converted = convert(Number(match[1]), '', rule.kind)
      if (!validSample(converted, rule)) continue
      measurements.push({
        number: converted,
        time: contextTime(source, match.index || 0),
        fingerprint: contextFingerprint(source, match.index || 0, converted, ''),
      })
    }
  }

  if (!measurements.length) {
    const cleaned = stripTemporalNoise(source)
    for (const match of cleaned.matchAll(/-?\d+(?:\.\d+)?/g)) {
      const converted = convert(Number(match[0]), '', rule.kind)
      if (!validSample(converted, rule)) continue
      measurements.push({ number: converted, time: 0, fingerprint: `${converted}|fallback|${match.index}` })
    }
  }

  return dedupeMeasurements(measurements)
}

function validSample(value, rule) {
  return Number.isFinite(value) && value >= rule.sampleMin && value <= rule.sampleMax
}

function aggregate(measurements, mode) {
  if (!measurements.length) return null
  const ordered = [...measurements].sort((a, b) => a.time - b.time)
  if (mode === 'latest') return ordered.at(-1).number
  if (mode === 'average') return ordered.reduce((sum, item) => sum + item.number, 0) / ordered.length
  return ordered.reduce((sum, item) => sum + item.number, 0)
}

function convert(number, rawUnit, kind) {
  if (!Number.isFinite(number)) return null
  const unit = normalizeUnit(rawUnit)

  if (kind === 'energy') {
    if (unit && !['kcal', 'calorie', 'calories', 'cal'].includes(unit)) return null
    return unit === 'cal' && number > 10000 ? number / 1000 : number
  }
  if (kind === 'durationMinutes') {
    if (unit.startsWith('sec')) return number / 60
    if (unit.startsWith('hour') || unit === 'hr' || unit === 'hrs') return number * 60
    if (!unit || unit.startsWith('min')) return number
    return null
  }
  if (kind === 'count') {
    if (!unit || unit.startsWith('step') || unit === 'count') return number
    return null
  }
  if (kind === 'distanceMiles') {
    if (!unit || unit === 'mi' || unit.startsWith('mile')) return number
    if (unit === 'km' || unit.startsWith('kilometer')) return number * 0.621371
    if (unit === 'm' || unit.startsWith('meter')) return number / 1609.344
    if (unit === 'yd' || unit.startsWith('yard')) return number / 1760
    return null
  }
  if (kind === 'distanceYards') {
    if (!unit || unit === 'yd' || unit.startsWith('yard')) return number
    if (unit === 'm' || unit.startsWith('meter')) return number * 1.09361
    if (unit === 'km' || unit.startsWith('kilometer')) return number * 1093.61
    if (unit === 'mi' || unit.startsWith('mile')) return number * 1760
    return null
  }
  if (kind === 'heartRate') {
    if (!unit || unit === 'bpm' || unit === 'count/min') return number
    return null
  }
  if (kind === 'milliseconds') {
    if (!unit || unit === 'ms') return number
    if (unit.startsWith('sec')) return number * 1000
    return null
  }
  if (kind === 'rate') {
    if (!unit || unit === 'count/min' || unit === 'breath/min' || unit === 'breaths/min' || unit === 'bpm') return number
    return null
  }
  if (kind === 'vo2') {
    if (!unit || unit === 'ml/kg/min') return number
    return null
  }
  return number
}

function sleepSummary(value, targetDate) {
  const output = { total: null, core: null, deep: null, rem: null, awake: null }
  if (value == null) return output

  const text = typeof value === 'string' ? value : JSON.stringify(value)
  let intervals = parseSleepIntervals(text)
  if (intervals.length) {
    const datedForTarget = intervals.filter((item) => localDate(item.end) === targetDate)
    if (datedForTarget.length) intervals = datedForTarget
    else if (intervals.some((item) => item.end > 0)) return output

    const awake = mergeIntervals(intervals.filter((item) => item.stage === 'awake'))
    const deep = mergeIntervals(intervals.filter((item) => item.stage === 'deep'))
    const rem = mergeIntervals(intervals.filter((item) => item.stage === 'rem'))
    const core = mergeIntervals(intervals.filter((item) => item.stage === 'core'))
    const asleep = mergeIntervals(intervals.filter((item) => item.stage !== 'awake'))
    output.awake = durationHours(awake)
    output.deep = durationHours(deep)
    output.rem = durationHours(rem)
    output.core = durationHours(core)
    output.total = durationHours(asleep)
    return output
  }

  const measurements = parseDurationMeasurements(text)
  if (measurements.length) output.total = measurements.reduce((sum, item) => sum + item.number, 0)
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
    if (!(end > start) || end - start > 24 * 3600000) continue
    intervals.push({ stage: detectSleepStage(chunk), start, end })
  }

  if (!intervals.length) {
    const times = extractDateTimes(text)
    for (let index = 0; index + 1 < times.length; index += 2) {
      const start = times[index].time
      const end = times[index + 1].time
      if (!(end > start) || end - start > 24 * 3600000) continue
      const context = text.slice(Math.max(0, times[index].index - 120), Math.min(text.length, times[index + 1].index + times[index + 1].raw.length + 120))
      intervals.push({ stage: detectSleepStage(context), start, end })
    }
  }

  return dedupeIntervals(intervals)
}

function detectSleepStage(text) {
  const match = String(text).match(/\b(awake|core|deep|rem|asleep)\b/i)
  return match ? match[1].toLowerCase() : 'asleep'
}

function parseDurationMeasurements(text) {
  const measurements = []
  const cleaned = stripTemporalNoise(text)
  const regex = /(-?\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)/gi
  for (const match of cleaned.matchAll(regex)) {
    const unit = normalizeUnit(match[2])
    let number = Number(match[1])
    if (unit.startsWith('sec')) number /= 3600
    else if (unit.startsWith('min')) number /= 60
    if (Number.isFinite(number) && number >= 0 && number <= 24) measurements.push({ number })
  }
  return measurements
}

function mergeIntervals(intervals) {
  const sorted = [...intervals]
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged = []
  for (const interval of sorted) {
    const last = merged.at(-1)
    if (!last || interval.start > last.end) merged.push({ ...interval })
    else last.end = Math.max(last.end, interval.end)
  }
  return merged
}

function dedupeIntervals(intervals) {
  const map = new Map()
  for (const item of intervals) map.set(`${item.stage}|${item.start}|${item.end}`, item)
  return [...map.values()]
}

function durationHours(intervals) {
  if (!intervals.length) return null
  return intervals.reduce((sum, item) => sum + (item.end - item.start) / 3600000, 0)
}

function stripTemporalNoise(text) {
  return String(text)
    .replace(/20\d{2}-\d{2}-\d{2}[T ][0-9:.+-Z]+/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi, ' ')
    .replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ' ')
}

function dedupeMeasurements(measurements) {
  const map = new Map()
  for (const item of measurements) {
    const key = item.fingerprint || `${round(item.number)}|${item.time || 0}`
    if (!map.has(key)) map.set(key, item)
  }
  return [...map.values()]
}

function contextTime(text, index) {
  const windowStart = Math.max(0, index - 220)
  const window = text.slice(windowStart, Math.min(text.length, index + 220))
  const times = extractDateTimes(window)
  if (!times.length) return 0
  const relativeIndex = index - windowStart
  times.sort((a, b) => Math.abs(a.index - relativeIndex) - Math.abs(b.index - relativeIndex))
  return times[0].time
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
      const raw = match[0]
      const time = parseTime(raw.replace(/\sat\s/i, ' '))
      if (time) found.push({ raw, time, index: match.index || 0 })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

function contextFingerprint(text, index, number, unit) {
  const window = text.slice(Math.max(0, index - 100), Math.min(text.length, index + 100)).replace(/\s+/g, ' ').trim()
  return `${round(number)}|${normalizeUnit(unit)}|${window}`
}

function parseTime(value) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function localDate(time) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date(time))
}

function normalizeUnit(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
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
  return Object.fromEntries(Object.entries(record)
    .filter(([, value]) => Number.isFinite(value) || typeof value === 'boolean')
    .map(([key, value]) => [key, Number.isFinite(value) ? round(value) : value]))
}

function bounded(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

function dateValue(value) {
  if (!value) return ''
  const direct = String(value).match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (direct) return direct[1]
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date)
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
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}
