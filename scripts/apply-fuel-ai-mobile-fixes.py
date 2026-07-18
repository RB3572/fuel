from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f'Expected source not found in {path}: {old[:100]!r}')
    file.write_text(text.replace(old, new, 1))


replace_once(
    'public/meal-plan.html',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
)
replace_once('public/meal-plan.html', '/meal-plan.css?v=20260718-2', '/meal-plan.css?v=20260718-3')
replace_once('public/meal-plan.html', '/meal-plan.js?v=20260718-1', '/meal-plan.js?v=20260718-2')

replace_once(
    'public/meal-plan.css',
    'html, body { width: 100%; height: 100%; overflow: hidden; }',
    'html, body { width: 100%; height: 100%; overflow: hidden; touch-action: pan-x pan-y; }\nhtml { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }',
)
replace_once(
    'public/meal-plan.css',
    '  height: 100vh;\n  height: 100dvh;',
    '  height: 100vh;\n  height: 100dvh;\n  height: var(--app-height, 100dvh);',
)
replace_once(
    'public/meal-plan.css',
    '  font-size: 16px;\n  line-height: 1.4;',
    '  font-size: 16px !important;\n  line-height: 1.4;\n  -webkit-appearance: none;\n  appearance: none;\n  -webkit-text-size-adjust: 100%;\n  touch-action: manipulation;',
)
replace_once(
    'public/meal-plan.css',
    '  .chat-composer textarea {\n    min-height: 44px;\n    max-height: min(132px, 24dvh);\n    padding: 10px 4px;\n    font-size: 16px;\n  }',
    '  .chat-composer textarea {\n    min-height: 44px;\n    max-height: min(132px, 24dvh);\n    padding: 10px 4px;\n    font-size: 16px !important;\n  }',
)
replace_once(
    'public/meal-plan.css',
    '.bubble-content {\n  min-width: 0;\n  max-width: 100%;\n  color: inherit;\n  font-size: 15px;\n  line-height: 1.58;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  word-break: break-word;\n}',
    '.bubble-content {\n  min-width: 0;\n  max-width: 100%;\n  color: inherit;\n  font-size: 15px;\n  line-height: 1.58;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  word-break: break-word;\n}\n.bubble-content.is-structured { white-space: normal; }\n.bubble-content.is-structured p { margin: 0 0 10px; }\n.bubble-content.is-structured p:last-child { margin-bottom: 0; }\n.bubble-content.is-structured h3 {\n  margin: 16px 0 7px;\n  color: inherit;\n  font-size: 12px;\n  line-height: 1.25;\n  letter-spacing: .075em;\n  text-transform: uppercase;\n}\n.bubble-content.is-structured h3:first-child { margin-top: 0; }\n.bubble-list-item {\n  display: grid;\n  grid-template-columns: 13px minmax(0, 1fr);\n  gap: 6px;\n  margin: 6px 0;\n}\n.bubble-list-item > i { color: #91b9ff; font-style: normal; font-weight: 800; }\n.plan-bubble .bubble-content { line-height: 1.5; }',
)

