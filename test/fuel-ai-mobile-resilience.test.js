import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planLooksComplete } from '../api/_lib/meal-plan.js'

test('accepts complete plans and rejects truncated plan fragments', () => {
  const complete = `MEAL PLAN FOR THE REST OF TODAY

TARGET
Stay close to the remaining calorie and protein targets.

PLAN
Dinner: a complete vegetarian meal with estimated nutrition.

ESTIMATED PLAN TOTAL
About 700 kcal.

WHY THIS FITS
This plan is balanced, practical, and ends with a complete sentence.`
  assert.equal(planLooksComplete(complete), true)
  assert.equal(planLooksComplete(`${complete.slice(0, -35)}Carbs: 102 (B`), false)
})

test('Gemini schemas avoid unsupported nested additionalProperties and retry incomplete plans', () => {
  const source = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /nutrients:\s*\{[^\n]+additionalProperties/)
  assert.match(source, /PLAN_RESPONSE_SCHEMA/)
  assert.match(source, /finishReason === 'MAX_TOKENS'/)
  assert.match(source, /gemini_incomplete_plan/)
  assert.match(source, /gemini_schema_rejected/)
})

test('mobile composer prevents iOS focus zoom and follows the visual viewport', () => {
  const html = readFileSync(new URL('../public/meal-plan.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../public/meal-plan.css', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../public/meal-plan.js', import.meta.url), 'utf8')
  assert.match(html, /maximum-scale=1/)
  assert.match(html, /user-scalable=no/)
  assert.match(css, /font-size:\s*16px !important/)
  assert.match(css, /--app-height/)
  assert.match(client, /visualViewport/)
  assert.match(client, /focusComposerOnDesktop/)
  assert.doesNotMatch(client, /setComposerBusy\(false\)\n\s*els\.input\.focus\(\)/)
})

test('plan bubbles render headings and bullets as structured content', () => {
  const client = readFileSync(new URL('../public/meal-plan.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../public/meal-plan.css', import.meta.url), 'utf8')
  assert.match(client, /renderAssistantContent/)
  assert.match(client, /bubble-list-item/)
  assert.match(client, /ESTIMATED PLAN TOTAL/)
  assert.match(css, /bubble-content\.is-structured/)
})
