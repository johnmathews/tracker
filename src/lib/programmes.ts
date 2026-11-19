import type { ApiError, Problem } from '@/lib/api'
import { isRecord } from '@/lib/storage'
import { goalMet } from '@/lib/tracker'
import { countOf, durationText, numberWord } from '@/lib/words'

/**
 * Programmes in the app (docs/specs/2026-11-17-programmes.md): the shapes the API sends, and the
 * words the Programmes page, the overview and the change sheet put round them. Every number here
 * comes from the server (P4, one engine): this module only words what the server computed, and
 * builds the change a sheet sends for the server to preview. Pure, so its tests read the same.
 */

export type { Problem } from '@/lib/api'

export type ProgrammeKind = 'strength' | 'mobility' | 'cardio'
/** A plan field a programme's activity has (spec §3.1). */
export type Field = 'weight' | 'reps' | 'duration' | 'distance' | 'sets' | 'target'
/** The plan values of one activity in one week, as the server expanded them. */
export type Values = Partial<Record<Field, number>> & { perSide?: boolean }

/** A library programme in the list (`GET /api/programmes`). */
export type ProgrammeSummary = {
  id: string
  name: string
  description?: string | null
  kind: ProgrammeKind
  weeks: number
  activities: number
  rev: number
  createdAt: number
  updatedAt: number
  /**
   * For an admin only (shared library spec §5): the shared copy this programme was last published
   * as, or null. Nobody else's summaries carry the field.
   */
  shared?: SharedRef | null
}
/** A shared copy: its own id, and when it was last published (seconds, as `updatedAt`). */
export type SharedRef = { id: string; updatedAt: number }
/**
 * A shared programme as every user sees it (`GET /api/shared-programmes`, spec §5): a library
 * summary with no `rev`, no `createdAt` and no owner (S2).
 */
export type SharedSummary = {
  id: string
  name: string
  description?: string | null
  kind: ProgrammeKind
  weeks: number
  activities: number
  updatedAt: number
}
/**
 * Publish's preview (`POST /api/programmes/{id}/publish`, spec §5, S5): the programme as every user
 * will see it, the shared copy it replaces (null on a first publish), and the token to confirm with.
 */
export type PublishPreview = {
  preview: true
  rev: string
  /** A first publish has no shared id until it is confirmed, so `id` is null there. */
  publish: {
    programme: Omit<SharedSummary, 'id'> & { id: string | null; doc: ProgrammeDoc }
    replaces: SharedRef | null
  }
}
/**
 * A shared programme to look at before copying it (`GET /api/shared-programmes/{id}/preview`,
 * K173): its document, and its plan as a start's preview at its own values from today.
 */
export type SharedPreview = {
  programme: SharedSummary & { doc: ProgrammeDoc }
  plan: StartPreview
}
export type ProgrammeParam = {
  label: string
  unit: string
  default: number
  min?: number
  max?: number
}
/** An activity as the format writes one: its fields are numbers, parameters or progressions. */
export type DocActivity = { key: string; name: string } & Record<string, unknown>
/** A `tracker-programme/1` document (spec §3.1); only what the app reads is typed. */
export type ProgrammeDoc = {
  name: string
  kind: ProgrammeKind
  weeks: number
  params?: Record<string, ProgrammeParam>
  activities: DocActivity[]
} & Record<string, unknown>
/** One programme with its document (`GET /api/programmes/{id}`). */
export type ProgrammeRecord = ProgrammeSummary & { doc: ProgrammeDoc }

