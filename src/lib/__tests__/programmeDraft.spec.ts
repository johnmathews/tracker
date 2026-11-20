import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addActivity,
  addParam,
  applyKind,
  choiceOf,
  choose,
  fieldLabel,
  formatWeeks,
  growsBy,
  isRest,
  kindChangeLines,
  loadDraft,
  measureOf,
  moveActivity,
  newProgramme,
  newSession,
  overrideMode,
  overrideNumber,
  overrideValue,
  paramText,
  paramUses,
  parseWeeks,
  problemPlace,
  removeActivity,
  removeParam,
  renameActivity,
  renameParam,
  ruleLine,
  setActivityField,
  setActivityKey,
  setDocField,
  setGrowsBy,
  setMeasure,
  setOverrideField,
  setOverrideValue,
  setRest,
  setParamField,
  setParamKey,
  setProgressionField,
  shapeOf,
  slugKey,
  switchShape,
  toDocument,
  uniqueKey,
  valueLine,
  type Activity,
  type Override,
  type ProgrammeDoc,
  type Progression,
} from '@/lib/programmeDraft'
import { readProgrammeFixture } from './fixtures'

const VALID = readdirSync(join(import.meta.dirname, '../../../fixtures/programmes/valid'))
  .filter((f) => f.endsWith('.json'))
  .sort()

function fixture(name: string): ProgrammeDoc {
  return loadDraft(readProgrammeFixture(`valid/${name}.json`))
}

function act(doc: ProgrammeDoc, key: string): Activity {
  const found = doc.activities.find((a) => a.key === key)
  if (!found) throw new Error(`no activity ${key}`)
  return found
}

function deload(doc: ProgrammeDoc): Override {
  const first = doc.overrides?.[0]
  if (!first) throw new Error('no override')
  return first
}

describe('loading and saving', () => {
  it.each(VALID)('%s comes back as it went in, keys in order', (file) => {
    const raw = readProgrammeFixture(`valid/${file}`)
    const out = toDocument(loadDraft(raw))
    expect(out).toEqual(raw)
    expect(JSON.stringify(out)).toBe(JSON.stringify(raw))
  })

  it('loads a copy, so editing the draft leaves the stored document alone', () => {
    const raw = readProgrammeFixture('valid/minimal.json')
    const doc = loadDraft(raw)
    doc.name = 'Changed'
    expect(raw.name).toBe('Push-ups')
  })

  it('saves a copy, so later edits do not reach a sent document', () => {
    const doc = fixture('minimal')
    const sent = toDocument(doc)
    doc.name = 'Changed'
    expect(sent.name).toBe('Push-ups')
  })

  it('starts a new programme with the format, an empty name and no activities', () => {
    expect(JSON.stringify(newProgramme())).toBe(
      JSON.stringify({
        format: 'tracker-programme/1',
        name: '',
        kind: 'strength',
        weeks: 8,
        activities: [],
      }),
    )
  })
})

describe('writing a field', () => {
  it('replaces a value where it is', () => {
    const doc = fixture('beginner-5x5')
    setActivityField(act(doc, 'bench'), 'sets', 3)
    expect(Object.keys(act(doc, 'bench'))).toEqual([
      'key',
      'name',
      'target',
      'sets',
      'reps',
      'weight',
    ])
    expect(act(doc, 'bench').sets).toBe(3)
  })

  it('adds a new key in the format’s order', () => {
    const doc = fixture('beginner-5x5')
    const bench = act(doc, 'bench')
    setActivityField(bench, 'notes', 'Pause on the chest.')
    setActivityField(bench, 'perSide', false)
    setActivityField(bench, 'link', 'https://example.com')
    expect(Object.keys(bench)).toEqual([
      'key',
      'name',
      'notes',
      'link',
      'target',
      'sets',
      'perSide',
      'reps',
      'weight',
    ])
  })

  it('adds a key at the end when nothing comes after it', () => {
    const doc = fixture('cardio')
    const run = act(doc, 'run')
    setActivityField(run, 'distance', undefined)
    setActivityField(run, 'distance', 4)
    expect(Object.keys(run).at(-1)).toBe('distance')
  })

  it('removes the key for None, so an absent field stays absent', () => {
    const doc = fixture('beginner-5x5')
    setActivityField(act(doc, 'squat'), 'weight', undefined)
    expect('weight' in act(doc, 'squat')).toBe(false)
  })

  it('places the programme’s own fields in order', () => {
    const doc = fixture('minimal')
    setDocField(doc, 'overrides', [])
    setDocField(doc, 'description', 'Daily push-ups.')
    setDocField(doc, 'params', {})
    setDocField(doc, 'dailyTarget', 2)
    expect(Object.keys(doc)).toEqual([
      'format',
      'name',
      'description',
      'kind',
      'weeks',
      'dailyTarget',
      'params',
      'activities',
      'overrides',
    ])
  })

  it('places a progression’s, a parameter’s and an override’s keys in order', () => {
    const doc = fixture('beginner-5x5')
    const weight = act(doc, 'squat').weight as Progression
    setProgressionField(weight, 'max', 150)
    setProgressionField(weight, 'every', 2)
    expect(Object.keys(weight)).toEqual(['start', 'rate', 'every', 'max', 'step'])

    const spec = fixture('spec-example')
    const squat = spec.params?.squat
    if (!squat) throw new Error('no squat')
    setParamField(squat, 'max', 200)
    setParamField(squat, 'min', 20)
    expect(Object.keys(squat)).toEqual(['label', 'unit', 'default', 'min', 'max'])

    const override: Override = { weeks: [4], activities: { '*': { sets: 2 } } }
    setOverrideField(override, 'label', 'Easy')
    expect(Object.keys(override)).toEqual(['weeks', 'label', 'activities'])
  })
})

