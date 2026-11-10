import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DATA_KEY,
  DEFAULT_SETTINGS,
  MARK_SETS,
  MAX_GOALS,
  MAX_LIMITS,
  SETTINGS_KEY,
  defaultCardio,
  defaultExercises,
  defaultFoods,
  migrateKeyPrefix,
  normaliseCardio,
  normaliseDistance,
  normaliseGoals,
  normaliseLimits,
  normaliseWeight,
  parseDietData,
  parsePlannerData,
  parseSettings,
  normalisePortableSettings,
  readKey,
  writeKey,
} from '@/lib/storage'

const WEEK = '2026-10-19'

/** Migrate a legacy single-list payload, as the stores do when no v2 data exists. */
function legacy(raw: string | null) {
  const { plans, log } = parsePlannerData(null, raw, WEEK)
  return { exercises: plans[WEEK]!, plans, log }
}

describe('parsePlannerData', () => {
  it('starts with no plans and an empty log when nothing is stored', () => {
    expect(parsePlannerData(null, null, WEEK)).toEqual({ plans: {}, log: {} })
  })

  it('round-trips a v2 payload and ignores the legacy key', () => {
    const data = {
      plans: {
        '2026-10-19': [
          { id: 'sq', name: 'Squats', sets: 3, reps: 15, perSide: false, weight: 12, target: 4 },
        ],
        '2026-10-26': [],
      },
      log: { '2026-10-19': { sq: ['great', null, null, null, null, null, null] } },
    }
    const parsed = parsePlannerData(JSON.stringify(data), '{"exercises":[]}', WEEK)
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(data))
  })

  it('drops bad weeks and bad items from v2 plans', () => {
    const parsed = parsePlannerData(
      JSON.stringify({
        plans: {
          '2026-10-19': [{ id: 'a', name: 'A', reps: 1 }, null],
          nope: [],
          '2026-10-26': 'x',
        },
      }),
      null,
      WEEK,
    )
    expect(parsed.plans).toEqual({ '2026-10-19': [{ id: 'a', name: 'A', reps: 1, target: 3 }] })
    expect(parsed.log).toEqual({})
    expect(parsePlannerData('{"plans":"x"}', null, WEEK).plans).toEqual({})
  })

  it('migrates a legacy list to every logged week and the current week', () => {
    const prototype = {
      exercises: [
        { id: 'pu', name: 'Push-ups', reps: 10, target: 4 },
        { id: 'kh', name: 'Kettlebell halos', reps: 8, perSide: true, target: 3 },
      ],
      log: { '2026-10-05': { pu: ['great', null, 'great', null, null, null, null] } },
    }
    const parsed = parsePlannerData(null, JSON.stringify(prototype), WEEK)
    expect(Object.keys(parsed.plans).sort()).toEqual(['2026-10-05', WEEK])
    expect(parsed.plans[WEEK]).toEqual(prototype.exercises)
    expect(parsed.plans['2026-10-05']).toEqual(prototype.exercises)
    // Separate copies, so editing one week can't change another.
    expect(parsed.plans[WEEK]![0]).not.toBe(parsed.plans['2026-10-05']![0])
    expect(parsed.log).toEqual(prototype.log)
  })

  it('migrates invalid legacy JSON as the defaults', () => {
    expect(legacy('{not json').exercises).toEqual(defaultExercises())
  })

  it('keeps legacy exercises when log is missing (the prototype crashed here)', () => {
    const parsed = legacy(
      JSON.stringify({ exercises: [{ id: 'a', name: 'A', reps: 5, target: 2 }] }),
    )
    expect(parsed.exercises).toHaveLength(1)
    expect(parsed.log).toEqual({})
  })

  it('keeps the legacy log when exercises is missing, restoring default exercises', () => {
    const log = { [WEEK]: { pu: ['great', 'great', null, null, null, null, null] } }
    const parsed = legacy(JSON.stringify({ log }))
    expect(parsed.exercises).toEqual(defaultExercises())
    expect(parsed.log).toEqual(log)
  })

  it('keeps an intentionally empty exercise list', () => {
    expect(legacy(JSON.stringify({ exercises: [], log: {} })).exercises).toEqual([])
  })

  it('drops malformed exercises and clamps or defaults bad fields', () => {
    const parsed = legacy(
      JSON.stringify({
        exercises: [
          { id: 'ok', name: 'Ok', reps: -4, target: 12 },
          { id: 'x', name: 'No target', reps: '7' },
          { name: 'No id' },
          null,
          'nope',
        ],
      }),
    )
    expect(parsed.exercises).toEqual([
      { id: 'ok', name: 'Ok', reps: 0, target: 7 },
      { id: 'x', name: 'No target', reps: 0, target: 3 },
    ])
  })

  it('keeps each kind of mark, reads an old `true` as great, and empties anything else', () => {
    const parsed = parsePlannerData(
      JSON.stringify({
        plans: {},
        log: { '2026-10-19': { a: ['great', 'partial', 'missed', true, 1, 'GREAT', {}] } },
      }),
      null,
      '2026-10-19',
    )
    expect(parsed.log['2026-10-19']!.a).toEqual([
      'great',
      'partial',
      'missed',
      'great',
      null,
      null,
      null,
    ])
  })

  it('normalises log arrays to seven marks and drops bad weeks', () => {
    const parsed = legacy(
      JSON.stringify({
        exercises: [],
        log: {
          '2026-10-19': { a: [true, 1, 'yes'], b: 'nope' },
          'not-a-date': { a: [true] },
          '2026-10-26': 'nope',
        },
      }),
    )
    expect(parsed.log).toEqual({
      '2026-10-19': { a: ['great', null, null, null, null, null, null] },
    })
  })
})

