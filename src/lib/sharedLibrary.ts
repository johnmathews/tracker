import {
  dayText,
  labelLines,
  type DocActivity,
  type ProgrammeKind,
  type SharedRef,
  type StartPreview,
} from '@/lib/programmes'
import { numberWord } from '@/lib/words'
import { webHost } from '@/lib/routes'

/**
 * The shared library's words on the Programmes page (docs/specs/2026-11-19-shared-library.md §7,
 * K171): the facts line a row and Publish's preview share, the day a shared copy was published,
 * and an activity's chip and link in the preview. Every fact comes from the server (P4).
 */

const KIND_NAMES: Record<ProgrammeKind, string> = {
  strength: 'Strength',
  mobility: 'Mobility',
  cardio: 'Cardio',
}

/** The line under the section's heading. */
export const SHARED_LEAD =
  'Programmes anyone with an account can copy. A copy is yours to change and start.'
/**
 * The shared preview's line over its grid (K173): "Eight weeks, at the programme's own values.
 * Deload in weeks 4 and 8. You choose your own values and start day when you start your copy."
 */
export function planLine(plan: StartPreview): string {
  return [
    `${numberWord(plan.weeks, true)} weeks, at the programme’s own values.`,
    ...labelLines(plan.grid),
    'You choose your own values and start day when you start your copy.',
  ].join(' ')
}

/** A shared row's button once it has been copied on this visit (K172). */
export const COPIED_LABEL = 'Added to library'

/**
 * Copy to library's question (K172). It warns when the library already has a programme of that
 * name, since a copy keeps no link to its original (S4) and copying again makes a second one.
 */
export function copyQuestion(
  name: string,
  library: readonly { name: string }[],
): { title: string; message: string; confirmLabel: string } {
  const key = name.trim().toLocaleLowerCase()
  const have = library.some((own) => own.name.trim().toLocaleLowerCase() === key)
  return {
    title: `Copy ${name} to your library?`,
    message: have
      ? `Your library already has a programme called ${name}. Copying adds another one.`
      : 'The copy is yours to change and start.',
    confirmLabel: 'Copy',
  }
}

/** Under Publish's preview (S2: a shared programme names no one). */
export const PUBLISH_WHO = 'Everyone with an account can see and copy it. Your name is not shown.'
/** Over a fresh preview, when the programme or its shared copy changed since the last one. */
export const PUBLISH_STALE = 'The programme changed since this preview. Check it, then publish.'

/** "Strength · 8 weeks · 5 activities": a library row's, a shared row's and the preview's. */
export function factsLine(p: { kind: ProgrammeKind; weeks: number; activities: number }): string {
  const weeks = p.weeks === 1 ? '1 week' : `${p.weeks} weeks`
  const activities = p.activities === 1 ? '1 activity' : `${p.activities} activities`
  return `${KIND_NAMES[p.kind]} · ${weeks} · ${activities}`
}

/** The day of a server time in seconds, in the browser's own day: "Tue 17 Nov". */
export function stampDay(seconds: number): string {
  const d = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return dayText(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
}

/** Publish again's line: what it replaces, and that copies stay (S3, S4). */
export function replacesLine(replaces: SharedRef): string {
  return `It replaces the shared copy from ${stampDay(replaces.updatedAt)}. Copies people have made stay as they are.`
}

/** The publish dialog's title: "Publish Strength 5×5", or "… again" when it replaces a copy. */
export function publishTitle(name: string, again: boolean): string {
  return again ? `Publish ${name} again` : `Publish ${name}`
}

/**
 * An activity's chip in the preview, from plain numbers only: "5 × 5", "3 × 8 each side". A
 * progression or a parameter changes week by week, so it has no one chip.
 */
export function activityChip(a: DocActivity): string | null {
  if (typeof a.sets !== 'number' || typeof a.reps !== 'number') return null
  return `${a.sets} × ${a.reps}${a.perSide === true ? ' each side' : ''}`
}

/** An activity's link, when it is a web address: where it goes, and the site that names it. */
export function activityLink(a: DocActivity): { href: string; host: string } | null {
  if (typeof a.link !== 'string') return null
  const host = webHost(a.link)
  return host ? { href: a.link.trim(), host } : null
}
