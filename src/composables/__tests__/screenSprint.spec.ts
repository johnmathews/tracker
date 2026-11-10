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
  STOP_SHARE,
  stopOffsets,
  GLIDE_MS,
  SPEED_MS,
  TURN_SHARE,
  turnTarget,
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

describe('turnTarget (K103)', () => {
  const points = [0, 800, 1600, 2400]

  it('turns once a drag has gone a share of the window, the way it went', () => {
    const far = 800 * TURN_SHARE
    expect(turnTarget(800 + far, 800, points, 800)).toBe(1600)
    expect(turnTarget(800 - far, 800, points, 800)).toBe(0)
  })

  it('leaves a shorter drag to the browser', () => {
    expect(turnTarget(800 + 800 * TURN_SHARE - 1, 800, points, 800)).toBeNull()
    expect(turnTarget(800, 800, points, 800)).toBeNull()
  })

  it('goes to the next point past where the page is, not past where it started', () => {
    expect(turnTarget(1700, 800, points, 800)).toBe(2400)
    expect(turnTarget(1600, 800, points, 800)).toBe(1600) // already there
  })

  it('has nowhere to go past the last point', () => {
    expect(turnTarget(2600, 2400, points, 800)).toBeNull()
  })
})

describe('stopOffsets (K101)', () => {
  it('has none where the screen fits', () => {
    expect(stopOffsets(653, 653)).toEqual([])
    expect(stopOffsets(654, 653)).toEqual([]) // a pixel over is a rounding
  })

  it('rests last where the screen’s foot meets the window’s', () => {
    expect(stopOffsets(762, 653)).toEqual([109])
  })

  it('steps a share of the window at a time on a long screen', () => {
    const step = Math.round(600 * STOP_SHARE)
    expect(stopOffsets(2000, 600)).toEqual([step, 2 * step, 1400])
  })

  it('leaves out a step that would come only a few pixels before the foot', () => {
    // 600 over in a 600px window: a step at 480 would leave 120, under a quarter of a step.
    expect(stopOffsets(1200, 600)).toEqual([600])
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

  describe('on a touch screen the browser snaps (K98)', () => {
    function touchScreen(): void {
      vi.stubGlobal(
        'matchMedia',
        vi.fn<(q: string) => MediaQueryList>(
          (q) => ({ matches: q.includes('pointer: coarse') }) as unknown as MediaQueryList,
        ),
      )
    }

    it('leaves a swipe and its momentum to the browser', () => {
      touchScreen()
      const wrapper = holder()
      window.dispatchEvent(new Event('touchstart'))
      scrollToY(100)
      window.dispatchEvent(new Event('touchend'))
      scrollToY(600)
      vi.advanceTimersByTime(REST_MS + SPRINT_MS + 50)
      expect(scrollTo).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('leaves a wheel and a rotation to the browser too', () => {
      touchScreen()
      const wrapper = holder()
      expect(wheel().defaultPrevented).toBe(false)
      scrollToY(600)
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(REST_MS + SPRINT_MS + 50)
      expect(scrollTo).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })

  describe('on a touch screen the wrap round is a swipe onto a copy (K100)', () => {
    /**
     * Three screens, each 800px, laid out one under the other in the order they stand in the
     * page, the copies included, in an 800px window with no band.
     */
    function layout(): void {
      document.body.innerHTML =
        '<main><section data-planner-screen id="ex" aria-labelledby="ex-h"><h2 id="ex-h">Exercises</h2></section>' +
        '<section data-planner-screen><h2>Cardio</h2></section>' +
        '<section data-planner-screen><h2>Food</h2></section></main>'
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const all = [...document.querySelectorAll('[data-planner-screen], [data-snap-copy]')]
        const i = all.indexOf(this)
        if (i < 0) return { top: 0, bottom: 0, height: 0 } as DOMRect
        const top = i * 800 - window.scrollY
        return { top, bottom: top + 800, height: 800 } as DOMRect
      })
    }
    function touchScreen(): void {
      vi.stubGlobal(
        'matchMedia',
        vi.fn<(q: string) => MediaQueryList>(
          (q) => ({ matches: q.includes('pointer: coarse') }) as unknown as MediaQueryList,
        ),
      )
    }
    /** What stands in the page, in order: a screen by its title, a copy as "copy of <title>". */
    function order(): string[] {
      return [...document.querySelectorAll('[data-planner-screen], [data-snap-copy]')].map(
        (el) =>
          (el.hasAttribute('data-snap-copy') ? 'copy of ' : '') +
          el.querySelector('h2')!.textContent,
      )
    }
    function copies(): HTMLElement[] {
      return [...document.querySelectorAll<HTMLElement>('[data-snap-copy]')]
    }
    /** The MutationObserver's records arrive in a microtask; the copies follow at the next frame. */
    async function frame(): Promise<void> {
      await Promise.resolve()
      vi.advanceTimersByTime(20)
    }
    /** A swipe that comes to rest at `y`, its finger lifted. */
    function restAt(y: number): void {
      window.dispatchEvent(new Event('touchstart'))
      Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
      window.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('touchend'))
    }

    beforeEach(() => {
      touchScreen()
      layout()
    })
    afterEach(() => {
      vi.restoreAllMocks()
      Reflect.deleteProperty(window, 'onscrollend')
    })

    it('lays a copy of the last screen above the first and of the first below the last', async () => {
      holder()
      await frame()
      expect(order()).toEqual(['copy of Food', 'Exercises', 'Cardio', 'Food', 'copy of Exercises'])
      // The page stays on Exercises, now one screen further down.
      expect(at_()).toBe(800)
      for (const copy of copies()) {
        expect(copy.inert).toBe(true)
        expect(copy.getAttribute('aria-hidden')).toBe('true')
        expect(copy.hasAttribute('data-noprint')).toBe(true)
        expect(copy.hasAttribute('aria-labelledby')).toBe(false)
        expect(copy.querySelector('[id]')).toBeNull()
      }
      expect(document.documentElement.style.scrollSnapType).toBe('') // snapping back on
    })

    it('rests on the real screen after a swipe onto a copy, at either end', async () => {
      holder()
      await frame()
      restAt(0) // up past Exercises, onto the copy of Food
      vi.advanceTimersByTime(REST_MS)
      expect(at_()).toBe(3 * 800) // the same place on Food
      restAt(4 * 800) // down past Food, onto the copy of Exercises
      vi.advanceTimersByTime(REST_MS)
      expect(at_()).toBe(800)
      const calls = scrollTo.mock.calls.length
      restAt(2 * 800) // Cardio: nothing to do
      vi.advanceTimersByTime(REST_MS)
      expect(scrollTo.mock.calls.length).toBe(calls)
    })

    it('waits for scrollend where the browser has it, and never for a finger still down', async () => {
      Object.defineProperty(window, 'onscrollend', { configurable: true, value: null })
      holder()
      await frame()
      window.dispatchEvent(new Event('touchstart'))
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(REST_MS)
      window.dispatchEvent(new Event('scrollend')) // the finger still holds the page
      expect(at_()).toBe(800)
      window.dispatchEvent(new Event('touchend'))
      vi.advanceTimersByTime(REST_MS)
      expect(at_()).toBe(800) // no timer: the browser says when it rests
      window.dispatchEvent(new Event('scrollend'))
      expect(at_()).toBe(3 * 800)
    })

    it('never wraps by script on a touch screen', async () => {
      holder()
      await frame()
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        configurable: true,
        value: 4000,
      })
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 3200 })
      const start = new Event('touchstart') as Event & Record<string, unknown>
      start.touches = [{ clientY: 500 }]
      window.dispatchEvent(start)
      const end = new Event('touchend') as Event & Record<string, unknown>
      end.changedTouches = [{ clientY: 300 }]
      window.dispatchEvent(end)
      expect(document.querySelector('[data-wrap-copy]')).toBeNull()
      expect(sprinting()).toBe(false)
      Reflect.deleteProperty(document.documentElement, 'scrollHeight')
    })

    it('makes the copies afresh when a screen changes, once the page rests', async () => {
      holder()
      await frame()
      document.querySelector('[data-planner-screen] h2')!.textContent = 'Workouts'
      await frame()
      expect(order()).toEqual(['copy of Food', 'Workouts', 'Cardio', 'Food', 'copy of Workouts'])
      // While the page moves, the change waits for rest.
      window.dispatchEvent(new Event('scroll'))
      document.querySelector('[data-planner-screen] h2')!.textContent = 'Exercises'
      await frame()
      expect(order().at(-1)).toBe('copy of Workouts')
      vi.advanceTimersByTime(REST_MS)
      expect(order().at(-1)).toBe('copy of Exercises')
    })

    it('follows a screen added or taken away, and the screens’ class on <html>', async () => {
      holder()
      await frame()
      const main = document.querySelector('main')!
      const wrap = document.createElement('div')
      wrap.innerHTML = '<section data-planner-screen><h2>Notes</h2></section>'
      main.append(wrap)
      await frame()
      expect(order().slice(0, 1)).toEqual(['copy of Notes'])
      wrap.remove()
      await frame()
      expect(order()[0]).toBe('copy of Food')
      const before = copies()[0]
      document.documentElement.classList.add('edit-screens')
      await frame()
      expect(copies()[0]).not.toBe(before)
      document.documentElement.classList.remove('edit-screens')
    })

    it('makes afresh only the copy of a screen that changed', async () => {
      holder()
      await frame()
      const [above, below] = copies()
      document.querySelectorAll('[data-planner-screen] h2')[1]!.textContent = 'Running'
      await frame()
      expect(copies()).toEqual([above, below]) // Cardio: no copy shows it
      document.querySelectorAll('[data-planner-screen] h2')[2]!.textContent = 'Meals'
      await frame()
      expect(copies()[0]).not.toBe(above)
      expect(copies()[1]).toBe(below)
      expect(order()).toEqual([
        'copy of Meals',
        'Exercises',
        'Running',
        'Meals',
        'copy of Exercises',
      ])
    })

    it('leaves the copies alone for a change outside the screens or inside a copy', async () => {
      holder()
      await frame()
      const [above] = copies()
      document.body.append(document.createElement('div'))
      above!.setAttribute('data-x', '')
      above!.querySelector('h2')!.textContent = 'Food'
      await frame()
      expect(copies()[0]).toBe(above)
    })

    it('takes the copies away when the screens are off, and when it unmounts', async () => {
      const enabled = ref(true)
      const wrapper = holder(enabled)
      await frame()
      expect(copies()).toHaveLength(2)
      enabled.value = false
      await nextTick()
      await frame()
      expect(copies()).toHaveLength(0)
      window.dispatchEvent(new Event('scrollend')) // the screens are off: nothing to do
      enabled.value = true
      await nextTick()
      await frame()
      expect(copies()).toHaveLength(2)
      wrapper.unmount()
      expect(copies()).toHaveLength(0)
    })

    it('makes no copies under a mouse or trackpad, or with one screen', async () => {
      vi.unstubAllGlobals()
      holder()
      await frame()
      document.querySelector('[data-planner-screen] h2')!.textContent = 'Workouts'
      await frame()
      expect(copies()).toHaveLength(0)
      for (const wrapper of mounted.splice(0)) wrapper.unmount()
      touchScreen()
      document.querySelector('main')!.innerHTML =
        '<section data-planner-screen><h2>Food</h2></section>'
      holder()
      await frame()
      expect(copies()).toHaveLength(0)
    })

    it('keeps the copies made while a sprint runs for its landing', async () => {
      holder()
      await frame()
      sprintTo(1600)
      document.querySelector('[data-planner-screen] h2')!.textContent = 'Workouts'
      await frame()
      expect(order().at(-1)).toBe('copy of Exercises')
      window.dispatchEvent(new Event('scrollend'))
      expect(order().at(-1)).toBe('copy of Exercises') // still sprinting
      vi.advanceTimersByTime(SPRINT_MS + 50)
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(REST_MS)
      expect(order().at(-1)).toBe('copy of Workouts')
    })
  })

  describe('on a touch screen a slow drag turns after a fifth of the window (K103)', () => {
    /** Three screens 800px tall in an 800px window, with no band; the copies make five. */
    function layout(): void {
      document.body.innerHTML =
        '<main><section data-planner-screen><h2>Exercises</h2></section>' +
        '<section data-planner-screen><h2>Cardio</h2></section>' +
        '<section data-planner-screen><h2>Food</h2></section></main>'
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const all = [...document.querySelectorAll('[data-planner-screen], [data-snap-copy]')]
        const i = all.indexOf(this)
        if (i < 0) return { top: 0, bottom: 0, height: 0 } as DOMRect
        const top = i * 800 - window.scrollY
        return { top, bottom: top + 800, height: 800 } as DOMRect
      })
    }
    const snap = () => document.documentElement.style.scrollSnapType
    const touch = (type: string, y: number) =>
      window.dispatchEvent(
        Object.assign(new Event(type), {
          touches: [{ clientY: y }],
          changedTouches: [{ clientY: y }],
        }),
      )
    /**
     * A finger dragging the page by `by` pixels in `steps` moves `ms` apart, the page following it.
     * Down the page is a finger going up.
     */
    function drag(by: number, steps: number, ms: number): void {
      const from = window.scrollY
      for (let k = 1; k <= steps; k++) {
        vi.advanceTimersByTime(ms)
        Object.defineProperty(window, 'scrollY', {
          configurable: true,
          value: from + (by * k) / steps,
        })
        window.dispatchEvent(new Event('scroll'))
        touch('touchmove', 500 - (by * k) / steps)
      }
    }
    /** The page arrives where it was sent, and rests. */
    function arrive(): void {
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(REST_MS)
    }

    beforeEach(async () => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn<(q: string) => MediaQueryList>(
          (q) => ({ matches: q.includes('pointer: coarse') }) as unknown as MediaQueryList,
        ),
      )
      layout()
      holder()
      await Promise.resolve()
      vi.advanceTimersByTime(20)
      scrollTo.mockClear() // the page is on Exercises, under the copy of Food
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('turns to the next screen when a slow drag lets go past a fifth', () => {
      touch('touchstart', 500)
      drag(180, 9, 100) // 20px every 100ms
      expect(snap()).toBe('none') // the browser won't pull it back first
      touch('touchend', 320)
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1600, behavior: 'smooth' })
      expect(snap()).toBe('none')
      arrive()
      expect(snap()).toBe('') // snapping again once it has landed
    })

    it('turns back up to the screen before', () => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 1600 })
      touch('touchstart', 500)
      drag(-180, 9, 100)
      touch('touchend', 680)
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'smooth' })
    })

    it('leaves a shorter drag to the browser, which snaps it back', () => {
      touch('touchstart', 500)
      drag(140, 7, 100)
      expect(snap()).toBe('')
      touch('touchend', 360)
      vi.advanceTimersByTime(REST_MS)
      expect(scrollTo).not.toHaveBeenCalled()
    })

    it('leaves a fling to the browser', () => {
      touch('touchstart', 500)
      drag(300, 5, 16)
      expect(snap()).toBe('')
      touch('touchend', 200)
      expect(scrollTo).not.toHaveBeenCalled()
    })

    it('turns after a fast drag the finger then held still', () => {
      touch('touchstart', 500)
      drag(300, 5, 16)
      expect(snap()).toBe('')
      vi.advanceTimersByTime(SPEED_MS)
      expect(snap()).toBe('none')
      touch('touchend', 200)
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1600, behavior: 'smooth' })
    })

    it('gives the browser the snap back when a slow drag speeds up', () => {
      touch('touchstart', 500)
      drag(180, 9, 100)
      expect(snap()).toBe('none')
      drag(150, 3, 16)
      expect(snap()).toBe('')
    })

    it('stops a turn where it is when a finger comes down on the page', () => {
      scrollTo.mockImplementation(() => {}) // the glide is still on its way
      touch('touchstart', 500)
      drag(180, 9, 100)
      touch('touchend', 320)
      touch('touchstart', 320)
      expect(snap()).toBe('')
    })

    it('snaps again after a while, even if the turn never arrives', () => {
      scrollTo.mockImplementation(() => {})
      touch('touchstart', 500)
      drag(180, 9, 100)
      touch('touchend', 320)
      arrive()
      expect(snap()).toBe('none') // short of where it was going: still on its way
      vi.advanceTimersByTime(GLIDE_MS)
      expect(snap()).toBe('')
    })

    it('jumps rather than glides when motion is reduced', () => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn<(q: string) => MediaQueryList>(
          (q) => ({ matches: /coarse|reduce/.test(q) }) as unknown as MediaQueryList,
        ),
      )
      touch('touchstart', 500)
      drag(180, 9, 100)
      touch('touchend', 320)
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1600, behavior: 'auto' })
    })

    it('leaves a mouse or trackpad alone', () => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn<(q: string) => MediaQueryList>(() => ({ matches: false }) as MediaQueryList),
      )
      touch('touchstart', 500)
      drag(180, 9, 100)
      expect(snap()).toBe('')
    })
  })

  describe('a screen taller than the window has stops inside it on a touch screen (K101)', () => {
    /** Exercises 1300px tall in an 800px window, Food 800px under it, the copies 800px each. */
    function layout(): void {
      document.body.innerHTML =
        '<main><section data-planner-screen><h2>Exercises</h2></section>' +
        '<section data-planner-screen><h2>Food</h2></section></main>'
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        let top = -window.scrollY
        for (const el of document.querySelectorAll('[data-planner-screen], [data-snap-copy]')) {
          const height = el.querySelector('h2')!.textContent === 'Exercises' ? 1300 : 800
          if (el === this) return { top, bottom: top + height, height } as DOMRect
          top += height
        }
        return { top: 0, bottom: 0, height: 0 } as DOMRect
      })
    }
    function touchScreen(): void {
      vi.stubGlobal(
        'matchMedia',
        vi.fn<(q: string) => MediaQueryList>(
          (q) => ({ matches: q.includes('pointer: coarse') }) as unknown as MediaQueryList,
        ),
      )
    }
    function stops(selector = '[data-planner-screen]'): string[] {
      return [...document.querySelectorAll<HTMLElement>(`${selector} > [data-snap-stop]`)].map(
        (stop) => `${stop.dataset.snapStop}@${stop.style.top}`,
      )
    }
    async function frame(): Promise<void> {
      await Promise.resolve()
      vi.advanceTimersByTime(20)
    }

    beforeEach(() => {
      touchScreen()
      layout()
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('rests the window’s foot on the screen’s, hidden from a screen reader and never printed', async () => {
      holder()
      await frame()
      expect(stops()).toEqual(['500@500px']) // only Exercises is taller than the window
      const stop = document.querySelector<HTMLElement>('[data-snap-stop]')!
      expect(stop.getAttribute('aria-hidden')).toBe('true')
      expect(stop.hasAttribute('data-noprint')).toBe(true)
      expect(stops('[data-snap-copy]')).toEqual([]) // a copy has none: it is only passed through
    })

    it('leaves stops that are already right alone, and moves them when the window changes', async () => {
      holder()
      await frame()
      const first = document.querySelector('[data-planner-screen] > [data-snap-stop]')
      document.querySelector('main')!.append(document.createElement('section'))
      window.dispatchEvent(new Event('resize'))
      await frame()
      expect(document.querySelector('[data-planner-screen] > [data-snap-stop]')).toBe(first)
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
      window.dispatchEvent(new Event('resize'))
      await frame()
      expect(stops()).toEqual(['600@600px']) // Food is taller than 700px too, but not shown
    })

    it('keeps the stops to the screen the page shows, so a swipe up lands on a screen’s top (K102)', async () => {
      holder()
      await frame()
      expect(stops()).toEqual(['500@500px'])
      const copiesBefore = [...document.querySelectorAll('[data-snap-copy]')]
      // Down onto Food: the copy of Food (800) and Exercises (1300) above it.
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 2100 })
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(REST_MS)
      expect(stops()).toEqual([]) // Exercises' stops gone; Food fits
      await frame()
      // Laying stops is no change to a screen: the copies stay as they were.
      expect([...document.querySelectorAll('[data-snap-copy]')]).toEqual(copiesBefore)
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 800 })
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(REST_MS)
      expect(stops()).toEqual(['500@500px']) // back on Exercises' top
    })

    it('takes the stops away where the browser doesn’t snap', async () => {
      const enabled = ref(true)
      holder(enabled)
      await frame()
      expect(stops()).toHaveLength(1)
      enabled.value = false
      await nextTick()
      await frame()
      expect(stops()).toEqual([])
    })

    it('follows a screen that changes size with nothing changed inside it', async () => {
      let resized: () => void = () => {}
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resized = callback
          }
          observe(): void {}
          disconnect(): void {}
        },
      )
      holder()
      await frame()
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 })
      resized()
      await frame()
      expect(stops()).toEqual(['300@300px'])
      vi.unstubAllGlobals()
      resized() // a mouse or trackpad now: nothing to lay
      await frame()
      expect(stops()).toEqual([])
    })
  })

  it('turns snapping off while it sprints, and back on when it lands or stops (K98)', () => {
    const html = document.documentElement
    sprintTo(1300)
    expect(html.style.scrollSnapType).toBe('none')
    vi.advanceTimersByTime(SPRINT_MS + 50)
    expect(html.style.scrollSnapType).toBe('')
    sprintTo(0)
    expect(html.style.scrollSnapType).toBe('none')
    stopSprint()
    expect(html.style.scrollSnapType).toBe('')
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

  it('measures Edit plan’s sticky bar where the week isn’t fixed (K99)', () => {
    const bar = document.createElement('header')
    bar.dataset.slot = 'bar'
    bar.style.position = 'fixed' // the week's screens: out of sight, over the page
    bar.getBoundingClientRect = () => ({ height: 108 }) as DOMRect
    document.body.prepend(bar)
    expect(bandHeight()).toBe(0)
    bar.style.position = 'sticky'
    band('static')
    expect(bandHeight()).toBe(108)
    document.querySelector<HTMLElement>('[data-slot="week-band"]')!.style.position = 'sticky'
    expect(bandHeight()).toBe(80)
  })

  it('rests each Edit plan screen just under the sticky bar (K99)', () => {
    const bar = document.createElement('header')
    bar.dataset.slot = 'bar'
    bar.style.position = 'sticky'
    bar.getBoundingClientRect = () => ({ height: 100 }) as DOMRect
    document.body.prepend(bar)
    const wrapper = holder()
    wheel()
    scrollToY(300)
    scrollToY(540) // Food's top is 660px down the window: past the bar, a step in
    expect(landed()).toBe(1200) // Food's top meets the bar's foot
    wrapper.unmount()
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
