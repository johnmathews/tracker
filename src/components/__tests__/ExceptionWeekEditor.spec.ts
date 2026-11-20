import { settle } from '@/components/ui/__tests__/setup'
import { describe, expect, it } from 'vitest'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { readProgrammeFixture } from '@/lib/__tests__/fixtures'
import ExceptionWeekEditor, { type OverrideProblem } from '@/components/ExceptionWeekEditor.vue'
import { loadDraft, type Override, type ProgrammeDoc } from '@/lib/programmeDraft'

type Props = InstanceType<typeof ExceptionWeekEditor>['$props']

function beginner(): ProgrammeDoc {
  return reactive(loadDraft(readProgrammeFixture('valid/beginner-5x5.json'))) as ProgrammeDoc
}

/** The beginner 5×5 with one exception week of its own in place of the deload. */
function withOverride(override: Override, doc = beginner()): ProgrammeDoc {
  doc.overrides = [override]
  return doc
}

function editor({
  doc = beginner(),
  index = 0,
  open = true,
  problems = [] as OverrideProblem[],
}: { doc?: ProgrammeDoc; index?: number; open?: boolean; problems?: OverrideProblem[] } = {}) {
  const wrapper = mount(ExceptionWeekEditor, {
    props: { doc, index, open, problems } as Props,
    attachTo: document.body,
  })
  return { wrapper, doc }
}

const group = (w: VueWrapper, key: string) =>
  w.get(`[data-testid="exception-group"][data-activity="${key}"]`)
const value = (w: VueWrapper, key: string, field: string) =>
  group(w, key).get(`[data-testid="exception-value"][data-field="${field}"]`)
const segment = (at: Pick<DOMWrapper<Element>, 'findAll'>, label: string) =>
  at.findAll('[data-testid="exception-value-mode"] button').find((b) => b.text() === label)!
const items = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((i) => i.textContent!.trim())
function item(label: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (i) => i.textContent?.trim() === label,
  )!
}

/** A primary-button press, as Reka's menu trigger hears it. */
async function press(target: Element): Promise<void> {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  ;(target as HTMLElement).click()
  await settle()
}

