import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlannerStore } from '@/stores/planner'
import { useTrackersStore } from '@/stores/trackers'
import { DATA_KEY, DIET_KEY, LEGACY_DATA_KEY, MARKS, type Exercise } from '@/lib/storage'
import { EXERCISE_CYCLE, EXERCISE_KIND_CYCLE } from '@/lib/tracker'
import { firstTrackers, type TrackerInfo } from '@/lib/trackers'

// Friday 23 Oct 2026: the week is Mon 19 – Sun 25 and today is index 4.
const NOW = new Date(2026, 9, 23, 18, 0)
const WEEK = '2026-10-19'
const CYCLING = { id: 'cy', name: 'Cycling', duration: 1800, target: 2 }
const RUNNING = { id: 'ru', name: 'Running', distance: 5, target: 3 }
const EX = 'exercise'

function stored(key: string): unknown {
  const raw = localStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

/** The trackers store with the account's first three trackers, each empty. */
function store() {
  const t = useTrackersStore()
  t.adopt(firstTrackers(null), {})
  return t
}

/** The visible week's items of a tracker, as plain data. */
function items(id: string): Exercise[] {
  return useTrackersStore().itemsOf(id) as Exercise[]
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the trackers (K123)', () => {
  const swim: TrackerInfo = {
    id: 'xswim',
    name: 'Swimming',
    kind: 'cardio',
    position: 1,
    dailyTarget: null,
    startWeek: '2026-10-12',
    endWeek: '2026-10-26',
  }

  it('starts with none, and holds the account’s in the week’s order', () => {
    const t = useTrackersStore()
    expect(t.list).toEqual([])
    expect(t.shown).toEqual([])
    t.adopt([...firstTrackers(null), swim], {})
    expect(t.ordered.map((x) => x.id)).toEqual(['exercise', 'cardio', 'xswim', 'diet'])
    expect(t.has('xswim')).toBe(true)
    expect(t.has('nope')).toBe(false)
    expect(t.get('diet')!.name).toBe('Food')
  })

  it('shows a tracker from its start week, up to but not in its end week (spec §2)', () => {
    const t = useTrackersStore()
    const planner = usePlannerStore()
    t.adopt([...firstTrackers(null), swim], {})
    expect(t.shown.map((x) => x.id)).toEqual(['exercise', 'cardio', 'xswim', 'diet'])
    planner.prevWeek()
    expect(t.shown.map((x) => x.id)).toContain('xswim')
    planner.prevWeek()
    expect(t.shown.map((x) => x.id)).not.toContain('xswim')
    planner.thisWeek()
    planner.nextWeek()
    expect(t.shown.map((x) => x.id)).toEqual(['exercise', 'cardio', 'diet'])
  })

  it('knows each tracker’s kind and its registry entry', () => {
    const t = useTrackersStore()
    t.adopt([...firstTrackers(null), swim], {})
    expect(t.kindOf('xswim')).toBe('cardio')
    expect(t.typeOf('diet').id).toBe('food')
    // One of the first three reads as its kind before the trackers load.
    t.clear()
    expect(t.kindOf('diet')).toBe('food')
    expect(t.kindOf('cardio')).toBe('cardio')
    expect(t.kindOf('nope')).toBe('strength')
  })

  it('creates a tracker last, empty, starting in the week on screen (K124)', () => {
    const t = store()
    usePlannerStore().nextWeek()
    const id = t.createTracker({ name: '  Upper body ', kind: 'strength' })!
    expect(id).toMatch(/^x/)
    expect(t.get(id)).toEqual({
      id,
      name: 'Upper body',
      kind: 'strength',
      position: 3,
      dailyTarget: 3,
      startWeek: '2026-10-26',
      endWeek: null,
    })
    // A new tracker starts empty: no default items (spec §4).
    expect(t.itemsOf(id)).toEqual([])
    expect(t.plansOf(id)).toEqual({})
    const food = t.createTracker({ name: 'Snacks', kind: 'food' })!
    expect(t.get(food)).toMatchObject({ position: 4, dailyTarget: 2 })
    const ride = t.createTracker({ name: 'Rides', kind: 'cardio' })!
    expect(t.get(ride)!.dailyTarget).toBeNull()
    expect(t.shown.map((x) => x.id)).toEqual(['exercise', 'cardio', 'diet', id, food, ride])
    usePlannerStore().prevWeek()
    expect(t.shown.map((x) => x.id)).toEqual(['exercise', 'cardio', 'diet'])
  })

  it('refuses a blank name, cuts a long one, and stops at 100 trackers', () => {
    const t = store()
    expect(t.createTracker({ name: ' \n ', kind: 'food' })).toBeNull()
    const id = t.createTracker({ name: 'N'.repeat(70), kind: 'food' })!
    expect(t.get(id)!.name).toHaveLength(60)
    for (let i = t.list.length; i < 100; i++) t.createTracker({ name: `T${i}`, kind: 'food' })
    expect(t.list).toHaveLength(100)
    expect(t.createTracker({ name: 'One more', kind: 'food' })).toBeNull()
  })

  it('renames a tracker, refusing a blank name or one it doesn’t have', () => {
    const t = store()
    expect(t.renameTracker(EX, '  Lifting ')).toBe(true)
    expect(t.get(EX)!.name).toBe('Lifting')
    expect(t.renameTracker(EX, '   ')).toBe(false)
    expect(t.renameTracker('nope', 'X')).toBe(false)
    expect(t.get(EX)!.name).toBe('Lifting')
  })

  it('ends a tracker from the week on screen, keeping an earlier end (K122)', () => {
    const t = store()
    const planner = usePlannerStore()
    planner.nextWeek()
    expect(t.endTracker('cardio')).toBe(true)
    expect(t.get('cardio')!.endWeek).toBe('2026-10-26')
    expect(t.shown.map((x) => x.id)).toEqual(['exercise', 'diet'])
    planner.thisWeek()
    expect(t.shown.map((x) => x.id)).toEqual(['exercise', 'cardio', 'diet'])
    planner.prevWeek()
    t.endTracker('cardio')
    expect(t.get('cardio')!.endWeek).toBe('2026-10-12')
    planner.nextWeek()
    planner.nextWeek()
    planner.nextWeek()
    t.endTracker('cardio')
    expect(t.get('cardio')!.endWeek).toBe('2026-10-12')
    expect(t.endTracker('nope')).toBe(false)
  })

  it('keeps a tracker’s plans and marks when it ends: earlier weeks still show them', () => {
    const t = store()
    t.toggle(EX, 'pu', 0)
    usePlannerStore().nextWeek()
    t.endTracker(EX)
    expect(t.shown.map((x) => x.id)).not.toContain(EX)
    usePlannerStore().prevWeek()
    expect(t.shown.map((x) => x.id)).toContain(EX)
    expect(t.markOf(EX, 'pu', 0)).toBe('great')
  })

  it('sets a daily target within 1–8, and none for cardio (K30, K57, K90)', () => {
    const t = store()
    expect(t.dailyTarget(EX)).toBe(3)
    expect(t.dailyTarget('diet')).toBe(2)
    expect(t.dailyTarget('cardio')).toBeNull()
    expect(t.setDailyTarget(EX, 12)).toBe(true)
    expect(t.dailyTarget(EX)).toBe(8)
    expect(t.changeDailyTarget(EX, -10)).toBe(true)
    expect(t.dailyTarget(EX)).toBe(1)
    expect(t.changeDailyTarget('diet', 1)).toBe(true)
    expect(t.dailyTarget('diet')).toBe(3)
    expect(t.setDailyTarget('cardio', 2)).toBe(false)
    expect(t.changeDailyTarget('cardio', 1)).toBe(false)
    expect(t.setDailyTarget('nope', 2)).toBe(false)
    expect(t.dailyTarget('cardio')).toBeNull()
  })

  it('reads a daily target as its kind’s default until the trackers load', () => {
    const t = useTrackersStore()
    expect([t.dailyTarget('exercise'), t.dailyTarget('cardio'), t.dailyTarget('diet')]).toEqual([
      3,
      null,
      2,
    ])
    expect(t.changeDailyTarget('exercise', 1)).toBe(false)
  })

  it('adopts the trackers and their data wholesale, one tracker or one week, and clears', () => {
    const t = useTrackersStore()
    const plan = [{ id: 'a', name: 'A', reps: 5, target: 2 }]
    t.adopt(firstTrackers({ dailyPick: 5, foodPick: 4 }), {
      exercise: {
        plans: { [WEEK]: plan },
        log: { [WEEK]: { a: ['great', null, null, null, null, null, null] } },
      },
    })
    expect(t.itemsOf(EX)).toEqual(plan)
    expect(t.grandTotal(EX)).toBe(1)
    expect([t.dailyTarget(EX), t.dailyTarget('diet')]).toEqual([5, 4])
    t.adoptWeek(EX, WEEK, [])
    expect(t.itemsOf(EX)).toEqual([])
    t.adoptWeek('xnew', WEEK, plan)
    expect(t.plansOf('xnew')).toEqual({ [WEEK]: plan })
    t.adoptTracker({ ...t.get('diet')!, name: 'Meals' })
    expect(t.get('diet')!.name).toBe('Meals')
    const swim: TrackerInfo = { ...firstTrackers(null)[1]!, id: 'xswim', position: 3 }
    t.adoptTracker(swim)
    expect(t.list.map((x) => x.id)).toEqual(['exercise', 'cardio', 'diet', 'xswim'])
    t.clear()
    expect(t.list).toEqual([])
    expect(t.itemsOf(EX)).toHaveLength(5)
    expect(t.logOf(EX)).toEqual({})
  })
})

