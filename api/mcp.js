import { sql } from './_lib/db.js'
import { automaticallySetGoals, getUserGoals, saveUserGoals } from './_lib/goals.js'
import { getNeonDashboard } from './_lib/neon-dashboard.js'
import { bearerToken, oauthChallenge, verifyAccessToken } from './_lib/mcp-auth.js'
import { appendUserContext, getUserContext, saveUserContext } from './_lib/user-context.js'
import { ensureNutrientSchema, NUTRIENT_JSON_SCHEMA_PROPERTIES, normalizeNutrients, nutrientColumns, nutrientsFromRow } from './_lib/nutrients.js'

const SERVER_VERSION = '1.4.0'
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const TIME_ZONE = 'America/Los_Angeles'

const READ_SECURITY = [{ type: 'oauth2', scopes: ['fuel:read'] }]
const WRITE_SECURITY = [{ type: 'oauth2', scopes: ['fuel:write'] }]

const tools = [
  {
    name: 'get_fuel_dashboard',
    title: 'Get Fuel dashboard',
    description: 'Retrieve the signed-in user’s current Fuel summary, nutrition, activity, recovery, goals, food, workouts, saved context, and optional 30-day trends.',
    inputSchema: {
      type: 'object',
      properties: {
        include_trends: { type: 'boolean', description: 'Include the 30-day trend series. Defaults to true.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_health_data',
    title: 'Get health data',
    description: 'Read every Apple Health daily metric stored in Fuel for a date range, including the normalized columns and original Shortcut payload.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Inclusive YYYY-MM-DD start date. Defaults to 30 days ago.' },
        end_date: { type: 'string', description: 'Inclusive YYYY-MM-DD end date. Defaults to today.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum records. Defaults to 31.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_food_entries',
    title: 'List food entries',
    description: 'List logged food and drink entries with macros, sodium, caffeine, sugars, and the complete standardized nutrient profile.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Inclusive YYYY-MM-DD start date. Defaults to today.' },
        end_date: { type: 'string', description: 'Inclusive YYYY-MM-DD end date. Defaults to start_date.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum entries. Defaults to 100.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'log_food',
    title: 'Log food',
    description: 'Add a food or drink entry with macros and detailed nutrients. Read user context first, use supplied values when available, estimate only when appropriate, and omit unknown nutrient values.',
    inputSchema: {
      type: 'object',
      required: ['description', 'idempotency_key'],
      properties: {
        idempotency_key: { type: 'string', minLength: 8, maxLength: 120, description: 'Stable unique key for this intended log entry so retries do not create duplicates.' },
        occurred_at: { type: 'string', description: 'ISO 8601 timestamp. Defaults to now.' },
        meal: { type: 'string', description: 'Meal category such as Breakfast, Lunch, Dinner, Snack, or Dessert.' },
        description: { type: 'string', minLength: 1, maxLength: 1000 },
        portion: { type: 'string', maxLength: 300 },
        calories_kcal: { type: 'number', minimum: 0 },
        protein_g: { type: 'number', minimum: 0 },
        carbs_g: { type: 'number', minimum: 0 },
        fat_g: { type: 'number', minimum: 0 },
        fiber_g: { type: 'number', minimum: 0 },
        sugars_g: { type: 'number', minimum: 0 },
        added_sugars_g: { type: 'number', minimum: 0 },
        sodium_mg: { type: 'number', minimum: 0 },
        caffeine_mg: { type: 'number', minimum: 0 },
        nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES, additionalProperties: false, description: 'Optional detailed nutrient values using the units encoded in each property name.' },
        confidence: { type: 'string', enum: ['exact', 'high', 'medium', 'low', 'estimated'] },
        notes: { type: 'string', maxLength: 1500 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'delete_food_entry',
    title: 'Delete food entry',
    description: 'Permanently delete one food or drink entry belonging to the signed-in user. Call list_food_entries first to obtain the exact entry_id, and only call this tool after the user explicitly confirms the deletion.',
    inputSchema: {
      type: 'object',
      required: ['entry_id', 'confirm'],
      properties: {
        entry_id: { type: 'string', minLength: 1, maxLength: 100, description: 'Exact food entry ID returned by list_food_entries.' },
        confirm: { type: 'boolean', enum: [true], description: 'Must be true to confirm permanent deletion.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_goals',
    title: 'Get goals',
    description: 'Read the signed-in user’s percentage-based calorie balance target, calculated daily calorie target, average daily burn, macros, activity, steps, and sleep goals.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'set_goals',
    title: 'Set goals',
    description: 'Update one or more Fuel goals for the signed-in user. Omitted goals retain their current values.',
    inputSchema: {
      type: 'object',
      properties: {
        calorie_balance_percent: { type: 'number', minimum: -50, maximum: 50, description: 'Negative is a deficit, positive is a surplus, and zero is maintenance relative to average daily calories burned.' },
        protein: { type: 'number', minimum: 20, maximum: 400 },
        carbs: { type: 'number', minimum: 20, maximum: 1000 },
        fat: { type: 'number', minimum: 15, maximum: 300 },
        fiber: { type: 'number', minimum: 5, maximum: 100 },
        move: { type: 'number', minimum: 100, maximum: 2500 },
        exercise: { type: 'number', minimum: 5, maximum: 240 },
        stand: { type: 'number', minimum: 15, maximum: 360 },
        steps: { type: 'number', minimum: 1000, maximum: 50000 },
        sleep_hours: { type: 'number', minimum: 4, maximum: 12 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'automatically_set_goals',
    title: 'Automatically set goals',
    description: 'Calculate and save personalized calorie, macro, activity, steps, and sleep goals from height, weight, age, objective, and recent completed expenditure history excluding today.',
    inputSchema: {
      type: 'object',
      required: ['height_in', 'weight_lb', 'age', 'objective'],
      properties: {
        height_in: { type: 'number', exclusiveMinimum: 36, exclusiveMaximum: 96 },
        weight_lb: { type: 'number', exclusiveMinimum: 60, exclusiveMaximum: 700 },
        age: { type: 'integer', minimum: 16, maximum: 100 },
        objective: { type: 'string', enum: ['maintenance', 'deficit', 'gain'] },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_user_context',
    title: 'Get Fuel preferences and context',
    description: 'Read the signed-in user’s saved food preferences, allergies, activity preferences, goals, and other guidance for interpreting and updating Fuel.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'update_user_context',
    title: 'Update Fuel preferences and context',
    description: 'Append new durable user preferences or replace the complete Fuel context. Use append for newly learned facts so existing context is preserved.',
    inputSchema: {
      type: 'object',
      required: ['context'],
      properties: {
        context: { type: 'string', minLength: 1, maxLength: 20000, description: 'Preference or context text to save.' },
        mode: { type: 'string', enum: ['append', 'replace'], description: 'Defaults to append. Replace overwrites the complete saved context.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'list_recipes',
    title: 'List recipes',
    description: 'List recipes saved in the signed-in user’s Fuel recipe index, optionally filtered by name or ingredients.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_recipe',
    title: 'Get recipe',
    description: 'Retrieve one saved Fuel recipe by recipe ID or exact name, including ingredients, instructions, serving, and nutrition.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'string' },
        name: { type: 'string' },
      },
      anyOf: [{ required: ['recipe_id'] }, { required: ['name'] }],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]

const toolByName = new Map(tools.map((tool) => [tool.name, tool]))

export default async function handler(req, res) {
  setTransportHeaders(res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    sendJson(res, 405, { error: 'Fuel MCP uses Streamable HTTP POST requests at /mcp.' })
    return
  }

  let body
  try {
    body = parseBody(req.body)
  } catch {
    sendJson(res, 400, rpcError(null, -32700, 'Parse error'))
    return
  }

  try {
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((message) => handleMessage(req, message)))).filter(Boolean)
      if (!responses.length) {
        res.statusCode = 204
        res.end()
        return
      }
      sendJson(res, 200, responses)
      return
    }

    const response = await handleMessage(req, body)
    if (!response) {
      res.statusCode = 204
      res.end()
      return
    }
    sendJson(res, 200, response)
  } catch (error) {
    console.error('Fuel MCP request failed', error)
    sendJson(res, 200, rpcError(body?.id ?? null, -32603, error instanceof Error ? error.message : 'Internal error'))
  }
}

async function handleMessage(req, message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message?.id ?? null, -32600, 'Invalid Request')
  }
  const id = message.id
  const isNotification = id === undefined || id === null

  if (message.method === 'notifications/initialized' || message.method.startsWith('notifications/')) return null
  if (message.method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: String(message.params?.protocolVersion || DEFAULT_PROTOCOL_VERSION),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Fuel', title: 'Fuel Health and Nutrition', version: SERVER_VERSION },
      instructions: 'Fuel is a private per-user health and nutrition dashboard. Read get_user_context before interpreting health data, recommending food, or estimating food entries. Read current Fuel data before interpreting progress. Use user-supplied nutrition when available and clearly mark estimates. Never expose another user’s data. Context, goal, and food updates require the write scope. Before deleting food, list entries to obtain the exact entry ID and require explicit user confirmation.',
    })
  }
  if (message.method === 'ping') return rpcResult(id, {})
  if (message.method === 'tools/list') return rpcResult(id, { tools })
  if (message.method === 'resources/list') return rpcResult(id, { resources: [] })
  if (message.method === 'prompts/list') return rpcResult(id, { prompts: [] })
  if (message.method === 'tools/call') return rpcResult(id, await callTool(req, message.params || {}))

  return isNotification ? null : rpcError(id, -32601, `Method not found: ${message.method}`)
}

async function callTool(req, params) {
  const name = String(params.name || '')
  const descriptor = toolByName.get(name)
  if (!descriptor) return toolError(`Unknown Fuel tool: ${name}`)

  const requiredScope = descriptor.securitySchemes?.[0]?.scopes?.[0] || 'fuel:read'
  const auth = verifyAccessToken(bearerToken(req), [requiredScope])
  if (!auth) return authenticationError(requiredScope)

  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
  try {
    const data = await executeTool(name, auth.userId, args)
    return {
      content: [{ type: 'text', text: summarize(name, data) }],
      structuredContent: data,
    }
  } catch (error) {
    console.error(`Fuel MCP tool ${name} failed`, error)
    return toolError(error instanceof Error ? error.message : 'Fuel tool failed.')
  }
}

async function executeTool(name, userId, args) {
  if (['get_fuel_dashboard', 'list_food_entries', 'log_food', 'delete_food_entry', 'list_recipes', 'get_recipe'].includes(name)) await ensureNutrientSchema()
  if (name === 'get_fuel_dashboard') {
    const [dashboard, userContext] = await Promise.all([
      getNeonDashboard(userId),
      getUserContext(userId),
    ])
    const complete = { ...dashboard, userContext }
    if (args.include_trends === false) {
      const { trends, ...withoutTrends } = complete
      return withoutTrends
    }
    return complete
  }

  if (name === 'get_health_data') {
    const endDate = validDate(args.end_date) || today()
    const startDate = validDate(args.start_date) || shiftDate(endDate, -30)
    assertDateOrder(startDate, endDate, 93)
    const limit = integer(args.limit, 1, 100) || 31
    const db = sql()
    const records = await db`
      SELECT date, active_energy_kcal, resting_energy_kcal, total_expenditure_kcal,
        exercise_minutes, step_count, walking_running_distance_mi, swimming_distance_yd,
        resting_heart_rate_bpm, hrv_ms, vo2_max, sleep_hours, respiratory_rate,
        blood_oxygen_percent, stand_minutes, walking_heart_rate_avg_bpm,
        cycling_distance_mi, flights_climbed, swimming_strokes, running_stride_length_m,
        cardio_recovery_bpm, partial_day, source, raw_payload, updated_at
      FROM health_daily
      WHERE user_id = ${userId} AND date BETWEEN ${startDate}::date AND ${endDate}::date
      ORDER BY date DESC
      LIMIT ${limit}
    `
    return { startDate, endDate, count: records.length, records }
  }

  if (name === 'list_food_entries') {
    const startDate = validDate(args.start_date) || today()
    const endDate = validDate(args.end_date) || startDate
    assertDateOrder(startDate, endDate, 93)
    const limit = integer(args.limit, 1, 200) || 100
    const db = sql()
    const entries = await db`
      SELECT id, occurred_at, meal, description, portion, calories_kcal, protein_g,
        carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
      FROM food_entries
      WHERE user_id = ${userId}
        AND occurred_at >= ${startDate}::date
        AND occurred_at < (${endDate}::date + interval '1 day')
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `
    return { startDate, endDate, count: entries.length, entries: entries.map(normalizeFoodRow) }
  }

  if (name === 'log_food') {
    const description = text(args.description, 1000)
    const idempotencyKey = text(args.idempotency_key, 120)
    if (!description || !idempotencyKey || idempotencyKey.length < 8) throw new Error('description and a stable idempotency_key are required.')
    const source = `Fuel MCP:${idempotencyKey}`
    const db = sql()
    const existing = await db`
      SELECT id, occurred_at, meal, description, portion, calories_kcal, protein_g,
        carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
      FROM food_entries WHERE user_id = ${userId} AND source = ${source} LIMIT 1
    `
    if (existing.length) return { ok: true, duplicatePrevented: true, entry: normalizeFoodRow(existing[0]) }

    const nutrients = normalizeNutrients({
      ...(args.nutrients && typeof args.nutrients === 'object' ? args.nutrients : {}),
      sugars_g: args.sugars_g,
      added_sugars_g: args.added_sugars_g,
      sodium_mg: args.sodium_mg,
      caffeine_mg: args.caffeine_mg,
    })
    const core = nutrientColumns(nutrients)
    const occurredAt = validTimestamp(args.occurred_at) || new Date()
    const rows = await db`
      INSERT INTO food_entries (
        user_id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients,
        confidence, notes, source, updated_at
      ) VALUES (
        ${userId}, ${occurredAt.toISOString()}, ${text(args.meal, 100)}, ${description}, ${text(args.portion, 300)},
        ${nonnegative(args.calories_kcal)}, ${nonnegative(args.protein_g)}, ${nonnegative(args.carbs_g)},
        ${nonnegative(args.fat_g)}, ${nonnegative(args.fiber_g)},
        ${core.sugarsG}, ${core.addedSugarsG}, ${core.sodiumMg}, ${core.caffeineMg}, ${JSON.stringify(nutrients)}::jsonb,
        ${text(args.confidence, 30) || 'estimated'}, ${text(args.notes, 1500)}, ${source}, now()
      )
      RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g,
        carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
    `
    return { ok: true, duplicatePrevented: false, entry: normalizeFoodRow(rows[0]) }
  }

  if (name === 'delete_food_entry') {
    const entryId = text(args.entry_id, 100)
    if (!entryId) throw new Error('entry_id is required. Call list_food_entries to obtain the exact ID.')
    if (args.confirm !== true) throw new Error('confirm must be true before a food entry can be permanently deleted.')
    const db = sql()
    const rows = await db`
      DELETE FROM food_entries
      WHERE user_id = ${userId} AND id::text = ${entryId}
      RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g,
        carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
    `
    if (!rows.length) return { ok: true, deleted: false, entryId }
    return { ok: true, deleted: true, entry: normalizeFoodRow(rows[0]) }
  }

  if (name === 'get_goals') return getUserGoals(userId)

  if (name === 'set_goals') {
    const input = { ...args }
    if (input.calorie_balance_percent !== undefined) {
      input.calorieBalancePercent = input.calorie_balance_percent
      delete input.calorie_balance_percent
    }
    if (input.sleep_hours !== undefined) {
      input.sleepHours = input.sleep_hours
      delete input.sleep_hours
    }
    return saveUserGoals(userId, input)
  }

  if (name === 'automatically_set_goals') {
    return automaticallySetGoals(userId, {
      heightIn: args.height_in,
      weightLb: args.weight_lb,
      age: args.age,
      objective: args.objective,
    })
  }

  if (name === 'get_user_context') return getUserContext(userId)

  if (name === 'update_user_context') {
    const context = text(args.context, 20000)
    if (!context) throw new Error('context is required.')
    return args.mode === 'replace'
      ? saveUserContext(userId, context)
      : appendUserContext(userId, context)
  }

  if (name === 'list_recipes') {
    const query = text(args.query, 200) || ''
    const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`
    const limit = integer(args.limit, 1, 100) || 100
    const db = sql()
    const recipes = await db`
      SELECT id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients, notes, source, updated_at
      FROM recipes
      WHERE user_id = ${userId}
        AND (${query} = '' OR name ILIKE ${pattern} ESCAPE '\\' OR ingredients ILIKE ${pattern} ESCAPE '\\')
      ORDER BY name ASC
      LIMIT ${limit}
    `
    return { count: recipes.length, recipes: recipes.map(normalizeRecipe) }
  }

  if (name === 'get_recipe') {
    const recipeId = text(args.recipe_id, 100) || ''
    const recipeName = text(args.name, 300) || ''
    if (!recipeId && !recipeName) throw new Error('Provide recipe_id or name.')
    const db = sql()
    const rows = await db`
      SELECT id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients, notes, source, updated_at
      FROM recipes
      WHERE user_id = ${userId}
        AND (id::text = ${recipeId} OR (${recipeName} <> '' AND lower(name) = lower(${recipeName})))
      LIMIT 1
    `
    if (!rows.length) throw new Error('Recipe not found.')
    return { recipe: normalizeRecipe(rows[0]) }
  }

  throw new Error(`Tool is not implemented: ${name}`)
}

function normalizeFoodRow(row) {
  return { ...row, nutrients: nutrientsFromRow(row) }
}

function normalizeRecipe(row) {
  return {
    id: row.id,
    name: row.name,
    serving: row.serving || '',
    ingredients: splitList(row.ingredients),
    instructions: splitInstructions(row.notes),
    nutrition: {
      calories: nullableNumber(row.calories_kcal),
      protein: nullableNumber(row.protein_g),
      carbs: nullableNumber(row.carbs_g),
      fat: nullableNumber(row.fat_g),
      fiber: nullableNumber(row.fiber_g),
      nutrients: nutrientsFromRow(row),
    },
    source: row.source || '',
    updatedAt: row.updated_at || null,
  }
}

function splitList(value) {
  return value ? String(value).split(/\s*;\s*|\n+/).map((item) => item.trim()).filter(Boolean) : []
}
function splitInstructions(value) {
  if (!value || /^saved recipe\.?$/i.test(String(value).trim())) return []
  return String(value).split(/\n+|(?<=\.)\s+(?=[A-Z0-9])/).map((item) => item.trim()).filter(Boolean)
}

function authenticationError(scope) {
  const challenge = oauthChallenge(scope)
  return {
    content: [{ type: 'text', text: 'Connect your Fuel account to use this tool.' }],
    isError: true,
    _meta: { 'mcp/www_authenticate': [challenge] },
  }
}

function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function summarize(name, data) {
  if (name === 'log_food') return data.duplicatePrevented ? 'This food entry was already logged, so no duplicate was created.' : 'Food was logged in Fuel.'
  if (name === 'delete_food_entry') return data.deleted ? `Deleted ${data.entry?.description || 'the food entry'} from Fuel.` : 'No matching food entry was found, so nothing was deleted.'
  if (name === 'set_goals' || name === 'automatically_set_goals') return 'Fuel goals were updated.'
  if (name === 'update_user_context') return 'Fuel preferences and context were updated.'
  if (name === 'get_user_context') return data.context ? 'Fuel preferences and context were retrieved.' : 'No Fuel preferences or context are saved yet.'
  if (name === 'list_food_entries') return `Found ${data.count} food entries from ${data.startDate} through ${data.endDate}.`
  if (name === 'get_health_data') return `Found ${data.count} daily health records from ${data.startDate} through ${data.endDate}.`
  if (name === 'list_recipes') return `Found ${data.count} saved recipes.`
  if (name === 'get_recipe') return `Retrieved ${data.recipe?.name || 'the recipe'}.`
  return 'Fuel data retrieved.'
}

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result } }
function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}
function parseBody(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body
  return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || ''))
}
function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
function setTransportHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id')
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version, MCP-Session-Id')
  res.setHeader('Cache-Control', 'no-store')
}
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date()) }
function validDate(value) {
  const text = String(value || '')
  return /^20\d{2}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T12:00:00Z`).getTime()) ? text : null
}
function shiftDate(dateText, amount) {
  const date = new Date(`${dateText}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}
function assertDateOrder(startDate, endDate, maximumDays) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const days = (end - start) / 86400000
  if (days < 0) throw new Error('start_date must not be after end_date.')
  if (days > maximumDays) throw new Error(`Date range cannot exceed ${maximumDays} days.`)
}
function integer(value, minimum, maximum) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}
function nonnegative(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Nutrition values must be nonnegative numbers.')
  return parsed
}
function nullableNumber(value) {
  const parsed = Number(value)
  return value == null || value === '' || !Number.isFinite(parsed) ? null : parsed
}
function text(value, maximumLength) {
  if (value == null) return null
  const normalized = String(value).trim()
  if (!normalized) return null
  if (normalized.length > maximumLength) throw new Error(`Text value exceeds ${maximumLength} characters.`)
  return normalized
}
function validTimestamp(value) {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}
