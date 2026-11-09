import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { useCardioStore } from '@/stores/cardio'
import { useDetailsStore } from '@/stores/details'
import { usePlannerStore } from '@/stores/planner'
import { CACHE_PREFIX, type SyncState } from '@/stores/sync'
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

/** The open dialog: Reka renders it in a portal on document.body. */
function dialog(): DOMWrapper<HTMLElement> | null {
  const el = document.querySelector<HTMLElement>('[role="dialog"]')
  return el ? new DOMWrapper(el) : null
}

async function openAdd(): Promise<DOMWrapper<HTMLElement>> {
  await wrapper.get('[data-testid="add-cardio"]').trigger('click')
  await flushPromises()
  return dialog()!
}

async function openEdit(name: string): Promise<DOMWrapper<HTMLElement>> {
  await grid().get(`button[aria-label="Edit ${name}"]`).trigger('click')
  await flushPromises()
  return dialog()!
}

function otherTabWrites(state: SyncState): void {
  const key = CACHE_PREFIX + USER
  localStorage.setItem(key, JSON.stringify(state))
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
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
    expect(add.get('h2').text()).toBe('Add cardio')
    const labels = add
      .findAll('input')
      .map((i) => add.get(`label[for="${i.attributes('id')}"]`).text())
    expect(labels).toEqual(['Name', 'Minutes', 'Distance in km', 'Times a week'])
    await add.get('#add-cardio-name').setValue('Swimming')
    await add.get('#add-cardio-minutes').setValue('45x')
    expect(add.get<HTMLInputElement>('#add-cardio-minutes').element.value).toBe('45')
    await add.get('#add-cardio-distance').setValue('1,5')
    expect(add.get<HTMLInputElement>('#add-cardio-distance').element.value).toBe('1.5')
    await add.get('#add-cardio-notes').setValue('Front crawl')
    await add.get('form').trigger('submit')
    await flushPromises()
    expect(dialog()).toBeNull()
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

  it('keeps the Add cardio dialog open on an empty name', async () => {
    await mountConfig()
    const add = await openAdd()
    await add.get('#add-cardio-name').setValue('   ')
    await add.get('form').trigger('submit')
    await flushPromises()
    expect(dialog()).not.toBeNull()
    expect(useCardioStore().items).toEqual([])
  })

  it('edits an item’s time, distance and goal, keeping its marks; blank clears an amount', async () => {
    await mountConfig(withCardio())
    await cells('Cycling')[0]!.trigger('click')
    const edit = await openEdit('Cycling')
    expect(edit.get('h2').text()).toBe('Edit cardio')
    expect(edit.get<HTMLInputElement>('#edit-cardio-minutes').element.value).toBe('30')
    expect(edit.get<HTMLInputElement>('#edit-cardio-distance').element.value).toBe('')
    await edit.get('#edit-cardio-minutes').setValue('')
    await edit.get('#edit-cardio-distance').setValue('20')
    await edit.get('button[aria-label="More times a week"]').trigger('click')
    await edit.get('form').trigger('submit')
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(useCardioStore().items[0]).toEqual({
      id: 'cy',
      name: 'Cycling',
      distance: 20,
      target: 3,
    })
    expect(cells('Cycling')[0]!.attributes('aria-pressed')).toBe('true')
  })

  it('opens with the item’s notes and odd minutes, and keeps everything when the notes are too big', async () => {
    const cache = withCardio()
    cache.cardio.plans[WEEK]![0] = { ...CYCLING, duration: 1830 }
    await mountConfig(cache)
    useDetailsStore().setNotes('cardio', 'cy', 'Easy spin')
    const edit = await openEdit('Cycling')
    expect(edit.get<HTMLInputElement>('#edit-cardio-minutes').element.value).toBe('30.5')
    const notes = edit.get<HTMLTextAreaElement>('#edit-cardio-notes')
    expect(notes.element.value).toBe('Easy spin')
    await edit.get('#edit-cardio-name').setValue('Ride')
    await notes.setValue('語'.repeat(12_000))
    await edit.get('form').trigger('submit')
    await flushPromises()
    expect(edit.find('#edit-cardio-notes-error').exists()).toBe(true)
    expect(useCardioStore().items[0]!.name).toBe('Cycling')
    expect(useDetailsStore().notesOf('cardio', 'cy')).toBe('Easy spin')
    // The notes count shows near the limit.
    await notes.setValue('x'.repeat(19_000))
    expect(edit.find('#edit-cardio-notes-count').exists()).toBe(true)
  })

  it('leaves a newer note alone when its own is untouched', async () => {
    await mountConfig(withCardio())
    useDetailsStore().setNotes('cardio', 'cy', 'Easy spin')
    const edit = await openEdit('Cycling')
    useDetailsStore().adoptItem('cardio', 'cy', { notes: 'From the phone' })
    await edit.get('#edit-cardio-name').setValue('Ride')
    await edit.get('form').trigger('submit')
    await flushPromises()
    expect(useCardioStore().items[0]!.name).toBe('Ride')
    expect(useDetailsStore().notesOf('cardio', 'cy')).toBe('From the phone')
  })

  it('says an item’s note can’t be saved when its id has a slash', async () => {
    const cache = withCardio()
    cache.cardio.plans[WEEK]!.push({ id: 'a/b', name: 'Slashed', target: 1 })
    await mountConfig(cache)
    const edit = await openEdit('Slashed')
    await edit.get('#edit-cardio-notes').setValue('Note')
    await edit.get('form').trigger('submit')
    await flushPromises()
    expect(edit.get('#edit-cardio-notes-error').text()).toBe(
      'This item’s notes can’t be saved: its id has a slash in it.',
    )
  })

  it('closes on Close without saving', async () => {
    await mountConfig(withCardio())
    const edit = await openEdit('Running')
    await edit.get('#edit-cardio-name').setValue('Jog')
    await edit.get('button[aria-label="Close"]').trigger('click')
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(useCardioStore().items[1]!.name).toBe('Running')
  })

  it('closes on Cancel without saving', async () => {
    await mountConfig(withCardio())
    const edit = await openEdit('Running')
    await edit.get('#edit-cardio-name').setValue('Jog')
    await edit
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(useCardioStore().items[1]!.name).toBe('Running')
  })

  it('closes when another tab deletes the item, but not for a different one', async () => {
    await mountConfig(withCardio())
    await openEdit('Cycling')
    const other = withCardio()
    other.cardio.plans = { [WEEK]: [CYCLING] }
    otherTabWrites(other)
    await flushPromises()
    expect(dialog()).not.toBeNull()
    other.cardio.plans = { [WEEK]: [RUNNING] }
    otherTabWrites(other)
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(names()).toEqual(['Running'])
  })

  it('closes its dialogs if the week changes under them', async () => {
    await mountConfig(withCardio())
    await openEdit('Cycling')
    usePlannerStore().nextWeek()
    await flushPromises()
    expect(dialog()).toBeNull()
    await openAdd()
    usePlannerStore().prevWeek()
    await flushPromises()
    expect(dialog()).toBeNull()
  })
})
