import { googleFetch } from './google.js'

const MIME = 'application/vnd.google-apps.spreadsheet'
const DEFAULT_TZ = 'America/Los_Angeles'
const schemas = {
  'Food Log': ['Date','Time','Meal','Food / Description','Estimated Portion','Calories (kcal)','Protein (g)','Carbs (g)','Fat (g)','Fiber (g)','Confidence','Assumptions / Notes','Source / Image Reference'],
  'Daily Summary': ['Date','Calories (kcal)','Protein (g)','Carbs (g)','Fat (g)','Fiber (g)','Entries','Notes'],
  Recipes: ['Recipe','Yield / Serving','Ingredients and Instructions','Calories','Protein (g)','Carbs (g)','Fat (g)','Fiber (g)','Nutrition Assumptions / Notes','Source'],
  'Workout Activity': ['Date','Start Time','Workout Type','Duration (min)','Active Calories','Total Calories','Distance (mi)','Avg. Pace','Avg. Heart Rate','Avg. Cadence','Effort','Location','Notes','Source','Swimming Distance (yd)','Step Count','Stroke Count','Data Quality','Import ID'],
  'Energy Balance': ['Date','Calories Consumed','Resting Energy','Active Energy','Total Expenditure','Net Balance','Status','Running Net Balance','Assumptions / Notes','Protein (g)','Sleep (hr)','Protein Score','Energy Balance Score','Sleep Score','Training Fuel Score','Fuel Status'],
  Recovery: ['Date','Sleep (hr)','Sleep Quality (1-10)','Energy (1-10)','Hunger (1-10)','Soreness (1-10)','Resting HR','Notes','HRV','Respiratory Rate','Sleep Core (hr)','Sleep Deep (hr)','Sleep REM (hr)'],
  Goals: ['Metric','Minimum','Target','Maximum','Notes'],
}
const optionalSchemas = {
  'Health Daily': ['Date','Active Energy (kcal)','Resting Energy (kcal)','Total Expenditure (kcal)','Exercise Time (min)','Step Count','Distance (mi)','Resting HR (bpm)','HRV (ms)','VO2 Max','Sleep (hr)','Respiratory Rate','Partial Day','Source'],
  'Supplement Log': ['Date','Time','Supplement','Dose','Calories','Carbs (g)','Notes','Source'],
}
const allSchemas = { ...schemas, ...optionalSchemas }
const required = [...Object.keys(schemas), 'Dashboard']
const optional = Object.keys(optionalSchemas)
const readable = Object.keys(allSchemas)
const aliases = {
  calories: ['calories kcal','calories consumed','calories in','food calories','consumed','calories','energy'],
  resting: ['resting energy kcal','resting energy','resting calories','basal calories','bmr'],
  active: ['active energy kcal','active energy','active calories','exercise calories','workout calories','calories burned'],
  expenditure: ['total expenditure kcal','total expenditure','total calories out','total calories','tdee','energy expenditure'],
  balance: ['net balance','energy balance','deficit surplus','deficit/surplus','net calories'],
  protein: ['protein g','protein','protein grams'],
  carbs: ['carbs g','carbs','carbohydrates g','carbohydrates'],
  fat: ['fat g','fat','fats'],
  score: ['training fuel score','fuel score','score'],
  sleep: ['sleep hr','sleep hours','sleep','hours slept'],
  rhr: ['resting hr bpm','resting hr','resting heart rate','rhr'],
  recovery: ['recovery score','recovery'],
  hrv: ['hrv ms','hrv'],
  duration: ['duration min','duration minutes','duration','minutes'],
  load: ['training load','load','effort'],
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
  const params = new URLSearchParams({ q, pageSize: '10', spaces: 'drive', fields: 'files(id,name,webViewLink,createdTime,modifiedTime)' })
  const result = await googleFetch(session, `https://www.googleapis.com/drive/v3/files?${params}`)
  return result.files?.[0] || null
}

