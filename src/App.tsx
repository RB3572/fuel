import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  Clock3,
  Database,
  Dumbbell,
  ExternalLink,
  Flame,
  Footprints,
  HeartPulse,
  LogOut,
  Moon,
  RefreshCw,
  Route,
  ShieldCheck,
  Utensils,
} from 'lucide-react'
import './App.css'

type NullableNumber = number | null

type SessionUser = {
  email?: string
  name?: string
  picture?: string
}

type SessionState = {
  loading: boolean
  authenticated: boolean
  user: SessionUser | null
}

type GoalRange = {
  minimum: NullableNumber
  target: NullableNumber
  maximum: NullableNumber
}

type Summary = {
  date: string
  partialDay: boolean
  caloriesConsumed: NullableNumber
  restingEnergy: NullableNumber
  activeEnergy: NullableNumber
  totalExpenditure: NullableNumber
  energyBalance: NullableNumber
  protein: NullableNumber
  carbs: NullableNumber
  fat: NullableNumber
  fiber: NullableNumber
  fuelScore: NullableNumber
  sleepHours: NullableNumber
  sleepQuality: NullableNumber
  recoveryScore: NullableNumber
  restingHeartRate: NullableNumber
  hrv: NullableNumber
  respiratoryRate: NullableNumber
  sleepCoreHours: NullableNumber
  sleepDeepHours: NullableNumber
  sleepRemHours: NullableNumber
  sleepAwakeHours: NullableNumber
  stepCount: NullableNumber
  distanceMiles: NullableNumber
  exerciseMinutes: NullableNumber
  vo2Max: NullableNumber
}

type FoodEntry = {
  time: string
  meal: string
  food: string
  portion: string
  calories: NullableNumber
  protein: NullableNumber
  carbs: NullableNumber
  fat: NullableNumber
  fiber: NullableNumber
  confidence: string
  notes: string
  source: string
}

type WorkoutEntry = {
  time: string
  activity: string
  durationMinutes: NullableNumber
  activeCalories: NullableNumber
  totalCalories: NullableNumber
  distanceMiles: NullableNumber
  averagePace: string
  averageHeartRate: NullableNumber
  averageCadence: NullableNumber
  effort: string
  location: string
  swimmingDistanceYards: NullableNumber
  stepCount: NullableNumber
  strokeCount: NullableNumber
  dataQuality: string
  notes: string
  source: string
}

type SupplementEntry = {
  time: string
  name: string
  dose: string
  calories: NullableNumber
  notes: string
}

type TrendPoint = {
  date: string
  partialDay: boolean
  caloriesConsumed: NullableNumber
  restingEnergy: NullableNumber
  activeEnergy: NullableNumber
  totalExpenditure: NullableNumber
  energyBalance: NullableNumber
  protein: NullableNumber
  carbs: NullableNumber
  fat: NullableNumber
  sleepHours: NullableNumber
  restingHeartRate: NullableNumber
  hrv: NullableNumber
  stepCount: NullableNumber
  distanceMiles: NullableNumber
  exerciseMinutes: NullableNumber
  vo2Max: NullableNumber
  workoutCount: number
  fuelScore: NullableNumber
}

type Coverage = {
  startDate: string | null
  endDate: string | null
  days: number
  healthDays: number
  foodEntries: number
  workouts: number
  recoveryDays: number
}

type DashboardData = {
  spreadsheet: {
    id: string
    name: string
    webViewLink?: string
    modifiedTime?: string
  }
  generatedAt: string
  today: {
    summary: Summary
    foodEntries: FoodEntry[]
    workouts: WorkoutEntry[]
    supplements: SupplementEntry[]
  }
  goals: Partial<Record<'protein' | 'calorieDeficit' | 'fat' | 'sleepHours' | 'fuelScore' | 'strengthSessions', GoalRange>>
  trends: TrendPoint[]
  coverage: Coverage
  sheetStatus: Array<{
    title: string
    rows: number
  }>
}

