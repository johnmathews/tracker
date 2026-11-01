import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { usePlannerStore } from '@/stores/planner'
import { SESSION_KEY, useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'
import type { PortableSettings } from '@/lib/storage'
import type { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, emptyState, signedIn } from '@/lib/__tests__/signedIn'

const NOW = new Date(2026, 10, 1, 9, 0)
const PICKS = { accent: '#30d158', dailyPick: 3, foodPick: 2 }

let wrapper: VueWrapper
let api: FakeApi

async function settle(): Promise<void> {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(0)
  await flushPromises()
}

/**
 * The Settings page, signed in as alice. `saved` is what the server holds (null: never saved),
 * and the cache holds it too unless `cache` says otherwise.
 */
async function openSettings({
  saved = { ...PICKS, goals: 'Ten pull-ups by March.' } as PortableSettings | null,
  cache = saved as unknown,
  offline = false,
} = {}): Promise<void> {
  history.replaceState(null, '', '/#/settings')
  api = signedIn({ ...emptyState(), settings: cache as PortableSettings | null })
  api.accounts.get(USER)!.settings = saved
  api.offline = offline
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
}

function goalsBox() {
  return wrapper.get<HTMLTextAreaElement>('[data-testid="goals"]')
}

function puts(): unknown[] {
  return api.calls.filter((c) => c.method === 'PUT' && c.path === '/settings').map((c) => c.body)
}

function button(name: string) {
  return wrapper.findAll('button').find((b) => b.text() === name)!
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
})

