const state={payload:null,busy:false,location:null,image:null}
const els={
  status:document.getElementById('status-card'),
  chat:document.getElementById('chat-section'),
  thread:document.getElementById('chat-thread'),
  sources:document.getElementById('maps-sources'),
  sourceList:document.getElementById('source-list'),
  form:document.getElementById('chat-form'),
  input:document.getElementById('chat-input'),
  send:document.getElementById('send-button'),
  attach:document.getElementById('attach-button'),
  newPlan:document.getElementById('new-plan-button'),
  imageInput:document.getElementById('image-input'),
  preview:document.getElementById('image-preview'),
  previewImg:document.getElementById('preview-img'),
  removeImage:document.getElementById('remove-image'),
}

// Photos are downscaled in the browser: full-resolution phone images blow past the
// serverless body limit and slow Gemini down for no accuracy gain.
const MAX_IMAGE_DIMENSION=1280
const JPEG_QUALITY=.82
const PLAN_REQUEST_TIMEOUT_MS=35000
const CHAT_REQUEST_TIMEOUT_MS=42000

function loadImage(dataUrl){
  return new Promise((resolve,reject)=>{
    const image=new Image()
    image.onload=()=>resolve(image)
    image.onerror=()=>reject(new Error('That photo could not be read. Try a JPEG or PNG.'))
    image.src=dataUrl
  })
}

function readAsDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onerror=()=>reject(new Error('That photo could not be read.'))
    reader.onload=()=>resolve(String(reader.result||''))
    reader.readAsDataURL(file)
  })
}

async function prepareImage(file){
  const image=await loadImage(await readAsDataUrl(file))
  const scale=Math.min(1,MAX_IMAGE_DIMENSION/Math.max(image.width,image.height))
  const width=Math.max(1,Math.round(image.width*scale))
  const height=Math.max(1,Math.round(image.height*scale))
  const canvas=document.createElement('canvas')
  canvas.width=width
  canvas.height=height
  canvas.getContext('2d').drawImage(image,0,0,width,height)
  const jpeg=canvas.toDataURL('image/jpeg',JPEG_QUALITY)
  return {previewUrl:jpeg,mimeType:'image/jpeg',data:jpeg.split(',')[1]||''}
}

function setImage(image){
  state.image=image
  if(image){
    els.previewImg.src=image.previewUrl
    els.preview.hidden=false
  }else{
    els.previewImg.removeAttribute('src')
    els.preview.hidden=true
    els.imageInput.value=''
  }
}

function setStatus(message,{error=false,loading=false}={}){
  els.status.className=`status-card card${error?' error':''}`
  els.status.innerHTML=`${loading?'<div class="status-spinner" aria-hidden="true"></div>':''}<p>${escapeHtml(message)}</p>`
  els.status.hidden=false
}

function hideStatus(){els.status.hidden=true}
function showGenerationError(message){setStatus(message,{error:true});const retry=document.createElement('button');retry.type='button';retry.className='status-retry';retry.textContent='Try again';retry.addEventListener('click',()=>void generatePlan(),{once:true});els.status.append(retry)}
async function timedFetch(url,options={},timeoutMs=PLAN_REQUEST_TIMEOUT_MS){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{return await fetch(url,{...options,signal:controller.signal})}catch(error){if(error?.name==='AbortError')throw new Error('Fuel AI took too long to respond. Try again.');throw error}finally{clearTimeout(timer)}}

async function loadPlanner(){
  setStatus('Checking today’s Fuel data…',{loading:true})
  try{
    const response=await timedFetch('/api/meal-plan',{cache:'no-store',headers:{Accept:'application/json'}},15000)
    const payload=await response.json()
    if(response.status===401){
      location.replace(payload.signInUrl||'/api/auth/google/start?return_to=%2Fmeal-plan.html')
      return
    }
    if(!response.ok)throw new Error(payload.error||'Unable to load the meal planner.')
    state.payload=payload
    if(payload.plan&&!payload.needsGeneration){
      sessionStorage.removeItem('fuelGeminiReauthAttempted')
      renderConversation(payload)
      hideStatus()
      return
    }
    await generatePlan()
  }catch(error){
    setStatus(error instanceof Error?error.message:'Unable to load the meal planner.',{error:true})
  }
}

