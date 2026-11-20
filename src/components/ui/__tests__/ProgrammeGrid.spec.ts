import { settle } from './setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ProgrammeGrid } from '@/components/ui/programme-grid'
import type { ChangePreview, Grid, Run, StartPreview } from '@/lib/programmes'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import PAUSED_JSON from '@/lib/__tests__/programmes/run-paused.json'
import PREVIEW_JSON from '@/lib/__tests__/programmes/change-preview.json'
import START_JSON from '@/lib/__tests__/programmes/start-preview.json'

const RUN = RUN_JSON as unknown as Run
const PAUSED = PAUSED_JSON as unknown as Run
const PREVIEW = PREVIEW_JSON as unknown as ChangePreview
const START = START_JSON as unknown as StartPreview

type Props = InstanceType<typeof ProgrammeGrid>['$props']

function mountGrid(props: Partial<Props> = {}) {
  return mount(ProgrammeGrid, {
    props: {
      grid: RUN.grid,
      kind: 'strength',
      mode: 'running',
      label: 'The plan, week by week',
      itemHref: (key: string) => `#/item/t1/${key}`,
      ...props,
    } as Props,
    attachTo: document.body,
  })
}

function cell(activity: string, week: number, root: ParentNode = document): HTMLElement {
  const td = root.querySelector<HTMLElement>(`td[data-activity="${activity}"][data-week="${week}"]`)
  if (!td) throw new Error(`no cell for ${activity} in week ${week}`)
  return td
}

function head(week: number): HTMLElement {
  return document.querySelector<HTMLElement>(`thead th[data-week="${week}"]`)!
}

/** A primary-button press, as Reka's menu trigger hears it. */
async function press(target: HTMLElement): Promise<void> {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  target.click()
  await settle()
}

afterEach(() => vi.restoreAllMocks())

