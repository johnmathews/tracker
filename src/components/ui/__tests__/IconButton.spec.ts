import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import { ChevronLeft } from '@lucide/vue'
import { IconButton, iconButtonVariants } from '@/components/ui/icon-button'

describe('IconButton', () => {
  it('takes its accessible name from the required label', () => {
    const wrapper = mount(IconButton, {
      props: { label: 'Previous week' },
      slots: { default: () => h(ChevronLeft) },
    })
    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('Previous week')
    expect(button.attributes('type')).toBe('button')
    expect(button.text()).toBe('')
  })

  it('requires a label at the type level', () => {
    // vue-tsc fails `npm run type-check` here if `label` ever becomes optional.
    // @ts-expect-error label is required
    const props: InstanceType<typeof IconButton>['$props'] = {}
    expect(props).toEqual({})
  })

  it('renders nothing without a label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mount(IconButton, { props: { label: '' } })
    expect(wrapper.find('button').exists()).toBe(false)
    warn.mockRestore()
  })

  it('fades its icon and takes no hover fill when aria-disabled at an end (K66)', () => {
    const button = mount(IconButton, {
      props: { label: 'Move Notes up' },
      attrs: { 'aria-disabled': 'true' },
    }).get('button')
    expect(button.attributes('aria-disabled')).toBe('true')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.classes()).toEqual(
      expect.arrayContaining([
        'hover:not-disabled:not-aria-disabled:bg-tile',
        'aria-disabled:cursor-default',
        'aria-disabled:[&_svg]:opacity-40',
      ]),
    )
    expect(button.classes()).not.toContain('hover:not-disabled:bg-tile')
  })

  it('is a 44px square, quiet by default, with a tile on hover and while open', () => {
    const button = mount(IconButton, { props: { label: 'Settings' } }).get('button')
    expect(button.attributes('data-variant')).toBe('quiet')
    expect(button.classes()).toEqual(
      expect.arrayContaining([
        'size-11',
        'rounded-md',
        'text-ink',
        'hover:not-disabled:not-aria-disabled:bg-tile',
        'aria-expanded:bg-tile',
      ]),
    )
    expect(button.classes()).not.toContain('border-control-border')
  })

  it('draws the control border when outlined', () => {
    const button = mount(IconButton, {
      props: { label: 'Close', variant: 'outlined' },
    }).get('button')
    expect(button.attributes('data-variant')).toBe('outlined')
    expect(button.classes()).toContain('border-control-border')
  })

  it('sizes a slotted Lucide icon to 20px at a 1.5 stroke, hidden from assistive tech', () => {
    const svg = mount(IconButton, {
      props: { label: 'Previous week' },
      slots: { default: () => h(ChevronLeft) },
    }).get('svg')
    expect(svg.attributes('width')).toBe('20')
    expect(svg.attributes('height')).toBe('20')
    expect(svg.attributes('stroke-width')).toBe('1.5')
    expect(svg.attributes('stroke')).toBe('currentColor')
    expect(svg.attributes('aria-hidden')).toBe('true')
  })

  it('passes aria-expanded, aria-controls, disabled and clicks through to the button', async () => {
    const onClick = vi.fn<() => void>()
    const wrapper = mount(IconButton, {
      props: { label: 'Settings', class: 'ml-auto' },
      attrs: { 'aria-expanded': 'true', 'aria-controls': 'settings-panel', onClick },
    })
    const button = wrapper.get('button')
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(button.attributes('aria-controls')).toBe('settings-panel')
    expect(button.classes()).toContain('ml-auto')
    await button.trigger('click')
    expect(onClick).toHaveBeenCalledOnce()

    await wrapper.setProps({ type: 'submit' })
    expect(button.attributes('type')).toBe('submit')
  })

  it('fades to 40% only when disabled, with the solid global focus outline', () => {
    const value = iconButtonVariants({ variant: 'outlined' })
    expect(value).toContain('disabled:opacity-40')
    expect(value).toContain('motion-safe:duration-120')
    expect(value).not.toMatch(/ring|outline-none/)
  })
})
