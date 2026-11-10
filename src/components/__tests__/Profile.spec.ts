import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
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
/** A settings write: the arrangement always goes, `{}` for the default (K66). */
const SENT = { ...PICKS, itemSections: {} }
const SAVED = { ...PICKS, goals: 'Ten pull-ups by March.', limits: 'Left knee: no jumping.' }

let wrapper: VueWrapper
let api: FakeApi

async function settle(): Promise<void> {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(0)
  await flushPromises()
}

/**
 * The Profile page (K106), signed in as alice. `saved` is what the server holds (null: never
 * saved), and the cache holds it too unless `cache` says otherwise.
 */
async function openProfile({
  saved = SAVED as PortableSettings | null,
  cache = saved as unknown,
  offline = false,
} = {}): Promise<void> {
  history.replaceState(null, '', '/#/profile')
  api = signedIn({ ...emptyState(), settings: cache as PortableSettings | null })
  api.accounts.get(USER)!.settings = saved
  api.offline = offline
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
}

function page() {
  return wrapper.get('[data-testid="profile-page"]')
}
function goalsBox() {
  return wrapper.get<HTMLTextAreaElement>('[data-testid="goals"]')
}
function limitsBox() {
  return wrapper.get<HTMLTextAreaElement>('[data-testid="limits"]')
}
function puts(): unknown[] {
  return api.calls.filter((c) => c.method === 'PUT' && c.path === '/settings').map((c) => c.body)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
})

describe('the Profile page (K106)', () => {
  it('opens at #/profile with no bar: Back to the week, the title, then its three sections', async () => {
    await openProfile()
    expect(wrapper.find('[data-testid="settings-button"]').exists()).toBe(false)
    expect(page().get('a').text()).toBe('Back to the week')
    expect(page().get('a').attributes('href')).toBe('#/')
    expect(page().get('h1').text()).toBe('Profile')
    expect(document.activeElement).toBe(page().get('h1').element)
    expect(
      page()
        .findAll('h2')
        .map((h) => h.text()),
    ).toEqual(['Account', 'Your goals', 'Your limits'])
    expect(page().get('[data-testid="signed-in-as"]').text()).toBe(`Signed in as ${USER}`)
  })

  it('labels both boxes, says who reads them, and fills them from the account (F1)', async () => {
    await openProfile()
    const [goals, limits] = page().findAll('[data-slot="text-area"]')
    expect(goals!.get('label').text()).toBe('What you’re working towards')
    expect(goals!.text()).toContain('Ask and your Claude connections read this. Nothing else does.')
    expect(limits!.get('label').text()).toBe('What you have to work around')
    expect(limits!.text()).toContain(
      'Injuries, equipment, time and food. Ask and your Claude connections read this too.',
    )
    expect(goalsBox().element.value).toBe('Ten pull-ups by March.')
    expect(limitsBox().element.value).toBe('Left knee: no jumping.')
    expect(goalsBox().attributes('maxlength')).toBe('1000')
    expect(limitsBox().attributes('maxlength')).toBe('1000')
  })

  it('goes back to the week, with focus on the bar’s Profile button', async () => {
    await openProfile()
    usePlannerStore().setConfigMode(true)
    location.hash = '#/'
    await settle()
    expect(wrapper.find('[data-testid="profile-page"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="profile-button"]').element)
  })
})

