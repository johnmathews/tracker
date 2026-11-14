import { describe, expect, it } from 'vitest'
import {
  MAX_POSITION,
  MAX_TRACKERS,
  firstTrackers,
  inOrder,
  isTrackerId,
  nextPosition,
  normaliseTrackerName,
  normaliseTrackers,
  showsIn,
  type TrackerInfo,
} from '@/lib/trackers'

// The fixtures in fixtures/transfer/parse/v6-*.json hold normaliseTracker to the API's rules; these
// cover the rest of the module.

const T: TrackerInfo = {
  id: 'xa',
  name: 'A',
  kind: 'food',
  position: 3,
  dailyTarget: 2,
  startWeek: null,
  endWeek: null,
}

describe('tracker ids', () => {
  it('takes 1 to 64 letters, digits, - or _, never __proto__', () => {
    for (const id of ['exercise', 'xk3j9a2b1c', 'A-b_9', 'x'.repeat(64)]) {
      expect(isTrackerId(id)).toBe(true)
    }
    for (const id of ['', 'x'.repeat(65), 'a b', 'a/b', 'a.b', '__proto__', 7, null]) {
      expect(isTrackerId(id)).toBe(false)
    }
  })
})

describe('tracker names', () => {
  it('are trimmed and cut to 60 characters; blank is none', () => {
    expect(normaliseTrackerName('  Upper body \n')).toBe('Upper body')
    expect(normaliseTrackerName('é'.repeat(70))).toBe('é'.repeat(60))
    expect(normaliseTrackerName(' \t ')).toBeNull()
    expect(normaliseTrackerName(5)).toBeNull()
  })
})

describe('normaliseTrackers', () => {
  it('keeps at most 100 trackers', () => {
    const many = Array.from({ length: MAX_TRACKERS + 5 }, (_, i) => ({
      ...T,
      id: `x${i}`,
    }))
    expect(normaliseTrackers(many)).toHaveLength(MAX_TRACKERS)
  })
})

describe('the weeks a tracker covers (spec §2)', () => {
  it('shows from its start week, up to but not including its end week', () => {
    const t = { startWeek: '2026-10-12', endWeek: '2026-10-26' }
    expect(showsIn(t, '2026-10-05')).toBe(false)
    expect(showsIn(t, '2026-10-12')).toBe(true)
    expect(showsIn(t, '2026-10-19')).toBe(true)
    expect(showsIn(t, '2026-10-26')).toBe(false)
    expect(showsIn({ startWeek: null, endWeek: null }, '1999-01-04')).toBe(true)
    // Created and deleted in the same week: it shows nowhere.
    expect(showsIn({ startWeek: '2026-10-19', endWeek: '2026-10-19' }, '2026-10-19')).toBe(false)
  })
})

describe('the week’s order', () => {
  it('sorts by position, then by id, and leaves the list as it was', () => {
    const list = [
      { ...T, id: 'xc', position: 1 },
      { ...T, id: 'xb', position: 0 },
      { ...T, id: 'xa', position: 1 },
      { ...T, id: 'xa', position: 1 },
    ]
    expect(inOrder(list).map((t) => t.id)).toEqual(['xb', 'xa', 'xa', 'xc'])
    expect(list.map((t) => t.id)).toEqual(['xc', 'xb', 'xa', 'xa'])
  })

  it('places a new tracker after every other, within the position limit', () => {
    expect(nextPosition([])).toBe(0)
    expect(nextPosition([{ position: 4 }, { position: 2 }])).toBe(5)
    expect(nextPosition([{ position: MAX_POSITION }])).toBe(MAX_POSITION)
  })
})

describe('the first three trackers (K123)', () => {
  it('are Strength, Cardio and Food, with the daily targets the settings hold', () => {
    expect(firstTrackers(null)).toEqual([
      { ...T, id: 'exercise', name: 'Strength', kind: 'strength', position: 0, dailyTarget: 3 },
      { ...T, id: 'cardio', name: 'Cardio', kind: 'cardio', position: 1, dailyTarget: null },
      { ...T, id: 'diet', name: 'Food', kind: 'food', position: 2, dailyTarget: 2 },
    ])
    const picked = firstTrackers({ dailyPick: 5, foodPick: 7 })
    expect(picked.map((t) => t.dailyTarget)).toEqual([5, null, 7])
  })
})
