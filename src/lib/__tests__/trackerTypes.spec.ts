import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARK_SETS, NEW_EXERCISE_TARGET, NEW_FOOD_TARGET, type Exercise } from '@/lib/storage'
import {
  EXERCISE_CYCLE,
  EXERCISE_KIND_CYCLE,
  FOOD_CYCLE,
  FOOD_KIND_CYCLE,
  cycleFor,
} from '@/lib/tracker'
import {
  SECTIONS,
  SECTION_NAMES,
  TRACKER_TYPES,
  exerciseDetails,
  isSection,
} from '@/lib/trackerTypes'

/** The registry both sides must match: api/tests/test_types.py reads the same file. */
type Expected = {
  sections: Record<string, string>
  types: Record<
    string,
    { pickKey: string; newTarget: number; fields: { key: string; label: string }[] }
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
    expect(SECTION_NAMES).toEqual(['exercise', 'diet'])
  })

  it('gives each type the fields, daily pick and new goal the API has', () => {
    const types = Object.fromEntries(
      Object.values(TRACKER_TYPES).map((t) => [
        t.id,
        { pickKey: t.pickKey, newTarget: t.newTarget, fields: t.fields },
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
  })

  it('names each section and its items as the week shows them', () => {
    expect([SECTIONS.exercise.label, SECTIONS.exercise.itemLabel]).toEqual([
      'Exercises',
      'Exercise',
    ])
    expect([SECTIONS.diet.label, SECTIONS.diet.itemLabel]).toEqual(['Food', 'Food'])
  })

  it('steps each type through its own cycle, which cycleFor reads', () => {
    expect(TRACKER_TYPES.exercise.cycle('squiggles')).toBe(EXERCISE_CYCLE)
    expect(TRACKER_TYPES.food.cycle('squiggles')).toBe(FOOD_CYCLE)
    for (const set of MARK_SETS.filter((s) => s !== 'squiggles')) {
      expect(TRACKER_TYPES.exercise.cycle(set)).toBe(EXERCISE_KIND_CYCLE)
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

  it('knows a section name from anything else', () => {
    expect(isSection('exercise')).toBe(true)
    expect(isSection('diet')).toBe(true)
    // A type id is not a section, and neither is what every object inherits.
    for (const v of ['food', 'toString', '__proto__', '', 'Exercise', 1, null, undefined, {}]) {
      expect(isSection(v)).toBe(false)
    }
  })
})
