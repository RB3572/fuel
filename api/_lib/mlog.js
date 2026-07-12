import { googleFetch } from './google.js'

const spreadsheetMimeType = 'application/vnd.google-apps.spreadsheet'

const sheetSchemas = {
  'Food Log': [
    'Date',
    'Time',
    'Meal',
    'Food',
    'Calories',
    'Protein',
    'Carbs',
    'Fat',
    'Notes',
  ],
  'Daily Summary': [
    'Date',
    'Calories Consumed',
    'Resting Energy',
    'Active Energy',
    'Total Expenditure',
    'Energy Balance',
    'Protein',
    'Carbs',
    'Fat',
    'Training Fuel Score',
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
    'Time',
    'Activity',
    'Duration Minutes',
    'Active Calories',
    'Training Load',
    'Intensity',
    'Notes',
  ],
  'Energy Balance': [
    'Date',
    'Calories Consumed',
    'Total Expenditure',
    'Energy Balance',
    'Deficit Surplus',
  ],
  Recovery: [
    'Date',
    'Sleep Hours',
    'Resting Heart Rate',
    'HRV',
    'Recovery Score',
    'Soreness',
    'Notes',
  ],
  Goals: [
    'Metric',
    'Target',
    'Unit',
    'Notes',
  ],
  Dashboard: [
    'Metric',
    'Value',
    'Unit',
    'Updated At',
    'Notes',
  ],
}

const requiredSheets = Object.keys(sheetSchemas)

const dailySummaryAliases = {
  caloriesConsumed: ['calories consumed', 'calories in', 'food calories', 'consumed'],
  restingEnergy: ['resting energy', 'resting calories', 'basal calories', 'bmr'],
  activeEnergy: ['active energy', 'active calories', 'exercise calories', 'workout calories'],
  totalExpenditure: ['total expenditure', 'total calories out', 'tdee', 'energy expenditure'],
  energyBalance: ['energy balance', 'deficit surplus', 'deficit/surplus', 'net calories'],
  protein: ['protein', 'protein grams', 'protein g'],
  carbs: ['carbs', 'carbohydrates'],
  fat: ['fat', 'fats'],
  fuelScore: ['training fuel score', 'fuel score', 'score'],
}

const recoveryAliases = {
  sleepHours: ['sleep hours', 'sleep', 'hours slept'],
  recoveryScore: ['recovery score', 'recovery'],
  restingHeartRate: ['resting heart rate', 'rhr'],
  hrv: ['hrv'],
}

const workoutAliases = {
  activeCalories: ['active calories', 'calories', 'energy', 'calories burned'],
  durationMinutes: ['duration minutes', 'duration', 'minutes'],
  trainingLoad: ['training load', 'load'],
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

    if (missing.length > 0 || existing.length === 0) {
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
  const ranges = requiredSheets.map((title) => `${quoteSheet(title)}!A1:Z1000`)
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

  return Object.fromEntries(
    requiredSheets.map((title, index) => [title, rowsToObjects(payload.valueRanges?.[index]?.values || [])]),
  )
}

function normalizeWorkbook(values) {
  const today = localDateKey(new Date())
  const dailyRows = values['Daily Summary']
  const energyRows = values['Energy Balance']
  const foodRows = values['Food Log']
  const workoutRows = values['Workout Activity']
  const recoveryRows = values.Recovery
  const goalRows = values.Goals

  const todayDaily = findDateRow(dailyRows, today)
  const todayEnergy = findDateRow(energyRows, today)
  const todayRecovery = findDateRow(recoveryRows, today)
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
    workoutTotals.activeCalories
  const restingEnergy = readNumberFrom(todayDaily, dailySummaryAliases.restingEnergy)
  const totalExpenditure =
    readNumberFrom(todayDaily, dailySummaryAliases.totalExpenditure) ??
    readNumberFrom(todayEnergy, dailySummaryAliases.totalExpenditure) ??
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
      readNumberFrom(todayDaily, recoveryAliases.sleepHours),
    recoveryScore:
      readNumberFrom(todayRecovery, recoveryAliases.recoveryScore) ??
      readNumberFrom(todayDaily, recoveryAliases.recoveryScore),
    restingHeartRate: readNumberFrom(todayRecovery, recoveryAliases.restingHeartRate),
    hrv: readNumberFrom(todayRecovery, recoveryAliases.hrv),
  }

  return {
    today: {
      summary,
      foodEntries: todayFoods.map(normalizeFoodEntry),
      workouts: todayWorkouts.map(normalizeWorkoutEntry),
    },
    goals,
    trends: buildTrends({ dailyRows, energyRows, foodRows, workoutRows, recoveryRows }),
    sheetStatus: requiredSheets.map((title) => ({
      title,
      rows: values[title]?.length || 0,
      columns: sheetSchemas[title],
    })),
  }
}

function buildTrends({ dailyRows, energyRows, foodRows, workoutRows, recoveryRows }) {
  const dates = lastNDates(21)

  return dates.map((date) => {
    const daily = findDateRow(dailyRows, date)
    const energy = findDateRow(energyRows, date)
    const foods = filterDateRows(foodRows, date)
    const workouts = filterDateRows(workoutRows, date)
    const recovery = findDateRow(recoveryRows, date)
    const foodTotals = sumFood(foods)
    const workoutTotals = sumWorkouts(workouts)
    const consumed =
      readNumberFrom(daily, dailySummaryAliases.caloriesConsumed) ??
      readNumberFrom(energy, dailySummaryAliases.caloriesConsumed) ??
      foodTotals.calories
    const active =
      readNumberFrom(daily, dailySummaryAliases.activeEnergy) ??
      workoutTotals.activeCalories
    const resting = readNumberFrom(daily, dailySummaryAliases.restingEnergy)
    const expenditure =
      readNumberFrom(daily, dailySummaryAliases.totalExpenditure) ??
      readNumberFrom(energy, dailySummaryAliases.totalExpenditure) ??
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
    calories: sumRows(rows, ['calories', 'energy']),
    protein: sumRows(rows, ['protein', 'protein g']),
    carbs: sumRows(rows, ['carbs', 'carbohydrates']),
    fat: sumRows(rows, ['fat', 'fats']),
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
    time: readTextFrom(row, ['time']),
    meal: readTextFrom(row, ['meal', 'type']),
    food: readTextFrom(row, ['food', 'item', 'name']),
    calories: readNumberFrom(row, ['calories', 'energy']),
    protein: readNumberFrom(row, ['protein']),
    carbs: readNumberFrom(row, ['carbs', 'carbohydrates']),
    fat: readNumberFrom(row, ['fat']),
    notes: readTextFrom(row, ['notes', 'note']),
  }
}

function normalizeWorkoutEntry(row) {
  return {
    time: readTextFrom(row, ['time']),
    activity: readTextFrom(row, ['activity', 'workout', 'name', 'type']),
    durationMinutes: readNumberFrom(row, workoutAliases.durationMinutes),
    activeCalories: readNumberFrom(row, workoutAliases.activeCalories),
    trainingLoad: readNumberFrom(row, workoutAliases.trainingLoad),
    intensity: readTextFrom(row, ['intensity']),
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
    const epoch = Date.UTC(1899, 11, 30)
    return localDateKey(new Date(epoch + value * 24 * 60 * 60 * 1000))
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
