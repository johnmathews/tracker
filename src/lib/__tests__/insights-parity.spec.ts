import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { planSource, type Plans } from '@/lib/plans'
import {
  defaultExercises,
  defaultFoods,
  markKind,
  type Log,
  type Mark,
  type MarkKind,
} from '@/lib/storage'
import { dayCounts, goalMet, goalsMet, metDays, totalFor, type Tracked } from '@/lib/tracker'
import { usePlannerStore } from '@/stores/planner'
import { useDietStore } from '@/stores/diet'
import type { Exercise, Food } from '@/lib/storage'

// The shared contract with the API's insights module: what a week shows, as the screen shows it.
// api/tests/test_insights.py runs the same files through tracker_api.insights.
const FIXTURES = join(import.meta.dirname, '../../../fixtures/insights')

type ExpectedItem = {
  id: string
  name: string
  target: number
  done: number
  great: number
  partial: number
  missed: number
  goalMet: boolean
}

type InsightsCase = {
  description: string
  section: 'exercise' | 'diet'
  week: string
  today: string
  dailyTarget: number
  plans: Plans<Tracked>
  log: Log
  expected: {
    planWeek: string | null
    dayCounts: number[]
    metDays: boolean[]
    future: boolean[]
    daysMet: number
    goalsMet: number
    items: ExpectedItem[]
  }
}

const CASES: [string, InsightsCase][] = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as InsightsCase])

/** A local-time date from `YYYY-MM-DD`, at noon so no clock change moves it to another day. */
function localDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 12)
}

function kindCount(days: (Mark | null)[], kind: MarkKind): number {
  return days.filter((m) => m !== null && markKind(m) === kind).length
}

describe('insights fixtures', () => {
  it('finds the fixture files', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(11)
  })

  // The rules as src/lib holds them: planSource, the defaults, and the tracker helpers.
  it.each(CASES)('%s: the lib rules', (_, c) => {
    const planWeek = planSource(c.plans, c.week)
    expect(planWeek).toBe(c.expected.planWeek)
    const defaults = c.section === 'exercise' ? defaultExercises() : defaultFoods()
    const items: Tracked[] = planWeek !== null ? c.plans[planWeek]! : defaults
    const week = c.log[c.week] ?? {}

    const counts = dayCounts(items, week)
    expect(counts).toEqual(c.expected.dayCounts)
    const met = metDays(counts, c.dailyTarget)
    expect(met).toEqual(c.expected.metDays)
    expect(met.filter(Boolean).length).toBe(c.expected.daysMet)
    expect(goalsMet(items, week)).toBe(c.expected.goalsMet)
    expect(
      items.map((it) => {
        const days = week[it.id] ?? []
        const done = totalFor(week, it.id)
        return {
          id: it.id,
          name: it.name,
          target: it.target,
          done,
          great: kindCount(days, 'great'),
          partial: kindCount(days, 'partial'),
          missed: kindCount(days, 'missed'),
          goalMet: goalMet(done, it.target),
        }
      }),
    ).toEqual(c.expected.items)
  })

  describe('through the stores', () => {
    beforeEach(() => {
      localStorage.clear()
      setActivePinia(createPinia())
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    // The screen's own path: the store picks the items and counts the days, and says which are
    // still to come against its clock.
    it.each(CASES)('%s: the week on screen', (_, c) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(localDate(c.today))
      const planner = usePlannerStore()
      const diet = useDietStore()
      const empty = { plans: {}, log: {} }
      const data = { plans: c.plans, log: c.log }
      const pick = c.section === 'exercise' ? 'dailyPick' : 'foodPick'
      planner.adopt(c.section === 'exercise' ? (data as never) : empty, {
        accent: '#30d158',
        dailyPick: 3,
        foodPick: 2,
        [pick]: c.dailyTarget,
      })
      if (c.section === 'diet') diet.adopt(data as never)
      // Whole weeks between today's Monday and the case's, which a week offset steps through.
      const weeks = Math.round(
        (localDate(c.week).getTime() - localDate(planner.currentWeekKey).getTime()) /
          (7 * 24 * 3600 * 1000),
      )
      planner.weekOffset = weeks
      expect(planner.weekKey).toBe(c.week)

      const items: (Exercise | Food)[] = c.section === 'exercise' ? planner.exercises : diet.foods
      const counts = c.section === 'exercise' ? planner.dayCounts : diet.dayCounts
      expect(items.map((it) => it.id)).toEqual(c.expected.items.map((it) => it.id))
      expect(counts).toEqual(c.expected.dayCounts)
      expect(
        metDays(counts, c.section === 'exercise' ? planner.dailyPick : planner.foodPick),
      ).toEqual(c.expected.metDays)
      expect(planner.days.map((d) => d.isFuture)).toEqual(c.expected.future)
    })
  })
})