function getLocation(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('This browser does not support location access.'));return}
    navigator.geolocation.getCurrentPosition(
      position=>resolve({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}),
      error=>reject(new Error(locationError(error))),
      {enableHighAccuracy:true,timeout:12000,maximumAge:5*60*1000},
    )
  })
}

function locationError(error){
  if(error?.code===1)return 'Location permission was denied. Fuel will create the plan without nearby recommendations.'
  if(error?.code===2)return 'Your current location could not be determined. Fuel will create the plan without nearby recommendations.'
  if(error?.code===3)return 'Location access timed out. Fuel will create the plan without nearby recommendations.'
  return 'Location was unavailable. Fuel will create the plan without nearby recommendations.'
}

async function generatePlan(force=false){
  if(state.busy)return
  state.busy=true
  setComposerBusy(true)
  state.location=null
  setStatus(force?'Building a fresh plan from today’s Fuel data…':'Building a plan from today’s Fuel data…',{loading:true})
  try{
    const response=await timedFetch('/api/meal-plan',{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({
        action:'plan',
        force,
        localTime:new Date().toString(),
        timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Los_Angeles',
      }),
    },PLAN_REQUEST_TIMEOUT_MS)
    const payload=await response.json()
    if(payload.code==='gemini_scope_missing'&&payload.reauthorizeUrl){
      if(sessionStorage.getItem('fuelGeminiReauthAttempted')==='1')throw new Error('Fuel could not add Gemini access to the current Google session. Sign out of Fuel once, then sign back in.')
      sessionStorage.setItem('fuelGeminiReauthAttempted','1')
      location.replace(payload.reauthorizeUrl)
      return
    }
    if(!response.ok)throw new Error(payload.error||'Unable to generate a meal plan.')
    sessionStorage.removeItem('fuelGeminiReauthAttempted')
    state.payload=payload
    renderConversation(payload)
    hideStatus()
  }catch(error){
    showGenerationError(error instanceof Error?error.message:'Unable to generate a meal plan.')
  }finally{
    state.busy=false
    setComposerBusy(false)
  }
}

function renderConversation(payload){
  if(!payload?.plan)return
  els.chat.hidden=false
  const messages=Array.isArray(payload.messages)?payload.messages:[]
  els.thread.innerHTML=''
  appendBubble('assistant',payload.plan,true)
  for(const message of messages)appendBubble(message.role,message.text,false)
  renderSources(payload.sources||[])
  requestAnimationFrame(()=>{els.thread.scrollTop=els.thread.scrollHeight})
}

function appendBubble(role,text,isPlan=false,imageUrl=null){
  const article=document.createElement('article')
  article.className=`chat-bubble ${role==='user'?'user-bubble':'assistant-bubble'}${isPlan?' plan-bubble':''}`
  const label=document.createElement('span')
  label.className='bubble-label'
  label.textContent=role==='user'?'You':'Fuel AI'
  article.append(label)
  if(imageUrl){
    const image=document.createElement('img')
    image.className='bubble-image'
    image.src=imageUrl
    image.alt='Food photo'
    article.append(image)
  }
  if(text){
    const content=document.createElement('div')
    content.className='bubble-content'
    if(role==='user')content.textContent=String(text)
    else renderAssistantContent(content,text)
    article.append(content)
  }
  els.thread.append(article)
}

function renderSources(sources){
  if(Array.isArray(sources)&&sources.length){
    els.sources.hidden=false
    els.sourceList.innerHTML=sources.map(source=>`<a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title||'Google Maps place')}</a>`).join('')
  }else{
    els.sources.hidden=true
    els.sourceList.innerHTML=''
  }
}

