function currentMinute(){const now=new Date();return now.getHours()*60+now.getMinutes()}
function minuteOfDay(value){const date=new Date(value);return Number.isNaN(date.getTime())?null:date.getHours()*60+date.getMinutes()+date.getSeconds()/60}
function fmtTime(minute){const hour=Math.floor(minute/60),m=Math.round(minute%60);return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(new Date(2000,0,1,hour,m))}
function pointsToPath(points,x,y){return points.map((point,index)=>`${index?'L':'M'} ${x(point.minute).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')}

function makeSeries(payload){
  const source=payload?.intradayEnergy||{}
  const end=Math.max(1,currentMinute())
  const expenditure=Array.isArray(source.expenditure)?source.expenditure:[]
  const consumedRows=Array.isArray(source.consumed)?source.consumed:[]
  const active=expenditure.map(row=>({minute:minuteOfDay(row.collectedAt),value:Number(row.activeEnergy)})).filter(point=>point.minute!=null&&point.minute<=end&&Number.isFinite(point.value))
  const total=expenditure.map(row=>({minute:minuteOfDay(row.collectedAt),value:Number(row.totalExpenditure)})).filter(point=>point.minute!=null&&point.minute<=end&&Number.isFinite(point.value))
  const consumed=consumedRows.map(row=>({minute:minuteOfDay(row.collectedAt),value:Number(row.caloriesConsumed)})).filter(point=>point.minute!=null&&point.minute<=end&&Number.isFinite(point.value))
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
  const width=900,height=300,pad={left:58,right:22,top:34,bottom:45}
  const all=[...series.consumed,...series.active,...series.total]
  const max=Math.max(100,...all.map(point=>point.value))*1.08
  const x=minute=>pad.left+(minute/series.end)*(width-pad.left-pad.right)
  const y=value=>height-pad.bottom-(value/max)*(height-pad.top-pad.bottom)
  const ticks=[0,.25,.5,.75,1].map(fraction=>Math.round(series.end*fraction))
  const yTicks=[0,.25,.5,.75,1].map(fraction=>Math.round(max*fraction))
  const wrap=document.createElement('section')
  wrap.className='intraday-energy panel'
  wrap.dataset.intradayEnergy='true'
  const hasPoints=all.length>0
  wrap.innerHTML=`<div class="intraday-energy-head"><div><span class="eyebrow">TODAY OVER TIME</span><h3>Cumulative energy</h3><p>Midnight to ${fmtTime(series.end)}. Every marker is an actual timestamp stored in Neon. No values are interpolated.</p></div><div class="intraday-legend"><span><i class="total-dot"></i>Total expended</span><span><i class="active-dot"></i>Active</span><span><i class="consumed-dot"></i>Consumed</span></div></div>${hasPoints?`<div class="intraday-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Recorded cumulative total expended, active energy, and consumed calories from midnight to the current time"><g class="intraday-grid">${yTicks.map(value=>`<line x1="${pad.left}" x2="${width-pad.right}" y1="${y(value)}" y2="${y(value)}"/><text x="${pad.left-10}" y="${y(value)+4}" text-anchor="end">${value}</text>`).join('')}</g>${renderSeries('total',series.total,x,y)}${renderSeries('active',series.active,x,y)}${renderSeries('consumed',series.consumed,x,y)}<g class="intraday-x">${ticks.map(minute=>`<text x="${x(minute)}" y="${height-14}" text-anchor="middle">${fmtTime(minute)}</text>`).join('')}</g><text class="intraday-y-label" x="15" y="${height/2}" transform="rotate(-90 15 ${height/2})" text-anchor="middle">Cumulative kcal</text></svg></div>`:'<div class="empty">No intraday energy measurements have been collected today.</div>'}`
  hero.insertAdjacentElement('afterend',wrap)
}

async function addIntradayEnergy(){
  if(location.pathname!=='/'&&location.pathname!=='/index.html')return
  if(document.querySelector('[data-intraday-energy]'))return
  try{const response=await fetch('/api/mlog',{cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)return;renderChart(await response.json())}catch{}
}

new MutationObserver(addIntradayEnergy).observe(document.documentElement,{childList:true,subtree:true})
addEventListener('DOMContentLoaded',addIntradayEnergy)
addIntradayEnergy()
