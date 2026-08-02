import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MapPin, Trash2, X } from 'lucide-react'
import PlaceMap from './PlaceMap'
import './PlacesPage.css'

type Place = {
  id: string; label: string | null; samples: number; likelyHome: boolean
  suggestedLabel: string | null; suggestedDetail: string | null; identified: boolean
  latitude: number; longitude: number
}
type Bucket = { index: number; startMinute: number; placeId: string | null; samples: number; share: number }
type Heatmap = { places: Place[]; buckets: Bucket[]; bucketsPerDay: number; windowDays: number; totalSamples: number; daysCovered: number; firstSampleAt: string | null }

// Volcanic ramp (obsidian -> violet -> plum -> ember -> lava -> sulfur), sampled off
// the magma/inferno colormaps. Ordered by heat so the palette climbs in both hue and
// lightness, which keeps adjacent places distinguishable rather than merely pretty.
const PLACE_COLORS = ['#1b1035', '#4a1079', '#7d1e6d', '#a92e5e', '#cf4446', '#e96a25', '#f79711', '#f7c93e']
// Places are handed colours in this order rather than straight down the ramp, so even
// two or three places span obsidian-to-sulfur instead of all landing in the dark end.
// A fixed order (rather than re-spreading by count) keeps a place's colour stable when
// a new one appears.
const COLOR_ORDER = [0, 7, 3, 5, 1, 6, 2, 4]
const paletteAt = (index: number) => PLACE_COLORS[COLOR_ORDER[index]]
// Warm ash rather than neutral grey, so empty slots sit in the same family.
const NO_DATA = '#e5ded6'
// Places past the palette collapse into one muted bucket, keeping the legend legible.
const OTHER_COLOR = '#9c8f84'

