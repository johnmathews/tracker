import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ItemPage from '@/components/ItemPage.vue'
import { ConfirmHost } from '@/components/ui/confirm-dialog'
import { usePlannerStore } from '@/stores/planner'
import { useCardioStore } from '@/stores/cardio'
import { useDietStore } from '@/stores/diet'
import { useDetailsStore } from '@/stores/details'
import type { Cardio, Exercise, Food } from '@/lib/storage'
import type { Section } from '@/lib/trackerTypes'

// Today is Wednesday 21 October 2026: the current week starts on Monday 19 October.
const NOW = new Date(2026, 9, 21, 12)
const KS: Exercise = {
  id: 'ks',
  name: 'Kettlebell swings',
  sets: 3,
  reps: 15,
  weight: 16,
  target: 3,
  perSide: false,
}
const PU: Exercise = { id: 'pu', name: 'Push-ups', sets: 3, reps: 12, target: 4, perSide: false }
const PL: Exercise = { id: 'pl', name: 'Plank', duration: 45, reps: 0, perSide: true, target: 2 }
const NUTS: Food = { id: 'nuts', name: 'Nuts', target: 5 }
const FISH: Food = { id: 'fish', name: 'Fish', target: 2 }
const RUN: Cardio = { id: 'ru', name: 'Running', duration: 1800, distance: 5, target: 3 }
const RIDE: Cardio = { id: 'cy', name: 'Cycling', duration: 5430, target: 2 }

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  const planner = usePlannerStore()
  planner.now = NOW
  planner.plans = {
    '2026-10-05': [PL, PU],
    '2026-10-12': [{ ...KS }, { ...PU }],
    '2026-10-19': [{ ...KS }, { ...PU }],
  }
  planner.log = {
    '2026-10-19': { ks: ['great', null, 'partial', null, null, null, null] },
    '2026-10-12': { ks: ['great', 'great', null, 'missed', null, null, null] },
  }
  const diet = useDietStore()
  diet.plans = { '2026-10-12': [{ ...NUTS }, { ...FISH }], '2026-10-19': [{ ...FISH }] }
  useCardioStore().plans = { '2026-10-12': [{ ...RIDE }, { ...RUN }], '2026-10-19': [{ ...RUN }] }
  useDetailsStore().adopt({
    exercise: {
      ks: {
        notes: '**Hinge, don’t squat.**\n\n- Brace\n\n[Form video](https://example.com/ks)',
        fields: { equipment: '16 kg kettlebell' },
      },
    },
    cardio: { ru: { fields: { route: 'Round the park' } } },
    diet: {},
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

function mountPage(section: Section = 'exercise', itemId = 'ks', example = false): VueWrapper {
  wrapper = mount(ItemPage, { props: { section, itemId, example }, attachTo: document.body })
  return wrapper
}

const page = () => wrapper!.get('[data-testid="item-page"]')
const section = (id: string) => wrapper!.get(`[data-testid="item-${id}"]`)
const button = () => wrapper!.get<HTMLButtonElement>('[data-testid="item-notes-button"]')
const area = () => wrapper!.find<HTMLTextAreaElement>('textarea')
const field = (key: string) => wrapper!.get<HTMLInputElement>(`input[data-field="${key}"]`)
const stored = () => usePlannerStore().plans['2026-10-19']!.find((e) => e.id === 'ks')!

/** Type into an input as a person does: the value, then the input event. */
async function type(el: { setValue(value: string): Promise<void> }, text: string) {
  await el.setValue(text)
}

describe('the head', () => {
  it('links back to the week, then says the type, the name and the plan’s chips', () => {
    mountPage()
    const back = wrapper!.get('[data-testid="back-to-week"]')
    expect(back.attributes('href')).toBe('#/')
    expect(back.text()).toBe('Back to the week')
    expect(back.attributes('data-noprint')).toBeDefined()
    expect(wrapper!.get('[data-testid="item-type"]').text()).toBe('Exercise')
    const h1 = wrapper!.get('h1')
    expect(h1.text()).toBe('Kettlebell swings')
    expect(wrapper!.findAll('h1')).toHaveLength(1)
    expect(wrapper!.findAll('[data-testid="item-chip"]').map((c) => c.text())).toEqual([
      '3 × 15',
      '16 kg',
    ])
  })

  it('takes focus on its name as it arrives, unless it is a style-guide example', () => {
    mountPage()
    expect(document.activeElement).toBe(wrapper!.get('h1').element)
    expect(wrapper!.get('h1').attributes('tabindex')).toBe('-1')
    wrapper!.unmount()
    ;(document.activeElement as HTMLElement | null)?.blur()
    mountPage('exercise', 'ks', true)
    expect(document.activeElement).not.toBe(wrapper!.get('h1').element)
  })

  it('has the sections as rows in layout A’s order, the plan first, each labelled by its heading (K65, K104)', () => {
    mountPage()
    const sections = page().findAll('section')
    expect(sections.map((s) => s.get('h2').text())).toEqual([
      'This week’s plan',
      'Notes',
      'Details',
      'Recent weeks',
    ])
    for (const s of sections) {
      expect(s.attributes('aria-labelledby')).toBe(s.get('h2').attributes('id'))
      // Each a row of the page, like Settings' (K51): no column holds it, its heading sits in the
      // week's name column and its content beside it.
      expect(s.element.parentElement).toBe(page().element)
      expect(s.classes()).toContain('grid-cols-[var(--grid-name-w)_minmax(0,1fr)]')
      expect(s.element.firstElementChild!.tagName).toBe('H2')
      expect(s.element.children).toHaveLength(2)
    }
    // On paper: the head, Notes and Details; the plan and Recent weeks stay off it.
    expect(section('plan').attributes('data-noprint')).toBeDefined()
    expect(section('weeks').attributes('data-noprint')).toBeDefined()
    expect(section('notes').attributes('data-noprint')).toBeUndefined()
    expect(section('details').attributes('data-noprint')).toBeUndefined()
  })
})

describe('notes', () => {
  it('reads as written, markdown shown and links opening a new tab', () => {
    mountPage()
    const body = wrapper!.get('[data-testid="item-notes-body"]')
    expect(body.html()).toContain('<strong>Hinge, don’t squat.</strong>')
    expect(body.findAll('li').map((li) => li.text())).toEqual(['Brace'])
    const link = body.get('a')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(button().text()).toBe('Edit notes')
    expect(area().exists()).toBe(false)
  })

  it('turns into a field labelled by the heading, saving as you type, and Done turns it back', async () => {
    mountPage()
    await button().trigger('click')
    const ta = area()
    expect(document.activeElement).toBe(ta.element)
    expect(ta.element.selectionStart).toBe(ta.element.value.length)
    expect(ta.attributes('aria-labelledby')).toBe(section('notes').get('h2').attributes('id'))
    expect(section('notes').text()).toContain('Markdown works: **bold**, *italic*, lists, links.')
    expect(button().text()).toBe('Done')
    // Read view stays for paper only while editing.
    expect(wrapper!.get('[data-testid="item-notes-body"]').classes()).toContain('hidden')

    await type(ta, 'Hips drive the bell. ')
    expect(useDetailsStore().notesOf('exercise', 'ks')).toBe('Hips drive the bell.')
    // The draft keeps its trailing space while the stored copy is trimmed.
    expect(ta.element.value).toBe('Hips drive the bell. ')
    await type(ta, 'Hips drive the bell. Breathe')
    expect(useDetailsStore().notesOf('exercise', 'ks')).toBe('Hips drive the bell. Breathe')

    await button().trigger('click')
    expect(area().exists()).toBe(false)
    expect(wrapper!.get('[data-testid="item-notes-body"]').text()).toBe(
      'Hips drive the bell. Breathe',
    )
    expect(document.activeElement).toBe(button().element)
  })

  it('turns back on Escape in the field, with focus on Edit notes', async () => {
    mountPage()
    await button().trigger('click')
    await area().trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(area().exists()).toBe(false)
    expect(document.activeElement).toBe(button().element)
    expect(button().text()).toBe('Edit notes')
  })

  it('holds only “Add notes” when there are none, and the field opens empty', async () => {
    mountPage('exercise', 'pu')
    expect(wrapper!.find('[data-testid="item-notes-body"]').exists()).toBe(false)
    expect(button().text()).toBe('Add notes')
    await button().trigger('click')
    expect(area().element.value).toBe('')
    expect(area().attributes('placeholder')).toBeUndefined()
    await type(area(), 'Elbows in')
    await button().trigger('click')
    expect(button().text()).toBe('Edit notes')
    // Clearing them leaves only the button again.
    await button().trigger('click')
    await type(area(), '  ')
    await button().trigger('click')
    expect(button().text()).toBe('Add notes')
    expect(useDetailsStore().get('exercise', 'pu')).toEqual({})
  })

  it('counts from 19,000, and over 20,000 says so and saves nothing until they fit', async () => {
    mountPage()
    await button().trigger('click')
    await type(area(), 'a'.repeat(18_999))
    expect(section('notes').text()).not.toContain('of 20,000 characters')
    await type(area(), 'a'.repeat(19_620))
    expect(section('notes').text()).toContain('19,620 of 20,000 characters')
    await type(area(), 'b'.repeat(20_140))
    expect(section('notes').text()).toContain(
      'These notes are 20,140 characters. Shorten them to 20,000 or fewer to save them.',
    )
    expect(area().attributes('aria-invalid')).toBe('true')
    expect(useDetailsStore().notesOf('exercise', 'ks')).toBe('a'.repeat(19_620))
    await type(area(), 'b'.repeat(20_000))
    expect(area().attributes('aria-invalid')).toBeUndefined()
    expect(useDetailsStore().notesOf('exercise', 'ks')).toBe('b'.repeat(20_000))
  })

  it('says when notes within the limit are still too big to save (32 KB)', async () => {
    mountPage()
    await button().trigger('click')
    // 12,000 characters of three bytes each: within 20,000, over the API's 32 KB.
    await type(area(), '€'.repeat(12_000))
    expect(section('notes').text()).toContain(
      'These notes are too long to save. Shorten them, then save again.',
    )
    expect(useDetailsStore().notesOf('exercise', 'ks')).toContain('Hinge')
  })

  it('says an item whose id has a slash can’t keep notes, and saves nothing', async () => {
    usePlannerStore().plans['2026-10-19']!.push({ ...PU, id: 'a/b', name: 'Slashed' })
    mountPage('exercise', 'a/b')
    await button().trigger('click')
    await type(area(), 'Elbows in')
    expect(section('notes').text()).toContain(
      'This item’s notes can’t be saved: its id has a slash in it.',
    )
    expect(useDetailsStore().get('exercise', 'a/b')).toEqual({})
    await type(field('works'), 'Chest')
    expect(section('details').text()).toContain(
      'This item’s details can’t be saved: its id has a slash in it.',
    )
  })

  it('takes the stored copy when it changes from elsewhere while being edited (a 409)', async () => {
    mountPage()
    await button().trigger('click')
    await type(area(), 'Mine')
    // The server's copy comes in after a conflict (sync's adoptTheirDetails).
    useDetailsStore().adoptItem('exercise', 'ks', { notes: 'Theirs' })
    await nextTick()
    expect(area().element.value).toBe('Theirs')
    // The next keystroke builds on the server's version rather than overwriting it.
    await type(area(), 'Theirs, and more')
    expect(useDetailsStore().notesOf('exercise', 'ks')).toBe('Theirs, and more')
    // An error from a draft too long goes when the stored copy replaces it.
    await type(area(), 'x'.repeat(20_001))
    useDetailsStore().adoptItem('exercise', 'ks', null)
    await nextTick()
    expect(area().element.value).toBe('')
    expect(area().attributes('aria-invalid')).toBeUndefined()
  })
})

describe('details', () => {
  it('shows the type’s fields from the registry, each saving as you type', async () => {
    mountPage()
    const labels = section('details')
      .findAll('label')
      .map((l) => l.text())
    expect(labels).toEqual(['Equipment', 'Works', 'Link'])
    expect(field('equipment').element.value).toBe('16 kg kettlebell')
    await type(field('works'), 'Glutes, hamstrings ')
    expect(useDetailsStore().fieldOf('exercise', 'ks', 'works')).toBe('Glutes, hamstrings')
    expect(field('works').element.value).toBe('Glutes, hamstrings ')
    // Link takes a row of its own.
    expect(field('link').element.closest('div.col-span-full')).not.toBeNull()
  })

  it('says a field over 500 characters is too long, and saves nothing until it fits', async () => {
    mountPage()
    await type(field('works'), 'w'.repeat(540))
    expect(section('details').text()).toContain(
      'This is 540 characters. Shorten it to 500 or fewer to save it.',
    )
    expect(useDetailsStore().fieldOf('exercise', 'ks', 'works')).toBe('')
    await type(field('works'), 'w'.repeat(500))
    expect(field('works').attributes('aria-invalid')).toBeUndefined()
    expect(useDetailsStore().fieldOf('exercise', 'ks', 'works')).toBe('w'.repeat(500))
  })

  it('says when a field fits but the item’s details would be too big to save', async () => {
    useDetailsStore().setNotes('exercise', 'ks', '€'.repeat(10_500))
    mountPage()
    await type(field('works'), '€'.repeat(500))
    expect(section('details').text()).toContain(
      'These details are too long to save. Shorten them or the notes, then save again.',
    )
  })

  it('offers a web address in the Link field as a link to a new tab, and nothing else', async () => {
    mountPage()
    expect(wrapper!.find('[data-testid="item-link-open"]').exists()).toBe(false)
    await type(field('link'), 'https://www.youtube.com/watch?v=swing-form')
    const open = wrapper!.get('[data-testid="item-link-open"]')
    expect(open.text()).toBe('Open youtube.com in a new tab')
    expect(open.attributes('href')).toBe('https://www.youtube.com/watch?v=swing-form')
    expect(open.attributes('target')).toBe('_blank')
    expect(open.attributes('rel')).toBe('noopener noreferrer')
    await type(field('link'), 'javascript:alert(1)')
    expect(wrapper!.find('[data-testid="item-link-open"]').exists()).toBe(false)
  })

  it('takes a field’s stored copy when it changes from elsewhere', async () => {
    mountPage()
    await type(field('works'), 'w'.repeat(501))
    useDetailsStore().adoptItem('exercise', 'ks', { fields: { works: 'Grip' } })
    await nextTick()
    expect(field('works').element.value).toBe('Grip')
    expect(field('equipment').element.value).toBe('')
    expect(field('works').attributes('aria-invalid')).toBeUndefined()
  })

  it('prints each filled field as its label over its value', async () => {
    mountPage()
    const paper = section('details').get('dl')
    expect(paper.classes()).toContain('print:flex')
    expect(paper.findAll('dt').map((d) => d.text())).toEqual(['Equipment'])
    expect(paper.get('dd').text()).toBe('16 kg kettlebell')
  })
})

describe('this week’s plan', () => {
  it('says what it changes, and has the Edit dialog’s controls without Name and Note', () => {
    mountPage()
    const plan = section('plan')
    expect(wrapper!.get('[data-testid="item-plan-line"]').text()).toBe(
      'Changes this week’s plan, and the weeks after it that have no plan of their own.',
    )
    expect(
      plan
        .findAll('label, [data-slot="segmented-control-label"], [data-slot="stepper-label"]')
        .map((l) => l.text()),
    ).toEqual(['Sets', 'Measure', 'Reps', 'Weight in kg', 'Reps count', 'Times a week'])
    expect(field('sets').element.value).toBe('3')
    expect(field('reps').element.value).toBe('15')
    expect(field('weight').element.value).toBe('16')
    expect(field('weight').attributes('placeholder')).toBe('Bodyweight')
    expect(plan.find('input[id$="-name"]').exists()).toBe(false)
    plan.get('button[aria-label="More times a week"]')
  })

  it('applies each change to this week’s plan at once', async () => {
    mountPage()
    await type(field('sets'), '4')
    expect(stored().sets).toBe(4)
    await type(field('reps'), '20')
    expect(stored().reps).toBe(20)
    await type(field('weight'), '20,5')
    expect(field('weight').element.value).toBe('20.5')
    expect(stored().weight).toBe(20.5)
    await section('plan')
      .findAll('button')
      .find((b) => b.text() === 'Each side')!
      .trigger('click')
    expect(stored().perSide).toBe(true)
    await section('plan')
      .findAll('button')
      .find((b) => b.text() === 'Time')!
      .trigger('click')
    expect(stored().duration).toBe(20)
    expect(section('plan').text()).toContain('Seconds')
    expect(section('plan').text()).toContain('Timed')
    await section('plan').get('button[aria-label="More times a week"]').trigger('click')
    expect(stored().target).toBe(4)
    // The chips in the head follow.
    expect(wrapper!.findAll('[data-testid="item-chip"]').map((c) => c.text())).toEqual([
      '4 × 20 s each side',
      '20.5 kg',
    ])
    // The week before keeps its own plan.
    expect(usePlannerStore().plans['2026-10-12']![0]!.sets).toBe(3)
  })

  it('shows the TextField’s error for a number that isn’t valid, and changes nothing', async () => {
    mountPage()
    await type(field('sets'), '25')
    expect(section('plan').text()).toContain(
      'This is 25 sets. Enter 20 or fewer to change the plan.',
    )
    expect(field('sets').attributes('aria-invalid')).toBe('true')
    expect(stored().sets).toBe(3)
    await type(field('sets'), '5')
    expect(stored().sets).toBe(5)
    await type(field('weight'), '600')
    expect(section('plan').text()).toContain(
      'This is 600 kg. Enter 500 or fewer to change the plan.',
    )
    expect(stored().weight).toBe(16)
    await type(field('weight'), '')
    expect(stored().weight).toBeUndefined()
    await section('plan')
      .findAll('button')
      .find((b) => b.text() === 'Time')!
      .trigger('click')
    await type(field('reps'), '4000')
    expect(section('plan').text()).toContain(
      'This is 4,000 seconds. Enter 3,600 or fewer to change the plan.',
    )
    expect(stored().duration).toBe(15)
  })

  it('reloads its controls when the plan changes from elsewhere', async () => {
    mountPage()
    await type(field('sets'), '25')
    usePlannerStore().updateExercise('ks', { ...KS, perSide: false, sets: 6 })
    await nextTick()
    expect(field('sets').element.value).toBe('6')
    expect(field('sets').attributes('aria-invalid')).toBeUndefined()
  })

  it('names another week when opened from one', () => {
    usePlannerStore().prevWeek()
    mountPage()
    expect(section('plan').get('h2').text()).toBe('Plan for the week of 12 October')
    expect(wrapper!.get('[data-testid="item-plan-line"]').text()).toBe(
      'Changes the plan for the week of 12 October, and the weeks after it that have no plan of their own.',
    )
  })

  it('has Times a week alone for a food, through the food’s goal', async () => {
    mountPage('diet', 'fish')
    expect(wrapper!.get('[data-testid="item-type"]').text()).toBe('Food')
    expect(wrapper!.findAll('[data-testid="item-chip"]')).toHaveLength(0)
    const plan = section('plan')
    expect(plan.findAll('input[data-field]')).toHaveLength(0)
    expect(plan.find('[data-slot="segmented-control"]').exists()).toBe(false)
    await plan.get('button[aria-label="Fewer times a week"]').trigger('click')
    expect(useDietStore().plans['2026-10-19']![0]!.target).toBe(1)
    expect(
      section('details')
        .findAll('label')
        .map((l) => l.text()),
    ).toEqual(['A serving', 'Examples'])
    expect(wrapper!.find('[data-testid="item-link-open"]').exists()).toBe(false)
  })
})

describe('a cardio item (K90)', () => {
  const runs = () => useCardioStore().plans['2026-10-19']!

  it('has its type, chips, Minutes and Distance in km, and the goal; Route and Link as details', () => {
    mountPage('cardio', 'ru')
    expect(wrapper!.get('[data-testid="item-type"]').text()).toBe('Cardio')
    expect(wrapper!.findAll('[data-testid="item-chip"]').map((c) => c.text())).toEqual([
      '30 min',
      '5 km',
    ])
    const plan = section('plan')
    expect(plan.findAll('label, [data-slot="stepper-label"]').map((l) => l.text())).toEqual([
      'Minutes',
      'Distance in km',
      'Times a week',
    ])
    expect(field('minutes').element.value).toBe('30')
    expect(field('distance').element.value).toBe('5')
    expect(plan.find('[data-slot="segmented-control"]').exists()).toBe(false)
    expect(
      section('details')
        .findAll('label')
        .map((l) => l.text()),
    ).toEqual(['Route', 'Link'])
    expect(field('route').element.value).toBe('Round the park')
  })

  it('applies each change to this week’s plan at once, blank leaving an amount out', async () => {
    mountPage('cardio', 'ru')
    await type(field('minutes'), '42.5')
    expect(runs()[0]!.duration).toBe(2550)
    await type(field('distance'), '7,25')
    expect(field('distance').element.value).toBe('7.25')
    expect(runs()[0]!.distance).toBe(7.25)
    await type(field('minutes'), '')
    expect(runs()[0]).toEqual({ id: 'ru', name: 'Running', distance: 7.25, target: 3 })
    await section('plan').get('button[aria-label="More times a week"]').trigger('click')
    expect(runs()[0]!.target).toBe(4)
    expect(wrapper!.findAll('[data-testid="item-chip"]').map((c) => c.text())).toEqual(['7.25 km'])
    // The week before keeps its own plan.
    expect(useCardioStore().plans['2026-10-12']![1]).toEqual(RUN)
  })

  it('says when a time or a distance is over its limit, and changes nothing', async () => {
    mountPage('cardio', 'ru')
    await type(field('minutes'), '1500')
    expect(section('plan').text()).toContain(
      'This is 1,500 minutes. Enter 1,440 or fewer to change the plan.',
    )
    expect(field('minutes').attributes('aria-invalid')).toBe('true')
    await type(field('distance'), '1200')
    expect(section('plan').text()).toContain(
      'This is 1,200 km. Enter 1,000 or fewer to change the plan.',
    )
    expect(runs()[0]).toEqual(RUN)
    await type(field('minutes'), '20')
    expect(runs()[0]).toEqual(RUN)
    await type(field('distance'), '4')
    expect(runs()[0]).toEqual({ ...RUN, duration: 1200, distance: 4 })
  })

  it('reloads its controls when the plan changes from elsewhere', async () => {
    mountPage('cardio', 'ru')
    await type(field('minutes'), '5000')
    useCardioStore().updateCardio('ru', { name: 'Running', duration: 1830 })
    await nextTick()
    expect(field('minutes').element.value).toBe('30.5')
    expect(field('minutes').attributes('aria-invalid')).toBeUndefined()
    expect(field('distance').element.value).toBe('')
  })

  it('shows its latest plan as words when it isn’t in the week', () => {
    mountPage('cardio', 'cy')
    const dl = section('plan').get('dl')
    expect(dl.findAll('div').map((d) => [d.get('dt').text(), d.get('dd').text()])).toEqual([
      ['Minutes', '90.5'],
      ['Times a week', '2'],
    ])
    expect(wrapper!.findAll('[data-testid="item-chip"]').map((c) => c.text())).toEqual([
      '90 min 30 s',
    ])
    useCardioStore().plans['2026-10-12']![0] = {
      id: 'cy',
      name: 'Cycling',
      distance: 40,
      target: 2,
    }
  })

  it('writes only the distance of a latest plan with no time', async () => {
    useCardioStore().plans['2026-10-12']![0] = {
      id: 'cy',
      name: 'Cycling',
      distance: 40,
      target: 2,
    }
    mountPage('cardio', 'cy')
    expect(
      section('plan')
        .get('dl')
        .findAll('div')
        .map((d) => [d.get('dt').text(), d.get('dd').text()]),
    ).toEqual([
      ['Distance in km', '40'],
      ['Times a week', '2'],
    ])
  })

  it('names cardio pages in its arranging line', async () => {
    mountPage('cardio', 'ru')
    await wrapper!.get('[data-testid="item-arrange"]').trigger('click')
    expect(wrapper!.get('[data-testid="item-arrange-line"]').text()).toBe(
      'Choose which sections every cardio page shows, and their order. Changes apply at once.',
    )
  })
})

describe('an item not in the week', () => {
  it('shows its latest plan as words, read-only, and its chips from that plan', () => {
    usePlannerStore().plans['2026-10-19'] = [{ ...PU }]
    mountPage()
    const plan = section('plan')
    expect(plan.get('h2').text()).toBe('Latest plan')
    expect(wrapper!.get('[data-testid="item-plan-line"]').text()).toBe(
      'Kettlebell swings isn’t in this week’s plan. This is its plan from the week of 12 October.',
    )
    const dl = plan.get('[data-testid="item-latest-plan"]')
    expect(dl.element.tagName).toBe('DL')
    expect(dl.findAll('div').map((d) => [d.get('dt').text(), d.get('dd').text()])).toEqual([
      ['Sets', '3'],
      ['Measure', 'Reps'],
      ['Reps', '15'],
      ['Weight in kg', '16'],
      ['Reps count', 'Per set'],
      ['Times a week', '3'],
    ])
    expect(plan.findAll('input, button')).toHaveLength(0)
    expect(wrapper!.findAll('[data-testid="item-chip"]').map((c) => c.text())).toEqual([
      '3 × 15',
      '16 kg',
    ])
    // Notes and details work as usual.
    expect(button().text()).toBe('Edit notes')
    expect(field('equipment').element.value).toBe('16 kg kettlebell')
  })

  it('writes a timed exercise’s settings, and names another week it was opened from', () => {
    usePlannerStore().prevWeek()
    mountPage('exercise', 'pl')
    expect(wrapper!.get('[data-testid="item-plan-line"]').text()).toBe(
      'Plank isn’t in the plan for the week of 12 October. This is its plan from the week of 5 October.',
    )
    const dl = section('plan').get('dl')
    expect(dl.findAll('div').map((d) => [d.get('dt').text(), d.get('dd').text()])).toEqual([
      ['Measure', 'Time'],
      ['Seconds', '45'],
      ['Weight in kg', 'Bodyweight'],
      ['Timed', 'Each side'],
      ['Times a week', '2'],
    ])
  })

  it('leaves out an exercise’s missing amount, and has only the goal for a food', () => {
    usePlannerStore().plans['2026-10-12']!.push({
      id: 'st',
      name: 'Stretch',
      reps: 0,
      perSide: false,
      target: 1,
    })
    mountPage('exercise', 'st')
    expect(
      section('plan')
        .findAll('dt')
        .map((d) => d.text()),
    ).toEqual(['Measure', 'Weight in kg', 'Reps count', 'Times a week'])
    wrapper!.unmount()
    mountPage('diet', 'nuts')
    expect(
      section('plan')
        .findAll('dt')
        .map((d) => d.text()),
    ).toEqual(['Times a week'])
  })

  it('shows nothing once no plan holds it', async () => {
    mountPage()
    const planner = usePlannerStore()
    planner.plans = { '2026-10-19': [{ ...PU }] }
    await nextTick()
    expect(wrapper!.find('[data-testid="item-page"]').exists()).toBe(false)
  })
})

describe('recent weeks', () => {
  it('shows eight weeks ending with the week opened, from the log and each week’s plan', () => {
    mountPage()
    const weeks = section('weeks')
    const lines = weeks.findAll('[data-testid="recent-week"]')
    // Kettlebell swings first appeared in the 12 October plan.
    expect(lines).toHaveLength(2)
    expect(lines[0]!.attributes('aria-current')).toBe('date')
    // Every mark counts, missed too: "red is still a done mark" (C11, K65). The week of 12 October
    // has two great days and a missed one, so it met its goal of three.
    expect(lines.map((l) => l.get('[data-testid="recent-week-count"]').text())).toEqual([
      '2 of 3',
      '3 of 3, goal met',
    ])
    expect(weeks.get('ol').attributes('aria-labelledby')).toBe(weeks.get('h2').attributes('id'))
    expect(weeks.get('[data-testid="recent-weeks-line"]').text()).toBe(
      'The goal was met in one of the last two weeks.',
    )
  })

  it('reads the default plan for an item while nothing is planned', () => {
    usePlannerStore().plans = {}
    mountPage('exercise', 'pu')
    expect(section('weeks').findAll('[data-testid="recent-week"]')).toHaveLength(8)
    expect(section('plan').get('h2').text()).toBe('This week’s plan')
  })
})

describe('arranging the sections (K66)', () => {
  const arrange = () => wrapper!.get<HTMLButtonElement>('[data-testid="item-arrange"]')
  const headings = () =>
    page()
      .findAll('section h2')
      .map((h) => h.text())
  const control = (label: string) =>
    wrapper!.get<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const toggle = (heading: string) =>
    page()
      .findAll<HTMLButtonElement>('[role="switch"]')
      .find((s) => s.text() === `Show ${heading}`)!

  it('has Arrange sections at the right of the head’s first line, a quiet Button', () => {
    mountPage()
    expect(arrange().text()).toBe('Arrange sections')
    expect(arrange().attributes('data-variant')).toBe('quiet')
    expect(arrange().find('svg').exists()).toBe(true)
    expect(arrange().attributes('data-noprint')).toBeDefined()
    // Back at the left, the button at the right, on one line.
    const line = arrange().element.parentElement!
    expect(line.firstElementChild).toBe(wrapper!.get('[data-testid="back-to-week"]').element)
    expect(line.lastElementChild).toBe(arrange().element)
  })

  it('shows only the shown sections, in the type’s order, on every page of the type', () => {
    usePlannerStore().setArrangement('exercise', {
      order: ['history', 'notes', 'details', 'plan'],
      hidden: ['details'],
    })
    mountPage()
    expect(headings()).toEqual(['Recent weeks', 'Notes', 'This week’s plan'])
    expect(wrapper!.find('[data-testid="item-details"]').exists()).toBe(false)
    wrapper!.unmount()
    mountPage('exercise', 'pu')
    expect(headings()).toEqual(['Recent weeks', 'Notes', 'This week’s plan'])
    // A food's page has its own, still the default.
    wrapper!.unmount()
    mountPage('diet', 'fish')
    expect(headings()).toEqual(['This week’s plan', 'Notes', 'Details', 'Recent weeks'])
  })

  it('lists every section with Show, Move up and Move down; focus stays on the button', async () => {
    usePlannerStore().setArrangement('exercise', {
      order: ['notes', 'details', 'plan', 'history'],
      hidden: ['details'],
    })
    mountPage()
    arrange().element.focus()
    await arrange().trigger('click')
    expect(arrange().text()).toBe('Done')
    expect(document.activeElement).toBe(arrange().element)
    expect(wrapper!.get('[data-testid="item-arrange-line"]').text()).toBe(
      'Choose which sections every exercise page shows, and their order. Changes apply at once.',
    )
    expect(headings()).toEqual(['Notes', 'Details', 'This week’s plan', 'Recent weeks'])
    for (const row of page().findAll('section')) {
      const name = row.get('h2').text()
      expect(row.attributes('aria-labelledby')).toBe(row.get('h2').attributes('id'))
      const sw = row.get('[role="switch"]')
      expect(sw.text()).toBe(`Show ${name}`)
      expect(sw.attributes('aria-checked')).toBe(String(name !== 'Details'))
      expect(row.find(`button[aria-label="Move ${name} up"]`).exists()).toBe(true)
      expect(row.find(`button[aria-label="Move ${name} down"]`).exists()).toBe(true)
      expect(row.get('[data-testid="item-arrange-state"]').text()).toBe(
        name === 'Details' ? 'Hidden' : 'Shown',
      )
      // Arranging shows no section's content.
      expect(row.find('input, textarea, ol').exists()).toBe(false)
    }
    // At the ends, the move is aria-disabled rather than disabled, so focus stays on it.
    expect(control('Move Notes up').attributes('aria-disabled')).toBe('true')
    expect(control('Move Notes up').attributes('disabled')).toBeUndefined()
    expect(control('Move Recent weeks down').attributes('aria-disabled')).toBe('true')
    expect(control('Move Notes down').attributes('aria-disabled')).toBeUndefined()
    await arrange().trigger('click')
    expect(arrange().text()).toBe('Arrange sections')
    expect(document.activeElement).toBe(arrange().element)
    expect(headings()).toEqual(['Notes', 'This week’s plan', 'Recent weeks'])
  })

  it('names food pages in a food’s line', async () => {
    mountPage('diet', 'fish')
    await arrange().trigger('click')
    expect(wrapper!.get('[data-testid="item-arrange-line"]').text()).toBe(
      'Choose which sections every food page shows, and their order. Changes apply at once.',
    )
  })

  it('shows and hides a section at once, for every page of the type', async () => {
    mountPage()
    await arrange().trigger('click')
    await toggle('Details').trigger('click')
    expect(usePlannerStore().arrangementFor('exercise').hidden).toEqual(['details'])
    expect(usePlannerStore().arrangementFor('food').hidden).toEqual([])
    expect(toggle('Details').attributes('aria-checked')).toBe('false')
    expect(section('details').get('[data-testid="item-arrange-state"]').text()).toBe('Hidden')
    await toggle('Details').trigger('click')
    expect(usePlannerStore().itemSections).toEqual({})
  })

  it('moves a section, keeping focus on its same button, or the other at an end', async () => {
    mountPage()
    await arrange().trigger('click')
    control('Move Recent weeks up').element.focus()
    await control('Move Recent weeks up').trigger('click')
    await nextTick()
    expect(headings()).toEqual(['This week’s plan', 'Notes', 'Recent weeks', 'Details'])
    expect(document.activeElement).toBe(control('Move Recent weeks up').element)
    await control('Move Recent weeks up').trigger('click')
    await control('Move Recent weeks up').trigger('click')
    await nextTick()
    expect(headings()).toEqual(['Recent weeks', 'This week’s plan', 'Notes', 'Details'])
    // At the top its Move up is at an end, so focus goes to its Move down.
    expect(control('Move Recent weeks up').attributes('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(control('Move Recent weeks down').element)
    // A press at an end does nothing.
    await control('Move Recent weeks up').trigger('click')
    await control('Move Details down').trigger('click')
    expect(headings()).toEqual(['Recent weeks', 'This week’s plan', 'Notes', 'Details'])
    expect(usePlannerStore().arrangementFor('exercise').order).toEqual([
      'history',
      'plan',
      'notes',
      'details',
    ])
    await control('Move This week’s plan down').trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(control('Move This week’s plan down').element)
    expect(headings()).toEqual(['Recent weeks', 'Notes', 'This week’s plan', 'Details'])
  })

  it('leaves arranging on Escape, with focus on the button', async () => {
    mountPage()
    await arrange().trigger('click')
    const sw = toggle('Notes')
    sw.element.focus()
    await sw.trigger('keydown', { key: 'a' })
    expect(arrange().text()).toBe('Done')
    await sw.trigger('keydown', { key: 'Escape' })
    expect(arrange().text()).toBe('Arrange sections')
    expect(document.activeElement).toBe(arrange().element)
    expect(page().find('[role="switch"]').exists()).toBe(false)
  })

  it('says when every section is hidden', async () => {
    mountPage()
    expect(wrapper!.find('[data-testid="item-all-hidden"]').exists()).toBe(false)
    await arrange().trigger('click')
    for (const name of ['Notes', 'Details', 'This week’s plan', 'Recent weeks']) {
      await toggle(name).trigger('click')
    }
    expect(wrapper!.find('[data-testid="item-all-hidden"]').exists()).toBe(false)
    await arrange().trigger('click')
    expect(page().findAll('section')).toHaveLength(0)
    expect(wrapper!.get('[data-testid="item-all-hidden"]').text()).toBe(
      'Every section is hidden. Arrange sections to show one.',
    )
  })
})

describe('in Edit plan: the name and Remove on the page (K104)', () => {
  let host: VueWrapper | undefined
  beforeEach(() => {
    usePlannerStore().setConfigMode(true)
    host = mount(ConfirmHost, { attachTo: document.body })
  })
  afterEach(() => {
    host?.unmount()
    host = undefined
    history.replaceState(null, '', '/')
  })

  const nameField = () => wrapper!.get<HTMLInputElement>('[data-testid="item-name-field"]')
  /** Answers the open question with the button of this name. */
  async function answer(label: string): Promise<void> {
    await flushPromises()
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!
    ;[...dialog.querySelectorAll('button')].find((b) => b.textContent === label)!.click()
    await flushPromises()
  }

  it('turns the title into a Name field, drops the chips, and ends with Remove', () => {
    mountPage()
    expect(nameField().element.value).toBe('Kettlebell swings')
    // The h1 stays for a screen reader and for focus, out of sight.
    expect(wrapper!.get('h1').classes()).toContain('sr-only')
    expect(wrapper!.findAll('[data-testid="item-chip"]')).toHaveLength(0)
    const sections = page().findAll('section')
    expect(sections.at(-1)!.attributes('data-testid')).toBe('item-remove')
    expect(section('remove').text()).toContain(
      'Takes Kettlebell swings off this week’s plan. Weeks with their own plan keep it, and its marks stay.',
    )
    expect(section('remove').get('button').text()).toBe('Remove from this week')
  })

  it('shows neither outside Edit plan, nor for an item not in the week, nor while arranging', async () => {
    usePlannerStore().setConfigMode(false)
    mountPage()
    expect(wrapper!.find('[data-testid="item-name-field"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="item-remove"]').exists()).toBe(false)
    expect(wrapper!.get('h1').classes()).not.toContain('sr-only')
    wrapper!.unmount()
    usePlannerStore().setConfigMode(true)
    mountPage('diet', 'nuts') // in an older week's plan only
    expect(wrapper!.find('[data-testid="item-name-field"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="item-remove"]').exists()).toBe(false)
    wrapper!.unmount()
    mountPage()
    await wrapper!.get('[data-testid="item-arrange"]').trigger('click')
    expect(wrapper!.find('[data-testid="item-remove"]').exists()).toBe(false)
  })

  it('renames the item as you type, keeping its plan; an empty name waits with an error', async () => {
    mountPage()
    await type(nameField(), 'Swings')
    expect(stored()).toEqual({ ...KS, name: 'Swings' })
    await type(nameField(), '   ')
    expect(stored().name).toBe('Swings')
    expect(wrapper!.text()).toContain('Enter a name.')
    expect(nameField().attributes('aria-invalid')).toBe('true')
    await type(nameField(), 'Two-hand swings ')
    expect(stored().name).toBe('Two-hand swings')
    expect(nameField().attributes('aria-invalid')).toBeUndefined()
  })

  it('renames a cardio item and a food the same way', async () => {
    mountPage('cardio', 'ru')
    await type(nameField(), 'Jogging')
    expect(useCardioStore().items.find((c) => c.id === 'ru')).toEqual({ ...RUN, name: 'Jogging' })
    wrapper!.unmount()
    mountPage('diet', 'fish')
    await type(nameField(), 'Salmon')
    expect(useDietStore().foods).toEqual([{ ...FISH, name: 'Salmon' }])
  })

  it('renames an exercise saved without a per-side count as counted per set', async () => {
    const { perSide: _, ...bare } = KS
    usePlannerStore().plans['2026-10-19'] = [bare as Exercise]
    mountPage()
    await type(nameField(), 'Swings')
    expect(stored()).toEqual({ ...KS, name: 'Swings' })
  })

  it('keeps the field as it is when another tab takes the item out of the week', async () => {
    mountPage()
    usePlannerStore().removeExercise('ks')
    await nextTick()
    // The page shows its latest plan now, read-only, with no Name field.
    expect(wrapper!.find('[data-testid="item-name-field"]').exists()).toBe(false)
    expect(wrapper!.get('h1').text()).toBe('Kettlebell swings')
  })

  it('takes a rename from elsewhere into the field', async () => {
    mountPage()
    usePlannerStore().updateExercise('ks', { ...KS, perSide: false, name: 'KB swings' })
    await nextTick()
    expect(nameField().element.value).toBe('KB swings')
    // A change to something else leaves the field alone.
    usePlannerStore().changeTarget('ks', 1)
    await nextTick()
    expect(nameField().element.value).toBe('KB swings')
  })

  it('asks before Remove; Cancel keeps the item, Remove takes it off and goes to the week', async () => {
    history.replaceState(null, '', '/#/item/exercise/ks')
    mountPage()
    await section('remove').get('button').trigger('click')
    await flushPromises()
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(dialog.querySelector('h2')!.textContent).toBe('Remove Kettlebell swings?')
    await answer('Cancel')
    expect(usePlannerStore().exercises.map((e) => e.id)).toEqual(['ks', 'pu'])
    await section('remove').get('button').trigger('click')
    await answer('Remove')
    expect(usePlannerStore().exercises.map((e) => e.id)).toEqual(['pu'])
    expect(location.hash).toBe('#/')
  })

  it('removes a cardio item and a food from this week only', async () => {
    mountPage('cardio', 'ru')
    await section('remove').get('button').trigger('click')
    await answer('Remove')
    expect(useCardioStore().items).toEqual([])
    expect(useCardioStore().plans['2026-10-12']).toHaveLength(2)
    wrapper!.unmount()
    mountPage('diet', 'fish')
    await section('remove').get('button').trigger('click')
    await answer('Remove')
    expect(useDietStore().foods).toEqual([])
  })

  it('removes nothing when the week changes while it asks', async () => {
    mountPage()
    await section('remove').get('button').trigger('click')
    await flushPromises()
    usePlannerStore().weekOffset = -1
    await answer('Remove')
    expect(usePlannerStore().plans['2026-10-19']!.map((e) => e.id)).toEqual(['ks', 'pu'])
  })
})