describe('a value’s shape', () => {
  it('reads the shape off the value', () => {
    expect(shapeOf(undefined)).toBe('absent')
    expect(shapeOf(5)).toBe('number')
    expect(shapeOf('$squat')).toBe('param')
    expect(shapeOf({ start: 30, add: 5 })).toBe('progression')
  })

  it('reads the choice a field shows: None, Stays the same or Grows', () => {
    expect(choiceOf(undefined)).toBe('none')
    expect(choiceOf(5)).toBe('stays')
    expect(choiceOf('$squat')).toBe('stays')
    expect(choiceOf({ start: 30 })).toBe('grows')
  })

  it('uses the value as the start when it starts to grow', () => {
    const doc = fixture('beginner-5x5')
    expect(switchShape(doc, 'sets', 5, 'progression')).toEqual({ start: 5, add: 1 })
    expect(switchShape(doc, 'weight', '$squat', 'progression')).toEqual({
      start: '$squat',
      add: 2.5,
    })
    expect(switchShape(doc, 'weight', undefined, 'progression')).toEqual({ start: 20, add: 2.5 })
    expect(switchShape(doc, 'duration', undefined, 'progression')).toEqual({ start: 30, add: 5 })
    expect(switchShape(doc, 'distance', undefined, 'progression')).toEqual({ start: 5, add: 0.5 })
  })

  it('keeps the start when a growing value becomes a number', () => {
    const doc = fixture('beginner-5x5')
    expect(switchShape(doc, 'weight', { start: 30, add: 2.5 }, 'number')).toBe(30)
    expect(switchShape(doc, 'weight', { start: '$squat', rate: 5 }, 'number')).toBe(40)
    expect(switchShape(doc, 'weight', '$squat', 'number')).toBe(40)
    expect(switchShape(doc, 'weight', '$gone', 'number')).toBe(20)
    expect(switchShape(doc, 'reps', undefined, 'number')).toBe(10)
    expect(switchShape(doc, 'target', undefined, 'number')).toBe(3)
  })

  it('names a parameter with $ and its key', () => {
    const doc = fixture('beginner-5x5')
    expect(switchShape(doc, 'weight', 40, 'param', 'squat')).toBe('$squat')
    expect(switchShape(doc, 'weight', '$squat', 'param', 'rate')).toBe('$rate')
    expect(switchShape(doc, 'weight', 40, 'param')).toBe('$squat')
    expect(switchShape(doc, 'weight', { start: '$rate', add: 1 }, 'param')).toBe('$rate')
    expect(switchShape(fixture('minimal'), 'sets', 3, 'param')).toBe(3)
  })

  it('keeps a value that already has the shape, and drops it for None', () => {
    const doc = fixture('beginner-5x5')
    const grows = { start: 30, add: 5 }
    expect(switchShape(doc, 'weight', grows, 'progression')).toBe(grows)
    expect(switchShape(doc, 'weight', 7, 'number')).toBe(7)
    expect(switchShape(doc, 'weight', '$rate', 'param')).toBe('$rate')
    expect(switchShape(doc, 'weight', 7, 'absent')).toBeUndefined()
  })

  it('switches between None, Stays the same and Grows', () => {
    const doc = fixture('beginner-5x5')
    expect(choose(doc, 'weight', 40, 'none')).toBeUndefined()
    expect(choose(doc, 'weight', undefined, 'stays')).toBe(20)
    expect(choose(doc, 'weight', '$squat', 'stays')).toBe('$squat')
    expect(choose(doc, 'weight', { start: '$squat', rate: '$rate' }, 'stays')).toBe('$squat')
    expect(choose(doc, 'weight', 40, 'grows')).toEqual({ start: 40, add: 2.5 })
  })

  it('switches Grows by between the unit and %, keeping the amount', () => {
    const p: Progression = { start: 30, add: 5, every: 2 }
    expect(growsBy(p)).toBe('add')
    setGrowsBy(p, 'rate')
    expect(p).toEqual({ start: 30, rate: 5, every: 2 })
    expect(Object.keys(p)).toEqual(['start', 'rate', 'every'])
    expect(growsBy(p)).toBe('rate')
    setGrowsBy(p, 'rate')
    expect(p).toEqual({ start: 30, rate: 5, every: 2 })
    setGrowsBy(p, 'add')
    expect(Object.keys(p)).toEqual(['start', 'add', 'every'])
    const bare: Progression = { start: 30 }
    setGrowsBy(bare, 'rate')
    expect(bare).toEqual({ start: 30 })
  })
})

