import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * Keyboard navigation for a WeekGrid table: the WAI-ARIA grid pattern with a roving tabindex
 * (brand/design-system/project/components/WeekGrid, Accessibility).
 *
 * - **Cells.** The grid's rows are its body and footer rows; the column headers aren't stops (a
 *   screen reader reads them with each cell). Every cell joins in except an `aria-hidden` one (the
 *   empty cell under "Week" in the Picked row). A cell's focus target is its one widget (the
 *   `widget` selector: the DayMark button) when it has one, else the cell itself.
 * - **One tab stop.** Exactly one target has `tabindex="0"`; every other has -1. It starts on the
 *   first target matching `start` (today's DayMark in the first row), else the first widget (the
 *   first day of a week that isn't this one), else the first cell; once a cell has been focused it
 *   is the last cell focused. Rows coming and going (Edit plan, adding, removing, another week) are picked up by a
 *   MutationObserver; a tab stop whose row has gone falls back to the start.
 * - **Keys.** Arrows move cell by cell and never wrap; Home and End go to the first and last cell
 *   in the row, Ctrl+Home and Ctrl+End to the first and last cell of the grid. Space and Enter are
 *   the widget's own (a DayMark toggles; Enter on a name's link opens the item's page in one
 *   press, F9, and Space on it does nothing); on a cell without one they do nothing.
 * - **Controls inside a cell.** Anything else focusable in a cell (a note's button and, in Edit
 *   plan, Remove in the row's last cell) is parked at `tabindex="-1"`, so
 *   Tab doesn't stop on every row's controls. F2 on the cell (or Enter, on a cell without a
 *   widget) lets them back into the Tab order and focuses the
 *   first; Tab and Shift+Tab move among them (Shift+Tab from the first returns to the cell, which
 *   keeps the tab stop), arrows stay with the control (a Stepper's value), and Escape parks them and
 *   puts focus back on the cell. Leaving the cell parks them too. Focus that reaches a control some
 *   other way (a click, or the focus put back after a removal) lets that cell's controls in just the
 *   same, so ConfirmDialog's return to a Remove button works unchanged.
 */
export interface GridNavOptions {
  /** A cell's one widget, which takes the cell's focus: the DayMark button. */
  widget: string
  /** Where the tab stop starts: today's DayMark. */
  start: string
}

export interface GridNav {
  /** Re-reads the rows: one tab stop, every other target at -1, new controls parked. */
  sync(): void
  destroy(): void
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'
/** On a parked control: its own tabindex from before ("" when it had none). */
const PARKED = 'data-grid-parked'

export function createGridNav(table: HTMLTableElement, options: GridNavOptions): GridNav {
  let stop: HTMLElement | null = null
  /** Whether the stop is a cell someone focused, rather than the start. */
  let chosen = false
  /** The cell whose controls are in the Tab order, if any. */
  let entered: HTMLTableCellElement | null = null

  const rows = (): HTMLTableRowElement[] =>
    [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])].flatMap((s) => [...s.rows])
  const navigable = (cell: Element): cell is HTMLTableCellElement =>
    cell.getAttribute('aria-hidden') !== 'true'
  const cellsOf = (row: HTMLTableRowElement): HTMLTableCellElement[] =>
    [...row.cells].filter(navigable)
  const targetOf = (cell: HTMLTableCellElement): HTMLElement =>
    cell.querySelector<HTMLElement>(options.widget) ?? cell
  const controlsIn = (cell: HTMLTableCellElement): HTMLElement[] => {
    const target = targetOf(cell)
    return [...cell.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el !== target)
  }

  /** The cell holding an event's target, if it's in this grid's rows. */
  function cellOf(node: EventTarget | null): HTMLTableCellElement | null {
    const cell = (node as Element).closest<HTMLTableCellElement>('td, th')
    return cell && rows().includes(cell.parentElement as HTMLTableRowElement) ? cell : null
  }

  function park(cell: HTMLTableCellElement): void {
    for (const el of controlsIn(cell)) {
      if (el.hasAttribute(PARKED)) continue
      el.setAttribute(PARKED, el.getAttribute('tabindex') ?? '')
      el.tabIndex = -1
    }
  }

  function unpark(cell: HTMLTableCellElement): void {
    for (const el of cell.querySelectorAll<HTMLElement>(`[${PARKED}]`)) {
      const own = el.getAttribute(PARKED)!
      el.removeAttribute(PARKED)
      if (own === '') el.removeAttribute('tabindex')
      else el.setAttribute('tabindex', own)
    }
  }

  // Focus leaves one cell (focusout parks it) before it enters another.
  function enter(cell: HTMLTableCellElement): void {
    unpark(cell)
    entered = cell
  }

  function leave(cell: HTMLTableCellElement): void {
    park(cell)
    entered = null
  }

  function setStop(target: HTMLElement): void {
    if (stop && stop !== target) stop.tabIndex = -1
    target.tabIndex = 0
    stop = target
    chosen = true
  }

  function sync(): void {
    const cells = rows().flatMap(cellsOf)
    for (const cell of cells) if (cell !== entered) park(cell)
    const targets = cells.map(targetOf)
    // The start can move (rows arriving in an empty grid); a cell someone focused stays put.
    if (!chosen || !targets.includes(stop!)) {
      chosen = false
      stop =
        targets.find((t) => t.matches(options.start)) ??
        targets.find((t) => t.matches(options.widget)) ??
        targets[0] ??
        null
    }
    for (const t of targets) t.tabIndex = t === stop ? 0 : -1
  }

  /** Where a navigation key goes from `cell`: a cell, null to stay put, undefined if not one. */
  function destination(cell: HTMLTableCellElement, ev: KeyboardEvent) {
    const all = rows()
    const row = cell.parentElement as HTMLTableRowElement
    const r = all.indexOf(row)
    const c = cell.cellIndex
    const along = (step: number) => {
      const cells = cellsOf(row).filter((x) => (step > 0 ? x.cellIndex > c : x.cellIndex < c))
      return (step > 0 ? cells[0] : cells.at(-1)) ?? null
    }
    const down = (step: number) => {
      const next = all[r + step]?.cells[c]
      return next && navigable(next) ? next : null
    }
    switch (ev.key) {
      case 'ArrowRight':
        return along(1)
      case 'ArrowLeft':
        return along(-1)
      case 'ArrowDown':
        return down(1)
      case 'ArrowUp':
        return down(-1)
      case 'Home':
        return cellsOf(ev.ctrlKey ? all[0]! : row)[0]!
      case 'End':
        return cellsOf(ev.ctrlKey ? all.at(-1)! : row).at(-1)!
    }
    return undefined
  }

  function onKeydown(ev: KeyboardEvent): void {
    const cell = cellOf(ev.target)
    if (!cell) return
    const target = targetOf(cell)
    if (ev.target !== target) {
      // In one of the cell's controls: only Escape is the grid's.
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      leave(cell)
      target.focus()
      return
    }
    // Enter is a widget's own (a DayMark steps, a name's link opens the item's page, F9); on a
    // cell without one it lets the controls in, as F2 does on any cell.
    const entering = ev.key === 'F2' || (ev.key === 'Enter' && target === cell)
    if (entering && controlsIn(cell).length > 0) {
      ev.preventDefault()
      enter(cell)
      controlsIn(cell)
        .find((el) => el.tabIndex >= 0 && !el.matches(':disabled'))
        ?.focus()
      return
    }
    if (
      (target === cell && (ev.key === ' ' || ev.key === 'Enter')) ||
      (target.matches('a') && ev.key === ' ')
    ) {
      // Nothing to act on (a total, the Picked row), or a link, which Space doesn't follow; Space
      // would scroll the page.
      ev.preventDefault()
      return
    }
    const next = destination(cell, ev)
    if (next === undefined) return
    ev.preventDefault()
    if (next) targetOf(next).focus()
  }

  function onFocusin(ev: FocusEvent): void {
    const cell = cellOf(ev.target)
    if (!cell) return
    const target = targetOf(cell)
    setStop(target)
    if (ev.target !== target && entered !== cell) enter(cell)
  }

  function onFocusout(ev: FocusEvent): void {
    if (entered && !entered.contains(ev.relatedTarget as Node | null)) leave(entered)
  }

  const observer = new MutationObserver(sync)
  observer.observe(table, { childList: true, subtree: true })
  table.addEventListener('keydown', onKeydown)
  table.addEventListener('focusin', onFocusin)
  table.addEventListener('focusout', onFocusout)
  sync()

  return {
    sync,
    destroy() {
      observer.disconnect()
      table.removeEventListener('keydown', onKeydown)
      table.removeEventListener('focusin', onFocusin)
      table.removeEventListener('focusout', onFocusout)
    },
  }
}

/** Runs `createGridNav` on the table in `table` while the component is mounted. */
export function useGridNav(table: Readonly<Ref<HTMLTableElement | null>>, options: GridNavOptions) {
  let nav: GridNav | undefined
  onMounted(() => (nav = createGridNav(table.value!, options)))
  onBeforeUnmount(() => nav?.destroy())
}
