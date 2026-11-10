import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { usePlannerStore } from '@/stores/planner'
import { useDietStore } from '@/stores/diet'
import { SESSION_KEY, useSessionStore } from '@/stores/session'
import { CACHE_PREFIX, type SyncState } from '@/stores/sync'
import { DRAWINGS, MARKS, markDrawing, markKind, type PortableSettings } from '@/lib/storage'
import { readFixture } from '@/lib/__tests__/fixtures'
import type { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, cached, emptyState, signedIn } from '@/lib/__tests__/signedIn'

/** A row's week as the stores hold it, "N of M": the grid shows no total since K33. */
function exTotal(i: number): string {
  const store = usePlannerStore()
  const e = store.exercises.at(i)!
  return `${store.totalFor(e.id)} of ${e.target}`
}
function foodTotal(i: number): string {
  const store = useDietStore()
  const f = store.foods.at(i)!
  return `${store.totalFor(f.id)} of ${f.target}`
}

const NOW = new Date(2026, 9, 23, 18, 0)

let wrapper: VueWrapper
let api: FakeApi

afterEach(() => {
  vi.unstubAllGlobals()
  // The Settings page lives at #/settings; each test starts on the week.
  history.replaceState(null, '', '/')
})

/** Mount the app signed in as alice, with `cache` as her data on this device. */
function mountApp(cache?: SyncState): VueWrapper {
  api = signedIn(cache)
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

/** Mount with config mode on, where the plan-editing controls are. */
async function mountConfig(): Promise<VueWrapper> {
  mountApp()
  await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
  return wrapper
}

/** The exercise grid only; the diet grid below reuses the same markup. */
function ex() {
  return wrapper.get('[data-testid="exercise-grid"]')
}
function diet() {
  return wrapper.get('[data-testid="diet-grid"]')
}

function rowCells(name: string) {
  return wrapper.findAll(`button[aria-label^="${name},"]`)
}

/** Lets Reka's queued work (focus-outside checks, presence, nextTick chains) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The open ConfirmDialog, by role; Reka renders it in a portal on document.body. */
function confirmation(): DOMWrapper<HTMLElement> | null {
  const el = document.querySelector<HTMLElement>('[role="alertdialog"]')
  return el ? new DOMWrapper(el) : null
}

/** Answer the open ConfirmDialog with the button of this name ("Cancel", "Remove"…). */
async function answer(name: string): Promise<void> {
  await confirmation()!
    .findAll('button')
    .find((b) => b.text() === name)!
    .trigger('click')
  await settle()
}

/** The Settings IconButton in the Header, and opening the popover from it. */
function settingsButton() {
  return wrapper.get('[data-testid="settings-button"]')
}
/** Back from the Settings page to the week, as its link goes. */
async function backToWeek(): Promise<void> {
  location.hash = '#/'
  await settle()
}

/** Opens the Settings page from the bar, coming back to the week first if it is already open. */
async function openSettings(): Promise<void> {
  if (location.hash === '#/settings') await backToWeek()
  await settingsButton().trigger('click')
  await settle()
}

/** The Settings page (#/settings). */
const PANEL = '[data-testid="settings-page"]'

/**
 * Saves settings without changing them, as one more exercise a day and then one fewer in Edit plan
 * would. Through the store, so a page that is open (Settings, with an import waiting) stays open.
 */
async function saveSettings(): Promise<void> {
  // A tick apart, as two presses are: the sync store sees the change, not just its net result.
  usePlannerStore().changeDailyPick(1)
  await nextTick()
  usePlannerStore().changeDailyPick(-1)
  await nextTick()
}

/** A daily target as Edit plan's Stepper on its section's title line shows it (K56). */
function target(testid: 'exercises-a-day' | 'foods-a-day'): string | undefined {
  return wrapper.get(`[data-testid="${testid}"] [role="spinbutton"]`).attributes('aria-valuenow')
}

/** Opens the new item page from the Add button under a grid (K104). */
async function openAdd(kind: 'exercise' | 'food' = 'exercise') {
  await wrapper.get(`[data-testid="add-${kind}"]`).trigger('click')
  await settle()
  return wrapper.get('[data-testid="new-item-page"]')
}

/** Adds the item on the new item page, as its Add button would, and goes back to the week. */
async function submit(page: Omit<DOMWrapper<Element>, 'exists'>): Promise<void> {
  await page.get('form').trigger('submit')
  await settle()
}

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the week label, the default rows and the reps chips', () => {
    mountApp()
    expect(wrapper.find('h1').text()).toBe('19–25 October')
    expect(
      ex()
        .findAll('[data-testid="item-name"]')
        .map((n) => n.text()),
    ).toEqual(['Push-ups', 'Pull-ups', 'Squats', 'Back extensions', 'Kettlebell halos'])
    const chips = wrapper.findAll('[data-testid="item-detail"]').map((c) => c.text())
    expect(chips[0]).toBe('10 reps a set')
    expect(chips[4]).toBe('8 each side')
  })

  it('marks today’s column in the header and the cells', () => {
    mountApp()
    const heads = ex().findAll('[data-testid="day-head"]')
    expect(heads.map((h) => h.attributes('data-today') === 'true')).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ])
    expect(rowCells('Squats')[4]!.element.parentElement!.getAttribute('data-today')).toBe('true')
  })

  it('steps a cell through its marks with aria-pressed, every mark counting in the totals', async () => {
    mountApp()
    const cell = rowCells('Push-ups')[1]!
    expect(cell.attributes('aria-pressed')).toBe('false')
    for (const mark of MARKS) {
      await cell.trigger('click')
      expect(cell.attributes('aria-pressed')).toBe('true')
      expect(cell.find(`[data-mark="${markKind(mark)}"]`).exists()).toBe(true)
      expect(cell.find(`[data-drawing="${markDrawing(mark)}"]`).exists()).toBe(true)
      expect(exTotal(0)).toBe('1 of 4')
    }
    await cell.trigger('click')
    expect(cell.attributes('aria-pressed')).toBe('false')
    expect(exTotal(0)).toBe('0 of 4')
  })

  it('marks a food eaten in each drawing, then clears it', async () => {
    mountApp()
    const cell = rowCells('Fish')[0]!
    for (const drawing of DRAWINGS) {
      await cell.trigger('click')
      expect(cell.find('[data-mark="great"]').exists()).toBe(true)
      expect(cell.find(`[data-drawing="${drawing}"]`).exists()).toBe(true)
    }
    await cell.trigger('click')
    expect(cell.attributes('aria-pressed')).toBe('false')
  })

  it('reaches a food’s goal once it is set lower on its page', async () => {
    await mountConfig()
    await rowCells('Nuts')[0]!.trigger('click')
    expect(foodTotal(3)).toBe('1 of 3')
    location.hash = '#/item/diet/nuts'
    await settle()
    const fewer = wrapper
      .get('[data-testid="item-page"]')
      .get('button[aria-label="Fewer times a week"]')
    await fewer.trigger('click')
    await fewer.trigger('click')
    await backToWeek()
    expect(foodTotal(3)).toBe('1 of 1')
  })

  it('gives Edit plan rows no Stepper and no Edit button: the name opens the page (K104)', async () => {
    await mountConfig()
    expect(wrapper.find('[data-testid="exercise-grid"] [role="spinbutton"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="diet-grid"] [role="spinbutton"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Edit "]').exists()).toBe(false)
  })

  it('draws the marks in the set chosen in Settings, and the device remembers it', async () => {
    mountApp()
    const cell = () => rowCells('Squats')[0]!
    await cell().trigger('click')
    expect(cell().find('[data-slot="day-mark-stroke"]').attributes('data-drawing')).toBe('zigzag')
    await openSettings()
    const marks = wrapper.get(PANEL).get('[role="radiogroup"]')
    const rows = marks.findAll('[role="radio"]')
    expect(rows.map((r) => r.text())).toEqual([
      'Squiggles',
      'Ticks',
      'Stamped ticks',
      'Faces',
      'Stamped faces',
    ])
    expect(rows.map((r) => r.attributes('aria-checked'))[0]).toBe('true')
    // Each row shows its set's three marks, as pictures rather than buttons.
    expect(rows[3]!.findAll('[data-testid="mark-set-sample"]')).toHaveLength(3)
    expect(rows[3]!.find('button').exists()).toBe(false)
    await rows[3]!.trigger('click')
    expect(JSON.parse(localStorage.getItem('tracker-settings-v1')!)).toMatchObject({
      markSet: 'faces',
    })
    await backToWeek()
    expect(cell().get('[data-slot="day-mark-symbol"]').attributes('data-set')).toBe('faces')
    // The stored mark is unchanged; a press steps the kinds once (K21).
    expect(cell().attributes('aria-label')).not.toContain('partly done')
    await cell().trigger('click')
    expect(cell().attributes('aria-label')).toContain('partly done')
  })

  it('navigates weeks and returns to this week', async () => {
    mountApp()
    const thisWeek = () => wrapper.findAll('button').find((b) => b.text() === 'This week')
    // "This week" shows only while another week is on screen (Header card).
    expect(thisWeek()).toBeUndefined()
    expect(wrapper.get('[data-testid="week-label"]').text()).toBe('19–25 October')
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(wrapper.find('h1').text()).toBe('12–18 October')
    expect(wrapper.get('[data-testid="week-label"]').text()).toBe('12–18 October')
    await wrapper.get('button[aria-label="Next week"]').trigger('click')
    await wrapper.get('button[aria-label="Next week"]').trigger('click')
    expect(wrapper.find('h1').text()).toBe('26 Oct – 1 Nov')
    expect(wrapper.get('[data-testid="week-label"]').text()).toBe('26 Oct – 1 Nov')
    await thisWeek()!.trigger('click')
    expect(wrapper.find('h1').text()).toBe('19–25 October')
    expect(thisWeek()).toBeUndefined()
  })

  it('removes an exercise only after confirmation', async () => {
    await mountConfig()
    const remove = wrapper.get('button[aria-label="Remove Squats"]')
    await remove.trigger('click')
    await settle()
    expect(confirmation()!.get('h2').text()).toBe('Remove Squats?')
    expect(confirmation()!.text()).toContain(
      'It comes off this week’s plan. Weeks with their own plan keep it, and its marks stay.',
    )
    await answer('Cancel')
    expect(confirmation()).toBeNull()
    expect(rowCells('Squats')).toHaveLength(7)
    await remove.trigger('click')
    await settle()
    await answer('Remove')
    expect(rowCells('Squats')).toHaveLength(0)
  })

  it('prints via window.print', async () => {
    mountApp()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Print…')!
      .trigger('click')
    expect(print).toHaveBeenCalledOnce()
  })

  it('refreshes today when the tab becomes visible again', () => {
    mountApp()
    const store = usePlannerStore()
    vi.setSystemTime(new Date(2026, 9, 24, 0, 5))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(store.days.findIndex((d) => d.isToday)).toBe(5)
  })

  it('moves today at midnight in a tab that stays visible', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    mountApp()
    const store = usePlannerStore()
    vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 30))
    vi.advanceTimersByTime(60_000)
    expect(store.days.findIndex((d) => d.isToday)).toBe(5)
  })

  it('adopts changes another tab writes to the cache', async () => {
    mountApp()
    const other = emptyState()
    other.exercise.plans = {
      '2026-10-19': [{ id: 'a', name: 'From other tab', reps: 5, target: 2 }],
    }
    other.exercise.log = { '2026-10-19': { a: ['great', null, null, null, null, null, null] } }
    otherTabWrites(other)
    await wrapper.vm.$nextTick()
    expect(
      ex()
        .findAll('[data-testid="item-name"]')
        .map((n) => n.text()),
    ).toEqual(['From other tab'])
    expect(exTotal(0)).toMatch(/^1 of \d+$/)
  })
})