describe('measure', () => {
  it('reads Reps, Time or Neither', () => {
    const doc = fixture('beginner-5x5')
    expect(measureOf(act(doc, 'squat'))).toBe('reps')
    expect(measureOf(act(doc, 'plank'))).toBe('time')
    expect(measureOf({ key: 'x', name: 'X', sets: 3 })).toBe('neither')
  })

  it('swaps reps for a hold, and back', () => {
    const doc = fixture('beginner-5x5')
    const squat = act(doc, 'squat')
    setMeasure(doc, squat, 'time')
    expect(Object.keys(squat)).toEqual([
      'key',
      'name',
      'notes',
      'target',
      'sets',
      'duration',
      'weight',
    ])
    expect(squat.duration).toBe(30)
    setMeasure(doc, squat, 'reps')
    expect(squat.reps).toBe(10)
    expect('duration' in squat).toBe(false)
    setMeasure(doc, squat, 'neither')
    expect('reps' in squat || 'duration' in squat).toBe(false)
  })

  it('keeps the value when the measure stays', () => {
    const doc = fixture('beginner-5x5')
    const plank = act(doc, 'plank')
    const hold = plank.duration
    setMeasure(doc, plank, 'time')
    expect(plank.duration).toBe(hold)
    setMeasure(doc, act(doc, 'squat'), 'reps')
    expect(act(doc, 'squat').reps).toBe(5)
  })

  it('drops the activity’s own exception values for the measure it loses', () => {
    const doc = fixture('beginner-5x5')
    const dl = act(doc, 'deadlift')
    setOverrideValue(deload(doc), 'deadlift', 'reps', 3)
    setMeasure(doc, dl, 'time')
    expect(deload(doc).activities.deadlift).toEqual({ sets: 1 })
    expect(deload(doc).activities['*']).toEqual({ sets: 3, weight: { scale: 0.9 } })
  })
})

