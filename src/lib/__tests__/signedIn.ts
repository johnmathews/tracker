import { vi } from 'vitest'
import { FakeApi } from './fakeApi'
import { SESSION_KEY } from '@/stores/session'
import { CACHE_PREFIX, type SyncState } from '@/stores/sync'

export const USER = 'alice'

export function emptyState(): SyncState {
  return {
    exercise: { plans: {}, log: {}, details: {}, revs: {}, detailRevs: {} },
    cardio: { plans: {}, log: {}, details: {}, revs: {}, detailRevs: {} },
    diet: { plans: {}, log: {}, details: {}, revs: {}, detailRevs: {} },
    settings: null,
  }
}

/**
 * A browser already signed in as alice: the fake API holds her account and is installed as
 * `fetch`, the session is remembered, and her cache holds `cache`, so the app renders at once.
 */
export function signedIn(cache: SyncState = emptyState()): FakeApi {
  const api = new FakeApi()
  api.addUser(USER)
  api.signedIn = USER
  vi.stubGlobal('fetch', api.fetch)
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user: USER }))
  localStorage.setItem(CACHE_PREFIX + USER, JSON.stringify(cache))
  return api
}

/** What the browser has cached for alice. */
export function cached(): SyncState {
  return JSON.parse(localStorage.getItem(CACHE_PREFIX + USER)!) as SyncState
}
