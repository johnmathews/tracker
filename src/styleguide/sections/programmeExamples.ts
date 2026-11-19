import {
  activityOptions,
  numberOf,
  type Blocking,
  type Cell,
  type ChangePreview,
  type ChangeRequest,
  type ConfirmOutcome,
  type GridWeek,
  type Grid,
  type LogEntry,
  type Outcome,
  type PreviewCell,
  type ProgrammeDoc,
  type Run,
  type SheetStart,
} from '@/lib/programmes'

/**
 * The programme the cards draw (components/ProgrammeGrid, ChangeSheet and ProgrammeChart,
 * preview.html): "Beginner 5×5", eight weeks from Mon 23 Nov 2026, deloads in weeks 4 and 8.
 * Today is Wed 16 Dec, in programme week 4. Week 3 of Bench press is split by a change on Wednesday,
 * Deadlift is paused for two weeks for its knee, and Barbell row's week 6 was set by hand.
 *
 * Built here in the browser, in the shapes the API sends (src/lib/programmes.ts), since the style
 * guide has no server and the web image leaves the root `fixtures/` out. Today is fixed rather
 * than taken from the clock: the components read it from the run (the server's today), and a
 * fixed one keeps the cards' own dates and words ("14–20 Dec", "Today, Wed 16 Dec, or any later
 * day.") on every day the guide is opened.
 */
export const TODAY = '2026-12-16'

const MONDAYS = [
  '2026-11-23',
  '2026-11-30',
  '2026-12-07',
  '2026-12-14',
  '2026-12-21',
  '2026-12-28',
  '2027-01-04',
  '2027-01-11',
]
/** This week's place in MONDAYS: programme week 4. */
const NOW = 3
const DELOAD = new Set([4, 8])
const TARGET = 3

/** A week's plan for an activity: its weight, paused, split by a change, or set by hand. */
type Plan = number | 'paused' | { split: [number, number] } | { hand: number; rule: number }
type Spec = {
  key: string
  name: string
  /** Sets in a normal week and in a deload. */
  sets: [number, number]
  plans: Plan[]
  /** How many days were marked in each week so far. */
  done: number[]
}

/** The cards' activities and numbers (ProgrammeGrid preview.html, `ACTS`). */
const SPECS: Spec[] = [
  {
    key: 'squat',
    name: 'Back squat',
    sets: [5, 3],
    plans: [40, 42.5, 45, 45, 52.5, 57.5, 60, 60],
    done: [3, 3, 3, 1],
  },
  {
    key: 'bench',
    name: 'Bench press',
    sets: [5, 3],
    plans: [30, 32.5, { split: [35, 32.5] }, 32.5, 37.5, 40, 42.5, 40],
    done: [3, 3, 1, 1],
  },
  {
    key: 'row',
    name: 'Barbell row',
    sets: [5, 3],
    plans: [30, 32.5, 35, 35, 40, { hand: 35, rule: 42.5 }, 45, 42.5],
    done: [3, 3, 3, 1],
  },
  {
    key: 'deadlift',
    name: 'Deadlift',
    sets: [1, 1],
    plans: [60, 65, 70, 'paused', 'paused', 75, 80, 77.5],
    done: [3, 2, 3],
  },
]

/** The log's seq of the hand-edit on Barbell row's week 6, which a change's preview meets. */
const HAND_EDIT = 3
const HAND_EDIT_ON = '2026-12-12'
const PAUSE = { from: '2026-12-14', until: '2026-12-28', reason: 'Knee' }

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** Midday on a day, in seconds, for a log entry's `madeAt`. */
function madeAt(iso: string): number {
  return Date.parse(`${iso}T12:00:00Z`) / 1000
}

/** The days marked in a week of `n`: Monday, Wednesday, Friday, then the rest. */
function marks(n: number): (string | null)[] {
  const order = [0, 2, 4, 1, 3, 5, 6]
  const days: (string | null)[] = Array(7).fill(null)
  for (const i of order.slice(0, n)) days[i] = 'great'
  return days
}

/**
 * The weight a week ends on: a split's second value, a hand-edit's own, and in a paused week the
 * weight it comes back at.
 */
function weightOf(spec: Spec, i: number): number {
  const plan = spec.plans[i]!
  if (plan === 'paused') return weightOf(spec, i + 1)
  if (typeof plan === 'number') return plan
  return 'split' in plan ? plan.split[1] : plan.hand
}