const notLogged = 'Not logged'

function App() {
  const [session, setSession] = useState<SessionState>({
    loading: true,
    authenticated: false,
    user: null,
  })
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [busyAuthAction, setBusyAuthAction] = useState(false)

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoadingDashboard(true)
    setError('')

    try {
      const response = await fetch('/api/mlog', { headers: { Accept: 'application/json' } })

      if (response.status === 401) {
        setSession({ loading: false, authenticated: false, user: null })
        setDashboard(null)
        return
      }

      const payload = (await response.json()) as DashboardData | { error?: string }
      if (!response.ok) {
        throw new Error('error' in payload && payload.error ? payload.error : 'Unable to load MLog')
      }

      setDashboard(payload as DashboardData)
      setLastRefresh(new Date())
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : 'Unable to load MLog')
    } finally {
      setLoadingDashboard(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSession() {
      try {
        const response = await fetch('/api/auth/session', { headers: { Accept: 'application/json' } })
        const payload = (await response.json()) as { authenticated: boolean; user?: SessionUser | null }

        if (!cancelled) {
          setSession({
            loading: false,
            authenticated: payload.authenticated,
            user: payload.user || null,
          })
        }
      } catch {
        if (!cancelled) setSession({ loading: false, authenticated: false, user: null })
      }
    }

    void loadSession()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!session.authenticated) return undefined

    void loadDashboard()
    const interval = window.setInterval(() => void loadDashboard(true), 60_000)
    const handleFocus = () => void loadDashboard(true)
    window.addEventListener('focus', handleFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [loadDashboard, session.authenticated])

  async function signOut(disconnect = false) {
    setBusyAuthAction(true)
    try {
      await fetch(disconnect ? '/api/auth/disconnect' : '/api/auth/logout', { method: 'POST' })
    } finally {
      setBusyAuthAction(false)
      setSession({ loading: false, authenticated: false, user: null })
      setDashboard(null)
      setLastRefresh(null)
    }
  }

  if (session.loading) return <LoadingScreen />
  if (!session.authenticated) return <SignInScreen error={readAuthError()} />

  const summary = dashboard?.today.summary
  const goals = dashboard?.goals

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">F</div>
          <div>
            <h1>Fuel</h1>
            <p>{formatLongDate(summary?.date || formatDateKey(new Date()))}</p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="identity">
            {session.user?.picture ? (
              <img src={session.user.picture} alt="" className="avatar" referrerPolicy="no-referrer" />
            ) : null}
            <div>
              <strong>{session.user?.name || 'Signed in'}</strong>
              <span>{session.user?.email || 'Google Drive connected'}</span>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loadingDashboard}
            aria-label="Refresh dashboard"
            title="Refresh dashboard"
          >
            <RefreshCw size={18} className={loadingDashboard ? 'spin' : ''} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => void signOut(false)}
            disabled={busyAuthAction}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="status-line">
        <span className={summary?.partialDay ? 'status-badge live' : 'status-badge'}>
          <span className="status-dot" />
          {summary?.partialDay ? 'Day in progress' : 'Day complete'}
        </span>
        <span>{lastRefresh ? `Updated ${formatTime(lastRefresh)}` : 'Loading MLog'}</span>
        {dashboard?.spreadsheet.webViewLink ? (
          <a href={dashboard.spreadsheet.webViewLink} target="_blank" rel="noreferrer">
            Open MLog <ExternalLink size={13} />
          </a>
        ) : null}
      </div>

      <section className="overview-grid" aria-label="Today overview">
        <OverviewPanel title="Energy" icon={<Flame size={19} />}>
          <div className="primary-pair">
            <BigMetric label="Consumed" value={summary?.caloriesConsumed} unit="kcal" />
            <BigMetric
              label={summary?.partialDay ? 'Burned so far' : 'Expenditure'}
              value={summary?.totalExpenditure}
              unit="kcal"
            />
          </div>
          <div className="panel-rule" />
          <div className="inline-stats">
            <InlineStat label="Resting" value={summary?.restingEnergy} unit="kcal" />
            <InlineStat label="Active" value={summary?.activeEnergy} unit="kcal" />
            <InlineStat
              label="Balance"
              value={summary?.partialDay ? null : summary?.energyBalance}
              unit={summary?.partialDay ? '' : 'kcal'}
              signed={!summary?.partialDay}
              fallback={summary?.partialDay ? 'In progress' : undefined}
            />
          </div>
        </OverviewPanel>

        <OverviewPanel title="Nutrition" icon={<Utensils size={19} />}>
          <ProgressMetric
            label="Protein"
            value={summary?.protein}
            target={goals?.protein?.target}
            unit="g"
          />
          <div className="nutrition-stats">
            <InlineStat label="Carbs" value={summary?.carbs} unit="g" />
            <InlineStat label="Fat" value={summary?.fat} unit="g" />
            <InlineStat label="Fiber" value={summary?.fiber} unit="g" />
          </div>
        </OverviewPanel>

        <OverviewPanel title="Activity" icon={<Footprints size={19} />}>
          <div className="metric-matrix">
            <SmallMetric icon={<Footprints size={16} />} label="Steps" value={summary?.stepCount} />
            <SmallMetric icon={<Route size={16} />} label="Distance" value={summary?.distanceMiles} unit="mi" />
            <SmallMetric icon={<Clock3 size={16} />} label="Exercise" value={summary?.exerciseMinutes} unit="min" />
            <SmallMetric icon={<Activity size={16} />} label="Active energy" value={summary?.activeEnergy} unit="kcal" />
          </div>
        </OverviewPanel>

        <OverviewPanel title="Recovery" icon={<HeartPulse size={19} />}>
          <div className="metric-matrix">
            <SmallMetric icon={<Moon size={16} />} label="Sleep" value={summary?.sleepHours} unit="h" duration />
            <SmallMetric icon={<HeartPulse size={16} />} label="Resting HR" value={summary?.restingHeartRate} unit="bpm" />
            <SmallMetric icon={<Activity size={16} />} label="HRV" value={summary?.hrv} unit="ms" />
            <SmallMetric icon={<Activity size={16} />} label="Respiratory" value={summary?.respiratoryRate} unit="/min" />
          </div>
          {summary?.sleepHours !== null && summary?.sleepHours !== undefined ? (
            <SleepStages summary={summary} />
          ) : null}
        </OverviewPanel>
      </section>

      <SectionHeading title="Today" detail="Meals, supplements, and training" />
      <section className="today-grid">
        <section className="panel log-panel">
          <PanelHeading
            title="Food"
            detail={`${dashboard?.today.foodEntries.length || 0} entries`}
            icon={<Utensils size={18} />}
          />
          <EntryList empty="No food logged today.">
            {(dashboard?.today.foodEntries || []).map((entry, index) => (
              <FoodRow key={`${entry.time}-${entry.food}-${index}`} entry={entry} />
            ))}
          </EntryList>
          {(dashboard?.today.supplements.length || 0) > 0 ? (
            <div className="supplement-strip">
              <span>Supplements</span>
              {(dashboard?.today.supplements || []).map((entry, index) => (
                <strong key={`${entry.name}-${index}`}>{[entry.name, entry.dose].filter(Boolean).join(' · ')}</strong>
              ))}
            </div>
          ) : null}
        </section>

        <section className="panel log-panel">
          <PanelHeading
            title="Workouts"
            detail={`${dashboard?.today.workouts.length || 0} sessions`}
            icon={<Dumbbell size={18} />}
          />
          <EntryList empty="No workouts logged today.">
            {(dashboard?.today.workouts || []).map((entry, index) => (
              <WorkoutRow key={`${entry.time}-${entry.activity}-${index}`} entry={entry} />
            ))}
          </EntryList>
        </section>
      </section>

      <SectionHeading title="Trends" detail="Last 30 days from Apple Health and MLog" />
      <section className="trend-grid">
        <section className="panel energy-chart-panel">
          <PanelHeading title="Energy" detail="Consumed and expended" icon={<Flame size={18} />} />
          <EnergyChart data={dashboard?.trends || []} />
        </section>

        <section className="panel trend-panel">
          <PanelHeading title="Steps" detail="Daily movement" icon={<Footprints size={18} />} />
          <LineChart data={dashboard?.trends || []} metric="stepCount" unit="steps" />
        </section>

        <section className="panel trend-panel">
          <PanelHeading title="Sleep" detail="Hours per night" icon={<Moon size={18} />} />
          <LineChart data={dashboard?.trends || []} metric="sleepHours" unit="h" duration />
        </section>

        <section className="panel trend-panel">
          <PanelHeading title="Resting heart rate" detail="Daily average" icon={<HeartPulse size={18} />} />
          <LineChart data={dashboard?.trends || []} metric="restingHeartRate" unit="bpm" />
        </section>
      </section>

      <footer className="sheet-footer">
        <div>
          <Database size={15} />
          <span>
            {dashboard?.coverage.days || 0} days · {dashboard?.coverage.workouts || 0} workouts · {dashboard?.coverage.foodEntries || 0} food entries
          </span>
        </div>
        <button type="button" className="text-button" onClick={() => void signOut(true)} disabled={busyAuthAction}>
          Disconnect Google Drive
        </button>
      </footer>
    </main>
  )
}

function OverviewPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="panel overview-panel">
      <PanelHeading title={title} icon={icon} />
      {children}
    </section>
  )
}

function PanelHeading({ title, detail, icon }: { title: string; detail?: string; icon: ReactNode }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      <span>{icon}</span>
    </div>
  )
}

function BigMetric({ label, value, unit }: { label: string; value: NullableNumber | undefined; unit: string }) {
  return (
    <div className="big-metric">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
      <small>{value == null ? '' : unit}</small>
    </div>
  )
}

function InlineStat({
  label,
  value,
  unit,
  signed = false,
  fallback,
}: {
  label: string
  value: NullableNumber | undefined
  unit: string
  signed?: boolean
  fallback?: string
}) {
  return (
    <div className="inline-stat">
      <span>{label}</span>
      <strong>{value == null && fallback ? fallback : signed ? formatSignedNumber(value) : formatNumber(value)}</strong>
      {unit ? <small>{unit}</small> : null}
    </div>
  )
}

function SmallMetric({
  icon,
  label,
  value,
  unit = '',
  duration = false,
}: {
  icon: ReactNode
  label: string
  value: NullableNumber | undefined
  unit?: string
  duration?: boolean
}) {
  return (
    <div className="small-metric">
      <span className="small-metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{duration ? formatDuration(value) : formatNumber(value)}</strong>
        {value == null || duration ? null : <small>{unit}</small>}
      </div>
    </div>
  )
}

