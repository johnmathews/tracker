import { ref, watch, type WatchStopHandle } from 'vue'
import { defineStore } from 'pinia'
import { request, type ApiError } from '@/lib/api'
import {
  isMark,
  isRecord,
  normaliseExercise,
  normaliseFood,
  normaliseLog,
  normalisePlans,
  normalisePortableSettings,
  parseJson,
  readKey,
  removeKey,
  writeKey,
  type Exercise,
  type Food,
  type KnownSettings,
  type Log,
  type Mark,
  type PortableSettings,
} from '@/lib/storage'
import type { Plans } from '@/lib/plans'
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportData } from '@/lib/transfer'
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

export const CACHE_PREFIX = 'tracker-cache-v3:'
export const OUTBOX_PREFIX = 'tracker-outbox-v3:'
/**
 * The names of earlier formats, newest first (K14): `-v2` from before the solid and hatch
 * drawings, `-v1` from before marks had kinds. A tab still open on older code reads a mark it
 * doesn't know as an empty day and writes its copy back, which empties the boxes in every newer
 * tab; it could also drop their queued marks. A new format takes new names, so the two never read
 * each other. `src/lib/__tests__/format.spec.ts` fails a format change that keeps the old names.
 * The app's rename (K44) moved every `fitness-planner-…` key to `tracker-…` before the stores
 * start (`migrateKeyPrefix`), so the earlier versions are found under the new prefix.
 */
export const OLD_CACHE_PREFIXES = ['tracker-cache-v2:', 'tracker-cache-v1:'] as const
export const OLD_OUTBOX_PREFIXES = ['tracker-outbox-v2:', 'tracker-outbox-v1:'] as const

const SECTIONS = ['exercise', 'diet'] as const
type Section = (typeof SECTIONS)[number]

export type Op =
  | { kind: 'plan'; section: Section; week: string }
  | { kind: 'tick'; section: Section; week: string; item: string; day: number; mark: Mark | null }
  | { kind: 'settings' }

/**
 * An operation in the outbox. Plan and settings operations read their values when sent, so two
 * versions of one look alike; the id tells a newer one from the one already in flight.
 */
type Queued = Op & { id: string }

type Tracked = { plans: Plans<unknown>; log: Log }
type Revs = Record<Section, Record<string, number>>
/** The shape of `GET /api/state`, and of the cache. */
export type SyncState = {
  exercise: { plans: Plans<Exercise>; log: Log; revs: Record<string, number> }
  diet: { plans: Plans<Food>; log: Log; revs: Record<string, number> }
  settings: KnownSettings | null
}
type Snapshot = { exercise: Tracked; diet: Tracked; settings: PortableSettings }
/** What `POST /api/import` added; `conversations` counts Ask's (docs/api.md §3). */
export type ImportAdded = { weeks: number; ticks: number; settings: boolean; conversations: number }
export type ImportOutcome =
  | { ok: true; added: ImportAdded }
  | { ok: false; code: 'offline' | 'server' | 'auth' | 'quota' | 'error' }

export const CONFLICT_NOTICE =
  'A plan was changed on another device, so this device now shows that version.'
/** A write refused because the account is at its quota (413 `quota`, docs/api.md §3). */
export const QUOTA_NOTICE = 'Your account is full, so a change was undone here.'
export const REFUSED_NOTICE =
  'The server refused a change, so it was undone here. Reload to see what was saved.'
const FIRST_RETRY = 5_000
const MAX_RETRY = 60_000

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function opKey(op: Op): string {
  if (op.kind === 'plan') return `plan/${op.section}/${op.week}`
  if (op.kind === 'tick') return `tick/${op.section}/${op.week}/${op.item}/${op.day}`
  return 'settings'
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
  const sectionOk = v.section === 'exercise' || v.section === 'diet'
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

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function revsOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isRecord(v)) return out
  for (const [week, rev] of Object.entries(v)) {
    if (typeof rev === 'number' && Number.isInteger(rev) && rev > 0) out[week] = rev
  }
  return out
}

