export type LiftStep = {
  phase: 'Warm-up' | 'Strength' | 'Accessory' | 'Core' | 'Cool-down'
  exercise: string
  prescription: string
  rest?: string
  cues?: string
}

export type LiftPlan = {
  id: string
  title: string
  focus: string
  duration: string
  level: 'Foundation' | 'Intermediate' | 'Recovery'
  summary: string
  tags: string[]
  steps: LiftStep[]
}

const dynamicUpper: LiftStep = {phase:'Warm-up',exercise:'Dynamic shoulder preparation',prescription:'2 rounds: 10 band pull-aparts, 8 scapular push-ups, 8 wall slides, 6 thoracic rotations/side',cues:'Controlled range. No long static holds before loading.'}
const dynamicLower: LiftStep = {phase:'Warm-up',exercise:'Dynamic lower-body preparation',prescription:'2 rounds: 8 bodyweight squats, 6 reverse lunges/side, 8 glute bridges, 8 leg swings/side, 10 calf rocks',cues:'Move smoothly through a comfortable full range.'}
const dynamicFull: LiftStep = {phase:'Warm-up',exercise:'Dynamic full-body preparation',prescription:'1-2 rounds: 6 inchworms, 8 squat-to-reach, 8 band pull-aparts, 6 lateral lunges/side',cues:'Increase range and speed gradually.'}
const cooldownUpper: LiftStep = {phase:'Cool-down',exercise:'Upper-body static reset',prescription:'30-45 sec each: doorway pec stretch, lat stretch, cross-body rear-shoulder stretch, triceps stretch',cues:'Easy tension only. Breathe slowly.'}
const cooldownLower: LiftStep = {phase:'Cool-down',exercise:'Lower-body static reset',prescription:'30-45 sec each: hip flexor, hamstring, calf, glute stretch',cues:'No bouncing. Stop if painful.'}
const cooldownFull: LiftStep = {phase:'Cool-down',exercise:'Full-body static reset',prescription:'30-45 sec each: pec, lat, hip flexor, hamstring and calf',cues:'Use this for range of motion, not as a soreness cure.'}

