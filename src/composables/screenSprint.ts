import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/** How long the page must stay still before it counts as come to rest. */
export const REST_MS = 120
/** How far into the window the line between two screens must come before a moving scroll sprints. */
export const STEP_SHARE = 0.04
export const MIN_STEP_PX = 16
/** How long a sprint takes, eased out (K45). */
export const SPRINT_MS = 260
/**
 * How long after a wheel event, or after a finger lifts, a scroll counts as a wheel's or a fling's
 * and may sprint at once. A fling's momentum runs on after the finger lifts. A wheel event further
 * than this after the last one starts a new gesture (K94).
 */
export const WHEEL_MS = 150
export const FLING_MS = 1200
/** A wheel step after this long a silence, and big enough, is a new click of a mouse wheel (K95). */
export const CLICK_GAP_MS = 100
/** The shortest time a wheel step is taken to cover, so a burst of steps can't read as fast. */
const MIN_STEP_MS = 8

/**
 * Tells a new push from the momentum of the last one (K95, K96), fed one wheel step at a time once
 * a gesture has moved a screen. It goes by speed, a step's size over the time since the last:
 * while the page sprints the browser sends steps late and merged, a frame's worth or three at
 * once, and their sizes jump though the speed doesn't. Momentum only slows. A trackpad's new swipe
 * cuts it off, so the speed drops and then grows: once it has fallen below 70% of its peak, two
 * steps in a row at least 1.6 times the lowest since (and 6px a frame more) are a new push. A mouse
 * wheel's click comes after a silence, so a step of 10px or more, or of 4px and half as big again
 * as the one before, after CLICK_GAP_MS is a new push too; momentum's last steps are smaller.
 */
export class MomentumWatch {
  private peak = 0
  private low = Infinity
  private armed = false
  private rising = 0
  private prev = 0

  /** A new sprint: start watching its momentum afresh. */
  reset(): void {
    this.peak = 0
    this.low = Infinity
    this.armed = false
    this.rising = 0
  }

  /** One wheel step, its size in pixels and the ms since the last; true when it starts a push. */
  next(size: number, gap: number): boolean {
    const prev = this.prev
    this.prev = size
    if (gap >= CLICK_GAP_MS && (size >= 10 || (size >= 4 && size > prev * 1.5))) return true
    const speed = size / Math.max(gap, MIN_STEP_MS)
    this.peak = Math.max(this.peak, speed)
    if (!this.armed) {
      if (speed < this.peak * 0.7) {
        this.armed = true
        this.low = speed
      }
      return false
    }
    if (speed < this.low) {
      this.low = speed
      this.rising = 0
      return false
    }
    if (speed >= Math.max(this.low * 1.6, this.low + 6 / 16)) return ++this.rising >= 2
    this.rising = 0
    return false
  }
}

/**
 * Where a scroll should go (PlannerScreen card, K38, K45). `top` is the scroll position, `height`
 * the screen's, `starts` each screen's top in page coordinates, in order, and `direction` the way
 * the person was scrolling (1 down, -1 up), or 0 when nobody scrolled (the window was resized or
 * the device rotated). A line counts once it is more than `step` pixels inside the window. Inside
 * one screen, nowhere: a tall screen scrolls as usual. Across the line between two, on in the
 * direction of travel: down to the next screen's top, up so the earlier screen's end meets the
 * bottom of the window. With no direction, to whichever screen fills more of the window. Returns
 * null when the page may stay where it is.
 */
