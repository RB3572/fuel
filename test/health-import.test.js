import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalize, parseTextPayload } from '../api/health/import.js'

const completeDictionary = {
  hrv: '72.83255626740842', restingHeartRate: '47', walkingrunDistance: '3.07742573133531',
  flightsClimb: '11', excersiseMinutes: '43', swmStrokes: '281', cardioRec: '32',
  runningStrideLength: '1.24', restingEnergy: '1837.115000000009', bloodOx: '98.66666666666667',
  standMins: '121', cardioFitness: '54.84', date: 'Jul 18, 2026 at 12:20\u202fAM',
  BikeDist: '5.2', swimDistance: 1150.000030704476, wlkHRAvg: '',
  sleep: 'Core\nREM\nDeep28800', walkingHr: '80', activeEnergy: '612.7870000000049',
  steps: '6615', respRate: '14.70588235294118',
}

test('normalizes every current Apple Shortcut dictionary key', () => {
  const r = normalize(parseTextPayload(JSON.stringify(completeDictionary)))
  assert.equal(r.date, '2026-07-18')
  assert.equal(r.hrv, 72.83255626740842)
  assert.equal(r.restingHeartRate, 47)
  assert.equal(r.walkingRunningDistance, 3.07742573133531)
  assert.equal(r.flightsClimbed, 11)
  assert.equal(r.exerciseMinutes, 43)
  assert.equal(r.swimmingStrokes, 281)
  assert.equal(r.cardioRecovery, 32)
  assert.equal(r.runningStrideLength, 1.24)
  assert.equal(r.restingEnergy, 1837.115000000009)
  assert.equal(r.bloodOxygen, 98.66666666666667)
  assert.equal(r.standMinutes, 121)
  assert.equal(r.vo2Max, 54.84)
  assert.equal(r.cyclingDistance, 5.2)
  assert.equal(r.swimmingDistance, 1150.000030704476)
  assert.equal(r.walkingHeartRateAverage, 80)
  assert.equal(r.sleepHours, 8)
  assert.equal(r.activeEnergy, 612.7870000000049)
  assert.equal(r.steps, 6615)
  assert.equal(r.respiratoryRate, 14.70588235294118)
  assert.ok(Math.abs(r.totalExpenditure - 2449.902000000014) < 1e-9)
})

test('preserves zero values and treats empty Shortcut values as missing', () => {
  const payload = {"hrv":"","restingHeartRate":"","walkingrunDistance":"","flightsClimb":"","excersiseMinutes":"","swmStrokes":"","cardioRec":"","runningStrideLength":"","restingEnergy":"","bloodOx":"97","standMins":"","cardioFitness":"","date":"Jul 18, 2026 at 12:20\u202fAM","BikeDist":"","swimDistance":0,"wlkHRAvg":"","sleep":"","walkingHr":"","activeEnergy":"3.042999999999999","steps":"","respRate":""}
  const r = normalize(payload)
  assert.equal(r.date, '2026-07-18')
  assert.equal(r.bloodOxygen, 97)
  assert.equal(r.swimmingDistance, 0)
  assert.equal(r.activeEnergy, 3.042999999999999)
  assert.equal(r.runningStrideLength, null)
  assert.equal(r.hrv, null)
  assert.equal(r.totalExpenditure, null)
})

test('blank aliases do not mask populated aliases', () => {
  assert.equal(normalize({ wlkHRAvg: '', walkingHr: '82' }).walkingHeartRateAverage, 82)
})

test('dashboard API and UI expose every current metric', () => {
  const dashboard = readFileSync(new URL('../api/_lib/neon-dashboard.js', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const importer = readFileSync(new URL('../api/health/import.js', import.meta.url), 'utf8')
  for (const token of ['running_stride_length_m', 'cardio_recovery_bpm', 'blood_oxygen_percent', 'walking_heart_rate_avg_bpm', 'swimming_strokes']) assert.match(importer, new RegExp(token))
  for (const token of ['runningStrideLength', 'cardioRecovery', 'bloodOxygen', 'walkingHeartRateAverage', 'swimmingStrokes']) assert.match(dashboard, new RegExp(token))
  for (const label of ['Resting', 'Active', 'Exercise', 'Walking + running', 'Running stride length', 'Steps', 'Stand time', 'Flights climbed', 'Cycling distance', 'Resting heart rate', 'HRV', 'Respiratory rate', 'VO₂ max', 'Blood oxygen', 'Walking heart rate', 'Cardio recovery', 'Sleep']) assert.match(app, new RegExp(label.replace(/[+]/g, '\\+')))
  assert.match(app, /swimmingDistanceYards/)
  assert.match(app, /strokeCount/)
})
