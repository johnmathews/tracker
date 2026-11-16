import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MARK_SETS,
  NEW_CARDIO_TARGET,
  NEW_EXERCISE_TARGET,
  NEW_FOOD_TARGET,
  type Cardio,
  type Exercise,
} from '@/lib/storage'
import {
  EXERCISE_CYCLE,
  EXERCISE_FILLED_CYCLE,
  EXERCISE_KIND_CYCLE,
  FOOD_CYCLE,
  FOOD_FILLED_CYCLE,
  FOOD_KIND_CYCLE,
  cycleFor,
} from '@/lib/tracker'
import {
  FIRST_NAMES,
  SECTIONS,
  SECTION_NAMES,
  TRACKER_KINDS,
  TRACKER_TYPES,
  cardioDetails,
  defaultItems,
  exerciseDetails,
  isSection,
  isTrackerKind,
  type TrackerType,
} from '@/lib/trackerTypes'
import { defaultExercises, defaultFoods } from '@/lib/storage'

/** The registry both sides must match: api/tests/test_types.py reads the same file. */
type Expected = {
  sections: Record<string, string>
  names: Record<string, string>
  types: Record<
    string,
    {
      pickKey: string | null
      newTarget: number
      dailyTarget: number | null
      fields: { key: string; label: string }[]
    }
  >
}
const EXPECTED = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../fixtures/types/registry.json'), 'utf8'),
) as Expected

