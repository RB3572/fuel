import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateCalorieTarget } from '../api/_lib/energy-reference.js'
import { cleanReplyText, parseStructuredChatResponse } from '../api/_lib/meal-plan.js'

test('calorie targets are calculated from average burn and percentage balance', () => {
  assert.equal(calculateCalorieTarget(2200, 0), 2200)
  assert.equal(calculateCalorieTarget(2200, -10), 1980)
  assert.equal(calculateCalorieTarget(2200, 10), 2420)
})

test('Fuel AI never exposes a raw JSON reply wrapper', () => {
  assert.equal(parseStructuredChatResponse('{"reply":"Complete answer","foods":[]}').reply, 'Complete answer')
  assert.equal(cleanReplyText('{"reply":"Clean answer"}'), 'Clean answer')
  const partial = parseStructuredChatResponse('{"reply":"A complete-looking partial answer without a closing quote')
  assert.match(partial.reply, /partial answer/)
  assert.doesNotMatch(cleanReplyText(partial.reply), /^[{[]/)
})

test('dashboard charts and goals use the requested energy model', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const dashboard = readFileSync(new URL('../api/_lib/neon-dashboard.js', import.meta.url), 'utf8')
  for (const token of ['All-time average','bar consumed','bar resting','bar active-energy','bar burned','calorieBalancePercent']) assert.match(app, new RegExp(token))
  assert.match(dashboard, /energyAverages/)
  assert.match(dashboard, /calorieBalancePercent/)
})

test('Gemini and MCP can access health, context, goals, and automatic replanning', () => {
  const mealPlan = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../public/meal-plan.js', import.meta.url), 'utf8')
  const mcp = readFileSync(new URL('../api/mcp.js', import.meta.url), 'utf8')
  assert.match(mealPlan, /JSON\.stringify\(summary/)
  assert.match(mealPlan, /buildHealthSummary\(state\.dashboard\)/)
  const dashboardSource = readFileSync(new URL('../api/_lib/neon-dashboard.js', import.meta.url), 'utf8')
  for (const token of ['runningStrideLength','cardioRecovery','bloodOxygen','walkingHeartRateAverage']) assert.match(dashboardSource, new RegExp(token))
  for (const token of ['contextUpdate','goalUpdates','updatedPlan']) assert.match(mealPlan, new RegExp(token))
  assert.match(client, /payload\.updatedPlan/)
  for (const token of ['running_stride_length_m','cardio_recovery_bpm','raw_payload','get_user_context','update_user_context','get_goals','set_goals','calorie_balance_percent']) assert.match(mcp, new RegExp(token))
})
