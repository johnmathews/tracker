import { ref, watch, type WatchStopHandle } from 'vue'
import { defineStore } from 'pinia'
import { request, type ApiError } from '@/lib/api'
import {
  isDetailsId,
  isItemId,
  isMark,
  isRecord,
  liftNotes,
  normaliseDetails,
  normaliseDetailsMap,
  normaliseLog,
  normalisePlans,
  normalisePortableSettings,
  parseJson,
  readKey,
  removeKey,
  writeKey,
  type DetailsMap,
  type KnownSettings,
  type Log,
  type Mark,
  type PortableSettings,
} from '@/lib/storage'
import type { Plans } from '@/lib/plans'
import { addDays, dateKey } from '@/lib/dates'
import { dayText, runsFromState, type RunSummary } from '@/lib/programmes'
import { numberWord } from '@/lib/words'
import { SECTIONS, SECTION_NAMES, TRACKER_TYPES, type Item } from '@/lib/trackerTypes'
import {
  MAX_TRACKERS,
  firstTrackers,
  isTrackerId,
  normaliseTracker,
  type Tracker,
  type TrackerInfo,
} from '@/lib/trackers'
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  buildExport,
  type ExportData,
  type ExportFile,
  type SectionData,
} from '@/lib/transfer'
import { useDetailsStore } from '@/stores/details'
import { usePlannerStore } from '@/stores/planner'
import { useTrackersStore } from '@/stores/trackers'

/**
 * Keeps the stores and the API in step (docs/architecture.md §7).
 *
 * The stores change state optimistically; a deep watch diffs that state against `base`, the last
 * state the server is known to hold, and turns each difference into an operation in a persisted
 * outbox. Operations go out one at a time, in order. Reads replace local state only when nothing
 * is waiting to go out, so a refresh can never undo an edit that hasn't reached the server yet.
 */

export const CACHE_PREFIX = 'tracker-cache-v6:'
export const OUTBOX_PREFIX = 'tracker-outbox-v6:'
/**
 * The server's today and the runs, as `/api/state` last gave them (programmes spec §8): kept
 * apart from the cache, so its format stays as it is, and read at start so a device offline still
 * knows which trackers are programmes. A stale today locks fewer days, never more: the server's
 * lock still holds.
 */
export const RUNS_PREFIX = 'tracker-runs-v1:'
/**
 * The names of earlier formats, newest first (K14): `-v5` from before trackers were the
 * account's own (K123), whose sections are the first three trackers' ids; `-v4` from before Cardio
 * (K90), which holds item details already; `-v3` from before item details (its plan items carry
 * their notes); `-v2` from before the solid and hatch drawings; `-v1` from before marks had kinds.
 * A tab still open on older code reads a mark it doesn't know as an empty day and writes its copy
 * back, which empties the boxes in every newer tab; it could also drop their queued marks. A new
 * format takes new names, so the two never read each other.
 * `src/lib/__tests__/format.spec.ts` fails a format change that keeps the old names. The app's
 * rename (K44) moved every `fitness-planner-…` key to `tracker-…` before the stores start
 * (`migrateKeyPrefix`), so the earlier versions are found under the new prefix.
 */
export const OLD_CACHE_PREFIXES = [
  'tracker-cache-v5:',
  'tracker-cache-v4:',
  'tracker-cache-v3:',
  'tracker-cache-v2:',
  'tracker-cache-v1:',
] as const
export const OLD_OUTBOX_PREFIXES = [
  'tracker-outbox-v5:',
  'tracker-outbox-v4:',
  'tracker-outbox-v3:',
  'tracker-outbox-v2:',
  'tracker-outbox-v1:',
] as const
/** The earlier formats that hold item details already (D2): they move as they are, lifting nothing. */
const WITH_DETAILS: readonly string[] = [
  'tracker-cache-v5:',
  'tracker-outbox-v5:',
  'tracker-cache-v4:',
  'tracker-outbox-v4:',
]

/**
 * A change for the server. `section` is a tracker id (K123): the first three trackers keep the old
 * section names, so an outbox from before trackers were the account's own sends as it is.
 */
export type Op =
  | { kind: 'plan'; section: string; week: string }
  | { kind: 'tick'; section: string; week: string; item: string; day: number; mark: Mark | null }
  /**
   * `lifted`: queued by `moveOldKeys` from a `-v3` cache whose plan writes were still queued. The
   * server's rev 1 is then migration 7's copy of the old note, which this one replaces.
   */
  | { kind: 'details'; section: string; item: string; lifted?: true }
  | { kind: 'settings' }
  /** A tracker made here: sent with its id, so sending it again is safe. */
  | { kind: 'tracker-create'; section: string }
  /** A tracker's name, position or daily target, sent with the revision last seen. */
  | { kind: 'tracker-patch'; section: string }
  /** Delete tracker (K122): the tracker ends from `week`, the week that was on screen. */
  | { kind: 'tracker-end'; section: string; week: string }

/**
 * An operation in the outbox. Plan, details, settings and tracker operations read their values
 * when sent, so two versions of one look alike; the id tells a newer one from the one already in
 * flight.
 */
type Queued = Op & { id: string }

type Tracked = { plans: Plans<unknown>; log: Log; details: DetailsMap }
type Revs = Record<string, Record<string, number>>
/**
 * One tracker's part of the cache: its plans, log and items' details, the plans' revisions by
 * week, and the details' by item id (`detailRevs` also lists items whose details were cleared,
 * which `details` leaves out).
 */
type SectionState = {
  plans: Plans<Item>
  log: Log
  details: DetailsMap
  revs: Record<string, number>
  detailRevs: Record<string, number>
}
/**
 * The cache: the account's trackers with their revisions, each tracker's data by id, and the
 * settings. `GET /api/state` sends the same, with each tracker's details and their revisions under
 * keys of their own (`stateFromApi`).
 */
export type SyncState = {
  trackers: Tracker[]
  sections: Record<string, SectionState>
  settings: KnownSettings | null
}
/** The settings the diff compares: the daily picks are the trackers' (K123). */
type SettingsSnapshot = Omit<PortableSettings, 'dailyPick' | 'foodPick'>
type Snapshot = {
  trackers: Record<string, TrackerInfo>
  sections: Record<string, Tracked>
  settings: SettingsSnapshot
}
/**
 * What `POST /api/import` added; `conversations` counts Ask's and `trackers` the trackers the
 * account didn't have (docs/api.md §3).
 */
export type ImportAdded = {
  trackers?: number
  weeks: number
  ticks: number
  details: number
  settings: boolean
  conversations: number
}
export type ImportOutcome =
  | { ok: true; added: ImportAdded }
  | { ok: false; code: 'offline' | 'server' | 'auth' | 'quota' | 'error' }

