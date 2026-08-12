import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { AGE_BANDS, METRICS, ageBandIndex, refFor, standing } from './compareReference'
import type { MetricDef, Ref, Sex } from './compareReference'
import './ComparePage.css'

type CompareData = {
  trends?: ReadonlyArray<Record<string, unknown>>
  energyAverages?: { totalExpenditure?: number | null; restingEnergy?: number | null; activeEnergy?: number | null } | null
  goalProfile?: { age?: number | null } | null
} | null

const fmt = (v: number | null, d = 0) => (v == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(v))

// Lazy-loaded from App.tsx. Compares the user's own 30-day averages against published
// population norms for their age band. All reference data lives in compareReference.ts.
export default function ComparePage({ data, nav }: { data: CompareData; nav: ReactNode }) {
  const profileAge = data?.goalProfile?.age ?? null
  const [manualBand, setManualBand] = useState<number>(() => Math.max(0, ageBandIndex(profileAge)))
  const [sex, setSex] = useState<Sex>(() => (typeof localStorage !== 'undefined' && localStorage.getItem('fuel-compare-sex') === 'f' ? 'f' : 'm'))
  const setSexPersist = (s: Sex) => { setSex(s); try { localStorage.setItem('fuel-compare-sex', s) } catch { /* ignore */ } }

  const bandIdx = profileAge != null ? ageBandIndex(profileAge) : manualBand

  // User's own averages over the synced history window.
  const userValues = useMemo(() => {
    const trends = data?.trends || []
    const avg = (key: string) => {
      const vals = trends.map((t) => t[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    return {
      caloriesConsumed: avg('caloriesConsumed'),
      totalExpenditure: data?.energyAverages?.totalExpenditure ?? avg('totalExpenditure'),
      restingEnergy: data?.energyAverages?.restingEnergy ?? avg('restingEnergy'),
      restingHeartRate: avg('restingHeartRate'),
      hrv: avg('hrv'),
      respiratoryRate: avg('respiratoryRate'),
      bloodOxygen: avg('bloodOxygen'),
      cardioRecovery: avg('cardioRecovery'),
      vo2Max: avg('vo2Max'),
      stepCount: avg('stepCount'),
      sleepHours: avg('sleepHours'),
    } as Record<string, number | null>
  }, [data])

  const groups = ['Energy', 'Cardiovascular', 'Fitness', 'Activity & sleep'] as const

  return (
    <main className="app-shell compare-page">
      {nav}
      <div className="compare-head">
        <div>
          <span className="eyebrow">COMPARE</span>
          <h1>How you compare</h1>
          <p>Your recent averages next to published norms for {profileAge != null ? `${profileAge}-year-olds` : `the ${AGE_BANDS[bandIdx]} age group`}.</p>
        </div>
        <div className="compare-controls">
          <div className="seg" role="group" aria-label="Sex for reference values">
            <button className={sex === 'm' ? 'on' : ''} onClick={() => setSexPersist('m')}>Male</button>
            <button className={sex === 'f' ? 'on' : ''} onClick={() => setSexPersist('f')}>Female</button>
          </div>
          {profileAge == null && (
            <label className="age-select">Age group
              <select value={manualBand} onChange={(e) => setManualBand(Number(e.target.value))}>
                {AGE_BANDS.map((b, i) => <option key={b} value={i}>{b}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {profileAge == null && <div className="compare-note-banner"><Info size={15} /><span>Add your age in Goals for an exact age-group match. Showing the {AGE_BANDS[bandIdx]} band for now.</span></div>}

      {groups.map((group) => {
        const metrics = METRICS.filter((m) => m.group === group)
        return (
          <section className="compare-group panel" key={group}>
            <h2>{group}</h2>
            {metrics.map((m) => <CompareRow key={m.key} metric={m} value={userValues[m.key]} ref={refFor(m, bandIdx, sex)} />)}
          </section>
        )
      })}

      <details className="compare-sources panel">
        <summary>Data sources & method</summary>
        <p className="method">For each metric we estimate your percentile by modelling the reference band as a normal distribution (median = typical value, spread from the 25th–75th percentile range). Your value is a {(data?.trends || []).length}-day average of your synced data. This is a wellness comparison, not a medical assessment — healthy individuals vary, and wearable measurements differ from clinical ones.</p>
        <ul>
          {[...new Set(METRICS.map((m) => m.source))].map((s) => <li key={s}>{s}</li>)}
        </ul>
      </details>
    </main>
  )
}

function CompareRow({ metric, value, ref }: { metric: MetricDef; value: number | null; ref: Ref | null }) {
  if (value == null || ref == null) {
    return (
      <div className="compare-row is-empty">
        <div className="cr-label"><strong>{metric.label}</strong><span>{metric.unit}</span></div>
        <div className="cr-empty">{value == null ? 'No synced data yet' : 'No age-group reference'}</div>
      </div>
    )
  }
  const st = standing(value, ref, metric.better)
  // Display domain that comfortably contains the band and the user's marker.
  const iqr = Math.max(1e-6, ref.p75 - ref.p25)
  const dMin = Math.min(ref.p25, value) - iqr * 0.9
  const dMax = Math.max(ref.p75, value) + iqr * 0.9
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - dMin) / (dMax - dMin)) * 100))}%`
  return (
    <div className="compare-row">
      <div className="cr-top">
        <div className="cr-label"><strong>{metric.label}</strong><span>{metric.unit}</span></div>
        <div className={`cr-standing tone-${st.tone}`}><b>{fmt(value, metric.decimals)}</b><span>{ordinal(st.pct)} pct · {st.label}</span></div>
      </div>
      <div className="cr-track">
        <span className="cr-band" style={{ left: pos(ref.p25), width: `calc(${pos(ref.p75)} - ${pos(ref.p25)})` }} />
        <span className="cr-median" style={{ left: pos(ref.p50) }} title={`Typical: ${fmt(ref.p50, metric.decimals)} ${metric.unit}`} />
        <span className={`cr-you tone-${st.tone}`} style={{ left: pos(value) }} />
      </div>
      <div className="cr-scale"><span>Typical {fmt(ref.p50, metric.decimals)} ({fmt(ref.p25, metric.decimals)}–{fmt(ref.p75, metric.decimals)})</span>{metric.note && <span className="cr-mnote">{metric.note}</span>}</div>
    </div>
  )
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
