import { describe, expect, it } from 'vitest'
import { reactive, watch } from 'vue'
import {
  dayCounts,
  goalMet,
  goalsMet,
  grandTotal,
  isDone,
  newId,
  cycleDay,
  cycleFor,
  EXERCISE_CYCLE,
  EXERCISE_KIND_CYCLE,
  FOOD_CYCLE,
  FOOD_KIND_CYCLE,
  markOf,
  metDays,
  nextMark,
  totalFor,
  type WeekLog,
} from '@/lib/tracker'
import {
  DRAWINGS,
  MARKS,
  MARK_KINDS,
  markDrawing,
  markKind,
  type Log,
  type Mark,
} from '@/lib/storage'

const items = [
  { id: 'a', name: 'A', target: 2 },
  { id: 'b', name: 'B', target: 0 },
  { id: 'c', name: 'C', target: 1 },
]
const week: WeekLog = {
  a: ['great', 'missed', null, null, null, null, null],
  b: ['great', null, null, null, null, null, null],
  gone: ['great', 'great', 'great', 'great', 'great', 'great', 'great'],
}

describe('tracker helpers', () => {
  it('reads single days and per-item totals, treating missing items as empty', () => {
    expect(markOf(week, 'a', 1)).toBe('missed')
    expect(markOf(week, 'c', 1)).toBeNull()
    // Every kind of mark counts, a missed day included.
    expect(isDone(week, 'a', 1)).toBe(true)
    expect(isDone(week, 'a', 2)).toBe(false)
    expect(isDone(week, 'c', 0)).toBe(false)
    expect(totalFor(week, 'a')).toBe(2)
    expect(totalFor(week, 'c')).toBe(0)
  })

  it('counts per day and in total over listed items only', () => {
    expect(dayCounts(items, week)).toEqual([2, 1, 0, 0, 0, 0, 0])
    expect(grandTotal(items, week)).toBe(3)
  })

  it('meets a goal only when it is above zero and reached', () => {
    expect(goalMet(2, 2)).toBe(true)
    expect(goalMet(3, 2)).toBe(true)
    expect(goalMet(1, 2)).toBe(false)
    expect(goalMet(1, 0)).toBe(false)
    expect(goalsMet(items, week)).toBe(1)
  })

  it('meets a day when its count reaches the day’s target (K30, K57)', () => {
    expect(metDays([0, 1, 2, 3, 4, 0, 2], 2)).toEqual([false, false, true, true, true, false, true])
    expect(metDays(dayCounts(items, week), 1)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(metDays([], 3)).toEqual([])
  })

  it('steps a day through its marks, creating the week and the days on first use', () => {
    const log: Log = {}
    cycleDay(log, '2026-10-19', 'a', 3, EXERCISE_CYCLE)
    expect(log).toEqual({ '2026-10-19': { a: [null, null, null, 'great', null, null, null] } })
    const seen = Array.from({ length: 9 }, () => {
      cycleDay(log, '2026-10-19', 'a', 3, EXERCISE_CYCLE)
      return log['2026-10-19']!.a![3]
    })
    expect(seen).toEqual([
      'partial',
      'missed',
      'great-solid',
      'partial-solid',
      'missed-solid',
      'great-hatch',
      'partial-hatch',
      'missed-hatch',
      null,
    ])
  })

  it('steps exercises through each drawing’s three kinds, and foods through green in each', () => {
    // Drawing first (K17): green, yellow and red in the zigzag, then the solid, then the hatch.
    expect(EXERCISE_CYCLE).toEqual(MARKS)
    expect(nextMark(null, EXERCISE_CYCLE)).toBe('great')
    expect(nextMark('missed', EXERCISE_CYCLE)).toBe('great-solid')
    expect(nextMark('missed-solid', EXERCISE_CYCLE)).toBe('great-hatch')
    expect(nextMark('missed-hatch', EXERCISE_CYCLE)).toBeNull()
    expect(FOOD_CYCLE).toEqual(['great', 'great-solid', 'great-hatch'])
    expect(nextMark(null, FOOD_CYCLE)).toBe('great')
    expect(nextMark('great', FOOD_CYCLE)).toBe('great-solid')
    expect(nextMark('great-hatch', FOOD_CYCLE)).toBeNull()
    // A food marked another way (an import, say) clears on the next press.
    expect(nextMark('partial', FOOD_CYCLE)).toBeNull()
  })

  it('steps a tick or face set through the plain kinds once (K21)', () => {
    expect(EXERCISE_KIND_CYCLE).toEqual(['great', 'partial', 'missed'])
    expect(FOOD_KIND_CYCLE).toEqual(['great'])
    expect(nextMark(null, EXERCISE_KIND_CYCLE)).toBe('great')
    expect(nextMark('great', EXERCISE_KIND_CYCLE)).toBe('partial')
    expect(nextMark('partial', EXERCISE_KIND_CYCLE)).toBe('missed')
    expect(nextMark('missed', EXERCISE_KIND_CYCLE)).toBeNull()
    expect(nextMark(null, FOOD_KIND_CYCLE)).toBe('great')
    expect(nextMark('great', FOOD_KIND_CYCLE)).toBeNull()
  })

  it('steps a squiggle drawing on from its kind in a symbol set', () => {
    expect(nextMark('great-solid', EXERCISE_KIND_CYCLE)).toBe('partial')
    expect(nextMark('partial-hatch', EXERCISE_KIND_CYCLE)).toBe('missed')
    expect(nextMark('missed-solid', EXERCISE_KIND_CYCLE)).toBeNull()
    expect(nextMark('great-hatch', FOOD_KIND_CYCLE)).toBeNull()
    expect(nextMark('partial', FOOD_KIND_CYCLE)).toBeNull()
  })

  it('picks the cycle for the item and the mark set', () => {
    expect(cycleFor('exercise', 'squiggles')).toBe(EXERCISE_CYCLE)
    expect(cycleFor('food', 'squiggles')).toBe(FOOD_CYCLE)
    for (const set of ['ticks', 'stamped-ticks', 'faces', 'stamped-faces'] as const) {
      expect(cycleFor('exercise', set)).toBe(EXERCISE_KIND_CYCLE)
      expect(cycleFor('food', set)).toBe(FOOD_KIND_CYCLE)
    }
  })

  it('reads a mark’s kind and drawing: a plain kind is the zigzag', () => {
    expect(MARKS.map((m) => [markKind(m), markDrawing(m)])).toEqual(
      DRAWINGS.flatMap((d) => MARK_KINDS.map((k) => [k, d])),
    )
    expect(markDrawing('partial')).toBe('zigzag')
    expect(markKind('missed-hatch')).toBe('missed')
  })

  it('makes distinct x-prefixed ids', () => {
    const a = newId()
    expect(a).toMatch(/^x[0-9a-z]+$/)
    expect(newId()).not.toBe(a)
  })
})

describe('cycleDay on a reactive log', () => {
  it('steps through the reactive proxy, so a watcher sees every change', () => {
    const log = reactive<Log>({})
    const seen: (Mark | null | undefined)[] = []
    watch(
      () => log['2026-10-19']?.pu?.[2],
      (v) => seen.push(v),
      { flush: 'sync' },
    )
    cycleDay(log, '2026-10-19', 'pu', 2, EXERCISE_CYCLE)
    cycleDay(log, '2026-10-19', 'pu', 2, EXERCISE_CYCLE)
    cycleDay(log, '2026-10-19', 'sq', 0, EXERCISE_CYCLE)
    // Creating the days is a change too (undefined → null), then each step.
    expect(seen).toEqual([null, 'great', 'partial'])
  })
})
