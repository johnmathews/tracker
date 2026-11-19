import {
  dayText,
  increaseOf,
  madeOnText,
  reasonText,
  runMeta,
  setsLine,
  valueText,
  weekCount,
  weekDates,
  weekName,
  weekOf,
  weekdayText,
  type ActivityState,
  type Cell,
  type DocActivity,
  type Field,
  type LogEntry,
  type Run,
} from '@/lib/programmes'

/**
 * The ProgrammeChart card's data (K145, spec §9.4): one activity of a run, week by week, as the
 * run's grid has it. Every value here is the server's (P4, one engine): this module picks the
 * field to chart, says where on the chart each value and change goes, and words them. It computes
 * no plan.
 */

/** One step of a week's line: from a fraction of the week (0 is Monday), at a value. */
export type Segment = { from: number; value: number }

export type ChartWeek = {
  monday: string
  /** The programme week(s) under its column: "4", or "4/5" for a week a change split. */
  number: string
  /** "Week 4", "Weeks 4 and 5": the table's and the panel's name for it. */
  name: string
  /** Its dates: "14–20 Dec". */
  dates: string
  /** An override's label, such as "Deload". */
  label: string | null
  state: ActivityState
  /** The planned value in the chart's unit as the week ends, or null when it isn't running. */
  value: number | null
  /** The week's steps: one, or one per value when a change split it. None unless running. */
  segments: Segment[]
  /** The plan in words: "45 kg, 3 × 5", "Paused, knee". */
  plan: string
  /** What was done against the week's goal, for this week and the weeks before it. */
  done: { done: number; target: number; met: boolean } | null
  /** "1 of 3 so far", "3 of 3, goal met", "2 of 3"; '' for a week to come. */
  doneText: string
  current: boolean
}

export type ActivityChart = {
  name: string
  field: Field
  /** The value axis's unit: "kg", "reps", "s", "min", "km". */
  unit: string
  /** The SVG's name for a screen reader. */
  label: string
  weeks: ChartWeek[]
  /** This week's column: -1 before the run starts, the last once it has ended. */
  now: number
  /** Each change of the charted field: where it took effect (a column and the part of it before
   * the from day) and its label. */
  changes: { at: number; label: string }[]
  /** Each run of paused weeks, by column, with its reason. */
  pauses: { from: number; to: number; reason: string | null }[]
  /**
   * The line over the chart: its value in ink at 600, between the words. A pause leads with its
   * own sentence, "Paused until Mon 28 Dec." or "Paused.", in paused-ink at 600 (K169).
   */
  lede: { lead: string | null; before: string; value: string | null; after: string }
  /** The server's sentence when the activity ends before the programme. */
  endsShort: string | null
}

/** The fields the chart can show, the progressing one first when it is one of them. */
const CHARTED: Field[] = ['weight', 'reps', 'duration', 'distance', 'sets', 'target']

/** A field's unit on the axis, and an increase's: a cardio session's time in minutes. */
const UNITS: Record<Field, string> = {
  weight: 'kg',
  reps: 'reps',
  duration: 's',
  distance: 'km',
  sets: 'sets',
  target: 'a week',
}

type Clock = { state: string; until: string | null; reason: string | null }

/** The activity's clock today, from the run's; none for an activity not in the run today. */
function clockOf(run: Run, key: string): Clock | undefined {
  return (run.clock.activities as Record<string, Clock> | undefined)?.[key]
}

/** A day's place in its week, Monday 0: the part of the week before it. */
function dayIndex(monday: string, day: string): number {
  const at = (iso: string) => Date.UTC(...(iso.split('-').map(Number) as [number, number, number]))
  return Math.round((at(day) - at(monday)) / 86_400_000)
}

/**
 * The progression a field follows, from the run's document or the change that added the activity.
 * Asked only of a field `increaseOf` says progresses, so there is one.
 */
function ruleOf(run: Run, key: string, field: Field): Record<string, unknown> {
  const added = run.log.find(
    (e) => e.change.type === 'add-activity' && (e.change.activity as DocActivity).key === key,
  )
  const activity =
    run.doc.activities.find((a) => a.key === key) ?? (added!.change.activity as DocActivity)
  return activity[field] as Record<string, unknown>
}

/** A number, or a parameter's value in the run. */
function numberOf(run: Run, v: unknown): number {
  return typeof v === 'string' && v.startsWith('$') ? run.params[v.slice(1)]! : Number(v)
}

/** "7.5% a week", "2.5 kg a week", "5 s every 2 weeks". */
function increaseWords(change: Record<string, unknown>, field: Field, every = 1): string {
  const how = typeof change.rate === 'number' ? `${change.rate}%` : `${change.add} ${UNITS[field]}`
  return `${how} ${every > 1 ? `every ${every} weeks` : 'a week'}`
}

