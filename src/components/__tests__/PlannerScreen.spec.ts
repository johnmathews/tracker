/**
 * The planner's screens (PlannerScreen and Header cards, K24–K27, K79, K80): the bar out of
 * sight until a long press opens Edit plan, the ways on to Cardio and Food, and the ordinary sticky bar in Edit plan, mounted in the real app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { HOLD_MS } from '@/composables/barReveal'
import { signedIn } from '@/lib/__tests__/signedIn'

const NOW = new Date(2026, 9, 23, 18, 0)

let wrapper: VueWrapper

function mountApp(): VueWrapper {
  signedIn()
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

const bar = () => wrapper.get('[data-slot="bar"]')
const handle = () => wrapper.get('[data-slot="bar-handle"]')
const finger = { pointerType: 'touch' }
/** Edit plan is on: the bar ends with "Done" (K82), and is the sticky one in the page (K27). */
const editing = () => wrapper.get('[data-testid="edit-plan-button"]').text() === 'Done'
const screens = () => document.documentElement.classList.contains('planner-screens')
const editScreens = () => document.documentElement.classList.contains('edit-screens')
/** A pointer event at a height on the screen (trigger can't set clientY). */
async function press(el: Element, type: string, clientY: number): Promise<void> {
  el.dispatchEvent(new MouseEvent(type, { clientY, bubbles: true }))
  await flushPromises()
}
/** The first day cell of the week, a button that toggles its mark on click. */
const dayCell = () => wrapper.get('[data-slot="day-mark-button"]')