/** Another tab saved `state` to alice's cache. */
function otherTabWrites(state: SyncState): void {
  const key = CACHE_PREFIX + USER
  localStorage.setItem(key, JSON.stringify(state))
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
}

describe('an item’s page (#/item/<section>/<id>, F7)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const PAGE = '[data-testid="item-page"]'
  /** A row's name link, in the exercise or food grid. */
  function nameLink(name: string, grid = ex()) {
    return grid.findAll('[data-testid="item-name"]').find((n) => n.text() === name)!
  }
  /** Press a name, as a person does: the browser follows its link. */
  async function openItem(name: string, grid = ex()): Promise<void> {
    const a = nameLink(name, grid).element as HTMLAnchorElement
    a.focus()
    location.hash = a.getAttribute('href')!
    await settle()
  }
  /** Press "Back to the week". */
  async function back(): Promise<void> {
    await wrapper.get('[data-testid="back-to-week"]').trigger('click')
    await settle()
  }

  it('makes each name a link to its item’s page, in both grids and in Edit plan', async () => {
    mountApp()
    const link = nameLink('Squats')
    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toBe('#/item/exercise/sq')
    expect(nameLink('Fish', diet()).attributes('href')).toBe('#/item/diet/fish')
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    // Edit plan keeps the link, the one way to the page: there is no pencil (K104).
    expect(nameLink('Squats').attributes('href')).toBe('#/item/exercise/sq')
    expect(ex().find('button[aria-label="Edit Squats"]').exists()).toBe(false)
  })

  it('opens as a page with no bar and no planner screens, focus on its name', async () => {
    mountApp()
    expect(document.documentElement.classList.contains('planner-screens')).toBe(true)
    await openItem('Squats')
    expect(location.hash).toBe('#/item/exercise/sq')
    const page = wrapper.get(PAGE)
    expect(page.get('h1').text()).toBe('Squats')
    expect(document.activeElement).toBe(page.get('h1').element)
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="edit-plan-button"]').exists()).toBe(false)
    expect(document.documentElement.classList.contains('planner-screens')).toBe(false)
    expect(wrapper.get('main').classes()).toContain('px-(--screen-pad-x)')
  })

  it('goes back through history to the week, with focus on the item’s name', async () => {
    mountApp()
    const before = history.length
    await openItem('Squats')
    expect(history.length).toBe(before + 1)
    await back()
    expect(wrapper.find(PAGE).exists()).toBe(false)
    expect(history.length).toBe(before + 1)
    expect(location.hash).toBe('')
    expect(document.activeElement).toBe(nameLink('Squats').element)
    // The browser's own Back from a food's page does the same.
    await openItem('Fish', diet())
    history.back()
    await settle()
    expect(document.activeElement).toBe(nameLink('Fish', diet()).element)
  })

  it('opens straight from its address, and Back replaces it with the week', async () => {
    history.replaceState(null, '', '/#/item/exercise/pl')
    mountApp()
    await settle()
    expect(wrapper.get(PAGE).get('h1').text()).toBe('Pull-ups')
    const back = vi.spyOn(history, 'back')
    await wrapper.get('[data-testid="back-to-week"]').trigger('click')
    await settle()
    expect(back).not.toHaveBeenCalled()
    expect(location.hash).toBe('#/')
    expect(document.activeElement).toBe(nameLink('Pull-ups').element)
  })

  it('opens the week for an address that names no item, dropping it', async () => {
    for (const hash of ['#/item/exercise/nope', '#/item/food/sq', '#/item/exercise/%E0%A4%A']) {
      history.replaceState(null, '', `/${hash}`)
      mountApp()
      await settle()
      expect(wrapper.find(PAGE).exists()).toBe(false)
      expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
      expect(location.hash).toBe('')
      wrapper.unmount()
    }
    // Typed into a running tab, too.
    mountApp()
    location.hash = '#/item/diet/nope'
    await settle()
    expect(location.hash).toBe('')
    location.hash = '#/item/nope'
    await settle()
    expect(location.hash).toBe('')
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
  })

  it('opens an old address for an item no longer in the week, with its latest plan', async () => {
    const state = emptyState()
    state.exercise.plans = {
      '2026-10-12': [{ id: 'ks', name: 'Kettlebell swings', reps: 15, target: 3, perSide: false }],
      '2026-10-19': [],
    }
    history.replaceState(null, '', '/#/item/exercise/ks')
    mountApp(state)
    // The server holds the same plans, so its reply keeps them.
    for (const [week, items] of Object.entries(state.exercise.plans))
      api.accounts.get(USER)!.plans.exercise[week] = { items, rev: 1 }
    await settle()
    expect(wrapper.get(PAGE).get('h1').text()).toBe('Kettlebell swings')
    expect(wrapper.get(PAGE).text()).toContain('Latest plan')
  })

  it('waits for the data before saying an item isn’t there', async () => {
    api = signedIn()
    localStorage.removeItem(CACHE_PREFIX + USER)
    history.replaceState(null, '', '/#/item/exercise/sq')
    const pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
    expect(wrapper.find(PAGE).exists()).toBe(false)
    expect(location.hash).toBe('#/item/exercise/sq')
    await flushPromises()
    await settle()
    expect(wrapper.get(PAGE).get('h1').text()).toBe('Squats')
  })

  it('drops the address when signing out on the page', async () => {
    mountApp()
    await openItem('Squats')
    await useSessionStore().logout()
    await flushPromises()
    expect(location.hash).toBe('')
    expect(wrapper.find(PAGE).exists()).toBe(false)
  })

  it('goes back to the week when another tab removes the item from every plan', async () => {
    mountApp()
    await openItem('Squats')
    usePlannerStore().plans = { '2026-10-19': [] }
    await settle()
    expect(location.hash).toBe('')
    expect(wrapper.find(PAGE).exists()).toBe(false)
  })

  it('shows a note typed on the page on every week', async () => {
    mountApp()
    await openItem('Squats')
    await wrapper.get('[data-testid="item-notes-button"]').trigger('click')
    await wrapper.get('textarea').setValue('Knees **out**')
    await back()
    const note = () =>
      ex()
        .findAll('[role="rowheader"]')
        .find((r) => r.text().startsWith('Squats'))!
        .get('[data-testid="item-note"]')
    expect(note().html()).toContain('<strong>out</strong>')
    await wrapper.get('button[aria-label="Next week"]').trigger('click')
    expect(note().text()).toBe('Knees out')
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(note().text()).toBe('Knees out')
  })

  it('shows a field typed on the page from every week’s page', async () => {
    mountApp()
    await openItem('Squats')
    await wrapper.get('input[data-field="equipment"]').setValue('Barbell')
    await back()
    await wrapper.get('button[aria-label="Next week"]').trigger('click')
    await openItem('Squats')
    expect(wrapper.get<HTMLInputElement>('input[data-field="equipment"]').element.value).toBe(
      'Barbell',
    )
    expect(wrapper.get(PAGE).text()).toContain('Plan for the week of 26 October')
  })

  it('shows a plan change in this week’s row', async () => {
    mountApp()
    await openItem('Squats')
    await wrapper.get('input[data-field="sets"]').setValue('4')
    await back()
    const row = ex()
      .findAll('[role="rowheader"]')
      .find((r) => r.text().startsWith('Squats'))!
    expect(row.findAll('[data-testid="item-detail"]').map((c) => c.text())).toEqual(['4 × 15'])
  })
})