async function createWorkbook(session) {
  const sheets = required.map(title => ({ properties: { title, gridProperties: { rowCount: ['Food Log','Workout Activity'].includes(title) ? 2000 : 1000, columnCount: Math.max(12, schemas[title]?.length || 3) } } }))
  const result = await googleFetch(session, 'https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: 'MLog', timeZone: DEFAULT_TZ }, sheets }),
  })
  await initializeEmptyHeaders(session, result.spreadsheetId)
  return { id: result.spreadsheetId, name: result.properties?.title || 'MLog', webViewLink: result.spreadsheetUrl }
}

async function reconcileWorkbook(session, spreadsheetId) {
  let metadata = await spreadsheetMetadata(session, spreadsheetId)
  const titles = new Set(metadata.sheets?.map(sheet => sheet.properties.title) || [])
  const requests = required.filter(title => !titles.has(title)).map(title => ({ addSheet: { properties: { title, gridProperties: { rowCount: ['Food Log','Workout Activity'].includes(title) ? 2000 : 1000, columnCount: Math.max(12, schemas[title]?.length || 3) } } } }))
  if (requests.length) {
    await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }),
    })
    metadata = await spreadsheetMetadata(session, spreadsheetId)
  }
  // Never append columns to a populated user sheet. Existing MLog variants are
  // interpreted through aliases; canonical headers are written only to empty sheets.
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
    if (header.every(value => value === '' || value == null)) data.push({ range: `${quote(title)}!A1`, majorDimension: 'ROWS', values: [schema] })
  }
  if (!data.length) return
  await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  })
}

async function readHeader(session, id, title) {
  const result = await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${quote(title)}!1:1`)}?majorDimension=ROWS`).catch(() => ({ values: [] }))
  return result.values?.[0] || []
}

