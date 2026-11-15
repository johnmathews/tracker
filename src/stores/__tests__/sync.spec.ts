import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { usePlannerStore } from '@/stores/planner'
import { useTrackersStore } from '@/stores/trackers'
import { useDetailsStore } from '@/stores/details'
import {
  CACHE_PREFIX,
  CONFLICT_NOTICE,
  OLD_CACHE_PREFIXES,
  OLD_OUTBOX_PREFIXES,
  OUTBOX_PREFIX,
  QUOTA_NOTICE,
  REFUSED_NOTICE,
  TRACKER_CONFLICT_NOTICE,
  TRACKER_FULL_NOTICE,
  DETAILS_CONFLICT_NOTICE,
  diff,
  legacyState,
  normaliseState,
  stateFromApi,
  useSyncStore,
  type SyncState,
} from '@/stores/sync'
import { DATA_KEY, DIET_KEY, LEGACY_DATA_KEY, defaultExercises } from '@/lib/storage'
import type { Arrangement, ItemSections } from '@/lib/itemSections'
import type { DetailsMap, Log } from '@/lib/storage'
import type { Plans } from '@/lib/plans'
import type { TrackerTypeId } from '@/lib/trackerTypes'
import type { TrackerInfo } from '@/lib/trackers'
import type { ExportData } from '@/lib/transfer'
import { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, cached, emptyState, oldState } from '@/lib/__tests__/signedIn'

// The -v3 names (before item details) are moved and lifted in syncDetails.spec.ts.
const [V5_CACHE, V4_CACHE, , V2_CACHE, V1_CACHE] = OLD_CACHE_PREFIXES
const [V5_OUTBOX, V4_OUTBOX, , V2_OUTBOX, V1_OUTBOX] = OLD_OUTBOX_PREFIXES

const NOW = new Date(2026, 9, 23, 18, 0)
const WEEK = '2026-10-19'
const PUSHUPS = { id: 'pu', name: 'Push-ups', reps: 10, target: 4 }
const SQUATS = { id: 'sq', name: 'Squats', reps: 15, target: 4 }

let api: FakeApi
let lost: ReturnType<typeof vi.fn<() => void>>

function outbox(): unknown[] {
  return JSON.parse(localStorage.getItem(OUTBOX_PREFIX + USER) ?? '[]') as unknown[]
}

function stateWith(plans: object, revs: object = {}): SyncState {
  const s = emptyState()
  s.sections.exercise.plans = plans as SyncState['sections'][string]['plans']
  s.sections.exercise.revs = revs as Record<string, number>
  return s
}

/** A cache from before trackers (`-v5` and older) whose exercise section holds `plans`. */
function oldStateWith(plans: object, revs: object = {}) {
  const s = oldState()
  s.exercise.plans = plans as SyncState['sections'][string]['plans']
  s.exercise.revs = revs as Record<string, number>
  return s
}

/** Start syncing alice, with `cache` on the device (or none), and let it settle. */
async function start(cache?: SyncState) {
  if (cache) localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(cache))
  const sync = useSyncStore()
  sync.start(USER, lost)
  await flushPromises()
  return { sync, planner: usePlannerStore(), trackers: useTrackersStore() }
}

/** Let a local change reach the watcher, then let the writes it queues finish. */
async function settle(): Promise<void> {
  await nextTick()
  await flushPromises()
}

