import { settle } from '@/components/ui/__tests__/setup'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProgrammeGridSection from '../sections/ProgrammeGridSection.vue'
import ProgrammeBuilderSection from '../sections/ProgrammeBuilderSection.vue'
import ActivityCardSection from '../sections/ActivityCardSection.vue'
import ValueFieldSection from '../sections/ValueFieldSection.vue'
import ExceptionWeekEditorSection from '../sections/ExceptionWeekEditorSection.vue'
import StartValueEditorSection from '../sections/StartValueEditorSection.vue'

/** The programme builder's sections (W5): each card state, captioned, under its id. */

const limited = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>('td[data-activity="deadlift"][data-limit]')].map(
    (td) => td.dataset.week,
  )

describe('ProgrammeGridSection, undated in the builder', () => {
  it('draws the weeks over the limit in error-ink with the problem’s path', () => {
    const wrapper = mount(ProgrammeGridSection, { attachTo: document.body })
    const grid = wrapper.get('#sg-programme-grid-builder-limit').element
    expect(limited(grid)).toEqual(['6', '7', '8'])
    expect(grid.querySelector('td[data-limit]')!.getAttribute('data-limit')).toBe(
      'activities[3].weight',
    )
    expect(grid.querySelector('td[data-limit]')!.textContent).toContain(', over the limit')
    expect(grid.querySelector('thead th[data-week="1"]')!.textContent).toBe('Week 1')
  })
})

describe('ProgrammeBuilderSection', () => {
  it('lays the activities beside the weeks, Deadlift’s problem on its card', async () => {
    const wrapper = mount(ProgrammeBuilderSection, { attachTo: document.body })
    const page = wrapper.get('#sg-programme-builder-limit')
    expect(page.findAll('[data-testid="activity-card"]')).toHaveLength(5)
    expect(page.get('[data-activity="deadlift"] [data-testid="activity-problem"]').text()).toBe(
      'Week 6 comes to 520 kg. The most is 500.',
    )
    expect(limited(page.element)).toEqual(['6', '7', '8'])
    expect(wrapper.get('#sg-programme-builder-kept').text()).toBe(
      'The weeks show the last version with no problems.',
    )
    await page.get('[data-activity="plank"] [data-slot="activity-toggle"]').trigger('click')
    expect(page.get('[data-activity="plank"] [role="group"]').attributes('aria-label')).toBe(
      'Plank',
    )
  })
})

describe('ActivityCardSection', () => {
  it('draws the cards closed, Plank open and a cardio card open', async () => {
    const wrapper = mount(ActivityCardSection, { attachTo: document.body })
    const closed = wrapper.get('#sg-activity-card-closed')
    expect(closed.findAll('[data-slot="activity-toggle"][aria-expanded="true"]')).toHaveLength(0)
    expect(closed.get('[data-activity="deadlift"]').classes()).toContain('border-error-ink')
    const open = wrapper.get('#sg-activity-card-open')
    expect(open.find('[data-activity="plank"] [role="group"]').exists()).toBe(true)
    const cardio = wrapper.get('#sg-activity-card-cardio')
    expect(cardio.find('[data-testid="activity-measure"]').exists()).toBe(false)
    expect(
      cardio.findAll('[data-testid="value-line"]').map((l) => l.attributes('data-field')),
    ).toEqual(['target', 'duration', 'distance'])
    // The ⋯ moves and removes a card in its own list only.
    const menu = open.get('[data-activity="plank"] [data-testid="activity-menu"]').element
    menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    ;(menu as HTMLElement).click()
    await settle()
    document.querySelector<HTMLElement>('[data-testid="activity-move-up"]')!.click()
    await settle()
    const keys = open
      .findAll('[data-testid="activity-card"]')
      .map((c) => c.attributes('data-activity'))
    expect(keys.slice(3)).toEqual(['plank', 'deadlift'])
    expect(open.find('[data-activity="plank"] [role="group"]').exists()).toBe(true)
    expect(closed.findAll('[data-testid="activity-card"]')).toHaveLength(5)
  })

  it('removes a card from its own list', async () => {
    const wrapper = mount(ActivityCardSection, { attachTo: document.body })
    const closed = wrapper.get('#sg-activity-card-closed')
    const menu = closed.get('[data-activity="bench"] [data-testid="activity-menu"]').element
    menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    ;(menu as HTMLElement).click()
    await settle()
    document.querySelector<HTMLElement>('[data-testid="activity-remove"]')!.click()
    await settle()
    expect(closed.findAll('[data-testid="activity-card"]')).toHaveLength(4)
    await closed.get('[data-activity="row"] [data-slot="activity-toggle"]').trigger('click')
    expect(closed.find('[data-activity="row"] [role="group"]').exists()).toBe(true)
  })
})

