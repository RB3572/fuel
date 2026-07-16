const state={status:null,busy:false}
const els={
  generate:document.getElementById('generate-button'),
  status:document.getElementById('status-card'),
  budget:document.getElementById('budget-section'),
  plan:document.getElementById('plan-section'),
  output:document.getElementById('plan-output'),
  sources:document.getElementById('maps-sources'),
  sourceList:document.getElementById('source-list'),
  generatedTime:document.getElementById('generated-time'),
}

function number(value,digits=0){
  const parsed=Number(value)
  return Number.isFinite(parsed)?new Intl.NumberFormat('en-US',{maximumFractionDigits:digits}).format(parsed):'—'
}

function setStatus(message,{error=false,html=false}={}){
  els.status.className=`status-card card${error?' error':''}`
  els.status.innerHTML=html?message:`<p>${escapeHtml(message)}</p>`
  els.status.hidden=false
}

function renderBudget(budget){
  if(!budget)return
  els.budget.hidden=false
  document.getElementById('budget-date').textContent=budget.date||''
  document.getElementById('remaining-calories').textContent=`${number(budget.caloriesRemaining)} kcal`
  document.getElementById('calorie-progress').textContent=`${number(budget.caloriesConsumed)} consumed of ${number(budget.caloriesGoal)} kcal`
  document.getElementById('remaining-protein').textContent=`${number(budget.proteinRemaining,1)} g`
  document.getElementById('remaining-carbs').textContent=`${number(budget.carbsRemaining,1)} g`
  document.getElementById('remaining-fat').textContent=`${number(budget.fatRemaining,1)} g`
  document.getElementById('remaining-fiber').textContent=`${number(budget.fiberRemaining,1)} g`
}

async function loadStatus(){
  try{
    const response=await fetch('/api/meal-plan',{cache:'no-store',headers:{Accept:'application/json'}})
    const payload=await response.json()
    if(response.status===401){
      setStatus(`<div><strong>Sign in to Fuel</strong><p class="location-note">The planner needs your private Fuel goals, food log, and saved context.</p></div><div class="status-actions"><a href="/api/auth/google/start?return_to=%2Fmeal-plan.html">Sign in with Google</a></div>`,{html:true})
      return
    }
    if(!response.ok)throw new Error(payload.error||'Unable to load the meal planner.')
    state.status=payload
    renderBudget(payload.budget)
    if(!payload.connected){
      setStatus(`<div><strong>Connect Gemini</strong><p class="location-note">Authorize the Google Cloud scope used to call Gemini as your Google account. Gemini API usage still belongs to the Google Cloud project, not a Gemini Advanced subscription.</p></div><div class="status-actions"><a href="${escapeAttribute(payload.connectUrl)}">Connect Google for Gemini</a></div>`,{html:true})
      els.generate.disabled=true
      return
    }
    els.status.hidden=true
    els.generate.disabled=false
  }catch(error){
    setStatus(error instanceof Error?error.message:'Unable to load the meal planner.',{error:true})
  }
}

function getLocation(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){
      reject(new Error('This browser does not support location access.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position)=>resolve({
        latitude:position.coords.latitude,
        longitude:position.coords.longitude,
        accuracy:position.coords.accuracy,
      }),
      (error)=>reject(new Error(locationError(error))),
      {enableHighAccuracy:true,timeout:12000,maximumAge:5*60*1000},
    )
  })
}

function locationError(error){
  if(error?.code===1)return 'Location permission was denied. Allow location access in your browser settings and try again.'
  if(error?.code===2)return 'Your current location could not be determined.'
  if(error?.code===3)return 'Location access timed out. Try again.'
  return 'Unable to access your current location.'
}

