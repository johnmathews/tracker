import type { WorkActivity, WorkSeries, WorkTotal, WorkWeek } from '@/lib/programmes'

/**
 * The work the WorkChart card draws (components/WorkChart/preview.html), in the shape the run's
 * `work` takes (work-charts spec §3). Built here, as programmeExamples.ts builds its run, since the
 * style guide has no server.
 *
 * "Beginner 5×5": eight weeks from Mon 26 Oct 2026, today Thu 19 Nov in week 4, deloads in weeks
 * 4 and 8 (three sets in place of five). Five lifts, and a plank added in week 2, held three times
 * a week. "Two-year strength": 104 weeks from Mon 16 Feb 2026, in week 40, a deload every sixth.
 */

/** The Monday `i` weeks after `first`. */
function mondayAfter(first: string, i: number): string {
  const [y, m, d] = first.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + 7 * i)).toISOString().slice(0, 10)
}

const FIRST = '2026-10-26'
const NOW = 4
const DELOAD = [4, 8]

type Lift = { key: string; name: string; kg: number[]; sets: number; reps: number; target: number }
const LIFTS: Lift[] = [
  {
    key: 'squat',
    name: 'Back squat',
    kg: [40, 42.5, 45, 40, 47.5, 50, 52.5, 47.5],
    sets: 5,
    reps: 5,
    target: 3,
  },
  {
    key: 'bench',
    name: 'Bench press',
    kg: [30, 32.5, 35, 30, 35, 37.5, 40, 35],
    sets: 5,
    reps: 5,
    target: 3,
  },
  {
    key: 'row',
    name: 'Barbell row',
    kg: [30, 32.5, 35, 30, 35, 37.5, 40, 35],
    sets: 5,
    reps: 5,
    target: 3,
  },
  {
    key: 'ohp',
    name: 'Overhead press',
    kg: [20, 22.5, 22.5, 20, 25, 25, 27.5, 22.5],
    sets: 5,
    reps: 5,
    target: 3,
  },
  {
    key: 'dead',
    name: 'Deadlift',
    kg: [50, 55, 57.5, 50, 60, 62.5, 67.5, 60],
    sets: 1,
    reps: 5,
    target: 1,
  },
]
/** Sessions marked each week so far; week 4 is under way. */
const DONE: Record<string, number[]> = {
  squat: [3, 3, 2, 2],
  bench: [3, 3, 3, 1],
  row: [3, 2, 3, 1],
  ohp: [3, 3, 2, 1],
  dead: [1, 1, 1, 0],
}

function week(i: number, planned: number, done: number | null, first = FIRST): WorkWeek {
  return { monday: mondayAfter(first, i), programmeWeeks: [i + 1], planned, done }
}

function liftSeries(l: Lift): WorkActivity {
  const weeks = l.kg.map((kg, i) => {
    const sets = DELOAD.includes(i + 1) && l.sets === 5 ? 3 : l.sets
    const one = kg * l.reps * sets
    return week(i, one * l.target, i < NOW ? one * DONE[l.key]![i]! : null)
  })
  return { key: l.key, name: l.name, measure: 'work', unit: 'kg', weeks }
}

const lifts = LIFTS.map(liftSeries)

/** The plank: seconds × 3 sets, three times a week, from week 2. */
const PLANK_S = [null, 30, 30, 35, 35, 40, 40, 45]
const PLANK_DONE = [0, 3, 2, 1]
export const PLANK: WorkActivity = {
  key: 'plank',
  name: 'Plank',
  measure: 'seconds',
  unit: 's',
  weeks: PLANK_S.map((s, i) =>
    week(i, s === null ? 0 : s * 3 * 3, i < NOW ? (s ?? 0) * 3 * PLANK_DONE[i]! : null),
  ),
}

function totalOf(series: WorkSeries[], leftOut: string[]): WorkTotal {
  return {
    unit: 'kg',
    leftOut,
    weeks: series[0]!.weeks.map((w, i) => ({
      ...w,
      planned: series.reduce((sum, s) => sum + s.weeks[i]!.planned, 0),
      done: w.done === null ? null : series.reduce((sum, s) => sum + s.weeks[i]!.done!, 0),
    })),
  }
}

export const TOTAL = totalOf(lifts, ['Plank'])
export const SQUAT = lifts[0]!
export const THIS_WEEK = mondayAfter(FIRST, NOW - 1)

// -- a long programme (K181): 104 weeks, in week 40 --

const LONG_FIRST = '2026-02-16'
const LONG_NOW = 40
const wave = (w: number) => 1 + 0.25 * Math.sin(w / 6) + w / 260

function longLift(base: number, sets: number, reps: number, target: number, seed: number) {
  return Array.from({ length: 104 }, (_, i) => {
    const w = i + 1
    const kg = Math.round((base * wave(w) * (w % 6 === 0 ? 0.8 : 1)) / 2.5) * 2.5
    const one = kg * reps * sets
    const marks =
      w === LONG_NOW
        ? 1
        : w < LONG_NOW
          ? Math.max(0, target - ((w * seed) % 5 === 0 ? 1 : 0))
          : null
    return week(i, one * target, marks === null ? null : one * marks, LONG_FIRST)
  })
}

const longSeries = [longLift(60, 5, 5, 3, 3), longLift(45, 5, 5, 3, 7), longLift(80, 1, 5, 1, 11)]
export const LONG_TOTAL = totalOf(
  longSeries.map((weeks) => ({ unit: 'kg', weeks })),
  [],
)
export const LONG_THIS_WEEK = mondayAfter(LONG_FIRST, LONG_NOW - 1)
