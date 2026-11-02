import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { exerciseDetails, usePlannerStore } from '@/stores/planner'
import { useDetailsStore } from '@/stores/details'
import { DATA_KEY, LEGACY_DATA_KEY, MARKS, SETTINGS_KEY } from '@/lib/storage'

// Friday 23 Oct 2026: the week is Mon 19 – Sun 25 and today is index 4.
const NOW = new Date(2026, 9, 23, 18, 0)

function stored(key: string): unknown {
  const raw = localStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

describe('planner store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with the five default exercises and the current week', () => {
    const s = usePlannerStore()
    expect(s.exercises.map((e) => e.name)).toEqual([
      'Push-ups',
      'Pull-ups',
      'Squats',
      'Back extensions',
      'Kettlebell halos',
    ])
    expect(s.weekKey).toBe('2026-10-19')
    expect(s.label).toBe('19–25 October')
    expect(s.days.map((d) => d.date)).toEqual(['19', '20', '21', '22', '23', '24', '25'])
    expect(s.days[3]!.full).toBe('Thursday 22 October')
    expect(s.days.findIndex((d) => d.isToday)).toBe(4)
    expect(s.days.map((d) => d.isFuture)).toEqual([false, false, false, false, false, true, true])
  })

  it('never reads or writes the keys from before accounts', async () => {
    const legacy = JSON.stringify({ exercises: [{ id: 'a', name: 'A', reps: 1, target: 2 }] })
    const v2 = JSON.stringify({ plans: { '2026-10-19': [] }, log: {} })
    localStorage.setItem(LEGACY_DATA_KEY, legacy)
    localStorage.setItem(DATA_KEY, v2)
    setActivePinia(createPinia())
    const s = usePlannerStore()
    expect(s.exercises).toHaveLength(5)
    s.toggle('pu', 0)
    s.addExercise({ name: 'Lunges', reps: 12, perSide: true })
    await nextTick()
    expect(localStorage.getItem(LEGACY_DATA_KEY)).toBe(legacy)
    expect(localStorage.getItem(DATA_KEY)).toBe(v2)
  })

  it('steps a cell through every kind in every drawing, each counting, then back to empty', () => {
    const s = usePlannerStore()
    for (const mark of MARKS) {
      s.toggle('pu', 0)
      expect(s.markOf('pu', 0)).toBe(mark)
      expect(s.isDone('pu', 0)).toBe(true)
      expect(s.totalFor('pu')).toBe(1)
    }
    s.toggle('pu', 0)
    expect(s.markOf('pu', 0)).toBeNull()
    expect(s.isDone('pu', 0)).toBe(false)
    expect(s.log['2026-10-19']!.pu).toEqual([null, null, null, null, null, null, null])
  })

  it('steps a cell through the three kinds once in a tick or face set (K21)', () => {
    const s = usePlannerStore()
    s.markSet = 'faces'
    s.toggle('pu', 0)
    expect(s.markOf('pu', 0)).toBe('great')
    s.toggle('pu', 0)
    expect(s.markOf('pu', 0)).toBe('partial')
    s.toggle('pu', 0)
    expect(s.markOf('pu', 0)).toBe('missed')
    s.toggle('pu', 0)
    expect(s.markOf('pu', 0)).toBeNull()
  })

  it('counts picks per day and the grand total across exercises', () => {
    const s = usePlannerStore()
    s.toggle('pu', 2)
    s.toggle('sq', 2)
    s.toggle('kh', 2)
    s.toggle('kh', 3)
    expect(s.dayCounts).toEqual([0, 0, 3, 1, 0, 0, 0])
    expect(s.grandTotal).toBe(4)
  })

  it('ignores log entries for removed exercises in the totals', () => {
    const s = usePlannerStore()
    s.toggle('pu', 0)
    s.toggle('sq', 0)
    s.removeExercise('pu')
    expect(s.dayCounts[0]).toBe(1)
    expect(s.grandTotal).toBe(1)
    expect(s.log['2026-10-19']?.pu?.[0]).toBe('great')
  })

  it('knows the real current week whichever week is on screen', () => {
    const s = usePlannerStore()
    s.nextWeek()
    expect(s.weekKey).toBe('2026-10-26')
    expect(s.currentWeekKey).toBe('2026-10-19')
  })

  it('keeps each week separate when navigating', () => {
    const s = usePlannerStore()
    s.toggle('pu', 0)
    s.prevWeek()
    expect(s.weekKey).toBe('2026-10-12')
    expect(s.isDone('pu', 0)).toBe(false)
    expect(s.days.some((d) => d.isToday)).toBe(false)
    s.nextWeek()
    s.nextWeek()
    expect(s.weekKey).toBe('2026-10-26')
    s.thisWeek()
    expect(s.weekKey).toBe('2026-10-19')
    expect(s.isDone('pu', 0)).toBe(true)
  })

  it('clamps the goal to 0–7', () => {
    const s = usePlannerStore()
    for (let i = 0; i < 10; i++) s.changeTarget('pu', 1)
    expect(s.exercises[0]!.target).toBe(7)
    for (let i = 0; i < 10; i++) s.changeTarget('pu', -1)
    expect(s.exercises[0]!.target).toBe(0)
    s.changeTarget('missing', 1)
  })

  it('keeps a duration over reps, and takes a goal from the form', () => {
    const s = usePlannerStore()
    s.addExercise({ name: 'Wall sit', reps: 12, duration: 60.7, perSide: false, target: 5 })
    const added = s.exercises.at(-1)!
    expect(added).toMatchObject({ name: 'Wall sit', reps: 0, duration: 60, target: 5 })
    expect(s.updateExercise(added.id, { name: 'Wall sit', reps: 12, perSide: false })).toBe(true)
    expect(s.exercises.at(-1)).toMatchObject({ reps: 12, target: 5 })
    expect(s.exercises.at(-1)).not.toHaveProperty('duration')
  })

  it('adds an exercise with goal 3 and ignores an empty name', () => {
    const s = usePlannerStore()
    expect(s.addExercise({ name: '   ', reps: 5, perSide: false })).toBeNull()
    expect(s.exercises).toHaveLength(5)
    const id = s.addExercise({ name: '  Lunges ', reps: 12, perSide: true })
    const added = s.exercises[5]!
    expect(added.id).toBe(id)
    expect(added).toMatchObject({ name: 'Lunges', reps: 12, perSide: true, target: 3 })
    expect(added.id).toMatch(/^x/)
    expect(s.plans['2026-10-19']).toHaveLength(6)
  })

  it('stores non-positive or non-numeric reps as 0', () => {
    const s = usePlannerStore()
    s.addExercise({ name: 'A', reps: Number.NaN, perSide: false })
    s.addExercise({ name: 'B', reps: -3, perSide: false })
    expect(s.exercises.slice(-2).map((e) => e.reps)).toEqual([0, 0])
  })

  it('moves "today" when the clock passes midnight and refreshNow runs', () => {
    const s = usePlannerStore()
    vi.setSystemTime(new Date(2026, 9, 24, 0, 5))
    s.refreshNow()
    expect(s.days.findIndex((d) => d.isToday)).toBe(5)
  })

  it('leaves now untouched when refreshNow runs on the same date', () => {
    const s = usePlannerStore()
    const before = s.now
    vi.setSystemTime(new Date(2026, 9, 23, 23, 59))
    s.refreshNow()
    expect(s.now).toBe(before)
  })

  it('adopts data and settings wholesale, and adopts one week at a time', () => {
    const s = usePlannerStore()
    const plan = [{ id: 'a', name: 'A', reps: 5, target: 2 }]
    s.adopt(
      {
        plans: { '2026-10-19': plan },
        log: { '2026-10-19': { a: ['great', null, null, null, null, null, null] } },
      },
      { accent: '#ff9f0a', dailyPick: 5, foodPick: 4 },
    )
    expect(s.exercises).toEqual(plan)
    expect(s.grandTotal).toBe(1)
    expect([s.accent, s.dailyPick, s.foodPick]).toEqual(['#ff9f0a', 5, 4])
    expect(s.savedSettings()).toEqual({ accent: '#ff9f0a', dailyPick: 5, foodPick: 4 })
    s.adoptWeek('2026-10-19', [])
    expect(s.exercises).toEqual([])
    s.adopt({ plans: {}, log: {} }, null)
    expect(s.exercises).toHaveLength(5)
    expect([s.accent, s.dailyPick, s.foodPick]).toEqual(['#30d158', 3, 2])
    expect(s.savedSettings()).toBeNull()
  })

  it('clears the user’s data, the mode and the week on sign-out, but keeps the theme', () => {
    const s = usePlannerStore()
    s.toggle('pu', 0)
    s.changeDailyPick(1)
    s.changeFoodPick(1)
    s.setConfigMode(true)
    s.nextWeek()
    s.setTheme('dark')
    s.clear()
    expect(s.grandTotal).toBe(0)
    expect(s.dailyPick).toBe(3)
    expect(s.foodPick).toBe(2)
    expect(s.savedSettings()).toBeNull()
    expect(s.configMode).toBe(false)
    expect(s.weekOffset).toBe(0)
    expect(s.theme).toBe('dark')
  })

  it('clamps daily pick to 1–8, and a change counts as saved settings', () => {
    const s = usePlannerStore()
    expect(s.savedSettings()).toBeNull()
    s.changeDailyPick(1)
    // The accent is kept as stored; nothing in the app changes it now.
    expect(s.savedSettings()).toEqual({ accent: '#30d158', dailyPick: 4, foodPick: 2 })
    for (let i = 0; i < 10; i++) s.changeDailyPick(1)
    expect(s.dailyPick).toBe(8)
    for (let i = 0; i < 10; i++) s.changeDailyPick(-1)
    expect(s.dailyPick).toBe(1)
  })

  it('clamps foods a day to 1–8, and a change counts as saved settings', () => {
    const s = usePlannerStore()
    s.changeFoodPick(1)
    expect(s.savedSettings()).toEqual({ accent: '#30d158', dailyPick: 3, foodPick: 3 })
    for (let i = 0; i < 10; i++) s.changeFoodPick(1)
    expect(s.foodPick).toBe(8)
    for (let i = 0; i < 10; i++) s.changeFoodPick(-1)
    expect(s.foodPick).toBe(1)
  })

  it('stores only the theme, merged into the device’s settings key', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ accent: '#ff9f0a', dailyPick: 5, theme: 'light' }),
    )
    setActivePinia(createPinia())
    const s = usePlannerStore()
    expect(s.theme).toBe('light')
    // The accent and daily pick are the user's, from the server, not the device's.
    expect([s.accent, s.dailyPick]).toEqual(['#30d158', 3])
    s.changeDailyPick(1)
    s.setTheme('dark')
    await nextTick()
    expect(stored(SETTINGS_KEY)).toEqual({ accent: '#ff9f0a', dailyPick: 5, theme: 'dark' })
  })

  it('keeps the mark set on the device, beside the theme, and reads it back', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }))
    setActivePinia(createPinia())
    const s = usePlannerStore()
    expect(s.markSet).toBe('squiggles')
    s.markSet = 'stamped-ticks'
    await nextTick()
    expect(stored(SETTINGS_KEY)).toEqual({ theme: 'dark', markSet: 'stamped-ticks' })
    setActivePinia(createPinia())
    expect(usePlannerStore().markSet).toBe('stamped-ticks')
  })

  it('writes a settings key holding only the theme when there was none', async () => {
    const s = usePlannerStore()
    s.setTheme('light')
    await nextTick()
    expect(stored(SETTINGS_KEY)).toEqual({ theme: 'light' })
  })
})

