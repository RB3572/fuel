from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f"Expected source not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once('api/mcp.js', "const SERVER_VERSION = '1.3.0'", "const SERVER_VERSION = '1.4.0'")

replace_once(
    'api/mcp.js',
    "instructions: 'Fuel is a private per-user health and nutrition dashboard. Read get_user_context before interpreting health data, recommending food, or estimating food entries. Read current Fuel data before interpreting progress. Use user-supplied nutrition when available and clearly mark estimates. Never expose another user’s data. Context, goal, and food updates require the write scope.',",
    "instructions: 'Fuel is a private per-user health and nutrition dashboard. Read get_user_context before interpreting health data, recommending food, or estimating food entries. Read current Fuel data before interpreting progress. Use user-supplied nutrition when available and clearly mark estimates. Never expose another user’s data. Context, goal, and food updates require the write scope. Before deleting food, list entries to obtain the exact entry ID and require explicit user confirmation.',",
)

delete_tool = r'''  {
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
'''
replace_once(
    'api/mcp.js',
    "  {\n    name: 'get_goals',",
    delete_tool + "  {\n    name: 'get_goals',",
)

replace_once(
    'api/mcp.js',
    "if (['get_fuel_dashboard', 'list_food_entries', 'log_food', 'list_recipes', 'get_recipe'].includes(name)) await ensureNutrientSchema()",
    "if (['get_fuel_dashboard', 'list_food_entries', 'log_food', 'delete_food_entry', 'list_recipes', 'get_recipe'].includes(name)) await ensureNutrientSchema()",
)

delete_handler = r'''
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
'''
replace_once(
    'api/mcp.js',
    "\n  if (name === 'get_goals') return getUserGoals(userId)",
    delete_handler + "\n  if (name === 'get_goals') return getUserGoals(userId)",
)

replace_once(
    'api/mcp.js',
    "  if (name === 'log_food') return data.duplicatePrevented ? 'This food entry was already logged, so no duplicate was created.' : 'Food was logged in Fuel.'",
    "  if (name === 'log_food') return data.duplicatePrevented ? 'This food entry was already logged, so no duplicate was created.' : 'Food was logged in Fuel.'\n  if (name === 'delete_food_entry') return data.deleted ? `Deleted ${data.entry?.description || 'the food entry'} from Fuel.` : 'No matching food entry was found, so nothing was deleted.'",
)

Path('test/mcp-delete-food-entry.test.js').write_text(r'''import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../api/mcp.js', import.meta.url), 'utf8')

test('MCP exposes a confirmed destructive delete food tool', () => {
  assert.match(source, /name: 'delete_food_entry'/)
  assert.match(source, /required: \['entry_id', 'confirm'\]/)
  assert.match(source, /confirm: \{ type: 'boolean', enum: \[true\]/)
  assert.match(source, /destructiveHint: true/)
  assert.match(source, /securitySchemes: WRITE_SECURITY/)
})

test('food deletion is scoped to the authenticated user and returns the deleted row', () => {
  assert.match(source, /DELETE FROM food_entries/)
  assert.match(source, /WHERE user_id = \$\{userId\} AND id::text = \$\{entryId\}/)
  assert.match(source, /args\.confirm !== true/)
  assert.match(source, /RETURNING id, occurred_at, meal, description/)
  assert.match(source, /deleted: false, entryId/)
  assert.match(source, /deleted: true, entry: normalizeFoodRow/)
})
''')
