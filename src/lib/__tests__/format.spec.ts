import { describe, expect, it } from 'vitest'
import {
  MARKS,
  normaliseCardio,
  normaliseDetails,
  normaliseExercise,
  normaliseFood,
} from '@/lib/storage'
import {
  CACHE_PREFIX,
  OLD_CACHE_PREFIXES,
  OLD_OUTBOX_PREFIXES,
  OUTBOX_PREFIX,
  normaliseState,
} from '@/stores/sync'

/**
 * K14 as a test: the cache and outbox keys carry a version, and a change to what they store takes
 * the next one. A tab still open on older code shares the browser's storage; it reads a value it
 * doesn't know as empty and writes its copy back, emptying the newer tab's marks. That happened
 * twice (journal 261025-stale-tab, and the solid and hatch drawings of #38).
 *
 * Each row records what one version stores: the marks, the fields an exercise, a cardio item and a
 * food keep, the keys a cache holds, the keys of a cached section, the keys an item's details
 * keep, and the keys of a cached tracker. A row may change only before its version ships.
 */
type Format = {
  marks: string[]
  exercise: string[]
  cardio: string[]
  food: string[]
  sections: string[]
  section: string[]
  details: string[]
  tracker: string[]
}

const MARK_NAMES = [
  'great',
  'partial',
  'missed',
  'great-solid',
  'partial-solid',
  'missed-solid',
  'great-hatch',
  'partial-hatch',
  'missed-hatch',
]

const FORMATS: Record<string, Format> = {
  'tracker-cache-v3:': {
    marks: [
      'great',
      'partial',
      'missed',
      'great-solid',
      'partial-solid',
      'missed-solid',
      'great-hatch',
      'partial-hatch',
      'missed-hatch',
    ],
    exercise: ['duration', 'id', 'name', 'notes', 'perSide', 'reps', 'sets', 'target', 'weight'],
    cardio: [],
    food: ['id', 'name', 'notes', 'target'],
    sections: ['diet', 'exercise', 'settings'],
    section: ['log', 'plans', 'revs'],
    details: [],
    tracker: [],
  },
  // Item details (D2): an item's notes leave its plan for its details, one copy for every week.
  'tracker-cache-v4:': {
    marks: MARK_NAMES,
    exercise: ['duration', 'id', 'name', 'perSide', 'reps', 'sets', 'target', 'weight'],
    cardio: [],
    food: ['id', 'name', 'target'],
    sections: ['diet', 'exercise', 'settings'],
    section: ['detailRevs', 'details', 'log', 'plans', 'revs'],
    details: ['fields', 'notes'],
    tracker: [],
  },
  // Cardio (K90): a third section, whose items keep a time and a distance.
  'tracker-cache-v5:': {
    marks: MARK_NAMES,
    exercise: ['duration', 'id', 'name', 'perSide', 'reps', 'sets', 'target', 'weight'],
    cardio: ['distance', 'duration', 'id', 'name', 'target'],
    food: ['id', 'name', 'target'],
    sections: ['cardio', 'diet', 'exercise', 'settings'],
    section: ['detailRevs', 'details', 'log', 'plans', 'revs'],
    details: ['fields', 'notes'],
    tracker: [],
  },
  // Trackers are the account's own (K123): the cache holds them, and each one's data by its id.
  'tracker-cache-v6:': {
    marks: MARK_NAMES,
    exercise: ['duration', 'id', 'name', 'perSide', 'reps', 'sets', 'target', 'weight'],
    cardio: ['distance', 'duration', 'id', 'name', 'target'],
    food: ['id', 'name', 'target'],
    sections: ['sections', 'settings', 'trackers'],
    section: ['detailRevs', 'details', 'log', 'plans', 'revs'],
    details: ['fields', 'notes'],
    tracker: ['dailyTarget', 'endWeek', 'id', 'kind', 'name', 'position', 'rev', 'startWeek'],
  },
}

/** The fields a normaliser keeps from an item with every field set, and one it should drop. */
function keptFields(normalise: (v: unknown) => object | null): string[] {
  const full = {
    id: 'x',
    name: 'Squats',
    sets: 3,
    reps: 10,
    duration: 30,
    perSide: true,
    weight: 12,
    distance: 5,
    target: 3,
    notes: 'a note',
    probe: 'not a field',
  }
  return Object.keys(normalise(full) ?? {}).sort()
}

describe('the stored format (K14)', () => {
  const format = FORMATS[CACHE_PREFIX]

  it('has a row for the current cache key', () => {
    expect(format, `add a FORMATS row for ${CACHE_PREFIX}`).toBeDefined()
  })

  it('stores what the row for the current key says; a change takes a new key', () => {
    const details = normaliseDetails({
      notes: 'a note',
      fields: { equipment: 'Mat' },
      probe: 'not a field',
    })
    const tracker = { id: 'exercise', name: 'Strength', kind: 'strength', rev: 1, probe: 'x' }
    const state = normaliseState({ trackers: [tracker], probe: 'not a key' })!
    const now = {
      marks: [...MARKS],
      exercise: keptFields(normaliseExercise),
      cardio: keptFields(normaliseCardio),
      food: keptFields(normaliseFood),
      sections: Object.keys(state).sort(),
      section: Object.keys(state.sections.exercise!).sort(),
      details: Object.keys(details ?? {}).sort(),
      tracker: Object.keys(state.trackers[0]!).sort(),
    }
    expect(
      now,
      `the stored format changed: bump CACHE_PREFIX and OUTBOX_PREFIX (K14), move the old names to the front of OLD_*_PREFIXES, and add a FORMATS row`,
    ).toEqual(format)
  })

  it('moves every earlier name, and the cache and outbox share a version', () => {
    const version = (prefix: string) => prefix.match(/-v(\d+):$/)![1]
    expect(version(OUTBOX_PREFIX)).toBe(version(CACHE_PREFIX))
    const current = Number(version(CACHE_PREFIX))
    const olds = (prefixes: readonly string[]) => prefixes.map((p) => Number(version(p)))
    const expected = Array.from({ length: current - 1 }, (_, i) => current - 1 - i)
    expect(olds(OLD_CACHE_PREFIXES)).toEqual(expected)
    expect(olds(OLD_OUTBOX_PREFIXES)).toEqual(expected)
  })
})
