import { settle } from '@/components/ui/__tests__/setup'
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { readProgrammeFixture } from '@/lib/__tests__/fixtures'
import ActivityCard from '@/components/ActivityCard.vue'
import {
  addActivity,
  loadDraft,
  newProgramme,
  newSession,
  type DraftSession,
  type ProgrammeDoc,
} from '@/lib/programmeDraft'

type Props = InstanceType<typeof ActivityCard>['$props']
type Problem = { fieldId: string | null; message: string }

function beginner(): ProgrammeDoc {
  return reactive(loadDraft(readProgrammeFixture('valid/beginner-5x5.json'))) as ProgrammeDoc
}

function card(
  index: number,
  {
    doc = beginner(),
    session = newSession(),
    open = true,
    problems = [] as Problem[],
  }: { doc?: ProgrammeDoc; session?: DraftSession; open?: boolean; problems?: Problem[] } = {},
) {
  const wrapper = mount(ActivityCard, {
    props: { doc, session, index, open, problems } as Props,
    attachTo: document.body,
  })
  return { wrapper, doc, session }
}

const toggle = (w: VueWrapper) => w.get('[data-slot="activity-toggle"]')
const line = (w: VueWrapper, field: string) =>
  w.get(`[data-testid="value-line"][data-field="${field}"] button`)
const segment = (w: VueWrapper, id: string, label: string) =>
  w.findAll(`[data-testid="${id}"] button`).find((b) => b.text() === label)!
const lines = (w: VueWrapper) =>
  w.findAll('[data-testid="value-line"]').map((l) => l.attributes('data-field'))

/** A primary-button press, as Reka's menu trigger hears it. */
async function press(target: Element): Promise<void> {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  ;(target as HTMLElement).click()
  await settle()
}

