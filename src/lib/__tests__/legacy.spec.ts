import { beforeEach, describe, expect, it } from 'vitest'
import { readLegacyData } from '@/lib/legacy'
import { DATA_KEY, DIET_KEY, LEGACY_DATA_KEY, LEGACY_DIET_KEY, SETTINGS_KEY } from '@/lib/storage'

const WEEK = '2026-10-19'

describe('readLegacyData', () => {
  beforeEach(() => localStorage.clear())

  it('finds nothing in a browser that never used the app before accounts', () => {
    expect(readLegacyData(WEEK)).toBeNull()
  })

  it('finds nothing when only the theme was ever saved', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }))
    expect(readLegacyData(WEEK)).toBeNull()
  })

  it('reads the v2 keys and the accent and daily pick, but never the theme', () => {
    const exercise = {
      plans: { [WEEK]: [{ id: 'sq', name: 'Squats', reps: 15, target: 4 }] },
      log: { [WEEK]: { sq: ['great', null, null, null, null, null, null] } },
    }
    const diet = {
      plans: {},
      log: { [WEEK]: { veg: [null, 'great', null, null, null, null, null] } },
    }
    localStorage.setItem(DATA_KEY, JSON.stringify(exercise))
    localStorage.setItem(DIET_KEY, JSON.stringify(diet))
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ accent: '#0a84ff', dailyPick: 5, theme: 'dark' }),
    )
    // No details: these keys predate accounts (P9), and notes came after them (K43).
    expect(readLegacyData(WEEK)).toEqual({
      exercise: { ...exercise, details: {} },
      diet: { ...diet, details: {} },
      settings: { accent: '#0a84ff', dailyPick: 5, foodPick: 2, goals: '' },
    })
  })

  it('migrates the single-list format from before weekly plans', () => {
    localStorage.setItem(
      LEGACY_DATA_KEY,
      JSON.stringify({
        exercises: [{ id: 'a', name: 'A', reps: 1, target: 2 }],
        log: { '2026-10-12': { a: ['great', null, null, null, null, null, null] } },
      }),
    )
    localStorage.setItem(LEGACY_DIET_KEY, JSON.stringify({ foods: [], log: {} }))
    const data = readLegacyData(WEEK)!
    // The list goes only on weeks it was ticked in: copying it onto this week, as the old app did
    // locally, would replace the account's carried-forward plan for this week and later ones.
    expect(Object.keys(data.exercise.plans)).toEqual(['2026-10-12'])
    // An empty list is no plan at all, so it cannot empty a week in the account.
    expect(data.diet).toEqual({ plans: {}, log: {}, details: {} })
    expect(data.settings).toBeNull()
  })

  it('keeps a single-list plan that was never ticked, on this week', () => {
    localStorage.setItem(
      LEGACY_DATA_KEY,
      JSON.stringify({ exercises: [{ id: 'a', name: 'A', reps: 1, target: 2 }], log: {} }),
    )
    expect(readLegacyData(WEEK)!.exercise.plans).toEqual({
      [WEEK]: [{ id: 'a', name: 'A', reps: 1, target: 2 }],
    })
  })

  it('reads a damaged single-list key as nothing, not the default exercises', () => {
    localStorage.setItem(LEGACY_DATA_KEY, '{broken')
    expect(readLegacyData(WEEK)).toBeNull()
  })

  it('counts settings alone as data worth offering', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ accent: '#bf5af2', dailyPick: 2 }))
    expect(readLegacyData(WEEK)).toEqual({
      exercise: { plans: {}, log: {}, details: {} },
      diet: { plans: {}, log: {}, details: {} },
      settings: { accent: '#bf5af2', dailyPick: 2, foodPick: 2, goals: '' },
    })
  })

  it('survives keys that are not valid JSON', () => {
    localStorage.setItem(DATA_KEY, '{broken')
    localStorage.setItem(SETTINGS_KEY, '[1]')
    expect(readLegacyData(WEEK)).toBeNull()
  })
})
