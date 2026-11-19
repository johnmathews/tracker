import { readProgrammeFixture } from '@/lib/__tests__/fixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProgrammesStore } from '@/stores/programmes'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'
import type { ChangePreview, ChangeRequest, Run } from '@/lib/programmes'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import PREVIEW_JSON from '@/lib/__tests__/programmes/change-preview.json'
import START_JSON from '@/lib/__tests__/programmes/start-preview.json'
import LIBRARY_JSON from '@/lib/__tests__/programmes/library.json'
import SHARED_JSON from '@/lib/__tests__/programmes/shared.json'

const RUN = RUN_JSON as unknown as Run
const PREVIEW = PREVIEW_JSON as unknown as ChangePreview
const PID = LIBRARY_JSON.programmes[0]!.id
const BEGINNER = readProgrammeFixture('valid/beginner-5x5.json')
const RECORD = { ...LIBRARY_JSON.programmes[0]!, doc: BEGINNER }
const SUMMARY = {
  programmeId: PID,
  name: 'Beginner 5×5',
  status: 'running',
  week: 4,
  weeks: 8,
  start: '2026-10-23',
  end: '2026-12-13',
  pausedUntil: null,
  rev: RUN.rev,
}

type Call = { method: string; path: string; body: unknown; user: string | null }
type Reply = { status?: number; body?: unknown } | 'offline'
let calls: Call[]
let replies: Record<string, Reply>

/** The API as a table of replies by "METHOD /path"; each call is kept. */
function serve(table: Record<string, Reply>): void {
  replies = table
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init = {}) => {
      const method = init.method ?? 'GET'
      const path = String(input).replace(/^\/api/, '')
      const headers = new Headers(init.headers)
      calls.push({
        method,
        path,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        user: headers.get('X-Expected-User'),
      })
      const reply = replies[`${method} ${path}`] ?? { status: 404, body: { error: 'not-found' } }
      if (reply === 'offline') throw new TypeError('Failed to fetch')
      if (reply.status === 204) return new Response(null, { status: 204 })
      return Response.json(reply.body ?? {}, { status: reply.status ?? 200 })
    }),
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
  calls = []
  useSessionStore().user = 'alice'
})
afterEach(() => vi.unstubAllGlobals())

describe('the Programmes page’s data', () => {
  it('loads the library, and the runs and today from the state', async () => {
    serve({
      'GET /programmes': { body: LIBRARY_JSON },
      'GET /state': { body: { today: '2026-11-12', runs: { t1: SUMMARY }, trackers: [] } },
    })
    const store = useProgrammesStore()
    expect(store.library).toBeNull()
    await store.loadPage()
    expect(store.library).toEqual(LIBRARY_JSON.programmes)
    expect(store.runs).toEqual({ t1: SUMMARY })
    expect(store.today).toBe('2026-11-12')
    expect(store.loadFailure).toBeNull()
    expect(calls.every((c) => c.user === 'alice')).toBe(true)
  })

  it('says why the page couldn’t load, keeping what it had', async () => {
    serve({
      'GET /programmes': { body: LIBRARY_JSON },
      'GET /state': { body: { today: '2026-11-12' } },
    })
    const store = useProgrammesStore()
    await store.loadPage()
    serve({ 'GET /programmes': 'offline', 'GET /state': 'offline' })
    await store.loadPage()
    expect(store.library).toEqual(LIBRARY_JSON.programmes)
    expect(store.loadFailure).toBe(
      'Can’t reach the server, so the programmes couldn’t load. Try again when you’re online.',
    )
    serve({ 'GET /programmes': { body: LIBRARY_JSON }, 'GET /state': { status: 500, body: {} } })
    await store.loadPage()
    expect(store.loadFailure).toBe(
      'The server had a problem, so the programmes couldn’t load. Try again in a while.',
    )
  })

  it('is offline while the browser or the sync says so', async () => {
    const store = useProgrammesStore()
    expect(store.offline).toBe(false)
    window.dispatchEvent(new Event('offline'))
    expect(store.offline).toBe(true)
    window.dispatchEvent(new Event('online'))
    expect(store.offline).toBe(false)
    useSyncStore().status = 'offline'
    expect(store.offline).toBe(true)
  })
})

