import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const mlog = read('../api/mlog.js')
const app = read('../src/App.tsx')
const plan = read('../api/_lib/meal-plan.js')

// "Fill missing nutrients" span silently for days: every entry was crashing on a
// ReferenceError (an import dropped during an unrelated refactor), the route collected
// the crashes into `failed`, and the client only ever read `updated` — so a total
// server-side failure rendered as "Nothing left to fill in."

test('every nutrient helper the route calls is actually imported', () => {
  // no-undef in .oxlintrc.json is the real guard; this pins the specific regression.
  const imported = mlog.match(/import \{([^}]*)\} from '\.\/_lib\/nutrients\.js'/)?.[1] || ''
  for (const helper of ['normalizeNutrients', 'nutrientColumns']) {
    assert.ok(new RegExp(`\\b${helper}\\b`).test(mlog), `${helper} should still be used`)
    assert.match(imported, new RegExp(`\\b${helper}\\b`), `${helper} is used but not imported`)
  }
})

test('the linter is configured to catch an undefined identifier', () => {
  const config = JSON.parse(read('../.oxlintrc.json'))
  assert.equal(config.rules['no-undef'], 'error')
  // Without declared environments every Node and browser global trips the rule, so it
  // would have to be turned back off.
  assert.ok(config.env?.node && config.env?.browser, 'no-undef needs env globals declared')
})

test('entries the server could not estimate are shown to the user', () => {
  assert.match(app, /const failures=\(p\.failed\|\|\[\]\)/)
  assert.match(app, /failedCount\+=failures\.length/)
  // Something must be rendered whether or not anything succeeded.
  assert.match(app, /could not be estimated/)
  assert.match(app, /else if\(failedCount\)setError/)
})

test('a whole-batch failure is never reported as "nothing to do"', () => {
  // 'Nothing left to fill in.' must be the last branch, reachable only when there were
  // no successes AND no failures.
  const nothing = app.indexOf("setFillNote('Nothing left to fill in.')")
  const failBranch = app.indexOf('else if(failedCount)setError')
  assert.ok(failBranch > 0 && failBranch < nothing, 'the failure branch must be checked before the empty branch')
})

test('thinkingConfig is stripped for models that do not support it', () => {
  // Otherwise the fallback chain is pointless: the moment gemini-2.5-flash is
  // unavailable, every request 400s on gemini-2.0-flash for an unknown field.
  assert.match(plan, /const NO_THINKING_CONFIG = \/gemini-\(1\\\.\|2\\\.0\)\//)
  assert.match(plan, /function bodyForModel\(model, requestBody\)/)
  assert.match(plan, /requestBody = bodyForModel\(model, requestBody\)/)
})
