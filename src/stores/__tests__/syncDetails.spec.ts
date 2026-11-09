import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { usePlannerStore } from '@/stores/planner'
import { useDetailsStore } from '@/stores/details'
import {
  CACHE_PREFIX,
  DETAILS_CONFLICT_NOTICE,
  DETAILS_DELAY,
  OLD_CACHE_PREFIXES,
  OLD_OUTBOX_PREFIXES,
  OUTBOX_PREFIX,
  QUOTA_NOTICE,
  REFUSED_NOTICE,
  diff,
  normaliseState,
  useSyncStore,
  type SyncState,
} from '@/stores/sync'
import { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, cached, emptyState } from '@/lib/__tests__/signedIn'

/**
 * Item details in sync (D2, docs/architecture.md §7): one `details` operation per item, sent after
 * the item's edits pause, with the revision last seen; conflicts adopt the server's copy; a 404
 * keeps the write queued (D6); a `-v3` cache's plan notes lift into details.
 */

const NOW = new Date(2026, 9, 23, 18, 0)
const WEEK = '2026-10-19'
const SQUATS = { id: 'sq', name: 'Squats', reps: 15, target: 4 }

let api: FakeApi
let lost: ReturnType<typeof vi.fn<() => void>>

function outbox(): Record<string, unknown>[] {
  return JSON.parse(localStorage.getItem(OUTBOX_PREFIX + USER) ?? '[]') as Record<string, unknown>[]
}

function detailsPuts(): { path: string; body: unknown }[] {
  return api.calls
    .filter((c) => c.method === 'PUT' && c.path.startsWith('/details/'))
    .map(({ path, body }) => ({ path, body }))
}

async function start(cache?: SyncState) {
  if (cache) localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(cache))
  const sync = useSyncStore()
  sync.start(USER, lost)
  await flushPromises()
  return { sync, details: useDetailsStore(), planner: usePlannerStore() }
}

/** Let a change reach the watcher, wait out the details delay, then let the writes finish. */
async function settle(): Promise<void> {
  await nextTick()
  await flushPromises()
  await vi.advanceTimersByTimeAsync(DETAILS_DELAY)
  await flushPromises()
}