describe('ValueFieldSection', () => {
  it('draws each state the card shows, in its own list', async () => {
    const wrapper = mount(ValueFieldSection, { attachTo: document.body })
    const words = (id: string, field: string) =>
      wrapper.get(`#sg-value-field-${id} [data-field="${field}"] [data-slot="value-words"]`).text()
    expect(words('closed', 'weight')).toBe('None')
    expect(words('closed', 'duration')).toBe('30 s, +5 s every 2 weeks, up to 90 s')
    expect(wrapper.find('#sg-value-field-closed [role="group"]').exists()).toBe(false)
    expect(wrapper.get('#sg-value-field-grows [role="group"]').attributes('aria-label')).toBe(
      'Hold',
    )
    expect(wrapper.get('#sg-value-field-stays [role="group"]').attributes('aria-label')).toBe(
      'Sets',
    )
    expect(wrapper.get('#sg-value-field-none [role="group"]').text()).toContain(
      'Plank has no weight.',
    )
    expect(wrapper.get('#sg-value-field-param [data-testid="value-param-pick"]').text()).toContain(
      'Long ride',
    )
    expect(wrapper.get('#sg-value-field-errorClosed [data-testid="value-error"]').text()).toBe(
      'Week 6 comes to 520 kg. The most is 500.',
    )
    expect(
      wrapper.get('#sg-value-field-errorOpen [role="group"] [data-testid="value-error"]').text(),
    ).toBe('Week 6 comes to 520 kg. The most is 500.')
    // Each list writes its own draft.
    await wrapper.get('#sg-value-field-stays input[data-testid="value-start"]').setValue('4')
    expect(words('stays', 'sets')).toBe('4')
    expect(words('closed', 'sets')).toBe('3')
    await wrapper.get('#sg-value-field-closed [data-field="sets"] button').trigger('click')
    expect(wrapper.get('#sg-value-field-closed [role="group"]').attributes('aria-label')).toBe(
      'Sets',
    )
    await wrapper.get('#sg-value-field-closed [data-field="sets"] button').trigger('click')
    expect(wrapper.find('#sg-value-field-closed [role="group"]').exists()).toBe(false)
  })
})

describe('ExceptionWeekEditorSection', () => {
  it('draws the deload closed, open and with a week past the end', async () => {
    const wrapper = mount(ExceptionWeekEditorSection, { attachTo: document.body })
    const closed = wrapper.get('#sg-exception-week-editor-closed')
    expect(closed.text()).toContain('Weeks 4 and 8 · Deload')
    expect(closed.text()).toContain('Every activity: 3 sets, 90% of the weight.')
    expect(closed.find('[role="group"]').exists()).toBe(false)
    expect(closed.find('[data-testid="exception-add"]').exists()).toBe(true)
    const open = wrapper.get('#sg-exception-week-editor-open')
    expect(
      open.findAll('[data-testid="exception-group"]').map((g) => g.attributes('data-activity')),
    ).toEqual(['*', 'deadlift'])
    const error = wrapper.get('#sg-exception-week-editor-error')
    const weeks = error.get('input[data-testid="exception-weeks"]')
    expect(weeks.attributes('aria-invalid')).toBe('true')
    expect(error.text()).toContain('Week 9 is past the end. This programme has 8 weeks.')
    // Each example edits its own draft: the closed one opens, the open one closes and goes.
    await closed.get('[data-testid="exception-open"]').trigger('click')
    expect(closed.find('[role="group"]').exists()).toBe(true)
    await open.get('[data-slot="exception-toggle"]').trigger('click')
    expect(open.find('[role="group"]').exists()).toBe(false)
    await closed.get('[data-testid="exception-remove"]').trigger('click')
    expect(closed.findAll('[data-testid="exception-week"]')).toHaveLength(0)
    await closed.get('[data-testid="exception-add"]').trigger('click')
    expect(closed.findAll('[data-testid="exception-week"]')).toHaveLength(1)
    expect(open.findAll('[data-testid="exception-week"]')).toHaveLength(1)
  })
})

