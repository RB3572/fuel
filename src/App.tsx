import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Beef,
  CalendarDays,
  Database,
  Dumbbell,
  Flame,
  Gauge,
  LogOut,
  Moon,
  RefreshCw,
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

type Summary = {
  date: string
  caloriesConsumed: NullableNumber
  restingEnergy: NullableNumber
  activeEnergy: NullableNumber
  totalExpenditure: NullableNumber
  energyBalance: NullableNumber
  protein: NullableNumber
  carbs: NullableNumber
  fat: NullableNumber
  fuelScore: NullableNumber
  sleepHours: NullableNumber
  recoveryScore: NullableNumber
  restingHeartRate: NullableNumber
  hrv: NullableNumber
}

type FoodEntry = {
  time: string
  meal: string
  food: string
  calories: NullableNumber
  protein: NullableNumber
  carbs: NullableNumber
  fat: NullableNumber
  notes: string
}

type WorkoutEntry = {
  time: string
  activity: string
  durationMinutes: NullableNumber
  activeCalories: NullableNumber
  trainingLoad: NullableNumber
  intensity: string
  notes: string
}

type TrendPoint = {
  date: string
  caloriesConsumed: NullableNumber
  totalExpenditure: NullableNumber
  energyBalance: NullableNumber
  protein: NullableNumber
  sleepHours: NullableNumber
  trainingLoad: NullableNumber
  fuelScore: NullableNumber
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
  }
  goals: Partial<Record<'protein' | 'calories' | 'carbs' | 'fat' | 'sleepHours' | 'fuelScore', number>>
  trends: TrendPoint[]
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
    if (!silent) {
      setLoadingDashboard(true)
    }

    setError('')

    try {
      const response = await fetch('/api/mlog', {
        headers: { Accept: 'application/json' },
      })

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
        const response = await fetch('/api/auth/session', {
          headers: { Accept: 'application/json' },
        })
        const payload = (await response.json()) as {
          authenticated: boolean
          user?: SessionUser | null
        }

        if (!cancelled) {
          setSession({
            loading: false,
            authenticated: payload.authenticated,
            user: payload.user || null,
          })
        }
      } catch {
        if (!cancelled) {
          setSession({ loading: false, authenticated: false, user: null })
        }
      }
    }

    void loadSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!session.authenticated) {
      return undefined
    }

    void loadDashboard()

    const interval = window.setInterval(() => {
      void loadDashboard(true)
    }, 60_000)

    function handleFocus() {
      void loadDashboard(true)
    }

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

  if (session.loading) {
    return <LoadingScreen />
  }

  if (!session.authenticated) {
    return <SignInScreen error={readAuthError()} />
  }

  const summary = dashboard?.today.summary

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark">Fuel</span>
          <div>
            <h1>Athlete dashboard</h1>
            <p>{formatLongDate(new Date())}</p>
          </div>
        </div>

        <div className="topbar-actions">
          {session.user?.picture ? (
            <img src={session.user.picture} alt="" className="avatar" referrerPolicy="no-referrer" />
          ) : null}
          <div className="identity">
            <strong>{session.user?.name || 'Signed in'}</strong>
            <span>{session.user?.email || 'Google Drive connected'}</span>
          </div>
          <button className="icon-action" type="button" onClick={() => void loadDashboard()} disabled={loadingDashboard}>
            <RefreshCw size={17} className={loadingDashboard ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
          <button className="icon-only" type="button" onClick={() => void signOut(false)} disabled={busyAuthAction} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="dashboard-grid" aria-label="Fuel dashboard">
        <section className="panel hero-panel">
          <div className="panel-heading">
            <div>
              <h2>Training Fuel Score</h2>
              <p>Live from MLog</p>
            </div>
            <Gauge size={22} />
          </div>
          <div className="fuel-score">
            <strong>{formatNumber(summary?.fuelScore, { decimals: 0 })}</strong>
            <span>{summary?.fuelScore === null || summary?.fuelScore === undefined ? notLogged : 'readiness and fueling'}</span>
          </div>
          <ProgressRow
            label="Fuel score goal"
            value={summary?.fuelScore ?? null}
            target={dashboard?.goals.fuelScore ?? 100}
            unit=""
          />
          <div className="connection-card">
            <ShieldCheck size={18} />
            <div>
              <strong>Secure Drive session</strong>
              <span>Tokens stay encrypted in HTTP-only session storage.</span>
            </div>
          </div>
          <button className="link-danger" type="button" onClick={() => void signOut(true)} disabled={busyAuthAction}>
            Disconnect Google Drive
          </button>
        </section>

        <section className="panel metrics-panel">
          <div className="panel-heading">
            <div>
              <h2>Today</h2>
              <p>{summary?.date || formatDateKey(new Date())}</p>
            </div>
            <CalendarDays size={22} />
          </div>
          <div className="metric-grid">
            <MetricCard icon={<Utensils size={18} />} label="Calories consumed" value={summary?.caloriesConsumed ?? null} unit="cal" />
            <MetricCard icon={<Flame size={18} />} label="Resting energy" value={summary?.restingEnergy ?? null} unit="cal" />
            <MetricCard icon={<Activity size={18} />} label="Active energy" value={summary?.activeEnergy ?? null} unit="cal" />
            <MetricCard icon={<Gauge size={18} />} label="Total expenditure" value={summary?.totalExpenditure ?? null} unit="cal" />
            <MetricCard
              icon={balanceIcon(summary?.energyBalance)}
              label={balanceLabel(summary?.energyBalance)}
              value={summary?.energyBalance ?? null}
              unit="cal"
              tone={balanceTone(summary?.energyBalance)}
              signed
            />
            <MetricCard icon={<Beef size={18} />} label="Protein" value={summary?.protein ?? null} unit="g" />
          </div>
        </section>

        <section className="panel nutrition-panel">
          <div className="panel-heading">
            <div>
              <h2>Macros</h2>
              <p>Daily progress</p>
            </div>
            <Beef size={22} />
          </div>
          <div className="progress-stack">
            <ProgressRow label="Protein" value={summary?.protein ?? null} target={dashboard?.goals.protein ?? null} unit="g" />
            <ProgressRow label="Carbs" value={summary?.carbs ?? null} target={dashboard?.goals.carbs ?? null} unit="g" />
            <ProgressRow label="Fat" value={summary?.fat ?? null} target={dashboard?.goals.fat ?? null} unit="g" />
            <ProgressRow label="Sleep" value={summary?.sleepHours ?? null} target={dashboard?.goals.sleepHours ?? null} unit="h" />
          </div>
        </section>

        <section className="panel chart-panel wide-panel">
          <div className="panel-heading">
            <div>
              <h2>Energy balance</h2>
              <p>Consumed vs expenditure</p>
            </div>
            <Flame size={22} />
          </div>
          <DualBarChart data={dashboard?.trends || []} />
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Protein</h2>
              <p>Last 21 days</p>
            </div>
            <Beef size={22} />
          </div>
          <LineChart data={dashboard?.trends || []} metric="protein" unit="g" />
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Sleep</h2>
              <p>Recovery trend</p>
            </div>
            <Moon size={22} />
          </div>
          <LineChart data={dashboard?.trends || []} metric="sleepHours" unit="h" />
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Training load</h2>
              <p>Workout activity</p>
            </div>
            <Dumbbell size={22} />
          </div>
          <LineChart data={dashboard?.trends || []} metric="trainingLoad" unit="" />
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Fuel Score</h2>
              <p>Readiness history</p>
            </div>
            <Gauge size={22} />
          </div>
          <LineChart data={dashboard?.trends || []} metric="fuelScore" unit="" />
        </section>

        <section className="panel list-panel wide-panel">
          <div className="panel-heading">
            <div>
              <h2>Food log</h2>
              <p>{dashboard?.today.foodEntries.length || 0} entries today</p>
            </div>
            <Utensils size={22} />
          </div>
          <EntryList
            empty="No food logged today."
            items={dashboard?.today.foodEntries || []}
            render={(entry) => (
              <FoodRow key={`${entry.time}-${entry.meal}-${entry.food}`} entry={entry} />
            )}
          />
        </section>

        <section className="panel list-panel">
          <div className="panel-heading">
            <div>
              <h2>Workouts</h2>
              <p>{dashboard?.today.workouts.length || 0} sessions today</p>
            </div>
            <Dumbbell size={22} />
          </div>
          <EntryList
            empty="No workouts logged today."
            items={dashboard?.today.workouts || []}
            render={(entry) => (
              <WorkoutRow key={`${entry.time}-${entry.activity}-${entry.durationMinutes}`} entry={entry} />
            )}
          />
        </section>

        <section className="panel recovery-panel">
          <div className="panel-heading">
            <div>
              <h2>Recovery</h2>
              <p>Sleep and strain</p>
            </div>
            <Moon size={22} />
          </div>
          <div className="mini-metrics">
            <MetricCard icon={<Moon size={17} />} label="Sleep" value={summary?.sleepHours ?? null} unit="h" />
            <MetricCard icon={<Activity size={17} />} label="Recovery" value={summary?.recoveryScore ?? null} unit="%" />
            <MetricCard icon={<Gauge size={17} />} label="Resting HR" value={summary?.restingHeartRate ?? null} unit="bpm" />
            <MetricCard icon={<Activity size={17} />} label="HRV" value={summary?.hrv ?? null} unit="ms" />
          </div>
        </section>
      </section>

      <footer className="sheet-footer">
        <Database size={16} />
        <span>
          {dashboard?.spreadsheet.webViewLink ? (
            <a href={dashboard.spreadsheet.webViewLink} target="_blank" rel="noreferrer">
              {dashboard.spreadsheet.name}
            </a>
          ) : (
            dashboard?.spreadsheet.name || 'MLog'
          )}
        </span>
        <span>{lastRefresh ? `Refreshed ${formatTime(lastRefresh)}` : 'Waiting for MLog'}</span>
        <span>{loadingDashboard ? 'Syncing...' : 'Auto-refreshes every 60 seconds'}</span>
      </footer>
    </main>
  )
}

