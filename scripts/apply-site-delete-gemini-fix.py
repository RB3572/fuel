from pathlib import Path
import re


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f'Expected source not found in {path}: {old[:140]!r}')
    file.write_text(text.replace(old, new, 1))


def regex_once(path, pattern, replacement, flags=0):
    file = Path(path)
    text = file.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'Expected one regex match in {path}, found {count}: {pattern[:140]!r}')
    file.write_text(updated)


# Include the database ID in dashboard food rows so the browser can target one exact entry.
replace_once(
    'api/_lib/neon-dashboard.js',
    "function normalizeFood(row) {\n  return {\n    time:",
    "function normalizeFood(row) {\n  return {\n    id: String(row.id),\n    time:",
)

# Add an authenticated DELETE operation to the existing food endpoint.
replace_once(
    'api/mlog.js',
    "  if (!['GET', 'POST'].includes(req.method)) {\n    methodNotAllowed(res, ['GET', 'POST'])",
    "  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {\n    methodNotAllowed(res, ['GET', 'POST', 'DELETE'])",
)
replace_once(
    'api/mlog.js',
    "    if (req.method === 'GET') {\n      const dashboard = await getNeonDashboard(auth.id)\n      dashboard.intradayEnergy = await getIntradayEnergy(auth.id)\n      sendJson(res, 200, dashboard, auth.cookie ? [auth.cookie] : [])\n      return\n    }\n\n    const body = unwrap(req.body)",
    "    if (req.method === 'GET') {\n      const dashboard = await getNeonDashboard(auth.id)\n      dashboard.intradayEnergy = await getIntradayEnergy(auth.id)\n      sendJson(res, 200, dashboard, auth.cookie ? [auth.cookie] : [])\n      return\n    }\n\n    const body = unwrap(req.body)\n    if (req.method === 'DELETE') {\n      const entryId = text(body.entryId ?? body.entry_id ?? body.id)\n      if (!entryId) {\n        sendJson(res, 422, { error: 'A food entry ID is required.' })\n        return\n      }\n      const db = sql()\n      const rows = await db`\n        DELETE FROM food_entries\n        WHERE user_id = ${auth.id} AND id::text = ${entryId}\n        RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, confidence, notes, source\n      `\n      if (!rows.length) {\n        sendJson(res, 404, { error: 'Food entry not found.' }, auth.cookie ? [auth.cookie] : [])\n        return\n      }\n      sendJson(res, 200, { ok: true, deleted: true, entry: rows[0] }, auth.cookie ? [auth.cookie] : [])\n      return\n    }",
)
replace_once(
    'api/mlog.js',
    "  } catch (error) {\n    console.error(req.method === 'POST' ? 'Food logging failed' : 'Unable to load Fuel data from Neon', error)\n    sendJson(res, 500, { error: req.method === 'POST' ? 'Food could not be logged.' : 'Unable to load Fuel data.' })\n  }",
    "  } catch (error) {\n    const operation = req.method === 'POST' ? 'Food logging' : req.method === 'DELETE' ? 'Food deletion' : 'Dashboard loading'\n    console.error(`${operation} failed`, error)\n    const message = req.method === 'POST' ? 'Food could not be logged.' : req.method === 'DELETE' ? 'Food entry could not be deleted.' : 'Unable to load Fuel data.'\n    sendJson(res, 500, { error: message })\n  }",
)

