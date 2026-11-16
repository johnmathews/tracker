/**
 * One TrackerSection per tracker the week shows (K123): its heading, grid, daily target and Add
 * by kind; the arrows between trackers; Edit plan's pen (K124) and Delete tracker (K122); and the
 * new tracker page that Add tracker opens (K124).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import NewTrackerPage from '@/components/NewTrackerPage.vue'
import { useDetailsStore } from '@/stores/details'
import { usePlannerStore } from '@/stores/planner'
import { useTrackersStore } from '@/stores/trackers'
import { CACHE_PREFIX, type SyncState } from '@/stores/sync'
import { MAX_TRACKERS, type Tracker } from '@/lib/trackers'
import { trackerView } from '@/lib/__tests__/trackerView'
import type { FakeApi } from '@/lib/__tests__/fakeApi'
import {
  USER,
  emptySection,
  emptyState,
  signedIn,
  type CachedState,
} from '@/lib/__tests__/signedIn'

// Friday 23 Oct 2026: the visible week is Mon 19 – Sun 25.
const NOW = new Date(2026, 9, 23, 18, 0)
const WEEK = '2026-10-19'
const CYCLING = { id: 'cy', name: 'Cycling', duration: 1800, target: 2 }
const RUNNING = { id: 'ru', name: 'Running', distance: 5, target: 3 }
/** A fourth tracker of the account's own, after the first three. */
const UPPER: Tracker = {
  id: 'xup',
  name: 'Upper body',
  kind: 'strength',
  position: 3,
  dailyTarget: 2,
  startWeek: null,
  endWeek: null,
  rev: 1,
}

let wrapper: VueWrapper
let api: FakeApi

/** A cache with this week's cardio plan: Cycling (30 min) and Running (5 km). */
function withCardio(): CachedState {
  const state = emptyState()
  state.sections.cardio.plans = { [WEEK]: [CYCLING, RUNNING] }
  return state
}

/** A cache with four trackers: the first three and Upper body, on the server too once mounted. */
function withFour(): CachedState {
  const state = withCardio()
  state.trackers.push({ ...UPPER })
  state.sections.xup = {
    ...emptySection(),
    plans: { [WEEK]: [{ id: 'dips', name: 'Dips', reps: 8, target: 3 }] },
    revs: { [WEEK]: 1 },
  }
  return state
}

/** Mount the app signed in as alice, with `cache` on the device as her account. */
function mountApp(cache: SyncState = emptyState()): VueWrapper {
  api = signedIn(cache)
  api.stall('GET', '/state') // the cache is the account here
  const a = api.accounts.get(USER)!
  for (const t of cache.trackers.slice(3)) a.trackers.push({ ...t })
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

async function mountConfig(cache?: SyncState): Promise<VueWrapper> {
  mountApp(cache)
  await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
  return wrapper
}

const byId = (testid: string) => wrapper.get(`[data-testid="${testid}"]`)
const has = (testid: string) => wrapper.find(`[data-testid="${testid}"]`).exists()

function grid(id: string) {
  return byId(`${id}-grid`)
}

function names(id: string): string[] {
  return grid(id)
    .findAll('[data-testid="item-name"]')
    .map((n) => n.text())
}

function cells(id: string, name: string) {
  return grid(id).findAll(`button[aria-label^="${name},"]`)
}

/** The screens' headings, in the week's order. */
function headings(): string[] {
  return wrapper.findAll('section[data-planner-screen] h2').map((h) => h.text())
}

/** Lets the hash change and the page it opens settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The open ConfirmDialog, which Reka renders in a portal on document.body. */
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]')
}

async function answer(label: string): Promise<void> {
  ;[...dialog()!.querySelectorAll('button')].find((b) => b.textContent === label)!.click()
  await flushPromises()
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
})