describe('sync', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
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

  it('shows the cache at once, then takes the server’s state', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [SQUATS], rev: 3 }
    localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(stateWith({ [WEEK]: [PUSHUPS] })))
    const sync = useSyncStore()
    const trackers = useTrackersStore()
    sync.start(USER, lost)
    expect(sync.loaded).toBe(true)
    expect(trackers.itemsOf('exercise')).toEqual([PUSHUPS])
    await flushPromises()
    expect(trackers.itemsOf('exercise')).toEqual([SQUATS])
    expect(cached().sections.exercise).toEqual({
      plans: { [WEEK]: [SQUATS] },
      log: {},
      details: {},
      revs: { [WEEK]: 3 },
      detailRevs: {},
    })
  })

  it('loads from the server when the device has no cache', async () => {
    api.accounts.get(USER)!.settings = {
      accent: '#0a84ff',
      dailyPick: 5,
      foodPick: 4,
      goals: '',
      limits: '',
    }
    const sync = useSyncStore()
    sync.start(USER, lost)
    expect(sync.loaded).toBe(false)
    await flushPromises()
    expect(sync.loaded).toBe(true)
    expect(usePlannerStore().accent).toBe('#0a84ff')
    expect(cached().settings).toEqual({
      accent: '#0a84ff',
      dailyPick: 5,
      foodPick: 4,
      goals: '',
      limits: '',
    })
  })

  it('ignores a cache it cannot read', async () => {
    localStorage.setItem(CACHE_PREFIX + USER, '{broken')
    const sync = useSyncStore()
    sync.start(USER, lost)
    expect(sync.loaded).toBe(false)
    await flushPromises()
    expect(sync.loaded).toBe(true)
  })

  it('creates the week’s plan, then sends the tick, and uses the new revision next time', async () => {
    const { trackers } = await start(emptyState())
    trackers.toggle('exercise', 'pu', 0)
    await settle()
    expect(api.paths('PUT')).toEqual([
      `PUT /plans/exercise/${WEEK}`,
      `PUT /ticks/exercise/${WEEK}/pu/0`,
    ])
    expect(api.calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ rev: 0 })
    const server = api.accounts.get(USER)!
    expect(server.plans.exercise[WEEK]!.rev).toBe(1)
    expect(server.ticks.exercise[WEEK]).toEqual({ pu: 1 })
    expect(outbox()).toEqual([])
    trackers.changeTarget('exercise', 'pu', 1)
    await settle()
    expect(api.calls.at(-1)!.body).toMatchObject({ rev: 1 })
    expect(server.plans.exercise[WEEK]!.rev).toBe(2)
    expect(cached().sections.exercise.revs).toEqual({ [WEEK]: 2 })
  })

  it('sends food plans and ticks under the diet section', async () => {
    const { trackers } = await start(emptyState())
    trackers.toggle('diet', 'veg', 2)
    await settle()
    expect(api.paths('PUT')).toEqual([`PUT /plans/diet/${WEEK}`, `PUT /ticks/diet/${WEEK}/veg/2`])
  })

  it('sends cardio plans and ticks under the cardio section (K90)', async () => {
    const { trackers } = await start(emptyState())
    const id = trackers.addItem('cardio', { name: 'Cycling', duration: 1800 })!
    await settle()
    trackers.toggle('cardio', id, 2)
    await settle()
    expect(api.paths('PUT')).toEqual([
      `PUT /plans/cardio/${WEEK}`,
      `PUT /ticks/cardio/${WEEK}/${id}/2`,
    ])
    expect(cached().sections.cardio.plans[WEEK]).toEqual([
      { id, name: 'Cycling', duration: 1800, target: 3 },
    ])
    expect(api.accounts.get(USER)!.ticks.cardio[WEEK]).toEqual({ [id]: 0b100 })
  })

  it('reads a server, or a cache, with no cardio as none (K90)', async () => {
    const old = emptyState()
    delete (old.sections as Partial<typeof old.sections>).cardio
    const { trackers } = await start(old)
    expect(trackers.itemsOf('cardio')).toEqual([])
    expect(trackers.plansOf('cardio')).toEqual({})
  })

  it('sends a daily target as a tracker write, which keeps the setting in step (K123)', async () => {
    api.accounts.get(USER)!.settings = {
      accent: '#30d158',
      dailyPick: 3,
      foodPick: 2,
      goals: '',
      limits: '',
    }
    const { trackers } = await start(emptyState())
    trackers.changeDailyTarget('exercise', 1)
    await settle()
    expect(api.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: '/trackers/exercise',
      body: { rev: 1, name: 'Strength', position: 0, dailyTarget: 4 },
    })
    expect(api.paths('PUT /settings')).toEqual([])
    expect(api.tracker(USER, 'exercise')).toMatchObject({ dailyTarget: 4, rev: 2 })
    expect(api.accounts.get(USER)!.settings).toMatchObject({ dailyPick: 4, foodPick: 2 })
    expect(cached().trackers[0]).toMatchObject({ id: 'exercise', dailyTarget: 4, rev: 2 })
    expect(cached().settings).toEqual({
      accent: '#30d158',
      dailyPick: 4,
      foodPick: 2,
      goals: '',
      limits: '',
    })
  })

  it('sends a foods-a-day change the same way, and the tracker holds it with no settings saved', async () => {
    const { trackers } = await start(emptyState())
    trackers.changeDailyTarget('diet', 2)
    await settle()
    expect(api.paths()).toContain('PATCH /trackers/diet')
    expect(api.tracker(USER, 'diet')).toMatchObject({ dailyTarget: 4, rev: 2 })
    expect(api.accounts.get(USER)!.settings).toBeNull()
    expect(cached().trackers[2]).toMatchObject({ id: 'diet', dailyTarget: 4, rev: 2 })
    expect(cached().settings).toBeNull()
  })

  it('sends the daily picks with the settings, from the first trackers (K123)', async () => {
    const { planner, trackers } = await start(emptyState())
    trackers.setDailyTarget('exercise', 5)
    trackers.setDailyTarget('diet', 6)
    planner.setGoals('Run 5 km.')
    await settle()
    const put = api.calls.find((c) => c.path === '/settings')!
    expect(put.body).toMatchObject({ dailyPick: 5, foodPick: 6, goals: 'Run 5 km.' })
    expect(api.accounts.get(USER)!.settings).toMatchObject({ dailyPick: 5, foodPick: 6 })
    expect(cached().settings).toEqual({
      accent: '#30d158',
      dailyPick: 5,
      foodPick: 6,
      goals: 'Run 5 km.',
    })
  })

  it('sends an item-page arrangement with the settings, and caches it (K66)', async () => {
    const { planner } = await start(emptyState())
    const arranged = {
      order: ['history', 'notes', 'details', 'plan'],
      hidden: ['details'],
    } as const
    planner.setArrangement('strength', { order: [...arranged.order], hidden: [...arranged.hidden] })
    await settle()
    const settings = { accent: '#30d158', dailyPick: 3, foodPick: 2 }
    expect(api.calls.at(-1)).toMatchObject({
      method: 'PUT',
      path: '/settings',
      body: { ...settings, itemSections: { strength: arranged } },
    })
    expect(api.accounts.get(USER)!.settings).toEqual({
      ...settings,
      goals: '',
      limits: '',
      itemSections: { strength: arranged },
    })
    expect(cached().settings).toEqual({ ...settings, itemSections: { strength: arranged } })
    // Back to the default: sent as {}, so the server forgets the old one rather than keep it.
    planner.setArrangement('strength', {
      order: ['plan', 'notes', 'details', 'history'],
      hidden: [],
    })
    await settle()
    expect(api.calls.at(-1)).toMatchObject({ body: { ...settings, itemSections: {} } })
    expect(api.accounts.get(USER)!.settings).toEqual({ ...settings, goals: '', limits: '' })
    expect(cached().settings).toEqual(settings)
  })

  it('takes the server’s arrangement on a read', async () => {
    const arranged: Arrangement = {
      order: ['notes', 'details', 'plan', 'history'],
      hidden: ['history'],
    }
    api.accounts.get(USER)!.settings = {
      accent: '#30d158',
      dailyPick: 3,
      foodPick: 2,
      goals: '',
      limits: '',
      itemSections: { food: arranged },
    }
    const { planner } = await start(emptyState())
    expect(planner.arrangementFor('food')).toEqual(arranged)
    expect(api.paths('PUT')).toEqual([])
  })

  it('ends on the latest value when a cell is toggled while its write is in flight', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [PUSHUPS], rev: 1 }
    const { trackers } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 1 }))
    const release = api.hold()
    trackers.toggle('exercise', 'pu', 0) // great: sent, reply held
    await nextTick()
    trackers.toggle('exercise', 'pu', 0) // partial: queued behind it, replacing nothing in flight
    await nextTick()
    release()
    await flushPromises()
    expect(trackers.markOf('exercise', 'pu', 0)).toBe('partial')
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ pu: 1 })
    expect(api.accounts.get(USER)!.partial.exercise[WEEK]).toEqual({ pu: 1 })
    expect(api.calls.at(-1)!.body).toEqual({ mark: 'partial', done: true })
    expect(outbox()).toEqual([])
  })

  it('keeps writes while offline, says so, and sends them once back', async () => {
    const { sync, trackers } = await start(emptyState())
    api.offline = true
    trackers.toggle('exercise', 'sq', 3)
    await settle()
    expect(sync.status).toBe('offline')
    expect(sync.pending).toBe(2)
    expect(outbox()).toHaveLength(2)
    api.offline = false
    await sync.flush()
    expect(sync.status).toBe('idle')
    expect(sync.pending).toBe(0)
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ sq: 8 })
  })

  it('retries on a timer that backs off', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    const { sync, trackers } = await start(emptyState())
    api.offline = true
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    const tries = () => api.paths(`/plans/exercise/${WEEK}`).length
    expect(tries()).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tries()).toBe(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tries()).toBe(2) // the second wait is ten seconds
    api.offline = false
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tries()).toBe(3)
    expect(sync.pending).toBe(0)
  })

  it('treats a gateway error as offline', async () => {
    const { sync, trackers } = await start(emptyState())
    api.failNext('PUT', '/plans', 502)
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    expect(sync.status).toBe('offline')
    expect(sync.pending).toBe(2)
  })

  it('hands control back on a 401 and keeps the outbox for after sign-in', async () => {
    const { trackers } = await start(emptyState())
    api.signedIn = null
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    expect(lost).toHaveBeenCalledOnce()
    expect(outbox()).toHaveLength(2)
  })

  it('hands control back when a read finds the session gone', async () => {
    api.signedIn = null
    await start(emptyState())
    expect(lost).toHaveBeenCalledOnce()
  })

  it('takes the server’s copy of a plan changed elsewhere, and says so', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [SQUATS], rev: 2 }
    api.stall('GET', '/state') // the start-up read must not bring the server's copy in first
    const { sync, trackers } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 1 }))
    trackers.changeTarget('exercise', 'pu', 1)
    await settle()
    expect(trackers.itemsOf('exercise')).toEqual([SQUATS])
    expect(sync.notice).toBe(CONFLICT_NOTICE)
    expect(cached().sections.exercise.revs).toEqual({ [WEEK]: 2 })
    await settle()
    expect(api.paths('PUT')).toHaveLength(1) // adopting their copy queues nothing
    sync.dismissNotice()
    expect(sync.notice).toBeNull()
  })

  it('takes the server’s copy of a food plan the same way', async () => {
    const veg = { id: 'veg', name: 'Vegetables', target: 7 }
    api.accounts.get(USER)!.plans.diet[WEEK] = { items: [veg], rev: 2 }
    api.stall('GET', '/state')
    const cache = emptyState()
    cache.sections.diet.plans = { [WEEK]: [veg, { id: 'nuts', name: 'Nuts', target: 3 }] }
    cache.sections.diet.revs = { [WEEK]: 1 }
    const { sync, trackers } = await start(cache)
    trackers.changeTarget('diet', 'veg', -1)
    await settle()
    expect(trackers.itemsOf('diet')).toEqual([veg])
    expect(sync.notice).toBe(CONFLICT_NOTICE)
  })

  it('takes the server’s copy of a cardio plan the same way', async () => {
    const run = { id: 'ru', name: 'Running', distance: 5, target: 3 }
    api.accounts.get(USER)!.plans.cardio[WEEK] = { items: [run], rev: 2 }
    api.stall('GET', '/state')
    const cache = emptyState()
    cache.sections.cardio.plans = { [WEEK]: [run, { id: 'cy', name: 'Cycling', target: 2 }] }
    cache.sections.cardio.revs = { [WEEK]: 1 }
    const { sync, trackers } = await start(cache)
    trackers.changeTarget('cardio', 'ru', -1)
    await settle()
    expect(trackers.itemsOf('cardio')).toEqual([run])
    expect(sync.notice).toBe(CONFLICT_NOTICE)
  })

  it('keeps a tick write while offline when the week already has its plan', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [PUSHUPS], rev: 1 }
    const { sync, trackers } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 1 }))
    api.offline = true
    trackers.toggle('exercise', 'pu', 2)
    await settle()
    expect(outbox()).toMatchObject([{ kind: 'tick', item: 'pu', day: 2, mark: 'great' }])
    expect(sync.status).toBe('offline')
  })

  it('does nothing on refresh before it has started', async () => {
    await useSyncStore().refresh()
    expect(api.calls).toEqual([])
  })

  it('keeps a settings write while offline', async () => {
    const { sync, trackers } = await start(emptyState())
    api.offline = true
    trackers.changeDailyTarget('exercise', 1)
    await settle()
    expect(sync.pending).toBe(1)
    expect(sync.status).toBe('offline')
  })

  it('sends a plan again as a create when the server has none', async () => {
    api.stall('GET', '/state')
    const { sync, trackers } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 4 }))
    trackers.changeTarget('exercise', 'pu', 1)
    await settle()
    const bodies = api.calls.filter((c) => c.method === 'PUT').map((c) => c.body)
    expect(bodies).toMatchObject([{ rev: 4 }, { rev: 0 }])
    expect(api.accounts.get(USER)!.plans.exercise[WEEK]!.rev).toBe(1)
    expect(sync.notice).toBeNull()
  })

  it('raises no notice when another device already created the same week', async () => {
    const defaults = defaultExercises()
    api.stall('GET', '/state')
    const { sync, trackers } = await start(emptyState())
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: defaults, rev: 1 }
    trackers.toggle('exercise', 'pu', 0)
    await settle()
    expect(sync.notice).toBeNull()
    expect(cached().sections.exercise.revs).toEqual({ [WEEK]: 1 })
  })

  it('drops a refused write so the rest still go', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, trackers } = await start(emptyState())
    api.failNext('PUT', '/plans', 400, { error: 'invalid' })
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    expect(warn).toHaveBeenCalledOnce()
    expect(sync.pending).toBe(0)
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ sq: 1 })
  })

  it('never lets a read undo a change made while it was in flight', async () => {
    const { sync, trackers } = await start(emptyState())
    // The read's reply is the state before the tick, and it lands after the tick has synced.
    const release = api.holdNext('GET', '/state')
    const read = sync.refresh()
    await flushPromises()
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    expect(sync.pending).toBe(0)
    release()
    await read
    expect(trackers.isDone('exercise', 'sq', 0)).toBe(true)
  })

  it('never lets a read undo a change its watcher has not seen yet', async () => {
    const { sync, trackers } = await start(emptyState())
    const release = api.holdNext('GET', '/state')
    const read = sync.refresh()
    await flushPromises()
    // The reply lands in the same tick as the edit, before Vue runs the sync watcher.
    trackers.changeTarget('exercise', 'sq', 1)
    release()
    await read
    await settle()
    expect(trackers.itemsOf('exercise').find((e) => e.id === 'sq')!.target).toBe(5)
    expect(api.accounts.get(USER)!.plans.exercise[WEEK]).toBeDefined()
  })

  it('keeps an unseen change when another tab writes the cache', async () => {
    const { sync, trackers } = await start(emptyState())
    trackers.changeTarget('exercise', 'sq', 1)
    sync.onStorage(CACHE_PREFIX + USER) // in the same tick, before the watcher runs
    await settle()
    expect(api.accounts.get(USER)!.plans.exercise[WEEK]!.items).toHaveLength(5)
  })

  it('reads the server only once the outbox is empty', async () => {
    const { sync, trackers } = await start(emptyState())
    api.offline = true
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    const reads = api.paths('GET /state').length
    await sync.refresh() // still offline: the writes stay queued, so no read
    expect(api.paths('GET /state')).toHaveLength(reads)
    expect(trackers.isDone('exercise', 'sq', 0)).toBe(true)
  })

  it('brings in other devices’ changes on refresh', async () => {
    const { sync, trackers } = await start(emptyState())
    api.accounts.get(USER)!.ticks.exercise[WEEK] = { sq: 0b10 }
    await sync.refresh()
    expect(trackers.isDone('exercise', 'sq', 1)).toBe(true)
  })

  it('adopts another tab’s cache write without sending it again', async () => {
    const { sync, trackers } = await start(emptyState())
    const other = stateWith({ [WEEK]: [SQUATS] }, { [WEEK]: 1 })
    localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(other))
    sync.onStorage(CACHE_PREFIX + USER)
    await settle()
    expect(trackers.itemsOf('exercise')).toEqual([SQUATS])
    expect(api.paths('PUT')).toEqual([])
    localStorage.setItem(OUTBOX_PREFIX + USER, JSON.stringify([{ kind: 'settings', id: 'a' }]))
    sync.onStorage(OUTBOX_PREFIX + USER)
    expect(sync.pending).toBe(1)
    sync.onStorage('something-else')
    sync.stop()
    sync.onStorage(CACHE_PREFIX + USER) // after stop: ignored
  })

  it('adopts another tab’s cache write without writing it back', async () => {
    const { sync, trackers } = await start(emptyState())
    // A tab still open on the code from before foods a day (K57) writes settings without
    // `foodPick`. Writing the adopted state back would add it, that tab would adopt and drop it
    // again, and the two would echo the cache between them, undoing each other's marks.
    const other = stateWith({ [WEEK]: [SQUATS] }, { [WEEK]: 1 })
    other.settings = { accent: '#2f6b4f', dailyPick: 3 } as SyncState['settings']
    const written = JSON.stringify(other)
    localStorage.setItem(CACHE_PREFIX + USER, written)
    sync.onStorage(CACHE_PREFIX + USER)
    await settle()
    expect(trackers.itemsOf('exercise')).toEqual([SQUATS])
    expect(localStorage.getItem(CACHE_PREFIX + USER)).toBe(written)
  })

  describe('My goals (F1)', () => {
    const PICKS = { accent: '#30d158', dailyPick: 3, foodPick: 2 }

    it('sends the goals the person sets, in one settings write', async () => {
      const { planner } = await start(emptyState())
      planner.setGoals('  Run 5 km by March.\n')
      await settle()
      expect(api.paths('PUT')).toEqual(['PUT /settings'])
      expect(api.calls.at(-1)!.body).toEqual({
        ...PICKS,
        goals: 'Run 5 km by March.',
        itemSections: {},
      })
      expect(api.accounts.get(USER)!.settings).toEqual({
        ...PICKS,
        goals: 'Run 5 km by March.',
        limits: '',
      })
      expect(cached().settings).toEqual({ ...PICKS, goals: 'Run 5 km by March.' })
      // The same text again is no change, so nothing more is sent.
      planner.setGoals('Run 5 km by March.')
      await settle()
      expect(api.paths('PUT')).toEqual(['PUT /settings'])
    })

    it('keeps its goals when a tab on older code writes the cache without them', async () => {
      api.accounts.get(USER)!.settings = { ...PICKS, goals: 'Lose 3 kg.', limits: '' }
      const { sync, planner, trackers } = await start()
      expect(planner.goals).toBe('Lose 3 kg.')
      const other = emptyState()
      other.trackers[0]!.dailyTarget = 5
      other.settings = { ...PICKS, dailyPick: 5 } as SyncState['settings']
      const written = JSON.stringify(other)
      localStorage.setItem(CACHE_PREFIX + USER, written)
      sync.onStorage(CACHE_PREFIX + USER)
      await settle()
      expect(trackers.dailyTarget('exercise')).toBe(5)
      expect(planner.goals).toBe('Lose 3 kg.')
      expect(localStorage.getItem(CACHE_PREFIX + USER)).toBe(written)
      // The next settings write still carries them.
      planner.setDailyGoal(false)
      await settle()
      const sent = { ...PICKS, dailyPick: 5, dailyGoal: false, goals: 'Lose 3 kg.', limits: '' }
      expect(api.calls.at(-1)!.body).toEqual({ ...sent, itemSections: {} })
      expect(api.accounts.get(USER)!.settings).toEqual(sent)
    })

    it('never sends goals it has not read, when it starts from an older tab’s cache', async () => {
      api.accounts.get(USER)!.settings = { ...PICKS, goals: 'Lose 3 kg.', limits: '' }
      api.offline = true // the cache is all this tab has
      const old = emptyState()
      old.settings = { ...PICKS } as SyncState['settings']
      const { sync, planner } = await start(old)
      expect(planner.goals).toBe('')
      planner.setDailyGoal(false)
      await settle()
      // Its cache doesn't claim goals it never had, so no other tab adopts an empty one.
      expect(cached().settings).toEqual({ ...PICKS, dailyGoal: false })
      api.offline = false
      await sync.refresh()
      const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/settings')!
      expect(put.body).toEqual({ ...PICKS, dailyGoal: false, itemSections: {} })
      const saved = { ...PICKS, dailyGoal: false, goals: 'Lose 3 kg.', limits: '' }
      expect(api.accounts.get(USER)!.settings).toEqual(saved)
      expect(planner.goals).toBe('Lose 3 kg.')
      expect(cached().settings).toEqual(saved)
    })
  })

  describe('Your limits (K107)', () => {
    const PICKS = { accent: '#30d158', dailyPick: 3, foodPick: 2 }

    it('sends the limits the person sets, in one settings write', async () => {
      const { planner } = await start(emptyState())
      planner.setLimits(' Left knee: no jumping.\n')
      await settle()
      expect(api.paths('PUT')).toEqual(['PUT /settings'])
      expect(api.calls.at(-1)!.body).toEqual({
        ...PICKS,
        limits: 'Left knee: no jumping.',
        itemSections: {},
      })
      expect(api.accounts.get(USER)!.settings).toMatchObject({ limits: 'Left knee: no jumping.' })
      expect(cached().settings).toEqual({ ...PICKS, limits: 'Left knee: no jumping.' })
    })

    it('keeps its limits when a tab from before them writes the cache with goals only', async () => {
      api.accounts.get(USER)!.settings = { ...PICKS, goals: 'Run 5 km.', limits: 'Vegetarian.' }
      const { sync, planner, trackers } = await start()
      expect(planner.limits).toBe('Vegetarian.')
      const other = emptyState()
      other.trackers[0]!.dailyTarget = 5
      other.settings = { ...PICKS, dailyPick: 5, goals: 'Run 5 km.' } as SyncState['settings']
      localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(other))
      sync.onStorage(CACHE_PREFIX + USER)
      await settle()
      expect([trackers.dailyTarget('exercise'), planner.limits]).toEqual([5, 'Vegetarian.'])
      planner.setDailyGoal(false)
      await settle()
      expect(api.calls.at(-1)!.body).toMatchObject({ limits: 'Vegetarian.' })
    })

    it('never sends limits it has not read, when it starts from an older tab’s cache', async () => {
      api.accounts.get(USER)!.settings = { ...PICKS, goals: '', limits: 'Vegetarian.' }
      api.offline = true
      const old = emptyState()
      old.settings = { ...PICKS, goals: '' } as SyncState['settings']
      const { sync, planner } = await start(old)
      planner.setDailyGoal(false)
      await settle()
      expect(cached().settings).toEqual({ ...PICKS, dailyGoal: false, goals: '' })
      api.offline = false
      await sync.refresh()
      const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/settings')!
      expect('limits' in (put.body as object)).toBe(false)
      expect(api.accounts.get(USER)!.settings).toMatchObject({ limits: 'Vegetarian.' })
      expect(planner.limits).toBe('Vegetarian.')
    })
  })

  it('ignores a tab still open on the code from before the solid and hatch drawings', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [SQUATS], rev: 1 }
    const { sync, trackers } = await start(emptyState())
    for (let i = 0; i < 4; i++) trackers.toggle('exercise', 'sq', 0) // great, partial, missed, great-solid
    await settle()
    expect(trackers.markOf('exercise', 'sq', 0)).toBe('great-solid')
    // That tab reads 'great-solid' as an empty day and writes its copy back under the -v2 names.
    const stale = { ...oldStateWith({ [WEEK]: [SQUATS] }, { [WEEK]: 1 }) } as Record<
      string,
      unknown
    >
    stale.exercise = { plans: { [WEEK]: [SQUATS] }, log: { [WEEK]: { sq: Array(7).fill(null) } } }
    localStorage.setItem(V2_CACHE + USER, JSON.stringify(stale))
    sync.onStorage(V2_CACHE + USER)
    localStorage.setItem(V2_OUTBOX + USER, '[]')
    sync.onStorage(V2_OUTBOX + USER)
    await settle()
    expect(trackers.markOf('exercise', 'sq', 0)).toBe('great-solid')
    expect(cached().sections.exercise.log[WEEK]!.sq![0]).toBe('great-solid')
  })

  it('moves the -v4 cache and outbox as they are, details kept and nothing lifted (K90)', async () => {
    const v4 = {
      exercise: {
        plans: { [WEEK]: [SQUATS] },
        log: { [WEEK]: { sq: ['partial'] } },
        details: { sq: { notes: 'Knees out' } },
        revs: { [WEEK]: 3 },
        detailRevs: { sq: 2 },
      },
      diet: { plans: {}, log: {}, details: {}, revs: {}, detailRevs: {} },
      settings: null,
    }
    const plan = { kind: 'plan', section: 'exercise', week: WEEK, id: 'p' }
    localStorage.setItem(V4_CACHE + USER, JSON.stringify(v4))
    localStorage.setItem(V4_OUTBOX + USER, JSON.stringify([plan]))
    api.stall('GET', '/state')
    const sync = useSyncStore()
    const trackers = useTrackersStore()
    sync.start(USER, lost)
    expect(trackers.markOf('exercise', 'sq', 0)).toBe('partial')
    expect(cached().sections.exercise.details).toEqual({ sq: { notes: 'Knees out' } })
    expect(cached().sections.exercise.revs).toEqual({ [WEEK]: 3 })
    expect(cached().sections.cardio).toEqual({
      plans: {},
      log: {},
      details: {},
      revs: {},
      detailRevs: {},
    })
    // The plan write moves; no details write is queued, since a -v4 cache holds them already.
    expect(outbox()).toEqual([plan])
    expect(localStorage.getItem(V4_CACHE + USER)).toBeNull()
    expect(localStorage.getItem(V4_OUTBOX + USER)).toBeNull()
  })

  it('moves the -v2 cache and outbox, and prefers them to the -v1 ones', async () => {
    const tick = { kind: 'tick', section: 'exercise', week: WEEK, item: 'sq' }
    const v2 = {
      ...oldState(),
      exercise: { plans: {}, log: { [WEEK]: { sq: ['missed-hatch'] } } },
    }
    const v1 = { ...oldState(), exercise: { plans: {}, log: { [WEEK]: { sq: [true] } } } }
    localStorage.setItem(V2_CACHE + USER, JSON.stringify(v2))
    localStorage.setItem(V1_CACHE + USER, JSON.stringify(v1))
    localStorage.setItem(
      V2_OUTBOX + USER,
      JSON.stringify([{ ...tick, day: 1, mark: 'great-solid', id: 'b' }]),
    )
    localStorage.setItem(
      V1_OUTBOX + USER,
      JSON.stringify([
        { ...tick, day: 1, done: true, id: 'a' },
        { ...tick, day: 2, done: true, id: 'c' },
      ]),
    )
    const sync = useSyncStore()
    const trackers = useTrackersStore()
    sync.start(USER, lost)
    expect(trackers.markOf('exercise', 'sq', 0)).toBe('missed-hatch')
    expect(outbox()).toEqual([
      { ...tick, day: 2, mark: 'great', id: 'c' },
      { ...tick, day: 1, mark: 'great-solid', id: 'b' },
    ])
    for (const prefix of [...OLD_CACHE_PREFIXES, ...OLD_OUTBOX_PREFIXES]) {
      expect(localStorage.getItem(prefix + USER)).toBeNull()
    }
  })

  it('ignores a tab still open on the code from before marks had kinds', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [SQUATS], rev: 1 }
    const { sync, trackers } = await start(emptyState())
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    // That tab reads 'great' as an empty day and writes its copy back under the old names.
    const stale = { ...oldStateWith({ [WEEK]: [SQUATS] }, { [WEEK]: 1 }) } as Record<
      string,
      unknown
    >
    stale.exercise = { plans: { [WEEK]: [SQUATS] }, log: { [WEEK]: { sq: Array(7).fill(false) } } }
    localStorage.setItem(V1_CACHE + USER, JSON.stringify(stale))
    sync.onStorage(V1_CACHE + USER)
    localStorage.setItem(V1_OUTBOX + USER, '[]')
    sync.onStorage(V1_OUTBOX + USER)
    await settle()
    expect(trackers.markOf('exercise', 'sq', 0)).toBe('great')
    expect(cached().sections.exercise.log[WEEK]!.sq![0]).toBe('great')
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ sq: 0b1 })
  })

  it('moves the cache and outbox from the names before marks had kinds', async () => {
    const tick = { kind: 'tick', section: 'exercise', week: WEEK, item: 'sq' }
    const old = { ...oldState(), exercise: { plans: {}, log: { [WEEK]: { sq: [true] } } } }
    localStorage.setItem(V1_CACHE + USER, JSON.stringify(old))
    localStorage.setItem(
      V1_OUTBOX + USER,
      JSON.stringify([
        { ...tick, day: 0, done: true, id: 'a' },
        { ...tick, day: 1, done: true, id: 'b' },
      ]),
    )
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([{ ...tick, day: 1, mark: 'missed', id: 'c' }]),
    )
    const sync = useSyncStore()
    const trackers = useTrackersStore()
    sync.start(USER, lost)
    expect(trackers.markOf('exercise', 'sq', 0)).toBe('great')
    expect(outbox()).toEqual([
      { ...tick, day: 0, mark: 'great', id: 'a' },
      { ...tick, day: 1, mark: 'missed', id: 'c' },
    ])
    expect(localStorage.getItem(V1_CACHE + USER)).toBeNull()
    expect(localStorage.getItem(V1_OUTBOX + USER)).toBeNull()
    await settle()
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ sq: 0b11 })
  })

  it('keeps the cache under the new name over the old one, and drops an old one it cannot read', async () => {
    localStorage.setItem(V1_CACHE + USER, JSON.stringify(oldStateWith({ [WEEK]: [PUSHUPS] })))
    localStorage.setItem(V1_OUTBOX + USER, '{broken')
    localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(stateWith({ [WEEK]: [SQUATS] })))
    const sync = useSyncStore()
    const trackers = useTrackersStore()
    sync.start(USER, lost)
    expect(trackers.itemsOf('exercise')).toEqual([SQUATS])
    expect(localStorage.getItem(V1_CACHE + USER)).toBeNull()
    expect(localStorage.getItem(V1_OUTBOX + USER)).toBeNull()
    sync.stop()
    localStorage.setItem(V1_CACHE + USER, '{broken')
    localStorage.removeItem(CACHE_PREFIX + USER)
    sync.start(USER, lost)
    expect(sync.loaded).toBe(false)
    expect(localStorage.getItem(V1_CACHE + USER)).toBeNull()
  })

  it('stops cleanly, keeping the cache, and forgets on request', async () => {
    const { sync, trackers } = await start(emptyState())
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    sync.stop()
    expect(sync.loaded).toBe(false)
    expect(localStorage.getItem(CACHE_PREFIX + USER)).not.toBeNull()
    trackers.toggle('exercise', 'pu', 0) // no longer watched
    await settle()
    expect(api.paths(`/ticks/exercise/${WEEK}/pu`)).toEqual([])
    localStorage.setItem(OUTBOX_PREFIX + USER, '[]')
    localStorage.setItem(V1_CACHE + USER, '{}')
    localStorage.setItem(V1_OUTBOX + USER, '[]')
    sync.forget(USER)
    expect(localStorage.getItem(CACHE_PREFIX + USER)).toBeNull()
    expect(localStorage.getItem(OUTBOX_PREFIX + USER)).toBeNull()
    expect(localStorage.getItem(V1_CACHE + USER)).toBeNull()
    expect(localStorage.getItem(V1_OUTBOX + USER)).toBeNull()
  })

  it('never writes the keys from before accounts', async () => {
    localStorage.setItem(LEGACY_DATA_KEY, '{"exercises":[]}')
    const { trackers } = await start(emptyState())
    trackers.toggle('exercise', 'sq', 0)
    trackers.toggle('diet', 'veg', 0)
    await settle()
    expect(localStorage.getItem(DATA_KEY)).toBeNull()
    expect(localStorage.getItem(DIET_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_DATA_KEY)).toBe('{"exercises":[]}')
  })
})