describe('the Settings page', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => wrapper?.unmount())

  it('opens as a page and goes back to the week', async () => {
    mountApp()
    expect(wrapper.find(PANEL).exists()).toBe(false)
    await openSettings()
    expect(location.hash).toBe('#/settings')
    const heading = wrapper.get(PANEL).get('h1')
    expect(heading.text()).toBe('Settings')
    expect(document.activeElement).toBe(heading.element)
    expect(
      wrapper
        .get(PANEL)
        .findAll('h2')
        .map((h) => h.text()),
    ).toEqual(['Appearance', 'Your goals', 'Your data', 'Connections', 'Account'])
    // Marks, then Theme (K59); the daily targets are set in Edit plan (K56).
    expect(
      wrapper
        .get(PANEL)
        .findAll('[data-slot="radio-card-label"], [data-slot="segmented-control-label"]')
        .map((l) => l.text()),
    ).toEqual(['Marks', 'Theme'])
    expect(wrapper.get(PANEL).find('[data-slot="stepper"]').exists()).toBe(false)
    // The week is off screen, and the bar holds only the wordmark.
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(false)
    expect(wrapper.find('nav[aria-label="Week"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="edit-plan-button"]').exists()).toBe(false)
    // The marks' pens are fixed, so there is no ink to choose.
    expect(wrapper.get(PANEL).find('[role="radiogroup"][aria-label="Ink"]').exists()).toBe(false)
    expect(wrapper.get(PANEL).text()).not.toContain('Ink')

    expect(wrapper.get(PANEL).get('a[href="#/"]').text()).toBe('Back to the week')
    await backToWeek()
    expect(wrapper.find(PANEL).exists()).toBe(false)
    expect(document.activeElement).toBe(settingsButton().element)
  })

  it('opens straight from a #/settings address', async () => {
    history.replaceState(null, '', '/#/settings')
    mountApp()
    await settle()
    expect(wrapper.get(PANEL).get('h1').text()).toBe('Settings')
  })

  /** Mount with these settings saved on the server as well as cached, so loading keeps them. */
  function mountWithSettings(settings: PortableSettings): void {
    api = signedIn({ ...emptyState(), settings })
    api.accounts.get(USER)!.settings = settings
    const pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  }

  it('keeps a saved accent as it is, though nothing shows it any more', async () => {
    mountWithSettings({ accent: '#ff9f0a', dailyPick: 3, foodPick: 2, goals: '' })
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    await wrapper.get('button[aria-label="More exercises a day"]').trigger('click')
    await settle()
    expect(usePlannerStore().accent).toBe('#ff9f0a')
    expect(api.accounts.get(USER)!.settings).toEqual({
      accent: '#ff9f0a',
      dailyPick: 4,
      foodPick: 2,
      goals: '',
    })
    expect(document.documentElement.style.getPropertyValue('--user-pen-light')).toBe('')
  })
})

