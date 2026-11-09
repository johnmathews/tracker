import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  bandHeight,
  sprintToScreen,
  QUIET_MS,
  REST_MS,
  SPRINT_MS,
  sprintTarget,
  sprinting,
  sprintTo,
  useScreenSprint,
} from '@/composables/screenSprint'

describe('sprintTarget (K38)', () => {
  // Two screens: Exercises 0–1300 (taller than the 800px window), Food from 1300.
  const starts = [0, 1300]

  it('leaves a scroll alone inside one screen, a tall one included', () => {
    expect(sprintTarget(0, 800, starts, 1)).toBeNull()
    expect(sprintTarget(300, 800, starts, 1)).toBeNull()
    expect(sprintTarget(500, 800, starts, -1)).toBeNull()
    expect(sprintTarget(1300, 800, starts, -1)).toBeNull()
  })

  it('sprints on in the direction of travel when both screens show', () => {
    expect(sprintTarget(520, 800, starts, 1)).toBe(1300)
    expect(sprintTarget(1200, 800, starts, -1)).toBe(500)
  })

  it('settles on the screen that fills more of the window when nobody scrolled (K40)', () => {
    // Food shows from 1300 to 1400 of 600–1400: Exercises fills more, so back to its end.
    expect(sprintTarget(600, 800, starts, 0)).toBe(500)
    // Food shows from 1300 to 1500 of 700–1500: it is half-way, so Food (ties go down).
    expect(sprintTarget(1100, 800, starts, 0)).toBe(1300)
    expect(sprintTarget(300, 800, starts, 0)).toBeNull()
  })

  it('counts a line within a pixel of the edge as no line', () => {
    expect(sprintTarget(500.5, 800, starts, 1)).toBeNull()
    expect(sprintTarget(1299.5, 800, starts, 1)).toBeNull()
  })

  it('counts a line only once it is a step inside the window, when given one (K45)', () => {
    expect(sprintTarget(520, 800, starts, 1, 32)).toBeNull()
    expect(sprintTarget(540, 800, starts, 1, 32)).toBe(1300)
    expect(sprintTarget(1280, 800, starts, -1, 32)).toBeNull()
    expect(sprintTarget(1260, 800, starts, -1, 32)).toBe(500)
  })
})

