import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const mcp = read('../api/mcp.js')
const planner = read('../api/_lib/meal-plan.js')
const mlog = read('../api/mlog.js')

// Saved context is append-only for anything the model drives. A model that rewrites the
// whole context silently drops facts the user mentioned once months ago; only the user
// can edit or delete, from the Preferences & context screen.

test('the MCP context tool can only append', () => {
  assert.match(mcp, /name: 'add_user_context'/)
  assert.doesNotMatch(mcp, /update_user_context/)
  // No mode switch, and no way to reach the overwriting helper.
  assert.doesNotMatch(mcp, /mode: \{ type: 'string', enum: \['append', 'replace'\] \}/)
  assert.doesNotMatch(mcp, /saveUserContext/)
  assert.match(mcp, /import \{ appendUserContext, getUserContext \} from '\.\/_lib\/user-context\.js'/)
  assert.match(mcp, /return appendUserContext\(userId, context\)/)
})

test('the MCP tool description and instructions say it cannot edit or remove', () => {
  assert.match(mcp, /existing context cannot be edited, replaced, or removed/)
  assert.match(mcp, /Saved context is append-only through add_user_context/)
  assert.match(mcp, /edit it themselves on the Preferences & context screen/)
})

test('Fuel AI on the website can only append context', () => {
  assert.match(planner, /if \(answer\.contextUpdate\) contextResult = await appendUserContext\(userId, answer\.contextUpdate\.context\)/)
  assert.doesNotMatch(planner, /saveUserContext/)
  // The response schema no longer offers a mode, and an invented one is dropped.
  assert.match(planner, /contextUpdate: \{\s*type: 'object',\s*properties: \{ context: \{ type: 'string' \} \},/)
  assert.doesNotMatch(planner, /value\.mode === 'replace'/)
  assert.match(planner, /Saved context is append-only: what you send is added to it/)
})

test('the user can still fully edit their own context from the website', () => {
  // The Preferences & context modal posts the whole textarea; that path is the human's,
  // not the model's, and must keep overwriting.
  assert.match(mlog, /saveUserContext\(auth\.id, unwrap\(req\.body\)\.context\)/)
  assert.match(read('../api/_lib/user-context.js'), /export async function saveUserContext/)
})