describe('the tracker-type registry', () => {
  it('maps each section to its type, as the API does', () => {
    expect(Object.fromEntries(SECTION_NAMES.map((s) => [s, SECTIONS[s].id]))).toEqual(
      EXPECTED.sections,
    )
    // The order the week first showed them: Strength, Cardio, Food (K90).
    expect(SECTION_NAMES).toEqual(['exercise', 'cardio', 'diet'])
  })

  it('names the first three trackers as the API does (K123)', () => {
    expect(FIRST_NAMES).toEqual(EXPECTED.names)
  })

  it('gives each type the fields, daily pick and new goal the API has', () => {
    const types = Object.fromEntries(
      Object.values(TRACKER_TYPES).map((t) => [
        t.id,
        {
          pickKey: t.pickKey,
          newTarget: t.newTarget,
          dailyTarget: t.dailyTarget,
          fields: t.fields,
        },
      ]),
    )
    expect(types).toEqual(EXPECTED.types)
  })

  it('keys each type by its id, and keeps field keys unique', () => {
    for (const [id, type] of Object.entries(TRACKER_TYPES)) {
      expect(type.id).toBe(id)
      expect(new Set(type.fields.map((f) => f.key)).size).toBe(type.fields.length)
    }
  })

  it('uses the stored new-item goals', () => {
    expect(SECTIONS.exercise.newTarget).toBe(NEW_EXERCISE_TARGET)
    expect(SECTIONS.diet.newTarget).toBe(NEW_FOOD_TARGET)
    expect(SECTIONS.cardio.newTarget).toBe(NEW_CARDIO_TARGET)
  })

  it('names each kind, its items and its Add as the week shows them (K123, K124)', () => {
    const words = (k: TrackerType) => [k.label, k.itemLabel, k.itemsLabel, k.addLabel]
    expect(words(SECTIONS.exercise)).toEqual(['Strength', 'Exercise', 'Exercises', 'Add exercise'])
    expect(words(SECTIONS.diet)).toEqual(['Food', 'Food', 'Foods', 'Add food'])
    expect(words(SECTIONS.cardio)).toEqual(['Cardio', 'Cardio', 'Cardio', 'Add cardio'])
    expect(SECTIONS.cardio.settings).toBe('Log time and distance.')
    expect(SECTIONS.diet.settings).toBe('Log portions.')
  })

  it('gives cardio no daily target, and the others theirs (K90)', () => {
    expect(SECTIONS.cardio.pickKey).toBeNull()
    expect([SECTIONS.exercise.pickKey, SECTIONS.diet.pickKey]).toEqual(['dailyPick', 'foodPick'])
  })

  it('steps each type through its own cycle, which cycleFor reads', () => {
    expect(TRACKER_TYPES.strength.cycle('squiggles')).toBe(EXERCISE_CYCLE)
    expect(TRACKER_TYPES.food.cycle('squiggles')).toBe(FOOD_CYCLE)
    // Cardio is marked like an exercise (K90).
    expect(TRACKER_TYPES.cardio.cycle('squiggles')).toBe(EXERCISE_CYCLE)
    expect(TRACKER_TYPES.strength.cycle('filled')).toBe(EXERCISE_FILLED_CYCLE)
    expect(TRACKER_TYPES.cardio.cycle('filled')).toBe(EXERCISE_FILLED_CYCLE)
    expect(TRACKER_TYPES.food.cycle('filled')).toBe(FOOD_FILLED_CYCLE)
    for (const set of MARK_SETS.filter((s) => s !== 'squiggles' && s !== 'filled')) {
      expect(TRACKER_TYPES.strength.cycle(set)).toBe(EXERCISE_KIND_CYCLE)
      expect(TRACKER_TYPES.cardio.cycle(set)).toBe(EXERCISE_KIND_CYCLE)
      expect(TRACKER_TYPES.food.cycle(set)).toBe(FOOD_KIND_CYCLE)
    }
    for (const set of MARK_SETS) {
      for (const type of Object.values(TRACKER_TYPES)) {
        expect(cycleFor(type.id, set)).toBe(type.cycle(set))
      }
    }
  })

  it('gives an exercise its chips and a food none', () => {
    const e: Exercise = { id: 'a', name: 'A', sets: 3, reps: 10, weight: 16, target: 3 }
    expect(SECTIONS.exercise.details(e)).toEqual(['3 × 10', '16 kg'])
    expect(SECTIONS.exercise.details(e)).toEqual(exerciseDetails(e))
    expect(SECTIONS.diet.details({ id: 'v', name: 'Veg', target: 5 })).toEqual([])
  })

  it('gives cardio its time, then its distance, either alone, or none (K90)', () => {
    const chips = (c: Omit<Cardio, 'id' | 'name' | 'target'>) =>
      SECTIONS.cardio.details({ id: 'c', name: 'Cycling', target: 2, ...c })
    expect(chips({ duration: 1800, distance: 12.5 })).toEqual(['30 min', '12.5 km'])
    expect(chips({ duration: 5430 })).toEqual(['90 min 30 s'])
    expect(chips({ distance: 5 })).toEqual(['5 km'])
    expect(chips({})).toEqual([])
    const c: Cardio = { id: 'r', name: 'Running', distance: 5, target: 3 }
    expect(SECTIONS.cardio.details(c)).toEqual(cardioDetails(c))
  })

  it('lists the kinds in the registry’s order, and knows one from anything else', () => {
    expect(TRACKER_KINDS).toEqual(Object.keys(EXPECTED.types))
    expect(TRACKER_KINDS.every(isTrackerKind)).toBe(true)
    expect(TRACKER_KINDS).toEqual(['strength', 'cardio', 'food', 'mobility'])
    for (const v of ['exercise', 'yoga', 'Mobility', 'toString', '__proto__', '', 1, null]) {
      expect(isTrackerKind(v)).toBe(false)
    }
  })

  it('cleans each kind’s items with its own rules', () => {
    const raw = { id: 'a', name: 'A', reps: 5, duration: 60, distance: 3, target: 9 }
    expect(TRACKER_TYPES.strength.normalise(raw)).toEqual({
      id: 'a',
      name: 'A',
      reps: 5,
      duration: 60,
      target: 7,
    })
    expect(TRACKER_TYPES.cardio.normalise(raw)).toEqual({
      id: 'a',
      name: 'A',
      duration: 60,
      distance: 3,
      target: 7,
    })
    expect(TRACKER_TYPES.food.normalise(raw)).toEqual({ id: 'a', name: 'A', target: 7 })
    expect(TRACKER_TYPES.food.normalise({ id: 1 })).toBeNull()
  })

  it('gives mobility strength’s plan without weight, its marks and a daily target (W8)', () => {
    const m = TRACKER_TYPES.mobility
    expect([m.label, m.itemLabel, m.itemsLabel, m.addLabel]).toEqual([
      'Mobility',
      'Exercise',
      'Exercises',
      'Add exercise',
    ])
    expect(m.settings).toBe('Log sets, reps or hold time, each side.')
    expect([m.plan, m.weighted]).toEqual(['exercise', false])
    expect([TRACKER_TYPES.strength.plan, TRACKER_TYPES.strength.weighted]).toEqual([
      'exercise',
      true,
    ])
    expect([TRACKER_TYPES.cardio.plan, TRACKER_TYPES.food.plan]).toEqual(['cardio', 'food'])
    expect(m.fields).toEqual(TRACKER_TYPES.strength.fields)
    expect([m.pickKey, m.dailyTarget, m.newTarget]).toEqual([null, 3, 3])
    for (const set of MARK_SETS) expect(m.cycle(set)).toBe(TRACKER_TYPES.strength.cycle(set))
    const hold = { id: 'h', name: 'Hip hold', sets: 2, duration: 45, perSide: true }
    const held = m.normalise({ ...hold, weight: 10, distance: 3, target: 4 })
    expect(held).toEqual({ ...hold, reps: 0, target: 4 })
    expect(m.details(held!)).toEqual(['2 × 45 s each side'])
    const reps = m.normalise({ id: 'c', name: 'Cat-cow', sets: 3, reps: 10, weight: 8 })
    expect(reps).toEqual({ id: 'c', name: 'Cat-cow', sets: 3, reps: 10, target: 3 })
    expect(m.details(reps!)).toEqual(['3 × 10'])
    expect(m.normalise({ id: 1 })).toBeNull()
  })

  it('gives the default items to the exercise and diet trackers only (spec §4)', () => {
    expect(defaultItems('exercise')).toEqual(defaultExercises())
    expect(defaultItems('diet')).toEqual(defaultFoods())
    expect(defaultItems('cardio')).toEqual([])
    expect(defaultItems('xk3j9a2b1c')).toEqual([])
  })

  it('knows a section name from anything else', () => {
    expect(isSection('exercise')).toBe(true)
    expect(isSection('diet')).toBe(true)
    expect(isSection('cardio')).toBe(true)
    // A kind is not a section, and neither is what every object inherits.
    for (const v of [
      'food',
      'strength',
      'toString',
      '__proto__',
      '',
      'Exercise',
      1,
      null,
      undefined,
      {},
    ]) {
      expect(isSection(v)).toBe(false)
    }
  })
})