function ProgressMetric({
  label,
  value,
  target,
  unit,
}: {
  label: string
  value: NullableNumber | undefined
  target: NullableNumber | undefined
  unit: string
}) {
  const percentage = value != null && target ? Math.min(100, Math.max(0, (value / target) * 100)) : 0

  return (
    <div className="progress-metric">
      <div>
        <span>{label}</span>
        <strong>{formatNumber(value)}{value == null ? '' : ` ${unit}`}</strong>
      </div>
      <div className="progress-track" aria-label={`${label} progress`}>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <small>{target ? `Target ${formatNumber(target)} ${unit}` : 'Target not logged'}</small>
    </div>
  )
}

function SleepStages({ summary }: { summary: Summary }) {
  const stages = [
    ['Core', summary.sleepCoreHours],
    ['Deep', summary.sleepDeepHours],
    ['REM', summary.sleepRemHours],
  ] as const
  const knownTotal = stages.reduce((total, [, value]) => total + (value || 0), 0)

  if (!knownTotal) return null

  return (
    <div className="sleep-stages" aria-label="Sleep stages">
      {stages.map(([label, value]) => (
        <span key={label} style={{ flexGrow: value || 0 }} title={`${label}: ${formatDuration(value)}`}>
          <i />
          {label} {formatDuration(value)}
        </span>
      ))}
    </div>
  )
}