async function sendMessage(message,{retried=false,image=null}={}){
  const text=String(message||'').trim()
  if((!text&&!image)||state.busy)return
  state.busy=true
  setComposerBusy(true)
  appendBubble('user',text,false,image?.previewUrl||null)
  appendTypingBubble()
  els.thread.scrollTop=els.thread.scrollHeight
  try{
    const response=await timedFetch('/api/meal-plan',{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({
        action:'chat',
        message:text,
        ...(image?{image:{mimeType:image.mimeType,data:image.data}}:{}),
        ...(state.location||{}),
        localTime:new Date().toString(),
        timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Los_Angeles',
      }),
    },CHAT_REQUEST_TIMEOUT_MS)
    const payload=await response.json()
    removeTypingBubble()
    if(response.status===409&&payload.code==='plan_stale'&&!retried){
      state.busy=false
      await generatePlan()
      await sendMessage(text,{retried:true,image})
      return
    }
    if(!response.ok)throw new Error(payload.error||'Unable to answer that message.')
    state.payload=payload
    if(payload.planUpdated&&payload.plan){
      // This message created a new plan (e.g. food logged). Start fresh: reset the
      // thread so only the new plan remains, matching plan generation.
      renderConversation(payload)
    }else{
      // Append rather than re-render the thread: a full re-render rebuilds from the
      // server's text-only history and would drop the photo the user just sent.
      appendBubble('assistant',payload.reply)
      renderSources(payload.sources||[])
      els.thread.scrollTop=els.thread.scrollHeight
    }
  }catch(error){
    removeTypingBubble()
    appendBubble('assistant',friendlyClientError(error instanceof Error?error.message:'Unable to answer that message.'))
  }finally{
    state.busy=false
    setComposerBusy(false)
    focusComposerOnDesktop()
  }
}

function appendTypingBubble(){
  const article=document.createElement('article')
  article.id='typing-bubble'
  article.className='chat-bubble assistant-bubble typing-bubble'
  article.innerHTML='<span class="bubble-label">Fuel AI</span><div class="typing-dots"><i></i><i></i><i></i></div>'
  els.thread.append(article)
}
function removeTypingBubble(){document.getElementById('typing-bubble')?.remove()}

function setComposerBusy(busy){
  els.input.disabled=busy
  els.send.disabled=busy
  els.attach.disabled=busy
  if(els.newPlan)els.newPlan.disabled=busy
}

function resizeInput(){
  els.input.style.height='auto'
  els.input.style.height=`${Math.min(150,Math.max(44,els.input.scrollHeight))}px`
}

