import { googleFetch } from './google.js'

const MIME = 'application/vnd.google-apps.spreadsheet'
const DEFAULT_TZ = 'America/Los_Angeles'
const TREND_DAYS = 30

const schemas = {
  'Food Log': ['Date', 'Time', 'Meal', 'Food / Description', 'Estimated Portion', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)', 'Confidence', 'Assumptions / Notes', 'Source / Image Reference'],
  'Daily Summary': ['Date', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)', 'Entries', 'Notes'],
  Recipes: ['Recipe', 'Yield / Serving', 'Ingredients and Instructions', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)', 'Nutrition Assumptions / Notes', 'Source'],
  'Workout Activity': ['Date', 'Start Time', 'Workout Type', 'Duration (min)', 'Active Calories', 'Total Calories', 'Distance (mi)', 'Avg. Pace', 'Avg. Heart Rate', 'Avg. Cadence', 'Effort', 'Location', 'Notes', 'Source', 'Swimming Distance (yd)', 'Step Count', 'Stroke Count', 'Data Quality', 'Import ID'],
  'Energy Balance': ['Date', 'Calories Consumed', 'Resting Energy', 'Active Energy', 'Total Expenditure', 'Net Balance', 'Status', 'Running Net Balance', 'Assumptions / Notes', 'Protein (g)', 'Sleep (hr)', 'Protein Score', 'Energy Balance Score', 'Sleep Score', 'Training Fuel Score', 'Fuel Status'],
  Recovery: ['Date', 'Sleep (hr)', 'Sleep Quality (1-10)', 'Energy (1-10)', 'Hunger (1-10)', 'Soreness (1-10)', 'Resting HR', 'Notes', 'HRV', 'Respiratory Rate', 'Sleep Core (hr)', 'Sleep Deep (hr)', 'Sleep REM (hr)', 'Sleep Awake (hr)', 'Source'],
  Goals: ['Metric', 'Minimum', 'Target', 'Maximum', 'Notes'],
}

const optionalSchemas = {
  'Health Daily': ['Date', 'Active Energy (kcal)', 'Resting Energy (kcal)', 'Total Expenditure (kcal)', 'Exercise Time (min)', 'Step Count', 'Distance (mi)', 'Resting HR (bpm)', 'HRV (ms)', 'VO2 Max', 'Sleep (hr)', 'Respiratory Rate', 'Partial Day', 'Source'],
  'Supplement Log': ['Date', 'Time', 'Supplement', 'Dose', 'Calories', 'Carbs (g)', 'Notes', 'Source'],
}

const allSchemas = { ...schemas, ...optionalSchemas }
const required = [...Object.keys(schemas), 'Dashboard']
const optional = Object.keys(optionalSchemas)
const readable = Object.keys(allSchemas)

const aliases = {
  calories: ['calories kcal', 'calories consumed', 'calories in', 'food calories', 'consumed', 'calories', 'energy'],
  protein: ['protein g', 'protein', 'protein grams'],
  carbs: ['carbs g', 'carbs', 'carbohydrates g', 'carbohydrates'],
  fat: ['fat g', 'fat', 'fats'],
  fiber: ['fiber g', 'fiber'],
  resting: ['resting energy kcal', 'resting energy', 'resting calories', 'basal calories', 'bmr'],
  active: ['active energy kcal', 'active energy', 'active calories', 'exercise calories', 'workout calories', 'calories burned'],
  expenditure: ['total expenditure kcal', 'total expenditure', 'total calories out', 'tdee', 'energy expenditure'],
  balance: ['net balance', 'energy balance', 'deficit surplus', 'deficit/surplus', 'net calories'],
  score: ['training fuel score', 'fuel score', 'score'],
  sleep: ['sleep hr', 'sleep hours', 'sleep', 'hours slept'],
  sleepQuality: ['sleep quality 1 10', 'sleep quality', 'sleep score'],
  rhr: ['resting hr bpm', 'resting hr', 'resting heart rate', 'rhr'],
  recovery: ['recovery score', 'recovery'],
  hrv: ['hrv ms', 'hrv'],
  respiratory: ['respiratory rate', 'respiratory rate breaths min'],
  sleepCore: ['sleep core hr', 'core sleep hr', 'sleep core'],
  sleepDeep: ['sleep deep hr', 'deep sleep hr', 'sleep deep'],
  sleepRem: ['sleep rem hr', 'rem sleep hr', 'sleep rem'],
  sleepAwake: ['sleep awake hr', 'awake hr', 'sleep awake'],
  steps: ['step count', 'steps'],
  distance: ['distance mi', 'walking running distance mi', 'walking running distance', 'distance'],
  exercise: ['exercise time min', 'exercise minutes', 'exercise time'],
  vo2: ['vo2 max', 'vo2max'],
  duration: ['duration min', 'duration minutes', 'duration', 'minutes'],
  totalCalories: ['total calories', 'workout total calories'],
  pace: ['avg pace', 'average pace', 'pace'],
  avgHeartRate: ['avg heart rate', 'average heart rate'],
  avgCadence: ['avg cadence', 'average cadence', 'cadence'],
  swimDistance: ['swimming distance yd', 'swim distance yd', 'swimming distance'],
  strokeCount: ['stroke count', 'swimming stroke count'],
  partial: ['partial day', 'partial'],
}