describe('the exercise tracker', () => {
  it('starts with the five default exercises', () => {
    expect(items(EX).map((e) => e.name)).toEqual([
      'Push-ups',
      'Pull-ups',
      'Squats',
      'Back extensions',
      'Kettlebell halos',
    ])
  })

  it('never reads or writes the keys from before accounts', async () => {
    const legacy = JSON.stringify({ exercises: [{ id: 'a', name: 'A', reps: 1, target: 2 }] })
    const v2 = JSON.stringify({ plans: { [WEEK]: [] }, log: {} })
    localStorage.setItem(LEGACY_DATA_KEY, legacy)
    localStorage.setItem(DATA_KEY, v2)
    setActivePinia(createPinia())
    const t = store()
    expect(t.itemsOf(EX)).toHaveLength(5)
    t.toggle(EX, 'pu', 0)
    t.addItem(EX, { name: 'Lunges', reps: 12, perSide: true })
    await nextTick()
    expect(localStorage.getItem(LEGACY_DATA_KEY)).toBe(legacy)
    expect(localStorage.getItem(DATA_KEY)).toBe(v2)
  })

  it('steps a cell through every kind in every drawing, each counting, then back to empty', () => {
    const t = store()
    for (const mark of MARKS) {
      t.toggle(EX, 'pu', 0)
      expect(t.markOf(EX, 'pu', 0)).toBe(mark)
      expect(t.isDone(EX, 'pu', 0)).toBe(true)
      expect(t.totalFor(EX, 'pu')).toBe(1)
    }
    t.toggle(EX, 'pu', 0)
    expect(t.markOf(EX, 'pu', 0)).toBeNull()
    expect(t.isDone(EX, 'pu', 0)).toBe(false)
    expect(t.logOf(EX)[WEEK]!.pu).toEqual([null, null, null, null, null, null, null])
  })

  it('steps a cell through the three kinds once in a tick or face set (K21)', () => {
    const t = store()
    usePlannerStore().markSet = 'faces'
    for (const mark of ['great', 'partial', 'missed', null]) {
      t.toggle(EX, 'pu', 0)
      expect(t.markOf(EX, 'pu', 0)).toBe(mark)
    }
  })

  it('counts picks per day and the grand total, ignoring removed exercises', () => {
    const t = store()
    t.toggle(EX, 'pu', 2)
    t.toggle(EX, 'sq', 2)
    t.toggle(EX, 'kh', 2)
    t.toggle(EX, 'kh', 3)
    expect(t.dayCounts(EX)).toEqual([0, 0, 3, 1, 0, 0, 0])
    expect(t.grandTotal(EX)).toBe(4)
    t.removeItem(EX, 'pu')
    expect(t.dayCounts(EX)[2]).toBe(2)
    expect(t.grandTotal(EX)).toBe(3)
    expect(t.logOf(EX)[WEEK]?.pu?.[2]).toBe('great')
  })

  it('keeps each week separate when navigating', () => {
    const t = store()
    const planner = usePlannerStore()
    t.toggle(EX, 'pu', 0)
    planner.prevWeek()
    expect(t.isDone(EX, 'pu', 0)).toBe(false)
    planner.thisWeek()
    expect(t.isDone(EX, 'pu', 0)).toBe(true)
  })

  it('clamps the goal to 0–7', () => {
    const t = store()
    for (let i = 0; i < 10; i++) t.changeTarget(EX, 'pu', 1)
    expect(items(EX)[0]!.target).toBe(7)
    for (let i = 0; i < 10; i++) t.changeTarget(EX, 'pu', -1)
    expect(items(EX)[0]!.target).toBe(0)
    t.changeTarget(EX, 'missing', 1)
  })

  it('keeps a duration over reps, and takes a goal from the form', () => {
    const t = store()
    t.addItem(EX, { name: 'Wall sit', reps: 12, duration: 60.7, perSide: false, target: 5 })
    const added = items(EX).at(-1)!
    expect(added).toMatchObject({ name: 'Wall sit', reps: 0, duration: 60, target: 5 })
    expect(t.updateItem(EX, added.id, { name: 'Wall sit', reps: 12, perSide: false })).toBe(true)
    expect(items(EX).at(-1)).toMatchObject({ reps: 12, target: 5 })
    expect(items(EX).at(-1)).not.toHaveProperty('duration')
  })

  it('adds an exercise with goal 3 and ignores an empty name', () => {
    const t = store()
    expect(t.addItem(EX, { name: '   ', reps: 5, perSide: false })).toBeNull()
    expect(items(EX)).toHaveLength(5)
    const id = t.addItem(EX, { name: '  Lunges ', reps: 12, perSide: true })
    const added = items(EX)[5]!
    expect(added.id).toBe(id)
    expect(added).toEqual({ id, name: 'Lunges', reps: 12, perSide: true, target: 3 })
    expect(t.plansOf(EX)[WEEK]).toHaveLength(6)
  })

  it('stores non-positive or non-numeric reps as 0, and no reps as 0', () => {
    const t = store()
    t.addItem(EX, { name: 'A', reps: Number.NaN, perSide: false })
    t.addItem(EX, { name: 'B', reps: -3, perSide: false })
    t.addItem(EX, { name: 'C' })
    expect(
      items(EX)
        .slice(-3)
        .map((e) => [e.reps, e.perSide]),
    ).toEqual([
      [0, false],
      [0, false],
      [0, false],
    ])
  })

  it('stores sets as a whole number capped at 20, and drops 0', () => {
    const t = store()
    t.addItem(EX, { name: 'A', sets: 3.7, reps: 10, perSide: false })
    t.addItem(EX, { name: 'B', sets: 99, reps: 10, perSide: false })
    t.addItem(EX, { name: 'C', sets: 0, reps: 10, perSide: false })
    const [a, b, c] = items(EX).slice(-3)
    expect([a!.sets, b!.sets]).toEqual([3, 20])
    expect(c).not.toHaveProperty('sets')
  })

  it('replaces the fields but keeps the id, goal and history', () => {
    const t = store()
    t.toggle(EX, 'sq', 0)
    t.changeTarget(EX, 'sq', 1)
    const input = { name: ' Goblet squats ', reps: 12, perSide: false, weight: 12 }
    expect(t.updateItem(EX, 'sq', input)).toBe(true)
    expect(items(EX).find((e) => e.id === 'sq')).toEqual({
      id: 'sq',
      name: 'Goblet squats',
      reps: 12,
      perSide: false,
      weight: 12,
      target: 5,
    })
    expect(t.totalFor(EX, 'sq')).toBe(1)
  })

  it('drops the weight when cleared and rejects bad input', () => {
    const t = store()
    t.updateItem(EX, 'sq', { name: 'Squats', reps: 15, perSide: false, weight: 12 })
    t.updateItem(EX, 'sq', { name: 'Squats', reps: 15, perSide: false })
    expect(items(EX).find((e) => e.id === 'sq')).not.toHaveProperty('weight')
    expect(t.updateItem(EX, 'sq', { name: '  ', reps: 1, perSide: false })).toBe(false)
    expect(t.updateItem(EX, 'nope', { name: 'X', reps: 1, perSide: false })).toBe(false)
    expect(items(EX).find((e) => e.id === 'sq')!.name).toBe('Squats')
  })

  it('keeps no note in the week: an item’s notes are its details, for every week (D3)', () => {
    const t = store()
    const input = { name: 'Squats', reps: 15, perSide: false, notes: 'Knees out' }
    t.updateItem(EX, 'sq', input as never)
    expect(items(EX).find((e) => e.id === 'sq')).not.toHaveProperty('notes')
    t.addItem(EX, { ...input, name: 'Swings' } as never)
    expect(items(EX).at(-1)).not.toHaveProperty('notes')
  })

  it('stores a weight given when adding', () => {
    const t = store()
    t.addItem(EX, { name: 'Swings', reps: 20, perSide: false, weight: 16 })
    expect(items(EX).at(-1)).toMatchObject({ name: 'Swings', reps: 20, weight: 16, target: 3 })
    t.addItem(EX, { name: 'Plank', reps: 0, perSide: false, weight: -4 })
    expect(items(EX).at(-1)).not.toHaveProperty('weight')
  })
})

