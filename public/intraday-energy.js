function parseClock(time){
  if(!time)return null
  const match=String(time).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i)
  if(!match)return null
  let hour=Number(match[1]);const minute=Number(match[2]);const meridiem=match[3]?.toUpperCase()
  if(meridiem==='PM'&&hour<12)hour+=12
  if(meridiem==='AM'&&hour===12)hour=0
  return Math.max(0,Math.min(1440,hour*60+minute))
}

function currentMinute(){const now=new Date();return now.getHours()*60+now.getMinutes()}
function fmtTime(minute){const hour=Math.floor(minute/60),m=minute%60;return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(new Date(2000,0,1,hour,m))}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function pointsToPath(points,x,y){return points.map((point,index)=>`${index?'L':'M'} ${x(point.minute).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')}

function makeSeries(payload){
  const summary=payload?.today?.summary||{}
  const foods=payload?.today?.foodEntries||[]
  const end=Math.max(1,currentMinute())
  const active=Math.max(0,Number(summary.activeEnergy)||0)
  const total=Math.max(active,Number(summary.totalExpenditure)||0)
  const resting=Math.max(0,total-active)
  const intervals=[]
  for(let minute=0;minute<=end;minute+=30)intervals.push(minute)
  if(intervals.at(-1)!==end)intervals.push(end)
  const consumedEvents=foods.map(entry=>({minute:parseClock(entry.time),calories:Number(entry.calories)||0})).filter(event=>event.minute!=null&&event.minute<=end).sort((a,b)=>a.minute-b.minute)
  const reportedConsumed=Math.max(0,Number(summary.caloriesConsumed)||0)
  const eventTotal=consumedEvents.reduce((sum,event)=>sum+event.calories,0)
  if(reportedConsumed>eventTotal+1)consumedEvents.push({minute:end,calories:reportedConsumed-eventTotal})
  let cumulative=0,eventIndex=0
  const consumed=intervals.map(minute=>{while(eventIndex<consumedEvents.length&&consumedEvents[eventIndex].minute<=minute){cumulative+=consumedEvents[eventIndex].calories;eventIndex++}return{minute,value:cumulative}})
  const activeSeries=intervals.map(minute=>({minute,value:active*(minute/end)}))
  const totalSeries=intervals.map(minute=>({minute,value:(resting+active)*(minute/end)}))
  return{end,consumed,active:activeSeries,total:totalSeries}
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
  wrap.innerHTML=`<div class="intraday-energy-head"><div><span class="eyebrow">TODAY OVER TIME</span><h3>Cumulative energy</h3><p>Midnight to ${fmtTime(series.end)}. Expenditure lines interpolate the latest Apple Health totals; intake steps up at logged meal times.</p></div><div class="intraday-legend"><span><i class="total-dot"></i>Total expended</span><span><i class="active-dot"></i>Active</span><span><i class="consumed-dot"></i>Consumed</span></div></div><div class="intraday-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative total expended, active energy, and consumed calories from midnight to the current time"><g class="intraday-grid">${yTicks.map(value=>`<line x1="${pad.left}" x2="${width-pad.right}" y1="${y(value)}" y2="${y(value)}"/><text x="${pad.left-10}" y="${y(value)+4}" text-anchor="end">${value}</text>`).join('')}</g><path class="intraday-line total-line" d="${pointsToPath(series.total,x,y)}"/><path class="intraday-line active-line" d="${pointsToPath(series.active,x,y)}"/><path class="intraday-line consumed-line" d="${pointsToPath(series.consumed,x,y)}"/>${['total','active','consumed'].map(key=>series[key].map(point=>`<circle class="intraday-point ${key}-point" cx="${x(point.minute)}" cy="${y(point.value)}" r="2.5"><title>${fmtTime(point.minute)} · ${Math.round(point.value)} kcal</title></circle>`).join('')).join('')}<g class="intraday-x">${ticks.map(minute=>`<text x="${x(minute)}" y="${height-14}" text-anchor="middle">${fmtTime(minute)}</text>`).join('')}</g><text class="intraday-y-label" x="15" y="${height/2}" transform="rotate(-90 15 ${height/2})" text-anchor="middle">Cumulative kcal</text></svg></div>`
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