describe('the library', () => {
  it('reads one programme with its document', async () => {
    serve({ [`GET /programmes/${PID}`]: { body: RECORD } })
    expect(await useProgrammesStore().readProgramme(PID)).toEqual({ ok: true, data: RECORD })
  })

  it('adds pasted JSON, then lists it', async () => {
    serve({
      'POST /programmes': { status: 201, body: RECORD },
      'GET /programmes': { body: LIBRARY_JSON },
      'GET /state': { body: { today: '2026-11-12', runs: {} } },
    })
    const store = useProgrammesStore()
    const result = await store.addProgramme(JSON.stringify(BEGINNER))
    expect(result).toEqual({ ok: true, data: RECORD })
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/programmes', body: { doc: BEGINNER } })
    expect(store.library).toEqual(LIBRARY_JSON.programmes)
  })

  it('returns the validator’s problems, each with its path', async () => {
    const errors = [{ path: 'weeks', message: 'give a whole number from 1 to 52.' }]
    serve({ 'POST /programmes': { status: 400, body: { error: 'invalid', errors } } })
    expect(await useProgrammesStore().addProgramme('{"weeks": 60}')).toEqual({
      ok: false,
      problems: errors,
      message: null,
    })
  })

  it('says text that isn’t JSON is the problem, and sends nothing', async () => {
    serve({})
    expect(await useProgrammesStore().addProgramme('{ "name": ')).toEqual({
      ok: false,
      problems: [],
      message:
        'This isn’t JSON the app can read. Check its brackets, commas and quotes, then check it again.',
    })
    expect(calls).toEqual([])
  })

  it('says why an add failed', async () => {
    serve({ 'POST /programmes': { status: 413, body: { error: 'too-large' } } })
    expect(await useProgrammesStore().addProgramme('{}')).toEqual({
      ok: false,
      problems: [],
      message: 'That programme is too big. A programme is at most 128 KB.',
    })
  })

  it('duplicates a programme under a new name', async () => {
    serve({
      [`GET /programmes/${PID}`]: { body: RECORD },
      'POST /programmes': { status: 201, body: { ...RECORD, id: 'p2' } },
      'GET /programmes': { body: LIBRARY_JSON },
      'GET /state': { body: {} },
    })
    const result = await useProgrammesStore().duplicate(PID)
    expect(result.ok).toBe(true)
    expect(calls[1]).toMatchObject({
      method: 'POST',
      path: '/programmes',
      body: { doc: { ...BEGINNER, name: 'Copy of Beginner 5×5' } },
    })
  })

  it('doesn’t duplicate a programme it can’t read', async () => {
    serve({ [`GET /programmes/${PID}`]: 'offline' })
    expect(await useProgrammesStore().duplicate(PID)).toMatchObject({ ok: false })
    expect(calls).toHaveLength(1)
  })

  it('asks for no user when nobody is signed in, and deletes before the list has loaded', async () => {
    useSessionStore().user = null
    serve({ [`DELETE /programmes/${PID}`]: { status: 204 } })
    const store = useProgrammesStore()
    expect(await store.remove(PID)).toEqual({ ok: true, data: null })
    expect(calls[0]!.user).toBe('')
    expect(store.library).toEqual([])
  })

  it('deletes a programme and drops it from the list', async () => {
    serve({
      'GET /programmes': { body: LIBRARY_JSON },
      'GET /state': { body: {} },
      [`DELETE /programmes/${PID}`]: { status: 204 },
    })
    const store = useProgrammesStore()
    await store.loadPage()
    expect(await store.remove(PID)).toEqual({ ok: true, data: null })
    expect(store.library).toEqual([])
    serve({ [`DELETE /programmes/${PID}`]: 'offline' })
    expect(await store.remove(PID)).toMatchObject({ ok: false, problems: [] })
  })
})

