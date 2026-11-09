import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Whether a key press belongs to something else, so a shortcut leaves it alone (K91): typing in a
 * field, a press with Ctrl, ⌘ or Alt (the browser's and the system's own shortcuts), a held key
 * repeating, a key mid-composition, one a handler already took, and any key while a dialog or a
 * popover is open, which has its own keys (Esc closes it).
 */
export function ownedElsewhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return true
  if (event.ctrlKey || event.metaKey || event.altKey) return true
  const target = event.target
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('input, textarea, select') !== null)
  )
    return true
  return (
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [data-slot="popover-content"]',
    ) !== null
  )
}

/**
 * Single-key shortcuts while the component is mounted (K91). `keys` maps a key, lower case as
 * `KeyboardEvent.key` gives it ("e", "escape"), to what it does; it is read on each press, so the
 * map can depend on state. A key with nothing mapped, or returning false, is left to the page.
 */
export function useShortcuts(keys: () => Record<string, (() => boolean | void) | undefined>) {
  function onKeydown(event: KeyboardEvent): void {
    if (ownedElsewhere(event)) return
    const run = keys()[event.key.toLowerCase()]
    if (run && run() !== false) event.preventDefault()
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