/** Validate a state from the cache or the API with the same rules as stored data. */
export function normaliseState(v: unknown): SyncState | null {
  if (!isRecord(v) || !isRecord(v.exercise) || !isRecord(v.diet)) return null
  const { exercise, diet } = v
  return {
    exercise: {
      plans: normalisePlans(exercise.plans, normaliseExercise),
      log: normaliseLog(exercise.log),
      revs: revsOf(exercise.revs),
    },
    diet: {
      plans: normalisePlans(diet.plans, normaliseFood),
      log: normaliseLog(diet.log),
      revs: revsOf(diet.revs),
    },
    settings: isRecord(v.settings) ? knownSettings(v.settings) : null,
  }
}

/**
 * Settings as a cache or the API words them. Goals are kept only when they are there: a tab from
 * before My goals writes none, and reading that as "no goals" would erase them (F1).
 */
function knownSettings(v: Record<string, unknown>): KnownSettings {
  const { goals, ...rest } = normalisePortableSettings(v)
  return typeof v.goals === 'string' ? { ...rest, goals } : rest
}

/** The operations that take the server from `base` to `local`. */
export function diff(base: Snapshot, local: Snapshot): Op[] {
  const ops: Op[] = []
  for (const section of SECTIONS) {
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
  }
  const { settings: bs } = base
  const { settings: ls } = local
  if (
    bs.accent !== ls.accent ||
    bs.dailyPick !== ls.dailyPick ||
    bs.foodPick !== ls.foodPick ||
    bs.goals !== ls.goals
  ) {
    ops.push({ kind: 'settings' })
  }
  return ops
}

