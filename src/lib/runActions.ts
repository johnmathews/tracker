import { dayText, reasonText, type Outcome, type Run } from '@/lib/programmes'

/**
 * Restart and Re-open on a run's overview (K164, K165, K167, K168): the bodies the two routes
 * take, the previews they send back, and the words the sheet shows for them. Every number and day
 * comes from the server's preview (P4); this only words them.
 */

/** `POST /api/runs/{tracker}/restart`'s body, less `preview` and `rev`. */
export type RestartBody = { name?: string; start?: string }
/** `POST /api/runs/{tracker}/reopen`'s body, less `preview` and `rev`. */
export type ReopenBody = { from?: string; reason?: string }

/** A restart's preview: the new tracker's name and start, week 1, its weeks and last day. */
export type RestartPreview = {
  preview: true
  rev: string
  restart: {
    name: string
    start: string
    firstWeek: { from: string; to: string }
    weeks: number
    end: string | null
    /** The day the old run ends from; null when it has ended by then. */
    oldEndsFrom: string | null
  }
}
/** A re-open's preview: its day and reason, the week it resumes at, the paused days, the end. */
export type ReopenPreview = {
  preview: true
  rev: string
  reopen: {
    from: string
    reason: string | null
    week: number | null
    paused: { from: string; to: string } | null
    end: string | null
    lastWeek: string | null
  }
}
/** A confirmed restart: the new tracker and its run (the old tracker comes back too). */
export type Restarted = { tracker: { id: string; name?: string }; run: Run; old: unknown }

/** A confirm's outcome: a stale `rev` brings the action previewed again (409 `conflict`). */
export type Confirmed<T, P> = Outcome<T> | { ok: false; stale: P }

/** What the run sheet does: Re-open programme, Restart from week 1, or Cancel the end. */
export type RunAction = 'reopen' | 'restart' | 'cancel-end'
export type RunActionBody = RestartBody & ReopenBody
export type RunActionPreview = RestartPreview | ReopenPreview

/** Why a re-open was refused (409 `cant-reopen`): the run changed since the overview read it. */
export const CANT_REOPEN =
  'This programme changed since its page opened, so it can’t be re-opened now.'

/** A `YYYY-MM-DD` day at local midnight. */
function local(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

function iso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The day before `day`: an end's last day, from its first day without. */
export function dayBefore(day: string): string {
  const d = local(day)
  d.setDate(d.getDate() - 1)
  return iso(d)
}

/** Days as a span with weekdays: "Mon 16 to Wed 18 Nov", or one day: "Mon 16 Nov". */
export function daysText(from: string, to: string): string {
  if (from === to) return dayText(from)
  const [a, b] = [local(from), local(to)]
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
  const first = sameMonth ? dayText(from).split(' ').slice(0, 2).join(' ') : dayText(from)
  return `${first} to ${dayText(to)}`
}

/** Days as dates only: "23–29 Nov", or "30 Nov–6 Dec" across two months. */
export function datesText(from: string, to: string): string {
  const date = (day: string) => dayText(day).split(' ').slice(1)
  const [[d1, m1], [d2, m2]] = [date(from), date(to)]
  return m1 === m2 ? `${d1}–${d2} ${m2}` : `${d1} ${m1}–${d2} ${m2}`
}

function weeksText(n: number): string {
  return `${n} ${n === 1 ? 'week' : 'weeks'}`
}

/** One line of the preview's "What it does": the thing, a hint under it, and its value. */
export type PreviewRow = { name: string; hint: string; value: string }
/** The preview in words: the sentence on its tile, its reason, the list, and the calm line. */
export type PreviewWords = { summary: string; reason: string; rows: PreviewRow[]; calm: string }

function weekOn(day: string, week: number | null): string {
  return week === null ? dayText(day) : `${dayText(day)}, week ${week}`
}

/** A re-open's preview in words, or Cancel the end's (a re-open from the end's own day). */
function reopenWords(preview: ReopenPreview, run: Run, cancelEnd: boolean): PreviewWords {
  const { from, reason, week, paused, end } = preview.reopen
  return {
    summary: cancelEnd
      ? `Carries on past ${dayText(dayBefore(from))}, as planned.`
      : `Carries on from ${dayText(from)}${week === null ? '' : `, at week ${week}`}.`,
    reason: reasonText(reason),
    rows: [
      {
        name: 'Carries on',
        hint: cancelEnd ? 'From the day it was to end' : 'At the week it stopped in',
        value: weekOn(from, week),
      },
      paused
        ? {
            name: 'Paused',
            hint: 'The days since it ended count as a pause',
            value: daysText(paused.from, paused.to),
          }
        : { name: 'Paused', hint: '', value: 'No day' },
      {
        name: 'Last day',
        hint: `Week ${run.weeks}, as planned`,
        value: end ? dayText(end) : 'No last day',
      },
    ],
    calm: `Nothing before ${dayText(paused?.from ?? from)} changes.`,
  }
}

/** A restart's preview in words. */
function restartWords(preview: RestartPreview): PreviewWords {
  const { name, start, firstWeek, weeks, end, oldEndsFrom } = preview.restart
  const rows: PreviewRow[] = [
    { name: 'New tracker', hint: '', value: name },
    { name: 'Week 1', hint: '', value: datesText(firstWeek.from, firstWeek.to) },
    { name: 'Last day', hint: weeksText(weeks), value: end ? dayText(end) : 'No last day' },
  ]
  if (oldEndsFrom) {
    rows.push({ name: 'The run now', hint: '', value: `Ends ${dayText(dayBefore(oldEndsFrom))}` })
  }
  return {
    summary: `A new ${name}, from week 1 on ${dayText(start)}.`,
    reason: '',
    rows,
    calm: oldEndsFrom
      ? `This run ends from ${dayText(oldEndsFrom)} and keeps its weeks, marks, notes and changes.`
      : 'This run has ended and stays as it is, with its weeks, marks, notes and changes.',
  }
}

/** The sheet's step 2 for `action`, from the server's preview. */
export function previewWords(action: RunAction, preview: RunActionPreview, run: Run): PreviewWords {
  return 'restart' in preview
    ? restartWords(preview)
    : reopenWords(preview, run, action === 'cancel-end')
}

/** The run's state for the overview's controls (K168). */
export type RunControls =
  /** Ended by End programme part way: Re-open programme and Restart from week 1. */
  | 'ended-early'
  /** Ended any other way (its last Sunday, before it started, or by a restart): Restart only. */
  | 'ended'
  /**
   * Running or paused with an end set for a later day: no End programme, and Cancel the end in its
   * place while a re-open applies (not when a restart set the end).
   */
  | 'ending'
  /** Running, paused or not started, with no end set: the usual controls. */
  | 'running'

export function runControls(run: Pick<Run, 'status' | 'ended' | 'canReopen'>): RunControls {
  if (run.status === 'ended') return run.canReopen ? 'ended-early' : 'ended'
  return run.ended ? 'ending' : 'running'
}