const clockLabel = (minute: number) => {
  const h = Math.floor(minute / 60) % 24
  const m = Math.round(minute % 60)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

// Fade a place's colour toward the empty-slot grey as confidence drops, so a slot the
// user is only sometimes at reads as weaker rather than as a hard block.
function withConfidence(hex: string, share: number) {
  const weight = Math.max(0.25, Math.min(1, share))
  const parse = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
  const [r, g, b] = parse(hex)
  const [nr, ng, nb] = parse(NO_DATA)
  const mix = (a: number, n: number) => Math.round(a * weight + n * (1 - weight))
  return `rgb(${mix(r, nr)}, ${mix(g, ng)}, ${mix(b, nb)})`
}

export default function PlacesPage({ nav }: { nav: ReactNode }) {
  const [data, setData] = useState<Heatmap | null>(null)
  const [status, setStatus] = useState('Loading your places…')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const identifying = useRef(false)
  const [tracking, setTracking] = useState(() => (typeof localStorage === 'undefined' ? true : localStorage.getItem('fuel-location-off') !== '1'))

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/mlog?fuel_route=places&days=30', { cache: 'no-store', headers: { Accept: 'application/json' } })
      const p = await r.json()
      if (!r.ok) throw new Error(p.error || 'Unable to load your places.')
      setData(p)
      setStatus('')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load your places.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // Give unnamed places a real name. One request at a time and spaced out: the lookup
  // is rate-limited upstream (one per second), and a place is only ever looked up once
  // because the answer is cached server-side. A failure is left unidentified rather
  // than retried in a loop.
  useEffect(() => {
    const pending = (data?.places || []).filter((place) => !place.label && !place.identified && place.samples > 0)
    if (!pending.length || identifying.current) return
    identifying.current = true
    let cancelled = false
    ;(async () => {
      for (const place of pending) {
        if (cancelled) break
        try {
          const r = await fetch('/api/mlog?fuel_route=places', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ action: 'identify', placeId: place.id }),
          })
          const p = await r.json().catch(() => ({}))
          if (!cancelled && r.ok) {
            setData((current) => (current ? {
              ...current,
              places: current.places.map((existing) => (existing.id === place.id
                ? { ...existing, suggestedLabel: p.suggestedLabel ?? existing.suggestedLabel, suggestedDetail: p.suggestedDetail ?? existing.suggestedDetail, identified: Boolean(p.identified) }
                : existing)),
            } : current))
          }
        } catch { /* leave it unidentified; the placeholder name still works */ }
        if (!cancelled) await new Promise((resolve) => setTimeout(resolve, 1100))
      }
      identifying.current = false
    })()
    return () => { cancelled = true; identifying.current = false }
  }, [data?.places])

  const colorFor = useMemo(() => {
    const map = new Map<string, string>()
    ;(data?.places || []).forEach((place, index) => {
      map.set(place.id, index < COLOR_ORDER.length ? paletteAt(index) : OTHER_COLOR)
    })
    return (id: string | null) => (id && map.get(id)) || NO_DATA
  }, [data])

  // What a place is called: the user's own name, else the name looked up from the
  // map, else a numbered placeholder. Used everywhere so the timeline, the legend and
  // the rename dialog can never disagree.
  const nameOf = useCallback((place: Place | undefined, index: number) =>
    place?.label || place?.suggestedLabel || `Place ${index + 1}`, [])

  const labelFor = useCallback((id: string | null) => {
    if (!id) return 'No data'
    const index = (data?.places || []).findIndex((p) => p.id === id)
    if (index < 0) return 'Unknown'
    return nameOf(data?.places[index], index)
  }, [data, nameOf])

  // Colour stops sit at each slot's centre, so the browser interpolates between them
  // and the bar reads as one continuous gradient down the day.
  const gradient = useMemo(() => {
    const buckets = data?.buckets || []
    if (!buckets.length) return `linear-gradient(${NO_DATA}, ${NO_DATA})`
    const stops = buckets.map((bucket) => {
      const position = ((bucket.index + 0.5) / buckets.length) * 100
      const color = bucket.samples ? withConfidence(colorFor(bucket.placeId), bucket.share) : NO_DATA
      return `${color} ${position.toFixed(2)}%`
    })
    return `linear-gradient(to bottom, ${stops.join(', ')})`
  }, [data, colorFor])

  // Collapse consecutive slots with the same dominant place into readable spans.
  const spans = useMemo(() => {
    const buckets = data?.buckets || []
    const out: Array<{ placeId: string | null; startMinute: number; endMinute: number; slots: number }> = []
    for (const bucket of buckets) {
      const id = bucket.samples ? bucket.placeId : null
      const last = out[out.length - 1]
      if (last && last.placeId === id) { last.endMinute = bucket.startMinute + (24 * 60) / buckets.length; last.slots += 1 }
      else out.push({ placeId: id, startMinute: bucket.startMinute, endMinute: bucket.startMinute + (24 * 60) / buckets.length, slots: 1 })
    }
    // Ignore single half-hour blips; they are noise, not a place you spend time.
    return out.filter((span) => span.placeId && span.slots >= 2)
  }, [data])

  const toggleTracking = () => {
    const next = !tracking
    setTracking(next)
    try { localStorage.setItem('fuel-location-off', next ? '0' : '1') } catch { /* ignore */ }
  }

  const saveLabel = async (placeId: string) => {
    setBusy(true)
    try {
      const r = await fetch('/api/mlog?fuel_route=places', { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ placeId, label: draft }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not rename that place.')
      setEditing(null)
      await load()
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not rename that place.') }
    finally { setBusy(false) }
  }

  const clearAll = async () => {
    if (!window.confirm('Delete all stored location history? Your places and the heatmap will be erased. This cannot be undone.')) return
    setBusy(true)
    try {
      const r = await fetch('/api/mlog?fuel_route=places', { method: 'DELETE', headers: { Accept: 'application/json' } })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not delete your history.')
      await load()
      setStatus('Location history deleted.')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not delete your history.') }
    finally { setBusy(false) }
  }

  const editingIndex = (data?.places || []).findIndex((place) => place.id === editing)
  const editingPlace = editingIndex >= 0 ? data?.places[editingIndex] : undefined
  const hourMarks = [0, 3, 6, 9, 12, 15, 18, 21, 24]
  const hasData = (data?.totalSamples || 0) > 0

  return (
    <main className="app-shell places-page">
      {nav}
      <div className="places-head">
        <div>
          <span className="eyebrow">PLACES</span>
          <h1>Where you spend your day</h1>
          <p>{hasData
            ? `Built from ${data?.totalSamples.toLocaleString()} check-ins across ${data?.daysCovered} ${data?.daysCovered === 1 ? 'day' : 'days'}.`
            : 'Fuel notes where you are when you open the app, then shows the pattern here.'}</p>
        </div>
        <div className="places-controls">
          <button className={`track-toggle${tracking ? ' on' : ''}`} onClick={toggleTracking}>
            <MapPin size={15} />{tracking ? 'Tracking on' : 'Tracking off'}
          </button>
        </div>
      </div>

      {status && <div className="places-status">{status}</div>}

      {!hasData && !status && (
        <section className="panel places-empty">
          <h2>No places yet</h2>
          <p>Fuel records a single location fix each time you open the app (at most once every few minutes). After a day or two of normal use, this page will show which places fill which parts of your day.</p>
          <p className="places-fine">Your fixes are stored in your own Fuel database and can be deleted below at any time.</p>
        </section>
      )}

      {hasData && (
        <section className="panel places-panel">
          <div className="timeline">
            <div className="tl-hours">
              {hourMarks.map((hour) => (
                <span key={hour} style={{ top: `${(hour / 24) * 100}%` }}>{hour === 24 ? '12am' : clockLabel(hour * 60)}</span>
              ))}
            </div>
            <div className="tl-bar" style={{ backgroundImage: gradient }} role="img" aria-label="Twenty-four hour place gradient, midnight at the top" />
            <div className="tl-spans">
              {spans.map((span) => (
                <div
                  className="tl-span"
                  key={`${span.placeId}-${span.startMinute}`}
                  style={{ top: `${(span.startMinute / 1440) * 100}%`, height: `${((span.endMinute - span.startMinute) / 1440) * 100}%` }}
                >
                  <span className="tl-dot" style={{ background: colorFor(span.placeId) }} />
                  <span className="tl-name">{labelFor(span.placeId)}</span>
                  <span className="tl-time">{clockLabel(span.startMinute)} – {clockLabel(span.endMinute)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {hasData && (
        <section className="panel places-legend">
          <h2>Your places</h2>
          {(data?.places || []).map((place, index) => (place.samples > 0 ? (
            <div className="legend-place" key={place.id}>
              <span className="lp-dot" style={{ background: index < COLOR_ORDER.length ? paletteAt(index) : OTHER_COLOR }} />
              <span className="lp-text">
                <span className="lp-name">{nameOf(place, index)}</span>
                {place.suggestedDetail && !place.label && <span className="lp-detail">{place.suggestedDetail}</span>}
              </span>
              {place.likelyHome && !place.label && <span className="lp-hint">likely home</span>}
              <span className="lp-count">{place.samples} check-in{place.samples === 1 ? '' : 's'}</span>
              <button className="lp-rename" onClick={() => { setEditing(place.id); setDraft(place.label || place.suggestedLabel || '') }}>Rename</button>
            </div>
          ) : null))}
          <p className="places-fine">Names come from OpenStreetMap and are only a starting point — rename any place to whatever you actually call it.</p>
        </section>
      )}

      {editingPlace && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setEditing(null) }}>
          <section className="panel place-modal" role="dialog" aria-modal="true" aria-label="Rename this place">
            <div className="place-modal-head">
              <div>
                <span className="eyebrow">RENAME</span>
                <h2>{nameOf(editingPlace, editingIndex)}</h2>
                {editingPlace.suggestedDetail && <p>{editingPlace.suggestedDetail}</p>}
              </div>
              <button className="icon-button" onClick={() => setEditing(null)} aria-label="Close"><X size={17} /></button>
            </div>

            <PlaceMap latitude={editingPlace.latitude} longitude={editingPlace.longitude} label={nameOf(editingPlace, editingIndex)} />

            {editingPlace.suggestedLabel && editingPlace.suggestedLabel !== draft.trim() && (
              <button className="pm-suggestion" onClick={() => setDraft(editingPlace.suggestedLabel || '')}>
                Use “{editingPlace.suggestedLabel}”
              </button>
            )}

            <label className="pm-label" htmlFor="place-name">What do you call this place?</label>
            <input
              id="place-name" className="pm-input" value={draft} autoFocus maxLength={60}
              placeholder={editingPlace.suggestedLabel || `Place ${editingIndex + 1}`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void saveLabel(editingPlace.id); if (event.key === 'Escape') setEditing(null) }}
            />
            <div className="pm-actions">
              <button className="lp-cancel" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="lp-save" onClick={() => void saveLabel(editingPlace.id)} disabled={busy}>Save name</button>
            </div>
            <p className="places-fine">Clearing the box puts the map's own name back.</p>
          </section>
        </div>
      )}

      <section className="panel places-privacy">
        <div>
          <h2>Location data</h2>
          <p>Your fixes are stored in your own Fuel database and are only ever read back to you. To name a place, its averaged centre — never an individual fix, and nothing identifying you — is sent once to OpenStreetMap and the answer is cached. Turning tracking off stops new fixes immediately.</p>
        </div>
        <button className="clear-history" onClick={() => void clearAll()} disabled={busy}><Trash2 size={15} />Delete all location history</button>
      </section>
    </main>
  )
}