describe('starting a programme', () => {
  it('previews a start with the server’s grid', async () => {
    serve({ [`POST /programmes/${PID}/preview`]: { body: START_JSON } })
    const body = { start: '2026-10-26', params: { squat: 40, rate: 5 } }
    expect(await useProgrammesStore().previewStart(PID, body)).toEqual({
      ok: true,
      data: START_JSON,
    })
    expect(calls[0]!.body).toEqual(body)
  })

  it('starts a run, then reads the state again so the week shows it', async () => {
    serve({
      [`POST /programmes/${PID}/start`]: { status: 201, body: { tracker: { id: 't1' }, run: RUN } },
      'GET /programmes': { body: LIBRARY_JSON },
      'GET /state': { body: { today: '2026-11-12', runs: { t1: SUMMARY } } },
    })
    const store = useProgrammesStore()
    const refresh = vi.spyOn(useSyncStore(), 'refresh').mockResolvedValue()
    const result = await store.start(PID, { name: 'Beginner 5×5', start: '2026-11-12', params: {} })
    expect(result).toEqual({ ok: true, data: { tracker: { id: 't1' }, run: RUN } })
    expect(refresh).toHaveBeenCalled()
    expect(store.runs).toEqual({ t1: SUMMARY })
    expect(store.run).toEqual(RUN)
  })

  it('returns a start’s problems', async () => {
    const errors = [{ path: 'start', message: 'a programme starts today or later.' }]
    serve({
      [`POST /programmes/${PID}/start`]: { status: 400, body: { error: 'invalid', errors } },
    })
    expect(await useProgrammesStore().start(PID, {})).toEqual({
      ok: false,
      problems: errors,
      message: null,
    })
  })
})

describe('a running programme', () => {
  it('reads the run for its overview', async () => {
    serve({ 'GET /runs/t1': { body: RUN } })
    const store = useProgrammesStore()
    expect(await store.loadRun('t1')).toEqual({ ok: true, data: RUN })
    expect(store.run).toEqual(RUN)
  })

  it('says a tracker has no run with no message, and why else a run couldn’t be read', async () => {
    serve({ 'GET /runs/t1': { status: 404, body: { error: 'not-found' } } })
    const store = useProgrammesStore()
    expect(await store.loadRun('t1')).toEqual({ ok: false, problems: [], message: null })
    serve({ 'GET /runs/t1': 'offline' })
    expect(await store.loadRun('t1')).toMatchObject({ ok: false, message: expect.any(String) })
    expect(store.run).toBeNull()
  })

  it('previews a change, writing nothing', async () => {
    serve({ 'POST /runs/t1/changes': { body: PREVIEW } })
    const request = {
      change: { type: 'set-value', activity: 'row', field: 'weight', value: 45 },
      from: '2026-11-16',
    } as const
    expect(await useProgrammesStore().previewChange('t1', request)).toEqual({
      ok: true,
      data: PREVIEW,
    })
    expect(calls[0]!.body).toEqual({ ...request, preview: true })
  })

  it('confirms a change with the preview’s rev, then takes the new run', async () => {
    const after = { ...RUN, rev: 'next' }
    serve({ 'POST /runs/t1/changes': { body: { preview: false, change: {}, run: after } } })
    const store = useProgrammesStore()
    const refresh = vi.spyOn(useSyncStore(), 'refresh').mockResolvedValue()
    const request: ChangeRequest = {
      change: { type: 'go-to-week', week: 5 },
      from: '2026-11-16',
      reason: 'Bored',
    }
    expect(await store.confirmChange('t1', request, PREVIEW.rev)).toEqual({ ok: true, data: after })
    expect(calls[0]!.body).toEqual({ ...request, preview: false, rev: PREVIEW.rev })
    expect(store.run).toEqual(after)
    expect(refresh).toHaveBeenCalled()
  })

  it('hands back the fresh preview when the plan changed since (409, a stale rev)', async () => {
    const fresh = { ...PREVIEW, rev: 'fresh' }
    serve({
      'POST /runs/t1/changes': {
        status: 409,
        body: { error: 'conflict', rev: 'fresh', preview: fresh },
      },
    })
    const request: ChangeRequest = { change: { type: 'go-to-week', week: 5 }, from: '2026-11-16' }
    expect(await useProgrammesStore().confirmChange('t1', request, 'stale')).toEqual({
      ok: false,
      stale: fresh,
    })
  })

  it('returns a change’s problems and its other failures', async () => {
    const errors = [{ path: 'change.value', message: 'give a number.' }]
    serve({ 'POST /runs/t1/changes': { status: 400, body: { error: 'invalid', errors } } })
    const store = useProgrammesStore()
    const request: ChangeRequest = { change: { type: 'go-to-week', week: 5 }, from: '2026-11-16' }
    expect(await store.previewChange('t1', request)).toEqual({
      ok: false,
      problems: errors,
      message: null,
    })
    serve({ 'POST /runs/t1/changes': { status: 409, body: { error: 'ended' } } })
    expect(await store.confirmChange('t1', request, 'r')).toEqual({
      ok: false,
      problems: [],
      message: 'This programme has ended, so it can’t change.',
    })
  })

  it('ends a run from today', async () => {
    const ended = { ...RUN, status: 'ended' }
    serve({ 'POST /runs/t1/end': { body: { tracker: { id: 't1' }, run: ended } } })
    const store = useProgrammesStore()
    const refresh = vi.spyOn(useSyncStore(), 'refresh').mockResolvedValue()
    expect(await store.endRun('t1')).toEqual({ ok: true, data: ended })
    expect(calls[0]!.body).toEqual({})
    expect(store.run).toEqual(ended)
    expect(refresh).toHaveBeenCalled()
    serve({ 'POST /runs/t1/end': 'offline' })
    expect(await store.endRun('t1')).toMatchObject({ ok: false })
  })
})