export function sprintTarget(
  top: number,
  height: number,
  starts: number[],
  direction: 1 | -1 | 0,
  step = 1,
): number | null {
  for (const line of starts.slice(1)) {
    if (line > top + step && line < top + height - step) {
      const down = direction === 0 ? line - top < height / 2 : direction > 0
      return down ? line : line - height
    }
  }
  return null
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
/**
 * A touch screen (a phone, an iPad without a trackpad): there the browser snaps between the
 * screens itself (main.css, K98), with `scroll-snap-stop: always`, so a swipe moves one screen
 * and its momentum is the browser's own. A script setting the position each frame fights iOS's
 * momentum and jitters.
 */
export const touchSnaps = () =>
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false

/**
 * CSS snapping would pull each frame of a sprint back to a snap point, so it is off while one
 * runs (the arrows, a wrap) and back on when it lands or stops.
 */
function snapOff(): void {
  document.documentElement.style.scrollSnapType = 'none'
}
function snapOn(): void {
  document.documentElement.style.removeProperty('scroll-snap-type')
}

let frame = 0
/** The end of the sprint running now, if one is. */
let landing: (() => void) | null = null
/** The way the last sprint went (1 down, -1 up): a wheel's momentum runs on the same way. */
let heading: 1 | -1 | 0 = 0

/**
 * Move the page to `top` in SPRINT_MS, eased out, at once when motion is reduced (K45). Each frame
 * sets the position, so a fling's momentum can't carry the page past it. `done` runs on arrival.
 */
export function sprintTo(top: number, done?: () => void): void {
  halt()
  heading = top > window.scrollY ? 1 : top < window.scrollY ? -1 : 0
  snapOff()
  if (reducedMotion()) {
    window.scrollTo({ top, behavior: 'auto' })
    done?.()
    snapOn()
    return
  }
  const from = window.scrollY
  const start = performance.now()
  landing = () => {
    landing = null
    done?.()
    snapOn()
  }
  const step = (now: number) => {
    // A frame's time can fall just before `start` (the first frame of a sprint begun in a scroll
    // handler), which would ease the page backwards for that frame.
    const k = Math.min(1, Math.max(0, (now - start) / SPRINT_MS))
    window.scrollTo({ top: from + (top - from) * (1 - (1 - k) ** 3), behavior: 'auto' })
    if (k < 1) frame = requestAnimationFrame(step)
    else landing?.()
  }
  frame = requestAnimationFrame(step)
}

/**
 * The height of what stays at the top over the screens: the week fixed above the week's screens
 * (K88), or Edit plan's sticky bar (K99); 0 where neither is (a short screen). A screen rests just
 * under it, so it is taken off the window's top.
 */
export function bandHeight(): number {
  for (const slot of ['week-band', 'bar']) {
    const band = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
    if (band && getComputedStyle(band).position === 'sticky') {
      return band.getBoundingClientRect().height
    }
  }
  return 0
}

/** Sprint to the top of the screen labelled by `headingId` (the arrows between screens, K42). */
export function sprintToScreen(headingId: string): void {
  const screen = document.querySelector(`[aria-labelledby="${headingId}"]`)
  if (screen) sprintTo(screen.getBoundingClientRect().top + window.scrollY - bandHeight())
}

function halt(): void {
  cancelAnimationFrame(frame)
  landing = null
  snapOn()
}

/** Stop a running sprint where it is. A wrap's copy goes with it, so none is left behind. */
export function stopSprint(): void {
  halt()
  wrapping = false
  for (const copy of document.querySelectorAll('[data-wrap-copy]')) copy.remove()
}

/** Whether a wrap's sprint is running: it can't be turned round halfway (K92). */
let wrapping = false

/**
 * Where the page is against its ends: 1 at its foot, -1 at its top, 0 between them or when it
 * doesn't scroll at all.
 */
export function pageEnd(): 1 | -1 | 0 {
  const max = document.documentElement.scrollHeight - window.innerHeight
  if (max <= 1) return 0
  if (window.scrollY >= max - 1) return 1
  return window.scrollY <= 1 ? -1 : 0
}

/**
 * The screens wrap round (K92): past the last one the first comes up from below, and above the
 * first the last comes down from above. A copy of the screen wrapped to, inert and hidden from a
 * screen reader, goes beyond the end, and the page sprints onto it. Then the copy goes and the
 * page jumps to the same place on the real screen, which looks the same, so the jump doesn't show.
 * Going down it rests the screen's top under the fixed week; going up, its end at the window's
 * foot, as a sprint up does. `done` runs once the page is on the real screen.
 */
export function wrapAround(way: 1 | -1, done?: () => void): boolean {
  const screens = [...document.querySelectorAll<HTMLElement>('[data-planner-screen]')]
  if (screens.length < 2) return false
  stopSprint()
  snapOff()
  const target = way > 0 ? screens[0]! : screens.at(-1)!
  const copy = target.cloneNode(true) as HTMLElement
  for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id')
  copy.removeAttribute('data-planner-screen')
  copy.removeAttribute('aria-labelledby')
  copy.setAttribute('aria-hidden', 'true')
  copy.inert = true
  copy.dataset.wrapCopy = ''
  const band = bandHeight()
  let to: number
  if (way > 0) {
    screens.at(-1)!.after(copy)
    to = copy.getBoundingClientRect().top + window.scrollY - band
  } else {
    screens[0]!.before(copy)
    // The copy pushes everything down; the page follows, so nothing moves on screen.
    const box = copy.getBoundingClientRect()
    window.scrollTo({ top: window.scrollY + box.height, behavior: 'auto' })
    const at = copy.getBoundingClientRect()
    to = Math.max(at.top + window.scrollY - band, at.bottom + window.scrollY - window.innerHeight)
  }
  wrapping = true
  sprintTo(to, () => {
    wrapping = false
    const offset = window.scrollY - (copy.getBoundingClientRect().top + window.scrollY)
    copy.remove()
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY + offset,
      behavior: 'auto',
    })
    done?.()
  })
  return true
}