function cell(spec: Spec, i: number, withMarks = true): Cell {
  const week = i + 1
  const plan = spec.plans[i]!
  const paused = plan === 'paused'
  const activityWeek = week - spec.plans.slice(0, i + 1).filter((p) => p === 'paused').length
  const out: Cell = {
    state: paused ? 'paused' : 'running',
    activityWeek: paused ? activityWeek + 1 : activityWeek,
    values: {
      target: TARGET,
      sets: DELOAD.has(week) ? spec.sets[1] : spec.sets[0],
      reps: 5,
      weight: weightOf(spec, i),
    },
    target: paused ? 0 : TARGET,
    splits: {},
    hand: {},
    until: paused ? PAUSE.until : null,
    reason: paused ? PAUSE.reason : null,
  }
  if (typeof plan === 'object' && 'split' in plan) {
    const monday = MONDAYS[i]!
    out.splits.weight = [
      { from: monday, value: plan.split[0] },
      { from: addDays(monday, 2), value: plan.split[1] },
    ]
  }
  if (typeof plan === 'object' && 'hand' in plan) {
    out.hand.weight = { change: HAND_EDIT, madeOn: HAND_EDIT_ON, rule: plan.rule }
  }
  if (withMarks) out.marks = marks(i <= NOW ? (spec.done[i] ?? 0) : 0)
  return out
}

/** One calendar week; `pausedFrom` pauses the whole programme from that day of this week. */
function week(i: number, specs: Spec[], pausedFrom: string | null = null): GridWeek {
  const monday = MONDAYS[i]!
  return {
    monday,
    programmeWeeks: [i + 1],
    label: DELOAD.has(i + 1) ? 'Deload' : null,
    current: i === NOW,
    locked: i < NOW,
    days: Array.from({ length: 7 }, (_, d) => {
      const date = addDays(monday, d)
      return {
        date,
        status: pausedFrom && date >= pausedFrom ? 'paused' : 'running',
        programmeWeek: i + 1,
        sealed: date < TODAY,
      }
    }),
    cells: Object.fromEntries(specs.map((s) => [s.key, cell(s, i)])),
  }
}

function grid(specs: Spec[]): Grid {
  return {
    activities: specs.map((s) => ({
      key: s.key,
      name: s.name,
      addedOn: MONDAYS[0]!,
      addedBy: null,
      endedOn: null,
    })),
    weeks: MONDAYS.map((_, i) => week(i, specs)),
    whenResumed: [],
  }
}