describe('each programme tracker’s run (the week view and the item page)', () => {
  it('reads a tracker’s run once, sharing one request, and again when the state lists a newer', async () => {
    serve({ 'GET /runs/t1': { body: RUN } })
    const store = useProgrammesStore()
    const sync = useSyncStore()
    const [a, b] = await Promise.all([store.ensureRun('t1'), store.ensureRun('t1')])
    expect(a).toEqual({ ok: true, data: RUN })
    expect(b).toBe(a)
    expect(store.byTracker.t1).toEqual(RUN)
    expect(calls.filter((c) => c.path === '/runs/t1')).toHaveLength(1)
    // Held, and the state lists the same run (or none): nothing to read.
    expect(await store.ensureRun('t1')).toBeNull()
    sync.runs = { t1: { ...SUMMARY, status: 'running' as const } }
    expect(await store.ensureRun('t1')).toBeNull()
    sync.runs = { t1: { ...SUMMARY, status: 'running' as const, rev: 'newer' } }
    await store.ensureRun('t1')
    expect(calls.filter((c) => c.path === '/runs/t1')).toHaveLength(2)
  })

  it('keeps a confirmed change’s run under its tracker', async () => {
    serve({ 'POST /runs/t1/changes': { body: { preview: false, change: {}, run: RUN } } })
    const store = useProgrammesStore()
    await store.confirmChange('t1', { change: { type: 'undo', change: 1 }, from: RUN.today }, 'r')
    expect(store.byTracker.t1).toEqual(RUN)
    expect(store.run).toEqual(RUN)
  })
})