describe('TrackerSection: the week (K123)', () => {
  it('shows each tracker by its name, in position order, with its heading id', () => {
    mountApp()
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food'])
    const ids = wrapper.findAll('section[data-planner-screen]').map((s) => s.attributes())
    expect(ids.map((a) => a['aria-labelledby'])).toEqual([
      'tracker-exercise-heading',
      'tracker-cardio-heading',
      'tracker-diet-heading',
    ])
    expect(ids.map((a) => a['data-kind'])).toEqual(['strength', 'cardio', 'food'])
    expect(names('cardio')).toEqual([])
    expect(grid('cardio').get('[data-slot="grid-label"]').text()).toBe('Cardio')
    expect(grid('cardio').attributes('aria-label')).toBe('Cardio, week of 19 October')
    expect(grid('exercise').attributes('aria-label')).toBe('Strength, week of 19 October')
  })

  it('shows a cardio item’s time and distance as chips, and no cardio day turns green', async () => {
    mountApp(withCardio())
    expect(names('cardio')).toEqual(['Cycling', 'Running'])
    const chips = grid('cardio')
      .findAll('[role="rowheader"]')
      .map((r) => r.findAll('[data-testid="item-detail"]').map((c) => c.text()))
    expect(chips).toEqual([['30 min'], ['5 km']])
    for (const cell of cells('cardio', 'Cycling')) await cell.trigger('click')
    for (const cell of cells('cardio', 'Running')) await cell.trigger('click')
    const heads = grid('cardio').findAll('[data-testid="day-head"]')
    expect(heads.some((h) => h.attributes('data-met') === 'true')).toBe(false)
  })

  it('marks a cardio day like an exercise: great, partial, missed, then empty', async () => {
    mountApp(withCardio())
    const cardio = trackerView('cardio')
    for (const mark of ['great', 'partial', 'missed']) {
      await cells('cardio', 'Running')[1]!.trigger('click')
      expect(cardio.markOf('ru', 1)).toBe(mark)
    }
    expect(cells('cardio', 'Running')[1]!.attributes('aria-pressed')).toBe('true')
    expect(trackerView('exercise').totalFor(trackerView('exercise').items[0]!.id)).toBe(0)
  })

  it('shows the default foods with no chips, and ticks one', async () => {
    mountApp()
    expect(names('diet')).toEqual(['Vegetables', 'Fruit', 'Fish', 'Nuts'])
    expect(grid('diet').findAll('[data-testid="item-detail"]')).toHaveLength(0)
    expect(grid('diet').findAll('[data-testid="day-head"]')[4]!.attributes('data-today')).toBe(
      'true',
    )
    await cells('diet', 'Fish')[0]!.trigger('click')
    await cells('diet', 'Fish')[2]!.trigger('click')
    expect(cells('diet', 'Fish')[2]!.attributes('aria-pressed')).toBe('true')
    const diet = trackerView('diet')
    expect(diet.totalFor(diet.items[2]!.id)).toBe(2)
  })

  it('moves with the shared week navigation', async () => {
    mountApp()
    await cells('diet', 'Fruit')[0]!.trigger('click')
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(cells('diet', 'Fruit')[0]!.attributes('aria-pressed')).toBe('false')
    await wrapper.get('button[aria-label="Next week"]').trigger('click')
    expect(cells('diet', 'Fruit')[0]!.attributes('aria-pressed')).toBe('true')
  })

  it('adopts another tab’s changes, a new tracker included', async () => {
    mountApp()
    const other = withFour()
    other.sections.diet.plans = { [WEEK]: [{ id: 'q', name: 'Quinoa', target: 2 }] }
    const key = CACHE_PREFIX + USER
    localStorage.setItem(key, JSON.stringify(other))
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
    await wrapper.vm.$nextTick()
    expect(names('diet')).toEqual(['Quinoa'])
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food', 'Upper body'])
  })

  it('shows the messages alone in a week with no tracker', async () => {
    const cache = emptyState()
    for (const t of cache.trackers) t.endWeek = WEEK
    mountApp(cache)
    expect(wrapper.findAll('section[data-planner-screen]')).toHaveLength(0)
    expect(wrapper.get('[data-testid="skip-to-today"]').attributes('href')).toBe('#')
    // The week before still shows them.
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food'])
  })
})