export async function getMLogDashboard(session) {
  const spreadsheet = await ensureWorkbook(session)
  const values = await readWorkbook(session, spreadsheet.id)

  return {
    spreadsheet,
    generatedAt: new Date().toISOString(),
    ...normalizeWorkbook(values, spreadsheet.timeZone || DEFAULT_TZ),
  }
}

async function ensureWorkbook(session) {
  const found = await findWorkbook(session)
  const spreadsheet = found || await createWorkbook(session)
  const metadata = await reconcileWorkbook(session, spreadsheet.id)

  return { ...spreadsheet, timeZone: metadata.properties?.timeZone || DEFAULT_TZ }
}

async function findWorkbook(session) {
  const q = ["name = 'MLog'", `mimeType = '${MIME}'`, "'root' in parents", 'trashed = false'].join(' and ')
  const params = new URLSearchParams({
    q,
    pageSize: '10',
    spaces: 'drive',
    fields: 'files(id,name,webViewLink,createdTime,modifiedTime)',
  })
  const result = await googleFetch(session, `https://www.googleapis.com/drive/v3/files?${params}`)

  return result.files?.[0] || null
}

async function createWorkbook(session) {
  const sheets = required.map((title) => ({
    properties: {
      title,
      gridProperties: {
        rowCount: ['Food Log', 'Workout Activity'].includes(title) ? 2000 : 1000,
        columnCount: Math.max(12, schemas[title]?.length || 3),
      },
    },
  }))
  const result = await googleFetch(session, 'https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: 'MLog', timeZone: DEFAULT_TZ }, sheets }),
  })

  await initializeEmptyHeaders(session, result.spreadsheetId)

  return {
    id: result.spreadsheetId,
    name: result.properties?.title || 'MLog',
    webViewLink: result.spreadsheetUrl,
  }
}

async function reconcileWorkbook(session, spreadsheetId) {
  let metadata = await spreadsheetMetadata(session, spreadsheetId)
  const titles = new Set(metadata.sheets?.map((sheet) => sheet.properties.title) || [])
  const requests = required
    .filter((title) => !titles.has(title))
    .map((title) => ({
      addSheet: {
        properties: {
          title,
          gridProperties: {
            rowCount: ['Food Log', 'Workout Activity'].includes(title) ? 2000 : 1000,
            columnCount: Math.max(12, schemas[title]?.length || 3),
          },
        },
      },
    }))

  if (requests.length) {
    await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
    metadata = await spreadsheetMetadata(session, spreadsheetId)
  }

  // Existing populated tabs are never reshaped. Header aliases handle older variants.
  await initializeEmptyHeaders(session, spreadsheetId)
  return metadata
}