describe('restarting and re-opening a run (K167, K168)', () => {
  const RESTART = {
    preview: true,
    rev: 'r1',
    restart: {
      name: 'Beginner 5×5',
      start: '2026-11-16',
      firstWeek: { from: '2026-11-16', to: '2026-11-22' },
      weeks: 8,
      end: '2027-01-10',
      oldEndsFrom: null,
    },
  }
  const REOPEN = {
    preview: true,
    rev: 'o1',
    reopen: {
      from: '2026-11-12',
      reason: 'Knee is better',
      week: 4,
      paused: { from: '2026-11-09', to: '2026-11-11' },
      end: '2026-12-20',
      lastWeek: '2026-12-14',
    },
  }

  it('previews a restart, writing nothing', async () => {
    serve({ 'POST /runs/t1/restart': { body: RESTART } })
    const store = useProgrammesStore()
    const body = { name: 'Beginner 5×5', start: '2026-11-16' }
    expect(await store.previewRestart('t1', body)).toEqual({ ok: true, data: RESTART })
    expect(calls[0]!.body).toEqual({ ...body, preview: true })
    expect(store.run).toBeNull()
  })

  it('restarts with the preview’s rev, keeping both runs, and reads the state again', async () => {
    const fresh = { ...RUN, tracker: 't2', rev: 'new' }
    const done = { preview: false, tracker: { id: 't2', name: 'Again' }, run: fresh, old: {} }
    serve({ 'POST /runs/t1/restart': { body: done } })
    const store = useProgrammesStore()
    store.byTracker = { t1: RUN }
    const refresh = vi.spyOn(useSyncStore(), 'refresh').mockResolvedValue()
    const res = await store.restart('t1', { name: 'Again', start: '2026-11-16' }, 'r1')
    expect(res).toMatchObject({ ok: true, data: { tracker: { id: 't2' }, run: fresh } })
    expect(calls[0]!.body).toEqual({
      name: 'Again',
      start: '2026-11-16',
      preview: false,
      rev: 'r1',
    })
    expect(store.run).toEqual(fresh)
    expect(store.byTracker).toEqual({ t1: RUN, t2: fresh })
    expect(refresh).toHaveBeenCalled()
  })

  it('hands back a restart’s fresh preview when its rev is stale, and its problems', async () => {
    const fresh = { ...RESTART, rev: 'r2' }
    serve({
      'POST /runs/t1/restart': {
        status: 409,
        body: { error: 'conflict', rev: 'r2', preview: fresh },
      },
    })
    const store = useProgrammesStore()
    expect(await store.restart('t1', {}, 'r1')).toEqual({ ok: false, stale: fresh })
    const errors = [{ path: 'start', message: 'the programme starts today or later.' }]
    serve({ 'POST /runs/t1/restart': { status: 400, body: { error: 'invalid', errors } } })
    expect(await store.previewRestart('t1', { start: '2026-11-01' })).toEqual({
      ok: false,
      problems: errors,
      message: null,
    })
    serve({ 'POST /runs/t1/restart': { status: 409, body: { error: 'too-many' } } })
    expect(await store.restart('t1', {}, 'r1')).toMatchObject({
      ok: false,
      message: expect.stringContaining('There’s no room for another.'),
    })
  })

  it('previews a re-open, then re-opens with its rev and takes the run back', async () => {
    const reopened = { ...RUN, rev: 'reopened' }
    const store = useProgrammesStore()
    const refresh = vi.spyOn(useSyncStore(), 'refresh').mockResolvedValue()
    const body = { from: '2026-11-12', reason: 'Knee is better' }
    serve({ 'POST /runs/t1/reopen': { body: REOPEN } })
    expect(await store.previewReopen('t1', body)).toEqual({ ok: true, data: REOPEN })
    expect(calls[0]!.body).toEqual({ ...body, preview: true })
    expect(store.run).toBeNull()
    const done = { preview: false, tracker: { id: 't1' }, run: reopened }
    serve({ 'POST /runs/t1/reopen': { body: done } })
    expect(await store.reopen('t1', body, 'o1')).toEqual({ ok: true, data: reopened })
    expect(calls[1]!.body).toEqual({ ...body, preview: false, rev: 'o1' })
    expect(store.run).toEqual(reopened)
    expect(store.byTracker.t1).toEqual(reopened)
    expect(refresh).toHaveBeenCalled()
  })

  it('hands back a re-open’s fresh preview when its rev is stale', async () => {
    const fresh = { ...REOPEN, rev: 'o2' }
    serve({
      'POST /runs/t1/reopen': {
        status: 409,
        body: { error: 'conflict', rev: 'o2', preview: fresh },
      },
    })
    expect(await useProgrammesStore().reopen('t1', {}, 'o1')).toEqual({ ok: false, stale: fresh })
    serve({ 'POST /runs/t1/reopen': 'offline' })
    expect(await useProgrammesStore().reopen('t1', {}, 'o1')).toEqual({
      ok: false,
      problems: [],
      message: 'Can’t reach the server, so nothing changed. Try again when you’re online.',
    })
  })

  it('says a run that can’t re-open any more can’t, and reads the run again', async () => {
    const ended = { ...RUN, status: 'ended', canReopen: false }
    serve({
      'POST /runs/t1/reopen': {
        status: 409,
        body: { error: 'cant-reopen', finished: true, restarted: true },
      },
      'GET /runs/t1': { body: ended },
    })
    const store = useProgrammesStore()
    expect(await store.previewReopen('t1', {})).toEqual({
      ok: false,
      problems: [],
      message: 'This programme changed since its page opened, so it can’t be re-opened now.',
    })
    expect(calls.map((c) => c.path)).toEqual(['/runs/t1/reopen', '/runs/t1'])
    expect(store.run).toEqual(ended)
  })
})

