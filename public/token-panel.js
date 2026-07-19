const SHORTCUT_URL = 'https://www.icloud.com/shortcuts/bfdc6b641b3f4172a7b842fc60dc1dd3'

// Redeploy marker: Neon-backed production configuration.
let tokenData = null
let panel = null
let launcher = null

async function copyText(value, button) {
  await navigator.clipboard.writeText(value)
  const original = button.textContent
  button.textContent = 'Copied'
  setTimeout(() => { button.textContent = original }, 1400)
}

function buildPanel() {
  panel = document.createElement('aside')
  panel.className = 'fuel-sync-panel'
  panel.setAttribute('aria-label', 'Apple Health sync setup')
  panel.innerHTML = `
    <div class="fuel-sync-head">
      <div>
        <strong>Apple Health sync</strong>
        <span>Neon-backed private storage</span>
      </div>
      <button class="fuel-sync-close" type="button" aria-label="Close">×</button>
    </div>
    <ol class="fuel-sync-steps">
      <li><a href="${SHORTCUT_URL}" target="_blank" rel="noreferrer">Install the Fuel Health Shortcut</a>.</li>
      <li>Open the Shortcut and replace only the bearer token with the token below.</li>
      <li>Leave <code>Bearer </code> before the token, with one space.</li>
    </ol>
    <label class="fuel-token-label" for="fuel-sync-token">Your bearer token</label>
    <div class="fuel-token-row">
      <textarea id="fuel-sync-token" readonly spellcheck="false">Loading…</textarea>
      <button class="fuel-copy-token" type="button">Copy</button>
    </div>
    <div class="fuel-sync-actions">
      <a href="${SHORTCUT_URL}" target="_blank" rel="noreferrer">Get Shortcut</a>
      <button class="fuel-rotate-token" type="button">Replace token</button>
    </div>
    <p class="fuel-sync-note">Replacing the token immediately revokes the old one. Health imports update one record per date and do not create duplicate daily entries.</p>
  `
  document.body.appendChild(panel)

  launcher = document.createElement('button')
  launcher.className = 'fuel-sync-launcher'
  launcher.type = 'button'
  launcher.textContent = 'Sync setup'
  document.body.appendChild(launcher)

  panel.querySelector('.fuel-sync-close').addEventListener('click', () => panel.classList.remove('open'))
  launcher.addEventListener('click', () => panel.classList.add('open'))
  panel.querySelector('.fuel-copy-token').addEventListener('click', (event) => {
    if (tokenData?.token) copyText(tokenData.token, event.currentTarget)
  })
  panel.querySelector('.fuel-rotate-token').addEventListener('click', async (event) => {
    if (!confirm('Replace the current token? The token already installed in the Shortcut will stop working.')) return
    event.currentTarget.disabled = true
    try {
      const response = await fetch('/api/health/token', { method: 'POST', headers: { Accept: 'application/json' } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to replace token')
      setToken(payload)
    } catch (error) {
      alert(error.message || 'Unable to replace token')
    } finally {
      event.currentTarget.disabled = false
    }
  })
}

function setToken(payload) {
  tokenData = payload
  const textarea = panel?.querySelector('#fuel-sync-token')
  if (textarea) textarea.value = payload.token || 'Unavailable'
}

async function initialize() {
  const sessionResponse = await fetch('/api/auth/session', { headers: { Accept: 'application/json' } }).catch(() => null)
  if (!sessionResponse?.ok) return
  const session = await sessionResponse.json().catch(() => null)
  if (!session?.authenticated) return

  if (!panel) buildPanel()
  try {
    const response = await fetch('/api/health/token', { headers: { Accept: 'application/json' } })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Unable to load token')
    setToken(payload)
    if (!localStorage.getItem('fuel-sync-onboarding-seen')) {
      panel.classList.add('open')
      localStorage.setItem('fuel-sync-onboarding-seen', '1')
    }
  } catch (error) {
    setToken({ token: error.message || 'Unable to load token' })
    panel.classList.add('open')
  }
}

// The sync panel is secondary UI, so its session/token requests are deferred until
// the browser is idle rather than competing with the dashboard's first paint. A
// MutationObserver used to run a whole-document text rewrite here on every React
// mutation; every string it targeted is long gone, so it was pure overhead.
const startPanel = () => (window.requestIdleCallback || ((fn) => setTimeout(fn, 600)))(initialize)
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', startPanel)
else startPanel()