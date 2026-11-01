import { describe, expect, it } from 'vitest'
import {
  RECENT_WEEKS,
  itemHistory,
  latestPlanWith,
  metPhrase,
  weekCount,
  weekMet,
  weekMonday,
  type RecentWeek,
} from '@/lib/history'
import type { Plans } from '@/lib/plans'
import type { Log } from '@/lib/storage'
import type { Tracked } from '@/lib/tracker'

const G = 'great'
const P = 'partial'
const M = 'missed'
const _ = null

/** Kettlebell swings, planned from 7 September with a goal of 3; not in the 21 September plan. */
const KS: Tracked = { id: 'ks', name: 'Kettlebell swings', target: 3 }
const PU: Tracked = { id: 'pu', name: 'Push-ups', target: 4 }
const PLANS: Plans<Tracked> = {
  '2026-09-07': [KS, PU],
  '2026-09-21': [PU],
  '2026-09-28': [{ ...KS, target: 2 }, PU],
  '2026-10-12': [{ ...KS, target: 0 }, PU],
  '2026-10-19': [KS, PU],
}
const LOG: Log = {
  '2026-10-26': { ks: [G, _, G, _, _, _, _] },
  '2026-10-19': { ks: [G, _, P, _, G, _, _] },
  '2026-10-12': { ks: [_, G, _, _, M, _, _] },
  '2026-10-05': { ks: [G, _, _, M, _, _, _] },
  '2026-09-28': { ks: [_, G, _, G, _, G, _] },
  // Marks in a week whose plan didn't hold it: the week reads "Not planned", seven empty boxes.
  '2026-09-21': { ks: [G, G, _, _, _, _, _] },
  '2026-09-14': { ks: [G, _, G, _, _, G, _] },
  '2026-09-07': { ks: [_, P, _, _, G, _, _] },
}

function history(id = 'ks', week = '2026-10-26', fallback: Tracked[] = []): RecentWeek[] {
  return itemHistory({
    plans: PLANS,
    log: LOG,
    id,
    week,
    currentWeek: '2026-10-26',
    fallback,
  })
}

describe('weekMonday', () => {
  it('reads a week key as its local Monday', () => {
    const d = weekMonday('2026-10-19')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 19, 0])
  })
})

describe('latestPlanWith', () => {
  it('finds the latest week whose own plan holds the item, and that plan’s copy', () => {
    expect(latestPlanWith(PLANS, 'ks')).toEqual({ week: '2026-10-19', item: KS })
    const removed = { ...PLANS, '2026-10-26': [PU] }
    expect(latestPlanWith(removed, 'ks')).toEqual({ week: '2026-10-19', item: KS })
  })

  it('is null for an item no plan holds', () => {
    expect(latestPlanWith(PLANS, 'nope')).toBeNull()
    expect(latestPlanWith({}, 'ks')).toBeNull()
  })
})

describe('itemHistory', () => {
  it('gives eight weeks ending with the opened week, newest first', () => {
    const weeks = history()
    expect(RECENT_WEEKS).toBe(8)
    expect(weeks.map((w) => w.week)).toEqual([
      '2026-10-26',
      '2026-10-19',
      '2026-10-12',
      '2026-10-05',
      '2026-09-28',
      '2026-09-21',
      '2026-09-14',
      '2026-09-07',
    ])
    expect(weeks.map((w) => w.current)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(weeks[1]!.monday.getDate()).toBe(19)
  })

  it('takes each week’s marks from the log and its goal from the plan it shows', () => {
    const weeks = history()
    // 26 October carries 19 October's plan forward; 5 October carries 28 September's.
    expect(weeks.map((w) => w.goal)).toEqual([3, 3, 0, 2, 2, null, 3, 3])
    expect(weeks[0]!.marks).toEqual([G, _, G, _, _, _, _])
    expect(weeks[2]!.marks).toEqual([_, G, _, _, M, _, _])
    // Not in that week's plan: no goal and seven empty boxes, whatever the log holds.
    expect(weeks[5]!.marks).toEqual([_, _, _, _, _, _, _])
  })

  it('shows a week with no log as seven empty boxes', () => {
    const weeks = itemHistory({
      plans: PLANS,
      log: {},
      id: 'pu',
      week: '2026-10-19',
      currentWeek: '2026-10-26',
      fallback: [],
    })
    expect(weeks[0]!.marks).toEqual([_, _, _, _, _, _, _])
    expect(weeks[0]!.current).toBe(false)
  })

  it('shows only the weeks since the item first appeared in a plan', () => {
    const plans = { '2026-10-12': [PU], '2026-10-19': [KS, PU] }
    const weeks = itemHistory({
      plans,
      log: LOG,
      id: 'ks',
      week: '2026-10-26',
      currentWeek: '2026-10-26',
      fallback: [],
    })
    expect(weeks.map((w) => w.week)).toEqual(['2026-10-26', '2026-10-19'])
  })

  it('reads the default plan when no week has a plan of its own', () => {
    const weeks = itemHistory({
      plans: {},
      log: {},
      id: 'pu',
      week: '2026-10-26',
      currentWeek: '2026-10-26',
      fallback: [PU],
    })
    expect(weeks).toHaveLength(8)
    expect(weeks.every((w) => w.goal === 4)).toBe(true)
  })
})

describe('a week’s count and whether it met its goal', () => {
  it('counts every kind of mark, and meets a goal above 0 that the count reaches', () => {
    const [now, w19, w12, w05, , w21] = history()
    expect([now, w19, w12, w05, w21].map((w) => weekCount(w!))).toEqual([2, 3, 2, 2, 0])
    expect(weekMet(now!)).toBe(false)
    expect(weekMet(w19!)).toBe(true)
    // A goal of 0 is never met; a week not planned isn't either.
    expect(weekMet(w12!)).toBe(false)
    expect(weekMet(w05!)).toBe(true)
    expect(weekMet(w21!)).toBe(false)
  })
})

describe('metPhrase', () => {
  it('says how many of the weeks shown met their goal, in words', () => {
    expect(metPhrase(history())).toBe('four of the last eight weeks')
  })

  it('is null when no week met its goal, or only one week shows', () => {
    const weeks = history()
    expect(metPhrase(weeks.filter((w) => !weekMet(w)))).toBeNull()
    expect(metPhrase(weeks.slice(1, 2))).toBeNull()
    expect(metPhrase(weeks.slice(0, 2))).toBe('one of the last two weeks')
  })
})
