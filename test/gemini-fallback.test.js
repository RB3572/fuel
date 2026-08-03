import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Drives the real callGemini against a stubbed Gemini endpoint using the exact error
// bodies Google returns. Two bugs this guards, both of which took every AI feature down
// at once: the rolling `gemini-flash-latest` alias, where free-tier keys are allocated
// a quota of ZERO so every call 429s on the first request of the day; and a fallback
// chain built entirely out of 2.x models, which Google then shut down or closed to new
// keys.

process.env.APP_URL ||= 'https://fuel.rishib.com'
process.env.GEMINI_API_KEY ||= 'test-key-not-real'
process.env.DATABASE_URL ||= 'postgres://unused/unused'
process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
process.env.SESSION_SECRET ||= 'test-secret'
delete process.env.GEMINI_MODEL

const { callGemini, DEFAULT_MODEL, GEMINI_MODEL_FALLBACKS, responseText, parseJsonResponse } = await import('../api/_lib/meal-plan.js')
const { asNutritionQuotaError } = await import('../api/_lib/recipe-nutrition.js')

const OK = { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }
const ZERO_QUOTA = {
  error: {
    code: 429, status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota, please check your plan and billing details.',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaValue: '0' }],
    }],
  },
}
const rateLimited = (retryDelay) => ({
  error: {
    code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for quota metric requests per minute.',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaValue: '10' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay },
    ],
  },
})

let calls = []
const realFetch = globalThis.fetch
const silence = { warn: console.warn, error: console.error }
function stub(handler) {
  calls = []
  console.warn = () => {}
  console.error = () => {}
  globalThis.fetch = async (url) => {
    const model = decodeURIComponent(String(url).split('/models/')[1].split(':')[0])
    calls.push(model)
    const { status, body } = handler(model, calls.length)
    return { ok: status === 200, status, json: async () => body }
  }
}
function restore() {
  globalThis.fetch = realFetch
  console.warn = silence.warn
  console.error = silence.error
}
const invoke = () => callGemini(DEFAULT_MODEL, { contents: [] }, false, 5000)
const thrown = async () => invoke().then(() => null, (error) => error)

test('the default model is current, pinned, and not a rolling alias', () => {
  assert.equal(DEFAULT_MODEL, 'gemini-3.1-flash-lite')
  assert.ok(!GEMINI_MODEL_FALLBACKS.some((model) => model.includes('latest')), 'a -latest alias is back in the fallback list')
  // gemini-2.0-flash and -flash-lite are shut down; a chain containing them is dead.
  assert.ok(!GEMINI_MODEL_FALLBACKS.some((model) => model.includes('2.0')), 'the 2.0 models are shut down')
  assert.ok(GEMINI_MODEL_FALLBACKS.filter((model) => model.startsWith('gemini-3')).length >= 2, 'the chain must be 3.x-first')
  assert.ok(GEMINI_MODEL_FALLBACKS.length >= 3, 'there must be something to fall back to')
})

test('a healthy model is called once, with no fallback', async (t) => {
  t.after(restore)
  stub(() => ({ status: 200, body: OK }))
  assert.deepEqual(await invoke(), OK)
  assert.deepEqual(calls, [GEMINI_MODEL_FALLBACKS[0]])
})

test('a zero-quota model falls through to the next and is never retried', async (t) => {
  t.after(restore)
  stub((model) => (model === GEMINI_MODEL_FALLBACKS[0] ? { status: 429, body: ZERO_QUOTA } : { status: 200, body: OK }))
  assert.deepEqual(await invoke(), OK)
  assert.deepEqual(calls, [GEMINI_MODEL_FALLBACKS[0], GEMINI_MODEL_FALLBACKS[1]])
  assert.equal(calls.filter((model) => model === GEMINI_MODEL_FALLBACKS[0]).length, 1, 'waiting cannot fix a zero allocation')
})

test('every model at zero quota blames the key, never billing', async (t) => {
  t.after(restore)
  stub(() => ({ status: 429, body: ZERO_QUOTA }))
  const error = await thrown()
  assert.equal(error.code, 'gemini_no_quota')
  assert.match(error.message, /fresh key in Google AI Studio/)
  assert.doesNotMatch(error.message, /billing/i)
  assert.deepEqual(calls, GEMINI_MODEL_FALLBACKS, 'every candidate should have been tried')
})

test('a short per-minute rate limit is waited out and retried on the same model', async (t) => {
  t.after(restore)
  stub((model, n) => (n === 1 ? { status: 429, body: rateLimited('1s') } : { status: 200, body: OK }))
  const started = Date.now()
  assert.deepEqual(await invoke(), OK)
  assert.deepEqual(calls, [GEMINI_MODEL_FALLBACKS[0], GEMINI_MODEL_FALLBACKS[0]])
  assert.ok(Date.now() - started >= 950, 'the retryDelay Google asked for was not honoured')
})

test('a long retry delay moves to the next model instead of holding the request open', async (t) => {
  t.after(restore)
  stub((model) => (model === GEMINI_MODEL_FALLBACKS[0] ? { status: 429, body: rateLimited('47s') } : { status: 200, body: OK }))
  const started = Date.now()
  assert.deepEqual(await invoke(), OK)
  assert.ok(Date.now() - started < 2000, 'it waited on a 47s delay')
  assert.deepEqual(calls, [GEMINI_MODEL_FALLBACKS[0], GEMINI_MODEL_FALLBACKS[1]])
})

