/**
 * The planner screen on the design system's marks (W10): the WeekGrid, DayMark, SectionHeader
 * and Chip cards in brand/design-system/project/components/, mounted in the real app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import App from '@/App.vue'
import { emptyState, signedIn } from '@/lib/__tests__/signedIn'
import { usePlannerStore } from '@/stores/planner'
import type { SyncState } from '@/stores/sync'

// Friday 23 October 2026: today is the fifth column; Saturday and Sunday are still to come.
const NOW = new Date(2026, 9, 23, 18, 0)
const WEEK = '2026-10-19'

let wrapper: VueWrapper

function mountApp(cache?: SyncState): VueWrapper {
  signedIn(cache)
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

async function mountConfig(cache?: SyncState): Promise<VueWrapper> {
  mountApp(cache)
  await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
  return wrapper
}

const ex = () => wrapper.get('[data-testid="exercise-grid"]')
const diet = () => wrapper.get('[data-testid="diet-grid"]')
const marks = (name: string) => wrapper.findAll(`button[aria-label^="${name},"]`)

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the planner grids (W10)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('notes on an item (K43)', () => {
    /** Three exercises and a food, their notes in their details (D2), on two weeks' own plans. */
    function withNotes(): SyncState {
      const state = emptyState()
      const exercises = [
        { id: 'pu', name: 'Push-ups', reps: 10, target: 4 },
        { id: 'sq', name: 'Squats', sets: 3, reps: 15, target: 3 },
        { id: 'kh', name: 'Halos', reps: 8, target: 2 },
      ]
      state.exercise.plans = { [WEEK]: exercises, '2026-10-26': exercises }
      state.exercise.details = {
        pu: { notes: 'Slow **down**.\n[Form video](https://example.com/push-ups)' },
        kh: { notes: '<script>alert(1)</script>', fields: { equipment: 'Kettlebell' } },
        sq: { fields: { works: 'Legs' } },
      }
      state.diet.plans = { [WEEK]: [{ id: 'fr', name: 'Fruit', target: 5 }] }
      state.diet.details = { fr: { notes: 'Not juice' } }
      return state
    }
    const row = (name: string) =>
      wrapper
        .findAll('tr[role="row"]')
        .find((r) => r.findAll('[data-testid="item-name"]').some((n) => n.text() === name))!

    it('shows a note on one line under the name and chips, and none where there is none', () => {
      mountApp(withNotes())
      const note = row('Push-ups').get('[data-testid="item-note"]')
      expect(note.element.tagName).toBe('BUTTON')
      expect(note.html()).toContain(
        'Slow <strong>down</strong>. <span class="note-link">Form video</span>',
      )
      expect(note.find('a').exists()).toBe(false)
      expect(row('Squats').find('[data-testid="item-note"]').exists()).toBe(false)
      expect(row('Halos').get('[data-testid="item-note"]').text()).toBe('<script>alert(1)</script>')
      expect(row('Halos').find('script').exists()).toBe(false)
      expect(row('Fruit').get('[data-testid="item-note"]').text()).toBe('Not juice')
    })

    it('shows the same note on every week, a week with its own plan included (F1)', async () => {
      mountApp(withNotes())
      usePlannerStore().nextWeek()
      await nextTick() // the cache, before the server's read answers
      expect(usePlannerStore().weekKey).toBe('2026-10-26')
      expect(row('Push-ups').get('[data-testid="item-note"]').text()).toBe('Slow down. Form video')
      // Fields alone are no note.
      expect(row('Squats').find('[data-testid="item-note"]').exists()).toBe(false)
    })

    it('keeps the grid one tab stop: the note waits behind its cell', () => {
      mountApp(withNotes())
      expect(row('Push-ups').get('[data-testid="item-note"]').attributes('tabindex')).toBe('-1')
    })
  })

  describe('a day that meets the daily pick (K30)', () => {
    /** Monday with `n` exercises marked, against the default pick of three. */
    function mondayWith(n: number): SyncState {
      const state = emptyState()
      const ids = ['pu', 'pl', 'sq', 'be', 'kh'].slice(0, n)
      state.exercise.log = {
        [WEEK]: Object.fromEntries(
          ids.map((id) => [id, ['great', null, null, null, null, null, null]]),
        ),
      }
      return state
    }

    it('turns the day green and underlines it once its marks reach the pick, and says so', () => {
      mountApp(mondayWith(3))
      const monday = ex().findAll('[data-testid="day-head"]')[0]!
      expect(monday.attributes('data-met')).toBe('true')
      expect(monday.text()).toContain('daily goal met')
      // The name alone carries it (K60): in pen, underlined, with no check and no column stroke.
      const name = monday.get('span:not(.sr-only)')
      expect(name.text()).toBe('Mon')
      expect(name.classes()).toEqual(expect.arrayContaining(['text-pen', 'underline']))
      expect(monday.find('svg').exists()).toBe(false)
      expect(ex().find('tbody svg[data-slot="met-underline"]').exists()).toBe(false)
      // The rest of the week, and the Food grid, stay as they are.
      const tuesday = ex().findAll('[data-testid="day-head"]')[1]!
      expect(tuesday.attributes('data-met')).toBeUndefined()
      expect(tuesday.get('span:not(.sr-only)').classes()).not.toContain('underline')
      expect(diet().find('[data-testid="day-head"][data-met]').exists()).toBe(false)
    })

    it('stays plain below the pick, and turns when a press reaches it', async () => {
      mountApp(mondayWith(2))
      const monday = () => ex().findAll('[data-testid="day-head"]')[0]!
      expect(monday().attributes('data-met')).toBeUndefined()
      await marks('Squats')[0]!.trigger('click')
      expect(monday().attributes('data-met')).toBe('true')
    })
  })

  describe('today (F16)', () => {
    it('names today’s marks with the full date and "today", and sets aria-current', () => {
      mountApp()
      const squats = marks('Squats')
      expect(squats[4]!.attributes('aria-label')).toBe('Squats, Friday 23 October, today')
      expect(squats[4]!.attributes('aria-current')).toBe('date')
      expect(squats[0]!.attributes('aria-label')).toBe('Squats, Monday 19 October')
      expect(squats[0]!.attributes('aria-current')).toBeUndefined()
    })

    it('marks today’s column header for a screen reader, with no band on screen (K36)', () => {
      mountApp()
      const heads = ex().findAll('[data-testid="day-head"]')
      expect(heads[4]!.attributes('aria-current')).toBe('date')
      expect(heads[4]!.text()).toBe('Fri 23, today')
      expect(heads[3]!.attributes('aria-current')).toBeUndefined()
      expect(heads[0]!.text()).toBe('Mon 19')
      expect(ex().html()).not.toContain('bg-highlight')
    })

    it('draws each mark in its own pen in the box, and an empty box when not marked', async () => {
      mountApp()
      const mark = marks('Push-ups')[1]!
      const stroke = () => mark.find('[data-slot="day-mark-stroke"]')
      expect(stroke().exists()).toBe(false)
      for (const pen of ['text-pen', 'text-pen-partial', 'text-pen-missed']) {
        await mark.trigger('click')
        expect(mark.attributes('aria-pressed')).toBe('true')
        expect(stroke().classes()).toContain(pen)
      }
      expect(mark.attributes('aria-label')).toBe("Push-ups, Tuesday 20 October, couldn't do it")
      expect(mark.text()).toBe('')
    })
  })

  describe('rows', () => {
    it('shows the chips in the card’s words, and no goal or total on the row (K33)', () => {
      mountApp()
      const row = ex()
        .findAll('[role="rowheader"]')
        .find((r) => r.text().startsWith('Kettlebell halos'))!
      expect(row.findAll('[data-testid="item-detail"]').map((c) => c.text())).toEqual([
        '8 each side',
      ])
      expect(row.text()).not.toContain('a week')
      expect(ex().find('[data-testid="row-total"]').exists()).toBe(false)
    })

    it('puts edit in the row header and remove at the end of the row, as IconButtons (F28)', async () => {
      await mountConfig()
      const edit = ex().get('button[aria-label="Edit Squats"]')
      const remove = ex().get('button[aria-label="Remove Squats"]')
      expect(edit.attributes('data-slot')).toBe('icon-button')
      expect(remove.attributes('data-slot')).toBe('icon-button')
      expect(edit.text()).toBe('')
      const header = edit.element.closest('[role="rowheader"]')!
      expect(header.querySelector('[role="spinbutton"]')).toBeNull()
      const last = header.closest('tr')!.lastElementChild!
      expect(last.getAttribute('role')).toBe('gridcell')
      expect(last.contains(remove.element)).toBe(true)
      expect(last.hasAttribute('data-noprint')).toBe(true)
      // Its column has a header for screen readers.
      const heads = ex().findAll('thead th')
      expect(heads.at(-1)!.text()).toBe('Remove')
      // Foods are the same: edit after the name, remove at the end.
      const food = diet().get('button[aria-label="Remove Fish"]').element.closest('tr')!
      expect(food.lastElementChild!.contains(food.querySelector('[data-action="remove"]'))).toBe(
        true,
      )
      expect(food.querySelector('[role="rowheader"] button[aria-label="Edit Fish"]')).not.toBeNull()
    })

    it('drops the Remove column outside Edit plan', async () => {
      await mountConfig()
      await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
      expect(ex().findAll('thead th').at(-1)!.text()).toBe('Sun 25')
      expect(ex().find('button[aria-label^="Remove"]').exists()).toBe(false)
    })

    it('holds the row header at an IconButton’s height in both modes, so rows keep their height (F25)', async () => {
      await mountConfig()
      const block = () => ex().findAll('[role="rowheader"]')[0]!.get('div')
      expect(block().classes()).toContain('min-h-11')
      await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
      expect(block().classes()).toContain('min-h-11')
    })

    /** Press a row's Remove, then answer the ConfirmDialog with `answer`. */
    async function removeRow(grid: ReturnType<typeof ex>, name: string, answer: string) {
      await grid.get(`button[aria-label="Remove ${name}"]`).trigger('click')
      await settle()
      const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="alertdialog"]')!)
      await dialog
        .findAll('button')
        .find((b) => b.text() === answer)!
        .trigger('click')
      await settle()
      await flushPromises()
    }
    const focused = () => document.activeElement?.getAttribute('aria-label')

    it('moves focus to the next row’s Remove after a removal, not to the page', async () => {
      await mountConfig()
      await removeRow(ex(), 'Squats', 'Cancel')
      expect(focused()).toBe('Remove Squats')
      await removeRow(ex(), 'Squats', 'Remove')
      expect(marks('Squats')).toHaveLength(0)
      expect(focused()).toBe('Remove Back extensions')
      // Focus put back on a control lets its cell's controls into the Tab order (gridNav); the
      // name cell's Edit, a cell of its own, stays parked.
      expect(document.activeElement!.getAttribute('tabindex')).toBeNull()
      expect(ex().get('button[aria-label="Edit Back extensions"]').attributes('tabindex')).toBe(
        '-1',
      )
      expect(ex().get('button[aria-label="Remove Pull-ups"]').attributes('tabindex')).toBe('-1')
    })

    it('falls back to the previous row, then to the Add button, as rows run out', async () => {
      await mountConfig()
      await removeRow(diet(), 'Nuts', 'Remove')
      expect(focused()).toBe('Remove Fish')
      for (const name of ['Fish', 'Fruit', 'Vegetables']) await removeRow(diet(), name, 'Remove')
      expect(document.activeElement?.getAttribute('data-testid')).toBe('add-food')
    })
  })

  describe('keyboard (F15, W11)', () => {
    /** What Tab stops on, in page order (jsdom has no layout, so visibility isn't checked). */
    function tabStops(): HTMLElement[] {
      return [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]',
        ),
      ].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled'))
    }
    const name = (el: Element | null) =>
      el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? null
    const focused = () => document.activeElement as HTMLElement
    async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
      focused().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
      await flushPromises()
    }

    it('makes each grid a WAI-ARIA grid with one tab stop, on today’s cell in the first row', () => {
      mountApp()
      const grids: [ReturnType<typeof ex>, string][] = [
        [ex(), 'Push-ups, Friday 23 October, today'],
        [diet(), 'Vegetables, Friday 23 October, today'],
      ]
      for (const [grid, today] of grids) {
        expect(grid.element.matches('table[role="grid"]')).toBe(true)
        expect(grid.findAll('[role="gridcell"]').length).toBeGreaterThan(0)
        expect(grid.find('[role="cell"]').exists()).toBe(false)
        const stops = tabStops().filter((el) => grid.element.contains(el))
        expect(stops.map(name)).toEqual([today])
      }
    })

    it('stops on the skip link, Edit plan, the Header, then each grid once, with the arrows between', () => {
      mountApp()
      expect(tabStops().map(name)).toEqual([
        'Skip to today',
        // Out of sight until it has focus (K82): the keyboard's way to Edit plan.
        'Edit plan',
        'Previous week',
        'Next week',
        'Settings',
        'Print…',
        'Push-ups, Friday 23 October, today',
        // The PlannerScreen's arrows between the screens (K42); the handle is for a finger only.
        // Cardio's grid, empty until something is planned (K90), has no stop of its own.
        'Go to Cardio',
        'Back to Exercises',
        'Go to Food',
        'Back to Cardio',
        'Vegetables, Friday 23 October, today',
      ])
    })

    it('moves by arrow keys cell by cell, and Home and End along the row', async () => {
      mountApp()
      ;(marks('Push-ups')[4]!.element as HTMLElement).focus()
      await press('ArrowRight')
      expect(name(focused())).toBe('Push-ups, Saturday 24 October')
      await press('ArrowDown')
      expect(name(focused())).toBe('Pull-ups, Saturday 24 October')
      await press('End')
      expect(name(focused())).toBe('Pull-ups, Sunday 25 October')
      await press('Home')
      // A name cell's focus is its name's link (WeekGrid card).
      expect(focused().getAttribute('data-slot')).toBe('item-link')
      expect(focused().textContent).toBe('Pull-ups')
      // The tab stop follows, so Tab comes back to the last cell used.
      expect(tabStops().filter((el) => ex().element.contains(el))).toEqual([focused()])
      await press('End', { ctrlKey: true })
      // The last cell of the grid: the last row's Sunday.
      expect(name(focused())).toMatch(/, Sunday 25 October$/)
    })

    it('toggles a day on Space or Enter only through its DayMark, as a button', async () => {
      mountApp()
      const mark = marks('Squats')[4]!
      ;(mark.element as HTMLElement).focus()
      await press('ArrowRight')
      await press('ArrowLeft')
      expect(focused()).toBe(mark.element)
      await mark.trigger('click')
      expect(mark.attributes('aria-pressed')).toBe('true')
    })

    it('has a "Skip to today" link first, which focuses today’s exercise cell', async () => {
      mountApp()
      const skip = wrapper.get('a[data-testid="skip-to-today"]')
      expect(skip.text()).toBe('Skip to today')
      expect(skip.classes()).toContain('sr-only')
      await skip.trigger('click')
      expect(name(focused())).toBe('Push-ups, Friday 23 October, today')
    })

    it('skips to the Food grid when there are no exercises', async () => {
      const state = emptyState()
      state.exercise.plans = { [WEEK]: [] }
      mountApp(state)
      await wrapper.get('a[data-testid="skip-to-today"]').trigger('click')
      expect(name(focused())).toBe('Vegetables, Friday 23 October, today')
    })

    it('skips to the first day in another week, and to the grid when it has no rows', async () => {
      // This week has nothing planned; the week before falls back to the default plan.
      const state = emptyState()
      state.exercise.plans = { [WEEK]: [] }
      state.diet.plans = { [WEEK]: [] }
      mountApp(state)
      const skip = wrapper.get('a[data-testid="skip-to-today"]')
      await skip.trigger('click')
      // A week with no rows has no cell to land on, so focus stays where it was.
      expect(document.activeElement).toBe(document.body)
      await wrapper.get('button[aria-label="Previous week"]').trigger('click')
      await flushPromises()
      await skip.trigger('click')
      expect(name(focused())).toBe('Push-ups, Monday 12 October')
    })

    it('keeps one stop per grid in Edit plan; F2 on a name reaches its controls', async () => {
      await mountConfig()
      expect(tabStops().filter((el) => ex().element.contains(el))).toHaveLength(1)
      ;(marks('Squats')[0]!.element as HTMLElement).focus()
      await press('Home')
      const link = focused()
      expect(link.getAttribute('data-slot')).toBe('item-link')
      // Enter on the name is its link's (it opens the item's page, F9); F2 lets the controls in.
      await press('F2')
      expect(name(focused())).toBe('Edit Squats')
      const header = focused().closest('th')!
      // The name's link keeps the tab stop (Shift+Tab returns to it), then its controls in order.
      const inHeader = tabStops().filter((el) => header.contains(el))
      expect(inHeader[0]).toBe(link)
      expect(inHeader.slice(1).map((el) => el.getAttribute('aria-label'))).toEqual(['Edit Squats'])
      await press('Escape')
      expect(focused()).toBe(link)
      expect(tabStops().filter((el) => ex().element.contains(el))).toEqual([link])
      // End reaches the row's Remove cell; Enter there reaches its button.
      await press('End')
      const cell = focused()
      expect(cell.tagName).toBe('TD')
      await press('Enter')
      expect(name(focused())).toBe('Remove Squats')
      await press('Escape')
      expect(focused()).toBe(cell)
    })
  })

  describe('headings and print (F20, F24)', () => {
    it('heads the page with the week as the Header writes it', () => {
      mountApp()
      expect(wrapper.get('h1').text()).toBe('19–25 October')
    })

    it('gives each section an h2 and no hint line', () => {
      mountApp()
      const sections = wrapper.findAll('section[aria-labelledby]')
      expect(sections.map((s) => s.get('h2').text())).toEqual(['Exercises', 'Cardio', 'Food'])
      expect(wrapper.find('[data-slot="section-hint"]').exists()).toBe(false)
    })

    it('keeps the Cardio heading with its grid on paper, apart from Exercises (K90)', () => {
      mountApp()
      const header = wrapper.get('#cardio-heading').element.closest('[data-slot="section-header"]')!
      expect(header.classList).toContain('print:break-after-avoid')
      const grid = wrapper.get('[data-testid="cardio-grid"]').element
      const block = grid.closest('[data-print-keep]')!
      expect(block.contains(header)).toBe(true)
      expect(block.classList).toContain('print:break-inside-avoid')
      // On paper a rule and some space set it apart, as Food's (F20).
      expect(block.closest('section')!.classList).toContain('print:mt-4')
    })

    it('keeps the Food heading with its grid on paper', () => {
      mountApp()
      const header = wrapper.get('#diet-heading').element.closest('[data-slot="section-header"]')!
      expect(header.classList).toContain('print:break-after-avoid')
      const block = diet().element.closest('[data-print-keep]')!
      expect(block.contains(header)).toBe(true)
      expect(block.classList).toContain('print:break-inside-avoid')
    })
  })
})
