import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { QuotaChip, questionsLeft } from '@/components/ui/quota-chip'

describe('questionsLeft', () => {
  it.each([
    [30, 30, '30 questions left today'],
    [27, 30, '27 questions left today'],
    [4, 30, '4 questions left today'],
    [3, 30, 'Three questions left today'],
    [2, 30, 'Two questions left today'],
    [1, 30, 'One question left today'],
    [0, 30, 'No questions left today'],
  ])('%i of %i reads “%s”', (remaining, limit, words) => {
    expect(questionsLeft(remaining, limit)).toBe(words)
  })

  it('holds a count outside 0 to the limit to it', () => {
    expect(questionsLeft(-2, 30)).toBe('No questions left today')
    expect(questionsLeft(45, 30)).toBe('30 questions left today')
    expect(questionsLeft(2.6, 30)).toBe('Two questions left today')
  })
})

describe('QuotaChip', () => {
  it('is a Chip with the count in words, in ink-secondary while some are left', () => {
    const chip = mount(QuotaChip, { props: { remaining: 27, limit: 30 } })
    expect(chip.element.tagName).toBe('SPAN')
    expect(chip.attributes('data-slot')).toBe('chip')
    expect(chip.attributes('data-left')).toBe('27')
    expect(chip.classes()).toEqual(
      expect.arrayContaining(['label', 'bg-tile', 'text-ink-secondary', 'rounded-sm', 'py-0.5']),
    )
    expect(chip.text()).toBe('27 questions left today')
    expect(chip.find('.text-ink').exists()).toBe(false)
    expect(chip.attributes('role')).toBeUndefined()
    expect(chip.attributes('tabindex')).toBeUndefined()
  })

  it('sets “No questions left today” in ink, never an error or caution ink', () => {
    const chip = mount(QuotaChip, { props: { remaining: 0, limit: 30 } })
    expect(chip.text()).toBe('No questions left today')
    expect(chip.attributes('data-left')).toBe('0')
    expect(chip.get('span span').classes()).toContain('text-ink')
    expect(chip.html()).not.toMatch(/error-ink|caution-ink|pen/)
  })

  it('follows the count as it changes', async () => {
    const chip = mount(QuotaChip, { props: { remaining: 4, limit: 30 } })
    await chip.setProps({ remaining: 3 })
    expect(chip.text()).toBe('Three questions left today')
    await chip.setProps({ remaining: 1 })
    expect(chip.text()).toBe('One question left today')
  })
})