function spreadsheetMetadata(session, id) {
  return googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties(timeZone),sheets.properties(title)`)
}

async function initializeEmptyHeaders(session, id) {
  const data = []

  for (const [title, schema] of Object.entries(schemas)) {
    const header = await readHeader(session, id, title)
    if (header.every((value) => value === '' || value == null)) {
      data.push({ range: `${quote(title)}!A1`, majorDimension: 'ROWS', values: [schema] })
    }
  }

  if (!data.length) return

  await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  })
}

async function readHeader(session, id, title) {
  const result = await googleFetch(
    session,
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${quote(title)}!1:1`)}?majorDimension=ROWS`,
  ).catch(() => ({ values: [] }))

  return result.values?.[0] || []
}

async function readWorkbook(session, id) {
  const metadata = await spreadsheetMetadata(session, id)
  const titles = new Set(metadata.sheets?.map((sheet) => sheet.properties.title) || [])
  const rangesToRead = [
    ...Object.keys(schemas),
    ...optional.filter((title) => titles.has(title)),
  ]
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
    valueRenderOption: 'UNFORMATTED_VALUE',
  })

  rangesToRead.forEach((title) => params.append('ranges', `${quote(title)}!A1:Z5000`))

  const result = await googleFetch(
    session,
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${params}`,
  )
  const workbook = Object.fromEntries(
    rangesToRead.map((title, index) => [title, rowsToObjects(result.valueRanges?.[index]?.values || [])]),
  )

  return Object.fromEntries(readable.map((title) => [title, workbook[title] || []]))
}

export function normalizeWorkbook(values, timeZone = DEFAULT_TZ) {
  const date = dateKey(new Date(), timeZone)
  const dailyRows = values['Daily Summary'] || []
  const energyRows = values['Energy Balance'] || []
  const foodRows = values['Food Log'] || []
  const workoutRows = values['Workout Activity'] || []
  const recoveryRows = values.Recovery || []
  const healthRows = values['Health Daily'] || []
  const supplementRows = values['Supplement Log'] || []
  const goalRows = values.Goals || []

  const daily = findDateRow(dailyRows, date, timeZone)
  const energy = findDateRow(energyRows, date, timeZone)
  const recovery = findDateRow(recoveryRows, date, timeZone)
  const health = findDateRow(healthRows, date, timeZone)
  const foods = filterDateRows(foodRows, date, timeZone)
  const workouts = filterDateRows(workoutRows, date, timeZone)
  const supplements = filterDateRows(supplementRows, date, timeZone)
  const foodTotals = sumFood(foods)
  const workoutTotals = sumWorkouts(workouts)
  const partialDay = isPartialDay(health, energy)

  const calories = numberFrom(daily, aliases.calories) ?? numberFrom(energy, aliases.calories) ?? foodTotals.calories
  const active = numberFrom(health, aliases.active) ?? numberFrom(energy, aliases.active) ?? numberFrom(daily, aliases.active) ?? workoutTotals.activeCalories
  const resting = numberFrom(health, aliases.resting) ?? numberFrom(energy, aliases.resting) ?? numberFrom(daily, aliases.resting)
  const expenditure = numberFrom(health, aliases.expenditure) ?? numberFrom(energy, aliases.expenditure) ?? numberFrom(daily, aliases.expenditure) ?? (resting != null && active != null ? resting + active : null)
  const explicitBalance = numberFrom(energy, aliases.balance) ?? numberFrom(daily, aliases.balance)
  const balance = partialDay ? null : explicitBalance ?? (calories != null && expenditure != null ? calories - expenditure : null)

  const summary = {
    date,
    partialDay,
    caloriesConsumed: calories,
    restingEnergy: resting,
    activeEnergy: active,
    totalExpenditure: expenditure,
    energyBalance: balance,
    protein: numberFrom(daily, aliases.protein) ?? numberFrom(energy, aliases.protein) ?? foodTotals.protein,
    carbs: numberFrom(daily, aliases.carbs) ?? foodTotals.carbs,
    fat: numberFrom(daily, aliases.fat) ?? foodTotals.fat,
    fiber: numberFrom(daily, aliases.fiber) ?? foodTotals.fiber,
    fuelScore: numberFrom(energy, aliases.score) ?? numberFrom(daily, aliases.score),
    sleepHours: numberFrom(recovery, aliases.sleep) ?? numberFrom(health, aliases.sleep) ?? numberFrom(energy, aliases.sleep) ?? numberFrom(daily, aliases.sleep),
    sleepQuality: numberFrom(recovery, aliases.sleepQuality),
    recoveryScore: numberFrom(recovery, aliases.recovery) ?? numberFrom(daily, aliases.recovery),
    restingHeartRate: numberFrom(recovery, aliases.rhr) ?? numberFrom(health, aliases.rhr),
    hrv: numberFrom(recovery, aliases.hrv) ?? numberFrom(health, aliases.hrv),
    respiratoryRate: numberFrom(recovery, aliases.respiratory) ?? numberFrom(health, aliases.respiratory),
    sleepCoreHours: numberFrom(recovery, aliases.sleepCore),
    sleepDeepHours: numberFrom(recovery, aliases.sleepDeep),
    sleepRemHours: numberFrom(recovery, aliases.sleepRem),
    sleepAwakeHours: numberFrom(recovery, aliases.sleepAwake),
    stepCount: numberFrom(health, aliases.steps),
    distanceMiles: numberFrom(health, aliases.distance),
    exerciseMinutes: numberFrom(health, aliases.exercise) ?? workoutTotals.durationMinutes,
    vo2Max: numberFrom(health, aliases.vo2),
  }

  return {
    today: {
      summary,
      foodEntries: sortByTime(foods.map(normalizeFood)),
      workouts: sortByTime(workouts.map(normalizeWorkout)),
      supplements: sortByTime(supplements.map(normalizeSupplement)),
    },
    goals: normalizeGoals(goalRows),
    trends: buildTrends({ dailyRows, energyRows, foodRows, workoutRows, recoveryRows, healthRows }, timeZone),
    coverage: buildCoverage({ healthRows, foodRows, workoutRows, recoveryRows }, timeZone),
    sheetStatus: [...required, ...optional.filter((title) => values[title]?.length > 0)].map((title) => ({
      title,
      rows: values[title]?.length || 0,
      columns: allSchemas[title] || [],
    })),
  }
}