describe('the shared library (shared library spec §5)', () => {
  const SID = SHARED_JSON.programmes[0]!.id
  const SHARED_DOC = { ...BEGINNER, name: 'Strength 5×5' }
  const COPY = { ...RECORD, id: 'p-copy', name: 'Strength 5×5', doc: SHARED_DOC }
  const PREVIEW = {
    preview: true,
    rev: 'pub1',
    publish: { programme: { ...SHARED_JSON.programmes[0]!, doc: SHARED_DOC }, replaces: null },
  }

  it('loads the shared programmes, as the signed-in user', async () => {
    serve({ 'GET /shared-programmes': { body: SHARED_JSON } })
    const store = useProgrammesStore()
    expect(store.shared).toBeNull()
    await store.loadShared()
    expect(store.shared).toEqual(SHARED_JSON.programmes)
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/shared-programmes', user: 'alice' })
  })

  it('keeps what it had when the shared library can’t load, saying nothing', async () => {
    serve({ 'GET /shared-programmes': 'offline' })
    const store = useProgrammesStore()
    await store.loadShared()
    expect(store.shared).toBeNull()
    expect(store.loadFailure).toBeNull()
    serve({ 'GET /shared-programmes': { body: SHARED_JSON } })
    await store.loadShared()
    serve({ 'GET /shared-programmes': { status: 500, body: {} } })
    await store.loadShared()
    expect(store.shared).toEqual(SHARED_JSON.programmes)
  })

  it('copies a shared programme into the library, newest first, without its document', async () => {
    serve({
      'GET /programmes': { body: LIBRARY_JSON },
      'GET /state': { body: {} },
      [`POST /shared-programmes/${SID}/copy`]: { status: 201, body: COPY },
    })
    const store = useProgrammesStore()
    await store.loadPage()
    expect(await store.copyShared(SID)).toEqual({ ok: true, data: COPY })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/shared-programmes/${SID}/copy` })
    const { doc: _doc, ...summary } = COPY
    expect(store.library).toEqual([summary, ...LIBRARY_JSON.programmes])
  })

  it('copies before the library has loaded, and says why a copy failed', async () => {
    serve({ [`POST /shared-programmes/${SID}/copy`]: { status: 201, body: COPY } })
    const store = useProgrammesStore()
    await store.copyShared(SID)
    expect(store.library!.map((p) => p.id)).toEqual(['p-copy'])
    serve({ [`POST /shared-programmes/${SID}/copy`]: { status: 409, body: { error: 'too-many' } } })
    expect(await store.copyShared(SID)).toMatchObject({
      ok: false,
      message: expect.stringContaining('There’s no room for another.'),
    })
    serve({ [`POST /shared-programmes/${SID}/copy`]: { status: 413, body: { error: 'quota' } } })
    expect(await store.copyShared(SID)).toMatchObject({
      message: 'Your account is full, so nothing was saved.',
    })
    serve({
      [`POST /shared-programmes/${SID}/copy`]: { status: 404, body: { error: 'not-found' } },
    })
    expect(await store.copyShared(SID)).toMatchObject({
      message: 'That programme is gone. It may have been deleted on another device.',
    })
    expect(store.library).toHaveLength(1)
  })

  it('previews a publish, writing nothing', async () => {
    serve({ [`POST /programmes/${PID}/publish`]: { body: PREVIEW } })
    expect(await useProgrammesStore().previewPublish(PID)).toEqual({ ok: true, data: PREVIEW })
    expect(calls[0]).toMatchObject({ body: { preview: true }, user: 'alice' })
  })

  it('publishes with the preview’s rev, marks the row shared, and reads the shared library again', async () => {
    const shared = { id: SID, updatedAt: 1794999600 }
    serve({
      'GET /programmes': { body: LIBRARY_JSON },
      'GET /state': { body: {} },
      [`POST /programmes/${PID}/publish`]: { body: { preview: false, shared } },
      'GET /shared-programmes': { body: SHARED_JSON },
    })
    const store = useProgrammesStore()
    await store.loadPage()
    expect(await store.publish(PID, 'pub1')).toEqual({ ok: true, data: shared })
    expect(calls.find((c) => c.path.endsWith('/publish'))!.body).toEqual({
      preview: false,
      rev: 'pub1',
    })
    expect(store.library![0]!.shared).toEqual(shared)
    expect(store.shared).toEqual(SHARED_JSON.programmes)
  })

  it('hands back the fresh preview when the programme changed since (409, a stale rev)', async () => {
    const fresh = { ...PREVIEW, rev: 'pub2' }
    serve({
      [`POST /programmes/${PID}/publish`]: {
        status: 409,
        body: { error: 'conflict', rev: 'pub2', preview: fresh },
      },
    })
    expect(await useProgrammesStore().publish(PID, 'pub1')).toEqual({ ok: false, stale: fresh })
  })

  it('says why a publish was refused: not an admin, or offline', async () => {
    const store = useProgrammesStore()
    serve({ [`POST /programmes/${PID}/publish`]: { status: 403, body: { error: 'not-admin' } } })
    expect(await store.previewPublish(PID)).toEqual({
      ok: false,
      problems: [],
      message: 'Only an admin can publish to the shared library.',
    })
    expect(await store.publish(PID, 'pub1')).toMatchObject({
      message: 'Only an admin can publish to the shared library.',
    })
    serve({ [`POST /programmes/${PID}/publish`]: 'offline' })
    expect(await store.publish(PID, 'pub1')).toMatchObject({
      message: 'Can’t reach the server, so nothing changed. Try again when you’re online.',
    })
  })

  it('unpublishes, unmarking the row and dropping it from the shared library', async () => {
    serve({
      'GET /programmes': {
        body: {
          programmes: [{ ...LIBRARY_JSON.programmes[0]!, shared: { id: SID, updatedAt: 1 } }],
        },
      },
      'GET /state': { body: {} },
      'GET /shared-programmes': { body: SHARED_JSON },
      [`DELETE /shared-programmes/${SID}`]: { status: 204 },
    })
    const store = useProgrammesStore()
    await store.loadPage()
    await store.loadShared()
    expect(await store.unpublish(SID)).toEqual({ ok: true, data: null })
    expect(store.library![0]!.shared).toBeNull()
    expect(store.shared!.map((p) => p.id)).toEqual([SHARED_JSON.programmes[1]!.id])
    serve({ [`DELETE /shared-programmes/${SID}`]: { status: 403, body: { error: 'not-admin' } } })
    expect(await store.unpublish(SID)).toMatchObject({
      ok: false,
      message: 'Only an admin can publish to the shared library.',
    })
  })

  it('unpublishes before either list has loaded', async () => {
    serve({ [`DELETE /shared-programmes/${SID}`]: { status: 204 } })
    const store = useProgrammesStore()
    expect(await store.unpublish(SID)).toEqual({ ok: true, data: null })
    expect(store.library).toBeNull()
    expect(store.shared).toBeNull()
  })
})
