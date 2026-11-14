import { settle } from './setup'
import { describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  tabsListVariants,
  tabsTriggerVariants,
} from '@/components/ui/tabs'

const TABS = [
  { value: 'appearance', label: 'Appearance' },
  { value: 'daily-goal', label: 'Daily goal' },
  { value: 'data', label: 'Your data' },
  { value: 'connections', label: 'Connections' },
]

/** The Settings tabs, each part its heading, with `open` as the open tab. */
function mountTabs(initial = 'appearance'): { wrapper: VueWrapper; open: { value: string } } {
  const open = ref(initial)
  const Host = defineComponent({
    components: { Tabs, TabsContent, TabsList, TabsTrigger },
    setup: () => ({ open, TABS }),
    template: `
      <Tabs v-model="open" class="mt-2">
        <TabsList aria-label="Settings" class="gap-x-[calc(var(--u)*32)]">
          <TabsTrigger v-for="t in TABS" :key="t.value" :value="t.value" class="text-(length:--set-text)">
            {{ t.label }}
          </TabsTrigger>
        </TabsList>
        <TabsContent v-for="t in TABS" :key="t.value" :value="t.value">
          <h2>{{ t.label }}</h2>
        </TabsContent>
      </Tabs>`,
  })
  const wrapper = mount(Host, { attachTo: document.body })
  return { wrapper, open }
}

function tabs(wrapper: VueWrapper) {
  return wrapper.findAll('[role="tab"]')
}
function selected(wrapper: VueWrapper): (string | undefined)[] {
  return tabs(wrapper).map((t) => t.attributes('aria-selected'))
}
function headings(wrapper: VueWrapper): string[] {
  return wrapper.findAll('h2').map((h) => h.text())
}

describe('Tabs', () => {
  it('is a named tablist of tab buttons, in order, the open one selected', () => {
    const { wrapper } = mountTabs()
    const list = wrapper.get('[role="tablist"]')
    expect(list.attributes('aria-label')).toBe('Settings')
    expect(tabs(wrapper).map((t) => t.text())).toEqual([
      'Appearance',
      'Daily goal',
      'Your data',
      'Connections',
    ])
    expect(tabs(wrapper).map((t) => t.attributes('type'))).toEqual(Array(4).fill('button'))
    expect(selected(wrapper)).toEqual(['true', 'false', 'false', 'false'])
    expect(tabs(wrapper).map((t) => t.attributes('data-state'))[0]).toBe('active')
  })

  it('renders only the open tab’s part, a tabpanel labelled by its tab', async () => {
    const { wrapper } = mountTabs('data')
    await settle()
    expect(headings(wrapper)).toEqual(['Your data'])
    const panel = wrapper.get('[role="tabpanel"]:not([hidden])')
    expect(panel.attributes('aria-labelledby')).toBe(tabs(wrapper)[2]!.attributes('id'))
    expect(tabs(wrapper)[2]!.attributes('aria-controls')).toBe(panel.attributes('id'))
  })

  it('opens a tab on a press', async () => {
    const { wrapper, open } = mountTabs()
    await tabs(wrapper)[3]!.trigger('mousedown')
    expect(open.value).toBe('connections')
    expect(selected(wrapper)).toEqual(['false', 'false', 'false', 'true'])
    expect(headings(wrapper)).toEqual(['Connections'])
  })

  it('follows the model when it changes from outside', async () => {
    const { wrapper, open } = mountTabs()
    open.value = 'daily-goal'
    await settle()
    expect(selected(wrapper)).toEqual(['false', 'true', 'false', 'false'])
    expect(headings(wrapper)).toEqual(['Daily goal'])
  })

  it('moves between tabs with the arrow keys, Home and End, opening each (automatic)', async () => {
    const { wrapper, open } = mountTabs()
    await settle()
    const list = wrapper.get('[role="tablist"]')
    const all = tabs(wrapper)
    // Reka's roving focus: the list is the one tab stop and hands focus to the open tab.
    expect(list.attributes('tabindex')).toBe('0')
    ;(list.element as HTMLElement).focus()
    await settle()
    expect(document.activeElement).toBe(all[0]!.element)
    expect(all.map((t) => t.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1'])
    await all[0]!.trigger('keydown', { key: 'ArrowRight' })
    await settle()
    expect(document.activeElement).toBe(all[1]!.element)
    expect(open.value).toBe('daily-goal')
    await all[1]!.trigger('keydown', { key: 'End' })
    await settle()
    expect(document.activeElement).toBe(all[3]!.element)
    expect(open.value).toBe('connections')
    await all[3]!.trigger('keydown', { key: 'Home' })
    await settle()
    expect(document.activeElement).toBe(all[0]!.element)
    expect(open.value).toBe('appearance')
    await all[0]!.trigger('keydown', { key: 'ArrowLeft' })
    await settle()
    expect(document.activeElement).toBe(all[3]!.element)
    expect(open.value).toBe('connections')
  })

  it('draws names in ink-secondary, the open one ink with a 3px ink rule, on a line rule', () => {
    const { wrapper } = mountTabs()
    expect(wrapper.get('[role="tablist"]').classes()).toEqual(
      expect.arrayContaining(['flex', 'flex-wrap', 'border-b', 'border-line', 'print:hidden']),
    )
    for (const tab of tabs(wrapper)) {
      expect(tab.classes()).toEqual(
        expect.arrayContaining([
          'min-h-11',
          'body',
          'font-semibold',
          'text-ink-secondary',
          'hover:text-ink',
          'data-[state=active]:text-ink',
          'data-[state=active]:shadow-[inset_0_-3px_0_var(--color-ink)]',
        ]),
      )
      // No side padding, so the open tab's rule is as wide as its name.
      expect(tab.classes().some((c) => /^p[xlr]-/.test(c))).toBe(false)
    }
    const all = tabsListVariants() + ' ' + tabsTriggerVariants()
    expect(all).toContain('motion-safe:duration-120')
    expect(all).not.toMatch(/pen|outline-none|#[0-9a-f]{3,6}\b/)
  })

  it('takes a page’s sizes from consumer classes, over its own', () => {
    const { wrapper } = mountTabs()
    const list = wrapper.get('[role="tablist"]')
    expect(list.classes()).toContain('gap-x-[calc(var(--u)*32)]')
    expect(list.classes()).not.toContain('gap-x-8')
    expect(tabs(wrapper)[0]!.classes()).toContain('text-(length:--set-text)')
    expect(wrapper.get('[data-slot="tabs"]').classes()).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'mt-2']),
    )
  })
})
