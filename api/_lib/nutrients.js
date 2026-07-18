import { sql } from './db.js'

export const NUTRIENT_DEFINITIONS = [
  { key: 'sugarsG', label: 'Total sugars', unit: 'g', aliases: ['sugar', 'sugars', 'totalSugar', 'totalSugars', 'sugars_g'] },
  { key: 'addedSugarsG', label: 'Added sugars', unit: 'g', aliases: ['addedSugar', 'addedSugars', 'added_sugars_g'] },
  { key: 'starchG', label: 'Starch', unit: 'g', aliases: ['starch', 'starch_g'] },
  { key: 'sugarAlcoholG', label: 'Sugar alcohol', unit: 'g', aliases: ['sugarAlcohol', 'sugarAlcohols', 'sugar_alcohol_g'] },
  { key: 'saturatedFatG', label: 'Saturated fat', unit: 'g', aliases: ['saturatedFat', 'satFat', 'saturated_fat_g'] },
  { key: 'transFatG', label: 'Trans fat', unit: 'g', aliases: ['transFat', 'trans_fat_g'] },
  { key: 'monounsaturatedFatG', label: 'Monounsaturated fat', unit: 'g', aliases: ['monounsaturatedFat', 'monoFat', 'monounsaturated_fat_g'] },
  { key: 'polyunsaturatedFatG', label: 'Polyunsaturated fat', unit: 'g', aliases: ['polyunsaturatedFat', 'polyFat', 'polyunsaturated_fat_g'] },
  { key: 'omega3G', label: 'Omega-3', unit: 'g', aliases: ['omega3', 'omega_3_g'] },
  { key: 'omega6G', label: 'Omega-6', unit: 'g', aliases: ['omega6', 'omega_6_g'] },
  { key: 'cholesterolMg', label: 'Cholesterol', unit: 'mg', aliases: ['cholesterol', 'cholesterol_mg'] },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg', aliases: ['sodium', 'sodium_mg'] },
  { key: 'potassiumMg', label: 'Potassium', unit: 'mg', aliases: ['potassium', 'potassium_mg'] },
  { key: 'calciumMg', label: 'Calcium', unit: 'mg', aliases: ['calcium', 'calcium_mg'] },
  { key: 'ironMg', label: 'Iron', unit: 'mg', aliases: ['iron', 'iron_mg'] },
  { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', aliases: ['magnesium', 'magnesium_mg'] },
  { key: 'phosphorusMg', label: 'Phosphorus', unit: 'mg', aliases: ['phosphorus', 'phosphorous', 'phosphorus_mg'] },
  { key: 'zincMg', label: 'Zinc', unit: 'mg', aliases: ['zinc', 'zinc_mg'] },
  { key: 'copperMg', label: 'Copper', unit: 'mg', aliases: ['copper', 'copper_mg'] },
  { key: 'manganeseMg', label: 'Manganese', unit: 'mg', aliases: ['manganese', 'manganese_mg'] },
  { key: 'seleniumMcg', label: 'Selenium', unit: 'mcg', aliases: ['selenium', 'selenium_mcg'] },
  { key: 'iodineMcg', label: 'Iodine', unit: 'mcg', aliases: ['iodine', 'iodine_mcg'] },
  { key: 'vitaminAMcg', label: 'Vitamin A', unit: 'mcg', aliases: ['vitaminA', 'vitamin_a_mcg'] },
  { key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', aliases: ['vitaminC', 'ascorbicAcid', 'vitamin_c_mg'] },
  { key: 'vitaminDMcg', label: 'Vitamin D', unit: 'mcg', aliases: ['vitaminD', 'vitamin_d_mcg'] },
  { key: 'vitaminEMg', label: 'Vitamin E', unit: 'mg', aliases: ['vitaminE', 'vitamin_e_mg'] },
  { key: 'vitaminKMcg', label: 'Vitamin K', unit: 'mcg', aliases: ['vitaminK', 'vitamin_k_mcg'] },
  { key: 'thiaminMg', label: 'Thiamin (B1)', unit: 'mg', aliases: ['thiamin', 'thiamine', 'vitaminB1', 'thiamin_mg'] },
  { key: 'riboflavinMg', label: 'Riboflavin (B2)', unit: 'mg', aliases: ['riboflavin', 'vitaminB2', 'riboflavin_mg'] },
  { key: 'niacinMg', label: 'Niacin (B3)', unit: 'mg', aliases: ['niacin', 'vitaminB3', 'niacin_mg'] },
  { key: 'pantothenicAcidMg', label: 'Pantothenic acid (B5)', unit: 'mg', aliases: ['pantothenicAcid', 'vitaminB5', 'pantothenic_acid_mg'] },
  { key: 'vitaminB6Mg', label: 'Vitamin B6', unit: 'mg', aliases: ['vitaminB6', 'pyridoxine', 'vitamin_b6_mg'] },
  { key: 'biotinMcg', label: 'Biotin (B7)', unit: 'mcg', aliases: ['biotin', 'vitaminB7', 'biotin_mcg'] },
  { key: 'folateMcg', label: 'Folate (B9)', unit: 'mcg', aliases: ['folate', 'folicAcid', 'vitaminB9', 'folate_mcg'] },
  { key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', aliases: ['vitaminB12', 'cobalamin', 'vitamin_b12_mcg'] },
  { key: 'cholineMg', label: 'Choline', unit: 'mg', aliases: ['choline', 'choline_mg'] },
  { key: 'caffeineMg', label: 'Caffeine', unit: 'mg', aliases: ['caffeine', 'caffeine_mg'] },
  { key: 'waterMl', label: 'Water', unit: 'mL', aliases: ['water', 'waterMl', 'water_ml'] },
  { key: 'alcoholG', label: 'Alcohol', unit: 'g', aliases: ['alcohol', 'alcohol_g'] },
]

export const NUTRIENT_JSON_SCHEMA_PROPERTIES = Object.fromEntries(
  NUTRIENT_DEFINITIONS.map(({ key, label, unit }) => [key, { type: 'number', minimum: 0, description: `${label} in ${unit}` }]),
)

const aliasToKey = new Map()
for (const definition of NUTRIENT_DEFINITIONS) {
  for (const alias of [definition.key, ...definition.aliases]) aliasToKey.set(normalizeKey(alias), definition.key)
}

let schemaPromise = null

export function ensureNutrientSchema() {
  if (!schemaPromise) {
    schemaPromise = ensureSchema().catch((error) => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

async function ensureSchema() {
  const db = sql()
  await db`
    ALTER TABLE food_entries
      ADD COLUMN IF NOT EXISTS sugars_g double precision,
      ADD COLUMN IF NOT EXISTS added_sugars_g double precision,
      ADD COLUMN IF NOT EXISTS sodium_mg double precision,
      ADD COLUMN IF NOT EXISTS caffeine_mg double precision,
      ADD COLUMN IF NOT EXISTS nutrients jsonb NOT NULL DEFAULT '{}'::jsonb
  `
  await db`
    ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS nutrients jsonb NOT NULL DEFAULT '{}'::jsonb
  `
}

export function normalizeNutrients(input) {
  const value = parseObject(input)
  if (!value) return {}
  const output = {}
  const sources = [parseObject(value.nutrients), value].filter(Boolean)
  for (const source of sources) {
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = aliasToKey.get(normalizeKey(rawKey))
      if (!key) continue
      const parsed = nutrientNumber(rawValue)
      if (parsed != null) output[key] = parsed
    }
  }
  return output
}

export function nutrientColumns(input) {
  const nutrients = normalizeNutrients(input)
  return {
    sugarsG: nutrients.sugarsG ?? null,
    addedSugarsG: nutrients.addedSugarsG ?? null,
    sodiumMg: nutrients.sodiumMg ?? null,
    caffeineMg: nutrients.caffeineMg ?? null,
  }
}

export function nutrientsFromRow(row) {
  const nutrients = normalizeNutrients(row)
  const direct = {
    sugarsG: nutrientNumber(row?.sugars_g),
    addedSugarsG: nutrientNumber(row?.added_sugars_g),
    sodiumMg: nutrientNumber(row?.sodium_mg),
    caffeineMg: nutrientNumber(row?.caffeine_mg),
  }
  for (const [key, value] of Object.entries(direct)) if (value != null) nutrients[key] = value
  return nutrients
}

export function sumNutrients(rows) {
  const totals = {}
  const seen = new Set()
  for (const row of rows || []) {
    const nutrients = nutrientsFromRow(row)
    for (const [key, value] of Object.entries(nutrients)) {
      totals[key] = (totals[key] || 0) + value
      seen.add(key)
    }
  }
  return Object.fromEntries(Object.entries(totals).filter(([key]) => seen.has(key)))
}

export function nutrientSummaryText(input, maximum = 10) {
  const nutrients = normalizeNutrients(input)
  return NUTRIENT_DEFINITIONS
    .filter(({ key }) => nutrients[key] != null)
    .slice(0, maximum)
    .map(({ key, label, unit }) => `${label}: ${round(nutrients[key])} ${unit}`)
    .join(', ')
}

function parseObject(value) {
  if (!value) return null
  if (typeof value === 'string') {
    try { return parseObject(JSON.parse(value)) } catch { return null }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : null
}

function nutrientNumber(value) {
  if (value == null || value === '') return null
  if (typeof value === 'object') return nutrientNumber(value.value ?? value.amount ?? value.quantity)
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  const match = String(value).replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '') }
function round(value) { return Math.round(value * 100) / 100 }
