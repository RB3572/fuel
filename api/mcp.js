import { sql } from './_lib/db.js'
import { automaticallySetGoals, getUserGoals, saveUserGoals } from './_lib/goals.js'
import { getNeonDashboard } from './_lib/neon-dashboard.js'
import { bearerToken, oauthChallenge, verifyAccessToken } from './_lib/mcp-auth.js'
import { appendUserContext, getUserContext } from './_lib/user-context.js'
import { ensureNutrientSchema, NUTRIENT_JSON_SCHEMA_PROPERTIES, normalizeNutrients, nutrientColumns } from './_lib/nutrients.js'
import { getRecipe, listRecipes, saveRecipe } from './_lib/recipes.js'
import { deleteFoodEntry, logRecipeAsFood, normalizeFoodRow, updateFoodEntry } from './_lib/food-entries.js'
import { getRolling24h } from './_lib/rolling-energy.js'
import { getPlaceHeatmap, renamePlace } from './_lib/places.js'
import { listDailyHistory, saveDailyHistory } from './_lib/daily-history.js'

const SERVER_VERSION = '1.5.0'
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
    name: 'update_food_entry',
    title: 'Update food entry',
    description: 'Correct an already-logged food or drink entry — its description, portion, timing, macros, or micronutrients. Call list_food_entries first to obtain the exact entry_id. Only the fields you supply change; everything else is left as it is. Micronutrients merge into the entry’s existing profile, so you can fill in what you know without resending the rest.',
    inputSchema: {
      type: 'object',
      required: ['entry_id'],
      properties: {
        entry_id: { type: 'string', minLength: 1, maxLength: 100, description: 'Exact food entry ID returned by list_food_entries.' },
        occurred_at: { type: 'string', description: 'ISO 8601 timestamp to move the entry to.' },
        meal: { type: ['string', 'null'], maxLength: 100, description: 'Meal category. Null clears it.' },
        description: { type: 'string', minLength: 1, maxLength: 1000, description: 'What was eaten. Cannot be emptied.' },
        portion: { type: ['string', 'null'], maxLength: 300 },
        calories_kcal: { type: ['number', 'null'], minimum: 0 },
        protein_g: { type: ['number', 'null'], minimum: 0 },
        carbs_g: { type: ['number', 'null'], minimum: 0 },
        fat_g: { type: ['number', 'null'], minimum: 0 },
        fiber_g: { type: ['number', 'null'], minimum: 0 },
        sugars_g: { type: ['number', 'null'], minimum: 0 },
        added_sugars_g: { type: ['number', 'null'], minimum: 0 },
        sodium_mg: { type: ['number', 'null'], minimum: 0 },
        caffeine_mg: { type: ['number', 'null'], minimum: 0 },
        nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES, additionalProperties: false, description: 'Micronutrients to merge into the entry’s existing profile.' },
        replace_nutrients: { type: 'boolean', description: 'Replace the whole micronutrient profile with `nutrients` instead of merging. Defaults to false.' },
        confidence: { type: 'string', enum: ['exact', 'high', 'medium', 'low', 'estimated'] },
        notes: { type: ['string', 'null'], maxLength: 1500 },
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
    name: 'add_user_context',
    title: 'Add to Fuel preferences and context',
    description: 'Append a newly learned durable preference to the signed-in user’s Fuel context. This only ever adds: existing context cannot be edited, replaced, or removed through this tool, so send just the new fact rather than a rewritten version of everything. Only the user can edit or delete their saved context, from the Preferences & context screen in Fuel.',
    inputSchema: {
      type: 'object',
      required: ['context'],
      properties: {
        context: { type: 'string', minLength: 1, maxLength: 20000, description: 'The new preference or fact to append. Do not restate context that is already saved.' },
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
    description: 'List recipes from the shared Fuel recipe bank, optionally filtered by name or ingredients. The bank is global: it returns every recipe anyone has contributed, not just the signed-in user’s.',
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
    description: 'Retrieve one recipe from the shared Fuel recipe bank by recipe ID or exact name, including ingredients, instructions, serving, and nutrition.',
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
  {
    name: 'add_recipe',
    title: 'Add recipe',
    description: 'Add a recipe to the shared Fuel recipe bank. The bank is a global, shared resource: the recipe becomes visible to everyone who uses Fuel, not just the person adding it. Adding a recipe whose name already exists updates that recipe in place rather than creating a duplicate.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 300, description: 'Recipe name. Matching an existing name updates that recipe for everyone.' },
        serving: { type: 'string', maxLength: 200, description: 'What one serving is, e.g. "1 bowl (350 g)".' },
        ingredients: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 100, description: 'One ingredient per item, including quantity.' },
        instructions: { type: 'array', items: { type: 'string', maxLength: 2000 }, maxItems: 60, description: 'Ordered preparation steps, one per item.' },
        source: { type: 'string', maxLength: 500, description: 'Where the recipe came from, e.g. a URL or cookbook.' },
        calories: { type: 'number', minimum: 0, maximum: 20000, description: 'Calories per serving (kcal).' },
        protein: { type: 'number', minimum: 0, maximum: 2000, description: 'Protein per serving (g).' },
        carbs: { type: 'number', minimum: 0, maximum: 2000, description: 'Carbohydrates per serving (g).' },
        fat: { type: 'number', minimum: 0, maximum: 2000, description: 'Fat per serving (g).' },
        fiber: { type: 'number', minimum: 0, maximum: 500, description: 'Fiber per serving (g).' },
        nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES, additionalProperties: false, description: 'Additional per-serving micronutrients.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'log_recipe',
    title: 'Log a recipe',
    description: 'Log a recipe from the shared Fuel recipe bank straight into the signed-in user’s food diary, scaling its per-serving nutrition by the number of servings eaten. Prefer this over log_food whenever the food is a saved recipe — the stored breakdown is more accurate than an estimate. A recipe with no nutrition breakdown is refused rather than logged as zero calories.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'string', description: 'Recipe ID from list_recipes.' },
        name: { type: 'string', maxLength: 300, description: 'Exact recipe name, if the ID is not known.' },
        servings: { type: 'number', exclusiveMinimum: 0, maximum: 20, description: 'Servings eaten. Rounded to the nearest quarter. Defaults to 1.' },
        meal: { type: 'string', maxLength: 100, description: 'Meal category such as Breakfast, Lunch, Dinner, or Snack.' },
        occurred_at: { type: 'string', description: 'ISO 8601 timestamp. Defaults to now.' },
      },
      anyOf: [{ required: ['recipe_id'] }, { required: ['name'] }],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'get_energy_balance',
    title: 'Get energy balance',
    description: 'Read the signed-in user’s calorie balance both for today so far and across the trailing 24 hours from right now. A negative balance is a deficit. The rolling figure is the better read late at night or early in the morning, when a calendar day says little.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_daily_history',
    title: 'List daily history',
    description: 'List the signed-in user’s day-level energy totals — calories burned, resting, active, and consumed — for recent days. Consumed is normally the sum of that day’s food entries; consumedOverridden marks a day whose intake was set manually instead.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'How many days back to include, ending today. Defaults to 30.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'update_daily_history',
    title: 'Update daily history',
    description: 'Correct one past day’s overall energy totals — for instance when a watch was not worn and the burn figures are wrong. Only the fields you supply change. Setting consumed overrides that day’s intake without touching its individual food entries; setting consumed to null removes the override so the day goes back to the sum of its food. To fix a single meal, use update_food_entry instead.',
    inputSchema: {
      type: 'object',
      required: ['date'],
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The day to edit, as YYYY-MM-DD.' },
        total_expenditure_kcal: { type: ['number', 'null'], minimum: 0, description: 'Total calories burned that day.' },
        resting_energy_kcal: { type: ['number', 'null'], minimum: 0 },
        active_energy_kcal: { type: ['number', 'null'], minimum: 0 },
        consumed_kcal: { type: ['number', 'null'], minimum: 0, description: 'Manual intake override. Null clears it.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_place_heatmap',
    title: 'Get 24-hour place heatmap',
    description: 'Read the pattern of where the signed-in user spends a typical day, built from location fixes taken when they open Fuel. Returns the day in half-hour slots with the place that usually dominates each one, plus readable spans such as "Place 1, 10pm–7:30am". Coordinates are deliberately never returned — only the pattern and whatever names the user gave their places. Places are unnamed until the user names them, so use rename_place before assuming which is home or work.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'How many days of history to build the pattern from. Defaults to 30.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: READ_SECURITY,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'rename_place',
    title: 'Rename a place',
    description: 'Give one of the signed-in user’s places a name, such as Home, Work, or Gym, so the heatmap reads plainly. Call get_place_heatmap first for the exact place_id, and use the name the user actually gives you rather than one inferred from the pattern.',
    inputSchema: {
      type: 'object',
      required: ['place_id', 'label'],
      properties: {
        place_id: { type: 'string', minLength: 1, maxLength: 100, description: 'Exact place ID from get_place_heatmap.' },
        label: { type: 'string', maxLength: 60, description: 'The name for this place. An empty string clears it.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes: WRITE_SECURITY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
      instructions: [
        'Fuel is a private per-user health and nutrition dashboard.',
        'Read get_user_context before interpreting health data, recommending food, or estimating food entries, and read current Fuel data before interpreting progress. Use user-supplied nutrition when available and clearly mark estimates. Never expose another user’s data.',
        'Editing food: list_food_entries returns the entry IDs that update_food_entry and delete_food_entry need. Prefer update_food_entry over deleting and re-logging, so the original timestamp survives. Deleting is permanent — confirm with the user first.',
        'Logging food: if the food is a saved recipe, use log_recipe rather than log_food, because the recipe bank’s stored breakdown beats an estimate.',
        'The recipe bank is shared by every Fuel user, so a recipe added or changed through add_recipe is visible to all of them. Everything else is private to the signed-in user.',
        'Energy: get_energy_balance covers both today so far and the trailing 24 hours; prefer the rolling figure late at night or early in the morning. update_daily_history fixes a whole day’s totals, update_food_entry fixes one meal.',
        'Location: get_place_heatmap returns when the user is usually at each place and never returns coordinates. Places are unnamed until the user names them, so ask before assuming which is home or work, and only pass rename_place a name the user actually gave you.',
        'Saved context is append-only through add_user_context: it adds a fact and can never edit or remove one, so send only what is new. If the user wants something changed or removed, tell them to edit it themselves on the Preferences & context screen.',
        'Context, goal, food, recipe, history, and place updates all require the write scope.',
      ].join(' '),
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
  if (['get_fuel_dashboard', 'list_food_entries', 'log_food', 'update_food_entry', 'delete_food_entry', 'log_recipe', 'get_energy_balance', 'list_recipes', 'get_recipe', 'add_recipe'].includes(name)) await ensureNutrientSchema()
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

  if (name === 'update_food_entry') {
    const entryId = text(args.entry_id, 100)
    if (!entryId) throw new Error('entry_id is required. Call list_food_entries to obtain the exact ID.')
    const { entry_id: _ignored, ...patch } = args
    if (!Object.keys(patch).length) throw new Error('Supply at least one field to change.')
    const result = await updateFoodEntry(userId, entryId, patch)
    if (!result) throw new Error('That food entry was not found. Call list_food_entries to obtain the exact ID.')
    return { ok: true, updated: true, entry: result.entry, previous: result.previous }
  }

  if (name === 'delete_food_entry') {
    const entryId = text(args.entry_id, 100)
    if (!entryId) throw new Error('entry_id is required. Call list_food_entries to obtain the exact ID.')
    if (args.confirm !== true) throw new Error('confirm must be true before a food entry can be permanently deleted.')
    const entry = await deleteFoodEntry(userId, entryId)
    if (!entry) return { ok: true, deleted: false, entryId }
    return { ok: true, deleted: true, entry }
  }

  if (name === 'log_recipe') {
    const result = await logRecipeAsFood(userId, {
      recipeId: text(args.recipe_id, 100) || '',
      name: text(args.name, 300) || '',
      servings: args.servings,
      meal: text(args.meal, 100) || '',
      occurredAt: args.occurred_at,
    })
    if (result.ok) return { ok: true, entry: result.entry, recipe: result.recipe, servings: result.servings }
    if (result.reason === 'missing_recipe') throw new Error('Provide recipe_id or name.')
    if (result.reason === 'not_found') throw new Error('That recipe is not in the shared Fuel recipe bank.')
    throw new Error(`${result.recipe.name} has no nutrition breakdown yet, so logging it would count as zero calories. Add one with add_recipe first.`)
  }

  if (name === 'get_energy_balance') {
    // The rolling figure is the point of this tool and comes from its own query, so a
    // failure anywhere in the much larger dashboard read must not take the whole tool
    // down with it — degrade to the rolling window alone.
    const [dashboard, rolling24h] = await Promise.all([
      getNeonDashboard(userId).catch((error) => { console.error('Energy balance dashboard read failed', error); return null }),
      getRolling24h(userId),
    ])
    const summary = dashboard?.today?.summary || {}
    return {
      today: {
        date: summary.date ?? null,
        consumed: summary.caloriesConsumed ?? null,
        burned: summary.totalExpenditure ?? null,
        restingEnergy: summary.restingEnergy ?? null,
        activeEnergy: summary.activeEnergy ?? null,
        balance: summary.energyBalance ?? null,
        partialDay: summary.partialDay ?? null,
      },
      rolling24h,
      averages: dashboard?.energyAverages ?? null,
      note: 'A negative balance is a deficit. today covers local midnight until now, so it understates a full day; rolling24h covers the trailing 24 hours.',
    }
  }

  if (name === 'list_daily_history') {
    const days = integer(args.days, 1, 365) || 30
    const history = await listDailyHistory(userId, days)
    return { days, count: history.length, history }
  }

  if (name === 'update_daily_history') {
    const date = validDate(args.date)
    if (!date) throw new Error('date must be a valid YYYY-MM-DD day.')
    // Absent keys are left alone by saveDailyHistory; explicit nulls clear the field.
    const values = {}
    const has = (key) => Object.prototype.hasOwnProperty.call(args, key)
    if (has('total_expenditure_kcal')) values.totalExpenditure = args.total_expenditure_kcal
    if (has('resting_energy_kcal')) values.restingEnergy = args.resting_energy_kcal
    if (has('active_energy_kcal')) values.activeEnergy = args.active_energy_kcal
    if (has('consumed_kcal')) values.consumed = args.consumed_kcal
    if (!Object.keys(values).length) throw new Error('Supply at least one figure to change.')
    const day = await saveDailyHistory(userId, date, values)
    return { ok: true, day }
  }

  // Location is the most sensitive thing Fuel stores, so this returns the daily
  // pattern and nothing that could place the user on a map: no coordinates, no
  // accuracy, no individual fixes.
  if (name === 'get_place_heatmap') {
    const days = integer(args.days, 1, 365) || 30
    const heatmap = await getPlaceHeatmap(userId, days)
    const label = (id) => {
      const index = heatmap.places.findIndex((place) => place.id === id)
      if (index < 0) return 'Unknown'
      return heatmap.places[index].label || `Place ${index + 1}`
    }
    const places = heatmap.places
      .filter((place) => place.samples > 0)
      .map(({ id, label: given, samples, likelyHome }, index) => ({
        id,
        label: given,
        displayName: given || `Place ${index + 1}`,
        named: Boolean(given),
        samples,
        shareOfDay: heatmap.totalSamples ? Math.round((samples / heatmap.totalSamples) * 1000) / 10 : 0,
        likelyHome,
      }))
    return {
      windowDays: heatmap.windowDays,
      totalSamples: heatmap.totalSamples,
      daysCovered: heatmap.daysCovered,
      firstSampleAt: heatmap.firstSampleAt,
      places,
      spans: placeSpans(heatmap, label),
      slots: heatmap.buckets.map(({ index, startMinute, placeId, samples, share }) => ({
        index,
        startsAt: clockLabel(startMinute),
        placeId: samples ? placeId : null,
        place: samples && placeId ? label(placeId) : null,
        samples,
        // 1 means that place wins the slot every time; lower means it varies.
        consistency: Math.round(share * 100) / 100,
      })),
      note: 'Built from fixes taken when the user opens Fuel, so slots they are rarely awake or online for are thin. Coordinates are never returned.',
    }
  }

  if (name === 'rename_place') {
    const placeId = text(args.place_id, 100)
    if (!placeId) throw new Error('place_id is required. Call get_place_heatmap to obtain the exact ID.')
    const place = await renamePlace(userId, placeId, args.label ?? '')
    return { ok: true, place }
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

  // Append-only by construction. There is no replace path here on purpose: a model
  // rewriting the whole context can silently drop facts the user told it once, months
  // ago, and never notice. Editing and deleting stay with the user.
  if (name === 'add_user_context') {
    const context = text(args.context, 20000)
    if (!context) throw new Error('context is required.')
    return appendUserContext(userId, context)
  }

  // The recipe bank is shared across every Fuel user, so these three tools
  // deliberately do not scope by userId. See api/_lib/recipes.js.
  if (name === 'list_recipes') {
    const recipes = await listRecipes({ query: text(args.query, 200) || '', limit: integer(args.limit, 1, 100) || 100 })
    return { count: recipes.length, recipes, shared: true }
  }

  if (name === 'get_recipe') {
    const recipeId = text(args.recipe_id, 100) || ''
    const recipeName = text(args.name, 300) || ''
    if (!recipeId && !recipeName) throw new Error('Provide recipe_id or name.')
    const recipe = await getRecipe({ recipeId, name: recipeName })
    if (!recipe) throw new Error('Recipe not found.')
    return { recipe, shared: true }
  }

  if (name === 'add_recipe') {
    const result = await saveRecipe(args, userId)
    return { ...result, shared: true }
  }

  throw new Error(`Tool is not implemented: ${name}`)
}

// Collapses consecutive half-hour slots that share a dominant place into the readable
// stretches a person actually thinks in ("Place 2, 9am–5pm"). Lone slots are dropped as
// noise, matching what the Places tab draws.
function placeSpans(heatmap, label) {
  const spans = []
  const slotMinutes = (24 * 60) / (heatmap.bucketsPerDay || 48)
  for (const bucket of heatmap.buckets) {
    const placeId = bucket.samples ? bucket.placeId : null
    const last = spans[spans.length - 1]
    if (last && last.placeId === placeId) {
      last.endMinute = bucket.startMinute + slotMinutes
      last.slots += 1
    } else {
      spans.push({ placeId, startMinute: bucket.startMinute, endMinute: bucket.startMinute + slotMinutes, slots: 1 })
    }
  }
  return spans
    .filter((span) => span.placeId && span.slots >= 2)
    .map((span) => ({
      placeId: span.placeId,
      place: label(span.placeId),
      from: clockLabel(span.startMinute),
      to: clockLabel(span.endMinute),
      hours: Math.round((span.slots * slotMinutes) / 6) / 10,
    }))
}

function clockLabel(minute) {
  const hour = Math.floor(minute / 60) % 24
  const minutes = Math.round(minute % 60)
  const suffix = hour < 12 ? 'am' : 'pm'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return minutes === 0 ? `${hour12}${suffix}` : `${hour12}:${String(minutes).padStart(2, '0')}${suffix}`
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
  if (name === 'update_food_entry') return `Updated ${data.entry?.description || 'the food entry'} in Fuel.`
  if (name === 'delete_food_entry') return data.deleted ? `Deleted ${data.entry?.description || 'the food entry'} from Fuel.` : 'No matching food entry was found, so nothing was deleted.'
  if (name === 'log_recipe') return `Logged ${data.servings === 1 ? '1 serving' : `${data.servings} servings`} of ${data.recipe?.name || 'the recipe'} to the Fuel diary.`
  if (name === 'get_energy_balance') {
    const rolling = data.rolling24h?.balance
    if (rolling == null) return 'Fuel does not have enough expenditure data yet to compute an energy balance.'
    return `Over the last 24 hours: ${Math.abs(rolling)} kcal ${rolling < 0 ? 'deficit' : 'surplus'}.`
  }
  if (name === 'list_daily_history') return `Returned day-level energy totals for the last ${data.days} days.`
  if (name === 'update_daily_history') return `Updated the stored totals for ${data.day?.date}.`
  if (name === 'get_place_heatmap') {
    if (!data.totalSamples) return 'No location history has been recorded yet, so there is no pattern to read.'
    return `Built a daily pattern from ${data.totalSamples} check-ins across ${data.daysCovered} ${data.daysCovered === 1 ? 'day' : 'days'}, covering ${data.places.length} ${data.places.length === 1 ? 'place' : 'places'}.`
  }
  if (name === 'rename_place') return data.place?.label ? `That place is now called ${data.place.label}.` : 'That place’s name was cleared.'
  if (name === 'set_goals' || name === 'automatically_set_goals') return 'Fuel goals were updated.'
  if (name === 'add_user_context') return 'That was added to the user\u2019s saved Fuel context.'
  if (name === 'get_user_context') return data.context ? 'Fuel preferences and context were retrieved.' : 'No Fuel preferences or context are saved yet.'
  if (name === 'list_food_entries') return `Found ${data.count} food entries from ${data.startDate} through ${data.endDate}.`
  if (name === 'get_health_data') return `Found ${data.count} daily health records from ${data.startDate} through ${data.endDate}.`
  if (name === 'list_recipes') return `Found ${data.count} recipes in the shared Fuel recipe bank.`
  if (name === 'get_recipe') return `Retrieved ${data.recipe?.name || 'the recipe'}.`
  if (name === 'add_recipe') return data.created
    ? `Added ${data.recipe?.name || 'the recipe'} to the shared Fuel recipe bank, where everyone can see it.`
    : `${data.recipe?.name || 'That recipe'} already existed in the shared Fuel recipe bank, so it was updated for everyone.`
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