describe('keys', () => {
  it('makes a key from a name', () => {
    expect(slugKey('Back squat')).toBe('back-squat')
    expect(slugKey('  --Hip   flexor!! ')).toBe('hip-flexor')
    expect(slugKey('Développé couché')).toBe('developpe-couche')
    expect(slugKey('Beginner 5×5')).toBe('beginner-5-5')
    expect(slugKey('×××')).toBe('')
    const long = slugKey('a'.repeat(39) + ' b c')
    expect(long).toBe('a'.repeat(39))
  })

  it('adds -2, -3 until the key is free, within 40 characters', () => {
    expect(uniqueKey('squat', [], 'activity')).toBe('squat')
    expect(uniqueKey('squat', ['squat'], 'activity')).toBe('squat-2')
    expect(uniqueKey('squat', ['squat', 'squat-2'], 'activity')).toBe('squat-3')
    expect(uniqueKey('', ['activity'], 'activity')).toBe('activity-2')
    const forty = 'b'.repeat(40)
    expect(uniqueKey(forty, [forty], 'activity')).toBe('b'.repeat(38) + '-2')
    expect(uniqueKey('a'.repeat(37) + '-cd', ['a'.repeat(37) + '-cd'], 'x')).toBe(
      'a'.repeat(37) + '-2',
    )
  })

  it('gives a new activity a key from its name and the kind’s fields', () => {
    const doc = newProgramme()
    const session = newSession()
    const first = addActivity(doc, session)
    const second = addActivity(doc, session, 'Back squat')
    const third = addActivity(doc, session)
    expect([first.key, second.key, third.key]).toEqual(['activity', 'back-squat', 'activity-2'])
    expect(second).toEqual({ key: 'back-squat', name: 'Back squat', sets: 3, reps: 10 })
    expect(doc.activities).toHaveLength(3)
    doc.kind = 'mobility'
    expect(addActivity(doc, session, 'Hold')).toEqual({
      key: 'hold',
      name: 'Hold',
      sets: 2,
      duration: 30,
    })
    doc.kind = 'cardio'
    expect(addActivity(doc, session, 'Run')).toEqual({ key: 'run', name: 'Run', duration: 1800 })
  })

  it('keeps a new activity’s key in step with its name, overrides included', () => {
    const doc = fixture('beginner-5x5')
    const session = newSession()
    const added = addActivity(doc, session, 'Press')
    setOverrideValue(deload(doc), 'press', 'sets', 2)
    renameActivity(doc, session, 5, 'Overhead press')
    expect(added.key).toBe('overhead-press')
    expect(Object.keys(deload(doc).activities)).toEqual(['*', 'deadlift', 'overhead-press'])
    renameActivity(doc, session, 5, 'Back squat')
    expect(added.key).toBe('back-squat')
    renameActivity(doc, session, 5, 'Back squat')
    expect(added.key).toBe('back-squat')
  })

  it('keeps a loaded activity’s key through a rename', () => {
    const doc = fixture('beginner-5x5')
    const session = newSession()
    renameActivity(doc, session, 0, 'Front squat')
    expect(doc.activities[0]).toMatchObject({ key: 'squat', name: 'Front squat' })
  })

  it('stops following the name once the key is edited by hand', () => {
    const doc = fixture('beginner-5x5')
    const session = newSession()
    const added = addActivity(doc, session, 'Press')
    expect(setActivityKey(doc, session, 5, 'ohp')).toBeNull()
    renameActivity(doc, session, 5, 'Overhead press')
    expect(added.key).toBe('ohp')
  })

  it('moves the override entries in place when a key is edited', () => {
    const doc = fixture('beginner-5x5')
    const session = newSession()
    expect(setActivityKey(doc, session, 3, 'dl')).toBeNull()
    expect(Object.keys(deload(doc).activities)).toEqual(['*', 'dl'])
    expect(deload(doc).activities.dl).toEqual({ sets: 1 })
    expect(setActivityKey(doc, session, 3, 'dl')).toBeNull()
  })

  it('refuses a key another activity has', () => {
    const doc = fixture('beginner-5x5')
    expect(setActivityKey(doc, newSession(), 3, 'squat')).toBe(
      'Another activity has the key squat.',
    )
    expect(act(doc, 'deadlift').name).toBe('Deadlift')
  })

  it('leaves override entries with an activity that still has the old key', () => {
    const doc = fixture('beginner-5x5')
    doc.activities.push({ key: 'deadlift', name: 'Second deadlift' })
    expect(setActivityKey(doc, newSession(), 5, 'dl2')).toBeNull()
    expect(Object.keys(deload(doc).activities)).toEqual(['*', 'deadlift'])
  })

  it('gives a new parameter a key from its label and keeps it in step', () => {
    const doc = fixture('minimal')
    const session = newSession()
    const key = addParam(doc, session, 'Bench start', 'kg', 30)
    expect(key).toBe('bench-start')
    expect(Object.keys(doc)).toEqual(['format', 'name', 'kind', 'weeks', 'params', 'activities'])
    setActivityField(doc.activities[0]!, 'reps', { start: '$bench-start', add: '$bench-start' })
    setActivityField(doc.activities[0]!, 'sets', '$bench-start')
    expect(renameParam(doc, session, 'bench-start', 'Bench base')).toBe('bench-base')
    expect(doc.activities[0]).toMatchObject({
      sets: '$bench-base',
      reps: { start: '$bench-base', add: '$bench-base' },
    })
    expect(renameParam(doc, session, 'bench-base', 'Bench base')).toBe('bench-base')
    expect(addParam(doc, session)).toBe('value')
    expect(doc.params?.value).toEqual({ label: '', unit: '', default: 0 })
  })

  it('keeps a loaded parameter’s key through a relabel', () => {
    const doc = fixture('beginner-5x5')
    expect(renameParam(doc, newSession(), 'squat', 'First squat')).toBe('squat')
    expect(doc.params?.squat?.label).toBe('First squat')
  })

  it('follows a parameter’s key into every $ reference, keeping its place', () => {
    const doc = fixture('beginner-5x5')
    const session = newSession()
    expect(setParamKey(doc, session, 'rate', 'growth')).toBeNull()
    expect(Object.keys(doc.params ?? {})).toEqual(['squat', 'growth'])
    expect(act(doc, 'squat').weight).toEqual({ start: '$squat', rate: '$growth', step: 2.5 })
    expect(setParamKey(doc, session, 'growth', 'squat')).toBe('Another value has the key squat.')
    expect(setParamKey(doc, session, 'growth', 'growth')).toBeNull()
  })

  it('stops a new parameter following its label once its key is edited', () => {
    const doc = fixture('minimal')
    const session = newSession()
    addParam(doc, session, 'Reps start', 'reps', 10)
    setParamKey(doc, session, 'reps-start', 'r')
    expect(renameParam(doc, session, 'r', 'Starting reps')).toBe('r')
  })
})