function buildTrends(rows, timeZone) {
  return lastDates(TREND_DAYS, timeZone).map((date) => {
    const daily = findDateRow(rows.dailyRows, date, timeZone)
    const energy = findDateRow(rows.energyRows, date, timeZone)
    const recovery = findDateRow(rows.recoveryRows, date, timeZone)
    const health = findDateRow(rows.healthRows, date, timeZone)
    const foods = filterDateRows(rows.foodRows, date, timeZone)
    const workouts = filterDateRows(rows.workoutRows, date, timeZone)
    const food = sumFood(foods)
    const workout = sumWorkouts(workouts)
    const partialDay = isPartialDay(health, energy)
    const consumed = numberFrom(daily, aliases.calories) ?? numberFrom(energy, aliases.calories) ?? food.calories
    const active = numberFrom(health, aliases.active) ?? numberFrom(energy, aliases.active) ?? numberFrom(daily, aliases.active) ?? workout.activeCalories
    const resting = numberFrom(health, aliases.resting) ?? numberFrom(energy, aliases.resting) ?? numberFrom(daily, aliases.resting)
    const expenditure = numberFrom(health, aliases.expenditure) ?? numberFrom(energy, aliases.expenditure) ?? numberFrom(daily, aliases.expenditure) ?? (resting != null && active != null ? resting + active : null)
    const explicitBalance = numberFrom(energy, aliases.balance) ?? numberFrom(daily, aliases.balance)

    return {
      date,
      partialDay,
      caloriesConsumed: consumed,
      restingEnergy: resting,
      activeEnergy: active,
      totalExpenditure: expenditure,
      energyBalance: partialDay ? null : explicitBalance ?? (consumed != null && expenditure != null ? consumed - expenditure : null),
      protein: numberFrom(daily, aliases.protein) ?? numberFrom(energy, aliases.protein) ?? food.protein,
      carbs: numberFrom(daily, aliases.carbs) ?? food.carbs,
      fat: numberFrom(daily, aliases.fat) ?? food.fat,
      sleepHours: numberFrom(recovery, aliases.sleep) ?? numberFrom(health, aliases.sleep) ?? numberFrom(energy, aliases.sleep) ?? numberFrom(daily, aliases.sleep),
      restingHeartRate: numberFrom(recovery, aliases.rhr) ?? numberFrom(health, aliases.rhr),
      hrv: numberFrom(recovery, aliases.hrv) ?? numberFrom(health, aliases.hrv),
      stepCount: numberFrom(health, aliases.steps),
      distanceMiles: numberFrom(health, aliases.distance),
      exerciseMinutes: numberFrom(health, aliases.exercise) ?? workout.durationMinutes,
      vo2Max: numberFrom(health, aliases.vo2),
      workoutCount: workout.count,
      fuelScore: numberFrom(energy, aliases.score) ?? numberFrom(daily, aliases.score),
    }
  })
}

