import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** How long a press is held before it toggles Edit plan (Header card, Out of sight; K79, K80). */
export const HOLD_MS = 500
/** How far a held press may wander and still count; further is a scroll or a swipe. */
const HOLD_SLOP_PX = 10
/** How long after a long press is let go its click may still arrive, and be swallowed. */
const CLICK_GRACE_MS = 300
/** How far the handle must be pulled down before it opens Edit plan. */
const PULL_PX = 12

/** A press being held: where it started, and the timer that ends it in a long press. */
interface Hold {
  id: number | undefined
  x: number
  y: number
  /** A finger or a pen, whose hold the browser would also answer with a context menu. */
  touch: boolean
  timer: ReturnType<typeof setTimeout>
}

/**
 * Where a press is never a hold: the bar and its handle, what lies over the page, and a field,
 * where holding selects text.
 */
const NOT_A_HOLD = [
  '[data-slot="bar"]',
  '[data-slot="bar-handle"]',
  '[data-slot="popover-content"]',
  '[role="dialog"]',
  'input',
  'textarea',
  'select',
  '[contenteditable]',
].join(', ')

interface BarRevealOptions {
  /** The bar is out of sight above the screen (the planner's screens). */
  overlay: Ref<boolean>
  /** A long press counts here: the planner's screens and Edit plan. */
  holdable: Ref<boolean>
  /** A long press: Edit plan on from the screens, off from Edit plan. */
  onLongPress: () => void
  /** The handle, pressed or pulled down: Edit plan on. */
  onHandle: () => void
}

/**
 * How the Header is reached on the planner's screens (Header card, Out of sight; K25, K79, K80).
 * Edit plan is where the bar is in view: sticky at the top, so the page sits below it and it
 * covers nothing (K27). So every way to the bar but the keyboard goes there.
 *
 * - **Long press, anywhere:** a press held HOLD_MS without moving more than HOLD_SLOP_PX calls
 *   `onLongPress`, by mouse, pen or finger, on the screens and in Edit plan alike. The click that
 *   ends it is swallowed, so a held day cell or button is never pressed, and a finger's or pen's
 *   hold opens no context menu. A press in a field, a popover, a dialog or the bar is never a
 *   hold.
 * - **Finger:** pressing the handle, or pulling it down, calls `onHandle`.
 * - **Keyboard:** the bar floats over the screen while focus is inside it (by CSS), so Tab still
 *   reaches it; Escape takes focus out of it.
 */
export function useBarReveal(bar: Ref<HTMLElement | null>, options: BarRevealOptions) {
  const { overlay, holdable } = options
  let pullFrom: number | null = null
  let held: Hold | null = null
  /** The click that ends a long press is still to come, and is swallowed. */
  let swallowClick = false
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  /** A finger's or pen's long press fired and is still down (its context menu is kept back). */
  let touchHoldDown = false

  function cancelHold(): void {
    if (held) clearTimeout(held.timer)
    held = null
  }
  function stopSwallowing(): void {
    clearTimeout(graceTimer)
    swallowClick = false
  }
  /** The window lost the press (another app, another tab): nothing of it is still to come. */
  function forgetPress(): void {
    cancelHold()
    stopSwallowing()
    touchHoldDown = false
  }
  function startHold(ev: PointerEvent): void {
    cancelHold()
    // The primary button only, so a right click is never a hold. (`isPrimary` is undefined
    // where PointerEvent is missing, as in jsdom.)
    if (ev.button !== 0 || ev.isPrimary === false) return
    const touch = ev.pointerType === 'touch' || ev.pointerType === 'pen'
    held = {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      touch,
      timer: setTimeout(() => {
        held = null
        swallowClick = true
        touchHoldDown = touch
        window.getSelection?.()?.removeAllRanges()
        options.onLongPress()
      }, HOLD_MS),
    }
  }
  function onHoldMove(ev: PointerEvent): void {
    if (!held || ev.pointerId !== held.id) return
    if (Math.hypot(ev.clientX - held.x, ev.clientY - held.y) > HOLD_SLOP_PX) cancelHold()
  }
  function onHoldEnd(ev: PointerEvent): void {
    if (held && ev.pointerId === held.id) cancelHold()
    touchHoldDown = false
    // The browser sends the click straight after pointerup, or not at all: never wait longer.
    if (swallowClick) {
      clearTimeout(graceTimer)
      graceTimer = setTimeout(stopSwallowing, CLICK_GRACE_MS)
    }
  }
  /** In the capture phase on window, so the click never reaches the cell or button held. */
  function onClick(ev: MouseEvent): void {
    if (!swallowClick) return
    stopSwallowing()
    ev.preventDefault()
    ev.stopPropagation()
  }
  /** A finger or pen held down opens the browser's menu; this hold is the bar's, not the menu's. */
  function onContextMenu(ev: MouseEvent): void {
    if (held?.touch || touchHoldDown) ev.preventDefault()
  }

  function onHandleDown(ev: PointerEvent): void {
    pullFrom = ev.clientY
  }
  function onHandleMove(ev: PointerEvent): void {
    if (pullFrom !== null && ev.clientY - pullFrom > PULL_PX) {
      pullFrom = null
      options.onHandle()
    }
  }
  function onHandleClick(): void {
    pullFrom = null
    options.onHandle()
  }

  function onPointerDown(ev: PointerEvent): void {
    // A new press: a click still owed to the last long press is not coming.
    stopSwallowing()
    if (!holdable.value) return
    const target = ev.target as Element | null
    if (!target?.closest(NOT_A_HOLD)) startHold(ev)
  }
  function onVisibility(): void {
    if (document.visibilityState === 'hidden') forgetPress()
  }
  function onKeydown(ev: KeyboardEvent): void {
    // A key's click (Enter, Space) is never the click that ends a long press.
    stopSwallowing()
    if (!overlay.value || ev.key !== 'Escape') return
    const active = document.activeElement as HTMLElement | null
    if (active && bar.value?.contains(active)) active.blur()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onHoldMove)
    document.addEventListener('pointerup', onHoldEnd)
    document.addEventListener('pointercancel', onHoldEnd)
    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', forgetPress)
    window.addEventListener('click', onClick, true)
  })
  onBeforeUnmount(() => {
    clearTimeout(graceTimer)
    cancelHold()
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('pointermove', onHoldMove)
    document.removeEventListener('pointerup', onHoldEnd)
    document.removeEventListener('pointercancel', onHoldEnd)
    document.removeEventListener('contextmenu', onContextMenu)
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('blur', forgetPress)
    window.removeEventListener('click', onClick, true)
  })

  return { onHandleDown, onHandleMove, onHandleClick }
}
