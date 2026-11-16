import {
  DEFAULT_SETTINGS,
  MARKS,
  MARK_KINDS,
  NEW_CARDIO_TARGET,
  NEW_EXERCISE_TARGET,
  NEW_FOOD_TARGET,
  defaultExercises,
  defaultFoods,
  markDrawing,
  markKind,
  normaliseCardio,
  normaliseExercise,
  normaliseFood,
  normaliseMobility,
  type Cardio,
  type Exercise,
  type Food,
  type Mark,
  type MarkSet,
  type PortableSettings,
} from '@/lib/storage'
import type { Tracked } from '@/lib/tracker'
import { durationText } from '@/lib/words'

/**
 * Tracker kinds (docs/architecture.md §1, K123): what a tracker records, and what follows from it.
 * A kind is code; a tracker is data, each account's own (src/lib/trackers.ts), with an id, a name
 * and a kind. The first three trackers keep the old section names as their ids (`exercise`,
 * `cardio`, `diet`: in URLs, the database, the cache and the outbox). `api/src/tracker_api/types.py`
 * holds the same registry, and `fixtures/types/registry.json` keeps the two in step.
 */

/** A kind's id. `strength` was `exercise` before trackers were the account's own (K123). */
export type TrackerTypeId = 'strength' | 'cardio' | 'food' | 'mobility'

/** A plan item of any kind. */
export type Item = Exercise | Cardio | Food

/** The settings that hold a daily target: how many items a day count as a met day (K30, K57). */
export type PickKey = Extract<keyof PortableSettings, 'dailyPick' | 'foodPick'>

/**
 * The plan fields an item of the kind has (PlanFields.vue): an exercise's sets, then reps or time,
 * each side and weight; cardio's time and distance; or a food's Times a week alone.
 */
export type PlanKind = 'exercise' | 'cardio' | 'food'

/** A text field on the item page, by its stored key and the label it shows. */
export type ItemField = { key: string; label: string }

export type TrackerType = {
  id: TrackerTypeId
  /** The kind's name, as the new tracker page's Kind control says it: "Strength" (K124). */
  label: string
  /** What an item of the kind records: the new tracker page's line under Kind (K128). */
  settings: string
  /** One item, as the grid's row header says it: "Exercise". */
  itemLabel: string
  /** Items in the plural, for the daily target's Stepper: "Exercises a day" (K63). */
  itemsLabel: string
  /** Edit plan's Add button and the new item page's Add: "Add exercise" (K104, K113). */
  addLabel: string
  /** The plan fields its items have. */
  plan: PlanKind
  /** Whether an item with an exercise's plan has a weight: mobility's has none (W8). */
  weighted: boolean
  /** The marks a press steps through in the device's mark set. */
  cycle: (set: MarkSet) => readonly Mark[]
  /** The chips under an item's name; none for a type without them. */
  details: (item: Tracked) => string[]
  /** The item page's fields, in order. */
  fields: readonly ItemField[]
  /**
   * The setting the first tracker of the kind keeps its daily target in, beside the tracker (K30,
   * K57); null for cardio, which has no daily target (K90), and for mobility, whose trackers keep
   * theirs only on the tracker.
   */
  pickKey: PickKey | null
  /** The weekly goal an added item starts with. */
  newTarget: number
  /** The daily target a new tracker of this kind starts with; null for a kind with none. */
  dailyTarget: number | null
  /** A stored plan item of this kind, cleaned as the API cleans it; null when it isn't one. */
  normalise: (item: unknown) => Item | null
}

/**
 * The marks a press steps through in the squiggles, after an empty day and back to it (DayMark
 * card, K17, K141), drawing first: an exercise goes great, partial and missed in the zigzag, then
 * in the hatch; a food is eaten or not, so it goes great in each drawing.
 */
export const EXERCISE_CYCLE: readonly Mark[] = MARKS.filter((m) => markDrawing(m) !== 'solid')
export const FOOD_CYCLE: readonly Mark[] = EXERCISE_CYCLE.filter((m) => markKind(m) === 'great')

/** The Filled in set's (K141): the solid fill alone, great, partial and missed, or great for a food. */
export const EXERCISE_FILLED_CYCLE: readonly Mark[] = MARKS.filter(
  (m) => markDrawing(m) === 'solid',
)
export const FOOD_FILLED_CYCLE: readonly Mark[] = ['great-solid']

/** The cycle a set gives an exercise (strength, cardio, mobility) or a food. */
function exerciseCycle(set: MarkSet): readonly Mark[] {
  if (set === 'squiggles') return EXERCISE_CYCLE
  return set === 'filled' ? EXERCISE_FILLED_CYCLE : EXERCISE_KIND_CYCLE
}
function foodCycle(set: MarkSet): readonly Mark[] {
  if (set === 'squiggles') return FOOD_CYCLE
  return set === 'filled' ? FOOD_FILLED_CYCLE : FOOD_KIND_CYCLE
}

/**
 * The cycles for a tick or face set (K21): one symbol per kind, so a press steps through the plain
 * kinds once, great, partial and missed for an exercise and great for a food.
 */
export const EXERCISE_KIND_CYCLE: readonly Mark[] = MARK_KINDS
export const FOOD_KIND_CYCLE: readonly Mark[] = ['great']

/**
 * The chips under a cardio item's name (K90): its time, "30 min" or "1 min 30 s" as an exercise's,
 * then its distance, "5 km". None for neither.
 */
export function cardioDetails(c: Cardio): string[] {
  const chips: string[] = []
  if (c.duration) chips.push(durationText(c.duration))
  if (c.distance) chips.push(`${c.distance} km`)
  return chips
}