describe('exerciseDetails', () => {
  it('formats per set, per side and missing reps in the Chip card’s words', () => {
    expect(exerciseDetails({ id: 'a', name: 'A', reps: 10, target: 3 })).toEqual(['10 reps a set'])
    expect(exerciseDetails({ id: 'a', name: 'A', reps: 8, perSide: true, target: 3 })).toEqual([
      '8 each side',
    ])
    // Nothing to say gives no chip, not a dash.
    expect(exerciseDetails({ id: 'a', name: 'A', reps: 0, target: 3 })).toEqual([])
  })

  it('formats a timed set in seconds and minutes, with sets and each side', () => {
    const timed = (duration: number, more = {}) =>
      exerciseDetails({ id: 'a', name: 'A', reps: 0, duration, target: 3, ...more })
    expect(timed(45)).toEqual(['45 s'])
    expect(timed(120, { sets: 3 })).toEqual(['3 × 2 min'])
    expect(timed(90, { perSide: true })).toEqual(['1 min 30 s each side'])
    expect(timed(30, { sets: 2, perSide: true, weight: 10 })).toEqual([
      '2 × 30 s each side',
      '10 kg',
    ])
  })

  it('appends the weight, or shows it alone without reps', () => {
    expect(exerciseDetails({ id: 'a', name: 'A', reps: 15, weight: 12, target: 3 })).toEqual([
      '15 reps a set',
      '12 kg',
    ])
    expect(exerciseDetails({ id: 'a', name: 'A', reps: 0, weight: 2.5, target: 3 })).toEqual([
      '2.5 kg',
    ])
  })
})

