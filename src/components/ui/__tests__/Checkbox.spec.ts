import './setup'
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { Checkbox, checkboxBoxVariants, checkboxVariants } from '@/components/ui/checkbox'

type Props = InstanceType<typeof Checkbox>['$props']

function mountCheckbox(props: Partial<Props> & { modelValue: boolean }): VueWrapper {
  const wrapper: VueWrapper = mount(Checkbox, {
    attachTo: document.body,
    props: {
      label: 'Back squat',
      ...props,
      'onUpdate:modelValue': (value: boolean) => wrapper.setProps({ modelValue: value }),
    },
  })
  return wrapper
}

describe('Checkbox', () => {
  it('is a role="checkbox" button named by its visible label', () => {
    const row = mountCheckbox({ modelValue: false }).get('button')
    expect(row.attributes('role')).toBe('checkbox')
    expect(row.attributes('type')).toBe('button')
    expect(row.attributes('aria-checked')).toBe('false')
    expect(row.text()).toBe('Back squat')
    expect(row.attributes('aria-label')).toBeUndefined()
  })

  it('requires a label at the type level', () => {
    // @ts-expect-error label is required
    const props: Props = { modelValue: true }
    expect(props).toEqual({ modelValue: true })
  })

  it('ticks and unticks on a press, as a boolean', async () => {
    const wrapper = mountCheckbox({ modelValue: false })
    const row = wrapper.get('button')
    await row.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    expect(row.attributes('aria-checked')).toBe('true')
    await row.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true], [false]])
    expect(row.attributes('aria-checked')).toBe('false')
  })

  it('draws a ticked box in ink with an on-ink check, never the pen', () => {
    const wrapper = mountCheckbox({ modelValue: true })
    const box = wrapper.get('[data-slot="checkbox-box"]')
    expect(box.attributes('aria-hidden')).toBe('true')
    expect(box.classes()).toEqual(
      expect.arrayContaining([
        'size-6',
        'border-2',
        'border-control-border',
        'bg-panel',
        'rounded-sm',
        'group-data-[state=checked]/checkbox:border-ink',
        'group-data-[state=checked]/checkbox:bg-ink',
      ]),
    )
    const tick = wrapper.get('[data-slot="checkbox-tick"]')
    expect(tick.classes()).toContain('text-on-ink')
    expect(tick.find('svg').exists()).toBe(true)
    expect(wrapper.html()).not.toMatch(/pen/)
  })

  it('shows no tick while unticked', () => {
    const wrapper = mountCheckbox({ modelValue: false })
    expect(wrapper.find('[data-slot="checkbox-tick"]').exists()).toBe(false)
  })

  it('is a row at least 48px tall, colour-only transitions and the global focus outline', () => {
    const row = checkboxVariants()
    for (const name of ['min-h-12', 'gap-3', 'text-ink', 'text-left']) expect(row).toContain(name)
    expect(row).not.toMatch(/ring|outline-none|overflow-hidden|transition-all/)
    const box = checkboxBoxVariants()
    expect(box).toContain('group-hover/checkbox:group-enabled/checkbox:border-ink')
    expect(box).toContain('motion-safe:duration-120')
    expect(box).not.toMatch(/transition-all/)
  })

  it('fades to 40% only when disabled, and does not change then', async () => {
    const wrapper = mountCheckbox({ modelValue: true, disabled: true })
    const row = wrapper.get('button')
    expect(row.attributes('disabled')).toBeDefined()
    expect(row.classes()).toContain('disabled:opacity-40')
    await row.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(row.attributes('aria-checked')).toBe('true')
  })

  it('puts a consumer class and attributes on the row', () => {
    const row = mountCheckbox({
      modelValue: false,
      class: 'w-full',
      'aria-describedby': 'hint',
    } as Partial<Props> & { modelValue: boolean }).get('button')
    expect(row.classes()).toContain('w-full')
    expect(row.attributes('aria-describedby')).toBe('hint')
  })
})