/**
 * The chips under an exercise name, in the Chip card's words: "3 × 12" or "3 × 8 each side" with
 * sets, "10 reps a set" or "8 each side" without, "3 sets" without reps, then "16 kg" when
 * weighted. None at all when it has none of these (no dash).
 */
export function exerciseDetails(e: Exercise): string[] {
  const chips: string[] = []
  const side = e.perSide ? ' each side' : ''
  if (e.duration) {
    const time = durationText(e.duration)
    chips.push(e.sets ? `${e.sets} × ${time}${side}` : `${time}${side}`)
  } else if (e.reps && e.sets) chips.push(`${e.sets} × ${e.reps}${side}`)
  else if (e.reps) chips.push(e.perSide ? `${e.reps} each side` : `${e.reps} reps a set`)
  else if (e.sets) chips.push(`${e.sets} sets`)
  if (e.weight) chips.push(`${e.weight} kg`)
  return chips
}

export const TRACKER_TYPES: Readonly<Record<TrackerTypeId, TrackerType>> = {
  strength: {
    id: 'strength',
    label: 'Strength',
    settings: 'Log sets, reps, time and weight.',
    itemLabel: 'Exercise',
    itemsLabel: 'Exercises',
    addLabel: 'Add exercise',
    plan: 'exercise',
    weighted: true,
    cycle: exerciseCycle,
    // An exercise section holds only exercises.
    details: (item) => exerciseDetails(item as Exercise),
    fields: [
      { key: 'equipment', label: 'Equipment' },
      { key: 'works', label: 'Works' },
      { key: 'link', label: 'Link' },
    ],
    pickKey: 'dailyPick',
    newTarget: NEW_EXERCISE_TARGET,
    dailyTarget: DEFAULT_SETTINGS.dailyPick,
    normalise: normaliseExercise,
  },
  cardio: {
    id: 'cardio',
    label: 'Cardio',
    settings: 'Log time and distance.',
    itemLabel: 'Cardio',
    itemsLabel: 'Cardio',
    addLabel: 'Add cardio',
    plan: 'cardio',
    weighted: false,
    // Marked like an exercise: done well, in part, or too difficult (K90).
    cycle: exerciseCycle,
    details: (item) => cardioDetails(item as Cardio),
    fields: [
      { key: 'route', label: 'Route' },
      { key: 'link', label: 'Link' },
    ],
    pickKey: null,
    newTarget: NEW_CARDIO_TARGET,
    dailyTarget: null,
    normalise: normaliseCardio,
  },
  food: {
    id: 'food',
    label: 'Food',
    settings: 'Log portions.',
    itemLabel: 'Food',
    itemsLabel: 'Foods',
    addLabel: 'Add food',
    plan: 'food',
    weighted: false,
    cycle: foodCycle,
    details: () => [],
    fields: [
      { key: 'serving', label: 'A serving' },
      { key: 'examples', label: 'Examples' },
    ],
    pickKey: 'foodPick',
    newTarget: NEW_FOOD_TARGET,
    dailyTarget: DEFAULT_SETTINGS.foodPick,
    normalise: normaliseFood,
  },
  // Stretches, holds and drills (K123): an exercise's sets, then reps or a hold time, each side if
  // you like, and no weight; marked as an exercise is, with a daily target of its own.
  mobility: {
    id: 'mobility',
    label: 'Mobility',
    settings: 'Log sets, reps or hold time, each side.',
    itemLabel: 'Exercise',
    itemsLabel: 'Exercises',
    addLabel: 'Add exercise',
    plan: 'exercise',
    weighted: false,
    cycle: exerciseCycle,
    details: (item) => exerciseDetails(item as Exercise),
    fields: [
      { key: 'equipment', label: 'Equipment' },
      { key: 'works', label: 'Works' },
      { key: 'link', label: 'Link' },
    ],
    pickKey: null,
    newTarget: NEW_EXERCISE_TARGET,
    dailyTarget: DEFAULT_SETTINGS.dailyPick,
    normalise: normaliseMobility,
  },
}

/** The kinds, in the registry's order. */
export const TRACKER_KINDS = Object.keys(TRACKER_TYPES) as readonly TrackerTypeId[]

export function isTrackerKind(v: unknown): v is TrackerTypeId {
  return typeof v === 'string' && Object.hasOwn(TRACKER_TYPES, v)
}

/**
 * The kind of each of the account's first three trackers, by id, in the order the week first
 * showed them: Strength, Cardio, Food (K90, K123). Files and caches from before trackers were the
 * account's own (export version 5, cache `-v5`) hold these three under these keys.
 */
export const SECTIONS = {
  exercise: TRACKER_TYPES.strength,
  cardio: TRACKER_TYPES.cardio,
  diet: TRACKER_TYPES.food,
} as const satisfies Record<string, TrackerType>

/** The id of one of the first three trackers. */
export type Section = keyof typeof SECTIONS

/** The first three trackers' ids, in order. */
export const SECTION_NAMES = Object.keys(SECTIONS) as readonly Section[]

/** The names the first three trackers start with (K123: the Exercises tracker reads "Strength"). */
export const FIRST_NAMES: Readonly<Record<Section, string>> = {
  exercise: 'Strength',
  cardio: 'Cardio',
  diet: 'Food',
}

export function isSection(v: unknown): v is Section {
  return typeof v === 'string' && Object.hasOwn(SECTIONS, v)
}

/**
 * The items a week shows while its tracker has no plan at all: today's default exercises and
 * foods, on the `exercise` and `diet` trackers only. Every other tracker starts empty (spec §4).
 */
export function defaultItems(trackerId: string): Item[] {
  if (trackerId === 'exercise') return defaultExercises()
  if (trackerId === 'diet') return defaultFoods()
  return []
}