describe('updateExercise', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('replaces the fields but keeps the id, goal and history', () => {
    const s = usePlannerStore()
    s.toggle('sq', 0)
    s.changeTarget('sq', 1)
    expect(
      s.updateExercise('sq', { name: ' Goblet squats ', reps: 12, perSide: false, weight: 12 }),
    ).toBe(true)
    expect(s.exercises.find((e) => e.id === 'sq')).toEqual({
      id: 'sq',
      name: 'Goblet squats',
      reps: 12,
      perSide: false,
      weight: 12,
      target: 5,
    })
    expect(s.totalFor('sq')).toBe(1)
  })

  it('drops the weight when cleared and rejects bad input', () => {
    const s = usePlannerStore()
    s.updateExercise('sq', { name: 'Squats', reps: 15, perSide: false, weight: 12 })
    s.updateExercise('sq', { name: 'Squats', reps: 15, perSide: false })
    expect(s.exercises.find((e) => e.id === 'sq')).not.toHaveProperty('weight')
    expect(s.updateExercise('sq', { name: '  ', reps: 1, perSide: false })).toBe(false)
    expect(s.updateExercise('nope', { name: 'X', reps: 1, perSide: false })).toBe(false)
    expect(s.exercises.find((e) => e.id === 'sq')!.name).toBe('Squats')
  })

  it('keeps no note in the week: an exercise’s notes are its details, for every week (D3)', () => {
    const s = usePlannerStore()
    const input = { name: 'Squats', reps: 15, perSide: false, notes: 'Knees out' }
    s.updateExercise('sq', input as never)
    expect(s.exercises.find((e) => e.id === 'sq')).not.toHaveProperty('notes')
    s.addExercise({ ...input, name: 'Swings' } as never)
    expect(s.exercises.at(-1)).not.toHaveProperty('notes')
  })

  it('forgets the items’ details with the rest of the user’s data', () => {
    const s = usePlannerStore()
    const details = useDetailsStore()
    details.setNotes('exercise', 'sq', 'Knees out')
    s.clear()
    expect(details.notesOf('exercise', 'sq')).toBe('')
  })

  it('stores a weight given when adding', () => {
    const s = usePlannerStore()
    s.addExercise({ name: 'Swings', reps: 20, perSide: false, weight: 16 })
    expect(s.exercises.at(-1)).toMatchObject({ name: 'Swings', reps: 20, weight: 16, target: 3 })
    s.addExercise({ name: 'Plank', reps: 0, perSide: false, weight: -4 })
    expect(s.exercises.at(-1)).not.toHaveProperty('weight')
  })
})

