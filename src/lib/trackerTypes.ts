import {
  MARKS,
  MARK_KINDS,
  NEW_EXERCISE_TARGET,
  NEW_FOOD_TARGET,
  markKind,
  type Exercise,
  type Mark,
  type MarkSet,
  type PortableSettings,
} from '@/lib/storage'
import type { Tracked } from '@/lib/tracker'
import { durationText } from '@/lib/words'

/**
 * Tracker types (docs/architecture.md §1): what kind of thing a section tracks, and what follows
 * from it. A section is the stored name (`exercise`, `diet`: in URLs, the database, the cache and
 * the outbox); its type is an attribute of it. `api/src/tracker_api/types.py` holds the same
 * registry, and `fixtures/types/registry.json` keeps the two in step.
 */

export type TrackerTypeId = 'exercise' | 'food'

/** A text field on the item page, by its stored key and the label it shows. */
export type ItemField = { key: string; label: string }

export type TrackerType = {
  id: TrackerTypeId
  /** The section's heading: "Exercises". */
  label: string
  /** One item, as the grid's row header says it: "Exercise". */
  itemLabel: string
  /** The marks a press steps through in the device's mark set. */
  cycle: (set: MarkSet) => readonly Mark[]
  /** The chips under an item's name; none for a type without them. */
  details: (item: Tracked) => string[]
  /** The item page's fields, in order. */
  fields: readonly ItemField[]
  /** The setting that holds how many items a day count as a met day (K30, K57). */
  pickKey: Exclude<keyof PortableSettings, 'accent' | 'itemSections'>
  /** The weekly goal an added item starts with. */
  newTarget: number
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
  exercise: {
    id: 'exercise',
    label: 'Exercises',
    itemLabel: 'Exercise',
    cycle: (set) => (set === 'squiggles' ? EXERCISE_CYCLE : EXERCISE_KIND_CYCLE),
    // An exercise section holds only exercises.
    details: (item) => exerciseDetails(item as Exercise),
    fields: [
      { key: 'equipment', label: 'Equipment' },
      { key: 'works', label: 'Works' },
      { key: 'link', label: 'Link' },
    ],
    pickKey: 'dailyPick',
    newTarget: NEW_EXERCISE_TARGET,
  },
  food: {
    id: 'food',
    label: 'Food',
    itemLabel: 'Food',
    cycle: (set) => (set === 'squiggles' ? FOOD_CYCLE : FOOD_KIND_CYCLE),
    details: () => [],
    fields: [
      { key: 'serving', label: 'A serving' },
      { key: 'examples', label: 'Examples' },
    ],
    pickKey: 'foodPick',
    newTarget: NEW_FOOD_TARGET,
  },
}

/** Each section's type. A second tracker of a type would be a new section here (D1). */
export const SECTIONS = {
  exercise: TRACKER_TYPES.exercise,
  diet: TRACKER_TYPES.food,
} as const satisfies Record<string, TrackerType>

export type Section = keyof typeof SECTIONS

/** The sections in the order the week shows them. */
export const SECTION_NAMES = Object.keys(SECTIONS) as readonly Section[]

export function isSection(v: unknown): v is Section {
  return typeof v === 'string' && Object.hasOwn(SECTIONS, v)
}
