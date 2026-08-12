import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CHART_GROUPS, CHART_METRICS, MAX_SERIES, METRIC_BY_KEY, SERIES_COLORS } from './chartMetrics'
import './ChartsPage.css'

type Trend = Record<string, unknown>
type ChartsData = { trends?: ReadonlyArray<Trend> } | null

const STORE_KEY = 'fuel-chart-series'
const DEFAULT_KEYS = ['energyBalance', 'stepCount']

const fmt = (v: number | null, d = 0) => (v == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(v))
const shortDate = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`))

type Series = { key: string; label: string; unit: string; decimals: number; color: string; values: (number | null)[]; min: number; max: number; avg: number }

// Lazy-loaded from App.tsx. Plots any combination of captured daily metrics on one
// time axis. Metrics have wildly different scales (steps ~10,000 vs sleep ~7 h), so
// the default view normalises each series to its own range in the selected window and
// the tooltip always reports real values; "Actual" puts everything on one shared axis.
export default function ChartsPage({ data, nav }: { data: ChartsData; nav: ReactNode }) {
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      if (Array.isArray(raw) && raw.length) return raw.filter((k) => METRIC_BY_KEY.has(k)).slice(0, MAX_SERIES)
    } catch { /* ignore */ }
    return DEFAULT_KEYS
  })
  const [days, setDays] = useState<number>(30)
  const [mode, setMode] = useState<'normalized' | 'actual'>('normalized')
  const [pickerOpen, setPickerOpen] = useState(false)

  // Functional update: toggles must not read `selected` from the closure, or rapid
  // successive clicks before a re-render would each start from the same stale list.
  const toggle = (key: string) => setSelected((prev) => (
    prev.includes(key) ? prev.filter((k) => k !== key) : prev.length < MAX_SERIES ? [...prev, key] : prev
  ))
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(selected)) } catch { /* ignore */ } }, [selected])

  // Memoised so it is referentially stable: `data?.trends || []` would allocate a new
  // array every render and defeat the memos below.
  const allTrends = useMemo(() => data?.trends || [], [data])
  const windowed = useMemo(() => (days >= allTrends.length ? allTrends : allTrends.slice(-days)), [allTrends, days])
  const dates = useMemo(() => windowed.map((t) => String(t.date || '')), [windowed])

  const series: Series[] = useMemo(() => selected.map((key, i) => {
    const def = METRIC_BY_KEY.get(key)!
    const values = windowed.map((t) => { const v = t[key]; return typeof v === 'number' && Number.isFinite(v) ? v : null })
    const present = values.filter((v): v is number => v != null)
    return {
      key, label: def.label, unit: def.unit, decimals: def.decimals,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      values,
      min: present.length ? Math.min(...present) : 0,
      max: present.length ? Math.max(...present) : 0,
      avg: present.length ? present.reduce((a, b) => a + b, 0) / present.length : 0,
    }
  }), [selected, windowed])

  const withData = series.filter((s) => s.values.some((v) => v != null))
  const units = [...new Set(withData.map((s) => s.unit))]
  const rangeOptions = [7, 14, 30, 90].filter((d, i, arr) => d <= allTrends.length || arr[i - 1] < allTrends.length)

  return (
    <main className="app-shell charts-page">
      {nav}
      <div className="charts-head">
        <div>
          <span className="eyebrow">EXPLORE</span>
          <h1>Plot anything over time</h1>
          <p>Overlay any metrics Fuel captures on one time axis.</p>
        </div>
        <div className="charts-controls">
          <div className="seg" role="group" aria-label="Time range">
            {rangeOptions.map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d}d</button>)}
            <button className={days >= 3650 ? 'on' : ''} onClick={() => setDays(3650)}>All</button>
          </div>
          <div className="seg" role="group" aria-label="Scale mode">
            <button className={mode === 'normalized' ? 'on' : ''} onClick={() => setMode('normalized')} title="Each metric scaled to its own range">Relative</button>
            <button className={mode === 'actual' ? 'on' : ''} onClick={() => setMode('actual')} title="All metrics on one shared value axis">Actual</button>
          </div>
        </div>
      </div>

      <section className="panel chart-panel-wrap">
        {withData.length === 0
          ? <div className="charts-empty">{selected.length ? 'No data for the selected metrics in this window.' : 'Pick one or more metrics below to start plotting.'}</div>
          : <MultiLineChart dates={dates} series={withData} mode={mode} />}
        {mode === 'actual' && units.length > 1 && withData.length > 1 && (
          <p className="charts-warn">These metrics use different units ({units.filter(Boolean).join(', ')}) but share one axis. Switch to <b>Relative</b> to compare their shapes fairly.</p>
        )}
        {mode === 'normalized' && withData.length > 0 && (
          <p className="charts-note">Each line is scaled to its own range over this window, so shapes can be compared directly. Hover for real values.</p>
        )}
      </section>

      {withData.length > 0 && (
        <section className="panel legend-panel">
          {withData.map((s) => (
            <div className="legend-row" key={s.key}>
              <span className="legend-chip" style={{ background: s.color }} />
              <span className="legend-label">{s.label}</span>
              <span className="legend-stat"><small>avg</small> {fmt(s.avg, s.decimals)}</span>
              <span className="legend-stat"><small>min</small> {fmt(s.min, s.decimals)}</span>
              <span className="legend-stat"><small>max</small> {fmt(s.max, s.decimals)}</span>
              <span className="legend-unit">{s.unit}</span>
              <button className="legend-remove" onClick={() => toggle(s.key)} aria-label={`Remove ${s.label}`}>×</button>
            </div>
          ))}
        </section>
      )}

      <section className="panel picker-panel">
        <button className="picker-head" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
          <strong>Metrics</strong>
          <span>{selected.length} of {MAX_SERIES} selected{selected.length >= MAX_SERIES ? ' (max)' : ''}</span>
          <span className="picker-toggle">{pickerOpen ? 'Hide' : 'Choose'}</span>
        </button>
        {pickerOpen && CHART_GROUPS.map((group) => (
          <div className="picker-group" key={group}>
            <h3>{group}</h3>
            <div className="picker-chips">
              {CHART_METRICS.filter((m) => m.group === group).map((m) => {
                const on = selected.includes(m.key)
                const full = !on && selected.length >= MAX_SERIES
                return (
                  <button key={m.key} className={`chip${on ? ' on' : ''}`} disabled={full} onClick={() => toggle(m.key)} title={full ? `Remove one first (max ${MAX_SERIES})` : m.label}>
                    {on && <span className="chip-dot" style={{ background: SERIES_COLORS[selected.indexOf(m.key) % SERIES_COLORS.length] }} />}
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>
    </main>
  )
}

function MultiLineChart({ dates, series, mode }: { dates: string[]; series: Series[]; mode: 'normalized' | 'actual' }) {
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const W = 960, H = 380, pad = { l: 58, r: 20, t: 16, b: 34 }
  const n = dates.length
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b
  const x = (i: number) => pad.l + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1))

  // In actual mode every series shares one domain; in relative mode each is scaled to
  // its own min/max so differently-sized metrics can be compared by shape.
  const globalMin = Math.min(...series.map((s) => s.min))
  const globalMax = Math.max(...series.map((s) => s.max))
  const yFor = (s: Series, v: number) => {
    let lo: number, hi: number
    if (mode === 'actual') { lo = globalMin; hi = globalMax } else { lo = s.min; hi = s.max }
    if (hi === lo) return pad.t + plotH / 2
    const pct = (v - lo) / (hi - lo)
    return pad.t + (1 - pct) * plotH
  }

  // Axis ticks: real numbers in actual mode, 0–100% of each metric's range otherwise.
  const ticks = mode === 'actual'
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: pad.t + (1 - f) * plotH, label: fmt(globalMin + f * (globalMax - globalMin), Math.abs(globalMax - globalMin) < 10 ? 1 : 0) }))
    : [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: pad.t + (1 - f) * plotH, label: `${Math.round(f * 100)}%` }))

  // Zero line is meaningful for metrics that go negative (surplus/deficit).
  const showZero = mode === 'actual' && globalMin < 0 && globalMax > 0
  const zeroY = showZero ? pad.t + (1 - (0 - globalMin) / (globalMax - globalMin)) * plotH : null

  const dateTicks = n <= 1 ? [0] : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1].filter((v, i, a) => a.indexOf(v) === i)

  // Split each series into runs of consecutive non-null points so gaps break the line.
  const pathFor = (s: Series) => {
    const runs: string[] = []
    let cur: string[] = []
    s.values.forEach((v, i) => {
      if (v == null) { if (cur.length > 1) runs.push(cur.join(' ')); cur = []; return }
      cur.push(`${cur.length ? 'L' : 'M'} ${x(i).toFixed(1)} ${yFor(s, v).toFixed(1)}`)
    })
    if (cur.length > 1) runs.push(cur.join(' '))
    return runs
  }

  const onMove = (clientX: number) => {
    const el = svgRef.current
    if (!el || n === 0) return
    const box = el.getBoundingClientRect()
    const rel = ((clientX - box.left) / box.width) * W
    const i = Math.round(((rel - pad.l) / (n <= 1 ? 1 : plotW)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <div className="multi-chart">
      <svg
        ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Time chart of ${series.map((s) => s.label).join(', ')}`}
        onMouseMove={(e) => onMove(e.clientX)} onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => onMove(e.touches[0].clientX)} onTouchMove={(e) => onMove(e.touches[0].clientX)}
      >
        <g className="chart-grid">
          {ticks.map((t) => <g key={t.label + t.y}><line x1={pad.l} x2={W - pad.r} y1={t.y} y2={t.y} /><text x={pad.l - 10} y={t.y + 4} textAnchor="end">{t.label}</text></g>)}
        </g>
        {zeroY != null && <line className="chart-zero" x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY} />}
        <g className="chart-dates">
          {dateTicks.map((i) => <text key={i} x={x(i)} y={H - 10} textAnchor="middle">{shortDate(dates[i])}</text>)}
        </g>
        {series.map((s) => pathFor(s).map((d, idx) => (
          <path key={`${s.key}-${idx}`} className="chart-line" d={d} stroke={s.color} />
        )))}
        {hover != null && (
          <g>
            <line className="chart-cursor" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + plotH} />
            {series.map((s) => { const v = s.values[hover]; return v == null ? null : <circle key={s.key} cx={x(hover)} cy={yFor(s, v)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} /> })}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className={`chart-tip${x(hover) > W * 0.6 ? ' flip' : ''}`} style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{dates[hover] ? shortDate(dates[hover]) : ''}</strong>
          {series.map((s) => (
            <div key={s.key}><span className="tip-chip" style={{ background: s.color }} />{s.label}<b>{fmt(s.values[hover], s.decimals)}{s.unit ? ` ${s.unit}` : ''}</b></div>
          ))}
        </div>
      )}
    </div>
  )
}