describe('ProgrammeGrid, a running programme (K142, K143)', () => {
  it('is a table in a labelled scrolling box, a column per week and a row per activity', () => {
    const wrapper = mountGrid()
    const box = wrapper.get('[data-testid="programme-grid"]')
    expect(box.attributes()).toMatchObject({
      role: 'region',
      tabindex: '0',
      'aria-label': 'The plan, week by week',
    })
    expect(
      wrapper.findAll('thead th[scope="col"][data-week]').map((th) => th.attributes('data-week')),
    ).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(
      wrapper.findAll('tbody tr[data-activity]').map((tr) => tr.attributes('data-activity')),
    ).toEqual(['squat', 'bench', 'row', 'deadlift', 'plank'])
    // The activity column's head is there for a screen reader only.
    expect(wrapper.get('thead th.sticky').text()).toBe('Activity')
  })

  it('heads each week with its number, its dates and its tags', () => {
    mountGrid()
    expect(head(1).textContent).toContain('Week 1')
    expect(head(1).textContent).toContain('19–25 Oct')
    expect(head(4).getAttribute('aria-current')).toBe('date')
    expect(head(4).textContent).toContain('This week')
    expect(head(4).textContent).toContain('Deload')
    expect(head(5).getAttribute('aria-current')).toBeNull()
    // Past weeks sit on a tile; this week is framed in ink.
    expect(head(3).dataset.past).toBe('')
    expect(head(4).dataset.current).toBe('')
    expect(head(5).dataset.past).toBeUndefined()
  })

  it('names each activity, links its page, and shows its sets and goal', () => {
    const wrapper = mountGrid()
    const squat = wrapper.get('tbody tr[data-activity="squat"] th')
    expect(squat.attributes('scope')).toBe('row')
    expect(squat.get('a').attributes('href')).toBe('#/item/t1/squat')
    expect(squat.get('a').text()).toBe('Back squat')
    expect(squat.get('[data-slot="chip"]').text()).toBe('5 × 5')
    expect(squat.text()).toContain('3 a week')
  })

  it('shows how a past week went: met, and not met', () => {
    mountGrid()
    const met = cell('squat', 2)
    expect(met.dataset.cell).toBe('done')
    expect(met.dataset.met).toBe('')
    expect(met.textContent).toContain('3 of 3, goal met')
    expect(met.textContent).toContain('42.5 kg')
    const notMet = cell('bench', 2)
    expect(notMet.dataset.cell).toBe('done')
    expect(notMet.dataset.met).toBeUndefined()
    expect(notMet.textContent).toContain('2 of 3')
    expect(notMet.textContent).not.toContain('goal met')
    // Nothing in a past week can be pressed.
    expect(notMet.querySelector('button')).toBeNull()
  })

  it('shows this week’s value, sets and count so far, and a split week’s two values', () => {
    mountGrid()
    const squat = cell('squat', 4)
    expect(squat.dataset.cell).toBe('current')
    expect(squat.textContent).toContain('42.5 kg')
    expect(squat.textContent).toContain('3 × 5')
    expect(squat.textContent).toContain('0 of 3 so far')
    expect(squat.querySelector('button')).toBeNull()
    const bench = cell('bench', 4)
    expect(bench.dataset.split).toBe('')
    expect(bench.textContent).toContain('35 → 27.5 kg')
    expect(bench.textContent).toContain('from Thu')
  })

  it('marks a hand-edited value with a pencil and words for a screen reader', () => {
    mountGrid()
    const row = cell('row', 5)
    expect(row.dataset.cell).toBe('planned')
    expect(row.dataset.handEdit).toBe('23 Oct')
    expect(row.querySelector('[data-slot="hand-edit"]')!.getAttribute('aria-hidden')).toBe('true')
    expect(row.textContent).toContain('35 kg, set by hand on 23 Oct')
  })

  it('shows a paused week in words with its reason, and a partly paused one’s date', () => {
    mountGrid()
    const paused = cell('deadlift', 5)
    expect(paused.dataset.cell).toBe('paused')
    expect(paused.textContent).toContain('Paused')
    expect(paused.textContent).toContain('Knee')
    expect(paused.querySelector('button')).toBeNull()
    expect(cell('deadlift', 6).textContent).toContain('Paused until Thu 26 Nov')
  })

  it('counts a past week run and then paused against the days it ran, not as Paused (K163)', () => {
    const grid: Grid = structuredClone(RUN.grid)
    // John's squat: 3 a week, done Monday and Tuesday, paused from Wednesday. Its goal is 1.
    const split = {
      ...grid.weeks[1]!.cells.squat!,
      target: 1,
      until: '2026-11-11',
      reason: 'Knee',
      marks: ['great', 'great', null, null, null, null, null],
    }
    grid.weeks[1]!.cells.squat = split
    grid.weeks[2]!.cells.squat = { ...split, marks: [null, null, null, null, null, null, null] }
    mountGrid({ grid })
    const met = cell('squat', 2)
    expect(met.dataset.cell).toBe('done')
    expect(met.dataset.met).toBe('')
    expect(met.textContent).toContain('2 of 1, goal met')
    expect(met.textContent).not.toContain('Paused')
    const missed = cell('squat', 3)
    expect(missed.dataset.cell).toBe('done')
    expect(missed.dataset.met).toBeUndefined()
    expect(missed.textContent).toContain('0 of 1')
    expect(missed.textContent).not.toContain('goal met')
  })

  it('counts this week so far against a split week’s goal, and says until when it is paused', () => {
    mountGrid()
    const deadlift = cell('deadlift', 4)
    expect(deadlift.dataset.cell).toBe('current')
    expect(deadlift.textContent).toContain('0 of 2 so far')
    expect(deadlift.textContent).toContain('Paused until Thu 26 Nov')
  })

  it('draws the Paused until line in paused-ink at 600, and nothing else in the cell (K166)', () => {
    mountGrid()
    // This week's cell (no button) and a later week's (a button): the line looks the same in both.
    for (const week of [4, 6]) {
      const td = cell('deadlift', week)
      const until = td.querySelectorAll<HTMLElement>('[data-testid="paused-until"]')
      expect(until).toHaveLength(1)
      expect(until[0]!.textContent).toBe('Paused until Thu 26 Nov')
      expect(until[0]!.classList).toContain('text-paused-ink')
      expect(until[0]!.classList).toContain('font-semibold')
      expect(until[0]!.classList).not.toContain('text-ink-secondary')
      // The cell's other lines keep their ink-secondary.
      expect(td.innerHTML.match(/text-paused-ink/g)).toHaveLength(1)
    }
  })

  it('makes each later week’s cell a button that opens Edit this week and Change from here', async () => {
    const wrapper = mountGrid()
    const button = cell('squat', 6).querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!
    expect(button.textContent).toContain('50 kg')
    await press(button)
    const items = [...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')]
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Edit this week', 'Change from here'])
    items[0]!.click()
    await settle()
    expect(wrapper.emitted('edit')![0]).toEqual(['squat', RUN.grid.weeks[5]])
    await press(button)
    document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')[1]!.click()
    await settle()
    expect(wrapper.emitted('change')![0]).toEqual(['squat', RUN.grid.weeks[5]])
  })

  it('disables the cells’ buttons offline', () => {
    mountGrid({ disabled: true })
    expect(cell('squat', 6).querySelector('button')!.disabled).toBe(true)
  })

  it('leaves out a week an activity isn’t in', () => {
    const grid: Grid = structuredClone(RUN.grid)
    delete grid.weeks[6]!.cells.plank
    grid.weeks[7]!.cells.plank!.state = 'ended'
    mountGrid({ grid })
    expect(cell('plank', 7).dataset.cell).toBe('none')
    expect(cell('plank', 7).textContent).toContain('Not in this week')
    expect(cell('plank', 8).dataset.cell).toBe('none')
  })
})

describe('ProgrammeGrid, a rest week: a running week planned with a goal of 0 (K170)', () => {
  /** Squat rests in weeks 2 (past), 4 (this week) and 6 (to come), with `marks` in week 2. */
  function restGrid(marks: (string | null)[] = [null, null, null, null, null, null, null]): Grid {
    const grid: Grid = structuredClone(RUN.grid)
    for (const i of [1, 3, 5]) {
      const squat = grid.weeks[i]!.cells.squat!
      squat.target = 0
      squat.values = { ...squat.values!, target: 0 }
    }
    grid.weeks[1]!.cells.squat!.marks = marks
    return grid
  }

  it('says “Rest week” for a past one that ran, with its value, never “Paused” or “0 of 0”', () => {
    mountGrid({ grid: restGrid() })
    const td = cell('squat', 2)
    expect(td.dataset.cell).toBe('rest')
    expect(td.dataset.met).toBeUndefined()
    expect(td.textContent).toBe('Rest week42.5 kg')
    expect(td.textContent).not.toContain('Paused')
    expect(td.textContent).not.toContain('0 of 0')
    expect(td.textContent).not.toContain('done')
    // In the cell value's style, in ink-secondary as a paused cell's "Paused", never underlined.
    const main = td.querySelector<HTMLElement>('[data-slot="cell-main"]')!
    expect(main.textContent).toBe('Rest week')
    expect(main.classList).toContain('font-semibold')
    expect(main.classList).toContain('text-ink-secondary')
    expect(td.innerHTML).not.toContain('decoration-pen')
    expect(td.innerHTML).not.toContain('text-paused-ink')
  })

  it('counts the days marked in a past rest week as “N done”', () => {
    mountGrid({ grid: restGrid(['great', null, null, null, null, null, null]) })
    const td = cell('squat', 2)
    expect(td.dataset.cell).toBe('rest')
    expect(td.textContent).toBe('Rest week42.5 kg1 done')
    expect(td.dataset.met).toBeUndefined()
  })

  it('says “Rest week” this week and later in place of the goal, over the value and sets', () => {
    mountGrid({ grid: restGrid() })
    const now = cell('squat', 4)
    expect(now.dataset.cell).toBe('current')
    expect(now.textContent).toBe('Rest week42.5 kg3 × 5')
    expect(now.textContent).not.toContain('so far')
    const later = cell('squat', 6)
    expect(later.dataset.cell).toBe('planned')
    const button = later.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    expect(button.textContent).toBe('Rest week50 kg5 × 5')
    const main = button.querySelector<HTMLElement>('[data-slot="cell-main"]')!
    expect(main.textContent).toBe('Rest week')
    expect(main.classList).toContain('text-ink-secondary')
    expect(later.textContent).not.toContain('0 a week')
  })

  it('says “Rest week” for an activity planned by its goal alone, never “0 a week”', () => {
    const grid = restGrid()
    for (const i of [1, 5])
      grid.weeks[i]!.cells.plank = {
        ...grid.weeks[i]!.cells.plank!,
        target: 0,
        values: { target: 0 },
      }
    mountGrid({ grid })
    expect(cell('plank', 2).textContent).toBe('Rest week')
    expect(cell('plank', 6).textContent).toBe('Rest week')
  })

  it('still shows a paused week as Paused with its reason, whatever its goal', () => {
    const grid = restGrid()
    grid.weeks[1]!.cells.squat = { ...grid.weeks[1]!.cells.squat!, state: 'paused', reason: 'Knee' }
    mountGrid({ grid })
    const td = cell('squat', 2)
    expect(td.dataset.cell).toBe('paused')
    expect(td.textContent).toBe('PausedKnee')
  })
})

describe('ProgrammeGrid, after an open pause (spec §5)', () => {
  it('says where this week stopped, and shows the weeks to come when resumed, without dates', () => {
    const wrapper = mountGrid({ grid: PAUSED.grid, openPause: true })
    expect(head(4).textContent).toContain('Paused from Thu')
    const resumed = wrapper.findAll('thead th[data-when-resumed]')
    expect(resumed.map((th) => th.attributes('data-week'))).toEqual(['4', '5', '6', '7', '8'])
    expect(resumed.every((th) => th.text().includes('When resumed'))).toBe(true)
    // The calendar's paused weeks give way to them.
    expect(wrapper.findAll('thead th[data-monday="2026-11-16"]')).toHaveLength(0)
    const later = wrapper.get('td[data-when-resumed][data-activity="squat"][data-week="5"]')
    expect(later.text()).toContain('47.5 kg')
    expect(later.find('button').exists()).toBe(false)
  })
})

describe('ProgrammeGrid, a change’s preview (K148)', () => {
  it('shows each changed cell before → after, keeps a blocking hand-edit, and has no buttons', () => {
    const wrapper = mountGrid({
      grid: PREVIEW.grid,
      mode: 'preview',
      changes: PREVIEW.cells,
      label: 'The plan with the change, week by week',
    })
    expect(wrapper.get('[data-testid="programme-grid"]').attributes('aria-label')).toBe(
      'The plan with the change, week by week',
    )
    const changed = cell('row', 6)
    expect(changed.dataset.cell).toBe('changed')
    expect(changed.textContent).toContain('42.5 → 47.5 kg')
    expect(cell('row', 5).dataset.handEdit).toBe('23 Oct')
    expect(cell('squat', 6).dataset.cell).toBe('planned')
    expect(wrapper.findAll('td button')).toHaveLength(0)
  })

  it('words a change of state, and a change to a field the cell doesn’t lead with', () => {
    const grid: Grid = structuredClone(RUN.grid)
    mountGrid({
      grid,
      mode: 'preview',
      changes: [
        {
          monday: '2026-11-23',
          key: 'squat',
          field: null,
          before: 'running',
          after: 'paused',
          starts: '2026-11-23',
          programmeWeek: 6,
        },
        {
          monday: '2026-11-30',
          key: 'squat',
          field: 'sets',
          before: 5,
          after: 4,
          starts: '2026-11-30',
          programmeWeek: 7,
        },
      ],
    })
    expect(cell('squat', 6).dataset.cell).toBe('changed')
    expect(cell('squat', 6).textContent).toContain('Active → Paused')
    expect(cell('squat', 7).textContent).toContain('5 sets → 4 sets')
  })
})

describe('ProgrammeGrid, a start’s preview (spec §9.1)', () => {
  it('shows every week as still to come: no frame, no tile, no buttons, no links', () => {
    const wrapper = mountGrid({
      grid: START.grid,
      mode: 'start',
      itemHref: undefined,
      label: 'Preview',
    })
    expect(wrapper.find('[aria-current="date"]').exists()).toBe(false)
    expect(wrapper.find('[data-past]').exists()).toBe(false)
    expect(wrapper.findAll('td button')).toHaveLength(0)
    expect(wrapper.find('tbody a').exists()).toBe(false)
    expect(
      wrapper.findAll('td[data-cell]').every((td) => td.attributes('data-cell') === 'planned'),
    ).toBe(true)
    expect(cell('squat', 1).textContent).toContain('40 kg')
  })

  it('heads the weeks by number alone when undated: a shared programme’s preview (K173)', () => {
    const dated = mountGrid({ grid: START.grid, mode: 'start' })
    const withDates = head(1).textContent
    dated.unmount()
    mountGrid({ grid: START.grid, mode: 'start', undated: true })
    expect(head(1).textContent).toContain('Week 1')
    expect(withDates).not.toBe(head(1).textContent)
    expect(head(1).textContent).not.toMatch(/\d+–\d+ \w{3}|\d+ \w{3}/)
  })

  it('shows a cardio programme’s time, then its distance', () => {
    const grid: Grid = structuredClone(START.grid)
    grid.activities = [
      { key: 'run', name: 'Run', addedOn: '2026-10-26', addedBy: null, endedOn: null },
    ]
    for (const week of grid.weeks) {
      week.cells = {
        run: { ...week.cells.squat!, values: { target: 3, duration: 1200, distance: 3 } },
      }
    }
    const wrapper = mountGrid({ grid, kind: 'cardio', mode: 'start' })
    expect(cell('run', 1).textContent).toContain('20 min')
    expect(cell('run', 1).textContent).toContain('3 km')
    // A cardio activity has no sets for its chip.
    expect(wrapper.find('tbody [data-slot="chip"]').exists()).toBe(false)
  })
})

describe('ProgrammeGrid on a phone', () => {
  function folded(matches: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  }
  afterEach(() => vi.unstubAllGlobals())

  it('opens on this week, first after the activity column', async () => {
    folded(true)
    const set = vi.spyOn(Element.prototype, 'scrollLeft', 'set')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const left = this.matches('thead [data-current]') ? 600 : 0
      const right = this.matches('thead th.sticky') ? 132 : left + 104
      return { left, right } as DOMRect
    })
    mountGrid()
    await settle()
    expect(set).toHaveBeenLastCalledWith(468)
  })

  it('opens at week 1 on a wide screen', async () => {
    folded(false)
    const set = vi.spyOn(Element.prototype, 'scrollLeft', 'set')
    mountGrid()
    await settle()
    expect(set).not.toHaveBeenCalledWith(expect.any(Number))
  })
})