function EntryList({ children, empty }: { children: ReactNode; empty: string }) {
  const childArray = useMemo(() => (Array.isArray(children) ? children : [children]), [children])
  if (childArray.length === 0) return <div className="empty-state">{empty}</div>
  return <div className="entry-list">{children}</div>
}

function FoodRow({ entry }: { entry: FoodEntry }) {
  const details = [entry.time, entry.meal, entry.portion].filter(Boolean).join(' · ')

  return (
    <article className="entry-row">
      <div className="entry-copy">
        <strong>{entry.food || entry.meal || 'Food entry'}</strong>
        <span>{details || 'No details logged'}</span>
      </div>
      <div className="entry-values">
        <strong>{formatNumber(entry.calories)} <small>kcal</small></strong>
        <span>{formatNumber(entry.protein)} g protein</span>
      </div>
    </article>
  )
}

function WorkoutRow({ entry }: { entry: WorkoutEntry }) {
  const distance = entry.swimmingDistanceYards != null
    ? `${formatNumber(entry.swimmingDistanceYards)} yd`
    : entry.distanceMiles != null
      ? `${formatNumber(entry.distanceMiles)} mi`
      : ''
  const details = [entry.time, formatMinutes(entry.durationMinutes), distance, entry.averagePace, entry.location]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="entry-row">
      <div className="entry-copy">
        <strong>{entry.activity || 'Workout'}</strong>
        <span>{details || 'No details logged'}</span>
      </div>
      <div className="entry-values">
        <strong>{formatNumber(entry.activeCalories)} <small>active kcal</small></strong>
        <span>{entry.averageHeartRate == null ? entry.effort || entry.dataQuality : `${formatNumber(entry.averageHeartRate)} bpm avg`}</span>
      </div>
    </article>
  )
}

function EnergyChart({ data }: { data: TrendPoint[] }) {
  const visible = data.slice(-14)
  const max = Math.max(...visible.flatMap((point) => [point.caloriesConsumed || 0, point.totalExpenditure || 0]), 1)
  const hasConsumption = visible.some((point) => point.caloriesConsumed != null)

  return (
    <div className="energy-chart">
      <div className="chart-legend">
        <span><i className="legend-consumed" /> Consumed</span>
        <span><i className="legend-expended" /> Expended</span>
      </div>
      <div className="energy-bars">
        {visible.map((point, index) => (
          <div className={`energy-day ${point.partialDay ? 'partial' : ''}`} key={point.date}>
            <div className="bar-pair">
              <span
                className={`bar consumed ${point.caloriesConsumed == null ? 'missing' : ''}`}
                style={{ height: `${barHeight(point.caloriesConsumed, max)}%` }}
                title={`${formatShortDate(point.date)} consumed: ${formatNumber(point.caloriesConsumed)} kcal`}
              />
              <span
                className={`bar expended ${point.totalExpenditure == null ? 'missing' : ''}`}
                style={{ height: `${barHeight(point.totalExpenditure, max)}%` }}
                title={`${formatShortDate(point.date)} expended: ${formatNumber(point.totalExpenditure)} kcal`}
              />
            </div>
            <small>{index % 2 === 0 || index === visible.length - 1 ? formatTinyDate(point.date) : ''}</small>
          </div>
        ))}
      </div>
      {!hasConsumption ? <p className="chart-note">Energy expenditure is available; food intake has not been logged for this period.</p> : null}
    </div>
  )
}