type PointerInit = {
  x?: number
  y?: number
  button?: number
  pointerType?: string
  pointerId?: number
  isPrimary?: boolean
}
/** A pointer event anywhere on the page: jsdom has no PointerEvent, so a MouseEvent stands in. */
function pointer(el: EventTarget, type: string, init: PointerInit = {}): MouseEvent {
  const ev = new MouseEvent(type, {
    clientX: init.x ?? 200,
    clientY: init.y ?? 300,
    button: init.button ?? 0,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse' })
  if (init.pointerId !== undefined)
    Object.defineProperty(ev, 'pointerId', { value: init.pointerId })
  if (init.isPrimary !== undefined)
    Object.defineProperty(ev, 'isPrimary', { value: init.isPrimary })
  el.dispatchEvent(ev)
  return ev
}
/** Holds a press on `el` for `ms`, and leaves it held. */
async function hold(el: EventTarget, ms: number, init: PointerInit = {}): Promise<void> {
  pointer(el, 'pointerdown', init)
  vi.advanceTimersByTime(ms)
  await flushPromises()
}
/** Lets go of a press: pointerup, then the click the browser sends after it. */
async function release(el: Element, init: PointerInit = {}): Promise<void> {
  pointer(el, 'pointerup', init)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await flushPromises()
}
/** A whole long press on the page: held, then let go. */
async function longPress(init: PointerInit = {}): Promise<void> {
  await hold(document.body, HOLD_MS, init)
  await release(document.body as unknown as Element, init)
}

describe('the planner’s screens (K24–K27)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('marks <html> for the screens, and lifts the mark in Edit plan, where the bar is sticky', async () => {
    mountApp()
    expect(screens()).toBe(true)
    expect(bar().classes()).toContain('fixed')
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(screens()).toBe(false)
    expect(bar().classes()).toContain('sticky')
    expect(wrapper.find('[data-slot="bar-handle"]').exists()).toBe(false)
  })

  it('measures the bar again whenever it changes size, and forgets it on the way out (K99)', () => {
    let measure: (() => void) | undefined
    const disconnect = vi.fn<() => void>()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          measure = callback
        }
        observe(): void {}
        disconnect = disconnect
      },
    )
    try {
      mountApp()
      const height = vi.spyOn(bar().element as HTMLElement, 'offsetHeight', 'get')
      height.mockReturnValue(140) // folded, the bar wraps onto a second line
      measure!()
      expect(document.documentElement.style.getPropertyValue('--bar-height')).toBe('140px')
      wrapper.unmount()
      expect(disconnect).toHaveBeenCalled()
      expect(document.documentElement.style.getPropertyValue('--bar-height')).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('gives Edit plan screens of its own under the sticky bar, and the week’s back (K99)', async () => {
    mountApp()
    expect(editScreens()).toBe(false)
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(editScreens()).toBe(true)
    expect(screens()).toBe(false)
    // The bar's height is there for main.css: each screen is the window less the bar.
    expect(document.documentElement.style.getPropertyValue('--bar-height')).toMatch(/^\d+px$/)
    // Each tracker is a screen, at least the window less the bar, from the top (option B).
    for (const id of ['exercises-heading', 'cardio-heading', 'diet-heading']) {
      const section = wrapper.get(`section[aria-labelledby="${id}"]`)
      expect(section.attributes('data-planner-screen')).toBeDefined()
      expect(section.classes()).toContain('edit:min-h-[calc(100dvh-var(--bar-height,0px))]')
      expect(section.classes()).not.toContain('edit:justify-center')
    }
    // The arrows show in Edit plan; the way on shares Add's line.
    for (const id of ['to-cardio', 'to-food', 'to-exercises', 'back-to-cardio']) {
      expect(wrapper.get(`[data-testid="${id}"]`).classes()).toContain('edit:inline-flex')
    }
    const wayOn = wrapper.get('[data-testid="to-cardio"]').element.parentElement!
    expect(wayOn.querySelector('[data-testid="add-exercise"]')).not.toBeNull()
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(editScreens()).toBe(false)
    expect(screens()).toBe(true)
  })

  it('leads the bar with the week as its title, with no wordmark (K81)', async () => {
    mountApp()
    expect(bar().find('[data-slot="brand-mark"], svg[aria-label="Tracker"]').exists()).toBe(false)
    const row = bar().get('nav[aria-label="Week"]').element.parentElement!
    expect(row.firstElementChild).toBe(bar().get('nav[aria-label="Week"]').element)
    const label = bar().get('[data-testid="week-label"]')
    expect(label.classes()).toContain('title-1')
    expect(label.classes()).toContain('text-(length:--bar-week)')
    // Another week on screen: "This week" is the first of the actions.
    await wrapper.get('button[aria-label="Next week"]').trigger('click')
    expect(bar().findAll('[data-slot="bar-action"]')[0]!.text()).toBe('This week')
  })

  it('ends the actions with Full screen where the browser has one, in Edit plan too (K49, K91)', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    try {
      mountApp()
      const actions = () =>
        bar()
          .findAll('[data-slot="bar-action"]')
          .map((b) => b.text())
      expect(actions().at(-1)).toBe('Full screen')
      await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
      expect(actions().at(-1)).toBe('Full screen')
      // Full screen on: the button says how to leave it.
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: document.documentElement,
      })
      document.dispatchEvent(new Event('fullscreenchange'))
      await flushPromises()
      expect(wrapper.get('[data-testid="fullscreen-button"]').text()).toBe('Exit full screen')
    } finally {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: undefined })
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    }
  })

  it('has no Edit plan or Done action: the keyboard’s hidden button goes in and out (K82, K91)', async () => {
    mountApp()
    const actions = () =>
      bar()
        .findAll('[data-slot="bar-action"]')
        .map((b) => b.text())
    expect(actions()).not.toContain('Edit plan')
    expect(actions()).not.toContain('Done')
    // The keyboard's way in and out: after "Skip to today", out of sight until focused.
    const hidden = wrapper.get('[data-testid="edit-plan-button"]')
    expect(hidden.element.tagName).toBe('BUTTON')
    expect(hidden.classes()).toEqual(expect.arrayContaining(['sr-only', 'focus:not-sr-only']))
    expect(hidden.attributes('aria-keyshortcuts')).toBe('E')
    expect(hidden.element.previousElementSibling?.getAttribute('data-testid')).toBe('skip-to-today')
    await hidden.trigger('click')
    expect(editing()).toBe(true)
    expect(actions()).not.toContain('Done')
    await hidden.trigger('click')
    expect(editing()).toBe(false)
    expect(screens()).toBe(true)
  })

  describe('the week’s keys (K91)', () => {
    async function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      target.dispatchEvent(event)
      await flushPromises()
      return event
    }

    it('E goes into Edit plan and out again, and Esc leaves it', async () => {
      mountApp()
      expect((await press('e')).defaultPrevented).toBe(true)
      expect(editing()).toBe(true)
      await press('E')
      expect(editing()).toBe(false)
      expect((await press('Escape')).defaultPrevented).toBe(false) // nothing to leave
      await press('e')
      await press('Escape')
      expect(editing()).toBe(false)
    })

    it('P prints, S opens Settings, and each button names its key', async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => {})
      mountApp()
      await press('p')
      expect(print).toHaveBeenCalledOnce()
      const keys = bar()
        .findAll('[data-slot="bar-action"]')
        .map((b) => [b.text(), b.attributes('aria-keyshortcuts')])
      expect(keys).toEqual(
        expect.arrayContaining([
          ['Settings', 'S'],
          ['Print…', 'P'],
        ]),
      )
      await press('s')
      expect(location.hash).toBe('#/settings')
      history.replaceState(null, '', location.pathname)
      print.mockRestore()
    })

    it('F toggles full screen where the browser has it, and Esc leaves it before Edit plan', async () => {
      const request = vi.fn<() => Promise<void>>(async () => {})
      const exit = vi.fn<() => Promise<void>>(async () => {})
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
      document.documentElement.requestFullscreen = request
      document.exitFullscreen = exit
      try {
        mountApp()
        expect(
          wrapper.get('[data-testid="fullscreen-button"]').attributes('aria-keyshortcuts'),
        ).toBe('F')
        await press('f')
        expect(request).toHaveBeenCalledOnce()
        Object.defineProperty(document, 'fullscreenElement', {
          configurable: true,
          value: document.documentElement,
        })
        document.dispatchEvent(new Event('fullscreenchange'))
        await press('e')
        await press('Escape')
        expect(exit).toHaveBeenCalledOnce()
        expect(editing()).toBe(true) // full screen first
      } finally {
        Object.defineProperty(document, 'fullscreenEnabled', {
          configurable: true,
          value: undefined,
        })
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
      }
    })

    it('leaves a key alone in a field, with a modifier, repeating, or while a dialog is open', async () => {
      mountApp()
      const field = document.createElement('input')
      document.body.append(field)
      await press('e', {}, field)
      await press('e', { metaKey: true })
      await press('e', { ctrlKey: true })
      await press('e', { altKey: true })
      await press('e', { repeat: true })
      await press('e', { isComposing: true })
      const edit = document.createElement('div')
      edit.contentEditable = 'true'
      Object.defineProperty(edit, 'isContentEditable', { value: true })
      document.body.append(edit)
      await press('e', {}, edit)
      const taken = new KeyboardEvent('keydown', { key: 'e', cancelable: true })
      taken.preventDefault()
      window.dispatchEvent(taken)
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      document.body.append(dialog)
      await press('e')
      dialog.remove()
      await press('x') // no key of the week's
      expect(editing()).toBe(false)
      field.remove()
      edit.remove()
    })
  })

  it('has no strip along the top edge, and floats the bar only for focus (K79, K80)', () => {
    mountApp()
    expect(wrapper.find('div[aria-hidden="true"].fixed').exists()).toBe(false)
    expect(bar().classes()).toContain('-translate-y-[110%]')
    expect(bar().classes()).toContain('focus-within:translate-y-0')
  })

  it('turns Edit plan on with a long press, by mouse or finger, and off with another (K80)', async () => {
    mountApp()
    await hold(document.body, HOLD_MS - 1)
    expect(editing()).toBe(false)
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(editing()).toBe(true)
    expect(screens()).toBe(false)
    await release(document.body as unknown as Element)
    // A press is just a press in Edit plan; a finger held as long turns it off.
    pointer(document.body, 'pointerdown', finger)
    pointer(document.body, 'pointerup', finger)
    vi.advanceTimersByTime(HOLD_MS)
    await flushPromises()
    expect(editing()).toBe(true)
    await longPress(finger)
    expect(editing()).toBe(false)
    expect(screens()).toBe(true)
  })

  it('does not count a press let go, moved, cancelled or made with another button', async () => {
    mountApp()
    // Let go early.
    pointer(document.body, 'pointerdown')
    vi.advanceTimersByTime(HOLD_MS - 100)
    pointer(document.body, 'pointerup')
    vi.advanceTimersByTime(HOLD_MS)
    await flushPromises()
    expect(editing()).toBe(false)
    // Moved a little still counts; moved further does not (a scroll or a swipe).
    pointer(document.body, 'pointerdown', { x: 200, y: 300 })
    pointer(document.body, 'pointermove', { x: 206, y: 306 })
    pointer(document.body, 'pointermove', { x: 200, y: 312 })
    vi.advanceTimersByTime(HOLD_MS)
    await flushPromises()
    expect(editing()).toBe(false)
    // Cancelled by the browser, as a touch scroll does.
    pointer(document.body, 'pointerdown', finger)
    pointer(document.body, 'pointercancel', finger)
    vi.advanceTimersByTime(HOLD_MS)
    await flushPromises()
    expect(editing()).toBe(false)
    // A right click held.
    await hold(document.body, HOLD_MS, { button: 2 })
    expect(editing()).toBe(false)
    // Within the slop, it counts.
    pointer(document.body, 'pointerup')
    pointer(document.body, 'pointerdown', { x: 200, y: 300 })
    pointer(document.body, 'pointermove', { x: 206, y: 306 })
    vi.advanceTimersByTime(HOLD_MS)
    await flushPromises()
    expect(editing()).toBe(true)
  })

  it('never marks the day cell that was held, and the next tap marks it', async () => {
    mountApp()
    expect(dayCell().attributes('aria-pressed')).toBe('false')
    await hold(dayCell().element, HOLD_MS)
    expect(editing()).toBe(true)
    await release(dayCell().element)
    // Back to the week, by the Edit plan button, to tap the cell.
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(dayCell().attributes('aria-pressed')).toBe('false')
    pointer(dayCell().element, 'pointerdown')
    await release(dayCell().element)
    expect(dayCell().attributes('aria-pressed')).toBe('true')
  })

  it('never presses the button held in Edit plan to leave it', async () => {
    mountApp()
    await longPress()
    // Hold an item's edit button: Edit plan goes off, and its dialog never opens.
    const editPushUps = wrapper.get('button[aria-label="Edit Push-ups"]').element
    await hold(editPushUps, HOLD_MS)
    expect(editing()).toBe(false)
    // Leaving Edit plan takes the button away, so the release lands on what is under the
    // pointer now: the week. That click is swallowed too.
    expect(editPushUps.isConnected).toBe(false)
    const under = dayCell().element
    await release(under)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(under.getAttribute('aria-pressed')).toBe('false')
  })

  it('swallows only the click that ends the long press, not a later one', async () => {
    mountApp()
    // A finger's long press may end with no click at all.
    await hold(dayCell().element, HOLD_MS, finger)
    pointer(dayCell().element, 'pointerup', finger)
    vi.advanceTimersByTime(1000)
    await flushPromises()
    // A click with no press first, as Enter on a focused button sends, still goes through.
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(editing()).toBe(false)
    await dayCell().trigger('click')
    expect(dayCell().attributes('aria-pressed')).toBe('true')
  })

  it('keeps the context menu from a finger’s long press, not from a mouse', async () => {
    mountApp()
    pointer(document.body, 'pointerdown', finger)
    const touchMenu = pointer(document.body, 'contextmenu', finger)
    expect(touchMenu.defaultPrevented).toBe(true)
    pointer(document.body, 'pointerup', finger)
    pointer(document.body, 'pointerdown', { button: 2 })
    const mouseMenu = pointer(document.body, 'contextmenu', { button: 2 })
    expect(mouseMenu.defaultPrevented).toBe(false)
    pointer(document.body, 'pointerup', { button: 2 })
    // Android sends the menu as the hold is reached, or after it: still kept back.
    await hold(document.body, HOLD_MS, finger)
    expect(editing()).toBe(true)
    expect(pointer(document.body, 'contextmenu', finger).defaultPrevented).toBe(true)
    pointer(document.body, 'pointerup', finger)
    // A pen's hold is a right click on Windows: its menu is kept back too.
    pointer(document.body, 'pointerdown', { pointerType: 'pen' })
    expect(pointer(document.body, 'contextmenu', { pointerType: 'pen' }).defaultPrevented).toBe(
      true,
    )
  })

  it('swallows no click once the window has lost the press, or a key was pressed', async () => {
    mountApp()
    // The window loses focus mid-hold, after the hold came: no pointerup arrives.
    await hold(dayCell().element, HOLD_MS)
    window.dispatchEvent(new Event('blur'))
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(editing()).toBe(false)
    // A key pressed after a long press: its click goes through.
    await hold(document.body, HOLD_MS)
    expect(editing()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    expect(editing()).toBe(false)
  })

  it('follows the finger that started the hold, and never a second one', async () => {
    mountApp()
    const one = { pointerType: 'touch', pointerId: 1, isPrimary: true }
    const two = { pointerType: 'touch', pointerId: 2, isPrimary: false }
    // A second finger is never a hold of its own.
    await hold(document.body, HOLD_MS, two)
    expect(editing()).toBe(false)
    pointer(document.body, 'pointerup', two)
    // The first finger's hold ignores the second one moving and lifting.
    pointer(document.body, 'pointerdown', one)
    pointer(document.body, 'pointermove', { ...two, x: 400, y: 600 })
    pointer(document.body, 'pointerup', two)
    vi.advanceTimersByTime(HOLD_MS)
    await flushPromises()
    expect(editing()).toBe(true)
  })

  it('drops a hold when the page is hidden, and keeps it while the page shows', async () => {
    mountApp()
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    pointer(document.body, 'pointerdown')
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(HOLD_MS)
    await flushPromises()
    expect(editing()).toBe(false)
  })

  it('takes no press in a field, a popover, a dialog or the bar for a hold', async () => {
    mountApp()
    const field = document.createElement('input')
    const pop = document.createElement('div')
    pop.dataset.slot = 'popover-content'
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(field, pop, dialog)
    for (const el of [field, pop, dialog, bar().element]) {
      await hold(el, HOLD_MS)
      expect(editing()).toBe(false)
      pointer(el, 'pointerup')
    }
    // In Edit plan too: holding a field to select its text keeps Edit plan on.
    await longPress()
    await hold(field, HOLD_MS)
    expect(editing()).toBe(true)
    pointer(field, 'pointerup')
    field.remove()
    pop.remove()
    dialog.remove()
  })

  it('opens Edit plan with the handle, pressed or pulled down (K80)', async () => {
    mountApp()
    expect(handle().attributes('tabindex')).toBe('-1')
    expect(handle().attributes('aria-label')).toBe('Edit plan')
    await handle().trigger('click')
    expect(editing()).toBe(true)
    // Edit plan has no handle: the bar is in view.
    expect(wrapper.find('[data-slot="bar-handle"]').exists()).toBe(false)
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    await press(handle().element, 'pointerdown', 0)
    await press(handle().element, 'pointermove', 6)
    expect(editing()).toBe(false)
    await press(handle().element, 'pointermove', 20)
    expect(editing()).toBe(true)
  })

  it('takes focus out of the floating bar on Escape, and leaves Escape alone in Edit plan', async () => {
    mountApp()
    const settings = wrapper.get('[data-testid="settings-button"]').element as HTMLElement
    settings.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(document.activeElement).not.toBe(settings)
    // Escape with focus outside the bar leaves that focus alone; another key does nothing.
    ;(dayCell().element as HTMLElement).focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(document.activeElement).toBe(dayCell().element)
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    const edit = wrapper.get('[data-testid="edit-plan-button"]').element as HTMLElement
    edit.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(editing()).toBe(true)
  })

  it('sprints between the screens from the arrows, named for where they go (K42)', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn<(q: string) => MediaQueryList>(
        (q) =>
          ({
            matches: q.includes('reduce'),
            addEventListener() {},
            removeEventListener() {},
          }) as unknown as MediaQueryList,
      ),
    )
    mountApp()
    const scrollTo = vi.fn<(options: ScrollToOptions) => void>()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    // Three screens a screen apart (K90): Exercises, Cardio, Food.
    const tops: Record<string, number> = { exercises: 0, cardio: 800, diet: 1600 }
    for (const [id, top] of Object.entries(tops)) {
      const screen = document.querySelector<HTMLElement>(`[aria-labelledby="${id}-heading"]`)!
      screen.getBoundingClientRect = () => ({ top: top - window.scrollY }) as DOMRect
    }
    const arrows: [testid: string, label: string, to: number][] = [
      ['to-cardio', 'Go to Cardio', 800],
      ['to-food', 'Go to Food', 1600],
      ['back-to-cardio', 'Back to Cardio', 800],
      ['to-exercises', 'Back to Exercises', 0],
    ]
    for (const [testid, label, to] of arrows) {
      const arrow = wrapper.get(`[data-testid="${testid}"]`)
      expect(arrow.attributes('aria-label')).toBe(label)
      expect(arrow.text()).toBe('')
      await arrow.trigger('click')
      expect(scrollTo).toHaveBeenLastCalledWith({ top: to, behavior: 'auto' })
      Object.defineProperty(window, 'scrollY', { configurable: true, value: to })
    }
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    vi.unstubAllGlobals()
  })
})
