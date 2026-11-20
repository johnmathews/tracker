import { settle } from '@/components/ui/__tests__/setup'
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { readProgrammeFixture } from '@/lib/__tests__/fixtures'
import ValueField from '@/components/ValueField.vue'
import { loadDraft, type ProgrammeDoc, type Value } from '@/lib/programmeDraft'
import type { Field } from '@/lib/programmes'

const BEGINNER = loadDraft(readProgrammeFixture('valid/beginner-5x5.json'))
const CARDIO = loadDraft(readProgrammeFixture('valid/cardio.json'))

type Props = InstanceType<typeof ValueField>['$props']

/** A ValueField whose updates come back to it as its value, as an ActivityCard writes them. */
function field(props: Partial<Props> & { field: Field }, doc: ProgrammeDoc = BEGINNER) {
  // eslint-disable-next-line prefer-const -- the handler reads it once the field is mounted
  let wrapper: VueWrapper
  const onUpdate = (v: Value | undefined) => wrapper.setProps({ value: v })
  wrapper = mount(ValueField, {
    props: {
      doc,
      value: undefined,
      optional: false,
      activity: 'Plank',
      open: true,
      problems: [],
      onUpdate,
      ...props,
    } as Props,
    attachTo: document.body,
  })
  return wrapper
}

const updates = (w: VueWrapper) => (w.emitted('update') ?? []).map((e) => e[0])
const input = (w: VueWrapper, id: string) =>
  w.get<HTMLInputElement>(`[data-testid="${id}"] input, input[data-testid="${id}"]`)
const segment = (w: VueWrapper, id: string, label: string) =>
  w.findAll(`[data-testid="${id}"] button`).find((b) => b.text() === label)!

/** A primary-button press, as Reka's menu trigger hears it. */
async function press(target: Element): Promise<void> {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  ;(target as HTMLElement).click()
  await settle()
}

describe('ValueField, closed', () => {
  it('says its name and its shape in words, and asks to open on a press', async () => {
    const w = field({
      field: 'duration',
      value: { start: 30, add: 5, every: 2, max: 90 },
      open: false,
    })
    const line = w.get('[data-testid="value-line"]')
    expect(line.attributes('data-field')).toBe('duration')
    const button = line.get('button')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(button.text()).toContain('Hold')
    expect(button.text()).toContain('30 s, +5 s every 2 weeks, up to 90 s')
    expect(w.find('[role="group"]').exists()).toBe(false)
    await button.trigger('click')
    expect(w.emitted('toggle')).toHaveLength(1)
  })

  it('reads a value left out as None, in ink-secondary', () => {
    const w = field({ field: 'weight', optional: true, open: false })
    const words = w.get('[data-slot="value-words"]')
    expect(words.text()).toBe('None')
    expect(words.classes()).toContain('text-ink-secondary')
  })

  it('reads Times a week left out as 3, as the format does', () => {
    const w = field({ field: 'target', open: false })
    expect(w.get('[data-slot="value-words"]').text()).toBe('3')
  })

  it('shows a whole-value problem under its words, tied to the line', () => {
    const message = 'Week 6 comes to 510 kg. The most is 500.'
    const w = field({
      field: 'weight',
      value: { start: 60, add: 90 },
      open: false,
      problems: [{ sub: null, message }],
    })
    const error = w.get('[data-testid="value-error"]')
    expect(error.text()).toBe(message)
    expect(w.get('[data-testid="value-line"] button').attributes('aria-describedby')).toBe(
      error.attributes('id'),
    )
  })
})

