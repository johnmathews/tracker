import { DAY_NAMES } from '@/lib/dates'
import {
  MARKS,
  MARK_KINDS,
  markKind,
  type Days,
  type Log,
  type Mark,
  type MarkSet,
} from '@/lib/storage'

/** Anything tracked as a tick per day against a weekly goal: exercises and foods. */
export type Tracked = { id: string; name: string; target: number; notes?: string }

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

/**
 * The marks a press steps through, after an empty day and back to it (DayMark card, K17), drawing
 * first: an exercise goes great, partial and missed in the zigzag, then in the solid, then in the
 * hatch; a food is eaten or not, so it goes great in each drawing.
 */
export const EXERCISE_CYCLE: readonly Mark[] = MARKS
export const FOOD_CYCLE: readonly Mark[] = MARKS.filter((m) => markKind(m) === 'great')

/**
 * The cycles for a tick or face set (K21): one symbol per kind, so a press steps through the plain
 * kinds once, great, partial and missed for an exercise and great for a food.
 */
export const EXERCISE_KIND_CYCLE: readonly Mark[] = MARK_KINDS
export const FOOD_KIND_CYCLE: readonly Mark[] = ['great']

/** The cycle a press steps through for an exercise or a food, in the device's mark set. */
export function cycleFor(item: 'exercise' | 'food', set: MarkSet): readonly Mark[] {
  if (set === 'squiggles') return item === 'exercise' ? EXERCISE_CYCLE : FOOD_CYCLE
  return item === 'exercise' ? EXERCISE_KIND_CYCLE : FOOD_KIND_CYCLE
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