describe('sync of item details', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActivePinia(createPinia())
    api = new FakeApi()
    api.addUser(USER)
    api.signedIn = USER
    vi.stubGlobal('fetch', api.fetch)
    lost = vi.fn<() => void>()
  })

  afterEach(() => {
    useSyncStore().stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('takes the server’s details and their revisions', async () => {
    api.accounts.get(USER)!.details.exercise.sq = { doc: { notes: 'Knees out' }, rev: 2 }
    api.accounts.get(USER)!.details.diet.veg = { doc: {}, rev: 3 }
    const { details } = await start()
    expect(details.notesOf('exercise', 'sq')).toBe('Knees out')
    expect(cached().exercise.details).toEqual({ sq: { notes: 'Knees out' } })
    expect(cached().exercise.detailRevs).toEqual({ sq: 2 })
    expect(cached().diet.details).toEqual({})
    expect(cached().diet.detailRevs).toEqual({ veg: 3 })
  })

  it('sends a note as the item’s details, with the revision last seen', async () => {
    const { details } = await start(emptyState())
    details.setNotes('exercise', 'sq', '  Knees **out** ')
    await settle()
    expect(detailsPuts()).toEqual([
      { path: '/details/exercise/sq', body: { details: { notes: 'Knees **out**' }, rev: 0 } },
    ])
    expect(api.accounts.get(USER)!.details.exercise.sq).toEqual({
      doc: { notes: 'Knees **out**' },
      rev: 1,
    })
    expect(cached().exercise.detailRevs).toEqual({ sq: 1 })
    details.setField('exercise', 'sq', 'equipment', 'Kettlebell')
    await settle()
    expect(detailsPuts().at(-1)!.body).toEqual({
      details: { notes: 'Knees **out**', fields: { equipment: 'Kettlebell' } },
      rev: 1,
    })
    expect(outbox()).toEqual([])
  })

  it('sends a food’s details under the diet section, and an id as a path segment', async () => {
    const { details } = await start(emptyState())
    details.setField('diet', 'a b?#', 'serving', 'A handful')
    await settle()
    expect(detailsPuts().map((c) => c.path)).toEqual(['/details/diet/a%20b%3F%23'])
  })

  it('drops a queued details write for an id the path can’t name, and sends the rest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([
        { kind: 'details', section: 'exercise', item: 'a/b', id: 'a' },
        { kind: 'details', section: 'exercise', item: '..', id: 'b' },
        { kind: 'details', section: 'exercise', item: 'sq', id: 'c' },
      ]),
    )
    const cache = emptyState()
    cache.exercise.details = {
      'a/b': { notes: 'Slash' },
      '..': { notes: 'Dots' },
      sq: { notes: 'Fine' },
    }
    const { sync } = await start(cache)
    expect(detailsPuts().map((c) => c.path)).toEqual(['/details/exercise/sq'])
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(REFUSED_NOTICE)
  })

  it('clears details by sending an empty document', async () => {
    api.accounts.get(USER)!.details.exercise.sq = { doc: { notes: 'Old' }, rev: 1 }
    const { details } = await start()
    details.setNotes('exercise', 'sq', '')
    await settle()
    expect(detailsPuts()).toEqual([{ path: '/details/exercise/sq', body: { details: {}, rev: 1 } }])
    expect(cached().exercise.details).toEqual({})
    expect(cached().exercise.detailRevs).toEqual({ sq: 2 })
  })

  it('waits for typing to pause, then sends the latest text once', async () => {
    const { details } = await start(emptyState())
    for (const text of ['K', 'Kn', 'Kne', 'Knee', 'Knees']) {
      details.setNotes('exercise', 'sq', text)
      await nextTick()
      await vi.advanceTimersByTimeAsync(DETAILS_DELAY / 2)
    }
    expect(detailsPuts()).toEqual([])
    // Queued at once, so a reload in the pause loses nothing; one operation for the item.
    expect(outbox()).toMatchObject([{ kind: 'details', section: 'exercise', item: 'sq' }])
    await settle()
    expect(detailsPuts()).toHaveLength(1)
    expect(detailsPuts()[0]!.body).toEqual({ details: { notes: 'Knees' }, rev: 0 })
  })

  it('runs a read skipped while details were held once they are sent', async () => {
    const { sync, details } = await start(emptyState())
    details.setNotes('exercise', 'sq', 'Knees out')
    await nextTick()
    // Another device changes a note meanwhile; this tab refreshes (focus) within the second.
    api.accounts.get(USER)!.details.exercise.pu = { doc: { notes: 'From the phone' }, rev: 1 }
    const reads = api.paths('GET /state').length
    await sync.refresh()
    expect(api.paths('GET /state')).toHaveLength(reads) // the held note keeps the outbox busy
    await vi.advanceTimersByTimeAsync(DETAILS_DELAY)
    await flushPromises()
    expect(api.paths().slice(-2)).toEqual(['PUT /details/exercise/sq', 'GET /state'])
    expect(details.notesOf('exercise', 'pu')).toBe('From the phone')
  })

  it('reads nothing extra after held details when no read was skipped', async () => {
    const { details } = await start(emptyState())
    details.setNotes('exercise', 'sq', 'Knees out')
    await settle()
    expect(api.paths().at(-1)).toBe('PUT /details/exercise/sq')
  })

  it('sends a tick at once, whatever details wait behind it', async () => {
    const { details, planner } = await start(emptyState())
    details.setNotes('exercise', 'sq', 'Knees out')
    await nextTick()
    planner.toggle('pu', 0)
    await nextTick()
    await flushPromises()
    // The plan and the tick queued after the note go first; the note waits for its pause.
    expect(api.paths('PUT')).toEqual([
      `PUT /plans/exercise/${WEEK}`,
      `PUT /ticks/exercise/${WEEK}/pu/0`,
    ])
    await settle()
    expect(api.paths('PUT').at(-1)).toBe('PUT /details/exercise/sq')
  })

  it('keeps an edit made offline through a reload, and sends it once back', async () => {
    const { sync, details } = await start(emptyState())
    api.offline = true
    details.setNotes('exercise', 'sq', 'Written offline')
    await settle()
    expect(sync.status).toBe('offline')
    expect(outbox()).toMatchObject([{ kind: 'details', section: 'exercise', item: 'sq' }])
    // A reload: a new page, the same storage.
    sync.stop()
    setActivePinia(createPinia())
    const again = await start()
    expect(again.details.notesOf('exercise', 'sq')).toBe('Written offline')
    api.offline = false
    await again.sync.flush()
    expect(api.accounts.get(USER)!.details.exercise.sq!.doc).toEqual({ notes: 'Written offline' })
    expect(again.sync.pending).toBe(0)
  })

  it('takes the server’s copy of details changed elsewhere, and says so', async () => {
    api.accounts.get(USER)!.details.exercise.sq = { doc: { notes: 'Theirs' }, rev: 2 }
    api.stall('GET', '/state')
    const cache = emptyState()
    cache.exercise.details = { sq: { notes: 'Mine' } }
    cache.exercise.detailRevs = { sq: 1 }
    const { sync, details } = await start(cache)
    details.setNotes('exercise', 'sq', 'Mine, edited')
    await settle()
    expect(details.notesOf('exercise', 'sq')).toBe('Theirs')
    expect(sync.notice).toBe(DETAILS_CONFLICT_NOTICE)
    expect(cached().exercise.details).toEqual({ sq: { notes: 'Theirs' } })
    expect(cached().exercise.detailRevs).toEqual({ sq: 2 })
    await settle()
    expect(detailsPuts()).toHaveLength(1) // adopting their copy queues nothing
  })

  it('takes a cleared copy from a conflict as no details', async () => {
    api.accounts.get(USER)!.details.exercise.sq = { doc: {}, rev: 3 }
    api.stall('GET', '/state')
    const cache = emptyState()
    cache.exercise.details = { sq: { notes: 'Mine' } }
    cache.exercise.detailRevs = { sq: 1 }
    const { details } = await start(cache)
    details.setField('exercise', 'sq', 'works', 'Legs')
    await settle()
    expect(details.get('exercise', 'sq')).toEqual({})
  })

  it('reads a server copy that is not an object as no details', async () => {
    api.stall('GET', '/state')
    const cache = emptyState()
    cache.exercise.details = { sq: { notes: 'Mine' } }
    cache.exercise.detailRevs = { sq: 1 }
    const { details } = await start(cache)
    api.failNext('PUT', '/details', 409, { error: 'conflict', details: 'damaged', rev: 2 })
    details.setNotes('exercise', 'sq', 'Mine, edited')
    await settle()
    expect(details.get('exercise', 'sq')).toEqual({})
    expect(cached().exercise.detailRevs).toEqual({ sq: 2 })
  })

  it('lets the reply to a details write that lands after sign-out touch nothing', async () => {
    const { sync, details } = await start(emptyState())
    const release = api.hold()
    details.setNotes('exercise', 'sq', 'Sent, then signed out')
    await settle()
    sync.stop()
    release()
    await flushPromises()
    expect(sync.status).toBe('idle')
    expect(sync.notice).toBeNull()
    // Still queued for the next sign-in: the reply was ignored, not taken as sent.
    expect(outbox()).toMatchObject([{ kind: 'details', item: 'sq' }])
  })

  it('sends details again as a create when the server has none', async () => {
    api.stall('GET', '/state')
    const cache = emptyState()
    cache.exercise.details = { sq: { notes: 'Mine' } }
    cache.exercise.detailRevs = { sq: 4 }
    const { sync, details } = await start(cache)
    details.setNotes('exercise', 'sq', 'Mine, edited')
    await settle()
    expect(detailsPuts().map((c) => (c.body as { rev: number }).rev)).toEqual([4, 0])
    expect(api.accounts.get(USER)!.details.exercise.sq!.rev).toBe(1)
    expect(sync.notice).toBeNull()
  })

  it('raises no notice when the server already holds the same details', async () => {
    api.accounts.get(USER)!.details.exercise.sq = { doc: { notes: 'Same' }, rev: 5 }
    api.stall('GET', '/state')
    const { sync, details } = await start(emptyState())
    details.setNotes('exercise', 'sq', 'Same')
    await settle()
    expect(sync.notice).toBeNull()
    expect(cached().exercise.detailRevs).toEqual({ sq: 5 })
  })

  it('keeps a details write on a 404, as an API older than details answers, and retries', async () => {
    const { sync, details } = await start(emptyState())
    api.failNext('PUT', '/details', 404, { detail: 'Not Found' })
    details.setNotes('exercise', 'sq', 'Kept')
    await settle()
    expect(sync.status).toBe('offline')
    expect(sync.notice).toBeNull()
    expect(outbox()).toMatchObject([{ kind: 'details', item: 'sq' }])
    await vi.advanceTimersByTimeAsync(5_000) // the first retry
    await flushPromises()
    expect(api.accounts.get(USER)!.details.exercise.sq!.doc).toEqual({ notes: 'Kept' })
    expect(sync.pending).toBe(0)
  })

  it('still drops a tick write the server answers with a 404', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, planner } = await start(emptyState())
    api.failNext('PUT', '/ticks', 404, { error: 'not-found' })
    planner.toggle('sq', 0)
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(REFUSED_NOTICE)
  })

  it('drops details the server refuses as too large or over quota, and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, details } = await start(emptyState())
    api.failNext('PUT', '/details', 413, { error: 'too-large' })
    details.setNotes('exercise', 'sq', 'Big')
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(REFUSED_NOTICE)
    api.failNext('PUT', '/details', 413, { error: 'quota' })
    details.setNotes('exercise', 'sq', 'Bigger')
    await settle()
    expect(sync.notice).toBe(QUOTA_NOTICE)
  })

  it('reads a queued details operation back from the outbox, and skips a damaged one', async () => {
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([
        { kind: 'details', section: 'exercise', item: 'sq', id: 'a' },
        { kind: 'details', section: 'nope', item: 'sq', id: 'b' },
        { kind: 'details', section: 'exercise', item: '', id: 'c' },
        { kind: 'details', section: 'diet', item: 7, id: 'd' },
      ]),
    )
    const cache = emptyState()
    cache.exercise.details = { sq: { notes: 'Queued before the reload' } }
    const { sync } = await start(cache)
    expect(api.accounts.get(USER)!.details.exercise.sq!.doc).toEqual({
      notes: 'Queued before the reload',
    })
    expect(sync.pending).toBe(0)
  })

  it('sends queued details before an import, without waiting for the pause', async () => {
    const { sync, details } = await start(emptyState())
    details.setNotes('exercise', 'sq', 'Before the import')
    const outcome = await sync.importFile({
      exercise: { plans: {}, log: {}, details: { pl: { notes: 'From the file' } } },
      cardio: { plans: {}, log: {}, details: {} },
      diet: { plans: {}, log: {}, details: {} },
      settings: null,
    })
    expect(outcome).toEqual({
      ok: true,
      added: { weeks: 0, ticks: 0, details: 1, settings: false, conversations: 0 },
    })
    const imported = api.calls.find((c) => c.path === '/import')!.body as SyncState
    expect(imported.exercise.details).toEqual({ pl: { notes: 'From the file' } })
    expect(details.notesOf('exercise', 'sq')).toBe('Before the import')
    expect(details.notesOf('exercise', 'pl')).toBe('From the file')
  })

  it('forgets the details on sign-out with the rest of the user’s data', async () => {
    api.accounts.get(USER)!.details.exercise.sq = { doc: { notes: 'Private' }, rev: 1 }
    const { details, planner } = await start()
    planner.clear()
    expect(details.notesOf('exercise', 'sq')).toBe('')
  })
})

