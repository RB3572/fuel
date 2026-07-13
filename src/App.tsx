import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Activity, Clock3, Database, Footprints, HeartPulse, LogOut, Moon, RefreshCw, Route, ShieldCheck } from 'lucide-react'
import './App.css'
import './ChartLabels.css'

type N = number | null
type RangeKey = 'day' | 'week' | 'month'
type SessionUser = { email?: string; name?: string; picture?: string }
type Summary = { date:string; partialDay:boolean; caloriesConsumed:N; restingEnergy:N; activeEnergy:N; totalExpenditure:N; energyBalance:N; protein:N; carbs:N; fat:N; fiber:N; sleepHours:N; restingHeartRate:N; hrv:N; respiratoryRate:N; stepCount:N; distanceMiles:N; exerciseMinutes:N; vo2Max:N }
type FoodEntry = { time:string; meal:string; food:string; portion:string; calories:N; protein:N; carbs:N; fat:N; fiber:N }
type WorkoutEntry = { time:string; activity:string; durationMinutes:N; activeCalories:N; distanceMiles:N; averagePace:string; averageHeartRate:N; effort:string; location:string; swimmingDistanceYards:N; stepCount:N; dataQuality:string }
type TrendPoint = Summary & { workoutCount:number }
type GoalRange = { minimum:N; target:N; maximum:N }
type DashboardData = { generatedAt:string; today:{summary:Summary;foodEntries:FoodEntry[];workouts:WorkoutEntry[];supplements:Array<{name:string;dose:string}>}; goals:Partial<Record<'calories'|'protein'|'carbs'|'fat'|'fiber'|'sleepHours',GoalRange>>; trends:TrendPoint[]; coverage:{days:number;workouts:number;foodEntries:number}; storage?:string }

const fmt = (v:N|undefined, d=0) => v == null ? 'Not logged' : new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(v)
const dateFmt = (s:string) => new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(`${s}T12:00:00`))
const longDate = (s:string) => new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric'}).format(new Date(`${s}T12:00:00`))
const duration = (v:N|undefined) => v == null ? 'Not logged' : `${Math.floor(v)}h ${Math.round((v%1)*60)}m`