describe('ExceptionWeekEditor, closed', () => {
  it('says what the week changes, with a pencil named for its weeks', async () => {
    const { wrapper } = editor({ open: false })
    const row = wrapper.get('[data-testid="exception-week"]')
    expect(row.text()).toContain('Weeks 4 and 8 · Deload')
    const lines = row.findAll('[data-slot="exception-line"]').map((l) => l.text())
    expect(lines).toEqual(['Every activity: 3 sets, 90% of the weight.', 'Deadlift: 1 set.'])
    const pencil = wrapper.get('[data-testid="exception-open"]')
    expect(pencil.attributes('aria-label')).toBe('Change weeks 4 and 8')
    expect(pencil.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[role="group"]').exists()).toBe(false)
    await pencil.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it.each([
    [[4], undefined, 'Week 4', 'Change week 4'],
    [[2, 4, 8], 'Light', 'Weeks 2, 4 and 8 · Light', 'Change weeks 2, 4 and 8'],
    [[], undefined, 'No weeks yet', 'Change this exception week'],
  ])('reads weeks %j with label %s as “%s”', (weeks, label, head, name) => {
    const doc = withOverride({ weeks, ...(label ? { label } : {}), activities: {} })
    const { wrapper } = editor({ doc, open: false })
    expect(wrapper.get('[data-slot="exception-head"]').text()).toBe(head)
    expect(wrapper.get('[data-testid="exception-open"]').attributes('aria-label')).toBe(name)
    expect(wrapper.get('[data-slot="exception-line"]').text()).toBe('No values yet.')
  })

  it('says each kind of value in words', () => {
    const doc = withOverride({
      weeks: [3],
      activities: {
        '*': { target: 2, reps: 1, duration: 20, weight: 50 },
        plank: { duration: { scale: 0.5 }, sets: 1 },
        ghost: { target: 1, reps: { scale: 0.8 } },
      },
    })
    const { wrapper } = editor({ doc, open: false })
    expect(wrapper.findAll('[data-slot="exception-line"]').map((l) => l.text())).toEqual([
      'Every activity: 2 times a week, 1 rep, 20 s, 50 kg.',
      'Plank: 50% of the hold, 1 set.',
      'ghost: 1 time a week, 80% of the reps.',
    ])
  })

  it('reads a cardio session’s time in minutes and its distance in km', () => {
    const doc = reactive(loadDraft(readProgrammeFixture('valid/cardio.json'))) as ProgrammeDoc
    doc.overrides = [{ weeks: [2], activities: { '*': { duration: 1800, distance: 5 } } }]
    const { wrapper } = editor({ doc, open: false })
    expect(wrapper.get('[data-slot="exception-line"]').text()).toBe('Every activity: 30 min, 5 km.')
  })

  it('shows each problem under its words, tied to the pencil', () => {
    const problems = [
      { fieldId: 'weeks', message: 'Week 9 is past the end. This programme has 8 weeks.' },
      { fieldId: null, message: 'Give at least one value.' },
    ]
    const { wrapper } = editor({ open: false, problems })
    const shown = wrapper.findAll('[data-testid="exception-problem"]')
    expect(shown.map((p) => p.text())).toEqual(problems.map((p) => p.message))
    expect(wrapper.get('[data-testid="exception-open"]').attributes('aria-describedby')).toBe(
      shown.map((p) => p.attributes('id')).join(' '),
    )
  })
})

describe('ExceptionWeekEditor, open', () => {
  it('opens in place in its frame, its head closing it', async () => {
    const { wrapper } = editor()
    const li = wrapper.get('[data-testid="exception-week"]')
    expect(li.classes()).toContain('border-ink')
    const head = wrapper.get('[data-slot="exception-toggle"]')
    expect(head.attributes('aria-expanded')).toBe('true')
    expect(head.text()).toContain('Weeks 4 and 8 · Deload')
    expect(head.text()).toContain('Every activity: 3 sets, 90% of the weight. Deadlift: 1 set.')
    const body = wrapper.get('[role="group"]')
    expect(head.attributes('aria-controls')).toBe(body.attributes('id'))
    expect(body.attributes('aria-label')).toBe('Exception week')
    await head.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('takes the weeks typed with commas, and says what to type when they aren’t numbers', async () => {
    const { wrapper, doc } = editor()
    const weeks = wrapper.get<HTMLInputElement>('input[data-testid="exception-weeks"]')
    expect(weeks.element.value).toBe('4, 8')
    expect(weeks.attributes('inputmode')).toBe('numeric')
    expect(wrapper.text()).toContain('Week numbers from 1 to 8, with commas.')
    await weeks.setValue('4, 6 8')
    expect(doc.overrides![0]!.weeks).toEqual([4, 6, 8])
    await weeks.setValue('4, x')
    expect(doc.overrides![0]!.weeks).toEqual([4, 6, 8])
    expect(weeks.element.value).toBe('4, x')
    expect(weeks.attributes('aria-invalid')).toBe('true')
    expect(document.getElementById(weeks.attributes('aria-describedby')!)!.textContent).toBe(
      '“x” isn’t a week number. Type the weeks, like 4, 8.',
    )
    await weeks.setValue('')
    expect(wrapper.text()).toContain('Type the weeks, like 4, 8.')
    // Ranges are the server's: week 12 of 8 is written, and its problem comes back by path.
    await weeks.setValue('12')
    expect(doc.overrides![0]!.weeks).toEqual([12])
    expect(weeks.attributes('aria-invalid')).toBeUndefined()
  })

  it('forgets what was typed when it closes', async () => {
    const { wrapper } = editor()
    await wrapper.get('input[data-testid="exception-weeks"]').setValue('4, x')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(
      wrapper.get<HTMLInputElement>('input[data-testid="exception-weeks"]').element.value,
    ).toBe('4, 8')
  })

  it('writes the label, and leaves an emptied one out', async () => {
    const { wrapper, doc } = editor({ doc: withOverride({ weeks: [4], activities: {} }) })
    const label = wrapper.get('input[data-testid="exception-label"]')
    expect(wrapper.text()).toContain('Optional. The grid shows it over each of these weeks.')
    await label.setValue('Deload')
    expect(Object.keys(doc.overrides![0]!)).toEqual(['weeks', 'label', 'activities'])
    await label.setValue('')
    expect(doc.overrides![0]!).not.toHaveProperty('label')
  })

  it('shows Every activity first, then each activity with values of its own', () => {
    const { wrapper } = editor()
    const groups = wrapper.findAll('[data-testid="exception-group"]')
    expect(groups.map((g) => g.attributes('data-activity'))).toEqual(['*', 'deadlift'])
    expect(groups.map((g) => g.attributes('aria-label'))).toEqual(['Every activity', 'Deadlift'])
    expect(groups[1]!.text()).toContain('Deadlift’s own value beats the value for every activity.')
    expect(groups[0]!.text()).not.toContain('own value beats')
    const rows = groups[0]!.findAll('[data-testid="exception-value"]')
    expect(rows.map((r) => r.attributes('data-field'))).toEqual(['sets', 'weight'])
    expect(segment(rows[0]!, 'Set to').attributes('aria-pressed')).toBe('true')
    expect(segment(rows[1]!, '% of planned').attributes('aria-pressed')).toBe('true')
    expect(rows[1]!.get<HTMLInputElement>('input').element.value).toBe('90')
    expect(rows[1]!.text()).toContain('%')
    expect(rows[0]!.get('[data-testid="exception-value-remove"]').attributes('aria-label')).toBe(
      'Remove sets from this group',
    )
    // The row's name labels its segments and its number.
    const name = rows[0]!.get('[data-slot="exception-value-name"]')
    expect(rows[0]!.get('input').attributes('aria-labelledby')).toBe(name.attributes('id'))
    expect(rows[0]!.find('[data-testid="exception-value-mode"] [role="group"]').exists()).toBe(true)
  })

  it('switches a value between Set to and % of planned', async () => {
    const { wrapper, doc } = editor()
    await segment(value(wrapper, '*', 'sets'), '% of planned').trigger('click')
    expect(doc.overrides![0]!.activities['*']!.sets).toEqual({ scale: 1 })
    expect(value(wrapper, '*', 'sets').get<HTMLInputElement>('input').element.value).toBe('100')
    await segment(value(wrapper, '*', 'weight'), 'Set to').trigger('click')
    expect(doc.overrides![0]!.activities['*']!.weight).toBe(20)
    expect(value(wrapper, '*', 'weight').text()).toContain('kg')
    // Pressing the mode it already has changes nothing.
    await segment(value(wrapper, '*', 'weight'), 'Set to').trigger('click')
    expect(doc.overrides![0]!.activities['*']!.weight).toBe(20)
  })

  it('writes a typed number, and keeps what isn’t a number with a line saying what to type', async () => {
    const { wrapper, doc } = editor()
    const weight = () => value(wrapper, '*', 'weight').get<HTMLInputElement>('input')
    await weight().setValue('85,5')
    expect(doc.overrides![0]!.activities['*']!.weight).toEqual({ scale: 0.855 })
    await weight().setValue('lots')
    expect(doc.overrides![0]!.activities['*']!.weight).toEqual({ scale: 0.855 })
    expect(weight().element.value).toBe('lots')
    expect(weight().attributes('aria-invalid')).toBe('true')
    expect(document.getElementById(weight().attributes('aria-describedby')!)!.textContent).toBe(
      'Type a number, like 90.',
    )
    await value(wrapper, '*', 'sets').get('input').setValue('')
    expect(value(wrapper, '*', 'sets').text()).toContain('Type a number, like 3.')
  })

  it('types a cardio session’s time in minutes', async () => {
    const doc = reactive(loadDraft(readProgrammeFixture('valid/cardio.json'))) as ProgrammeDoc
    doc.overrides = [{ weeks: [2], activities: { '*': { duration: 1800 } } }]
    const { wrapper } = editor({ doc })
    const time = value(wrapper, '*', 'duration')
    expect(time.get<HTMLInputElement>('input').element.value).toBe('30')
    expect(time.text()).toContain('min')
    expect(time.text()).toContain('Time')
    await time.get('input').setValue('45')
    expect(doc.overrides[0]!.activities['*']!.duration).toBe(2700)
  })

  it('removes a value; an activity’s last value takes its group with it', async () => {
    const { wrapper, doc } = editor()
    await value(wrapper, '*', 'sets').get('[data-testid="exception-value-remove"]').trigger('click')
    await settle()
    expect(doc.overrides![0]!.activities['*']).toEqual({ weight: { scale: 0.9 } })
    expect(document.activeElement).toBe(
      group(wrapper, '*').get('[data-testid="exception-value-add"]').element,
    )
    await value(wrapper, 'deadlift', 'sets')
      .get('[data-testid="exception-value-remove"]')
      .trigger('click')
    await settle()
    expect(doc.overrides![0]!.activities).not.toHaveProperty('deadlift')
    expect(wrapper.find('[data-activity="deadlift"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="exception-group-add"]').element)
    // Every activity stays, even with nothing in it.
    await value(wrapper, '*', 'weight')
      .get('[data-testid="exception-value-remove"]')
      .trigger('click')
    expect(group(wrapper, '*').findAll('[data-testid="exception-value"]')).toHaveLength(0)
  })

  it('adds a value from the fields the group doesn’t set yet', async () => {
    const { wrapper, doc } = editor()
    await press(group(wrapper, 'deadlift').get('[data-testid="exception-value-add"]').element)
    expect(items()).toEqual(['Times a week', 'Reps', 'Weight'])
    item('Weight').click()
    await settle()
    expect(doc.overrides![0]!.activities.deadlift).toEqual({ sets: 1, weight: 20 })
    // Every activity offers each field some activity has: the plank's hold too.
    await press(group(wrapper, '*').get('[data-testid="exception-value-add"]').element)
    expect(items()).toEqual(['Times a week', 'Reps', 'Hold'])
    item('Hold').click()
    await settle()
    expect(Object.keys(doc.overrides![0]!.activities['*']!)).toEqual(['sets', 'duration', 'weight'])
  })

  it('hides Add a value once the group sets every field', () => {
    const doc = withOverride({
      weeks: [4],
      activities: { plank: { target: 2, sets: 2, duration: 20 } },
    })
    const { wrapper } = editor({ doc })
    expect(group(wrapper, 'plank').find('[data-testid="exception-value-add"]').exists()).toBe(false)
  })

  it('adds values for one activity: its group shows, waiting for its first value', async () => {
    const { wrapper, doc } = editor()
    await press(wrapper.get('[data-testid="exception-group-add"]').element)
    expect(items()).toEqual(['Back squat', 'Bench press', 'Barbell row', 'Plank'])
    item('Plank').click()
    await settle()
    expect(group(wrapper, 'plank').attributes('aria-label')).toBe('Plank')
    expect(doc.overrides![0]!.activities).not.toHaveProperty('plank')
    expect(document.activeElement).toBe(
      group(wrapper, 'plank').get('[data-testid="exception-value-add"]').element,
    )
    await press(group(wrapper, 'plank').get('[data-testid="exception-value-add"]').element)
    expect(items()).toEqual(['Times a week', 'Sets', 'Hold'])
    item('Hold').click()
    await settle()
    expect(doc.overrides![0]!.activities.plank).toEqual({ duration: 30 })
    // Closing forgets a group still waiting.
    await press(wrapper.get('[data-testid="exception-group-add"]').element)
    item('Bench press').click()
    await settle()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(wrapper.find('[data-activity="bench"]').exists()).toBe(false)
  })

  it('hides Add values for one activity once each activity has a group', () => {
    const doc = withOverride({ weeks: [4], activities: { a: { sets: 1 } } })
    doc.activities = [{ key: 'a', name: '', sets: 3 }]
    const { wrapper } = editor({ doc })
    expect(wrapper.find('[data-testid="exception-group-add"]').exists()).toBe(false)
    // An unnamed activity is named for what it is.
    expect(group(wrapper, 'a').attributes('aria-label')).toBe('Activity 1')
  })

  it('offers a key no activity has the kind’s fields', async () => {
    const doc = withOverride({ weeks: [4], activities: { ghost: { sets: 1 } } })
    const { wrapper } = editor({ doc })
    expect(group(wrapper, 'ghost').attributes('aria-label')).toBe('ghost')
    await press(group(wrapper, 'ghost').get('[data-testid="exception-value-add"]').element)
    expect(items()).toEqual(['Times a week', 'Reps', 'Hold', 'Weight'])
  })

  it('asks to be removed', async () => {
    const { wrapper } = editor()
    await wrapper.get('[data-testid="exception-remove"]').trigger('click')
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})

describe('ExceptionWeekEditor’s problems', () => {
  it('shows each problem under the field its path names', () => {
    const problems: OverrideProblem[] = [
      { fieldId: 'weeks', message: 'Week 9 is past the end. This programme has 8 weeks.' },
      { fieldId: 'label', message: 'Keep the label to 40 characters.' },
      { fieldId: 'activities.deadlift.sets', message: 'Give 1 to 20 sets.' },
      { fieldId: 'activities.*', message: 'Give at least one value.' },
      { fieldId: 'activities.ghost.sets', message: 'No activity has the key ghost.' },
      { fieldId: 'activities.deadlift.weight', message: 'Give a weight from 0 to 500.' },
      { fieldId: null, message: 'Give each exception week a value.' },
    ]
    const { wrapper } = editor({ problems })
    const weeks = wrapper.get('input[data-testid="exception-weeks"]')
    expect(document.getElementById(weeks.attributes('aria-describedby')!)!.textContent).toBe(
      problems[0]!.message,
    )
    const label = wrapper.get('input[data-testid="exception-label"]')
    expect(label.attributes('aria-invalid')).toBe('true')
    const sets = value(wrapper, 'deadlift', 'sets').get('input')
    expect(sets.attributes('aria-invalid')).toBe('true')
    expect(document.getElementById(sets.attributes('aria-describedby')!)!.textContent).toBe(
      'Give 1 to 20 sets.',
    )
    expect(group(wrapper, '*').get('[data-slot="exception-group-errors"]').text()).toBe(
      'Give at least one value.',
    )
    // A field with no row of its own goes to its group; a group not shown, to the top.
    expect(group(wrapper, 'deadlift').get('[data-slot="exception-group-errors"]').text()).toBe(
      'Give a weight from 0 to 500.',
    )
    expect(wrapper.get('[data-slot="exception-errors"]').text()).toContain(
      'No activity has the key ghost.',
    )
    expect(wrapper.get('[data-slot="exception-errors"]').text()).toContain(
      'Give each exception week a value.',
    )
  })

  it('focuses the field a problem names, else Weeks', async () => {
    const { wrapper } = editor()
    const vm = wrapper.vm as unknown as { focusField: (f: string | null) => Promise<void> }
    await vm.focusField('label')
    expect(document.activeElement).toBe(wrapper.get('input[data-testid="exception-label"]').element)
    await vm.focusField('activities.deadlift.sets')
    expect(document.activeElement).toBe(value(wrapper, 'deadlift', 'sets').get('input').element)
    await vm.focusField('activities.deadlift')
    expect(document.activeElement).toBe(
      group(wrapper, 'deadlift').get('[data-testid="exception-value-add"]').element,
    )
    await vm.focusField(null)
    expect(document.activeElement).toBe(wrapper.get('input[data-testid="exception-weeks"]').element)
    await vm.focusField('activities.ghost.sets')
    expect(document.activeElement).toBe(wrapper.get('input[data-testid="exception-weeks"]').element)
  })
})

describe('ExceptionWeekEditor’s focus', () => {
  it('moves to Weeks on opening, and back to the pencil on closing', async () => {
    const { wrapper } = editor({ open: false })
    await wrapper.setProps({ open: true })
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('input[data-testid="exception-weeks"]').element)
    await wrapper.setProps({ open: false })
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="exception-open"]').element)
  })

  it('leaves focus alone on closing when it is elsewhere', async () => {
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    const { wrapper } = editor()
    elsewhere.focus()
    await wrapper.setProps({ open: false })
    await nextTick()
    expect(document.activeElement).toBe(elsewhere)
  })
})

describe('ExceptionWeekEditor’s rest list (K191)', () => {
  /** Week 3 rests the legs: Back squat and Deadlift, the deadlift keeping a set of its own. */
  const legs = (): Override => ({
    weeks: [3],
    label: 'Legs rest',
    activities: { squat: { target: 0 }, deadlift: { target: 0, sets: 1 } },
  })
  const restList = (w: VueWrapper) => w.get('[data-testid="exception-rest"]')
  const rows = (w: VueWrapper) => restList(w).findAll('[data-testid="exception-rest-row"]')
  const row = (w: VueWrapper, key: string) =>
    restList(w).get(`[data-testid="exception-rest-row"][data-rest="${key}"]`)
  const ticked = (w: VueWrapper) =>
    rows(w)
      .filter((r) => r.attributes('aria-checked') === 'true')
      .map((r) => r.attributes('data-rest'))

  it('lists Every activity, then each activity, under Label and before the values', () => {
    const { wrapper } = editor()
    const list = restList(wrapper)
    expect(list.attributes('role')).toBe('group')
    expect(document.getElementById(list.attributes('aria-labelledby')!)!.textContent).toBe(
      'Rest these activities',
    )
    expect(rows(wrapper).map((r) => r.attributes('role'))).toEqual(Array(6).fill('checkbox'))
    expect(rows(wrapper).map((r) => r.text())).toEqual([
      'Every activity',
      'Back squat',
      'Bench press',
      'Barbell row',
      'Deadlift',
      'Plank',
    ])
    expect(rows(wrapper).map((r) => r.attributes('data-rest'))).toEqual([
      '*',
      'squat',
      'bench',
      'row',
      'deadlift',
      'plank',
    ])
    expect(list.text()).toContain('A rested activity has no sessions in these weeks.')
    expect(ticked(wrapper)).toEqual([])
    const label = wrapper.get('input[data-testid="exception-label"]').element
    const firstGroup = wrapper.get('[data-testid="exception-group"]').element
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
    expect(label.compareDocumentPosition(list.element) & FOLLOWING).toBeTruthy()
    expect(list.element.compareDocumentPosition(firstGroup) & FOLLOWING).toBeTruthy()
  })

  it('writes a tick as Times a week 0, and an untick takes it back', async () => {
    const { wrapper, doc } = editor()
    const o = () => doc.overrides![0]!
    await row(wrapper, 'squat').trigger('click')
    expect(o().activities.squat).toEqual({ target: 0 })
    await row(wrapper, 'deadlift').trigger('click')
    expect(o().activities.deadlift).toEqual({ target: 0, sets: 1 })
    expect(Object.keys(o().activities)).toEqual(['*', 'deadlift', 'squat'])
    expect(ticked(wrapper)).toEqual(['squat', 'deadlift'])
    await row(wrapper, 'deadlift').trigger('click')
    expect(o().activities.deadlift).toEqual({ sets: 1 })
    await row(wrapper, 'squat').trigger('click')
    expect(o().activities).not.toHaveProperty('squat')
    expect(Object.keys(o().activities)).toEqual(['*', 'deadlift'])
    expect(ticked(wrapper)).toEqual([])
  })

  it('rests every activity through Every activity, unless an activity has its own Times a week', async () => {
    const doc = withOverride({
      weeks: [5],
      activities: { bench: { target: 2 }, row: { target: 0 } },
    })
    const { wrapper } = editor({ doc })
    await row(wrapper, '*').trigger('click')
    expect(doc.overrides![0]!.activities['*']).toEqual({ target: 0 })
    expect(Object.keys(doc.overrides![0]!.activities)).toEqual(['bench', 'row', '*'])
    expect(ticked(wrapper)).toEqual(['*', 'squat', 'row', 'deadlift', 'plank'])
    // Through Every activity: ticked and disabled. Its own rest: ticked, and it can change.
    expect(row(wrapper, 'squat').attributes('disabled')).toBeDefined()
    expect(row(wrapper, 'plank').attributes('disabled')).toBeDefined()
    expect(row(wrapper, 'row').attributes('disabled')).toBeUndefined()
    // Its own Times a week beats Every activity's (K153): bench doesn't rest, and can.
    expect(row(wrapper, 'bench').attributes('aria-checked')).toBe('false')
    expect(row(wrapper, 'bench').attributes('disabled')).toBeUndefined()
    await row(wrapper, 'bench').trigger('click')
    expect(doc.overrides![0]!.activities.bench).toEqual({ target: 0 })
    // A disabled row doesn't change.
    await row(wrapper, 'squat').trigger('click')
    expect(doc.overrides![0]!.activities).not.toHaveProperty('squat')
    await row(wrapper, '*').trigger('click')
    expect(doc.overrides![0]!.activities).not.toHaveProperty('*')
    expect(ticked(wrapper)).toEqual(['bench', 'row'])
    expect(row(wrapper, 'squat').attributes('disabled')).toBeUndefined()
  })

  it('shows a rest in the list only, not as a Times a week row', async () => {
    const doc = withOverride({
      weeks: [3],
      activities: {
        '*': { target: 0, sets: 2 },
        squat: { target: 0 },
        bench: { target: 2 },
        row: { target: { scale: 0.5 } },
        deadlift: { target: 0, sets: 1 },
      },
    })
    const { wrapper } = editor({ doc })
    const groups = wrapper.findAll('[data-testid="exception-group"]')
    // Back squat rests and has nothing else to show: no group.
    expect(groups.map((g) => g.attributes('data-activity'))).toEqual([
      '*',
      'bench',
      'row',
      'deadlift',
    ])
    const fields = (key: string) =>
      group(wrapper, key)
        .findAll('[data-testid="exception-value"]')
        .map((r) => r.attributes('data-field'))
    expect(fields('*')).toEqual(['sets'])
    expect(fields('bench')).toEqual(['target'])
    expect(fields('row')).toEqual(['target'])
    expect(fields('deadlift')).toEqual(['sets'])
    // Add a value doesn't offer Times a week while it is a rest.
    await press(group(wrapper, 'deadlift').get('[data-testid="exception-value-add"]').element)
    expect(items()).toEqual(['Reps', 'Weight'])
    item('Reps').click()
    await settle()
    expect(doc.overrides![0]!.activities.deadlift).toEqual({ target: 0, sets: 1, reps: 10 })
    // Add values for one activity offers an activity whose entry holds only the rest.
    await press(wrapper.get('[data-testid="exception-group-add"]').element)
    expect(items()).toEqual(['Back squat', 'Plank'])
    item('Back squat').click()
    await settle()
    expect(fields('squat')).toEqual([])
    await press(group(wrapper, 'squat').get('[data-testid="exception-value-add"]').element)
    expect(items()).toEqual(['Sets', 'Reps', 'Weight'])
    item('Sets').click()
    await settle()
    expect(doc.overrides![0]!.activities.squat).toEqual({ target: 0, sets: 3 })
    expect(fields('squat')).toEqual(['sets'])
    // Its last value removed, the group goes and the rest stays.
    await value(wrapper, 'squat', 'sets')
      .get('[data-testid="exception-value-remove"]')
      .trigger('click')
    await settle()
    expect(doc.overrides![0]!.activities.squat).toEqual({ target: 0 })
    expect(wrapper.find('[data-testid="exception-group"][data-activity="squat"]').exists()).toBe(
      false,
    )
    expect(row(wrapper, 'squat').attributes('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('[data-testid="exception-group-add"]').element)
  })

  it('names the rests first when closed, then the other values', () => {
    const doc = withOverride(legs())
    const { wrapper } = editor({ doc, open: false })
    expect(wrapper.get('[data-slot="exception-head"]').text()).toBe('Week 3 · Legs rest')
    expect(wrapper.findAll('[data-slot="exception-line"]').map((l) => l.text())).toEqual([
      'Rest: Back squat, Deadlift.',
      'Deadlift: 1 set.',
    ])
  })

  it('says “Rest: every activity.” for Every activity, and nothing else for a rest alone', () => {
    const doc = withOverride({
      weeks: [5],
      activities: { plank: { target: 0 }, '*': { target: 0 }, bench: { target: 2 } },
    })
    const { wrapper } = editor({ doc, open: false })
    expect(wrapper.findAll('[data-slot="exception-line"]').map((l) => l.text())).toEqual([
      'Rest: every activity.',
      'Bench press: 2 times a week.',
    ])
  })

  it('names the rests in the open head too', () => {
    const { wrapper } = editor({ doc: withOverride(legs()) })
    expect(wrapper.get('[data-slot="exception-toggle"]').text()).toContain(
      'Rest: Back squat, Deadlift. Deadlift: 1 set.',
    )
  })

  it('shows a rest’s problem under its row, tied to it, and focuses the row', async () => {
    const problems: OverrideProblem[] = [
      { fieldId: 'activities.squat.target', message: 'Rest at most 2 activities.' },
      { fieldId: 'activities.*.target', message: 'Every activity can’t rest here.' },
    ]
    const doc = withOverride({
      ...legs(),
      activities: { ...legs().activities, '*': { target: 0 } },
    })
    const { wrapper } = editor({ doc, problems })
    for (const [key, message] of [
      ['squat', 'Rest at most 2 activities.'],
      ['*', 'Every activity can’t rest here.'],
    ] as const) {
      const r = row(wrapper, key)
      expect(r.attributes('aria-invalid')).toBe('true')
      expect(document.getElementById(r.attributes('aria-describedby')!)!.textContent).toBe(message)
    }
    expect(restList(wrapper).findAll('[data-testid="exception-rest-problem"]')).toHaveLength(2)
    // Shown once: not in the group's problems, nor at the top.
    expect(wrapper.find('[data-slot="exception-errors"]').exists()).toBe(false)
    expect(wrapper.find('[data-slot="exception-group-errors"]').exists()).toBe(false)
    const vm = wrapper.vm as unknown as { focusField: (f: string | null) => Promise<void> }
    await vm.focusField('activities.squat.target')
    expect(document.activeElement).toBe(row(wrapper, 'squat').element)
    // Closed, it shows under the words with the others.
    await wrapper.setProps({ open: false })
    expect(wrapper.findAll('[data-testid="exception-problem"]').map((p) => p.text())).toEqual([
      'Rest at most 2 activities.',
      'Every activity can’t rest here.',
    ])
  })

  it('keeps a Times a week problem that isn’t a rest on its row or group', () => {
    const problems: OverrideProblem[] = [
      { fieldId: 'activities.bench.target', message: 'Give 0 to 14 times a week.' },
      { fieldId: 'activities.plank.target', message: 'Plank has no Times a week here.' },
      { fieldId: 'activities.ghost.target', message: 'No activity has the key ghost.' },
    ]
    const doc = withOverride({
      weeks: [3],
      activities: { bench: { target: 20 }, plank: { sets: 1 }, ghost: { target: 0 } },
    })
    const { wrapper } = editor({ doc, problems })
    expect(value(wrapper, 'bench', 'target').text()).toContain('Give 0 to 14 times a week.')
    expect(group(wrapper, 'plank').get('[data-slot="exception-group-errors"]').text()).toBe(
      'Plank has no Times a week here.',
    )
    // A key no activity has isn't on the list: its problem goes to the top.
    expect(wrapper.get('[data-slot="exception-errors"]').text()).toBe(
      'No activity has the key ghost.',
    )
    expect(restList(wrapper).find('[data-testid="exception-rest-problem"]').exists()).toBe(false)
  })

  it('shows a loaded rest ticked, and changes nothing until a row is pressed', async () => {
    const doc = withOverride(legs())
    const before = JSON.stringify(doc)
    const { wrapper } = editor({ doc })
    expect(ticked(wrapper)).toEqual(['squat', 'deadlift'])
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(JSON.stringify(doc)).toBe(before)
  })
})
