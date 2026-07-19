const ENERGY_TIME_ZONE = 'America/Los_Angeles'
const ENERGY_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: ENERGY_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
})
const ENERGY_CLOCK_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: ENERGY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

let energyRequestRunning = false

function clockParts(value) {
  const parts = Object.fromEntries(ENERGY_CLOCK_PARTS.formatToParts(value).map((part) => [part.type, part.value]))
  return {
    hour: Number(parts.hour) || 0,
    minute: Number(parts.minute) || 0,
    second: Number(parts.second) || 0,
  }
}

function minuteOfDay(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = clockParts(date)
  return parts.hour * 60 + parts.minute + parts.second / 60
}

function currentMinute() {
  const parts = clockParts(new Date())
  return Math.max(1, parts.hour * 60 + parts.minute + parts.second / 60)
}

function formatTime(value) {
  return ENERGY_CLOCK.format(value instanceof Date ? value : new Date(value))
}

function formatMinute(minute) {
  const total = Math.max(0, Math.min(1439, Math.round(minute)))
  const hour = Math.floor(total / 60)
  const minutes = total % 60
  return `${hour % 12 || 12}:${String(minutes).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function sortPoints(points) {
  return points.sort((left, right) => left.minute - right.minute)
}

function pointRows(rows, field) {
  return sortPoints((Array.isArray(rows) ? rows : []).map((row) => {
    const minute = minuteOfDay(row.collectedAt)
    const value = Number(row[field])
    return { minute, value, timestamp: row.collectedAt }
  }).filter((point) => point.minute != null && Number.isFinite(point.value)))
}

function makeSeries(payload) {
  const source = payload?.intradayEnergy || {}
  const expenditure = Array.isArray(source.expenditure) ? source.expenditure : []
  const consumed = Array.isArray(source.consumed) ? source.consumed : []
  return [
    { key: 'total', label: 'Total burned', points: pointRows(expenditure, 'totalExpenditure') },
    { key: 'active', label: 'Active burned', points: pointRows(expenditure, 'activeEnergy') },
    { key: 'resting', label: 'Resting burned', points: pointRows(expenditure, 'restingEnergy') },
    { key: 'consumed', label: 'Consumed', points: pointRows(consumed, 'caloriesConsumed') },
  ]
}

function pointsToPath(points, x, y) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.minute).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')
}

function renderSeries(series, x, y) {
  if (!series.points.length) return ''
  const path = series.points.length > 1
    ? `<path class="intraday-line ${series.key}-line" d="${pointsToPath(series.points, x, y)}"/>`
    : ''
  const dots = series.points.map((point) => `
    <circle class="intraday-point ${series.key}-point" cx="${x(point.minute)}" cy="${y(point.value)}" r="4">
      <title>${series.label}: ${Math.round(point.value).toLocaleString()} kcal at ${formatTime(point.timestamp)}</title>
    </circle>
  `).join('')
  return path + dots
}

function chartMarkup(payload) {
  const series = makeSeries(payload)
  const end = currentMinute()
  const visibleSeries = series.map((item) => ({
    ...item,
    points: item.points.filter((point) => point.minute >= 0 && point.minute <= end),
  }))
  const allPoints = visibleSeries.flatMap((item) => item.points)

  if (!allPoints.length) {
    return `
      <div class="intraday-energy-head">
        <div><span class="eyebrow">TODAY OVER TIME</span><h3>Calories</h3><p>Only timestamped Neon records appear here.</p></div>
      </div>
      <div class="intraday-empty">No timestamped calorie measurements have been stored today.</div>
    `
  }

  const width = 960
  const height = 330
  const pad = { left: 62, right: 22, top: 24, bottom: 43 }
  const max = Math.max(100, ...allPoints.map((point) => point.value)) * 1.06
  const x = (minute) => pad.left + (clamp(minute, 0, end) / end) * (width - pad.left - pad.right)
  const y = (value) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom)
  const yTicks = [0, .25, .5, .75, 1].map((fraction) => Math.round(max * fraction))
  const xTicks = [0, .25, .5, .75, 1].map((fraction) => end * fraction)

  return `
    <div class="intraday-energy-head">
      <div>
        <span class="eyebrow">TODAY OVER TIME</span>
        <h3>Calories</h3>
        <p>Only measurements stored in Neon are plotted. Lines connect recorded points without adding or projecting values.</p>
      </div>
      <div class="intraday-legend">
        ${visibleSeries.map((item) => `<span><i class="${item.key}-dot"></i>${item.label}</span>`).join('')}
      </div>
    </div>
    <div class="intraday-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Recorded calories consumed, active calories, resting calories, and total calories burned today">
        <g class="intraday-grid">
          ${yTicks.map((value) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"/><text x="${pad.left - 10}" y="${y(value) + 4}" text-anchor="end">${value}</text>`).join('')}
        </g>
        ${visibleSeries.map((item) => renderSeries(item, x, y)).join('')}
        <g class="intraday-x">
          ${xTicks.map((minute, index) => `<text x="${x(minute)}" y="${height - 14}" text-anchor="${index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}">${formatMinute(minute)}</text>`).join('')}
        </g>
        <text class="intraday-y-label" x="15" y="${height / 2}" transform="rotate(-90 15 ${height / 2})" text-anchor="middle">Kilocalories</text>
      </svg>
    </div>
  `
}

function summaryBarsMarkup(payload) {
  const summary = payload?.today?.summary || {}
  const resting = Number(summary.restingEnergy) || 0
  const active = Number(summary.activeEnergy) || 0
  const total = Number(summary.totalExpenditure) || resting + active
  const consumed = Number(summary.caloriesConsumed) || 0
  const balance = total - consumed
  const balanceLabel = balance >= 0 ? 'Deficit' : 'Surplus'
  const balanceClass = balance >= 0 ? 'deficit' : 'surplus'
  const balanceAmount = Math.abs(balance)
  const max = Math.max(total, consumed, active, 1)
  const pctNumber = (value) => Math.max(0, value / max * 100)
  const pct = (value) => `${pctNumber(value)}%`
  const restingShare = total > 0 ? resting / total * 100 : 0
  const activeShare = total > 0 ? active / total * 100 : 0
  const gapStart = Math.min(pctNumber(total), pctNumber(consumed))
  const gapWidth = Math.abs(pctNumber(total) - pctNumber(consumed))
  const gapNarrowClass = gapWidth < 18 ? ' narrow-gap' : ''

  return `
    <div class="energy-summary-bars" data-energy-summary-bars>
      <div class="energy-summary-metrics" aria-label="Current energy totals">
        <div><span><i class="total-dot"></i>Total burned</span><strong>${Math.round(total).toLocaleString()} kcal</strong></div>
        <div><span><i class="consumed-dot"></i>Consumed</span><strong>${Math.round(consumed).toLocaleString()} kcal</strong></div>
        <div><span><i class="active-dot"></i>Active</span><strong>${Math.round(active).toLocaleString()} kcal</strong></div>
        <div class="energy-balance-metric ${balanceClass}"><span><i class="balance-dot"></i>${balanceLabel}</span><strong>${Math.round(balanceAmount).toLocaleString()} kcal</strong></div>
      </div>
      <div class="energy-summary-plot">
        <div class="energy-summary-track" aria-label="Total burned ${Math.round(total)} kilocalories, consisting of ${Math.round(resting)} resting and ${Math.round(active)} active kilocalories">
          <div class="energy-summary-fill total-burned-fill" style="width:${pct(total)}">
            <span class="resting-segment" style="width:${restingShare}%"></span>
            <span class="active-segment" style="width:${activeShare}%"></span>
          </div>
        </div>
        <div class="energy-summary-track consumed-track" aria-label="Consumed ${Math.round(consumed)} kilocalories. ${balanceLabel} is ${Math.round(balanceAmount)} kilocalories, represented by the distance between consumed and total burned.">
          <span class="energy-summary-fill consumed-fill" style="width:${pct(consumed)}"></span>
          ${balanceAmount > 0 ? `<span class="energy-balance-gap ${balanceClass}-gap${gapNarrowClass}" style="left:${gapStart}%;width:${gapWidth}%"><b>${Math.round(balanceAmount).toLocaleString()} kcal ${balanceLabel.toLowerCase()}</b></span>` : ''}
        </div>
        <div class="energy-summary-track" aria-label="Active calories ${Math.round(active)} kilocalories">
          <span class="energy-summary-fill active-fill" style="width:${pct(active)}"></span>
        </div>
      </div>
      <div class="energy-summary-key"><span><i class="resting-dot"></i>Resting</span><span><i class="active-dot"></i>Active</span><span><i class="consumed-dot"></i>Consumed</span><span><i class="balance-dot"></i>${balanceLabel} gap</span></div>
    </div>`
}

function renderChart(payload) {
  const hero = document.querySelector('.hero.panel')
  if (!hero) return false

  // The energy summary boxes + horizontal bar are now rendered by React (EnergySummary
  // in App.tsx), which also makes them customizable. This script only injects the
  // intraday "today over time" chart below the hero.
  let wrap = document.querySelector('[data-intraday-energy]')
  if (!wrap) {
    wrap = document.createElement('section')
    wrap.className = 'intraday-energy panel'
    wrap.dataset.intradayEnergy = 'true'
    hero.insertAdjacentElement('afterend', wrap)
  }
  wrap.innerHTML = chartMarkup(payload)
  return true
}

async function refreshIntradayEnergy() {
  if (energyRequestRunning || (location.pathname !== '/' && location.pathname !== '/index.html')) return
  const hero = document.querySelector('.hero.panel')
  if (!hero) return
  energyRequestRunning = true
  try {
    const response = await fetch('/api/mlog', { cache: 'no-store', headers: { Accept: 'application/json' } })
    if (!response.ok) return
    renderChart(await response.json())
  } catch {
    // The authenticated dashboard handles its own connection errors.
  } finally {
    energyRequestRunning = false
  }
}

// The fitness-ring reveal animation is owned entirely by React (ActivityRings in
// App.tsx). This script only injects the intraday energy chart. The observer must
// NOT refresh on every mutation: renderChart rewrites innerHTML, which is itself a
// mutation, so an unconditional refresh here forms an infinite fetch/render loop
// that freezes the main thread. Only refresh from the observer until the chart has
// been injected. Ongoing updates come from the interval/focus/DOMContentLoaded below.
new MutationObserver(() => {
  if (!document.querySelector('[data-intraday-energy]')) void refreshIntradayEnergy()
}).observe(document.documentElement, { childList: true, subtree: true })
addEventListener('DOMContentLoaded', () => void refreshIntradayEnergy())
addEventListener('focus', () => void refreshIntradayEnergy())
setInterval(() => void refreshIntradayEnergy(), 30000)
void refreshIntradayEnergy()
