const statusEl = document.getElementById('recipe-status')
const groupsEl = document.getElementById('recipe-groups')
const searchEl = document.getElementById('recipe-search')
let recipes = []

loadRecipes()
searchEl.addEventListener('input', render)

async function loadRecipes() {
  try {
    const response = await fetch('/api/mlog', { cache: 'no-store', headers: { Accept: 'application/json' } })
    if (response.status === 401) {
      location.assign('/')
      return
    }
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Unable to load recipes')
    recipes = payload.recipes || []
    render()
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : 'Unable to load recipes.'
  }
}

function render() {
  const query = searchEl.value.trim().toLowerCase()
  const filtered = recipes.filter(recipe => {
    const haystack = [recipe.name, recipe.category, recipe.serving, ...(recipe.ingredients || []), ...(recipe.instructions || [])].join(' ').toLowerCase()
    return !query || haystack.includes(query)
  })
  statusEl.hidden = filtered.length > 0
  groupsEl.hidden = filtered.length === 0
  statusEl.textContent = recipes.length ? 'No recipes match that search.' : 'No saved recipes yet.'
  groupsEl.innerHTML = ''

  const grouped = groupBy(filtered, recipe => recipe.category || 'Other recipes')
  for (const [category, items] of Object.entries(grouped)) {
    const section = document.createElement('details')
    section.className = 'recipe-drawer'
    section.open = category === 'Ninja Creami' || Object.keys(grouped).length === 1
    section.innerHTML = `<summary><div><strong>${escapeHtml(category)}</strong><span>${items.length} recipe${items.length === 1 ? '' : 's'}</span></div><span class="drawer-chevron">⌄</span></summary><div class="recipe-list"></div>`
    const list = section.querySelector('.recipe-list')
    for (const recipe of items) list.appendChild(recipeCard(recipe))
    groupsEl.appendChild(section)
  }
}

function recipeCard(recipe) {
  const details = document.createElement('details')
  details.className = 'recipe-card'
  const macros = recipe.nutrition || {}
  const nutrition = [
    macros.calories != null ? `${format(macros.calories)} kcal` : '',
    macros.protein != null ? `${format(macros.protein, 1)}g protein` : '',
    macros.carbs != null ? `${format(macros.carbs, 1)}g carbs` : '',
    macros.fat != null ? `${format(macros.fat, 1)}g fat` : '',
  ].filter(Boolean).join(' · ')
  details.innerHTML = `
    <summary>
      <div><strong>${escapeHtml(recipe.name)}</strong><span>${escapeHtml(recipe.serving || 'Saved recipe')}</span></div>
      <div class="recipe-preview"><span>${escapeHtml(nutrition || 'Nutrition not entered')}</span><span>View</span></div>
    </summary>
    <div class="recipe-detail">
      ${nutritionBlock(recipe.nutrition)}
      <section><h2>Ingredients</h2>${listBlock(recipe.ingredients, 'No ingredients entered yet.')}</section>
      <section><h2>Instructions</h2>${numberedBlock(recipe.instructions, 'No instructions entered yet.')}</section>
      ${recipe.source ? `<p class="recipe-source">Source: ${escapeHtml(recipe.source)}</p>` : ''}
    </div>`
  return details
}

function nutritionBlock(nutrition = {}) {
  const values = [
    ['Calories', nutrition.calories, 'kcal'],
    ['Protein', nutrition.protein, 'g'],
    ['Carbs', nutrition.carbs, 'g'],
    ['Fat', nutrition.fat, 'g'],
    ['Fiber', nutrition.fiber, 'g'],
  ].filter(([, value]) => value != null)
  if (!values.length) return ''
  return `<div class="nutrition-grid">${values.map(([label, value, unit]) => `<div><span>${label}</span><strong>${format(value, label === 'Calories' ? 0 : 1)} ${unit}</strong></div>`).join('')}</div>`
}

function listBlock(items = [], empty) {
  return items.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<p class="empty-copy">${empty}</p>`
}

function numberedBlock(items = [], empty) {
  return items.length ? `<ol>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol>` : `<p class="empty-copy">${empty}</p>`
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item)
    ;(groups[key] ||= []).push(item)
    return groups
  }, {})
}

function format(value, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}