describe('sync, after review', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActivePinia(createPinia())
    api = new FakeApi()
    api.addUser(USER)
    api.addUser('bob')
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

  it('names the expected user on every read and write', async () => {
    const { trackers } = await start(emptyState())
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    const synced = api.calls.filter((c) => c.path.startsWith('/state') || c.method === 'PUT')
    expect(synced.length).toBeGreaterThan(2)
    expect(synced.every((c) => c.expectedUser === USER)).toBe(true)
  })

  it('never writes into the account of someone who signed in in another tab', async () => {
    const { trackers } = await start(emptyState())
    api.signedIn = 'bob' // alice signed out elsewhere and bob signed in: the cookie is his
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    expect(lost).toHaveBeenCalled()
    expect(api.accounts.get('bob')!.plans.exercise).toEqual({})
    expect(api.accounts.get('bob')!.ticks.exercise).toEqual({})
  })

  it('keeps and retries a write the server failed', async () => {
    const { sync, trackers } = await start(emptyState())
    api.failNext('PUT', '/plans', 500)
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    expect(sync.pending).toBe(2)
    expect(sync.status).toBe('offline')
    await sync.flush()
    expect(sync.pending).toBe(0)
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ sq: 1 })
  })

  it('says so when it drops a write the server refused for good', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, trackers } = await start(emptyState())
    api.failNext('PUT', '/ticks', 403, { error: 'origin' })
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(REFUSED_NOTICE)
  })

  it('says the account is full when it drops a write refused for quota', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, trackers } = await start(emptyState())
    api.failNext('PUT', '/ticks', 413, { error: 'quota' })
    trackers.toggle('exercise', 'sq', 0)
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(QUOTA_NOTICE)
  })

  it('gives up on a request that never answers, and tries again', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    const { sync, trackers } = await start(emptyState())
    api.stall('PUT', '/plans')
    trackers.toggle('exercise', 'sq', 0)
    await nextTick()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(sync.status).toBe('offline')
    expect(sync.pending).toBe(2)
  })

  it('lets replies to the last user’s writes touch nothing of the next user’s', async () => {
    const { sync, trackers } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 1 }))
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [SQUATS], rev: 5 }
    const release = api.hold()
    trackers.changeTarget('exercise', 'pu', 1) // alice: will get a 409 carrying her server copy
    trackers.toggle('exercise', 'sq', 0) //       alice: will get a 401 once bob holds the cookie
    await nextTick()
    sync.stop()
    api.signedIn = 'bob'
    const bobLost = vi.fn<() => void>()
    sync.start('bob', bobLost)
    release()
    await flushPromises()
    expect(sync.notice).toBeNull()
    expect(bobLost).not.toHaveBeenCalled()
    expect(lost).not.toHaveBeenCalled()
    expect(sync.status).toBe('idle')
    expect(useTrackersStore().plansOf('exercise')).toEqual({})
    expect(sync.loaded).toBe(true)
  })

  it('treats another tab’s state as newer than a read already in flight', async () => {
    const { sync, trackers } = await start(emptyState())
    const release = api.holdNext('GET', '/state')
    const read = sync.refresh()
    await flushPromises()
    const other = emptyState()
    other.sections.exercise.log = { [WEEK]: { sq: ['great', null, null, null, null, null, null] } }
    localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(other))
    sync.onStorage(CACHE_PREFIX + USER)
    release()
    await read
    expect(trackers.isDone('exercise', 'sq', 0)).toBe(true)
  })

  it('skips damaged outbox entries rather than sticking on them', async () => {
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([
        null,
        { kind: 'plan', section: 'nope', week: WEEK },
        { kind: 'settings', id: 'a' },
      ]),
    )
    const { sync } = await start(emptyState())
    await settle()
    expect(sync.pending).toBe(0)
    expect(api.paths('PUT')).toEqual(['PUT /settings'])
  })

  it('sends a tick queued before marks had kinds as the mark it meant', async () => {
    const tick = { kind: 'tick', section: 'exercise', week: WEEK, item: 'sq' }
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([
        { ...tick, day: 0, done: true, id: 'a' },
        { ...tick, day: 1, done: false, id: 'b' },
        { ...tick, day: 2, done: 'yes', id: 'c' },
        { ...tick, day: 3, mark: 'meh', id: 'd' },
        { ...tick, day: 4, mark: 'missed', id: 'e' },
      ]),
    )
    const { sync } = await start(emptyState())
    await settle()
    expect(sync.pending).toBe(0)
    expect(api.calls.filter((c) => c.method === 'PUT').map((c) => [c.path, c.body])).toEqual([
      [`/ticks/exercise/${WEEK}/sq/0`, { mark: 'great', done: true }],
      [`/ticks/exercise/${WEEK}/sq/1`, { mark: null, done: false }],
      [`/ticks/exercise/${WEEK}/sq/4`, { mark: 'missed', done: true }],
    ])
  })

  it('drops a plan write for a week the stores no longer hold', async () => {
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([{ kind: 'plan', section: 'exercise', week: '2026-01-05', id: 'a' }]),
    )
    const { sync } = await start(emptyState())
    await settle()
    expect(sync.pending).toBe(0)
    expect(api.paths('PUT')).toEqual([])
  })
})