describe('weekly plans', () => {
  const names = () => items(EX).map((e) => e.name)

  it('shows the defaults until something changes, then plans only the changed week', () => {
    const t = store()
    expect(names()).toHaveLength(5)
    expect(t.plansOf(EX)).toEqual({})
    t.changeTarget(EX, 'pu', 1)
    expect(Object.keys(t.plansOf(EX))).toEqual([WEEK])
  })

  it('carries the latest earlier plan forward to unplanned weeks', () => {
    const t = store()
    t.addItem(EX, { name: 'Swings', reps: 20, perSide: false, weight: 16 })
    usePlannerStore().nextWeek()
    usePlannerStore().nextWeek()
    expect(names()).toContain('Swings')
    expect(t.plansOf(EX)).not.toHaveProperty('2026-11-02')
  })

  it('lets an unplanned week follow later edits until it is changed itself', () => {
    const t = store()
    const p = usePlannerStore()
    t.changeTarget(EX, 'pu', 1)
    p.nextWeek()
    p.prevWeek()
    t.updateItem(EX, 'sq', { name: 'Squats', reps: 15, perSide: false, weight: 12 })
    p.nextWeek()
    expect(items(EX).find((e) => e.id === 'sq')!.weight).toBe(12)
    // A tick gives the week its own plan, so edits to the earlier week no longer reach it.
    t.toggle(EX, 'sq', 0)
    expect(t.plansOf(EX)).toHaveProperty('2026-10-26')
    p.prevWeek()
    t.updateItem(EX, 'sq', { name: 'Squats', reps: 15, perSide: false, weight: 16 })
    p.nextWeek()
    expect(items(EX).find((e) => e.id === 'sq')!.weight).toBe(12)
  })

  it('edits, adds and removes in the visible week only', () => {
    const t = store()
    const p = usePlannerStore()
    t.changeTarget(EX, 'pu', 1)
    p.nextWeek()
    t.removeItem(EX, 'pu')
    t.addItem(EX, { name: 'Swings', reps: 20, perSide: false })
    t.changeTarget(EX, 'sq', -1)
    expect(names()).not.toContain('Push-ups')
    p.prevWeek()
    expect(names()).toContain('Push-ups')
    expect(names()).not.toContain('Swings')
    expect(items(EX).find((e) => e.id === 'sq')!.target).toBe(4)
  })

  it('removes an item from this week on: later weeks follow, earlier ones keep it (K127)', () => {
    const t = store()
    const p = usePlannerStore()
    // Last week has a plan of its own, so it isn't this week's carried back.
    p.prevWeek()
    t.changeTarget(EX, 'sq', 1)
    p.nextWeek()
    t.removeItem(EX, 'pu')
    expect(names()).not.toContain('Push-ups')
    p.nextWeek()
    p.nextWeek()
    expect(names()).not.toContain('Push-ups')
    p.prevWeek()
    p.prevWeek()
    p.prevWeek()
    expect(names()).toContain('Push-ups')
  })

  it('keeps each tracker’s plans apart, a new one’s too', () => {
    const t = store()
    const id = t.createTracker({ name: 'Upper body', kind: 'strength' })!
    const added = t.addItem(id, { name: 'Dips', sets: 3, reps: 8, perSide: false })!
    expect(t.itemsOf(id)).toEqual([
      { id: added, name: 'Dips', sets: 3, reps: 8, perSide: false, target: 3 },
    ])
    t.toggle(id, added, 1)
    expect(t.markOf(id, added, 1)).toBe('great')
    expect(t.markOf(EX, added, 1)).toBeNull()
    expect(items(EX)).toHaveLength(5)
    usePlannerStore().nextWeek()
    expect(t.itemsOf(id).map((it) => it.name)).toEqual(['Dips'])
  })
})