function buildCoverage(rows, timeZone) {
  const dates = new Set()
  for (const collection of [rows.healthRows, rows.foodRows, rows.workoutRows, rows.recoveryRows]) {
    for (const row of collection) {
      const normalized = normalizeDate(rawFrom(row, ['date', 'day']), timeZone)
      if (normalized) dates.add(normalized)
    }
  }
  const sorted = [...dates].sort()

  return {
    startDate: sorted[0] || null,
    endDate: sorted.at(-1) || null,
    days: sorted.length,
    healthDays: uniqueDateCount(rows.healthRows, timeZone),
    foodEntries: rows.foodRows.length,
    workouts: rows.workoutRows.length,
    recoveryDays: uniqueDateCount(rows.recoveryRows, timeZone),
  }
}

function rowsToObjects(rows) {
  if (!rows.length) return []
  const headers = rows[0].map((value) => String(value || '').trim())

  return rows
    .slice(1)
    .filter((row) => row.some((value) => value !== '' && value != null))
    .map((row) => {
      const object = {}
      headers.forEach((header, index) => {
        if (header && !(header in object)) object[header] = row[index] ?? ''
      })
      return object
    })
}

function normalizeGoals(rows) {
  const goals = {}

  for (const row of rows) {
    const metric = textFrom(row, ['metric', 'goal', 'name']).toLowerCase()
    const minimum = numberFrom(row, ['minimum', 'min'])
    const target = numberFrom(row, ['target', 'value'])
    const maximum = numberFrom(row, ['maximum', 'max'])
    if (!metric) continue

    const value = { minimum, target, maximum }
    if (metric.includes('protein')) goals.protein = value
    if (metric.includes('calorie') && metric.includes('deficit')) goals.calorieDeficit = value
    if (metric === 'fat' || metric.includes('fat ')) goals.fat = value
    if (metric.includes('sleep')) goals.sleepHours = value
    if (metric.includes('fuel') || metric.includes('score')) goals.fuelScore = value
    if (metric.includes('strength')) goals.strengthSessions = value
  }

  return goals
}

function normalizeFood(row) {
  return {
    time: formatTime(rawFrom(row, ['time'])),
    meal: textFrom(row, ['meal', 'type']),
    food: textFrom(row, ['food description', 'food', 'item', 'name']),
    portion: textFrom(row, ['estimated portion', 'portion', 'serving']),
    calories: numberFrom(row, aliases.calories),
    protein: numberFrom(row, aliases.protein),
    carbs: numberFrom(row, aliases.carbs),
    fat: numberFrom(row, aliases.fat),
    fiber: numberFrom(row, aliases.fiber),
    confidence: textFrom(row, ['confidence']),
    notes: textFrom(row, ['assumptions notes', 'notes', 'note']),
    source: textFrom(row, ['source image reference', 'source']),
  }
}

function normalizeWorkout(row) {
  return {
    time: formatTime(rawFrom(row, ['start time', 'time'])),
    activity: textFrom(row, ['workout type', 'activity', 'workout', 'name', 'type']),
    durationMinutes: numberFrom(row, aliases.duration),
    activeCalories: numberFrom(row, aliases.active),
    totalCalories: numberFrom(row, aliases.totalCalories),
    distanceMiles: numberFrom(row, aliases.distance),
    averagePace: textFrom(row, aliases.pace),
    averageHeartRate: numberFrom(row, aliases.avgHeartRate),
    averageCadence: numberFrom(row, aliases.avgCadence),
    effort: textFrom(row, ['effort', 'intensity']),
    location: textFrom(row, ['location']),
    swimmingDistanceYards: numberFrom(row, aliases.swimDistance),
    stepCount: numberFrom(row, aliases.steps),
    strokeCount: numberFrom(row, aliases.strokeCount),
    dataQuality: textFrom(row, ['data quality']),
    notes: textFrom(row, ['notes', 'note']),
    source: textFrom(row, ['source']),
  }
}

function normalizeSupplement(row) {
  return {
    time: formatTime(rawFrom(row, ['time'])),
    name: textFrom(row, ['supplement', 'name']),
    dose: textFrom(row, ['dose', 'serving']),
    calories: numberFrom(row, aliases.calories),
    notes: textFrom(row, ['notes', 'note']),
  }
}

