import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../api/_lib/neon-dashboard.js', import.meta.url), 'utf8')
const api = readFileSync(new URL('../api/mlog.js', import.meta.url), 'utf8')
const planner = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../public/meal-plan.js', import.meta.url), 'utf8')

test('dashboard exposes confirmed food deletion for an exact authenticated entry', () => {
  assert.match(dashboard, /id: String\(row\.id\)/)
  assert.match(app, /window\.confirm/)
  assert.match(app, /method:'DELETE'/)
  assert.match(app, /entryId:entry\.id/)
  assert.match(app, /delete-entry-button/)
  assert.match(api, /\['GET', 'POST', 'DELETE'\]/)
  assert.match(api, /DELETE FROM food_entries/)
  assert.match(api, /WHERE user_id = \$\{auth\.id\} AND id::text = \$\{entryId\}/)
})

test('Gemini plan generation uses bounded structured fields without default Maps latency', () => {
  assert.match(planner, /estimatedPlanTotal: \{ type: 'string' \}/)
  assert.match(planner, /whyThisFits: \{ type: 'string' \}/)
  assert.match(planner, /GEMINI_PLAN_TIMEOUT_MS = 18000/)
  assert.match(planner, /new AbortController\(\)/)
  assert.match(planner, /code: 'gemini_timeout'|gemini_timeout/)
  assert.doesNotMatch(planner, /requestBody\.tools = \[\{ googleMaps:/)
  assert.doesNotMatch(planner, /Return complete plain text, never JSON/)
})

test('meal-plan client times out and presents a retry instead of spinning forever', () => {
  assert.match(client, /PLAN_REQUEST_TIMEOUT_MS=35000/)
  assert.match(client, /timedFetch/)
  assert.match(client, /showGenerationError/)
  assert.match(client, /status-retry/)
  assert.match(client, /Fuel AI took too long to respond/)
})

test('initial plan generation does not block on geolocation', () => {
  assert.doesNotMatch(client, /state\.location=await getLocation\(\)/)
  assert.match(client, /Building a plan from today’s Fuel data/)
})