describe('exercise sets and weight', () => {
  it('keeps a valid weight and drops a missing, zero or invalid one', () => {
    const { exercises } = legacy(
      JSON.stringify({
        exercises: [
          { id: 'a', name: 'A', reps: 15, weight: 12, target: 3 },
          { id: 'b', name: 'B', reps: 15, weight: 0, target: 3 },
          { id: 'c', name: 'C', reps: 15, weight: '12', target: 3 },
          { id: 'd', name: 'D', reps: 15, target: 3 },
        ],
      }),
    )
    expect(exercises.map((e) => e.weight)).toEqual([12, undefined, undefined, undefined])
    expect(exercises.slice(1).every((e) => !('weight' in e))).toBe(true)
  })

  it('rounds to two decimals and caps at 500 kg', () => {
    expect(normaliseWeight(2.505)).toBe(2.51)
    expect(normaliseWeight(9000)).toBe(500)
    expect(normaliseWeight(-1)).toBeUndefined()
    expect(normaliseWeight(0.004)).toBeUndefined()
    expect(normaliseWeight(Number.NaN)).toBeUndefined()
  })

  it('keeps sets as a whole number from 1 to 20 and drops anything else', () => {
    const { exercises } = legacy(
      JSON.stringify({
        exercises: [
          { id: 'a', name: 'A', sets: 3, reps: 10 },
          { id: 'b', name: 'B', sets: 50, reps: 10 },
          { id: 'c', name: 'C', sets: 0, reps: 10 },
          { id: 'd', name: 'D', sets: 'three', reps: 10 },
        ],
      }),
    )
    expect(exercises.map((e) => e.sets)).toEqual([3, 20, undefined, undefined])
    expect(exercises.slice(2).every((e) => !('sets' in e))).toBe(true)
  })
})