export const CONFLICT_NOTICE =
  'A plan was changed on another device, so this device now shows that version.'
export const DETAILS_CONFLICT_NOTICE =
  'An item’s notes or details were changed on another device, so this device now shows that version.'
export const TRACKER_CONFLICT_NOTICE =
  'A tracker was changed on another device, so this device now shows that version.'
/** A write refused because the account is at its quota (413 `quota`, docs/api.md §3). */
export const QUOTA_NOTICE = 'Your account is full, so a change was undone here.'
/** A new tracker refused because the account already holds the most it may (409 `too-many`). */
export const TRACKER_FULL_NOTICE =
  'The account already holds 100 trackers, deleted ones included, so the new tracker was removed here.'
export const REFUSED_NOTICE =
  'The server refused a change, so it was undone here. Reload to see what was saved.'
/** What a programme's plan write refused (409 `programme-tracker`) says, naming the tracker. */
export function programmeNotice(tracker: string): string {
  return `Your change to ${tracker}’s plan wasn’t saved: a programme’s plan changes only through its own controls, so it was undone here.`
}

/**
 * What marks refused as too late (409 `locked-day`, spec §8) say: the first by its item and day,
 * and how many more. The app never drops a mark silently.
 */
export function lateNotice(marks: { name: string; day: string }[]): string {
  const [first] = marks
  if (marks.length === 1) {
    return `Your mark for ${first!.name} on ${first!.day} reached the server too late: that day is locked, so it was undone here.`
  }
  return `Your marks for ${first!.name} on ${first!.day} and ${numberWord(marks.length - 1)} more reached the server too late: those days are locked, so they were undone here.`
}

const FIRST_RETRY = 5_000
const MAX_RETRY = 60_000
/**
 * How long a details operation waits after its item's last change before it is sent. Notes save as
 * you type (ItemPage card): queued at once, an edit survives a reload, and waiting for the typing
 * to pause sends one write rather than one per key.
 */
export const DETAILS_DELAY = 1_000

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/**
 * The compile-time check that every operation kind is handled: `op` is `never` once they are, so
 * a kind without a branch fails to type-check. Never reached at run time: `isQueued` keeps any
 * other kind out of the outbox.
 */
/* v8 ignore next 3 */
function unhandled(op: never): never {
  throw new Error(`sync: no handler for ${JSON.stringify(op)}`)
}

/** What a queued operation replaces: one per plan, cell, item's details, settings and tracker change. */
function opKey(op: Op): string {
  switch (op.kind) {
    case 'plan':
      return `plan/${op.section}/${op.week}`
    case 'tick':
      return `tick/${op.section}/${op.week}/${op.item}/${op.day}`
    case 'details':
      return `details/${op.section}/${op.item}`
    case 'settings':
      return 'settings'
    case 'tracker-create':
    case 'tracker-patch':
    case 'tracker-end':
      return `${op.kind}/${op.section}`
    /* v8 ignore next 2 */
    default:
      return unhandled(op)
  }
}

const WEEK_KEY = /^\d{4}-\d{2}-\d{2}$/

/** A tick queued before marks had kinds: `done: true` is a great day, `done: false` an empty one. */
function upgradeQueued(v: unknown): unknown {
  if (!isRecord(v) || v.kind !== 'tick' || 'mark' in v || typeof v.done !== 'boolean') return v
  const { done, ...rest } = v
  return { ...rest, mark: done ? 'great' : null }
}

/**
 * An outbox entry this version can send; a damaged or foreign one is skipped, not stuck on. A tick
 * queued before marks had kinds carries `done` instead of `mark`; `upgradeQueued` reads it.
 */
function isQueued(v: unknown): v is Queued {
  if (!isRecord(v) || typeof v.id !== 'string') return false
  if (v.kind === 'settings') return true
  const sectionOk = isTrackerId(v.section)
  if (v.kind === 'tracker-create' || v.kind === 'tracker-patch') return sectionOk
  if (v.kind === 'details') {
    const liftedOk = v.lifted === undefined || v.lifted === true
    return sectionOk && liftedOk && typeof v.item === 'string' && isItemId(v.item)
  }
  const weekOk = typeof v.week === 'string' && WEEK_KEY.test(v.week)
  if (v.kind === 'plan' || v.kind === 'tracker-end') return sectionOk && weekOk
  return (
    v.kind === 'tick' &&
    sectionOk &&
    weekOk &&
    typeof v.item === 'string' &&
    (v.mark === null || isMark(v.mark)) &&
    Number.isInteger(v.day) &&
    (v.day as number) >= 0 &&
    (v.day as number) <= 6
  )
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** A revision: a whole number above 0; null for anything else. */
function revOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

function revsOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isRecord(v)) return out
  for (const [key, raw] of Object.entries(v)) {
    const rev = revOf(raw)
    if (rev !== null) out[key] = rev
  }
  return out
}

/** `v[key]` when `v` is an object that has it as its own; undefined otherwise. */
function own(v: unknown, key: string): unknown {
  return isRecord(v) && Object.hasOwn(v, key) ? v[key] : undefined
}

/** A tracker without its revision: what the stores hold. */
function infoOf(t: Tracker): TrackerInfo {
  const { id, name, kind, position, dailyTarget, startWeek, endWeek } = t
  return { id, name, kind, position, dailyTarget, startWeek, endWeek }
}

/** A tracker from the API, validated as a file's is, with its revision (0 when it has none). */
function storedTracker(v: unknown, position: number): Tracker | null {
  const info = normaliseTracker(v, position)
  return info && { ...info, rev: revOf(own(v, 'rev')) ?? 0 }
}

/** A list of trackers from the cache or the API: the valid ones, the first of each id. */
function storedTrackers(v: unknown[]): Tracker[] {
  const out: Tracker[] = []
  const seen = new Set<string>()
  for (const [i, raw] of v.entries()) {
    const t = storedTracker(raw, i)
    if (!t || seen.has(t.id)) continue
    seen.add(t.id)
    out.push(t)
    if (out.length === MAX_TRACKERS) break
  }
  return out
}

/**
 * One tracker's part of a state, validated with the stored data's rules for its kind. With
 * `itemNotes` (a cache from before item details) its details come from its plans' notes, as an
 * old export's do (D3).
 */
function sectionState(
  v: unknown,
  normalise: (item: unknown) => Item | null,
  itemNotes = false,
): SectionState {
  const plans = own(v, 'plans')
  return {
    plans: normalisePlans(plans, normalise),
    log: normaliseLog(own(v, 'log')),
    details: itemNotes ? liftNotes(plans, normalise) : normaliseDetailsMap(own(v, 'details')),
    revs: revsOf(own(v, 'revs')),
    detailRevs: revsOf(own(v, 'detailRevs')),
  }
}

