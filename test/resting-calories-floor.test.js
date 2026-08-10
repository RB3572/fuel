import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const goals = read('../api/_lib/goals.js')
const reference = read('../api/_lib/energy-reference.js')
const dashboard = read('../api/_lib/neon-dashboard.js')
const app = read('../src/App.tsx')

// A user-set minimum resting calories: once a day is no longer in progress, a resting
// figure under this floor is bumped up to it (and the same delta carried into total
// expenditure, since total is derived as active + resting) so a day HealthKit
// under-reported does not understate that day's burn or inflate its apparent deficit.

test('the floor is a real optional column, off by default', () => {
  assert.match(goals, /ALTER TABLE user_goals ADD COLUMN IF NOT EXISTS resting_calories_floor double precision/)
  assert.match(goals, /restingCaloriesFloor: 0/, 'DEFAULTS must have an off default, unlike every other goal')
  assert.match(goals, /restingCaloriesFloor: \[0, 3000\]/)
})

test('saving 0 clears the floor instead of storing a literal 0-calorie floor', () => {
  assert.match(goals, /const restingCaloriesFloor = goals\.restingCaloriesFloor > 0 \? goals\.restingCaloriesFloor : null/)
  assert.match(goals, /resting_calories_floor = EXCLUDED\.resting_calories_floor/)
})

test('the auto-set flow ensures the table exists before energy-reference reads it', () => {
  // automaticallySetGoals calls getEnergyReference (which now queries user_goals)
  // before its own later saveUserGoals call would otherwise create the table.
  const start = goals.indexOf('export async function automaticallySetGoals')
  const body = goals.slice(start, goals.indexOf('export async function', start + 1))
  const ensureIndex = body.indexOf('await ensureGoalsTable()')
  const referenceIndex = body.indexOf('await getEnergyReference(userId)')
  assert.ok(ensureIndex >= 0 && referenceIndex > ensureIndex, 'ensureGoalsTable must run before getEnergyReference in automaticallySetGoals')
})

test('the historical average applies the floor without dropping users who have no goals row yet', () => {
  // A scalar subquery, not a join to user_goals: a join would zero out every row for a
  // user who has never saved goals (no user_goals row exists at all).
  assert.doesNotMatch(reference, /CROSS JOIN/)
  assert.match(reference, /COALESCE\(\(SELECT resting_calories_floor FROM user_goals WHERE user_id = \$\{userId\}\), 0\)/)
  assert.match(reference, /GREATEST\(0, COALESCE\(\(SELECT resting_calories_floor FROM user_goals WHERE user_id = \$\{userId\}\), 0\) - COALESCE\(h\.resting_energy_kcal, 0\)\)/)
})

test('bumping resting also bumps total expenditure by the same delta, not just cosmetically', () => {
  const matches = reference.match(/GREATEST\(0, COALESCE\(\(SELECT resting_calories_floor FROM user_goals WHERE user_id = \$\{userId\}\), 0\) - COALESCE\(h\.resting_energy_kcal, 0\)\)/g) || []
  assert.equal(matches.length, 2, 'the same delta expression must be added to both resting_energy_kcal and total_expenditure_kcal')
})

test('the average deficit/surplus honors a manually edited day, matching trends and today', () => {
  // This was the actual bug: trends[] and today.summary already preferred
  // calories_consumed_override (see daily-history.test.js), but the *average* balance
  // that feeds energyAverages.energyBalance was computed from the raw food-entries sum
  // and never moved after an edit.
  assert.match(reference, /COALESCE\(b\.calories_consumed_override, f\.calories_consumed\)/)
  assert.match(reference, /h\.calories_consumed_override/)
})

test('trends and today.summary both apply the floor, gated on the day being complete', () => {
  assert.match(dashboard, /function applyRestingFloor\(resting, total, floor, partialDay\)/)
  assert.match(dashboard, /if \(partialDay \|\| floor == null \|\| resting == null \|\| resting >= floor\) return \{ resting, total \}/)
  // Both call sites pass the day's own partialDay, so a day still in progress is never
  // bumped — only a day that is over gets its history corrected.
  const trendsCall = dashboard.match(/applyRestingFloor\(\s*number\(health\?\.resting_energy_kcal\), number\(health\?\.total_expenditure_kcal\), userGoals\.restingCaloriesFloor, partialDay,\s*\)/)
  const todayCall = dashboard.match(/applyRestingFloor\(\s*number\(todayHealth\?\.resting_energy_kcal\), number\(todayHealth\?\.total_expenditure_kcal\), userGoals\.restingCaloriesFloor, todayPartialDay,\s*\)/)
  assert.ok(trendsCall, 'trends must apply the floor using that day\'s own partialDay')
  assert.ok(todayCall, 'today.summary must apply the floor using today\'s own partialDay')
})

test('the setting is exposed to the client and editable in the Goals modal', () => {
  assert.match(dashboard, /restingCaloriesFloor: range\(userGoals\.restingCaloriesFloor\)/)
  assert.match(app, /restingCaloriesFloor:goalTarget\(initial\?\.goals,'restingCaloriesFloor',0\)/)
  assert.match(app, /restingCaloriesFloor:Number\(e\.target\.value\)/)
})
