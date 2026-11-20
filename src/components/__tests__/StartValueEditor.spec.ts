import '@/components/ui/__tests__/setup'
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { readProgrammeFixture } from '@/lib/__tests__/fixtures'
import StartValueEditor, { type ParamProblem } from '@/components/StartValueEditor.vue'
import {
  addParam,
  loadDraft,
  newProgramme,
  newSession,
  type DraftSession,
  type ProgrammeDoc,
} from '@/lib/programmeDraft'

type Props = InstanceType<typeof StartValueEditor>['$props']

function beginner(): ProgrammeDoc {
  return reactive(loadDraft(readProgrammeFixture('valid/beginner-5x5.json'))) as ProgrammeDoc
}

function editor(
  paramKey: string,
  {
    doc = beginner(),
    session = newSession(),
    open = true,
    problems = [] as ParamProblem[],
  }: { doc?: ProgrammeDoc; session?: DraftSession; open?: boolean; problems?: ParamProblem[] } = {},
) {
  const wrapper = mount(StartValueEditor, {
    props: { doc, session, paramKey, open, problems } as Props,
    attachTo: document.body,
  })
  return { wrapper, doc, session }
}

const input = (w: VueWrapper, id: string) => w.get<HTMLInputElement>(`input[data-testid="${id}"]`)
const describedText = (el: { attributes: (n: string) => string | undefined }) =>
  document.getElementById(el.attributes('aria-describedby')!.split(' ').at(-1)!)!.textContent