/**
 * Validate the cache with the same rules as stored data: its trackers, then each tracker's data by
 * its kind. Data for an id with no tracker is dropped. Null for anything without a list of
 * trackers, such as a cache in an older format.
 */
export function normaliseState(v: unknown): SyncState | null {
  if (!isRecord(v) || !Array.isArray(v.trackers)) return null
  const trackers = storedTrackers(v.trackers)
  const sections: Record<string, SectionState> = {}
  for (const t of trackers) {
    sections[t.id] = sectionState(own(v.sections, t.id), TRACKER_TYPES[t.kind].normalise)
  }
  return { trackers, sections, settings: isRecord(v.settings) ? knownSettings(v.settings) : null }
}

/**
 * `GET /api/state` as a state (docs/api.md §3): `{trackers, sections, details, detailRevs,
 * settings}`, each tracker's details and their revisions moved into its section. The keys of the
 * version 5 state that the API still sends (`exercise`, `cardio`, `diet`) are not read. Null when
 * the reply has no list of trackers.
 */
export function stateFromApi(v: unknown): SyncState | null {
  if (!isRecord(v)) return null
  const sections: Record<string, unknown> = {}
  if (Array.isArray(v.trackers)) {
    for (const raw of v.trackers) {
      const id = own(raw, 'id')
      if (!isTrackerId(id)) continue
      sections[id] = {
        plans: own(own(v.sections, id), 'plans'),
        log: own(own(v.sections, id), 'log'),
        revs: own(own(v.sections, id), 'revs'),
        details: own(v.details, id),
        detailRevs: own(v.detailRevs, id),
      }
    }
  }
  return normaliseState({ trackers: v.trackers, sections, settings: v.settings })
}

/**
 * A cache from before trackers were the account's own (`-v5` and older) as a state: its fixed
 * sections become the first three trackers, named and with the daily targets its settings hold,
 * their revisions not known yet (0). `itemNotes` reads a cache from before item details (`-v3` and
 * older), lifting its plan notes into details. Cardio came later (K90) with no new format: a cache
 * without it reads as no cardio.
 */
export function legacyState(v: unknown, itemNotes = false): SyncState | null {
  if (!isRecord(v) || !isRecord(v.exercise) || !isRecord(v.diet)) return null
  const settings = isRecord(v.settings) ? knownSettings(v.settings) : null
  const sections: Record<string, SectionState> = {}
  for (const id of SECTION_NAMES) {
    sections[id] = sectionState(v[id], SECTIONS[id].normalise, itemNotes)
  }
  return { trackers: firstTrackers(settings).map((t) => ({ ...t, rev: 0 })), sections, settings }
}

/**
 * Settings as a cache or the API words them. Goals are kept only when they are there: a tab from
 * before My goals writes none, and reading that as "no goals" would erase them (F1). Your limits
 * likewise, from a tab before them (K107). Daily goal is left out the same way by
 * `normalisePortableSettings` (K85).
 */
function knownSettings(v: Record<string, unknown>): KnownSettings {
  const { goals, limits, ...rest } = normalisePortableSettings(v)
  return {
    ...rest,
    ...(typeof v.goals === 'string' ? { goals } : {}),
    ...(typeof v.limits === 'string' ? { limits } : {}),
  }
}

const NO_TRACKED: Tracked = { plans: {}, log: {}, details: {} }

/**
 * The operations that take the server from `base` to `local`. Tracker operations come first, so a
 * new tracker exists on the server before its plans, marks and details are sent. A tracker is never
 * deleted: one gone from `local` sends nothing.
 */
export function diff(base: Snapshot, local: Snapshot): Op[] {
  const ops: Op[] = []
  for (const [section, l] of Object.entries(local.trackers)) {
    const b = Object.hasOwn(base.trackers, section) ? base.trackers[section] : undefined
    if (!b) {
      ops.push({ kind: 'tracker-create', section })
      continue
    }
    if (l.name !== b.name || l.position !== b.position || l.dailyTarget !== b.dailyTarget) {
      ops.push({ kind: 'tracker-patch', section })
    }
    if (l.endWeek !== null && l.endWeek !== b.endWeek) {
      ops.push({ kind: 'tracker-end', section, week: l.endWeek })
    }
  }
  for (const section of new Set([...Object.keys(base.sections), ...Object.keys(local.sections)])) {
    const b = base.sections[section] ?? NO_TRACKED
    const l = local.sections[section] ?? NO_TRACKED
    for (const [week, items] of Object.entries(l.plans)) {
      if (JSON.stringify(items) !== JSON.stringify(b.plans[week])) {
        ops.push({ kind: 'plan', section, week })
      }
    }
    for (const week of new Set([...Object.keys(b.log), ...Object.keys(l.log)])) {
      const bw = b.log[week] ?? {}
      const lw = l.log[week] ?? {}
      for (const item of new Set([...Object.keys(bw), ...Object.keys(lw)])) {
        for (let day = 0; day < 7; day++) {
          const mark = lw[item]?.[day] ?? null
          if (mark !== (bw[item]?.[day] ?? null)) {
            ops.push({ kind: 'tick', section, week, item, day, mark })
          }
        }
      }
    }
    // An item without details is an empty document: clearing them sends `{}`.
    for (const item of new Set([...Object.keys(b.details), ...Object.keys(l.details)])) {
      if (JSON.stringify(l.details[item] ?? {}) !== JSON.stringify(b.details[item] ?? {})) {
        ops.push({ kind: 'details', section, item })
      }
    }
  }
  const { settings: bs } = base
  const { settings: ls } = local
  if (
    bs.accent !== ls.accent ||
    bs.dailyGoal !== ls.dailyGoal ||
    bs.weekTitle !== ls.weekTitle ||
    bs.goals !== ls.goals ||
    bs.limits !== ls.limits ||
    // No key and `{}` are both every page as it comes (K66).
    JSON.stringify(bs.itemSections ?? {}) !== JSON.stringify(ls.itemSections ?? {})
  ) {
    ops.push({ kind: 'settings' })
  }
  return ops
}

/** The earlier of two end weeks; null is no end. */
function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a < b ? a : b
}

/** A send's outcome: `done` drops the operation, `again` sends it again now, `stop` ends the flush. */
type Outcome = 'done' | 'again' | 'stop'

