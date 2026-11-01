import { addDays, dateKey } from '@/lib/dates'
import { planSource, type Plans } from '@/lib/plans'
import type { Log, Mark } from '@/lib/storage'
import { goalMet, markOf, type Tracked } from '@/lib/tracker'
import { numberWord } from '@/lib/words'

/**
 * An item's recent weeks (RecentWeeks card): what the ItemPage shows of how it has gone, from the
 * log and each week's plan. Pure, so the page and its tests read the same thing.
 */

/** How many weeks the item page shows, ending with the week it was opened from. */
export const RECENT_WEEKS = 8

/** One week of an item: its Monday, its seven marks, and its goal (null when not planned). */
export type RecentWeek = {
  /** The week's Monday, `YYYY-MM-DD`. */
  week: string
  monday: Date
  /** Whether it is the real current week. */
  current: boolean
  /** Monday to Sunday; seven empty days when the week's plan didn't hold the item. */
  marks: (Mark | null)[]
  /** That week's goal, from the plan it shows; null when that plan didn't hold the item. */
  goal: number | null
}

/** A week key as its local Monday at midnight. */
export function weekMonday(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/**
 * The latest week whose own plan holds the item, and the item as that plan has it: what the item
 * page shows, read-only, for an item not in the week it was opened from. Null when no plan does.
 */
export function latestPlanWith<T extends Tracked>(
  plans: Plans<T>,
  id: string,
): { week: string; item: T } | null {
  // `YYYY-MM-DD` keys sort chronologically as strings.
  for (const week of Object.keys(plans).sort().reverse()) {
    const item = plans[week]!.find((it) => it.id === id)
    if (item) return { week, item }
  }
  return null
}

/**
 * The item's weeks, newest first: up to RECENT_WEEKS ending with `week`, and none before the first
 * plan that holds it (a newer item shows only the weeks since it appeared). Each week's goal comes
 * from the plan it shows (`planSource`), or `fallback` (the default items) when nothing is planned.
 */
export function itemHistory<T extends Tracked>({
  plans,
  log,
  id,
  week,
  currentWeek,
  fallback,
}: {
  plans: Plans<T>
  log: Log
  id: string
  week: string
  currentWeek: string
  fallback: readonly T[]
}): RecentWeek[] {
  const first = Object.keys(plans)
    .sort()
    .find((k) => plans[k]!.some((it) => it.id === id))
  const opened = weekMonday(week)
  const weeks: RecentWeek[] = []
  for (let i = 0; i < RECENT_WEEKS; i++) {
    const monday = addDays(opened, -7 * i)
    const key = dateKey(monday)
    if (first !== undefined && key < first) break
    const source = planSource(plans, key)
    const item = (source ? plans[source]! : fallback).find((it) => it.id === id)
    const days = log[key] ?? {}
    weeks.push({
      week: key,
      monday,
      current: key === currentWeek,
      marks: Array.from({ length: 7 }, (_, d) => (item ? markOf(days, id, d) : null)),
      goal: item ? item.target : null,
    })
  }
  return weeks
}

/** The days marked in a week: every kind of mark counts, as in the week. */
export function weekCount(week: RecentWeek): number {
  return week.marks.filter((m) => m !== null).length
}

/** Whether a week met its goal: a goal above 0 that its count reaches. */
export function weekMet(week: RecentWeek): boolean {
  return week.goal !== null && goalMet(weekCount(week), week.goal)
}

/**
 * The words of the line over the weeks, "three of the last eight weeks", counting the weeks shown.
 * Null when no week met its goal, or only one week shows: the counts already say it.
 */
export function metPhrase(weeks: readonly RecentWeek[]): string | null {
  const met = weeks.filter(weekMet).length
  if (met === 0 || weeks.length < 2) return null
  return `${numberWord(met)} of the last ${numberWord(weeks.length)} weeks`
}