function cleanAssistantText(value){let text=String(value??'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');for(let i=0;i<3;i++){try{const parsed=JSON.parse(text);if(typeof parsed==='string'){text=parsed.trim();continue}if(parsed&&typeof parsed.reply==='string'){text=parsed.reply.trim();continue}if(parsed&&typeof parsed.plan==='string'){text=parsed.plan.trim();continue}}catch{}break}const match=text.match(/[\"'](?:reply|plan)[\"']\s*:\s*[\"']([\s\S]*)/);if(/^\s*\{/.test(text)&&match)text=match[1].replace(/[\"']?\s*[}]+\s*$/,'');return text.replace(/^\s*[\[{]+\s*/,'').replace(/\s*[\]}]+\s*$/,'').trim()}
// Render inline markdown (**bold**, __bold__, *italic*, `code`) as real DOM nodes.
// Text is added via textContent, so it is always escaped — no HTML injection.
function appendInlineMarkdown(parent,value){
  const text=String(value||'')
  const rx=/(\*\*|__)(.+?)\1|`([^`]+)`|\*(\S(?:[^*]*\S)?)\*/g
  let last=0,m
  while((m=rx.exec(text))){
    if(m.index>last)parent.append(document.createTextNode(text.slice(last,m.index)))
    let el
    if(m[2]!=null){el=document.createElement('strong');el.textContent=m[2]}
    else if(m[3]!=null){el=document.createElement('code');el.textContent=m[3]}
    else{el=document.createElement('em');el.textContent=m[4]}
    parent.append(el)
    last=rx.lastIndex
  }
  if(last<text.length)parent.append(document.createTextNode(text.slice(last)))
}
function renderAssistantContent(container,value){
  const text=cleanAssistantText(value).replace(/\r\n?/g,'\n')
  container.classList.add('is-structured')
  const lines=text.split('\n')
  let paragraph=[]
  const flushParagraph=()=>{if(!paragraph.length)return;const p=document.createElement('p');appendInlineMarkdown(p,paragraph.join(' '));container.append(p);paragraph=[]}
  for(const rawLine of lines){
    const line=rawLine.trim()
    if(!line){flushParagraph();continue}
    const mdHeading=line.match(/^#{1,4}\s+(.+)$/)
    const planHeading=/^(MEAL PLAN FOR THE REST OF TODAY|TARGET|PLAN|ESTIMATED PLAN TOTAL|WHY THIS FITS|BREAKFAST|LUNCH|DINNER|MORNING SNACK|AFTERNOON SNACK|EVENING SNACK|SNACK|DESSERT)$/i.test(line.replace(/:$/,'').trim())
    const bullet=line.match(/^(?:[-•]|\*(?=\s)|\d+[.)])\s+(.+)$/)
    if(mdHeading||planHeading){flushParagraph();const h=document.createElement('h3');appendInlineMarkdown(h,(mdHeading?mdHeading[1]:line).replace(/:$/,'').trim());container.append(h);continue}
    if(bullet){flushParagraph();const item=document.createElement('div');item.className='bubble-list-item';const marker=document.createElement('i');marker.textContent='•';const copy=document.createElement('span');appendInlineMarkdown(copy,bullet[1]);item.append(marker,copy);container.append(item);continue}
    paragraph.push(line)
  }
  flushParagraph()
}
function friendlyClientError(value){const text=String(value||'');return /Invalid JSON payload|generation_config\.response_schema|Unknown name \"additionalProperties\"|Cannot find field/i.test(text)?'Fuel AI hit a response-format issue. Please try that message again.':text}
function focusComposerOnDesktop(){if(window.matchMedia('(hover: hover) and (pointer: fine)').matches)els.input.focus({preventScroll:true})}
// The app shell is sized to the visual viewport, so the document itself must never
// scroll. Mobile browsers still scroll the whole page when the composer is focused
// (to lift the field above the keyboard); snap it back so the view never jumps.
function pinViewport(){if(window.scrollX!==0||window.scrollY!==0)window.scrollTo(0,0);const scroller=document.scrollingElement;if(scroller&&scroller.scrollTop!==0)scroller.scrollTop=0}
function syncViewportHeight(){const height=window.visualViewport?.height||window.innerHeight;document.documentElement.style.setProperty('--app-height',`${Math.round(height)}px`);pinViewport()}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
function escapeAttribute(value){return escapeHtml(value)}

els.form.addEventListener('submit',event=>{
  event.preventDefault()
  const message=els.input.value.trim()
  const image=state.image
  if(!message&&!image)return
  els.input.value=''
  setImage(null)
  resizeInput()
  void sendMessage(message,{image})
})
els.newPlan?.addEventListener('click',()=>{if(!state.busy)void generatePlan(true)})
els.attach.addEventListener('click',()=>els.imageInput.click())
els.removeImage.addEventListener('click',()=>setImage(null))
els.imageInput.addEventListener('change',async()=>{
  const file=els.imageInput.files?.[0]
  if(!file)return
  try{
    setImage(await prepareImage(file))
    focusComposerOnDesktop()
  }catch(error){
    setImage(null)
    setStatus(error instanceof Error?error.message:'That photo could not be read.',{error:true})
  }
})
els.input.addEventListener('input',resizeInput)
els.input.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();els.form.requestSubmit()}
})
// Focusing the input opens the keyboard; counteract the browser's scroll-into-view and,
// once the viewport settles, keep the newest message and the composer in view.
els.input.addEventListener('focus',()=>{
  pinViewport()
  requestAnimationFrame(pinViewport)
  setTimeout(()=>{pinViewport();els.thread.scrollTop=els.thread.scrollHeight},300)
})
syncViewportHeight()
window.addEventListener('resize',syncViewportHeight,{passive:true})
window.visualViewport?.addEventListener('resize',syncViewportHeight,{passive:true})
window.visualViewport?.addEventListener('scroll',syncViewportHeight,{passive:true})
resizeInput()
void loadPlanner()

// Shared Fuel nav menu (Dashboard + Sign out) — same trigger button as every page.
const fuelMenuBtn=document.getElementById('fuel-menu-btn'),fuelMenu=document.getElementById('fuel-menu')
fuelMenuBtn?.addEventListener('click',event=>{event.stopPropagation();const open=fuelMenu.hidden;fuelMenu.hidden=!open;fuelMenuBtn.setAttribute('aria-expanded',String(open))})
document.addEventListener('click',event=>{if(fuelMenu&&!fuelMenu.hidden&&!fuelMenu.contains(event.target)&&event.target!==fuelMenuBtn){fuelMenu.hidden=true;fuelMenuBtn.setAttribute('aria-expanded','false')}})
document.getElementById('fuel-signout')?.addEventListener('click',async()=>{try{await fetch('/api/auth/logout',{method:'POST'})}catch{/* ignore */}window.location.href='/'})
