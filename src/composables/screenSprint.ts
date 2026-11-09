import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/** How long the page must stay still before it counts as come to rest. */
export const REST_MS = 120
/** How far into the window the line between two screens must come before a moving scroll sprints. */
export const STEP_SHARE = 0.04
export const MIN_STEP_PX = 16
/** How long a sprint takes, eased out (K45). */
export const SPRINT_MS = 260
/** How long the wheel must be quiet after a sprint before it scrolls the page again. */
export const QUIET_MS = 180
/**
 * How long after a wheel event, or after a finger lifts, a scroll counts as a wheel's or a fling's
 * and may sprint at once. A fling's momentum runs on after the finger lifts.
 */
export const WHEEL_MS = 150
export const FLING_MS = 1200

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
  stopSprint()
  heading = top > window.scrollY ? 1 : top < window.scrollY ? -1 : 0
  if (reducedMotion()) {
    window.scrollTo({ top, behavior: 'auto' })
    done?.()
    return
  }
  const from = window.scrollY
  const start = performance.now()
  landing = () => {
    landing = null
    done?.()
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
 * The height of the week fixed above the screens (K88), or 0 where it isn't fixed (Edit plan, a
 * short screen). A screen rests just under it, so it is taken off the window's top.
 */
export function bandHeight(): number {
  const band = document.querySelector<HTMLElement>('[data-slot="week-band"]')
  if (!band || getComputedStyle(band).position !== 'sticky') return 0
  return band.getBoundingClientRect().height
}

/** Sprint to the top of the screen labelled by `headingId` (the arrows between screens, K42). */
export function sprintToScreen(headingId: string): void {
  const screen = document.querySelector(`[aria-labelledby="${headingId}"]`)
  if (screen) sprintTo(screen.getBoundingClientRect().top + window.scrollY - bandHeight())
}

/** Stop a running sprint where it is. */
export function stopSprint(): void {
  cancelAnimationFrame(frame)
  landing = null
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
 * the page, unless the wheel turns the other way (K89). A resize or a rotation that leaves the page across a line settles on the screen that
 * fills more of the window (K40). The screens are the elements matching `[data-planner-screen]`.
 * Scrolling inside a screen is left alone, so a screen with more rows than fit scrolls as usual.
 */
export function useScreenSprint(enabled: Ref<boolean>) {
  let last = 0
  let direction: 1 | -1 | 0 = 1
  let timer: ReturnType<typeof setTimeout> | undefined
  let quietUntil = 0
  let finger = false
  /** When the last wheel event came, and when a finger last lifted. */
  let wheelAt = -Infinity
  let liftAt = -Infinity

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
    clearTimeout(timer)
    sprintTo(target, () => {
      last = window.scrollY
      quietUntil = performance.now() + QUIET_MS
    })
    return true
  }

  /** At rest. A finger still on the screen is holding the page where it is; its lifting decides. */
  function settle(): void {
    if (enabled.value && !finger && !sprinting()) go(1)
  }

  function onScroll(): void {
    if (!enabled.value || sprinting()) return
    const now = window.scrollY
    if (now !== last) direction = now > last ? 1 : -1
    last = now
    clearTimeout(timer)
    // A wheel or a fling sprints at once; a scrollbar drag or the keyboard waits for rest (K45).
    const t = performance.now()
    const moving = t - wheelAt < WHEEL_MS || (!finger && t - liftAt < FLING_MS)
    if (moving && go(Math.max(MIN_STEP_PX, window.innerHeight * STEP_SHARE))) return
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
   * During a sprint and until the wheel is quiet after it, the wheel can't move the page: that
   * swallows a fling's momentum, which runs on the way the sprint went. A wheel the other way is
   * the person turning round, so it is never held back: it stops the sprint where it is and
   * scrolls, and the scroll sprints back.
   */
  function onWheel(event: WheelEvent): void {
    if (!enabled.value) return
    const now = performance.now()
    wheelAt = now
    if (!sprinting() && now >= quietUntil) return
    const way = Math.sign(event.deltaY)
    if (way !== 0 && way !== heading) {
      stopSprint()
      quietUntil = 0
      last = window.scrollY
      return
    }
    event.preventDefault()
    quietUntil = now + QUIET_MS
  }

  function onTouchStart(): void {
    finger = true
  }
  function onTouchMove(event: TouchEvent): void {
    if (enabled.value && sprinting()) event.preventDefault()
  }
  function onTouchEnd(): void {
    finger = false
    liftAt = performance.now()
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
