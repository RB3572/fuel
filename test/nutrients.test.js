import test from 'node:test'
import assert from 'node:assert/strict'
import { nutrientColumns, nutrientSummaryText, nutrientsFromRow, normalizeNutrients, sumNutrients } from '../api/_lib/nutrients.js'

test('normalizes detailed nutrient aliases and preserves zero values', () => {
  const nutrients = normalizeNutrients({
    sugars_g: '12.5 g',
    addedSugars: 4,
    sodium: '850 mg',
    caffeineMg: 0,
    vitaminB12: '2.4 mcg',
    omega3: 1.2,
  })
  assert.deepEqual(nutrients, {
    sugarsG: 12.5,
    addedSugarsG: 4,
    sodiumMg: 850,
    caffeineMg: 0,
    vitaminB12Mcg: 2.4,
    omega3G: 1.2,
  })
})

test('uses first-class nutrient columns as authoritative row values', () => {
  const nutrients = nutrientsFromRow({
    nutrients: { sugarsG: 8, sodiumMg: 500, vitaminCMg: 12 },
    sugars_g: 10,
    sodium_mg: 700,
    caffeine_mg: 80,
  })
  assert.equal(nutrients.sugarsG, 10)
  assert.equal(nutrients.sodiumMg, 700)
  assert.equal(nutrients.caffeineMg, 80)
  assert.equal(nutrients.vitaminCMg, 12)
  assert.deepEqual(nutrientColumns(nutrients), { sugarsG: 10, addedSugarsG: null, sodiumMg: 700, caffeineMg: 80 })
})

test('sums only nutrients that were actually tracked', () => {
  const total = sumNutrients([
    { nutrients: { sodiumMg: 200, vitaminCMg: 10 } },
    { sodium_mg: 300, nutrients: { caffeineMg: 95 } },
  ])
  assert.deepEqual(total, { sodiumMg: 500, vitaminCMg: 10, caffeineMg: 95 })
  assert.equal(total.calciumMg, undefined)
})

test('creates readable nutrient summaries', () => {
  const summary = nutrientSummaryText({ sugarsG: 12, sodiumMg: 500, caffeineMg: 80 })
  assert.match(summary, /Total sugars: 12 g/)
  assert.match(summary, /Sodium: 500 mg/)
  assert.match(summary, /Caffeine: 80 mg/)
})
