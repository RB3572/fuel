import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const mcp = read('../api/mcp.js')
const entries = read('../api/_lib/food-entries.js')
const mlog = read('../api/mlog.js')

test('MCP advertises the food, energy, history and place tools', () => {
  for (const name of [
    'update_food_entry', 'delete_food_entry', 'log_recipe',
    'get_energy_balance', 'list_daily_history', 'update_daily_history',
    'get_place_heatmap', 'rename_place',
  ]) {
    assert.match(mcp, new RegExp(`name: '${name}'`), `${name} is not declared`)
    assert.match(mcp, new RegExp(`if \\(name === '${name}'\\)`), `${name} has no executor`)
  }
})

test('every write tool demands the write scope and every read tool is marked read-only', () => {
  const writes = ['update_food_entry', 'delete_food_entry', 'log_recipe', 'update_daily_history', 'rename_place']
  const reads = ['get_energy_balance', 'list_daily_history', 'get_place_heatmap']
  const blockFor = (name) => {
    const start = mcp.indexOf(`name: '${name}'`)
    return mcp.slice(start, mcp.indexOf('\n  },', start))
  }
  for (const name of writes) assert.match(blockFor(name), /securitySchemes: WRITE_SECURITY/, `${name} should require the write scope`)
  for (const name of reads) {
    assert.match(blockFor(name), /securitySchemes: READ_SECURITY/, `${name} should be a read scope`)
    assert.match(blockFor(name), /readOnlyHint: true/, `${name} should be annotated read-only`)
  }
})

test('food edits are patches: absent fields are kept, explicit nulls clear', () => {
  assert.match(entries, /const has = \(key\) => Object\.prototype\.hasOwnProperty\.call\(patch, key\)/)
  assert.match(entries, /if \(!has\(arg\)\) return current\[column\] \?\? null/)
  assert.match(entries, /if \(patch\[arg\] === null\) return null/)
  // A blank description would leave an unidentifiable row in the diary.
  assert.match(entries, /description cannot be emptied/)
  assert.match(mcp, /Supply at least one field to change/)
})

test('micronutrients merge onto the stored profile unless a replace is requested', () => {
  assert.match(entries, /patch\.replace_nutrients === true \? \{\} : nutrientsFromRow\(current\)/)
  assert.match(entries, /for \(const \[arg, key\] of COLUMN_NUTRIENTS\) if \(has\(arg\) && patch\[arg\] === null\) delete nutrients\[key\]/)
  // The four mirrored columns must be recomputed from the merged profile, not left stale.
  assert.match(entries, /const columns = nutrientColumns\(nutrients\)/)
  assert.match(entries, /sugars_g = \$\{columns\.sugarsG\}/)
})

test('every diary write is scoped to the signed-in user', () => {
  const scoped = entries.match(/WHERE user_id = \$\{userId\}/g) || []
  assert.ok(scoped.length >= 4, `expected every diary query to filter by user_id, found ${scoped.length}`)
  assert.match(entries, /INSERT INTO food_entries[\s\S]*?\$\{userId\}/)
})

test('logging a recipe reads nutrition server-side and refuses an empty breakdown', () => {
  // Nutrition comes from the bank, never from the caller, so a crafted request cannot
  // forge what lands in the diary.
  assert.match(entries, /const recipe = await getRecipe\(\{ recipeId, name \}\)/)
  assert.match(entries, /if \(recipe\.nutrition\?\.calories == null\) return \{ ok: false, reason: 'needs_nutrition'/)
  assert.match(entries, /Math\.min\(20, Math\.round\(parsed \* 4\) \/ 4\)/)
  assert.match(mcp, /no nutrition breakdown yet/)
})

test('the dashboard and MCP log recipes through the same helper', () => {
  assert.match(mlog, /import \{ logRecipeAsFood \} from '\.\/_lib\/food-entries\.js'/)
  assert.match(mcp, /logRecipeAsFood/)
  // The dashboard's status codes have to survive the shared helper.
  assert.match(mlog, /sendJson\(res, 422, \{ error: 'A recipe is required\.' \}/)
  assert.match(mlog, /sendJson\(res, 404/)
  assert.match(mlog, /needsNutrition: true/)
})

test('the rolling 24-hour balance has one implementation, shared by both surfaces', () => {
  const rolling = read('../api/_lib/rolling-energy.js')
  assert.match(rolling, /export async function getRolling24h/)
  assert.match(mlog, /import \{ getRolling24h \} from '\.\/_lib\/rolling-energy\.js'/)
  assert.match(mcp, /import \{ getRolling24h \} from '\.\/_lib\/rolling-energy\.js'/)
  assert.doesNotMatch(mlog, /async function readRolling24h/)
})

test('get_energy_balance survives a failing dashboard read', () => {
  // The rolling window is the point of the tool and comes from its own query.
  assert.match(mcp, /getNeonDashboard\(userId\)\.catch\(/)
  assert.match(mcp, /A negative balance is a deficit/)
})

test('editing a day overrides intake without touching that day’s food entries', () => {
  const history = read('../api/_lib/daily-history.js')
  assert.match(history, /calories_consumed_override = CASE WHEN \$\{consumed !== undefined\}/)
  assert.doesNotMatch(history, /DELETE FROM food_entries|UPDATE food_entries/)
  assert.match(mcp, /Supply at least one figure to change/)
  assert.match(mcp, /use update_food_entry instead/)
})

test('the place heatmap never returns coordinates to an MCP client', () => {
  const start = mcp.indexOf("if (name === 'get_place_heatmap')")
  const block = mcp.slice(start, mcp.indexOf("if (name === 'rename_place')", start))
  // Only these fields are copied out of the heatmap; latitude/longitude are dropped.
  assert.doesNotMatch(block, /latitude|longitude/)
  assert.match(block, /Coordinates are never returned/)
  assert.match(mcp, /Coordinates are deliberately never returned/)
})

test('place reads and renames are scoped to the signed-in user', () => {
  const places = read('../api/_lib/places.js')
  assert.match(places, /WHERE user_id = \$\{userId\}/)
  assert.match(places, /WHERE id = \$\{String\(placeId\)\}::uuid AND user_id = \$\{userId\}/)
  assert.match(mcp, /getPlaceHeatmap\(userId, days\)/)
  assert.match(mcp, /renamePlace\(userId, placeId/)
})

test('server instructions tell a client how to use the new tools', () => {
  assert.match(mcp, /SERVER_VERSION = '1\.5\.0'/)
  assert.match(mcp, /Prefer update_food_entry over deleting and re-logging/)
  assert.match(mcp, /use log_recipe rather than log_food/)
  assert.match(mcp, /ask before assuming which is home or work/)
})