describe('ValueField, open', () => {
  it('opens into a group named for the value, the line saying it is open', () => {
    const w = field({ field: 'sets', value: 3, optional: true })
    const button = w.get('[data-testid="value-line"] button')
    expect(button.attributes('aria-expanded')).toBe('true')
    const group = w.get('[role="group"][aria-label="Sets"]')
    expect(button.attributes('aria-controls')).toBe(group.attributes('id'))
    const shapes = w.findAll('[data-testid="value-shape"] button').map((b) => b.text())
    expect(shapes).toEqual(['None', 'Stays the same', 'Grows'])
    expect(segment(w, 'value-shape', 'Stays the same').attributes('aria-pressed')).toBe('true')
  })

  it('offers no None where the activity can’t go without the value', () => {
    const w = field({ field: 'reps', value: 5 })
    const shapes = w.findAll('[data-testid="value-shape"] button').map((b) => b.text())
    expect(shapes).toEqual(['Stays the same', 'Grows'])
  })

  it('writes a number typed in Value; a word is refused there, and nothing is written', async () => {
    const w = field({ field: 'sets', value: 3, optional: true })
    const value = input(w, 'value-start')
    expect(value.element.value).toBe('3')
    expect(value.attributes('inputmode')).toBe('numeric')
    await value.setValue('4')
    expect(updates(w)).toEqual([4])
    await value.setValue('four')
    expect(updates(w)).toEqual([4])
    expect(value.attributes('aria-invalid')).toBe('true')
    expect(w.text()).toContain('Type a number, like 3.')
    await value.setValue('')
    expect(updates(w)).toEqual([4])
    await value.setValue('5')
    expect(updates(w)).toEqual([4, 5])
    expect(value.attributes('aria-invalid')).toBeUndefined()
  })

  it('reads a decimal comma as a point', async () => {
    const w = field({ field: 'weight', value: 20, optional: true })
    await input(w, 'value-start').setValue('22,5')
    expect(updates(w)).toEqual([22.5])
    expect(input(w, 'value-start').attributes('inputmode')).toBe('decimal')
  })

  it('writes Times a week left out only once it is changed', async () => {
    const w = field({ field: 'target' })
    expect(input(w, 'value-start').element.value).toBe('3')
    expect(updates(w)).toEqual([])
    await input(w, 'value-start').setValue('2')
    expect(updates(w)).toEqual([2])
  })

  it('switches shape keeping what it can: Grows takes the value as its start', async () => {
    const w = field({ field: 'sets', value: 3, optional: true })
    await segment(w, 'value-shape', 'Grows').trigger('click')
    expect(updates(w)).toEqual([{ start: 3, add: 1 }])
    await segment(w, 'value-shape', 'Stays the same').trigger('click')
    expect(updates(w).at(-1)).toBe(3)
    await segment(w, 'value-shape', 'None').trigger('click')
    expect(updates(w).at(-1)).toBeUndefined()
    expect(w.text()).toContain('Plank has no sets. Pick Stays the same to give it one.')
  })

  it('names “This activity” in None’s hint before it has a name', () => {
    const w = field({ field: 'weight', optional: true, activity: '' })
    expect(w.text()).toContain('This activity has no weight. Pick Stays the same to give it one.')
  })
})