/** The Set increase changes of the field, not undone, oldest first. */
function increases(run: Run, key: string, field: Field): LogEntry[] {
  return run.log
    .filter(
      (e) =>
        e.change.type === 'set-increase' &&
        e.change.activity === key &&
        e.change.field === field &&
        e.undoneBy === null,
    )
    .reverse()
}

/**
 * How the field goes up as of today: the latest Set increase in force, else the document's rule.
 * A Set increase keeps the rule's cadence (§8.1).
 */
function increaseNow(run: Run, key: string, field: Field): string {
  const rule = ruleOf(run, key, field)
  const every = Number(rule.every ?? 1)
  const latest = increases(run, key, field)
    .filter((e) => e.from <= run.today)
    .at(-1)
  if (latest) return increaseWords(latest.change, field, every)
  const how = 'rate' in rule ? { rate: numberOf(run, rule.rate) } : { add: numberOf(run, rule.add) }
  return increaseWords(how, field, every)
}

/** The field to chart: the one the activity progresses, else its first of weight, reps, time,
 * distance. */
function fieldOf(run: Run, key: string, cells: Cell[]): Field {
  const has = (f: Field) => cells.some((c) => c.values?.[f] !== undefined)
  const progressed = increaseOf(run.doc, run.log, key)?.field
  if (progressed && has(progressed)) return progressed
  return CHARTED.find(has) ?? 'target'
}

/** The change lines: the charted field's Set value and Set increase, not undone, in the grid. */
function changesOf(run: Run, key: string, field: Field): ActivityChart['changes'] {
  const out: ActivityChart['changes'] = []
  for (const e of run.log) {
    const c = e.change
    const ours = c.activity === key && c.field === field && e.undoneBy === null
    if (!ours || (c.type !== 'set-value' && c.type !== 'set-increase')) continue
    const column = run.grid.weeks.findIndex((w) => w.monday === weekOf(run.grid, e.from)?.monday)
    if (column < 0) continue
    const what =
      c.type === 'set-value' ? valueText(field, Number(c.value)) : increaseWords(c, field)
    out.push({
      at: column + dayIndex(run.grid.weeks[column]!.monday, e.from) / 7,
      label: `${what}, from ${madeOnText(e.from)}`,
    })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** The day before `iso`: an end's last day, from the first day without it. */
function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10)
}

/**
 * The chart of `key` in `run`, or null when the run has no such activity. The current week, the
 * weeks done, the pauses and every value come from the grid; the increase from the log, or the
 * document when the log has none.
 */
export function activityChart(run: Run, key: string): ActivityChart | null {
  const activity = run.grid.activities.find((a) => a.key === key)
  if (!activity) return null
  const cells = run.grid.weeks.map((w) => w.cells[key]).filter((c): c is Cell => !!c)
  const field = fieldOf(run, key, cells)
  // A cardio session's time reads in minutes; every other value as the server sends it.
  const minutes = field === 'duration' && run.kind === 'cardio'
  const shown = (v: number) => (minutes ? v / 60 : v)
  let now = run.grid.weeks.findIndex((w) => w.current)
  if (now < 0) now = run.today < run.grid.weeks[0]!.monday ? -1 : run.grid.weeks.length - 1

  const weeks = run.grid.weeks.map((week, i): ChartWeek => {
    const cell: Cell = week.cells[key] ?? {
      state: 'not-started',
      activityWeek: null,
      values: null,
      target: 0,
      splits: {},
      hand: {},
      until: null,
      reason: null,
    }
    const running = cell.state === 'running' && cell.values?.[field] !== undefined
    const splits = cell.splits[field]
    const segments: Segment[] = !running
      ? []
      : splits
        ? splits.map((s) => ({ from: dayIndex(week.monday, s.from) / 7, value: shown(s.value) }))
        : [{ from: 0, value: shown(cell.values![field]!) }]
    const done = i <= now && cell.target > 0 ? weekCount(cell) : null
    return {
      monday: week.monday,
      number: week.programmeWeeks.join('/') || '–',
      name: weekName(week),
      dates: weekDates(week.monday),
      label: week.label,
      state: cell.state,
      value: segments.at(-1)?.value ?? null,
      segments,
      plan: planText(run, cell, field),
      done,
      doneText: done
        ? `${done.done} of ${done.target}${i === now && week.current ? ' so far' : done.met ? ', goal met' : ''}`
        : '',
      current: week.current,
    }
  })

  const pauses: ActivityChart['pauses'] = []
  weeks.forEach((w, i) => {
    if (w.state !== 'paused') return
    const last = pauses.at(-1)
    if (last && last.to === i - 1) last.to = i
    else pauses.push({ from: i, to: i, reason: run.grid.weeks[i]!.cells[key]!.reason })
  })

  return {
    name: activity.name,
    field,
    unit: minutes ? 'min' : UNITS[field],
    label: `${activity.name}: planned ${field === 'duration' ? 'time' : field} for each week, with the weeks done so far`,
    weeks,
    now,
    changes: changesOf(run, key, field),
    pauses,
    lede: ledeOf(run, key, field, activity.endedOn),
    endsShort: run.endsShort.find((e) => e.key === key)?.message ?? null,
  }
}