describe('trackers (K123)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
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

  it('creates a tracker with its own id and week, then sends its plan and marks', async () => {
    const { sync, trackers } = await start(emptyState())
    const id = trackers.createTracker({ name: 'Upper body', kind: 'strength' })!
    const item = trackers.addItem(id, { name: 'Dips', reps: 8, perSide: false })!
    trackers.toggle(id, item, 1)
    await settle()
    expect(api.paths().filter((p) => !p.startsWith('GET'))).toEqual([
      'POST /trackers',
      `PUT /plans/${id}/${WEEK}`,
      `PUT /ticks/${id}/${WEEK}/${item}/1`,
    ])
    expect(api.calls.find((c) => c.path === '/trackers')!.body).toEqual({
      id,
      name: 'Upper body',
      kind: 'strength',
      week: WEEK,
    })
    expect(api.tracker(USER, id)).toMatchObject({ position: 3, startWeek: WEEK, rev: 1 })
    expect(api.accounts.get(USER)!.ticks[id]![WEEK]).toEqual({ [item]: 0b10 })
    expect(sync.pending).toBe(0)
    expect(cached().trackers.at(-1)).toMatchObject({ id, name: 'Upper body', rev: 1 })
    expect(cached().sections[id]!.revs).toEqual({ [WEEK]: 1 })
    // The next read keeps it, with its data.
    await sync.refresh()
    expect(trackers.itemsOf(id).map((it) => it.name)).toEqual(['Dips'])
  })

  it('sends a create again safely: the server returns the tracker it holds', async () => {
    api.offline = true
    const { sync, trackers } = await start(emptyState())
    const id = trackers.createTracker({ name: 'Snacks', kind: 'food' })!
    await settle()
    expect(outbox()).toMatchObject([{ kind: 'tracker-create', section: id }])
    // The create reached the server, but its reply was lost: it is still queued.
    api.offline = false
    const a = api.accounts.get(USER)!
    a.trackers.push({ ...trackers.get(id)!, rev: 1 })
    await sync.refresh()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBeNull()
    expect(a.trackers.filter((t) => t.id === id)).toHaveLength(1)
  })

  it('sends what changed before the create was sent as a patch, and takes the server’s place', async () => {
    api.offline = true
    const { sync, trackers } = await start(emptyState())
    const id = trackers.createTracker({ name: 'Snacks', kind: 'food' })!
    await settle()
    trackers.setDailyTarget(id, 5)
    trackers.renameTracker(id, 'Treats')
    await settle()
    // Another device made one meanwhile, so this one goes after it.
    api.offline = false
    const a = api.accounts.get(USER)!
    a.trackers.push({ ...trackers.get(id)!, id: 'xother', position: 3, rev: 1 })
    const online = api.calls.length
    await sync.refresh()
    const writes = api.calls.slice(online).filter((c) => c.method !== 'GET')
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /trackers',
      `PATCH /trackers/${id}`,
    ])
    expect(writes[0]!.body).toMatchObject({ name: 'Treats' })
    expect(writes[1]!.body).toEqual({ rev: 1, name: 'Treats', position: 4, dailyTarget: 5 })
    expect(api.tracker(USER, id)).toMatchObject({ name: 'Treats', dailyTarget: 5, position: 4 })
    expect(trackers.get(id)!.position).toBe(4)
    expect(sync.pending).toBe(0)
  })

  it('renames a tracker with the revision last seen, and takes the new one', async () => {
    const { trackers } = await start(emptyState())
    trackers.renameTracker('cardio', 'Endurance')
    await settle()
    expect(api.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: '/trackers/cardio',
      body: { rev: 1, name: 'Endurance', position: 1, dailyTarget: null },
    })
    trackers.renameTracker('cardio', 'Cardio work')
    await settle()
    expect(api.calls.at(-1)!.body).toMatchObject({ rev: 2 })
    expect(api.tracker(USER, 'cardio')).toMatchObject({ name: 'Cardio work', rev: 3 })
    expect(cached().trackers[1]).toMatchObject({ name: 'Cardio work', rev: 3 })
  })

  it('takes the server’s copy of a tracker changed on another device', async () => {
    api.stall('GET', '/state')
    const { sync, trackers } = await start(emptyState())
    Object.assign(api.tracker(USER, 'diet')!, { name: 'Meals', rev: 4 })
    trackers.renameTracker('diet', 'Eating')
    await settle()
    expect(trackers.get('diet')!.name).toBe('Meals')
    expect(sync.notice).toBe(TRACKER_CONFLICT_NOTICE)
    expect(sync.pending).toBe(0)
    expect(cached().trackers[2]).toMatchObject({ name: 'Meals', rev: 4 })
    // Nothing goes back: their copy is the base now.
    await settle()
    expect(api.paths('PATCH')).toHaveLength(1)
  })

  it('keeps its own end when a conflict brings the server’s copy in', async () => {
    api.stall('GET', '/state')
    const { trackers } = await start(emptyState())
    Object.assign(api.tracker(USER, 'cardio')!, { name: 'Rides', rev: 4 })
    trackers.renameTracker('cardio', 'Runs')
    trackers.endTracker('cardio')
    await settle()
    expect(trackers.get('cardio')).toMatchObject({ name: 'Rides', endWeek: WEEK })
    expect(api.tracker(USER, 'cardio')!.endWeek).toBe(WEEK)
  })

  it('sends a change made on a cache from before trackers at the server’s revision', async () => {
    api.offline = true
    localStorage.setItem(V5_CACHE + USER, JSON.stringify(oldState()))
    const { sync, trackers } = await start()
    expect(cached().trackers[0]!.rev).toBe(0)
    trackers.renameTracker('exercise', 'Lifting')
    await settle()
    api.offline = false
    Object.assign(api.tracker(USER, 'exercise')!, { rev: 3 })
    const online = api.calls.length
    await sync.refresh()
    const patches = api.calls.slice(online).filter((c) => c.method === 'PATCH')
    expect(patches.map((c) => c.body)).toMatchObject([{ rev: 0 }, { rev: 3 }])
    expect(api.tracker(USER, 'exercise')).toMatchObject({ name: 'Lifting', rev: 4 })
    expect(sync.notice).toBeNull()
  })

  it('ends a tracker from the week on screen, keeping its history (K122)', async () => {
    const { sync, planner, trackers } = await start(emptyState())
    trackers.toggle('cardio', 'x', 0)
    planner.nextWeek()
    trackers.endTracker('cardio')
    await settle()
    // The end goes first: a tracker's writes come before its plans' and marks'.
    expect(api.paths().filter((p) => !p.startsWith('GET'))[0]).toBe('POST /trackers/cardio/end')
    expect(api.calls.find((c) => c.path.endsWith('/end'))!.body).toEqual({ week: '2026-10-26' })
    expect(api.tracker(USER, 'cardio')).toMatchObject({ endWeek: '2026-10-26', rev: 2 })
    expect(cached().trackers[1]).toMatchObject({ endWeek: '2026-10-26', rev: 2 })
    await sync.refresh()
    expect(trackers.shown.map((t) => t.id)).toEqual(['exercise', 'diet'])
    planner.prevWeek()
    expect(trackers.shown.map((t) => t.id)).toEqual(['exercise', 'cardio', 'diet'])
    expect(trackers.markOf('cardio', 'x', 0)).toBe('great')
  })

  it('keeps an earlier end the server holds', async () => {
    api.stall('GET', '/state')
    const { trackers } = await start(emptyState())
    api.tracker(USER, 'diet')!.endWeek = '2026-10-12'
    trackers.endTracker('diet')
    await settle()
    expect(trackers.get('diet')!.endWeek).toBe('2026-10-12')
    expect(api.paths('POST /trackers')).toEqual(['POST /trackers/diet/end'])
  })

  it('drops a refused tracker write and says so, so the rest still go', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, trackers } = await start(emptyState())
    api.failNext('POST', '/trackers', 409, { error: 'too-many' })
    trackers.createTracker({ name: 'One too many', kind: 'food' })
    trackers.toggle('exercise', 'pu', 0)
    await settle()
    expect(sync.notice).toBe(TRACKER_FULL_NOTICE)
    expect(sync.pending).toBe(0)
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ pu: 1 })
  })

  it('drops the writes queued for a tracker the server refused to create, saying why once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, trackers } = await start(emptyState())
    api.failNext('POST', '/trackers', 409, { error: 'exists' })
    const id = trackers.createTracker({ name: 'Taken', kind: 'food' })!
    trackers.addItem(id, { name: 'Oats' })
    trackers.endTracker(id)
    trackers.toggle('exercise', 'pu', 0)
    await settle()
    expect(sync.notice).toBe(REFUSED_NOTICE)
    expect(sync.pending).toBe(0)
    expect(api.paths(`/trackers/${id}`)).toEqual([])
    expect(api.paths(`/plans/${id}/`)).toEqual([])
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ pu: 1 })
  })

  it('sends nothing for a tracker the stores no longer hold', async () => {
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([
        { kind: 'tracker-create', section: 'xgone', id: 'a' },
        { kind: 'tracker-patch', section: 'xgone', id: 'b' },
        { kind: 'tracker-end', section: 'bad id', week: WEEK, id: 'c' },
        { kind: 'tracker-end', section: 'x', week: 'nope', id: 'd' },
      ]),
    )
    const { sync } = await start(emptyState())
    await settle()
    expect(sync.pending).toBe(0)
    expect(api.paths('/trackers')).toEqual([])
  })

  it('lets replies to tracker writes sent before a sign-out touch nothing', async () => {
    const writes: ((t: ReturnType<typeof useTrackersStore>) => void)[] = [
      (t) => void t.createTracker({ name: 'Snacks', kind: 'food' }),
      (t) => void t.renameTracker('diet', 'Meals'),
      (t) => void t.endTracker('cardio'),
    ]
    for (const write of writes) {
      const { sync, trackers } = await start(emptyState())
      const release = api.hold()
      write(trackers)
      await nextTick()
      sync.stop()
      release()
      await flushPromises()
      expect(sync.notice).toBeNull()
      expect(lost).not.toHaveBeenCalled()
    }
  })

  it('takes a reply that isn’t a tracker as done, changing nothing', async () => {
    const { sync, trackers } = await start(emptyState())
    api.failNext('POST', '/trackers', 200, {})
    const id = trackers.createTracker({ name: 'Snacks', kind: 'food' })!
    await settle()
    api.failNext('PATCH', '/trackers/diet', 200, {})
    trackers.renameTracker('diet', 'Meals')
    await settle()
    api.failNext('POST', '/trackers/cardio/end', 200, {})
    trackers.endTracker('cardio')
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBeNull()
    expect(cached().trackers.find((t) => t.id === id)!.rev).toBe(0)
    expect(cached().trackers[2]).toMatchObject({ name: 'Meals', rev: 1 })
    expect(cached().trackers[1]).toMatchObject({ endWeek: WEEK, rev: 1 })
  })

  it('says so when a conflict brings no copy of the tracker, and keeps this one', async () => {
    api.stall('GET', '/state')
    const { sync, trackers } = await start(emptyState())
    api.failNext('PATCH', '/trackers/diet', 409, { error: 'conflict', rev: 7 })
    trackers.renameTracker('diet', 'Meals')
    await settle()
    expect(sync.notice).toBe(TRACKER_CONFLICT_NOTICE)
    expect(trackers.get('diet')!.name).toBe('Meals')
    expect(cached().trackers[2]!.rev).toBe(7)
  })

  it('drops an end the server refuses, and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, trackers } = await start(emptyState())
    api.failNext('POST', '/trackers/cardio/end', 404, { error: 'not-found' })
    trackers.endTracker('cardio')
    await settle()
    expect(sync.notice).toBe(REFUSED_NOTICE)
    expect(sync.pending).toBe(0)
  })

  it('sends queued writes for a tracker this device hasn’t read yet', async () => {
    api.stall('GET', '/state')
    const a = api.accounts.get(USER)!
    a.trackers.push({ ...a.trackers[1]!, id: 'xsrv', name: 'Other', position: 3, rev: 1 })
    a.details.xsrv = { le: { doc: { notes: 'Theirs' }, rev: 2 } }
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([
        // Another tab's create for one of the first three, which the server holds already.
        { kind: 'tracker-create', section: 'cardio', id: 'a' },
        { kind: 'tracker-end', section: 'xsrv', week: WEEK, id: 'b' },
        { kind: 'details', section: 'xsrv', item: 'le', id: 'c' },
      ]),
    )
    const { sync } = await start(emptyState())
    expect(sync.pending).toBe(0)
    expect(api.calls.find((c) => c.path === '/trackers')!.body).toMatchObject({
      id: 'cardio',
      week: WEEK,
    })
    expect(api.tracker(USER, 'xsrv')!.endWeek).toBe(WEEK)
    expect(useDetailsStore().notesOf('xsrv', 'le')).toBe('Theirs')
    expect(sync.notice).toBe(DETAILS_CONFLICT_NOTICE)
  })

  it('keeps its own earlier end over a later one the server’s copy brings', async () => {
    api.stall('GET', '/state')
    const { trackers } = await start(emptyState())
    Object.assign(api.tracker(USER, 'cardio')!, { endWeek: '2026-11-02', rev: 4 })
    trackers.renameTracker('cardio', 'Runs')
    trackers.endTracker('cardio')
    await settle()
    expect(trackers.get('cardio')!.endWeek).toBe(WEEK)
    expect(api.tracker(USER, 'cardio')!.endWeek).toBe(WEEK)
  })

  it('reads a tracker another device made, and shows it from its start week', async () => {
    const a = api.accounts.get(USER)!
    a.trackers.push({
      id: 'xswim',
      name: 'Swimming',
      kind: 'cardio',
      position: 3,
      dailyTarget: null,
      startWeek: '2026-10-26',
      endWeek: null,
      rev: 2,
    })
    a.plans.xswim = { '2026-10-26': { items: [{ id: 'le', name: 'Lengths', target: 2 }], rev: 1 } }
    const { planner, trackers } = await start(emptyState())
    expect(trackers.shown.map((t) => t.id)).toEqual(['exercise', 'cardio', 'diet'])
    planner.nextWeek()
    expect(trackers.shown.map((t) => t.id)).toEqual(['exercise', 'cardio', 'diet', 'xswim'])
    expect(trackers.itemsOf('xswim')).toEqual([{ id: 'le', name: 'Lengths', target: 2 }])
    expect(cached().trackers.at(-1)).toMatchObject({ id: 'xswim', rev: 2 })
  })
})