export default function App(){
  const [session,setSession]=useState<{loading:boolean;authenticated:boolean;user:SessionUser|null}>({loading:true,authenticated:false,user:null})
  const [data,setData]=useState<DashboardData|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [range,setRange]=useState<RangeKey>('day')

  const load=useCallback(async()=>{ setLoading(true); setError(''); try{ const r=await fetch('/api/mlog',{cache:'no-store',headers:{Accept:'application/json'}}); if(r.status===401){setSession({loading:false,authenticated:false,user:null});setData(null);return} const p=await r.json(); if(!r.ok) throw new Error(p.error||'Unable to load Fuel'); setData(p)}catch(e){setError(e instanceof Error?e.message:'Unable to load Fuel')}finally{setLoading(false)}},[])
  useEffect(()=>{fetch('/api/auth/session').then(r=>r.json()).then(p=>setSession({loading:false,authenticated:p.authenticated,user:p.user||null})).catch(()=>setSession({loading:false,authenticated:false,user:null}))},[])
  useEffect(()=>{if(!session.authenticated)return; void load(); const id=setInterval(load,30000); const focus=()=>void load(); addEventListener('focus',focus); return()=>{clearInterval(id);removeEventListener('focus',focus)}},[session.authenticated,load])
  const logout=async()=>{await fetch('/api/auth/logout',{method:'POST'});setSession({loading:false,authenticated:false,user:null});setData(null)}
  if(session.loading) return <Centered title="Fuel" text="Loading your dashboard." />
  if(!session.authenticated) return <SignIn />
  const s=data?.today.summary
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><b>F</b><div><h1>Fuel</h1><p>{longDate(s?.date||new Date().toISOString().slice(0,10))}</p></div></div><div className="user"><div><strong>{session.user?.name||'Signed in'}</strong><span>{session.user?.email}</span></div><button onClick={load} aria-label="Refresh"><RefreshCw size={17} className={loading?'spin':''}/></button><button onClick={logout} aria-label="Sign out"><LogOut size={17}/></button></div></header>
    {error&&<div className="error">{error}</div>}

    <EnergyHero summary={s} trends={data?.trends||[]} range={range} setRange={setRange}/>

    <Section title="Nutrition" detail="Daily intake compared with targets" />
    <section className="panel nutrition-panel">
      <GoalRing label="Calories" value={s?.caloriesConsumed} target={data?.goals.calories?.target ?? Math.max(0,(s?.totalExpenditure||2300)-350)} unit="kcal" />
      <GoalBar label="Protein" value={s?.protein} target={data?.goals.protein?.target||112} unit="g" />
      <GoalBar label="Carbohydrates" value={s?.carbs} target={data?.goals.carbs?.target||300} unit="g" />
      <GoalBar label="Fat" value={s?.fat} target={data?.goals.fat?.target||60} unit="g" />
      <GoalBar label="Fiber" value={s?.fiber} target={data?.goals.fiber?.target||30} unit="g" />
    </section>

    <Section title="Food consumed" detail={`${data?.today.foodEntries.length||0} entries today`} />
    <section className="panel"><EntryList empty="No food logged today.">{(data?.today.foodEntries||[]).map((e,i)=><FoodRow key={i} e={e}/>)}</EntryList></section>

    <Section title="Activity" detail="Movement and training from Apple Health" />
    <section className="metric-grid">
      <Metric icon={<Activity/>} label="Active energy" value={s?.activeEnergy} unit="kcal" />
      <Metric icon={<Clock3/>} label="Exercise" value={s?.exerciseMinutes} unit="min" />
      <Metric icon={<Route/>} label="Distance" value={s?.distanceMiles} unit="mi" decimals={2}/>
      <Metric icon={<Footprints/>} label="Steps" value={s?.stepCount} unit="" />
    </section>

    <Section title="Workouts" detail={`${data?.today.workouts.length||0} sessions`} />
    <section className="panel"><EntryList empty="No workouts logged today.">{(data?.today.workouts||[]).map((e,i)=><WorkoutRow key={i} e={e}/>)}</EntryList></section>

    <Section title="Steps" detail="Interactive 30-day movement trend" />
    <section className="panel"><InteractiveLine data={data?.trends||[]} metric="stepCount" unit="steps" chartTitle="Daily steps" yLabel="Steps" /></section>

    <Section title="Vitals" detail="Resting cardiovascular and respiratory measures" />
    <section className="metric-grid">
      <Metric icon={<HeartPulse/>} label="Resting heart rate" value={s?.restingHeartRate} unit="bpm" />
      <Metric icon={<Activity/>} label="HRV" value={s?.hrv} unit="ms" />
      <Metric icon={<Activity/>} label="Respiratory rate" value={s?.respiratoryRate} unit="/min" decimals={1}/>
      <Metric icon={<Activity/>} label="VO₂ max" value={s?.vo2Max} unit="mL/kg/min" decimals={1}/>
    </section>
    <section className="panel"><InteractiveLine data={data?.trends||[]} metric="restingHeartRate" unit="bpm" chartTitle="Resting heart rate trend" yLabel="Beats per minute" /></section>

    <Section title="Recovery" detail="Sleep and readiness context" />
    <section className="recovery-grid"><Metric icon={<Moon/>} label="Sleep" value={s?.sleepHours} unit="h" display={duration(s?.sleepHours)}/><section className="panel"><InteractiveLine data={data?.trends||[]} metric="sleepHours" unit="h" decimals={1} chartTitle="Sleep duration" yLabel="Hours" /></section></section>

    <footer><Database size={15}/><span>{data?.coverage.days||0} days · {data?.coverage.workouts||0} workouts · {data?.coverage.foodEntries||0} food entries · Neon Postgres</span></footer>
  </main>
}

function EnergyHero({summary,trends,range,setRange}:{summary:Summary|undefined;trends:TrendPoint[];range:RangeKey;setRange:(r:RangeKey)=>void}){
  const days=range==='day'?1:range==='week'?7:30
  const visible=trends.slice(-days)
  const consumed=visible.reduce((a,p)=>a+(p.caloriesConsumed||0),0)
  const expended=visible.reduce((a,p)=>a+(p.totalExpenditure||0),0)
  const balance=consumed&&expended?consumed-expended:null
  return <section className="hero panel"><div className="hero-head"><div><span className="eyebrow">ENERGY BALANCE</span><h2>{balance==null?'Incomplete data':balance>0?`${fmt(balance)} kcal surplus`:`${fmt(Math.abs(balance))} kcal deficit`}</h2><p>{range==='day'?'Today':range==='week'?'Last 7 days':'Last 30 days'} · intake versus total expenditure</p></div><div className="tabs">{(['day','week','month'] as RangeKey[]).map(r=><button className={range===r?'active':''} onClick={()=>setRange(r)} key={r}>{r==='day'?'Day':r==='week'?'Week':'Month'}</button>)}</div></div><EnergyInteractiveChart data={visible}/><div className="hero-stats"><Stat label="Consumed" value={consumed||summary?.caloriesConsumed} /><Stat label="Resting" value={range==='day'?summary?.restingEnergy:visible.reduce((a,p)=>a+(p.restingEnergy||0),0)} /><Stat label="Active" value={range==='day'?summary?.activeEnergy:visible.reduce((a,p)=>a+(p.activeEnergy||0),0)} /><Stat label="Expended" value={expended||summary?.totalExpenditure} /></div></section>
}

