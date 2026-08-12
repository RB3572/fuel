import { googleFetch } from './google.js'

const spreadsheetMimeType = 'application/vnd.google-apps.spreadsheet'

const sheetSchemas = {
  'Food Log': [
    'Date',
    'Time',
    'Meal',
    'Food / Description',
    'Estimated Portion',
    'Calories (kcal)',
    'Protein (g)',
    'Carbs (g)',
    'Fat (g)',
    'Fiber (g)',
    'Confidence',
    'Assumptions / Notes',
    'Source / Image Reference',
  ],
  'Daily Summary': [
    'Date',
    'Calories (kcal)',
    'Protein (g)',
    'Carbs (g)',
    'Fat (g)',
    'Fiber (g)',
    'Entries',
    'Notes',
  ],
  Recipes: [
    'Recipe',
    'Serving Size',
    'Calories',
    'Protein',
    'Carbs',
    'Fat',
    'Notes',
  ],
  'Workout Activity': [
    'Date',
    'Start Time',
    'Workout Type',
    'Duration (min)',
    'Active Calories',
    'Total Calories',
    'Distance (mi)',
    'Avg. Pace',
    'Avg. Heart Rate',
    'Avg. Cadence',
    'Effort',
    'Location',
    'Notes',
    'Source',
    'Swimming Distance (yd)',
    'Step Count',
    'Stroke Count',
    'Data Quality',
    'Import ID',
  ],
  'Energy Balance': [
    'Date',
    'Calories Consumed',
    'Resting Energy',
    'Active Energy',
    'Total Expenditure',
    'Net Balance',
    'Status',
    'Running Net Balance',
    'Assumptions / Notes',
    'Protein (g)',
  ],
  Recovery: [
    'Date',
    'Sleep (hr)',
    'Sleep Quality (1-10)',
    'Energy (1-10)',
    'Hunger (1-10)',
    'Soreness (1-10)',
    'Resting HR',
    'Notes',
    'HRV',
    'Respiratory Rate',
    'Sleep Core (hr)',
    'Sleep Deep (hr)',
    'Sleep REM (hr)',
  ],
  Goals: [
    'Metric',
    'Minimum',
    'Target',
    'Maximum',
    'Notes',
  ],
  Dashboard: [
    'MLog Athlete Dashboard',
  ],
}

const requiredSheets = Object.keys(sheetSchemas)

const optionalSheetSchemas = {
  'Health Daily': [
    'Date',
    'Active Energy (kcal)',
    'Resting Energy (kcal)',
    'Total Expenditure (kcal)',
    'Exercise Time (min)',
    'Step Count',
    'Distance (mi)',
    'Resting HR (bpm)',
    'HRV (ms)',
    'VO2 Max',
    'Sleep (hr)',
    'Respiratory Rate',
    'Partial Day',
    'Source',
  ],
  'Supplement Log': [
    'Date',
    'Time',
    'Supplement',
    'Dose',
    'Calories',
    'Carbs (g)',
    'Notes',
    'Source',
  ],
}

const optionalSheets = Object.keys(optionalSheetSchemas)
const readableSheetSchemas = { ...sheetSchemas, ...optionalSheetSchemas }

const dailySummaryAliases = {
  caloriesConsumed: ['calories consumed', 'calories in', 'food calories', 'consumed', 'calories', 'calories kcal', 'kcal'],
  restingEnergy: ['resting energy', 'resting energy kcal', 'resting calories', 'basal calories', 'bmr'],
  activeEnergy: ['active energy', 'active energy kcal', 'active calories', 'exercise calories', 'workout calories'],
  totalExpenditure: ['total expenditure', 'total expenditure kcal', 'total calories out', 'total calories', 'tdee', 'energy expenditure'],
  energyBalance: ['energy balance', 'deficit surplus', 'deficit/surplus', 'net calories', 'net balance'],
  protein: ['protein', 'protein grams', 'protein g'],
  carbs: ['carbs', 'carbs g', 'carbohydrates', 'carbohydrates g'],
  fat: ['fat', 'fat g', 'fats'],
  fuelScore: ['training fuel score', 'fuel score', 'score'],
}

const recoveryAliases = {
  sleepHours: ['sleep hours', 'sleep hr', 'sleep h', 'sleep', 'hours slept'],
  recoveryScore: ['recovery score', 'recovery'],
  restingHeartRate: ['resting heart rate', 'resting hr', 'resting hr bpm', 'rhr'],
  hrv: ['hrv', 'hrv ms'],
}