function sumFood(rows) {
  return {
    calories: sumRows(rows, aliases.calories),
    protein: sumRows(rows, aliases.protein),
    carbs: sumRows(rows, aliases.carbs),
    fat: sumRows(rows, aliases.fat),
    fiber: sumRows(rows, aliases.fiber),
  }
}

function sumWorkouts(rows) {
  return {
    activeCalories: sumRows(rows, aliases.active),
    durationMinutes: sumRows(rows, aliases.duration),
    count: rows.length,
  }
}

function sumRows(rows, keys) {
  let total = 0
  let seen = false

  for (const row of rows) {
    const value = numberFrom(row, keys)
    if (value != null) {
      total += value
      seen = true
    }
  }

  return seen ? total : null
}

function numberFrom(row, keys) {
  if (!row) return null

  for (const value of matchingValues(row, keys)) {
    if (value === '' || value == null) continue
    const parsed = typeof value === 'number'
      ? value
      : Number(String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0])
    if (Number.isFinite(parsed)) return parsed
  }

  return null
}

function textFrom(row, keys) {
  if (!row) return ''

  for (const value of matchingValues(row, keys)) {
    if (value !== '' && value != null) return String(value).trim()
  }

  return ''
}

function rawFrom(row, keys) {
  if (!row) return undefined
  return matchingValues(row, keys)[0]
}

function matchingValues(row, keys) {
  if (!row) return []
  const set = new Set(keys.map(normalizeKey))
  return Object.entries(row)
    .filter(([key]) => set.has(normalizeKey(key)))
    .map(([, value]) => value)
}

function isPartialDay(health, energy) {
  const explicit = booleanFrom(health, aliases.partial)
  if (explicit !== null) return explicit
  const notes = textFrom(energy, ['assumptions notes', 'notes']).toLowerCase()
  return notes.includes('partial') || notes.includes('not final') || notes.includes('in progress')
}

function booleanFrom(row, keys) {
  const value = rawFrom(row, keys)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (value == null || value === '') return null
  const normalized = String(value).trim().toLowerCase()
  if (['yes', 'true', 'y', '1'].includes(normalized)) return true
  if (['no', 'false', 'n', '0'].includes(normalized)) return false
  return null
}

function findDateRow(rows, date, timeZone) {
  return rows.find((row) => normalizeDate(rawFrom(row, ['date', 'day']), timeZone) === date) || null
}

function filterDateRows(rows, date, timeZone) {
  return rows.filter((row) => normalizeDate(rawFrom(row, ['date', 'day']), timeZone) === date)
}

function uniqueDateCount(rows, timeZone) {
  return new Set(
    rows
      .map((row) => normalizeDate(rawFrom(row, ['date', 'day']), timeZone))
      .filter(Boolean),
  ).size
}

function sortByTime(entries) {
  return [...entries].sort((a, b) => timeSortValue(a.time) - timeSortValue(b.time))
}

function timeSortValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return Number.MAX_SAFE_INTEGER - 1
  let hour = Number(match[1]) % 12
  if (match[3].toUpperCase() === 'PM') hour += 12
  return hour * 60 + Number(match[2])
}

function formatTime(value) {
  if (value === '' || value == null) return ''
  if (typeof value !== 'number') return String(value).trim()
  const total = Math.round((value % 1) * 1440)
  const hour24 = Math.floor(total / 60) % 24
  const minutes = total % 60

  return `${hour24 % 12 || 12}:${String(minutes).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`
}

function normalizeDate(value, timeZone) {
  if (value === '' || value == null) return ''
  if (typeof value === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10)
  }

  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
  const parsed = new Date(text)

  return Number.isNaN(parsed.getTime()) ? text : dateKey(parsed, timeZone)
}

function lastDates(count, timeZone) {
  const today = dateKey(new Date(), timeZone)
  const [year, month, day] = today.split('-').map(Number)
  const anchor = Date.UTC(year, month - 1, day, 12)

  return Array.from({ length: count }, (_, index) => (
    new Date(anchor - (count - 1 - index) * 86400000).toISOString().slice(0, 10)
  ))
}

function dateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function quote(title) {
  return `'${title.replaceAll("'", "''")}'`
}
