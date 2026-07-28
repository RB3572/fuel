import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Drives the real callGemini against a stubbed Gemini endpoint using the exact error
// bodies Google returns. The bug this guards: the rolling `gemini-flash-latest` alias
// points at Google's newest Flash model, and free-tier keys are allocated a quota of
// ZERO on it — so every call 429s on the first request of the day and reads exactly
// like an exhausted account.

process.env.APP_URL ||= 'https://fuel.rishib.com'
process.env.GEMINI_API_KEY ||= 'test-key-not-real'
process.env.DATABASE_URL ||= 'postgres://unused/unused'
process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
process.env.SESSION_SECRET ||= 'test-secret'
delete process.env.GEMINI_MODEL

const { callGemini, DEFAULT_MODEL, GEMINI_MODEL_FALLBACKS } = await import('../api/_lib/meal-plan.js')
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

test('the default model is a pinned free-tier model, not a rolling alias', () => {
  assert.equal(DEFAULT_MODEL, 'gemini-2.5-flash')
  assert.ok(!GEMINI_MODEL_FALLBACKS.some((model) => model.includes('latest')), 'a -latest alias is back in the fallback list')
  assert.ok(GEMINI_MODEL_FALLBACKS.length >= 2, 'there must be something to fall back to')
})

test('a healthy model is called once, with no fallback', async (t) => {
  t.after(restore)
  stub(() => ({ status: 200, body: OK }))
  assert.deepEqual(await invoke(), OK)
  assert.deepEqual(calls, ['gemini-2.5-flash'])
})

test('a zero-quota model falls through to the next and is never retried', async (t) => {
  t.after(restore)
  stub((model) => (model === 'gemini-2.5-flash' ? { status: 429, body: ZERO_QUOTA } : { status: 200, body: OK }))
  assert.deepEqual(await invoke(), OK)
  assert.deepEqual(calls, ['gemini-2.5-flash', 'gemini-2.0-flash'])
  assert.equal(calls.filter((model) => model === 'gemini-2.5-flash').length, 1, 'waiting cannot fix a zero allocation')
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
  assert.deepEqual(calls, ['gemini-2.5-flash', 'gemini-2.5-flash'])
  assert.ok(Date.now() - started >= 950, 'the retryDelay Google asked for was not honoured')
})

test('a long retry delay moves to the next model instead of holding the request open', async (t) => {
  t.after(restore)
  stub((model) => (model === 'gemini-2.5-flash' ? { status: 429, body: rateLimited('47s') } : { status: 200, body: OK }))
  const started = Date.now()
  assert.deepEqual(await invoke(), OK)
  assert.ok(Date.now() - started < 2000, 'it waited on a 47s delay')
  assert.deepEqual(calls, ['gemini-2.5-flash', 'gemini-2.0-flash'])
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
  stub((model) => (model === 'gemini-2.5-flash'
    ? { status: 404, body: { error: { message: 'models/gemini-2.5-flash is not found for API version v1beta' } } }
    : { status: 200, body: OK }))
  assert.deepEqual(await invoke(), OK)
  assert.deepEqual(calls, ['gemini-2.5-flash', 'gemini-2.0-flash'])

  stub((model) => (model === 'gemini-2.5-flash'
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
