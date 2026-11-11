import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { useCardioStore } from '@/stores/cardio'
import { useDetailsStore } from '@/stores/details'
import { usePlannerStore } from '@/stores/planner'
import type { SyncState } from '@/stores/sync'
import type { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, emptyState, signedIn } from '@/lib/__tests__/signedIn'

// Friday 23 Oct 2026: the visible week is Mon 19 – Sun 25.
const NOW = new Date(2026, 9, 23, 18, 0)
const WEEK = '2026-10-19'
const CYCLING = { id: 'cy', name: 'Cycling', duration: 1800, target: 2 }
const RUNNING = { id: 'ru', name: 'Running', distance: 5, target: 3 }

let wrapper: VueWrapper
let api: FakeApi

/** A cache with this week's cardio plan: Cycling (30 min) and Running (5 km). */
function withCardio(): SyncState {
  const state = emptyState()
  state.cardio.plans = { [WEEK]: [CYCLING, RUNNING] }
  return state
}

/** Mount the app signed in as alice, with `cache` on the device. */
function mountApp(cache: SyncState = emptyState()): VueWrapper {
  api = signedIn(cache)
  api.stall('GET', '/state') // the cache is the account here
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

function grid() {
  return wrapper.get('[data-testid="cardio-grid"]')
}

function names(): string[] {
  return grid()
    .findAll('[data-testid="item-name"]')
    .map((n) => n.text())
}

function cells(name: string) {
  return grid().findAll(`button[aria-label^="${name},"]`)
}

/** Lets the hash change and the page it opens settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Opens the new item page from Add cardio, on the title line (K104, K113). */
async function openAdd() {
  await wrapper.get('[data-testid="add-cardio"]').trigger('click')
  await settle()
  return wrapper.get('[data-testid="new-item-page"]')
}

describe('CardioSection (K90)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sits between Exercises and Food, empty for an account with no cardio', () => {
    mountApp()
    const headings = wrapper.findAll('section[data-planner-screen] h2').map((h) => h.text())
    expect(headings).toEqual(['Exercises', 'Cardio', 'Food'])
    expect(names()).toEqual([])
    expect(grid().get('[data-slot="grid-label"]').text()).toBe('Cardio')
    expect(grid().attributes('aria-label')).toBe('Cardio, week of 19 October')
  })

  it('shows each item’s time and distance as chips, and no day turns green', async () => {
    mountApp(withCardio())
    expect(names()).toEqual(['Cycling', 'Running'])
    const chips = grid()
      .findAll('[role="rowheader"]')
      .map((r) => r.findAll('[data-testid="item-detail"]').map((c) => c.text()))
    expect(chips).toEqual([['30 min'], ['5 km']])
    for (const cell of cells('Cycling')) await cell.trigger('click')
    for (const cell of cells('Running')) await cell.trigger('click')
    const heads = grid().findAll('[data-testid="day-head"]')
    expect(heads.some((h) => h.attributes('data-met') === 'true')).toBe(false)
  })

  it('marks a day like an exercise: great, partial, missed, then empty', async () => {
    mountApp(withCardio())
    const cardio = useCardioStore()
    for (const mark of ['great', 'partial', 'missed']) {
      await cells('Running')[1]!.trigger('click')
      expect(cardio.markOf('ru', 1)).toBe(mark)
    }
    expect(cells('Running')[1]!.attributes('aria-pressed')).toBe('true')
    // The exercises are untouched.
    const planner = usePlannerStore()
    expect(planner.totalFor(planner.exercises[0]!.id)).toBe(0)
  })

  it('has no daily target on its title line in Edit plan', async () => {
    await mountConfig(withCardio())
    const header = wrapper.get('#cardio-heading').element.closest('[data-slot="section-header"]')!
    expect(header.querySelector('[data-slot="day-target"]')).toBeNull()
    // The others keep theirs while Daily goal is on.
    expect(wrapper.find('[data-testid="exercises-a-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="foods-a-day"]').exists()).toBe(true)
  })

  it('adds an item with a time and a distance, syncs it, and removes one after confirmation', async () => {
    await mountConfig(withCardio())
    const add = await openAdd()
    expect(add.get('[data-testid="new-add"]').text()).toBe('Add cardio')
    const labels = add
      .findAll('input')
      .map((i) => add.get(`label[for="${i.attributes('id')}"]`).text())
    expect(labels).toEqual(['Name', 'Minutes', 'Distance in km', 'Times a week', 'Route', 'Link'])
    await add.get('[data-testid="new-name-field"]').setValue('Swimming')
    await add.get('input[data-field="minutes"]').setValue('45x')
    expect(add.get<HTMLInputElement>('input[data-field="minutes"]').element.value).toBe('45')
    await add.get('input[data-field="distance"]').setValue('1,5')
    expect(add.get<HTMLInputElement>('input[data-field="distance"]').element.value).toBe('1.5')
    await add.get('[data-testid="new-notes-button"]').trigger('click')
    await add.get('textarea').setValue('Front crawl')
    await add.get('form').trigger('submit')
    await settle()
    expect(wrapper.find('[data-testid="new-item-page"]').exists()).toBe(false)
    const swim = useCardioStore().items.at(-1)!
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

    await grid().get('button[aria-label="Remove Running"]').trigger('click')
    await flushPromises()
    const confirm = document.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(confirm.querySelector('h2')!.textContent).toBe('Remove Running?')
    ;[...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!.click()
    await flushPromises()
    expect(names()).toEqual(['Cycling', 'Swimming'])
  })
})