describe('ValueField, growing', () => {
  const HOLD = { start: 30, add: 5, every: 2, max: 90 }

  it('shows Starts at, Grows by, Amount, Every and the most and the rounding', () => {
    const w = field({ field: 'duration', value: HOLD })
    expect(segment(w, 'value-shape', 'Grows').attributes('aria-pressed')).toBe('true')
    expect(input(w, 'value-start').element.value).toBe('30')
    expect(segment(w, 'value-by', 's').attributes('aria-pressed')).toBe('true')
    expect(segment(w, 'value-by', '%').attributes('aria-pressed')).toBe('false')
    expect(input(w, 'value-amount').element.value).toBe('5')
    expect(w.get('[data-testid="value-every"] input').element).toBeTruthy()
    expect(w.get('[data-slot="stepper-suffix"]').text()).toBe('weeks')
    expect(w.text()).toContain('Up to 90 s. Rounds to 5 s.')
  })

  it('writes the start, the amount, and Every in place, keeping the keys in order', async () => {
    const w = field({ field: 'duration', value: HOLD })
    await input(w, 'value-start').setValue('40')
    expect(JSON.stringify(updates(w).at(-1))).toBe(
      JSON.stringify({ start: 40, add: 5, every: 2, max: 90 }),
    )
    await input(w, 'value-amount').setValue('10')
    expect(updates(w).at(-1)).toEqual({ start: 40, add: 10, every: 2, max: 90 })
    await w.get('[aria-label="More weeks between increases"]').trigger('click')
    expect(updates(w).at(-1)).toEqual({ start: 40, add: 10, every: 3, max: 90 })
    await w.get('[aria-label="Fewer weeks between increases"]').trigger('click')
    await w.get('[aria-label="Fewer weeks between increases"]').trigger('click')
    // Every 1 week is the format's default: the key goes.
    expect(updates(w).at(-1)).toEqual({ start: 40, add: 10, max: 90 })
    expect(w.get('[data-slot="stepper-suffix"]').text()).toBe('week')
    await input(w, 'value-amount').setValue('x')
    expect(w.text()).toContain('Type a number, like 10.')
  })

  it('switches Grows by between the unit and %, moving the amount', async () => {
    const w = field({ field: 'weight', value: { start: 60, add: 5, step: 2.5 }, optional: true })
    await segment(w, 'value-by', '%').trigger('click')
    expect(updates(w).at(-1)).toEqual({ start: 60, rate: 5, step: 2.5 })
    expect(w.text()).toContain('%')
    await segment(w, 'value-by', 'kg').trigger('click')
    expect(updates(w).at(-1)).toEqual({ start: 60, add: 5, step: 2.5 })
  })

  it('says there is no most, and the field’s own rounding, when they are left out', () => {
    const w = field({ field: 'weight', value: { start: 60, add: 5 }, optional: true })
    expect(w.text()).toContain('No most. Rounds to 0.5 kg.')
    const sets = field({ field: 'sets', value: { start: 3, add: 1 }, optional: true })
    expect(sets.text()).toContain('No most. Rounds to 1.')
  })

  it('opens the most and the rounding; an emptied field leaves its key out', async () => {
    const w = field({ field: 'duration', value: HOLD })
    const more = w.get('[data-testid="value-limits"]')
    expect(more.attributes('aria-expanded')).toBe('false')
    await more.trigger('click')
    expect(more.attributes('aria-expanded')).toBe('true')
    expect(w.text()).not.toContain('Up to 90 s.')
    expect(w.text()).toContain('Left empty, no most.')
    expect(input(w, 'value-max').element.value).toBe('90')
    expect(input(w, 'value-step').element.value).toBe('')
    await input(w, 'value-step').setValue('10')
    expect(updates(w).at(-1)).toEqual({ ...HOLD, step: 10 })
    await input(w, 'value-max').setValue('')
    expect(updates(w).at(-1)).toEqual({ start: 30, add: 5, every: 2, step: 10 })
    await input(w, 'value-max').setValue('lots')
    expect(w.text()).toContain('Type a number, like 60, or leave it empty.')
    await more.trigger('click')
    expect(w.find('[data-testid="value-max"]').exists()).toBe(false)
  })

  it('shows a problem under the field its path names, and the whole value’s at the group’s foot', () => {
    const w = field({
      field: 'weight',
      value: { start: 60, add: 90 },
      optional: true,
      problems: [
        { sub: 'add', message: 'Give an increase from -500 to 500.' },
        { sub: null, message: 'Week 6 comes to 510 kg. The most is 500.' },
      ],
    })
    const amount = input(w, 'value-amount')
    expect(amount.attributes('aria-invalid')).toBe('true')
    const describedBy = amount.attributes('aria-describedby')!
    expect(document.getElementById(describedBy)!.textContent).toContain('Give an increase')
    const foot = w.get('[role="group"] > [data-testid="value-error"]')
    expect(foot.text()).toBe('Week 6 comes to 510 kg. The most is 500.')
    expect(w.get('[role="group"]').attributes('aria-describedby')).toBe(foot.attributes('id'))
    // Open, the line itself carries no problem.
    expect(
      w.get('[data-testid="value-line"] button').attributes('aria-describedby'),
    ).toBeUndefined()
  })

  it('puts a problem with the most or the rounding under its field, opened', () => {
    const w = field({
      field: 'weight',
      value: { start: 60, add: 5, step: 0.001 },
      optional: true,
      problems: [
        { sub: 'step', message: 'Give a number of 0.01 or more, with at most two decimals.' },
      ],
    })
    expect(input(w, 'value-step').attributes('aria-invalid')).toBe('true')
  })
})

