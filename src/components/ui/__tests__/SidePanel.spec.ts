import { settle } from './setup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { FOLDED, SidePanel } from '@/components/ui/side-panel'

const KEY = 'tracker.askHistoryOpen'

/** A MediaQueryList for the folded rule that a test can flip, as a phone turning on its side. */
function stubFolded(matches: boolean) {
  type Listener = (ev: MediaQueryListEvent) => void
  const listeners = new Set<Listener>()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === FOLDED ? matches : false,
      addEventListener: (_: string, fn: Listener) => listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    })),
  )
  return (next: boolean) => {
    for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent)
  }
}

/** The Ask page in small: a v-model, the slots, and its own toggle when folded. */
const Page = defineComponent({
  props: {
    storageKey: { type: String, default: KEY },
    startOpen: { type: Boolean, default: true },
  },
  setup(props, { expose }) {
    const open = ref(props.startOpen)
    const panel = ref<InstanceType<typeof SidePanel> | null>(null)
    expose({ open, panel })
    return () =>
      h(
        SidePanel,
        {
          ref: panel,
          open: open.value,
          'onUpdate:open': (v: boolean) => (open.value = v),
          storageKey: props.storageKey,
        },
        {
          title: () => 'History',
          strip: () => h('button', { id: 'strip-new', type: 'button' }, 'New conversation'),
          panel: () => h('button', { id: 'first-item', type: 'button' }, 'Is my diet good enough?'),
          default: ({ folded, panelId }: { folded: boolean; panelId: string }) =>
            h('main', [
              folded
                ? h(
                    'button',
                    {
                      id: 'toggle',
                      type: 'button',
                      'aria-controls': panelId,
                      'aria-expanded': String(open.value),
                      onClick: () => (open.value = true),
                    },
                    'Show history',
                  )
                : null,
              h('h1', 'Ask'),
            ]),
        },
      )
  },
})

function byLabel(label: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SidePanel, docked', () => {
  it('is a section named by its label, its head a title and a Hide button that controls it', () => {
    stubFolded(false)
    const page = mount(Page, { attachTo: document.body })
    const aside = page.get('[data-slot="side-panel-panel"]')
    expect(aside.element.tagName).toBe('SECTION')
    expect(aside.attributes('aria-label')).toBe('Conversation history')
    expect(aside.classes()).toEqual(expect.arrayContaining(['bg-panel', 'border-r', 'border-line']))
    expect(page.get('[data-slot="side-panel-panel"] h2').text()).toBe('History')
    const hide = byLabel('Hide history')!
    expect(hide.getAttribute('aria-expanded')).toBe('true')
    expect(hide.getAttribute('aria-controls')).toBe(aside.attributes('id'))
    // Open is the panel's resting state, so Hide has no tile fill until hovered (the mockup's head
    // button); IconButton's own aria-expanded tile stays for its other uses.
    expect(hide.className).toMatch(/\baria-expanded:not-hover:bg-transparent\b/)
    expect(page.find('#first-item').isVisible()).toBe(true)
    expect(page.get('[data-slot="side-panel-strip"]').isVisible()).toBe(false)
    expect(page.get('[data-slot="side-panel"]').classes()).toContain(
      'grid-cols-[max(260px,calc(var(--u)*300))_minmax(0,1fr)]',
    )
    expect(page.find('main h1').exists()).toBe(true)
  })

  it('hides to the strip, the line kept, moving focus to Show; and shows again', async () => {
    stubFolded(false)
    const page = mount(Page, { attachTo: document.body })
    byLabel('Hide history')!.click()
    await settle()
    expect((page.vm as unknown as { open: boolean }).open).toBe(false)
    const strip = page.get('[data-slot="side-panel-strip"]')
    expect(strip.isVisible()).toBe(true)
    expect(strip.find('#strip-new').exists()).toBe(true)
    expect(page.find('#first-item').isVisible()).toBe(false)
    expect(page.get('[data-slot="side-panel-panel"]').classes()).toContain('border-r')
    expect(page.get('[data-slot="side-panel"]').classes()).toContain(
      'grid-cols-[max(56px,calc(var(--u)*64))_minmax(0,1fr)]',
    )
    const show = byLabel('Show history')!
    expect(show.getAttribute('aria-expanded')).toBe('false')
    expect(show.getAttribute('aria-controls')).toBe(
      page.get('[data-slot="side-panel-panel"]').attributes('id'),
    )
    expect(document.activeElement).toBe(show)

    show.click()
    await settle()
    expect((page.vm as unknown as { open: boolean }).open).toBe(true)
    expect(document.activeElement).toBe(byLabel('Hide history'))
  })

  it('changes width over 200ms, and at once under reduced motion', () => {
    stubFolded(false)
    const classes = mount(Page).get('[data-slot="side-panel"]').classes()
    expect(classes).toEqual(
      expect.arrayContaining([
        'motion-safe:transition-[grid-template-columns]',
        'motion-safe:duration-200',
      ]),
    )
    expect(
      classes.filter((c) => /transition|duration/.test(c) && !c.startsWith('motion-safe:')),
    ).toEqual([])
  })

  it('remembers hidden or open on this device, under its key', async () => {
    stubFolded(false)
    localStorage.setItem(KEY, 'false')
    const page = mount(Page, { attachTo: document.body })
    await settle()
    expect((page.vm as unknown as { open: boolean }).open).toBe(false)
    byLabel('Show history')!.click()
    await settle()
    expect(localStorage.getItem(KEY)).toBe('true')
    byLabel('Hide history')!.click()
    await settle()
    expect(localStorage.getItem(KEY)).toBe('false')
  })

  it('opens, and still hides and shows, when storage throws', async () => {
    stubFolded(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const page = mount(Page, { attachTo: document.body, props: { startOpen: true } })
    await settle()
    expect((page.vm as unknown as { open: boolean }).open).toBe(true)
    byLabel('Hide history')!.click()
    await settle()
    expect((page.vm as unknown as { open: boolean }).open).toBe(false)
  })

  it('remembers nothing without a key, and close() leaves a docked panel alone', async () => {
    stubFolded(false)
    const page = mount(Page, { attachTo: document.body, props: { storageKey: '' } })
    byLabel('Hide history')!.click()
    await settle()
    expect(localStorage.length).toBe(0)
    byLabel('Show history')!.click()
    await settle()
    const vm = page.vm as unknown as { open: boolean; panel: { close: () => void } }
    vm.panel.close()
    await settle()
    expect(vm.open).toBe(true)
  })
})

