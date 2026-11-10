import { settle } from './setup'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { CircleUserRound, LogOut, UserRound } from '@lucide/vue'
import { BarAction } from '@/components/ui/bar-action'
import { Menu, MenuItem, menuItemVariants, menuVariants } from '@/components/ui/menu'

const EMAIL = 'alex@example.com'

/** The account menu as the bar will hold it (K106), with controls before and after it. */
function mountMenu(options: { header?: boolean } = {}) {
  const onProfile = vi.fn<(event: Event) => void>()
  const onSignOut = vi.fn<(event: Event) => void>()
  const open = ref(false)
  const Page = defineComponent({
    setup() {
      return () =>
        h('div', [
          h('button', { id: 'before', type: 'button' }, 'Before'),
          h(
            Menu,
            {
              ...(options.header === false ? {} : { headerCaption: 'Signed in as', header: EMAIL }),
              open: open.value,
              'onUpdate:open': (value: boolean) => (open.value = value),
            },
            {
              trigger: () =>
                // No id of its own: the menu gives the trigger the id that names the panel.
                h(BarAction, { label: 'Profile' }, { default: () => h(CircleUserRound) }),
              default: () => [
                h(
                  MenuItem,
                  { id: 'profile', onSelect: onProfile },
                  { icon: () => h(UserRound), default: () => 'Profile' },
                ),
                h(
                  MenuItem,
                  { id: 'sign-out', onSelect: onSignOut },
                  { icon: () => h(LogOut), default: () => 'Sign out' },
                ),
              ],
            },
          ),
          h('button', { id: 'after', type: 'button' }, 'After'),
        ])
    },
  })
  const wrapper = mount(Page, { attachTo: document.body })
  return { wrapper, onProfile, onSignOut, open }
}

function trigger(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-slot="bar-action"]')!
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el
}

function panel(): HTMLElement | null {
  return document.querySelector('[data-slot="menu"]')
}