# Add the dashboard delete control and confirmation flow.
replace_once(
    'src/App.tsx',
    'Timer, X } from \'lucide-react\'',
    'Timer, Trash2, X } from \'lucide-react\'',
)
replace_once(
    'src/App.tsx',
    "type FoodEntry = { time:string; meal:string; food:string;",
    "type FoodEntry = { id:string; time:string; meal:string; food:string;",
)
replace_once(
    'src/App.tsx',
    "  const[loading,setLoading]=useState(false)\n  const[error,setError]=useState('')",
    "  const[loading,setLoading]=useState(false)\n  const[deletingFoodId,setDeletingFoodId]=useState<string|null>(null)\n  const[error,setError]=useState('')",
)
replace_once(
    'src/App.tsx',
    "  const logout=async()=>{await fetch('/api/auth/logout',{method:'POST'});setSession({loading:false,authenticated:false,user:null});setData(null)}",
    "  const logout=async()=>{await fetch('/api/auth/logout',{method:'POST'});setSession({loading:false,authenticated:false,user:null});setData(null)}\n  const deleteFood=async(entry:FoodEntry)=>{if(!entry.id||deletingFoodId)return;const label=entry.food||entry.meal||'this food entry';if(!window.confirm(`Delete \"${label}\" from Fuel? This cannot be undone.`))return;setDeletingFoodId(entry.id);setError('');try{const r=await fetch('/api/mlog',{method:'DELETE',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({entryId:entry.id})}),p=await r.json();if(!r.ok)throw new Error(p.error||'Unable to delete this food entry.');await load()}catch(e){setError(e instanceof Error?e.message:'Unable to delete this food entry.')}finally{setDeletingFoodId(null)}}",
)
replace_once(
    'src/App.tsx',
    "<Section title=\"Food consumed\" detail={`${data?.today.foodEntries.length||0} entries today`}/><section className=\"panel\"><EntryList empty=\"No food logged today.\">{(data?.today.foodEntries||[]).map((e,i)=><FoodRow key={i} e={e}/>)}</EntryList></section>",
    "<Section title=\"Food consumed\" detail={`${data?.today.foodEntries.length||0} entries today`}/><section className=\"panel\"><EntryList empty=\"No food logged today.\">{(data?.today.foodEntries||[]).map((e,i)=><FoodRow key={e.id||i} e={e} deleting={deletingFoodId===e.id} onDelete={()=>void deleteFood(e)}/>)}</EntryList></section>",
)
replace_once(
    'src/App.tsx',
    "function FoodRow({e}:{e:FoodEntry}){const details=[e.nutrients?.sugarsG!=null?`${fmt(e.nutrients.sugarsG,1)}g sugar`:'',e.nutrients?.sodiumMg!=null?`${fmt(e.nutrients.sodiumMg)}mg sodium`:'',e.nutrients?.caffeineMg!=null?`${fmt(e.nutrients.caffeineMg)}mg caffeine`:''].filter(Boolean).join(' · ');return <article className=\"entry\"><div><strong>{e.food||e.meal}</strong><span>{[e.time,e.meal,e.portion].filter(Boolean).join(' · ')}</span>{details&&<span className=\"food-micro\">{details}</span>}</div><div><strong>{fmt(e.calories)} kcal</strong><span>{fmt(e.protein,1)}g protein · {fmt(e.carbs,1)}g carbs · {fmt(e.fat,1)}g fat · {fmt(e.fiber,1)}g fiber</span></div></article>}",
    "function FoodRow({e,deleting,onDelete}:{e:FoodEntry;deleting:boolean;onDelete:()=>void}){const details=[e.nutrients?.sugarsG!=null?`${fmt(e.nutrients.sugarsG,1)}g sugar`:'',e.nutrients?.sodiumMg!=null?`${fmt(e.nutrients.sodiumMg)}mg sodium`:'',e.nutrients?.caffeineMg!=null?`${fmt(e.nutrients.caffeineMg)}mg caffeine`:''].filter(Boolean).join(' · ');return <article className=\"entry food-entry\"><div><strong>{e.food||e.meal}</strong><span>{[e.time,e.meal,e.portion].filter(Boolean).join(' · ')}</span>{details&&<span className=\"food-micro\">{details}</span>}</div><div className=\"entry-actions\"><div className=\"entry-nutrition\"><strong>{fmt(e.calories)} kcal</strong><span>{fmt(e.protein,1)}g protein · {fmt(e.carbs,1)}g carbs · {fmt(e.fat,1)}g fat · {fmt(e.fiber,1)}g fiber</span></div><button className=\"delete-entry-button\" disabled={deleting} onClick={onDelete} aria-label={`Delete ${e.food||'food entry'}`} title=\"Delete food entry\"><Trash2 size={15}/><span>{deleting?'Deleting…':'Delete'}</span></button></div></article>}",
)

