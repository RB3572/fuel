const ENERGY_TIME_ZONE='America/Los_Angeles'
const energyClockFormatter=new Intl.DateTimeFormat('en-US',{timeZone:ENERGY_TIME_ZONE,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})

function clockParts(value){
  const parts=Object.fromEntries(energyClockFormatter.formatToParts(value).map(part=>[part.type,part.value]))
  return{hour:Number(parts.hour)||0,minute:Number(parts.minute)||0,second:Number(parts.second)||0}
}

function currentMinute(){
  const parts=clockParts(new Date())
  return parts.hour*60+parts.minute+parts.second/60
}

function minuteOfDay(value){
  const date=new Date(value)
  if(Number.isNaN(date.getTime()))return null
  const parts=clockParts(date)
  return parts.hour*60+parts.minute+parts.second/60
}

function fmtTime(minute){
  const total=Math.max(0,Math.min(1439,Math.round(minute)))
  const hour=Math.floor(total/60)
  const minutes=total%60
  const displayHour=hour%12||12
  return`${displayHour}:${String(minutes).padStart(2,'0')} ${hour>=12?'PM':'AM'}`
}

function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function pointsToPath(points,x,y){return points.map((point,index)=>`${index?'L':'M'} ${x(point.minute).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')}
function sortPoints(points){return points.sort((a,b)=>a.minute-b.minute)}

function makeSeries(payload){
  const source=payload?.intradayEnergy||{}
  const end=Math.max(1,currentMinute())
  const expenditure=Array.isArray(source.expenditure)?source.expenditure:[]
  const consumedRows=Array.isArray(source.consumed)?source.consumed:[]
  const active=sortPoints(expenditure.map(row=>({minute:minuteOfDay(row.collectedAt),value:Number(row.activeEnergy)})).filter(point=>point.minute!=null&&point.minute<=end&&Number.isFinite(point.value)))
  const total=sortPoints(expenditure.map(row=>({minute:minuteOfDay(row.collectedAt),value:Number(row.totalExpenditure)})).filter(point=>point.minute!=null&&point.minute<=end&&Number.isFinite(point.value)))
  const consumed=sortPoints(consumedRows.map(row=>({minute:minuteOfDay(row.collectedAt),value:Number(row.caloriesConsumed)})).filter(point=>point.minute!=null&&point.minute<=end&&Number.isFinite(point.value)))
  return{end,active,total,consumed}
}

function renderSeries(key,points,x,y){
  if(!points.length)return''
  const path=points.length>1?`<path class="intraday-line ${key}-line" d="${pointsToPath(points,x,y)}"/>`:''
  const dots=points.map(point=>`<circle class="intraday-point ${key}-point" cx="${x(point.minute)}" cy="${y(point.value)}" r="3.5"><title>${fmtTime(point.minute)} · ${Math.round(point.value)} kcal</title></circle>`).join('')
  return path+dots
}

function renderChart(payload){
  const hero=document.querySelector('.hero.panel')
  if(!hero||document.querySelector('[data-intraday-energy]'))return
  const series=makeSeries(payload)
  const all=[...series.consumed,...series.active,...series.total]
  const fixedMaximum=Math.max(100,...all.map(point=>point.value))*1.08
  const width=900,height=300,pad={left:58,right:22,top:34,bottom:45}
  const wrap=document.createElement('section')
  wrap.className='intraday-energy panel'
  wrap.dataset.intradayEnergy='true'
  wrap.innerHTML=`<div class="intraday-energy-head"><div><span class="eyebrow">TODAY OVER TIME</span><h3>Cumulative energy</h3><p>The default view spans 12:00 AM through the current time. Every marker is an actual Neon timestamp. Zoom changes only the time axis; the calorie scale stays fixed.</p></div><div class="intraday-legend"><span><i class="total-dot"></i>Total expended</span><span><i class="active-dot"></i>Active</span><span><i class="consumed-dot"></i>Consumed</span></div></div><div class="intraday-controls" aria-label="Energy chart controls"><button type="button" data-zoom-out aria-label="Zoom out on time axis">−</button><label>Time zoom<input data-zoom type="range" min="1" max="8" step="0.25" value="1"></label><strong data-zoom-label>1×</strong><button type="button" data-zoom-in aria-label="Zoom in on time axis">+</button><label class="intraday-pan-control">Time position<input data-pan type="range" min="0" max="100" step="1" value="100" disabled></label><button type="button" data-reset>Full day</button><span data-window-label>12:00 AM–${fmtTime(series.end)}</span></div><div class="intraday-chart"></div>`
  hero.insertAdjacentElement('afterend',wrap)

  const chart=wrap.querySelector('.intraday-chart')
  const zoomInput=wrap.querySelector('[data-zoom]')
  const panInput=wrap.querySelector('[data-pan]')
  const zoomLabel=wrap.querySelector('[data-zoom-label]')
  const windowLabel=wrap.querySelector('[data-window-label]')

  function renderPlot(){
    const zoom=clamp(Number(zoomInput.value)||1,1,8)
    const fullEnd=series.end
    const visibleSpan=Math.min(fullEnd,Math.max(15,fullEnd/zoom))
    const latestStart=Math.max(0,fullEnd-visibleSpan)
    const pan=clamp(Number(panInput.value)||0,0,100)/100
    const start=latestStart*pan
    const finish=Math.min(fullEnd,start+visibleSpan)
    const domain=Math.max(1,finish-start)
    const x=minute=>pad.left+((minute-start)/domain)*(width-pad.left-pad.right)
    const y=value=>height-pad.bottom-(value/fixedMaximum)*(height-pad.top-pad.bottom)
    const ticks=[0,.25,.5,.75,1].map(fraction=>start+domain*fraction)
    const yTicks=[0,.25,.5,.75,1].map(fraction=>Math.round(fixedMaximum*fraction))
    const visible={
      total:series.total.filter(point=>point.minute>=start&&point.minute<=finish),
      active:series.active.filter(point=>point.minute>=start&&point.minute<=finish),
      consumed:series.consumed.filter(point=>point.minute>=start&&point.minute<=finish),
    }
    const hasVisible=visible.total.length||visible.active.length||visible.consumed.length
    chart.innerHTML=hasVisible?`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Recorded cumulative total expended, active energy, and consumed calories between ${fmtTime(start)} and ${fmtTime(finish)}"><g class="intraday-grid">${yTicks.map(value=>`<line x1="${pad.left}" x2="${width-pad.right}" y1="${y(value)}" y2="${y(value)}"/><text x="${pad.left-10}" y="${y(value)+4}" text-anchor="end">${value}</text>`).join('')}</g>${renderSeries('total',visible.total,x,y)}${renderSeries('active',visible.active,x,y)}${renderSeries('consumed',visible.consumed,x,y)}<g class="intraday-x">${ticks.map(minute=>`<text x="${x(minute)}" y="${height-14}" text-anchor="middle">${fmtTime(minute)}</text>`).join('')}</g><text class="intraday-y-label" x="15" y="${height/2}" transform="rotate(-90 15 ${height/2})" text-anchor="middle">Cumulative kcal</text></svg>`:'<div class="empty">No recorded energy measurements fall inside this time window.</div>'
    panInput.disabled=zoom<=1
    zoomLabel.textContent=`${Number.isInteger(zoom)?zoom:zoom.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}×`
    windowLabel.textContent=`${fmtTime(start)}–${fmtTime(finish)}`
  }

  zoomInput.addEventListener('input',renderPlot)
  panInput.addEventListener('input',renderPlot)
  wrap.querySelector('[data-zoom-out]').addEventListener('click',()=>{zoomInput.value=String(clamp((Number(zoomInput.value)||1)-.5,1,8));renderPlot()})
  wrap.querySelector('[data-zoom-in]').addEventListener('click',()=>{zoomInput.value=String(clamp((Number(zoomInput.value)||1)+.5,1,8));renderPlot()})
  wrap.querySelector('[data-reset]').addEventListener('click',()=>{zoomInput.value='1';panInput.value='100';renderPlot()})
  renderPlot()
}

async function addIntradayEnergy(){
  if(location.pathname!=='/'&&location.pathname!=='/index.html')return
  if(document.querySelector('[data-intraday-energy]'))return
  try{const response=await fetch('/api/mlog',{cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)return;renderChart(await response.json())}catch{}
}

new MutationObserver(addIntradayEnergy).observe(document.documentElement,{childList:true,subtree:true})
addEventListener('DOMContentLoaded',addIntradayEnergy)
addIntradayEnergy()