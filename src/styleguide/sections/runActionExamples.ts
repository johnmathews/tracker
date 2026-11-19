import type { Outcome, Problem, Run } from '@/lib/programmes'
import {
  dayBefore,
  type Confirmed,
  type ReopenPreview,
  type RestartPreview,
  type RunActionBody,
  type RunActionPreview,
} from '@/lib/runActions'
import { RUN, TODAY } from './programmeExamples'

/**
 * The runs the ChangeSheet card's run sheet opens on (K168), from the ProgrammeGrid section's
 * programme on Wed 16 Dec, and a fake server for their previews and confirms: nothing is sent.
 */

/** End programme stopped it from Mon 14 Dec, in week 4, for the knee: a re-open applies. */
export const ENDED_EARLY: Run = {
  ...RUN,
  status: 'ended',
  end: '2026-12-13',
  ended: { from: '2026-12-14', reason: 'Knee', seq: 9 },
  canReopen: true,
}

/** Still running, with an end set from Mon 28 Dec, week 6. */
export const ENDING: Run = {
  ...RUN,
  end: '2026-12-27',
  ended: { from: '2026-12-28', reason: null, seq: 9 },
  canReopen: true,
}

function local(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
function addDays(iso: string, days: number): string {
  const d = local(iso)
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** The Sunday ending `day`'s week. */
function sunday(day: string): string {
  return addDays(day, (7 - local(day).getDay()) % 7)
}

function refused(problems: Problem[]): Outcome<never> {
  return { ok: false, problems, message: null }
}

/** A restart's preview, as the server words its problems. */
function restartPreview(run: Run, body: RunActionBody): Outcome<RestartPreview> {
  const name = (body.name ?? '').trim()
  const start = body.start ?? TODAY
  if (!name) return refused([{ path: 'name', message: 'give the tracker a name.' }])
  if (start < TODAY) {
    return refused([{ path: 'start', message: 'the programme starts today or later.' }])
  }
  const end = addDays(sunday(start), 7 * (run.weeks - 1))
  return {
    ok: true,
    data: {
      preview: true,
      rev: 'sg-rev-1',
      restart: {
        name,
        start,
        firstWeek: { from: start, to: sunday(start) },
        weeks: run.weeks,
        end,
        oldEndsFrom: run.status === 'ended' ? null : start,
      },
    },
  }
}

/** A re-open's preview: from the day asked, at week 4 (ended) or week 6 (ending). */
function reopenPreview(run: Run, body: RunActionBody): Outcome<ReopenPreview> {
  const from = body.from ?? TODAY
  const ended = run.ended!.from
  if (from < TODAY) {
    return refused([{ path: 'from', message: 'the programme re-opens today or later.' }])
  }
  const week = run.status === 'ended' ? 4 : 6
  const end = addDays(sunday(from), 7 * (run.weeks - week))
  return {
    ok: true,
    data: {
      preview: true,
      rev: 'sg-rev-1',
      reopen: {
        from,
        reason: body.reason ?? null,
        week,
        paused: from > ended ? { from: ended, to: dayBefore(from) } : null,
        end,
        lastWeek: addDays(end, -6),
      },
    },
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A fake server for the run sheet on `run`: each answer comes after `delay` ms, so the pressed
 * button shows it is busy. With `staleOnce`, the first confirm finds the run changed since the
 * preview (409) and sends the fresh preview back; the next one goes through.
 */
export function runActionServer(run: Run, { delay = 0, staleOnce = false } = {}) {
  let stale = staleOnce
  const previewOf = (body: RunActionBody): Outcome<RunActionPreview> =>
    'name' in body || 'start' in body ? restartPreview(run, body) : reopenPreview(run, body)
  return {
    async preview(body: RunActionBody): Promise<Outcome<RunActionPreview>> {
      await wait(delay)
      return previewOf(body)
    },
    async confirm(body: RunActionBody): Promise<Confirmed<unknown, RunActionPreview>> {
      await wait(delay)
      const res = previewOf(body)
      if (stale && res.ok) {
        stale = false
        return { ok: false, stale: { ...res.data, rev: 'sg-rev-2' } }
      }
      return res.ok ? { ok: true, data: RUN } : res
    },
  }
}