async function readWorkbook(session, id) {
  const metadata = await spreadsheetMetadata(session, id)
  const titles = new Set(metadata.sheets?.map(sheet => sheet.properties.title) || [])
  const rangesToRead = [
    ...Object.keys(schemas),
    ...optional.filter(title => titles.has(title)),
  ]
  const params = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' })
  rangesToRead.forEach(title => params.append('ranges', `${quote(title)}!A1:Z5000`))
  const result = await googleFetch(session, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${params}`)
  const workbook = Object.fromEntries(rangesToRead.map((title, index) => [title, rowsToObjects(result.valueRanges?.[index]?.values || [])]))

  return Object.fromEntries(readable.map(title => [title, workbook[title] || []]))
}

export function normalizeWorkbook(values, timeZone = DEFAULT_TZ) {
  const date = dateKey(new Date(), timeZone)
  const dailyRows = values['Daily Summary'] || [], energyRows = values['Energy Balance'] || []
  const foodRows = values['Food Log'] || [], workoutRows = values['Workout Activity'] || []
  const recoveryRows = values.Recovery || [], healthRows = values['Health Daily'] || [], goalRows = values.Goals || []
  const daily = findDateRow(dailyRows, date, timeZone), energy = findDateRow(energyRows, date, timeZone)
  const recovery = findDateRow(recoveryRows, date, timeZone), health = findDateRow(healthRows, date, timeZone)
  const foods = filterDateRows(foodRows, date, timeZone), workouts = filterDateRows(workoutRows, date, timeZone)
  const foodTotals = sumFood(foods), workoutTotals = sumWorkouts(workouts)
  const calories = numberFrom(daily, aliases.calories) ?? numberFrom(energy, aliases.calories) ?? foodTotals.calories
  const active = numberFrom(energy, aliases.active) ?? numberFrom(health, aliases.active) ?? numberFrom(daily, aliases.active) ?? workoutTotals.activeCalories
  const resting = numberFrom(energy, aliases.resting) ?? numberFrom(health, aliases.resting) ?? numberFrom(daily, aliases.resting)
  const expenditure = numberFrom(energy, aliases.expenditure) ?? numberFrom(health, aliases.expenditure) ?? numberFrom(daily, aliases.expenditure) ?? (resting != null && active != null ? resting + active : null)
  const balance = numberFrom(energy, aliases.balance) ?? numberFrom(daily, aliases.balance) ?? (calories != null && expenditure != null ? calories - expenditure : null)
  const summary = {
    date, caloriesConsumed: calories, restingEnergy: resting, activeEnergy: active,
    totalExpenditure: expenditure, energyBalance: balance,
    protein: numberFrom(daily, aliases.protein) ?? numberFrom(energy, aliases.protein) ?? foodTotals.protein,
    carbs: numberFrom(daily, aliases.carbs) ?? foodTotals.carbs,
    fat: numberFrom(daily, aliases.fat) ?? foodTotals.fat,
    fuelScore: numberFrom(energy, aliases.score) ?? numberFrom(daily, aliases.score),
    sleepHours: numberFrom(recovery, aliases.sleep) ?? numberFrom(health, aliases.sleep) ?? numberFrom(energy, aliases.sleep) ?? numberFrom(daily, aliases.sleep),
    recoveryScore: numberFrom(recovery, aliases.recovery) ?? numberFrom(daily, aliases.recovery),
    restingHeartRate: numberFrom(recovery, aliases.rhr) ?? numberFrom(health, aliases.rhr),
    hrv: numberFrom(recovery, aliases.hrv) ?? numberFrom(health, aliases.hrv),
  }
  return {
    today: { summary, foodEntries: foods.map(normalizeFood), workouts: workouts.map(normalizeWorkout) },
    goals: normalizeGoals(goalRows),
    trends: buildTrends({ dailyRows, energyRows, foodRows, workoutRows, recoveryRows, healthRows }, timeZone),
    sheetStatus: [...required, ...optional.filter(title => values[title]?.length > 0)].map(title => ({ title, rows: values[title]?.length || 0, columns: allSchemas[title] || [] })),
  }
}

function buildTrends(rows, timeZone) {
  return lastDates(21, timeZone).map(date => {
    const daily = findDateRow(rows.dailyRows, date, timeZone), energy = findDateRow(rows.energyRows, date, timeZone)
    const recovery = findDateRow(rows.recoveryRows, date, timeZone), health = findDateRow(rows.healthRows, date, timeZone)
    const foods = filterDateRows(rows.foodRows, date, timeZone), workouts = filterDateRows(rows.workoutRows, date, timeZone)
    const food = sumFood(foods), workout = sumWorkouts(workouts)
    const consumed = numberFrom(daily, aliases.calories) ?? numberFrom(energy, aliases.calories) ?? food.calories
    const active = numberFrom(energy, aliases.active) ?? numberFrom(health, aliases.active) ?? numberFrom(daily, aliases.active) ?? workout.activeCalories
    const resting = numberFrom(energy, aliases.resting) ?? numberFrom(health, aliases.resting) ?? numberFrom(daily, aliases.resting)
    const expenditure = numberFrom(energy, aliases.expenditure) ?? numberFrom(health, aliases.expenditure) ?? numberFrom(daily, aliases.expenditure) ?? (resting != null && active != null ? resting + active : null)
    return {
      date, caloriesConsumed: consumed, totalExpenditure: expenditure,
      energyBalance: numberFrom(energy, aliases.balance) ?? numberFrom(daily, aliases.balance) ?? (consumed != null && expenditure != null ? consumed - expenditure : null),
      protein: numberFrom(daily, aliases.protein) ?? numberFrom(energy, aliases.protein) ?? food.protein,
      sleepHours: numberFrom(recovery, aliases.sleep) ?? numberFrom(health, aliases.sleep) ?? numberFrom(energy, aliases.sleep) ?? numberFrom(daily, aliases.sleep),
      trainingLoad: workout.trainingLoad,
      fuelScore: numberFrom(energy, aliases.score) ?? numberFrom(daily, aliases.score),
    }
  })
}

function rowsToObjects(rows) {
  if (!rows.length) return []
  const headers = rows[0].map(value => String(value || '').trim())
  return rows.slice(1).filter(row => row.some(value => value !== '' && value != null)).map(row => {
    const object = {}
    headers.forEach((header, index) => { if (header && !(header in object)) object[header] = row[index] ?? '' })
    return object
  })
}

function normalizeGoals(rows) {
  const goals = {}
  for (const row of rows) {
    const metric = textFrom(row, ['metric','goal','name']).toLowerCase(), target = numberFrom(row, ['target','value'])
    if (!metric || target == null) continue
    if (metric.includes('protein')) goals.protein = target
    if (metric.includes('calorie') || metric.includes('energy')) goals.calories = target
    if (metric.includes('carb')) goals.carbs = target
    if (metric === 'fat' || metric.includes('fat ')) goals.fat = target
    if (metric.includes('sleep')) goals.sleepHours = target
    if (metric.includes('fuel') || metric.includes('score')) goals.fuelScore = target
  }
  return goals
}

function sumFood(rows) { return { calories: sumRows(rows, aliases.calories), protein: sumRows(rows, aliases.protein), carbs: sumRows(rows, aliases.carbs), fat: sumRows(rows, aliases.fat) } }
function sumWorkouts(rows) { return { activeCalories: sumRows(rows, aliases.active), trainingLoad: sumRows(rows, aliases.load), durationMinutes: sumRows(rows, aliases.duration) } }
function normalizeFood(row) { return { time: formatTime(rawFrom(row, ['time'])), meal: textFrom(row, ['meal','type']), food: textFrom(row, ['food description','food','item','name']), calories: numberFrom(row, aliases.calories), protein: numberFrom(row, aliases.protein), carbs: numberFrom(row, aliases.carbs), fat: numberFrom(row, aliases.fat), notes: textFrom(row, ['assumptions notes','notes','note']) } }
function normalizeWorkout(row) { return { time: formatTime(rawFrom(row, ['start time','time'])), activity: textFrom(row, ['workout type','activity','workout','name','type']), durationMinutes: numberFrom(row, aliases.duration), activeCalories: numberFrom(row, aliases.active), trainingLoad: numberFrom(row, aliases.load), intensity: textFrom(row, ['effort','intensity']), notes: textFrom(row, ['notes','note']) } }

function sumRows(rows, keys) { let total = 0, seen = false; for (const row of rows) { const value = numberFrom(row, keys); if (value != null) { total += value; seen = true } } return seen ? total : null }
function numberFrom(row, keys) { if (!row) return null; for (const value of matchingValues(row, keys)) { if (value === '' || value == null) continue; const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, '')); if (Number.isFinite(parsed)) return parsed } return null }
function textFrom(row, keys) { if (!row) return ''; for (const value of matchingValues(row, keys)) if (value !== '' && value != null) return String(value).trim(); return '' }
function rawFrom(row, keys) { return matchingValues(row, keys)[0] }
function matchingValues(row, keys) { const set = new Set(keys.map(normalizeKey)); return Object.entries(row).filter(([key]) => set.has(normalizeKey(key))).map(([, value]) => value) }
function findDateRow(rows, date, tz) { return rows.find(row => normalizeDate(rawFrom(row, ['date','day']), tz) === date) || null }
function filterDateRows(rows, date, tz) { return rows.filter(row => normalizeDate(rawFrom(row, ['date','day']), tz) === date) }

function formatTime(value) {
  if (value === '' || value == null) return ''
  if (typeof value !== 'number') return String(value).trim()
  const total = Math.round((value % 1) * 1440), hour24 = Math.floor(total / 60) % 24, minutes = total % 60
  return `${hour24 % 12 || 12}:${String(minutes).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`
}
function normalizeDate(value, tz) {
  if (value === '' || value == null) return ''
  if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10)
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) return `${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? text : dateKey(parsed, tz)
}
function lastDates(count, tz) { const today = dateKey(new Date(), tz), [y,m,d] = today.split('-').map(Number), anchor = Date.UTC(y,m-1,d,12); return Array.from({ length: count }, (_, i) => new Date(anchor - (count - 1 - i) * 86400000).toISOString().slice(0,10)) }
function dateKey(date, tz) { const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || DEFAULT_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date); const values = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}` }
function normalizeKey(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function quote(title) { return `'${title.replaceAll("'", "''")}'` }