describe('cardio items (K90)', () => {
  it('has no default cardio: an account shows none until some is added', () => {
    expect(defaultCardio()).toEqual([])
  })

  it('keeps a time in whole seconds and a distance in km to 2 places, each when above zero', () => {
    expect(
      normaliseCardio({ id: 'c', name: 'Cycling', duration: 1800.4, distance: 12.345, target: 2 }),
    ).toEqual({ id: 'c', name: 'Cycling', duration: 1800, distance: 12.35, target: 2 })
    expect(normaliseCardio({ id: 'r', name: 'Running', duration: -5, distance: 0 })).toEqual({
      id: 'r',
      name: 'Running',
      target: 3,
    })
    expect(normaliseCardio({ id: 'x', name: 'X', duration: 1e9, distance: 1e9 })).toMatchObject({
      duration: 86_400,
      distance: 1000,
    })
    expect(normaliseCardio({ id: 1, name: 'X' })).toBeNull()
    expect(normaliseCardio('Cycling')).toBeNull()
  })

  it('reads a distance like a weight', () => {
    expect(normaliseDistance(0.004)).toBeUndefined()
    expect(normaliseDistance('5')).toBeUndefined()
    expect(normaliseDistance(Number.NaN)).toBeUndefined()
    expect(normaliseDistance(21.0975)).toBe(21.1)
  })
})

describe('parseDietData', () => {
  it('starts with no plans when nothing is stored', () => {
    expect(parseDietData(null, null, WEEK)).toEqual({ plans: {}, log: {} })
    expect(defaultFoods().map((f) => f.name)).toEqual(['Vegetables', 'Fruit', 'Fish', 'Nuts'])
  })

  it('round-trips a v2 payload byte for byte', () => {
    const data = {
      plans: { [WEEK]: [{ id: 'veg', name: 'Vegetables', target: 7 }] },
      log: { [WEEK]: { veg: ['great', null, null, null, null, null, 'great'] } },
    }
    expect(JSON.stringify(parseDietData(JSON.stringify(data), null, WEEK))).toBe(
      JSON.stringify(data),
    )
  })

  it('migrates a legacy list, dropping or clamping bad foods', () => {
    const parsed = parseDietData(
      null,
      JSON.stringify({
        foods: [{ id: 'a', name: 'A', target: 9 }, { id: 'b', name: 'B' }, { name: 'no id' }],
        log: 'nope',
      }),
      WEEK,
    )
    expect(parsed).toEqual({
      plans: {
        [WEEK]: [
          { id: 'a', name: 'A', target: 7 },
          { id: 'b', name: 'B', target: 3 },
        ],
      },
      log: {},
    })
    expect(parseDietData(null, '{bad', WEEK).plans[WEEK]).toEqual(defaultFoods())
    expect(parseDietData(null, JSON.stringify({ log: {} }), WEEK).plans[WEEK]).toEqual(
      defaultFoods(),
    )
  })
})

describe('normalisePortableSettings', () => {
  it('keeps an item-page arrangement, normalised, and leaves out none or the default (K66)', () => {
    const base = { accent: '#bf5af2', dailyPick: 4, foodPick: 5, goals: '', limits: '' }
    expect(
      normalisePortableSettings({
        ...base,
        itemSections: {
          food: { order: ['history', 'history'], hidden: ['plan', 'x'] },
          cardio: {},
        },
      }),
    ).toEqual({
      ...base,
      itemSections: { food: { order: ['history', 'plan', 'notes', 'details'], hidden: ['plan'] } },
    })
    expect(normalisePortableSettings({ ...base, itemSections: 'none' })).toEqual(base)
    expect(normalisePortableSettings({ ...base, itemSections: {} })).toEqual(base)
  })
})

