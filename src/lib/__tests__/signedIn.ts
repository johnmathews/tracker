import { vi } from 'vitest'
import { FakeApi } from './fakeApi'
import { SESSION_KEY } from '@/stores/session'
import { CACHE_PREFIX, type SyncState } from '@/stores/sync'
import { firstTrackers } from '@/lib/trackers'
import type { Section } from '@/lib/trackerTypes'

export const USER = 'alice'

/** One tracker's part of the cache, with nothing in it. */
export function emptySection(): SyncState['sections'][string] {
  return { plans: {}, log: {}, details: {}, revs: {}, detailRevs: {} }
}

/** A cache with the account's first three trackers (K123), each empty, and no settings. */
export function emptyState(): SyncState & {
  sections: Record<Section, SyncState['sections'][string]>
} {
  return {
    trackers: firstTrackers(null).map((t) => ({ ...t, rev: 1 })),
    sections: { exercise: emptySection(), cardio: emptySection(), diet: emptySection() },
    settings: null,
  }
}

/**
 * A cache in the format from before trackers were the account's own (`-v5` and older): the first
 * three trackers' sections under fixed keys.
 */
export function oldState() {
  return {
    exercise: emptySection(),
    cardio: emptySection(),
    diet: emptySection(),
    settings: null as SyncState['settings'],
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

/** A cache whose first three trackers' sections are always there, as `emptyState` makes them. */
export type CachedState = ReturnType<typeof emptyState>

/** What the browser has cached for alice. */
export function cached(): CachedState {
  return JSON.parse(localStorage.getItem(CACHE_PREFIX + USER)!) as CachedState
}
