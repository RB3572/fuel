import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../api/mcp.js', import.meta.url), 'utf8')
// The diary writes themselves live in the shared helper, so both the dashboard API and
// the MCP server edit food the same way.
const entries = fs.readFileSync(new URL('../api/_lib/food-entries.js', import.meta.url), 'utf8')

test('MCP exposes a confirmed destructive delete food tool', () => {
  assert.match(source, /name: 'delete_food_entry'/)
  assert.match(source, /required: \['entry_id', 'confirm'\]/)
  assert.match(source, /confirm: \{ type: 'boolean', enum: \[true\]/)
  assert.match(source, /destructiveHint: true/)
  assert.match(source, /securitySchemes: WRITE_SECURITY/)
})

test('food deletion is confirmed at the tool and scoped to the owner in SQL', () => {
  assert.match(source, /args\.confirm !== true/)
  assert.match(source, /deleted: false, entryId/)
  assert.match(source, /deleted: true, entry/)
  assert.match(entries, /DELETE FROM food_entries WHERE user_id = \$\{userId\} AND id::text = \$\{String\(entryId\)\}/)
  assert.match(entries, /RETURNING id, occurred_at, meal, description/)
})
