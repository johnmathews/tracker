import { DAY_NAMES } from '@/lib/dates'
import { markKind, type Days, type Log, type Mark, type MarkSet } from '@/lib/storage'
import { TRACKER_TYPES, type TrackerTypeId } from '@/lib/trackerTypes'

/**
 * Anything tracked as a tick per day against a weekly goal: exercises and foods. Its notes are its
 * details, one copy for every week (src/stores/details.ts), not part of a week's plan.
 */
export type Tracked = { id: string; name: string; target: number }

/** One week of a log: item id → its days Mon–Sun. */
export type WeekLog = Record<string, Days>

export function markOf(week: WeekLog, id: string, day: number): Mark | null {
  return week[id]?.[day] ?? null
}

/** Any mark counts as done: a partial day and a day tried and missed count towards the goal. */
export function isDone(week: WeekLog, id: string, day: number): boolean {
  return markOf(week, id, day) !== null
}

export function totalFor(week: WeekLog, id: string): number {
  return (week[id] ?? []).filter((m) => m !== null).length
}

/** How many of `items` are ticked on each day. Log entries for removed items don't count. */
export function dayCounts(items: Tracked[], week: WeekLog): number[] {
  return DAY_NAMES.map((_, i) => items.filter((it) => isDone(week, it.id, i)).length)
}

export function grandTotal(items: Tracked[], week: WeekLog): number {
  return items.reduce((sum, it) => sum + totalFor(week, it.id), 0)
}

export function goalMet(total: number, target: number): boolean {
  return target > 0 && total >= target
}

export function goalsMet(items: Tracked[], week: WeekLog): number {
  return items.filter((it) => goalMet(totalFor(week, it.id), it.target)).length
}

/**
 * The days whose marked items reach the day's target: exercises a day (K30) or foods a day (K57).
 * A met day's name turns green, underlined (K60). The API's insights module counts the same way.
 */
export function metDays(counts: number[], target: number): boolean[] {
  return counts.map((n) => n >= target)
}

// The cycles live with their types; they are named here too, where the week's logic reads them.
export {
  EXERCISE_CYCLE,
  EXERCISE_KIND_CYCLE,
  FOOD_CYCLE,
  FOOD_KIND_CYCLE,
} from '@/lib/trackerTypes'

/** The cycle a press steps through for an item of a type, in the device's mark set. */
export function cycleFor(type: TrackerTypeId, set: MarkSet): readonly Mark[] {
  return TRACKER_TYPES[type].cycle(set)
}

/**
 * The mark after `mark` in `cycle`, and empty after the last. A mark the cycle doesn't hold (a
 * squiggle drawing, in a symbol set) steps on from its kind, so `great-solid` goes to `partial`;
 * one whose kind isn't there either goes to empty.
 */
export function nextMark(mark: Mark | null, cycle: readonly Mark[]): Mark | null {
  if (mark === null) return cycle[0]!
  const at = cycle.indexOf(mark)
  const i = at >= 0 ? at : cycle.indexOf(markKind(mark))
  return i >= 0 && i < cycle.length - 1 ? cycle[i + 1]! : null
}

/** Step one day to its next mark in place, creating the week and the item's days on first use. */
export function cycleDay(
  log: Log,
  weekKey: string,
  id: string,
  day: number,
  cycle: readonly Mark[],
): void {
  // Read each level back through `log` rather than keeping the `??=` result: on a reactive log
  // that result is the raw object, and a change made to it would notify no watcher.
  log[weekKey] ??= {}
  const week = log[weekKey]!
  week[id] ??= Array<Mark | null>(7).fill(null)
  const days = week[id]!
  days[day] = nextMark(days[day] ?? null, cycle)
}

export function newId(): string {
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