replace_once(
    'public/meal-plan.js',
    "    content.className='bubble-content'\n    content.textContent=role==='user'?String(text):cleanAssistantText(text)\n    article.append(content)",
    "    content.className='bubble-content'\n    if(role==='user')content.textContent=String(text)\n    else renderAssistantContent(content,text,isPlan)\n    article.append(content)",
)
replace_once(
    'public/meal-plan.js',
    "    appendBubble('assistant',error instanceof Error?error.message:'Unable to answer that message.')",
    "    appendBubble('assistant',friendlyClientError(error instanceof Error?error.message:'Unable to answer that message.'))",
)
replace_once(
    'public/meal-plan.js',
    "    setComposerBusy(false)\n    els.input.focus()",
    "    setComposerBusy(false)\n    focusComposerOnDesktop()",
)
replace_once(
    'public/meal-plan.js',
    "    setImage(await prepareImage(file))\n    els.input.focus()",
    "    setImage(await prepareImage(file))\n    focusComposerOnDesktop()",
)
replace_once(
    'public/meal-plan.js',
    "function cleanAssistantText(value){let text=String(value??'').trim().replace(/^```(?:json)?\\s*/i,'').replace(/\\s*```$/,'');for(let i=0;i<3;i++){try{const parsed=JSON.parse(text);if(typeof parsed==='string'){text=parsed.trim();continue}if(parsed&&typeof parsed.reply==='string'){text=parsed.reply.trim();continue}}catch{}break}const match=text.match(/[\\\"']reply[\\\"']\\s*:\\s*[\\\"']([\\s\\S]*)/);if(/^\\s*\\{/.test(text)&&match)text=match[1].replace(/[\\\"']?\\s*[}]+\\s*$/,'');return text.replace(/^\\s*[\\[{]+\\s*/,'').replace(/\\s*[\\]}]+\\s*$/,'').trim()}\nfunction escapeHtml",
    "function cleanAssistantText(value){let text=String(value??'').trim().replace(/^```(?:json)?\\s*/i,'').replace(/\\s*```$/,'');for(let i=0;i<3;i++){try{const parsed=JSON.parse(text);if(typeof parsed==='string'){text=parsed.trim();continue}if(parsed&&typeof parsed.reply==='string'){text=parsed.reply.trim();continue}if(parsed&&typeof parsed.plan==='string'){text=parsed.plan.trim();continue}}catch{}break}const match=text.match(/[\\\"'](?:reply|plan)[\\\"']\\s*:\\s*[\\\"']([\\s\\S]*)/);if(/^\\s*\\{/.test(text)&&match)text=match[1].replace(/[\\\"']?\\s*[}]+\\s*$/,'');return text.replace(/^\\s*[\\[{]+\\s*/,'').replace(/\\s*[\\]}]+\\s*$/,'').trim()}\nfunction stripInlineMarkdown(value){return String(value||'').replace(/\\*\\*([^*]+)\\*\\*/g,'$1').replace(/__([^_]+)__/g,'$1').replace(/`([^`]+)`/g,'$1').trim()}\nfunction renderAssistantContent(container,value,isPlan){\n  const text=cleanAssistantText(value).replace(/\\r\\n?/g,'\\n')\n  if(!isPlan){container.textContent=text;return}\n  container.classList.add('is-structured')\n  const lines=text.split('\\n')\n  let paragraph=[]\n  const flushParagraph=()=>{if(!paragraph.length)return;const p=document.createElement('p');p.textContent=stripInlineMarkdown(paragraph.join(' '));container.append(p);paragraph=[]}\n  for(const rawLine of lines){\n    const line=rawLine.trim()\n    if(!line){flushParagraph();continue}\n    const bullet=line.match(/^(?:[-*•]|\\d+[.)])\\s+(.+)$/)\n    const heading=line.replace(/^#{1,4}\\s*/,'').replace(/:$/,'').trim()\n    const isHeading=/^(MEAL PLAN FOR THE REST OF TODAY|TARGET|PLAN|ESTIMATED PLAN TOTAL|WHY THIS FITS|BREAKFAST|LUNCH|DINNER|MORNING SNACK|AFTERNOON SNACK|EVENING SNACK|SNACK|DESSERT)$/i.test(heading)\n    if(isHeading){flushParagraph();const h=document.createElement('h3');h.textContent=stripInlineMarkdown(heading);container.append(h);continue}\n    if(bullet){flushParagraph();const item=document.createElement('div');item.className='bubble-list-item';const marker=document.createElement('i');marker.textContent='•';const copy=document.createElement('span');copy.textContent=stripInlineMarkdown(bullet[1]);item.append(marker,copy);container.append(item);continue}\n    paragraph.push(line)\n  }\n  flushParagraph()\n}\nfunction friendlyClientError(value){const text=String(value||'');return /Invalid JSON payload|generation_config\\.response_schema|Unknown name \\\"additionalProperties\\\"|Cannot find field/i.test(text)?'Fuel AI hit a response-format issue. Please try that message again.':text}\nfunction focusComposerOnDesktop(){if(window.matchMedia('(hover: hover) and (pointer: fine)').matches)els.input.focus({preventScroll:true})}\nfunction syncViewportHeight(){const height=window.visualViewport?.height||window.innerHeight;document.documentElement.style.setProperty('--app-height',`${Math.round(height)}px`)}\nfunction escapeHtml",
)
replace_once(
    'public/meal-plan.js',
    "resizeInput()\nvoid loadPlanner()",
    "syncViewportHeight()\nwindow.addEventListener('resize',syncViewportHeight,{passive:true})\nwindow.visualViewport?.addEventListener('resize',syncViewportHeight,{passive:true})\nwindow.visualViewport?.addEventListener('scroll',syncViewportHeight,{passive:true})\nresizeInput()\nvoid loadPlanner()",
)