describe('a mobility tracker (W8)', () => {
  it('plans by hold time or by reps, each side, and keeps no weight', () => {
    const t = store()
    const id = t.createTracker({ name: 'Mobility', kind: 'mobility' })!
    expect(t.dailyTarget(id)).toBe(3)
    const hold = t.addItem(id, {
      name: 'Hip hold',
      sets: 2,
      duration: 45,
      perSide: true,
      weight: 8,
    })!
    const reps = t.addItem(id, { name: 'Cat-cow', sets: 3, reps: 10, perSide: false, weight: 4 })!
    expect(t.itemsOf(id)).toEqual([
      { id: hold, name: 'Hip hold', sets: 2, reps: 0, duration: 45, perSide: true, target: 3 },
      { id: reps, name: 'Cat-cow', sets: 3, reps: 10, perSide: false, target: 3 },
    ])
    t.updateItem(id, reps, { name: 'Cat-cow', reps: 12, perSide: false, weight: 6 })
    expect(t.itemsOf(id)[1]).toEqual({
      id: reps,
      name: 'Cat-cow',
      reps: 12,
      perSide: false,
      target: 3,
    })
    // A press marks it as an exercise: great, then partial.
    t.toggle(id, hold, 0)
    t.toggle(id, hold, 0)
    expect(t.markOf(id, hold, 0)).toBe('partial')
  })
})

