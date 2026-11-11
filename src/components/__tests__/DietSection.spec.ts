import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { useDietStore } from '@/stores/diet'
import { usePlannerStore } from '@/stores/planner'
import { CACHE_PREFIX } from '@/stores/sync'
import type { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, emptyState, signedIn } from '@/lib/__tests__/signedIn'

const NOW = new Date(2026, 9, 23, 18, 0)

let wrapper: VueWrapper
let api: FakeApi

/** Mount the app signed in as alice, with an empty account. */
function mountApp(): VueWrapper {
  api = signedIn()
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

function diet() {
  return wrapper.get('[data-testid="diet-grid"]')
}

function cells(name: string) {
  return diet().findAll(`button[aria-label^="${name},"]`)
}

/** Lets the hash change and the page it opens settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Opens the new item page from Add food, on the title line (K104, K113). */
async function openAddFood() {
  await wrapper.get('[data-testid="add-food"]').trigger('click')
  await settle()
  return wrapper.get('[data-testid="new-item-page"]')
}

describe('DietSection', () => {
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

  it('renders below the exercises with the default foods and no reps chips', () => {
    mountApp()
    expect(wrapper.get('#diet-heading').text()).toBe('Food')
    expect(
      diet()
        .findAll('[data-testid="item-name"]')
        .map((n) => n.text()),
    ).toEqual(['Vegetables', 'Fruit', 'Fish', 'Nuts'])
    expect(diet().findAll('[data-testid="item-detail"]')).toHaveLength(0)
    expect(diet().get('[data-slot="grid-label"]').text()).toBe('Food')
    expect(diet().findAll('[data-testid="day-head"]')[4]!.attributes('data-today')).toBe('true')
  })

  it('ticks a food, updating its total', async () => {
    mountApp()
    await cells('Fish')[0]!.trigger('click')
    await cells('Fish')[2]!.trigger('click')
    expect(cells('Fish')[2]!.attributes('aria-pressed')).toBe('true')
    // The grid shows no total since K33; the store keeps it.
    const diet = useDietStore()
    expect(diet.totalFor(diet.foods[2]!.id)).toBe(2)
    // The exercise totals are untouched.
    const planner = usePlannerStore()
    expect(planner.totalFor(planner.exercises[0]!.id)).toBe(0)
  })

  it('moves with the shared week navigation', async () => {
    mountApp()
    await cells('Fruit')[0]!.trigger('click')
    await wrapper.get('button[aria-label="Previous week"]').trigger('click')
    expect(cells('Fruit')[0]!.attributes('aria-pressed')).toBe('false')
    await wrapper.get('button[aria-label="Next week"]').trigger('click')
    expect(cells('Fruit')[0]!.attributes('aria-pressed')).toBe('true')
  })

  it('adds a food, syncs it, and removes one after confirmation', async () => {
    await mountConfig()
    const add = await openAddFood()
    expect(add.get('[data-testid="new-add"]').text()).toBe('Add food')
    await add.get('[data-testid="new-name-field"]').setValue('Beans')
    await add.get('form').trigger('submit')
    await settle()
    expect(wrapper.find('[data-testid="new-item-page"]').exists()).toBe(false)
    expect(diet().findAll('[data-testid="item-name"]').at(-1)!.text()).toBe('Beans')
    expect(useDietStore().foods.at(-1)!.target).toBe(3)
    await flushPromises()
    const plan = api.accounts.get(USER)!.plans.diet['2026-10-19']!.items as { name: string }[]
    expect(plan.at(-1)!.name).toBe('Beans')

    await diet().get('button[aria-label="Remove Nuts"]').trigger('click')
    await flushPromises()
    // Reka renders the ConfirmDialog in a portal on document.body.
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(dialog.querySelector('h2')!.textContent).toBe('Remove Nuts?')
    ;[...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!.click()
    await flushPromises()
    expect(cells('Nuts')).toHaveLength(0)
  })

  it('adopts another tab’s diet changes', async () => {
    mountApp()
    const other = emptyState()
    other.diet.plans = { '2026-10-19': [{ id: 'q', name: 'Quinoa', target: 2 }] }
    const key = CACHE_PREFIX + USER
    localStorage.setItem(key, JSON.stringify(other))
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
    await wrapper.vm.$nextTick()
    expect(
      diet()
        .findAll('[data-testid="item-name"]')
        .map((n) => n.text()),
    ).toEqual(['Quinoa'])
  })
})
