// Fills in the two parts of the shared nav bar that are not static markup: today's
// date and the signed-in Google account picture. Loaded only by the static pages
// (recipes.html, meal-plan.html) — the React app renders the same nav itself, and
// scripts that mutate React-owned DOM have caused remount loops here before.

const long = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
const short = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date())
document.querySelectorAll('.brand-date .date-long').forEach((n) => { n.textContent = long })
document.querySelectorAll('.brand-date .date-short').forEach((n) => { n.textContent = short })

async function paintAvatar() {
  const slot = document.querySelector('.brand-avatar')
  if (!slot) return
  try {
    const response = await fetch('/api/auth/session', { headers: { Accept: 'application/json' } })
    if (!response.ok) return
    const session = await response.json()
    if (!session?.authenticated) return
    const user = session.user || {}
    const label = user.name || user.email || 'Signed in'
    slot.title = label
    if (!user.picture) {
      slot.textContent = label.slice(0, 1).toUpperCase()
      return
    }
    const img = new Image()
    img.className = 'brand-avatar'
    img.src = user.picture
    img.alt = label
    img.title = label
    img.referrerPolicy = 'no-referrer'
    // Only swap once the picture actually loads, so a failed Google image leaves
    // the initial in place rather than a broken-image icon.
    img.addEventListener('load', () => slot.replaceWith(img))
    slot.textContent = label.slice(0, 1).toUpperCase()
  } catch {
    // Signed-out or offline: the initial placeholder stays.
  }
}

void paintAvatar()
