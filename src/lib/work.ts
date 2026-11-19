import {
  weekName,
  type Run,
  type WorkActivity,
  type WorkMeasure,
  type WorkSeries,
} from '@/lib/programmes'

/**
 * The work charts' words (K179–K181, work-charts spec §5): amounts with a thousands separator, the
 * line over each chart, and the sentence naming the activities the total leaves out. Every amount
 * is the server's (W4): this module only words them.
 */

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const TENTHS = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const TICK = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

/** "3,150 kg", "180 s", "12.5 km": km keeps one decimal, every other unit none (spec §5). */
export function amountText(value: number, unit: string): string {
  return `${(unit === 'km' ? TENTHS : WHOLE).format(value)} ${unit}`
}

/** A value axis's tick: "5,000", "2.5". */
export function tickText(value: number): string {
  return TICK.format(value)
}

/** What each measure counts, in words for a chart's title and its name for a screen reader. */
const MEASURE_WORDS: Record<WorkMeasure, string> = {
  work: 'work in kg',
  reps: 'total reps',
  seconds: 'seconds held',
  distance: 'distance in km',
  time: 'time in minutes',
}

/** An activity's title over its chart: its name, and what it counts when that isn't work in kg
 * ("Plank, seconds held"). */
export function activityTitle(activity: WorkActivity): string {
  return activity.measure === 'work'
    ? activity.name
    : `${activity.name}, ${MEASURE_WORDS[activity.measure]}`
}

/** A chart's name for a screen reader: "Back squat: work in kg planned and done, week by week". */
export function chartLabel(name: string, measure: WorkMeasure): string {
  return `${name}: ${MEASURE_WORDS[measure]} planned and done, week by week`
}

/** The line over a chart: its value in ink at 600, between the words. */
export type WorkLine = { before: string; value: string; after: string }

/**
 * "Week 4: **3,150 kg** of 4,725 kg planned. 12,400 kg done so far." (spec §5). An activity without
 * weight leaves out the last sentence: "Week 4: **180 s** of 270 s planned." With no current week
 * in the series (the run has ended, or not started), the line counts the whole programme: "In all:
 * **30,150 kg** of 37,800 kg planned."
 */
export function workLine(series: WorkSeries, current: string | null, soFar: boolean): WorkLine {
  const amount = (v: number) => amountText(v, series.unit)
  const done = series.weeks.reduce((sum, w) => sum + (w.done ?? 0), 0)
  const week = series.weeks.find((w) => w.monday === current)
  if (!week) {
    const planned = series.weeks.reduce((sum, w) => sum + w.planned, 0)
    return { before: 'In all: ', value: amount(done), after: ` of ${amount(planned)} planned.` }
  }
  return {
    before: `${weekName(week)}: `,
    value: amount(week.done ?? 0),
    after: ` of ${amount(week.planned)} planned.${soFar ? ` ${amount(done)} done so far.` : ''}`,
  }
}

/** Names joined as a sentence says them: "Plank", "Plank and Run", "Plank, Run and Stretch". */
export function listText(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * The sentence under the total naming what it leaves out (spec §5): "Plank has no weight, so it is
 * not in the total.", "Plank and Run have no weight, so they are not in the total."; null when it
 * leaves nothing out.
 */
export function leftOutLine(names: string[]): string | null {
  if (!names.length) return null
  const one = names.length === 1
  return `${listText(names)} ${one ? 'has' : 'have'} no weight, so ${one ? 'it is' : 'they are'} not in the total.`
}

/** This week's Monday in the run's grid, which picks each chart's band; null when no week is. */
export function currentMonday(run: Run): string | null {
  return run.grid.weeks.find((w) => w.current)?.monday ?? null
}

/** A week a chart lays out: its Monday and the programme week(s) it holds. */
export type FrameWeek = { monday: string; programmeWeeks: number[] }

/**
 * The weeks every chart of a run lays out: the grid's, as the total's weeks follow them (spec §3).
 * An activity's weeks can be fewer (none before it was added or after it ended); laid on these,
 * its columns line up with the total's and every other activity's.
 */
export function workFrame(run: Run): FrameWeek[] {
  return run.grid.weeks.map((w) => ({ monday: w.monday, programmeWeeks: w.programmeWeeks }))
}