describe('Your goals in Settings', () => {
  it('sits between Appearance and Your data, labelled, with what reads it', async () => {
    await openSettings()
    const page = wrapper.get('[data-testid="settings-page"]')
    expect(page.findAll('h2').map((h) => h.text())).toEqual([
      'Appearance',
      'Your goals',
      'Your data',
      'Account',
    ])
    const field = page.get('[data-slot="text-area"]')
    expect(field.get('label').text()).toBe('What you’re working towards')
    expect(field.text()).toContain('Ask reads this when it answers. Nothing else does.')
    expect(goalsBox().element.value).toBe('Ten pull-ups by March.')
    expect(goalsBox().attributes('aria-describedby')).toBeTruthy()
  })

  it('saves once per pause in typing, however many keys (F18)', async () => {
    await openSettings()
    for (const text of ['R', 'Ru', 'Run', 'Run 5', 'Run 5 km']) {
      await goalsBox().setValue(text)
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(puts()).toEqual([])
    await vi.advanceTimersByTimeAsync(400)
    await settle()
    expect(puts()).toEqual([{ ...PICKS, goals: 'Run 5 km' }])
    await goalsBox().setValue('Run 5 km by May')
    await vi.advanceTimersByTimeAsync(599)
    await settle()
    expect(puts()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(puts()).toEqual([
      { ...PICKS, goals: 'Run 5 km' },
      { ...PICKS, goals: 'Run 5 km by May' },
    ])
    expect(api.accounts.get(USER)!.settings!.goals).toBe('Run 5 km by May')
  })

  it('saves at once on leaving the box, and leaves the words as typed', async () => {
    await openSettings()
    await goalsBox().setValue('Vegetables every day.\n')
    await goalsBox().trigger('blur')
    await settle()
    expect(puts()).toEqual([{ ...PICKS, goals: 'Vegetables every day.' }])
    // The trailing line break the person just typed stays in the box.
    expect(goalsBox().element.value).toBe('Vegetables every day.\n')
    // Leaving the box again with nothing new sends nothing.
    await goalsBox().trigger('blur')
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    expect(puts()).toHaveLength(1)
  })

  it('saves what was typed when the page closes mid-pause', async () => {
    await openSettings()
    await goalsBox().setValue('Feel less stiff.')
    location.hash = '#/'
    await settle()
    expect(puts()).toEqual([{ ...PICKS, goals: 'Feel less stiff.' }])
  })

  it('keeps nothing of a half-typed draft when another tab signs out mid-pause', async () => {
    await openSettings()
    await goalsBox().setValue('Half typed')
    api.signedIn = null
    localStorage.removeItem(SESSION_KEY)
    await useSessionStore().onStorage(SESSION_KEY)
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    expect(wrapper.find('[data-testid="settings-page"]').exists()).toBe(false)
    expect(puts()).toEqual([])
    // The signed-out stores hold no goals, so nothing can carry them to the next sign-in.
    expect(usePlannerStore().goals).toBe('')
    expect(usePlannerStore().goalsKnown).toBe(false)
  })

  it('shows goals saved elsewhere, but never over words still being typed', async () => {
    await openSettings()
    usePlannerStore().adopt({ plans: {}, log: {} }, { ...PICKS, goals: 'From the phone.' })
    await settle()
    expect(goalsBox().element.value).toBe('From the phone.')
    await goalsBox().setValue('Mine, half')
    usePlannerStore().adopt({ plans: {}, log: {} }, { ...PICKS, goals: 'From the phone, again.' })
    await settle()
    expect(goalsBox().element.value).toBe('Mine, half')
  })

  it('can’t be typed in until the saved goals are known, so it never writes over them (F1)', async () => {
    // A cache from a tab before My goals, and no server yet.
    await openSettings({ cache: { ...PICKS }, offline: true })
    expect(usePlannerStore().goalsKnown).toBe(false)
    expect(goalsBox().element.disabled).toBe(true)
    api.offline = false
    await useSyncStore().refresh()
    await settle()
    expect(goalsBox().element.disabled).toBe(false)
    expect(goalsBox().element.value).toBe('Ten pull-ups by March.')
  })

  it('takes goals on a new account, which has nothing saved yet', async () => {
    await openSettings({ saved: null })
    expect(usePlannerStore().goalsKnown).toBe(false)
    expect(goalsBox().element.disabled).toBe(false)
    await goalsBox().setValue('Run 5 km.')
    await goalsBox().trigger('blur')
    await settle()
    expect(api.accounts.get(USER)!.settings).toEqual({ ...PICKS, goals: 'Run 5 km.' })
  })
})

describe('export and import with Ask’s history', () => {
  const turn = { question: 'Is my diet good enough?', answer: 'Mostly.', stop: 'end_turn' }
  const conversation = { id: 'c1', title: 'Is my diet good enough?', createdAt: 1, updatedAt: 2 }

  function captureDownload(): () => Promise<Record<string, unknown>> {
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn<(b: Blob) => string>((b) => {
      blob = b
      return 'blob:x'
    })
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    return async () => JSON.parse(await blob!.text()) as Record<string, unknown>
  }

  it('exports the server’s conversations with this device’s plans and marks', async () => {
    const file = captureDownload()
    await openSettings()
    api.addConversation(USER, { ...conversation, turns: [{ ...turn, askedAt: 1 }] as never })
    await button('Export').trigger('click')
    await settle()
    expect(api.paths('GET /export')).toHaveLength(1)
    const data = await file()
    expect(data.conversations).toEqual([{ ...conversation, turns: [{ ...turn, askedAt: 1 }] }])
    expect(data.settings).toEqual({ ...PICKS, goals: 'Ten pull-ups by March.' })
    expect(wrapper.find('[data-testid="import-notice"]').exists()).toBe(false)
  })

  it('leaves the list out when there are no conversations', async () => {
    const file = captureDownload()
    await openSettings()
    await button('Export').trigger('click')
    await settle()
    expect('conversations' in (await file())).toBe(false)
  })

  it('exports without them, and says so, when the server can’t be reached', async () => {
    const file = captureDownload()
    await openSettings()
    api.offline = true
    await button('Export').trigger('click')
    await settle()
    expect('conversations' in (await file())).toBe(false)
    expect(wrapper.get('[data-testid="import-notice"]').text()).toBe(
      'Exported without your Ask conversations, because the server couldn’t be reached.',
    )
  })

  async function choose(data: unknown): Promise<void> {
    const input = wrapper.get('[data-testid="import-file"]')
    const file = new File([JSON.stringify(data)], 'export.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await settle()
  }

  const EMPTY = {
    format: 'tracker-export',
    version: 4,
    exercise: { plans: {}, log: {} },
    diet: { plans: {}, log: {} },
  }

  it('counts goals that fill empty ones as a change, names them, and imports them', async () => {
    await openSettings({ saved: { ...PICKS, goals: '' } })
    await choose({ ...EMPTY, settings: { ...PICKS, dailyPick: 5, goals: 'Run 5 km.' } })
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds zero weekly plans and zero marked days, plus your goals. Existing plans and marks stay as they are.',
    )
    await button('Import').trigger('click')
    await settle()
    expect(api.accounts.get(USER)!.settings).toEqual({ ...PICKS, goals: 'Run 5 km.' })
    expect(goalsBox().element.value).toBe('Run 5 km.')
  })

  it('counts the conversations it would add, leaving out the ones already here', async () => {
    await openSettings()
    api.addConversation(USER, { ...conversation, turns: [] })
    const second = { ...conversation, id: 'c2', title: 'How steady was October?', turns: [] }
    const third = { ...conversation, id: 'c3', title: 'Fish?', turns: [] }
    await choose({ ...EMPTY, conversations: [{ ...conversation, turns: [] }, second, third] })
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds zero weekly plans and zero marked days, plus two conversations from Ask. Existing plans and marks stay as they are.',
    )
    await button('Import').trigger('click')
    await settle()
    expect(api.accounts.get(USER)!.conversations.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('names everything a file brings to an account with no settings', async () => {
    await openSettings({ saved: null })
    const one = { ...conversation, turns: [] }
    await choose({ ...EMPTY, settings: { ...PICKS, goals: 'Run.' }, conversations: [one] })
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds zero weekly plans and zero marked days, plus the exercises and foods a day, your goals and one conversation from Ask. Existing plans and marks stay as they are.',
    )
  })

  it('says nothing is new when every conversation is already here', async () => {
    await openSettings()
    api.addConversation(USER, { ...conversation, turns: [] })
    await choose({ ...EMPTY, conversations: [{ ...conversation, turns: [] }] })
    expect(wrapper.get('[data-testid="import-notice"]').text()).toBe(
      'Nothing new: everything in that file is already here.',
    )
  })
})