describe('upgrading from the cache and outbox before trackers (-v5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
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

  it('sends the marks and plans made offline on -v5 once the new code is online', async () => {
    // What the -v5 code left behind: a cardio item added and marked, and an exercise marked,
    // all offline.
    const v5 = oldState()
    const ride = { id: 'xride', name: 'Ride', duration: 1800, target: 2 }
    v5.cardio.plans = { [WEEK]: [ride] }
    v5.cardio.log = { [WEEK]: { xride: ['great', null, null, null, null, null, null] } }
    v5.exercise.log = { [WEEK]: { pu: [null, 'partial', null, null, null, null, null] } }
    v5.exercise.plans = { [WEEK]: defaultExercises() }
    v5.settings = { accent: '#30d158', dailyPick: 4, foodPick: 2, goals: '', limits: '' }
    const ops = [
      { kind: 'plan', section: 'cardio', week: WEEK, id: 'q1' },
      {
        kind: 'tick',
        section: 'cardio',
        week: WEEK,
        item: 'xride',
        day: 0,
        mark: 'great',
        id: 'q2',
      },
      { kind: 'plan', section: 'exercise', week: WEEK, id: 'q3' },
      {
        kind: 'tick',
        section: 'exercise',
        week: WEEK,
        item: 'pu',
        day: 1,
        mark: 'partial',
        id: 'q4',
      },
    ]
    localStorage.setItem(V5_CACHE + USER, JSON.stringify(v5))
    localStorage.setItem(V5_OUTBOX + USER, JSON.stringify(ops))
    const { sync, trackers } = await start()
    expect(localStorage.getItem(V5_CACHE + USER)).toBeNull()
    expect(localStorage.getItem(V5_OUTBOX + USER)).toBeNull()
    // The writes went as they were queued, onto the three original ids.
    expect(api.paths('PUT')).toEqual([
      `PUT /plans/cardio/${WEEK}`,
      `PUT /ticks/cardio/${WEEK}/xride/0`,
      `PUT /plans/exercise/${WEEK}`,
      `PUT /ticks/exercise/${WEEK}/pu/1`,
    ])
    const a = api.accounts.get(USER)!
    expect(a.plans.cardio[WEEK]!.items).toEqual([ride])
    expect(a.ticks.cardio[WEEK]).toEqual({ xride: 1 })
    expect(a.partial.exercise[WEEK]).toEqual({ pu: 0b10 })
    expect(sync.pending).toBe(0)
    // Then the server's state, with its trackers, replaced the converted cache.
    expect(trackers.markOf('cardio', 'xride', 0)).toBe('great')
    expect(cached().trackers.map((t) => [t.id, t.rev])).toEqual([
      ['exercise', 1],
      ['cardio', 1],
      ['diet', 1],
    ])
  })

  it('shows the -v5 cache at once as the first three trackers', async () => {
    api.stall('GET', '/state')
    const v5 = oldState()
    v5.diet.plans = { [WEEK]: [{ id: 'veg', name: 'Vegetables', target: 7 }] }
    v5.diet.details = { veg: { notes: 'Greens' } }
    v5.settings = { accent: '#30d158', dailyPick: 4, foodPick: 5 }
    localStorage.setItem(V5_CACHE + USER, JSON.stringify(v5))
    const sync = useSyncStore()
    const trackers = useTrackersStore()
    sync.start(USER, lost)
    expect(sync.loaded).toBe(true)
    expect(trackers.shown.map((t) => t.name)).toEqual(['Strength', 'Cardio', 'Food'])
    expect([trackers.dailyTarget('exercise'), trackers.dailyTarget('diet')]).toEqual([4, 5])
    expect(trackers.itemsOf('diet')).toEqual([{ id: 'veg', name: 'Vegetables', target: 7 }])
    expect(useDetailsStore().notesOf('diet', 'veg')).toBe('Greens')
    // The details move as they are: nothing is lifted or queued.
    expect(outbox()).toEqual([])
    expect(cached().trackers).toHaveLength(3)
  })

  it('reads a -v5 cache it can’t understand as nothing, and loads afresh', async () => {
    localStorage.setItem(V5_CACHE + USER, JSON.stringify({ exercise: 'nope' }))
    const sync = useSyncStore()
    sync.start(USER, lost)
    expect(sync.loaded).toBe(false)
    expect(localStorage.getItem(V5_CACHE + USER)).toBeNull()
    await flushPromises()
    expect(sync.loaded).toBe(true)
    expect(useTrackersStore().list).toHaveLength(3)
  })
})

