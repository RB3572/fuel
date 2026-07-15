const SVG_NS = 'http://www.w3.org/2000/svg'

function numeric(text: string | null | undefined) {
  if (!text || /not logged/i.test(text)) return null
  const value = Number(text.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(value) ? value : null
}

function findPanel(title: string) {
  return [...document.querySelectorAll<HTMLElement>('.overview-panel')].find(
    (panel) => panel.querySelector('h2')?.textContent?.trim() === title,
  )
}

function ringSegment(value: number, total: number, offset: number, className: string) {
  const radius = 48
  const circumference = 2 * Math.PI * radius
  const share = total > 0 ? value / total : 0
  const length = Math.max(0, circumference * share - 5)
  const segment = document.createElementNS(SVG_NS, 'circle')
  segment.setAttribute('cx', '60')
  segment.setAttribute('cy', '60')
  segment.setAttribute('r', String(radius))
  segment.setAttribute('class', `macro-ring-segment ${className}`)
  segment.setAttribute('stroke-dasharray', `${length} ${circumference - length}`)
  segment.setAttribute('stroke-dashoffset', String(-offset))
  return { segment, nextOffset: offset + circumference * share }
}

function enhanceNutrition() {
  const panel = findPanel('Nutrition')
  const energyPanel = findPanel('Energy')
  if (!panel || !energyPanel || panel.querySelector('.macro-score-card')) return

  const calories = numeric(energyPanel.querySelector('.big-metric strong')?.textContent)
  const protein = numeric(panel.querySelector('.progress-metric strong')?.textContent)
  const stats = [...panel.querySelectorAll<HTMLElement>('.nutrition-stats .inline-stat')]
  const carbs = numeric(stats[0]?.querySelector('strong')?.textContent)
  const fat = numeric(stats[1]?.querySelector('strong')?.textContent)
  const fiber = numeric(stats[2]?.querySelector('strong')?.textContent)
  if ([protein, carbs, fat].every((value) => value == null)) return

  const proteinCalories = (protein || 0) * 4
  const carbCalories = (carbs || 0) * 4
  const fatCalories = (fat || 0) * 9
  const macroCalories = Math.max(1, proteinCalories + carbCalories + fatCalories)
  const card = document.createElement('div')
  card.className = 'macro-score-card'
  const copy = document.createElement('div')
  copy.className = 'macro-score-copy'
  copy.innerHTML = `
    <span class="macro-kicker">Daily intake</span>
    <strong>${calories == null ? 'Not logged' : Math.round(calories).toLocaleString()}</strong>
    <small>${calories == null ? '' : 'calories'}</small>
    <div class="macro-key">
      <span><i class="protein-dot"></i>Protein <b>${protein == null ? '—' : `${Math.round(protein)}g`}</b></span>
      <span><i class="carb-dot"></i>Carbs <b>${carbs == null ? '—' : `${Math.round(carbs)}g`}</b></span>
      <span><i class="fat-dot"></i>Fat <b>${fat == null ? '—' : `${Math.round(fat)}g`}</b></span>
    </div>`

  const ring = document.createElement('div')
  ring.className = 'macro-ring-wrap'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 120 120')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Macronutrient calorie distribution')
  const track = document.createElementNS(SVG_NS, 'circle')
  track.setAttribute('cx', '60')
  track.setAttribute('cy', '60')
  track.setAttribute('r', '48')
  track.setAttribute('class', 'macro-ring-track')
  svg.append(track)

  let offset = 0
  for (const [value, className] of [
    [proteinCalories, 'protein-segment'],
    [carbCalories, 'carb-segment'],
    [fatCalories, 'fat-segment'],
  ] as const) {
    const result = ringSegment(value, macroCalories, offset, className)
    svg.append(result.segment)
    offset = result.nextOffset
  }

  const center = document.createElement('div')
  center.className = 'macro-ring-center'
  center.innerHTML = `<strong>${fiber == null ? '—' : Math.round(fiber)}</strong><span>g fiber</span>`
  ring.append(svg, center)
  card.append(copy, ring)
  panel.querySelector('.progress-metric')?.classList.add('visually-replaced')
  panel.querySelector('.nutrition-stats')?.classList.add('visually-replaced')
  panel.append(card)
}

