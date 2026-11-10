import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { CACHE_PREFIX } from '@/stores/sync'
import { usePlannerStore } from '@/stores/planner'
import { DATA_KEY, DIET_KEY, SETTINGS_KEY } from '@/lib/storage'
import { IMPORT_MARKER_PREFIX } from '@/lib/legacy'
import type { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, signedIn } from '@/lib/__tests__/signedIn'

const NOW = new Date(2026, 9, 23, 18, 0)
const WEEK = '2026-10-19'
const SQUATS = { id: 'sq', name: 'Squats', reps: 15, target: 4 }

let wrapper: VueWrapper
let api: FakeApi

/** What a browser recorded before accounts: last week's plan and ticks, and an accent. */
function recordBeforeAccounts(): void {
  localStorage.setItem(
    DATA_KEY,
    JSON.stringify({
      plans: { '2026-10-12': [SQUATS] },
      log: { '2026-10-12': { sq: ['great', null, 'great', null, null, null, null] } },
    }),
  )
  localStorage.setItem(
    DIET_KEY,
    JSON.stringify({
      plans: {},
      log: { [WEEK]: { veg: ['great', null, null, null, null, null, null] } },
    }),
  )
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ accent: '#bf5af2', dailyPick: 2, theme: 'dark' }),
  )
}

async function mountApp(): Promise<VueWrapper> {
  wrapper?.unmount()
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

function prompt() {
  return wrapper.find('[data-testid="import-prompt"]')
}

function button(name: string) {
  return wrapper.findAll('button').find((b) => b.text() === name)!
}

function marker(user = USER): string | null {
  return localStorage.getItem(IMPORT_MARKER_PREFIX + user)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the first-login import prompt', () => {
  it('offers this browser’s earlier log, with what it would add', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    expect(prompt().get('h2').text()).toBe('Data from before accounts')
    expect(prompt().text()).toContain(
      'Adds one weekly plan and three marked days, plus the exercises and foods a day. Existing plans and marks stay as they are.',
    )
  })

  it('adds it to the account on the server, then stays answered', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    await button('Add to my account').trigger('click')
    await flushPromises()
    expect(api.paths('POST /import')).toHaveLength(1)
    const account = api.accounts.get(USER)!
    expect(account.plans.exercise['2026-10-12']!.items).toEqual([SQUATS])
    expect(account.ticks.diet[WEEK]).toEqual({ veg: 1 })
    expect(account.settings).toEqual({
      accent: '#bf5af2',
      dailyPick: 2,
      foodPick: 2,
      goals: '',
      limits: '',
    })
    expect(prompt().get('h2').text()).toBe('Added to your account')
    expect(prompt().get('[role="status"]').text()).toContain('now part of your account')
    // The earlier week and the settings show at once, from the server's merged state.
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(wrapper.findAll('button[aria-label^="Squats,"]')[0]!.attributes('aria-pressed')).toBe(
      'true',
    )
    expect(usePlannerStore().accent).toBe('#bf5af2')
    await button('Close').trigger('click')
    expect(prompt().exists()).toBe(false)
    expect(marker()).toBe('"imported"')
    // The old keys stay, read-only, and the prompt does not come back.
    expect(localStorage.getItem(DATA_KEY)).not.toBeNull()
    await mountApp()
    expect(prompt().exists()).toBe(false)
  })

  it('remembers “Not mine”', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    await button('Not mine').trigger('click')
    expect(prompt().exists()).toBe(false)
    expect(marker()).toBe('"dismissed"')
    expect(api.paths('/import')).toEqual([])
    await mountApp()
    expect(prompt().exists()).toBe(false)
  })

  it('asks again on the next load after “Later”', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    await button('Later').trigger('click')
    expect(prompt().exists()).toBe(false)
    expect(marker()).toBeNull()
    await mountApp()
    expect(prompt().exists()).toBe(true)
  })

  it('says so and keeps the offer when the server cannot be reached', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    api.offline = true
    await button('Add to my account').trigger('click')
    await flushPromises()
    expect(prompt().get('[role="alert"]').text()).toBe(
      'Can’t reach the server, so nothing was added. Try again when you’re online.',
    )
    expect(marker()).toBeNull()
  })

  it('says something went wrong when the server refuses', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    api.failNext('POST', '/import', 400, { error: 'format' })
    await button('Add to my account').trigger('click')
    await flushPromises()
    expect(prompt().get('[role="alert"]').text()).toContain('Something went wrong')
    expect(button('Add to my account').attributes('aria-busy')).toBeUndefined()
  })

  it('sends one import however often “Add” is pressed', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    const release = api.hold()
    await button('Add to my account').trigger('click')
    expect(button('Adding…').attributes('aria-busy')).toBe('true')
    await button('Adding…').trigger('click')
    release()
    await flushPromises()
    expect(api.paths('POST /import')).toHaveLength(1)
  })

  it('does not ask when the account already holds everything here', async () => {
    recordBeforeAccounts()
    api = signedIn()
    const account = api.accounts.get(USER)!
    account.plans.exercise['2026-10-12'] = { items: [SQUATS], rev: 1 }
    account.ticks.exercise['2026-10-12'] = { sq: 0b101 }
    account.ticks.diet[WEEK] = { veg: 1 }
    account.settings = { accent: '#30d158', dailyPick: 3, foodPick: 2, goals: '', limits: '' }
    localStorage.removeItem(CACHE_PREFIX + USER) // so the first state shown is the server's
    await mountApp()
    expect(prompt().exists()).toBe(false)
    expect(marker()).toBe('"imported"')
  })

  it('does not ask a browser that never used the app before accounts', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }))
    api = signedIn()
    await mountApp()
    expect(prompt().exists()).toBe(false)
    expect(marker()).toBeNull()
  })

  it('waits for the server’s own state, not just the cache, then asks', async () => {
    recordBeforeAccounts()
    api = signedIn() // with a cached copy, so the planner shows at once
    const release = api.holdNext('GET', '/state')
    await mountApp()
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
    expect(prompt().exists()).toBe(false)
    expect(marker()).toBeNull()
    release()
    await flushPromises()
    expect(prompt().exists()).toBe(true)
  })

  it('names a server failure as one', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    api.failNext('POST', '/import', 500)
    await button('Add to my account').trigger('click')
    await flushPromises()
    expect(prompt().get('[role="alert"]').text()).toBe(
      'The server had a problem, so nothing was added. Try again in a while.',
    )
  })

  it('says when the account is full', async () => {
    recordBeforeAccounts()
    api = signedIn()
    await mountApp()
    api.failNext('POST', '/import', 413, { error: 'quota' })
    await button('Add to my account').trigger('click')
    await flushPromises()
    expect(prompt().get('[role="alert"]').text()).toBe(
      'Your account is full, so nothing was added.',
    )
  })

  it('asks each user on the same browser separately', async () => {
    recordBeforeAccounts()
    api = signedIn()
    api.addUser('bob')
    await mountApp()
    await button('Not mine').trigger('click')
    expect(marker()).toBe('"dismissed"')
    // Alice signs out in another tab and bob signs in: he gets his own question.
    localStorage.setItem('tracker-session-v1', JSON.stringify({ user: 'bob' }))
    api.signedIn = 'bob'
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'tracker-session-v1',
        storageArea: localStorage,
      }),
    )
    await flushPromises()
    expect(prompt().exists()).toBe(true)
    expect(marker('bob')).toBeNull()
  })
})
