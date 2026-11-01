import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { SESSION_KEY, useSessionStore } from '@/stores/session'
import { CACHE_PREFIX, OUTBOX_PREFIX, useSyncStore } from '@/stores/sync'
import { usePlannerStore } from '@/stores/planner'
import { FakeApi, PASSWORD } from '@/lib/__tests__/fakeApi'
import { USER, emptyState, signedIn } from '@/lib/__tests__/signedIn'

let api: FakeApi

function fresh(): FakeApi {
  const a = new FakeApi()
  a.addUser(USER)
  vi.stubGlobal('fetch', a.fetch)
  return a
}

describe('session', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    useSyncStore().stop()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('signs in at once from a remembered user, then confirms with the server', async () => {
    api = signedIn()
    const session = useSessionStore()
    const init = session.init()
    expect(session.status).toBe('signed-in')
    expect(session.user).toBe(USER)
    expect(useSyncStore().loaded).toBe(true)
    await init
    expect(api.paths('GET /auth/me')).toHaveLength(1)
    expect(session.status).toBe('signed-in')
  })

  it('stays signed in offline with a remembered user, working from the cache', async () => {
    api = signedIn()
    api.offline = true
    const session = useSessionStore()
    await session.init()
    expect(session.status).toBe('signed-in')
  })

  it('asks to sign in again when the remembered session has ended, keeping unsent changes', async () => {
    api = signedIn()
    api.signedIn = null
    localStorage.setItem(OUTBOX_PREFIX + USER, JSON.stringify([{ kind: 'settings', id: 'a' }]))
    const session = useSessionStore()
    await session.init()
    expect(session.status).toBe('signed-out')
    expect(session.expired).toBe(true)
    expect(session.user).toBe(USER)
    expect(localStorage.getItem(OUTBOX_PREFIX + USER)).not.toBeNull()
  })

  it('finds a still-valid cookie when nothing is remembered', async () => {
    api = fresh()
    api.signedIn = USER
    const session = useSessionStore()
    await session.init()
    expect(session.status).toBe('signed-in')
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual({ user: USER })
  })

  it.each([
    ['no session', false],
    ['the server unreachable', true],
  ])('shows sign-in with nothing remembered and %s', async (_, offline) => {
    api = fresh()
    api.offline = offline
    const session = useSessionStore()
    expect(session.status).toBe('checking')
    await session.init()
    expect(session.status).toBe('signed-out')
    expect(session.expired).toBe(false)
  })

  it('switches to the server’s user when the cookie belongs to someone else', async () => {
    api = signedIn()
    api.addUser('bob')
    api.signedIn = 'bob'
    const session = useSessionStore()
    const init = session.init()
    usePlannerStore().toggle('pu', 0) // alice's data, shown from her cache
    api.stall('GET', '/state') // bob's data has not arrived yet
    await init
    expect(session.user).toBe('bob')
    // Nothing of alice's may stay in the stores, where Export could still reach it.
    expect(usePlannerStore().grandTotal).toBe(0)
  })

  it('logs in, remembers the user and starts syncing', async () => {
    api = fresh()
    const session = useSessionStore()
    expect(await session.login(USER, PASSWORD)).toBeNull()
    expect(session.status).toBe('signed-in')
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual({ user: USER })
    await flushPromises()
    expect(useSyncStore().loaded).toBe(true)
  })

  it('loads the Ask flag for a remembered user, who never sees the sign-in form (F9)', async () => {
    api = signedIn()
    api.ask = true
    const session = useSessionStore()
    // Unknown until the server says, so the bar's Ask button never flashes on or off.
    expect(session.ask).toBeNull()
    await session.init()
    await flushPromises()
    expect(session.ask).toBe(true)
    expect(api.paths('GET /auth/options')).toHaveLength(1)
  })

  it('loads the Ask flag after signing in, off when the API has no key', async () => {
    api = fresh()
    const session = useSessionStore()
    await session.login(USER, PASSWORD)
    await flushPromises()
    expect(session.ask).toBe(false)
  })

  it('keeps the Ask flag as it was when the options can’t be read', async () => {
    api = signedIn()
    api.ask = true
    api.offline = true
    const session = useSessionStore()
    await session.init()
    await flushPromises()
    expect(session.ask).toBeNull()
    api.offline = false
    await session.loadOptions()
    expect(session.ask).toBe(true)
    api.failNext('GET', '/auth/options', 502)
    await session.loadOptions()
    expect(session.ask).toBe(true)
    session.askOff()
    expect(session.ask).toBe(false)
  })

  it.each([
    ['wrong password', { status: 401, body: { error: 'invalid' } }, { code: 'invalid' }],
    [
      'a locked account',
      { status: 423, body: { error: 'locked', retryAfter: 600 } },
      { code: 'locked', retryAfter: 600 },
    ],
    [
      'a busy server',
      { status: 503, body: { error: 'busy', retryAfter: 1 } },
      { code: 'busy', retryAfter: 1 },
    ],
    ['an unknown refusal', { status: 418, body: { error: 'teapot' } }, { code: 'error' }],
  ])('reports %s', async (_, reply, expected) => {
    api = fresh()
    api.failNext('POST', '/auth/login', reply.status, reply.body)
    const session = useSessionStore()
    expect(await session.login(USER, PASSWORD)).toEqual(expected)
    expect(session.status).toBe('checking')
  })

  it('calls a reply it does not expect an error', async () => {
    api = fresh()
    api.failNext('POST', '/auth/login', 409, { error: 'conflict' })
    expect(await useSessionStore().login(USER, PASSWORD)).toEqual({ code: 'error' })
  })

  it('reports a wrong password from the server itself', async () => {
    api = fresh()
    expect(await useSessionStore().login(USER, 'nope nope nope')).toEqual({ code: 'invalid' })
  })

  it('reports being offline', async () => {
    api = fresh()
    api.offline = true
    expect(await useSessionStore().login(USER, PASSWORD)).toEqual({ code: 'offline' })
  })

  it('looks up and redeems an invite link, signing in', async () => {
    api = fresh()
    api.links.set('tok', { kind: 'invite', username: 'bob' })
    const session = useSessionStore()
    expect(await session.lookup('tok')).toEqual({ kind: 'invite', username: 'bob' })
    expect(await session.redeem('tok', 'short')).toEqual({ code: 'password' })
    expect(await session.redeem('tok', PASSWORD)).toBeNull()
    expect(session.user).toBe('bob')
    expect(await session.lookup('tok')).toEqual({ code: 'gone' })
    expect(await session.redeem('tok', PASSWORD)).toEqual({ code: 'gone' })
  })

  it('follows another tab signing out', async () => {
    api = signedIn()
    const session = useSessionStore()
    await session.init()
    await flushPromises()
    usePlannerStore().toggle('pu', 0)
    localStorage.removeItem(SESSION_KEY)
    api.signedIn = null
    await session.onStorage(SESSION_KEY)
    expect(session.status).toBe('signed-out')
    expect(session.expired).toBe(false)
    expect(usePlannerStore().grandTotal).toBe(0)
    expect(useSyncStore().user).toBeNull()
  })

  it('ignores a session event that changes nothing', async () => {
    api = signedIn()
    const session = useSessionStore()
    await session.init()
    const reads = api.paths('GET /auth/me').length
    await session.onStorage(SESSION_KEY)
    expect(session.status).toBe('signed-in')
    expect(api.paths('GET /auth/me')).toHaveLength(reads)
  })

  it('follows another tab signing in as someone else', async () => {
    api = signedIn()
    api.addUser('bob')
    const session = useSessionStore()
    await session.init()
    await flushPromises()
    usePlannerStore().toggle('pu', 0)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: 'bob' }))
    api.signedIn = 'bob'
    await session.onStorage(SESSION_KEY)
    expect(session.user).toBe('bob')
    expect(useSyncStore().user).toBe('bob')
    expect(usePlannerStore().grandTotal).toBe(0)
    await session.onStorage('unrelated')
    expect(session.user).toBe('bob')
  })

  it('signs out, forgetting the user’s data on the device', async () => {
    api = signedIn()
    const session = useSessionStore()
    await session.init()
    await flushPromises()
    usePlannerStore().toggle('pu', 0)
    expect(await session.logout()).toBeNull()
    expect(session.status).toBe('signed-out')
    expect(session.user).toBeNull()
    expect(api.signedIn).toBeNull()
    expect(usePlannerStore().grandTotal).toBe(0)
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(localStorage.getItem(CACHE_PREFIX + USER)).toBeNull()
    expect(localStorage.getItem(OUTBOX_PREFIX + USER)).toBeNull()
  })

  it('signs out cleanly when nobody was signed in', async () => {
    api = fresh()
    const session = useSessionStore()
    expect(await session.logout()).toBeNull()
    expect(session.status).toBe('signed-out')
  })

  it('refuses to sign out offline, since only the server can end the session', async () => {
    api = signedIn()
    const session = useSessionStore()
    await session.init()
    api.offline = true
    expect(await session.logout()).toEqual({ code: 'offline' })
    expect(session.status).toBe('signed-in')
    expect(localStorage.getItem(CACHE_PREFIX + USER)).not.toBeNull()
  })

  it('finishes signing out when the session had already ended', async () => {
    api = signedIn(emptyState())
    const session = useSessionStore()
    await session.init()
    api.signedIn = null
    expect(await session.logout()).toBeNull()
    expect(session.status).toBe('signed-out')
  })
})