describe('ValueField, a value chosen at start', () => {
  it('swaps a number for a parameter, then back to a number with its default', async () => {
    const w = field({ field: 'weight', value: 40, optional: true })
    await w.get('[data-testid="value-use-param"]').trigger('click')
    expect(updates(w).at(-1)).toBe('$squat')
    const pick = w.get('[data-testid="value-param-pick"]')
    expect(pick.attributes('aria-haspopup')).toBe('menu')
    expect(pick.text()).toContain('Squat start')
    expect(pick.text()).toContain('40 kg')
    expect(w.text()).toContain('Chosen when the programme starts. A number works too.')
    await press(pick.element)
    const items = [...document.querySelectorAll('[data-slot="menu-item"]')]
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Squat start · 40 kg', 'Use a number'])
    expect(items[0]!.querySelector('[data-slot="param-chosen"]')).not.toBeNull()
    ;(items[1] as HTMLElement).click()
    await settle()
    expect(updates(w).at(-1)).toBe(40)
  })

  it('picks a start from the values chosen at start, and the amount from a % one', async () => {
    const w = field({ field: 'weight', value: { start: 40, rate: 5, step: 2.5 }, optional: true })
    const links = w.findAll('[data-testid="value-use-param"]')
    expect(links).toHaveLength(2)
    await links[0]!.trigger('click')
    expect(updates(w).at(-1)).toEqual({ start: '$squat', rate: 5, step: 2.5 })
    await w.findAll('[data-testid="value-use-param"]')[0]!.trigger('click')
    expect(updates(w).at(-1)).toEqual({ start: '$squat', rate: '$rate', step: 2.5 })
    // The rate's pick lists the % values only.
    const picks = w.findAll('[data-testid="value-param-pick"]')
    expect(picks).toHaveLength(2)
    await press(picks[1]!.element)
    const items = [...document.querySelectorAll('[data-slot="menu-item"]')]
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Weekly increase · 5%',
      'Use a number',
    ])
    ;(items[1] as HTMLElement).click()
    await settle()
    expect(updates(w).at(-1)).toEqual({ start: '$squat', rate: 5, step: 2.5 })
  })

  it('moves to another value chosen at start from the Menu', async () => {
    const doc = loadDraft(BEGINNER)
    doc.params!.top = { label: 'Top set', unit: 'kg', default: 80 }
    const w = field({ field: 'weight', value: { start: '$squat', add: 5 }, optional: true }, doc)
    await press(w.get('[data-testid="value-param-pick"]').element)
    const items = [...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')]
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Squat start · 40 kg',
      'Top set · 80 kg',
      'Use a number',
    ])
    items[1]!.click()
    await settle()
    expect(updates(w).at(-1)).toEqual({ start: '$top', add: 5 })
  })

  it('offers no parameter when none fits the field', () => {
    const w = field({ field: 'sets', value: 3, optional: true })
    expect(w.find('[data-testid="value-use-param"]').exists()).toBe(false)
    const doc = loadDraft(BEGINNER)
    delete doc.params
    const bare = field({ field: 'weight', value: { start: 3, add: 1 } }, doc)
    expect(bare.find('[data-testid="value-use-param"]').exists()).toBe(false)
  })

  it('counts a value with no unit of its own as a count’s', async () => {
    const doc = loadDraft(BEGINNER)
    doc.params = { laps: { label: 'Laps', unit: 'laps', default: 4 } }
    const w = field({ field: 'reps', value: 5 }, doc)
    await w.get('[data-testid="value-use-param"]').trigger('click')
    expect(updates(w).at(-1)).toBe('$laps')
  })
})

describe('ValueField, a cardio session’s time', () => {
  it('reads and writes minutes, and keeps the document in seconds', async () => {
    const w = field(
      { field: 'duration', value: { start: 3600, add: 600, every: 2 }, optional: true },
      CARDIO,
    )
    expect(w.text()).toContain('Time')
    expect(input(w, 'value-start').element.value).toBe('60')
    expect(input(w, 'value-amount').element.value).toBe('10')
    expect(w.text()).toContain('min')
    expect(w.text()).toContain('No most. Rounds to 5 s.')
    await input(w, 'value-start').setValue('45')
    expect(updates(w).at(-1)).toEqual({ start: 2700, add: 600, every: 2 })
  })

  it('says the most and the rounding as a time', () => {
    const w = field(
      { field: 'duration', value: { start: 1200, rate: 10, step: 60, max: 1800 }, optional: true },
      CARDIO,
    )
    expect(w.text()).toContain('Up to 30 min. Rounds to 1 min.')
    expect(segment(w, 'value-by', '%').attributes('aria-pressed')).toBe('true')
  })
})

