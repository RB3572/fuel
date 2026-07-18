import test from 'node:test'
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