describe('Your goals on the Profile page', () => {
  it('saves once per pause in typing, however many keys (F18)', async () => {
    await openProfile()
    for (const text of ['R', 'Ru', 'Run', 'Run 5', 'Run 5 km']) {
      await goalsBox().setValue(text)
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(puts()).toEqual([])
    await vi.advanceTimersByTimeAsync(400)
    await settle()
    expect(puts()).toEqual([{ ...SENT, goals: 'Run 5 km', limits: SAVED.limits }])
    await goalsBox().setValue('Run 5 km by May')
    await vi.advanceTimersByTimeAsync(599)
    await settle()
    expect(puts()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(puts()).toHaveLength(2)
    expect(api.accounts.get(USER)!.settings!.goals).toBe('Run 5 km by May')
  })

  it('saves at once on leaving the box, and leaves the words as typed', async () => {
    await openProfile()
    await goalsBox().setValue('Vegetables every day.\n')
    await goalsBox().trigger('blur')
    await settle()
    expect(puts()).toEqual([{ ...SENT, goals: 'Vegetables every day.', limits: SAVED.limits }])
    expect(goalsBox().element.value).toBe('Vegetables every day.\n')
    await goalsBox().trigger('blur')
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    expect(puts()).toHaveLength(1)
  })

  it('saves what was typed when the page closes mid-pause', async () => {
    await openProfile()
    await goalsBox().setValue('Feel less stiff.')
    location.hash = '#/'
    await settle()
    expect(api.accounts.get(USER)!.settings!.goals).toBe('Feel less stiff.')
  })

  it('keeps nothing of a half-typed draft when another tab signs out mid-pause', async () => {
    await openProfile()
    await goalsBox().setValue('Half typed')
    await limitsBox().setValue('Half typed too')
    api.signedIn = null
    localStorage.removeItem(SESSION_KEY)
    await useSessionStore().onStorage(SESSION_KEY)
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    expect(wrapper.find('[data-testid="profile-page"]').exists()).toBe(false)
    expect(puts()).toEqual([])
    const planner = usePlannerStore()
    expect([planner.goals, planner.goalsKnown, planner.limits, planner.limitsKnown]).toEqual([
      '',
      false,
      '',
      false,
    ])
  })

  it('shows goals saved elsewhere, but never over words still being typed', async () => {
    await openProfile()
    usePlannerStore().adopt({ plans: {}, log: {} }, { ...PICKS, goals: 'From the phone.' })
    await settle()
    expect(goalsBox().element.value).toBe('From the phone.')
    await goalsBox().setValue('Mine, half')
    usePlannerStore().adopt({ plans: {}, log: {} }, { ...PICKS, goals: 'From the phone, again.' })
    await settle()
    expect(goalsBox().element.value).toBe('Mine, half')
  })

  it('can’t be typed in until the saved goals are known, so it never writes over them (F1)', async () => {
    await openProfile({ cache: { ...PICKS }, offline: true })
    expect(goalsBox().element.disabled).toBe(true)
    api.offline = false
    await useSyncStore().refresh()
    await settle()
    expect(goalsBox().element.disabled).toBe(false)
    expect(goalsBox().element.value).toBe('Ten pull-ups by March.')
  })

  it('takes goals on a new account, which has nothing saved yet', async () => {
    await openProfile({ saved: null })
    expect(goalsBox().element.disabled).toBe(false)
    await goalsBox().setValue('Run 5 km.')
    await goalsBox().trigger('blur')
    await settle()
    expect(api.accounts.get(USER)!.settings).toEqual({ ...PICKS, goals: 'Run 5 km.', limits: '' })
  })
})

describe('Your limits on the Profile page (K107)', () => {
  it('saves once per pause in typing, apart from the goals', async () => {
    await openProfile()
    for (const text of ['V', 'Veg', 'Vegetarian.']) {
      await limitsBox().setValue(text)
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(puts()).toEqual([])
    await vi.advanceTimersByTimeAsync(400)
    await settle()
    expect(puts()).toEqual([{ ...SENT, goals: SAVED.goals, limits: 'Vegetarian.' }])
    expect(api.accounts.get(USER)!.settings!.limits).toBe('Vegetarian.')
    expect(goalsBox().element.value).toBe(SAVED.goals)
  })

  it('saves at once on leaving the box, and when the page closes mid-pause', async () => {
    await openProfile()
    await limitsBox().setValue('Gym on Saturdays only.')
    await limitsBox().trigger('blur')
    await settle()
    expect(api.accounts.get(USER)!.settings!.limits).toBe('Gym on Saturdays only.')
    await limitsBox().setValue('Gym on Saturdays only. 40 minutes on weekdays.')
    location.hash = '#/'
    await settle()
    expect(api.accounts.get(USER)!.settings!.limits).toBe(
      'Gym on Saturdays only. 40 minutes on weekdays.',
    )
  })

  it('shows limits saved elsewhere, but never over words still being typed', async () => {
    await openProfile()
    usePlannerStore().adopt({ plans: {}, log: {} }, { ...PICKS, limits: 'From the phone.' })
    await settle()
    expect(limitsBox().element.value).toBe('From the phone.')
    await limitsBox().setValue('Mine, half')
    usePlannerStore().adopt({ plans: {}, log: {} }, { ...PICKS, limits: 'Again.' })
    await settle()
    expect(limitsBox().element.value).toBe('Mine, half')
  })

  it('can’t be typed in until the saved limits are known, as a cache from before them has none', async () => {
    await openProfile({ cache: { ...PICKS, goals: 'Ten pull-ups by March.' }, offline: true })
    expect(goalsBox().element.disabled).toBe(false)
    expect(limitsBox().element.disabled).toBe(true)
    api.offline = false
    await useSyncStore().refresh()
    await settle()
    expect(limitsBox().element.disabled).toBe(false)
    expect(limitsBox().element.value).toBe('Left knee: no jumping.')
  })

  it('takes limits on a new account, which has nothing saved yet', async () => {
    await openProfile({ saved: null })
    expect(limitsBox().element.disabled).toBe(false)
    await limitsBox().setValue('Vegetarian.')
    await limitsBox().trigger('blur')
    await settle()
    expect(api.accounts.get(USER)!.settings).toEqual({ ...PICKS, goals: '', limits: 'Vegetarian.' })
  })
})

describe('the Profile action and its menu (K106)', () => {
  /** The week, signed in as alice, with the bar in view (Edit plan, K80). */
  async function openWeek(): Promise<void> {
    history.replaceState(null, '', '/')
    api = signedIn({ ...emptyState(), settings: SAVED })
    api.accounts.get(USER)!.settings = SAVED
    const pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
    await settle()
    usePlannerStore().setConfigMode(true)
    await settle()
  }
  function profileButton() {
    return wrapper.get('[data-testid="profile-button"]')
  }
  /** The open menu; Reka renders it in a portal on document.body. */
  function menu(): DOMWrapper<HTMLElement> | null {
    const el = document.querySelector<HTMLElement>('[data-slot="menu"]')
    return el ? new DOMWrapper(el) : null
  }
  function item(name: string): HTMLElement {
    return [...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')].find(
      (el) => el.textContent?.trim() === name,
    )!
  }
  function confirmation(): DOMWrapper<HTMLElement> | null {
    const el = document.querySelector<HTMLElement>('[role="alertdialog"]')
    return el ? new DOMWrapper(el) : null
  }
  function heading(): string {
    return document.querySelector('h1')?.textContent?.trim() ?? ''
  }

  it('ends the bar, named Profile, and opens a menu: who is signed in, Profile and Sign out', async () => {
    await openWeek()
    const actions = wrapper.findAll('[data-slot="bar-action"]')
    expect(actions.at(-1)!.text()).toBe('Profile')
    expect(profileButton().attributes('aria-haspopup')).toBe('menu')
    expect(profileButton().attributes('aria-expanded')).toBe('false')
    await profileButton().trigger('click')
    await settle()
    expect(profileButton().attributes('aria-expanded')).toBe('true')
    expect(menu()!.get('[data-slot="menu-header"]').text()).toBe(`Signed in as${USER}`)
    expect(
      menu()!
        .findAll('[data-slot="menu-item"]')
        .map((i) => i.text()),
    ).toEqual(['Profile', 'Sign out'])
  })

  it('goes to the Profile page from the menu', async () => {
    await openWeek()
    await profileButton().trigger('click')
    await settle()
    item('Profile').click()
    await settle()
    expect(location.hash).toBe('#/profile')
    expect(wrapper.get('[data-testid="profile-page"]').get('h1').text()).toBe('Profile')
  })

  it('signs out from the menu, forgetting the data', async () => {
    await openWeek()
    await profileButton().trigger('click')
    await settle()
    item('Sign out').click()
    await settle()
    expect(heading()).toBe('Sign in')
    expect(api.paths('/auth/logout')).toHaveLength(1)
  })

  it('asks first when changes have not synced, and goes back to the button on Cancel', async () => {
    await openWeek()
    api.offline = true
    usePlannerStore().setGoals('Unsent.')
    await settle()
    api.offline = false
    await profileButton().trigger('click')
    await settle()
    item('Sign out').click()
    await settle()
    expect(confirmation()!.get('h2').text()).toBe('Sign out now?')
    expect(confirmation()!.text()).toContain(
      'One change on this device hasn’t reached the server yet. Signing out now loses them.',
    )
    const cancel = [...confirmation()!.element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!
    cancel.click()
    await settle()
    expect(confirmation()).toBeNull()
    expect(api.paths('/auth/logout')).toEqual([])
    expect(document.activeElement).toBe(profileButton().element)
  })

  it('says why in a question it can try again from, when signing out fails offline', async () => {
    await openWeek()
    api.offline = true
    await profileButton().trigger('click')
    await settle()
    item('Sign out').click()
    await settle()
    expect(confirmation()!.text()).toContain(
      'Signing out needs the server, to end the session there.',
    )
    expect(confirmation()!.get('[role="alert"]').text()).toBe(
      'Can’t reach the server. Check the connection and try again.',
    )
    api.offline = false
    const again = [...confirmation()!.element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Sign out',
    )!
    again.click()
    await settle()
    expect(heading()).toBe('Sign in')
  })
})