/** A week's plan in words: the value (each, when a change split the week), then the sets line. */
function planText(run: Run, cell: Cell, field: Field): string {
  if (cell.state === 'paused') {
    return cell.reason ? `Paused, ${cell.reason.toLowerCase()}` : 'Paused'
  }
  if (cell.state === 'ended') return 'Ended'
  if (cell.state === 'not-started' || !cell.values) return 'Not started'
  const splits = cell.splits[field]
  const value = splits
    ? splits
        .map((s, i) =>
          i === 0
            ? valueText(field, s.value)
            : `then ${valueText(field, s.value)} from ${weekdayText(s.from)}`,
        )
        .join(', ')
    : valueText(field, cell.values[field]!)
  return [value, setsLine(cell.values, run.kind)].filter(Boolean).join(', ')
}

/** The line over the chart (ProgrammeChart card): this week's plan and how it goes up, or why
 * there is none. */
function ledeOf(
  run: Run,
  key: string,
  field: Field,
  endedOn: string | null,
): ActivityChart['lede'] {
  const none = (before: string) => ({ lead: null, before, value: null, after: '' })
  // An end reads by its last day, "Ended Sun 15 Nov.", as the overview's line says it (K168).
  if (run.status === 'ended') return none(runMeta(run).rest)
  if (endedOn && endedOn <= run.today) return none(`Ended ${dayText(dayBefore(endedOn))}.`)
  const reason = (v: unknown) => {
    const text = reasonText(typeof v === 'string' ? v : null)
    return text ? ` ${text}` : ''
  }
  // A pause leads with its sentence in paused-ink (K169), the reason after it.
  if (run.status === 'paused') {
    const until = run.clock.until ? ` until ${dayText(run.clock.until)}` : ''
    return {
      lead: `The programme is paused${until}.`,
      before: reason(run.clock.reason),
      value: null,
      after: '',
    }
  }
  const value = (cell: Cell | undefined) => {
    const v = cell?.values?.[field]
    return v === undefined ? null : valueText(field, v)
  }
  const thisWeek = run.grid.weeks.find((w) => w.current)
  const clock = clockOf(run, key)
  if (clock?.state === 'paused') {
    // "Paused until Mon 28 Dec. Knee. It comes back at 45 kg." (K169): the day leads, as in the
    // grid and the week; with no end day, "Paused. Knee. It comes back at 45 kg when you resume it."
    // A value the grid doesn't hold (it comes back after the grid ends) leaves the last part out.
    const lead = clock.until ? `Paused until ${dayText(clock.until)}.` : 'Paused.'
    const back = clock.until
      ? value(weekOf(run.grid, clock.until)?.cells[key] ?? thisWeek?.cells[key])
      : value(thisWeek?.cells[key])
    const why = reason(clock.reason)
    if (back === null) return { lead, before: why, value: null, after: '' }
    const after = clock.until ? '.' : ' when you resume it.'
    return { lead, before: `${why} It comes back at `, value: back, after }
  }
  const cell = thisWeek?.cells[key]
  if (cell?.state === 'running') {
    const progresses = increaseOf(run.doc, run.log, key)?.field === field
    const goes = progresses ? ` It goes up ${increaseNow(run, key, field)}.` : ''
    const sets = setsLine(cell.values!, run.kind)
    return {
      lead: null,
      before: thisWeek!.label ? `This week is a ${thisWeek!.label.toLowerCase()}: ` : 'This week: ',
      value: value(cell),
      after: `${sets ? `, ${sets}` : ''}.${goes}`,
    }
  }
  // Not running yet: the run, or the activity, starts later.
  const first = run.grid.weeks.find((w) => w.cells[key]?.state === 'running')
  if (!first) return none('')
  // A week the activity runs in has a day the programme runs.
  const day = first.days.find((d) => d.status === 'running')!.date
  return {
    lead: null,
    before: `It starts on ${dayText(day)} at `,
    value: value(first.cells[key]),
    after: '.',
  }
}
