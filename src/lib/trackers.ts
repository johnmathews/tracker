import {
  MAX_DAILY_PICK,
  MIN_DAILY_PICK,
  clamp,
  isRecord,
  normaliseText,
  type KnownSettings,
} from '@/lib/storage'
import {
  FIRST_NAMES,
  SECTIONS,
  SECTION_NAMES,
  TRACKER_TYPES,
  isSection,
  isTrackerKind,
  type TrackerTypeId,
} from '@/lib/trackerTypes'

/**
 * The account's trackers (K123, spec docs/specs/2026-11-14-account-trackers.md): each has an id,
 * a name, a kind, a position in the week, an optional daily target, and the weeks it covers. The
 * API's `validate.normalise_tracker` and `data.shows_in` hold the same rules, and the shared
 * fixtures in `fixtures/transfer/parse/` keep the two in step.
 */
export type TrackerInfo = {
  id: string
  name: string
  kind: TrackerTypeId
  /** The week's sort key, from 0; the week shows trackers by position, then by id. */
  position: number
  /** How many items a day make a met day; null for a kind with no daily target (cardio). */
  dailyTarget: number | null
  /** The Monday of the week it was created in; null for the first three. */
  startWeek: string | null
  /** The Monday of the first week it no longer shows in; null while it is live. */
  endWeek: string | null
}

/** A tracker as the API and the cache hold it: its revision counts its changes, as a plan's. */
export type Tracker = TrackerInfo & { rev: number }

/** A tracker's name, in characters (code points). */
export const MAX_TRACKER_NAME = 60
/** An account's trackers, ended ones included: a create or an import adds none past it. */
export const MAX_TRACKERS = 100
/** A tracker's position: a sort key, from 0. */
export const MAX_POSITION = 10_000

/** A tracker id: URL-safe, as `newId` makes them, so it can sit in a path. */
const TRACKER_ID = /^[A-Za-z0-9_-]{1,64}$/
const WEEK_KEY = /^\d{4}-\d{2}-\d{2}$/

/** A tracker id: 1 to 64 letters, digits, `-` or `_`, and never `__proto__`. */
export function isTrackerId(v: unknown): v is string {
  return typeof v === 'string' && TRACKER_ID.test(v) && v !== '__proto__'
}

/** A whole number from a JSON number, rounded as the API rounds; `fallback` for anything else. */
function toInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
}

function weekOrNull(v: unknown): string | null {
  return typeof v === 'string' && WEEK_KEY.test(v) ? v : null
}

/**
 * A tracker's name: trimmed and cut to MAX_TRACKER_NAME characters; null for anything that isn't
 * a string or for nothing left.
 */
export function normaliseTrackerName(v: unknown): string | null {
  return normaliseText(v, MAX_TRACKER_NAME) ?? null
}

/**
 * A file's or the API's tracker, or null. It needs a tracker id, a kind the registry has (each of
 * the first three ids its own kind) and a name that isn't blank, cut to MAX_TRACKER_NAME
 * characters. A bad position reads as `position` and is clamped to 0 to MAX_POSITION, a daily
 * target is clamped to 1 to 8 (the kind's default when it isn't a number, null for a kind
 * without one), and a week that isn't a week key reads as null. As the API's `normalise_tracker`.
 */
export function normaliseTracker(v: unknown, position: number): TrackerInfo | null {
  if (!isRecord(v) || !isTrackerId(v.id) || !isTrackerKind(v.kind)) return null
  if (isSection(v.id) && SECTIONS[v.id].id !== v.kind) return null
  const name = normaliseTrackerName(v.name)
  if (name === null) return null
  const fallback = TRACKER_TYPES[v.kind].dailyTarget
  return {
    id: v.id,
    name,
    kind: v.kind,
    position: clamp(toInt(v.position, position), 0, MAX_POSITION),
    dailyTarget:
      fallback === null
        ? null
        : clamp(toInt(v.dailyTarget, fallback), MIN_DAILY_PICK, MAX_DAILY_PICK),
    startWeek: weekOrNull(v.startWeek),
    endWeek: weekOrNull(v.endWeek),
  }
}

/**
 * A list's trackers: the valid ones, the first of each id, at most MAX_TRACKERS. Anything that
 * isn't a list reads as none. As the API's `normalise_trackers`.
 */
export function normaliseTrackers(v: unknown): TrackerInfo[] {
  const out: TrackerInfo[] = []
  if (!Array.isArray(v)) return out
  const seen = new Set<string>()
  for (const [i, raw] of v.entries()) {
    const tracker = normaliseTracker(raw, i)
    if (!tracker || seen.has(tracker.id)) continue
    seen.add(tracker.id)
    out.push(tracker)
    if (out.length === MAX_TRACKERS) break
  }
  return out
}

/**
 * Whether a tracker shows in the week whose Monday is `week` (spec §2): from its start week, or
 * always without one, up to but not including its end week. Week keys compare as dates.
 */
export function showsIn(t: Pick<TrackerInfo, 'startWeek' | 'endWeek'>, week: string): boolean {
  return (t.startWeek === null || t.startWeek <= week) && (t.endWeek === null || t.endWeek > week)
}

/** The trackers in the week's order: by position, then by id. Returns a new list. */
export function inOrder<T extends Pick<TrackerInfo, 'id' | 'position'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
}

/** The position a new tracker takes: after every other, ended ones included (the API's rule). */
export function nextPosition(list: readonly Pick<TrackerInfo, 'position'>[]): number {
  return Math.min(
    MAX_POSITION,
    list.reduce((n, t) => Math.max(n, t.position + 1), 0),
  )
}

/**
 * The account's first three trackers as the API's migration made them: Strength, Cardio and
 * Food, with the daily targets from `settings` (the defaults without any). A cache from before
 * trackers were the account's own maps onto them.
 */
export function firstTrackers(settings: Pick<KnownSettings, 'dailyPick' | 'foodPick'> | null) {
  return SECTION_NAMES.map((id, position): TrackerInfo => ({
    id,
    name: FIRST_NAMES[id],
    kind: SECTIONS[id].id,
    position,
    dailyTarget:
      SECTIONS[id].pickKey === null
        ? null
        : (settings?.[SECTIONS[id].pickKey] ?? SECTIONS[id].dailyTarget),
    startWeek: null,
    endWeek: null,
  }))
}
