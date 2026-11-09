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
  normaliseCardio,
  normaliseDetailsMap,
  normaliseExercise,
  normaliseFood,
  normaliseLog,
  normalisePlans,
  normalisePortableSettings,
  parseJson,
  readKey,
  removeKey,
  writeKey,
  type Cardio,
  type DetailsMap,
  type Exercise,
  type Food,
  type KnownSettings,
  type Log,
  type Mark,
  type PortableSettings,
} from '@/lib/storage'
import type { Plans } from '@/lib/plans'
import { SECTION_NAMES, isSection, type Section } from '@/lib/trackerTypes'
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportData } from '@/lib/transfer'
import { useCardioStore } from '@/stores/cardio'
import { useDetailsStore } from '@/stores/details'
import { useDietStore } from '@/stores/diet'
import { usePlannerStore } from '@/stores/planner'

/**
 * Keeps the stores and the API in step (docs/architecture.md §7).
 *
 * The stores change state optimistically; a deep watch diffs that state against `base`, the last
 * state the server is known to hold, and turns each difference into an operation in a persisted
 * outbox. Operations go out one at a time, in order. Reads replace local state only when nothing
 * is waiting to go out, so a refresh can never undo an edit that hasn't reached the server yet.
 */

export const CACHE_PREFIX = 'tracker-cache-v5:'
export const OUTBOX_PREFIX = 'tracker-outbox-v5:'
/**
 * The names of earlier formats, newest first (K14): `-v4` from before Cardio (K90), which holds
 * item details already, `-v3` from before item details (its plan items
 * carry their notes), `-v2` from before the solid and hatch drawings, `-v1` from before marks had
 * kinds. A tab still open on older code reads a mark it doesn't know as an empty day and writes its
 * copy back, which empties the boxes in every newer tab; it could also drop their queued marks. A
 * new format takes new names, so the two never read each other.
 * `src/lib/__tests__/format.spec.ts` fails a format change that keeps the old names. The app's
 * rename (K44) moved every `fitness-planner-…` key to `tracker-…` before the stores start
 * (`migrateKeyPrefix`), so the earlier versions are found under the new prefix.
 */
export const OLD_CACHE_PREFIXES = [
  'tracker-cache-v4:',
  'tracker-cache-v3:',
  'tracker-cache-v2:',
  'tracker-cache-v1:',
] as const
export const OLD_OUTBOX_PREFIXES = [
  'tracker-outbox-v4:',
  'tracker-outbox-v3:',
  'tracker-outbox-v2:',
  'tracker-outbox-v1:',
] as const
/** The earlier formats that hold item details already (D2): they move as they are, lifting nothing. */
const WITH_DETAILS: readonly string[] = ['tracker-cache-v4:', 'tracker-outbox-v4:']

export type Op =
  | { kind: 'plan'; section: Section; week: string }
  | { kind: 'tick'; section: Section; week: string; item: string; day: number; mark: Mark | null }
  /**
   * `lifted`: queued by `moveOldKeys` from a `-v3` cache whose plan writes were still queued. The
   * server's rev 1 is then migration 7's copy of the old note, which this one replaces.
   */
  | { kind: 'details'; section: Section; item: string; lifted?: true }
  | { kind: 'settings' }

/**
 * An operation in the outbox. Plan, details and settings operations read their values when sent,
 * so two versions of one look alike; the id tells a newer one from the one already in flight.
 */
type Queued = Op & { id: string }

type Tracked = { plans: Plans<unknown>; log: Log; details: DetailsMap }
type Revs = Record<Section, Record<string, number>>
/**
 * One section of `GET /api/state` and of the cache: its plans, log and items' details, the plans'
 * revisions by week, and the details' by item id (`detailRevs` also lists items whose details were
 * cleared, which `details` leaves out).
 */
type SectionState<T> = {
  plans: Plans<T>
  log: Log
  details: DetailsMap
  revs: Record<string, number>
  detailRevs: Record<string, number>
}
/** The shape of `GET /api/state`, and of the cache. */
export type SyncState = {
  exercise: SectionState<Exercise>
  cardio: SectionState<Cardio>
  diet: SectionState<Food>
  settings: KnownSettings | null
}
type Snapshot = { exercise: Tracked; cardio: Tracked; diet: Tracked; settings: PortableSettings }
/** What `POST /api/import` added; `conversations` counts Ask's (docs/api.md §3). */
export type ImportAdded = {
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
/** A write refused because the account is at its quota (413 `quota`, docs/api.md §3). */
export const QUOTA_NOTICE = 'Your account is full, so a change was undone here.'
export const REFUSED_NOTICE =
  'The server refused a change, so it was undone here. Reload to see what was saved.'
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

/** What a queued operation replaces: one per plan, cell, item's details, and settings. */
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
  const sectionOk = isSection(v.section)
  if (v.kind === 'details') {
    const liftedOk = v.lifted === undefined || v.lifted === true
    return sectionOk && liftedOk && typeof v.item === 'string' && isItemId(v.item)
  }
  const weekOk = typeof v.week === 'string' && WEEK_KEY.test(v.week)
  if (v.kind === 'plan') return sectionOk && weekOk
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

/** No revisions yet, for every section. */
function noRevs(): Revs {
  return Object.fromEntries(SECTION_NAMES.map((s) => [s, {}])) as Revs
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function revsOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isRecord(v)) return out
  for (const [key, rev] of Object.entries(v)) {
    if (typeof rev === 'number' && Number.isInteger(rev) && rev > 0) out[key] = rev
  }
  return out
}

