import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { exerciseDetails, usePlannerStore } from '@/stores/planner'
import { useDetailsStore } from '@/stores/details'
import { SETTINGS_KEY } from '@/lib/storage'

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

  it('starts on the current week', () => {
    const s = usePlannerStore()
    expect(s.weekKey).toBe('2026-10-19')
    expect(s.label).toBe('19–25 October')
    expect(s.days.map((d) => d.date)).toEqual(['19', '20', '21', '22', '23', '24', '25'])
    expect(s.days[3]!.full).toBe('Thursday 22 October')
    expect(s.days.findIndex((d) => d.isToday)).toBe(4)
    expect(s.days.map((d) => d.isFuture)).toEqual([false, false, false, false, false, true, true])
  })

  it('knows the real current week whichever week is on screen', () => {
    const s = usePlannerStore()
    s.nextWeek()
    expect(s.weekKey).toBe('2026-10-26')
    expect(s.currentWeekKey).toBe('2026-10-19')
  })

  it('moves between weeks, and back to this one', () => {
    const s = usePlannerStore()
    s.prevWeek()
    expect(s.weekKey).toBe('2026-10-12')
    expect(s.days.some((d) => d.isToday)).toBe(false)
    s.nextWeek()
    s.nextWeek()
    expect(s.weekKey).toBe('2026-10-26')
    s.thisWeek()
    expect(s.weekKey).toBe('2026-10-19')
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

  it('adopts settings wholesale, leaving the daily picks to the trackers (K123)', () => {
    const s = usePlannerStore()
    s.adopt({ accent: '#ff9f0a', dailyPick: 5, foodPick: 4 })
    expect(s.accent).toBe('#ff9f0a')
    expect(s.savedSettings()).toEqual({ accent: '#ff9f0a' })
    s.adopt(null)
    expect(s.accent).toBe('#30d158')
    expect(s.savedSettings()).toBeNull()
  })

  it('clears the user’s settings, details, the mode and the week on sign-out, keeping the theme', () => {
    const s = usePlannerStore()
    s.setGoals('Lose 3 kg.')
    s.setConfigMode(true)
    s.nextWeek()
    s.setTheme('dark')
    const details = useDetailsStore()
    details.setNotes('exercise', 'sq', 'Knees out')
    s.clear()
    expect(details.notesOf('exercise', 'sq')).toBe('')
    expect(s.savedSettings()).toBeNull()
    expect(s.configMode).toBe(false)
    expect(s.weekOffset).toBe(0)
    expect(s.theme).toBe('dark')
  })

  it('stores only the theme, merged into the device’s settings key', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ accent: '#ff9f0a', dailyPick: 5, theme: 'light' }),
    )
    setActivePinia(createPinia())
    const s = usePlannerStore()
    expect(s.theme).toBe('light')
    // The accent is the user's, from the server, not the device's.
    expect(s.accent).toBe('#30d158')
    s.setGoals('Run 5 km.')
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