test('sustained rate limiting says wait, not out of quota', async (t) => {
  t.after(restore)
  stub(() => ({ status: 429, body: rateLimited('47s') }))
  const error = await thrown()
  assert.equal(error.code, 'gemini_rate_limited')
  assert.match(error.message, /Wait a minute/i)
})

test('404 and 503 fall through; invalid keys and schema bugs do not', async (t) => {
  t.after(restore)
  stub((model) => (model === GEMINI_MODEL_FALLBACKS[0]
    ? { status: 404, body: { error: { message: 'models/gemini-2.5-flash is not found for API version v1beta' } } }
    : { status: 200, body: OK }))
  assert.deepEqual(await invoke(), OK)
  assert.deepEqual(calls, [GEMINI_MODEL_FALLBACKS[0], GEMINI_MODEL_FALLBACKS[1]])

  stub((model) => (model === GEMINI_MODEL_FALLBACKS[0]
    ? { status: 503, body: { error: { message: 'The model is overloaded.' } } }
    : { status: 200, body: OK }))
  assert.deepEqual(await invoke(), OK)

  // A bad key and a malformed request fail identically on every model — trying them all
  // just multiplies the latency.
  stub(() => ({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }))
  assert.match((await thrown()).message, /Gemini API key is not valid/)
  assert.equal(calls.length, 1)

  stub(() => ({ status: 400, body: { error: { message: 'Invalid JSON payload received. Unknown name "additionalProperties"' } } }))
  assert.equal((await thrown()).code, 'gemini_schema_rejected')
  assert.equal(calls.length, 1)
})

test('the nutrition layer separates a rate limit from a key with no allocation', async (t) => {
  t.after(restore)
  stub(() => ({ status: 429, body: rateLimited('47s') }))
  const limited = asNutritionQuotaError(await thrown())
  assert.equal(limited.quotaExhausted, true)
  assert.equal(limited.retryable, true, 'a per-minute limit is worth retrying')

  stub(() => ({ status: 429, body: ZERO_QUOTA }))
  const dead = asNutritionQuotaError(await thrown())
  assert.equal(dead.retryable, false, 'a zero allocation is not fixed by retrying')
  assert.match(dead.message, /fresh key/)

  // An ordinary estimate failure must not be mistaken for a quota problem, or one bad
  // entry would abandon the whole batch.
  assert.equal(asNutritionQuotaError(new Error('Fuel AI returned an unreadable nutrition estimate.')), null)
})

test('the fill-nutrients route distinguishes retryable from terminal', () => {
  const mlog = readFileSync(new URL('../api/mlog.js', import.meta.url), 'utf8')
  assert.match(mlog, /quotaRetryable = Boolean\(error\.retryable\)/)
  assert.match(mlog, /sendJson\(res, quotaRetryable \? 429 : 503/)
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /hit the free Gemini rate limit/)
  // Partial progress must survive a mid-batch rate limit.
  assert.match(app, /r\.status===429&&filled/)
})

// A thinking model returns its reasoning as extra parts in the same array. Joining
// those in front of the answer produces a string that cannot be parsed — which is what
// "Fuel AI returned an unreadable answer" was, on every AI feature at once.
const withParts = (parts) => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] })

test('reasoning parts are excluded from the answer', () => {
  const payload = withParts([
    { thought: true, text: 'Let me work out the macros for this bowl...' },
    { text: '{"foods":[{"description":"Burrito bowl"}]}' },
  ])
  // The naive join is exactly what used to happen, and it does not parse.
  assert.throws(() => JSON.parse(payload.candidates[0].content.parts.map((p) => p.text).join('')))
  assert.equal(parseJsonResponse(payload).value.foods[0].description, 'Burrito bowl')
})

test('an answer wrapped in prose or a code fence is still recovered', () => {
  assert.deepEqual(parseJsonResponse(withParts([{ text: '```json\n{"a":1}\n```' }])).value, { a: 1 })
  assert.deepEqual(parseJsonResponse(withParts([{ text: 'Here you go:\n{"a":1}' }])).value, { a: 1 })
  // Multi-part answers must still be joined.
  assert.deepEqual(parseJsonResponse(withParts([{ text: '{"a":' }, { text: '1}' }])).value, { a: 1 })
})

test('unparseable output returns the text so the error can quote it', () => {
  const result = parseJsonResponse(withParts([{ text: 'I cannot help with that.' }]))
  assert.equal(result.value, null)
  assert.match(result.text, /cannot help/)
})

test('a blocked or thought-only response yields empty text rather than crashing', () => {
  assert.equal(responseText({ candidates: [{ finishReason: 'MAX_TOKENS', content: { role: 'model' } }] }), '')
  assert.equal(responseText({}), '')
  assert.equal(parseJsonResponse(withParts([{ thought: true, text: 'thinking' }])).text, '')
})

test('every Gemini caller parses through the shared helper', () => {
  for (const path of ['../api/_lib/quick-log.js', '../api/_lib/food-nutrition.js', '../api/_lib/recipe-nutrition.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /parseJsonResponse\(payload\)/, `${path} must not hand-roll the parse`)
    assert.doesNotMatch(source, /parts\?\.map\(\(part\) => part\.text\)/, `${path} still joins raw parts`)
  }
})
