import SwiftUI

// The website's Lifting tab (src/LiftingPage.tsx + src/workouts.ts), transcribed
// whole: same plans, same prescriptions, same view-only stance. Apple Health remains
// the activity log — nothing here writes anywhere, matching the website's own
// "No logging from this page" note.

struct LiftStep {
    enum Phase: String { case warmUp = "Warm-up", strength = "Strength", accessory = "Accessory", core = "Core", coolDown = "Cool-down" }
    var phase: Phase
    var exercise: String
    var prescription: String
    var rest: String?
    var cues: String?
}

struct LiftPlan: Identifiable {
    enum Level: String { case foundation = "Foundation", intermediate = "Intermediate", recovery = "Recovery" }
    var id: String
    var title: String
    var focus: String
    var duration: String
    var level: Level
    var summary: String
    var tags: [String]
    var steps: [LiftStep]
}

private let dynamicUpper = LiftStep(phase: .warmUp, exercise: "Dynamic shoulder preparation",
    prescription: "2 rounds: 10 band pull-aparts, 8 scapular push-ups, 8 wall slides, 6 thoracic rotations/side",
    cues: "Controlled range. No long static holds before loading.")
private let dynamicLower = LiftStep(phase: .warmUp, exercise: "Dynamic lower-body preparation",
    prescription: "2 rounds: 8 bodyweight squats, 6 reverse lunges/side, 8 glute bridges, 8 leg swings/side, 10 calf rocks",
    cues: "Move smoothly through a comfortable full range.")
private let dynamicFull = LiftStep(phase: .warmUp, exercise: "Dynamic full-body preparation",
    prescription: "1-2 rounds: 6 inchworms, 8 squat-to-reach, 8 band pull-aparts, 6 lateral lunges/side",
    cues: "Increase range and speed gradually.")
private let cooldownUpper = LiftStep(phase: .coolDown, exercise: "Upper-body static reset",
    prescription: "30-45 sec each: doorway pec stretch, lat stretch, cross-body rear-shoulder stretch, triceps stretch",
    cues: "Easy tension only. Breathe slowly.")
private let cooldownLower = LiftStep(phase: .coolDown, exercise: "Lower-body static reset",
    prescription: "30-45 sec each: hip flexor, hamstring, calf, glute stretch",
    cues: "No bouncing. Stop if painful.")
private let cooldownFull = LiftStep(phase: .coolDown, exercise: "Full-body static reset",
    prescription: "30-45 sec each: pec, lat, hip flexor, hamstring and calf",
    cues: "Use this for range of motion, not as a soreness cure.")