export const useSyncStore = defineStore('sync', () => {
  const planner = usePlannerStore()
  const trackers = useTrackersStore()
  const details = useDetailsStore()

  const user = ref<string | null>(null)
  /** True once there is data to show, from the cache or the server. */
  const loaded = ref(false)
  /** `offline` after a write or read failed to reach the API; cleared by the next success. */
  const status = ref<'idle' | 'syncing' | 'offline'>('idle')
  const pending = ref(0)
  const notice = ref<string | null>(null)
  /** True once this session has read the account from the server, not only from the cache. */
  const fresh = ref(false)
  /**
   * Whether the last read from the server found the account with no settings at all (a new one),
   * so its notes are empty. It stays true after this tab saves settings, until the next read: the
   * Profile page's boxes go on taking typing once one note is saved (K107).
   */
  const blank = ref(false)
  /** The server's today (spec §8): what locks a programme's past days, never the device's clock. */
  const today = ref<string | null>(null)
  /** Each run's summary by its tracker's id, as `/api/state` last listed them. */
  const runs = ref<Record<string, RunSummary>>({})

  let base: Snapshot | null = null
  /** Each tracker's plans' revisions by week, and its items' details' by item id. */
  let revs: Revs = {}
  let detailRevs: Revs = {}
  /** Each tracker's revision, by tracker id; one not seen yet is missing. */
  let trackerRevs: Record<string, number> = {}
  let stopWatch: WatchStopHandle | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = FIRST_RETRY
  /** Running while details changed less than DETAILS_DELAY ago: details operations wait for it. */
  let detailsTimer: ReturnType<typeof setTimeout> | undefined
  let flushing: Promise<void> | null = null
  let refreshing: Promise<void> | null = null
  /** A read skipped because the outbox still held something (held details): run it once empty. */
  let readPending = false
  /** Bumped on every start and stop, so replies to an older session are ignored. */
  let generation = 0
  /** The marks refused as too late in this flush, for one notice that names them. */
  let late: { name: string; day: string }[] = []
  /** A refusal undid a change here: read the server's state once the flush is done. */
  let reread = false
  /** Bumped on every local change, so a read that raced one is discarded. */
  let changes = 0
  /** True while `adopt` replaces the stores' state, which is not a local change. */
  let adopting = false
  let authLost: (() => void) | null = null

  const cacheKey = () => CACHE_PREFIX + user.value
  const outboxKey = () => OUTBOX_PREFIX + user.value
  const runsKey = () => RUNS_PREFIX + user.value

  /**
   * Take the server's today and runs, and tell the trackers store which trackers are programmes.
   * `persist` keeps them for the next start; an account with neither keeps nothing.
   */
  function adoptRuns(
    read: { today: string | null; runs: Record<string, RunSummary> },
    persist: boolean,
  ) {
    today.value = read.today
    runs.value = read.runs
    trackers.setProgrammes(Object.keys(read.runs))
    if (!persist) return
    if (read.today === null && !Object.keys(read.runs).length) removeKey(runsKey())
    else writeKey(runsKey(), read)
  }

  /**
   * Whether a day (`YYYY-MM-DD`) is locked on a tracker (spec §8): a programme tracker's days
   * before yesterday, by the server's today. Yesterday stays open for one day, and an ordinary
   * tracker is never locked. Nothing is locked before the server has said what today is.
   */
  function locked(tracker: string, day: string): boolean {
    if (today.value === null || !Object.hasOwn(runs.value, tracker)) return false
    const [y, m, d] = today.value.split('-').map(Number)
    return day < dateKey(addDays(new Date(y!, m! - 1, d!), -1))
  }

  /** One tracker's revisions in `map`, created on first use. */
  function revsFor(map: Revs, section: string): Record<string, number> {
    if (!Object.hasOwn(map, section)) map[section] = {}
    return map[section]!
  }

  /** The base's copy of one tracker's data, created on first use. */
  function baseSection(section: string): Tracked {
    if (!Object.hasOwn(base!.sections, section)) {
      base!.sections[section] = { plans: {}, log: {}, details: {} }
    }
    return base!.sections[section]!
  }

  /**
   * Take the server's copy of a week's plan, from a conflict, read by the tracker's kind. The base
   * first: adopting their copy is then no change to send back.
   */
  function adoptTheirs(section: string, week: string, items: unknown[]): void {
    const { normalise } = trackers.typeOf(section)
    const theirs = normalisePlans({ [week]: items }, normalise)[week]!
    baseSection(section).plans[week] = clone(theirs)
    trackers.adoptWeek(section, week, theirs)
  }

  /** Take the server's copy of an item's details, from a conflict; the base first, as above. */
  function adoptTheirDetails(section: string, item: string, raw: unknown): void {
    const theirs = normaliseDetails(raw) ?? {}
    const doc = baseSection(section).details
    if (Object.keys(theirs).length) doc[item] = clone(theirs)
    else delete doc[item]
    details.adoptItem(section, item, theirs)
  }

  /**
   * Take the server's copy of a tracker, from a conflict; the base first, as above. An end this
   * device made stays when it is earlier: the diff then sends it again.
   */
  function adoptTheirTracker(theirs: TrackerInfo): void {
    base!.trackers[theirs.id] = clone(theirs)
    const mine = trackers.get(theirs.id)
    trackers.adoptTracker({ ...theirs, endWeek: earlier(mine?.endWeek ?? null, theirs.endWeek) })
  }

  /**
   * The daily picks the settings carry, from the `exercise` and `diet` trackers (K123). Each has a
   * target whatever is loaded: the kind's default stands in until the trackers are.
   */
  function picks(): Pick<KnownSettings, 'dailyPick' | 'foodPick'> {
    return { dailyPick: trackers.dailyTarget('exercise')!, foodPick: trackers.dailyTarget('diet')! }
  }

  /** The settings to cache, or null while the user has none of their own. */
  function savedSettings(): KnownSettings | null {
    const settings = planner.savedSettings()
    return settings && { ...settings, ...picks() }
  }

  function local(): Snapshot {
    const ids = new Set([
      ...trackers.list.map((t) => t.id),
      ...Object.keys(trackers.data),
      ...Object.keys(details.docs),
    ])
    const sections: Record<string, Tracked> = {}
    for (const id of ids) {
      sections[id] = {
        plans: trackers.plansOf(id),
        log: trackers.logOf(id),
        details: Object.hasOwn(details.docs, id) ? details.docs[id]! : {},
      }
    }
    return clone({
      trackers: Object.fromEntries(trackers.list.map((t) => [t.id, t])),
      sections,
      settings: {
        accent: planner.accent,
        ...(planner.dailyGoalKnown ? { dailyGoal: planner.dailyGoal } : {}),
        ...(planner.weekTitleKnown ? { weekTitle: planner.weekTitle } : {}),
        goals: planner.goals,
        limits: planner.limits,
        itemSections: planner.itemSections,
      },
    })
  }

  function readOutbox(): Queued[] {
    const ops = parseJson(readKey(outboxKey()))
    return Array.isArray(ops) ? ops.map(upgradeQueued).filter(isQueued) : []
  }

  function writeOutbox(ops: Queued[]): void {
    if (ops.length) writeKey(outboxKey(), ops)
    else removeKey(outboxKey())
    pending.value = ops.length
  }

  /**
   * Add operations, each replacing any queued one for the same plan, cell, details, settings or
   * tracker change. A details write that replaces a lifted one is lifted too: it still has the old
   * note to replace.
   */
  function enqueue(ops: Op[]): void {
    const keys = new Set(ops.map(opKey))
    const outbox = readOutbox()
    const lifted = new Set(
      outbox.filter((op) => op.kind === 'details' && op.lifted).map((op) => opKey(op)),
    )
    const queued = ops.map((op) =>
      op.kind === 'details' && lifted.has(opKey(op))
        ? { ...op, lifted: true as const, id: newId() }
        : { ...op, id: newId() },
    )
    writeOutbox([...outbox.filter((op) => !keys.has(opKey(op))), ...queued])
  }

  /** Drop a sent operation, unless a newer one for the same key has replaced it meanwhile. */
  function dequeue(sent: Queued): void {
    writeOutbox(readOutbox().filter((op) => op.id !== sent.id))
  }

  function persistCache(): void {
    const snapshot = local()
    const sections: Record<string, SectionState> = {}
    for (const [id, section] of Object.entries(snapshot.sections)) {
      sections[id] = {
        ...(section as SectionState),
        revs: revs[id] ?? {},
        detailRevs: detailRevs[id] ?? {},
      }
    }
    const cache: SyncState = {
      trackers: trackers.list.map((t) => ({ ...clone(t), rev: trackerRevs[t.id] ?? 0 })),
      sections,
      settings: savedSettings(),
    }
    writeKey(cacheKey(), cache)
  }

  /**
   * Make `state` both what the stores show and what the server is known to hold. `persist` false
   * leaves the cache alone: another tab's state is already there, in that tab's words.
   */
  function adopt(state: SyncState, persist = true): void {
    revs = {}
    detailRevs = {}
    trackerRevs = {}
    for (const t of state.trackers) if (t.rev > 0) trackerRevs[t.id] = t.rev
    const data: Record<string, { plans: Plans<Item>; log: Log }> = {}
    const docs: Record<string, DetailsMap> = {}
    for (const [id, section] of Object.entries(state.sections)) {
      revs[id] = { ...section.revs }
      detailRevs[id] = { ...section.detailRevs }
      data[id] = { plans: section.plans, log: section.log }
      docs[id] = section.details
    }
    adopting = true
    try {
      planner.adopt(clone(state.settings))
      trackers.adopt(clone(state.trackers.map(infoOf)), clone(data))
      details.adopt(clone(docs))
    } finally {
      adopting = false
    }
    base = local()
    loaded.value = true
    if (persist) persistCache()
  }

  /**
   * Queue whatever the stores hold that `base` does not. The watcher calls it after each change,
   * but a reply can land before Vue runs the watcher, so reads and other tabs' writes call it
   * first too: comparing whole snapshots catches a change however it was made.
   */
  function capture(): void {
    if (!base || adopting) return
    const now = local()
    const ops = diff(base, now)
    if (!ops.length) return
    changes++
    base = now
    persistCache()
    enqueue(ops)
    if (ops.some((op) => op.kind === 'details')) holdDetails()
    void flush()
  }

  /**
   * Hold details operations until the edits pause for DETAILS_DELAY, then send them. A read that
   * was skipped meanwhile, since they kept the outbox busy, runs once they are sent.
   */
  function holdDetails(): void {
    clearTimeout(detailsTimer)
    detailsTimer = setTimeout(() => {
      detailsTimer = undefined
      const gen = generation
      void flush().then(() => {
        if (gen === generation && readPending && !readOutbox().length) void refresh()
      })
    }, DETAILS_DELAY)
  }

  function scheduleRetry(): void {
    status.value = 'offline'
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => void refresh(), retryDelay)
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY)
  }

  /** A request on behalf of the signed-in user, which the API refuses for anyone else. */
  function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown) {
    return request<T>(method, path, body, { 'X-Expected-User': user.value ?? '' })
  }

  /** A week's plan as it is now, with the revision last seen; a 409 brings the server's in. */
  async function sendPlan(
    op: Extract<Queued, { kind: 'plan' }>,
    gen: number,
  ): Promise<Outcome | ApiError> {
    const { section, week } = op
    const plans = trackers.plansOf(section)
    // Gone from the stores (another tab's state, a damaged cache): sending [] would wipe it.
    if (!Object.hasOwn(plans, week)) return 'done'
    const res = await call<{ rev: number }>('PUT', `/plans/${section}/${week}`, {
      items: plans[week],
      rev: revsFor(revs, section)[week] ?? 0,
    })
    if (gen !== generation) return 'stop'
    if (res.ok) {
      revsFor(revs, section)[week] = res.data.rev
      return 'done'
    }
    if (res.error.kind !== 'conflict') return res.error
    const { body } = res.error
    revsFor(revs, section)[week] = body.rev
    // The server has no plan for the week: send ours again as a create.
    if (!Array.isArray(body.items)) return 'again'
    adoptTheirs(section, week, body.items)
    notice.value = CONFLICT_NOTICE
    return 'done'
  }

  async function sendTick(
    op: Extract<Queued, { kind: 'tick' }>,
    gen: number,
  ): Promise<Outcome | ApiError> {
    const { section, week, item, day, mark } = op
    const path = `/ticks/${section}/${week}/${encodeURIComponent(item)}/${day}`
    // `done` too, for an API from before marks had kinds (mid-deploy): it saves the day as done,
    // and a current API reads `mark` and ignores it.
    const res = await call('PUT', path, { mark, done: mark !== null })
    if (gen !== generation) return 'stop'
    return res.ok ? 'done' : res.error
  }

  /**
   * An item's details as they are now, with the revision last seen; a 409 brings the server's copy
   * in, as a plan's does. A 404 comes from an API older than details (the web image can land
   * first, F8): the write stays queued and is retried like a server failure, never dropped (D6).
   * So an id the path can't name (`isDetailsId`), which would 404 for good, is never sent: one
   * queued by older code is refused here, as the server would refuse it.
   */
  async function sendDetails(
    op: Extract<Queued, { kind: 'details' }>,
    gen: number,
  ): Promise<Outcome | ApiError> {
    const { section, item } = op
    if (!isDetailsId(item)) return { kind: 'refused', status: 400, code: 'invalid' }
    const rev = revsFor(detailRevs, section)[item] ?? 0
    const res = await call<{ rev: number }>(
      'PUT',
      `/details/${section}/${encodeURIComponent(item)}`,
      { details: details.get(section, item), rev },
    )
    if (gen !== generation) return 'stop'
    if (res.ok) {
      revsFor(detailRevs, section)[item] = res.data.rev
      return 'done'
    }
    const { error } = res
    if (error.kind === 'refused' && error.status === 404) return { kind: 'server', status: 404 }
    if (error.kind !== 'conflict') return error
    revsFor(detailRevs, section)[item] = error.body.rev
    // The item has never had details on the server: send ours again as a create.
    if (error.body.details === null || error.body.details === undefined) return 'again'
    // Rev 1 under a lifted write is migration 7's copy of the old note: ours is newer, as the
    // queued plan write it came with would have been. Sent again at rev 1, it replaces it.
    if (op.lifted && error.body.rev === 1 && rev !== 1) return 'again'
    adoptTheirDetails(section, item, error.body.details)
    notice.value = DETAILS_CONFLICT_NOTICE
    return 'done'
  }

  async function sendSettings(gen: number): Promise<Outcome | ApiError> {
    // The arrangement always goes, `{}` for the default: the API keeps the saved one when the
    // key is missing (an older tab), so leaving it out could never reset it. Goals go only once
    // this tab has read them or the person set them: an absent key keeps the saved ones (F1).
    // Your limits (K107), Daily goal (K85) and the week title (K132) the same way. The daily picks are the `exercise`
    // and `diet` trackers' targets, which the API keeps in step with them (K123): a missing
    // `dailyPick` would reset the target.
    const res = await call('PUT', '/settings', {
      accent: planner.accent,
      ...picks(),
      itemSections: planner.itemSections,
      ...(planner.dailyGoalKnown ? { dailyGoal: planner.dailyGoal } : {}),
      ...(planner.weekTitleKnown ? { weekTitle: planner.weekTitle } : {}),
      ...(planner.goalsKnown ? { goals: planner.goals } : {}),
      ...(planner.limitsKnown ? { limits: planner.limits } : {}),
    })
    if (gen !== generation) return 'stop'
    return res.ok ? 'done' : res.error
  }

  /**
   * A tracker made here, sent with its own id and the week it starts in (`POST /api/trackers`).
   * Sent again, the server returns the one it holds (200). The server places it last: its position
   * is taken here, and anything changed since the create was queued (a name, a daily target, an
   * end) is then queued as its own write.
   */
  async function sendCreate(
    op: Extract<Queued, { kind: 'tracker-create' }>,
    gen: number,
  ): Promise<Outcome | ApiError> {
    const mine = trackers.get(op.section)
    // Gone from the stores (another tab's state): there is nothing to create.
    if (!mine) return 'done'
    const res = await call<unknown>('POST', '/trackers', {
      id: mine.id,
      name: mine.name,
      kind: mine.kind,
      week: mine.startWeek ?? planner.weekKey,
    })
    if (gen !== generation) return 'stop'
    if (!res.ok) return res.error
    const theirs = storedTracker(res.data, mine.position)
    if (!theirs) return 'done'
    trackerRevs[theirs.id] = theirs.rev
    if (base) base.trackers[theirs.id] = infoOf(theirs)
    const now = trackers.get(op.section)
    if (now && now.position !== theirs.position) {
      trackers.adoptTracker({ ...now, position: theirs.position })
    }
    capture()
    return 'done'
  }

  /**
   * A tracker's name, position and daily target as they are now, with the revision last seen
   * (`PATCH /api/trackers/{id}`). A 409 brings the server's copy in, as a plan's does, unless this
   * device never saw a revision of the tracker (a cache from before trackers): its change then
   * goes again at the server's revision.
   */
  async function sendPatch(
    op: Extract<Queued, { kind: 'tracker-patch' }>,
    gen: number,
  ): Promise<Outcome | ApiError> {
    const mine = trackers.get(op.section)
    if (!mine) return 'done'
    const rev = trackerRevs[mine.id] ?? 0
    const res = await call<unknown>('PATCH', `/trackers/${encodeURIComponent(mine.id)}`, {
      rev,
      name: mine.name,
      position: mine.position,
      dailyTarget: mine.dailyTarget,
    })
    if (gen !== generation) return 'stop'
    if (res.ok) {
      const saved = revOf(own(res.data, 'rev'))
      if (saved !== null) trackerRevs[mine.id] = saved
      return 'done'
    }
    if (res.error.kind !== 'conflict') return res.error
    const { body } = res.error
    trackerRevs[mine.id] = body.rev
    if (rev === 0) return 'again'
    const theirs = normaliseTracker(body.tracker, mine.position)
    if (theirs) adoptTheirTracker(theirs)
    notice.value = TRACKER_CONFLICT_NOTICE
    return 'done'
  }

  /**
   * Delete tracker (K122): the tracker ends from the week that was on screen
   * (`POST /api/trackers/{id}/end`). The server keeps an earlier end, and so does this device.
   */
  async function sendEnd(
    op: Extract<Queued, { kind: 'tracker-end' }>,
    gen: number,
  ): Promise<Outcome | ApiError> {
    const { section, week } = op
    const res = await call<unknown>('POST', `/trackers/${encodeURIComponent(section)}/end`, {
      week,
    })
    if (gen !== generation) return 'stop'
    if (!res.ok) return res.error
    const theirs = storedTracker(res.data, 0)
    if (!theirs) return 'done'
    trackerRevs[section] = theirs.rev
    const known = base?.trackers[section]
    if (known) known.endWeek = theirs.endWeek
    const mine = trackers.get(section)
    const end = earlier(mine?.endWeek ?? null, theirs.endWeek)
    if (mine && mine.endWeek !== end) trackers.adoptTracker({ ...mine, endWeek: end })
    return 'done'
  }

  /**
   * Send one operation. A reply that arrives after `stop()` (sign-out, or another user) is ignored
   * entirely. Each kind has its own branch, and a kind without one fails to compile (`unhandled`),
   * so a new kind can never be sent as another (F2).
   */
  async function send(op: Queued, gen: number): Promise<Outcome> {
    let result: Outcome | ApiError
    switch (op.kind) {
      case 'plan':
        result = await sendPlan(op, gen)
        break
      case 'tick':
        result = await sendTick(op, gen)
        break
      case 'details':
        result = await sendDetails(op, gen)
        break
      case 'settings':
        result = await sendSettings(gen)
        break
      case 'tracker-create':
        result = await sendCreate(op, gen)
        break
      case 'tracker-patch':
        result = await sendPatch(op, gen)
        break
      case 'tracker-end':
        result = await sendEnd(op, gen)
        break
      /* v8 ignore next 2 */
      default:
        return unhandled(op)
    }
    if (typeof result === 'string') return result
    const error = result
    if (error.kind === 'offline' || error.kind === 'server') {
      scheduleRetry()
      return 'stop'
    }
    if (error.kind === 'auth') {
      authLost?.()
      return 'stop'
    }
    // A programme's lock (spec §8): a mark that arrives after its grace day, or a plan write to a
    // programme tracker. Dropped like any refusal, named in the notice, then the state read
    // again so the change is undone here.
    if (error.kind === 'refused' && error.status === 409) {
      if (error.code === 'locked-day' && op.kind === 'tick') {
        late.push(lateMark(op))
        notice.value = lateNotice(late)
        reread = true
        return 'done'
      }
      if (error.code === 'programme-tracker' && op.kind === 'plan') {
        notice.value = programmeNotice(trackers.get(op.section)?.name ?? 'a programme')
        reread = true
        return 'done'
      }
    }
    // Refused for good (an invalid write, a misconfigured origin): retrying cannot help, and
    // keeping it would block every write behind it. Drop it, and say so: the next read will
    // show the server's state without this change.
    console.warn('sync: dropped a refused write', op, error)
    if (op.kind === 'tracker-create') {
      // The tracker doesn't exist on the server, so every write queued for it would be refused
      // too. Drop them with it, and say why once.
      writeOutbox(
        readOutbox().filter((q) => q.id === op.id || !('section' in q) || q.section !== op.section),
      )
      notice.value =
        error.kind === 'refused' && error.code === 'too-many' ? TRACKER_FULL_NOTICE : REFUSED_NOTICE
      return 'done'
    }
    notice.value =
      error.kind === 'refused' && error.code === 'quota' ? QUOTA_NOTICE : REFUSED_NOTICE
    return 'done'
  }

  /** A refused mark's item, by its name in the week's plan, and its day: "Mon 9 Nov". */
  function lateMark(op: Extract<Queued, { kind: 'tick' }>): { name: string; day: string } {
    const item = trackers.plansOf(op.section)[op.week]?.find((it) => it.id === op.item)
    const [y, m, d] = op.week.split('-').map(Number)
    const day = dateKey(addDays(new Date(y!, m! - 1, d!), op.day))
    return { name: item?.name ?? 'an item', day: dayText(day) }
  }

  /**
   * Send queued operations in order until the outbox is empty or a send cannot finish. Details
   * wait while edits are still coming (DETAILS_DELAY), unless `now`; the rest go past them, since
   * nothing else depends on an item's details being sent first (a tick does on its week's plan,
   * and every write on its tracker's create).
   */
  function flush(now = false): Promise<void> {
    if (flushing) return flushing
    const gen = generation
    flushing = (async () => {
      for (;;) {
        const held = detailsTimer !== undefined && !now
        const op = readOutbox().find((q) => !(held && q.kind === 'details'))
        if (!op || gen !== generation) break
        status.value = 'syncing'
        const outcome = await send(op, gen)
        if (gen !== generation || outcome === 'stop') return
        if (outcome === 'done') dequeue(op)
        retryDelay = FIRST_RETRY
        // A new revision, or the server's copy after a conflict, belongs in the cache.
        if (op.kind !== 'tick' && op.kind !== 'settings') persistCache()
      }
      if (gen === generation) status.value = 'idle'
    })().finally(() => {
      flushing = null
      late = []
      // A refusal undid a change here: the server's state shows what it kept.
      if (reread && gen === generation) {
        reread = false
        void refresh()
      }
    })
    return flushing
  }

  /** Send what is queued, then take the server's state if nothing local is still waiting. */
  function refresh(): Promise<void> {
    if (refreshing) return refreshing
    const gen = generation
    refreshing = (async () => {
      if (!user.value) return
      await flush()
      if (gen !== generation || status.value === 'offline') return
      if (readOutbox().length) {
        readPending = true
        return
      }
      readPending = false
      const before = changes
      const res = await call<unknown>('GET', '/state')
      if (gen !== generation) return
      if (!res.ok) {
        if (res.error.kind === 'auth') authLost?.()
        else if (res.error.kind === 'offline' || res.error.kind === 'server') scheduleRetry()
        return
      }
      status.value = 'idle'
      retryDelay = FIRST_RETRY
      fresh.value = true
      // The server's today and the runs are its own, whatever this device has queued.
      adoptRuns(runsFromState(res.data), true)
      const state = stateFromApi(res.data)
      blank.value = state !== null && state.settings === null
      // A change made while the read was in flight is newer than the reply: keep it.
      capture()
      if (changes !== before || readOutbox().length) return
      if (state) adopt(state)
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  /**
   * Merge `data` into the account on the server (`POST /api/import`), then show the result. Local
   * writes go first, so the server merges against everything this device has; the server's merge
   * never deletes (docs/architecture.md §4). One request, however much the data holds: a file of
   * any version goes as version 6, its data under the trackers' ids.
   */
  async function importFile(data: ExportData): Promise<ImportOutcome> {
    if (!user.value) return { ok: false, code: 'auth' }
    const gen = generation
    capture()
    // A flush already running stops at details still waiting for their pause: send them now.
    await flushing
    await flush(true)
    if (gen !== generation) return { ok: false, code: 'error' }
    // Queued writes must reach the server first, or the merge would not see them.
    if (readOutbox().length) {
      return { ok: false, code: status.value === 'offline' ? 'offline' : 'server' }
    }
    const sections: Record<string, { plans: Plans<Item>; log: Log }> = {}
    const docs: Record<string, DetailsMap> = {}
    for (const [id, section] of Object.entries(data.sections)) {
      sections[id] = { plans: section.plans, log: section.log }
      docs[id] = section.details
    }
    const file = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      trackers: data.trackers,
      sections,
      details: docs,
      ...(data.settings ? { settings: data.settings } : {}),
      // Ask's history: the server adds the ones it has no id for, and never changes the rest.
      ...(data.conversations ? { conversations: data.conversations } : {}),
      // The programme library and the runs, as the file has them: the server reads and checks
      // them (§8.6), so a run imported here keeps its log and its locked days.
      ...(data.programmes ? { programmes: data.programmes } : {}),
      ...(data.runs ? { runs: data.runs } : {}),
    }
    const res = await call<ImportAdded>('POST', '/import', file)
    if (gen !== generation) return { ok: false, code: 'error' }
    if (!res.ok) {
      if (res.error.kind === 'offline') return { ok: false, code: 'offline' }
      if (res.error.kind === 'server') return { ok: false, code: 'server' }
      if (res.error.kind === 'auth') {
        authLost?.()
        return { ok: false, code: 'auth' }
      }
      if (res.error.kind === 'refused' && res.error.code === 'quota') {
        return { ok: false, code: 'quota' }
      }
      return { ok: false, code: 'error' }
    }
    // A read already in flight was sent before the import: wait for it, then read again.
    await refreshing
    await refresh()
    return { ok: true, added: res.data }
  }

  /**
   * Bring this user's cache and outbox over from the old names, once per sign-in, newest first. A
   * cache under a newer name wins; queued writes from all of them are kept, the newer for the same
   * cell. The old keys go, so an old tab still open finds nothing of this tab's to overwrite.
   *
   * Every old cache holds the first three trackers under fixed keys: it moves as their sections
   * (`legacyState`). Its outbox's operations name those trackers' ids already, so they move as
   * they are and are sent as they were queued: offline changes made on older code still reach the
   * server. A `-v5` or `-v4` cache and outbox hold item details already. Every older cache is from
   * before item details, so its plan notes lift into details (D3). The server lifted the same notes
   * from its own plans (migration 7), so they are not sent, except in a section whose plan writes
   * were still queued: a note there may not have reached the server. Those go as lifted writes,
   * which replace the migration's copy (rev 1) of the old note; an item in a queued week's plan with
   * no note in the cache sends a cleared document, since its note may have been cleared offline. A
   * note changed on the server since (rev 2 on) is a conflict, which brings the server's copy in.
   * An id the details path can't name (`isDetailsId`) queues nothing.
   */
  function moveOldKeys(name: string): void {
    let old: SyncState | null = null
    for (const prefix of OLD_CACHE_PREFIXES) {
      const oldCache = readKey(prefix + name)
      if (oldCache === null) continue
      const lift = !WITH_DETAILS.includes(prefix)
      const state = legacyState(parseJson(oldCache), lift)
      if (state && readKey(cacheKey()) === null) {
        writeKey(cacheKey(), state)
        if (lift) old = state
      }
      removeKey(prefix + name)
    }
    const unsent = new Map<string, Set<string>>()
    for (const prefix of OLD_OUTBOX_PREFIXES) {
      const oldOps = parseJson(readKey(prefix + name))
      if (Array.isArray(oldOps)) {
        const queued = readOutbox()
        const keys = new Set(queued.map(opKey))
        const moved = oldOps.map(upgradeQueued).filter(isQueued)
        for (const op of moved) {
          if (op.kind !== 'plan' || WITH_DETAILS.includes(prefix)) continue
          unsent.set(op.section, (unsent.get(op.section) ?? new Set()).add(op.week))
        }
        writeOutbox([...moved.filter((op) => !keys.has(opKey(op))), ...queued])
      }
      removeKey(prefix + name)
    }
    if (!old) return
    const items = new Map<string, Op>()
    for (const [section, weeks] of unsent) {
      const kept = old.sections[section]
      if (!kept) continue
      const ids = [
        ...Object.keys(kept.details),
        ...[...weeks].flatMap((week) => (kept.plans[week] ?? []).map((it) => it.id)),
      ]
      for (const item of ids) {
        if (isDetailsId(item)) {
          items.set(`${section}/${item}`, { kind: 'details', section, item, lifted: true })
        }
      }
    }
    if (items.size) enqueue([...items.values()])
  }

  /** Begin syncing for `name`: show the cache at once, then send and read in the background. */
  function start(name: string, onAuthLost: () => void): void {
    stop()
    generation++
    user.value = name
    authLost = onAuthLost
    moveOldKeys(name)
    const cached = normaliseState(parseJson(readKey(cacheKey())))
    if (cached) adopt(cached)
    adoptRuns(runsFromState(parseJson(readKey(runsKey()))), false)
    pending.value = readOutbox().length
    stopWatch = watch(
      () => [
        trackers.list,
        trackers.data,
        details.docs,
        planner.accent,
        planner.dailyGoal,
        planner.weekTitle,
        planner.goals,
        planner.limits,
        planner.itemSections,
      ],
      capture,
      { deep: true },
    )
    void refresh()
  }

  /** Stop syncing; the cache and outbox stay, so signing in again carries on. */
  function stop(): void {
    generation++
    // Replies to the old session are ignored; don't let its pending promises block the next one.
    flushing = null
    refreshing = null
    stopWatch?.()
    stopWatch = null
    clearTimeout(retryTimer)
    clearTimeout(detailsTimer)
    detailsTimer = undefined
    readPending = false
    retryDelay = FIRST_RETRY
    base = null
    revs = {}
    detailRevs = {}
    trackerRevs = {}
    user.value = null
    loaded.value = false
    fresh.value = false
    blank.value = false
    status.value = 'idle'
    pending.value = 0
    notice.value = null
    today.value = null
    runs.value = {}
    late = []
    reread = false
  }

  /** Delete a user's cache and outbox: signing out on purpose leaves nothing behind. */
  function forget(name: string): void {
    for (const prefix of [
      CACHE_PREFIX,
      OUTBOX_PREFIX,
      RUNS_PREFIX,
      ...OLD_CACHE_PREFIXES,
      ...OLD_OUTBOX_PREFIXES,
    ]) {
      removeKey(prefix + name)
    }
  }

  /** Another tab changed this user's cache or outbox (a `storage` event). */
  function onStorage(key: string | null): void {
    if (!user.value) return
    if (key === cacheKey()) {
      capture() // queue this tab's own unsent change before the other tab's state replaces it
      const state = normaliseState(parseJson(readKey(cacheKey())))
      // Its pending writes are in the shared outbox, so its state can count as the base. It is
      // newer than any read still in flight here, so that read must not overwrite it. Writing it
      // back would echo: a tab on older code words the cache differently (no `foodPick`), so each
      // tab would rewrite the other's copy forever, undoing marks as they were made.
      if (state) {
        changes++
        adopt(state, false)
      }
    } else if (key === outboxKey()) {
      pending.value = readOutbox().length
    }
  }

  function dismissNotice(): void {
    notice.value = null
  }

  /**
   * The export file of what this device holds, unsynced changes included: every tracker, ended ones
   * too, with its data, and the settings with the daily picks (Settings › Export).
   */
  function exportFile(now = new Date()): ExportFile {
    const { sections, settings } = local()
    return buildExport({
      trackers: trackers.list,
      sections: sections as Record<string, SectionData>,
      settings: { ...settings, ...picks() },
      now,
    })
  }

  return {
    user,
    loaded,
    status,
    pending,
    notice,
    fresh,
    blank,
    today,
    runs,
    locked,
    start,
    stop,
    forget,
    flush,
    refresh,
    importFile,
    exportFile,
    onStorage,
    dismissNotice,
  }
})