describe('weekly plans', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  const names = (s: ReturnType<typeof usePlannerStore>) => s.exercises.map((e) => e.name)

  it('shows the defaults until something changes, then plans only the changed week', () => {
    const s = usePlannerStore()
    expect(names(s)).toHaveLength(5)
    expect(s.plans).toEqual({})
    s.changeTarget('pu', 1)
    expect(Object.keys(s.plans)).toEqual(['2026-10-19'])
  })

  it('carries the latest earlier plan forward to unplanned weeks', () => {
    const s = usePlannerStore()
    s.addExercise({ name: 'Swings', reps: 20, perSide: false, weight: 16 })
    s.nextWeek()
    s.nextWeek()
    expect(names(s)).toContain('Swings')
    expect(s.plans).not.toHaveProperty('2026-11-02')
  })

  it('lets an unplanned week follow later edits until it is changed itself', () => {
    const s = usePlannerStore()
    s.changeTarget('pu', 1)
    s.nextWeek()
    s.prevWeek()
    s.updateExercise('sq', { name: 'Squats', reps: 15, perSide: false, weight: 12 })
    s.nextWeek()
    expect(s.exercises.find((e) => e.id === 'sq')!.weight).toBe(12)

    // A tick gives the week its own plan, so edits to the earlier week no longer reach it.
    s.toggle('sq', 0)
    expect(s.plans).toHaveProperty('2026-10-26')
    s.prevWeek()
    s.updateExercise('sq', { name: 'Squats', reps: 15, perSide: false, weight: 16 })
    s.nextWeek()
    expect(s.exercises.find((e) => e.id === 'sq')!.weight).toBe(12)
  })

  it('edits, adds and removes in the visible week only', () => {
    const s = usePlannerStore()
    s.changeTarget('pu', 1)
    s.nextWeek()
    s.removeExercise('pu')
    s.addExercise({ name: 'Swings', reps: 20, perSide: false })
    s.changeTarget('sq', -1)
    expect(names(s)).not.toContain('Push-ups')
    s.prevWeek()
    expect(names(s)).toContain('Push-ups')
    expect(names(s)).not.toContain('Swings')
    expect(s.exercises.find((e) => e.id === 'sq')!.target).toBe(4)
  })

  it('starts in normal mode and toggles config mode without saving it', async () => {
    const s = usePlannerStore()
    expect(s.configMode).toBe(false)
    s.setConfigMode(true)
    expect(s.configMode).toBe(true)
    await nextTick()
    expect(localStorage.length).toBe(0)
  })
})