let workoutPlans: [LiftPlan] = [
    LiftPlan(id: "push-strength", title: "Push Strength", focus: "Chest, triceps, pressing strength",
        duration: "38-43 min", level: .intermediate,
        summary: "Heavy horizontal pressing with shoulder-friendly assistance and limited failure work.",
        tags: ["Chest", "Triceps", "Strength"], steps: [
            LiftStep(phase: .warmUp, exercise: "Erg or bike", prescription: "6-8 min easy-moderate, then 2 gradual bench warm-up sets", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "Barbell or dumbbell bench press", prescription: "4 sets × 4-6 reps @ 2 RIR", rest: "2-3 min", cues: "Touch near nipple line, elbows controlled, stop before form breaks."),
            LiftStep(phase: .strength, exercise: "30° incline dumbbell press", prescription: "3 × 6-9 @ 1-2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Dips or assisted dips", prescription: "2 × 6-10 @ 1-2 RIR", rest: "90 sec", cues: "Use assistance if shoulder position or depth becomes unstable."),
            LiftStep(phase: .accessory, exercise: "Overhead rope triceps extension", prescription: "2 × 10-15; final set optional drop by 20-25%", rest: "60 sec", cues: "Only the last isolation set approaches technical failure."),
            cooldownUpper,
        ]),
    LiftPlan(id: "pull-strength", title: "Pull Strength", focus: "Lats, mid-back, biceps",
        duration: "38-44 min", level: .intermediate,
        summary: "Vertical pull plus heavy rows, with rear-deltoid balance and efficient arm work.",
        tags: ["Back", "Biceps", "Strength"], steps: [
            LiftStep(phase: .warmUp, exercise: "Erg", prescription: "1000-1500 m easy, then 2 light pulling ramp sets", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "Pull-ups or neutral-grip pulldown", prescription: "4 × 4-7 @ 2 RIR", rest: "2 min", cues: nil),
            LiftStep(phase: .strength, exercise: "Chest-supported row", prescription: "3 × 6-9 @ 1-2 RIR", rest: "90 sec", cues: "Pause briefly with shoulder blades retracted."),
            LiftStep(phase: .accessory, exercise: "One-arm cable row + reverse fly", prescription: "2 supersets: 10-12/side + 12-15", rest: "60 sec after pair", cues: "Reverse fly in a T or slight Y path, not a shrugging N path."),
            LiftStep(phase: .accessory, exercise: "Hammer curl", prescription: "2 × 8-12 @ 1-2 RIR", rest: "60 sec", cues: nil),
            cooldownUpper,
        ]),
    LiftPlan(id: "legs-strength", title: "Lower Strength", focus: "Squat, hinge, calves",
        duration: "40-45 min", level: .intermediate,
        summary: "Low-rep squat work with a moderate hinge dose that preserves running and swimming recovery.",
        tags: ["Legs", "Strength", "Compound"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "6 min easy, then 2-3 progressive squat warm-up sets", rest: nil, cues: nil),
            dynamicLower,
            LiftStep(phase: .accessory, exercise: "Standing calf raise", prescription: "2 × 10-15 with 2-sec stretch", rest: "45 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Back squat or safety-bar squat", prescription: "4 × 4-6 @ 2 RIR", rest: "2-3 min", cues: nil),
            LiftStep(phase: .strength, exercise: "Romanian deadlift", prescription: "3 × 6-8 @ 2 RIR", rest: "2 min", cues: "Bar stays close to legs; hinge at hips with a neutral spine."),
            LiftStep(phase: .accessory, exercise: "Hamstring curl", prescription: "2 × 10-15 @ 1-2 RIR", rest: "60 sec", cues: nil),
            cooldownLower,
        ]),
    LiftPlan(id: "full-body-a", title: "Full Body A", focus: "Squat, push, pull",
        duration: "35-42 min", level: .foundation,
        summary: "A complete session built around three movement patterns and paired accessories.",
        tags: ["Full body", "Efficient"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike or erg", prescription: "5-7 min conversational pace", rest: nil, cues: nil),
            dynamicFull,
            LiftStep(phase: .strength, exercise: "Goblet squat or front squat", prescription: "3 × 6-10 @ 2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Dumbbell bench press + seated cable row", prescription: "3 supersets: 6-10 + 8-12 @ 1-2 RIR", rest: "90 sec after pair", cues: nil),
            LiftStep(phase: .accessory, exercise: "Romanian deadlift + face pull", prescription: "2 supersets: 8-10 + 12-15", rest: "75 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Dead bug", prescription: "2 × 6-8 slow reps/side", rest: "30 sec", cues: nil),
            cooldownFull,
        ]),
    LiftPlan(id: "full-body-b", title: "Full Body B", focus: "Hinge, vertical push, vertical pull",
        duration: "36-43 min", level: .foundation,
        summary: "Hinge-dominant full body work with shoulder and trunk stability.",
        tags: ["Full body", "Posterior chain"], steps: [
            LiftStep(phase: .warmUp, exercise: "Erg", prescription: "1000 m easy-moderate", rest: nil, cues: nil),
            dynamicFull,
            LiftStep(phase: .strength, exercise: "Trap-bar deadlift", prescription: "4 × 3-5 @ 2 RIR", rest: "2-3 min", cues: nil),
            LiftStep(phase: .strength, exercise: "Landmine press + neutral-grip pulldown", prescription: "3 supersets: 8-10/side + 8-12", rest: "90 sec after pair", cues: nil),
            LiftStep(phase: .accessory, exercise: "Reverse lunge", prescription: "2 × 8/side @ 2 RIR", rest: "75 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Pallof press", prescription: "2 × 10/side with 2-sec hold", rest: "30 sec", cues: nil),
            cooldownFull,
        ]),
    LiftPlan(id: "swimmer-shoulders", title: "Swimmer Shoulder Balance", focus: "Scapulae, rear delts, rotator cuff",
        duration: "30-36 min", level: .foundation,
        summary: "Low-fatigue upper-body work to support swimming volume without adding redundant front-delt stress.",
        tags: ["Swimming", "Shoulders", "Prehab"], steps: [
            LiftStep(phase: .warmUp, exercise: "Easy bike", prescription: "5 min", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "Chest-supported neutral-grip row", prescription: "3 × 8-12 @ 2-3 RIR", rest: "75 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Cable reverse fly + face pull", prescription: "3 supersets: 12-15 + 12-15", rest: "45 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Cable external rotation", prescription: "2 × 12-15/side, controlled", rest: "30 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Serratus wall slide or push-up plus", prescription: "2 × 10-12", rest: "30 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Side plank", prescription: "2 × 25-40 sec/side", rest: nil, cues: nil),
            cooldownUpper,
        ]),
    LiftPlan(id: "runner-resilience", title: "Runner Resilience", focus: "Single-leg strength, calves, hamstrings",
        duration: "35-42 min", level: .foundation,
        summary: "Unilateral and calf-focused strength that complements running while controlling soreness.",
        tags: ["Running", "Legs", "Injury resilience"], steps: [
            LiftStep(phase: .warmUp, exercise: "Treadmill", prescription: "8 min easy incline walk or jog", rest: nil, cues: nil),
            dynamicLower,
            LiftStep(phase: .strength, exercise: "Rear-foot-elevated split squat", prescription: "3 × 6-9/side @ 2 RIR", rest: "75 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Single-leg Romanian deadlift", prescription: "3 × 8/side @ 2 RIR", rest: "60 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Seated calf raise + tibialis raise", prescription: "3 supersets: 10-15 + 15-20", rest: "45 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Hamstring curl", prescription: "2 × 10-15", rest: "60 sec", cues: nil),
            cooldownLower,
        ]),
    LiftPlan(id: "chest-triceps", title: "Chest + Triceps Density", focus: "Chest hypertrophy, triceps",
        duration: "34-40 min", level: .intermediate,
        summary: "Time-efficient paired pressing with one evidence-based intensity technique at the end.",
        tags: ["Chest", "Triceps", "Hypertrophy"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "5 min, then band pull-aparts and 2 press ramp sets", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "30° incline dumbbell press", prescription: "3 × 6-10 @ 1-2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Cable fly + close-grip push-up", prescription: "3 supersets: 10-15 + near 2 RIR", rest: "75 sec", cues: "Fly across the body without losing shoulder position."),
            LiftStep(phase: .accessory, exercise: "Reverse-grip pressdown", prescription: "2 × 10-15", rest: "45 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Rope pressdown mechanical drop set", prescription: "1 set: strict reps to 1 RIR, step closer/reduce load, then 6-10 more clean reps", rest: nil, cues: "Stop at technical failure, not forced-rep failure."),
            cooldownUpper,
        ]),
    LiftPlan(id: "back-biceps", title: "Back + Biceps Density", focus: "Upper and mid-back, arms",
        duration: "34-40 min", level: .intermediate,
        summary: "Compound pulling first, then paired rear-delt and curl work.",
        tags: ["Back", "Biceps", "Hypertrophy"], steps: [
            LiftStep(phase: .warmUp, exercise: "Erg", prescription: "1000 m easy", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "Neutral-grip pull-up or pulldown", prescription: "3 × 6-10 @ 1-2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "One-arm dumbbell row", prescription: "3 × 8-12/side @ 1-2 RIR", rest: "60 sec between sides", cues: nil),
            LiftStep(phase: .accessory, exercise: "Reverse fly + EZ-bar curl", prescription: "3 supersets: 12-15 + 8-12", rest: "60 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Zottman curl", prescription: "2 × 10-14 controlled", rest: "45 sec", cues: nil),
            cooldownUpper,
        ]),
    LiftPlan(id: "posterior-chain", title: "Posterior Chain", focus: "Hamstrings, glutes, back",
        duration: "38-44 min", level: .intermediate,
        summary: "Hinge strength with targeted hamstring and trunk work, avoiding unnecessary deadlift failure.",
        tags: ["Hinge", "Hamstrings", "Glutes"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "6 min, then 2 deadlift ramp sets", rest: nil, cues: nil),
            dynamicLower,
            LiftStep(phase: .strength, exercise: "Romanian deadlift", prescription: "4 × 5-8 @ 2 RIR", rest: "2 min", cues: nil),
            LiftStep(phase: .strength, exercise: "Hip thrust", prescription: "3 × 8-12 @ 1-2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Seated or lying hamstring curl", prescription: "3 × 10-15", rest: "60 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Bird dog + suitcase carry", prescription: "2 rounds: 6/side + 30-40 m/side", rest: "45 sec", cues: nil),
            cooldownLower,
        ]),
    LiftPlan(id: "squat-volume", title: "Squat Volume", focus: "Quads, glutes, squat skill",
        duration: "38-45 min", level: .intermediate,
        summary: "Moderate-load squat practice and unilateral work without maximal loading.",
        tags: ["Squat", "Quads", "Volume"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "6-8 min, then 2 squat ramp sets", rest: nil, cues: nil),
            dynamicLower,
            LiftStep(phase: .strength, exercise: "Front squat or high-bar squat", prescription: "4 × 6-8 @ 2 RIR", rest: "2 min", cues: nil),
            LiftStep(phase: .accessory, exercise: "Leg press", prescription: "3 × 10-15 @ 1-2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Walking lunge", prescription: "2 × 8-10/side", rest: "75 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Calf raise", prescription: "3 × 10-15 with full pause", rest: "45 sec", cues: nil),
            cooldownLower,
        ]),
    LiftPlan(id: "upper-balanced", title: "Balanced Upper", focus: "Horizontal push/pull, shoulders",
        duration: "36-42 min", level: .foundation,
        summary: "Equal pressing and pulling volume with rear-shoulder emphasis.",
        tags: ["Upper body", "Balanced"], steps: [
            LiftStep(phase: .warmUp, exercise: "Erg or bike", prescription: "6 min", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "Dumbbell bench press + chest-supported row", prescription: "4 supersets: 6-10 + 8-12", rest: "90 sec after pair", cues: nil),
            LiftStep(phase: .strength, exercise: "Landmine press + pulldown", prescription: "3 supersets: 8-10/side + 8-12", rest: "75 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Cable reverse fly", prescription: "2 × 12-18", rest: "45 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Rope triceps pressdown + hammer curl", prescription: "2 supersets: 10-15 + 8-12", rest: "45 sec", cues: nil),
            cooldownUpper,
        ]),
    LiftPlan(id: "power-primer", title: "Whole-Body Power Primer", focus: "Explosive intent, low fatigue",
        duration: "30-35 min", level: .intermediate,
        summary: "Fast, low-rep medicine-ball and strength work for power without grinding reps.",
        tags: ["Power", "Athletic", "Low fatigue"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "5 min with 3 × 10-sec cadence pickups", rest: nil, cues: nil),
            dynamicFull,
            LiftStep(phase: .strength, exercise: "Medicine-ball slam", prescription: "5 × 3 explosive reps with 10 lb ball", rest: "45-60 sec", cues: "Every rep fast. Stop if speed drops."),
            LiftStep(phase: .strength, exercise: "Trap-bar deadlift", prescription: "5 × 3 @ ~70-80%, 3 RIR", rest: "90 sec", cues: "Accelerate the bar; no grinding."),
            LiftStep(phase: .strength, exercise: "Plyometric push-up or fast incline push-up", prescription: "4 × 3-5", rest: "60 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Pallof press", prescription: "2 × 8/side", rest: nil, cues: nil),
            cooldownFull,
        ]),
    LiftPlan(id: "minimal-full", title: "Minimum Effective Full Body", focus: "Whole body on a busy day",
        duration: "30-34 min", level: .foundation,
        summary: "One hard work set plus a back-off set per pattern for a high return on limited time.",
        tags: ["Busy day", "Full body"], steps: [
            LiftStep(phase: .warmUp, exercise: "Erg or bike", prescription: "5 min", rest: nil, cues: nil),
            dynamicFull,
            LiftStep(phase: .strength, exercise: "Leg press or squat", prescription: "1 top set × 6-10 @ 1 RIR, then 1 back-off set × 10-12", rest: "2 min", cues: nil),
            LiftStep(phase: .strength, exercise: "Dumbbell bench press", prescription: "1 top set × 6-10 @ 1 RIR, then 1 back-off set × 10-12", rest: "90 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Cable row or pulldown", prescription: "1 top set × 6-10 @ 1 RIR, then 1 back-off set × 10-12", rest: "90 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Romanian deadlift", prescription: "2 × 8-10 @ 2 RIR", rest: "90 sec", cues: nil),
            cooldownFull,
        ]),
    LiftPlan(id: "recovery-pump-upper", title: "Upper Recovery Pump", focus: "Blood flow, technique, recovery",
        duration: "30-35 min", level: .recovery,
        summary: "Low-load, far-from-failure work after demanding training days. Not a 100-rep exhaustion test.",
        tags: ["Recovery", "Upper body", "Light"], steps: [
            LiftStep(phase: .warmUp, exercise: "Easy bike", prescription: "8 min nasal-breathing pace", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .accessory, exercise: "Machine chest press + cable row", prescription: "3 supersets × 15-20 each @ 4-5 RIR", rest: "45 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Face pull + rope pressdown + cable curl", prescription: "2 circuits × 15-20 each @ 4 RIR", rest: "45 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Easy plank", prescription: "2 × 30 sec", rest: nil, cues: nil),
            cooldownUpper,
        ]),
    LiftPlan(id: "recovery-pump-lower", title: "Lower Recovery Pump", focus: "Circulation, joint-friendly legs",
        duration: "30-35 min", level: .recovery,
        summary: "Easy lower-body volume for movement quality between harder run, swim, or lift days.",
        tags: ["Recovery", "Legs", "Light"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "10 min easy", rest: nil, cues: nil),
            dynamicLower,
            LiftStep(phase: .accessory, exercise: "Leg press + hamstring curl", prescription: "3 supersets × 15-20 each @ 4-5 RIR", rest: "45 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Calf raise + bodyweight split squat", prescription: "2 supersets × 15-20 + 10/side", rest: "45 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Dead bug", prescription: "2 × 6/side slow", rest: nil, cues: nil),
            cooldownLower,
        ]),
    LiftPlan(id: "core-carry", title: "Core + Carries", focus: "Anti-extension, anti-rotation, grip",
        duration: "30-36 min", level: .foundation,
        summary: "Trunk stiffness and loaded carries rather than repeated spinal flexion alone.",
        tags: ["Core", "Carries", "Grip"], steps: [
            LiftStep(phase: .warmUp, exercise: "Treadmill incline walk", prescription: "8 min", rest: nil, cues: nil),
            dynamicFull,
            LiftStep(phase: .core, exercise: "Dead bug + side plank", prescription: "3 rounds: 6-8/side + 25-40 sec/side", rest: "30 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Pallof press + cable chop", prescription: "3 rounds: 10/side + 8/side", rest: "45 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Suitcase carry", prescription: "4 × 30-40 m/side", rest: "45 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Farmer carry", prescription: "3 × 40-60 m, strong posture", rest: "60 sec", cues: nil),
            cooldownFull,
        ]),
    LiftPlan(id: "arms-efficient", title: "Arms Efficient", focus: "Biceps, triceps, forearms",
        duration: "30-35 min", level: .intermediate,
        summary: "Three paired arm movements with long-length triceps and elbow-flexor variety.",
        tags: ["Arms", "Supersets"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "5 min", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .accessory, exercise: "Overhead rope extension + incline dumbbell curl", prescription: "3 supersets × 8-12 each @ 1-2 RIR", rest: "60 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Reverse-grip pressdown + hammer curl", prescription: "3 supersets × 10-15 + 8-12", rest: "50 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Rope pressdown + Zottman curl", prescription: "2 supersets × 12-18 + 10-14", rest: "45 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Wrist roller or light reverse curl", prescription: "2 controlled rounds", rest: "45 sec", cues: nil),
            cooldownUpper,
        ]),
    LiftPlan(id: "dips-pike", title: "Dips + Pike Push-ups", focus: "Chest, triceps, shoulders",
        duration: "32-38 min", level: .intermediate,
        summary: "Bodyweight-biased pressing using dips and pike push-ups with pulling balance.",
        tags: ["Bodyweight", "Push", "Shoulders"], steps: [
            LiftStep(phase: .warmUp, exercise: "Erg", prescription: "1000 m easy", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "Dips or assisted dips", prescription: "4 × 5-10 @ 2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Pike push-up", prescription: "3 × 6-10 @ 2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Inverted row", prescription: "3 × 8-12 @ 2 RIR", rest: "75 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Cable fly + face pull", prescription: "2 supersets × 12-15 each", rest: "45 sec", cues: nil),
            cooldownUpper,
        ]),
    LiftPlan(id: "deadlift-row", title: "Deadlift + Row", focus: "Lower back, mid-back, posterior chain",
        duration: "38-44 min", level: .intermediate,
        summary: "Technical deadlifting followed by supported rowing to limit unnecessary spinal fatigue.",
        tags: ["Deadlift", "Back", "Posterior chain"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "6 min plus 3 deadlift ramp sets", rest: nil, cues: nil),
            dynamicLower,
            LiftStep(phase: .strength, exercise: "Conventional or trap-bar deadlift", prescription: "5 × 3 @ 2-3 RIR", rest: "2-3 min", cues: "Bar tracks close to the legs. End set if position changes."),
            LiftStep(phase: .strength, exercise: "Chest-supported row", prescription: "3 × 8-12 @ 1-2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Hamstring curl + shrug", prescription: "2 supersets × 10-15 + 10-15", rest: "60 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Bird dog", prescription: "2 × 6/side slow", rest: nil, cues: nil),
            cooldownFull,
        ]),
    LiftPlan(id: "unilateral-legs", title: "Unilateral Legs", focus: "Single-leg strength and control",
        duration: "36-42 min", level: .intermediate,
        summary: "Split-stance work for strength symmetry without the axial load of heavy squats.",
        tags: ["Legs", "Unilateral", "Balance"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "6 min", rest: nil, cues: nil),
            dynamicLower,
            LiftStep(phase: .strength, exercise: "Rear-foot-elevated split squat", prescription: "4 × 6-9/side @ 2 RIR", rest: "75 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Single-leg Romanian deadlift", prescription: "3 × 8-10/side", rest: "60 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Step-up", prescription: "2 × 8/side, controlled lowering", rest: "60 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Single-leg calf raise", prescription: "3 × 12-18/side", rest: "30 sec", cues: nil),
            cooldownLower,
        ]),
    LiftPlan(id: "upper-strength-cluster", title: "Upper Strength Clusters", focus: "Bench and pull-up strength",
        duration: "36-42 min", level: .intermediate,
        summary: "Small intra-set breaks preserve rep quality on heavy upper-body work.",
        tags: ["Strength", "Cluster sets", "Upper body"], steps: [
            LiftStep(phase: .warmUp, exercise: "Erg", prescription: "1000 m plus 2-3 bench and pull-up ramp sets", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "Bench press cluster", prescription: "4 rounds of 2+2 reps with 20 sec intra-set rest @ ~4-6RM load", rest: "2 min between rounds", cues: "No grinding. Keep 1-2 reps in reserve across the cluster."),
            LiftStep(phase: .strength, exercise: "Pull-up or pulldown cluster", prescription: "4 rounds of 3+3 reps with 20 sec intra-set rest", rest: "90 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Chest-supported row + rope pressdown", prescription: "2 supersets × 8-12 + 10-15", rest: "60 sec", cues: nil),
            cooldownUpper,
        ]),
    LiftPlan(id: "lower-strength-cluster", title: "Lower Strength Clusters", focus: "Squat strength, rep quality",
        duration: "38-44 min", level: .intermediate,
        summary: "Clustered squat reps maintain technique while limiting fatigue accumulation.",
        tags: ["Strength", "Cluster sets", "Legs"], steps: [
            LiftStep(phase: .warmUp, exercise: "Bike", prescription: "7 min plus 3 squat ramp sets", rest: nil, cues: nil),
            dynamicLower,
            LiftStep(phase: .strength, exercise: "Back squat cluster", prescription: "4 rounds of 2+2 reps with 20 sec intra-set rest @ ~5RM load", rest: "2-3 min between rounds", cues: nil),
            LiftStep(phase: .strength, exercise: "Romanian deadlift", prescription: "3 × 6-8 @ 2 RIR", rest: "2 min", cues: nil),
            LiftStep(phase: .accessory, exercise: "Calf raise + hamstring curl", prescription: "2 supersets × 12-15 each", rest: "45 sec", cues: nil),
            cooldownLower,
        ]),
    LiftPlan(id: "treadmill-lift", title: "Treadmill + Compact Lift", focus: "Aerobic warm-up and whole body",
        duration: "40-45 min", level: .foundation,
        summary: "A longer treadmill start followed by a deliberately compact strength circuit.",
        tags: ["Treadmill", "Full body", "Hybrid"], steps: [
            LiftStep(phase: .warmUp, exercise: "Treadmill", prescription: "15 min easy Zone 2 walk/jog; final 2 min gradually faster", rest: nil, cues: nil),
            dynamicFull,
            LiftStep(phase: .strength, exercise: "Goblet squat + dumbbell bench + cable row", prescription: "3 circuits × 8-12 each @ 2 RIR", rest: "75 sec after circuit", cues: nil),
            LiftStep(phase: .strength, exercise: "Romanian deadlift + landmine press", prescription: "2 supersets × 8-10 + 8/side", rest: "60 sec", cues: nil),
            LiftStep(phase: .core, exercise: "Plank", prescription: "2 × 30-45 sec", rest: nil, cues: nil),
            cooldownFull,
        ]),
    LiftPlan(id: "erg-lift", title: "2000 m Erg + Pull-Push", focus: "Rowing warm-up, upper body",
        duration: "38-44 min", level: .foundation,
        summary: "Your preferred 2000 m erg followed by concise upper-body strength work.",
        tags: ["Erg", "Upper body", "Hybrid"], steps: [
            LiftStep(phase: .warmUp, exercise: "Row erg", prescription: "2000 m at easy-moderate pace, not a time trial", rest: nil, cues: nil),
            dynamicUpper,
            LiftStep(phase: .strength, exercise: "Dumbbell bench press + seated row", prescription: "3 supersets × 6-10 + 8-12 @ 2 RIR", rest: "90 sec", cues: nil),
            LiftStep(phase: .strength, exercise: "Pulldown + landmine press", prescription: "3 supersets × 8-12 + 8/side", rest: "75 sec", cues: nil),
            LiftStep(phase: .accessory, exercise: "Face pull + rope pressdown", prescription: "2 supersets × 12-15 each", rest: "45 sec", cues: nil),
            cooldownUpper,
        ]),
]

