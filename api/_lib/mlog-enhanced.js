import { googleFetch } from './google.js'
import { getMLogDashboard as getBaseDashboard } from './mlog-v2.js'

const TIME_ZONE = 'America/Los_Angeles'

export async function getMLogDashboard(session) {
  const dashboard = await getBaseDashboard(session)
  const healthRows = await readHealthDaily(session, dashboard.spreadsheet.id)
  const today = dashboard.today?.summary?.date
  const todayHealth = findRow(healthRows, today)
  const swimYards = numberFrom(todayHealth, ['Swimming Distance (yd)', 'Swim Distance (yd)', 'Swimming Distance'])

  dashboard.today.summary.swimmingDistanceYards = swimYards

  const workouts = dashboard.today.workouts || []
  const hasHealthSummary = [
    dashboard.today.summary.exerciseMinutes,
    dashboard.today.summary.distanceMiles,
    dashboard.today.summary.stepCount,
    dashboard.today.summary.activeEnergy,
  ].some((value) => Number.isFinite(value) && value > 0)

  if (hasHealthSummary && !workouts.some((entry) => entry.source === 'Apple Health daily summary')) {
    workouts.unshift({
      time: '',
      activity: 'Daily activity',
      durationMinutes: dashboard.today.summary.exerciseMinutes,
      activeCalories: dashboard.today.summary.activeEnergy,
      totalCalories: null,
      distanceMiles: dashboard.today.summary.distanceMiles,
      averagePace: '',
      averageHeartRate: null,
      averageCadence: null,
      effort: '',
      location: '',
      swimmingDistanceYards: null,
      stepCount: dashboard.today.summary.stepCount,
      strokeCount: null,
      dataQuality: 'Apple Health cumulative total',
      notes: 'Current-day exercise, walking/running distance, steps, and active energy from Apple Health.',
      source: 'Apple Health daily summary',
    })
  }

  if (Number.isFinite(swimYards) && swimYards > 0 && !workouts.some((entry) => Number(entry.swimmingDistanceYards) > 0)) {
    workouts.unshift({
      time: '',
      activity: 'Swimming',
      durationMinutes: null,
      activeCalories: null,
      totalCalories: null,
      distanceMiles: null,
      averagePace: '',
      averageHeartRate: null,
      averageCadence: null,
      effort: '',
      location: '',
      swimmingDistanceYards: swimYards,
      stepCount: null,
      strokeCount: null,
      dataQuality: 'Apple Health cumulative total',
      notes: 'Swimming distance synchronized from Apple Health.',
      source: 'Apple Health daily summary',
    })
  }

  dashboard.today.workouts = workouts

  for (const point of dashboard.trends || []) {
    const row = findRow(healthRows, point.date)
    point.swimmingDistanceYards = numberFrom(row, ['Swimming Distance (yd)', 'Swim Distance (yd)', 'Swimming Distance'])
  }

  return dashboard
}

async function readHealthDaily(session, spreadsheetId) {
  const range = "'Health Daily'!A1:Z5000"
  const response = await googleFetch(
    session,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  ).catch(() => ({ values: [] }))

  const rows = response.values || []
  const headers = rows[0] || []
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [String(header || ''), row[index] ?? ''])))
}

function findRow(rows, date) {
  return rows.find((row) => normalizeDate(row.Date ?? row.date) === date) || null
}

function numberFrom(row, aliases) {
  if (!row) return null
  const wanted = new Set(aliases.map(normalizeKey))
  for (const [key, value] of Object.entries(row)) {
    if (!wanted.has(normalizeKey(key))) continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return null
}

function normalizeDate(value) {
  if (typeof value === 'number' && value > 20000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10)
  }
  const direct = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct) return direct[1]
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(parsed)
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}