replace_once(
    'api/_lib/meal-plan.js',
    'const validCache = Boolean(cache?.plan && cache.food_fingerprint === state.foodFingerprint)',
    'const validCache = Boolean(cache?.plan && cache.food_fingerprint === state.foodFingerprint && planLooksComplete(cache.plan))',
)
replace_once(
    'api/_lib/meal-plan.js',
    "          nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES, additionalProperties: false },",
    "          nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES },",
)
old_generate = """async function generateMealPlan({ state, location, localTime, timeZone }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const prompt = buildPlanPrompt({ ...state, location, localTime, timeZone })
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.35, topP: 0.9, maxOutputTokens: 2200 },
  }
  if (location) {
    requestBody.tools = [{ googleMaps: {} }]
    requestBody.toolConfig = { retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } } }
  }
  const payload = await callGemini(model, requestBody, Boolean(location))
  const candidate = payload?.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part?.text || '').join('\n').trim()
  if (!text) throw geminiError(payload?.promptFeedback?.blockReason ? `Gemini blocked the request: ${payload.promptFeedback.blockReason}.` : 'Gemini returned an empty meal plan.', 502, 'gemini_empty_response')
  return { text, sources: groundingSources(candidate), model }
}
"""
new_generate = """const PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { plan: { type: 'string' } },
  required: ['plan'],
}

async function generateMealPlan({ state, location, localTime, timeZone }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const prompt = buildPlanPrompt({ ...state, location, localTime, timeZone })
  const buildRequest = (instruction = '') => {
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: `${prompt}${instruction}` }] }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.9,
        maxOutputTokens: 3200,
        responseMimeType: 'application/json',
        responseSchema: PLAN_RESPONSE_SCHEMA,
      },
    }
    if (location) {
      requestBody.tools = [{ googleMaps: {} }]
      requestBody.toolConfig = { retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } } }
    }
    return requestBody
  }

  let payload = await callGemini(model, buildRequest(), Boolean(location))
  let parsed = parsePlanPayload(payload)
  if (parsed.candidate?.finishReason === 'MAX_TOKENS' || !planLooksComplete(parsed.text)) {
    payload = await callGemini(model, buildRequest('\n\nRETRY REQUIREMENTS: Return one complete plan under 1,200 words. Start with MEAL PLAN FOR THE REST OF TODAY, include every requested heading exactly once, and finish the WHY THIS FITS section with a complete sentence. Do not continue a prior fragment.'), Boolean(location))
    parsed = parsePlanPayload(payload)
  }
  if (!planLooksComplete(parsed.text)) {
    throw geminiError('Fuel AI could not produce a complete meal plan. Please try again.', 502, 'gemini_incomplete_plan')
  }
  return { text: parsed.text, sources: groundingSources(parsed.candidate), model }
}

function parsePlanPayload(payload) {
  const candidate = payload?.candidates?.[0]
  const raw = candidate?.content?.parts?.map((part) => part?.text || '').join('').trim()
  if (!raw) return { text: '', candidate }
  try {
    const parsed = JSON.parse(raw)
    const text = typeof parsed === 'string' ? parsed : parsed?.plan
    return { text: cleanReplyText(text || ''), candidate }
  } catch {
    return { text: cleanReplyText(raw), candidate }
  }
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
"""
replace_once('api/_lib/meal-plan.js', old_generate, new_generate)
replace_once(
    'api/_lib/meal-plan.js',
    "    const message = result.payload?.error?.message || result.payload?.error || `Gemini request failed with status ${result.response.status}.`\n    const code = result.response.status === 403 ? 'gemini_permission_denied' : 'gemini_request_failed'\n    throw geminiError(String(message), result.response.status >= 400 && result.response.status < 500 ? result.response.status : 502, code)",
    "    const providerMessage = String(result.payload?.error?.message || result.payload?.error || `Gemini request failed with status ${result.response.status}.`)\n    console.error('Gemini provider error', providerMessage)\n    if (/Invalid JSON payload|response_schema|Unknown name \\\"additionalProperties\\\"|Cannot find field/i.test(providerMessage)) {\n      throw geminiError('Fuel AI response formatting was rejected. Please try again.', 502, 'gemini_schema_rejected')\n    }\n    const code = result.response.status === 403 ? 'gemini_permission_denied' : 'gemini_request_failed'\n    const publicMessage = result.response.status >= 400 && result.response.status < 500 ? 'Fuel AI could not process that request. Please try again.' : 'Fuel AI is temporarily unavailable. Please try again.'\n    throw geminiError(publicMessage, result.response.status >= 400 && result.response.status < 500 ? result.response.status : 502, code)",
)
