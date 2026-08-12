import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const history = read('../api/_lib/daily-history.js')
const dashboard = read('../api/_lib/neon-dashboard.js')

// Editing a past day moved every figure except the deficit/surplus chart. Apple Health
// flags an in-progress day partial_day, the chart suppresses partial days so a
// half-finished today does not draw a fake deficit, and nothing but a later sync ever
// cleared the flag — so a day whose last sync landed mid-afternoon stayed partial
// forever and could not be corrected by hand.

test('the deficit chart still suppresses days that are genuinely in progress', () => {
  assert.match(dashboard, /energyBalance: partialDay \|\| calories == null \|\| expenditure == null \? null :/)
  assert.match(dashboard, /const partialDay = Boolean\(health\?\.partial_day\)/)
})

test('a manual edit clears partial_day, on both insert and update', () => {
  const insert = history.slice(history.indexOf('INSERT INTO health_daily'), history.indexOf('ON CONFLICT'))
  assert.match(insert, /partial_day/, 'the inserted column list must set partial_day')
  assert.match(insert, /false, 'Manual edit', now\(\)/, 'a newly created day must not be born partial')
  const update = history.slice(history.indexOf('ON CONFLICT'), history.indexOf('RETURNING'))
  assert.match(update, /partial_day = false/, 'correcting an existing day must clear the partial flag')
})

test('edits stay partial-scoped: untouched figures are preserved', () => {
  // Clearing partial_day must not turn the edit into a whole-row overwrite.
  for (const column of ['total_expenditure_kcal', 'resting_energy_kcal', 'active_energy_kcal', 'calories_consumed_override']) {
    assert.match(history, new RegExp(`${column}\\s*= CASE WHEN`), `${column} lost its keep-if-absent guard`)
  }
})

test('an intake override never touches the underlying food entries', () => {
  assert.doesNotMatch(history, /DELETE FROM food_entries|UPDATE food_entries|INSERT INTO food_entries/)
  assert.match(dashboard, /number\(health\?\.calories_consumed_override\) \?\? \(totals\.calories \|\| null\)/)
})

test('saveDailyHistory reports the flag it just cleared', () => {
  assert.match(history, /RETURNING date, total_expenditure_kcal, resting_energy_kcal, active_energy_kcal, calories_consumed_override, partial_day/)
  assert.match(history, /partialDay: Boolean\(row\.partial_day\)/)
})