describe('importFile', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
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

  const data: ExportData = {
    trackers: [],
    sections: {
      exercise: {
        plans: { [WEEK]: [SQUATS], '2026-10-12': [SQUATS] },
        log: { [WEEK]: { sq: ['great', 'great', null, null, null, null, null] } },
        details: {},
      },
      cardio: {
        plans: { [WEEK]: [{ id: 'ru', name: 'Running', distance: 5, target: 3 }] },
        log: {},
        details: {},
      },
      diet: { plans: {}, log: {}, details: {} },
    },
    settings: { accent: '#0a84ff', dailyPick: 5, foodPick: 4, goals: '', limits: '' },
  }

  it('sends pending writes first, imports on the server, then shows the merged state', async () => {
    const { sync, planner, trackers } = await start(emptyState())
    api.offline = true
    trackers.toggle('exercise', 'pu', 3) // queued: this week gets its own plan (the defaults) first
    await settle()
    api.offline = false
    const outcome = await sync.importFile(data)
    expect(outcome).toEqual({
      ok: true,
      added: { trackers: 0, weeks: 2, ticks: 2, details: 0, settings: true, conversations: 0 },
    })
    const order = api.paths().filter((p) => !p.startsWith('GET'))
    expect(order.at(-1)).toBe('POST /import')
    expect(api.calls.find((c) => c.path === '/import')!.expectedUser).toBe(USER)
    // This week kept its own plan; last week came from the import; settings applied.
    expect(trackers.itemsOf('exercise').map((e) => e.id)).toContain('pu')
    expect(trackers.plansOf('exercise')['2026-10-12']).toEqual([SQUATS])
    expect(trackers.isDone('exercise', 'pu', 3) && trackers.isDone('exercise', 'sq', 0)).toBe(true)
    expect(trackers.itemsOf('cardio')).toEqual(data.sections.cardio!.plans[WEEK])
    expect(planner.accent).toBe('#0a84ff')
    // The file went as version 6, its data under the trackers' ids (K123).
    const sent = api.calls.find((c) => c.path === '/import')!.body as Record<string, unknown>
    expect(sent).toMatchObject({ version: 6, trackers: [], details: { exercise: {} } })
    expect(Object.keys(sent.sections as object)).toEqual(['exercise', 'cardio', 'diet'])
    // The file's daily picks reach the first trackers, as the settings they are kept in step with.
    expect([trackers.dailyTarget('exercise'), trackers.dailyTarget('diet')]).toEqual([5, 4])
  })

  it('imports a version 6 file’s trackers, then shows them with their data (K123)', async () => {
    const { sync, trackers } = await start(emptyState())
    const swim = {
      id: 'xswim',
      name: 'Swimming',
      kind: 'cardio' as const,
      position: 7,
      dailyTarget: null,
      startWeek: '2026-10-12',
      endWeek: null,
    }
    const lengths = { id: 'le', name: 'Lengths', distance: 1, target: 2 }
    const file: ExportData = {
      ...data,
      trackers: [swim],
      sections: {
        ...data.sections,
        xswim: {
          plans: { '2026-10-12': [lengths] },
          log: { [WEEK]: { le: ['great', null, null, null, null, null, null] } },
          details: { le: { fields: { route: 'The lido' } } },
        },
      },
    }
    const outcome = await sync.importFile(file)
    expect(outcome).toMatchObject({ ok: true, added: { trackers: 1, details: 1 } })
    // Added after the account's own, empty of anything but the file's data.
    expect(trackers.get('xswim')).toEqual({ ...swim, position: 3 })
    expect(trackers.itemsOf('xswim')).toEqual([lengths])
    expect(trackers.markOf('xswim', 'le', 0)).toBe('great')
    expect(useDetailsStore().fieldOf('xswim', 'le', 'route')).toBe('The lido')
    expect(cached().trackers.map((t) => t.id)).toEqual(['exercise', 'cardio', 'diet', 'xswim'])
  })

  it('posts the file’s Ask conversations, which the server adds when it has none of their id', async () => {
    const { sync } = await start(emptyState())
    const turn = { question: 'Q', answer: 'A', stop: 'end_turn' as const, askedAt: 1 }
    api.addConversation(USER, { id: 'kept', title: 'Mine', turns: [turn] })
    const conversations = [
      { id: 'kept', title: 'Theirs', createdAt: 1, updatedAt: 2, turns: [] },
      { id: 'new', title: 'New', createdAt: 1, updatedAt: 2, turns: [turn] },
    ]
    const outcome = await sync.importFile({ ...data, conversations })
    expect(outcome).toMatchObject({ ok: true, added: { conversations: 1 } })
    const sent = api.calls.find((c) => c.path === '/import')!.body as Record<string, unknown>
    expect(sent.conversations).toEqual(conversations)
    expect(api.accounts.get(USER)!.conversations.map((c) => c.title)).toEqual(['Mine', 'New'])
    // A file with no list sends none, as one from before Ask.
    await sync.importFile(data)
    const last = api.calls.filter((c) => c.path === '/import').at(-1)!.body as object
    expect('conversations' in last).toBe(false)
  })

  it('fills empty goals from the file, and keeps goals already saved', async () => {
    const picks = { accent: '#ff9f0a', dailyPick: 2, foodPick: 2 }
    api.accounts.get(USER)!.settings = { ...picks, goals: '', limits: '' }
    const { sync, planner } = await start()
    const file = { ...data, settings: { ...data.settings!, goals: 'Run 5 km by March.' } }
    expect(await sync.importFile(file)).toMatchObject({ ok: true, added: { settings: true } })
    expect([planner.accent, planner.goals]).toEqual(['#ff9f0a', 'Run 5 km by March.'])
    const other = { ...file, settings: { ...file.settings, goals: 'Something else.' } }
    expect(await sync.importFile(other)).toMatchObject({ ok: true, added: { settings: false } })
    expect(planner.goals).toBe('Run 5 km by March.')
    expect(api.accounts.get(USER)!.settings).toEqual({
      ...picks,
      goals: 'Run 5 km by March.',
      limits: '',
    })
  })

  it('fills empty limits from the file, and keeps limits already saved', async () => {
    const picks = { accent: '#ff9f0a', dailyPick: 2, foodPick: 2, goals: '' }
    api.accounts.get(USER)!.settings = { ...picks, limits: '' }
    const { sync, planner } = await start()
    const file = { ...data, settings: { ...data.settings!, limits: 'Vegetarian.' } }
    expect(await sync.importFile(file)).toMatchObject({ ok: true, added: { settings: true } })
    expect(planner.limits).toBe('Vegetarian.')
    const other = { ...file, settings: { ...file.settings, limits: 'Something else.' } }
    expect(await sync.importFile(other)).toMatchObject({ ok: true, added: { settings: false } })
    expect(planner.limits).toBe('Vegetarian.')
  })

  it('reports being offline and changes nothing', async () => {
    const { sync, trackers } = await start(emptyState())
    api.offline = true
    expect(await sync.importFile(data)).toEqual({ ok: false, code: 'offline' })
    expect(trackers.plansOf('exercise')).toEqual({})
  })

  it('reports a refusal, a server failure, and hands control back on a 401', async () => {
    const { sync } = await start(emptyState())
    api.failNext('POST', '/import', 400, { error: 'format' })
    expect(await sync.importFile(data)).toEqual({ ok: false, code: 'error' })
    api.failNext('POST', '/import', 413, { error: 'quota' })
    expect(await sync.importFile(data)).toEqual({ ok: false, code: 'quota' })
    api.failNext('POST', '/import', 500)
    expect(await sync.importFile(data)).toEqual({ ok: false, code: 'server' })
    api.signedIn = null
    expect(await sync.importFile(data)).toEqual({ ok: false, code: 'auth' })
    expect(lost).toHaveBeenCalled()
  })

  it('gives up if the session stops while it waits', async () => {
    const { sync, trackers } = await start(emptyState())
    let release = api.hold()
    trackers.toggle('exercise', 'pu', 3) // a queued write the import must wait for
    await nextTick()
    const waiting = sync.importFile(data)
    sync.stop()
    release()
    expect(await waiting).toEqual({ ok: false, code: 'error' })
    sync.start(USER, lost)
    await flushPromises()
    release = api.hold()
    const posting = sync.importFile(data)
    await flushPromises() // the import is now in flight
    sync.stop()
    release()
    expect(await posting).toEqual({ ok: false, code: 'error' })
  })

  it('refuses when nobody is signed in', async () => {
    expect(await useSyncStore().importFile(data)).toEqual({ ok: false, code: 'auth' })
    expect(api.calls).toEqual([])
  })

  it('reads the account afresh after importing, even with a read already in flight', async () => {
    const { sync, trackers } = await start(emptyState())
    const release = api.holdNext('GET', '/state') // a read sent before the import
    const reading = sync.refresh()
    await flushPromises()
    const importing = sync.importFile(data)
    await flushPromises()
    release()
    await reading
    expect(await importing).toMatchObject({ ok: true })
    expect(trackers.plansOf('exercise')['2026-10-12']).toEqual([SQUATS])
  })

  it('does not import while queued writes cannot be sent', async () => {
    const { sync, trackers } = await start(emptyState())
    api.offline = true
    trackers.toggle('exercise', 'pu', 3)
    await settle()
    api.offline = false
    api.failNext('PUT', '/plans', 500) // the queued write fails again, so it is retried later
    expect(await sync.importFile(data)).toMatchObject({ ok: false })
    expect(api.paths('POST /import')).toEqual([])
  })

  it('says when it has read the account itself, not just the cache', async () => {
    const release = api.holdNext('GET', '/state')
    localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(emptyState()))
    const sync = useSyncStore()
    sync.start(USER, lost)
    expect([sync.loaded, sync.fresh]).toEqual([true, false])
    release()
    await flushPromises()
    expect(sync.fresh).toBe(true)
    sync.stop()
    expect(sync.fresh).toBe(false)
  })
})

