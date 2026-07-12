import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity,
  Beef,
  CalendarDays,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Moon,
  Plus,
  Salad,
  Timer,
  Trash2,
  Utensils,
} from 'lucide-react'
import './App.css'

type LogType = 'workout' | 'meal'

type LogEntry = {
  id: string
  type: LogType
  title: string
  detail: string
  calories: number
  protein: number
  minutes: number
  createdAt: string
}

type DayState = {
  waterCups: number
  sleepHours: number
  recoveryNote: string
}

type DashboardState = {
  entries: LogEntry[]
  day: DayState
}

const storageKey = 'fuel-dashboard-v1'

const seedEntries: LogEntry[] = [
  {
    id: 'seed-run',
    type: 'workout',
    title: 'Zone 2 run',
    detail: 'Easy aerobic base',
    calories: 420,
    protein: 0,
    minutes: 46,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'seed-breakfast',
    type: 'meal',
    title: 'Greek yogurt bowl',
    detail: 'Berries, granola, honey',
    calories: 520,
    protein: 34,
    minutes: 0,
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: 'seed-lift',
    type: 'workout',
    title: 'Lower body lift',
    detail: 'Squat, hinge, calves',
    calories: 310,
    protein: 0,
    minutes: 54,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
  },
  {
    id: 'seed-salmon',
    type: 'meal',
    title: 'Salmon rice plate',
    detail: 'Rice, greens, avocado',
    calories: 760,
    protein: 48,
    minutes: 0,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
]

const initialState: DashboardState = {
  entries: seedEntries,
  day: {
    waterCups: 5,
    sleepHours: 7.2,
    recoveryNote: 'Light legs, good appetite, keep tonight easy.',
  },
}

function App() {
  const [state, setState] = useState<DashboardState>(() => loadState())
  const [mode, setMode] = useState<LogType>('workout')
  const [workout, setWorkout] = useState({
    title: '',
    detail: '',
    minutes: '45',
    calories: '350',
  })
  const [meal, setMeal] = useState({
    title: '',
    detail: '',
    calories: '650',
    protein: '35',
  })

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state])

  const today = useMemo(() => getDateKey(new Date()), [])
  const todayEntries = useMemo(
    () => state.entries.filter((entry) => getDateKey(new Date(entry.createdAt)) === today),
    [state.entries, today],
  )

  const totals = useMemo(() => {
    return todayEntries.reduce(
      (sum, entry) => ({
        caloriesIn: sum.caloriesIn + (entry.type === 'meal' ? entry.calories : 0),
        caloriesOut: sum.caloriesOut + (entry.type === 'workout' ? entry.calories : 0),
        protein: sum.protein + entry.protein,
        minutes: sum.minutes + entry.minutes,
      }),
      { caloriesIn: 0, caloriesOut: 0, protein: 0, minutes: 0 },
    )
  }, [todayEntries])

  const weekly = useMemo(() => getWeeklyLoad(state.entries), [state.entries])
  const sortedEntries = [...todayEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  function addWorkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = workout.title.trim() || 'Workout'
    const minutes = readNumber(workout.minutes)
    const calories = readNumber(workout.calories)

    setState((current) => ({
      ...current,
      entries: [
        {
          id: crypto.randomUUID(),
          type: 'workout',
          title,
          detail: workout.detail.trim() || 'Training session',
          minutes,
          calories,
          protein: 0,
          createdAt: new Date().toISOString(),
        },
        ...current.entries,
      ],
    }))
    setWorkout({ title: '', detail: '', minutes: '45', calories: '350' })
  }

  function addMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = meal.title.trim() || 'Meal'
    const calories = readNumber(meal.calories)
    const protein = readNumber(meal.protein)

    setState((current) => ({
      ...current,
      entries: [
        {
          id: crypto.randomUUID(),
          type: 'meal',
          title,
          detail: meal.detail.trim() || 'Logged food',
          calories,
          protein,
          minutes: 0,
          createdAt: new Date().toISOString(),
        },
        ...current.entries,
      ],
    }))
    setMeal({ title: '', detail: '', calories: '650', protein: '35' })
  }

  function deleteEntry(id: string) {
    setState((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== id),
    }))
  }

  function updateDay(next: Partial<DayState>) {
    setState((current) => ({
      ...current,
      day: { ...current.day, ...next },
    }))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Fuel</h1>
          <p>{formatLongDate(new Date())}</p>
        </div>
        <div className="date-control" aria-label="Current log date">
          <CalendarDays size={18} />
          <span>Today</span>
        </div>
      </header>

      <section className="dashboard-grid" aria-label="Fuel dashboard">
        <aside className="panel summary-panel">
          <div className="panel-heading">
            <div>
              <h2>Daily balance</h2>
              <p>{todayEntries.length} entries</p>
            </div>
            <Activity size={22} />
          </div>

          <div className="score">
            <span>{Math.max(0, totals.caloriesIn - totals.caloriesOut)}</span>
            <small>net calories</small>
          </div>

          <div className="metric-stack">
            <Metric icon={<Utensils size={18} />} label="Food" value={`${totals.caloriesIn}`} unit="cal" />
            <Metric icon={<Dumbbell size={18} />} label="Training" value={`${totals.minutes}`} unit="min" />
            <Metric icon={<Beef size={18} />} label="Protein" value={`${totals.protein}`} unit="g" />
          </div>

          <div className="segmented" aria-label="Log type">
            <button type="button" className={mode === 'workout' ? 'selected' : ''} onClick={() => setMode('workout')}>
              <Dumbbell size={16} />
              Workout
            </button>
            <button type="button" className={mode === 'meal' ? 'selected' : ''} onClick={() => setMode('meal')}>
              <Salad size={16} />
              Meal
            </button>
          </div>

          {mode === 'workout' ? (
            <form className="log-form" onSubmit={addWorkout}>
              <label>
                Activity
                <input
                  value={workout.title}
                  onChange={(event) => setWorkout({ ...workout, title: event.target.value })}
                  placeholder="Swim intervals"
                />
              </label>
              <label>
                Notes
                <input
                  value={workout.detail}
                  onChange={(event) => setWorkout({ ...workout, detail: event.target.value })}
                  placeholder="Main set, RPE, route"
                />
              </label>
              <div className="form-row">
                <label>
                  Minutes
                  <input
                    inputMode="numeric"
                    value={workout.minutes}
                    onChange={(event) => setWorkout({ ...workout, minutes: event.target.value })}
                  />
                </label>
                <label>
                  Calories
                  <input
                    inputMode="numeric"
                    value={workout.calories}
                    onChange={(event) => setWorkout({ ...workout, calories: event.target.value })}
                  />
                </label>
              </div>
              <button type="submit" className="primary-action">
                <Plus size={18} />
                Add workout
              </button>
            </form>
          ) : (
            <form className="log-form" onSubmit={addMeal}>
              <label>
                Meal
                <input
                  value={meal.title}
                  onChange={(event) => setMeal({ ...meal, title: event.target.value })}
                  placeholder="Chicken rice bowl"
                />
              </label>
              <label>
                Notes
                <input
                  value={meal.detail}
                  onChange={(event) => setMeal({ ...meal, detail: event.target.value })}
                  placeholder="Ingredients, timing"
                />
              </label>
              <div className="form-row">
                <label>
                  Calories
                  <input
                    inputMode="numeric"
                    value={meal.calories}
                    onChange={(event) => setMeal({ ...meal, calories: event.target.value })}
                  />
                </label>
                <label>
                  Protein
                  <input
                    inputMode="numeric"
                    value={meal.protein}
                    onChange={(event) => setMeal({ ...meal, protein: event.target.value })}
                  />
                </label>
              </div>
              <button type="submit" className="primary-action meal-action">
                <Plus size={18} />
                Add meal
              </button>
            </form>
          )}
        </aside>

        <section className="panel timeline-panel">
          <div className="panel-heading">
            <div>
              <h2>Today log</h2>
              <p>{formatTimeRange(sortedEntries)}</p>
            </div>
            <Footprints size={22} />
          </div>

          <div className="timeline-list">
            {sortedEntries.length ? (
              sortedEntries.map((entry) => (
                <article key={entry.id} className={`entry-row ${entry.type}`}>
                  <div className="entry-icon">{entry.type === 'workout' ? <Dumbbell size={18} /> : <Utensils size={18} />}</div>
                  <div className="entry-copy">
                    <div>
                      <h3>{entry.title}</h3>
                      <span>{formatShortTime(entry.createdAt)}</span>
                    </div>
                    <p>{entry.detail}</p>
                    <div className="entry-metrics">
                      {entry.type === 'workout' ? (
                        <>
                          <span>{entry.minutes} min</span>
                          <span>{entry.calories} cal out</span>
                        </>
                      ) : (
                        <>
                          <span>{entry.calories} cal</span>
                          <span>{entry.protein}g protein</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button type="button" className="icon-button" onClick={() => deleteEntry(entry.id)} aria-label={`Delete ${entry.title}`}>
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <Activity size={28} />
                <p>No entries yet today.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="side-stack">
          <section className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <h2>Training load</h2>
                <p>7 day minutes</p>
              </div>
              <Timer size={22} />
            </div>
            <div className="bar-chart" aria-label="Weekly training minutes">
              {weekly.map((day, index) => (
                <div key={`${day.label}-${index}`} className="bar-column">
                  <span style={{ height: `${Math.max(8, day.percent)}%` }} />
                  <small>{day.label}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="panel nutrition-panel">
            <div className="panel-heading">
              <div>
                <h2>Nutrition</h2>
                <p>Targets</p>
              </div>
              <Flame size={22} />
            </div>
            <ProgressRow label="Calories" value={totals.caloriesIn} goal={2400} accent="tomato" unit="cal" />
            <ProgressRow label="Protein" value={totals.protein} goal={150} accent="blue" unit="g" />
            <ProgressRow label="Water" value={state.day.waterCups} goal={10} accent="green" unit="cups" />
            <div className="water-controls">
              <button type="button" onClick={() => updateDay({ waterCups: Math.max(0, state.day.waterCups - 1) })}>
                <Droplets size={16} />
                -1
              </button>
              <button type="button" onClick={() => updateDay({ waterCups: state.day.waterCups + 1 })}>
                <Droplets size={16} />
                +1
              </button>
            </div>
          </section>

          <section className="panel recovery-panel">
            <div className="panel-heading">
              <div>
                <h2>Recovery</h2>
                <p>Readiness notes</p>
              </div>
              <Moon size={22} />
            </div>
            <label className="sleep-control">
              Sleep
              <input
                type="number"
                min="0"
                max="14"
                step="0.1"
                value={state.day.sleepHours}
                onChange={(event) => updateDay({ sleepHours: readNumber(event.target.value) })}
              />
            </label>
            <textarea
              value={state.day.recoveryNote}
              onChange={(event) => updateDay({ recoveryNote: event.target.value })}
              rows={4}
            />
          </section>
        </aside>
      </section>
    </main>
  )
}

function Metric({ icon, label, value, unit }: { icon: ReactNode; label: string; value: string; unit: string }) {
  return (
    <div className="metric-row">
      <span>{icon}</span>
      <p>{label}</p>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  )
}

function ProgressRow({
  label,
  value,
  goal,
  accent,
  unit,
}: {
  label: string
  value: number
  goal: number
  accent: 'green' | 'tomato' | 'blue'
  unit: string
}) {
  const percent = Math.min(100, Math.round((value / goal) * 100))

  return (
    <div className="progress-row">
      <div>
        <span>{label}</span>
        <strong>
          {value}
          <small>/{goal} {unit}</small>
        </strong>
      </div>
      <div className="progress-track">
        <span className={accent} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function loadState(): DashboardState {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return initialState
    const parsed = JSON.parse(raw) as DashboardState
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : initialState.entries,
      day: { ...initialState.day, ...(parsed.day ?? {}) },
    }
  } catch {
    return initialState
  }
}

function readNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 10) / 10 : 0
}

function getDateKey(date: Date) {
  return date.toLocaleDateString('en-CA')
}

function getWeeklyLoad(entries: LogEntry[]) {
  const today = new Date()
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (6 - offset))
    const key = getDateKey(date)
    const minutes = entries
      .filter((entry) => entry.type === 'workout' && getDateKey(new Date(entry.createdAt)) === key)
      .reduce((sum, entry) => sum + entry.minutes, 0)

    return {
      label: date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1),
      minutes,
    }
  })
  const max = Math.max(...days.map((day) => day.minutes), 60)
  return days.map((day) => ({ ...day, percent: Math.round((day.minutes / max) * 100) }))
}

function formatLongDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function formatShortTime(value: string) {
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatTimeRange(entries: LogEntry[]) {
  if (!entries.length) return 'Ready'
  const last = entries[entries.length - 1]
  const first = entries[0]
  return `${formatShortTime(last.createdAt)} - ${formatShortTime(first.createdAt)}`
}

export default App