describe('TrackerSection: four trackers', () => {
  it('goes from each tracker to the next and back, named for where the arrow goes (K42)', () => {
    mountApp(withFour())
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food', 'Upper body'])
    const screens = wrapper.findAll('section[data-planner-screen]')
    const arrows = screens.map((s) =>
      s
        .findAll('button[aria-label^="Go to"], button[aria-label^="Back to"]')
        .map((b) => [b.attributes('data-testid'), b.attributes('aria-label')]),
    )
    expect(arrows).toEqual([
      [['to-cardio', 'Go to Cardio']],
      [
        ['back-to-exercise', 'Back to Strength'],
        ['to-diet', 'Go to Food'],
      ],
      [
        ['back-to-cardio', 'Back to Cardio'],
        ['to-xup', 'Go to Upper body'],
      ],
      [['back-to-diet', 'Back to Food']],
    ])
    // Each tracker after the first starts a page of its own on paper (K97).
    expect(screens.map((s) => s.classes().includes('print:break-before-page'))).toEqual([
      false,
      true,
      true,
      true,
    ])
  })

  it('takes the Add words and the daily target from the kind, not the tracker', async () => {
    await mountConfig(withFour())
    expect(byId('add-exercise').text()).toBe('Add exercise')
    expect(byId('add-cardio').text()).toBe('Add cardio')
    expect(byId('add-diet').text()).toBe('Add food')
    expect(byId('add-xup').text()).toBe('Add exercise')
    // A strength tracker of the account's own has its own daily target, 2 a day.
    const target = byId('xup-a-day')
    expect(target.get('[role="spinbutton"]').attributes('aria-valuenow')).toBe('2')
    expect(target.find('button[aria-label="More exercises a day"]').exists()).toBe(true)
    expect(byId('diet-a-day').find('button[aria-label="Fewer foods a day"]').exists()).toBe(true)
    // Cardio has none (K90).
    const cardio = wrapper.get('#tracker-cardio-heading').element.closest('header')!
    expect(cardio.querySelector('[data-slot="day-target"]')).toBeNull()
    // Upper body's days turn green at 2 marked exercises (K30).
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    await cells('xup', 'Dips')[4]!.trigger('click')
    expect(
      grid('xup')
        .findAll('[data-testid="day-head"]')
        .map((h) => h.attributes('data-met')),
    ).not.toContain('true')
    useTrackersStore().setDailyTarget('xup', 1)
    await wrapper.vm.$nextTick()
    expect(grid('xup').findAll('[data-testid="day-head"]')[4]!.attributes('data-met')).toBe('true')
  })

  it('opens the new item page of the tracker whose Add was pressed', async () => {
    await mountConfig(withFour())
    await byId('add-xup').trigger('click')
    await settle()
    expect(location.hash).toBe('#/new/xup')
    const page = byId('new-item-page')
    expect(page.get('h1').text()).toBe('New exercise')
    expect(page.get('[data-testid="new-add"]').text()).toBe('Add exercise')
    await page.get('[data-testid="new-name-field"]').setValue('Rows')
    await page.get('form').trigger('submit')
    await settle()
    expect(names('xup')).toEqual(['Dips', 'Rows'])
    expect(document.activeElement).toBe(byId('add-xup').element)
  })
})

describe('TrackerSection: adding items by kind', () => {
  it('adds a cardio item with a time and a distance, and syncs it', async () => {
    await mountConfig(withCardio())
    await byId('add-cardio').trigger('click')
    await settle()
    const add = byId('new-item-page')
    expect(add.get('[data-testid="new-add"]').text()).toBe('Add cardio')
    const labels = add
      .findAll('input')
      .map((i) => add.get(`label[for="${i.attributes('id')}"]`).text())
    expect(labels).toEqual(['Name', 'Minutes', 'Distance in km', 'Times a week', 'Route', 'Link'])
    await add.get('[data-testid="new-name-field"]').setValue('Swimming')
    await add.get('input[data-field="minutes"]').setValue('45x')
    await add.get('input[data-field="distance"]').setValue('1,5')
    await add.get('[data-testid="new-notes-button"]').trigger('click')
    await add.get('textarea').setValue('Front crawl')
    await add.get('form').trigger('submit')
    await settle()
    const swim = trackerView('cardio').items.at(-1)!
    expect(swim).toEqual({
      id: swim.id,
      name: 'Swimming',
      duration: 2700,
      distance: 1.5,
      target: 3,
    })
    expect(useDetailsStore().notesOf('cardio', swim.id)).toBe('Front crawl')
    await flushPromises()
    const plan = api.accounts.get(USER)!.plans.cardio[WEEK]!.items as { name: string }[]
    expect(plan.map((c) => c.name)).toEqual(['Cycling', 'Running', 'Swimming'])
  })

  it('adds a food with the food’s goal, and syncs it', async () => {
    await mountConfig()
    await byId('add-diet').trigger('click')
    await settle()
    const add = byId('new-item-page')
    expect(add.get('[data-testid="new-add"]').text()).toBe('Add food')
    await add.get('[data-testid="new-name-field"]').setValue('Beans')
    await add.get('form').trigger('submit')
    await settle()
    expect(names('diet').at(-1)).toBe('Beans')
    expect(trackerView('diet').items.at(-1)!.target).toBe(3)
    await flushPromises()
    const plan = api.accounts.get(USER)!.plans.diet[WEEK]!.items as { name: string }[]
    expect(plan.at(-1)!.name).toBe('Beans')
  })
})