describe('diff', () => {
  const settings = { accent: '#30d158', goals: '', limits: '' }
  const tracker = (id: string, kind: TrackerTypeId, position: number): TrackerInfo => ({
    id,
    name: id,
    kind,
    position,
    dailyTarget: kind === 'cardio' ? null : 3,
    startWeek: null,
    endWeek: null,
  })
  const empty = () => ({
    trackers: {
      exercise: tracker('exercise', 'strength', 0),
      cardio: tracker('cardio', 'cardio', 1),
      diet: tracker('diet', 'food', 2),
    } as Record<string, TrackerInfo>,
    sections: {
      exercise: { plans: {}, log: {}, details: {} },
      cardio: { plans: {}, log: {}, details: {} },
      diet: { plans: {}, log: {}, details: {} },
    } as Record<string, { plans: Plans<unknown>; log: Log; details: DetailsMap }>,
    settings: { ...settings } as Parameters<typeof diff>[0]['settings'],
  })

  it('is empty for identical snapshots', () => {
    expect(diff(empty(), empty())).toEqual([])
  })

  it('finds changed goals', () => {
    const local = empty()
    local.settings.goals = 'Run 5 km.'
    expect(diff(empty(), local)).toEqual([{ kind: 'settings' }])
  })

  it('finds changed limits', () => {
    const local = empty()
    local.settings.limits = 'Vegetarian.'
    expect(diff(empty(), local)).toEqual([{ kind: 'settings' }])
  })

  it('finds a changed Daily goal, but not a daily target: that is the tracker’s (K123)', () => {
    const local = empty()
    local.settings.dailyGoal = false
    expect(diff(empty(), local)).toEqual([{ kind: 'settings' }])
    const target = empty()
    target.trackers.diet!.dailyTarget = 5
    expect(diff(empty(), target)).toEqual([{ kind: 'tracker-patch', section: 'diet' }])
  })

  it('finds a changed item-page arrangement, and none when it is the same', () => {
    const arranged: ItemSections = {
      strength: { order: ['notes', 'details', 'plan', 'history'], hidden: [] },
    }
    const local = { ...empty(), settings: { ...settings, itemSections: arranged } }
    expect(diff(empty(), local)).toEqual([{ kind: 'settings' }])
    expect(diff(local, structuredClone(local))).toEqual([])
    // No key and an empty one are the same: every page as it comes.
    const none = { ...empty(), settings: { ...settings, itemSections: {} } }
    expect(diff(empty(), none)).toEqual([])
  })

  it('finds changed plans, set and cleared days, and settings', () => {
    const base = empty()
    base.sections.diet!.log = { [WEEK]: { veg: ['great', null, null, null, null, null, null] } }
    const local = empty()
    local.sections.exercise!.plans = { [WEEK]: [PUSHUPS] }
    local.sections.diet!.log = { [WEEK]: { veg: [null, 'great', null, null, null, null, null] } }
    local.settings.goals = 'Run 5 km.'
    expect(diff(base, local)).toEqual([
      { kind: 'plan', section: 'exercise', week: WEEK },
      { kind: 'tick', section: 'diet', week: WEEK, item: 'veg', day: 0, mark: null },
      { kind: 'tick', section: 'diet', week: WEEK, item: 'veg', day: 1, mark: 'great' },
      { kind: 'settings' },
    ])
  })

  it('creates a new tracker before anything is sent for it, and nothing more for it', () => {
    const local = empty()
    local.trackers.xnew = { ...tracker('xnew', 'strength', 3), startWeek: WEEK }
    local.sections.xnew = { plans: { [WEEK]: [PUSHUPS] }, log: {}, details: {} }
    expect(diff(empty(), local)).toEqual([
      { kind: 'tracker-create', section: 'xnew' },
      { kind: 'plan', section: 'xnew', week: WEEK },
    ])
  })

  it('patches a renamed, moved or retargeted tracker, and ends one from its end week', () => {
    const local = empty()
    local.trackers.exercise!.name = 'Lifting'
    local.trackers.cardio!.position = 9
    local.trackers.cardio!.endWeek = WEEK
    local.trackers.diet!.endWeek = WEEK
    expect(diff(empty(), local)).toEqual([
      { kind: 'tracker-patch', section: 'exercise' },
      { kind: 'tracker-patch', section: 'cardio' },
      { kind: 'tracker-end', section: 'cardio', week: WEEK },
      { kind: 'tracker-end', section: 'diet', week: WEEK },
    ])
    // A tracker gone from the stores is never deleted on the server.
    const gone = empty()
    delete gone.trackers.cardio
    expect(diff(empty(), gone)).toEqual([])
  })

  it('clears the marks of a section gone from the stores, week by week', () => {
    const base = empty()
    base.sections.xold = {
      plans: {},
      log: { [WEEK]: { a: [null, 'great', null, null, null, null, null] } },
      details: {},
    }
    expect(diff(base, empty())).toEqual([
      { kind: 'tick', section: 'xold', week: WEEK, item: 'a', day: 1, mark: null },
    ])
  })
})