describe('ValueField, focus from the foot bar', () => {
  it('focuses the field a problem names, or the line', async () => {
    const w = field({ field: 'duration', value: { start: 30, add: 5, step: 5 } })
    const vm = w.vm as unknown as { focus: (sub: string | null) => Promise<void> }
    await vm.focus('add')
    expect(document.activeElement).toBe(input(w, 'value-amount').element)
    await vm.focus('step')
    expect(document.activeElement).toBe(input(w, 'value-step').element)
    await vm.focus(null)
    expect(document.activeElement).toBe(w.get('[data-testid="value-line"] button').element)
    await vm.focus('nothing-here')
    expect(document.activeElement).toBe(w.get('[data-testid="value-line"] button').element)
  })
})

describe('ValueField, its edges', () => {
  it('forgets a word typed in a field once the shape changes', async () => {
    const w = field({ field: 'sets', value: 3, optional: true })
    await input(w, 'value-start').setValue('three')
    expect(w.text()).toContain('Type a number, like 3.')
    await segment(w, 'value-shape', 'Grows').trigger('click')
    expect(w.text()).not.toContain('Type a number')
    expect(input(w, 'value-start').element.value).toBe('3')
  })

  it('takes a % amount as typed, with its own example', async () => {
    const w = field({ field: 'weight', value: { start: 60, rate: 2.5 }, optional: true })
    await input(w, 'value-amount').setValue('7.5')
    expect(updates(w).at(-1)).toEqual({ start: 60, rate: 7.5 })
    await input(w, 'value-amount').setValue('more')
    expect(w.text()).toContain('Type a number, like 7.5.')
  })

  it('moves a % amount to another value chosen at start', async () => {
    const doc = loadDraft(BEGINNER)
    doc.params!.fast = { label: 'Fast increase', unit: '%', default: 10 }
    const w = field({ field: 'weight', value: { start: 40, rate: '$rate' }, optional: true }, doc)
    await press(w.get('[data-testid="value-param-pick"]').element)
    const items = [...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')]
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Weekly increase · 5%',
      'Fast increase · 10%',
      'Use a number',
    ])
    items[1]!.click()
    await settle()
    expect(updates(w).at(-1)).toEqual({ start: 40, rate: '$fast' })
  })

  it('shows a problem with a start chosen at start, and with Every', () => {
    const w = field({
      field: 'weight',
      value: { start: '$squat', add: 5, every: 60 },
      optional: true,
      problems: [
        { sub: 'start', message: 'Squat start can’t be the start: its unit is kg.' },
        { sub: 'every', message: 'Give a whole number of weeks from 1 to 52.' },
      ],
    })
    const errors = w.findAll('[data-slot="inline-message"]').map((m) => m.text())
    expect(errors).toEqual([
      'Squat start can’t be the start: its unit is kg.',
      'Give a whole number of weeks from 1 to 52.',
    ])
  })

  it('names a parameter the document lacks by its key, and Use a number gives 0', async () => {
    const w = field({ field: 'weight', value: '$gone', optional: true })
    expect(w.get('[data-testid="value-param-pick"]').text()).toContain('$gone')
    await press(w.get('[data-testid="value-param-pick"]').element)
    const items = [...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')]
    items.at(-1)!.click()
    await settle()
    expect(updates(w).at(-1)).toBe(0)
  })

  it('gives the most an example of 100 when the start is chosen at start', async () => {
    const w = field({ field: 'weight', value: { start: '$squat', add: 5 }, optional: true })
    await w.get('[data-testid="value-limits"]').trigger('click')
    await input(w, 'value-max').setValue('heavy')
    expect(w.text()).toContain('Type a number, like 100, or leave it empty.')
  })
})
