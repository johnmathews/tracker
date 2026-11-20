import type { Grid } from '@/lib/programmes'
import type { ProgrammeDoc } from '@/lib/programmeDraft'
import { RUN } from './programmeExamples'

/**
 * The programme builder's examples (ProgrammeBuilder, ActivityCard and ValueField cards): Beginner
 * 5×5 (docs/programmes.md §6) with the cards' one mistake, the deadlift at 70 kg and +90 kg a week,
 * so weeks 6 to 8 pass the 500 kg an item can hold.
 */
export function builderDoc(): ProgrammeDoc {
  return {
    format: 'tracker-programme/1',
    name: 'Beginner 5×5',
    description:
      'Three full-body sessions a week, adding weight each week, with a deload in weeks 4 and 8.',
    kind: 'strength',
    weeks: 8,
    dailyTarget: 3,
    params: {
      squat: { label: 'Squat start', unit: 'kg', default: 40, min: 20, max: 200 },
      rate: { label: 'Weekly increase', unit: '%', default: 5, min: 0, max: 20 },
    },
    activities: [
      {
        key: 'squat',
        name: 'Back squat',
        notes: 'Belt from week 5.',
        target: 3,
        sets: 5,
        reps: 5,
        weight: { start: '$squat', rate: '$rate', step: 2.5 },
      },
      {
        key: 'bench',
        name: 'Bench press',
        target: 3,
        sets: 5,
        reps: 5,
        weight: { start: 30, add: 2.5, step: 2.5 },
      },
      {
        key: 'row',
        name: 'Barbell row',
        target: 3,
        sets: 5,
        reps: 5,
        weight: { start: 30, add: 2.5, step: 2.5 },
      },
      {
        key: 'deadlift',
        name: 'Deadlift',
        target: 3,
        sets: 1,
        reps: 5,
        weight: { start: 70, add: 90, step: 2.5 },
      },
      {
        key: 'plank',
        name: 'Plank',
        target: 3,
        sets: 3,
        duration: { start: 30, add: 5, every: 2, max: 90 },
      },
    ],
    overrides: [
      {
        weeks: [4, 8],
        label: 'Deload',
        activities: { '*': { sets: 3, weight: { scale: 0.9 } }, deadlift: { sets: 1 } },
      },
    ],
  }
}

/**
 * Beginner 5×5 with week 3 resting the legs (ExceptionWeekEditor card, K191): Back squat and
 * Deadlift ticked under Rest these activities, each a Times a week of 0. The deadlift also has 1
 * set of its own, so its group still shows.
 */
export function legsRestDoc(): ProgrammeDoc {
  const doc = builderDoc()
  doc.overrides!.push({
    weeks: [3],
    label: 'Legs rest',
    activities: { squat: { target: 0 }, deadlift: { target: 0, sets: 1 } },
  })
  return doc
}

/** A cardio programme's Long ride, its distance chosen at start (ValueField card). */
export function rideDoc(): ProgrammeDoc {
  return {
    format: 'tracker-programme/1',
    name: 'Base miles',
    kind: 'cardio',
    weeks: 6,
    params: { ride: { label: 'Long ride', unit: 'km', default: 20, min: 5 } },
    activities: [
      {
        key: 'run',
        name: 'Easy run',
        target: 2,
        duration: { start: 1200, rate: 10, step: 60, max: 1800 },
        distance: { start: 3, add: 0.5, max: 6 },
      },
      {
        key: 'long-ride',
        name: 'Long ride',
        target: 1,
        duration: { start: 3600, add: 600, every: 2 },
        distance: { start: '$ride', rate: 10 },
      },
    ],
  }
}

/** The problem the server finds in the builder's draft, as the page shows it. */
export const LIMIT = 'Week 6 comes to 520 kg. The most is 500.'
export const LIMIT_PATH = 'activities[3].weight'

/** The deadlift's weights week by week, as the draft route sends them. */
const DEADLIFT = [70, 160, 250, 340, 430, 520, 610, 700]

/**
 * The builder's weeks (the ProgrammeGrid card undated, spec S2): the plan as a start's preview,
 * every week still to come, the deadlift's weeks 6 to 8 over the limit with the problem's path.
 */
export const LIMIT_GRID: Grid = (() => {
  const grid = structuredClone(RUN.grid)
  grid.weeks.forEach((week, i) => {
    for (const [key, c] of Object.entries(week.cells)) {
      // A paused week in the running example has no values: the builder's plan has no pauses.
      const base = c.values ?? { target: 3, sets: 1, reps: 5 }
      const values = { ...base, ...(key === 'deadlift' ? { weight: DEADLIFT[i]! } : {}) }
      week.cells[key] = {
        ...c,
        state: 'running',
        values,
        target: values.target ?? 3,
        splits: {},
        hand: {},
        until: null,
        reason: null,
        ...(key === 'deadlift' && i >= 5 ? { limits: { weight: LIMIT_PATH } } : {}),
      }
    }
  })
  return grid
})()