describe('the connect link (#/connect/<id>), a link route', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => wrapper?.unmount())

  /** As a link opened in a running tab: one hashchange. */
  async function go(hash: string): Promise<void> {
    history.replaceState(null, '', `/${hash}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await settle()
  }

  it('shows the consent screen over the week while signed in, and leads back to it', async () => {
    mountApp()
    api.addRequest('req1')
    await settle()
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
    await go('#/connect/req1')
    expect(wrapper.get('h1').text()).toBe('Connect Claude')
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-slot="bar"]').exists()).toBe(false)
    expect(document.documentElement.classList.contains('planner-screens')).toBe(false)
    await go('#/connect/used')
    expect(wrapper.get('h1').text()).toBe('This link has expired')
    await wrapper
      .findAll('a')
      .find((a) => a.text() === 'Go to the week')!
      .trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
  })

  it('takes only an id the API could have made', async () => {
    mountApp()
    await go('#/connect/a%20b')
    expect(wrapper.find('[data-testid="connect-page"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
  })
})

describe('export and import', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const EXPORT = {
    format: 'fitness-planner-export',
    version: 1,
    exercise: {
      plans: {
        '2026-10-12': [{ id: 'sq', name: 'Squats', reps: 15, target: 4 }],
        '2026-10-19': [{ id: 'sq', name: 'Squats', reps: 15, target: 4 }],
      },
      // A version 1 file, as an export from before marks had kinds: a done day is `true`.
      log: { '2026-10-19': { sq: [true, true, false, false, false, false, false] } },
    },
    diet: {
      plans: { '2026-10-19': [{ id: 'eggs', name: 'Eggs', target: 2 }] },
      log: { '2026-10-19': { eggs: [false, false, true, false, false, false, false] } },
    },
    settings: { accent: '#bf5af2', dailyPick: 2, foodPick: 4 },
  }

  function button(name: string) {
    return wrapper.findAll('button').find((b) => b.text() === name)!
  }

  /** jsdom cannot open a file picker; hand the input a file and fire `change`. */
  async function choose(file: File): Promise<void> {
    const input = wrapper.get('[data-testid="import-file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  function jsonFile(data: unknown): File {
    return new File([JSON.stringify(data)], 'export.json', { type: 'application/json' })
  }

  it('exports the plans, ticks and settings as a dated JSON file', async () => {
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn<(b: Blob) => string>((b) => {
      blob = b
      return 'blob:x'
    })
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mountApp()
    await rowCells('Squats')[2]!.trigger('click')
    await rowCells('Squats')[3]!.trigger('click')
    await rowCells('Squats')[3]!.trigger('click')
    await openSettings()
    await button('Export').trigger('click')
    // Export reads Ask's conversations from the server first.
    await flushPromises()
    expect(click).toHaveBeenCalledOnce()
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('tracker-2026-10-23.json')
    const file = JSON.parse(await blob!.text())
    expect(file).toMatchObject({
      format: 'tracker-export',
      version: 5,
      settings: { accent: '#30d158', dailyPick: 3, foodPick: 2 },
    })
    expect(file.settings).not.toHaveProperty('theme')
    expect(file.exercise.log['2026-10-19'].sq).toEqual([
      null,
      null,
      'great',
      'partial',
      null,
      null,
      null,
    ])
    expect(file.diet).toEqual({ plans: {}, log: {}, details: {} })
  })

  it('exports the item pages’ arrangement with the settings (K66)', async () => {
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn<(b: Blob) => string>((b) => {
      blob = b
      return 'blob:x'
    })
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mountApp()
    const arranged = { order: ['history', 'notes', 'details', 'plan'], hidden: ['details'] }
    usePlannerStore().setArrangement('exercise', {
      order: ['history', 'notes', 'details', 'plan'],
      hidden: ['details'],
    })
    await openSettings()
    await button('Export').trigger('click')
    // Export reads the server's export for Ask's history first.
    await flushPromises()
    const file = JSON.parse(await blob!.text())
    expect(file.settings).toEqual({
      accent: '#30d158',
      dailyPick: 3,
      foodPick: 2,
      goals: '',
      itemSections: { exercise: arranged },
    })
  })

  it('opens the file picker from Import…', async () => {
    mountApp()
    await openSettings()
    const picker = vi.spyOn(
      wrapper.get('[data-testid="import-file"]').element as HTMLInputElement,
      'click',
    )
    await button('Import…').trigger('click')
    expect(picker).toHaveBeenCalledOnce()
  })

  it('summarises what a file adds, then merges it on Import', async () => {
    mountApp()
    await rowCells('Push-ups')[4]!.trigger('click')
    await openSettings()
    await saveSettings()
    await choose(jsonFile(EXPORT))
    // The tick gave this week its own plan, so only last week's exercise plan and this week's food
    // plan are new. Settings are saved here, so the file's accent and daily pick don't apply.
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds two weekly plans and three marked days. Existing plans and marks stay as they are.',
    )
    expect(usePlannerStore().isDone('sq', 0)).toBe(false)

    await button('Import').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('Imported.')
    expect(wrapper.find('[data-testid="import-summary"]').exists()).toBe(false)
    await backToWeek()
    expect(rowCells('Squats')[0]!.attributes('aria-pressed')).toBe('true')
    expect(rowCells('Push-ups')[4]!.attributes('aria-pressed')).toBe('true')
    expect(rowCells('Eggs')[2]!.attributes('aria-pressed')).toBe('true')
    expect(usePlannerStore().dailyPick).toBe(3)
  })

  it('applies the file’s settings when this browser has none saved', async () => {
    mountApp()
    await openSettings()
    await choose(jsonFile(EXPORT))
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds three weekly plans and three marked days, plus the exercises and foods a day. Existing plans and marks stay as they are.',
    )
    await button('Import').trigger('click')
    await flushPromises()
    expect(usePlannerStore().accent).toBe(EXPORT.settings.accent)
    await backToWeek()
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(target('exercises-a-day')).toBe('2')
    expect(target('foods-a-day')).toBe('4')
  })

  it('uses the singular for one plan and one tick', async () => {
    mountApp()
    await openSettings()
    await saveSettings()
    await choose(
      jsonFile({
        format: 'fitness-planner-export',
        version: 1,
        exercise: {
          plans: { '2026-10-12': [] },
          // A version 1 file: a done day is `true`.
          log: { '2026-10-19': { pu: [true, false, false, false, false, false, false] } },
        },
      }),
    )
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds one weekly plan and one marked day. Existing plans and marks stay as they are.',
    )
  })

  it('keeps the summary true when settings change while it is open', async () => {
    mountApp()
    await openSettings()
    await choose(jsonFile(EXPORT))
    expect(wrapper.get('[data-testid="import-summary"]').text()).toContain('plus the exercises')
    await saveSettings()
    expect(wrapper.get('[data-testid="import-summary"]').text()).not.toContain('plus the exercises')
    await button('Import').trigger('click')
    await flushPromises()
    expect(usePlannerStore().dailyPick).toBe(3)
  })

  it('says so, and keeps the file, when the server cannot be reached', async () => {
    mountApp()
    await openSettings()
    await choose(jsonFile(EXPORT))
    api.offline = true
    await button('Import').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Can’t reach the server, so nothing was imported. Try again when you’re online.',
    )
    expect(wrapper.find('[data-testid="import-summary"]').exists()).toBe(true)
    api.offline = false
    const before = api.paths('POST /import').length // the attempt made while offline
    const release = api.hold()
    await button('Import').trigger('click')
    await button('Import').trigger('click') // a second press while the first is under way
    release()
    await flushPromises()
    expect(api.paths('POST /import')).toHaveLength(before + 1)
    expect(wrapper.get('[role="status"]').text()).toBe('Imported.')
  })

  it('says when the account is full', async () => {
    mountApp()
    await openSettings()
    await choose(jsonFile(EXPORT))
    api.failNext('POST', '/import', 413, { error: 'quota' })
    await button('Import').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Your account is full, so nothing was imported.',
    )
  })

  it('discards the file on Cancel', async () => {
    mountApp()
    await openSettings()
    await choose(jsonFile(EXPORT))
    await button('Cancel').trigger('click')
    expect(wrapper.find('[data-testid="import-summary"]').exists()).toBe(false)
    await backToWeek()
    expect(rowCells('Squats')[0]!.attributes('aria-pressed')).toBe('false')
    expect(localStorage.getItem('tracker-v2')).toBeNull()
  })

  it('says so when the file adds nothing', async () => {
    mountApp()
    await openSettings()
    await choose(jsonFile({ format: 'fitness-planner-export', version: 1 }))
    expect(wrapper.get('[role="status"]').text()).toBe(
      'Nothing new: everything in that file is already here.',
    )
    expect(wrapper.find('[data-testid="import-summary"]').exists()).toBe(false)
  })

  it.each([
    ['not JSON', new File(['{oops'], 'x.json'), 'That file isn’t valid JSON.'],
    ['another format', jsonFile({ plans: {} }), 'That file isn’t a Tracker export.'],
    [
      'a newer version',
      jsonFile({ format: 'fitness-planner-export', version: 6 }),
      'That export comes from a newer version of the app.',
    ],
  ])('rejects %s with an inline error and changes nothing', async (_, file, message) => {
    mountApp()
    await flushPromises()
    const before = { ...localStorage }
    await openSettings()
    await choose(file)
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe(message)
    expect(alert.attributes('data-tone')).toBe('error')
    expect({ ...localStorage }).toEqual(before)
  })

  it('reports a file that cannot be read', async () => {
    mountApp()
    await openSettings()
    const file = jsonFile(EXPORT)
    vi.spyOn(file, 'text').mockRejectedValue(new Error('gone'))
    await choose(file)
    expect(wrapper.get('[role="alert"]').text()).toBe('That file couldn’t be read.')
  })

  it('ignores a change with no file, and clears the outcome when reopened', async () => {
    mountApp()
    await openSettings()
    await wrapper.get('[data-testid="import-file"]').trigger('change')
    await flushPromises()
    expect(wrapper.find('[role="alert"], [role="status"]').exists()).toBe(false)
    await choose(new File(['{oops'], 'x.json'))
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await openSettings()
    await openSettings()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('export and import with the sample data', () => {
  // Four weeks of edited plans, ticks and diet over a five-week span, two items' details, plus
  // non-default settings (fixtures/transfer/sample/). The storage is alice's cache as the sync
  // store keeps it, under the current key: a new cache format needs a new sample.
  const storage = readFixture<Record<string, unknown>>('sample/storage.json')
  const sample = readFixture<Record<string, unknown>>('sample/export.json')

  const cache = storage[CACHE_PREFIX + USER] as SyncState
  const { revs: _er, detailRevs: _ed, ...exercise } = cache.exercise
  const { revs: _cr, detailRevs: _cd, ...cardio } = cache.cardio
  const { revs: _dr, detailRevs: _dd, ...diet } = cache.diet
  const { accent, dailyPick, foodPick } = cache.settings as PortableSettings
  // The cache and the file carry the same goals.
  const { goals } = sample.settings as PortableSettings

  /** The sample as alice's cache, a fresh copy each time. */
  function sampleCache(): SyncState {
    return JSON.parse(JSON.stringify(cache)) as SyncState
  }

  it('holds the cache under the current key', () => {
    expect(
      cache,
      `fixtures/transfer/sample/storage.json needs ${CACHE_PREFIX}${USER}`,
    ).toBeDefined()
  })

  function button(name: string) {
    return wrapper.findAll('button').find((b) => b.text() === name)!
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('exports the sample storage as the sample export file', async () => {
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn<(b: Blob) => string>((b) => {
      blob = b
      return 'blob:sample'
    })
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    api = signedIn(sampleCache())
    api.stall('GET', '/state') // show the cache, as the browser does before the server answers
    const pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
    // The seeded week shows its edited plan, so the app really loaded the sample.
    expect(
      ex()
        .findAll('[data-testid="item-name"]')
        .map((n) => n.text()),
    ).toEqual(['Push-ups', 'Pull-ups', 'Squats', 'Kettlebell halos', 'Plank'])
    await openSettings()
    await button('Export').trigger('click')
    // The account has no Ask conversations, so the file is the sample as it was.
    await flushPromises()
    expect(JSON.parse(await blob!.text())).toEqual({ ...sample, exportedAt: NOW.toISOString() })
  })

  it('imports the sample export into an empty account and syncs all of it', async () => {
    mountApp()
    await flushPromises()
    await openSettings()
    const input = wrapper.get('[data-testid="import-file"]')
    const file = new File([JSON.stringify(sample)], 'sample.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.get('[data-testid="import-summary"]').text()).toBe(
      'Adds seven weekly plans and 108 marked days, plus the notes and details of three items, the exercises and foods a day and your goals. Existing plans and marks stay as they are.',
    )
    await button('Import').trigger('click')
    await flushPromises()
    const { revs: _e, detailRevs: _ed, ...cachedExercise } = cached().exercise
    const { revs: _c, detailRevs: _cd, ...cachedCardio } = cached().cardio
    const { revs: _d, detailRevs: _dd, ...cachedDiet } = cached().diet
    expect(cachedExercise).toEqual(exercise)
    expect(cachedCardio).toEqual(cardio)
    expect(cachedDiet).toEqual(diet)
    expect(cached().settings).toEqual({ accent, dailyPick, foodPick, goals })
    // Every plan, tick and item's details reached the server too.
    const server = api.state(USER) as SyncState
    const { plans, log, details } = server.exercise
    expect({ plans, log, details }).toEqual(exercise)
    expect({
      plans: server.cardio.plans,
      log: server.cardio.log,
      details: server.cardio.details,
    }).toEqual(cardio)
    expect({
      plans: server.diet.plans,
      log: server.diet.log,
      details: server.diet.details,
    }).toEqual(diet)
    expect(server.settings).toEqual({ accent, dailyPick, foodPick, goals })
    // The theme is per device, so it never left this browser.
    expect(localStorage.getItem('tracker-settings-v1')).toBeNull()
  })
})

describe('theme', () => {
  let listeners: ((ev: MediaQueryListEvent) => void)[]

  /** jsdom has no matchMedia, so stand in for the OS colour-scheme query. */
  function fakeColorScheme(dark: boolean): void {
    listeners = []
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: dark,
      media: query,
      addEventListener: (_: string, fn: (ev: MediaQueryListEvent) => void) => listeners.push(fn),
      removeEventListener: (_: string, fn: (ev: MediaQueryListEvent) => void) =>
        (listeners = listeners.filter((l) => l !== fn)),
    }))
  }

  function isDarkClass(): boolean {
    return document.documentElement.classList.contains('dark')
  }

  beforeEach(() => localStorage.clear())
  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    document.documentElement.classList.remove('dark')
  })

  it('follows the OS setting by default, including later changes', async () => {
    fakeColorScheme(true)
    mountApp()
    expect(isDarkClass()).toBe(true)
    listeners.forEach((fn) => fn({ matches: false } as MediaQueryListEvent))
    await wrapper.vm.$nextTick()
    expect(isDarkClass()).toBe(false)
    wrapper.unmount()
    expect(listeners).toHaveLength(0)
  })

  it('switches theme from the settings panel and remembers it', async () => {
    fakeColorScheme(false)
    mountApp()
    expect(isDarkClass()).toBe(false)
    await openSettings()
    const themeButton = (name: string) =>
      wrapper
        .get(PANEL)
        .findAll('[role="group"] button[aria-pressed]')
        .find((b) => b.text() === name)!

    expect(themeButton('System').attributes('aria-pressed')).toBe('true')
    await themeButton('Dark').trigger('click')
    expect(isDarkClass()).toBe(true)
    expect(themeButton('Dark').attributes('aria-pressed')).toBe('true')
    expect(JSON.parse(localStorage.getItem('tracker-settings-v1')!).theme).toBe('dark')

    await themeButton('Light').trigger('click')
    expect(isDarkClass()).toBe(false)
  })

  it('treats System as light where matchMedia is unavailable', () => {
    mountApp()
    expect(isDarkClass()).toBe(false)
  })
})

describe('config mode and weekly plans', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)

  function chips(name: string): string {
    const row = ex()
      .findAll('[role="rowheader"]')
      .find((r) => r.get('[data-testid="item-name"]').text() === name)!
    return row
      .findAll('[data-testid="item-detail"]')
      .map((c) => c.text())
      .join(' · ')
  }

  it('hides every editing control in normal mode but still ticks cells', async () => {
    mountApp()
    // Off Edit plan, the bar's Edit plan is the keyboard's hidden button (K82, K91).
    const toggle = wrapper.get('[data-testid="edit-plan-button"]')
    expect(toggle.text()).toBe('Edit plan')
    expect(toggle.classes()).toContain('sr-only')
    expect(toggle.attributes('aria-pressed')).toBeUndefined()
    expect(wrapper.find('button[aria-label^="Edit Squats"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Remove"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Raise"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="add-exercise"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="add-food"]').exists()).toBe(false)
    expect(button('Copy plan to next week')).toBeUndefined()
    expect(wrapper.find('[data-testid="exercises-a-day"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="foods-a-day"]').exists()).toBe(false)

    await rowCells('Squats')[0]!.trigger('click')
    expect(rowCells('Squats')[0]!.attributes('aria-pressed')).toBe('true')

    await toggle.trigger('click')
    // In Edit plan the same hidden button reads "Done"; no action in the bar does (K91).
    const done = wrapper.get('[data-testid="edit-plan-button"]')
    expect(done.text()).toBe('Done')
    expect(done.classes()).toContain('sr-only')
    expect(wrapper.findAll('[data-slot="bar-action"]').map((b) => b.text())).not.toContain('Done')
    expect(wrapper.find('button[aria-label="Edit Squats"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Remove Fish"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="add-food"]').exists()).toBe(true)
  })

  it('fixes the week above the screens once, as the page’s h1, with a hairline under it once scrolled (K88)', async () => {
    mountApp()
    const band = wrapper.get('[data-slot="week-band"]')
    expect(wrapper.findAll('h1').map((h) => h.text())).toEqual(['19–25 October'])
    expect(band.get('h1').text()).toBe('19–25 October')
    // Before the screens, so it is not bound inside the first one.
    expect(band.element.nextElementSibling?.getAttribute('aria-labelledby')).toBe(
      'exercises-heading',
    )
    expect(band.classes()).toEqual(
      expect.arrayContaining([
        'full:sticky',
        'full:top-0',
        'full:bg-canvas',
        'full:text-center',
        'full:h-(--week-band)',
        'full:data-under:border-line',
        'short:sr-only',
      ]),
    )
    expect(band.attributes('data-under')).toBeUndefined()
    document.documentElement.scrollTop = 200
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 200 })
    window.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(band.attributes('data-under')).toBe('true'))
    document.documentElement.scrollTop = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    window.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(band.attributes('data-under')).toBeUndefined())
  })

  it('sets the daily targets on the title lines, without the week beside them (K56)', async () => {
    mountApp()
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(button('Copy plan to next week')).toBeUndefined()
    const header = (id: string) => wrapper.get(`#${id}`).element.closest('header')!
    expect(
      header('exercises-heading').querySelector('[data-testid="exercises-a-day"]'),
    ).not.toBeNull()
    expect(header('diet-heading').querySelector('[data-testid="foods-a-day"]')).not.toBeNull()
    expect([target('exercises-a-day'), target('foods-a-day')]).toEqual(['3', '2'])
    // Centred on the title line (K62): the Stepper alone, reading "2 per day" (K63), its label
    // kept for a screen reader. On screen the line is three columns like the Header's.
    const foods = wrapper.get('[data-testid="foods-a-day"]')
    expect(foods.get('label').text()).toBe('Foods a day')
    expect(foods.get('label').classes()).toContain('sr-only')
    expect(foods.get('[data-slot="stepper-suffix"]').text()).toBe('per day')
    expect(header('diet-heading').className).toContain(
      'screen:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
    )
    expect(header('diet-heading').className).toContain('folded:flex')
  })

  it('keeps each daily target to 1–8 and saves it', async () => {
    await mountConfig()
    const fewer = wrapper.get('button[aria-label="Fewer exercises a day"]')
    for (let i = 0; i < 3; i++) await fewer.trigger('click')
    expect(fewer.attributes('aria-disabled')).toBe('true')
    expect(target('exercises-a-day')).toBe('1')
    const more = wrapper.get('button[aria-label="More foods a day"]')
    for (let i = 0; i < 8; i++) await more.trigger('click')
    expect(more.attributes('aria-disabled')).toBe('true')
    expect(target('foods-a-day')).toBe('8')
    await settle()
    expect(api.accounts.get(USER)!.settings).toEqual({
      accent: '#30d158',
      dailyPick: 1,
      foodPick: 8,
      goals: '',
    })
  })

  it('turns a food day green when its marks reach foods a day (K57)', async () => {
    await mountConfig()
    const monday = () =>
      wrapper.get('[data-testid="diet-grid"]').findAll('[data-testid="day-head"]')[0]!
    await rowCells('Vegetables')[0]!.trigger('click')
    expect(monday().attributes('data-met')).toBeUndefined()
    await rowCells('Fruit')[0]!.trigger('click')
    expect(monday().attributes('data-met')).toBe('true')
    await wrapper.get('button[aria-label="More foods a day"]').trigger('click')
    expect(monday().attributes('data-met')).toBeUndefined()
  })

  it('closes an open question when another tab signs in as someone else', async () => {
    await mountConfig()
    await wrapper.get('button[aria-label="Remove Squats"]').trigger('click')
    await settle()
    expect(confirmation()).not.toBeNull()

    // Bob has a copy on this device, so his data shows at once, with no reload in between.
    api.addUser('bob')
    api.signedIn = 'bob'
    localStorage.setItem(CACHE_PREFIX + 'bob', JSON.stringify(emptyState()))
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: 'bob' }))
    window.dispatchEvent(
      new StorageEvent('storage', { key: SESSION_KEY, storageArea: localStorage }),
    )
    await flushPromises()
    await settle()
    expect(confirmation()).toBeNull()
    expect(wrapper.find('h1').text()).toBe('19–25 October')
  })

  it('does not remove a row if the week changed while it asked', async () => {
    await mountConfig()
    await wrapper.get('button[aria-label="Remove Squats"]').trigger('click')
    await settle()
    vi.setSystemTime(new Date(2026, 9, 26, 0, 5))
    usePlannerStore().refreshNow()
    await flushPromises()
    await answer('Remove')
    expect(wrapper.find('h1').text()).toBe('26 Oct – 1 Nov')
    expect(rowCells('Squats')).toHaveLength(7)
  })

  it('opens Add as a page with no bar, and comes back with focus on that Add button (K104)', async () => {
    await mountConfig()
    const add = await openAdd('food')
    expect(location.hash).toBe('#/new/diet')
    expect(wrapper.find('[data-slot="bar"]').exists()).toBe(false)
    expect(add.get('h1').text()).toBe('New food')
    await add.get('[data-testid="new-name-field"]').setValue('Beans')
    await submit(add)
    expect(location.hash).toBe('')
    expect(document.activeElement).toBe(wrapper.get('[data-testid="add-food"]').element)
    // Signing out from the page lands on the sign-in screen, and the address forgets it.
    await openAdd()
    await useSessionStore().logout()
    await settle()
    expect(location.hash).toBe('')
    expect(wrapper.find('[data-testid="new-item-page"]').exists()).toBe(false)
    // Signed out, B, H and L are the page's, not the app's (K105).
    const back = vi.spyOn(history, 'back')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', cancelable: true }))
    expect(back).not.toHaveBeenCalled()
  })

  it('adds an exercise with sets from the new item page (K104)', async () => {
    await mountConfig()
    const add = await openAdd()
    await add.get('[data-testid="new-name-field"]').setValue('Swings')
    await add.get('input[data-field="sets"]').setValue('4x')
    await add.get('input[data-field="reps"]').setValue('20')
    await submit(add)
    expect(chips('Swings')).toBe('4 × 20')
  })
})