describe('moving a -v3 cache and outbox', () => {
  const V3_CACHE = OLD_CACHE_PREFIXES.find((p) => p.endsWith('-v3:'))!
  const V3_OUTBOX = OLD_OUTBOX_PREFIXES.find((p) => p.endsWith('-v3:'))!
  const v3 = {
    exercise: {
      plans: {
        '2026-10-12': [
          { ...SQUATS, notes: 'Older note' },
          { id: 'pu', name: 'Push-ups', reps: 10, target: 4, notes: 'Push' },
        ],
        [WEEK]: [
          { ...SQUATS, notes: 'Latest note' },
          { id: 'pu', name: 'Push-ups', reps: 10, target: 4 },
        ],
      },
      log: {},
      revs: { [WEEK]: 1 },
    },
    diet: {
      plans: { [WEEK]: [{ id: 'veg', name: 'Vegetables', target: 7, notes: 'Not juice' }] },
      log: {},
      revs: {},
    },
    settings: null,
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActivePinia(createPinia())
    api = new FakeApi()
    api.addUser(USER)
    api.signedIn = USER
    vi.stubGlobal('fetch', api.fetch)
    lost = vi.fn<() => void>()
  })

  afterEach(() => {
    useSyncStore().stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lifts its plan notes into details, the latest week’s winning, and plans keep none', async () => {
    localStorage.setItem(V3_CACHE + USER, JSON.stringify(v3))
    api.stall('GET', '/state') // show the moved cache, as the browser does before the server answers
    const sync = useSyncStore()
    sync.start(USER, lost)
    const details = useDetailsStore()
    expect(details.notesOf('exercise', 'sq')).toBe('Latest note')
    expect(details.notesOf('exercise', 'pu')).toBe('Push')
    expect(details.notesOf('diet', 'veg')).toBe('Not juice')
    expect(cached().exercise.plans[WEEK]).toEqual([
      SQUATS,
      { id: 'pu', name: 'Push-ups', reps: 10, target: 4 },
    ])
    expect(cached().exercise.details).toEqual({
      sq: { notes: 'Latest note' },
      pu: { notes: 'Push' },
    })
    expect(localStorage.getItem(V3_CACHE + USER)).toBeNull()
    await flushPromises()
    // Nothing was queued in the -v3 outbox, so nothing of the notes is sent: the server has them.
    expect(detailsPuts()).toEqual([])
  })

  it('sends the lifted notes of a section whose plan writes were still queued', async () => {
    localStorage.setItem(V3_CACHE + USER, JSON.stringify(v3))
    localStorage.setItem(
      V3_OUTBOX + USER,
      JSON.stringify([{ kind: 'plan', section: 'exercise', week: WEEK, id: 'old' }]),
    )
    await start()
    expect(
      detailsPuts()
        .map((c) => c.path)
        .sort(),
    ).toEqual(['/details/exercise/pu', '/details/exercise/sq'])
    expect(api.accounts.get(USER)!.details.exercise.sq!.doc).toEqual({ notes: 'Latest note' })
    expect(localStorage.getItem(V3_OUTBOX + USER)).toBeNull()
  })

  /**
   * The server as migration 7 left it: each item's old note, lifted from its plans, at rev 1. The
   * old app's plan for WEEK, at rev 1, still had them.
   */
  function migrated(notes: Record<string, string>): void {
    const a = api.accounts.get(USER)!
    a.plans.exercise[WEEK] = { items: [SQUATS, { id: 'pu', name: 'Push-ups', reps: 10 }], rev: 1 }
    for (const [id, text] of Object.entries(notes)) {
      a.details.exercise[id] = { doc: { notes: text }, rev: 1 }
    }
  }

  /** A -v3 cache whose WEEK was edited offline under the old app, its plan write still queued. */
  function editedOffline(): void {
    const plans = {
      [WEEK]: [
        { ...SQUATS, notes: 'Edited offline' },
        // Its note was cleared offline: no week of the cache has one.
        { id: 'kh', name: 'Kettlebell halos', reps: 8, target: 3 },
      ],
    }
    localStorage.setItem(
      V3_CACHE + USER,
      JSON.stringify({ ...v3, exercise: { plans, log: {}, revs: { [WEEK]: 1 } } }),
    )
    localStorage.setItem(
      V3_OUTBOX + USER,
      JSON.stringify([{ kind: 'plan', section: 'exercise', week: WEEK, id: 'old' }]),
    )
  }

  it('keeps a note edited offline under the old app over the migrated one, and says nothing', async () => {
    migrated({ sq: 'Old note', kh: 'Cleared offline' })
    editedOffline()
    const { sync, details } = await start()
    expect(api.accounts.get(USER)!.details.exercise.sq).toEqual({
      doc: { notes: 'Edited offline' },
      rev: 2,
    })
    expect(details.notesOf('exercise', 'sq')).toBe('Edited offline')
    expect(sync.notice).toBeNull()
    expect(sync.pending).toBe(0)
  })

  it('sends a note cleared offline under the old app as a cleared document', async () => {
    migrated({ sq: 'Old note', kh: 'Cleared offline' })
    editedOffline()
    const { details } = await start()
    expect(api.accounts.get(USER)!.details.exercise.kh).toEqual({ doc: {}, rev: 2 })
    expect(details.notesOf('exercise', 'kh')).toBe('')
  })

  it('keeps the lifted note when it is edited again before it is sent', async () => {
    migrated({ sq: 'Old note' })
    editedOffline()
    api.offline = true
    const { sync, details } = await start()
    details.setNotes('exercise', 'sq', 'Edited again')
    await settle()
    expect(outbox()).toMatchObject([
      { kind: 'plan' },
      { kind: 'details', item: 'kh' },
      { kind: 'details', item: 'sq', lifted: true },
    ])
    api.offline = false
    await sync.refresh()
    expect(api.accounts.get(USER)!.details.exercise.sq!.doc).toEqual({ notes: 'Edited again' })
    expect(sync.notice).toBeNull()
  })

  it('lifts no write for an id the details path can’t name', async () => {
    const plans = {
      [WEEK]: [
        { id: 'a/b', name: 'Slash', target: 3, notes: 'Kept here only' },
        { id: '.', name: 'Dot', target: 3 },
        { ...SQUATS, notes: 'Sent' },
      ],
    }
    localStorage.setItem(
      V3_CACHE + USER,
      JSON.stringify({ ...v3, exercise: { plans, log: {}, revs: {} } }),
    )
    localStorage.setItem(
      V3_OUTBOX + USER,
      JSON.stringify([
        { kind: 'plan', section: 'exercise', week: WEEK, id: 'old' },
        // A week the cache no longer holds lifts nothing.
        { kind: 'plan', section: 'exercise', week: '2026-10-05', id: 'gone' },
      ]),
    )
    const { sync } = await start()
    expect(detailsPuts().map((c) => c.path)).toEqual(['/details/exercise/sq'])
    expect(sync.notice).toBeNull()
  })

  it('still takes the server’s copy when a lifted note was changed after the migration', async () => {
    migrated({ sq: 'Old note' })
    api.accounts.get(USER)!.details.exercise.sq = { doc: { notes: 'Changed since' }, rev: 2 }
    editedOffline()
    const { sync, details } = await start()
    expect(details.notesOf('exercise', 'sq')).toBe('Changed since')
    expect(sync.notice).toBe(DETAILS_CONFLICT_NOTICE)
  })

  it('takes the server’s rev-1 copy over a write that was not lifted', async () => {
    migrated({ sq: 'Old note' })
    api.stall('GET', '/state')
    const { sync, details } = await start(emptyState())
    details.setNotes('exercise', 'sq', 'Mine')
    await settle()
    expect(details.notesOf('exercise', 'sq')).toBe('Old note')
    expect(sync.notice).toBe(DETAILS_CONFLICT_NOTICE)
  })

  it('ignores a tab still open on the code from before details', async () => {
    api.accounts.get(USER)!.details.exercise.sq = { doc: { notes: 'Knees out' }, rev: 1 }
    const { sync, details } = await start()
    // That tab knows no details: it writes its plans, notes and all, under the -v3 names.
    localStorage.setItem(V3_CACHE + USER, JSON.stringify(v3))
    sync.onStorage(V3_CACHE + USER)
    localStorage.setItem(V3_OUTBOX + USER, '[]')
    sync.onStorage(V3_OUTBOX + USER)
    await settle()
    expect(details.notesOf('exercise', 'sq')).toBe('Knees out')
    expect(cached().exercise.details).toEqual({ sq: { notes: 'Knees out' } })
    expect(api.paths('PUT')).toEqual([])
  })
})

