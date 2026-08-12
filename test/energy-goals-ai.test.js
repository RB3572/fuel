import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateCalorieTarget } from '../api/_lib/energy-reference.js'
import { cleanReplyText, parseStructuredChatResponse, responseText } from '../api/_lib/meal-plan.js'

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

test('Gemini and MCP can access health, context, and goals', () => {
  const mealPlan = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
  const mcp = readFileSync(new URL('../api/mcp.js', import.meta.url), 'utf8')
  assert.match(mealPlan, /JSON\.stringify\(summary/)
  assert.match(mealPlan, /buildHealthSummary\(state\.dashboard\)/)
  const dashboardSource = readFileSync(new URL('../api/_lib/neon-dashboard.js', import.meta.url), 'utf8')
  for (const token of ['runningStrideLength','cardioRecovery','bloodOxygen','walkingHeartRateAverage']) assert.match(dashboardSource, new RegExp(token))
  for (const token of ['contextUpdate','goalUpdates']) assert.match(mealPlan, new RegExp(token))
  // Context is append-only for the model: add_user_context replaced update_user_context.
  for (const token of ['running_stride_length_m','cardio_recovery_bpm','raw_payload','get_user_context','add_user_context','get_goals','set_goals','calorie_balance_percent']) assert.match(mcp, new RegExp(token))
})

test('a meal plan is only ever (re)built by the explicit "New plan" action, and only the newest plan is kept in the thread', () => {
  const mealPlan = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../public/meal-plan.js', import.meta.url), 'utf8')
  // No automatic regeneration triggers remain in the chat handler.
  for (const token of ['regeneratePlan','wantsNewPlan','plan_stale','updatedPlan','planUpdated']) assert.doesNotMatch(mealPlan, new RegExp(token))
  assert.doesNotMatch(client, /plan_stale/)
  // The client never auto-generates on load; only the New plan button forces generation.
  assert.doesNotMatch(client, /await generatePlan\(\)/)
  assert.match(client, /generatePlan\(true\)/)
  // Regenerating drops any earlier plan-kind messages before appending the new one.
  assert.match(mealPlan, /filter\(\(item\) => item\.kind !== 'plan'\)/)
})

test('a chat message finishes processing on the server and reappears even if the tab is closed mid-flight', () => {
  const mealPlan = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../public/meal-plan.js', import.meta.url), 'utf8')
  // The reply is saved to the conversation before the handler ever tries to respond, so
  // a request that fails to deliver its response has still done the real work.
  const saveIndex = mealPlan.indexOf('const saved = await saveCachedPlan(userId, {\n        foodFingerprint: cache?.food_fingerprint')
  const sendIndex = mealPlan.indexOf("sendJson(res, 200, {\n        ...responseBase(nextState, saved),")
  assert.ok(saveIndex >= 0 && sendIndex > saveIndex, 'the chat reply must be persisted before the response is sent')
  // The client gives the server enough time to actually finish (just under its own 60s
  // ceiling) rather than aborting a request that would otherwise have succeeded.
  assert.match(client, /CHAT_REQUEST_TIMEOUT_MS=58000/)
  // A text-only message keeps sending even if the tab closes or navigates away.
  assert.match(client, /keepalive:true/)
  // Returning to the tab — foreground, back-forward cache restore, or regained network
  // — re-fetches the conversation so a reply that finished while away shows up.
  assert.match(client, /refreshConversation/)
  assert.match(client, /addEventListener\('visibilitychange'/)
  assert.match(client, /addEventListener\('pageshow'/)
  assert.match(client, /addEventListener\('online'/)
})

test('a thinking model\'s reasoning is excluded before the chat/plan JSON is parsed', () => {
  // This was the actual cause of "Fuel AI could not produce a complete response" (the
  // user's "invalid response") on an otherwise-fine answer: reasoning parts flagged
  // thought:true, concatenated in front of the real JSON, produce a string that cannot
  // be parsed. Already fixed once for quick-log's parseJsonResponse; answerChat and
  // parsePlanPayload had the same bare `parts.map` bug until now.
  const payload = {
    candidates: [{
      content: {
        parts: [
          { text: 'Reasoning about the request before answering...', thought: true },
          { text: '{"reply":"Here is your answer.","foods":[]}' },
        ],
      },
    }],
  }
  const raw = responseText(payload)
  assert.doesNotMatch(raw, /Reasoning about/)
  const parsed = parseStructuredChatResponse(raw)
  assert.equal(parsed.valid, true)
  assert.equal(parsed.reply, 'Here is your answer.')
})

test('answerChat and parsePlanPayload read the model answer through responseText, not a raw parts.map', () => {
  const mealPlan = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
  assert.doesNotMatch(mealPlan, /candidate\?\.content\?\.parts\?\.map\(\(part\) => part\?\.text \|\| ''\)\.join\(''\)\.trim\(\)/)
  const matches = mealPlan.match(/= responseText\(payload\)/g) || []
  assert.ok(matches.length >= 3, 'parsePlanPayload and both answerChat reads (initial + retry) must use responseText')
})

test('a genuinely incomplete response names why, instead of a bare "could not produce" message', () => {
  const mealPlan = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
  assert.match(mealPlan, /function incompleteReasonLabel\(candidate, raw\)/)
  assert.match(mealPlan, /the answer ran out of room before it finished/)
  assert.match(mealPlan, /the response was blocked by a safety filter/)
  assert.match(mealPlan, /no response text came back/)
  assert.match(mealPlan, /Fuel AI could not produce a complete response \(\$\{incompleteReasonLabel\(candidate, raw\)\}\)/)
  assert.match(mealPlan, /Fuel AI could not produce a complete meal plan \(\$\{incompleteReasonLabel\(parsed\.candidate, raw\)\}\)/)
})

test('the meal plan collapses in the chat thread', () => {
  const client = readFileSync(new URL('../public/meal-plan.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../public/meal-plan.css', import.meta.url), 'utf8')
  assert.match(client, /const details=document\.createElement\('details'\)/)
  assert.match(client, /details\.className='plan-details'/)
  assert.match(client, /details\.open=true/)
  assert.match(css, /\.plan-details \{/)
  assert.match(css, /\.plan-details\[open\] \.plan-chevron \{ transform: rotate\(180deg\); \}/)
})