describe('SidePanel, its title', () => {
  it.each([false, true])('reads History when the page gives none (folded: %s)', async (folded) => {
    stubFolded(folded)
    const open = ref(false)
    const Shell = defineComponent(
      () => () =>
        h(SidePanel, { open: open.value, 'onUpdate:open': (v: boolean) => (open.value = v) }),
    )
    mount(Shell, { attachTo: document.body })
    await settle()
    open.value = true
    await settle()
    expect(
      document.querySelector('[data-slot="side-panel"] h2, [role="dialog"] h2')!.textContent,
    ).toBe('History')
  })
})

describe('SidePanel, folded', () => {
  it('is a closed drawer at first, whatever was remembered, and gives the page its toggle', async () => {
    stubFolded(true)
    localStorage.setItem(KEY, 'true')
    const page = mount(Page, { attachTo: document.body })
    await settle()
    expect((page.vm as unknown as { open: boolean }).open).toBe(false)
    expect(page.find('[data-slot="side-panel-panel"]').exists()).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(page.get('[data-slot="side-panel"]').classes()).toContain('grid-cols-[minmax(0,1fr)]')
    expect(page.get('#toggle').attributes('aria-expanded')).toBe('false')
    expect(localStorage.getItem(KEY)).toBe('true')
  })

  it('opens over a 40% scrim, focus inside, and Escape closes it back to the toggle', async () => {
    stubFolded(true)
    const page = mount(Page, { attachTo: document.body })
    await settle()
    const toggle = document.getElementById('toggle')!
    toggle.focus()
    toggle.click()
    await settle()
    const drawer = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(drawer.getAttribute('aria-label')).toBe('Conversation history')
    expect(drawer.id).toBe(toggle.getAttribute('aria-controls'))
    expect(drawer.className).toMatch(/w-\[min\(85%,320px\)\]/)
    expect(drawer.className).toMatch(/motion-safe:transition-transform/)
    expect(drawer.querySelector('h2')!.textContent).toBe('History')
    expect(drawer.querySelector('#first-item')).not.toBeNull()
    expect(drawer.contains(document.activeElement)).toBe(true)
    const scrim = document.querySelector('[data-slot="side-panel-scrim"]')!
    expect(scrim.className).toMatch(/bg-scrim/)
    expect(scrim.className).toMatch(/opacity-40/)
    expect(localStorage.getItem(KEY)).toBeNull()

    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect((page.vm as unknown as { open: boolean }).open).toBe(false)
    expect(document.activeElement).toBe(toggle)
  })

  it('closes from its Hide button, and from close() when a conversation is picked', async () => {
    stubFolded(true)
    const page = mount(Page, { attachTo: document.body })
    const vm = page.vm as unknown as { open: boolean; panel: { close: () => void } }
    vm.open = true
    await settle()
    byLabel('Hide history')!.click()
    await settle()
    expect(vm.open).toBe(false)

    vm.open = true
    await settle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    vm.panel.close()
    await settle()
    expect(vm.open).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('docks again, as remembered, when the screen unfolds, and closes when it folds', async () => {
    const turn = stubFolded(false)
    localStorage.setItem(KEY, 'false')
    const page = mount(Page, { attachTo: document.body })
    await settle()
    turn(true)
    await settle()
    expect(page.find('[data-slot="side-panel-panel"]').exists()).toBe(false)
    expect((page.vm as unknown as { open: boolean }).open).toBe(false)
    turn(false)
    await settle()
    expect(page.find('[data-slot="side-panel-panel"]').exists()).toBe(true)
    expect((page.vm as unknown as { open: boolean }).open).toBe(false)
    localStorage.removeItem(KEY)
    turn(true)
    await settle()
    turn(false)
    await settle()
    expect((page.vm as unknown as { open: boolean }).open).toBe(true)
  })
})