describe('StartValueEditor, closed', () => {
  it('shows its label, its default and the fields that use it, with a pencil', async () => {
    const { wrapper } = editor('squat', { open: false })
    const row = wrapper.get('[data-testid="start-value"]')
    expect(row.attributes('data-param')).toBe('squat')
    expect(row.get('[data-slot="start-value-name"]').text()).toBe('Squat start')
    expect(row.text()).toContain('40 kg by default')
    expect(row.text()).toContain('Used by Back squat’s weight')
    const pencil = wrapper.get('[data-testid="start-value-open"]')
    expect(pencil.attributes('aria-label')).toBe('Change Squat start')
    expect(pencil.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[role="group"]').exists()).toBe(false)
    await pencil.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('reads a percentage, a bare number and an unused value', () => {
    const doc = beginner()
    doc.params!.reps = { label: 'Top set', unit: '', default: 8 }
    doc.params!.blank = { label: '', unit: 'kg', default: 0 }
    expect(editor('rate', { doc, open: false }).wrapper.text()).toContain('5% by default')
    const reps = editor('reps', { doc, open: false }).wrapper
    expect(reps.text()).toContain('8 by default')
    expect(reps.text()).toContain('Used by no field yet.')
    const blank = editor('blank', { doc, open: false }).wrapper
    expect(blank.get('[data-slot="start-value-name"]').text()).toBe('No label yet')
    expect(blank.get('[data-testid="start-value-open"]').attributes('aria-label')).toBe(
      'Change this value',
    )
  })

  it('names every field that uses it', () => {
    const doc = beginner()
    doc.activities[1]!.weight = { start: '$squat', add: 2.5 }
    doc.activities[2]!.weight = '$squat'
    const { wrapper } = editor('squat', { doc, open: false })
    expect(wrapper.text()).toContain(
      'Used by Back squat’s weight, Bench press’s weight and Barbell row’s weight',
    )
  })

  it('shows each problem under its words, tied to the pencil', () => {
    const problems = [{ fieldId: 'default', message: 'Give a default from 20 to 200.' }]
    const { wrapper } = editor('squat', { open: false, problems })
    const shown = wrapper.get('[data-testid="start-value-problem"]')
    expect(shown.text()).toBe('Give a default from 20 to 200.')
    expect(wrapper.get('[data-testid="start-value-open"]').attributes('aria-describedby')).toBe(
      shown.attributes('id'),
    )
  })
})

describe('StartValueEditor, open', () => {
  it('opens in place in its frame, its head saying the default and the range', async () => {
    const { wrapper } = editor('squat')
    expect(wrapper.get('[data-testid="start-value"]').classes()).toContain('border-ink')
    const head = wrapper.get('[data-slot="start-value-toggle"]')
    expect(head.attributes('aria-expanded')).toBe('true')
    expect(head.text()).toContain('Squat start')
    expect(head.text()).toContain('40 kg by default, from 20 to 200 kg')
    const body = wrapper.get('[role="group"]')
    expect(body.attributes('aria-label')).toBe('Squat start')
    expect(head.attributes('aria-controls')).toBe(body.attributes('id'))
    expect(input(wrapper, 'start-value-label').element.value).toBe('Squat start')
    expect(input(wrapper, 'start-value-unit').element.value).toBe('kg')
    expect(input(wrapper, 'start-value-default').element.value).toBe('40')
    expect(input(wrapper, 'start-value-min').element.value).toBe('20')
    expect(input(wrapper, 'start-value-max').element.value).toBe('200')
    expect(wrapper.text()).toContain(
      'Lowest and highest are optional. The start asks for a value between them.',
    )
    expect(wrapper.get('[data-testid="start-value-used"]').text()).toBe(
      'Used by Back squat’s weight.',
    )
    expect(wrapper.find('[data-testid="start-value-key"]').exists()).toBe(false)
    await head.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it.each([
    [{ min: 0 }, '5% by default, at least 0%'],
    [{ max: 20 }, '5% by default, at most 20%'],
    [{}, '5% by default'],
  ])('reads a range of %j as “%s”', (range, words) => {
    const doc = beginner()
    doc.params!.rate = { label: 'Weekly increase', unit: '%', default: 5, ...range }
    const { wrapper } = editor('rate', { doc })
    expect(wrapper.get('[data-slot="start-value-toggle"]').text()).toContain(words)
  })

  it('relabels a loaded value, keeping its key', async () => {
    const { wrapper, doc } = editor('squat')
    await input(wrapper, 'start-value-label').setValue('Squat to start')
    expect(Object.keys(doc.params!)).toEqual(['squat', 'rate'])
    expect(doc.params!.squat!.label).toBe('Squat to start')
  })

  it('keeps a value added this session’s key in step with its label', async () => {
    const doc = beginner()
    const session = newSession()
    const key = addParam(doc, session)
    const { wrapper } = editor(key, { doc, session })
    expect(wrapper.get('[data-testid="start-value-used"]').text()).toBe('Used by no field yet.')
    await input(wrapper, 'start-value-label').setValue('Bench start')
    expect(Object.keys(doc.params!)).toEqual(['squat', 'rate', 'bench-start'])
  })

  it('writes the unit, the default and the range; empty leaves the range out', async () => {
    const { wrapper, doc } = editor('squat')
    await input(wrapper, 'start-value-unit').setValue('lb')
    expect(doc.params!.squat!.unit).toBe('lb')
    expect(wrapper.get('[data-slot="start-value-default"]').text()).toContain('lb')
    await input(wrapper, 'start-value-default').setValue('45,5')
    expect(doc.params!.squat!.default).toBe(45.5)
    await input(wrapper, 'start-value-min').setValue('')
    await input(wrapper, 'start-value-max').setValue('300')
    expect(doc.params!.squat).toEqual({ label: 'Squat start', unit: 'lb', default: 45.5, max: 300 })
    await input(wrapper, 'start-value-min').setValue('10')
    expect(Object.keys(doc.params!.squat!)).toEqual(['label', 'unit', 'default', 'min', 'max'])
  })

  it('keeps what isn’t a number, and says what to type', async () => {
    const { wrapper, doc } = editor('squat')
    await input(wrapper, 'start-value-default').setValue('forty')
    expect(doc.params!.squat!.default).toBe(40)
    expect(input(wrapper, 'start-value-default').element.value).toBe('forty')
    expect(describedText(input(wrapper, 'start-value-default'))).toBe('Type a number, like 40.')
    await input(wrapper, 'start-value-default').setValue('')
    expect(describedText(input(wrapper, 'start-value-default'))).toBe('Type a number, like 40.')
    await input(wrapper, 'start-value-max').setValue('lots')
    expect(doc.params!.squat!.max).toBe(200)
    expect(describedText(input(wrapper, 'start-value-max'))).toBe(
      'Type a number, like 40, or leave it empty.',
    )
    // Closed and opened again, it shows the value as the draft holds it.
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(input(wrapper, 'start-value-default').element.value).toBe('40')
  })

  it('changes the key under More; every field that uses it follows', async () => {
    const { wrapper, doc } = editor('squat')
    const more = wrapper.get('[data-testid="start-value-more"]')
    expect(more.attributes('aria-expanded')).toBe('false')
    await more.trigger('click')
    expect(more.attributes('aria-expanded')).toBe('true')
    const key = input(wrapper, 'start-value-key')
    expect(document.getElementById(more.attributes('aria-controls')!)!.contains(key.element)).toBe(
      true,
    )
    expect(key.element.value).toBe('squat')
    expect(wrapper.text()).toContain(
      'A start through Claude names the value by it. Lowercase letters, numbers and dashes.',
    )
    await key.setValue('rate')
    expect(describedText(key)).toBe('Another value has the key rate.')
    expect(Object.keys(doc.params!)).toEqual(['squat', 'rate'])
    await key.setValue('back-squat')
    expect(Object.keys(doc.params!)).toEqual(['back-squat', 'rate'])
    expect(doc.activities[0]!.weight).toEqual({ start: '$back-squat', rate: '$rate', step: 2.5 })
    await wrapper.setProps({ paramKey: 'back-squat' })
    expect(input(wrapper, 'start-value-key').element.value).toBe('back-squat')
    await more.trigger('click')
    expect(wrapper.find('[data-testid="start-value-key"]').exists()).toBe(false)
  })

  it('refuses to remove a value a field uses, naming the field', async () => {
    const { wrapper, doc } = editor('squat')
    const remove = wrapper.get('[data-testid="start-value-remove"]')
    expect(remove.attributes('aria-describedby')).toBeUndefined()
    await remove.trigger('click')
    const refused = wrapper.get('[data-testid="start-value-refused"]')
    expect(refused.text()).toBe(
      'Back squat’s weight uses Squat start. Give that field a number first, then remove it.',
    )
    expect(refused.attributes('role')).toBe('alert')
    expect(remove.attributes('aria-describedby')).toBe(refused.attributes('id'))
    expect(doc.params).toHaveProperty('squat')
    expect(wrapper.emitted('removed')).toBeUndefined()
    // Closed and opened again, the refusal is gone.
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(wrapper.find('[data-testid="start-value-refused"]').exists()).toBe(false)
  })

  it('removes a value no field uses at once', async () => {
    const doc = reactive({
      ...newProgramme(),
      params: { spare: { label: 'Spare', unit: 'kg', default: 1 } },
    }) as ProgrammeDoc
    const { wrapper } = editor('spare', { doc })
    await wrapper.get('[data-testid="start-value-remove"]').trigger('click')
    // The last value takes `params` with it.
    expect(doc).not.toHaveProperty('params')
    expect(wrapper.emitted('removed')).toHaveLength(1)
    // Until the page takes it away, it keeps the key it was opened with.
    await nextTick()
    expect(wrapper.get('[data-testid="start-value"]').attributes('data-param')).toBe('spare')
  })
})

describe('StartValueEditor’s problems', () => {
  it('shows each problem under the field its path names; the rest at the top', async () => {
    const problems: ParamProblem[] = [
      { fieldId: 'label', message: 'Give a label of 1 to 40 characters.' },
      { fieldId: 'unit', message: 'Keep the unit to 10 characters.' },
      { fieldId: 'default', message: 'Give a default from 20 to 200.' },
      { fieldId: 'min', message: 'Make the lowest less than the highest.' },
      { fieldId: 'max', message: 'Give a highest of at most 1000.' },
      { fieldId: null, message: 'Use lowercase letters, numbers and dashes in the key.' },
    ]
    const { wrapper } = editor('squat', { problems })
    for (const [id, p] of [
      ['start-value-label', problems[0]],
      ['start-value-unit', problems[1]],
      ['start-value-default', problems[2]],
      ['start-value-min', problems[3]],
      ['start-value-max', problems[4]],
    ] as const) {
      expect(input(wrapper, id).attributes('aria-invalid')).toBe('true')
      expect(describedText(input(wrapper, id))).toBe(p!.message)
    }
    expect(wrapper.get('[data-slot="start-value-errors"]').text()).toBe(problems[5]!.message)
  })

  it('opens More for a problem with the key', async () => {
    const problems = [{ fieldId: 'key', message: 'Use lowercase letters in the key.' }]
    const { wrapper } = editor('squat', { problems })
    expect(describedText(input(wrapper, 'start-value-key'))).toBe(problems[0]!.message)
  })

  it('focuses the field a problem names, else Label', async () => {
    const { wrapper } = editor('squat')
    const vm = wrapper.vm as unknown as { focusField: (f: string | null) => Promise<void> }
    await vm.focusField('max')
    expect(document.activeElement).toBe(input(wrapper, 'start-value-max').element)
    await vm.focusField('key')
    expect(document.activeElement).toBe(input(wrapper, 'start-value-key').element)
    await vm.focusField(null)
    expect(document.activeElement).toBe(input(wrapper, 'start-value-label').element)
  })
})

describe('StartValueEditor’s focus', () => {
  it('moves to Label on opening, and back to the pencil on closing', async () => {
    const { wrapper } = editor('squat', { open: false })
    await wrapper.setProps({ open: true })
    await nextTick()
    expect(document.activeElement).toBe(input(wrapper, 'start-value-label').element)
    await wrapper.setProps({ open: false })
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="start-value-open"]').element)
  })

  it('leaves focus alone on closing when it is elsewhere', async () => {
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    const { wrapper } = editor('squat')
    elsewhere.focus()
    await wrapper.setProps({ open: false })
    await nextTick()
    expect(document.activeElement).toBe(elsewhere)
  })
})