const DOC: ProgrammeDoc = {
  format: 'tracker-programme/1',
  name: 'Beginner 5×5',
  kind: 'strength',
  weeks: 8,
  params: {
    squat: { label: 'Squat start', unit: 'kg', default: 40, min: 20, max: 200 },
    rate: { label: 'Weekly increase', unit: '%', default: 5, min: 0, max: 20 },
  },
  activities: [
    {
      key: 'squat',
      name: 'Back squat',
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
      weight: { start: 60, add: 5, step: 2.5 },
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

/** The run's Changes, newest first (ProgrammeGrid preview.html, the Changes tab). */
const LOG: LogEntry[] = [
  {
    seq: 4,
    madeAt: madeAt(PAUSE.from),
    from: PAUSE.from,
    change: { type: 'pause-activity', activity: 'deadlift', weeks: 2 },
    reason: PAUSE.reason,
    source: 'app',
    undoneBy: null,
    undoable: true,
  },
  {
    seq: HAND_EDIT,
    madeAt: madeAt(HAND_EDIT_ON),
    from: HAND_EDIT_ON,
    change: { type: 'edit-week', activity: 'row', week: 6, field: 'weight', value: 35 },
    reason: 'Hotel gym over New Year',
    source: 'app',
    undoneBy: null,
    undoable: true,
  },
  {
    seq: 2,
    madeAt: madeAt('2026-12-09'),
    from: '2026-12-09',
    change: { type: 'set-value', activity: 'bench', field: 'weight', value: 32.5 },
    reason: 'Shoulder',
    source: 'Claude',
    undoneBy: null,
    undoable: false,
  },
  {
    seq: 1,
    madeAt: madeAt('2026-12-03'),
    from: '2026-12-03',
    change: { type: 'set-increase', activity: 'squat', field: 'weight', rate: 7.5 },
    reason: 'Too easy',
    source: 'app',
    undoneBy: null,
    undoable: false,
  },
]

const ENDS_SHORT = {
  key: 'deadlift',
  name: 'Deadlift',
  week: 6,
  of: 8,
  message: 'Deadlift ends at its week 6 of 8, because of its pause.',
}

/** The running programme, as `GET /api/runs/{tracker}` sends it. */
export const RUN: Run = {
  tracker: 'sg-beginner-5x5',
  programmeId: 'sg-programme',
  name: 'Beginner 5×5',
  kind: 'strength',
  doc: DOC,
  params: { squat: 40, rate: 5 },
  start: MONDAYS[0]!,
  end: '2027-01-17',
  status: 'running',
  today: TODAY,
  week: NOW + 1,
  weeks: 8,
  rev: 'sg-rev-1',
  openPause: null,
  endsShort: [ENDS_SHORT],
  ended: null,
  clock: {
    programmeWeek: NOW + 1,
    status: 'running',
    until: null,
    reason: null,
    activities: Object.fromEntries(
      SPECS.map((s) => {
        const c = cell(s, NOW)
        return [
          s.key,
          { state: c.state, activityWeek: c.activityWeek, until: c.until, reason: c.reason },
        ]
      }),
    ),
  },
  log: LOG,
  grid: grid(SPECS),
}

/**
 * The programme paused today, Wed 16 Dec, with no end date: this week says where it stopped, and
 * the weeks after it are as they will run once resumed (ProgrammeGrid preview.html, "After an open
 * pause", which shows Back squat, Barbell row and Deadlift).
 */
export const OPEN_PAUSE_GRID: Grid = (() => {
  const specs = SPECS.filter((s) => s.key !== 'bench')
  const base = grid(specs)
  return {
    activities: base.activities,
    weeks: MONDAYS.slice(0, NOW + 1).map((_, i) => week(i, specs, i === NOW ? TODAY : null)),
    whenResumed: MONDAYS.slice(NOW + 1).map((_, k) => {
      const i = NOW + 1 + k
      return {
        programmeWeek: i + 1,
        label: DELOAD.has(i + 1) ? 'Deload' : null,
        cells: Object.fromEntries(specs.map((s) => [s.key, cell(s, i, false)])),
      }
    }),
  }
})()

/**
 * Deadlift paused from today, Wed 16 Dec, until Wed 30 Dec, beside Back squat (ProgrammeGrid
 * preview.html, "Paused for part of the week", K166). This week ran Monday and Tuesday, so its goal
 * is 1 (⌈3 × 2 / 7⌉, K163); week 5 is paused; week 6 runs from Wednesday. This week's cell and
 * week 6's each end on "Paused until Wed 30 Dec".
 */
export const PART_PAUSE_GRID: Grid = (() => {
  const until = '2026-12-30'
  const deadlift = SPECS.find((s) => s.key === 'deadlift')!
  const specs: Spec[] = [
    SPECS.find((s) => s.key === 'squat')!,
    { ...deadlift, plans: [60, 65, 70, 65, 'paused', 75, 80, 77.5], done: [3, 2, 3, 1] },
  ]
  const base = grid(specs)
  const weeks = base.weeks.map((w, i) => {
    if (i < NOW || i > NOW + 2) return w
    const c = w.cells.deadlift!
    const part: Cell = { ...c, until, reason: 'Knee', target: i === NOW ? 1 : c.target }
    return { ...w, cells: { ...w.cells, deadlift: part } }
  })
  return { ...base, weeks }
})()

// -- the change sheet's server, faked: nothing is sent and nothing is saved --

const ROW = SPECS.find((s) => s.key === 'row')!

/** Round to the bar's 2.5 kg step. */
function onStep(kg: number): number {
  return Math.round(kg / 2.5) * 2.5
}

/**
 * Barbell row's weight from `value` in programme week `from` on, as the row's rule makes it:
 * 2.5 kg a week, and 90% in a deload.
 */
function rowWeight(value: number, from: number, week: number): number {
  const kg = value + 2.5 * (week - from)
  return DELOAD.has(week) ? onStep(kg * 0.9) : kg
}

function refused(path: string, message: string): Outcome<ChangePreview> {
  return { ok: false, problems: [{ path, message }], message: null }
}

/**
 * What the server would say of a change to Barbell row's weight (spec §7.3): Set weight from a
 * later week's Monday, from then on or for that week only. The hand-edit on week 6 keeps its
 * value unless the change drops it. Any other change gets a line saying the guide doesn't preview
 * it, and a value the server would refuse gets the server's own words.
 */
export function previewChange(request: ChangeRequest): Outcome<ChangePreview> {
  const change = request.change
  const once = change.type === 'edit-week'
  if (!(change.type === 'set-value' || once) || change.field !== 'weight') {
    return {
      ok: false,
      problems: [],
      message: 'The style guide previews Set weight only. Nothing here is saved.',
    }
  }
  const value = numberOf(String(change.value ?? ''))
  if (typeof value !== 'number' || value <= 0 || value > 500) {
    return refused('change.value', 'give a number above 0 and at most 500.')
  }
  if (value % 2.5 !== 0) {
    return refused('change.value', 'the weight goes in steps of 2.5, so give a multiple of 2.5.')
  }
  const at = MONDAYS.indexOf(request.from)
  if (at <= NOW) {
    return refused(
      'from',
      'the style guide previews a change from a later week’s Monday, Mon 21 Dec to Mon 11 Jan.',
    )
  }
  const from = at + 1
  const dropped = ((change.dropHandEdits as number[] | undefined) ?? []).includes(HAND_EDIT)
  const blocking: Blocking[] = []
  const cells: PreviewCell[] = []
  const after = structuredClone(RUN.grid)
  for (let i = at; i < (once ? at + 1 : MONDAYS.length); i++) {
    const week = i + 1
    const hand = typeof ROW.plans[i] === 'object'
    if (hand && !once && !dropped) {
      blocking.push({
        change: HAND_EDIT,
        key: 'row',
        field: 'weight',
        programmeWeek: week,
        value: weightOf(ROW, i),
        madeOn: HAND_EDIT_ON,
        message: `Week ${week} keeps the ${weightOf(ROW, i)} kg set on 12 Dec.`,
      })
      continue
    }
    const kg = once ? value : rowWeight(value, from, week)
    cells.push({
      monday: MONDAYS[i]!,
      key: 'row',
      field: 'weight',
      before: weightOf(ROW, i),
      after: kg,
      starts: MONDAYS[i]!,
      programmeWeek: week,
    })
    const row = after.weeks[i]!.cells.row!
    row.values = { ...row.values!, weight: kg }
    row.hand = {}
  }
  return {
    ok: true,
    data: {
      preview: true,
      rev: 'sg-rev-1',
      change: { seq: 5, from: request.from, change, reason: request.reason ?? null },
      cells,
      blocking,
      endsShort: [ENDS_SHORT],
      undoes: null,
      deletes: null,
      grid: after,
    },
  }
}

/** The preview the ProgrammeGrid section shows: Barbell row at 45 kg from Mon 21 Dec. */
export const ROW_AT_45 = (() => {
  const res = previewChange({
    change: { type: 'set-value', activity: 'row', field: 'weight', value: 45 },
    from: MONDAYS[NOW + 1]!,
    reason: 'Rows feel light',
  })
  if (!res.ok) throw new Error('the example preview is refused')
  return res.data
})()

/** Change from here, on Barbell row's week 5 (ChangeSheet preview.html, step 1). */
export const ROW_FROM_WEEK_5: SheetStart = {
  title: 'Change Barbell row',
  options: activityOptions(RUN, 'row', MONDAYS[NOW + 1]!),
  kind: 'set-value',
  field: 'weight',
  activity: 'row',
  from: MONDAYS[NOW + 1]!,
  scope: 'on',
  undo: null,
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A fake server for the ChangeSheet: each answer comes after `delay` ms, so the pressed button
 * shows it is busy. With `staleOnce`, the first confirm finds the plan changed since the preview
 * (409) and sends the fresh preview back; the next one goes through.
 */
export function exampleServer({ delay = 0, staleOnce = false } = {}) {
  let stale = staleOnce
  return {
    async preview(request: ChangeRequest): Promise<Outcome<ChangePreview>> {
      await wait(delay)
      return previewChange(request)
    },
    async confirm(request: ChangeRequest): Promise<ConfirmOutcome> {
      await wait(delay)
      const res = previewChange(request)
      if (stale && res.ok) {
        stale = false
        return { ok: false, stale: { ...res.data, rev: 'sg-rev-2' } }
      }
      return res.ok ? { ok: true, data: RUN } : res
    },
  }
}
