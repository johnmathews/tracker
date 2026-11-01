import './setup'
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { Switch, switchVariants } from '@/components/ui/switch'

type Props = InstanceType<typeof Switch>['$props']

function mountSwitch(props: Partial<Props> & { modelValue: boolean }): VueWrapper {
  const wrapper: VueWrapper = mount(Switch, {
    attachTo: document.body,
    props: {
      label: 'Edit plan',
      ...props,
      'onUpdate:modelValue': (value: boolean) => wrapper.setProps({ modelValue: value }),
    },
  })
  return wrapper
}

describe('Switch', () => {
  it('is a role="switch" button named by its visible label', () => {
    const button = mountSwitch({ modelValue: false }).get('button')
    expect(button.attributes('role')).toBe('switch')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-checked')).toBe('false')
    expect(button.text()).toBe('Edit plan')
    expect(button.attributes('aria-label')).toBeUndefined()
  })

  it('adds context words to its name for screen readers only (K66)', () => {
    const button = mountSwitch({ modelValue: true, label: 'Show', context: 'Notes' }).get('button')
    expect(button.text()).toBe('Show Notes')
    const hidden = button.get('[data-slot="switch-context"]')
    expect(hidden.classes()).toContain('sr-only')
    expect(hidden.text()).toBe('Notes')
    expect(button.attributes('aria-label')).toBeUndefined()
  })

  it('requires a label at the type level', () => {
    // @ts-expect-error label is required
    const props: Props = { modelValue: true }
    expect(props).toEqual({ modelValue: true })
  })

  it('toggles aria-checked and the model on a press', async () => {
    const wrapper = mountSwitch({ modelValue: false })
    const button = wrapper.get('button')
    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    expect(button.attributes('aria-checked')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true], [false]])
    expect(button.attributes('aria-checked')).toBe('false')
  })

  it('draws on as an ink track with an on-ink thumb, never the pen', () => {
    const wrapper = mountSwitch({ modelValue: true })
    const track = wrapper.get('[data-slot="switch-track"]')
    const thumb = wrapper.get('[data-slot="switch-thumb"]')
    expect(track.attributes('aria-hidden')).toBe('true')
    expect(track.classes()).toEqual(
      expect.arrayContaining([
        'border-control-border',
        'group-data-[state=checked]/switch:border-ink',
        'group-data-[state=checked]/switch:bg-ink',
      ]),
    )
    expect(thumb.classes()).toEqual(
      expect.arrayContaining([
        'bg-ink-secondary',
        'data-[state=checked]:translate-x-4',
        'data-[state=checked]:bg-on-ink',
      ]),
    )
    expect(wrapper.html()).not.toMatch(/pen/)
  })

  it('is a 44px row with a tile on hover, colour-only transitions and the global focus outline', () => {
    const value = switchVariants()
    for (const name of ['h-11', 'px-2', 'rounded-md', 'hover:not-disabled:bg-tile']) {
      expect(value).toContain(name)
    }
    expect(value).toContain('motion-safe:duration-120')
    expect(value).not.toMatch(/ring|outline-none|overflow-hidden|translate|transition-all/)
  })

  it('fades to 40% only when disabled, and does not toggle then', async () => {
    const wrapper = mountSwitch({ modelValue: false, disabled: true })
    const button = wrapper.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.classes()).toContain('disabled:opacity-40')
    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('shows a shorter label on a phone while the accessible name stays the full label', () => {
    const button = mountSwitch({ modelValue: false, shortLabel: 'Edit' }).get('button')
    expect(button.attributes('aria-label')).toBe('Edit plan')
    const short = button.get('[data-slot="switch-short-label"]')
    expect(short.text()).toBe('Edit')
    expect(short.classes()).toContain('sm:hidden')
    expect(button.get('[data-slot="switch-label"]').classes()).toContain('max-sm:hidden')
  })

  it('puts a consumer class on the button', () => {
    const button = mountSwitch({ modelValue: false, class: 'ml-auto' }).get('button')
    expect(button.classes()).toContain('ml-auto')
  })
})
