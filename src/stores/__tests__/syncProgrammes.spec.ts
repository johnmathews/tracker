import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useTrackersStore } from '@/stores/trackers'
import {
  CACHE_PREFIX,
  OUTBOX_PREFIX,
  RUNS_PREFIX,
  useSyncStore,
  type SyncState,
} from '@/stores/sync'
import type { ExportData } from '@/lib/transfer'
import type { Tracker } from '@/lib/trackers'
import { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, emptySection, emptyState } from '@/lib/__tests__/signedIn'
import { withProgrammes } from '@/components/__tests__/programmesApi'

/**
 * Programmes in sync (docs/specs/2026-11-17-programmes.md §8): the server's `today` and the runs
 * from `/api/state`, which the lock and the week view read; a queued mark the server refuses as
 * too late, named in a notice and never dropped silently; a programme's plan write refused the
 * same way; and the app's import passing the library and the runs through.
 */

// Thursday 12 Nov 2026 on this device; the server's today is set per test.
const NOW = new Date(2026, 10, 12, 9, 0)
const WEEK = '2026-11-09'
const SUMMARY = {
  programmeId: 'p1',
  name: 'Beginner 5×5',
  status: 'running',
  week: 4,
  weeks: 8,
  start: '2026-10-23',
  end: '2026-12-13',
  pausedUntil: null,
  pausedSince: null,
  pauseReason: null,
  rev: 'r1',
}
const PROGRAMME: Tracker = {
  id: 't1',
  name: 'Beginner 5×5',
  kind: 'strength',
  position: 3,
  dailyTarget: 2,
  startWeek: '2026-10-19',
  endWeek: '2026-12-14',
  rev: 1,
}
const SQUAT = { id: 'squat', name: 'Back squat', sets: 3, reps: 5, weight: 42.5, target: 3 }
const BENCH = { id: 'bench', name: 'Bench press', sets: 3, reps: 5, weight: 27.5, target: 3 }

let api: FakeApi
let lost: ReturnType<typeof vi.fn<() => void>>

/** A cache with the first three trackers and the programme tracker `t1`, its week written. */
function withProgramme(): SyncState {
  const state = emptyState()
  state.trackers.push({ ...PROGRAMME })
  state.sections.t1 = { ...emptySection(), plans: { [WEEK]: [SQUAT, BENCH] }, revs: { [WEEK]: 1 } }
  return state
}

/** The fake API with alice's programme tracker, `/api/state` saying `today` and the runs. */
function serve(today = '2026-11-12', runs: Record<string, unknown> = { t1: SUMMARY }) {
  const account = api.accounts.get(USER)!
  account.trackers.push({ ...PROGRAMME })
  account.plans.t1 = { [WEEK]: { items: [SQUAT, BENCH], rev: 1 } }
  return withProgrammes(api, {}, { today, runs })
}

async function start(cache: SyncState = withProgramme()) {
  localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(cache))
  const sync = useSyncStore()
  sync.start(USER, lost)
  await flushPromises()
  return { sync, trackers: useTrackersStore() }
}

async function settle(): Promise<void> {
  await nextTick()
  await flushPromises()
  await flushPromises()
}

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

describe('the server’s today and the runs', () => {
  it('carries today and the runs from the state, and marks the programme trackers', async () => {
    serve('2026-11-13')
    const { sync, trackers } = await start()
    expect(sync.today).toBe('2026-11-13')
    expect(sync.runs).toEqual({ t1: SUMMARY })
    expect(trackers.isProgramme('t1')).toBe(true)
    expect(trackers.isProgramme('exercise')).toBe(false)
  })

  it('keeps them for the next start, so a device offline still knows its programmes', async () => {
    serve()
    await start()
    useSyncStore().stop()
    setActivePinia(createPinia())
    api.offline = true
    const { sync, trackers } = await start()
    expect(sync.today).toBe('2026-11-12')
    expect(trackers.isProgramme('t1')).toBe(true)
    // Signing out on purpose leaves nothing behind.
    sync.stop()
    sync.forget(USER)
    expect(localStorage.getItem(RUNS_PREFIX + USER)).toBeNull()
  })

  it('reads a damaged copy as none', async () => {
    localStorage.setItem(RUNS_PREFIX + USER, '{"today": 3, "runs": []}')
    api.offline = true
    const { sync, trackers } = await start()
    expect(sync.today).toBeNull()
    expect(sync.runs).toEqual({})
    expect(trackers.isProgramme('t1')).toBe(false)
  })

  it('locks a programme tracker’s days before yesterday by the server’s today only', async () => {
    // The device says Thursday 12 Nov; the server says Friday 13 Nov.
    serve('2026-11-13')
    const { sync } = await start()
    expect(sync.locked('t1', '2026-11-11')).toBe(true)
    // Yesterday stays open (the grace day), and today and later too.
    expect(sync.locked('t1', '2026-11-12')).toBe(false)
    expect(sync.locked('t1', '2026-11-13')).toBe(false)
    expect(sync.locked('t1', '2026-11-20')).toBe(false)
    // An ordinary tracker is never locked.
    expect(sync.locked('exercise', '2026-10-01')).toBe(false)
  })

  it('locks nothing before it knows the server’s today', async () => {
    api.offline = true
    const { sync } = await start()
    expect(sync.today).toBeNull()
    expect(sync.locked('t1', '2020-01-01')).toBe(false)
  })
})

