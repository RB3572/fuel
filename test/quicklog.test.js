import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const quickLog = read('../api/_lib/quick-log.js')
const page = read('../public/quicklog.js')
const html = read('../public/quicklog.html')
const app = read('../src/App.tsx')
const mlog = read('../api/mlog.js')

test('/quicklog is routed to the camera page', () => {
  const config = JSON.parse(read('../vercel.json'))
  assert.ok(config.rewrites.some((r) => r.source === '/quicklog' && r.destination === '/quicklog.html'))
})

test('the camera opens rear-facing and can be flipped', () => {
  // A plate on a table is what this page is pointed at.
  assert.match(page, /let facingMode = 'environment'/)
  assert.match(page, /facingMode: \{ ideal: facingMode \}/, 'ideal, not exact: a front-only laptop must still work')
  assert.match(page, /facingMode = facingMode === 'user' \? 'environment' : 'user'/)
  assert.match(html, /id="ql-flip"/)
})

test('the captured frame is un-mirrored before it is sent', () => {
  // The preview is mirrored so it reads as a mirror to the person holding the phone;
  // the model must still see the scene the right way round (packaging text especially).
  assert.match(read('../public/quicklog.css'), /\.ql\.is-front \.ql-video\{transform:scaleX\(-1\)\}/)
  assert.match(page, /if \(facingMode === 'user'\) \{[\s\S]*?context\.scale\(-1, 1\)/)
  // The mirror class must follow the camera rather than being set unconditionally.
  assert.match(page, /classList\.toggle\('is-front', facingMode === 'user'\)/)
  assert.doesNotMatch(page, /classList\.add\('is-front'\)/)
})

test('one tap logs and leaves — no preview or confirm step', () => {
  assert.match(page, /shutter\.addEventListener\('click', \(\) => void takeAndLog\(\)\)/)
  assert.match(page, /fuel_route=quicklog/)
  assert.match(page, /window\.location\.href = `\/#logged=/)
  // Nothing that asks the user a question.
  assert.doesNotMatch(page, /confirm\(|prompt\(/)
})

test('the camera is released when the page is left or hidden', () => {
  assert.match(page, /for \(const track of stream\.getTracks\(\)\) track\.stop\(\)/)
  assert.match(page, /visibilitychange/)
  assert.match(page, /pagehide/)
  // And before the upload, so the light is off while the request is in flight.
  assert.match(page, /stopCamera\(\)\n\n  try \{/)
})

test('a photo with no food is not logged as an empty entry', () => {
  assert.match(quickLog, /if \(!foods\.length\) return \{ ok: true, logged: \[\], note:/)
  assert.match(page, /if \(!logged\.length\) \{/)
})

test('uploads are bounded and type-checked before they reach Gemini', () => {
  assert.match(quickLog, /ALLOWED_IMAGE_TYPES = new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/)
  assert.match(quickLog, /data\.length \* 0\.75 > MAX_IMAGE_BYTES/)
  assert.match(quickLog, /MAX_FOODS = 8/)
  assert.match(page, /1600 \/ Math\.max\(width, height\)/, 'the capture is downscaled before upload')
})

test('quick-logged entries are marked as already AI-estimated', () => {
  // They arrive complete, so the "fill missing nutrients" queue must not pick them up.
  assert.match(quickLog, /ai_filled_at, updated_at/)
  assert.match(quickLog, /'Fuel quick log', now\(\), now\(\)/)
})

test('the route is POST-only and scoped to the signed-in user', () => {
  assert.match(mlog, /async function handleQuickLog\(req, res\) \{\s*if \(req\.method !== 'POST'\)/)
  assert.match(mlog, /logPhoto\(auth\.id, body\.image/)
  assert.match(quickLog, /INSERT INTO food_entries[\s\S]*?\$\{userId\}/)
})

test('the dashboard scrolls to the entry it was sent to, and says which one', () => {
  assert.match(app, /window\.location\.hash\.match\(\/\^#logged=\(\.\*\)\$\/\)/)
  assert.match(app, /\.food-entry\.just-logged'\)\|\|document\.getElementById\('food-consumed'\)/)
  assert.match(app, /scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/)
  // Smooth scrolling is a no-op on some engines and under reduced motion; arriving
  // parked at the top would defeat the redirect entirely.
  assert.match(app, /if\(Math\.abs\(window\.scrollY-before\)<8\)target\.scrollIntoView\(\{block:'center'\}\)/)
  assert.match(app, /just-logged-badge/)
  // The hash is consumed so a refresh does not re-trigger the highlight.
  assert.match(app, /window\.history\.replaceState\(\{\},'',window\.location\.pathname\+window\.location\.search\)/)
})

test('the fill diagnostic reports config, queue and a live probe', () => {
  assert.match(mlog, /url\.searchParams\.get\('diagnose'\)/)
  assert.match(mlog, /geminiKeyConfigured: Boolean\(process\.env\.GEMINI_API_KEY/)
  assert.match(mlog, /modelRequested:/)
  assert.match(mlog, /async function probeGemini\(\)/)
  assert.match(mlog, /providerReason: error\?\.providerReason/)
  // The key itself must never be echoed back.
  const report = mlog.slice(mlog.indexOf("url.searchParams.get('diagnose')"), mlog.indexOf('sendJson(res, 200, report'))
  assert.doesNotMatch(report, /process\.env\.GEMINI_API_KEY\b(?!\s*\|\|\s*process\.env\.GOOGLE_API_KEY\))/)
  assert.doesNotMatch(report, /apiKey/)
})