css_path = Path('src/App.css')
css = css_path.read_text()
css += "\n.entry-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px}.entry-nutrition{text-align:right}.delete-entry-button{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;border:1px solid #e2e2e2;background:#fff;color:#6f2727;padding:7px 9px;border-radius:9px;font-size:11px;font-weight:700;cursor:pointer}.delete-entry-button:hover{border-color:#d9a3a3;background:#fff7f7}.delete-entry-button:disabled{opacity:.5;cursor:wait}@media(max-width:560px){.entry-actions{align-items:flex-start;justify-content:space-between}.entry-nutrition{text-align:left}.delete-entry-button span{display:none}.delete-entry-button{padding:8px}}\n"
css_path.write_text(css)

# Make plan generation deterministic and bounded instead of two unbounded, contradictory attempts.
replace_once(
    'api/_lib/meal-plan.js',
    "const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])",
    "const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])\nconst GEMINI_PLAN_TIMEOUT_MS = 18000\nconst GEMINI_RETRY_TIMEOUT_MS = 12000\nconst GEMINI_CHAT_TIMEOUT_MS = 25000",
)
new_plan_block = r'''const PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    plan: { type: 'string' },
    estimatedPlanTotal: { type: 'string' },
    whyThisFits: { type: 'string' },
  },
  required: ['target', 'plan', 'estimatedPlanTotal', 'whyThisFits'],
}

async function generateMealPlan({ state, location, localTime, timeZone }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const prompt = buildPlanPrompt({ ...state, location, localTime, timeZone })
  const buildRequest = (instruction = '') => ({
    contents: [{ role: 'user', parts: [{ text: `${prompt}${instruction}` }] }],
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 1800,
      responseMimeType: 'application/json',
      responseSchema: PLAN_RESPONSE_SCHEMA,
    },
  })

  let payload = await callGemini(model, buildRequest(), false, GEMINI_PLAN_TIMEOUT_MS)
  let parsed = parsePlanPayload(payload)
  if (parsed.candidate?.finishReason === 'MAX_TOKENS' || !parsed.valid) {
    payload = await callGemini(model, buildRequest('\n\nRETRY REQUIREMENTS: Keep the complete response concise. Each required field must be present and end with a complete sentence. The plan field should contain short meal lines with portions and estimates, not a long essay.'), false, GEMINI_RETRY_TIMEOUT_MS)
    parsed = parsePlanPayload(payload)
  }
  if (!parsed.valid) {
    throw geminiError('Fuel AI could not produce a complete meal plan. Please try again.', 502, 'gemini_incomplete_plan')
  }
  const text = formatPlanPayload(parsed)
  return { text, sources: [], model }
}

function parsePlanPayload(payload) {
  const candidate = payload?.candidates?.[0]
  const raw = candidate?.content?.parts?.map((part) => part?.text || '').join('').trim()
  if (!raw) return { valid: false, target: '', plan: '', estimatedPlanTotal: '', whyThisFits: '', candidate }
  try {
    const value = JSON.parse(raw)
    const target = cleanReplyText(value?.target || '')
    const plan = cleanReplyText(value?.plan || '')
    const estimatedPlanTotal = cleanReplyText(value?.estimatedPlanTotal || '')
    const whyThisFits = cleanReplyText(value?.whyThisFits || '')
    const valid = [target, plan, estimatedPlanTotal, whyThisFits].every((field) => field.length >= 8)
    return { valid, target, plan, estimatedPlanTotal, whyThisFits, candidate }
  } catch {
    return { valid: false, target: '', plan: '', estimatedPlanTotal: '', whyThisFits: '', candidate }
  }
}

function formatPlanPayload(value) {
  return `MEAL PLAN FOR THE REST OF TODAY\n\nTARGET\n${value.target}\n\nPLAN\n${value.plan}\n\nESTIMATED PLAN TOTAL\n${value.estimatedPlanTotal}\n\nWHY THIS FITS\n${value.whyThisFits}`.trim()
}

export function planLooksComplete(value) {
  const text = cleanReplyText(value)
  if (text.length < 180) return false
  const required = ['MEAL PLAN FOR THE REST OF TODAY', 'TARGET', 'PLAN', 'ESTIMATED PLAN TOTAL', 'WHY THIS FITS']
  if (!required.every((heading) => text.toUpperCase().includes(heading))) return false
  if (!/[.!?)]$/.test(text)) return false
  const opening = (text.match(/\(/g) || []).length
  const closing = (text.match(/\)/g) || []).length
  return opening === closing
}

'''
regex_once(
    'api/_lib/meal-plan.js',
    r"const PLAN_RESPONSE_SCHEMA = \{[\s\S]*?\n// Chat answers are structured",
    new_plan_block + '// Chat answers are structured',
)
replace_once(
    'api/_lib/meal-plan.js',
    '  let payload = await callGemini(model, request)',
    '  let payload = await callGemini(model, request, false, GEMINI_CHAT_TIMEOUT_MS)',
)
replace_once(
    'api/_lib/meal-plan.js',
    "    payload = await callGemini(model, {\n      ...request,",
    "    payload = await callGemini(model, {\n      ...request,",
)
replace_once(
    'api/_lib/meal-plan.js',
    "      generationConfig: { ...request.generationConfig, maxOutputTokens: 2400 },\n    })",
    "      generationConfig: { ...request.generationConfig, maxOutputTokens: 2400 },\n    }, false, GEMINI_RETRY_TIMEOUT_MS)",
)
replace_once(
    'api/_lib/meal-plan.js',
    "async function callGemini(model, requestBody, allowMapsFallback = false) {",
    "async function callGemini(model, requestBody, allowMapsFallback = false, timeoutMs = GEMINI_CHAT_TIMEOUT_MS) {",
)
old_invoke = r'''  const invoke = async (body) => {
    const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers, body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  }
'''
new_invoke = r'''  const invoke = async (body) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      return { response, payload }
    } catch (error) {
      if (error?.name === 'AbortError') throw geminiError('Fuel AI took too long to respond. Please try again.', 504, 'gemini_timeout')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
'''
replace_once('api/_lib/meal-plan.js', old_invoke, new_invoke)
replace_once(
    'api/_lib/meal-plan.js',
    "7. Return complete plain text, never JSON or code fences.\n\nUse concise plain text with these headings: MEAL PLAN FOR THE REST OF TODAY, TARGET, PLAN, ESTIMATED PLAN TOTAL, WHY THIS FITS.`",
    "7. Return compact JSON matching the response schema. Put clean plain text inside each field, without code fences or duplicate section headings.\n\nFIELD REQUIREMENTS\n- target: Briefly state the remaining calorie and macro targets.\n- plan: List only the remaining eating occasions, with portions and nutrition estimates.\n- estimatedPlanTotal: Summarize the proposed plan's calories and macros.\n- whyThisFits: Explain briefly why the plan fits the user's remaining needs and restrictions.`",
)