function LoadingScreen() {
  return (
    <main className="center-screen">
      <div className="loader-card">
        <RefreshCw size={28} className="spin" />
        <h1>Fuel</h1>
        <p>Checking your secure Google Drive session.</p>
      </div>
    </main>
  )
}

function SignInScreen({ error }: { error: string }) {
  return (
    <main className="center-screen">
      <section className="signin-panel">
        <span className="brand-mark">Fuel</span>
        <h1>Personal athlete dashboard</h1>
        <p>
          Sign in with Google to connect the MLog spreadsheet in your Drive root. If MLog does not exist yet,
          Fuel will create the workbook and initialize the required tabs without overwriting future data.
        </p>
        {error ? <div className="error-banner compact">{error}</div> : null}
        <button className="primary-action" type="button" onClick={() => window.location.assign('/api/auth/google/start')}>
          <ShieldCheck size={18} />
          Connect Google Drive
        </button>
      </section>
    </main>
  )
}

function MetricCard({
  icon,
  label,
  value,
  unit,
  tone = 'neutral',
  signed = false,
}: {
  icon: ReactNode
  label: string
  value: NullableNumber
  unit: string
  tone?: 'neutral' | 'positive' | 'negative'
  signed?: boolean
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{signed ? formatSignedNumber(value) : formatNumber(value)}</strong>
      {value === null ? null : <small>{unit}</small>}
    </div>
  )
}