function LineChart({
  data,
  metric,
  unit,
  duration = false,
}: {
  data: TrendPoint[]
  metric: keyof TrendPoint
  unit: string
  duration?: boolean
}) {
  const points = data
    .map((point, index) => ({
      date: point.date,
      index,
      value: typeof point[metric] === 'number' ? point[metric] as number : null,
    }))
    .filter((point): point is { date: string; index: number; value: number } => point.value !== null)

  if (points.length < 2) return <div className="empty-state chart-empty">Insufficient data</div>

  const max = Math.max(...points.map((point) => point.value))
  const min = Math.min(...points.map((point) => point.value))
  const padding = Math.max((max - min) * 0.12, max * 0.03, 1)
  const plotMin = Math.max(0, min - padding)
  const plotMax = max + padding
  const range = plotMax - plotMin || 1
  const width = 480
  const height = 150
  const plotPoints = points.map((point) => ({
    ...point,
    x: data.length === 1 ? 0 : (point.index / (data.length - 1)) * width,
    y: height - ((point.value - plotMin) / range) * height,
  }))
  const average = points.reduce((sum, point) => sum + point.value, 0) / points.length
  const latest = points.at(-1)?.value ?? null

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${String(metric)} trend`}>
        <line x1="0" y1={height} x2={width} y2={height} className="chart-axis" />
        <polyline
          points={plotPoints.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {plotPoints.map((point) => (
          <circle key={`${point.date}-${point.value}`} cx={point.x} cy={point.y} r="3" />
        ))}
      </svg>
      <div className="chart-summary">
        <div>
          <span>Latest</span>
          <strong>{duration ? formatDuration(latest) : `${formatNumber(latest)}${latest == null ? '' : ` ${unit}`}`}</strong>
        </div>
        <div>
          <span>30-day average</span>
          <strong>{duration ? formatDuration(average) : `${formatNumber(average)} ${unit}`}</strong>
        </div>
      </div>
    </div>
  )
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  )
}

function LoadingScreen() {
  return (
    <main className="center-screen">
      <div className="loader-card">
        <RefreshCw size={25} className="spin" />
        <h1>Fuel</h1>
        <p>Loading your MLog dashboard.</p>
      </div>
    </main>
  )
}

function SignInScreen({ error }: { error: string }) {
  return (
    <main className="center-screen">
      <section className="signin-panel">
        <div className="brand-mark signin-mark">F</div>
        <h1>Fuel</h1>
        <p>A private, read-only view of nutrition, activity, and recovery data stored in MLog.</p>
        {error ? <div className="error-banner compact">{error}</div> : null}
        <button className="primary-action" type="button" onClick={() => window.location.assign('/api/auth/google/start')}>
          <ShieldCheck size={18} />
          Connect Google Drive
        </button>
      </section>
    </main>
  )
}

function formatNumber(value: NullableNumber | undefined, decimals?: number) {
  if (value == null) return notLogged
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: decimals ?? (Number.isInteger(value) ? 0 : 1),
  }).format(value)
}

function formatSignedNumber(value: NullableNumber | undefined) {
  if (value == null) return notLogged
  if (value > 0) return `+${formatNumber(value)}`
  return formatNumber(value)
}

function formatDuration(value: NullableNumber | undefined) {
  if (value == null) return notLogged
  const totalMinutes = Math.round(value * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function formatMinutes(value: NullableNumber | undefined) {
  if (value == null) return ''
  const rounded = Math.round(value)
  return `${rounded} min`
}

function barHeight(value: NullableNumber, max: number) {
  if (value == null) return 2
  return Math.max(5, (value / max) * 100)
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(parseDateKey(value))
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parseDateKey(value))
}

function formatTinyDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(parseDateKey(value))
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(value)
}

function readAuthError() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('auth_error')
  if (!code) return ''
  if (code === 'access_denied') return 'Google Drive access was not granted.'
  if (code === 'state_mismatch') return 'The sign-in session expired. Please try again.'
  return 'Unable to connect Google Drive. Please try again.'
}

export default App