# Bound browser waits and expose an explicit retry action instead of a permanent spinner.
replace_once(
    'public/meal-plan.js',
    'const JPEG_QUALITY=.82',
    'const JPEG_QUALITY=.82\nconst PLAN_REQUEST_TIMEOUT_MS=35000\nconst CHAT_REQUEST_TIMEOUT_MS=42000',
)
replace_once(
    'public/meal-plan.js',
    "function hideStatus(){els.status.hidden=true}",
    "function hideStatus(){els.status.hidden=true}\nfunction showGenerationError(message){setStatus(message,{error:true});const retry=document.createElement('button');retry.type='button';retry.className='status-retry';retry.textContent='Try again';retry.addEventListener('click',()=>void generatePlan(),{once:true});els.status.append(retry)}\nasync function timedFetch(url,options={},timeoutMs=PLAN_REQUEST_TIMEOUT_MS){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{return await fetch(url,{...options,signal:controller.signal})}catch(error){if(error?.name==='AbortError')throw new Error('Fuel AI took too long to respond. Try again.');throw error}finally{clearTimeout(timer)}}",
)
replace_once(
    'public/meal-plan.js',
    "    const response=await fetch('/api/meal-plan',{cache:'no-store',headers:{Accept:'application/json'}})",
    "    const response=await timedFetch('/api/meal-plan',{cache:'no-store',headers:{Accept:'application/json'}},15000)",
)
replace_once(
    'public/meal-plan.js',
    "  els.chat.hidden=true\n  setStatus('Requesting today’s Fuel data…',{loading:true})",
    "  setStatus('Requesting today’s Fuel data…',{loading:true})",
)
# The current source uses a location status first; remove the unconditional hide independently.
replace_once('public/meal-plan.js', '  els.chat.hidden=true\n  setStatus(\'Requesting your current location…\',{loading:true})', "  setStatus('Requesting your current location…',{loading:true})")
replace_once(
    'public/meal-plan.js',
    "    const response=await fetch('/api/meal-plan',{\n      method:'POST',",
    "    const response=await timedFetch('/api/meal-plan',{\n      method:'POST',",
)
# Close the initial generation timedFetch call with its timeout.
replace_once(
    'public/meal-plan.js',
    "      }),\n    })\n    const payload=await response.json()",
    "      }),\n    },PLAN_REQUEST_TIMEOUT_MS)\n    const payload=await response.json()",
)
replace_once(
    'public/meal-plan.js',
    "    setStatus(error instanceof Error?error.message:'Unable to generate a meal plan.',{error:true})",
    "    showGenerationError(error instanceof Error?error.message:'Unable to generate a meal plan.')",
)
# Convert the chat POST separately after the first occurrence has already changed.
replace_once(
    'public/meal-plan.js',
    "    const response=await fetch('/api/meal-plan',{\n      method:'POST',",
    "    const response=await timedFetch('/api/meal-plan',{\n      method:'POST',",
)
replace_once(
    'public/meal-plan.js',
    "        timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Los_Angeles',\n      }),\n    })\n    const payload=await response.json()",
    "        timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Los_Angeles',\n      }),\n    },CHAT_REQUEST_TIMEOUT_MS)\n    const payload=await response.json()",
)

