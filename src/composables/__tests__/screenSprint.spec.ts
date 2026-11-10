import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  CLICK_GAP_MS,
  MomentumWatch,
  bandHeight,
  pageEnd,
  stopSprint,
  wrapAround,
  sprintToScreen,
  REST_MS,
  SPRINT_MS,
  WHEEL_MS,
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

describe('MomentumWatch (K95)', () => {
  /** Feeds steps 16ms apart; the index of the first that starts a push, or -1. */
  function feed(watch: MomentumWatch, steps: number[], gap = 16): number {
    return steps.findIndex((size) => watch.next(size, gap))
  }

  it('never takes momentum, rising or falling, for a push', () => {
    const watch = new MomentumWatch()
    const ramp = [4, 8, 16, 24, 32, 40]
    const fade = Array.from({ length: 60 }, (_, i) => Math.max(1, Math.round(40 * 0.97 ** i)))
    expect(feed(watch, [...ramp, ...fade])).toBe(-1)
  })

  it('takes a drop and then two steps up for a new swipe, but not one merged step', () => {
    const watch = new MomentumWatch()
    feed(watch, [40, 36, 30, 24, 20])
    expect(feed(watch, [4, 30, 5, 6])).toBe(-1) // a lone big step: the browser merged two
    expect(feed(watch, [12, 16])).toBe(1)
  })

  it('goes by speed, so momentum sent late and merged is still momentum (K96)', () => {
    const watch = new MomentumWatch()
    const steps: [number, number][] = [
      [30, 16],
      [26, 16],
      [22, 16],
      [18, 16],
      [60, 64], // four frames' worth at once, slower than the frame before
      [14, 16],
      [44, 64],
      [10, 16],
      [32, 64],
    ]
    expect(steps.some(([size, gap]) => watch.next(size, gap))).toBe(false)
  })

  it('takes a click after a silence for a push, but not momentum’s last small steps', () => {
    const watch = new MomentumWatch()
    feed(watch, [40, 30, 20, 2, 1])
    expect(watch.next(2, CLICK_GAP_MS)).toBe(false) // 2px after 1px: a tail, not a click
    expect(watch.next(4, CLICK_GAP_MS)).toBe(true) // 4px, twice the last
    expect(watch.next(100, CLICK_GAP_MS)).toBe(true) // a mouse wheel's notch
    expect(watch.next(100, CLICK_GAP_MS - 1)).toBe(false) // too soon after the last
  })

  it('starts afresh for each sprint', () => {
    const watch = new MomentumWatch()
    feed(watch, [40, 20, 4])
    watch.reset()
    expect(feed(watch, [8, 14, 20])).toBe(-1) // a new ramp, not a rise after a drop
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

  /**
   * A fling's momentum: a wheel step every 16ms for `ms`, from `from` and dying away, as a
   * trackpad sends it after the finger lifts (K93).
   */
  function coast(ms: number, from = 10, way = 1): void {
    let d = from
    for (let t = 0; t < ms; t += 16) {
      vi.advanceTimersByTime(16)
      wheel(way * Math.max(1, Math.round(d)))
      d *= 0.9
    }
  }

  /** Where the last sprint put the page. */
  function at_(): number | undefined {
    return scrollTo.mock.lastCall?.[0].top
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

  describe('one swipe, one screen on a phone (K98)', () => {
    /** Three screens 1300px tall, as on a phone: Exercises, Cardio, Food. */
    function three(): void {
      document.body.innerHTML = '<section data-planner-screen></section>'.repeat(3)
      const all = document.querySelectorAll<HTMLElement>('[data-planner-screen]')
      all.forEach((el, i) => {
        el.getBoundingClientRect = () => ({ top: i * 1300 - window.scrollY }) as DOMRect
      })
    }
    /** A small swipe down: the finger lifts, and the browser's momentum carries the page on. */
    function flick(): void {
      window.dispatchEvent(new Event('touchstart'))
      scrollToY(window.scrollY + 40)
      window.dispatchEvent(new Event('touchend'))
    }
    /** iOS momentum that a sprint doesn't stop: the page goes on down for `ms`, 30px a frame. */
    function iosMomentum(ms: number): void {
      for (let t = 0; t < ms; t += 16) {
        vi.advanceTimersByTime(16)
        scrollToY(window.scrollY + 30)
      }
    }

    it('moves one screen however long the momentum runs after the sprint', () => {
      three()
      const wrapper = holder()
      flick()
      scrollToY(600) // the momentum brings Cardio a step in
      expect(landed()).toBe(1300)
      iosMomentum(900) // on past Cardio's end and Food's top, inside FLING_MS
      vi.advanceTimersByTime(REST_MS + SPRINT_MS + 50)
      expect(window.scrollY).toBe(1300)
      // A new swipe moves the next screen.
      flick()
      scrollToY(1300 + 600)
      expect(landed()).toBe(2600)
      wrapper.unmount()
    })

    it("stops the browser's momentum while a fling's sprint runs, and lets go on landing", () => {
      three()
      const wrapper = holder()
      flick()
      scrollToY(600)
      expect(document.documentElement.style.overflow).toBe('hidden')
      landed()
      expect(document.documentElement.style.overflow).toBe('')
      wrapper.unmount()
    })

    it("doesn't hold the page still for a wheel's sprint", () => {
      three()
      const wrapper = holder()
      wheel()
      scrollToY(600)
      expect(document.documentElement.style.overflow).toBe('')
      landed()
      wrapper.unmount()
    })
  })

  it('swallows the wheel during a sprint and until it is quiet after', () => {
    const wrapper = holder()
    expect(wheel().defaultPrevented).toBe(false)
    scrollToY(600)
    expect(wheel().defaultPrevented).toBe(true)
    coast(SPRINT_MS + 50)
    expect(at_()).toBe(1300)
    expect(wheel(1).defaultPrevented).toBe(true) // the fling's momentum, still arriving
    vi.advanceTimersByTime(WHEEL_MS)
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
    coast(SPRINT_MS + 50)
    expect(at_()).toBe(1300)
    expect(wheel(1).defaultPrevented).toBe(true)
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

  it('keeps only the wheel’s last 70 steps, and sprints nowhere for a screen it can’t find', () => {
    const wrapper = holder()
    vi.advanceTimersByTime(WHEEL_MS)
    for (let i = 0; i < 80; i++) wheel(1) // far from an end: an ordinary scroll each time
    expect(scrollTo).not.toHaveBeenCalled()
    sprintToScreen('no-such-heading')
    expect(sprinting()).toBe(false)
    wrapper.unmount()
  })

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
    vi.advanceTimersByTime(WHEEL_MS + 1)
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

  describe('wrapping round (K92)', () => {
    /**
     * The page as the browser lays it out: Exercises 1300px tall from 0, Food 800px from 1300, so
     * its foot is at 1300 in an 800px window. A wrap's copy goes after Food (down) or before
     * Exercises (up), and the rectangles follow it.
     */
    function layout(): void {
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        configurable: true,
        get: () => 2100 + (document.querySelector('[data-wrap-copy]') ? copyHeight() : 0),
      })
      const [ex, food] = document.querySelectorAll<HTMLElement>('[data-planner-screen]')
      const shift = () => (copyFirst() ? copyHeight() : 0)
      ex!.getBoundingClientRect = () => rect(shift(), 1300)
      food!.getBoundingClientRect = () => rect(1300 + shift(), 800)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        return rect(copyFirst() ? 0 : 2100, copyHeight())
      })
    }
    function copy(): HTMLElement | null {
      return document.querySelector<HTMLElement>('[data-wrap-copy]')
    }
    function copyFirst(): boolean {
      return copy()?.nextElementSibling?.hasAttribute('data-planner-screen') ?? false
    }
    function copyHeight(): number {
      return copyFirst() ? 800 : 1300
    }
    function rect(top: number, height: number): DOMRect {
      return { top: top - window.scrollY, bottom: top + height - window.scrollY, height } as DOMRect
    }
    function at(y: number): void {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
    }
    function touch(type: string, y: number): void {
      const event = new Event(type) as Event & Record<string, unknown>
      const list = [{ clientY: y }]
      Object.assign(event, type === 'touchstart' ? { touches: list } : { changedTouches: list })
      window.dispatchEvent(event)
    }

    beforeEach(() => {
      document.querySelectorAll('[data-planner-screen]')[0]!.setAttribute('id', 'ex')
      layout()
    })
    afterEach(() => {
      vi.restoreAllMocks()
      Reflect.deleteProperty(document.documentElement, 'scrollHeight')
    })

    it('knows the page’s ends', () => {
      at(0)
      expect(pageEnd()).toBe(-1)
      at(600)
      expect(pageEnd()).toBe(0)
      at(1300)
      expect(pageEnd()).toBe(1)
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        configurable: true,
        value: 800,
      })
      expect(pageEnd()).toBe(0) // a page that doesn't scroll has no ends
    })

    it('brings the first screen up from below a copy, then rests on the real one', () => {
      at(1300)
      const done = vi.fn<() => void>()
      expect(wrapAround(1, done)).toBe(true)
      const c = copy()!
      expect(c.previousElementSibling?.hasAttribute('data-planner-screen')).toBe(true)
      expect(c.hasAttribute('data-planner-screen')).toBe(false)
      expect(c.getAttribute('aria-hidden')).toBe('true')
      expect(c.inert).toBe(true)
      expect(c.querySelector('[id]') ?? c.id).toBeFalsy()
      vi.advanceTimersByTime(SPRINT_MS / 2)
      expect(window.scrollY).toBeGreaterThan(1300) // moving onto the copy
      expect(landed()).toBe(0)
      expect(copy()).toBeNull()
      expect(done).toHaveBeenCalledOnce()
    })

    it('brings the last screen down from above, without the page jumping first', () => {
      at(0)
      wrapAround(-1)
      expect(copyFirst()).toBe(true)
      expect(scrollTo.mock.calls[0]?.[0].top).toBe(800) // follows the copy: nothing moves
      expect(landed()).toBe(1300)
      expect(copy()).toBeNull()
    })

    it('needs two screens, and leaves no copy when stopped', () => {
      document.querySelectorAll('[data-planner-screen]')[1]!.remove()
      expect(wrapAround(1)).toBe(false)
      screens()
      layout()
      at(1300)
      wrapAround(1)
      stopSprint()
      expect(copy()).toBeNull()
    })

    it('wraps once a new wheel gesture at the foot has gone a step on, and can’t be turned round', () => {
      const wrapper = holder()
      at(1300)
      const first = wheel(10)
      expect(first.defaultPrevented).toBe(true)
      expect(copy()).toBeNull() // 10px: not yet a step
      wheel(30)
      expect(copy()).not.toBeNull()
      expect(wheel(-10).defaultPrevented).toBe(true) // a wrap runs to its end
      expect(landed()).toBe(0)
      wrapper.unmount()
    })

    it('wraps straight back when the wheel turns round as a wrap lands (K89)', () => {
      const wrapper = holder()
      at(1300)
      wheel(40)
      coast(SPRINT_MS + 50, 30)
      expect(at_()).toBe(0)
      expect(wheel(1).defaultPrevented).toBe(true) // the wrap's own momentum, still swallowed
      expect(wheel(-40).defaultPrevented).toBe(true) // turned round at the top: wraps back up
      expect(landed()).toBe(1300)
      wrapper.unmount()
    })

    it('moves one screen a gesture: the rest of it is swallowed, however it runs (K94)', () => {
      const wrapper = holder()
      at(1300)
      wheel(40)
      coast(SPRINT_MS + 50, 30)
      expect(at_()).toBe(0) // wrapped to the top
      // The same gesture's momentum going on, however long: swallowed, no second screen.
      for (const d of [2, 2, 1, 1, 1, 1]) expect(wheel(d).defaultPrevented).toBe(true)
      expect(copy()).toBeNull()
      expect(sprinting()).toBe(false)
      wrapper.unmount()
    })

    it('takes a new gesture after the wheel was still as the next push (K94)', () => {
      const wrapper = holder()
      at(1300)
      wheel(100)
      expect(landed()).toBe(0) // the wheel was still while it ran
      // A new notch: let through, and the page is not at the end it goes past, so it scrolls.
      expect(wheel(100).defaultPrevented).toBe(false)
      expect(copy()).toBeNull()
      wrapper.unmount()
    })

    it('lets a push made mid-sprint go, and moves on only after (K96)', () => {
      const wrapper = holder()
      at(0)
      wheel()
      scrollToY(600) // down to Food
      expect(sprinting()).toBe(true)
      vi.advanceTimersByTime(CLICK_GAP_MS)
      expect(wheel(40).defaultPrevented).toBe(true) // a click mid-sprint: swallowed
      expect(landed()).toBe(1300) // Food, and no further
      expect(copy()).toBeNull()
      wrapper.unmount()
    })

    it('counts a push that began mid-sprint once it has landed, as it goes on (K96)', () => {
      const wrapper = holder()
      at(1300)
      wheel(40)
      coast(SPRINT_MS - 100, 40) // momentum while the wrap runs
      for (const d of [2, 8, 14]) wheel(d) // a new swipe starting before it lands
      vi.advanceTimersByTime(150)
      expect(sprinting()).toBe(false)
      expect(wheel(20).defaultPrevented).toBe(false) // still growing, now landed: a new push
      wrapper.unmount()
    })

    it('lets a new swipe through inside the last one’s momentum once the sprint has landed (K95)', () => {
      const wrapper = holder()
      at(1300)
      wheel(40)
      coast(SPRINT_MS + 50, 40)
      expect(at_()).toBe(0)
      // The momentum cut off by a new swipe: steps drop, then grow.
      for (const d of [2, 1]) expect(wheel(d).defaultPrevented).toBe(true)
      expect(wheel(8).defaultPrevented).toBe(true)
      expect(wheel(14).defaultPrevented).toBe(false) // the second step up: a new push
      wrapper.unmount()
    })

    it('counts a wheel in lines, and wraps up from the top', () => {
      const wrapper = holder()
      at(0)
      const event = new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, cancelable: true })
      window.dispatchEvent(event)
      expect(landed()).toBe(1300)
      wrapper.unmount()
    })

    it('never wraps on momentum that reaches the foot mid-gesture, or a gesture the other way', () => {
      const wrapper = holder()
      at(1000)
      wheel(40) // the gesture starts above the foot
      at(1300)
      expect(wheel(40).defaultPrevented).toBe(false)
      vi.advanceTimersByTime(WHEEL_MS)
      expect(wheel(-40).defaultPrevented).toBe(false) // up from the foot: an ordinary scroll
      wheel(0)
      expect(copy()).toBeNull()
      wrapper.unmount()
    })

    it('wraps on a swipe past an end, and scrolls as usual otherwise', () => {
      const wrapper = holder()
      at(1300)
      touch('touchstart', 500)
      touch('touchend', 480) // under a step
      expect(copy()).toBeNull()
      touch('touchstart', 500)
      touch('touchend', 400)
      expect(landed()).toBe(0)
      vi.advanceTimersByTime(WHEEL_MS)
      at(0)
      touch('touchstart', 400)
      touch('touchend', 500)
      expect(landed()).toBe(1300)
      wrapper.unmount()
    })
  })
})