describe('normaliseState', () => {
  const STRENGTH = {
    id: 'exercise',
    name: 'Strength',
    kind: 'strength',
    position: 0,
    dailyTarget: 3,
    startWeek: null,
    endWeek: null,
  }

  it('validates like stored data and drops bad revisions', () => {
    expect(normaliseState(null)).toBeNull()
    // A cache from before trackers has no list of them.
    expect(normaliseState({ exercise: {}, diet: {} })).toBeNull()
    expect(
      normaliseState({
        trackers: [{ ...STRENGTH, rev: 4 }, { ...STRENGTH, name: 'Again', rev: 9 }, 'nope'],
        sections: {
          exercise: {
            plans: { [WEEK]: [{ id: 'a', name: 'A', reps: 2.6, target: 9 }], bad: [] },
            log: {},
            revs: { [WEEK]: 2, x: 'y', y: 0, z: 1.5 },
          },
          stray: { plans: { [WEEK]: [] } },
        },
        settings: 'nope',
      }),
    ).toEqual({
      trackers: [{ ...STRENGTH, rev: 4 }],
      sections: {
        exercise: {
          plans: { [WEEK]: [{ id: 'a', name: 'A', reps: 3, target: 7 }] },
          log: {},
          details: {},
          revs: { [WEEK]: 2 },
          detailRevs: {},
        },
      },
      settings: null,
    })
  })

  it('reads each tracker’s plans by its kind, and a revision it lacks as 0', () => {
    const state = normaliseState({
      trackers: [{ ...STRENGTH, id: 'xswim', name: 'Swim', kind: 'cardio', dailyTarget: 4 }],
      sections: {
        xswim: {
          plans: {
            [WEEK]: [{ id: 'cy', name: 'Cycling', duration: 1799.6, distance: 0, reps: 3 }],
          },
          log: { [WEEK]: { cy: ['partial-hatch', 'nope'] } },
          details: { cy: { fields: { route: ' The river ' } } },
          revs: { [WEEK]: 4 },
          detailRevs: { cy: 2 },
        },
      },
    })!
    expect(state.trackers).toEqual([
      { ...STRENGTH, id: 'xswim', name: 'Swim', kind: 'cardio', dailyTarget: null, rev: 0 },
    ])
    expect(state.sections.xswim).toEqual({
      plans: { [WEEK]: [{ id: 'cy', name: 'Cycling', duration: 1800, target: 3 }] },
      log: { [WEEK]: { cy: ['partial-hatch', null, null, null, null, null, null] } },
      details: { cy: { fields: { route: 'The river' } } },
      revs: { [WEEK]: 4 },
      detailRevs: { cy: 2 },
    })
  })

  it('keeps goals only when the settings carry them as text', () => {
    const state = (settings: unknown) => normaliseState({ trackers: [], settings })!.settings
    const picks = { accent: '#30d158', dailyPick: 3, foodPick: 2 }
    expect(state({ ...picks, goals: ' Run 5 km. ' })).toEqual({ ...picks, goals: 'Run 5 km.' })
    expect(state({ ...picks, goals: '' })).toEqual({ ...picks, goals: '' })
    // A tab from before My goals, or a damaged value: not known, so never "none".
    expect(state(picks)).toEqual(picks)
    expect(state({ ...picks, goals: 7 })).toEqual(picks)
  })

  it('keeps limits only when the settings carry them as text', () => {
    const state = (settings: unknown) => normaliseState({ trackers: [], settings })!.settings
    const picks = { accent: '#30d158', dailyPick: 3, foodPick: 2 }
    expect(state({ ...picks, limits: ' Vegetarian. ' })).toEqual({
      ...picks,
      limits: 'Vegetarian.',
    })
    expect(state({ ...picks, limits: '' })).toEqual({ ...picks, limits: '' })
    // A tab from before Your limits, or a damaged value: not known, so never "none".
    expect(state({ ...picks, limits: 7 })).toEqual(picks)
  })
})

describe('stateFromApi', () => {
  it('reads the API’s keys, each tracker’s details moved into its section', () => {
    api = new FakeApi()
    const a = api.addUser(USER)
    a.plans.exercise[WEEK] = { items: [PUSHUPS], rev: 2 }
    a.details.diet.veg = { doc: { notes: 'Greens' }, rev: 3 }
    a.details.diet.nuts = { doc: {}, rev: 1 }
    const state = stateFromApi(api.state(USER))!
    expect(state.trackers.map((t) => [t.id, t.rev])).toEqual([
      ['exercise', 1],
      ['cardio', 1],
      ['diet', 1],
    ])
    expect(state.sections.exercise).toMatchObject({
      plans: { [WEEK]: [PUSHUPS] },
      revs: { [WEEK]: 2 },
    })
    expect(state.sections.diet).toMatchObject({
      details: { veg: { notes: 'Greens' } },
      detailRevs: { veg: 3, nuts: 1 },
    })
  })

  it('passes over a tracker it can’t read, and keeps at most 100', () => {
    const t = { name: 'T', kind: 'food', position: 0, rev: 1 }
    const state = stateFromApi({
      trackers: ['nope', { ...t, id: 'bad id' }, { ...t, id: 'xok' }],
      sections: { xok: { plans: {} } },
    })!
    expect(state.trackers.map((x) => x.id)).toEqual(['xok'])
    const many = Array.from({ length: 105 }, (_, i) => ({ ...t, id: `x${i}` }))
    expect(normaliseState({ trackers: many })!.trackers).toHaveLength(100)
  })

  it('ignores the version 5 keys, and reads nothing without a list of trackers', () => {
    expect(stateFromApi(null)).toBeNull()
    const v5 = { exercise: { plans: { [WEEK]: [PUSHUPS] } }, diet: {}, settings: null }
    expect(stateFromApi(v5)).toBeNull()
    const state = stateFromApi({ ...v5, trackers: [], sections: {} })!
    expect(state).toEqual({ trackers: [], sections: {}, settings: null })
  })
})

describe('legacyState', () => {
  it('maps a cache from before trackers onto the first three, named and with its daily picks', () => {
    const state = legacyState({
      exercise: { plans: { [WEEK]: [PUSHUPS] }, revs: { [WEEK]: 2 } },
      diet: {},
      settings: { accent: '#30d158', dailyPick: 5, foodPick: 4, goals: 'x' },
    })!
    expect(state.trackers.map((t) => [t.id, t.name, t.kind, t.dailyTarget, t.rev])).toEqual([
      ['exercise', 'Strength', 'strength', 5, 0],
      ['cardio', 'Cardio', 'cardio', null, 0],
      ['diet', 'Food', 'food', 4, 0],
    ])
    expect(state.sections.exercise).toMatchObject({
      plans: { [WEEK]: [PUSHUPS] },
      revs: { [WEEK]: 2 },
    })
    // A cache from before Cardio (K90) reads as none.
    expect(state.sections.cardio).toEqual({
      plans: {},
      log: {},
      details: {},
      revs: {},
      detailRevs: {},
    })
    expect(state.settings).toMatchObject({ dailyPick: 5, goals: 'x' })
    expect(legacyState({ exercise: {} })).toBeNull()
    expect(legacyState(null)).toBeNull()
  })
})