describe('the cardio tracker (K90)', () => {
  it('shows no cardio until some is planned, unlike the other two first trackers', () => {
    const t = store()
    expect(t.itemsOf('cardio')).toEqual([])
    expect(t.dayCounts('cardio')).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(t.goalsMet('cardio')).toBe(0)
  })

  it('marks a day like an exercise: great, partial and missed in each drawing, then empty', () => {
    const t = useTrackersStore()
    t.adopt(firstTrackers(null), { cardio: { plans: { [WEEK]: [CYCLING, RUNNING] }, log: {} } })
    for (const mark of EXERCISE_CYCLE) {
      t.toggle('cardio', 'cy', 1)
      expect(t.markOf('cardio', 'cy', 1)).toBe(mark)
    }
    t.toggle('cardio', 'cy', 1)
    expect(t.markOf('cardio', 'cy', 1)).toBeNull()
    // In a symbol set, one press per kind.
    usePlannerStore().markSet = 'ticks'
    for (const mark of EXERCISE_KIND_CYCLE) {
      t.toggle('cardio', 'ru', 4)
      expect(t.markOf('cardio', 'ru', 4)).toBe(mark)
    }
  })

  it('counts every kind of mark towards the weekly goal', () => {
    const t = useTrackersStore()
    t.adopt(firstTrackers(null), {
      cardio: {
        plans: { [WEEK]: [CYCLING, RUNNING] },
        log: { [WEEK]: { cy: ['great', null, 'missed', null, null, null, null] } },
      },
    })
    expect(t.totalFor('cardio', 'cy')).toBe(2)
    expect(t.totalFor('cardio', 'ru')).toBe(0)
    expect(t.dayCounts('cardio')).toEqual([1, 0, 1, 0, 0, 0, 0])
    expect(t.goalsMet('cardio')).toBe(1)
  })

  it('adds an item with a time, a distance, both or neither, and a goal of 3 by default', () => {
    const t = store()
    expect(t.addItem('cardio', { name: '  ' })).toBeNull()
    const ride = t.addItem('cardio', { name: ' Cycling ', duration: 1800.4, target: 9 })!
    const run = t.addItem('cardio', { name: 'Running', distance: 5.004 })!
    const swim = t.addItem('cardio', { name: 'Swim', duration: 0, distance: -1 })!
    const far = t.addItem('cardio', {
      name: 'Tour',
      duration: 999_999,
      distance: 5000,
      target: 2,
    })!
    // A strength field means nothing to cardio.
    const odd = t.addItem('cardio', { name: 'Odd', reps: 5, sets: 2, perSide: true, weight: 4 })!
    expect(t.itemsOf('cardio')).toEqual([
      { id: ride, name: 'Cycling', duration: 1800, target: 7 },
      { id: run, name: 'Running', distance: 5, target: 3 },
      { id: swim, name: 'Swim', target: 3 },
      { id: far, name: 'Tour', duration: 86_400, distance: 1000, target: 2 },
      { id: odd, name: 'Odd', target: 3 },
    ])
    expect(t.plansOf('cardio')[WEEK]).toHaveLength(5)
  })

  it('changes an item this week, keeping its goal when none is given', () => {
    const t = useTrackersStore()
    t.adopt(firstTrackers(null), {
      cardio: { plans: { '2026-10-12': [CYCLING, RUNNING] }, log: {} },
    })
    expect(t.updateItem('cardio', 'cy', { name: '', duration: 60 })).toBe(false)
    expect(t.updateItem('cardio', 'nope', { name: 'Nope' })).toBe(false)
    expect(t.updateItem('cardio', 'cy', { name: 'Long ride', distance: 40 })).toBe(true)
    expect(t.itemsOf('cardio')[0]).toEqual({ id: 'cy', name: 'Long ride', distance: 40, target: 2 })
    expect(t.updateItem('cardio', 'ru', { name: 'Running', duration: 1500, target: 4 })).toBe(true)
    expect(t.itemsOf('cardio')[1]).toEqual({ id: 'ru', name: 'Running', duration: 1500, target: 4 })
    // The earlier week it carried forward from is left as it was.
    expect(t.plansOf('cardio')['2026-10-12']).toEqual([CYCLING, RUNNING])
  })

  it('follows the planner’s week: a week before the first plan shows the earliest one', () => {
    const t = useTrackersStore()
    t.adopt(firstTrackers(null), { cardio: { plans: { [WEEK]: [CYCLING] }, log: {} } })
    usePlannerStore().prevWeek()
    expect(t.itemsOf('cardio')).toEqual([CYCLING])
  })
})