/**
 * One section of a state, validated with the stored data's rules. With `itemNotes` (a cache from
 * before item details) its details come from its plans' notes, as an old export's do (D3).
 */
function sectionState<T extends object>(
  v: Record<string, unknown>,
  normalise: (item: unknown) => T | null,
  itemNotes: boolean,
): SectionState<T> {
  return {
    plans: normalisePlans(v.plans, normalise),
    log: normaliseLog(v.log),
    details: itemNotes ? liftNotes(v.plans, normalise) : normaliseDetailsMap(v.details),
    revs: revsOf(v.revs),
    detailRevs: revsOf(v.detailRevs),
  }
}

/**
 * Validate a state from the cache or the API with the same rules as stored data. `itemNotes` reads
 * a cache from before item details (`-v3` and older), lifting its plan notes into details. Cardio
 * came later (K90) with no new format: a cache, or an API mid-deploy, without it reads as no cardio.
 */
export function normaliseState(v: unknown, itemNotes = false): SyncState | null {
  if (!isRecord(v) || !isRecord(v.exercise) || !isRecord(v.diet)) return null
  return {
    exercise: sectionState(v.exercise, normaliseExercise, itemNotes),
    cardio: sectionState(isRecord(v.cardio) ? v.cardio : {}, normaliseCardio, itemNotes),
    diet: sectionState(v.diet, normaliseFood, itemNotes),
    settings: isRecord(v.settings) ? knownSettings(v.settings) : null,
  }
}

/**
 * Settings as a cache or the API words them. Goals are kept only when they are there: a tab from
 * before My goals writes none, and reading that as "no goals" would erase them (F1). Daily goal is
 * left out the same way by `normalisePortableSettings` (K85).
 */
function knownSettings(v: Record<string, unknown>): KnownSettings {
  const { goals, ...rest } = normalisePortableSettings(v)
  return typeof v.goals === 'string' ? { ...rest, goals } : rest
}

/** The operations that take the server from `base` to `local`. */
export function diff(base: Snapshot, local: Snapshot): Op[] {
  const ops: Op[] = []
  for (const section of SECTION_NAMES) {
    const b = base[section]
    const l = local[section]
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
    bs.dailyPick !== ls.dailyPick ||
    bs.foodPick !== ls.foodPick ||
    bs.dailyGoal !== ls.dailyGoal ||
    bs.goals !== ls.goals ||
    // No key and `{}` are both every page as it comes (K66).
    JSON.stringify(bs.itemSections ?? {}) !== JSON.stringify(ls.itemSections ?? {})
  ) {
    ops.push({ kind: 'settings' })
  }
  return ops
}

/** A send's outcome: `done` drops the operation, `again` sends it again now, `stop` ends the flush. */
type Outcome = 'done' | 'again' | 'stop'

