import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { describeCoordinate } = await import('../api/_lib/place-names.js')
const places = readFileSync(new URL('../api/_lib/places.js', import.meta.url), 'utf8')

const realFetch = globalThis.fetch
let lastUrl = null
let lastInit = null
function stub(payload, { status = 200 } = {}) {
  globalThis.fetch = async (url, init) => {
    lastUrl = String(url); lastInit = init
    return { ok: status === 200, status, json: async () => payload }
  }
}
const restore = () => { globalThis.fetch = realFetch }

// Real Nominatim reverse payloads put a POI's own name in `name` and everything else in
// `address`. These are the shapes that decide whether a place reads as "Cava" or
// "Place 3".
test('a named POI uses its own name', async (t) => {
  t.after(restore)
  stub({ name: 'Cava', address: { shop: 'Cava', road: 'East Colorado Boulevard', city: 'Pasadena', suburb: 'Playhouse Village' } })
  const result = await describeCoordinate(34.1455, -118.1305)
  assert.equal(result.name, 'Cava')
  assert.equal(result.detail, 'Playhouse Village, Pasadena')
})

test('a campus building falls back through the address when unnamed', async (t) => {
  t.after(restore)
  stub({ address: { building: 'Beckman Institute', university: 'California Institute of Technology', city: 'Pasadena' } })
  assert.equal((await describeCoordinate(34.1377, -118.1253)).name, 'Beckman Institute')
})

test('a mall is preferred over the road it sits on', async (t) => {
  t.after(restore)
  stub({ address: { shop: 'Westfield Santa Anita', road: 'Baldwin Avenue', city: 'Arcadia' } })
  assert.equal((await describeCoordinate(34.1397, -118.0353)).name, 'Westfield Santa Anita')
})

test('a plain residential fix degrades to a street, never a bare house number', async (t) => {
  t.after(restore)
  stub({ address: { house_number: '482', road: 'South Marengo Avenue', suburb: 'Madison Heights', city: 'Pasadena' } })
  const result = await describeCoordinate(34.13, -118.14)
  assert.equal(result.name, '482 South Marengo Avenue')
  assert.doesNotMatch(result.name, /^\d+$/)
})

test('an empty result yields no name rather than a wrong one', async (t) => {
  t.after(restore)
  stub({ address: {} })
  assert.equal((await describeCoordinate(0, 0)).name, '')
})

test('the lookup identifies itself and asks for the right zoom', async (t) => {
  t.after(restore)
  stub({ name: 'Anywhere', address: {} })
  await describeCoordinate(34.1, -118.1)
  // Nominatim's usage policy requires an identifying User-Agent.
  assert.match(lastInit.headers['User-Agent'], /Fuel/)
  assert.match(lastUrl, /zoom=18/)
  assert.match(lastUrl, /format=jsonv2/)
  // A coordinate is sent with limited precision and nothing else — no id, no account.
  assert.doesNotMatch(lastUrl, /user|email|token|id=/i)
})

test('an upstream failure is an error, not a silent wrong name', async (t) => {
  t.after(restore)
  stub({}, { status: 503 })
  await assert.rejects(() => describeCoordinate(34.1, -118.1), /OpenStreetMap returned 503/)
})

test('a place is looked up once and the answer is cached', () => {
  assert.match(places, /if \(place\.geocoded_at && !force\)/)
  assert.match(places, /suggested_label = \$\{name \|\| null\}/)
  // A failed lookup must not mark the place identified, or it could never be retried.
  assert.match(places, /identified: false, error: 'Could not look up a name for this place\.'/)
})

test('a looked-up name never overwrites the name the user chose', () => {
  // suggested_label and label are separate columns; identifyPlace only ever writes the
  // suggestion, and renamePlace only ever writes the label.
  const identify = places.slice(
    places.indexOf('export async function identifyPlace'),
    places.indexOf('export async function renamePlace'),
  )
  assert.ok(identify.length > 200, 'failed to isolate identifyPlace')
  assert.doesNotMatch(identify, /SET label =/)
  assert.match(identify, /SET suggested_label =/)
  assert.match(places, /UPDATE user_places SET label = \$\{clean \|\| null\}/)
})
