import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.DATABASE_URL ||= 'postgres://unused/unused'

const { DASHBOARD_SECTIONS, ENERGY_BOXES, CHARTS, normalizeLayout } = await import('../api/_lib/dashboard-layout.js')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

// normalizeLayout drops any key it does not recognise, and dropping is not an error.
// So a widget the client can toggle but the server has never heard of saves cleanly,
// renders, and then vanishes on reload with nothing logged anywhere. rolling24 shipped
// that way. These tests pin the client and server lists to each other.
const clientList = (name) => {
  const match = app.match(new RegExp(`const ${name}:\\w+\\[\\]=\\[([^\\]]*)\\]`))
  assert.ok(match, `${name} not found in src/App.tsx`)
  return match[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, '')).filter(Boolean)
}

test('the client and server agree on every dashboard section', () => {
  assert.deepEqual(clientList('ALL_SECTIONS'), DASHBOARD_SECTIONS)
})

test('the client and server agree on every energy box', () => {
  assert.deepEqual(clientList('ALL_ENERGY_BOXES'), ENERGY_BOXES)
})

test('the client and server agree on every toggleable chart', () => {
  assert.deepEqual(clientList('ALL_CHARTS'), CHARTS)
})

test('every toggleable chart round-trips, one at a time', () => {
  for (const chart of CHARTS) {
    const saved = normalizeLayout({ charts: [chart] })
    assert.deepEqual(saved.charts, [chart], `${chart} does not survive being saved on its own`)
  }
  assert.deepEqual(normalizeLayout({ charts: [] }).charts, [], 'turning every chart off is a real choice')
  assert.deepEqual(normalizeLayout({}).charts, CHARTS, 'an absent key means "use defaults"')
})

test('the rolling 24-hour metric survives a save', () => {
  const saved = normalizeLayout({ order: [...DASHBOARD_SECTIONS], hidden: [], energyBoxes: ['totalBurned', 'rolling24'] })
  assert.deepEqual(saved.energyBoxes, ['totalBurned', 'rolling24'], 'rolling24 was stripped on the way into the database')
})

test('every toggleable energy box round-trips, one at a time', () => {
  for (const box of ENERGY_BOXES) {
    const saved = normalizeLayout({ energyBoxes: [box] })
    assert.deepEqual(saved.energyBoxes, [box], `${box} does not survive being saved on its own`)
  }
})

test('an empty selection stays empty rather than resetting to every box', () => {
  // Turning every metric off is a real choice; only an absent key means "use defaults".
  assert.deepEqual(normalizeLayout({ energyBoxes: [] }).energyBoxes, [])
  assert.deepEqual(normalizeLayout({}).energyBoxes, ENERGY_BOXES)
})

test('unknown keys are still rejected, and order is still completed', () => {
  const saved = normalizeLayout({ order: ['vitals', 'bogus'], hidden: ['bogus'], energyBoxes: ['bogus', 'consumed'], charts: ['bogus', 'intraday'] })
  assert.deepEqual(saved.energyBoxes, ['consumed'])
  assert.deepEqual(saved.charts, ['intraday'])
  assert.deepEqual(saved.hidden, [])
  assert.equal(saved.order[0], 'vitals')
  assert.equal(saved.order.length, DASHBOARD_SECTIONS.length, 'every known section should be present exactly once')
  assert.deepEqual([...saved.order].sort(), [...DASHBOARD_SECTIONS].sort())
})
