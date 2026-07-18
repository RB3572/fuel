from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f'Expected source not found in {path}: {old[:140]!r}')
    file.write_text(text.replace(old, new, 1))


replace_once(
    'public/meal-plan.js',
    "  setStatus('Requesting your current location…',{loading:true})\n  let locationData={}\n  try{\n    try{\n      state.location=await getLocation()\n      locationData=state.location\n      setStatus('Building a plan from today’s Fuel data and current location…',{loading:true})\n    }catch(error){\n      state.location=null\n      setStatus(error instanceof Error?error.message:'Location was unavailable. Generating without it.',{loading:true})\n    }\n\n    const response=await timedFetch('/api/meal-plan',",
    "  state.location=null\n  setStatus('Building a plan from today’s Fuel data…',{loading:true})\n  try{\n    const response=await timedFetch('/api/meal-plan',",
)
replace_once('public/meal-plan.js', '        ...locationData,\n', '')
replace_once('api/_lib/meal-plan.js', '  if (text.length < 180) return false', '  if (text.length < 100) return false')
replace_once('public/meal-plan.html', '/meal-plan.js?v=20260718-3', '/meal-plan.js?v=20260718-4')

path = Path('test/site-delete-gemini-timeout.test.js')
text = path.read_text()
text += "\ntest('initial plan generation does not block on geolocation', () => {\n  assert.doesNotMatch(client, /state\\.location=await getLocation\\(\\)/)\n  assert.match(client, /Building a plan from today’s Fuel data/)\n})\n"
path.write_text(text)
