const statusEl = document.getElementById('recipe-status')
const groupsEl = document.getElementById('recipe-groups')
const searchEl = document.getElementById('recipe-search')
const backfillEl = document.getElementById('recipe-backfill')
let recipes = []

loadRecipes()
searchEl.addEventListener('input', render)

// One click on a card's Log button sends the recipe to today's food log. The button
// carries only the recipe id — the server reads the nutrition from the recipe bank
// so what gets logged always matches the recipe.
groupsEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-log-recipe]')
  if (!button) return
  // The button lives inside <summary>, whose default action toggles the card open.
  event.preventDefault()
  event.stopPropagation()
  void logRecipe(button)
})

// allowEstimate bounds the 409 -> estimate -> retry path to a SINGLE retry. Without
// it, a recipe that still reports missing nutrition after a nominally successful
// estimate sends the client into an unbounded log/estimate loop against the server.
async function logRecipe(button, allowEstimate = true) {
  if (button.disabled) return
  const id = button.dataset.logRecipe
  const original = button.textContent
  button.disabled = true
  button.textContent = 'Logging…'
  try {
    const response = await fetch('/api/mlog?fuel_route=log-recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ recipeId: id, servings: 1 }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401) { location.assign('/'); return }
    if (response.status === 409 && payload.needsNutrition) {
      if (!allowEstimate) throw new Error('Nutrition for this recipe is still missing, so it was not logged.')
      button.textContent = 'Estimating…'
      const filled = await estimateOne(id)
      if (!filled) throw new Error(payload.error || 'Nutrition is missing.')
      await refresh()
      void updateBackfillBanner()
      // The card was re-rendered, so log through the replacement button — once.
      const replacement = groupsEl.querySelector(`[data-log-recipe="${CSS.escape(id)}"]`)
      if (replacement) return logRecipe(replacement, false)
      return
    }
    if (!response.ok) throw new Error(payload.error || 'Could not log this recipe.')
    button.textContent = 'Logged ✓'
    button.classList.add('is-logged')
    setTimeout(() => { button.textContent = original; button.classList.remove('is-logged'); button.disabled = false }, 2200)
  } catch (error) {
    button.textContent = 'Failed'
    button.title = error instanceof Error ? error.message : 'Could not log this recipe.'
    setTimeout(() => { button.textContent = original; button.disabled = false }, 2600)
  }
}

async function estimateOne(recipeId) {
  const response = await fetch('/api/mlog?fuel_route=recipe-nutrition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ recipeId }),
  })
  const payload = await response.json().catch(() => ({}))
  return response.ok && (payload.updated || []).length > 0
}

async function refresh() {
  const response = await fetch('/api/mlog', { cache: 'no-store', headers: { Accept: 'application/json' } })
  if (!response.ok) return
  const payload = await response.json()
  recipes = payload.recipes || []
  render()
}

// Recipes with no calorie figure cannot be one-click logged, so offer to fill them
// in rather than letting a click silently log a zero-calorie entry.
async function runBackfill() {
  const button = backfillEl.querySelector('button')
  button.disabled = true
  let remaining = Infinity
  let done = 0
  try {
    while (remaining > 0) {
      button.textContent = done ? `Filling in… ${done} done` : 'Filling in…'
      const response = await fetch('/api/mlog?fuel_route=recipe-nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ limit: 6 }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not fill in nutrition.')
      done += (payload.updated || []).length
      // Out of Gemini quota: further passes cannot succeed, so keep whatever was
      // filled in and tell the user why the rest stopped.
      if (payload.quotaExhausted) {
        await refresh()
        await updateBackfillBanner()
        throw new Error(payload.error || 'Out of Gemini quota.')
      }
      // Stop when a pass makes no progress, so permanently un-estimable recipes
      // (no usable ingredients) cannot spin this loop forever.
      if (!(payload.updated || []).length) break
      remaining = payload.remaining ?? 0
    }
    await refresh()
    await updateBackfillBanner()
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : 'Could not fill in nutrition.'
  } finally {
    button.disabled = false
  }
}

async function updateBackfillBanner() {
  if (!backfillEl) return
  try {
    const response = await fetch('/api/mlog?fuel_route=recipe-nutrition', { cache: 'no-store', headers: { Accept: 'application/json' } })
    if (!response.ok) { backfillEl.hidden = true; return }
    const payload = await response.json()
    const pending = payload.pending || 0
    backfillEl.hidden = pending === 0
    if (pending > 0) {
      backfillEl.innerHTML = `<span>${pending} recipe${pending === 1 ? '' : 's'} ${pending === 1 ? 'has' : 'have'} no nutrition breakdown, so ${pending === 1 ? 'it cannot' : 'they cannot'} be logged yet.</span><button type="button">Fill in with Fuel AI</button>`
      backfillEl.querySelector('button').addEventListener('click', runBackfill)
    }
  } catch {
    backfillEl.hidden = true
  }
}

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
    void updateBackfillBanner()
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
  const loggable = macros.calories != null
  const logButton = `<button type="button" class="log-recipe-button" data-log-recipe="${escapeHtml(recipe.id)}" title="${loggable ? `Log one ${escapeHtml(recipe.serving || 'serving')} to today` : 'Estimate nutrition, then log to today'}">${loggable ? 'Log' : 'Estimate + log'}</button>`
  details.innerHTML = `
    <summary>
      <div><strong>${escapeHtml(recipe.name)}</strong><span>${escapeHtml(recipe.serving || 'Saved recipe')}</span></div>
      <div class="recipe-preview"><span class="preview-nutrition">${escapeHtml(nutrition || 'Nutrition not entered')}</span><span class="preview-actions">${logButton}<span class="view-hint">View</span></span></div>
    </summary>
    <div class="recipe-detail">
      ${recipe.nutritionEstimated ? '<p class="estimate-note">Nutrition estimated by Fuel AI from the ingredients.</p>' : ''}
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

// Shared Fuel nav menu (Dashboard + Sign out). Same trigger button as every page.
const fuelMenuBtn = document.getElementById('fuel-menu-btn')
const fuelMenu = document.getElementById('fuel-menu')
fuelMenuBtn?.addEventListener('click', (event) => { event.stopPropagation(); const open = fuelMenu.hidden; fuelMenu.hidden = !open; fuelMenuBtn.setAttribute('aria-expanded', String(open)) })
document.addEventListener('click', (event) => { if (fuelMenu && !fuelMenu.hidden && !fuelMenu.contains(event.target) && event.target !== fuelMenuBtn) { fuelMenu.hidden = true; fuelMenuBtn.setAttribute('aria-expanded', 'false') } })
document.getElementById('fuel-signout')?.addEventListener('click', async () => { try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ } window.location.href = '/' })