describe('ExceptionWeekEditorSection’s rest list (K191)', () => {
  it('draws week 3 resting the legs, open, its rows ticking on their own draft', async () => {
    const wrapper = mount(ExceptionWeekEditorSection, { attachTo: document.body })
    const rest = wrapper.get('#sg-exception-week-editor-rest')
    const rows = () => rest.findAll('[data-testid="exception-rest-row"]')
    const ticked = () =>
      rows()
        .filter((r) => r.attributes('aria-checked') === 'true')
        .map((r) => r.text())
    expect(rest.text()).toContain('Week 3 · Legs rest')
    expect(rest.text()).toContain('Rest: Back squat, Deadlift.')
    expect(ticked()).toEqual(['Back squat', 'Deadlift'])
    // Back squat rests and has nothing else: no group of its own.
    expect(
      rest.findAll('[data-testid="exception-group"]').map((g) => g.attributes('data-activity')),
    ).toEqual(['*', 'deadlift'])
    // The deload, closed above it, says nothing of a rest.
    expect(rest.text()).toContain('Weeks 4 and 8 · Deload')
    await rows()[2]!.trigger('click')
    expect(ticked()).toEqual(['Back squat', 'Bench press', 'Deadlift'])
    const open = wrapper.get('#sg-exception-week-editor-open')
    expect(open.findAll('[data-testid="exception-rest-row"][aria-checked="true"]')).toHaveLength(0)
  })
})

describe('StartValueEditorSection', () => {
  it('draws the values closed, Squat start open, and the refusal', async () => {
    const wrapper = mount(StartValueEditorSection, { attachTo: document.body })
    await settle()
    const closed = wrapper.get('#sg-start-value-editor-closed')
    expect(
      closed.findAll('[data-testid="start-value"]').map((r) => r.attributes('data-param')),
    ).toEqual(['squat', 'rate'])
    expect(closed.find('[role="group"]').exists()).toBe(false)
    const open = wrapper.get('#sg-start-value-editor-open')
    expect(open.get('[role="group"]').attributes('aria-label')).toBe('Squat start')
    const refused = wrapper.get('#sg-start-value-editor-refused')
    expect(refused.get('[data-testid="start-value-refused"]').text()).toBe(
      'Back squat’s weight uses Squat start. Give that field a number first, then remove it.',
    )
    expect(refused.find('input[data-testid="start-value-key"]').exists()).toBe(true)
    // Each example edits its own draft.
    await closed.get('[data-param="rate"] [data-testid="start-value-open"]').trigger('click')
    expect(closed.get('[role="group"]').attributes('aria-label')).toBe('Weekly increase')
    await closed.get('[data-testid="start-value-add"]').trigger('click')
    expect(closed.findAll('[data-testid="start-value"]')).toHaveLength(3)
    expect(closed.get('[role="group"]').attributes('aria-label')).toBe('This value')
    await closed.get('[data-testid="start-value-remove"]').trigger('click')
    expect(closed.findAll('[data-testid="start-value"]')).toHaveLength(2)
    await open.get('[data-slot="start-value-toggle"]').trigger('click')
    expect(open.find('[role="group"]').exists()).toBe(false)
  })
})