describe('useScreenSprint', () => {
  let scrollTo: ReturnType<typeof vi.fn<(options: ScrollToOptions) => void>>

  /** Puts the window at `y`, as a scroll would. */
  function scrollToY(y: number): void {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
    window.dispatchEvent(new Event('scroll'))
  }

  /** Where the page is after every frame of a sprint has run. */
  function landed(): number | undefined {
    vi.advanceTimersByTime(SPRINT_MS + 50)
    return scrollTo.mock.lastCall?.[0].top
  }

  function screens(): void {
    document.body.innerHTML =
      '<section data-planner-screen></section><section data-planner-screen></section>'
    const [ex, food] = document.querySelectorAll<HTMLElement>('[data-planner-screen]')
    // Rectangles relative to the window, as the browser gives them.
    ex!.getBoundingClientRect = () => ({ top: -window.scrollY }) as DOMRect
    food!.getBoundingClientRect = () => ({ top: 1300 - window.scrollY }) as DOMRect
  }

  const mounted: { unmount(): void }[] = []
  function holder(enabled = ref(true)) {
    const wrapper = mount(
      defineComponent({
        setup() {
          useScreenSprint(enabled)
          return () => h('div')
        },
      }),
    )
    mounted.push(wrapper)
    return wrapper
  }

  function wheel(deltaY = 10): WheelEvent {
    const event = new WheelEvent('wheel', { deltaY, cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    // The page follows each frame of a sprint, as the browser would.
    scrollTo = vi.fn<(options: ScrollToOptions) => void>((o) => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: o.top })
    })
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    screens()
  })

  afterEach(() => {
    // A test that failed before unmounting leaves its listeners; take them down here.
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('sprints to Food as soon as a wheel brings it a step into the window (K45)', () => {
    const wrapper = holder()
    wheel()
    scrollToY(300)
    scrollToY(520) // Food's top is 20px in: less than a step (32px of 800)
    expect(scrollTo).not.toHaveBeenCalled()
    scrollToY(540)
    expect(landed()).toBe(1300)
    wrapper.unmount()
  })

  it('leaves a scrollbar drag or the keyboard to sprint at rest, not mid-scroll', () => {
    const wrapper = holder()
    scrollToY(600) // no wheel came: a scrollbar drag or a key
    expect(scrollTo).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REST_MS)
    expect(landed()).toBe(1300)
    wrapper.unmount()
  })

  it("sprints at once in a fling's momentum after the finger lifts", () => {
    const wrapper = holder()
    window.dispatchEvent(new Event('touchstart'))
    window.dispatchEvent(new Event('touchend'))
    scrollToY(600)
    // Under way before the rest timer could have fired: the fling started it.
    vi.advanceTimersByTime(REST_MS - 20)
    expect(scrollTo).toHaveBeenCalled()
    expect(landed()).toBe(1300)
    wrapper.unmount()
  })

  it('sprints after a pause when the scroll stops short of a step', () => {
    const wrapper = holder()
    scrollToY(520)
    vi.advanceTimersByTime(REST_MS - 1)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(landed()).toBe(1300)
    wrapper.unmount()
  })

  it('waits for a finger to lift, then sprints', () => {
    const wrapper = holder()
    window.dispatchEvent(new Event('touchstart'))
    scrollToY(700)
    vi.advanceTimersByTime(REST_MS + SPRINT_MS)
    expect(scrollTo).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('touchend'))
    expect(landed()).toBe(1300)
    wrapper.unmount()
  })

  it('swallows the wheel during a sprint and until it is quiet after', () => {
    const wrapper = holder()
    expect(wheel().defaultPrevented).toBe(false)
    scrollToY(600)
    expect(wheel().defaultPrevented).toBe(true)
    landed()
    expect(wheel().defaultPrevented).toBe(true) // the fling's momentum, still arriving
    vi.advanceTimersByTime(QUIET_MS)
    expect(wheel().defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('lets a wheel the other way through at once, during a sprint or after it (K89)', () => {
    const wrapper = holder()
    wheel()
    scrollToY(600) // down to Food
    expect(sprinting()).toBe(true)
    expect(wheel(-10).defaultPrevented).toBe(false) // turned round mid-sprint
    expect(sprinting()).toBe(false) // stopped where it was
    const held = scrollTo.mock.calls.length
    vi.advanceTimersByTime(SPRINT_MS)
    expect(scrollTo.mock.calls.length).toBe(held)
    // Down again: it sprints on to Food, and its momentum is swallowed.
    wheel()
    scrollToY(window.scrollY + 40)
    expect(landed()).toBe(1300)
    expect(wheel().defaultPrevented).toBe(true)
    // The other way, while the wheel is still busy: not held back.
    expect(wheel(-10).defaultPrevented).toBe(false)
    expect(wheel(-10).defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('holds back a wheel with no way to it, as it does the sprint’s own way', () => {
    const wrapper = holder()
    sprintTo(window.scrollY) // a sprint that goes nowhere: no way to turn back from
    expect(wheel(0).defaultPrevented).toBe(true)
    expect(wheel(-10).defaultPrevented).toBe(false)
    sprintTo(window.scrollY)
    expect(wheel(10).defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('holds a finger still while a sprint runs', () => {
    const wrapper = holder()
    const move = () => {
      const event = new Event('touchmove', { cancelable: true })
      window.dispatchEvent(event)
      return event
    }
    expect(move().defaultPrevented).toBe(false)
    wheel()
    scrollToY(600)
    expect(move().defaultPrevented).toBe(true)
    landed()
    expect(move().defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('sprints back up to the end of Exercises, at once when motion is reduced', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn<(q: string) => MediaQueryList>(
        (q) => ({ matches: q.includes('reduce') }) as unknown as MediaQueryList,
      ),
    )
    const wrapper = holder()
    scrollToY(1300)
    wheel()
    scrollToY(1100)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'auto' })
    wrapper.unmount()
  })

  it('settles a resize or rotation on the screen that fills more of the window', () => {
    const wrapper = holder()
    // A scroll down sets a direction; the resize after it clears it.
    scrollToY(100)
    vi.advanceTimersByTime(REST_MS)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 600 })
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(REST_MS)
    expect(landed()).toBe(500)
    wrapper.unmount()
  })

  it('moves to a place in one eased sprint, then calls back', () => {
    const done = vi.fn<() => void>()
    sprintTo(1300, done)
    vi.advanceTimersByTime(SPRINT_MS / 2)
    const halfway = window.scrollY
    expect(halfway).toBeGreaterThan(1300 * 0.75) // eased out: most of the way by half time
    expect(done).not.toHaveBeenCalled()
    expect(landed()).toBe(1300)
    expect(done).toHaveBeenCalledOnce()
  })

  it('does nothing while switched off, and stops a pending sprint when it is', async () => {
    const enabled = ref(true)
    const wrapper = holder(enabled)
    scrollToY(520)
    enabled.value = false
    await nextTick()
    vi.advanceTimersByTime(REST_MS)
    scrollToY(700)
    vi.advanceTimersByTime(REST_MS)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(wheel().defaultPrevented).toBe(false)
    enabled.value = true
    await nextTick()
    wrapper.unmount()
    scrollToY(650)
    vi.advanceTimersByTime(REST_MS)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  /** The fixed week (K88): `sticky` as on the planner's screens, 80px tall. */
  function band(position = 'sticky'): void {
    const el = document.createElement('div')
    el.dataset.slot = 'week-band'
    el.style.position = position
    el.getBoundingClientRect = () => ({ height: 80 }) as DOMRect
    document.body.prepend(el)
  }

  it('measures the fixed week only where it is fixed (K88)', () => {
    expect(bandHeight()).toBe(0)
    band('static')
    expect(bandHeight()).toBe(0)
    document.body.innerHTML = ''
    band()
    expect(bandHeight()).toBe(80)
  })

  it('rests each screen just under the fixed week (K88)', () => {
    band()
    const wrapper = holder()
    wheel()
    scrollToY(300)
    scrollToY(540) // Food's top is 640px down the window: past the band, a step in
    expect(landed()).toBe(1220)
    vi.advanceTimersByTime(QUIET_MS + 1)
    wheel()
    scrollToY(1180) // back up: Exercises' end comes a step into the screens' part
    expect(landed()).toBe(500) // its end meets the bottom of the window
    wrapper.unmount()
  })

  it('sprints an arrow’s screen to just under the fixed week (K42, K88)', () => {
    band()
    document
      .querySelectorAll('[data-planner-screen]')[1]!
      .setAttribute('aria-labelledby', 'diet-heading')
    sprintToScreen('diet-heading')
    expect(landed()).toBe(1220)
  })
})