describe('details in diff and normaliseState', () => {
  const empty = () => ({ plans: {}, log: {}, details: {} })
  const snapshot = (exercise = empty(), diet = empty(), cardio = empty()) => ({
    exercise,
    cardio,
    diet,
    settings: { accent: '#30d158', dailyPick: 3, foodPick: 2, goals: '' },
  })

  it('finds each item whose details changed, were added, or were cleared', () => {
    const base = snapshot({ ...empty(), details: { sq: { notes: 'A' }, pu: { notes: 'B' } } })
    const local = snapshot(
      { ...empty(), details: { sq: { notes: 'A' }, kh: { notes: 'C' } } },
      { ...empty(), details: { veg: { fields: { serving: '80 g' } } } },
      { ...empty(), details: { ru: { fields: { route: 'The park' } } } },
    )
    expect(diff(base, local)).toEqual([
      { kind: 'details', section: 'exercise', item: 'pu' },
      { kind: 'details', section: 'exercise', item: 'kh' },
      { kind: 'details', section: 'cardio', item: 'ru' },
      { kind: 'details', section: 'diet', item: 'veg' },
    ])
  })

  it('validates details like stored data, lifting plan notes only from an older cache', () => {
    const raw = {
      exercise: {
        plans: { [WEEK]: [{ ...SQUATS, notes: 'In the plan' }] },
        log: {},
        details: { pu: { notes: '  Trimmed  ', other: 'dropped' }, bad: 'x', kh: {} },
        revs: {},
        detailRevs: { pu: 2, bad: 'x', zero: 0, kh: 3 },
      },
      diet: { plans: {}, log: {} },
    }
    const state = normaliseState(raw)!
    expect(state.exercise.plans[WEEK]).toEqual([SQUATS])
    expect(state.exercise.details).toEqual({ pu: { notes: 'Trimmed' } })
    expect(state.exercise.detailRevs).toEqual({ pu: 2, kh: 3 })
    expect(state.diet.details).toEqual({})
    expect(state.diet.detailRevs).toEqual({})
    expect(normaliseState(raw, true)!.exercise.details).toEqual({ sq: { notes: 'In the plan' } })
  })
})