css_file = Path('public/meal-plan.css')
chat_css = css_file.read_text()
chat_css += "\n.status-retry{border:0;border-radius:11px;background:var(--black);color:var(--white);padding:10px 15px;font-weight:750;cursor:pointer}.status-card.error{flex-wrap:wrap}.status-card.error p{flex-basis:100%;text-align:center}\n"
css_file.write_text(chat_css)

# Bump static asset versions so mobile browsers do not retain the broken client.
replace_once('public/meal-plan.html', '/meal-plan.css?v=20260718-3', '/meal-plan.css?v=20260718-4')
replace_once('public/meal-plan.html', '/meal-plan.js?v=20260718-2', '/meal-plan.js?v=20260718-3')

Path('test/site-delete-gemini-timeout.test.js').write_text(r'''import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../api/_lib/neon-dashboard.js', import.meta.url), 'utf8')
const api = readFileSync(new URL('../api/mlog.js', import.meta.url), 'utf8')
const planner = readFileSync(new URL('../api/_lib/meal-plan.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../public/meal-plan.js', import.meta.url), 'utf8')

test('dashboard exposes confirmed food deletion for an exact authenticated entry', () => {
  assert.match(dashboard, /id: String\(row\.id\)/)
  assert.match(app, /window\.confirm/)
  assert.match(app, /method:'DELETE'/)
  assert.match(app, /entryId:entry\.id/)
  assert.match(app, /delete-entry-button/)
  assert.match(api, /\['GET', 'POST', 'DELETE'\]/)
  assert.match(api, /DELETE FROM food_entries/)
  assert.match(api, /WHERE user_id = \$\{auth\.id\} AND id::text = \$\{entryId\}/)
})

test('Gemini plan generation uses bounded structured fields without default Maps latency', () => {
  assert.match(planner, /estimatedPlanTotal: \{ type: 'string' \}/)
  assert.match(planner, /whyThisFits: \{ type: 'string' \}/)
  assert.match(planner, /GEMINI_PLAN_TIMEOUT_MS = 18000/)
  assert.match(planner, /new AbortController\(\)/)
  assert.match(planner, /code: 'gemini_timeout'|gemini_timeout/)
  assert.doesNotMatch(planner, /requestBody\.tools = \[\{ googleMaps:/)
  assert.doesNotMatch(planner, /Return complete plain text, never JSON/)
})

test('meal-plan client times out and presents a retry instead of spinning forever', () => {
  assert.match(client, /PLAN_REQUEST_TIMEOUT_MS=35000/)
  assert.match(client, /timedFetch/)
  assert.match(client, /showGenerationError/)
  assert.match(client, /status-retry/)
  assert.match(client, /Fuel AI took too long to respond/)
})
''')