/** Whether a sprint is running. */
export function sprinting(): boolean {
  return landing !== null
}

/**
 * The planner's screens never rest side by side (K38): while `enabled`, a scroll that brings the
 * line between two screens into the window sprints on to the next one. A wheel or a fling sprints
 * as soon as the line is a step inside (K45), while it is still moving; a finger on the screen
 * waits until it lifts; anything else (a scrollbar drag, the keyboard) when the page comes to rest.
 * While a sprint runs, and until the wheel is quiet after it, the wheel and a finger can't move
 * the page, unless the wheel turns the other way (K89). At either end a new wheel gesture or a swipe
 * on past it wraps round to the screen at the other end (K92). A resize or a rotation that leaves the page across a line settles on the screen that
 * fills more of the window (K40). The screens are the elements matching `[data-planner-screen]`.
 * Scrolling inside a screen is left alone, so a screen with more rows than fit scrolls as usual.
 */
export function useScreenSprint(enabled: Ref<boolean>) {
  let last = 0
  let direction: 1 | -1 | 0 = 1
  let timer: ReturnType<typeof setTimeout> | undefined
  let finger = false
  /** When the last wheel event came, and when a finger last lifted. */
  let wheelAt = -Infinity
  let liftAt = -Infinity
  /**
   * A wheel gesture that began with the page at one of its ends, going on past it (K92): the way
   * it goes and how far it has gone. Momentum arriving at an end mid-gesture never starts one.
   */
  let push: { way: 1 | -1; sum: number } | null = null
  /**
   * Whether the wheel gesture going on now has already moved a screen (K94). A gesture is a run of
   * wheel events less than WHEEL_MS apart: a swipe and all its momentum, or a mouse wheel turned
   * without stopping. It moves one screen at most.
   */
  let spent = false
  /** Watches a spent gesture's momentum for a new push (K95). */
  const momentum = new MomentumWatch()
  /** Where a finger came down, and whether the page was at an end then. */
  let touchY = 0
  let touchEnd: 1 | -1 | 0 = 0

  /**
   * Each screen's top, as the scroll position that rests it just under the fixed week (K88). With
   * the window less the band as the height, sprintTarget sees only the part the screens move in.
   */
  function starts(band: number): number[] {
    const screens = [...document.querySelectorAll<HTMLElement>('[data-planner-screen]')]
    return screens.map((el) => el.getBoundingClientRect().top + window.scrollY - band)
  }

  function go(step: number): boolean {
    const band = bandHeight()
    const target = sprintTarget(
      window.scrollY,
      window.innerHeight - band,
      starts(band),
      direction,
      step,
    )
    if (target === null) return false
    begin(target)
    return true
  }

  /** Sprint to `target`: the gesture that asked for it has had its screen. */
  function begin(target: number): void {
    clearTimeout(timer)
    spent = true
    momentum.reset()
    sprintTo(target, landed)
  }

  /** A sprint or a wrap has landed. */
  function landed(): void {
    last = window.scrollY
  }

  /** How far a scroll must go to count: 4% of the window, at least 16px (K45). */
  function step(): number {
    return Math.max(MIN_STEP_PX, window.innerHeight * STEP_SHARE)
  }

  /** Wrap round to the first screen or the last (K92), then rest as after a sprint. */
  function wrap(way: 1 | -1): void {
    clearTimeout(timer)
    spent = true
    momentum.reset()
    wrapAround(way, landed)
  }

  /** At rest. A finger still on the screen is holding the page where it is; its lifting decides. */
  function settle(): void {
    if (enabled.value && !finger && !sprinting() && !touchSnaps()) go(1)
  }

  function onScroll(): void {
    if (!enabled.value || sprinting() || touchSnaps()) return
    const now = window.scrollY
    if (now !== last) direction = now > last ? 1 : -1
    last = now
    clearTimeout(timer)
    // A wheel or a fling sprints at once; a scrollbar drag or the keyboard waits for rest (K45).
    const t = performance.now()
    const moving = t - wheelAt < WHEEL_MS || (!finger && t - liftAt < FLING_MS)
    if (moving && go(step())) return
    timer = setTimeout(settle, REST_MS)
  }

  /** A resize or rotation: no one scrolled, so no direction until the next scroll says one. */
  function onResize(): void {
    direction = 0
    last = window.scrollY
    clearTimeout(timer)
    timer = setTimeout(settle, REST_MS)
  }

  /**
   * One push, one screen (K94, K95): once a wheel gesture has moved a screen, its momentum can't
   * move the page, however long it runs. A new push (a new gesture after the wheel was still for
   * WHEEL_MS, or one MomentumWatch finds inside the momentum) moves the next screen once the
   * sprint before has landed; nothing moves on while one runs (K96). A wheel the other way is the person turning round
   * (K89): it stops a sprint where it is, and counts as a new gesture.
   */
  function onWheel(event: WheelEvent): void {
    if (!enabled.value || touchSnaps()) return
    const now = performance.now()
    const gap = now - wheelAt
    let fresh = gap >= WHEEL_MS
    wheelAt = now
    const way = Math.sign(event.deltaY)
    const size = Math.abs(event.deltaY) * (event.deltaMode === 1 ? 16 : 1)
    if (fresh) spent = false
    if (sprinting() || spent) {
      // A new push the same way, once the sprint has landed (K95). Never during it (K96): the
      // momentum watch still sees the steps, so a push that started then goes on to count after.
      const push = way !== 0 && way === heading && momentum.next(size, gap)
      if (push && !sprinting()) {
        spent = false
        fresh = true
      } else if (way === 0 || way === heading || wrapping) {
        event.preventDefault()
        return
      } else {
        stopSprint()
        spent = false
        last = window.scrollY
        fresh = true
      }
    }
    // A gesture starting at an end, the way past it, wraps once it has gone a step (K92).
    const end = pageEnd()
    if (fresh) push = end !== 0 && end === way ? { way: end, sum: 0 } : null
    if (push && way === push.way && end === way) {
      event.preventDefault()
      push.sum += size
      if (push.sum >= step()) {
        push = null
        wrap(way)
      }
    } else push = null
  }

  function onTouchStart(event: TouchEvent): void {
    finger = true
    touchY = event.touches?.[0]?.clientY ?? 0
    touchEnd = sprinting() ? 0 : pageEnd()
  }
  function onTouchMove(event: TouchEvent): void {
    if (enabled.value && sprinting()) event.preventDefault()
  }
  /**
   * A finger lifting. A swipe that began at an end and went a step the way past it, with the page
   * still there, wraps round (K92); anything else is a scroll like any other.
   */
  function onTouchEnd(event: TouchEvent): void {
    finger = false
    liftAt = performance.now()
    const y = event.changedTouches?.[0]?.clientY ?? touchY
    const way = Math.sign(touchY - y)
    if (
      enabled.value &&
      touchEnd !== 0 &&
      way === touchEnd &&
      pageEnd() === touchEnd &&
      Math.abs(touchY - y) >= step()
    ) {
      wrap(touchEnd)
      return
    }
    onScroll()
  }

  watch(enabled, (on) => {
    if (!on) clearTimeout(timer)
  })
  onMounted(() => {
    last = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
  })
  onBeforeUnmount(() => {
    clearTimeout(timer)
    stopSprint()
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('touchcancel', onTouchEnd)
  })
}