describe('an index or key that isn’t there', () => {
  it('changes nothing', () => {
    const doc = fixture('beginner-5x5')
    const before = JSON.stringify(doc)
    const session = newSession()
    renameActivity(doc, session, 99, 'X')
    expect(setActivityKey(doc, session, 99, 'x')).toBeNull()
    expect(renameParam(doc, session, 'nope', 'X')).toBe('nope')
    expect(setParamKey(doc, session, 'nope', 'x')).toBeNull()
    expect(setParamKey(fixture('minimal'), session, 'nope', 'x')).toBeNull()
    expect(renameParam(fixture('minimal'), session, 'nope', 'X')).toBe('nope')
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('renames a new activity in a programme with no exception weeks', () => {
    const doc = newProgramme()
    const session = newSession()
    addActivity(doc, session)
    renameActivity(doc, session, 0, 'Plank')
    expect(doc.activities[0]?.key).toBe('plank')
  })
})

describe('kind', () => {
  it('labels each field in the kind’s words', () => {
    expect(fieldLabel('strength', 'duration')).toBe('Hold')
    expect(fieldLabel('cardio', 'duration')).toBe('Time')
    expect(fieldLabel('cardio', 'target')).toBe('Times a week')
    expect(fieldLabel('mobility', 'perSide')).toBe('Sides')
  })

  it('names the fields a kind change drops', () => {
    const doc = fixture('beginner-5x5')
    expect(kindChangeLines(doc, 'mobility')).toEqual(['Weight goes from 4 activities.'])
    expect(kindChangeLines(doc, 'cardio')).toEqual([
      'Sets goes from 5 activities.',
      'Reps goes from 4 activities.',
      'Weight goes from 4 activities.',
      'The daily target goes.',
    ])
    expect(kindChangeLines(doc, 'strength')).toEqual([])
    expect(kindChangeLines(fixture('mobility'), 'strength')).toEqual([])
    expect(kindChangeLines(fixture('mobility'), 'cardio')).toEqual([
      'Sets goes from 2 activities.',
      'Sides goes from 1 activity.',
      'Reps goes from 1 activity.',
      'The daily target goes.',
    ])
    expect(kindChangeLines(fixture('cardio'), 'strength')).toEqual([
      'Distance goes from 2 activities.',
    ])
  })

  it('drops those fields from activities and exception weeks', () => {
    const doc = fixture('beginner-5x5')
    applyKind(doc, 'mobility')
    expect(doc.kind).toBe('mobility')
    expect(doc.activities.some((a) => 'weight' in a)).toBe(false)
    expect(deload(doc).activities).toEqual({ '*': { sets: 3 }, deadlift: { sets: 1 } })
    applyKind(doc, 'cardio')
    expect(Object.keys(doc)).toEqual([
      'format',
      'name',
      'description',
      'kind',
      'weeks',
      'params',
      'activities',
    ])
    expect(act(doc, 'plank')).toEqual({
      key: 'plank',
      name: 'Plank',
      target: 3,
      duration: { start: 30, add: 5, every: 2, max: 90 },
    })
  })

  it('changes the kind of a programme with no exception weeks', () => {
    const doc = fixture('mobility')
    applyKind(doc, 'cardio')
    expect(doc.activities[0]).toEqual({
      key: 'hip-flexor',
      name: 'Hip flexor stretch',
      link: 'https://example.com/hip-flexor',
      target: 5,
      duration: { start: 30, add: 5, every: 2, max: 40 },
    })
    expect('dailyTarget' in doc).toBe(false)
  })

  it('changes nothing for the same kind', () => {
    const doc = fixture('beginner-5x5')
    const before = JSON.stringify(doc)
    applyKind(doc, 'strength')
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('removing', () => {
  it('removes an activity with its exception entries', () => {
    const doc = fixture('beginner-5x5')
    const session = newSession()
    removeActivity(doc, session, 3)
    expect(doc.activities.map((a) => a.key)).toEqual(['squat', 'bench', 'row', 'plank'])
    expect(deload(doc).activities).toEqual({ '*': { sets: 3, weight: { scale: 0.9 } } })
  })

  it('removes an exception week left with no values, and the list when it is empty', () => {
    const doc = fixture('beginner-5x5')
    const session = newSession()
    const added = addActivity(doc, session, 'Curl')
    deload(doc).activities = { curl: { sets: 2 } }
    removeActivity(doc, session, 5)
    expect('overrides' in doc).toBe(false)
    expect(session.followActivities.has(added.key)).toBe(false)
  })

  it('keeps the other exception weeks when one is left with no values', () => {
    const doc = fixture('beginner-5x5')
    doc.overrides?.push({ weeks: [6], label: 'Light', activities: { deadlift: { sets: 2 } } })
    removeActivity(doc, newSession(), 3)
    expect(doc.overrides).toEqual([
      { weeks: [4, 8], label: 'Deload', activities: { '*': { sets: 3, weight: { scale: 0.9 } } } },
    ])
  })

  it('keeps exception entries another activity with the same key still uses', () => {
    const doc = fixture('beginner-5x5')
    doc.activities.push({ key: 'deadlift', name: 'Second deadlift' })
    removeActivity(doc, newSession(), 5)
    expect(deload(doc).activities.deadlift).toEqual({ sets: 1 })
  })

  it('ignores an index with no activity', () => {
    const doc = fixture('minimal')
    removeActivity(doc, newSession(), 4)
    expect(doc.activities).toHaveLength(1)
  })

  it('moves an activity up or down', () => {
    const doc = fixture('beginner-5x5')
    expect(moveActivity(doc, 1, -1)).toBe(true)
    expect(doc.activities.map((a) => a.key).slice(0, 2)).toEqual(['bench', 'squat'])
    expect(moveActivity(doc, 0, 1)).toBe(true)
    expect(moveActivity(doc, 0, -1)).toBe(false)
    expect(moveActivity(doc, 4, 1)).toBe(false)
    expect(moveActivity(doc, 9, -1)).toBe(false)
  })

  it('names the fields that use a parameter', () => {
    const doc = fixture('beginner-5x5')
    expect(paramUses(doc, 'squat')).toEqual(['Back squat’s weight'])
    expect(paramUses(doc, 'rate')).toEqual(['Back squat’s weight'])
    setActivityField(act(doc, 'plank'), 'duration', '$rate')
    setActivityField(act(doc, 'bench'), 'sets', '$rate')
    expect(paramUses(doc, 'rate')).toEqual([
      'Back squat’s weight',
      'Bench press’s sets',
      'Plank’s hold',
    ])
    const cardio = fixture('cardio')
    expect(paramUses(cardio, 'ride')).toEqual(['Long ride’s distance'])
    setActivityField(act(cardio, 'run'), 'duration', { start: 1200, add: '$ride' })
    expect(paramUses(cardio, 'ride')).toEqual(['Easy run’s time', 'Long ride’s distance'])
    expect(paramUses(fixture('minimal'), 'squat')).toEqual([])
  })

  it('refuses to remove a parameter a field uses', () => {
    const doc = fixture('beginner-5x5')
    expect(removeParam(doc, 'squat')).toEqual({
      usedBy: ['Back squat’s weight'],
      message:
        'Back squat’s weight uses Squat start. Give that field a number first, then remove it.',
    })
    setActivityField(act(doc, 'bench'), 'weight', { start: '$squat', add: 2.5 })
    setActivityField(act(doc, 'row'), 'weight', '$squat')
    expect(removeParam(doc, 'squat')?.message).toBe(
      'Back squat’s weight, Bench press’s weight and Barbell row’s weight use Squat start. Give those fields a number first, then remove it.',
    )
    expect(doc.params?.squat).toBeDefined()
  })

  it('removes an unused parameter, and the list when it is empty', () => {
    const doc = fixture('beginner-5x5')
    setActivityField(act(doc, 'squat'), 'weight', 40)
    expect(removeParam(doc, 'rate')).toBeNull()
    expect(Object.keys(doc.params ?? {})).toEqual(['squat'])
    expect(removeParam(doc, 'squat')).toBeNull()
    expect('params' in doc).toBe(false)
    expect(removeParam(doc, 'squat')).toBeNull()
  })
})

describe('problems by path', () => {
  const doc = fixture('beginner-5x5')

  it('puts a problem with no field in the foot bar', () => {
    expect(problemPlace(doc, '')).toEqual({ card: null, index: null, fieldId: null })
  })

  it('puts a programme field’s problem under it', () => {
    expect(problemPlace(doc, 'name')).toEqual({ card: 'programme', index: null, fieldId: 'name' })
    expect(problemPlace(doc, 'dailyTarget')).toEqual({
      card: 'programme',
      index: null,
      fieldId: 'dailyTarget',
    })
  })

  it('finds an activity’s field', () => {
    expect(problemPlace(doc, 'activities[3].weight.add')).toEqual({
      card: 'activity',
      index: 3,
      fieldId: 'weight.add',
    })
    expect(problemPlace(doc, 'activities[3].weight')).toEqual({
      card: 'activity',
      index: 3,
      fieldId: 'weight',
    })
    expect(problemPlace(doc, 'activities[12]')).toEqual({
      card: 'activity',
      index: 12,
      fieldId: null,
    })
    expect(problemPlace(doc, 'activities')).toEqual({
      card: 'activity',
      index: null,
      fieldId: null,
    })
    expect(problemPlace(doc, 'activities["x"].name')).toEqual({
      card: 'activity',
      index: null,
      fieldId: 'name',
    })
  })

  it('finds an exception week’s field, with "*" written either way', () => {
    expect(problemPlace(doc, 'overrides[0].activities["*"].sets')).toEqual({
      card: 'override',
      index: 0,
      fieldId: 'activities.*.sets',
    })
    expect(problemPlace(doc, 'overrides[0].activities.*.weight.scale')).toEqual({
      card: 'override',
      index: 0,
      fieldId: 'activities.*.weight',
    })
    expect(problemPlace(doc, 'overrides[0].activities.long-ride')).toEqual({
      card: 'override',
      index: 0,
      fieldId: 'activities.long-ride',
    })
    expect(problemPlace(doc, 'overrides[1].weeks[2]')).toEqual({
      card: 'override',
      index: 1,
      fieldId: 'weeks',
    })
    expect(problemPlace(doc, 'overrides')).toEqual({ card: 'override', index: null, fieldId: null })
  })

  it('finds a parameter by its key', () => {
    expect(problemPlace(doc, 'params.rate.default')).toEqual({
      card: 'param',
      index: 1,
      fieldId: 'default',
    })
    expect(problemPlace(doc, 'params["Squat start"]')).toEqual({
      card: 'param',
      index: null,
      fieldId: null,
    })
    expect(problemPlace(doc, 'params')).toEqual({ card: 'param', index: null, fieldId: null })
    expect(problemPlace(fixture('minimal'), 'params.squat')).toEqual({
      card: 'param',
      index: null,
      fieldId: null,
    })
  })

  it('reads as far as a broken path goes', () => {
    expect(problemPlace(doc, 'activities[x')).toEqual({
      card: 'activity',
      index: null,
      fieldId: null,
    })
  })
})

describe('the rule line', () => {
  it('says each Beginner 5×5 activity’s rule', () => {
    const doc = fixture('beginner-5x5')
    expect(doc.activities.map((a) => ruleLine(doc, a))).toEqual([
      '5 × 5 · 40 kg (Squat start), +5% (Weekly increase) a week',
      '5 × 5 · 30 kg, +2.5 kg a week',
      '5 × 5 · 30 kg, +2.5 kg a week',
      '1 × 5 · 60 kg, +5 kg a week',
      '3 × 30 s · +5 s every 2 weeks, up to 90 s',
    ])
  })

  it('says mobility and cardio rules', () => {
    const mob = fixture('mobility')
    expect(mob.activities.map((a) => ruleLine(mob, a))).toEqual([
      '2 × 30 s each side · +5 s every 2 weeks, up to 40 s',
      '2 × 10 · +2 reps every 3 weeks, up to 16 reps',
    ])
    const cardio = fixture('cardio')
    expect(cardio.activities.map((a) => ruleLine(cardio, a))).toEqual([
      '20 min, +10% a week, up to 30 min · 3 km, +0.5 km a week, up to 6 km',
      '60 min, +10 min every 2 weeks · 20 km (Long ride), +10% a week',
    ])
    expect(ruleLine(cardio, { key: 'x', name: 'X' })).toBe('No values yet.')
  })

  it('says a rule with only some fields', () => {
    const doc = fixture('beginner-5x5')
    const line = (a: Omit<Activity, 'key' | 'name'>) => ruleLine(doc, { key: 'x', name: 'X', ...a })
    expect(line({})).toBe('No values yet.')
    expect(line({ sets: 3 })).toBe('3 sets')
    expect(line({ sets: 1 })).toBe('1 set')
    expect(line({ reps: 12 })).toBe('12 reps')
    expect(line({ reps: 1 })).toBe('1 rep')
    expect(line({ duration: 45 })).toBe('45 s')
    expect(line({ perSide: true })).toBe('Each side')
    expect(line({ sets: 3, perSide: false })).toBe('3 sets')
    expect(line({ weight: 20 })).toBe('20 kg')
    expect(line({ sets: '$squat', reps: 5 })).toBe('40 (Squat start) × 5')
    expect(line({ sets: '$squat' })).toBe('40 sets (Squat start)')
    expect(line({ sets: { start: 3, add: 1, every: 2, max: 5 }, reps: { start: 8, add: 1 } })).toBe(
      '3 × 8 · +1 set every 2 weeks, up to 5 sets · +1 rep a week',
    )
    expect(line({ weight: { start: 60, add: -2.5 } })).toBe('60 kg, −2.5 kg a week')
    expect(line({ weight: { start: 60, rate: -10 } })).toBe('60 kg, −10% a week')
    expect(line({ weight: { start: 40, max: 60 } })).toBe('40 kg, up to 60 kg')
    expect(line({ weight: { start: 40 } })).toBe('40 kg')
    expect(line({ sets: 3, duration: { start: 30 } })).toBe('3 × 30 s')
    expect(line({ sets: 3, duration: { start: '$squat', every: 1, add: 5 } })).toBe(
      '3 × 40 s (Squat start) · +5 s a week',
    )
    expect(line({ weight: '$nope' })).toBe('$nope')
    expect(line({ weight: { start: 40, add: '$squat' } })).toBe(
      '40 kg, +40 kg (Squat start) a week',
    )
  })

  it('says one value’s line, or None', () => {
    const doc = fixture('beginner-5x5')
    expect(valueLine(doc, 'weight', undefined)).toBe('None')
    expect(valueLine(doc, 'sets', 3)).toBe('3')
    expect(valueLine(doc, 'weight', '$squat')).toBe('40 kg (Squat start)')
    expect(valueLine(doc, 'duration', { start: 30, add: 5, every: 2, max: 90 })).toBe(
      '30 s, +5 s every 2 weeks, up to 90 s',
    )
    expect(valueLine(doc, 'reps', { start: 10, add: 2, every: 3, max: 16 })).toBe(
      '10, +2 every 3 weeks, up to 16',
    )
  })

  it('shows a parameter by its label and default', () => {
    const doc = fixture('beginner-5x5')
    expect(paramText(doc, 'squat')).toBe('Squat start · 40 kg')
    expect(paramText(doc, 'rate')).toBe('Weekly increase · 5%')
    expect(paramText(doc, 'nope')).toBe('$nope')
    expect(paramText(fixture('minimal'), 'nope')).toBe('$nope')
    expect(valueLine(fixture('minimal'), 'weight', '$nope')).toBe('$nope')
    const session = newSession()
    const blank = newProgramme()
    const key = addParam(blank, session, 'Rounds')
    expect(paramText(blank, key)).toBe('Rounds · 0')
  })
})

describe('exception weeks', () => {
  it('reads typed weeks', () => {
    expect(parseWeeks('4, 8')).toEqual({ weeks: [4, 8] })
    expect(parseWeeks(' 4 8,12 ,')).toEqual({ weeks: [4, 8, 12] })
    expect(parseWeeks('8, 4, 8')).toEqual({ weeks: [8, 4] })
  })

  it('says what is wrong with typed weeks', () => {
    expect(parseWeeks('  ')).toEqual({ error: 'Type the weeks, like 4, 8.' })
    expect(parseWeeks('4, eight')).toEqual({
      error: '“eight” isn’t a week number. Type the weeks, like 4, 8.',
    })
    expect(parseWeeks('4.5')).toEqual({
      error: '“4.5” isn’t a week number. Type the weeks, like 4, 8.',
    })
  })

  it('writes weeks back as typed', () => {
    expect(formatWeeks([4, 8])).toBe('4, 8')
    expect(formatWeeks([])).toBe('')
  })

  it('reads a value as Set to or % of planned', () => {
    expect(overrideMode(3)).toBe('set')
    expect(overrideMode({ scale: 0.9 })).toBe('percent')
    expect(overrideNumber(3)).toBe(3)
    expect(overrideNumber({ scale: 0.9 })).toBe(90)
    expect(overrideNumber({ scale: 0.07 })).toBe(7)
    expect(overrideValue('set', 3)).toBe(3)
    expect(overrideValue('percent', 90)).toEqual({ scale: 0.9 })
    expect(overrideValue('percent', 7)).toEqual({ scale: 0.07 })
  })

  it('writes an exception value in order, and drops an entry left empty', () => {
    const doc = fixture('beginner-5x5')
    const o = deload(doc)
    setOverrideValue(o, 'deadlift', 'weight', { scale: 0.8 })
    setOverrideValue(o, 'deadlift', 'target', 2)
    expect(Object.keys(o.activities.deadlift ?? {})).toEqual(['target', 'sets', 'weight'])
    setOverrideValue(o, 'bench', 'sets', 2)
    expect(Object.keys(o.activities)).toEqual(['*', 'deadlift', 'bench'])
    setOverrideValue(o, 'bench', 'sets', undefined)
    expect('bench' in o.activities).toBe(false)
    setOverrideValue(o, 'row', 'sets', undefined)
    expect('row' in o.activities).toBe(false)
  })

  it('reads a rest: the key’s own Times a week set to 0 (K191)', () => {
    const o: Override = {
      weeks: [3],
      activities: { '*': { sets: 3 }, squat: { target: 0 }, bench: { target: 2 }, row: {} },
    }
    expect(isRest(o, 'squat')).toBe(true)
    expect(isRest(o, 'bench')).toBe(false)
    expect(isRest(o, 'row')).toBe(false)
    expect(isRest(o, '*')).toBe(false)
    expect(isRest(o, 'plank')).toBe(false)
    expect(isRest({ weeks: [3], activities: { squat: { target: { scale: 0 } } } }, 'squat')).toBe(
      false,
    )
  })

  it('writes a rest as Times a week 0 first in the entry, and takes it back', () => {
    const doc = fixture('beginner-5x5')
    const o = deload(doc)
    setRest(o, 'deadlift', true)
    expect(o.activities.deadlift).toEqual({ target: 0, sets: 1 })
    expect(Object.keys(o.activities.deadlift ?? {})).toEqual(['target', 'sets'])
    setRest(o, 'squat', true)
    expect(Object.keys(o.activities)).toEqual(['*', 'deadlift', 'squat'])
    expect(o.activities.squat).toEqual({ target: 0 })
    setRest(o, 'deadlift', false)
    expect(o.activities.deadlift).toEqual({ sets: 1 })
    setRest(o, 'squat', false)
    expect('squat' in o.activities).toBe(false)
    // A rest takes the place of another Times a week; taking it back leaves none.
    setOverrideValue(o, 'bench', 'target', 2)
    setRest(o, 'bench', true)
    expect(o.activities.bench).toEqual({ target: 0 })
    setRest(o, 'bench', false)
    expect('bench' in o.activities).toBe(false)
  })
})
