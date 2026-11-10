/**
 * The new item page (K104), at #/new/<section>: Edit plan's Add opens it in place of a dialog. It
 * holds what is typed until Add, then adds the item with its notes and details and goes back to
 * the week.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NewItemPage from '@/components/NewItemPage.vue'
import { usePlannerStore } from '@/stores/planner'
import { useCardioStore } from '@/stores/cardio'
import { useDietStore } from '@/stores/diet'
import { useDetailsStore } from '@/stores/details'
import { markFromWeek } from '@/lib/routes'
import { MAX_DETAILS_NOTES, MAX_FIELD, type Exercise } from '@/lib/storage'
import type { Section } from '@/lib/trackerTypes'

// Wednesday 21 October 2026: the current week starts on Monday 19 October.
const NOW = new Date(2026, 9, 21, 12)
const WEEK = '2026-10-19'
const PU: Exercise = { id: 'pu', name: 'Push-ups', sets: 3, reps: 12, target: 4, perSide: false }

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  const planner = usePlannerStore()
  planner.now = NOW
  planner.plans = { [WEEK]: [{ ...PU }] }
  useDietStore().plans = { [WEEK]: [] }
  useCardioStore().plans = { [WEEK]: [] }
  history.replaceState(null, '', '/#/new/exercise')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  history.replaceState(null, '', '/')
})

function mountPage(section: Section = 'exercise', example = false): VueWrapper {
  wrapper = mount(NewItemPage, { props: { section, example }, attachTo: document.body })
  return wrapper
}

const nameField = () => wrapper!.get<HTMLInputElement>('[data-testid="new-name-field"]')
const field = (key: string) => wrapper!.get<HTMLInputElement>(`input[data-field="${key}"]`)
const headings = () => wrapper!.findAll('h2').map((h) => h.text())
async function add(): Promise<void> {
  await wrapper!.get('form').trigger('submit')
  await nextTick()
}
const added = () => usePlannerStore().exercises.at(-1)!

describe('the new item page (K104)', () => {
  it('opens at the top on an empty Name, with one set of one rep three times a week', () => {
    document.documentElement.scrollTop = 900
    mountPage()
    expect(document.documentElement.scrollTop).toBe(0)
    expect(wrapper!.get('[data-testid="new-item-page"]').attributes('data-slot')).toBe('item-page')
    expect(wrapper!.get('h1').text()).toBe('New exercise')
    expect(wrapper!.get('[data-testid="back-to-week"]').attributes('href')).toBe('#/')
    expect(wrapper!.get('[data-testid="new-cancel"]').text()).toBe('Cancel')
    expect(wrapper!.get('[data-testid="new-add"]').text()).toBe('Add exercise')
    expect(nameField().element.value).toBe('')
    expect(document.activeElement).toBe(nameField().element)
    expect(field('sets').element.value).toBe('1')
    expect(field('reps').element.value).toBe('1')
    expect(wrapper!.get('[role="spinbutton"]').attributes('aria-valuenow')).toBe('3')
    // The plan first; Recent weeks has nothing yet, so it isn't there.
    expect(headings()).toEqual(['This week’s plan', 'Notes', 'Details'])
    expect(wrapper!.get('[data-testid="item-plan-line"]').text()).toBe(
      'Adds it to this week’s plan, and the weeks after it that have no plan of their own.',
    )
  })

  it('reads a field the control clears to nothing as empty', async () => {
    mountPage()
    await wrapper!.get('[data-testid="new-notes-button"]').trigger('click')
    for (const c of wrapper!.findAllComponents({ name: 'TextField' }))
      c.vm.$emit('update:modelValue', undefined)
    wrapper!.findComponent({ name: 'TextArea' }).vm.$emit('update:modelValue', undefined)
    await nextTick()
    expect(nameField().element.value).toBe('')
    expect(wrapper!.get('textarea').element.value).toBe('')
    expect(field('equipment').element.value).toBe('')
  })

  it('takes no focus as a style-guide example', () => {
    mountPage('exercise', true)
    expect(document.activeElement).not.toBe(nameField().element)
  })

  it('follows the type’s arrangement, always showing the plan', () => {
    usePlannerStore().setArrangement('exercise', {
      order: ['history', 'details', 'notes', 'plan'],
      hidden: ['notes', 'plan'],
    })
    mountPage()
    expect(headings()).toEqual(['Details', 'This week’s plan'])
  })

  it('names another week in its plan heading and line', () => {
    usePlannerStore().nextWeek()
    mountPage()
    expect(headings()[0]).toBe('Plan for the week of 26 October')
    expect(wrapper!.get('[data-testid="item-plan-line"]').text()).toBe(
      'Adds it to the plan for the week of 26 October, and the weeks after it that have no plan of their own.',
    )
  })

  it('adds an exercise with its plan, notes and details, then goes back to the week', async () => {
    mountPage()
    await nameField().setValue('  Kettlebell swings ')
    await field('sets').setValue('3x')
    expect(field('sets').element.value).toBe('3')
    await field('reps').setValue('15')
    await field('weight').setValue('16,5')
    await wrapper!.get('button[aria-label="More times a week"]').trigger('click')
    await wrapper!.get('[data-testid="new-notes-button"]').trigger('click')
    expect(document.activeElement).toBe(wrapper!.get('textarea').element)
    await wrapper!.get('textarea').setValue('**Hinge.**')
    await field('equipment').setValue('16 kg kettlebell')
    await add()
    expect(added()).toEqual({
      id: added().id,
      name: 'Kettlebell swings',
      sets: 3,
      reps: 15,
      weight: 16.5,
      perSide: false,
      target: 4,
    })
    const details = useDetailsStore()
    expect(details.notesOf('exercise', added().id)).toBe('**Hinge.**')
    expect(details.fieldOf('exercise', added().id, 'equipment')).toBe('16 kg kettlebell')
    expect(details.fieldOf('exercise', added().id, 'works')).toBe('')
    expect(location.hash).toBe('#/')
  })

  it('adds a timed exercise counted each side', async () => {
    mountPage()
    await nameField().setValue('Side plank')
    await wrapper!
      .findAll('button')
      .find((r) => r.text() === 'Time')!
      .trigger('click')
    expect(wrapper!.get('label[for$="-reps"]').text()).toBe('Seconds')
    await field('reps').setValue('45')
    await wrapper!
      .findAll('button')
      .find((r) => r.text() === 'Each side')!
      .trigger('click')
    await add()
    expect(added()).toMatchObject({
      name: 'Side plank',
      sets: 1,
      reps: 0,
      duration: 45,
      perSide: true,
    })
  })

  it('adds nothing without a name, and says so with focus on the field', async () => {
    mountPage()
    await nameField().setValue('   ')
    await add()
    expect(usePlannerStore().exercises).toHaveLength(1)
    expect(wrapper!.text()).toContain('Enter a name.')
    expect(document.activeElement).toBe(nameField().element)
    expect(location.hash).toBe('#/new/exercise')
    await nameField().setValue('Squats')
    expect(nameField().attributes('aria-invalid')).toBeUndefined()
  })

  it('adds nothing while a number is over its limit, until it changes', async () => {
    mountPage()
    await nameField().setValue('Squats')
    await field('sets').setValue('25')
    await add()
    expect(usePlannerStore().exercises).toHaveLength(1)
    expect(wrapper!.text()).toContain('This is 25 sets. Enter 20 or fewer to change the plan.')
    expect(document.activeElement).toBe(field('sets').element)
    await field('sets').setValue('2')
    expect(field('sets').attributes('aria-invalid')).toBeUndefined()
    await add()
    expect(added()).toMatchObject({ name: 'Squats', sets: 2 })
  })

  it('adds nothing while the notes or a detail are too long', async () => {
    mountPage()
    await nameField().setValue('Squats')
    await wrapper!.get('[data-testid="new-notes-button"]').trigger('click')
    await wrapper!.get('textarea').setValue('x'.repeat(MAX_DETAILS_NOTES + 1))
    await field('works').setValue('y'.repeat(MAX_FIELD + 40))
    await add()
    expect(usePlannerStore().exercises).toHaveLength(1)
    expect(wrapper!.text()).toContain(
      'These notes are 20,001 characters. Shorten them to 20,000 or fewer to add them.',
    )
    expect(wrapper!.text()).toContain(
      'This is 540 characters. Shorten it to 500 or fewer to add it.',
    )
    // Within the count, but more bytes than the API stores (32 KB).
    await wrapper!.get('textarea').setValue('€'.repeat(MAX_DETAILS_NOTES))
    await field('works').setValue('')
    await add()
    expect(wrapper!.text()).toContain(
      'These notes are too long to save. Shorten them, then add again.',
    )
    await wrapper!.get('textarea').setValue('Deep')
    await add()
    expect(added().name).toBe('Squats')
  })

  it('adds a cardio item with its time and distance', async () => {
    mountPage('cardio')
    expect(wrapper!.get('h1').text()).toBe('New cardio')
    expect(wrapper!.get('[data-testid="new-add"]').text()).toBe('Add cardio')
    await nameField().setValue('Swimming')
    await field('minutes').setValue('45')
    await field('distance').setValue('1,5')
    await add()
    const swim = useCardioStore().items.at(-1)!
    expect(swim).toEqual({
      id: swim.id,
      name: 'Swimming',
      duration: 2700,
      distance: 1.5,
      target: 3,
    })
  })

  it('adds no cardio item while a number is over its limit', async () => {
    mountPage('cardio')
    await nameField().setValue('Swimming')
    await field('distance').setValue('2000')
    await add()
    expect(useCardioStore().items).toEqual([])
    expect(wrapper!.text()).toContain('Enter 1,000 or fewer to change the plan.')
  })

  it('adds a food with its goal and nothing else in its plan', async () => {
    mountPage('diet')
    expect(wrapper!.find('input[data-field="sets"]').exists()).toBe(false)
    await nameField().setValue('Beans')
    await wrapper!.get('button[aria-label="Fewer times a week"]').trigger('click')
    await add()
    const beans = useDietStore().foods.at(-1)!
    expect(beans).toEqual({ id: beans.id, name: 'Beans', target: 2 })
  })

  it('goes back on Cancel, adding nothing, through history when the week opened it', async () => {
    const back = history.back
    let went = false
    history.back = () => {
      went = true
    }
    try {
      markFromWeek()
      mountPage()
      await nameField().setValue('Squats')
      await wrapper!.get('[data-testid="new-cancel"]').trigger('click')
      expect(went).toBe(true)
      expect(usePlannerStore().exercises).toHaveLength(1)
    } finally {
      history.back = back
    }
  })
})