export type ActivityState = 'running' | 'paused' | 'ended' | 'not-started'
/** One activity in one calendar week of the grid. */
export type Cell = {
  state: ActivityState
  activityWeek: number | null
  values: Values | null
  target: number
  /** A field whose value changed within the week: each value with the day it started. */
  splits: Record<string, { from: string; value: number }[]>
  /** The fields set by hand for the week (spec §7.2), with the day each was set. */
  hand: Record<string, { change: number; madeOn: string; rule: number }>
  until: string | null
  reason: string | null
  /** Monday to Sunday's marks; left out of the weeks after an open pause. */
  marks?: (string | null)[]
}
export type GridDay = {
  date: string
  status: 'before-start' | 'running' | 'paused'
  programmeWeek: number | null
  sealed: boolean
}
/** One calendar week of the grid: `locked` and `current` are the server's, from its today. */
export type GridWeek = {
  monday: string
  programmeWeeks: number[]
  label: string | null
  current: boolean
  locked: boolean
  days: GridDay[]
  cells: Record<string, Cell>
}
/** A programme week after an open pause, as it will run once resumed: no dates yet. */
export type ResumedWeek = {
  programmeWeek: number
  label: string | null
  cells: Record<string, Cell>
}
export type GridActivity = {
  key: string
  name: string
  addedOn: string
  addedBy: number | null
  endedOn: string | null
}
/** The overview grid (spec §9.2): the server's, for a run, a start or a change's preview. */
export type Grid = { activities: GridActivity[]; weeks: GridWeek[]; whenResumed: ResumedWeek[] }
export type EndsShort = { key: string; name: string; week: number; of: number; message: string }

export type ChangeKind =
  | 'set-value'
  | 'set-increase'
  | 'set-parameter'
  | 'edit-week'
  | 'pause-activity'
  | 'resume-activity'
  | 'add-activity'
  | 'end-activity'
  | 'pause-programme'
  | 'resume-programme'
  | 'go-to-week'
  | 'undo'
/** A change as the API takes it (`programme_replay`'s format), tagged by `type`. */
export type Change = { type: ChangeKind } & Record<string, unknown>
/** A log row: a change, or End programme (K156) or a re-open (K165), which are no change. */
export type LogRow = { type: ChangeKind | 'end-programme' | 'reopen-programme' } & Record<
  string,
  unknown
>
/** One entry in a run's log, newest first. */
export type LogEntry = {
  seq: number
  madeAt: number
  from: string
  change: LogRow
  reason: string | null
  source: string
  undoneBy: number | null
  undoable: boolean
}
export type RunStatus = 'upcoming' | 'running' | 'paused' | 'ended'
/** A run (`GET /api/runs/{tracker}`). */
export type Run = {
  tracker: string
  programmeId: string | null
  name: string
  kind: ProgrammeKind
  doc: ProgrammeDoc
  params: Record<string, number>
  start: string
  end: string | null
  status: RunStatus
  /** The server's today: the first day a change may start, and what locks a week (spec §8). */
  today: string
  week: number | null
  weeks: number
  rev: string
  openPause: { since: string; programmeWeek: number; reason: string | null } | null
  endsShort: EndsShort[]
  /** The end in force. `restarted` is true when a restart wrote it, so the new run replaces this
   * one (K167); absent from an older server. */
  ended: { from: string; reason: string | null; seq: number; restarted?: boolean } | null
  /** Whether a re-open applies today (K167): an end that stopped the run part way, a restart's
   * aside. True for an end set for a later day, while `status` is still `running`. */
  canReopen: boolean
  clock: { programmeWeek: number | null; status: string | null; until: string | null } & Record<
    string,
    unknown
  >
  log: LogEntry[]
  grid: Grid
  /** The work planned and done, week by week (K179, work-charts spec §3); absent from an older
   * server. */
  work?: Work
}
/** One week of a work chart: the grid's week, its planned amount, and what was done (spec §3).
 * `done` is null for a week wholly after today. */
