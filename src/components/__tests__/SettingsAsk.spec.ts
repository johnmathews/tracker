import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { usePlannerStore } from '@/stores/planner'
import { useTrackersStore } from '@/stores/trackers'
import type { PortableSettings } from '@/lib/storage'
import type { SettingsTab } from '@/lib/routes'
import type { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, emptyState, signedIn } from '@/lib/__tests__/signedIn'

const NOW = new Date(2026, 10, 1, 9, 0)
const PICKS = { accent: '#30d158', dailyPick: 3, foodPick: 2 }
/** A settings write: the arrangement always goes, `{}` for the default (K66). */
const SENT = { ...PICKS, itemSections: {} }

let wrapper: VueWrapper
let api: FakeApi

async function settle(): Promise<void> {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(0)
  await flushPromises()
}

/**
 * The Settings page on a tab, by its address (K119; Your data unless `tab` says otherwise), signed
 * in as alice. `saved` is what the server holds (null: never saved), and the cache holds it too
 * unless `cache` says otherwise.
 */
async function openSettings({
  saved = { ...PICKS, goals: 'Ten pull-ups by March.' } as PortableSettings | null,
  cache = saved as unknown,
  offline = false,
  tab = 'data' as SettingsTab,
} = {}): Promise<void> {
  history.replaceState(null, '', `/#/settings/${tab}`)
  api = signedIn({ ...emptyState(), settings: cache as PortableSettings | null })
  api.accounts.get(USER)!.settings = saved
  api.offline = offline
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
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

describe('Settings without goals and account (K107)', () => {
  it('has Appearance, Daily goal, Your data and Connections; goals and Sign out are on Profile', async () => {
    await openSettings()
    const page = wrapper.get('[data-testid="settings-page"]')
    expect(page.findAll('[role="tab"]').map((t) => t.text())).toEqual([
      'Appearance',
      'Daily goal',
      'Your data',
      'Connections',
    ])
    for (const tab of ['appearance', 'daily-goal', 'data', 'connections'] as const) {
      await page.get(`[data-testid="settings-tab-${tab}"]`).trigger('mousedown')
      await settle()
      expect(page.find('[data-testid="goals"]').exists()).toBe(false)
      expect(page.find('[data-testid="signed-in-as"]').exists()).toBe(false)
      expect(page.findAll('button').some((b) => b.text() === 'Sign out')).toBe(false)
    }
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
    expect(data.settings).toEqual({ ...PICKS, goals: 'Ten pull-ups by March.', limits: '' })
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
    await openSettings({ saved: { ...PICKS, goals: '', limits: '' } })
    await choose({ ...EMPTY, settings: { ...PICKS, dailyPick: 5, goals: 'Run 5 km.' } })
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds zero weekly plans and zero marked days, plus your goals. Existing plans and marks stay as they are.',
    )
    await button('Import').trigger('click')
    await settle()
    expect(api.accounts.get(USER)!.settings).toEqual({ ...PICKS, goals: 'Run 5 km.', limits: '' })
    expect(usePlannerStore().goals).toBe('Run 5 km.')
  })

  it('counts limits that fill empty ones as a change, names them, and imports them (K107)', async () => {
    await openSettings({ saved: { ...PICKS, goals: '', limits: '' } })
    await choose({ ...EMPTY, settings: { ...PICKS, goals: 'Run 5 km.', limits: 'Vegetarian.' } })
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds zero weekly plans and zero marked days, plus your goals and your limits. Existing plans and marks stay as they are.',
    )
    await button('Import').trigger('click')
    await settle()
    expect(usePlannerStore().limits).toBe('Vegetarian.')
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

describe('Daily goal in Settings (K85)', () => {
  const dailyGoal = () => wrapper.get('[data-testid="daily-goal"]')
  async function toWeek(): Promise<void> {
    location.hash = '#/'
    await settle()
  }
  /** Marks Monday for the first `n` exercises, enough to reach a daily pick of `n`. */
  async function markMonday(n: number): Promise<void> {
    const cells = wrapper.findAll('[data-testid="exercise-grid"] [data-slot="day-mark-button"]')
    for (let i = 0; i < n; i++) await cells[i * 7]!.trigger('click')
  }
  const monday = () =>
    wrapper.get('[data-testid="exercise-grid"]').findAll('[data-testid="day-head"]')[0]!

  it('is a section of its own, on by default, with what it does (K107)', async () => {
    await openSettings({ tab: 'daily-goal' })
    const section = wrapper
      .findAll('[data-testid="settings-page"] section')
      .find((s) => s.get('h2').text() === 'Daily goal')!
    expect(section.get('[data-slot="switch"]').element).toBe(dailyGoal().element)
    expect(dailyGoal().text()).toBe('Daily goal')
    expect(dailyGoal().attributes('aria-checked')).toBe('true')
    const hint = document.getElementById(dailyGoal().attributes('aria-describedby')!)!
    expect(hint.textContent).toContain('set in Edit plan. A day that reaches it turns green.')
    // Unknown until the server says or the person sets it: nothing is sent for it (K85).
    expect(usePlannerStore().dailyGoalKnown).toBe(false)
  })

  it('turned off, saves with the account, hides the steppers and every met day, keeping the numbers', async () => {
    await openSettings({ tab: 'daily-goal' })
    await dailyGoal().trigger('click')
    await settle()
    expect(dailyGoal().attributes('aria-checked')).toBe('false')
    expect(puts()).toEqual([{ ...SENT, dailyGoal: false, goals: 'Ten pull-ups by March.' }])
    expect(api.accounts.get(USER)!.settings!.dailyGoal).toBe(false)
    await toWeek()
    await markMonday(3)
    expect(monday().attributes('data-met')).toBeUndefined()
    // Food too: two foods on Monday reach foods a day (2), and still no day is met.
    const foods = wrapper.findAll('[data-testid="diet-grid"] [data-slot="day-mark-button"]')
    await foods[0]!.trigger('click')
    await foods[7]!.trigger('click')
    const foodMonday = wrapper
      .get('[data-testid="diet-grid"]')
      .findAll('[data-testid="day-head"]')[0]!
    expect(foodMonday.attributes('data-met')).toBeUndefined()
    usePlannerStore().setDailyGoal(true)
    await settle()
    expect(foodMonday.attributes('data-met')).toBe('true')
    usePlannerStore().setDailyGoal(false)
    await settle()
    usePlannerStore().setConfigMode(true)
    await settle()
    expect(wrapper.find('[data-testid="exercise-a-day"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="diet-a-day"]').exists()).toBe(false)
    // Back on: the same numbers, and Monday is met.
    usePlannerStore().setConfigMode(false)
    usePlannerStore().setDailyGoal(true)
    await settle()
    expect(monday().attributes('data-met')).toBe('true')
    usePlannerStore().setConfigMode(true)
    await settle()
    expect(wrapper.find('[data-testid="exercise-a-day"]').exists()).toBe(true)
    expect(useTrackersStore().dailyTarget('exercise')).toBe(3)
  })

  it('reads an off from the account, and sends it with its next settings write', async () => {
    await openSettings({
      saved: { ...PICKS, dailyGoal: false, goals: '', limits: '' },
      tab: 'daily-goal',
    })
    expect(dailyGoal().attributes('aria-checked')).toBe('false')
    await toWeek()
    await markMonday(3)
    expect(monday().attributes('data-met')).toBeUndefined()
    usePlannerStore().setGoals('Run 5 km.')
    await settle()
    expect(puts().at(-1)).toEqual({
      ...SENT,
      dailyGoal: false,
      goals: 'Run 5 km.',
      limits: '',
    })
  })
})

describe('Week title in Settings (K131, K132)', () => {
  const control = () => wrapper.get('[data-testid="week-title-control"]')
  const segment = (name: string) =>
    control()
      .findAll('button')
      .find((b) => b.text() === name)!
  const band = () => wrapper.get('[data-slot="week-band"]')
  const bandButton = () => wrapper.find('[data-testid="band-this-week-button"]')
  async function toWeek(): Promise<void> {
    location.hash = '#/'
    await settle()
  }

  it('comes first in Appearance, Date or Week number, Date chosen and nothing sent', async () => {
    await openSettings({ tab: 'appearance' })
    // Week title, then Marks, then Theme (K136).
    const text = control().element.closest('section')!.textContent!
    const at = (label: string): number => text.indexOf(label)
    expect(at('Week title')).toBeGreaterThan(-1)
    expect(at('Week title')).toBeLessThan(at('Marks'))
    expect(at('Marks')).toBeLessThan(at('Theme'))
    expect(
      control()
        .findAll('button')
        .map((b) => b.text()),
    ).toEqual(['Date', 'Week number'])
    expect(segment('Date').attributes('aria-pressed')).toBe('true')
    expect(segment('Week number').attributes('aria-pressed')).toBe('false')
    // Unknown until the server says or the person picks: nothing is sent for it (K132).
    expect(usePlannerStore().weekTitleKnown).toBe(false)
    expect(puts()).toEqual([])
  })

  it('picked, saves with the account and titles the bar and the band by the number', async () => {
    await openSettings({ tab: 'appearance' })
    await segment('Week number').trigger('click')
    await settle()
    expect(segment('Week number').attributes('aria-pressed')).toBe('true')
    expect(puts()).toEqual([{ ...SENT, weekTitle: 'number', goals: 'Ten pull-ups by March.' }])
    expect(api.accounts.get(USER)!.settings!.weekTitle).toBe('number')
    await toWeek()
    // The number for the eye; a screen reader hears the dates after it.
    const h1 = band().get('h1')
    expect(h1.text()).toBe('Week 44, 26 Oct – 1 Nov')
    expect(h1.get('.sr-only').text()).toBe(', 26 Oct – 1 Nov')
    expect(wrapper.get('[data-testid="week-label"]').text()).toBe('Week 44, 26 Oct – 1 Nov')
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(h1.text()).toBe('Week 43, 19–25 October')
  })

  it('reads the number from the account', async () => {
    await openSettings({
      saved: { ...PICKS, weekTitle: 'number', goals: '', limits: '' },
      tab: 'appearance',
    })
    expect(segment('Week number').attributes('aria-pressed')).toBe('true')
    await toWeek()
    expect(band().get('h1').text()).toBe('Week 44, 26 Oct – 1 Nov')
    usePlannerStore().setGoals('Run 5 km.')
    await settle()
    expect(puts().at(-1)).toEqual({ ...SENT, weekTitle: 'number', goals: 'Run 5 km.', limits: '' })
  })

  it('puts "View current week" after the band’s title on another week, in the week view only (K130)', async () => {
    await openSettings({ tab: 'appearance' })
    await toWeek()
    expect(bandButton().exists()).toBe(false)
    await wrapper.get('button[aria-label="Next week"]').trigger('click')
    expect(bandButton().text()).toBe('View current week')
    expect(band().element.lastElementChild).toBe(bandButton().element)
    // Edit plan has the bar's own; the band there is for a screen reader only.
    usePlannerStore().setConfigMode(true)
    await settle()
    expect(bandButton().exists()).toBe(false)
    usePlannerStore().setConfigMode(false)
    await settle()
    await bandButton().trigger('click')
    expect(band().get('h1').text()).toBe('26 Oct – 1 Nov')
    expect(bandButton().exists()).toBe(false)
  })
})
