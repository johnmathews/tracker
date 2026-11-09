import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { planSource, type Plans } from '@/lib/plans'
import {
  defaultCardio,
  defaultExercises,
  defaultFoods,
  markKind,
  type DetailsMap,
  type Log,
  type Mark,
  type MarkKind,
} from '@/lib/storage'
import { dayCounts, goalMet, goalsMet, metDays, totalFor, type Tracked } from '@/lib/tracker'
import { SECTIONS, type Section } from '@/lib/trackerTypes'
import { usePlannerStore } from '@/stores/planner'
import { useCardioStore } from '@/stores/cardio'
import { useDietStore } from '@/stores/diet'
import { noDetails, useDetailsStore } from '@/stores/details'
import type { Cardio, Exercise, Food } from '@/lib/storage'

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
  /** The item's notes, from its details, the same in every week; "" when left out. */
  notes?: string
}

type InsightsCase = {
  description: string
  section: Section
  week: string
  today: string
  /** Exercises a day or foods a day; null for a section with none (cardio, K90). */
  dailyTarget: number | null
  plans: Plans<Tracked>
  log: Log
  /** The section's item details; none when left out. */
  details?: DetailsMap
  expected: {
    planWeek: string | null
    dayCounts: number[]
    metDays: boolean[]
    future: boolean[]
    /** Null with no daily target. */
    daysMet: number | null
    goalsMet: number
    items: ExpectedItem[]
  }
}

const CASES: [string, InsightsCase][] = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as InsightsCase])

const DEFAULTS: Record<Section, () => Tracked[]> = {
  exercise: defaultExercises,
  cardio: defaultCardio,
  diet: defaultFoods,
}

/** The days a target meets: none at all without one (cardio, K90). */
function metFor(counts: number[], target: number | null): boolean[] {
  return target === null ? counts.map(() => false) : metDays(counts, target)
}

/** A local-time date from `YYYY-MM-DD`, at noon so no clock change moves it to another day. */
function localDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 12)
}

function kindCount(days: (Mark | null)[], kind: MarkKind): number {
  return days.filter((m) => m !== null && markKind(m) === kind).length
}

/** The expected items with each one's notes spelt out, "" when the fixture leaves them out. */
function expectedItems(c: InsightsCase): Required<ExpectedItem>[] {
  return c.expected.items.map((it) => ({ ...it, notes: it.notes ?? '' }))
}

describe('insights fixtures', () => {
  it('finds the fixture files', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(13)
  })

  // The rules as src/lib holds them: planSource, the defaults, and the tracker helpers.
  it.each(CASES)('%s: the lib rules', (_, c) => {
    const planWeek = planSource(c.plans, c.week)
    expect(planWeek).toBe(c.expected.planWeek)
    const items: Tracked[] = planWeek !== null ? c.plans[planWeek]! : DEFAULTS[c.section]()
    const week = c.log[c.week] ?? {}

    const counts = dayCounts(items, week)
    expect(counts).toEqual(c.expected.dayCounts)
    const met = metFor(counts, c.dailyTarget)
    expect(met).toEqual(c.expected.metDays)
    expect(c.dailyTarget === null ? null : met.filter(Boolean).length).toBe(c.expected.daysMet)
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
          // An item's notes are its details', never a week's plan's.
          notes: c.details?.[it.id]?.notes ?? '',
        }
      }),
    ).toEqual(expectedItems(c))
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
      const cardio = useCardioStore()
      const diet = useDietStore()
      const empty = { plans: {}, log: {} }
      const data = { plans: c.plans, log: c.log }
      // Cardio has no daily target (K90): the settings keep their own.
      const pick = SECTIONS[c.section].pickKey
      planner.adopt(c.section === 'exercise' ? (data as never) : empty, {
        accent: '#30d158',
        dailyPick: 3,
        foodPick: 2,
        ...(pick ? { [pick]: c.dailyTarget } : {}),
      })
      if (c.section === 'cardio') cardio.adopt(data as never)
      if (c.section === 'diet') diet.adopt(data as never)
      const details = useDetailsStore()
      details.adopt({ ...noDetails(), [c.section]: c.details ?? {} })
      // Whole weeks between today's Monday and the case's, which a week offset steps through.
      const weeks = Math.round(
        (localDate(c.week).getTime() - localDate(planner.currentWeekKey).getTime()) /
          (7 * 24 * 3600 * 1000),
      )
      planner.weekOffset = weeks
      expect(planner.weekKey).toBe(c.week)

      const stores = {
        exercise: [planner.exercises, planner.dayCounts],
        cardio: [cardio.items, cardio.dayCounts],
        diet: [diet.foods, diet.dayCounts],
      } satisfies Record<Section, [(Exercise | Cardio | Food)[], number[]]>
      const [items, counts] = stores[c.section]
      expect(items.map((it) => it.id)).toEqual(c.expected.items.map((it) => it.id))
      // The note the row and the item page show is the one insights gives.
      expect(items.map((it) => details.notesOf(c.section, it.id))).toEqual(
        expectedItems(c).map((it) => it.notes),
      )
      expect(counts).toEqual(c.expected.dayCounts)
      expect(metFor(counts, pick && planner[pick])).toEqual(c.expected.metDays)
      expect(planner.days.map((d) => d.isFuture)).toEqual(c.expected.future)
    })
  })
})
