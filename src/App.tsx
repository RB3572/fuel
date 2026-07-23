import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Activity, Bike, BookOpen, Check, Clock3, Copy, Database, Dumbbell, Eye, EyeOff, Footprints, GripVertical, HeartPulse, Home, LayoutGrid, LogOut, Moon, Pencil, Plus, RefreshCw, Route, Save, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2, Users, X } from 'lucide-react'
import type { LiftPlan } from './workouts'
// Code-split: the workout dataset and its stylesheet only download when the user
// actually opens the Lifting tab, keeping them out of the dashboard's first paint.
const LiftingPage = lazy(() => import('./LiftingPage'))
const ComparePage = lazy(() => import('./ComparePage'))
import './App.css'
import './ChartLabels.css'
import './ProfileMenu.css'
import './DashEdit.css'
import './VitalsSignal.css'

type N = number | null
type RangeKey = 'day' | 'week' | 'month'
type SessionUser = { email?: string; name?: string; picture?: string }
type NutrientTotals=Record<string,N>
type Summary = { date:string; partialDay:boolean; caloriesConsumed:N; restingEnergy:N; activeEnergy:N; totalExpenditure:N; energyBalance:N; protein:N; carbs:N; fat:N; fiber:N; sugars?:N; addedSugars?:N; sodium?:N; caffeine?:N; nutrients?:NutrientTotals; sleepHours:N; restingHeartRate:N; hrv:N; respiratoryRate:N; bloodOxygen:N; walkingHeartRateAverage:N; stepCount:N; distanceMiles:N; cyclingDistanceMiles:N; swimmingDistanceYards:N; swimmingStrokes:N; runningStrideLength:N; cardioRecovery:N; standMinutes:N; flightsClimbed:N; exerciseMinutes:N; vo2Max:N }
type FoodEntry = { id:string; time:string; meal:string; food:string; portion:string; calories:N; protein:N; carbs:N; fat:N; fiber:N; sugars?:N; addedSugars?:N; sodium?:N; caffeine?:N; nutrients?:NutrientTotals }
type WorkoutEntry = { time:string; activity:string; durationMinutes:N; activeCalories:N; distanceMiles:N; averagePace:string; averageHeartRate:N; effort:string; location:string; swimmingDistanceYards:N; stepCount:N; strokeCount:N; dataQuality:string }
type TrendPoint = Summary & { workoutCount:number }
type GoalRange = { minimum:N; target:N; maximum:N }
type GoalKey = 'calories'|'calorieBalancePercent'|'protein'|'carbs'|'fat'|'fiber'|'move'|'exercise'|'stand'|'steps'|'sleepHours'
type EditableGoalKey = Exclude<GoalKey,'calories'>
type GoalValues = Record<EditableGoalKey,number>
type GoalProfile = { heightIn:number|null;weightLb:number|null;age:number|null;objective:'maintenance'|'deficit'|'gain' }
type EnergyAverages = { totalExpenditure:N; restingEnergy:N; activeEnergy:N; energyBalance:N; expenditureDays:number; balanceDays:number }
type DashboardData = { generatedAt:string; energyAverages?:EnergyAverages; today:{summary:Summary;foodEntries:FoodEntry[];workouts:WorkoutEntry[];supplements:Array<{name:string;dose:string}>}; goals:Partial<Record<GoalKey,GoalRange>>; goalProfile?:GoalProfile; trends:TrendPoint[]; coverage:{days:number;workouts:number;foodEntries:number}; storage?:string }
type SyncToken = { token:string; tokenPrefix?:string; createdAt?:string; lastUsedAt?:string|null; endpoint:string; shortcutUrl:string; instructions:string }

type GoalApiResponse = GoalValues & { calories:number; averageExpenditure:number; averageExpenditureDays:number; averageEnergyBalance:N; averageBalanceDays:number; profile?:GoalProfile; autoSet?:{objective:string;averageExpenditure:number;historyDays:number;usedFallback:boolean;note:string} }

const fmt=(v:N|undefined,d=0)=>v==null?'Not logged':new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(v)
const dateFmt=(s:string)=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(`${s}T12:00:00`))
const navDateLong=()=>new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric'}).format(new Date())
const navDateShort=()=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date())
const longDate=(s:string)=>new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric'}).format(new Date(`${s}T12:00:00`))
const duration=(v:N|undefined)=>v==null?'Not logged':`${Math.floor(v)}h ${Math.round((v%1)*60)}m`
const positive=(v:N|undefined)=>v!=null&&v>0
const goalTarget=(goals:DashboardData['goals']|undefined,key:GoalKey,fallback:number)=>goals?.[key]?.target??fallback
const balanceLabel=(value:number)=>value===0?'maintenance':value<0?`${Math.abs(value)}% deficit`:`${value}% surplus`
const NUTRIENT_DISPLAY:Array<[string,string,string,number]>=[
  ['sugarsG','Total sugars','g',1],['addedSugarsG','Added sugars','g',1],['sodiumMg','Sodium','mg',0],['caffeineMg','Caffeine','mg',0],
  ['saturatedFatG','Saturated fat','g',1],['transFatG','Trans fat','g',1],['monounsaturatedFatG','Monounsaturated fat','g',1],['polyunsaturatedFatG','Polyunsaturated fat','g',1],
  ['omega3G','Omega-3','g',2],['omega6G','Omega-6','g',2],['cholesterolMg','Cholesterol','mg',0],['starchG','Starch','g',1],['sugarAlcoholG','Sugar alcohol','g',1],
  ['potassiumMg','Potassium','mg',0],['calciumMg','Calcium','mg',0],['ironMg','Iron','mg',1],['magnesiumMg','Magnesium','mg',0],['phosphorusMg','Phosphorus','mg',0],
  ['zincMg','Zinc','mg',1],['copperMg','Copper','mg',2],['manganeseMg','Manganese','mg',2],['seleniumMcg','Selenium','mcg',1],['iodineMcg','Iodine','mcg',1],
  ['vitaminAMcg','Vitamin A','mcg',0],['vitaminCMg','Vitamin C','mg',1],['vitaminDMcg','Vitamin D','mcg',1],['vitaminEMg','Vitamin E','mg',1],['vitaminKMcg','Vitamin K','mcg',1],
  ['thiaminMg','Thiamin (B1)','mg',2],['riboflavinMg','Riboflavin (B2)','mg',2],['niacinMg','Niacin (B3)','mg',1],['pantothenicAcidMg','Pantothenic acid (B5)','mg',1],
  ['vitaminB6Mg','Vitamin B6','mg',2],['biotinMcg','Biotin (B7)','mcg',1],['folateMcg','Folate (B9)','mcg',0],['vitaminB12Mcg','Vitamin B12','mcg',1],['cholineMg','Choline','mg',0],
  ['waterMl','Water','mL',0],['alcoholG','Alcohol','g',1],
]

type SectionKey='nutrition'|'detailedNutrition'|'foodConsumed'|'fitness'|'workouts'|'steps'|'vitals'|'recovery'
type EnergyBoxKey='totalBurned'|'consumed'|'active'|'resting'|'deficit'
type Layout={order:SectionKey[];hidden:SectionKey[];energyBoxes:EnergyBoxKey[]}
const ALL_SECTIONS:SectionKey[]=['nutrition','detailedNutrition','foodConsumed','fitness','workouts','steps','vitals','recovery']
const ALL_ENERGY_BOXES:EnergyBoxKey[]=['totalBurned','consumed','active','resting','deficit']
const DEFAULT_LAYOUT:Layout={order:[...ALL_SECTIONS],hidden:[],energyBoxes:[...ALL_ENERGY_BOXES]}
const ENERGY_BOX_LABELS:Record<EnergyBoxKey,string>={totalBurned:'Total burned',consumed:'Consumed',active:'Active',resting:'Resting',deficit:'Deficit / Surplus'}
function normalizeLayout(raw:unknown):Layout{
  const value=raw&&typeof raw==='object'?raw as Partial<Layout>:{}
  const order:SectionKey[]=[];const seen=new Set<string>()
  for(const k of Array.isArray(value.order)?value.order:[])if(ALL_SECTIONS.includes(k as SectionKey)&&!seen.has(k)){order.push(k as SectionKey);seen.add(k)}
  for(const k of ALL_SECTIONS)if(!seen.has(k))order.push(k)
  const hidden=[...new Set((Array.isArray(value.hidden)?value.hidden:[]).filter(k=>ALL_SECTIONS.includes(k as SectionKey)))] as SectionKey[]
  const energyBoxes=value.energyBoxes===undefined?[...ALL_ENERGY_BOXES]:[...new Set((Array.isArray(value.energyBoxes)?value.energyBoxes:[]).filter(k=>ALL_ENERGY_BOXES.includes(k as EnergyBoxKey)))] as EnergyBoxKey[]
  return{order,hidden,energyBoxes}
}