function EnergyInteractiveChart({data}:{data:TrendPoint[]}){
  const [active,setActive]=useState(Math.max(0,data.length-1))
  const max=Math.max(1,...data.flatMap(p=>[p.caloriesConsumed||0,p.totalExpenditure||0]))
  if(!data.length)return <div className="empty">No energy data</div>
  const p=data[active]||data.at(-1)!
  return <div className="energy-viz" onMouseLeave={()=>setActive(data.length-1)}>
    <div className="chart-header-row"><div><strong className="chart-title">Daily energy intake and expenditure</strong><span className="chart-axis-note">Horizontal axis: date · Vertical axis: kilocalories</span></div><ChartLegend items={[['legend-consumed','Calories consumed'],['legend-expended','Total calories expended']]}/></div>
    <div className="tooltip"><strong>{dateFmt(p.date)}</strong><span>Consumed {fmt(p.caloriesConsumed)} kcal</span><span>Expended {fmt(p.totalExpenditure)} kcal</span><span>{p.caloriesConsumed!=null&&p.totalExpenditure!=null?`${p.caloriesConsumed-p.totalExpenditure>0?'+':''}${fmt(p.caloriesConsumed-p.totalExpenditure)} kcal balance`:'Balance unavailable'}</span></div>
    <div className="bars" aria-label="Energy chart by date">{data.map((d,i)=><button key={d.date} className={`bar-day ${i===active?'selected':''}`} onMouseEnter={()=>setActive(i)} onFocus={()=>setActive(i)} onClick={()=>setActive(i)} aria-label={`${dateFmt(d.date)}: ${fmt(d.caloriesConsumed)} calories consumed and ${fmt(d.totalExpenditure)} calories expended`}><span className="bar consumed" style={{height:`${Math.max(3,(d.caloriesConsumed||0)/max*100)}%`}}/><span className="bar burned" style={{height:`${Math.max(3,(d.totalExpenditure||0)/max*100)}%`}}/><small>{dateFmt(d.date)}</small></button>)}</div>
    <div className="x-axis-label">Date</div>
  </div>
}