export type WorkWeek = {
  monday: string
  programmeWeeks: number[]
  planned: number
  done: number | null
}
/** What a work chart draws: one measure, in its unit, a week per entry in the grid's order. */
export type WorkSeries = { unit: string; weeks: WorkWeek[] }
/** What an activity's chart counts (spec §1): work in kg, reps, seconds held, km or minutes. */
export type WorkMeasure = 'work' | 'reps' | 'seconds' | 'distance' | 'time'
export type WorkActivity = WorkSeries & { key: string; name: string; measure: WorkMeasure }
/** The programme's total: the work of its weighted activities, naming the others it leaves out. */
export type WorkTotal = WorkSeries & { leftOut: string[] }
/** A run's work (K179): the total, null when no activity has weight, then each activity's. */
export type Work = { total: WorkTotal | null; activities: WorkActivity[] }
/** A run as `/api/state` lists it, by its tracker's id (spec §9.1). */
export type RunSummary = {
  programmeId: string | null
  name: string
  status: RunStatus
  week: number | null
  weeks: number
  start: string
  end: string | null
  pausedUntil: string | null
  /** A paused run's first paused day and its reason (§8.8); absent from an older server. */
  pausedSince?: string | null
  pauseReason?: string | null
  rev: string
}
/** What starting a programme would write (`POST /api/programmes/{id}/preview`). */
export type StartPreview = {
  start: string
  end: string | null
  weeks: number
  params: Record<string, number>
  endsShort: EndsShort[]
  grid: Grid
}
/** One cell a change alters: a field's value, or (with `field` null) the activity's state. */
export type PreviewCell = {
  monday: string
  key: string
  field: string | null
  before: number | string | boolean | null
  after: number | string | boolean | null
  starts: string
  programmeWeek: number | null
}
/** A hand-edit that keeps its value though the change alters its week (spec §7.2). */
export type Blocking = {
  change: number
  key: string
  field: string
  programmeWeek: number
  value: number
  madeOn: string
  message: string
}
/** A change's preview (spec §7.3): its `grid` is the plan as it would be. */
export type ChangePreview = {
  preview: true
  rev: string
  change: { seq: number; from: string; change: Change; reason: string | null }
  cells: PreviewCell[]
  blocking: Blocking[]
  endsShort: EndsShort[]
  undoes: number | null
  deletes: string | null
  grid: Grid
}
/** A change as a sheet sends it: the change, its from day and its reason. */
export type ChangeRequest = { change: Change; from: string; reason?: string }

/** What a request came to: the data, or the problems with what was sent, or why it failed. */
export type Outcome<T> =
  { ok: true; data: T } | { ok: false; problems: Problem[]; message: string | null }
/** A confirm's outcome: a stale `rev` brings the change previewed again (409, spec §7.3). */
export type ConfirmOutcome = Outcome<Run> | { ok: false; stale: ChangePreview }

/** How long the start form waits after a change to its fields before it asks for a preview. */
export const START_PREVIEW_DELAY = 250