function ProgressRow({
  label,
  value,
  target,
  unit,
}: {
  label: string
  value: NullableNumber
  target: NullableNumber | undefined
  unit: string
}) {
  const percentage = value !== null && target ? Math.min(100, Math.max(0, (value / target) * 100)) : null

  return (
    <div className="progress-row">
      <div>
        <span>{label}</span>
        <strong>
          {formatNumber(value)}
          {value !== null && unit ? ` ${unit}` : ''}
        </strong>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${percentage ?? 0}%` }} className={percentage === null ? 'missing' : ''} />
      </div>
      <small>{target ? `Goal ${formatNumber(target)}${unit ? ` ${unit}` : ''}` : 'Goal not logged'}</small>
    </div>
  )
}

function DualBarChart({ data }: { data: TrendPoint[] }) {
  const max = Math.max(
    ...data.flatMap((point) => [point.caloriesConsumed ?? 0, point.totalExpenditure ?? 0]),
    1,
  )

  return (
    <div className="dual-chart">
      <div className="chart-legend">
        <span className="legend-item consumed">Consumed</span>
        <span className="legend-item expenditure">Expenditure</span>
      </div>
      <div className="bar-grid">
        {data.map((point) => (
          <div className="bar-day" key={point.date}>
            <div className="bar-pair">
              <span
                className={point.caloriesConsumed === null ? 'missing' : 'consumed'}
                style={{ height: `${barHeight(point.caloriesConsumed, max)}%` }}
                title={`Consumed: ${formatNumber(point.caloriesConsumed)} cal`}
              />
              <span
                className={point.totalExpenditure === null ? 'missing' : 'expenditure'}
                style={{ height: `${barHeight(point.totalExpenditure, max)}%` }}
                title={`Expenditure: ${formatNumber(point.totalExpenditure)} cal`}
              />
            </div>
            <small>{formatTinyDate(point.date)}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function LineChart({
  data,
  metric,
  unit,
}: {
  data: TrendPoint[]
  metric: keyof TrendPoint
  unit: string
}) {
  const points = data
    .map((point, index) => ({
      date: point.date,
      index,
      value: typeof point[metric] === 'number' ? point[metric] as number : null,
    }))
    .filter((point): point is { date: string; index: number; value: number } => point.value !== null)

  if (points.length < 2) {
    return <div className="empty-chart">{notLogged}</div>
  }

  const max = Math.max(...points.map((point) => point.value))
  const min = Math.min(...points.map((point) => point.value))
  const range = max - min || 1
  const width = 320
  const height = 132
  const path = points
    .map((point) => {
      const x = data.length === 1 ? 0 : (point.index / (data.length - 1)) * width
      const y = height - ((point.value - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${String(metric)} trend`}>
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => {
          const x = data.length === 1 ? 0 : (point.index / (data.length - 1)) * width
          const y = height - ((point.value - min) / range) * height

          return <circle key={`${point.date}-${point.value}`} cx={x} cy={y} r="3.2" />
        })}
      </svg>
      <div className="chart-summary">
        <span>
          Latest {formatNumber(points.at(-1)?.value ?? null)}
          {unit ? ` ${unit}` : ''}
        </span>
        <span>
          Range {formatNumber(min)}-{formatNumber(max)}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
    </div>
  )
}