struct LiftingView: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Panel {
                    Text("Choose a 30-45 minute session.")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Palette.ink(scheme))
                    Text("These plans prioritize high-quality compound work, controlled weekly fatigue, and time-efficient supersets. Most working sets stop one to three repetitions before technical failure. Drop sets and cluster sets are used selectively rather than as defaults, and the recovery sessions stay deliberately easy.")
                        .font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                    FlowChips(items: ["Dynamic warm-up first", "1-3 reps in reserve", "Compound lifts prioritized", "Static stretching last", "No logging from this page"])
                }
                ForEach(workoutPlans) { plan in
                    NavigationLink { LiftPlanDetailView(plan: plan) } label: { LiftCard(plan: plan) }
                        .buttonStyle(.plain)
                }
                Panel(title: "Programming basis") {
                    Text("The library uses progressive resistance training principles, adequate rest for strength work, moderate proximity to failure, full-range compound movements, and non-competing supersets when time is limited. Dynamic movements prepare the session, while short static holds are reserved for the end. Because running and swimming already create substantial endurance load, lower-body volume and failure work are constrained to protect recovery.")
                        .font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                }
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Lifting")
    }
}

private struct LiftCard: View {
    @Environment(\.colorScheme) private var scheme
    let plan: LiftPlan

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(plan.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink(scheme))
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Palette.muted(scheme))
            }
            Text(plan.focus).font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
            Text(plan.summary).font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
            HStack(spacing: 10) {
                Label(plan.duration, systemImage: "timer").font(.caption)
                LevelPill(level: plan.level)
            }
            .foregroundStyle(Palette.muted(scheme))
            FlowChips(items: plan.tags, small: true)
        }
        .padding(16)
        .background(Palette.panel(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Palette.border(scheme), lineWidth: 1))
    }
}