async function generatePlan({withoutLocation=false}={}){
  if(state.busy)return
  state.busy=true
  els.generate.disabled=true
  els.generate.querySelector('span').textContent=withoutLocation?'Generating without location…':'Requesting location…'
  els.plan.hidden=true
  try{
    let location={}
    if(!withoutLocation){
      try{
        location=await getLocation()
      }catch(error){
        setStatus(`<div><strong>Location is unavailable</strong><p class="location-note">${escapeHtml(error instanceof Error?error.message:'Unable to access location.')}</p></div><div class="status-actions"><button id="without-location" class="secondary-button" type="button">Generate without location</button></div>`,{error:true,html:true})
        document.getElementById('without-location')?.addEventListener('click',()=>void generatePlan({withoutLocation:true}))
        return
      }
    }

    els.generate.querySelector('span').textContent='Generating with Gemini…'
    setStatus(`<div class="status-spinner" aria-hidden="true"></div><p>Gemini is building a plan from today’s Fuel data${withoutLocation?'':' and nearby options'}…</p>`,{html:true})
    const response=await fetch('/api/meal-plan',{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({
        ...location,
        localTime:new Date().toString(),
        timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Los_Angeles',
      }),
    })
    const payload=await response.json()
    if(response.status===409&&payload.connectUrl){
      setStatus(`<div><strong>Gemini authorization is required</strong><p class="location-note">Reconnect Google to grant the required Gemini scope.</p></div><div class="status-actions"><a href="${escapeAttribute(payload.connectUrl)}">Connect Google for Gemini</a></div>`,{html:true})
      return
    }
    if(!response.ok)throw new Error(payload.error||'Unable to generate a meal plan.')

    state.status=payload
    renderBudget(payload.budget)
    renderPlan(payload.plan||'',payload.sources||[])
    els.generatedTime.textContent=`Generated ${new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(new Date(payload.generatedAt||Date.now()))}`
    els.plan.hidden=false
    els.status.hidden=true
    els.plan.scrollIntoView({behavior:'smooth',block:'start'})
  }catch(error){
    setStatus(error instanceof Error?error.message:'Unable to generate a meal plan.',{error:true})
  }finally{
    state.busy=false
    els.generate.disabled=!state.status?.connected
    els.generate.querySelector('span').textContent='Use location and generate'
  }
}

function renderPlan(text,sources){
  const headings=new Set(['MEAL PLAN FOR THE REST OF TODAY','BUDGET','PLAN','OPTIONAL LOCAL ALTERNATIVES','ESTIMATED PLAN TOTAL','WHY THIS FITS'])
  const lines=String(text).replace(/\r/g,'').split('\n')
  const blocks=[]
  let current={heading:'MEAL PLAN FOR THE REST OF TODAY',lines:[]}
  for(const raw of lines){
    const cleaned=raw.replace(/^#{1,6}\s*/,'').replace(/\*\*/g,'').trim()
    if(headings.has(cleaned.toUpperCase())){
      if(current.lines.length||blocks.length)blocks.push(current)
      current={heading:cleaned.toUpperCase(),lines:[]}
    }else if(cleaned){
      current.lines.push(cleaned)
    }
  }
  if(current.lines.length||!blocks.length)blocks.push(current)
  els.output.innerHTML=blocks.map(block=>{
    const listLike=block.lines.filter(line=>/^[-•*]|^\d+[.)]/.test(line)).length>=Math.max(1,Math.ceil(block.lines.length/2))
    const content=listLike
      ?`<ul>${block.lines.map(line=>`<li>${escapeHtml(line.replace(/^[-•*]\s*|^\d+[.)]\s*/,''))}</li>`).join('')}</ul>`
      :`<p>${block.lines.map(escapeHtml).join('\n')}</p>`
    return `<section class="plan-block"><h3>${escapeHtml(titleCase(block.heading))}</h3>${content}</section>`
  }).join('')

  if(sources.length){
    els.sources.hidden=false
    els.sourceList.innerHTML=sources.map(source=>`<a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title||'Google Maps place')}</a>`).join('')
  }else{
    els.sources.hidden=true
    els.sourceList.innerHTML=''
  }
}

function titleCase(value){
  return value.toLowerCase().replace(/(^|\s)\S/g,match=>match.toUpperCase())
}

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))
}

function escapeAttribute(value){
  return escapeHtml(value)
}

els.generate.addEventListener('click',()=>void generatePlan())
void loadStatus()
