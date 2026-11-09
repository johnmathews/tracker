import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCardioStore } from '@/stores/cardio'
import { usePlannerStore } from '@/stores/planner'
import { EXERCISE_CYCLE, EXERCISE_KIND_CYCLE } from '@/lib/tracker'

// Friday 23 Oct 2026: the visible week is Mon 19 – Sun 25.
const NOW = new Date(2026, 9, 23, 18, 0)
const WEEK = '2026-10-19'
const CYCLING = { id: 'cy', name: 'Cycling', duration: 1800, target: 2 }
const RUNNING = { id: 'ru', name: 'Running', distance: 5, target: 3 }

describe('cardio store (K90)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows no cardio until some is planned, unlike the other sections', () => {
    const c = useCardioStore()
    expect(c.items).toEqual([])
    expect(c.dayCounts).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(c.goalsMet).toBe(0)
  })

  it('marks a day like an exercise: great, partial and missed in each drawing, then empty', () => {
    const c = useCardioStore()
    c.adopt({ plans: { [WEEK]: [CYCLING, RUNNING] }, log: {} })
    for (const mark of EXERCISE_CYCLE) {
      c.toggle('cy', 1)
      expect(c.markOf('cy', 1)).toBe(mark)
    }
    c.toggle('cy', 1)
    expect(c.markOf('cy', 1)).toBeNull()
    // In a symbol set, one press per kind.
    usePlannerStore().markSet = 'ticks'
    for (const mark of EXERCISE_KIND_CYCLE) {
      c.toggle('ru', 4)
      expect(c.markOf('ru', 4)).toBe(mark)
    }
  })

  it('counts every kind of mark towards the weekly goal', () => {
    const c = useCardioStore()
    c.adopt({
      plans: { [WEEK]: [CYCLING, RUNNING] },
      log: { [WEEK]: { cy: ['great', null, 'missed', null, null, null, null] } },
    })
    expect(c.totalFor('cy')).toBe(2)
    expect(c.totalFor('ru')).toBe(0)
    expect(c.dayCounts).toEqual([1, 0, 1, 0, 0, 0, 0])
    expect(c.goalsMet).toBe(1)
  })

  it('adds an item with a time, a distance, both or neither, and a goal of 3 by default', () => {
    const c = useCardioStore()
    expect(c.addCardio({ name: '  ' })).toBeNull()
    const ride = c.addCardio({ name: ' Cycling ', duration: 1800.4, target: 9 })!
    const run = c.addCardio({ name: 'Running', distance: 5.004 })!
    const swim = c.addCardio({ name: 'Swim', duration: 0, distance: -1 })!
    const far = c.addCardio({ name: 'Tour', duration: 999_999, distance: 5000, target: 2 })!
    expect(c.items).toEqual([
      { id: ride, name: 'Cycling', duration: 1800, target: 7 },
      { id: run, name: 'Running', distance: 5, target: 3 },
      { id: swim, name: 'Swim', target: 3 },
      { id: far, name: 'Tour', duration: 86_400, distance: 1000, target: 2 },
    ])
    // The week now has its own plan.
    expect(c.plans[WEEK]).toHaveLength(4)
  })

  it('changes an item this week, keeping its goal when none is given', () => {
    const c = useCardioStore()
    c.adopt({ plans: { '2026-10-12': [CYCLING, RUNNING] }, log: {} })
    expect(c.updateCardio('cy', { name: '', duration: 60 })).toBe(false)
    expect(c.updateCardio('nope', { name: 'Nope' })).toBe(false)
    expect(c.updateCardio('cy', { name: 'Long ride', distance: 40 })).toBe(true)
    expect(c.items[0]).toEqual({ id: 'cy', name: 'Long ride', distance: 40, target: 2 })
    expect(c.updateCardio('ru', { name: 'Running', duration: 1500, target: 4 })).toBe(true)
    expect(c.items[1]).toEqual({ id: 'ru', name: 'Running', duration: 1500, target: 4 })
    // The earlier week it carried forward from is left as it was.
    expect(c.plans['2026-10-12']).toEqual([CYCLING, RUNNING])
  })

  it('changes a goal within 0–7, and removes an item from this week only', () => {
    const c = useCardioStore()
    c.adopt({ plans: { '2026-10-12': [CYCLING] }, log: {} })
    c.changeTarget('cy', 9)
    expect(c.items[0]!.target).toBe(7)
    c.changeTarget('cy', -9)
    expect(c.items[0]!.target).toBe(0)
    c.changeTarget('nope', 1)
    c.removeCardio('cy')
    expect(c.items).toEqual([])
    expect(c.plans['2026-10-12']).toEqual([CYCLING])
  })

  it('follows the planner’s week, and adopts a week or clears', () => {
    const c = useCardioStore()
    c.adopt({ plans: { [WEEK]: [CYCLING] }, log: {} })
    const planner = usePlannerStore()
    planner.prevWeek()
    // A week before the first plan shows the earliest one.
    expect(c.items).toEqual([CYCLING])
    c.adoptWeek('2026-10-12', [RUNNING])
    expect(c.items).toEqual([RUNNING])
    c.clear()
    expect(c.plans).toEqual({})
    expect(c.log).toEqual({})
  })
})