private struct LevelPill: View {
    @Environment(\.colorScheme) private var scheme
    let level: LiftPlan.Level

    private var tint: Color {
        switch level {
        case .foundation: return Palette.muted(scheme)
        case .intermediate: return DashboardTheme.shared.accent
        case .recovery: return .green
        }
    }

    var body: some View {
        Text(level.rawValue)
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(tint.opacity(0.15), in: Capsule())
            .foregroundStyle(tint)
    }
}

private struct FlowChips: View {
    @Environment(\.colorScheme) private var scheme
    let items: [String]
    var small = false

    var body: some View {
        // No native flow layout pre-iOS 16; a wrapping HStack via a simple grid reads
        // fine here since tag lists are short and captions are compact.
        LazyVGrid(columns: [GridItem(.adaptive(minimum: small ? 70 : 130), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.system(size: small ? 10 : 11, weight: .medium))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Palette.surface(scheme), in: Capsule())
                    .foregroundStyle(Palette.muted(scheme))
                    .lineLimit(1)
            }
        }
    }
}

struct LiftPlanDetailView: View {
    @Environment(\.colorScheme) private var scheme
    let plan: LiftPlan

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Panel {
                    HStack {
                        LevelPill(level: plan.level)
                        Spacer()
                    }
                    Text(plan.title).font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink(scheme))
                    Text(plan.summary).font(.system(size: 14)).foregroundStyle(Palette.muted(scheme))
                    HStack(spacing: 14) {
                        Label(plan.duration, systemImage: "timer")
                        Label(plan.focus, systemImage: "target")
                    }
                    .font(.caption).foregroundStyle(Palette.muted(scheme))
                    FlowChips(items: plan.tags)
                }
                Panel {
                    ForEach(Array(plan.steps.enumerated()), id: \.offset) { index, step in
                        StepRow(step: step)
                        if index < plan.steps.count - 1 { Divider() }
                    }
                }
                Panel {
                    Text("Choose loads that preserve the listed repetitions in reserve (RIR). Technical failure means the next repetition would require altered range, posture, or assistance. Do not force painful ranges, and use a spotter or safety arms for heavy presses and squats.")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                }
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Lifting")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct StepRow: View {
    @Environment(\.colorScheme) private var scheme
    let step: LiftStep

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(step.phase.rawValue)
                .font(.system(size: 10, weight: .semibold))
                .textCase(.uppercase)
                .foregroundStyle(Palette.muted(scheme))
                .frame(width: 64, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(step.exercise).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                Text(step.prescription).font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                if let rest = step.rest {
                    Text("Rest: \(rest)").font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                }
                if let cues = step.cues {
                    Text(cues).font(.system(size: 12)).italic().foregroundStyle(Palette.muted(scheme))
                }
            }
        }
        .padding(.vertical, 8)
    }
}