function enhanceContextMenu() {
  const menu = document.querySelector<HTMLElement>('.profile-menu')
  if (!menu || menu.querySelector('.fuel-context-menu-button')) return

  const button = document.createElement('button')
  button.className = 'fuel-context-menu-button'
  button.type = 'button'
  button.setAttribute('role', 'menuitem')
  button.innerHTML = `
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h8"></path>
    </svg>
    <span>Preferences & context</span>`
  button.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('.profile-button')?.click()
    void openContextModal()
  })

  const syncButton = [...menu.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    candidate.textContent?.includes('Sync setup'),
  )
  menu.insertBefore(button, syncButton || menu.querySelector('.logout-menu-button'))
}

async function openContextModal() {
  if (document.querySelector('.fuel-context-backdrop')) return
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop fuel-context-backdrop'
  const modal = document.createElement('section')
  modal.className = 'context-modal panel'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.innerHTML = `
    <div class="sync-modal-head">
      <div><h2>Preferences & context</h2><p>Food preferences, allergies, physical activity, goals, and durable guidance used by Fuel and MCP clients.</p></div>
      <button class="icon-button context-close-button" type="button" aria-label="Close">×</button>
    </div>
    <label class="context-label" for="fuel-context-textarea">Fuel context</label>
    <textarea id="fuel-context-textarea" maxlength="20000" disabled placeholder="Loading saved context…"></textarea>
    <div class="context-footer"><span class="context-count">0 / 20,000 characters</span><button class="save-context-button" type="button" disabled>Save context</button></div>
    <p class="sync-message context-message" aria-live="polite"></p>
    <p class="sync-note">MCP clients can read this field and append newly learned preferences. Saving here replaces the complete stored context.</p>`
  backdrop.append(modal)
  document.body.append(backdrop)

  const textarea = modal.querySelector<HTMLTextAreaElement>('textarea')!
  const count = modal.querySelector<HTMLElement>('.context-count')!
  const message = modal.querySelector<HTMLElement>('.context-message')!
  const save = modal.querySelector<HTMLButtonElement>('.save-context-button')!
  const close = () => backdrop.remove()
  modal.querySelector<HTMLButtonElement>('.context-close-button')!.addEventListener('click', close)
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close() })
  textarea.addEventListener('input', () => { count.textContent = `${textarea.value.length.toLocaleString()} / 20,000 characters` })

  try {
    const response = await fetch('/api/context', { cache: 'no-store', headers: { Accept: 'application/json' } })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Unable to load Fuel context.')
    textarea.value = payload.context || ''
    textarea.disabled = false
    save.disabled = false
    count.textContent = `${textarea.value.length.toLocaleString()} / 20,000 characters`
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Unable to load Fuel context.'
  }

  save.addEventListener('click', async () => {
    save.disabled = true
    textarea.disabled = true
    message.textContent = ''
    try {
      const response = await fetch('/api/context', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ context: textarea.value }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to save Fuel context.')
      textarea.value = payload.context || ''
      count.textContent = `${textarea.value.length.toLocaleString()} / 20,000 characters`
      message.textContent = 'Preferences and context saved.'
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Unable to save Fuel context.'
    } finally {
      save.disabled = false
      textarea.disabled = false
    }
  })
}

function hideLegacyEnergyControls() {
  document.querySelector<HTMLElement>('.hero .energy-viz')?.classList.add('visually-replaced')
  document.querySelector<HTMLElement>('.hero .tabs')?.classList.add('visually-replaced')
}

function runEnhancements() {
  enhanceNutrition()
  enhanceContextMenu()
  hideLegacyEnergyControls()
}

const observer = new MutationObserver(runEnhancements)
observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('load', runEnhancements)
runEnhancements()