export const useSyncStore = defineStore('sync', () => {
  const planner = usePlannerStore()
  const diet = useDietStore()

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
  let revs: Revs = { exercise: {}, diet: {} }
  let stopWatch: WatchStopHandle | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = FIRST_RETRY
  let flushing: Promise<void> | null = null
  let refreshing: Promise<void> | null = null
  /** Bumped on every start and stop, so replies to an older session are ignored. */
  let generation = 0
  /** Bumped on every local change, so a read that raced one is discarded. */
  let changes = 0
  /** True while `adopt` replaces the stores' state, which is not a local change. */
  let adopting = false
  let authLost: (() => void) | null = null

  const cacheKey = () => CACHE_PREFIX + user.value
  const outboxKey = () => OUTBOX_PREFIX + user.value
  const store = (section: Section) => (section === 'exercise' ? planner : diet)

  function local(): Snapshot {
    return clone({
      exercise: { plans: planner.plans, log: planner.log },
      diet: { plans: diet.plans, log: diet.log },
      settings: {
        accent: planner.accent,
        dailyPick: planner.dailyPick,
        foodPick: planner.foodPick,
        goals: planner.goals,
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

  /** Add operations, each replacing any queued one for the same plan, cell or settings. */
  function enqueue(ops: Op[]): void {
    const keys = new Set(ops.map(opKey))
    const queued = ops.map((op) => ({ ...op, id: newId() }))
    writeOutbox([...readOutbox().filter((op) => !keys.has(opKey(op))), ...queued])
  }

  /** Drop a sent operation, unless a newer one for the same key has replaced it meanwhile. */
  function dequeue(sent: Queued): void {
    writeOutbox(readOutbox().filter((op) => op.id !== sent.id))
  }

  function persistCache(): void {
    const snapshot = local()
    const cache: SyncState = {
      exercise: { ...(snapshot.exercise as SyncState['exercise']), revs: revs.exercise },
      diet: { ...(snapshot.diet as SyncState['diet']), revs: revs.diet },
      settings: planner.savedSettings(),
    }
    writeKey(cacheKey(), cache)
  }

  /**
   * Make `state` both what the stores show and what the server is known to hold. `persist` false
   * leaves the cache alone: another tab's state is already there, in that tab's words.
   */
  function adopt(state: SyncState, persist = true): void {
    revs = { exercise: { ...state.exercise.revs }, diet: { ...state.diet.revs } }
    adopting = true
    try {
      planner.adopt(clone({ plans: state.exercise.plans, log: state.exercise.log }), state.settings)
      diet.adopt(clone({ plans: state.diet.plans, log: state.diet.log }))
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
    void flush()
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

  /**
   * `done` drops the operation; `again` sends it again now; `stop` ends the flush. A reply that
   * arrives after `stop()` (sign-out, or another user) is ignored entirely.
   */
  async function send(op: Queued, gen: number): Promise<'done' | 'again' | 'stop'> {
    let error: ApiError
    if (op.kind === 'plan') {
      const { section, week } = op
      const plans = store(section).plans
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
      error = res.error
      if (error.kind === 'conflict') {
        revs[section][week] = error.body.rev
        // The server has no plan for the week: send ours again as a create.
        if (!Array.isArray(error.body.items)) return 'again'
        const theirs = normalisePlans(
          { [week]: error.body.items },
          section === 'exercise' ? normaliseExercise : normaliseFood,
        )[week]!
        // The base first: adopting their copy is then no change to send back.
        base![section].plans[week] = clone(theirs)
        if (section === 'exercise') planner.adoptWeek(week, theirs as Exercise[])
        else diet.adoptWeek(week, theirs as Food[])
        notice.value = CONFLICT_NOTICE
        return 'done'
      }
    } else if (op.kind === 'tick') {
      const { section, week, item, day, mark } = op
      const path = `/ticks/${section}/${week}/${encodeURIComponent(item)}/${day}`
      // `done` too, for an API from before marks had kinds (mid-deploy): it saves the day as done,
      // and a current API reads `mark` and ignores it.
      const res = await call('PUT', path, { mark, done: mark !== null })
      if (gen !== generation) return 'stop'
      if (res.ok) return 'done'
      error = res.error
    } else {
      // Goals only once this tab has read them or the person set them: an absent key keeps the
      // saved ones on the server (F1).
      const res = await call('PUT', '/settings', planner.portableSettings())
      if (gen !== generation) return 'stop'
      if (res.ok) return 'done'
      error = res.error
    }
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

  /** Send queued operations in order until the outbox is empty or a send cannot finish. */
  function flush(): Promise<void> {
    if (flushing) return flushing
    const gen = generation
    flushing = (async () => {
      for (;;) {
        const op = readOutbox()[0]
        if (!op || gen !== generation) break
        status.value = 'syncing'
        const outcome = await send(op, gen)
        if (gen !== generation || outcome === 'stop') return
        if (outcome === 'done') dequeue(op)
        retryDelay = FIRST_RETRY
        if (op.kind === 'plan') persistCache()
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
      if (gen !== generation || status.value === 'offline' || readOutbox().length) return
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
    await flush()
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
   */
  function moveOldKeys(name: string): void {
    for (const prefix of OLD_CACHE_PREFIXES) {
      const oldCache = readKey(prefix + name)
      if (oldCache === null) continue
      const state = normaliseState(parseJson(oldCache))
      if (state && readKey(cacheKey()) === null) writeKey(cacheKey(), state)
      removeKey(prefix + name)
    }
    for (const prefix of OLD_OUTBOX_PREFIXES) {
      const oldOps = parseJson(readKey(prefix + name))
      if (Array.isArray(oldOps)) {
        const queued = readOutbox()
        const keys = new Set(queued.map(opKey))
        const moved = oldOps.map(upgradeQueued).filter(isQueued)
        writeOutbox([...moved.filter((op) => !keys.has(opKey(op))), ...queued])
      }
      removeKey(prefix + name)
    }
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
        diet.plans,
        diet.log,
        planner.accent,
        planner.dailyPick,
        planner.foodPick,
        planner.goals,
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
    retryDelay = FIRST_RETRY
    base = null
    revs = { exercise: {}, diet: {} }
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
