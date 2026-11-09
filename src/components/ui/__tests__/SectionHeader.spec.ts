import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { SectionHeader } from '@/components/ui/section-header'

function header(hint?: string) {
  return mount(SectionHeader, {
    props: { title: 'Exercises', hint, headingId: 'exercises-heading', week: '19–25 October' },
  })
}

describe('SectionHeader', () => {
  it('titles the section with an h2 its section can point at: the serif a step under the week (K87)', () => {
    const title = header().get('h2')
    expect(title.attributes('id')).toBe('exercises-heading')
    expect(title.text()).toBe('Exercises')
    expect(title.classes()).toEqual(
      expect.arrayContaining(['title-1', 'screen:text-(length:--fs-section)']),
    )
    expect(title.classes()).not.toContain('screen:font-sans')
  })

  it('puts the hint under the title in caption ink-secondary, off paper (F24)', () => {
    const hint = header('Mark each day you ate it.').get('[data-slot="section-hint"]')
    expect(hint.text()).toBe('Mark each day you ate it.')
    expect(hint.classes()).toEqual(expect.arrayContaining(['caption', 'text-ink-secondary']))
    expect(hint.attributes('data-noprint')).toBeDefined()
  })

  it('leaves the hint out when there is none', () => {
    expect(header().find('[data-slot="section-hint"]').exists()).toBe(false)
  })

  it('sets the week first, centred across the line as the screen’s title, hidden from a screen reader (K86)', () => {
    const wrapper = header()
    expect(wrapper.element.tagName).toBe('HEADER')
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(['flex-wrap', 'items-baseline', 'print:break-after-avoid']),
    )
    // Actions follow the title rather than being pushed to the far end (K61).
    expect(wrapper.classes()).not.toContain('justify-between')
    const week = wrapper.get('[data-slot="section-week"]')
    expect(wrapper.element.firstElementChild).toBe(week.element)
    expect(week.text()).toBe('19–25 October')
    expect(week.attributes('aria-hidden')).toBe('true')
    // The title serif at the title size, in ink, centred, across the whole line; folded too.
    expect(week.classes()).toEqual(
      expect.arrayContaining([
        'title-1',
        'text-ink',
        'screen:block',
        'screen:col-span-full',
        'screen:text-center',
        'screen:text-(length:--fs-title)',
        'folded:basis-full',
      ]),
    )
    expect(week.classes()).not.toContain('text-ink-secondary')
    expect(week.classes()).not.toContain('folded:hidden')
  })

  it('shows no week where none is given, as in Edit plan (K81)', () => {
    const wrapper = mount(SectionHeader, { props: { title: 'Food', headingId: 'food-heading' } })
    expect(wrapper.find('[data-slot="section-week"]').exists()).toBe(false)
  })
})