describe('ProgrammeGrid, its edges', () => {
  it('names a week before the start, and leaves its number off', () => {
    const grid: Grid = structuredClone(START.grid)
    grid.weeks[0]!.programmeWeeks = []
    const wrapper = mountGrid({ grid, mode: 'start' })
    const first = wrapper.findAll('thead th[scope="col"]')[1]!
    expect(first.text()).toContain('Before the start')
    expect(first.attributes('data-week')).toBeUndefined()
  })

  it('takes the chip from a tagged week when every week has a tag, and shows none with no values', () => {
    const grid: Grid = structuredClone(START.grid)
    for (const week of grid.weeks) week.label = 'Deload'
    grid.activities.push({
      key: 'ghost',
      name: 'Ghost',
      addedOn: '2026-10-26',
      addedBy: null,
      endedOn: null,
    })
    const wrapper = mountGrid({ grid, mode: 'start' })
    expect(wrapper.get('tbody tr[data-activity="squat"] [data-slot="chip"]').text()).toBe('5 × 5')
    const ghost = wrapper.get('tbody tr[data-activity="ghost"] th')
    expect(ghost.find('[data-slot="chip"]').exists()).toBe(false)
    expect(ghost.text()).toBe('Ghost')
  })

  it('shows a paused week with no reason, a past split, and a cell planned by its goal alone', () => {
    const grid: Grid = structuredClone(RUN.grid)
    grid.weeks[5]!.cells.squat = { ...grid.weeks[5]!.cells.squat!, state: 'paused', reason: null }
    grid.weeks[2]!.cells.bench!.splits = {
      weight: [
        { from: '2026-11-02', value: 35 },
        { from: '2026-11-04', value: 32.5 },
      ],
    }
    grid.weeks[6]!.cells.plank!.values = { target: 3 }
    mountGrid({ grid })
    expect(cell('squat', 6).dataset.cell).toBe('paused')
    expect(cell('squat', 6).querySelectorAll('span.block')).toHaveLength(0)
    expect(cell('bench', 3).dataset.split).toBe('')
    expect(cell('bench', 3).textContent).toContain('35 → 32.5 kg')
    expect(cell('bench', 3).textContent).toContain('from Wed')
    expect(cell('plank', 7).dataset.cell).toBe('planned')
    expect(cell('plank', 7).textContent).toContain('3 a week')
  })

  it('shows a preview with no changes as the plan', () => {
    mountGrid({ grid: PREVIEW.grid, mode: 'preview' })
    expect(cell('row', 6).dataset.cell).toBe('planned')
  })
})