describe('ActivityCard, closed', () => {
  it('shows the name and the rule in a line, and asks to open on a press', async () => {
    const { wrapper } = card(4, { open: false })
    const li = wrapper.get('[data-testid="activity-card"]')
    expect(li.attributes('data-activity')).toBe('plank')
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('false')
    expect(toggle(wrapper).text()).toContain('Plank')
    expect(toggle(wrapper).text()).toContain('3 × 30 s · +5 s every 2 weeks, up to 90 s')
    expect(wrapper.find('[role="group"]').exists()).toBe(false)
    await toggle(wrapper).trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('shows each problem under the rule, tied to the toggle, with an error-ink border', () => {
    const { wrapper } = card(3, {
      open: false,
      problems: [
        { fieldId: 'weight', message: 'Week 6 comes to 510 kg. The most is 500.' },
        { fieldId: 'name', message: 'Give a name of 1 to 80 characters.' },
      ],
    })
    const problems = wrapper.findAll('[data-testid="activity-problem"]')
    expect(problems.map((p) => p.text())).toEqual([
      'Week 6 comes to 510 kg. The most is 500.',
      'Give a name of 1 to 80 characters.',
    ])
    const describedBy = toggle(wrapper).attributes('aria-describedby')!.split(' ')
    expect(describedBy).toEqual(problems.map((p) => p.attributes('id')))
    expect(wrapper.get('[data-testid="activity-card"]').classes()).toContain('border-error-ink')
  })

  it('names an unnamed activity in its menu', () => {
    const doc = reactive(newProgramme()) as ProgrammeDoc
    addActivity(doc, newSession())
    const { wrapper } = card(0, { doc, open: false })
    expect(wrapper.get('[data-testid="activity-menu"]').attributes('aria-label')).toBe(
      'More for this activity',
    )
    expect(toggle(wrapper).text()).toContain('No name yet')
  })
})

describe('ActivityCard, open', () => {
  it('opens in place as a group named for the activity, framed in ink', () => {
    const { wrapper } = card(0)
    const group = wrapper.get('[role="group"]')
    expect(group.attributes('aria-label')).toBe('Back squat')
    expect(toggle(wrapper).attributes('aria-controls')).toBe(group.attributes('id'))
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="activity-card"]').classes()).toContain('border-ink')
    expect(lines(wrapper)).toEqual(['target', 'sets', 'reps', 'weight'])
  })

  it('renames a loaded activity and keeps its key', async () => {
    const { wrapper, doc } = card(0)
    await wrapper.get('input[data-testid="activity-name"]').setValue('Front squat')
    expect(doc.activities[0]!.name).toBe('Front squat')
    expect(doc.activities[0]!.key).toBe('squat')
  })

  it('keeps a new activity’s key in step with its name (spec F5)', async () => {
    const doc = reactive(newProgramme()) as ProgrammeDoc
    const session = newSession()
    addActivity(doc, session)
    const { wrapper } = card(0, { doc, session })
    await wrapper.get('input[data-testid="activity-name"]').setValue('Goblet squat')
    expect(doc.activities[0]!.key).toBe('goblet-squat')
    expect(wrapper.get('[data-testid="activity-card"]').attributes('data-activity')).toBe(
      'goblet-squat',
    )
  })

  it('switches Measure between Reps, Time and Neither', async () => {
    const { wrapper, doc } = card(0)
    expect(segment(wrapper, 'activity-measure', 'Reps').attributes('aria-pressed')).toBe('true')
    await segment(wrapper, 'activity-measure', 'Time').trigger('click')
    expect(doc.activities[0]).not.toHaveProperty('reps')
    expect(doc.activities[0]!.duration).toBe(30)
    expect(lines(wrapper)).toEqual(['target', 'sets', 'duration', 'weight'])
    await segment(wrapper, 'activity-measure', 'Neither').trigger('click')
    expect(doc.activities[0]).not.toHaveProperty('duration')
    expect(lines(wrapper)).toEqual(['target', 'sets', 'weight'])
  })

  it('sets Sides: Each side writes perSide, Per set leaves it out', async () => {
    const { wrapper, doc } = card(0)
    expect(segment(wrapper, 'activity-sides', 'Per set').attributes('aria-pressed')).toBe('true')
    await segment(wrapper, 'activity-sides', 'Each side').trigger('click')
    expect(doc.activities[0]!.perSide).toBe(true)
    await segment(wrapper, 'activity-sides', 'Per set').trigger('click')
    expect(doc.activities[0]).not.toHaveProperty('perSide')
  })

  it('opens one value at a time, and writes what it sets to its path', async () => {
    const { wrapper, doc } = card(4)
    await line(wrapper, 'sets').trigger('click')
    expect(line(wrapper, 'sets').attributes('aria-expanded')).toBe('true')
    await line(wrapper, 'weight').trigger('click')
    expect(line(wrapper, 'sets').attributes('aria-expanded')).toBe('false')
    expect(line(wrapper, 'weight').attributes('aria-expanded')).toBe('true')
    // A plank has no weight: None, and Stays the same gives it one.
    await segment(wrapper, 'value-shape', 'Stays the same').trigger('click')
    expect(doc.activities[4]!.weight).toBe(20)
    await segment(wrapper, 'value-shape', 'None').trigger('click')
    expect(doc.activities[4]).not.toHaveProperty('weight')
    await line(wrapper, 'weight').trigger('click')
    expect(wrapper.findAll('[data-testid="value-line"] [aria-expanded="true"]')).toHaveLength(0)
  })

  it('has Times a week, Time and Distance in a cardio programme, and no Measure or Sides', () => {
    const doc = reactive(loadDraft(readProgrammeFixture('valid/cardio.json'))) as ProgrammeDoc
    const { wrapper } = card(1, { doc })
    expect(lines(wrapper)).toEqual(['target', 'duration', 'distance'])
    expect(wrapper.find('[data-testid="activity-measure"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="activity-sides"]').exists()).toBe(false)
  })

  it('has no Weight in a mobility programme', () => {
    const doc = reactive(loadDraft(readProgrammeFixture('valid/mobility.json'))) as ProgrammeDoc
    const { wrapper } = card(0, { doc })
    expect(lines(wrapper)).not.toContain('weight')
    expect(lines(wrapper)).toContain('target')
  })
})

describe('ActivityCard, More', () => {
  it('opens the key, the notes and the link', async () => {
    const { wrapper } = card(0)
    const more = wrapper.get('[data-testid="activity-more"]')
    expect(more.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="activity-key"]').exists()).toBe(false)
    await more.trigger('click')
    expect(more.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get<HTMLInputElement>('input[data-testid="activity-key"]').element.value).toBe(
      'squat',
    )
    expect(wrapper.text()).toContain('Runs started from now use it as the item’s id.')
    expect(
      wrapper.get<HTMLTextAreaElement>('textarea[data-testid="activity-notes"]').element.value,
    ).toBe('Belt from week 5.')
    expect(wrapper.get('input[data-testid="activity-link"]').attributes('inputmode')).toBe('url')
    await more.trigger('click')
    expect(wrapper.find('[data-testid="activity-key"]').exists()).toBe(false)
  })

  it('changes the key, and refuses one another activity has', async () => {
    const { wrapper, doc } = card(0)
    await wrapper.get('[data-testid="activity-more"]').trigger('click')
    const key = wrapper.get('input[data-testid="activity-key"]')
    await key.setValue('bench')
    expect(doc.activities[0]!.key).toBe('squat')
    expect(wrapper.text()).toContain('Another activity has the key bench.')
    expect(key.attributes('aria-invalid')).toBe('true')
    await key.setValue('back-squat')
    expect(doc.activities[0]!.key).toBe('back-squat')
    expect(wrapper.text()).not.toContain('Another activity has the key')
  })

  it('writes the notes and the link, and leaves them out when emptied', async () => {
    const { wrapper, doc } = card(0)
    await wrapper.get('[data-testid="activity-more"]').trigger('click')
    await wrapper.get('textarea[data-testid="activity-notes"]').setValue('')
    expect(doc.activities[0]).not.toHaveProperty('notes')
    await wrapper.get('input[data-testid="activity-link"]').setValue('https://example.com/squat')
    expect(doc.activities[0]!.link).toBe('https://example.com/squat')
    expect(Object.keys(doc.activities[0]!)).toEqual([
      'key',
      'name',
      'link',
      'target',
      'sets',
      'reps',
      'weight',
    ])
    await wrapper.get('input[data-testid="activity-link"]').setValue('')
    expect(doc.activities[0]).not.toHaveProperty('link')
  })
})

describe('ActivityCard, the ⋯ menu', () => {
  it('offers Move down and Remove on the first card, and emits each', async () => {
    const { wrapper } = card(0, { open: false })
    const menu = wrapper.get('[data-testid="activity-menu"]')
    expect(menu.attributes('aria-label')).toBe('More for Back squat')
    expect(menu.attributes('aria-haspopup')).toBe('menu')
    await press(menu.element)
    expect(document.querySelector('[data-testid="activity-move-up"]')).toBeNull()
    document.querySelector<HTMLElement>('[data-testid="activity-move-down"]')!.click()
    await settle()
    expect(wrapper.emitted('move')).toEqual([[1]])
    await press(menu.element)
    document.querySelector<HTMLElement>('[data-testid="activity-remove"]')!.click()
    await settle()
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })

  it('offers Move up and no Move down on the last card', async () => {
    const { wrapper } = card(4, { open: false })
    await press(wrapper.get('[data-testid="activity-menu"]').element)
    expect(document.querySelector('[data-testid="activity-move-down"]')).toBeNull()
    document.querySelector<HTMLElement>('[data-testid="activity-move-up"]')!.click()
    await settle()
    expect(wrapper.emitted('move')).toEqual([[-1]])
  })
})

describe('ActivityCard, problems open (spec F4)', () => {
  it('puts each problem under the field its path names', async () => {
    const { wrapper } = card(3, {
      problems: [
        { fieldId: 'name', message: 'Give a name of 1 to 80 characters.' },
        { fieldId: 'weight', message: 'Week 6 comes to 510 kg. The most is 500.' },
        { fieldId: 'key', message: 'Use lowercase letters, numbers and dashes.' },
        { fieldId: 'perSide', message: 'Give true or false.' },
        { fieldId: null, message: 'This activity has a key that is not part of the format.' },
        { fieldId: 'duration', message: 'An activity has reps or a duration, not both.' },
      ],
    })
    const name = wrapper.get('input[data-testid="activity-name"]')
    expect(name.attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[data-testid="activity-problem"]').exists()).toBe(false)
    const weight = wrapper.get('[data-testid="value-line"][data-field="weight"]')
    expect(weight.text()).toContain('Week 6 comes to 510 kg. The most is 500.')
    // A problem in More opens it.
    expect(wrapper.get('input[data-testid="activity-key"]').attributes('aria-invalid')).toBe('true')
    const general = wrapper.get('[data-slot="activity-errors"]').text()
    expect(general).toContain('Give true or false.')
    expect(general).toContain('not part of the format')
    // Measure says Reps, so a duration has no line of its own here.
    expect(general).toContain('reps or a duration, not both')
    expect(wrapper.get('[data-testid="activity-card"]').classes()).not.toContain('border-error-ink')
  })

  it('focuses the field a problem names: a value inside its line, More’s fields, the head', async () => {
    const { wrapper } = card(3)
    const vm = wrapper.vm as unknown as { focusField: (id: string | null) => Promise<void> }
    await vm.focusField('weight.add')
    expect(line(wrapper, 'weight').attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="value-amount"] input, input[data-testid="value-amount"]').element,
    )
    await vm.focusField('weight')
    expect(document.activeElement).toBe(line(wrapper, 'weight').element)
    await vm.focusField('notes')
    expect(document.activeElement).toBe(
      wrapper.get('textarea[data-testid="activity-notes"]').element,
    )
    await vm.focusField('name')
    expect(document.activeElement).toBe(wrapper.get('input[data-testid="activity-name"]').element)
    await vm.focusField(null)
    expect(document.activeElement).toBe(toggle(wrapper).element)
    await vm.focusField('perSide')
    expect(document.activeElement).toBe(toggle(wrapper).element)
  })
})
