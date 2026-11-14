import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { usePlannerStore } from '@/stores/planner'
import {
  MAX_CARDIO_DURATION,
  MAX_DAILY_PICK,
  MAX_DURATION,
  MAX_SETS,
  MAX_TARGET,
  MIN_DAILY_PICK,
  MIN_TARGET,
  clamp,
  normaliseDistance,
  normaliseWeight,
  type Exercise,
  type Log,
  type Mark,
} from '@/lib/storage'
import { copyPlan, planSource, type Plans } from '@/lib/plans'
import * as tracker from '@/lib/tracker'
import {
  SECTIONS,
  TRACKER_TYPES,
  defaultItems,
  isSection,
  type Item,
  type TrackerType,
  type TrackerTypeId,
} from '@/lib/trackerTypes'
import {
  MAX_TRACKERS,
  inOrder,
  nextPosition,
  normaliseTrackerName,
  showsIn,
  type TrackerInfo,
} from '@/lib/trackers'

/** One tracker's plans and log, as the sync store fills and saves them. */
export type TrackerData = { plans: Plans<Item>; log: Log }

/**
 * What an Add or Edit form gives, for an item of any kind: a name and a weekly goal, and the
 * fields its kind records. A strength item reads sets, reps or a time, each side and a weight; a
 * cardio item a time and a distance; a food the name and goal alone. The rest are ignored.
 */
export type NewItem = {
  name: string
  /** The weekly goal; left out, an added item gets its kind's, and an edited one keeps its own. */
  target?: number
  sets?: number
  /** Reps per set; ignored when `duration` is set. */
  reps?: number
  /** Seconds per set for a timed exercise; a cardio item's whole time. */
  duration?: number
  perSide?: boolean
  weight?: number
  /** A cardio item's kilometres. */
  distance?: number
}

/** What the exercise form gives (src/composables/exerciseForm.ts). */
export type NewExercise = NewItem & { reps: number; perSide: boolean }

/** What the cardio form gives: a name, a time and a distance, and a goal. */
export type NewCardio = Pick<NewItem, 'name' | 'duration' | 'distance' | 'target'>

/**
 * A strength item's stored fields from form input. An exercise counts reps or time, never both:
 * a duration keeps reps at 0.
 */
function exerciseFields(input: NewItem, name: string): Omit<Exercise, 'id' | 'target'> {
  const duration =
    input.duration !== undefined && Number.isFinite(input.duration) && input.duration > 0
      ? Math.min(MAX_DURATION, Math.floor(input.duration))
      : 0
  const reps =
    !duration && input.reps !== undefined && Number.isFinite(input.reps) && input.reps > 0
      ? Math.floor(input.reps)
      : 0
  const sets = Math.min(MAX_SETS, Math.floor(input.sets ?? 0))
  const weight = normaliseWeight(input.weight)
  return {
    name,
    ...(sets > 0 ? { sets } : {}),
    reps,
    ...(duration ? { duration } : {}),
    perSide: input.perSide === true,
    ...(weight !== undefined ? { weight } : {}),
  }
}

/**
 * The item as stored for a tracker of `kind`, or null when the trimmed name is empty: a cardio
 * item's whole seconds and km within their limits, each left out when not set; a strength item's
 * fields as `exerciseFields` cleans them; a food's name and goal.
 */
function buildItem(kind: TrackerTypeId, id: string, input: NewItem, goal: number): Item | null {
  const name = input.name.trim()
  if (!name) return null
  const target = clamp(goal, MIN_TARGET, MAX_TARGET)
  if (kind === 'strength') return { id, ...exerciseFields(input, name), target }
  if (kind === 'food') return { id, name, target }
  const duration = Math.round(input.duration ?? 0)
  const distance = normaliseDistance(input.distance)
  return {
    id,
    name,
    ...(duration > 0 ? { duration: Math.min(MAX_CARDIO_DURATION, duration) } : {}),
    ...(distance !== undefined ? { distance } : {}),
    target,
  }
}

const NO_PLANS: Readonly<Plans<Item>> = Object.freeze({})
const NO_LOG: Readonly<Log> = Object.freeze({})

/**
 * The account's trackers (K123) and, per tracker, its plans and log, keyed by tracker id. The
 * visible week comes from the planner store, and each tracker's plans carry forward week to week
 * (`planSource`). The sync store fills it through `adopt` and saves its changes: a new tracker is a
 * `tracker-create` operation, a renamed one or a new daily target a `tracker-patch`, and an ended
 * one a `tracker-end` (docs/architecture.md §7).
 *
 * A tracker is never removed: Delete tracker ends it from the week on screen (K122), and earlier
 * weeks still show it, with its items. Items' notes and fields are the details store's.
 */