// -- dates --

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A `YYYY-MM-DD` day at local midnight. */
function local(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/** "Mon 21 Dec", as the server's sentences write a day. */
export function dayText(iso: string): string {
  const d = local(iso)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** "21 Dec", a day without its weekday. */
function dateText(iso: string): string {
  const d = local(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** A day's weekday alone: "Wed". */
export function weekdayText(iso: string): string {
  return WEEKDAYS[local(iso).getDay()]!
}

/** A week's dates under its number: "14–20 Dec", or "30 Nov–6 Dec" across two months. */
export function weekDates(monday: string): string {
  const start = local(monday)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const month = (d: Date) => MONTHS[d.getMonth()]
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${month(end)}`
    : `${start.getDate()} ${month(start)}–${end.getDate()} ${month(end)}`
}

/** A week by its programme week, "Week 4"; both when a change split it, "Weeks 4 and 7". */
export function weekName(week: { programmeWeeks: number[] }): string {
  const weeks = week.programmeWeeks
  if (weeks.length === 0) return 'Before the start'
  if (weeks.length === 1) return `Week ${weeks[0]}`
  return `Weeks ${weeks.slice(0, -1).join(', ')} and ${weeks.at(-1)}`
}

// -- values --

/** Each field's words: what Set calls it, its input's label, and its unit. */
export const FIELD_WORDS: Record<Field, { set: string; input: string; noun: string }> = {
  weight: { set: 'Set weight', input: 'Weight in kg', noun: 'Weight' },
  reps: { set: 'Set reps', input: 'Reps', noun: 'Reps' },
  duration: { set: 'Set time', input: 'Time in seconds', noun: 'Time' },
  distance: { set: 'Set distance', input: 'Distance in km', noun: 'Distance' },
  sets: { set: 'Set sets', input: 'Sets', noun: 'Sets' },
  target: { set: 'Set goal', input: 'Sessions a week', noun: 'Goal' },
}

/** The unit an increase of a field is in: "kg", "s". */
const INCREASE_UNIT: Record<Field, string> = {
  weight: 'kg',
  reps: 'reps',
  duration: 's',
  distance: 'km',
  sets: 'sets',
  target: 'sessions',
}

/** A field's value with its unit: "42.5 kg", "1 min 30 s", "8 reps", "3 a week". */
export function valueText(field: string, n: number): string {
  switch (field) {
    case 'weight':
      return `${n} kg`
    case 'duration':
      return durationText(n)
    case 'distance':
      return `${n} km`
    case 'reps':
      return `${n} reps`
    case 'sets':
      return `${n} sets`
    case 'target':
      return goalText(n)
    default:
      return String(n)
  }
}

/** The value a cell leads with: weight, then time, then distance, then reps, then sets. */
export function primaryField(values: Values): Field | null {
  const order: Field[] = ['weight', 'duration', 'distance', 'reps', 'sets']
  return order.find((f) => values[f] !== undefined) ?? null
}

/**
 * The line under a cell's value: "5 × 5" with sets and reps, "3 sets" when the value is the time
 * or the reps, "8 reps" when only reps go with a weight; a cardio session's distance under its time.
 */
export function setsLine(values: Values, kind: ProgrammeKind): string | null {
  if (kind === 'cardio') {
    return values.duration !== undefined && values.distance !== undefined
      ? valueText('distance', values.distance)
      : null
  }
  const lead = primaryField(values)
  const { sets, reps } = values
  if (sets !== undefined && reps !== undefined && lead !== 'reps') {
    return `${sets} × ${reps}${values.perSide ? ' each side' : ''}`
  }
  if (sets !== undefined && lead !== 'sets') {
    return `${valueText('sets', sets)}${values.perSide ? ', each side' : ''}`
  }
  if (reps !== undefined && lead !== 'reps') return valueText('reps', reps)
  return null
}

/** An activity's weekly goal: "3 a week". */
export function goalText(target: number): string {
  return `${target} a week`
}

/** How a week went, as RecentWeeks counts it: any mark counts, against the week's goal. */
export function weekCount(cell: Cell): { done: number; target: number; met: boolean } {
  const done = (cell.marks ?? []).filter((m) => m !== null).length
  return { done, target: cell.target, met: goalMet(done, cell.target) }
}

/**
 * A changed cell's words (spec §9.3): the value before, with its arrow, then the value after.
 * "40 → " and "45 kg": a weight or a distance drops its unit before the arrow; a change of state
 * reads "Active → " and "Paused" (K161: "Running" is also an activity's name).
 */
export function changeWords(change: PreviewCell): { was: string; now: string } {
  if (change.field === null) {
    return { was: `${stateWord(change.before)} → `, now: stateWord(change.after) }
  }
  const field = change.field
  const word = (v: unknown) => (typeof v === 'number' ? valueText(field, v) : '–')
  const bare = (field === 'weight' || field === 'distance') && typeof change.before === 'number'
  return { was: `${bare ? change.before : word(change.before)} → `, now: word(change.after) }
}

/** The fields each kind plans, in the order the sheet offers them (spec §3.1). */
export function fieldsOf(kind: ProgrammeKind): Field[] {
  if (kind === 'cardio') return ['duration', 'distance', 'target']
  const fields: Field[] = ['weight', 'reps', 'duration', 'sets', 'target']
  return kind === 'mobility' ? fields.filter((f) => f !== 'weight') : fields
}

/** An activity's state in a word. */
export function stateWord(state: unknown): string {
  if (state === 'running') return 'Active'
  if (state === 'paused') return 'Paused'
  if (state === 'ended') return 'Ended'
  return 'Not yet'
}

// -- runs --

/** A run in the Started list (K161): its first sentence (in ink, at 600), then the rest. */
export function runLine(run: RunSummary): { lead: string; rest: string } {
  const ends = run.end ? `Ends ${dayText(run.end)}.` : ''
  if (run.status === 'upcoming') return { lead: `Starts ${dayText(run.start)}.`, rest: ends }
  const lead = `Week ${run.week} of ${run.weeks}.`
  if (run.status === 'paused') {
    const until = run.pausedUntil ? ` until ${dayText(run.pausedUntil)}` : ''
    const since = run.pausedSince ? ` since ${dayText(run.pausedSince)}` : ''
    const why = reasonText(run.pauseReason)
    return { lead, rest: `Paused${since}${until}.${why ? ` ${why}` : ''}` }
  }
  return { lead, rest: `Started ${dayText(run.start)}. ${ends}`.trim() }
}

/** A reason as a sentence of its own: "knee" reads "Knee."; none reads ''. */
export function reasonText(reason: string | null | undefined): string {
  const text = (reason ?? '').trim()
  if (!text) return ''
  return sentenceCase(/[.!?]$/.test(text) ? text : `${text}.`)
}

/** The line under the overview's title: where the run is, and when it started and ends. */
export function runMeta(run: Run): { lead: string | null; rest: string } {
  const ends = run.end ? `, ends ${dayText(run.end)}` : ''
  if (run.status === 'ended') {
    // The last day, then the end's reason (K168): "Ended Sun 15 Nov. Knee."
    const why = reasonText(run.ended?.reason)
    return {
      lead: null,
      rest: `${run.end ? `Ended ${dayText(run.end)}.` : 'Ended.'}${why ? ` ${why}` : ''}`,
    }
  }
  if (run.status === 'upcoming') return { lead: null, rest: `Starts ${dayText(run.start)}${ends}.` }
  const at = `in week ${run.week} of ${run.weeks}`
  if (run.openPause) {
    return {
      lead: null,
      rest: `Paused since ${dayText(run.openPause.since)}, ${at}. Resume it when you’re ready.`,
    }
  }
  if (run.status === 'paused') {
    const until = run.clock.until ? ` until ${dayText(run.clock.until)}` : ''
    return { lead: null, rest: `Paused${until}, ${at}.` }
  }
  return {
    lead: `Week ${run.week} of ${run.weeks}.`,
    rest: `Started ${dayText(run.start)}${ends}.`,
  }
}

/** `today` and the runs from `GET /api/state`; anything that isn't a run is left out. */
export function runsFromState(v: unknown): {
  today: string | null
  runs: Record<string, RunSummary>
} {
  const today = isRecord(v) && typeof v.today === 'string' ? v.today : null
  const runs: Record<string, RunSummary> = {}
  const listed = isRecord(v) && isRecord(v.runs) ? v.runs : {}
  for (const [id, run] of Object.entries(listed)) {
    if (isRecord(run) && typeof run.name === 'string' && typeof run.status === 'string') {
      runs[id] = run as RunSummary
    }
  }
  return { today, runs }
}

// -- words round problems and failures --

/** The count over a pasted programme's problems. */
export function problemsLine(n: number): string {
  return `This programme has ${countOf(n, 'problem')}. Fix ${n === 1 ? 'it' : 'them'}, then check it again.`
}

/** The server's sentence ("a change starts today or later.") with a capital, to stand alone. */
export function sentenceCase(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1)
}

/** Why a request failed, in a line: what happened, then what to do. */
export function failureText(error: ApiError): string {
  if (error.kind === 'offline') {
    return 'Can’t reach the server, so nothing changed. Try again when you’re online.'
  }
  if (error.kind === 'server') {
    return 'The server had a problem, so nothing changed. Try again in a while.'
  }
  if (error.kind === 'auth') return 'Your session has ended. Sign in again.'
  if (error.kind === 'conflict') {
    return 'The plan changed on another device. Check it, then try again.'
  }
  switch (error.code) {
    case 'quota':
      return 'Your account is full, so nothing was saved.'
    case 'too-large':
      return 'That programme is too big. A programme is at most 128 KB.'
    case 'too-many':
      return 'There’s no room for another. Delete one you don’t need, then try again.'
    case 'ended':
      return 'This programme has ended, so it can’t change.'
    case 'not-found':
      return 'That programme is gone. It may have been deleted on another device.'
    case 'not-admin':
      return 'Only an admin can publish to the shared library.'
    default:
      return 'The server refused it, so nothing changed. Try again.'
  }
}

/** A duplicate's name, within the 60 characters a programme's name may have. */
export function copyName(name: string): string {
  return `Copy of ${name}`.slice(0, 60)
}

/** Where a change came from: the app, Ask, or an agent's connection. */
export function sourceText(source: string): string {
  if (source === 'app') return 'From the app'
  if (source === 'ask') return 'From Ask'
  return `From ${source}`
}

// -- changes in sentences --

type Names = Record<string, string>

function weeksText(weeks: unknown): string {
  return typeof weeks === 'number' ? `for ${countOf(weeks, 'week')}` : 'until resumed'
}

function increaseText(change: LogRow): string {
  if (typeof change.rate === 'number') return `${change.rate}% a week`
  return `${change.add} ${INCREASE_UNIT[String(change.field) as Field]} a week`
}

/** A change for the log (spec §9.2): "Barbell row set to 45 kg, from Mon 21 Dec." */
export function logSentence(change: LogRow, from: string, names: Names, log: LogEntry[]): string {
  const name = (key: unknown) => names[String(key)] ?? String(key)
  const on = `, from ${dayText(from)}.`
  switch (change.type) {
    case 'set-value':
      return `${name(change.activity)} set to ${valueText(String(change.field), Number(change.value))}${on}`
    case 'set-increase':
      return `${name(change.activity)} increase set to ${increaseText(change)}${on}`
    case 'edit-week':
      return `${name(change.activity)} set to ${valueText(String(change.field), Number(change.value))} in week ${change.week} only.`
    case 'pause-activity':
      return `${name(change.activity)} paused ${weeksText(change.weeks)}${on}`
    case 'resume-activity':
      return `${name(change.activity)} resumed${on}`
    case 'end-activity':
      return `${name(change.activity)} ended${on}`
    case 'add-activity':
      return `${(change.activity as DocActivity).name} added${on}`
    case 'pause-programme':
      return `Programme paused ${weeksText(change.weeks)}${on}`
    case 'resume-programme':
      return `Programme resumed at the ${change.at === 'next' ? 'next' : 'paused'} week${on}`
    case 'go-to-week':
      return `Programme moved to week ${change.week}${on}`
    case 'end-programme':
      // A restart's marker on a run already ended (K167) reads as the restart, not a second end.
      return change.restarted ? `Restarted from week 1${on}` : `Programme ended${on}`
    case 'reopen-programme':
      return `Programme re-opened${on}`
    case 'set-parameter':
      return `Parameter ${change.param} set to ${change.value}${on}`
    case 'undo': {
      const undone = log.find((e) => e.seq === change.change)
      return undone
        ? `Undid: ${logSentence(undone.change, undone.from, names, log)}`
        : 'Undid a change.'
    }
  }
}

/** The change at the top of the sheet's step 2: the field first, "Weight 45 kg from Mon 21 Dec". */
export function summarySentence(
  change: Change,
  from: string,
  names: Names,
  log: LogEntry[],
): string {
  if (change.type === 'set-value' || change.type === 'edit-week') {
    const field = String(change.field) as Field
    const value = `${FIELD_WORDS[field].noun} ${valueText(field, Number(change.value))}`
    return change.type === 'edit-week'
      ? `${value} in week ${change.week} only.`
      : `${value} from ${dayText(from)}, from then on.`
  }
  return logSentence(change, from, names, log)
}

/** The change on the plan's preview bar (K148): "Barbell row at 45 kg from Mon 21 Dec." */
export function barSentence(change: Change, from: string, names: Names, log: LogEntry[]): string {
  if (change.type === 'set-value') {
    const name = names[String(change.activity)] ?? String(change.activity)
    return `${name} at ${valueText(String(change.field), Number(change.value))} from ${dayText(from)}.`
  }
  return logSentence(change, from, names, log)
}

/** The line that calms, under the preview: what the change leaves as it is. */
export function calmLine(
  change: { type: string; week?: unknown },
  from: string,
  weeks: number,
): string {
  const before = `Nothing before ${dayText(from)} changes.`
  if (change.type !== 'edit-week' || typeof change.week !== 'number' || change.week >= weeks) {
    return before
  }
  const next = change.week + 1
  const after =
    next === weeks ? `Week ${weeks} stays as it is.` : `Weeks ${next} to ${weeks} stay as they are.`
  return `${after} ${before}`
}

// -- the change a sheet sends --

/** One choice in the sheet's Change menu: a kind of change, and the field for a Set. */
export type ChangeOption = { kind: ChangeKind; field: Field | null }

/** How a sheet opens: its title, the changes it offers, and what is chosen to begin with. */
export type SheetStart = {
  title: string
  options: ChangeOption[]
  kind: ChangeKind
  field: Field | null
  activity: string | null
  from: string
  scope: 'on' | 'once'
  /** For Undo: the change it reverses. */
  undo: number | null
}

/** What the sheet's fields hold, as typed. */
export type SheetForm = {
  kind: ChangeKind
  activity: string | null
  field: Field | null
  value: string
  from: string
  scope: 'on' | 'once'
  weeks: string
  at: 'paused' | 'next'
  week: string
  reason: string
  undo: number | null
  add: Record<'name' | Field, string>
}

/** A sheet's fields, empty, for a change of `kind` from `from`. */
export function emptyForm(kind: ChangeKind, from: string): SheetForm {
  return {
    kind,
    activity: null,
    field: null,
    value: '',
    from,
    scope: 'on',
    weeks: '',
    at: 'paused',
    week: '',
    reason: '',
    undo: null,
    add: { name: '', weight: '', reps: '', duration: '', distance: '', sets: '', target: '' },
  }
}

/** The calendar week of the grid holding `day`, or null when the grid has none. */
export function weekOf(grid: Grid, day: string): GridWeek | null {
  return grid.weeks.find((w) => w.monday <= day && day <= addDays(w.monday, 6)) ?? null
}

/** The programme week `day` falls in, as the server's grid has it. */
export function programmeWeekOn(grid: Grid, day: string): number | null {
  return weekOf(grid, day)?.days.find((d) => d.date === day)?.programmeWeek ?? null
}

function addDays(iso: string, n: number): string {
  const d = local(iso)
  d.setDate(d.getDate() + n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The field an activity's increase works on and how (`add` or `rate`), from the run's document or
 * the change that added it; null for an activity whose values don't progress.
 */
export function increaseOf(
  doc: ProgrammeDoc,
  log: LogEntry[],
  key: string,
): { field: Field; how: 'add' | 'rate' } | null {
  const added = log.find(
    (e) => e.change.type === 'add-activity' && (e.change.activity as DocActivity).key === key,
  )
  const activity =
    doc.activities.find((a) => a.key === key) ?? (added?.change.activity as DocActivity | undefined)
  if (!activity) return null
  for (const field of ['weight', 'reps', 'duration', 'distance', 'sets', 'target'] as Field[]) {
    const rule = activity[field]
    if (isRecord(rule) && ('rate' in rule || 'add' in rule)) {
      return { field, how: 'rate' in rule ? 'rate' : 'add' }
    }
  }
  return null
}

/** The label of an increase's field: "Increase in kg a week", "Increase in % a week". */
export function increaseLabel(increase: { field: Field; how: 'add' | 'rate' }): string {
  const unit = increase.how === 'rate' ? '%' : INCREASE_UNIT[increase.field]
  return `Increase in ${unit} a week`
}

/** A number as typed, with a comma for a decimal point too; left as typed for the server to refuse. */
export function numberOf(text: string): number | string {
  const trimmed = text.trim().replace(',', '.')
  const n = Number(trimmed)
  return trimmed !== '' && Number.isFinite(n) ? n : text.trim()
}

/** The change, from day and reason a sheet's fields make, for the server to preview. */
export function changeBody(
  form: SheetForm,
  ctx: { grid: Grid; doc: ProgrammeDoc; log: LogEntry[]; kind: ProgrammeKind; drop: number[] },
): ChangeRequest {
  const drop = ctx.drop.length ? { dropHandEdits: ctx.drop } : {}
  const weeks = form.weeks.trim() ? { weeks: numberOf(form.weeks) } : {}
  let change: Change
  switch (form.kind) {
    case 'set-value':
      change =
        form.scope === 'once'
          ? {
              type: 'edit-week',
              activity: form.activity,
              week: programmeWeekOn(ctx.grid, form.from),
              field: form.field,
              value: numberOf(form.value),
            }
          : {
              type: 'set-value',
              activity: form.activity,
              field: form.field,
              value: numberOf(form.value),
              ...drop,
            }
      break
    case 'set-increase': {
      const increase = increaseOf(ctx.doc, ctx.log, form.activity!)
      change = {
        type: 'set-increase',
        activity: form.activity,
        field: increase?.field ?? null,
        [increase?.how ?? 'add']: numberOf(form.value),
        ...drop,
      }
      break
    }
    case 'pause-activity':
      change = { type: 'pause-activity', activity: form.activity, ...weeks }
      break
    case 'resume-activity':
      change = { type: 'resume-activity', activity: form.activity, ...drop }
      break
    case 'end-activity':
      change = { type: 'end-activity', activity: form.activity }
      break
    case 'pause-programme':
      change = { type: 'pause-programme', ...weeks }
      break
    case 'resume-programme':
      change = { type: 'resume-programme', at: form.at }
      break
    case 'go-to-week':
      change = { type: 'go-to-week', week: numberOf(form.week) }
      break
    case 'add-activity': {
      const taken = ctx.grid.activities.map((a) => a.key)
      const activity: Record<string, unknown> = {
        key: activityKey(form.add.name, taken),
        name: form.add.name.trim(),
      }
      for (const field of fieldsOf(ctx.kind)) {
        if (form.add[field].trim()) activity[field] = numberOf(form.add[field])
      }
      change = { type: 'add-activity', activity }
      break
    }
    default:
      change = { type: 'undo', change: form.undo }
  }
  const reason = form.reason.trim()
  return { change, from: form.from, ...(reason ? { reason } : {}) }
}

/** A key for a new activity from its name: a-z, 0-9 and -, at most 40, unique in the run. */
export function activityKey(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'activity'
  let key = base
  for (let n = 2; taken.includes(key); n++) key = `${base.slice(0, 40 - String(n).length - 1)}-${n}`
  return key
}

/** The Change menu's words for an option. */
export function optionLabel(option: ChangeOption): string {
  switch (option.kind) {
    case 'set-value':
      return FIELD_WORDS[option.field!].set
    case 'set-increase':
      return 'Set increase'
    case 'pause-activity':
      return 'Pause activity'
    case 'resume-activity':
      return 'Resume activity'
    case 'end-activity':
      return 'End activity'
    case 'pause-programme':
      return 'Pause programme'
    case 'resume-programme':
      return 'Resume programme'
    case 'go-to-week':
      return 'Go to week'
    case 'add-activity':
      return 'Add activity'
    default:
      return 'Undo'
  }
}

/**
 * The changes an activity offers on `day` (today by default): Set for each field it has, Set
 * increase when its values progress, Pause or Resume as it stands that day, and End.
 */
export function activityOptions(run: Run, key: string, day = run.today): ChangeOption[] {
  const cell = (weekOf(run.grid, day) ?? run.grid.weeks.at(-1))?.cells[key]
  const values = cell?.values ?? {}
  const sets: ChangeOption[] = fieldsOf(run.kind)
    .filter((f) => values[f] !== undefined)
    .map((field) => ({ kind: 'set-value', field }))
  const increase: ChangeOption[] = increaseOf(run.doc, run.log, key)
    ? [{ kind: 'set-increase', field: null }]
    : []
  const paused = cell?.state === 'paused' || (!!cell?.until && cell.until > day)
  return [
    ...sets,
    ...increase,
    { kind: paused ? 'resume-activity' : 'pause-activity', field: null },
    { kind: 'end-activity', field: null },
  ]
}

/** The programme's changes, from the overview's controls. */
export function programmeOptions(run: Pick<Run, 'status'>): ChangeOption[] {
  return [
    { kind: run.status === 'paused' ? 'resume-programme' : 'pause-programme', field: null },
    { kind: 'go-to-week', field: null },
    { kind: 'add-activity', field: null },
  ]
}

/** A short date for a hand-edit: "23 Oct". */
export function madeOnText(iso: string): string {
  return dateText(iso)
}

/** The start preview's line: "Eight weeks, Mon 26 Oct to Sun 20 Dec. Deload in weeks 4 and 8." */
export function startLine(preview: StartPreview): string {
  const span = preview.end
    ? `${numberWord(preview.weeks, true)} weeks, ${dayText(preview.start)} to ${dayText(preview.end)}.`
    : `${numberWord(preview.weeks, true)} weeks from ${dayText(preview.start)}.`
  return [span, ...labelLines(preview.grid)].join(' ')
}

/** A plan's week labels, one sentence each: "Deload in weeks 4 and 8." */
export function labelLines(grid: Grid): string[] {
  const labels = new Map<string, number[]>()
  for (const week of grid.weeks) {
    if (week.label)
      labels.set(week.label, [...(labels.get(week.label) ?? []), ...week.programmeWeeks])
  }
  return [...labels].map(
    ([label, weeks]) => `${label} in ${weekName({ programmeWeeks: weeks }).toLowerCase()}.`,
  )
}