function InteractiveLine({data,metric,unit,decimals=0,chartTitle,yLabel}:{data:TrendPoint[];metric:keyof TrendPoint;unit:string;decimals?:number;chartTitle:string;yLabel:string}){
  const points=data.map((p,i)=>({date:p.date,value:typeof p[metric]==='number'?p[metric] as number:null,i})).filter((p):p is {date:string;value:number;i:number}=>p.value!=null)
  const [active,setActive]=useState(Math.max(0,points.length-1))
  if(points.length<2)return <div className="empty">Insufficient data</div>
  const max=Math.max(...points.map(p=>p.value)),min=Math.min(...points.map(p=>p.value)),w=760,h=190,pad=24,range=max-min||1
  const xy=points.map((p,i)=>({...p,x:pad+i/(points.length-1)*(w-pad*2),y:pad+(max-p.value)/range*(h-pad*2)}))
  const a=xy[active]||xy.at(-1)!
  const first=xy[0],last=xy.at(-1)!
  return <div className="interactive-line" onMouseLeave={()=>setActive(points.length-1)}>
    <div className="chart-header-row"><div><strong className="chart-title">{chartTitle}</strong><span className="chart-axis-note">Horizontal axis: date · Vertical axis: {yLabel}</span></div><ChartLegend items={[['legend-line',chartTitle]]}/></div>
    <div className="line-tooltip"><strong>{dateFmt(a.date)}</strong><span>{fmt(a.value,decimals)} {unit}</span></div>
    <div className="chart-stage"><span className="y-axis-label">{yLabel}</span><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${chartTitle}, plotted by date`} onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect(); const idx=Math.round(((e.clientX-r.left)/r.width)*(points.length-1));setActive(Math.max(0,Math.min(points.length-1,idx)))}}><defs><linearGradient id={`fill-${String(metric)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopOpacity=".18"/><stop offset="1" stopOpacity="0"/></linearGradient></defs><line className="gridline" x1={pad} x2={w-pad} y1={pad} y2={pad}/><line className="gridline" x1={pad} x2={w-pad} y1={h-pad} y2={h-pad}/><path className="area" d={`M ${xy[0].x} ${h-pad} L ${xy.map(p=>`${p.x} ${p.y}`).join(' L ')} L ${xy.at(-1)!.x} ${h-pad} Z`} fill={`url(#fill-${String(metric)})`}/><polyline points={xy.map(p=>`${p.x},${p.y}`).join(' ')} fill="none"/><line className="cursor" x1={a.x} x2={a.x} y1={pad} y2={h-pad}/>{xy.map((p,i)=><circle key={p.date} cx={p.x} cy={p.y} r={i===active?6:3} onClick={()=>setActive(i)}/>)}</svg><span className="y-max-label">{fmt(max,decimals)} {unit}</span><span className="y-min-label">{fmt(min,decimals)} {unit}</span></div>
    <div className="line-axis-footer"><span>{dateFmt(first.date)}</span><strong>Date</strong><span>{dateFmt(last.date)}</span></div>
  </div>
}

function ChartLegend({items}:{items:Array<[string,string]>}){return <div className="chart-legend" aria-label="Chart legend">{items.map(([className,label])=><span key={label}><i className={className}/>{label}</span>)}</div>}
function GoalRing({label,value,target,unit}:{label:string;value:N|undefined;target:number;unit:string}){const pct=Math.min(100,Math.max(0,((value||0)/target)*100));return <div className="goal-ring"><div className="ring" style={{'--pct':`${pct*3.6}deg`} as CSSProperties}><div><strong>{fmt(value)}</strong><span>of {fmt(target)} {unit}</span></div></div><h3>{label}</h3></div>}
function GoalBar({label,value,target,unit}:{label:string;value:N|undefined;target:number;unit:string}){const pct=Math.min(120,Math.max(0,((value||0)/target)*100));return <div className="goal-bar"><div><strong>{label}</strong><span>{fmt(value)} / {fmt(target)} {unit}</span></div><div className="track"><i style={{width:`${Math.min(100,pct)}%`}}/></div></div>}
function Metric({icon,label,value,unit,decimals=0,display}:{icon:ReactNode;label:string;value:N|undefined;unit:string;decimals?:number;display?:string}){return <section className="metric-card panel"><span>{icon}</span><div><p>{label}</p><strong>{display||fmt(value,decimals)}</strong>{value!=null&&!display&&<small>{unit}</small>}</div></section>}
function Stat({label,value}:{label:string;value:N|undefined}){return <div><span>{label}</span><strong>{fmt(value)} kcal</strong></div>}
function Section({title,detail}:{title:string;detail:string}){return <div className="section-title"><h2>{title}</h2><p>{detail}</p></div>}
function EntryList({children,empty}:{children:ReactNode;empty:string}){const a=Array.isArray(children)?children:[children];return a.length?<div className="entry-list">{children}</div>:<div className="empty">{empty}</div>}
function FoodRow({e}:{e:FoodEntry}){return <article className="entry"><div><strong>{e.food||e.meal}</strong><span>{[e.time,e.meal,e.portion].filter(Boolean).join(' · ')}</span></div><div><strong>{fmt(e.calories)} kcal</strong><span>{fmt(e.protein,1)}g protein · {fmt(e.carbs,1)}g carbs · {fmt(e.fat,1)}g fat</span></div></article>}
function WorkoutRow({e}:{e:WorkoutEntry}){const dist=e.swimmingDistanceYards!=null?`${fmt(e.swimmingDistanceYards)} yd`:e.distanceMiles!=null?`${fmt(e.distanceMiles,2)} mi`:'';return <article className="entry"><div><strong>{e.activity||'Workout'}</strong><span>{[e.time,e.durationMinutes!=null?`${fmt(e.durationMinutes)} min`:'',dist,e.location].filter(Boolean).join(' · ')}</span></div><div><strong>{fmt(e.activeCalories)} active kcal</strong><span>{e.averageHeartRate!=null?`${fmt(e.averageHeartRate)} bpm avg`:e.dataQuality}</span></div></article>}
function Centered({title,text}:{title:string;text:string}){return <main className="center"><RefreshCw className="spin"/><h1>{title}</h1><p>{text}</p></main>}
function SignIn(){return <main className="center"><div className="signin"><b>F</b><h1>Fuel</h1><p>Your private nutrition, activity, and recovery dashboard.</p><button onClick={()=>location.assign('/api/auth/google/start')}><ShieldCheck size={18}/> Sign in with Google</button></div></main>}