describe('ProgrammeGrid, a start’s preview on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('opens at week 1: no week is this week yet', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const set = vi.spyOn(Element.prototype, 'scrollLeft', 'set')
    mountGrid({ grid: START.grid, mode: 'start' })
    await settle()
    expect(set).not.toHaveBeenCalled()
  })
})

describe('ProgrammeGrid, a week over an item’s limit in the builder (spec S2)', () => {
  /** The start preview with the cells' `limits` the draft route gives a week over a limit. */
  function overLimit(limits: Record<string, Record<number, Record<string, string>>>): Grid {
    const grid: Grid = structuredClone(START.grid)
    grid.weeks.forEach((week, i) => {
      for (const [key, byWeek] of Object.entries(limits)) {
        const marked = byWeek[i + 1]
        if (marked) week.cells[key] = { ...week.cells[key]!, limits: marked }
      }
    })
    return grid
  }

  it('shows the value in error-ink after circle-alert, with the problem’s path', () => {
    const path = 'activities[3].weight'
    const grid = overLimit({ deadlift: { 6: { weight: path }, 7: { weight: path } } })
    mountGrid({ grid, mode: 'start', undated: true, itemHref: undefined })
    const td = cell('deadlift', 6)
    expect(td.dataset.limit).toBe(path)
    const main = td.querySelector<HTMLElement>('[data-slot="cell-main"]')!
    expect(main.querySelector('[data-slot="limit-mark"]')).not.toBeNull()
    expect(main.querySelector('span.text-error-ink')!.textContent).toContain('kg')
    expect(main.textContent).toContain(', over the limit')
    expect(main.querySelector('.sr-only')!.textContent).toBe(', over the limit')
    // The sets line under it is not over.
    expect(td.querySelectorAll('[data-slot="limit-mark"]')).toHaveLength(1)
    expect(cell('deadlift', 7).dataset.limit).toBe(path)
    expect(cell('deadlift', 5).hasAttribute('data-limit')).toBe(false)
    expect(cell('deadlift', 5).querySelector('[data-slot="limit-mark"]')).toBeNull()
    expect(cell('deadlift', 5).textContent).not.toContain('over the limit')
  })

  it('marks the sets line when the sets or the reps are over', () => {
    const grid = overLimit({
      squat: { 2: { sets: 'activities[0].sets' } },
      bench: { 2: { reps: 'activities[1].reps' } },
    })
    mountGrid({ grid, mode: 'start', undated: true })
    for (const key of ['squat', 'bench']) {
      const td = cell(key, 2)
      const line = td.querySelector<HTMLElement>('[data-slot="limit-line"]')!
      expect(line.textContent).toContain('5 × 5')
      expect(line.textContent).toContain(', over the limit')
      expect(line.className).toContain('text-error-ink')
      expect(td.querySelector('[data-slot="cell-main"] [data-slot="limit-mark"]')).toBeNull()
    }
    expect(cell('squat', 2).dataset.limit).toBe('activities[0].sets')
  })

  it('marks the leading line for a goal-only activity or a field with no line of its own', () => {
    const grid: Grid = structuredClone(START.grid)
    for (const week of grid.weeks) {
      week.cells.squat = { ...week.cells.squat!, values: { target: 3 } }
      week.cells.bench = { ...week.cells.bench!, values: { target: 3, weight: 30 } }
    }
    grid.weeks[0]!.cells.squat!.limits = { target: 'activities[0].target' }
    grid.weeks[0]!.cells.bench!.limits = { target: 'activities[1].target' }
    mountGrid({ grid, mode: 'start', undated: true })
    for (const key of ['squat', 'bench']) {
      const main = cell(key, 1).querySelector('[data-slot="cell-main"]')!
      expect(main.querySelector('[data-slot="limit-mark"]')).not.toBeNull()
    }
  })

  it('marks a cardio session’s distance on its line under the time', () => {
    const grid: Grid = structuredClone(START.grid)
    grid.activities = [
      { key: 'run', name: 'Run', addedOn: '2026-10-26', addedBy: null, endedOn: null },
    ]
    for (const week of grid.weeks) {
      week.cells = {
        run: { ...week.cells.squat!, values: { target: 3, duration: 1200, distance: 3 } },
      }
    }
    grid.weeks[0]!.cells.run!.limits = { distance: 'activities[0].distance' }
    mountGrid({ grid, kind: 'cardio', mode: 'start', undated: true })
    const line = cell('run', 1).querySelector('[data-slot="limit-line"]')!
    expect(line.textContent).toContain('3 km')
  })

  it('leaves the limits out of a dated grid', () => {
    const grid = overLimit({ deadlift: { 6: { weight: 'activities[3].weight' } } })
    mountGrid({ grid, mode: 'start' })
    expect(cell('deadlift', 6).hasAttribute('data-limit')).toBe(false)
    expect(cell('deadlift', 6).querySelector('[data-slot="limit-mark"]')).toBeNull()
  })
})