describe('TrackerSection: renaming with the pen (K121, K124)', () => {
  /** Presses Cardio's pen and gives its field. */
  async function startRename() {
    await byId('rename-cardio').trigger('click')
    await wrapper.vm.$nextTick()
    return wrapper.get<HTMLInputElement>('[data-testid="name-field-cardio"]')
  }

  it('has a pen in Edit plan only, named for the tracker', async () => {
    mountApp()
    expect(has('rename-cardio')).toBe(false)
    expect(has('delete-cardio')).toBe(false)
    expect(has('add-cardio')).toBe(false)
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(byId('rename-cardio').attributes('aria-label')).toBe('Rename Cardio')
  })

  it('turns the title into a field with the name selected; Enter saves and syncs it', async () => {
    await mountConfig()
    const field = await startRename()
    expect(document.activeElement).toBe(field.element)
    expect(field.element.value).toBe('Cardio')
    expect([field.element.selectionStart, field.element.selectionEnd]).toEqual([0, 6])
    expect(field.element.maxLength).toBe(60)
    // The h2 stays for a screen reader.
    expect(wrapper.get('#tracker-cardio-heading').classes()).toContain('sr-only')
    await field.setValue('  Running  ')
    await field.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(has('name-field-cardio')).toBe(false)
    expect(headings()).toEqual(['Strength', 'Running', 'Food'])
    expect(document.activeElement).toBe(byId('rename-cardio').element)
    expect(byId('to-cardio').attributes('aria-label')).toBe('Go to Running')
    await flushPromises()
    expect(api.tracker(USER, 'cardio')!.name).toBe('Running')
  })

  it('saves with Done, and leaves an unchanged name alone', async () => {
    await mountConfig()
    const rename = vi.spyOn(useTrackersStore(), 'renameTracker')
    let field = await startRename()
    await byId('rename-done-cardio').trigger('click')
    expect(rename).not.toHaveBeenCalled()
    field = await startRename()
    await field.setValue('Rides')
    await byId('rename-done-cardio').trigger('click')
    await wrapper.vm.$nextTick()
    expect(headings()).toEqual(['Strength', 'Rides', 'Food'])
  })

  it('puts the old name back on Escape, and keeps Edit plan on', async () => {
    await mountConfig()
    const field = await startRename()
    await field.setValue('Rides')
    await field.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food'])
    expect(usePlannerStore().configMode).toBe(true)
    expect(document.activeElement).toBe(byId('rename-cardio').element)
  })

  it('waits on an empty name with a message, and ignores Enter while composing', async () => {
    await mountConfig()
    const field = await startRename()
    await field.setValue('   ')
    await field.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(wrapper.find('[role="alert"], [data-slot="inline-message"]').exists()).toBe(false)
    await field.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(field.attributes('aria-invalid')).toBe('true')
    const message = wrapper.get(`#${field.attributes('aria-describedby')}`)
    expect(message.text()).toBe('Enter a name.')
    expect(useTrackersStore().get('cardio')!.name).toBe('Cardio')
    await field.setValue('Rides')
    await field.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(headings()).toEqual(['Strength', 'Rides', 'Food'])
  })

  it('follows a rename from elsewhere while the draft is untouched, and keeps a typed one', async () => {
    await mountConfig()
    const field = await startRename()
    useTrackersStore().renameTracker('cardio', 'Rides')
    await wrapper.vm.$nextTick()
    expect(field.element.value).toBe('Rides')
    await field.setValue('Laps')
    useTrackersStore().renameTracker('cardio', 'Swims')
    await wrapper.vm.$nextTick()
    expect(field.element.value).toBe('Laps')
  })

  it('stops renaming when Edit plan closes', async () => {
    await mountConfig()
    await startRename()
    usePlannerStore().setConfigMode(false)
    await wrapper.vm.$nextTick()
    usePlannerStore().setConfigMode(true)
    await wrapper.vm.$nextTick()
    expect(has('name-field-cardio')).toBe(false)
    expect(has('rename-cardio')).toBe(true)
  })
})