function EntryList<T>({
  items,
  empty,
  render,
}: {
  items: T[]
  empty: string
  render: (item: T) => ReactNode
}) {
  if (items.length === 0) {
    return <div className="empty-list">{empty}</div>
  }

  return <div className="entry-list">{items.map(render)}</div>
}

function FoodRow({ entry }: { entry: FoodEntry }) {
  return (
    <article className="entry-row">
      <div>
        <strong>{entry.food || entry.meal || 'Food entry'}</strong>
        <span>{[entry.time, entry.meal, entry.notes].filter(Boolean).join(' | ') || 'No details logged'}</span>
      </div>
      <div className="entry-metrics">
        <small>{formatNumber(entry.calories)} cal</small>
        <small>{formatNumber(entry.protein)} g protein</small>
      </div>
    </article>
  )
}

function WorkoutRow({ entry }: { entry: WorkoutEntry }) {
  return (
    <article className="entry-row">
      <div>
        <strong>{entry.activity || 'Workout'}</strong>
        <span>{[entry.time, entry.intensity, entry.notes].filter(Boolean).join(' | ') || 'No details logged'}</span>
      </div>
      <div className="entry-metrics">
        <small>{formatNumber(entry.durationMinutes)} min</small>
        <small>{formatNumber(entry.activeCalories)} cal</small>
      </div>
    </article>
  )
}

function balanceIcon(value: NullableNumber | undefined) {
  if (value === undefined || value === null || value === 0) {
    return <Gauge size={18} />
  }

  return value > 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />
}

function balanceLabel(value: NullableNumber | undefined) {
  if (value === undefined || value === null) {
    return 'Deficit / surplus'
  }

  if (value < 0) {
    return 'Deficit'
  }

  if (value > 0) {
    return 'Surplus'
  }

  return 'Balanced'
}

function balanceTone(value: NullableNumber | undefined): 'neutral' | 'positive' | 'negative' {
  if (value === undefined || value === null || value === 0) {
    return 'neutral'
  }

  return value < 0 ? 'negative' : 'positive'
}

function formatNumber(value: NullableNumber | undefined, options: { decimals?: number } = {}) {
  if (value === undefined || value === null) {
    return notLogged
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: options.decimals ?? (Number.isInteger(value) ? 0 : 1),
  }).format(value)
}

function formatSignedNumber(value: NullableNumber | undefined) {
  if (value === undefined || value === null) {
    return notLogged
  }

  const formatted = formatNumber(Math.abs(value))

  if (value > 0) {
    return `+${formatted}`
  }

  if (value < 0) {
    return `-${formatted}`
  }

  return formatted
}

function barHeight(value: NullableNumber, max: number) {
  if (value === null) {
    return 6
  }

  return Math.max(8, (value / max) * 100)
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function formatTinyDate(value: string) {
  const [, month, day] = value.split('-')

  return `${Number(month)}/${Number(day)}`
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function readAuthError() {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('auth_error')

  if (!error) {
    return ''
  }

  if (error === 'invalid_state') {
    return 'Google sign-in could not be verified. Please try again.'
  }

  return 'Google sign-in failed. Please try again.'
}

export default App