describe('the food tracker', () => {
  const D = 'diet'

  it('starts with the default foods', () => {
    const t = store()
    expect(t.itemsOf(D).map((f) => [f.name, f.target])).toEqual([
      ['Vegetables', 7],
      ['Fruit', 5],
      ['Fish', 2],
      ['Nuts', 3],
    ])
    expect(t.grandTotal(D)).toBe(0)
    expect(t.goalsMet(D)).toBe(0)
  })

  it('marks a food eaten in each drawing, then clears it; once in a tick set', () => {
    const t = store()
    t.toggle(D, 'fish', 0)
    t.toggle(D, 'fish', 3)
    t.toggle(D, 'veg', 3)
    expect(t.markOf(D, 'fish', 3)).toBe('great')
    expect(t.totalFor(D, 'fish')).toBe(2)
    expect(t.dayCounts(D)).toEqual([1, 0, 0, 2, 0, 0, 0])
    expect(t.goalsMet(D)).toBe(1)
    t.toggle(D, 'fish', 3)
    expect(t.markOf(D, 'fish', 3)).toBe('great-solid')
    t.toggle(D, 'fish', 3)
    expect(t.markOf(D, 'fish', 3)).toBe('great-hatch')
    t.toggle(D, 'fish', 3)
    expect(t.markOf(D, 'fish', 3)).toBeNull()
    usePlannerStore().markSet = 'ticks'
    t.toggle(D, 'nuts', 0)
    expect(t.markOf(D, 'nuts', 0)).toBe('great')
    t.toggle(D, 'nuts', 0)
    expect(t.markOf(D, 'nuts', 0)).toBeNull()
  })

  it('renames a food and sets its goal, clamped, keeping its id and marks', () => {
    const t = store()
    t.toggle(D, 'fish', 0)
    expect(t.updateItem(D, 'fish', { name: ' Salmon ', target: 9 })).toBe(true)
    expect(t.itemsOf(D)[2]).toEqual({ id: 'fish', name: 'Salmon', target: 7 })
    expect(t.isDone(D, 'fish', 0)).toBe(true)
    // A food keeps no exercise fields.
    t.updateItem(D, 'fish', { name: 'Salmon', reps: 3, distance: 4 })
    expect(t.itemsOf(D)[2]).toEqual({ id: 'fish', name: 'Salmon', target: 7 })
  })

  it('adds a food with goal 3, or its own clamped, and removes one from this week', () => {
    const t = store()
    const id = t.addItem(D, { name: ' Beans ' })
    expect(t.itemsOf(D).at(-1)).toEqual({ id, name: 'Beans', target: 3 })
    const lentils = t.addItem(D, { name: 'Lentils', target: 9 })
    expect(t.itemsOf(D).at(-1)).toEqual({ id: lentils, name: 'Lentils', target: 7 })
    t.toggle(D, 'nuts', 0)
    t.removeItem(D, 'nuts')
    expect(t.itemsOf(D).map((f) => f.id)).not.toContain('nuts')
    expect(t.logOf(D)[WEEK]?.nuts?.[0]).toBe('great')
  })

  it('never reads or writes the diet keys from before accounts', async () => {
    const legacy = JSON.stringify({ foods: [{ id: 'z', name: 'Z', target: 2 }], log: {} })
    localStorage.setItem('tracker-diet-v1', legacy)
    setActivePinia(createPinia())
    const t = store()
    expect(t.itemsOf(D)).toHaveLength(4)
    t.toggle(D, 'veg', 0)
    await nextTick()
    expect(localStorage.getItem('tracker-diet-v1')).toBe(legacy)
    expect(stored(DIET_KEY)).toBeNull()
  })
})