describe('TrackerSection: Delete tracker (K122)', () => {
  it('asks first in the ConfirmDialog, and Cancel keeps the tracker', async () => {
    await mountConfig(withCardio())
    const button = byId('delete-cardio')
    expect(button.text()).toBe('Delete tracker')
    await button.trigger('click')
    await flushPromises()
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Delete Cardio?')
    expect(dialog()!.textContent).toContain(
      'It comes off this week and the weeks after. Earlier weeks keep it.',
    )
    // Each sentence on a line of its own (K129).
    expect(dialog()!.querySelector('[data-slot="confirm-message"]')!.className).toContain(
      'whitespace-pre-line',
    )
    await answer('Cancel')
    expect(dialog()).toBeNull()
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food'])
    expect(useTrackersStore().get('cardio')!.endWeek).toBeNull()
    expect(document.activeElement).toBe(byId('delete-cardio').element)
  })

  it('ends the tracker from the week on screen; earlier weeks keep it with its marks', async () => {
    const cache = withCardio()
    cache.sections.cardio.plans['2026-10-12'] = [CYCLING]
    cache.sections.cardio.log = {
      '2026-10-12': { cy: ['great', null, null, null, null, null, null] },
    }
    await mountConfig(cache)
    await byId('delete-cardio').trigger('click')
    await flushPromises()
    await answer('Delete')
    expect(headings()).toEqual(['Strength', 'Food'])
    // Focus goes to the Add of the tracker that takes its screen.
    expect(document.activeElement).toBe(byId('add-diet').element)
    expect(byId('to-diet').attributes('aria-label')).toBe('Go to Food')
    expect(useTrackersStore().get('cardio')!.endWeek).toBe(WEEK)
    await flushPromises()
    expect(api.tracker(USER, 'cardio')!.endWeek).toBe(WEEK)
    // The week before still shows Cardio, with its marks.
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food'])
    expect(cells('cardio', 'Cycling')[0]!.attributes('aria-pressed')).toBe('true')
  })

  it('puts focus on the tracker before when the last goes, then on Add tracker', async () => {
    const cache = emptyState()
    cache.trackers = cache.trackers.filter((t) => t.id !== 'cardio')
    await mountConfig(cache)
    await byId('delete-diet').trigger('click')
    await flushPromises()
    await answer('Delete')
    expect(document.activeElement).toBe(byId('add-exercise').element)
    expect(has('to-diet')).toBe(false)
    await byId('delete-exercise').trigger('click')
    await flushPromises()
    await answer('Delete')
    expect(headings()).toEqual([])
    expect(document.activeElement).toBe(byId('add-tracker-button').element)
  })

  it('ends nothing when the week changes while it asks', async () => {
    await mountConfig()
    await byId('delete-cardio').trigger('click')
    await flushPromises()
    usePlannerStore().prevWeek()
    await answer('Delete')
    expect(useTrackersStore().get('cardio')!.endWeek).toBeNull()
  })
})

describe('the skip link (F15)', () => {
  it('points at the first tracker the week shows', async () => {
    const cache = emptyState()
    cache.trackers[0]!.endWeek = WEEK
    mountApp(cache)
    expect(byId('skip-to-today').attributes('href')).toBe('#tracker-cardio-heading')
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(byId('skip-to-today').attributes('href')).toBe('#tracker-exercise-heading')
  })
})

