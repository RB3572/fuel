from pathlib import Path

path = Path('scripts/apply-site-delete-gemini-fix.py')
text = path.read_text()

bad_block = '''replace_once(
    'public/meal-plan.js',
    "  els.chat.hidden=true\n  setStatus('Requesting today’s Fuel data…',{loading:true})",
    "  setStatus('Requesting today’s Fuel data…',{loading:true})",
)
'''
if bad_block not in text:
    raise RuntimeError('Expected obsolete client replacement was not found.')
text = text.replace(bad_block, '', 1)

old_format = '''function formatPlanPayload(value) {
  return `MEAL PLAN FOR THE REST OF TODAY\\n\\nTARGET\\n${value.target}\\n\\nPLAN\\n${value.plan}\\n\\nESTIMATED PLAN TOTAL\\n${value.estimatedPlanTotal}\\n\\nWHY THIS FITS\\n${value.whyThisFits}`.trim()
}
'''
new_format = '''function formatPlanPayload(value) {
  const whyThisFits = /[.!?)]$/.test(value.whyThisFits) ? value.whyThisFits : `${value.whyThisFits}.`
  return `MEAL PLAN FOR THE REST OF TODAY\\n\\nTARGET\\n${value.target}\\n\\nPLAN\\n${value.plan}\\n\\nESTIMATED PLAN TOTAL\\n${value.estimatedPlanTotal}\\n\\nWHY THIS FITS\\n${whyThisFits}`.trim()
}
'''
if old_format not in text:
    raise RuntimeError('Expected plan formatter was not found.')
text = text.replace(old_format, new_format, 1)

marker = '''replace_once(
    'api/_lib/meal-plan.js',
    "7. Return complete plain text, never JSON or code fences.\\n\\nUse concise plain text with these headings: MEAL PLAN FOR THE REST OF TODAY, TARGET, PLAN, ESTIMATED PLAN TOTAL, WHY THIS FITS.`",
    "7. Return compact JSON matching the response schema. Put clean plain text inside each field, without code fences or duplicate section headings.\\n\\nFIELD REQUIREMENTS\\n- target: Briefly state the remaining calorie and macro targets.\\n- plan: List only the remaining eating occasions, with portions and nutrition estimates.\\n- estimatedPlanTotal: Summarize the proposed plan's calories and macros.\\n- whyThisFits: Explain briefly why the plan fits the user's remaining needs and restrictions.`",
)
'''
addition = marker + '''replace_once(
    'api/_lib/meal-plan.js',
    "  const locationText = location ? `Latitude ${location.latitude.toFixed(5)}, longitude ${location.longitude.toFixed(5)}, accuracy about ${Math.round(location.accuracy || 0)} meters. Use location only for genuinely useful nearby options.` : 'Location was unavailable. Do not invent nearby businesses.'",
    "  const locationText = location ? `Local coordinates are available for time-zone and general context only. Do not name or invent nearby businesses.` : 'Location was unavailable. Do not invent nearby businesses.'",
)
'''
if marker not in text:
    raise RuntimeError('Expected prompt replacement marker was not found.')
text = text.replace(marker, addition, 1)

path.write_text(text)