describe('parseSettings', () => {
  it('defaults to green accent, three exercises and two foods a day with Daily goal on, the system theme and squiggles', () => {
    expect(parseSettings(null)).toEqual({
      accent: '#30d158',
      dailyPick: 3,
      foodPick: 2,
      dailyGoal: true,
      goals: '',
      limits: '',
      theme: 'system',
      markSet: 'squiggles',
    })
    expect(DEFAULT_SETTINGS.accent).toBe('#30d158')
  })

  it('accepts valid values and clamps both daily picks to 1–8', () => {
    expect(
      parseSettings(
        JSON.stringify({ accent: '#bf5af2', dailyPick: 20, foodPick: 5, theme: 'dark' }),
      ),
    ).toEqual({
      accent: '#bf5af2',
      dailyPick: 8,
      foodPick: 5,
      dailyGoal: true,
      goals: '',
      limits: '',
      theme: 'dark',
      markSet: 'squiggles',
    })
    expect(parseSettings(JSON.stringify({ dailyPick: 0 })).dailyPick).toBe(1)
    expect(parseSettings(JSON.stringify({ foodPick: 0 })).foodPick).toBe(1)
    expect(parseSettings(JSON.stringify({ foodPick: 12 })).foodPick).toBe(8)
  })

  it('reads Daily goal off only from false, and leaves it out of portable settings when unknown (K85)', () => {
    expect(parseSettings(JSON.stringify({ dailyGoal: false })).dailyGoal).toBe(false)
    expect(parseSettings(JSON.stringify({ dailyGoal: 'no' })).dailyGoal).toBe(true)
    expect(normalisePortableSettings({ dailyGoal: false }).dailyGoal).toBe(false)
    expect(normalisePortableSettings({ dailyGoal: true }).dailyGoal).toBe(true)
    // Unknown (a cache or file from before it): absent, so sending it keeps the saved one.
    expect('dailyGoal' in normalisePortableSettings({ dailyGoal: 0 })).toBe(false)
    expect('dailyGoal' in normalisePortableSettings({})).toBe(false)
  })

  it('rejects a non-hex accent', () => {
    expect(parseSettings(JSON.stringify({ accent: 'red' })).accent).toBe('#30d158')
    expect(parseSettings('garbage')).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back to the system theme for an unknown or missing theme', () => {
    expect(parseSettings(JSON.stringify({ theme: 'sepia' })).theme).toBe('system')
    // Settings saved before the theme option existed.
    expect(parseSettings(JSON.stringify({ accent: '#0a84ff', dailyPick: 2 })).theme).toBe('system')
  })

  it('reads each mark set and falls back to squiggles for anything else', () => {
    for (const markSet of MARK_SETS) {
      expect(parseSettings(JSON.stringify({ markSet })).markSet).toBe(markSet)
    }
    expect(parseSettings(JSON.stringify({ markSet: 'stars' })).markSet).toBe('squiggles')
    expect(parseSettings(JSON.stringify({ markSet: 3 })).markSet).toBe('squiggles')
  })
})

describe('normaliseLimits', () => {
  it('trims the ends, keeps the line breaks inside, and cuts at MAX_LIMITS code points', () => {
    expect(normaliseLimits(' Left knee.\nVegetarian.\n ')).toBe('Left knee.\nVegetarian.')
    expect(Array.from(normaliseLimits('🦵'.repeat(MAX_LIMITS + 5)))).toHaveLength(MAX_LIMITS)
    expect(MAX_LIMITS).toBe(1000)
  })

  it('reads blank text and anything that is not a string as no limits', () => {
    for (const v of [' \n ', '', null, undefined, 42, ['Knee']]) expect(normaliseLimits(v)).toBe('')
  })

  it('is read with the portable settings, beside the goals', () => {
    expect(normalisePortableSettings({ limits: ' Vegetarian. ' }).limits).toBe('Vegetarian.')
    expect(normalisePortableSettings({}).limits).toBe('')
  })
})

