import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { usePlannerStore } from '@/stores/planner'
import { useDietStore } from '@/stores/diet'
import {
  CACHE_PREFIX,
  CONFLICT_NOTICE,
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
import { DATA_KEY, DIET_KEY, LEGACY_DATA_KEY } from '@/lib/storage'
import type { Arrangement, ItemSections } from '@/lib/itemSections'
import type { ExportData } from '@/lib/transfer'
import { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, cached, emptyState } from '@/lib/__tests__/signedIn'

// The -v3 names (before item details) are moved and lifted in syncDetails.spec.ts.
const [, V2_CACHE, V1_CACHE] = OLD_CACHE_PREFIXES
const [, V2_OUTBOX, V1_OUTBOX] = OLD_OUTBOX_PREFIXES

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
  s.exercise.plans = plans as SyncState['exercise']['plans']
  s.exercise.revs = revs as Record<string, number>
  return s
}

/** Start syncing alice, with `cache` on the device (or none), and let it settle. */
async function start(cache?: SyncState) {
  if (cache) localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(cache))
  const sync = useSyncStore()
  sync.start(USER, lost)
  await flushPromises()
  return { sync, planner: usePlannerStore(), diet: useDietStore() }
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
    const planner = usePlannerStore()
    sync.start(USER, lost)
    expect(sync.loaded).toBe(true)
    expect(planner.exercises).toEqual([PUSHUPS])
    await flushPromises()
    expect(planner.exercises).toEqual([SQUATS])
    expect(cached().exercise).toEqual({
      plans: { [WEEK]: [SQUATS] },
      log: {},
      details: {},
      revs: { [WEEK]: 3 },
      detailRevs: {},
    })
  })

  it('loads from the server when the device has no cache', async () => {
    api.accounts.get(USER)!.settings = { accent: '#0a84ff', dailyPick: 5, foodPick: 4, goals: '' }
    const sync = useSyncStore()
    sync.start(USER, lost)
    expect(sync.loaded).toBe(false)
    await flushPromises()
    expect(sync.loaded).toBe(true)
    expect(usePlannerStore().accent).toBe('#0a84ff')
    expect(cached().settings).toEqual({ accent: '#0a84ff', dailyPick: 5, foodPick: 4, goals: '' })
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
    const { planner } = await start(emptyState())
    planner.toggle('pu', 0)
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
    planner.changeTarget('pu', 1)
    await settle()
    expect(api.calls.at(-1)!.body).toMatchObject({ rev: 1 })
    expect(server.plans.exercise[WEEK]!.rev).toBe(2)
    expect(cached().exercise.revs).toEqual({ [WEEK]: 2 })
  })

  it('sends food plans and ticks under the diet section', async () => {
    const { diet } = await start(emptyState())
    diet.toggle('veg', 2)
    await settle()
    expect(api.paths('PUT')).toEqual([`PUT /plans/diet/${WEEK}`, `PUT /ticks/diet/${WEEK}/veg/2`])
  })

  it('sends settings changes', async () => {
    const { planner } = await start(emptyState())
    planner.changeDailyPick(1)
    await settle()
    expect(api.accounts.get(USER)!.settings).toEqual({
      accent: '#30d158',
      dailyPick: 4,
      foodPick: 2,
      goals: '',
    })
    expect(cached().settings).toEqual({ accent: '#30d158', dailyPick: 4, foodPick: 2 })
  })

  it('sends a foods-a-day change', async () => {
    const { planner } = await start(emptyState())
    planner.changeFoodPick(2)
    await settle()
    expect(api.accounts.get(USER)!.settings).toEqual({
      accent: '#30d158',
      dailyPick: 3,
      foodPick: 4,
      goals: '',
    })
    expect(cached().settings).toEqual({ accent: '#30d158', dailyPick: 3, foodPick: 4 })
  })

  it('sends an item-page arrangement with the settings, and caches it (K66)', async () => {
    const { planner } = await start(emptyState())
    const arranged = {
      order: ['history', 'notes', 'details', 'plan'],
      hidden: ['details'],
    } as const
    planner.setArrangement('exercise', { order: [...arranged.order], hidden: [...arranged.hidden] })
    await settle()
    const settings = { accent: '#30d158', dailyPick: 3, foodPick: 2 }
    expect(api.calls.at(-1)).toMatchObject({
      method: 'PUT',
      path: '/settings',
      body: { ...settings, itemSections: { exercise: arranged } },
    })
    expect(api.accounts.get(USER)!.settings).toEqual({
      ...settings,
      goals: '',
      itemSections: { exercise: arranged },
    })
    expect(cached().settings).toEqual({ ...settings, itemSections: { exercise: arranged } })
    // Back to the default: sent as {}, so the server forgets the old one rather than keep it.
    planner.setArrangement('exercise', {
      order: ['notes', 'details', 'plan', 'history'],
      hidden: [],
    })
    await settle()
    expect(api.calls.at(-1)).toMatchObject({ body: { ...settings, itemSections: {} } })
    expect(api.accounts.get(USER)!.settings).toEqual({ ...settings, goals: '' })
    expect(cached().settings).toEqual(settings)
  })

  it('takes the server’s arrangement on a read', async () => {
    const arranged: Arrangement = {
      order: ['plan', 'notes', 'details', 'history'],
      hidden: ['history'],
    }
    api.accounts.get(USER)!.settings = {
      accent: '#30d158',
      dailyPick: 3,
      foodPick: 2,
      goals: '',
      itemSections: { food: arranged },
    }
    const { planner } = await start(emptyState())
    expect(planner.arrangementFor('food')).toEqual(arranged)
    expect(api.paths('PUT')).toEqual([])
  })

  it('ends on the latest value when a cell is toggled while its write is in flight', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [PUSHUPS], rev: 1 }
    const { planner } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 1 }))
    const release = api.hold()
    planner.toggle('pu', 0) // great: sent, reply held
    await nextTick()
    planner.toggle('pu', 0) // partial: queued behind it, replacing nothing in flight
    await nextTick()
    release()
    await flushPromises()
    expect(planner.markOf('pu', 0)).toBe('partial')
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ pu: 1 })
    expect(api.accounts.get(USER)!.partial.exercise[WEEK]).toEqual({ pu: 1 })
    expect(api.calls.at(-1)!.body).toEqual({ mark: 'partial', done: true })
    expect(outbox()).toEqual([])
  })

  it('keeps writes while offline, says so, and sends them once back', async () => {
    const { sync, planner } = await start(emptyState())
    api.offline = true
    planner.toggle('sq', 3)
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
    const { sync, planner } = await start(emptyState())
    api.offline = true
    planner.toggle('sq', 0)
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
    const { sync, planner } = await start(emptyState())
    api.failNext('PUT', '/plans', 502)
    planner.toggle('sq', 0)
    await settle()
    expect(sync.status).toBe('offline')
    expect(sync.pending).toBe(2)
  })

  it('hands control back on a 401 and keeps the outbox for after sign-in', async () => {
    const { planner } = await start(emptyState())
    api.signedIn = null
    planner.toggle('sq', 0)
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
    const { sync, planner } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 1 }))
    planner.changeTarget('pu', 1)
    await settle()
    expect(planner.exercises).toEqual([SQUATS])
    expect(sync.notice).toBe(CONFLICT_NOTICE)
    expect(cached().exercise.revs).toEqual({ [WEEK]: 2 })
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
    cache.diet.plans = { [WEEK]: [veg, { id: 'nuts', name: 'Nuts', target: 3 }] }
    cache.diet.revs = { [WEEK]: 1 }
    const { sync, diet } = await start(cache)
    diet.changeTarget('veg', -1)
    await settle()
    expect(diet.foods).toEqual([veg])
    expect(sync.notice).toBe(CONFLICT_NOTICE)
  })

  it('keeps a tick write while offline when the week already has its plan', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [PUSHUPS], rev: 1 }
    const { sync, planner } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 1 }))
    api.offline = true
    planner.toggle('pu', 2)
    await settle()
    expect(outbox()).toMatchObject([{ kind: 'tick', item: 'pu', day: 2, mark: 'great' }])
    expect(sync.status).toBe('offline')
  })

  it('does nothing on refresh before it has started', async () => {
    await useSyncStore().refresh()
    expect(api.calls).toEqual([])
  })

  it('keeps a settings write while offline', async () => {
    const { sync, planner } = await start(emptyState())
    api.offline = true
    planner.changeDailyPick(1)
    await settle()
    expect(sync.pending).toBe(1)
    expect(sync.status).toBe('offline')
  })

  it('sends a plan again as a create when the server has none', async () => {
    api.stall('GET', '/state')
    const { sync, planner } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 4 }))
    planner.changeTarget('pu', 1)
    await settle()
    const bodies = api.calls.filter((c) => c.method === 'PUT').map((c) => c.body)
    expect(bodies).toMatchObject([{ rev: 4 }, { rev: 0 }])
    expect(api.accounts.get(USER)!.plans.exercise[WEEK]!.rev).toBe(1)
    expect(sync.notice).toBeNull()
  })

  it('raises no notice when another device already created the same week', async () => {
    const defaults = usePlannerStore().exercises.map((e) => ({ ...e }))
    api.stall('GET', '/state')
    const { sync, planner } = await start(emptyState())
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: defaults, rev: 1 }
    planner.toggle('pu', 0)
    await settle()
    expect(sync.notice).toBeNull()
    expect(cached().exercise.revs).toEqual({ [WEEK]: 1 })
  })

  it('drops a refused write so the rest still go', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, planner } = await start(emptyState())
    api.failNext('PUT', '/plans', 400, { error: 'invalid' })
    planner.toggle('sq', 0)
    await settle()
    expect(warn).toHaveBeenCalledOnce()
    expect(sync.pending).toBe(0)
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ sq: 1 })
  })

  it('never lets a read undo a change made while it was in flight', async () => {
    const { sync, planner } = await start(emptyState())
    // The read's reply is the state before the tick, and it lands after the tick has synced.
    const release = api.holdNext('GET', '/state')
    const read = sync.refresh()
    await flushPromises()
    planner.toggle('sq', 0)
    await settle()
    expect(sync.pending).toBe(0)
    release()
    await read
    expect(planner.isDone('sq', 0)).toBe(true)
  })

  it('never lets a read undo a change its watcher has not seen yet', async () => {
    const { sync, planner } = await start(emptyState())
    const release = api.holdNext('GET', '/state')
    const read = sync.refresh()
    await flushPromises()
    // The reply lands in the same tick as the edit, before Vue runs the sync watcher.
    planner.changeTarget('sq', 1)
    release()
    await read
    await settle()
    expect(planner.exercises.find((e) => e.id === 'sq')!.target).toBe(5)
    expect(api.accounts.get(USER)!.plans.exercise[WEEK]).toBeDefined()
  })

  it('keeps an unseen change when another tab writes the cache', async () => {
    const { sync, planner } = await start(emptyState())
    planner.changeTarget('sq', 1)
    sync.onStorage(CACHE_PREFIX + USER) // in the same tick, before the watcher runs
    await settle()
    expect(api.accounts.get(USER)!.plans.exercise[WEEK]!.items).toHaveLength(5)
  })

  it('reads the server only once the outbox is empty', async () => {
    const { sync, planner } = await start(emptyState())
    api.offline = true
    planner.toggle('sq', 0)
    await settle()
    const reads = api.paths('GET /state').length
    await sync.refresh() // still offline: the writes stay queued, so no read
    expect(api.paths('GET /state')).toHaveLength(reads)
    expect(planner.isDone('sq', 0)).toBe(true)
  })

  it('brings in other devices’ changes on refresh', async () => {
    const { sync, planner } = await start(emptyState())
    api.accounts.get(USER)!.ticks.exercise[WEEK] = { sq: 0b10 }
    await sync.refresh()
    expect(planner.isDone('sq', 1)).toBe(true)
  })

  it('adopts another tab’s cache write without sending it again', async () => {
    const { sync, planner } = await start(emptyState())
    const other = stateWith({ [WEEK]: [SQUATS] }, { [WEEK]: 1 })
    localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(other))
    sync.onStorage(CACHE_PREFIX + USER)
    await settle()
    expect(planner.exercises).toEqual([SQUATS])
    expect(api.paths('PUT')).toEqual([])
    localStorage.setItem(OUTBOX_PREFIX + USER, JSON.stringify([{ kind: 'settings', id: 'a' }]))
    sync.onStorage(OUTBOX_PREFIX + USER)
    expect(sync.pending).toBe(1)
    sync.onStorage('something-else')
    sync.stop()
    sync.onStorage(CACHE_PREFIX + USER) // after stop: ignored
  })

  it('adopts another tab’s cache write without writing it back', async () => {
    const { sync, planner } = await start(emptyState())
    // A tab still open on the code from before foods a day (K57) writes settings without
    // `foodPick`. Writing the adopted state back would add it, that tab would adopt and drop it
    // again, and the two would echo the cache between them, undoing each other's marks.
    const other = stateWith({ [WEEK]: [SQUATS] }, { [WEEK]: 1 })
    other.settings = { accent: '#2f6b4f', dailyPick: 3 } as SyncState['settings']
    const written = JSON.stringify(other)
    localStorage.setItem(CACHE_PREFIX + USER, written)
    sync.onStorage(CACHE_PREFIX + USER)
    await settle()
    expect(planner.exercises).toEqual([SQUATS])
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
      expect(api.accounts.get(USER)!.settings).toEqual({ ...PICKS, goals: 'Run 5 km by March.' })
      expect(cached().settings).toEqual({ ...PICKS, goals: 'Run 5 km by March.' })
      // The same text again is no change, so nothing more is sent.
      planner.setGoals('Run 5 km by March.')
      await settle()
      expect(api.paths('PUT')).toEqual(['PUT /settings'])
    })

    it('keeps its goals when a tab on older code writes the cache without them', async () => {
      api.accounts.get(USER)!.settings = { ...PICKS, goals: 'Lose 3 kg.' }
      const { sync, planner } = await start()
      expect(planner.goals).toBe('Lose 3 kg.')
      const other = emptyState()
      other.settings = { ...PICKS, dailyPick: 5 } as SyncState['settings']
      const written = JSON.stringify(other)
      localStorage.setItem(CACHE_PREFIX + USER, written)
      sync.onStorage(CACHE_PREFIX + USER)
      await settle()
      expect(planner.dailyPick).toBe(5)
      expect(planner.goals).toBe('Lose 3 kg.')
      expect(localStorage.getItem(CACHE_PREFIX + USER)).toBe(written)
      // The next settings write still carries them.
      planner.changeFoodPick(1)
      await settle()
      const sent = { ...PICKS, dailyPick: 5, foodPick: 3, goals: 'Lose 3 kg.' }
      expect(api.calls.at(-1)!.body).toEqual({ ...sent, itemSections: {} })
      expect(api.accounts.get(USER)!.settings).toEqual(sent)
    })

    it('never sends goals it has not read, when it starts from an older tab’s cache', async () => {
      api.accounts.get(USER)!.settings = { ...PICKS, goals: 'Lose 3 kg.' }
      api.offline = true // the cache is all this tab has
      const old = emptyState()
      old.settings = { ...PICKS } as SyncState['settings']
      const { sync, planner } = await start(old)
      expect(planner.goals).toBe('')
      planner.changeDailyPick(1)
      await settle()
      // Its cache doesn't claim goals it never had, so no other tab adopts an empty one.
      expect(cached().settings).toEqual({ ...PICKS, dailyPick: 4 })
      api.offline = false
      await sync.refresh()
      const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/settings')!
      expect(put.body).toEqual({ ...PICKS, dailyPick: 4, itemSections: {} })
      const saved = { ...PICKS, dailyPick: 4, goals: 'Lose 3 kg.' }
      expect(api.accounts.get(USER)!.settings).toEqual(saved)
      expect(planner.goals).toBe('Lose 3 kg.')
      expect(cached().settings).toEqual(saved)
    })
  })

  it('ignores a tab still open on the code from before the solid and hatch drawings', async () => {
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [SQUATS], rev: 1 }
    const { sync, planner } = await start(emptyState())
    for (let i = 0; i < 4; i++) planner.toggle('sq', 0) // great, partial, missed, great-solid
    await settle()
    expect(planner.markOf('sq', 0)).toBe('great-solid')
    // That tab reads 'great-solid' as an empty day and writes its copy back under the -v2 names.
    const stale = { ...stateWith({ [WEEK]: [SQUATS] }, { [WEEK]: 1 }) } as Record<string, unknown>
    stale.exercise = { plans: { [WEEK]: [SQUATS] }, log: { [WEEK]: { sq: Array(7).fill(null) } } }
    localStorage.setItem(V2_CACHE + USER, JSON.stringify(stale))
    sync.onStorage(V2_CACHE + USER)
    localStorage.setItem(V2_OUTBOX + USER, '[]')
    sync.onStorage(V2_OUTBOX + USER)
    await settle()
    expect(planner.markOf('sq', 0)).toBe('great-solid')
    expect(cached().exercise.log[WEEK]!.sq![0]).toBe('great-solid')
  })

  it('moves the -v2 cache and outbox, and prefers them to the -v1 ones', async () => {
    const tick = { kind: 'tick', section: 'exercise', week: WEEK, item: 'sq' }
    const v2 = {
      ...emptyState(),
      exercise: { plans: {}, log: { [WEEK]: { sq: ['missed-hatch'] } } },
    }
    const v1 = { ...emptyState(), exercise: { plans: {}, log: { [WEEK]: { sq: [true] } } } }
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
    const planner = usePlannerStore()
    sync.start(USER, lost)
    expect(planner.markOf('sq', 0)).toBe('missed-hatch')
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
    const { sync, planner } = await start(emptyState())
    planner.toggle('sq', 0)
    await settle()
    // That tab reads 'great' as an empty day and writes its copy back under the old names.
    const stale = { ...stateWith({ [WEEK]: [SQUATS] }, { [WEEK]: 1 }) } as Record<string, unknown>
    stale.exercise = { plans: { [WEEK]: [SQUATS] }, log: { [WEEK]: { sq: Array(7).fill(false) } } }
    localStorage.setItem(V1_CACHE + USER, JSON.stringify(stale))
    sync.onStorage(V1_CACHE + USER)
    localStorage.setItem(V1_OUTBOX + USER, '[]')
    sync.onStorage(V1_OUTBOX + USER)
    await settle()
    expect(planner.markOf('sq', 0)).toBe('great')
    expect(cached().exercise.log[WEEK]!.sq![0]).toBe('great')
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ sq: 0b1 })
  })

  it('moves the cache and outbox from the names before marks had kinds', async () => {
    const tick = { kind: 'tick', section: 'exercise', week: WEEK, item: 'sq' }
    const old = { ...emptyState(), exercise: { plans: {}, log: { [WEEK]: { sq: [true] } } } }
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
    const planner = usePlannerStore()
    sync.start(USER, lost)
    expect(planner.markOf('sq', 0)).toBe('great')
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
    localStorage.setItem(V1_CACHE + USER, JSON.stringify(stateWith({ [WEEK]: [PUSHUPS] })))
    localStorage.setItem(V1_OUTBOX + USER, '{broken')
    localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(stateWith({ [WEEK]: [SQUATS] })))
    const sync = useSyncStore()
    const planner = usePlannerStore()
    sync.start(USER, lost)
    expect(planner.exercises).toEqual([SQUATS])
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
    const { sync, planner } = await start(emptyState())
    planner.toggle('sq', 0)
    await settle()
    sync.stop()
    expect(sync.loaded).toBe(false)
    expect(localStorage.getItem(CACHE_PREFIX + USER)).not.toBeNull()
    planner.toggle('pu', 0) // no longer watched
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
    const { planner, diet } = await start(emptyState())
    planner.toggle('sq', 0)
    diet.toggle('veg', 0)
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
    const { planner } = await start(emptyState())
    planner.toggle('sq', 0)
    await settle()
    const synced = api.calls.filter((c) => c.path.startsWith('/state') || c.method === 'PUT')
    expect(synced.length).toBeGreaterThan(2)
    expect(synced.every((c) => c.expectedUser === USER)).toBe(true)
  })

  it('never writes into the account of someone who signed in in another tab', async () => {
    const { planner } = await start(emptyState())
    api.signedIn = 'bob' // alice signed out elsewhere and bob signed in: the cookie is his
    planner.toggle('sq', 0)
    await settle()
    expect(lost).toHaveBeenCalled()
    expect(api.accounts.get('bob')!.plans.exercise).toEqual({})
    expect(api.accounts.get('bob')!.ticks.exercise).toEqual({})
  })

  it('keeps and retries a write the server failed', async () => {
    const { sync, planner } = await start(emptyState())
    api.failNext('PUT', '/plans', 500)
    planner.toggle('sq', 0)
    await settle()
    expect(sync.pending).toBe(2)
    expect(sync.status).toBe('offline')
    await sync.flush()
    expect(sync.pending).toBe(0)
    expect(api.accounts.get(USER)!.ticks.exercise[WEEK]).toEqual({ sq: 1 })
  })

  it('says so when it drops a write the server refused for good', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, planner } = await start(emptyState())
    api.failNext('PUT', '/ticks', 403, { error: 'origin' })
    planner.toggle('sq', 0)
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(REFUSED_NOTICE)
  })

  it('says the account is full when it drops a write refused for quota', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sync, planner } = await start(emptyState())
    api.failNext('PUT', '/ticks', 413, { error: 'quota' })
    planner.toggle('sq', 0)
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(QUOTA_NOTICE)
  })

  it('gives up on a request that never answers, and tries again', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    const { sync, planner } = await start(emptyState())
    api.stall('PUT', '/plans')
    planner.toggle('sq', 0)
    await nextTick()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(sync.status).toBe('offline')
    expect(sync.pending).toBe(2)
  })

  it('lets replies to the last user’s writes touch nothing of the next user’s', async () => {
    const { sync, planner } = await start(stateWith({ [WEEK]: [PUSHUPS] }, { [WEEK]: 1 }))
    api.accounts.get(USER)!.plans.exercise[WEEK] = { items: [SQUATS], rev: 5 }
    const release = api.hold()
    planner.changeTarget('pu', 1) // alice: will get a 409 carrying her server copy
    planner.toggle('sq', 0) //       alice: will get a 401 once bob holds the cookie
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
    expect(usePlannerStore().plans).toEqual({})
    expect(sync.loaded).toBe(true)
  })

  it('treats another tab’s state as newer than a read already in flight', async () => {
    const { sync, planner } = await start(emptyState())
    const release = api.holdNext('GET', '/state')
    const read = sync.refresh()
    await flushPromises()
    const other = emptyState()
    other.exercise.log = { [WEEK]: { sq: ['great', null, null, null, null, null, null] } }
    localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(other))
    sync.onStorage(CACHE_PREFIX + USER)
    release()
    await read
    expect(planner.isDone('sq', 0)).toBe(true)
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
    exercise: {
      plans: { [WEEK]: [SQUATS], '2026-10-12': [SQUATS] },
      log: { [WEEK]: { sq: ['great', 'great', null, null, null, null, null] } },
      details: {},
    },
    diet: { plans: {}, log: {}, details: {} },
    settings: { accent: '#0a84ff', dailyPick: 5, foodPick: 4, goals: '' },
  }

  it('sends pending writes first, imports on the server, then shows the merged state', async () => {
    const { sync, planner } = await start(emptyState())
    api.offline = true
    planner.toggle('pu', 3) // queued: this week gets its own plan (the defaults) first
    await settle()
    api.offline = false
    const outcome = await sync.importFile(data)
    expect(outcome).toEqual({
      ok: true,
      added: { weeks: 1, ticks: 2, details: 0, settings: true, conversations: 0 },
    })
    const order = api.paths().filter((p) => !p.startsWith('GET'))
    expect(order.at(-1)).toBe('POST /import')
    expect(api.calls.find((c) => c.path === '/import')!.expectedUser).toBe(USER)
    // This week kept its own plan; last week came from the import; settings applied.
    expect(planner.exercises.map((e) => e.id)).toContain('pu')
    expect(planner.plans['2026-10-12']).toEqual([SQUATS])
    expect(planner.isDone('pu', 3) && planner.isDone('sq', 0)).toBe(true)
    expect(planner.accent).toBe('#0a84ff')
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
    api.accounts.get(USER)!.settings = { ...picks, goals: '' }
    const { sync, planner } = await start()
    const file = { ...data, settings: { ...data.settings!, goals: 'Run 5 km by March.' } }
    expect(await sync.importFile(file)).toMatchObject({ ok: true, added: { settings: true } })
    expect([planner.accent, planner.goals]).toEqual(['#ff9f0a', 'Run 5 km by March.'])
    const other = { ...file, settings: { ...file.settings, goals: 'Something else.' } }
    expect(await sync.importFile(other)).toMatchObject({ ok: true, added: { settings: false } })
    expect(planner.goals).toBe('Run 5 km by March.')
    expect(api.accounts.get(USER)!.settings).toEqual({ ...picks, goals: 'Run 5 km by March.' })
  })

  it('reports being offline and changes nothing', async () => {
    const { sync, planner } = await start(emptyState())
    api.offline = true
    expect(await sync.importFile(data)).toEqual({ ok: false, code: 'offline' })
    expect(planner.plans).toEqual({})
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
    const { sync, planner } = await start(emptyState())
    let release = api.hold()
    planner.toggle('pu', 3) // a queued write the import must wait for
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
    const { sync, planner } = await start(emptyState())
    const release = api.holdNext('GET', '/state') // a read sent before the import
    const reading = sync.refresh()
    await flushPromises()
    const importing = sync.importFile(data)
    await flushPromises()
    release()
    await reading
    expect(await importing).toMatchObject({ ok: true })
    expect(planner.plans['2026-10-12']).toEqual([SQUATS])
  })

  it('does not import while queued writes cannot be sent', async () => {
    const { sync, planner } = await start(emptyState())
    api.offline = true
    planner.toggle('pu', 3)
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
  const settings = { accent: '#30d158', dailyPick: 3, foodPick: 2, goals: '' }
  const empty = () => ({
    exercise: { plans: {}, log: {}, details: {} },
    diet: { plans: {}, log: {}, details: {} },
    settings: { ...settings },
  })

  it('is empty for identical snapshots', () => {
    expect(diff(empty(), empty())).toEqual([])
  })

  it('finds changed goals', () => {
    const local = empty()
    local.settings.goals = 'Run 5 km.'
    expect(diff(empty(), local)).toEqual([{ kind: 'settings' }])
  })

  it('finds a changed foods a day', () => {
    const local = empty()
    local.settings.foodPick = 5
    expect(diff(empty(), local)).toEqual([{ kind: 'settings' }])
  })

  it('finds a changed item-page arrangement, and none when it is the same', () => {
    const arranged: ItemSections = {
      exercise: { order: ['plan', 'notes', 'details', 'history'], hidden: [] },
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
    base.diet.log = { [WEEK]: { veg: ['great', null, null, null, null, null, null] } }
    const local = empty()
    local.exercise.plans = { [WEEK]: [PUSHUPS] }
    local.diet.log = { [WEEK]: { veg: [null, 'great', null, null, null, null, null] } }
    local.settings.dailyPick = 4
    expect(diff(base, local)).toEqual([
      { kind: 'plan', section: 'exercise', week: WEEK },
      { kind: 'tick', section: 'diet', week: WEEK, item: 'veg', day: 0, mark: null },
      { kind: 'tick', section: 'diet', week: WEEK, item: 'veg', day: 1, mark: 'great' },
      { kind: 'settings' },
    ])
  })
})

describe('normaliseState', () => {
  it('validates like stored data and drops bad revisions', () => {
    expect(normaliseState(null)).toBeNull()
    expect(normaliseState({ exercise: {} })).toBeNull()
    expect(
      normaliseState({
        exercise: {
          plans: { [WEEK]: [{ id: 'a', name: 'A', reps: 2.6, target: 9 }], bad: [] },
          log: {},
          revs: { [WEEK]: 2, x: 'y', y: 0, z: 1.5 },
        },
        diet: { plans: 'nope' },
        settings: 'nope',
      }),
    ).toEqual({
      exercise: {
        plans: { [WEEK]: [{ id: 'a', name: 'A', reps: 3, target: 7 }] },
        log: {},
        details: {},
        revs: { [WEEK]: 2 },
        detailRevs: {},
      },
      diet: { plans: {}, log: {}, details: {}, revs: {}, detailRevs: {} },
      settings: null,
    })
  })

  it('keeps goals only when the settings carry them as text', () => {
    const state = (settings: unknown) =>
      normaliseState({ exercise: {}, diet: {}, settings })!.settings
    const picks = { accent: '#30d158', dailyPick: 3, foodPick: 2 }
    expect(state({ ...picks, goals: ' Run 5 km. ' })).toEqual({ ...picks, goals: 'Run 5 km.' })
    expect(state({ ...picks, goals: '' })).toEqual({ ...picks, goals: '' })
    // A tab from before My goals, or a damaged value: not known, so never "none".
    expect(state(picks)).toEqual(picks)
    expect(state({ ...picks, goals: 7 })).toEqual(picks)
  })
})
