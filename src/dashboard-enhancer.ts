type NullableNumber = number | null

type IntradayExpenditurePoint = {
  collectedAt: string
  activeEnergy: NullableNumber
  restingEnergy: NullableNumber
  totalExpenditure: NullableNumber
}

type IntradayConsumedPoint = {
  collectedAt: string
  caloriesConsumed: NullableNumber
}

type IntradayEnergy = {
  date: string
  expenditure: IntradayExpenditurePoint[]
  consumed: IntradayConsumedPoint[]
}

type DashboardPayload = {
  intradayEnergy?: IntradayEnergy
}

type PlotPoint = {
  time: number
  value: number
  clock: string
}

type PlotSeries = {
  key: string
  label: string
  className: string
  points: PlotPoint[]
}

const SVG_NS = 'http://www.w3.org/2000/svg'
let energyRefreshTimer: number | null = null
let energyRequestInFlight = false

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
    </div>
  `

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

  const oldProgress = panel.querySelector('.progress-metric')
  const oldStats = panel.querySelector('.nutrition-stats')
  oldProgress?.classList.add('visually-replaced')
  oldStats?.classList.add('visually-replaced')
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
    <span>Preferences & context</span>
  `
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
      <div>
        <h2>Preferences & context</h2>
        <p>Food preferences, allergies, physical activity, goals, and durable guidance used by Fuel and MCP clients.</p>
      </div>
      <button class="icon-button context-close-button" type="button" aria-label="Close">×</button>
    </div>
    <label class="context-label" for="fuel-context-textarea">Fuel context</label>
    <textarea id="fuel-context-textarea" maxlength="20000" disabled placeholder="Loading saved context…"></textarea>
    <div class="context-footer">
      <span class="context-count">0 / 20,000 characters</span>
      <button class="save-context-button" type="button" disabled>Save context</button>
    </div>
    <p class="sync-message context-message" aria-live="polite"></p>
    <p class="sync-note">MCP clients can read this field and append newly learned preferences. Saving here replaces the complete stored context.</p>
  `
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

function ensureIntradayChartMount() {
  const hero = document.querySelector<HTMLElement>('.hero')
  if (!hero) return

  hero.querySelector<HTMLElement>('.energy-viz')?.classList.add('visually-replaced')
  hero.querySelector<HTMLElement>('.tabs')?.classList.add('visually-replaced')

  let mount = hero.querySelector<HTMLElement>('.intraday-energy-card')
  if (!mount) {
    mount = document.createElement('div')
    mount.className = 'intraday-energy-card'
    mount.innerHTML = '<div class="intraday-loading">Loading timestamped Neon energy points…</div>'
    const stats = hero.querySelector('.hero-stats')
    hero.insertBefore(mount, stats || null)
    void refreshIntradayChart()
  }

  if (energyRefreshTimer == null) {
    energyRefreshTimer = window.setInterval(() => void refreshIntradayChart(), 30000)
  }
}

async function refreshIntradayChart() {
  if (energyRequestInFlight) return
  const mount = document.querySelector<HTMLElement>('.intraday-energy-card')
  if (!mount) return
  energyRequestInFlight = true
  try {
    const response = await fetch('/api/mlog', { cache: 'no-store', headers: { Accept: 'application/json' } })
    const payload = await response.json() as DashboardPayload & { error?: string }
    if (!response.ok) throw new Error(payload.error || 'Unable to load intraday energy points.')
    renderIntradayChart(mount, payload.intradayEnergy)
  } catch (error) {
    mount.innerHTML = `<div class="intraday-empty">${escapeHtml(error instanceof Error ? error.message : 'Unable to load intraday energy points.')}</div>`
  } finally {
    energyRequestInFlight = false
  }
}

function renderIntradayChart(mount: HTMLElement, data?: IntradayEnergy) {
  if (!data) {
    mount.innerHTML = '<div class="intraday-empty">No timestamped energy data is available today.</div>'
    return
  }

  const expenditure = data.expenditure || []
  const series: PlotSeries[] = [
    {
      key: 'active', label: 'Active burned', className: 'series-active',
      points: expenditure.filter((point) => point.activeEnergy != null).map((point) => plotPoint(point.collectedAt, point.activeEnergy as number)),
    },
    {
      key: 'resting', label: 'Resting burned', className: 'series-resting',
      points: expenditure.filter((point) => point.restingEnergy != null).map((point) => plotPoint(point.collectedAt, point.restingEnergy as number)),
    },
    {
      key: 'total', label: 'Total burned', className: 'series-total',
      points: expenditure.filter((point) => point.totalExpenditure != null).map((point) => plotPoint(point.collectedAt, point.totalExpenditure as number)),
    },
    {
      key: 'consumed', label: 'Consumed', className: 'series-consumed',
      points: (data.consumed || []).filter((point) => point.caloriesConsumed != null).map((point) => plotPoint(point.collectedAt, point.caloriesConsumed as number)),
    },
  ]

  const allValues = series.flatMap((item) => item.points.map((point) => point.value))
  if (!allValues.length) {
    mount.innerHTML = '<div class="intraday-empty">No timestamped energy points have been stored today.</div>'
    return
  }

  const width = 1000
  const height = 360
  const padding = { left: 64, right: 24, top: 28, bottom: 42 }
  const start = new Date(`${data.date}T00:00:00`).getTime()
  const now = Date.now()
  const end = Math.max(start + 1, now)
  const max = Math.max(100, ...allValues)
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const x = (time: number) => padding.left + clamp((time - start) / (end - start), 0, 1) * plotWidth
  const y = (value: number) => padding.top + (1 - value / max) * plotHeight

  mount.innerHTML = `
    <div class="intraday-chart-head">
      <div><strong>Calories over today</strong><span>Only database measurements are plotted and connected.</span></div>
      <div class="intraday-legend">${series.map((item) => `<span><i class="${item.className}"></i>${item.label}</span>`).join('')}</div>
    </div>
    <div class="intraday-chart-stage"></div>
  `

  const stage = mount.querySelector<HTMLElement>('.intraday-chart-stage')!
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Timestamped calories consumed, active calories, resting calories, and total calories burned today')

  for (const ratio of [0, .25, .5, .75, 1]) {
    const group = document.createElementNS(SVG_NS, 'g')
    group.setAttribute('class', 'intraday-grid')
    const line = document.createElementNS(SVG_NS, 'line')
    const lineY = padding.top + ratio * plotHeight
    line.setAttribute('x1', String(padding.left))
    line.setAttribute('x2', String(width - padding.right))
    line.setAttribute('y1', String(lineY))
    line.setAttribute('y2', String(lineY))
    const label = document.createElementNS(SVG_NS, 'text')
    label.setAttribute('x', String(padding.left - 10))
    label.setAttribute('y', String(lineY + 4))
    label.setAttribute('text-anchor', 'end')
    label.textContent = String(Math.round(max * (1 - ratio)))
    group.append(line, label)
    svg.append(group)
  }

  for (const item of series) {
    const valid = item.points.filter((point) => point.time >= start && point.time <= end)
    const group = document.createElementNS(SVG_NS, 'g')
    group.setAttribute('class', `intraday-series ${item.className}`)
    if (valid.length > 1) {
      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', valid.map((point, index) => `${index ? 'L' : 'M'} ${x(point.time)} ${y(point.value)}`).join(' '))
      group.append(path)
    }
    for (const point of valid) {
      const circle = document.createElementNS(SVG_NS, 'circle')
      circle.setAttribute('cx', String(x(point.time)))
      circle.setAttribute('cy', String(y(point.value)))
      circle.setAttribute('r', '5')
      const title = document.createElementNS(SVG_NS, 'title')
      title.textContent = `${item.label}: ${Math.round(point.value).toLocaleString()} kcal at ${point.clock}`
      circle.append(title)
      group.append(circle)
    }
    svg.append(group)
  }

  const midnight = svgText(padding.left, height - 12, '12:00 AM', 'start')
  const current = svgText(width - padding.right, height - 12, clockFormat(new Date(now)), 'end')
  const yLabel = svgText(16, padding.top + plotHeight / 2, 'Kilocalories', 'middle')
  yLabel.setAttribute('transform', `rotate(-90 16 ${padding.top + plotHeight / 2})`)
  svg.append(midnight, current, yLabel)
  stage.append(svg)
}

function plotPoint(timestamp: string, value: number): PlotPoint {
  return { time: new Date(timestamp).getTime(), value, clock: clockFormat(new Date(timestamp)) }
}

function svgText(x: number, y: number, value: string, anchor: 'start'|'middle'|'end') {
  const text = document.createElementNS(SVG_NS, 'text')
  text.setAttribute('class', 'intraday-axis-label')
  text.setAttribute('x', String(x))
  text.setAttribute('y', String(y))
  text.setAttribute('text-anchor', anchor)
  text.textContent = value
  return text
}

function clockFormat(value: Date) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(value)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character] || character)
}

function runEnhancements() {
  enhanceNutrition()
  enhanceContextMenu()
  ensureIntradayChartMount()
}

const observer = new MutationObserver(runEnhancements)
observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('load', runEnhancements)
window.addEventListener('focus', () => void refreshIntradayChart())
runEnhancements()
