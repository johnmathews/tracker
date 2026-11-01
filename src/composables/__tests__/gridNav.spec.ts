import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createGridNav, useGridNav, type GridNav } from '@/composables/gridNav'

/**
 * A small WeekGrid: a header row (never a stop), two body rows of name, three days and a total,
 * and a Picked row whose last cell is aria-hidden. Day 2 is today. `edit` puts controls in the
 * row headers, as Edit plan does.
 */
function html({ today = true, edit = false } = {}): string {
  const header = (name: string) =>
    `<th role="rowheader" data-c="${name}">${name}${
      edit
        ? `<button data-c="${name}-lower" aria-disabled="true">-</button><input data-c="${name}-input" />` +
          `<button data-c="${name}-skip" tabindex="-1">?</button><button data-c="${name}-remove" disabled>x</button>`
        : ''
    }</th>`
  const day = (name: string, i: number) =>
    `<td role="gridcell"><button data-w data-c="${name}-${i}" ${
      today && i === 2 ? 'aria-current="date"' : ''
    }>${i}</button></td>`
  const row = (name: string) =>
    `<tr>${header(name)}${[0, 1, 2].map((i) => day(name, i)).join('')}<td role="gridcell" data-c="${name}-total">1 of 2</td></tr>`
  return `<table role="grid">
    <caption>Week</caption>
    <thead><tr><th>Exercise</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Week</th></tr></thead>
    <tbody>${row('a')}${row('b')}</tbody>
    <tfoot><tr><th role="rowheader" data-c="picked">Picked</th><td data-c="p0">1</td><td data-c="p1">2</td><td data-c="p2">3</td><td aria-hidden="true"></td></tr></tfoot>
  </table>`
}

let nav: GridNav | undefined
let table: HTMLTableElement

function setup(opts: { today?: boolean; edit?: boolean; start?: string } = {}): HTMLTableElement {
  document.body.innerHTML = `<a href="#x">before</a>${html(opts)}<a href="#y">after</a>`
  table = document.querySelector('table')!
  nav = createGridNav(table, { widget: '[data-w]', start: opts.start ?? '[aria-current="date"]' })
  return table
}

afterEach(() => {
  nav?.destroy()
  nav = undefined
  document.body.innerHTML = ''
})

const el = (c: string) => document.querySelector<HTMLElement>(`[data-c="${c}"]`)!
const stops = () => [...table.querySelectorAll<HTMLElement>('[tabindex="0"]')]

