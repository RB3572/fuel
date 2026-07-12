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
  const segment = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
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
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 120 120')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Macronutrient calorie distribution')
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
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

function runEnhancements() {
  enhanceNutrition()
}

const observer = new MutationObserver(runEnhancements)
observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('load', runEnhancements)
runEnhancements()