const workoutAliases = {
  time: ['time', 'start time'],
  activity: ['activity', 'workout', 'workout type', 'name', 'type'],
  activeCalories: ['active calories', 'active calories kcal', 'calories', 'energy', 'calories burned'],
  durationMinutes: ['duration minutes', 'duration min', 'duration', 'minutes'],
  trainingLoad: ['training load', 'load', 'effort'],
  intensity: ['intensity', 'effort'],
}

const foodAliases = {
  time: ['time', 'start time'],
  meal: ['meal', 'meal type', 'type'],
  food: ['food', 'food description', 'food / description', 'description', 'item', 'name'],
  calories: ['calories', 'calories kcal', 'kcal', 'energy'],
  protein: ['protein', 'protein g', 'protein grams'],
  carbs: ['carbs', 'carbs g', 'carbohydrates', 'carbohydrates g'],
  fat: ['fat', 'fat g', 'fats'],
  notes: ['notes', 'note', 'assumptions notes', 'assumptions / notes'],
}

export async function getMLogDashboard(session) {
  const spreadsheet = await ensureMLogSpreadsheet(session)
  const values = await readWorkbook(session, spreadsheet.id)
  const normalized = normalizeWorkbook(values)

  return {
    spreadsheet,
    generatedAt: new Date().toISOString(),
    ...normalized,
  }
}

async function ensureMLogSpreadsheet(session) {
  const found = await findMLogSpreadsheet(session)
  const spreadsheet = found || (await createMLogSpreadsheet(session))

  await reconcileWorkbook(session, spreadsheet.id)

  return spreadsheet
}

async function findMLogSpreadsheet(session) {
  const query = [
    "name = 'MLog'",
    `mimeType = '${spreadsheetMimeType}'`,
    "'root' in parents",
    'trashed = false',
  ].join(' and ')
  const params = new URLSearchParams({
    q: query,
    pageSize: '10',
    spaces: 'drive',
    fields: 'files(id,name,webViewLink,createdTime,modifiedTime)',
  })
  const payload = await googleFetch(
    session,
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  )

  return payload.files?.[0] || null
}

async function createMLogSpreadsheet(session) {
  const sheets = requiredSheets.map((title) => ({
    properties: {
      title,
      gridProperties: { rowCount: 1000, columnCount: Math.max(12, sheetSchemas[title].length) },
    },
  }))
  const payload = await googleFetch(session, 'https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: 'MLog' },
      sheets,
    }),
  })

  await writeHeaders(session, payload.spreadsheetId)

  return {
    id: payload.spreadsheetId,
    name: payload.properties?.title || 'MLog',
    webViewLink: payload.spreadsheetUrl,
  }
}

async function reconcileWorkbook(session, spreadsheetId) {
  const metadata = await googleFetch(
    session,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
  )
  const titles = new Set(metadata.sheets?.map((sheet) => sheet.properties.title) || [])
  const requests = requiredSheets
    .filter((title) => !titles.has(title))
    .map((title) => ({
      addSheet: {
        properties: {
          title,
          gridProperties: { rowCount: 1000, columnCount: Math.max(12, sheetSchemas[title].length) },
        },
      },
    }))

  if (requests.length > 0) {
    await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
  }

  await writeHeaders(session, spreadsheetId)
}

async function writeHeaders(session, spreadsheetId) {
  const data = []

  for (const title of requiredSheets) {
    const header = await readHeader(session, spreadsheetId, title)
    const existingNames = new Set(header.filter(Boolean))
    const missing = sheetSchemas[title].filter((name) => !existingNames.has(name))
    const nextHeader = header.length > 0 ? [...header, ...missing] : sheetSchemas[title]

    if (missing.length > 0 || header.length === 0) {
      data.push({
        range: `${quoteSheet(title)}!A1`,
        majorDimension: 'ROWS',
        values: [nextHeader],
      })
    }
  }

  if (data.length === 0) {
    return
  }

  await googleFetch(
    session,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data,
      }),
    },
  )
}

async function readHeader(session, spreadsheetId, title) {
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
  })
  const payload = await googleFetch(
    session,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${quoteSheet(title)}!1:1`,
    )}?${params.toString()}`,
  ).catch(() => ({ values: [] }))

  return payload.values?.[0] || []
}