function key(target: Element, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

/** A primary-button press: pointerdown (what a dismissable layer hears), then click. */
async function press(target: HTMLElement): Promise<void> {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  target.click()
  await settle()
}

async function openByKeyboard(): Promise<ReturnType<typeof mountMenu>> {
  const mounted = mountMenu()
  trigger().focus()
  key(trigger(), 'Enter')
  await settle()
  expect(panel()).not.toBeNull()
  return mounted
}

describe('Menu', () => {
  it('opens on a press of its trigger, as a menu named by the trigger', async () => {
    const { open } = mountMenu()
    const button = trigger()
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(panel()).toBeNull()

    await press(button)

    const content = panel()!
    expect(content).not.toBeNull()
    expect(open.value).toBe(true)
    expect(content.getAttribute('role')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(content.id)
    expect(content.getAttribute('aria-labelledby')).toBe(button.id)
    // Under the trigger, right edges aligned.
    expect(content.dataset.side).toBe('bottom')
    expect(content.dataset.align).toBe('end')
    // The open trigger keeps a tile fill (the card's Open state).
    expect(button.classList).toContain('aria-expanded:bg-tile')
  })

  it('shows the header over its items, and describes the menu by it', async () => {
    mountMenu()
    await press(trigger())
    const content = panel()!
    const header = content.querySelector<HTMLElement>('[data-slot="menu-header"]')!
    expect(header.textContent).toBe(`Signed in as${EMAIL}`)
    expect(content.getAttribute('aria-describedby')).toBe(header.id)
    const caption = header.firstElementChild!
    expect(caption.textContent).toBe('Signed in as')
    expect([...caption.classList]).toEqual(
      expect.arrayContaining(['caption', 'text-ink-secondary']),
    )
    expect([...header.lastElementChild!.classList]).toEqual(
      expect.arrayContaining(['label', 'text-ink', 'wrap-anywhere']),
    )

    const items = [...content.querySelectorAll('[role="menuitem"]')]
    expect(items.map((item) => item.textContent)).toEqual(['Profile', 'Sign out'])
    // Each item draws its Lucide icon, hidden from assistive technology, before its name.
    for (const item of items) {
      const icon = item.querySelector('svg')!
      expect(icon.getAttribute('aria-hidden')).toBe('true')
      expect(icon.getAttribute('stroke-width')).toBe('1.5')
    }
    // The header is text, not an item.
    expect(header.getAttribute('role')).toBeNull()
  })

  it('has no header and no description when none is given', async () => {
    mountMenu({ header: false })
    await press(trigger())
    const content = panel()!
    expect(content.querySelector('[data-slot="menu-header"]')).toBeNull()
    expect(content.hasAttribute('aria-describedby')).toBe(false)
    expect(content.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
  })

  it('opens from the keyboard with the first item focused', async () => {
    await openByKeyboard()
    expect(document.activeElement).toBe(byId('profile'))
    expect(byId('profile').hasAttribute('data-highlighted')).toBe(true)
  })

  it('moves the highlight with the arrow keys, passing over the header and wrapping', async () => {
    await openByKeyboard()
    key(byId('profile'), 'ArrowDown')
    await settle()
    expect(document.activeElement).toBe(byId('sign-out'))
    expect(byId('sign-out').hasAttribute('data-highlighted')).toBe(true)
    expect(byId('profile').hasAttribute('data-highlighted')).toBe(false)

    key(byId('sign-out'), 'ArrowDown')
    await settle()
    expect(document.activeElement).toBe(byId('profile'))

    key(byId('profile'), 'ArrowUp')
    await settle()
    expect(document.activeElement).toBe(byId('sign-out'))
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const { open, onProfile, onSignOut } = await openByKeyboard()
    key(byId('profile'), 'Escape')
    await settle()
    expect(panel()).toBeNull()
    expect(open.value).toBe(false)
    expect(document.activeElement).toBe(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(onProfile).not.toHaveBeenCalled()
    expect(onSignOut).not.toHaveBeenCalled()
  })

  it('fires an item’s select handler on a press, then closes and returns focus', async () => {
    const { onProfile, onSignOut } = mountMenu()
    trigger().focus()
    await press(trigger())
    byId('sign-out').click()
    await settle()
    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(onProfile).not.toHaveBeenCalled()
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('fires the highlighted item’s select handler on Enter', async () => {
    const { onProfile, onSignOut } = await openByKeyboard()
    key(byId('profile'), 'Enter')
    await settle()
    expect(onProfile).toHaveBeenCalledTimes(1)
    expect(onSignOut).not.toHaveBeenCalled()
    expect(panel()).toBeNull()
  })

  it('closes on a pointer press outside', async () => {
    const { onProfile, onSignOut } = mountMenu()
    await press(trigger())
    expect(panel()).not.toBeNull()
    await press(byId('before'))
    expect(panel()).toBeNull()
    expect(onProfile).not.toHaveBeenCalled()
    expect(onSignOut).not.toHaveBeenCalled()
  })

  it('opens from code through v-model:open', async () => {
    const { open } = mountMenu()
    open.value = true
    await settle()
    expect(panel()).not.toBeNull()
  })

  it('draws the card: panel, line border, radius-lg, overlay shadow, 288px; 48px items on tile', async () => {
    mountMenu()
    await press(trigger())
    expect([...panel()!.classList]).toEqual(
      expect.arrayContaining([
        'bg-panel',
        'border',
        'border-line',
        'rounded-lg',
        'shadow-overlay',
        'p-2',
        'w-72',
        'max-w-(--reka-dropdown-menu-content-available-width)',
      ]),
    )
    expect([...byId('profile').classList]).toEqual(
      expect.arrayContaining(['min-h-12', 'rounded-md', 'label', 'data-highlighted:bg-tile']),
    )
    // No raw colours, no motion beyond the 120ms fade, and the focus ring stays the global one.
    for (const value of [menuVariants(), menuItemVariants()]) {
      expect(value).not.toMatch(/#[0-9a-f]{3,6}|animate-|zoom|slide/)
    }
    expect(menuItemVariants()).not.toMatch(/outline-none/)
    expect(menuVariants()).toContain('motion-safe:duration-120')
  })
})