// public/intraday-energy.js renders the intraday chart from this payload instead of
// issuing its own /api/mlog request, which previously doubled every dashboard fetch.
function publishDashboard(payload:DashboardData){(window as unknown as{__fuelDashboard?:DashboardData}).__fuelDashboard=payload;dispatchEvent(new CustomEvent('fuel:dashboard'))}

function useInView<T extends HTMLElement>(){const ref=useRef<T|null>(null);const[visible,setVisible]=useState(false);useEffect(()=>{const node=ref.current;if(!node)return;if(typeof IntersectionObserver==='undefined'){setVisible(true);return}const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setVisible(true);observer.disconnect()}},{threshold:.18,rootMargin:'0px 0px -6% 0px'});observer.observe(node);return()=>observer.disconnect()},[]);return{ref,visible}}

// ---- Daily vitals health signal -------------------------------------------------
// Compares TODAY's vital signs against the user's OWN history and flags days that are
// statistically unusual — an early, personalized "are you coming down with something"
// signal. Method (kept honest and defensible, not a black box):
//  * Per vital: a modified z-score z = (today − median)/(1.4826·MAD). Median/MAD is the
//    Iglewicz–Hoaglin robust estimator, so one or two odd past days don't distort the
//    baseline the way mean/SD would. (Falls back to mean/SD if MAD is 0.)
//  * Two-tailed p = erfc(|z|/√2): the chance a normal day would look this extreme.
//  * A vital is FLAGGED only when p < 0.05/N (Bonferroni across the N vitals tested),
//    so checking many vitals doesn't manufacture false alarms.
//  * Score 1–10 from combined surprise −log10(p): the single most unusual vital drives
//    it, and additional deviating vitals compound it (multiple off-signals are less
//    likely to be chance). 10 = today looks just like your history, 1 = highly unusual.
// Informational only — this is not a medical diagnosis.
type VitalKey='restingHeartRate'|'hrv'|'respiratoryRate'|'bloodOxygen'|'walkingHeartRateAverage'|'cardioRecovery'
type VitalDef={key:VitalKey;label:string;unit:string;decimals:number}
const VITAL_DEFS:VitalDef[]=[
  {key:'restingHeartRate',label:'Resting heart rate',unit:'bpm',decimals:0},
  {key:'hrv',label:'HRV',unit:'ms',decimals:0},
  {key:'respiratoryRate',label:'Respiratory rate',unit:'/min',decimals:1},
  {key:'bloodOxygen',label:'Blood oxygen',unit:'%',decimals:1},
  {key:'walkingHeartRateAverage',label:'Walking heart rate',unit:'bpm',decimals:0},
  {key:'cardioRecovery',label:'Cardio recovery',unit:'bpm',decimals:0},
]
const VITALS_MIN_HISTORY=7
type VitalItem=VitalDef&{today:number;center?:number;z?:number;p?:number;direction?:'up'|'down';insufficient?:boolean;flagged?:boolean;watch?:boolean}
type VitalsSignalResult={status:'healthy'|'watch'|'flag'|'baseline';score:number|null;evaluated:number;flags:VitalItem[];items:VitalItem[]}
// Abramowitz & Stegun 7.1.26 complementary error function (x ≥ 0), |error| < 1.5e-7.
function erfc(x:number){const t=1/(1+0.3275911*x);const y=((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t;return y*Math.exp(-x*x)}
function median(values:number[]){const s=[...values].sort((a,b)=>a-b);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2}
function computeVitalsSignal(trends:TrendPoint[],summary:Summary|undefined):VitalsSignalResult{
  if(!summary)return{status:'baseline',score:null,evaluated:0,flags:[],items:[]}
  const today=summary.date
  const items:VitalItem[]=[]
  for(const def of VITAL_DEFS){
    const todayVal=summary[def.key]
    if(todayVal==null||!Number.isFinite(todayVal))continue
    const baseline=(trends||[]).filter(t=>t.date!==today).map(t=>t[def.key]).filter((v):v is number=>v!=null&&Number.isFinite(v))
    if(baseline.length<VITALS_MIN_HISTORY){items.push({...def,today:todayVal,insufficient:true});continue}
    const m=median(baseline)
    const mad=median(baseline.map(v=>Math.abs(v-m)))
    let sigma=1.4826*mad
    if(!(sigma>0)){const mean=baseline.reduce((a,b)=>a+b,0)/baseline.length;sigma=Math.sqrt(baseline.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,baseline.length-1))}
    if(!(sigma>0)){items.push({...def,today:todayVal,center:m,insufficient:true});continue}
    const z=(todayVal-m)/sigma
    const p=Math.min(1,erfc(Math.abs(z)/Math.SQRT2))
    items.push({...def,today:todayVal,center:m,z,p,direction:z>=0?'up':'down'})
  }
  const evaluated=items.filter(i=>i.z!=null)
  if(!evaluated.length)return{status:'baseline',score:null,evaluated:0,flags:[],items}
  const alpha=0.05/evaluated.length
  for(const i of evaluated){i.flagged=(i.p as number)<alpha;i.watch=!i.flagged&&Math.abs(i.z as number)>=2}
  const surprises=evaluated.map(i=>-Math.log10(Math.max(i.p as number,1e-12)))
  const primary=Math.max(...surprises)
  const primaryIdx=surprises.indexOf(primary)
  const extra=evaluated.reduce((sum,i,idx)=>idx!==primaryIdx&&Math.abs(i.z as number)>=2?sum-Math.log10(Math.max(i.p as number,1e-12)):sum,0)
  const combined=primary+0.5*extra
  const score=Math.max(1,Math.min(10,Math.round(10-2.2*Math.max(0,combined-1))))
  const flags=evaluated.filter(i=>i.flagged).sort((a,b)=>(a.p as number)-(b.p as number))
  const status:VitalsSignalResult['status']=flags.length?'flag':evaluated.some(i=>i.watch)?'watch':'healthy'
  return{status,score,evaluated:evaluated.length,flags,items}
}
function VitalsSignal({trends,summary}:{trends:TrendPoint[];summary:Summary|undefined}){
  const[open,setOpen]=useState(false)
  const signal=computeVitalsSignal(trends,summary)
  if(signal.status==='baseline')return <div className="vitals-signal is-baseline"><span className="vs-dot"/><span className="vs-text">Building your vitals baseline — a few more days of synced history unlocks the daily health signal.</span></div>
  const{status,score,flags,items,evaluated}=signal
  const headline=status==='flag'
    ?`Heads up — ${flags.slice(0,3).map(f=>`${f.label.toLowerCase()} ${f.direction==='up'?'↑':'↓'}`).join(', ')} vs your usual`
    :status==='watch'
      ?'Vitals mostly on track — one is drifting from your usual'
      :'Vitals aligned with your baseline'
  return <div className={`vitals-signal is-${status}`}>
    <button className="vs-head" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
      <span className="vs-dot"/>
      <span className="vs-score" aria-label={`Vitals alignment score ${score} out of 10`}>{score}<small>/10</small></span>
      <span className="vs-text">{headline}</span>
      <span className="vs-toggle">{open?'Hide':'Details'}</span>
    </button>
    {open&&<div className="vs-panel">
      <div className="vs-rows">
        {items.map(it=><div className={`vs-row${it.flagged?' is-flag':it.watch?' is-watch':''}`} key={it.key}>
          <span className="vs-label">{it.label}</span>
          {it.insufficient
            ?<span className="vs-note">Not enough history yet</span>
            :<><span className="vs-today">{fmt(it.today,it.decimals)} {it.unit}</span><span className="vs-typ">usually ~{fmt(it.center,it.decimals)}</span><span className="vs-badge">{it.flagged||it.watch?`${it.direction==='up'?'High ↑':'Low ↓'} · z ${fmt(Math.abs(it.z as number),1)}`:'Typical'}</span></>}
        </div>)}
      </div>
      <p className="vs-method">Today vs. your own history using a modified z-score (median/MAD), Bonferroni-corrected across {evaluated} vital{evaluated===1?'':'s'}. 10 = typical for you, 1 = highly unusual. Informational only — not a medical diagnosis.</p>
    </div>}
  </div>
}

export default function App(){
  const[session,setSession]=useState<{loading:boolean;authenticated:boolean;user:SessionUser|null}>({loading:true,authenticated:false,user:null})
  const[data,setData]=useState<DashboardData|null>(null)
  const[loading,setLoading]=useState(false)
  const[deletingFoodId,setDeletingFoodId]=useState<string|null>(null)
  const[editingFood,setEditingFood]=useState<FoodEntry|null>(null)
  const[error,setError]=useState('')
  const[range,setRange]=useState<RangeKey>('day')
  const[menuOpen,setMenuOpen]=useState(false)
  const[syncOpen,setSyncOpen]=useState(false)
  const[goalsOpen,setGoalsOpen]=useState(false)
  const[editMode,setEditMode]=useState(false)
  const[layout,setLayout]=useState<Layout>(DEFAULT_LAYOUT)
  const[dragKey,setDragKey]=useState<SectionKey|null>(null)
  const[page,setPage]=useState<'dashboard'|'lifting'|'compare'>(()=>{const v=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('view'):null;return v==='lifting'?'lifting':v==='compare'?'compare':'dashboard'})
  const[selectedLift,setSelectedLift]=useState<LiftPlan|null>(null)
  const load=useCallback(async()=>{setLoading(true);setError('');try{const r=await fetch('/api/mlog',{cache:'no-store',headers:{Accept:'application/json'}});if(r.status===401){setSession({loading:false,authenticated:false,user:null});setData(null);return}const p=await r.json();if(!r.ok)throw new Error(p.error||'Unable to load Fuel');setData(p);publishDashboard(p)}catch(e){setError(e instanceof Error?e.message:'Unable to load Fuel')}finally{setLoading(false)}},[])
  // Fire the session check, the dashboard payload, and the saved layout together on
  // mount. Previously the dashboard waited a full round-trip for /api/auth/session
  // before it even started loading; /api/mlog already returns 401 when signed out,
  // which is all we need to fall back to the sign-in screen.
  useEffect(()=>{
    fetch('/api/auth/session').then(r=>r.json()).then(p=>setSession({loading:false,authenticated:p.authenticated,user:p.user||null})).catch(()=>setSession({loading:false,authenticated:false,user:null}))
    void load()
    fetch('/api/mlog?fuel_route=dashboard-layout',{cache:'no-store',headers:{Accept:'application/json'}}).then(r=>r.json()).then(p=>{if(p?.layout)setLayout(normalizeLayout(p.layout))}).catch(()=>{})
  },[load])
  useEffect(()=>{if(!session.authenticated)return;const id=setInterval(load,30000);const focus=()=>void load();addEventListener('focus',focus);return()=>{clearInterval(id);removeEventListener('focus',focus)}},[session.authenticated,load])
  const logout=async()=>{await fetch('/api/auth/logout',{method:'POST'});setSession({loading:false,authenticated:false,user:null});setData(null)}
  const deleteFood=async(entry:FoodEntry)=>{if(!entry.id||deletingFoodId)return;const label=entry.food||entry.meal||'this food entry';if(!window.confirm(`Delete "${label}" from Fuel? This cannot be undone.`))return;setDeletingFoodId(entry.id);setError('');try{const r=await fetch('/api/mlog',{method:'DELETE',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({entryId:entry.id})}),p=await r.json();if(!r.ok)throw new Error(p.error||'Unable to delete this food entry.');await load()}catch(e){setError(e instanceof Error?e.message:'Unable to delete this food entry.')}finally{setDeletingFoodId(null)}}
  const saveLayout=useCallback((next:Layout)=>{setLayout(next);fetch('/api/mlog?fuel_route=dashboard-layout',{method:'PUT',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({layout:next})}).catch(()=>{})},[])
  const toggleHidden=(key:SectionKey)=>saveLayout({...layout,hidden:layout.hidden.includes(key)?layout.hidden.filter(k=>k!==key):[...layout.hidden,key]})
  const reorder=(target:SectionKey)=>{if(!dragKey||dragKey===target){setDragKey(null);return}const order=layout.order.filter(k=>k!==dragKey);order.splice(order.indexOf(target),0,dragKey);saveLayout({...layout,order});setDragKey(null)}
  const toggleBox=(key:EnergyBoxKey)=>saveLayout({...layout,energyBoxes:layout.energyBoxes.includes(key)?layout.energyBoxes.filter(k=>k!==key):ALL_ENERGY_BOXES.filter(k=>k===key||layout.energyBoxes.includes(k))})
  if(session.loading)return <Centered title="Fuel" text="Loading your dashboard."/>
  if(!session.authenticated)return <SignIn/>
  const menu=<DashMenu editMode={editMode} loading={loading} onEdit={()=>{setEditMode(v=>!v);setMenuOpen(false)}} onRefresh={()=>{setMenuOpen(false);void load()}} onGoals={()=>{setMenuOpen(false);setGoalsOpen(true)}} onSync={()=>{setMenuOpen(false);setSyncOpen(true)}} onLogout={logout}/>
  const navFor=(current:'dashboard'|'lifting'|'compare')=><TopNav current={current} user={session.user} goDashboard={()=>{setPage('dashboard');window.scrollTo({top:0})}} goLifting={()=>{setSelectedLift(null);setPage('lifting')}} goCompare={()=>{setPage('compare');window.scrollTo({top:0})}} menuOpen={menuOpen} onMenu={()=>setMenuOpen(v=>!v)} menu={menu}/>
  if(page==='lifting')return <Suspense fallback={<Centered title="Fuel" text="Loading lifting plans."/>}><LiftingPage selected={selectedLift} onSelect={setSelectedLift} nav={navFor('lifting')}/></Suspense>
  if(page==='compare')return <Suspense fallback={<Centered title="Fuel" text="Loading comparison."/>}><ComparePage data={data} nav={navFor('compare')}/></Suspense>
  const s=data?.today.summary
  const workoutDetail=s?.exerciseMinutes!=null?`${fmt(s.exerciseMinutes)} total exercise minutes`:`${data?.today.workouts.length||0} activity summaries`
  const sectionNodes:Record<SectionKey,{title:string;detail:string;node:ReactNode}>={
    nutrition:{title:'Nutrition',detail:`Calculated calorie target · ${balanceLabel(goalTarget(data?.goals,'calorieBalancePercent',0))} relative to average burn`,node:<section className="panel nutrition-panel"><GoalRing label="Calculated calories" value={s?.caloriesConsumed} target={goalTarget(data?.goals,'calories',2000)} unit="kcal"/><GoalBar label="Protein" value={s?.protein} target={goalTarget(data?.goals,'protein',112)} unit="g"/><GoalBar label="Carbohydrates" value={s?.carbs} target={goalTarget(data?.goals,'carbs',300)} unit="g"/><GoalBar label="Fat" value={s?.fat} target={goalTarget(data?.goals,'fat',60)} unit="g"/><GoalBar label="Fiber" value={s?.fiber} target={goalTarget(data?.goals,'fiber',30)} unit="g"/></section>},
    detailedNutrition:{title:'Detailed nutrition',detail:'Totals from logged food; unavailable nutrients remain blank rather than being guessed',node:<NutrientGrid nutrients={s?.nutrients}/>},
    foodConsumed:{title:'Food consumed',detail:`${data?.today.foodEntries.length||0} entries today`,node:<section className="panel"><EntryList empty="No food logged today.">{(data?.today.foodEntries||[]).map((e,i)=><FoodRow key={e.id||i} e={e} deleting={deletingFoodId===e.id} onDelete={()=>void deleteFood(e)} onEdit={()=>setEditingFood(e)}/>)}</EntryList></section>},
    fitness:{title:'Fitness',detail:'Daily activity totals from Apple Health',node:<><ActivityRings summary={s} goals={data?.goals}/><section className="metric-grid fitness-metrics"><Metric icon={<Activity/>} label="Active energy" value={s?.activeEnergy} unit="kcal"/><Metric icon={<Clock3/>} label="Exercise" value={s?.exerciseMinutes} unit="min"/><Metric icon={<Route/>} label="Walking + running" value={s?.distanceMiles} unit="mi" decimals={2}/>{positive(s?.runningStrideLength)&&<Metric icon={<Route/>} label="Running stride length" value={s?.runningStrideLength} unit="m" decimals={2}/>}<Metric icon={<Footprints/>} label="Steps" value={s?.stepCount} unit=""/>{positive(s?.standMinutes)&&<Metric icon={<Clock3/>} label="Stand time" value={s?.standMinutes} unit="min"/>}{positive(s?.flightsClimbed)&&<Metric icon={<Activity/>} label="Flights climbed" value={s?.flightsClimbed} unit="flights"/>}{positive(s?.cyclingDistanceMiles)&&<Metric icon={<Bike/>} label="Cycling distance" value={s?.cyclingDistanceMiles} unit="mi" decimals={2}/>}</section></>},
    workouts:{title:'Workouts',detail:workoutDetail,node:<section className="panel"><EntryList empty="No workout activity logged today.">{(data?.today.workouts||[]).map((e,i)=><WorkoutRow key={i} e={e}/>)}</EntryList></section>},
    steps:{title:'Steps',detail:`Interactive 30-day movement trend · goal ${fmt(goalTarget(data?.goals,'steps',10000))}`,node:<section className="panel chart-panel"><InteractiveLine data={data?.trends||[]} metric="stepCount" unit="steps" chartTitle="Daily steps" yLabel="Steps"/></section>},
    vitals:{title:'Vitals',detail:'Cardiovascular, oxygen, and respiratory measures',node:<><section className="metric-grid"><Metric icon={<HeartPulse/>} label="Resting heart rate" value={s?.restingHeartRate} unit="bpm"/><Metric icon={<Activity/>} label="HRV" value={s?.hrv} unit="ms"/><Metric icon={<Activity/>} label="Respiratory rate" value={s?.respiratoryRate} unit="/min" decimals={1}/><Metric icon={<Activity/>} label="VO₂ max" value={s?.vo2Max} unit="mL/kg/min" decimals={1}/>{positive(s?.bloodOxygen)&&<Metric icon={<Activity/>} label="Blood oxygen" value={s?.bloodOxygen} unit="%" decimals={1}/>}{positive(s?.walkingHeartRateAverage)&&<Metric icon={<HeartPulse/>} label="Walking heart rate" value={s?.walkingHeartRateAverage} unit="bpm avg"/>}{positive(s?.cardioRecovery)&&<Metric icon={<HeartPulse/>} label="Cardio recovery" value={s?.cardioRecovery} unit="bpm" decimals={1}/>}</section><section className="panel chart-panel"><InteractiveLine data={data?.trends||[]} metric="restingHeartRate" unit="bpm" chartTitle="Resting heart rate trend" yLabel="Beats per minute"/></section></>},
    recovery:{title:'Recovery',detail:`Sleep target ${fmt(goalTarget(data?.goals,'sleepHours',8),1)} hours`,node:<section className="recovery-grid"><Metric icon={<Moon/>} label="Sleep" value={s?.sleepHours} unit="h" display={duration(s?.sleepHours)}/><section className="panel chart-panel"><InteractiveLine data={data?.trends||[]} metric="sleepHours" unit="h" decimals={1} chartTitle="Sleep duration" yLabel="Hours"/></section></section>},
  }
  return <main className={`app-shell${editMode?' edit-mode':''}`}>
    <TopNav current="dashboard" user={session.user} goDashboard={()=>window.scrollTo({top:0,behavior:'smooth'})} goLifting={()=>setPage('lifting')} goCompare={()=>{setPage('compare');window.scrollTo({top:0})}} menuOpen={menuOpen} onMenu={()=>setMenuOpen(v=>!v)} menu={menu}/>
    <VitalsSignal trends={data?.trends||[]} summary={s}/>
    {editMode&&<div className="edit-banner panel"><LayoutGrid size={16}/><span>Editing your dashboard — drag to reorder, hide sections, and toggle energy metrics.</span><button className="edit-done" onClick={()=>setEditMode(false)}><Check size={15}/>Done</button></div>}
    {error&&<div className="error">{error}</div>}
    <EnergyHero summary={s} trends={data?.trends||[]} energyAverages={data?.energyAverages} range={range} setRange={setRange} boxes={layout.energyBoxes} editMode={editMode} onToggleBox={toggleBox}/>
    {layout.order.filter(k=>editMode||!layout.hidden.includes(k)).map(key=>{const def=sectionNodes[key];return <DashSection key={key} title={def.title} detail={def.detail} editMode={editMode} hidden={layout.hidden.includes(key)} dragging={dragKey===key} onDragStart={()=>setDragKey(key)} onDragEnd={()=>setDragKey(null)} onDropSection={()=>reorder(key)} onToggleHide={()=>toggleHidden(key)}>{def.node}</DashSection>})}
    <footer><Database size={15}/><span>{data?.coverage.days||0} days · {data?.coverage.workouts||0} active days · {data?.coverage.foodEntries||0} food entries · Neon Postgres</span></footer>
    {syncOpen&&<SyncSetup onClose={()=>setSyncOpen(false)}/>}
    {goalsOpen&&<GoalsSetup initial={data} onClose={()=>setGoalsOpen(false)} onSaved={load}/>}
    {editingFood&&<EditFoodModal entry={editingFood} onClose={()=>setEditingFood(null)} onSaved={load}/>}
  </main>
}


// The signed-in Google account picture, shown at the far left of every nav bar.
// Falls back to an initial when Google returns no picture or the image fails.
function BrandAvatar({user}:{user:SessionUser|null}){
  const[broken,setBroken]=useState(false)
  const label=user?.name||user?.email||'Signed in'
  if(user?.picture&&!broken)return <img className="brand-avatar" src={user.picture} alt={label} title={label} referrerPolicy="no-referrer" onError={()=>setBroken(true)}/>
  return <span className="brand-avatar brand-avatar-fallback" title={label} aria-label={label}>{(user?.name||user?.email||'U').slice(0,1).toUpperCase()}</span>
}

// One nav bar used on every in-app view (dashboard + lifting). The static pages
// (recipes.html, meal-plan.html) render the same markup so the bar never changes.
function TopNav({current,user,goDashboard,goLifting,goCompare,menuOpen,onMenu,menu}:{current:'dashboard'|'lifting'|'compare';user:SessionUser|null;goDashboard:()=>void;goLifting:()=>void;goCompare:()=>void;menuOpen:boolean;onMenu:()=>void;menu:ReactNode}){
  return <header className="topbar"><div className="brand"><BrandAvatar user={user}/><div className="brand-text"><h1>Fuel</h1><p className="brand-date"><span className="date-long">{navDateLong()}</span><span className="date-short">{navDateShort()}</span></p></div></div><nav className="user" aria-label="Fuel navigation">
    <button className={`nav-icon-button${current==='dashboard'?' nav-active':''}`} onClick={goDashboard} aria-current={current==='dashboard'?'page':undefined} aria-label="Dashboard" title="Dashboard"><Home size={18}/></button>
    <a className="nav-icon-button" href="/meal-plan.html" aria-label="Fuel AI" title="Fuel AI"><Sparkles size={18}/></a>
    <a className="nav-icon-button" href="/recipes.html" aria-label="Recipes" title="Recipes"><BookOpen size={18}/></a>
    <button className={`nav-icon-button${current==='lifting'?' nav-active':''}`} onClick={goLifting} aria-current={current==='lifting'?'page':undefined} aria-label="Lifting" title="Lifting"><Dumbbell size={18}/></button>
    <button className={`nav-icon-button${current==='compare'?' nav-active':''}`} onClick={goCompare} aria-current={current==='compare'?'page':undefined} aria-label="Compare" title="Compare to your age group"><Users size={18}/></button>
    <div className="profile-shell"><button className="nav-icon-button" onClick={onMenu} aria-expanded={menuOpen} aria-label="Menu" title="Menu"><SlidersHorizontal size={18}/></button>{menuOpen&&menu}</div>
  </nav></header>
}
function DashMenu({editMode,loading,onEdit,onRefresh,onGoals,onSync,onLogout}:{editMode:boolean;loading:boolean;onEdit:()=>void;onRefresh:()=>void;onGoals:()=>void;onSync:()=>void;onLogout:()=>void}){return <div className="profile-menu panel" role="menu"><button onClick={onEdit} role="menuitem"><LayoutGrid size={17}/><span>{editMode?'Finish editing':'Edit dashboard'}</span></button><button onClick={onRefresh} role="menuitem"><RefreshCw size={17} className={loading?'spin':''}/><span>Refresh</span></button><button onClick={onGoals} role="menuitem"><Target size={17}/><span>Goals</span></button><button onClick={onSync} role="menuitem"><Settings size={17}/><span>Sync setup</span></button><button className="logout-menu-button" onClick={onLogout} role="menuitem"><LogOut size={17}/><span>Log out</span></button></div>}
function DashSection({title,detail,editMode,hidden,dragging,onDragStart,onDragEnd,onDropSection,onToggleHide,children}:{title:string;detail:string;editMode:boolean;hidden:boolean;dragging:boolean;onDragStart:()=>void;onDragEnd:()=>void;onDropSection:()=>void;onToggleHide:()=>void;children:ReactNode}){
  if(!editMode)return <><Section title={title} detail={detail}/>{children}</>
  return <div className={`dash-section${dragging?' dragging':''}${hidden?' section-hidden':''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={e=>e.preventDefault()} onDrop={onDropSection}>
    <div className="section-edit-bar"><span className="drag-handle" aria-hidden="true"><GripVertical size={16}/></span><div className="section-edit-label"><strong>{title}</strong><small>{detail}</small></div><button className="section-hide-toggle" onClick={onToggleHide}>{hidden?<><Eye size={15}/>Show</>:<><EyeOff size={15}/>Hide</>}</button></div>
    <div className="section-body">{children}</div>
  </div>
}

function GoalsSetup({initial,onClose,onSaved}:{initial:DashboardData|null;onClose:()=>void;onSaved:()=>Promise<void>|void}){
  const defaults:GoalValues={calorieBalancePercent:goalTarget(initial?.goals,'calorieBalancePercent',0),protein:goalTarget(initial?.goals,'protein',112),carbs:goalTarget(initial?.goals,'carbs',300),fat:goalTarget(initial?.goals,'fat',60),fiber:goalTarget(initial?.goals,'fiber',30),move:goalTarget(initial?.goals,'move',1000),exercise:goalTarget(initial?.goals,'exercise',80),stand:goalTarget(initial?.goals,'stand',120),steps:goalTarget(initial?.goals,'steps',10000),sleepHours:goalTarget(initial?.goals,'sleepHours',8)}
  const[goals,setGoals]=useState<GoalValues>(defaults)
  const[reference,setReference]=useState({averageExpenditure:initial?.energyAverages?.totalExpenditure??null,calories:goalTarget(initial?.goals,'calories',2000),days:initial?.energyAverages?.expenditureDays||0})
  const[busy,setBusy]=useState(false)
  const[message,setMessage]=useState('')
  const previewCalories=reference.averageExpenditure==null?reference.calories:Math.round(reference.averageExpenditure*(1+goals.calorieBalancePercent/100))
  useEffect(()=>{fetch('/api/goals',{cache:'no-store'}).then(r=>r.json()).then((p:GoalApiResponse)=>{if(Number.isFinite(p.calorieBalancePercent)){setGoals({calorieBalancePercent:p.calorieBalancePercent,protein:p.protein,carbs:p.carbs,fat:p.fat,fiber:p.fiber,move:p.move,exercise:p.exercise,stand:p.stand,steps:p.steps,sleepHours:p.sleepHours});setReference({averageExpenditure:p.averageExpenditure,calories:p.calories,days:p.averageExpenditureDays})}}).catch(()=>{})},[])
  const submit=async()=>{setBusy(true);setMessage('');try{const r=await fetch('/api/goals',{method:'PUT',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({goals})}),p:GoalApiResponse&{error?:string}=await r.json();if(!r.ok)throw new Error(p.error||'Unable to update goals.');setGoals({calorieBalancePercent:p.calorieBalancePercent,protein:p.protein,carbs:p.carbs,fat:p.fat,fiber:p.fiber,move:p.move,exercise:p.exercise,stand:p.stand,steps:p.steps,sleepHours:p.sleepHours});setReference({averageExpenditure:p.averageExpenditure,calories:p.calories,days:p.averageExpenditureDays});setMessage('Goals saved.');await onSaved()}catch(e){setMessage(e instanceof Error?e.message:'Unable to update goals.')}finally{setBusy(false)}}
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="goals-modal panel" role="dialog" aria-modal="true"><div className="sync-modal-head"><div><h2>Goals</h2><p>Set the calorie balance as a percentage of average daily energy burned.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><div className="auto-goals"><div className="auto-goals-head"><Target size={18}/><div><h3>Calculated calorie target</h3><p>{fmt(reference.averageExpenditure)} kcal average burn × {100+goals.calorieBalancePercent}% = <strong>{fmt(previewCalories)} kcal/day</strong></p><p>{reference.days} completed expenditure days · negative is a deficit, positive is a surplus, and zero is maintenance.</p></div></div><label className="goal-field"><span>Calorie balance<small>%</small></span><input type="number" min="-50" max="50" step="1" value={goals.calorieBalancePercent} onChange={e=>setGoals(g=>({...g,calorieBalancePercent:Number(e.target.value)}))}/></label></div><div className="goal-config-grid">{([
    ['protein','Protein','g'],['carbs','Carbohydrates','g'],['fat','Fat','g'],['fiber','Fiber','g'],['move','Move','kcal'],['exercise','Exercise','min'],['stand','Stand','min'],['steps','Steps','steps'],['sleepHours','Sleep','hours']
  ] as Array<[EditableGoalKey,string,string]>).map(([key,label,unit])=><label className="goal-field" key={key}><span>{label}<small>{unit}</small></span><input type="number" min="0" step={key==='sleepHours'?.1:1} value={goals[key]} onChange={e=>setGoals(g=>({...g,[key]:Number(e.target.value)}))}/></label>)}</div><button className="save-goals-button" disabled={busy} onClick={()=>void submit()}><Save size={17}/>Save goals</button>{message&&<p className="sync-message">{message}</p>}<p className="sync-note">The calorie target updates automatically as the average of completed Apple Health expenditure days changes.</p></section></div>
}

function SyncSetup({onClose}:{onClose:()=>void}){const[record,setRecord]=useState<SyncToken|null>(null),[busy,setBusy]=useState(true),[message,setMessage]=useState('');const fetchToken=useCallback(async(method:'GET'|'POST'='GET')=>{setBusy(true);setMessage('');try{const r=await fetch('/api/health/token',{method,headers:{Accept:'application/json'}}),p=await r.json();if(!r.ok)throw new Error(p.error||'Unable to provide a health sync token.');setRecord(p)}catch(e){setMessage(e instanceof Error?e.message:'Unable to provide a health sync token.')}finally{setBusy(false)}},[]);useEffect(()=>{void fetchToken()},[fetchToken]);const copy=async()=>{if(!record?.token)return;await navigator.clipboard.writeText(record.token);setMessage('Token copied.')};return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="sync-modal panel" role="dialog" aria-modal="true"><div className="sync-modal-head"><div><h2>Apple Health sync</h2><p>Neon-backed private storage</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><ol><li><a href={record?.shortcutUrl||'https://www.icloud.com/shortcuts/0895a9a876fa454f8e2bc90daa555fc7'} target="_blank" rel="noreferrer">Install the Fuel Health Shortcut</a>.</li><li>Replace only the bearer token in the Shortcut with the token below.</li><li>Leave the endpoint and the word <strong>Bearer</strong> unchanged.</li></ol><label>Your bearer token</label><div className="token-box">{busy?'Loading token…':record?.token||'Token unavailable'}</div><button className="primary-sync-button" onClick={copy} disabled={!record?.token||busy}><Copy size={17}/>Copy token</button><div className="sync-actions"><a className="shortcut-button" href={record?.shortcutUrl||'https://www.icloud.com/shortcuts/0895a9a876fa454f8e2bc90daa555fc7'} target="_blank" rel="noreferrer">Get Shortcut</a><button className="resync-button" onClick={()=>void fetchToken('POST')} disabled={busy}><RefreshCw size={16}/>Re-sync token</button></div>{message&&<p className="sync-message">{message}</p>}<p className="sync-note">Re-syncing immediately revokes the previous token. Imports update one record per date and do not create duplicate daily entries.</p></section></div>}

function ActivityRings({summary,goals}:{summary:Summary|undefined;goals:DashboardData['goals']|undefined}){const rings=[{label:'Move',value:summary?.activeEnergy||0,target:goalTarget(goals,'move',1000),unit:'CAL',radius:96,width:26,className:'move-ring'},{label:'Exercise',value:summary?.exerciseMinutes||0,target:goalTarget(goals,'exercise',80),unit:'MIN',radius:67,width:24,className:'exercise-ring'},{label:'Stand',value:summary?.standMinutes||0,target:goalTarget(goals,'stand',120),unit:'MIN',radius:40,width:22,className:'stand-ring'}],{ref,visible}=useInView<HTMLDivElement>();return <section ref={ref} className={`activity-rings panel ${visible?'is-visible':''}`}><div className="rings-graphic" role="img"><svg viewBox="0 0 240 240" aria-hidden="true">{rings.map(r=>{const c=2*Math.PI*r.radius,pct=Math.min(1,Math.max(0,r.value/r.target)),target=c*(1-pct);return <g key={r.label} className={r.className}><circle className="fitness-track" cx="120" cy="120" r={r.radius} strokeWidth={r.width}/><circle className="fitness-progress" cx="120" cy="120" r={r.radius} strokeWidth={r.width} strokeDasharray={c} style={{strokeDashoffset:visible?target:c} as CSSProperties}/></g>})}</svg></div><div className="rings-copy">{rings.map(r=><div className={`ring-stat ${r.className}`} key={r.label}><span>{r.label}</span><strong>{fmt(r.value)}/{fmt(r.target)}<small>{r.unit}</small></strong></div>)}</div></section>}
function EnergyHero({summary,trends,energyAverages,range,setRange,boxes,editMode,onToggleBox}:{summary:Summary|undefined;trends:TrendPoint[];energyAverages:EnergyAverages|undefined;range:RangeKey;setRange:(r:RangeKey)=>void;boxes:EnergyBoxKey[];editMode:boolean;onToggleBox:(k:EnergyBoxKey)=>void}){const days=range==='day'?1:range==='week'?7:30,visible=trends.slice(-days),consumed=visible.reduce((a,p)=>a+(p.caloriesConsumed||0),0),expended=visible.reduce((a,p)=>a+(p.totalExpenditure||0),0),balance=consumed&&expended?consumed-expended:null;return <section className="hero panel"><div className="hero-head"><div><span className="eyebrow">ENERGY BALANCE</span><h2>{balance==null?'Incomplete data':balance>0?`${fmt(balance)} kcal surplus`:`${fmt(Math.abs(balance))} kcal deficit`}</h2><p>{range==='day'?'Today':range==='week'?'Last 7 days':'Last 30 days'} · intake versus total expenditure</p></div><div className="tabs">{(['day','week','month'] as RangeKey[]).map(r=><button className={range===r?'active':''} onClick={()=>setRange(r)} key={r}>{r==='day'?'Day':r==='week'?'Week':'Month'}</button>)}</div></div><EnergySummary summary={summary} boxes={boxes} editMode={editMode} onToggleBox={onToggleBox}/><NetBalanceChart data={trends.slice(-30)} allTimeAverage={energyAverages}/><EnergyInteractiveChart data={visible}/></section>}
function EnergySummary({summary,boxes,editMode,onToggleBox}:{summary:Summary|undefined;boxes:EnergyBoxKey[];editMode:boolean;onToggleBox:(k:EnergyBoxKey)=>void}){
  const resting=summary?.restingEnergy||0,active=summary?.activeEnergy||0,total=summary?.totalExpenditure||resting+active,consumed=summary?.caloriesConsumed||0
  const balance=total-consumed,balanceWord=balance>=0?'Deficit':'Surplus',balanceClass=balance>=0?'deficit':'surplus',balanceAmount=Math.abs(balance)
  const max=Math.max(total,consumed,1),pct=(v:number)=>`${Math.max(0,v/max*100)}%`
  const restingShare=total>0?resting/total*100:0,activeShare=total>0?active/total*100:0
  const gapStart=Math.min(total,consumed)/max*100,gapWidth=Math.abs(total-consumed)/max*100
  const boxDefs:Array<{key:EnergyBoxKey;dot:string;label:string;value:number;cls:string}>=[
    {key:'totalBurned',dot:'total-dot',label:'Total burned',value:total,cls:''},
    {key:'consumed',dot:'consumed-dot',label:'Consumed',value:consumed,cls:''},
    {key:'active',dot:'active-dot',label:'Active',value:active,cls:''},
    {key:'resting',dot:'resting-dot',label:'Resting',value:resting,cls:''},
    {key:'deficit',dot:'balance-dot',label:balanceWord,value:balanceAmount,cls:`energy-balance-metric ${balanceClass}`},
  ]
  const shown=boxDefs.filter(d=>boxes.includes(d.key))
  return <div className="energy-summary-bars">
    {editMode&&<div className="energy-box-picker"><span className="picker-label">Metrics</span>{boxDefs.map(d=><button key={d.key} className={`box-chip${boxes.includes(d.key)?' on':''}`} onClick={()=>onToggleBox(d.key)}>{boxes.includes(d.key)?<Check size={13}/>:<Plus size={13}/>}{ENERGY_BOX_LABELS[d.key]}</button>)}</div>}
    {shown.length>0&&<div className="energy-summary-metrics" data-count={shown.length}>{shown.map(d=><div key={d.key} className={d.cls||undefined}><span><i className={d.dot}/>{d.label}</span><strong>{fmt(d.value)} kcal</strong></div>)}</div>}
    <div className="energy-summary-plot">
      <div className="energy-summary-track"><div className="energy-summary-fill total-burned-fill" style={{width:pct(total)}}><span className="resting-segment" style={{width:`${restingShare}%`}}/><span className="active-segment" style={{width:`${activeShare}%`}}/></div></div>
      <div className="energy-summary-track consumed-track"><span className="energy-summary-fill consumed-fill" style={{width:pct(consumed)}}/>{balanceAmount>0&&<span className={`energy-balance-gap ${balanceClass}-gap${gapWidth<18?' narrow-gap':''}`} style={{left:`${gapStart}%`,width:`${gapWidth}%`}}><b>{fmt(balanceAmount)} kcal {balanceWord.toLowerCase()}</b></span>}</div>
    </div>
    <div className="energy-summary-key"><span><i className="resting-dot"/>Resting</span><span><i className="active-dot"/>Active</span><span><i className="consumed-dot"/>Consumed</span><span><i className="balance-dot"/>{balanceWord} gap</span></div>
  </div>
}
function EnergyInteractiveChart({data}:{data:TrendPoint[]}){const[active,setActive]=useState<number|null>(null),max=Math.max(1,...data.flatMap(p=>[p.caloriesConsumed||0,p.restingEnergy||0,p.activeEnergy||0,p.totalExpenditure||0]));if(!data.length)return <div className="empty">No energy data</div>;const p=active==null?null:data[active];return <div className="energy-viz animated-chart is-visible" onMouseLeave={()=>setActive(null)}><div className="chart-header-row"><div><strong className="chart-title">Daily intake and energy components</strong><span className="chart-axis-note">Four bars per day · calories consumed, resting, active, and total burned</span></div><ChartLegend items={[["legend-consumed","Consumed"],["legend-resting","Resting"],["legend-active","Active"],["legend-expended","Total burned"]]}/></div><div className="bars">{data.map((d,i)=><button key={d.date} className={`bar-day ${i===active?'selected':''}`} onMouseEnter={()=>setActive(i)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} onClick={()=>setActive(i)}><span className="bar consumed" style={{'--bar-height':`${Math.max(3,(d.caloriesConsumed||0)/max*100)}%`} as CSSProperties}/><span className="bar resting" style={{'--bar-height':`${Math.max(3,(d.restingEnergy||0)/max*100)}%`} as CSSProperties}/><span className="bar active-energy" style={{'--bar-height':`${Math.max(3,(d.activeEnergy||0)/max*100)}%`} as CSSProperties}/><span className="bar burned" style={{'--bar-height':`${Math.max(3,(d.totalExpenditure||0)/max*100)}%`} as CSSProperties}/>{i===active&&p&&<span className="point-label energy-point-label"><strong>{dateFmt(p.date)}</strong><span>{fmt(p.caloriesConsumed)} consumed</span><span>{fmt(p.restingEnergy)} resting</span><span>{fmt(p.activeEnergy)} active</span><span>{fmt(p.totalExpenditure)} total</span></span>}<small>{dateFmt(d.date)}</small></button>)}</div><div className="x-axis-label">Date</div></div>}
function InteractiveLine({data,metric,unit,decimals=0,chartTitle,yLabel}:{data:TrendPoint[];metric:keyof TrendPoint;unit:string;decimals?:number;chartTitle:string;yLabel:string}){const points=data.map((p,i)=>({date:p.date,value:typeof p[metric]==='number'?p[metric] as number:null,i})).filter((p):p is{date:string;value:number;i:number}=>p.value!=null),[active,setActive]=useState<number|null>(null);if(points.length<2)return <div className="empty">Insufficient data</div>;const max=Math.max(...points.map(p=>p.value)),min=Math.min(...points.map(p=>p.value)),w=760,h=220,padX=42,padY=30,range=max-min||1,xy=points.map((p,i)=>({...p,x:padX+i/(points.length-1)*(w-padX*2),y:padY+(max-p.value)/range*(h-padY*2)})),a=active==null?null:xy[active],first=xy[0],last=xy.at(-1)!,labelLeft=a?`${Math.min(86,Math.max(12,(a.x/w)*100))}%`:'50%',labelTop=a?`${Math.min(80,Math.max(8,(a.y/h)*100))}%`:'50%';return <div className="interactive-line animated-chart is-visible" onMouseLeave={()=>setActive(null)}><div className="chart-header-row"><div><strong className="chart-title">{chartTitle}</strong><span className="chart-axis-note">Horizontal axis: date · Vertical axis: {yLabel}</span></div><ChartLegend items={[["legend-line",chartTitle]]}/></div><div className="chart-stage"><span className="y-axis-label">{yLabel}</span><svg viewBox={`0 0 ${w} ${h}`} onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect(),idx=Math.round(((e.clientX-r.left)/r.width)*(points.length-1));setActive(Math.max(0,Math.min(points.length-1,idx)))}}><defs><linearGradient id={`fill-${String(metric)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopOpacity=".18"/><stop offset="1" stopOpacity="0"/></linearGradient></defs><line className="gridline" x1={padX} x2={w-padX} y1={padY} y2={padY}/><line className="gridline" x1={padX} x2={w-padX} y1={h-padY} y2={h-padY}/><path className="area" d={`M ${xy[0].x} ${h-padY} L ${xy.map(p=>`${p.x} ${p.y}`).join(' L ')} L ${xy.at(-1)!.x} ${h-padY} Z`} fill={`url(#fill-${String(metric)})`}/><polyline className="trend-line" points={xy.map(p=>`${p.x},${p.y}`).join(' ')} fill="none"/>{a&&<line className="cursor" x1={a.x} x2={a.x} y1={padY} y2={h-padY}/>} {xy.map((p,i)=><circle key={p.date} cx={p.x} cy={p.y} r={i===active?6:3} onClick={()=>setActive(i)} onFocus={()=>setActive(i)} tabIndex={0}/>)}</svg>{a&&<div className="point-label line-point-label" style={{left:labelLeft,top:labelTop}}><strong>{dateFmt(a.date)}</strong><span>{fmt(a.value,decimals)} {unit}</span></div>}<span className="y-max-label">{fmt(max,decimals)} {unit}</span><span className="y-min-label">{fmt(min,decimals)} {unit}</span></div><div className="line-axis-footer"><span>{dateFmt(first.date)}</span><strong>Date</strong><span>{dateFmt(last.date)}</span></div></div>}
function NetBalanceChart({data,allTimeAverage}:{data:TrendPoint[];allTimeAverage:EnergyAverages|undefined}){
  const[active,setActive]=useState<number|null>(null)
  const scrollRef=useRef<HTMLDivElement|null>(null)
  const points=data.map(p=>({date:p.date,net:p.caloriesConsumed!=null&&p.totalExpenditure!=null?p.caloriesConsumed-p.totalExpenditure:null}))
  useEffect(()=>{const el=scrollRef.current;if(!el)return;const toEnd=()=>{el.scrollLeft=el.scrollWidth};toEnd();const r=requestAnimationFrame(toEnd);return()=>cancelAnimationFrame(r)},[points.length])
  if(!points.some(p=>p.net!=null))return <div className="empty">No energy balance data yet</div>
  const max=Math.max(1,...points.map(p=>p.net==null?0:Math.abs(p.net)))
  const step=Math.max(1,Math.round(points.length/8))
  const shown=active!=null?points[active]:points[points.length-1]
  const readout=!shown||shown.net==null?'No data for this day':shown.net>0?`${longDate(shown.date)} · +${fmt(shown.net)} kcal surplus`:`${longDate(shown.date)} · ${fmt(shown.net)} kcal deficit`
  const average=allTimeAverage?.energyBalance
  const averageText=average==null?'All-time average unavailable':average>0?`All-time average: +${fmt(average)} kcal surplus/day`:`All-time average: ${fmt(average)} kcal deficit/day`
  return <div className="net-balance">
    <div className="chart-header-row"><div><strong className="chart-title">Daily deficit and surplus</strong><span className="net-average">{averageText} · {allTimeAverage?.balanceDays||0} days</span><span className="chart-axis-note net-readout">{readout}</span></div><ChartLegend items={[["legend-surplus","Surplus"],["legend-deficit","Deficit"]]}/></div>
    <div className="net-scroll" ref={scrollRef} onMouseLeave={()=>setActive(null)}>
      <div className="net-bars">
        <span className="net-zero" aria-hidden="true"/>
        {points.map((p,i)=>{const surplus=(p.net||0)>0,height=p.net==null?0:Math.max(3,(Math.abs(p.net)/max)*100);return <button key={p.date} className={`net-day ${i===active?'selected':''}`} aria-label={`${longDate(p.date)}: ${p.net==null?'no data':p.net>0?`${fmt(p.net)} kcal surplus`:`${fmt(-p.net)} kcal deficit`}`} onMouseEnter={()=>setActive(i)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} onClick={()=>setActive(i)}>
<span className="net-up">{p.net!=null&&surplus&&<i className="net-bar surplus" style={{'--net-height':`${height}%`} as CSSProperties}/>}</span>
<span className="net-down">{p.net!=null&&!surplus&&<i className="net-bar deficit" style={{'--net-height':`${height}%`} as CSSProperties}/>}</span>
        </button>})}
      </div>
      <div className="net-axis" aria-hidden="true">{points.map((p,i)=><span key={p.date}>{i===0||i===points.length-1||i%step===0?dateFmt(p.date):''}</span>)}</div>
    </div>
  </div>
}
function ChartLegend({items}:{items:Array<[string,string]>}){return <div className="chart-legend">{items.map(([className,label])=><span key={label}><i className={className}/>{label}</span>)}</div>}
function NutrientGrid({nutrients}:{nutrients:NutrientTotals|undefined}){const tracked=NUTRIENT_DISPLAY.filter(([key])=>nutrients?.[key]!=null);if(!tracked.length)return <section className="panel"><div className="empty">Detailed nutrients will appear as newly logged foods include them.</div></section>;return <section className="panel nutrient-grid">{tracked.map(([key,label,unit,decimals])=><div className="nutrient-item" key={key}><span>{label}</span><strong>{fmt(nutrients?.[key],decimals)}<small>{unit}</small></strong></div>)}</section>}
function GoalRing({label,value,target,unit}:{label:string;value:N|undefined;target:number;unit:string}){const pct=Math.min(100,Math.max(0,((value||0)/target)*100)),{ref,visible}=useInView<HTMLDivElement>();return <div ref={ref} className={`goal-ring ${visible?'is-visible':''}`}><div className="ring" style={{'--pct':`${pct*3.6}deg`} as CSSProperties}><div><strong>{fmt(value)}</strong><span>of {fmt(target)} {unit}</span></div></div><h3>{label}</h3></div>}
function GoalBar({label,value,target,unit}:{label:string;value:N|undefined;target:number;unit:string}){const pct=Math.min(120,Math.max(0,((value||0)/target)*100)),{ref,visible}=useInView<HTMLDivElement>();return <div ref={ref} className={`goal-bar ${visible?'is-visible':''}`}><div><strong>{label}</strong><span>{fmt(value)} / {fmt(target)} {unit}</span></div><div className="track"><i style={{'--goal-width':`${Math.min(100,pct)}%`} as CSSProperties}/></div></div>}
function Metric({icon,label,value,unit,decimals=0,display}:{icon:ReactNode;label:string;value:N|undefined;unit:string;decimals?:number;display?:string}){return <section className="metric-card panel"><span>{icon}</span><div><p>{label}</p><strong>{display||fmt(value,decimals)}</strong>{value!=null&&!display&&<small>{unit}</small>}</div></section>}
function Section({title,detail}:{title:string;detail:string}){return <div className="section-title"><h2>{title}</h2><p>{detail}</p></div>}
function EntryList({children,empty}:{children:ReactNode;empty:string}){const a=Array.isArray(children)?children:[children];return a.length?<div className="entry-list">{children}</div>:<div className="empty">{empty}</div>}
function FoodRow({e,deleting,onDelete,onEdit}:{e:FoodEntry;deleting:boolean;onDelete:()=>void;onEdit:()=>void}){const details=[e.nutrients?.sugarsG!=null?`${fmt(e.nutrients.sugarsG,1)}g sugar`:'',e.nutrients?.sodiumMg!=null?`${fmt(e.nutrients.sodiumMg)}mg sodium`:'',e.nutrients?.caffeineMg!=null?`${fmt(e.nutrients.caffeineMg)}mg caffeine`:''].filter(Boolean).join(' · ');return <article className="entry food-entry"><div><strong>{e.food||e.meal}</strong><span>{[e.time,e.meal,e.portion].filter(Boolean).join(' · ')}</span>{details&&<span className="food-micro">{details}</span>}</div><div className="entry-actions"><div className="entry-nutrition"><strong>{fmt(e.calories)} kcal</strong><span>{fmt(e.protein,1)}g protein · {fmt(e.carbs,1)}g carbs · {fmt(e.fat,1)}g fat · {fmt(e.fiber,1)}g fiber</span></div><div className="entry-buttons"><button className="edit-entry-button" disabled={deleting||!e.id} onClick={onEdit} aria-label={`Edit ${e.food||'food entry'}`} title="Edit food entry"><Pencil size={15}/><span>Edit</span></button><button className="delete-entry-button" disabled={deleting} onClick={onDelete} aria-label={`Delete ${e.food||'food entry'}`} title="Delete food entry"><Trash2 size={15}/><span>{deleting?'Deleting…':'Delete'}</span></button></div></div></article>}

function EditFoodModal({entry,onClose,onSaved}:{entry:FoodEntry;onClose:()=>void;onSaved:()=>Promise<void>|void}){
  const[form,setForm]=useState({food:entry.food||'',meal:entry.meal||'',portion:entry.portion||'',calories:entry.calories??null as N,protein:entry.protein??null as N,carbs:entry.carbs??null as N,fat:entry.fat??null as N,fiber:entry.fiber??null as N})
  const[busy,setBusy]=useState(false)
  const[message,setMessage]=useState('')
  const num=(v:N)=>v==null?'':String(v)
  const setNum=(key:'calories'|'protein'|'carbs'|'fat'|'fiber')=>(value:string)=>setForm(f=>({...f,[key]:value===''?null:Number(value)}))
  const save=async()=>{
    if(!form.food.trim()){setMessage('A food name is required.');return}
    setBusy(true);setMessage('')
    try{
      const r=await fetch('/api/mlog',{method:'PUT',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({entryId:entry.id,description:form.food.trim(),meal:form.meal.trim(),portion:form.portion.trim(),calories:form.calories,protein:form.protein,carbs:form.carbs,fat:form.fat,fiber:form.fiber})})
      const p=await r.json();if(!r.ok)throw new Error(p.error||'Unable to update this food entry.')
      await onSaved();onClose()
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to update this food entry.')}finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="goals-modal panel" role="dialog" aria-modal="true"><div className="sync-modal-head"><div><h2>Edit food</h2><p>Update this diary entry.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <label className="goal-field"><span>Food</span><input type="text" value={form.food} onChange={e=>setForm(f=>({...f,food:e.target.value}))} placeholder="e.g. Grilled chicken bowl"/></label>
    <div className="goal-config-grid">
      <label className="goal-field"><span>Meal</span><input type="text" value={form.meal} onChange={e=>setForm(f=>({...f,meal:e.target.value}))} placeholder="Breakfast, Lunch…"/></label>
      <label className="goal-field"><span>Portion</span><input type="text" value={form.portion} onChange={e=>setForm(f=>({...f,portion:e.target.value}))} placeholder="1 bowl"/></label>
      <label className="goal-field"><span>Calories<small>kcal</small></span><input type="number" min="0" step="1" value={num(form.calories)} onChange={e=>setNum('calories')(e.target.value)}/></label>
      <label className="goal-field"><span>Protein<small>g</small></span><input type="number" min="0" step="0.1" value={num(form.protein)} onChange={e=>setNum('protein')(e.target.value)}/></label>
      <label className="goal-field"><span>Carbs<small>g</small></span><input type="number" min="0" step="0.1" value={num(form.carbs)} onChange={e=>setNum('carbs')(e.target.value)}/></label>
      <label className="goal-field"><span>Fat<small>g</small></span><input type="number" min="0" step="0.1" value={num(form.fat)} onChange={e=>setNum('fat')(e.target.value)}/></label>
      <label className="goal-field"><span>Fiber<small>g</small></span><input type="number" min="0" step="0.1" value={num(form.fiber)} onChange={e=>setNum('fiber')(e.target.value)}/></label>
    </div>
    <button className="save-goals-button" disabled={busy} onClick={()=>void save()}><Save size={17}/>{busy?'Saving…':'Save changes'}</button>
    {message&&<p className="sync-message">{message}</p>}
  </section></div>
}
function WorkoutRow({e}:{e:WorkoutEntry}){const facts=[e.swimmingDistanceYards!=null?`${fmt(e.swimmingDistanceYards)} yd`:e.distanceMiles!=null?`${fmt(e.distanceMiles,2)} mi`:'',e.strokeCount!=null?`${fmt(e.strokeCount)} strokes`:'',e.stepCount!=null?`${fmt(e.stepCount)} steps`:''].filter(Boolean);return <article className="entry"><div><strong>{e.activity||'Activity'}</strong><span>{facts.join(' · ')||e.dataQuality}</span></div><div><span>{e.dataQuality}</span></div></article>}
function Centered({title,text}:{title:string;text:string}){return <main className="center"><RefreshCw className="spin"/><h1>{title}</h1><p>{text}</p></main>}
function SignIn(){return <main className="center"><div className="signin"><h1>Fuel</h1><p>Your private nutrition, activity, and recovery dashboard.</p><button onClick={()=>location.assign('/api/auth/google/start')}><ShieldCheck size={18}/>Sign in with Google</button></div></main>}