async function readWorkbook(session, spreadsheetId) {
  const metadata = await googleFetch(
    session,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
  )
  const existingTitles = new Set(metadata.sheets?.map((sheet) => sheet.properties.title) || [])
  const titlesToRead = [
    ...requiredSheets,
    ...optionalSheets.filter((title) => existingTitles.has(title)),
  ]
  const ranges = titlesToRead.map((title) => `${quoteSheet(title)}!A1:Z2000`)
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
    valueRenderOption: 'UNFORMATTED_VALUE',
  })

  for (const range of ranges) {
    params.append('ranges', range)
  }

  const payload = await googleFetch(
    session,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`,
  )

  const workbook = Object.fromEntries(
    titlesToRead.map((title, index) => [title, rowsToObjects(payload.valueRanges?.[index]?.values || [])]),
  )

  return Object.fromEntries(
    [...requiredSheets, ...optionalSheets].map((title) => [title, workbook[title] || []]),
  )
}

export function normalizeWorkbook(values) {
  const today = localDateKey(new Date())
  const dailyRows = values['Daily Summary']
  const energyRows = values['Energy Balance']
  const foodRows = values['Food Log']
  const workoutRows = values['Workout Activity']
  const recoveryRows = values.Recovery
  const healthRows = values['Health Daily'] || []
  const goalRows = values.Goals

  const todayDaily = findDateRow(dailyRows, today)
  const todayEnergy = findDateRow(energyRows, today)
  const todayRecovery = findDateRow(recoveryRows, today)
  const todayHealth = findDateRow(healthRows, today)
  const todayFoods = filterDateRows(foodRows, today)
  const todayWorkouts = filterDateRows(workoutRows, today)

  const foodTotals = sumFood(todayFoods)
  const workoutTotals = sumWorkouts(todayWorkouts)
  const goals = normalizeGoals(goalRows)

  const caloriesConsumed =
    readNumberFrom(todayDaily, dailySummaryAliases.caloriesConsumed) ??
    readNumberFrom(todayEnergy, dailySummaryAliases.caloriesConsumed) ??
    foodTotals.calories
  const activeEnergy =
    readNumberFrom(todayDaily, dailySummaryAliases.activeEnergy) ??
    readNumberFrom(todayEnergy, dailySummaryAliases.activeEnergy) ??
    readNumberFrom(todayHealth, dailySummaryAliases.activeEnergy) ??
    workoutTotals.activeCalories
  const restingEnergy =
    readNumberFrom(todayDaily, dailySummaryAliases.restingEnergy) ??
    readNumberFrom(todayEnergy, dailySummaryAliases.restingEnergy) ??
    readNumberFrom(todayHealth, dailySummaryAliases.restingEnergy)
  const totalExpenditure =
    readNumberFrom(todayDaily, dailySummaryAliases.totalExpenditure) ??
    readNumberFrom(todayEnergy, dailySummaryAliases.totalExpenditure) ??
    readNumberFrom(todayHealth, dailySummaryAliases.totalExpenditure) ??
    (restingEnergy !== null && activeEnergy !== null ? restingEnergy + activeEnergy : null)
  const energyBalance =
    readNumberFrom(todayDaily, dailySummaryAliases.energyBalance) ??
    readNumberFrom(todayEnergy, dailySummaryAliases.energyBalance) ??
    (caloriesConsumed !== null && totalExpenditure !== null ? caloriesConsumed - totalExpenditure : null)
  const protein = readNumberFrom(todayDaily, dailySummaryAliases.protein) ?? foodTotals.protein
  const carbs = readNumberFrom(todayDaily, dailySummaryAliases.carbs) ?? foodTotals.carbs
  const fat = readNumberFrom(todayDaily, dailySummaryAliases.fat) ?? foodTotals.fat

  const summary = {
    date: today,
    caloriesConsumed,
    restingEnergy,
    activeEnergy,
    totalExpenditure,
    energyBalance,
    protein,
    carbs,
    fat,
    fuelScore: readNumberFrom(todayDaily, dailySummaryAliases.fuelScore),
    sleepHours:
      readNumberFrom(todayRecovery, recoveryAliases.sleepHours) ??
      readNumberFrom(todayHealth, recoveryAliases.sleepHours) ??
      readNumberFrom(todayDaily, recoveryAliases.sleepHours),
    recoveryScore:
      readNumberFrom(todayRecovery, recoveryAliases.recoveryScore) ??
      readNumberFrom(todayDaily, recoveryAliases.recoveryScore),
    restingHeartRate:
      readNumberFrom(todayRecovery, recoveryAliases.restingHeartRate) ??
      readNumberFrom(todayHealth, recoveryAliases.restingHeartRate),
    hrv:
      readNumberFrom(todayRecovery, recoveryAliases.hrv) ??
      readNumberFrom(todayHealth, recoveryAliases.hrv),
  }

  return {
    today: {
      summary,
      foodEntries: todayFoods.map(normalizeFoodEntry),
      workouts: todayWorkouts.map(normalizeWorkoutEntry),
    },
    goals,
    trends: buildTrends({ dailyRows, energyRows, foodRows, workoutRows, recoveryRows, healthRows }),
    sheetStatus: [...requiredSheets, ...optionalSheets.filter((title) => values[title]?.length > 0)].map((title) => ({
      title,
      rows: values[title]?.length || 0,
      columns: readableSheetSchemas[title],
    })),
  }
}

function buildTrends({ dailyRows, energyRows, foodRows, workoutRows, recoveryRows, healthRows }) {
  const dates = lastNDates(21)

  return dates.map((date) => {
    const daily = findDateRow(dailyRows, date)
    const energy = findDateRow(energyRows, date)
    const foods = filterDateRows(foodRows, date)
    const workouts = filterDateRows(workoutRows, date)
    const recovery = findDateRow(recoveryRows, date)
    const health = findDateRow(healthRows, date)
    const foodTotals = sumFood(foods)
    const workoutTotals = sumWorkouts(workouts)
    const consumed =
      readNumberFrom(daily, dailySummaryAliases.caloriesConsumed) ??
      readNumberFrom(energy, dailySummaryAliases.caloriesConsumed) ??
      foodTotals.calories
    const active =
      readNumberFrom(daily, dailySummaryAliases.activeEnergy) ??
      readNumberFrom(energy, dailySummaryAliases.activeEnergy) ??
      readNumberFrom(health, dailySummaryAliases.activeEnergy) ??
      workoutTotals.activeCalories
    const resting =
      readNumberFrom(daily, dailySummaryAliases.restingEnergy) ??
      readNumberFrom(energy, dailySummaryAliases.restingEnergy) ??
      readNumberFrom(health, dailySummaryAliases.restingEnergy)
    const expenditure =
      readNumberFrom(daily, dailySummaryAliases.totalExpenditure) ??
      readNumberFrom(energy, dailySummaryAliases.totalExpenditure) ??
      readNumberFrom(health, dailySummaryAliases.totalExpenditure) ??
      (resting !== null && active !== null ? resting + active : null)

    return {
      date,
      caloriesConsumed: consumed,
      totalExpenditure: expenditure,
      energyBalance:
        readNumberFrom(daily, dailySummaryAliases.energyBalance) ??
        readNumberFrom(energy, dailySummaryAliases.energyBalance) ??
        (consumed !== null && expenditure !== null ? consumed - expenditure : null),
      protein: readNumberFrom(daily, dailySummaryAliases.protein) ?? foodTotals.protein,
      sleepHours:
        readNumberFrom(recovery, recoveryAliases.sleepHours) ??
        readNumberFrom(health, recoveryAliases.sleepHours) ??
        readNumberFrom(daily, recoveryAliases.sleepHours),
      trainingLoad: workoutTotals.trainingLoad,
      fuelScore: readNumberFrom(daily, dailySummaryAliases.fuelScore),
    }
  })
}

function rowsToObjects(rows) {
  if (rows.length === 0) {
    return []
  }

  const headers = rows[0].map((header) => String(header || '').trim())

  return rows
    .slice(1)
    .filter((row) => row.some((value) => value !== '' && value !== null && value !== undefined))
    .map((row) => {
      const object = {}

      headers.forEach((header, index) => {
        if (header) {
          object[header] = row[index] ?? ''
        }
      })

      return object
    })
}

function normalizeGoals(rows) {
  const goals = {}

  for (const row of rows) {
    const metric = readTextFrom(row, ['metric', 'goal', 'name']).toLowerCase()
    const target = readNumberFrom(row, ['target', 'value'])

    if (!metric || target === null) {
      continue
    }

    if (metric.includes('protein')) goals.protein = target
    if (metric.includes('calorie') || metric.includes('energy')) goals.calories = target
    if (metric.includes('carb')) goals.carbs = target
    if (metric === 'fat' || metric.includes(' fat')) goals.fat = target
    if (metric.includes('sleep')) goals.sleepHours = target
    if (metric.includes('fuel') || metric.includes('score')) goals.fuelScore = target
  }

  return goals
}

function sumFood(rows) {
  return {
    calories: sumRows(rows, foodAliases.calories),
    protein: sumRows(rows, foodAliases.protein),
    carbs: sumRows(rows, foodAliases.carbs),
    fat: sumRows(rows, foodAliases.fat),
  }
}

function sumWorkouts(rows) {
  return {
    activeCalories: sumRows(rows, workoutAliases.activeCalories),
    trainingLoad: sumRows(rows, workoutAliases.trainingLoad),
    durationMinutes: sumRows(rows, workoutAliases.durationMinutes),
  }
}

function normalizeFoodEntry(row) {
  return {
    time: readTimeFrom(row, foodAliases.time),
    meal: readTextFrom(row, foodAliases.meal),
    food: readTextFrom(row, foodAliases.food),
    calories: readNumberFrom(row, foodAliases.calories),
    protein: readNumberFrom(row, foodAliases.protein),
    carbs: readNumberFrom(row, foodAliases.carbs),
    fat: readNumberFrom(row, foodAliases.fat),
    notes: readTextFrom(row, foodAliases.notes),
  }
}

function normalizeWorkoutEntry(row) {
  return {
    time: readTimeFrom(row, workoutAliases.time),
    activity: readTextFrom(row, workoutAliases.activity),
    durationMinutes: readNumberFrom(row, workoutAliases.durationMinutes),
    activeCalories: readNumberFrom(row, workoutAliases.activeCalories),
    trainingLoad: readNumberFrom(row, workoutAliases.trainingLoad),
    intensity: readTextFrom(row, workoutAliases.intensity),
    notes: readTextFrom(row, ['notes', 'note']),
  }
}

function sumRows(rows, aliases) {
  let total = 0
  let seen = false

  for (const row of rows) {
    const value = readNumberFrom(row, aliases)

    if (value !== null) {
      total += value
      seen = true
    }
  }

  return seen ? total : null
}

function readNumberFrom(row, aliases) {
  if (!row) {
    return null
  }

  const value = readRawFrom(row, aliases)

  if (value === '' || value === null || value === undefined) {
    return null
  }

  const number = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''))

  return Number.isFinite(number) ? number : null
}

function readTextFrom(row, aliases) {
  if (!row) {
    return ''
  }

  const value = readRawFrom(row, aliases)

  return value === null || value === undefined ? '' : String(value).trim()
}

function readTimeFrom(row, aliases) {
  if (!row) {
    return ''
  }

  return normalizeTime(readRawFrom(row, aliases))
}

function readRawFrom(row, aliases) {
  const normalizedAliases = aliases.map(normalizeKey)
  const entry = Object.entries(row).find(([key]) => normalizedAliases.includes(normalizeKey(key)))

  return entry?.[1]
}

function findDateRow(rows, date) {
  return rows.find((row) => normalizeDate(readRawFrom(row, ['date', 'day'])) === date) || null
}

function filterDateRows(rows, date) {
  return rows.filter((row) => normalizeDate(readRawFrom(row, ['date', 'day'])) === date)
}

function normalizeDate(value) {
  if (value === '' || value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'number') {
    return dateKeyFromSheetSerial(value)
  }

  const text = String(value).trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }

  const parsed = new Date(text)

  if (Number.isNaN(parsed.getTime())) {
    return text
  }

  return localDateKey(parsed)
}

function normalizeTime(value) {
  if (value === '' || value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'number') {
    const fraction = ((value % 1) + 1) % 1
    const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60)
    const hours24 = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const period = hours24 >= 12 ? 'PM' : 'AM'
    const hours12 = hours24 % 12 || 12

    return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`
  }

  return String(value).trim()
}

function dateKeyFromSheetSerial(value) {
  const epoch = Date.UTC(1899, 11, 30)
  const wholeDays = Math.floor(value)
  const date = new Date(epoch + wholeDays * 24 * 60 * 60 * 1000)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function lastNDates(days) {
  const dates = []
  const today = new Date()

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    dates.push(localDateKey(date))
  }

  return dates
}

function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function quoteSheet(title) {
  return `'${title.replaceAll("'", "''")}'`
}
