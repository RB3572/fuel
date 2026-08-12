// Turns a place's centroid into a human name — "Cava", "Caltech Beckman Hall",
// "Arcadia Mall" — using OpenStreetMap's Nominatim.
//
// PRIVACY: this is the only part of Fuel that sends a coordinate off the server. It is
// deliberately narrow: only a place's averaged centroid (never an individual fix),
// only once per place (the answer is cached in user_places.suggested_label), and only
// for places the user is actually looking at. Nothing identifying the user is sent —
// no account, no cookie, no id. The suggestion is a suggestion: the label the user
// types always wins, and a place can be renamed or left as-is.
//
// Nominatim is free and needs no key, but its usage policy requires an identifying
// User-Agent and at most one request per second, so callers do one place at a time.

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT = 'Fuel/1.0 (personal health dashboard; https://fuel.rishib.com)'
const TIMEOUT_MS = 8000

// zoom=18 is building/POI level. Lower and everything becomes a street; higher adds
// nothing for the coordinates a phone produces.
const ZOOM = 18

export async function describeCoordinate(latitude, longitude) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('A valid coordinate is required.')

  const url = new URL(ENDPOINT)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', lat.toFixed(6))
  url.searchParams.set('lon', lon.toFixed(6))
  url.searchParams.set('zoom', String(ZOOM))
  url.searchParams.set('addressdetails', '1')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let payload
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}.`)
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The place lookup timed out.')
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (payload?.error) throw new Error(String(payload.error.message || payload.error))

  return { name: bestName(payload), detail: contextLine(payload) }
}

// Nominatim puts a POI's own name in `name` and everything else in `address`. Prefer
// the specific over the general: the shop or building someone would actually say,
// then the street, and only then the neighbourhood.
function bestName(payload) {
  const address = payload?.address || {}
  const candidates = [
    payload?.name,
    address.shop, address.amenity, address.leisure, address.tourism, address.office,
    address.building, address.club, address.healthcare, address.craft,
    // A named campus/park/school the coordinate sits inside.
    address.university, address.college, address.school, address.park,
    address.retail, address.commercial,
    address.house_name,
    // Street level is the last useful rung; a bare house number is not a name.
    address.road ? [address.house_number, address.road].filter(Boolean).join(' ') : null,
    address.neighbourhood, address.suburb, address.hamlet, address.village, address.town, address.city,
  ]
  for (const candidate of candidates) {
    const clean = String(candidate ?? '').trim()
    if (clean) return clean.slice(0, 60)
  }
  return ''
}

// A short second line so an ambiguous name is still recognisable — "Pasadena" under a
// "Cava", say. Never the full postal address; that is more than is needed to pick a name.
function contextLine(payload) {
  const address = payload?.address || {}
  const parts = [
    address.neighbourhood || address.suburb || null,
    address.city || address.town || address.village || address.hamlet || null,
  ].filter(Boolean)
  return [...new Set(parts)].join(', ').slice(0, 80)
}