describe('exercise sets', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('formats sets with reps, per side, or alone', () => {
    const e = { id: 'a', name: 'A', target: 3 }
    expect(exerciseDetails({ ...e, sets: 3, reps: 10 })).toEqual(['3 × 10'])
    expect(exerciseDetails({ ...e, sets: 3, reps: 8, perSide: true })).toEqual(['3 × 8 each side'])
    expect(exerciseDetails({ ...e, sets: 4, reps: 0 })).toEqual(['4 sets'])
  })

  it('stores sets as a whole number capped at 20, and drops 0', () => {
    const s = usePlannerStore()
    s.addExercise({ name: 'A', sets: 3.7, reps: 10, perSide: false })
    s.addExercise({ name: 'B', sets: 99, reps: 10, perSide: false })
    s.addExercise({ name: 'C', sets: 0, reps: 10, perSide: false })
    const [a, b, c] = s.exercises.slice(-3)
    expect([a!.sets, b!.sets]).toEqual([3, 20])
    expect(c).not.toHaveProperty('sets')
  })
})

describe('savedSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is tracked in memory, so blocked storage cannot hide a change', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const s = usePlannerStore()
    expect(s.savedSettings()).toBeNull()
    s.changeDailyPick(1)
    expect(s.savedSettings()).toEqual({ accent: '#30d158', dailyPick: 4, foodPick: 2 })
  })

  it('holds each type’s item-page arrangement, saved with the other settings (K66)', () => {
    const s = usePlannerStore()
    expect(s.itemSections).toEqual({})
    expect(s.arrangementFor('exercise')).toEqual({
      order: ['notes', 'details', 'plan', 'history'],
      hidden: [],
    })
    const arranged = { order: ['history', 'notes', 'details', 'plan'], hidden: ['details'] }
    s.setArrangement('exercise', {
      order: ['history', 'notes', 'details', 'plan'],
      hidden: ['details'],
    })
    expect(s.itemSections).toEqual({ exercise: arranged })
    expect(s.arrangementFor('exercise')).toEqual(arranged)
    expect(s.arrangementFor('food').hidden).toEqual([])
    expect(s.savedSettings()).toEqual({
      accent: '#30d158',
      dailyPick: 3,
      foodPick: 2,
      itemSections: { exercise: arranged },
    })
    // Back to the default: left out, as for an account that never arranged a page.
    s.setArrangement('exercise', { order: ['notes', 'details', 'plan', 'history'], hidden: [] })
    expect(s.itemSections).toEqual({})
    expect(s.savedSettings()).toEqual({ accent: '#30d158', dailyPick: 3, foodPick: 2 })
  })

  it('adopts the arrangement with the settings, and the default with none', () => {
    const s = usePlannerStore()
    const food = { order: ['plan', 'notes', 'details', 'history'], hidden: [] } as const
    s.adopt(
      { plans: {}, log: {} },
      {
        accent: '#ff9f0a',
        dailyPick: 2,
        foodPick: 5,
        itemSections: { food: { ...food, order: [...food.order], hidden: [] } },
      },
    )
    expect(s.arrangementFor('food').order).toEqual(food.order)
    expect(s.savedSettings()!.itemSections).toEqual({ food })
    s.adopt({ plans: {}, log: {} }, { accent: '#ff9f0a', dailyPick: 2, foodPick: 5 })
    expect(s.itemSections).toEqual({})
    s.setArrangement('food', { ...food, order: [...food.order], hidden: [] })
    s.adopt({ plans: {}, log: {} }, null)
    expect(s.itemSections).toEqual({})
  })

  it('treats adopted settings as saved, and none adopted as unsaved', () => {
    const s = usePlannerStore()
    s.adopt({ plans: {}, log: {} }, { accent: '#ff9f0a', dailyPick: 2, foodPick: 5 })
    expect(s.savedSettings()).toEqual({ accent: '#ff9f0a', dailyPick: 2, foodPick: 5 })
    s.adopt({ plans: {}, log: {} }, null)
    expect(s.savedSettings()).toBeNull()
  })

  describe('My goals', () => {
    const PICKS = { accent: '#30d158', dailyPick: 3, foodPick: 2 }

    it('start unknown, so they are neither sent nor cached', () => {
      const s = usePlannerStore()
      expect(s.goals).toBe('')
      expect(s.goalsKnown).toBe(false)
      expect(s.portableSettings()).toEqual(PICKS)
      s.changeDailyPick(1)
      expect(s.savedSettings()).toEqual({ ...PICKS, dailyPick: 4 })
    })

    it('are set normalised, and count as the person’s settings', () => {
      const s = usePlannerStore()
      s.setGoals('  Run 5 km by March.\n\n')
      expect(s.goals).toBe('Run 5 km by March.')
      expect(s.goalsKnown).toBe(true)
      expect(s.savedSettings()).toEqual({ ...PICKS, goals: 'Run 5 km by March.' })
      s.setGoals('')
      expect(s.portableSettings()).toEqual({ ...PICKS, goals: '' })
    })

    it('ignore the same text again, and stay unknown when nothing changed', () => {
      const s = usePlannerStore()
      s.setGoals('   ')
      expect(s.goalsKnown).toBe(false)
      expect(s.savedSettings()).toBeNull()
    })

    it('are adopted when the settings carry them, and kept when they don’t', () => {
      const s = usePlannerStore()
      s.adopt({ plans: {}, log: {} }, { ...PICKS, goals: 'Lose 3 kg.' })
      expect([s.goals, s.goalsKnown]).toEqual(['Lose 3 kg.', true])
      // A tab from before My goals wrote these, or there are no settings at all.
      s.adopt({ plans: {}, log: {} }, { ...PICKS, dailyPick: 5 })
      expect([s.goals, s.dailyPick]).toEqual(['Lose 3 kg.', 5])
      s.adopt({ plans: {}, log: {} }, null)
      expect([s.goals, s.goalsKnown]).toEqual(['Lose 3 kg.', true])
      s.adopt({ plans: {}, log: {} }, { ...PICKS, goals: '' })
      expect([s.goals, s.goalsKnown]).toEqual(['', true])
    })

    it('are forgotten on sign-out', () => {
      const s = usePlannerStore()
      s.setGoals('Lose 3 kg.')
      s.clear()
      expect([s.goals, s.goalsKnown]).toEqual(['', false])
      expect(s.portableSettings()).toEqual(PICKS)
    })
  })

  it('does not count a theme change: the theme is the device’s', async () => {
    const s = usePlannerStore()
    s.setTheme('dark')
    await nextTick()
    expect(s.savedSettings()).toBeNull()
  })
})