export const useTrackersStore = defineStore('trackers', () => {
  const planner = usePlannerStore()
  /** Every tracker of the account, ended ones included, as adopted. */
  const list = ref<TrackerInfo[]>([])
  /** Each tracker's plans and log by tracker id; a tracker with neither may have no entry. */
  const data = ref<Record<string, TrackerData>>({})

  /** Every tracker in the week's order: by position, then by id. */
  const ordered = computed(() => inOrder(list.value))
  /** The trackers the visible week shows (spec §2), in the week's order. */
  const shown = computed(() => ordered.value.filter((t) => showsIn(t, planner.weekKey)))

  function get(id: string): TrackerInfo | undefined {
    return list.value.find((t) => t.id === id)
  }

  /** Whether the account has the tracker, ended or not. */
  function has(id: string): boolean {
    return get(id) !== undefined
  }

  /**
   * A tracker's kind. An id the store doesn't hold (only while a page that named it closes) reads
   * as its fixed kind when it is one of the first three, and as strength otherwise.
   */
  function kindOf(id: string): TrackerTypeId {
    return get(id)?.kind ?? (isSection(id) ? SECTIONS[id].id : 'strength')
  }

  /** A tracker's kind's registry entry: its labels, fields, chips and marks. */
  function typeOf(id: string): TrackerType {
    return TRACKER_TYPES[kindOf(id)]
  }

  function plansOf(id: string): Plans<Item> {
    return data.value[id]?.plans ?? NO_PLANS
  }

  function logOf(id: string): Log {
    return data.value[id]?.log ?? NO_LOG
  }

  function weekOf(id: string): tracker.WeekLog {
    return logOf(id)[planner.weekKey] ?? {}
  }

  /**
   * The visible week's items: its own plan, the one it carries forward, or, with no plan at all,
   * the default items (on the `exercise` and `diet` trackers only, spec §4).
   */
  function itemsOf(id: string): Item[] {
    const plans = plansOf(id)
    const week = planSource(plans, planner.weekKey)
    return week ? plans[week]! : defaultItems(id)
  }

  function markOf(id: string, item: string, day: number): Mark | null {
    return tracker.markOf(weekOf(id), item, day)
  }

  function isDone(id: string, item: string, day: number): boolean {
    return tracker.isDone(weekOf(id), item, day)
  }

  function totalFor(id: string, item: string): number {
    return tracker.totalFor(weekOf(id), item)
  }

  /** How many of the week's items are marked on each day. */
  function dayCounts(id: string): number[] {
    return tracker.dayCounts(itemsOf(id), weekOf(id))
  }

  function grandTotal(id: string): number {
    return tracker.grandTotal(itemsOf(id), weekOf(id))
  }

  function goalsMet(id: string): number {
    return tracker.goalsMet(itemsOf(id), weekOf(id))
  }

  /**
   * How many items a day make a met day; null for a kind with none (cardio). A tracker not loaded
   * yet reads as its kind's default (`kindOf`), so the first trackers' Steppers always have one.
   */
  function dailyTarget(id: string): number | null {
    const t = get(id)
    return t ? t.dailyTarget : typeOf(id).dailyTarget
  }

  /** The tracker's data, created on first use; read back through the reactive map. */
  function ensure(id: string): TrackerData {
    if (!data.value[id]) data.value[id] = { plans: {}, log: {} }
    return data.value[id]!
  }

  // Any change to a week, marks included, gives it its own plan, so later edits to the week it was
  // carried from no longer move it.
  /** The visible week's own plan, copied from what it shows on its first change. */
  function own(id: string): Item[] {
    const plans = ensure(id).plans
    if (!plans[planner.weekKey]) plans[planner.weekKey] = copyPlan(itemsOf(id))
    return plans[planner.weekKey]!
  }

  /**
   * Steps the day to its next mark in the kind's cycle: great, partial and missed in each drawing
   * for strength and cardio, eaten in each drawing for food, then empty; in a tick or face set,
   * the kinds once (K21).
   */
  function toggle(id: string, item: string, day: number): void {
    own(id)
    const cycle = tracker.cycleFor(kindOf(id), planner.markSet)
    tracker.cycleDay(ensure(id).log, planner.weekKey, item, day, cycle)
  }

  function changeTarget(id: string, item: string, delta: number): void {
    const it = own(id).find((x) => x.id === item)
    if (it) it.target = clamp(it.target + delta, MIN_TARGET, MAX_TARGET)
  }

  /**
   * Adds an item to the tracker this week, cleaned for its kind; returns its id, or null (and adds
   * nothing) when the trimmed name is empty. Its notes are its details (the details store), not
   * the week's.
   */
  function addItem(id: string, input: NewItem): string | null {
    const itemId = tracker.newId()
    const it = buildItem(kindOf(id), itemId, input, input.target ?? typeOf(id).newTarget)
    if (!it) return null
    own(id).push(it)
    return itemId
  }

  /**
   * Replaces the item's fields this week, keeping its id and history; the goal stays as it is
   * when the input leaves it out. False for an empty name or an item not in the week.
   */
  function updateItem(id: string, item: string, input: NewItem): boolean {
    const current = itemsOf(id).find((it) => it.id === item)
    if (!current) return false
    const next = buildItem(kindOf(id), item, input, input.target ?? current.target)
    if (!next) return false
    const items = own(id)
    items[items.findIndex((it) => it.id === item)] = next
    return true
  }

  /** Removes the item from this week; its log history stays in storage. */
  function removeItem(id: string, item: string): void {
    const kept = own(id).filter((it) => it.id !== item)
    ensure(id).plans[planner.weekKey] = kept
  }

  /**
   * Sets a tracker's daily target, clamped to 1–8 (K30, K57). False for a kind with none (cardio)
   * or a tracker not here.
   */
  function setDailyTarget(id: string, target: number): boolean {
    const t = get(id)
    if (!t || TRACKER_TYPES[t.kind].dailyTarget === null) return false
    t.dailyTarget = clamp(Math.round(target), MIN_DAILY_PICK, MAX_DAILY_PICK)
    return true
  }

  function changeDailyTarget(id: string, delta: number): boolean {
    const current = dailyTarget(id)
    return current !== null && setDailyTarget(id, current + delta)
  }

  /**
   * Adds a tracker after every other, empty, with its kind's daily target, starting in the week
   * on screen (K124). Returns its id, made here (`newId`) so a create sent again is safe, or null
   * (and adds nothing) for a blank name or an account at MAX_TRACKERS.
   */
  function createTracker(input: { name: string; kind: TrackerTypeId }): string | null {
    const name = normaliseTrackerName(input.name)
    if (name === null || list.value.length >= MAX_TRACKERS) return null
    const id = tracker.newId()
    list.value.push({
      id,
      name,
      kind: input.kind,
      position: nextPosition(list.value),
      dailyTarget: TRACKER_TYPES[input.kind].dailyTarget,
      startWeek: planner.weekKey,
      endWeek: null,
    })
    data.value[id] = { plans: {}, log: {} }
    return id
  }

  /** Renames a tracker (trimmed, at most 60 characters). False for a blank name or no tracker. */
  function renameTracker(id: string, name: string): boolean {
    const t = get(id)
    const next = normaliseTrackerName(name)
    if (!t || next === null) return false
    t.name = next
    return true
  }

  /**
   * Delete tracker (K122): ends the tracker from the week on screen, whichever it is. Its plans,
   * marks and notes stay, and earlier weeks still show it. An earlier end stays. False for a
   * tracker not here.
   */
  function endTracker(id: string): boolean {
    const t = get(id)
    if (!t) return false
    const week = planner.weekKey
    if (t.endWeek === null || week < t.endWeek) t.endWeek = week
    return true
  }

  /** Replace the trackers and their data wholesale: from the cache, the server, or another tab. */
  function adopt(trackers: TrackerInfo[], sections: Record<string, TrackerData>): void {
    list.value = trackers
    data.value = sections
  }

  /** Replace one week of a tracker's plan, e.g. with the server's copy after a conflict. */
  function adoptWeek(id: string, week: string, items: Item[]): void {
    ensure(id).plans[week] = items
  }

  /** Replace one tracker, or add it, e.g. with the server's copy after a write. */
  function adoptTracker(next: TrackerInfo): void {
    const i = list.value.findIndex((t) => t.id === next.id)
    if (i < 0) list.value.push(next)
    else list.value[i] = next
  }

  function clear(): void {
    adopt([], {})
  }

  return {
    list,
    data,
    ordered,
    shown,
    get,
    has,
    kindOf,
    typeOf,
    plansOf,
    logOf,
    itemsOf,
    markOf,
    isDone,
    totalFor,
    dayCounts,
    grandTotal,
    goalsMet,
    dailyTarget,
    toggle,
    changeTarget,
    addItem,
    updateItem,
    removeItem,
    setDailyTarget,
    changeDailyTarget,
    createTracker,
    renameTracker,
    endTracker,
    adopt,
    adoptWeek,
    adoptTracker,
    clear,
  }
})