export const workoutPlans: LiftPlan[] = [
  {
    id:'push-strength',title:'Push Strength',focus:'Chest, triceps, pressing strength',duration:'38-43 min',level:'Intermediate',summary:'Heavy horizontal pressing with shoulder-friendly assistance and limited failure work.',tags:['Chest','Triceps','Strength'],steps:[
      {phase:'Warm-up',exercise:'Erg or bike',prescription:'6-8 min easy-moderate, then 2 gradual bench warm-up sets'},dynamicUpper,
      {phase:'Strength',exercise:'Barbell or dumbbell bench press',prescription:'4 sets × 4-6 reps @ 2 RIR',rest:'2-3 min',cues:'Touch near nipple line, elbows controlled, stop before form breaks.'},
      {phase:'Strength',exercise:'30° incline dumbbell press',prescription:'3 × 6-9 @ 1-2 RIR',rest:'90 sec'},
      {phase:'Accessory',exercise:'Dips or assisted dips',prescription:'2 × 6-10 @ 1-2 RIR',rest:'90 sec',cues:'Use assistance if shoulder position or depth becomes unstable.'},
      {phase:'Accessory',exercise:'Overhead rope triceps extension',prescription:'2 × 10-15; final set optional drop by 20-25%',rest:'60 sec',cues:'Only the last isolation set approaches technical failure.'},cooldownUpper]
  },
  {
    id:'pull-strength',title:'Pull Strength',focus:'Lats, mid-back, biceps',duration:'38-44 min',level:'Intermediate',summary:'Vertical pull plus heavy rows, with rear-deltoid balance and efficient arm work.',tags:['Back','Biceps','Strength'],steps:[
      {phase:'Warm-up',exercise:'Erg',prescription:'1000-1500 m easy, then 2 light pulling ramp sets'},dynamicUpper,
      {phase:'Strength',exercise:'Pull-ups or neutral-grip pulldown',prescription:'4 × 4-7 @ 2 RIR',rest:'2 min'},
      {phase:'Strength',exercise:'Chest-supported row',prescription:'3 × 6-9 @ 1-2 RIR',rest:'90 sec',cues:'Pause briefly with shoulder blades retracted.'},
      {phase:'Accessory',exercise:'One-arm cable row + reverse fly',prescription:'2 supersets: 10-12/side + 12-15',rest:'60 sec after pair',cues:'Reverse fly in a T or slight Y path, not a shrugging N path.'},
      {phase:'Accessory',exercise:'Hammer curl',prescription:'2 × 8-12 @ 1-2 RIR',rest:'60 sec'},cooldownUpper]
  },
  {
    id:'legs-strength',title:'Lower Strength',focus:'Squat, hinge, calves',duration:'40-45 min',level:'Intermediate',summary:'Low-rep squat work with a moderate hinge dose that preserves running and swimming recovery.',tags:['Legs','Strength','Compound'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'6 min easy, then 2-3 progressive squat warm-up sets'},dynamicLower,
      {phase:'Accessory',exercise:'Standing calf raise',prescription:'2 × 10-15 with 2-sec stretch',rest:'45 sec'},
      {phase:'Strength',exercise:'Back squat or safety-bar squat',prescription:'4 × 4-6 @ 2 RIR',rest:'2-3 min'},
      {phase:'Strength',exercise:'Romanian deadlift',prescription:'3 × 6-8 @ 2 RIR',rest:'2 min',cues:'Bar stays close to legs; hinge at hips with a neutral spine.'},
      {phase:'Accessory',exercise:'Hamstring curl',prescription:'2 × 10-15 @ 1-2 RIR',rest:'60 sec'},cooldownLower]
  },
  {
    id:'full-body-a',title:'Full Body A',focus:'Squat, push, pull',duration:'35-42 min',level:'Foundation',summary:'A complete session built around three movement patterns and paired accessories.',tags:['Full body','Efficient'],steps:[
      {phase:'Warm-up',exercise:'Bike or erg',prescription:'5-7 min conversational pace'},dynamicFull,
      {phase:'Strength',exercise:'Goblet squat or front squat',prescription:'3 × 6-10 @ 2 RIR',rest:'90 sec'},
      {phase:'Strength',exercise:'Dumbbell bench press + seated cable row',prescription:'3 supersets: 6-10 + 8-12 @ 1-2 RIR',rest:'90 sec after pair'},
      {phase:'Accessory',exercise:'Romanian deadlift + face pull',prescription:'2 supersets: 8-10 + 12-15',rest:'75 sec'},
      {phase:'Core',exercise:'Dead bug',prescription:'2 × 6-8 slow reps/side',rest:'30 sec'},cooldownFull]
  },
  {
    id:'full-body-b',title:'Full Body B',focus:'Hinge, vertical push, vertical pull',duration:'36-43 min',level:'Foundation',summary:'Hinge-dominant full body work with shoulder and trunk stability.',tags:['Full body','Posterior chain'],steps:[
      {phase:'Warm-up',exercise:'Erg',prescription:'1000 m easy-moderate'},dynamicFull,
      {phase:'Strength',exercise:'Trap-bar deadlift',prescription:'4 × 3-5 @ 2 RIR',rest:'2-3 min'},
      {phase:'Strength',exercise:'Landmine press + neutral-grip pulldown',prescription:'3 supersets: 8-10/side + 8-12',rest:'90 sec after pair'},
      {phase:'Accessory',exercise:'Reverse lunge',prescription:'2 × 8/side @ 2 RIR',rest:'75 sec'},
      {phase:'Core',exercise:'Pallof press',prescription:'2 × 10/side with 2-sec hold',rest:'30 sec'},cooldownFull]
  },
  {
    id:'swimmer-shoulders',title:'Swimmer Shoulder Balance',focus:'Scapulae, rear delts, rotator cuff',duration:'30-36 min',level:'Foundation',summary:'Low-fatigue upper-body work to support swimming volume without adding redundant front-delt stress.',tags:['Swimming','Shoulders','Prehab'],steps:[
      {phase:'Warm-up',exercise:'Easy bike',prescription:'5 min'},dynamicUpper,
      {phase:'Strength',exercise:'Chest-supported neutral-grip row',prescription:'3 × 8-12 @ 2-3 RIR',rest:'75 sec'},
      {phase:'Accessory',exercise:'Cable reverse fly + face pull',prescription:'3 supersets: 12-15 + 12-15',rest:'45 sec'},
      {phase:'Accessory',exercise:'Cable external rotation',prescription:'2 × 12-15/side, controlled',rest:'30 sec'},
      {phase:'Accessory',exercise:'Serratus wall slide or push-up plus',prescription:'2 × 10-12',rest:'30 sec'},
      {phase:'Core',exercise:'Side plank',prescription:'2 × 25-40 sec/side'},cooldownUpper]
  },
  {
    id:'runner-resilience',title:'Runner Resilience',focus:'Single-leg strength, calves, hamstrings',duration:'35-42 min',level:'Foundation',summary:'Unilateral and calf-focused strength that complements running while controlling soreness.',tags:['Running','Legs','Injury resilience'],steps:[
      {phase:'Warm-up',exercise:'Treadmill',prescription:'8 min easy incline walk or jog'},dynamicLower,
      {phase:'Strength',exercise:'Rear-foot-elevated split squat',prescription:'3 × 6-9/side @ 2 RIR',rest:'75 sec'},
      {phase:'Strength',exercise:'Single-leg Romanian deadlift',prescription:'3 × 8/side @ 2 RIR',rest:'60 sec'},
      {phase:'Accessory',exercise:'Seated calf raise + tibialis raise',prescription:'3 supersets: 10-15 + 15-20',rest:'45 sec'},
      {phase:'Accessory',exercise:'Hamstring curl',prescription:'2 × 10-15',rest:'60 sec'},cooldownLower]
  },
  {
    id:'chest-triceps',title:'Chest + Triceps Density',focus:'Chest hypertrophy, triceps',duration:'34-40 min',level:'Intermediate',summary:'Time-efficient paired pressing with one evidence-based intensity technique at the end.',tags:['Chest','Triceps','Hypertrophy'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'5 min, then band pull-aparts and 2 press ramp sets'},dynamicUpper,
      {phase:'Strength',exercise:'30° incline dumbbell press',prescription:'3 × 6-10 @ 1-2 RIR',rest:'90 sec'},
      {phase:'Accessory',exercise:'Cable fly + close-grip push-up',prescription:'3 supersets: 10-15 + near 2 RIR',rest:'75 sec',cues:'Fly across the body without losing shoulder position.'},
      {phase:'Accessory',exercise:'Reverse-grip pressdown',prescription:'2 × 10-15',rest:'45 sec'},
      {phase:'Accessory',exercise:'Rope pressdown mechanical drop set',prescription:'1 set: strict reps to 1 RIR, step closer/reduce load, then 6-10 more clean reps',cues:'Stop at technical failure, not forced-rep failure.'},cooldownUpper]
  },
  {
    id:'back-biceps',title:'Back + Biceps Density',focus:'Upper and mid-back, arms',duration:'34-40 min',level:'Intermediate',summary:'Compound pulling first, then paired rear-delt and curl work.',tags:['Back','Biceps','Hypertrophy'],steps:[
      {phase:'Warm-up',exercise:'Erg',prescription:'1000 m easy'},dynamicUpper,
      {phase:'Strength',exercise:'Neutral-grip pull-up or pulldown',prescription:'3 × 6-10 @ 1-2 RIR',rest:'90 sec'},
      {phase:'Strength',exercise:'One-arm dumbbell row',prescription:'3 × 8-12/side @ 1-2 RIR',rest:'60 sec between sides'},
      {phase:'Accessory',exercise:'Reverse fly + EZ-bar curl',prescription:'3 supersets: 12-15 + 8-12',rest:'60 sec'},
      {phase:'Accessory',exercise:'Zottman curl',prescription:'2 × 10-14 controlled',rest:'45 sec'},cooldownUpper]
  },
  {
    id:'posterior-chain',title:'Posterior Chain',focus:'Hamstrings, glutes, back',duration:'38-44 min',level:'Intermediate',summary:'Hinge strength with targeted hamstring and trunk work, avoiding unnecessary deadlift failure.',tags:['Hinge','Hamstrings','Glutes'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'6 min, then 2 deadlift ramp sets'},dynamicLower,
      {phase:'Strength',exercise:'Romanian deadlift',prescription:'4 × 5-8 @ 2 RIR',rest:'2 min'},
      {phase:'Strength',exercise:'Hip thrust',prescription:'3 × 8-12 @ 1-2 RIR',rest:'90 sec'},
      {phase:'Accessory',exercise:'Seated or lying hamstring curl',prescription:'3 × 10-15',rest:'60 sec'},
      {phase:'Core',exercise:'Bird dog + suitcase carry',prescription:'2 rounds: 6/side + 30-40 m/side',rest:'45 sec'},cooldownLower]
  },
  {
    id:'squat-volume',title:'Squat Volume',focus:'Quads, glutes, squat skill',duration:'38-45 min',level:'Intermediate',summary:'Moderate-load squat practice and unilateral work without maximal loading.',tags:['Squat','Quads','Volume'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'6-8 min, then 2 squat ramp sets'},dynamicLower,
      {phase:'Strength',exercise:'Front squat or high-bar squat',prescription:'4 × 6-8 @ 2 RIR',rest:'2 min'},
      {phase:'Accessory',exercise:'Leg press',prescription:'3 × 10-15 @ 1-2 RIR',rest:'90 sec'},
      {phase:'Accessory',exercise:'Walking lunge',prescription:'2 × 8-10/side',rest:'75 sec'},
      {phase:'Accessory',exercise:'Calf raise',prescription:'3 × 10-15 with full pause',rest:'45 sec'},cooldownLower]
  },
  {
    id:'upper-balanced',title:'Balanced Upper',focus:'Horizontal push/pull, shoulders',duration:'36-42 min',level:'Foundation',summary:'Equal pressing and pulling volume with rear-shoulder emphasis.',tags:['Upper body','Balanced'],steps:[
      {phase:'Warm-up',exercise:'Erg or bike',prescription:'6 min'},dynamicUpper,
      {phase:'Strength',exercise:'Dumbbell bench press + chest-supported row',prescription:'4 supersets: 6-10 + 8-12',rest:'90 sec after pair'},
      {phase:'Strength',exercise:'Landmine press + pulldown',prescription:'3 supersets: 8-10/side + 8-12',rest:'75 sec'},
      {phase:'Accessory',exercise:'Cable reverse fly',prescription:'2 × 12-18',rest:'45 sec'},
      {phase:'Accessory',exercise:'Rope triceps pressdown + hammer curl',prescription:'2 supersets: 10-15 + 8-12',rest:'45 sec'},cooldownUpper]
  },
  {
    id:'power-primer',title:'Whole-Body Power Primer',focus:'Explosive intent, low fatigue',duration:'30-35 min',level:'Intermediate',summary:'Fast, low-rep medicine-ball and strength work for power without grinding reps.',tags:['Power','Athletic','Low fatigue'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'5 min with 3 × 10-sec cadence pickups'},dynamicFull,
      {phase:'Strength',exercise:'Medicine-ball slam',prescription:'5 × 3 explosive reps with 10 lb ball',rest:'45-60 sec',cues:'Every rep fast. Stop if speed drops.'},
      {phase:'Strength',exercise:'Trap-bar deadlift',prescription:'5 × 3 @ ~70-80%, 3 RIR',rest:'90 sec',cues:'Accelerate the bar; no grinding.'},
      {phase:'Strength',exercise:'Plyometric push-up or fast incline push-up',prescription:'4 × 3-5',rest:'60 sec'},
      {phase:'Core',exercise:'Pallof press',prescription:'2 × 8/side'},cooldownFull]
  },
  {
    id:'minimal-full',title:'Minimum Effective Full Body',focus:'Whole body on a busy day',duration:'30-34 min',level:'Foundation',summary:'One hard work set plus a back-off set per pattern for a high return on limited time.',tags:['Busy day','Full body'],steps:[
      {phase:'Warm-up',exercise:'Erg or bike',prescription:'5 min'},dynamicFull,
      {phase:'Strength',exercise:'Leg press or squat',prescription:'1 top set × 6-10 @ 1 RIR, then 1 back-off set × 10-12',rest:'2 min'},
      {phase:'Strength',exercise:'Dumbbell bench press',prescription:'1 top set × 6-10 @ 1 RIR, then 1 back-off set × 10-12',rest:'90 sec'},
      {phase:'Strength',exercise:'Cable row or pulldown',prescription:'1 top set × 6-10 @ 1 RIR, then 1 back-off set × 10-12',rest:'90 sec'},
      {phase:'Accessory',exercise:'Romanian deadlift',prescription:'2 × 8-10 @ 2 RIR',rest:'90 sec'},cooldownFull]
  },
  {
    id:'recovery-pump-upper',title:'Upper Recovery Pump',focus:'Blood flow, technique, recovery',duration:'30-35 min',level:'Recovery',summary:'Low-load, far-from-failure work after demanding training days. Not a 100-rep exhaustion test.',tags:['Recovery','Upper body','Light'],steps:[
      {phase:'Warm-up',exercise:'Easy bike',prescription:'8 min nasal-breathing pace'},dynamicUpper,
      {phase:'Accessory',exercise:'Machine chest press + cable row',prescription:'3 supersets × 15-20 each @ 4-5 RIR',rest:'45 sec'},
      {phase:'Accessory',exercise:'Face pull + rope pressdown + cable curl',prescription:'2 circuits × 15-20 each @ 4 RIR',rest:'45 sec'},
      {phase:'Core',exercise:'Easy plank',prescription:'2 × 30 sec'},cooldownUpper]
  },
  {
    id:'recovery-pump-lower',title:'Lower Recovery Pump',focus:'Circulation, joint-friendly legs',duration:'30-35 min',level:'Recovery',summary:'Easy lower-body volume for movement quality between harder run, swim, or lift days.',tags:['Recovery','Legs','Light'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'10 min easy'},dynamicLower,
      {phase:'Accessory',exercise:'Leg press + hamstring curl',prescription:'3 supersets × 15-20 each @ 4-5 RIR',rest:'45 sec'},
      {phase:'Accessory',exercise:'Calf raise + bodyweight split squat',prescription:'2 supersets × 15-20 + 10/side',rest:'45 sec'},
      {phase:'Core',exercise:'Dead bug',prescription:'2 × 6/side slow'},cooldownLower]
  },
  {
    id:'core-carry',title:'Core + Carries',focus:'Anti-extension, anti-rotation, grip',duration:'30-36 min',level:'Foundation',summary:'Trunk stiffness and loaded carries rather than repeated spinal flexion alone.',tags:['Core','Carries','Grip'],steps:[
      {phase:'Warm-up',exercise:'Treadmill incline walk',prescription:'8 min'},dynamicFull,
      {phase:'Core',exercise:'Dead bug + side plank',prescription:'3 rounds: 6-8/side + 25-40 sec/side',rest:'30 sec'},
      {phase:'Core',exercise:'Pallof press + cable chop',prescription:'3 rounds: 10/side + 8/side',rest:'45 sec'},
      {phase:'Strength',exercise:'Suitcase carry',prescription:'4 × 30-40 m/side',rest:'45 sec'},
      {phase:'Accessory',exercise:'Farmer carry',prescription:'3 × 40-60 m, strong posture',rest:'60 sec'},cooldownFull]
  },
  {
    id:'arms-efficient',title:'Arms Efficient',focus:'Biceps, triceps, forearms',duration:'30-35 min',level:'Intermediate',summary:'Three paired arm movements with long-length triceps and elbow-flexor variety.',tags:['Arms','Supersets'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'5 min'},dynamicUpper,
      {phase:'Accessory',exercise:'Overhead rope extension + incline dumbbell curl',prescription:'3 supersets × 8-12 each @ 1-2 RIR',rest:'60 sec'},
      {phase:'Accessory',exercise:'Reverse-grip pressdown + hammer curl',prescription:'3 supersets × 10-15 + 8-12',rest:'50 sec'},
      {phase:'Accessory',exercise:'Rope pressdown + Zottman curl',prescription:'2 supersets × 12-18 + 10-14',rest:'45 sec'},
      {phase:'Accessory',exercise:'Wrist roller or light reverse curl',prescription:'2 controlled rounds',rest:'45 sec'},cooldownUpper]
  },
  {
    id:'dips-pike',title:'Dips + Pike Push-ups',focus:'Chest, triceps, shoulders',duration:'32-38 min',level:'Intermediate',summary:'Bodyweight-biased pressing using dips and pike push-ups with pulling balance.',tags:['Bodyweight','Push','Shoulders'],steps:[
      {phase:'Warm-up',exercise:'Erg',prescription:'1000 m easy'},dynamicUpper,
      {phase:'Strength',exercise:'Dips or assisted dips',prescription:'4 × 5-10 @ 2 RIR',rest:'90 sec'},
      {phase:'Strength',exercise:'Pike push-up',prescription:'3 × 6-10 @ 2 RIR',rest:'90 sec'},
      {phase:'Strength',exercise:'Inverted row',prescription:'3 × 8-12 @ 2 RIR',rest:'75 sec'},
      {phase:'Accessory',exercise:'Cable fly + face pull',prescription:'2 supersets × 12-15 each',rest:'45 sec'},cooldownUpper]
  },
  {
    id:'deadlift-row',title:'Deadlift + Row',focus:'Lower back, mid-back, posterior chain',duration:'38-44 min',level:'Intermediate',summary:'Technical deadlifting followed by supported rowing to limit unnecessary spinal fatigue.',tags:['Deadlift','Back','Posterior chain'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'6 min plus 3 deadlift ramp sets'},dynamicLower,
      {phase:'Strength',exercise:'Conventional or trap-bar deadlift',prescription:'5 × 3 @ 2-3 RIR',rest:'2-3 min',cues:'Bar tracks close to the legs. End set if position changes.'},
      {phase:'Strength',exercise:'Chest-supported row',prescription:'3 × 8-12 @ 1-2 RIR',rest:'90 sec'},
      {phase:'Accessory',exercise:'Hamstring curl + shrug',prescription:'2 supersets × 10-15 + 10-15',rest:'60 sec'},
      {phase:'Core',exercise:'Bird dog',prescription:'2 × 6/side slow'},cooldownFull]
  },
  {
    id:'unilateral-legs',title:'Unilateral Legs',focus:'Single-leg strength and control',duration:'36-42 min',level:'Intermediate',summary:'Split-stance work for strength symmetry without the axial load of heavy squats.',tags:['Legs','Unilateral','Balance'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'6 min'},dynamicLower,
      {phase:'Strength',exercise:'Rear-foot-elevated split squat',prescription:'4 × 6-9/side @ 2 RIR',rest:'75 sec'},
      {phase:'Strength',exercise:'Single-leg Romanian deadlift',prescription:'3 × 8-10/side',rest:'60 sec'},
      {phase:'Accessory',exercise:'Step-up',prescription:'2 × 8/side, controlled lowering',rest:'60 sec'},
      {phase:'Accessory',exercise:'Single-leg calf raise',prescription:'3 × 12-18/side',rest:'30 sec'},cooldownLower]
  },
  {
    id:'upper-strength-cluster',title:'Upper Strength Clusters',focus:'Bench and pull-up strength',duration:'36-42 min',level:'Intermediate',summary:'Small intra-set breaks preserve rep quality on heavy upper-body work.',tags:['Strength','Cluster sets','Upper body'],steps:[
      {phase:'Warm-up',exercise:'Erg',prescription:'1000 m plus 2-3 bench and pull-up ramp sets'},dynamicUpper,
      {phase:'Strength',exercise:'Bench press cluster',prescription:'4 rounds of 2+2 reps with 20 sec intra-set rest @ ~4-6RM load',rest:'2 min between rounds',cues:'No grinding. Keep 1-2 reps in reserve across the cluster.'},
      {phase:'Strength',exercise:'Pull-up or pulldown cluster',prescription:'4 rounds of 3+3 reps with 20 sec intra-set rest',rest:'90 sec'},
      {phase:'Accessory',exercise:'Chest-supported row + rope pressdown',prescription:'2 supersets × 8-12 + 10-15',rest:'60 sec'},cooldownUpper]
  },
  {
    id:'lower-strength-cluster',title:'Lower Strength Clusters',focus:'Squat strength, rep quality',duration:'38-44 min',level:'Intermediate',summary:'Clustered squat reps maintain technique while limiting fatigue accumulation.',tags:['Strength','Cluster sets','Legs'],steps:[
      {phase:'Warm-up',exercise:'Bike',prescription:'7 min plus 3 squat ramp sets'},dynamicLower,
      {phase:'Strength',exercise:'Back squat cluster',prescription:'4 rounds of 2+2 reps with 20 sec intra-set rest @ ~5RM load',rest:'2-3 min between rounds'},
      {phase:'Strength',exercise:'Romanian deadlift',prescription:'3 × 6-8 @ 2 RIR',rest:'2 min'},
      {phase:'Accessory',exercise:'Calf raise + hamstring curl',prescription:'2 supersets × 12-15 each',rest:'45 sec'},cooldownLower]
  },
  {
    id:'treadmill-lift',title:'Treadmill + Compact Lift',focus:'Aerobic warm-up and whole body',duration:'40-45 min',level:'Foundation',summary:'A longer treadmill start followed by a deliberately compact strength circuit.',tags:['Treadmill','Full body','Hybrid'],steps:[
      {phase:'Warm-up',exercise:'Treadmill',prescription:'15 min easy Zone 2 walk/jog; final 2 min gradually faster'},dynamicFull,
      {phase:'Strength',exercise:'Goblet squat + dumbbell bench + cable row',prescription:'3 circuits × 8-12 each @ 2 RIR',rest:'75 sec after circuit'},
      {phase:'Strength',exercise:'Romanian deadlift + landmine press',prescription:'2 supersets × 8-10 + 8/side',rest:'60 sec'},
      {phase:'Core',exercise:'Plank',prescription:'2 × 30-45 sec'},cooldownFull]
  },
  {
    id:'erg-lift',title:'2000 m Erg + Pull-Push',focus:'Rowing warm-up, upper body',duration:'38-44 min',level:'Foundation',summary:'Your preferred 2000 m erg followed by concise upper-body strength work.',tags:['Erg','Upper body','Hybrid'],steps:[
      {phase:'Warm-up',exercise:'Row erg',prescription:'2000 m at easy-moderate pace, not a time trial'},dynamicUpper,
      {phase:'Strength',exercise:'Dumbbell bench press + seated row',prescription:'3 supersets × 6-10 + 8-12 @ 2 RIR',rest:'90 sec'},
      {phase:'Strength',exercise:'Pulldown + landmine press',prescription:'3 supersets × 8-12 + 8/side',rest:'75 sec'},
      {phase:'Accessory',exercise:'Face pull + rope pressdown',prescription:'2 supersets × 12-15 each',rest:'45 sec'},cooldownUpper]
  }
]