describe('normaliseGoals', () => {
  // The cases both languages share are in fixtures/transfer/parse/goals*.json.
  it('trims the ends, keeps the line breaks inside, and cuts at MAX_GOALS code points', () => {
    expect(normaliseGoals(' \n\tRun 5 km.\nFish twice a week.\n ')).toBe(
      'Run 5 km.\nFish twice a week.',
    )
    const cut = normaliseGoals('🏃'.repeat(MAX_GOALS + 5))
    expect(Array.from(cut)).toHaveLength(MAX_GOALS)
    expect(MAX_GOALS).toBe(1000)
  })

  it('reads blank text and anything that is not a string as no goals', () => {
    for (const v of [' \n\t ', '', null, undefined, 42, ['Run']]) expect(normaliseGoals(v)).toBe('')
  })
})

describe('readKey / writeKey', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('writes JSON and reads it back', () => {
    writeKey('k', { a: 1 })
    expect(readKey('k')).toBe('{"a":1}')
  })

  it('skips the write when the stored value is already identical', () => {
    writeKey('k', { a: 1 })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    writeKey('k', { a: 1 })
    expect(setItem).not.toHaveBeenCalled()
    writeKey('k', { a: 2 })
    expect(setItem).toHaveBeenCalledOnce()
  })

  it('swallows storage errors so the app keeps running', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(readKey('k')).toBeNull()
    expect(() => writeKey('k', 1)).not.toThrow()
  })
})

describe('migrateKeyPrefix', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('moves every key under an earlier name to tracker, leaving other keys alone (K44)', () => {
    localStorage.setItem('exercise-planner-v2', '{"plans":{}}')
    localStorage.setItem('exercise-planner-outbox-v1:alice', '[1]')
    localStorage.setItem('fitness-planner-cache-v3:alice', '{"c":1}')
    localStorage.setItem('fitness-planner-session-v1', '{"user":"alice"}')
    localStorage.setItem('other', 'x')
    migrateKeyPrefix()
    expect(localStorage.getItem(DATA_KEY)).toBe('{"plans":{}}')
    expect(localStorage.getItem('tracker-outbox-v1:alice')).toBe('[1]')
    expect(localStorage.getItem('tracker-cache-v3:alice')).toBe('{"c":1}')
    expect(localStorage.getItem('tracker-session-v1')).toBe('{"user":"alice"}')
    for (const old of [
      'exercise-planner-v2',
      'exercise-planner-outbox-v1:alice',
      'fitness-planner-cache-v3:alice',
      'fitness-planner-session-v1',
    ]) {
      expect(localStorage.getItem(old)).toBeNull()
    }
    expect(localStorage.getItem('other')).toBe('x')
    expect(localStorage).toHaveLength(5)
  })

  it('prefers the newer earlier name when both hold the same key', () => {
    localStorage.setItem('exercise-planner-settings-v1', '{"theme":"light"}')
    localStorage.setItem('fitness-planner-settings-v1', '{"theme":"dark"}')
    migrateKeyPrefix()
    expect(localStorage.getItem(SETTINGS_KEY)).toBe('{"theme":"dark"}')
    expect(localStorage).toHaveLength(1)
  })

  it('keeps a value already under the new name and drops the old one', () => {
    localStorage.setItem(SETTINGS_KEY, '{"theme":"dark"}')
    localStorage.setItem('exercise-planner-settings-v1', '{"theme":"light"}')
    migrateKeyPrefix()
    expect(localStorage.getItem(SETTINGS_KEY)).toBe('{"theme":"dark"}')
    expect(localStorage.getItem('exercise-planner-settings-v1')).toBeNull()
  })

  it('keeps the old key when the copy fails, so the next load retries', () => {
    localStorage.setItem('exercise-planner-v2', '{}')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => migrateKeyPrefix()).not.toThrow()
    expect(localStorage.getItem('exercise-planner-v2')).toBe('{}')
  })

  it('does nothing when storage is blocked', () => {
    localStorage.setItem('exercise-planner-v2', '{}')
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => migrateKeyPrefix()).not.toThrow()
    expect(localStorage.getItem('exercise-planner-v2')).toBe('{}')
  })
})