describe('Add tracker and the new tracker page (K124)', () => {
  async function openNewTracker() {
    await byId('add-tracker-button').trigger('click')
    await settle()
    return byId('new-tracker-page')
  }

  it('is a bar action before Settings, in Edit plan only', async () => {
    mountApp()
    expect(has('add-tracker-button')).toBe(false)
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    const actions = wrapper.findAll('[data-slot="bar-action"]').map((b) => b.text())
    expect(actions.indexOf('Add tracker')).toBe(actions.indexOf('Settings') - 1)
  })

  it('opens the page at #/new-tracker, framed like the new item page', async () => {
    await mountConfig()
    const page = await openNewTracker()
    expect(location.hash).toBe('#/new-tracker')
    expect(has('bar')).toBe(false)
    expect(wrapper.find('[data-slot="bar"]').exists()).toBe(false)
    expect(page.get('h1').text()).toBe('New tracker')
    // K128: no Starts row, no line over the control, and the row's heading is its only label.
    expect(page.findAll('h2').map((h) => h.text())).toEqual(['Kind'])
    expect(page.find('[data-testid="new-tracker-starts"]').exists()).toBe(false)
    expect(page.find('[data-slot="segmented-control-label"]').exists()).toBe(false)
    expect(page.find('[data-slot="segmented-control"] [aria-label="Kind"]').exists()).toBe(true)
    expect(page.text()).not.toContain('The kind is set once')
    expect(page.get('[data-testid="back-to-week"]').text()).toBe('Back to the week')
    expect(page.get('[data-testid="new-tracker-add"]').text()).toBe('Add tracker')
    const name = page.get<HTMLInputElement>('[data-testid="new-tracker-name"]')
    expect(document.activeElement).toBe(name.element)
    expect(name.element.maxLength).toBe(60)
  })

  it('offers the registry’s kinds and shows what the chosen one logs (K128)', async () => {
    await mountConfig()
    const page = await openNewTracker()
    const kinds = page.findAll('[data-slot="segmented-control"] button')
    expect(kinds.map((k) => k.text())).toEqual(['Strength', 'Cardio', 'Food', 'Mobility'])
    const lines = () =>
      page
        .get('[data-testid="new-tracker-kind-line"]')
        .findAll('p')
        .map((p) => p.text())
    expect(lines()).toEqual(['Log sets, reps, time and weight.'])
    await kinds[2]!.trigger('click')
    expect(lines()).toEqual(['Log portions.'])
    await kinds[3]!.trigger('click')
    expect(lines()).toEqual(['Log sets, reps or hold time, each side.'])
  })

  it('asks for a name before adding anything', async () => {
    await mountConfig()
    const page = await openNewTracker()
    await page.get('form').trigger('submit')
    await flushPromises()
    const name = page.get<HTMLInputElement>('[data-testid="new-tracker-name"]')
    expect(name.attributes('aria-invalid')).toBe('true')
    expect(page.text()).toContain('Enter a name.')
    expect(document.activeElement).toBe(name.element)
    expect(useTrackersStore().list).toHaveLength(3)
    await name.setValue('Mobility')
    expect(name.attributes('aria-invalid')).toBeUndefined()
  })

  it('adds the tracker last, from the week on screen, and comes back to its Add', async () => {
    await mountConfig()
    usePlannerStore().prevWeek()
    const page = await openNewTracker()
    await page.get('[data-testid="new-tracker-name"]').setValue('  Rides ')
    await page.findAll('[data-slot="segmented-control"] button')[1]!.trigger('click')
    await page.get('form').trigger('submit')
    await settle()
    expect(has('new-tracker-page')).toBe(false)
    expect(usePlannerStore().configMode).toBe(true)
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food', 'Rides'])
    const added = useTrackersStore().ordered.at(-1)!
    expect(added).toMatchObject({ name: 'Rides', kind: 'cardio', startWeek: '2026-10-12' })
    expect(document.activeElement).toBe(byId(`add-${added.id}`).element)
    expect(byId(`add-${added.id}`).text()).toBe('Add cardio')
    await flushPromises()
    expect(api.tracker(USER, added.id)!.name).toBe('Rides')
    // The week before it doesn't show it.
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food'])
  })

  it('adds one tracker when Add tracker is pressed twice before the week opens', async () => {
    await mountConfig()
    const page = await openNewTracker()
    await page.get('[data-testid="new-tracker-name"]').setValue('Rides')
    const form = page.get('form')
    await form.trigger('submit')
    await form.trigger('submit')
    await settle()
    expect(headings()).toEqual(['Strength', 'Cardio', 'Food', 'Rides'])
    expect(useTrackersStore().list).toHaveLength(4)
  })

  it('goes back on Cancel with focus on Add tracker, adding nothing', async () => {
    await mountConfig()
    const page = await openNewTracker()
    await page.get('[data-testid="new-tracker-name"]').setValue('Rides')
    await page.get('[data-testid="new-tracker-cancel"]').trigger('click')
    await settle()
    expect(has('new-tracker-page')).toBe(false)
    expect(useTrackersStore().list).toHaveLength(3)
    expect(document.activeElement).toBe(byId('add-tracker-button').element)
  })

  it('says so when the account holds the most trackers it can', async () => {
    const cache = emptyState()
    for (let i = 3; i < MAX_TRACKERS; i++)
      cache.trackers.push({ ...UPPER, id: `x${i}`, position: i, endWeek: '2026-10-12' })
    await mountConfig(cache)
    const page = await openNewTracker()
    await page.get('[data-testid="new-tracker-name"]').setValue('Rides')
    await page.get('form').trigger('submit')
    await flushPromises()
    expect(page.text()).toContain('An account holds at most 100 trackers, deleted ones included.')
    expect(has('new-tracker-page')).toBe(true)
  })

  it('takes no focus as a style-guide example', () => {
    setActivePinia(createPinia())
    const page = mount(NewTrackerPage, { props: { example: true }, attachTo: document.body })
    expect(document.activeElement).toBe(document.body)
    page.unmount()
  })
})