export const useSyncStore = defineStore('sync', () => {
  const planner = usePlannerStore()
  const cardio = useCardioStore()
  const diet = useDietStore()
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

  let base: Snapshot | null = null
  let revs: Revs = noRevs()
  let detailRevs: Revs = noRevs()
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
  /** Bumped on every local change, so a read that raced one is discarded. */
  let changes = 0
  /** True while `adopt` replaces the stores' state, which is not a local change. */
  let adopting = false
  let authLost: (() => void) | null = null

  const cacheKey = () => CACHE_PREFIX + user.value
  const outboxKey = () => OUTBOX_PREFIX + user.value
  /** Each section's store, keyed by the registry's sections: a new section must add its own. */
  const stores = { exercise: planner, cardio, diet } satisfies Record<
    Section,
    { plans: Plans<unknown> }
  >
  /**
   * Take the server's copy of a week's plan, from a conflict. The base first: adopting their copy
   * is then no change to send back.
   */
  const adoptTheirs: Record<Section, (week: string, items: unknown[]) => void> = {
    exercise(week, items) {
      const theirs = normalisePlans({ [week]: items }, normaliseExercise)[week]!
      base!.exercise.plans[week] = clone(theirs)
      planner.adoptWeek(week, theirs)
    },
    cardio(week, items) {
      const theirs = normalisePlans({ [week]: items }, normaliseCardio)[week]!
      base!.cardio.plans[week] = clone(theirs)
      cardio.adoptWeek(week, theirs)
    },
    diet(week, items) {
      const theirs = normalisePlans({ [week]: items }, normaliseFood)[week]!
      base!.diet.plans[week] = clone(theirs)
      diet.adoptWeek(week, theirs)
    },
  }

  /** Take the server's copy of an item's details, from a conflict; the base first, as above. */
  function adoptTheirDetails(section: Section, item: string, raw: unknown): void {
    const theirs = normaliseDetails(raw) ?? {}
    if (Object.keys(theirs).length) base![section].details[item] = clone(theirs)
    else delete base![section].details[item]
    details.adoptItem(section, item, theirs)
  }

  function local(): Snapshot {
    return clone({
      exercise: { plans: planner.plans, log: planner.log, details: details.docs.exercise },
      cardio: { plans: cardio.plans, log: cardio.log, details: details.docs.cardio },
      diet: { plans: diet.plans, log: diet.log, details: details.docs.diet },
      settings: {
        accent: planner.accent,
        dailyPick: planner.dailyPick,
        foodPick: planner.foodPick,
        ...(planner.dailyGoalKnown ? { dailyGoal: planner.dailyGoal } : {}),
        goals: planner.goals,
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
   * Add operations, each replacing any queued one for the same plan, cell, details or settings. A
   * details write that replaces a lifted one is lifted too: it still has the old note to replace.
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
    // The snapshot's plans are the stores' own, so they hold each section's items.
    const cache = {
      exercise: { ...snapshot.exercise, revs: revs.exercise, detailRevs: detailRevs.exercise },
      cardio: { ...snapshot.cardio, revs: revs.cardio, detailRevs: detailRevs.cardio },
      diet: { ...snapshot.diet, revs: revs.diet, detailRevs: detailRevs.diet },
      settings: planner.savedSettings(),
    } as SyncState
    writeKey(cacheKey(), cache)
  }

  /**
   * Make `state` both what the stores show and what the server is known to hold. `persist` false
   * leaves the cache alone: another tab's state is already there, in that tab's words.
   */
  function adopt(state: SyncState, persist = true): void {
    revs = noRevs()
    detailRevs = noRevs()
    for (const section of SECTION_NAMES) {
      revs[section] = { ...state[section].revs }
      detailRevs[section] = { ...state[section].detailRevs }
    }
    adopting = true
    try {
      planner.adopt(clone({ plans: state.exercise.plans, log: state.exercise.log }), state.settings)
      cardio.adopt(clone({ plans: state.cardio.plans, log: state.cardio.log }))
      diet.adopt(clone({ plans: state.diet.plans, log: state.diet.log }))
      details.adopt(
        clone({
          exercise: state.exercise.details,
          cardio: state.cardio.details,
          diet: state.diet.details,
        }),
      )
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
  function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
    return request<T>(method, path, body, { 'X-Expected-User': user.value ?? '' })
  }

  /** A week's plan as it is now, with the revision last seen; a 409 brings the server's in. */
  async function sendPlan(
    op: Extract<Queued, { kind: 'plan' }>,
    gen: number,
  ): Promise<Outcome | ApiError> {
    const { section, week } = op
    const plans = stores[section].plans
    // Gone from the stores (another tab's state, a damaged cache): sending [] would wipe it.
    if (!(week in plans)) return 'done'
    const res = await call<{ rev: number }>('PUT', `/plans/${section}/${week}`, {
      items: plans[week],
      rev: revs[section][week] ?? 0,
    })
    if (gen !== generation) return 'stop'
    if (res.ok) {
      revs[section][week] = res.data.rev
      return 'done'
    }
    if (res.error.kind !== 'conflict') return res.error
    const { body } = res.error
    revs[section][week] = body.rev
    // The server has no plan for the week: send ours again as a create.
    if (!Array.isArray(body.items)) return 'again'
    adoptTheirs[section](week, body.items)
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
    const rev = detailRevs[section][item] ?? 0
    const res = await call<{ rev: number }>(
      'PUT',
      `/details/${section}/${encodeURIComponent(item)}`,
      { details: details.get(section, item), rev },
    )
    if (gen !== generation) return 'stop'
    if (res.ok) {
      detailRevs[section][item] = res.data.rev
      return 'done'
    }
    const { error } = res
    if (error.kind === 'refused' && error.status === 404) return { kind: 'server', status: 404 }
    if (error.kind !== 'conflict') return error
    detailRevs[section][item] = error.body.rev
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
    // Daily goal the same way (K85).
    const res = await call('PUT', '/settings', {
      accent: planner.accent,
      dailyPick: planner.dailyPick,
      foodPick: planner.foodPick,
      itemSections: planner.itemSections,
      ...(planner.dailyGoalKnown ? { dailyGoal: planner.dailyGoal } : {}),
      ...(planner.goalsKnown ? { goals: planner.goals } : {}),
    })
    if (gen !== generation) return 'stop'
    return res.ok ? 'done' : res.error
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
    // Refused for good (an invalid write, a misconfigured origin): retrying cannot help, and
    // keeping it would block every write behind it. Drop it, and say so: the next read will
    // show the server's state without this change.
    console.warn('sync: dropped a refused write', op, error)
    notice.value =
      error.kind === 'refused' && error.code === 'quota' ? QUOTA_NOTICE : REFUSED_NOTICE
    return 'done'
  }

  /**
   * Send queued operations in order until the outbox is empty or a send cannot finish. Details
   * wait while edits are still coming (DETAILS_DELAY), unless `now`; the rest go past them, since
   * nothing else depends on an item's details being sent first (a tick does on its week's plan).
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
        if (op.kind === 'plan' || op.kind === 'details') persistCache()
      }
      if (gen === generation) status.value = 'idle'
    })().finally(() => {
      flushing = null
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
      // A change made while the read was in flight is newer than the reply: keep it.
      capture()
      if (changes !== before || readOutbox().length) return
      const state = normaliseState(res.data)
      if (state) adopt(state)
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  /**
   * Merge `data` into the account on the server (`POST /api/import`), then show the result. Local
   * writes go first, so the server merges against everything this device has; the server's merge
   * never deletes (docs/architecture.md §4). One request, however much the data holds.
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
    const file = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exercise: data.exercise,
      cardio: data.cardio,
      diet: data.diet,
      ...(data.settings ? { settings: data.settings } : {}),
      // Ask's history: the server adds the ones it has no id for, and never changes the rest.
      ...(data.conversations ? { conversations: data.conversations } : {}),
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
   * A `-v4` cache and outbox hold item details already: they move as they are. Every older cache is
   * from before item details, so its plan notes lift into details (D3). The
   * server lifted the same notes from its own plans (migration 7), so they are not sent, except in
   * a section whose plan writes were still queued: a note there may not have reached the server.
   * Those go as lifted writes, which replace the migration's copy (rev 1) of the old note; an item
   * in a queued week's plan with no note in the cache sends a cleared document, since its note may
   * have been cleared offline. A note changed on the server since (rev 2 on) is a conflict, which
   * brings the server's copy in. An id the details path can't name (`isDetailsId`) queues nothing.
   */
  function moveOldKeys(name: string): void {
    let old: SyncState | null = null
    for (const prefix of OLD_CACHE_PREFIXES) {
      const oldCache = readKey(prefix + name)
      if (oldCache === null) continue
      const lift = !WITH_DETAILS.includes(prefix)
      const state = normaliseState(parseJson(oldCache), lift)
      if (state && readKey(cacheKey()) === null) {
        writeKey(cacheKey(), state)
        if (lift) old = state
      }
      removeKey(prefix + name)
    }
    const unsent = new Map<Section, Set<string>>()
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
      const { details: lifted, plans } = old[section]
      const ids = [
        ...Object.keys(lifted),
        ...[...weeks].flatMap((week) => (plans[week] ?? []).map((it) => it.id)),
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
    pending.value = readOutbox().length
    stopWatch = watch(
      () => [
        planner.plans,
        planner.log,
        cardio.plans,
        cardio.log,
        diet.plans,
        diet.log,
        details.docs,
        planner.accent,
        planner.dailyPick,
        planner.foodPick,
        planner.dailyGoal,
        planner.goals,
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
    revs = noRevs()
    detailRevs = noRevs()
    user.value = null
    loaded.value = false
    fresh.value = false
    status.value = 'idle'
    pending.value = 0
    notice.value = null
  }

  /** Delete a user's cache and outbox: signing out on purpose leaves nothing behind. */
  function forget(name: string): void {
    for (const prefix of [
      CACHE_PREFIX,
      OUTBOX_PREFIX,
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

  return {
    user,
    loaded,
    status,
    pending,
    notice,
    fresh,
    start,
    stop,
    forget,
    flush,
    refresh,
    importFile,
    onStorage,
    dismissNotice,
  }
})