describe('a mark the server refuses as too late (spec §8)', () => {
  it('drops it, names the day and the item in a notice, and shows the server’s marks', async () => {
    serve()
    const { sync, trackers } = await start()
    api.failNext('PUT', '/ticks/t1', 409, { error: 'locked-day', date: '2026-11-09' })
    trackers.toggle('t1', 'squat', 0)
    await settle()
    expect(sync.pending).toBe(0)
    expect(localStorage.getItem(OUTBOX_PREFIX + USER)).toBeNull()
    expect(sync.notice).toBe(
      'Your mark for Back squat on Mon 9 Nov reached the server too late: that day is locked, so it was undone here.',
    )
    // The state is read again: the refused mark goes.
    expect(trackers.markOf('t1', 'squat', 0)).toBeNull()
    // Marking never gave the programme's week a plan of its own to send.
    expect(api.paths().some((p) => p.startsWith('PUT /plans'))).toBe(false)
  })

  it('names the first and counts the rest when several are refused at once', async () => {
    serve()
    const { sync, trackers } = await start()
    api.offline = true
    trackers.toggle('t1', 'squat', 0)
    trackers.toggle('t1', 'bench', 1)
    trackers.toggle('t1', 'gone', 1)
    await settle()
    expect(sync.pending).toBe(3)
    api.offline = false
    api.failNext('PUT', '/ticks/t1', 409, { error: 'locked-day', date: '2026-11-09' })
    api.failNext('PUT', '/ticks/t1', 409, { error: 'locked-day', date: '2026-11-10' })
    api.failNext('PUT', '/ticks/t1', 409, { error: 'locked-day', date: '2026-11-10' })
    await sync.refresh()
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(
      'Your marks for Back squat on Mon 9 Nov and two more reached the server too late: those days are locked, so they were undone here.',
    )
  })

  it('words an item it no longer has', async () => {
    serve()
    const { sync, trackers } = await start()
    api.failNext('PUT', '/ticks/t1', 409, { error: 'locked-day', date: '2026-11-10' })
    trackers.toggle('t1', 'gone', 1)
    await settle()
    expect(sync.notice).toBe(
      'Your mark for an item on Tue 10 Nov reached the server too late: that day is locked, so it was undone here.',
    )
  })

  it('treats a programme’s refused plan write the same way, naming the tracker', async () => {
    serve()
    // Only an older tab could have queued one: this store never edits a programme's plan.
    localStorage.setItem(
      OUTBOX_PREFIX + USER,
      JSON.stringify([{ kind: 'plan', section: 't1', week: WEEK, id: 'old' }]),
    )
    api.failNext('PUT', '/plans/t1', 409, { error: 'programme-tracker' })
    const { sync, trackers } = await start()
    await settle()
    expect(sync.pending).toBe(0)
    expect(sync.notice).toBe(
      'Your change to Beginner 5×5’s plan wasn’t saved: a programme’s plan changes only through its own controls, so it was undone here.',
    )
    expect(trackers.plansOf('t1')[WEEK]).toEqual([SQUAT, BENCH])
  })
})

describe('importing a file through the app (§8.6)', () => {
  const data: ExportData = {
    trackers: [],
    sections: {
      exercise: { plans: {}, log: {}, details: {} },
      cardio: { plans: {}, log: {}, details: {} },
      diet: { plans: {}, log: {}, details: {} },
    },
    settings: null,
  }

  it('passes the library and the runs through, as the file had them', async () => {
    const { sync } = await start(emptyState())
    const programmes = [{ id: 'p1', doc: { name: 'Beginner 5×5' } }]
    const runs = [{ tracker: 't9', doc: {}, log: [] }]
    await sync.importFile({ ...data, programmes, runs })
    const sent = api.calls.find((c) => c.path === '/import')!.body as Record<string, unknown>
    expect(sent.programmes).toEqual(programmes)
    expect(sent.runs).toEqual(runs)
    // A file with neither sends neither.
    await sync.importFile(data)
    const last = api.calls.filter((c) => c.path === '/import').at(-1)!.body as object
    expect('programmes' in last || 'runs' in last).toBe(false)
  })
})
