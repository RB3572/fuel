// Quick log: open the camera, take one photo, log it, go back to the dashboard.
// No preview, no confirm step, no form — the whole point is that logging a meal costs
// a single tap. Anything that could ask a question belongs on the AI page instead.

const video = document.getElementById('ql-video')
const canvas = document.getElementById('ql-canvas')
const shutter = document.getElementById('ql-shutter')
const flip = document.getElementById('ql-flip')
const statusLine = document.getElementById('ql-status')
const hint = document.getElementById('ql-hint')
const busy = document.getElementById('ql-busy')
const busyText = document.getElementById('ql-busy-text')

// Rear camera by default — a plate on a table is what this page is pointed at. The
// flip button covers the rest.
let facingMode = 'environment'
let stream = null
let sending = false

function say(message, tone) {
  statusLine.textContent = message || ''
  statusLine.hidden = !message
  statusLine.className = `ql-status${tone ? ` is-${tone}` : ''}`
}

async function startCamera() {
  stopCamera()
  say('Starting the camera…')
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // `ideal` rather than `exact`: a laptop with only a front camera should still
      // work rather than throwing OverconstrainedError.
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false,
    })
    video.srcObject = stream
    await video.play().catch(() => {})
    shutter.disabled = false
    say('')
  } catch (error) {
    shutter.disabled = true
    const name = error?.name || ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      say('Fuel needs camera access to quick-log. Allow it in your browser settings, then reload.', 'error')
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      say('No camera was found on this device.', 'error')
    } else {
      say(`The camera could not start${name ? ` (${name})` : ''}.`, 'error')
    }
  }
}

function stopCamera() {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
  stream = null
}

// Grab the current frame at its native size, capped so the upload stays small.
function captureJpeg() {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return null
  const scale = Math.min(1, 1600 / Math.max(width, height))
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  // A front camera is mirrored on screen; un-mirror it so the model sees the scene the
  // right way round (text on packaging especially).
  if (facingMode === 'user') {
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

async function takeAndLog() {
  if (sending || shutter.disabled) return
  const dataUrl = captureJpeg()
  if (!dataUrl) { say('The camera is not ready yet.', 'error'); return }

  sending = true
  shutter.disabled = true
  busy.hidden = false
  busyText.textContent = 'Reading your photo…'
  say('')
  // Freeze the frame under the overlay so it is obvious which shot is being logged.
  stopCamera()

  try {
    const response = await fetch('/api/mlog?fuel_route=quicklog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ image: { mimeType: 'image/jpeg', data: dataUrl }, localTime: new Date().toString() }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401) { window.location.href = '/'; return }
    if (!response.ok) throw new Error(payload.error || 'That photo could not be logged.')

    const logged = payload.logged || []
    if (!logged.length) {
      busy.hidden = true
      sending = false
      say(payload.note || 'No food was recognised in that photo. Try again.', 'error')
      await startCamera()
      return
    }
    // Straight back to the dashboard, which scrolls to the food it just gained.
    busyText.textContent = `Logged ${logged.length === 1 ? logged[0].description : `${logged.length} items`}`
    window.location.href = `/#logged=${encodeURIComponent(logged.map((entry) => entry.id).join(','))}`
  } catch (error) {
    busy.hidden = true
    sending = false
    say(error instanceof Error ? error.message : 'That photo could not be logged.', 'error')
    await startCamera()
  }
}

shutter.addEventListener('click', () => void takeAndLog())
flip.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user'
  document.getElementById('ql').classList.toggle('is-front', facingMode === 'user')
  void startCamera()
})
// The tab going away should not leave the camera light on.
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); else if (!sending) void startCamera() })
window.addEventListener('pagehide', stopCamera)

hint.textContent = 'Point at your food and tap to log it'
document.getElementById('ql').classList.toggle('is-front', facingMode === 'user')
void startCamera()