/** Dispatch a keydown on the focused element; returns whether the grid took it. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  document.activeElement!.dispatchEvent(ev)
  return ev.defaultPrevented
}

/** Let the MutationObserver see a change to the rows. */
const observed = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createGridNav', () => {
  describe('the one tab stop', () => {
    it('puts it on today’s cell in the first body row, and every other cell at -1', () => {
      setup()
      expect(stops()).toEqual([el('a-2')])
      for (const c of ['a-0', 'a-1', 'b-2', 'a-total', 'p0', 'picked'])
        expect(el(c).getAttribute('tabindex')).toBe('-1')
      expect(el('a').getAttribute('tabindex')).toBe('-1')
      // A day cell's focus is its widget's; the cell itself takes none.
      expect(el('a-0').closest('td')!.hasAttribute('tabindex')).toBe(false)
      // The column headers and the hidden cell under "Week" are out of the navigation.
      for (const th of table.tHead!.querySelectorAll('th'))
        expect(th.hasAttribute('tabindex')).toBe(false)
      expect(table.querySelector('[aria-hidden="true"]')!.hasAttribute('tabindex')).toBe(false)
    })

    it('starts on the first day cell when today isn’t in this week', () => {
      setup({ today: false })
      expect(stops()).toEqual([el('a-0')])
    })

    it('starts on the first cell when no cell has a widget, and has none without rows', () => {
      setup({ start: '[data-none]' })
      for (const b of table.querySelectorAll('[data-w]')) b.removeAttribute('data-w')
      nav!.sync()
      expect(stops()).toEqual([el('a')])
      table.tBodies[0]!.remove()
      table.tFoot!.remove()
      nav!.sync()
      expect(stops()).toEqual([])
    })

    it('remembers the last cell focused as the tab stop', () => {
      setup()
      el('b-1').focus()
      expect(stops()).toEqual([el('b-1')])
      el('p1').focus()
      expect(stops()).toEqual([el('p1')])
      expect(el('b-1').getAttribute('tabindex')).toBe('-1')
    })

    it('ignores keys and focus outside the grid’s rows', () => {
      setup()
      const ev = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      })
      table.caption!.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    })

    it('ignores focus in the column headers and after the grid', () => {
      setup()
      table.tHead!.querySelector('th')!.setAttribute('tabindex', '-1')
      table.tHead!.querySelector('th')!.focus()
      ;(document.querySelector('a[href="#y"]') as HTMLElement).focus()
      expect(stops()).toEqual([el('a-2')])
    })
  })

  describe('arrow keys', () => {
    it('move cell by cell along the row, across names, days and the total', () => {
      setup()
      el('a-2').focus()
      expect(press('ArrowRight')).toBe(true)
      expect(document.activeElement).toBe(el('a-total'))
      expect(stops()).toEqual([el('a-total')])
      press('ArrowLeft')
      press('ArrowLeft')
      press('ArrowLeft')
      press('ArrowLeft')
      expect(document.activeElement).toBe(el('a'))
    })

    it('move up and down a column, into and out of the Picked row', () => {
      setup()
      el('a-1').focus()
      press('ArrowDown')
      expect(document.activeElement).toBe(el('b-1'))
      press('ArrowDown')
      expect(document.activeElement).toBe(el('p1'))
      press('ArrowUp')
      expect(document.activeElement).toBe(el('b-1'))
    })

    it('stop at the grid’s edges and never wrap or land on the hidden cell', () => {
      setup()
      el('a').focus()
      expect(press('ArrowLeft')).toBe(true)
      expect(document.activeElement).toBe(el('a'))
      press('ArrowUp')
      expect(document.activeElement).toBe(el('a'))
      el('b-total').focus()
      press('ArrowDown')
      expect(document.activeElement).toBe(el('b-total'))
      el('p2').focus()
      press('ArrowRight')
      expect(document.activeElement).toBe(el('p2'))
      press('ArrowDown')
      expect(document.activeElement).toBe(el('p2'))
    })

    it('Home and End go to the first and last cell in the row', () => {
      setup()
      el('b-1').focus()
      press('End')
      expect(document.activeElement).toBe(el('b-total'))
      press('Home')
      expect(document.activeElement).toBe(el('b'))
      el('p0').focus()
      press('End')
      expect(document.activeElement).toBe(el('p2'))
    })

    it('Ctrl+Home and Ctrl+End go to the first and last cell of the grid', () => {
      setup()
      el('b-1').focus()
      press('End', { ctrlKey: true })
      expect(document.activeElement).toBe(el('p2'))
      press('Home', { ctrlKey: true })
      expect(document.activeElement).toBe(el('a'))
    })

    it('leave other keys alone', () => {
      setup()
      el('a-1').focus()
      expect(press('a')).toBe(false)
      expect(press('PageDown')).toBe(false)
      expect(document.activeElement).toBe(el('a-1'))
    })
  })

  describe('Space and Enter', () => {
    it('are left to a day cell’s widget, and do nothing on any other cell', () => {
      setup()
      el('a-1').focus()
      expect(press(' ')).toBe(false)
      expect(press('Enter')).toBe(false)
      el('a-total').focus()
      expect(press(' ')).toBe(true)
      expect(press('Enter')).toBe(true)
      expect(document.activeElement).toBe(el('a-total'))
    })
  })

  describe('a name that is a link (WeekGrid card, F9)', () => {
    /** The name as a link, the cell's widget, with a note's button beside it. */
    function linked(): void {
      setup()
      for (const name of ['a', 'b']) {
        const th = el(name)
        th.innerHTML = `<a href="#/item/${name}" data-w data-c="${name}-link">${name}</a><button data-c="${name}-note">note</button>`
      }
      nav!.sync()
    }

    it('takes the name cell’s focus, and Enter on it is the link’s own, in one press', () => {
      linked()
      el('a-0').focus()
      expect(press('Home')).toBe(true)
      expect(document.activeElement).toBe(el('a-link'))
      expect(stops()).toEqual([el('a-link')])
      // The note's button stays out of the Tab order, and Enter doesn't enter the cell.
      expect(el('a-note').getAttribute('tabindex')).toBe('-1')
      expect(press('Enter')).toBe(false)
      expect(document.activeElement).toBe(el('a-link'))
      expect(el('a-note').getAttribute('tabindex')).toBe('-1')
    })

    it('does nothing on Space, as on any link', () => {
      linked()
      el('a-link').focus()
      expect(press(' ')).toBe(true)
      expect(document.activeElement).toBe(el('a-link'))
    })

    it('lets F2 into the cell’s other controls, and Escape back to the link', () => {
      linked()
      el('b-link').focus()
      expect(press('F2')).toBe(true)
      expect(document.activeElement).toBe(el('b-note'))
      expect(el('b-note').hasAttribute('tabindex')).toBe(false)
      expect(press('Escape')).toBe(true)
      expect(document.activeElement).toBe(el('b-link'))
      expect(el('b-note').getAttribute('tabindex')).toBe('-1')
      expect(press('ArrowRight')).toBe(true)
      expect(document.activeElement).toBe(el('b-0'))
    })
  })

  describe('controls inside a cell (Edit plan)', () => {
    it('keeps them out of the Tab order until the cell is entered', () => {
      setup({ edit: true })
      expect(el('a-lower').getAttribute('tabindex')).toBe('-1')
      expect(el('a-input').getAttribute('tabindex')).toBe('-1')
      expect(stops()).toEqual([el('a-2')])
    })

    it('Enter or F2 on the cell lets them in and focuses the first; Escape puts them back', () => {
      setup({ edit: true })
      el('a').focus()
      expect(press('Enter')).toBe(true)
      expect(document.activeElement).toBe(el('a-lower'))
      expect(el('a-lower').hasAttribute('tabindex')).toBe(false)
      expect(el('a-input').hasAttribute('tabindex')).toBe(false)
      // A change to the rows while editing (the goal stepping) leaves them in.
      nav!.sync()
      expect(el('a-lower').hasAttribute('tabindex')).toBe(false)
      // A control that was out of the Tab order stays out.
      expect(el('a-skip').getAttribute('tabindex')).toBe('-1')
      // The cell keeps the tab stop, so Shift+Tab from the first control lands back on it.
      expect(stops()).toEqual([el('a')])
      // Arrows belong to the control (a Stepper's value), not the grid.
      expect(press('ArrowDown')).toBe(false)
      expect(document.activeElement).toBe(el('a-lower'))
      expect(press('Escape')).toBe(true)
      expect(document.activeElement).toBe(el('a'))
      expect(el('a-lower').getAttribute('tabindex')).toBe('-1')
      expect(el('a-skip').getAttribute('tabindex')).toBe('-1')
      el('b').focus()
      expect(press('F2')).toBe(true)
      expect(document.activeElement).toBe(el('b-lower'))
      expect(press('a')).toBe(false)
    })

    it('puts them back when focus leaves the cell, but not when it moves inside it', () => {
      setup({ edit: true })
      el('a').focus()
      press('Enter')
      el('a-input').focus()
      expect(el('a-lower').hasAttribute('tabindex')).toBe(false)
      el('a').focus()
      expect(el('a-lower').hasAttribute('tabindex')).toBe(false)
      el('a-1').focus()
      expect(el('a-lower').getAttribute('tabindex')).toBe('-1')
    })

    it('lets them in when focus reaches one some other way (a click, focus after removal)', () => {
      setup({ edit: true })
      el('a').focus()
      press('Enter')
      el('b-input').focus()
      expect(stops()).toEqual([el('b')])
      expect(el('b-lower').hasAttribute('tabindex')).toBe(false)
      expect(el('a-lower').getAttribute('tabindex')).toBe('-1')
      // Leaving the page entirely puts them back too.
      el('b-input').blur()
      expect(el('b-lower').getAttribute('tabindex')).toBe('-1')
    })

    it('does nothing on Enter in a cell without controls, or Escape outside one', () => {
      setup()
      el('a').focus()
      expect(press('Enter')).toBe(true)
      expect(document.activeElement).toBe(el('a'))
      expect(press('Escape')).toBe(false)
    })
  })

  describe('rows coming and going', () => {
    it('keeps one tab stop as rows are added, and parks their controls', async () => {
      setup()
      el('b-1').focus()
      const added = table.tBodies[0]!.rows[1]!.cloneNode(true) as HTMLTableRowElement
      for (const n of added.querySelectorAll('[data-c]'))
        n.setAttribute('data-c', n.getAttribute('data-c')!.replace('b', 'c'))
      for (const n of added.querySelectorAll('[tabindex]')) n.removeAttribute('tabindex')
      added.cells[0]!.insertAdjacentHTML('beforeend', '<button data-c="c-remove">x</button>')
      table.tBodies[0]!.append(added)
      await observed()
      expect(stops()).toEqual([el('b-1')])
      expect(el('c-1').getAttribute('tabindex')).toBe('-1')
      expect(el('c-total').getAttribute('tabindex')).toBe('-1')
      expect(el('c-remove').getAttribute('tabindex')).toBe('-1')
    })

    it('moves a stop nobody chose to today once rows arrive in an empty grid', async () => {
      setup()
      const body = table.tBodies[0]!
      const rows = [...body.rows]
      for (const r of rows) r.remove()
      await observed()
      expect(stops()).toEqual([el('picked')])
      body.append(...rows)
      await observed()
      expect(stops()).toEqual([el('a-2')])
    })

    it('moves the tab stop back to today when its row goes', async () => {
      setup()
      el('b-1').focus()
      table.tBodies[0]!.rows[1]!.remove()
      await observed()
      expect(stops()).toEqual([el('a-2')])
    })

    it('forgets the cell being edited when its row goes', async () => {
      setup({ edit: true })
      el('b').focus()
      press('Enter')
      table.tBodies[0]!.rows[1]!.remove()
      await observed()
      el('a-input').focus()
      expect(el('a-lower').hasAttribute('tabindex')).toBe(false)
    })
  })

  it('stops listening once destroyed', () => {
    setup()
    nav!.destroy()
    nav = undefined
    el('a-1').focus()
    expect(press('ArrowRight')).toBe(false)
    expect(stops()).toEqual([el('a-2')])
  })
})

describe('useGridNav', () => {
  it('runs the grid while the component is mounted', async () => {
    const Grid = defineComponent({
      setup() {
        const table = ref<HTMLTableElement | null>(null)
        useGridNav(table, { widget: '[data-w]', start: '[aria-current="date"]' })
        return () =>
          h('div', {
            ref: (e) => (table.value = (e as HTMLElement | null)?.querySelector('table') ?? null),
            innerHTML: html(),
          })
      },
    })
    const wrapper = mount(Grid, { attachTo: document.body })
    await nextTick()
    table = wrapper.element.querySelector('table')!
    expect(stops()).toEqual([el('a-2')])
    el('a-2').focus()
    press('ArrowLeft')
    expect(document.activeElement).toBe(el('a-1'))
    wrapper.unmount()
  })
})