describe('Edit plan', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
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
  it('formats sets with reps, per side, or alone', () => {
    const e = { id: 'a', name: 'A', target: 3 }
    expect(exerciseDetails({ ...e, sets: 3, reps: 10 })).toEqual(['3 × 10'])
    expect(exerciseDetails({ ...e, sets: 3, reps: 8, perSide: true })).toEqual(['3 × 8 each side'])
    expect(exerciseDetails({ ...e, sets: 4, reps: 0 })).toEqual(['4 sets'])
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
    s.setGoals('Run 5 km.')
    expect(s.savedSettings()).toEqual({ accent: '#30d158', goals: 'Run 5 km.' })
  })

  it('holds each type’s item-page arrangement, saved with the other settings (K66)', () => {
    const s = usePlannerStore()
    expect(s.itemSections).toEqual({})
    expect(s.arrangementFor('strength')).toEqual({
      order: ['plan', 'notes', 'details', 'history'],
      hidden: [],
    })
    const arranged = { order: ['history', 'notes', 'details', 'plan'], hidden: ['details'] }
    s.setArrangement('strength', {
      order: ['history', 'notes', 'details', 'plan'],
      hidden: ['details'],
    })
    expect(s.itemSections).toEqual({ strength: arranged })
    expect(s.arrangementFor('strength')).toEqual(arranged)
    expect(s.arrangementFor('food').hidden).toEqual([])
    expect(s.savedSettings()).toEqual({ accent: '#30d158', itemSections: { strength: arranged } })
    // Back to the default: left out, as for an account that never arranged a page.
    s.setArrangement('strength', { order: ['plan', 'notes', 'details', 'history'], hidden: [] })
    expect(s.itemSections).toEqual({})
    expect(s.savedSettings()).toEqual({ accent: '#30d158' })
  })

  it('adopts the arrangement with the settings, and the default with none', () => {
    const s = usePlannerStore()
    const food = { order: ['notes', 'details', 'plan', 'history'], hidden: [] } as const
    s.adopt({
      accent: '#ff9f0a',
      dailyPick: 2,
      foodPick: 5,
      itemSections: { food: { ...food, order: [...food.order], hidden: [] } },
    })
    expect(s.arrangementFor('food').order).toEqual(food.order)
    expect(s.savedSettings()!.itemSections).toEqual({ food })
    s.adopt({ accent: '#ff9f0a', dailyPick: 2, foodPick: 5 })
    expect(s.itemSections).toEqual({})
    s.setArrangement('food', { ...food, order: [...food.order], hidden: [] })
    s.adopt(null)
    expect(s.itemSections).toEqual({})
  })

  it('treats adopted settings as saved, and none adopted as unsaved', () => {
    const s = usePlannerStore()
    s.adopt({ accent: '#ff9f0a', dailyPick: 2, foodPick: 5 })
    expect(s.savedSettings()).toEqual({ accent: '#ff9f0a' })
    s.adopt(null)
    expect(s.savedSettings()).toBeNull()
  })

  describe('My goals', () => {
    const PICKS = { accent: '#30d158' }

    it('start unknown, so they are neither sent nor cached', () => {
      const s = usePlannerStore()
      expect(s.goals).toBe('')
      expect(s.goalsKnown).toBe(false)
      expect(s.portableSettings()).toEqual(PICKS)
      s.setLimits('Vegetarian.')
      expect(s.savedSettings()).toEqual({ ...PICKS, limits: 'Vegetarian.' })
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
      s.adopt({ ...PICKS, goals: 'Lose 3 kg.' })
      expect([s.goals, s.goalsKnown]).toEqual(['Lose 3 kg.', true])
      // A tab from before My goals wrote these, or there are no settings at all.
      s.adopt({ ...PICKS, accent: '#ff9f0a' })
      expect([s.goals, s.accent]).toEqual(['Lose 3 kg.', '#ff9f0a'])
      s.adopt(null)
      expect([s.goals, s.goalsKnown]).toEqual(['Lose 3 kg.', true])
      s.adopt({ ...PICKS, goals: '' })
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

  describe('Your limits (K107)', () => {
    const PICKS = { accent: '#30d158' }

    it('start unknown, so they are neither sent nor cached', () => {
      const s = usePlannerStore()
      expect([s.limits, s.limitsKnown]).toEqual(['', false])
      expect(s.portableSettings()).toEqual(PICKS)
    })

    it('are set normalised, apart from the goals, and count as the person’s settings', () => {
      const s = usePlannerStore()
      s.setLimits('  Left knee: no jumping.\n\n')
      expect([s.limits, s.limitsKnown]).toEqual(['Left knee: no jumping.', true])
      expect(s.goalsKnown).toBe(false)
      expect(s.savedSettings()).toEqual({ ...PICKS, limits: 'Left knee: no jumping.' })
      s.setLimits('')
      expect(s.portableSettings()).toEqual({ ...PICKS, limits: '' })
    })

    it('ignore the same text again, and stay unknown when nothing changed', () => {
      const s = usePlannerStore()
      s.setLimits('   ')
      expect(s.limitsKnown).toBe(false)
      expect(s.savedSettings()).toBeNull()
    })

    it('are adopted when the settings carry them, and kept when they don’t', () => {
      const s = usePlannerStore()
      s.adopt({ ...PICKS, limits: 'Vegetarian.' })
      expect([s.limits, s.limitsKnown]).toEqual(['Vegetarian.', true])
      // A tab from before Your limits: goals, but no limits.
      s.adopt({ ...PICKS, goals: 'Run 5 km.' })
      expect([s.limits, s.goals]).toEqual(['Vegetarian.', 'Run 5 km.'])
      s.adopt({ ...PICKS, limits: '' })
      expect([s.limits, s.limitsKnown]).toEqual(['', true])
    })

    it('are forgotten on sign-out', () => {
      const s = usePlannerStore()
      s.setLimits('Vegetarian.')
      s.clear()
      expect([s.limits, s.limitsKnown]).toEqual(['', false])
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
