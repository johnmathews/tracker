import { settle } from '@/components/ui/__tests__/setup'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ProgrammeGridSection from '../sections/ProgrammeGridSection.vue'
import ChangeSheetSection from '../sections/ChangeSheetSection.vue'
import ProgrammeChartSection from '../sections/ProgrammeChartSection.vue'
import WeekGridSection from '../sections/WeekGridSection.vue'
import WorkChartSection from '../sections/WorkChartSection.vue'
import { exampleServer, previewChange } from '../sections/programmeExamples'

/** The sections of the programme primitives (#84): each card state, captioned, under its id. */

/** The states' captions (StateExample); the answer lines under them carry an id. */
const captions = (root: ParentNode) =>
  [...root.querySelectorAll('p.caption:not([id])')].map((p) => p.textContent ?? '')

function cell(root: ParentNode, activity: string, week: number): HTMLElement {
  return root.querySelector<HTMLElement>(`td[data-activity="${activity}"][data-week="${week}"]`)!
}

describe('ProgrammeGridSection', () => {
  it('draws the running overview with every cell state the card shows', () => {
    const wrapper = mount(ProgrammeGridSection, { attachTo: document.body })
    const grid = wrapper.get('#sg-programme-grid-overview-running').element
    expect(grid.getAttribute('aria-label')).toBe('The plan, week by week')
    // Past weeks: met and not met, and a split week.
    expect(cell(grid, 'squat', 1).dataset.cell).toBe('done')
    expect(cell(grid, 'squat', 1).textContent).toContain('3 of 3, goal met')
    expect(cell(grid, 'deadlift', 2).textContent).toContain('2 of 3')
    expect(cell(grid, 'deadlift', 2).hasAttribute('data-met')).toBe(false)
    expect(cell(grid, 'bench', 3).hasAttribute('data-split')).toBe(true)
    expect(cell(grid, 'bench', 3).textContent).toContain('35 → 32.5 kg')
    expect(cell(grid, 'bench', 3).textContent).toContain('from Wed')
    // This week, framed, a deload; a paused activity; a later week's button; a hand-edit.
    const head = grid.querySelector('thead th[data-week="4"]')!
    expect(head.getAttribute('aria-current')).toBe('date')
    expect(head.textContent).toContain('14–20 Dec')
    expect(head.textContent).toContain('This week')
    expect(head.textContent).toContain('Deload')
    expect(cell(grid, 'squat', 4).textContent).toContain('1 of 3 so far')
    expect(cell(grid, 'deadlift', 4).dataset.cell).toBe('paused')
    expect(cell(grid, 'deadlift', 4).textContent).toContain('Knee')
    expect(cell(grid, 'squat', 5).querySelector('button[aria-haspopup="menu"]')).not.toBeNull()
    expect(cell(grid, 'row', 6).dataset.handEdit).toBe('12 Dec')
  })

  it('draws the open pause and the change preview, each region named apart', () => {
    const wrapper = mount(ProgrammeGridSection, { attachTo: document.body })
    const paused = wrapper.get('#sg-programme-grid-overview-open-pause').element
    expect(paused.querySelector('thead [data-current]')!.textContent).toContain('Paused from Wed')
    const resumed = [...paused.querySelectorAll('thead th[data-when-resumed]')]
    expect(resumed.map((th) => th.getAttribute('data-week'))).toEqual(['5', '6', '7', '8'])
    expect(resumed.every((th) => th.textContent!.includes('When resumed'))).toBe(true)

    const preview = wrapper.get('#sg-programme-grid-preview-changed').element
    expect(cell(preview, 'row', 5).dataset.cell).toBe('changed')
    expect(cell(preview, 'row', 5).textContent).toContain('40 → 45 kg')
    expect(cell(preview, 'row', 6).dataset.handEdit).toBe('12 Dec')
    expect(preview.querySelector('button[aria-haspopup="menu"]')).toBeNull()

    const labels = wrapper.findAll('[role="region"]').map((r) => r.attributes('aria-label'))
    expect(new Set(labels).size).toBe(6)
    expect(captions(wrapper.element)).toHaveLength(6)
  })

  it('draws rest weeks as “Rest week”, past and to come, and a real pause as Paused (K170)', () => {
    const wrapper = mount(ProgrammeGridSection, { attachTo: document.body })
    const grid = wrapper.get('#sg-programme-grid-overview-rest').element
    expect(cell(grid, 'squat', 2).dataset.cell).toBe('rest')
    expect(cell(grid, 'squat', 2).textContent).toBe('Rest week42.5 kg')
    expect(cell(grid, 'bench', 3).dataset.cell).toBe('rest')
    expect(cell(grid, 'bench', 3).textContent).toBe('Rest week35 kg1 done')
    const later = cell(grid, 'squat', 6)
    expect(later.hasAttribute('data-rest')).toBe(true)
    expect(later.querySelector('button[aria-haspopup="menu"]')!.textContent).toBe(
      'Rest week57.5 kg5 × 5',
    )
    expect(cell(grid, 'deadlift', 5).dataset.cell).toBe('paused')
  })

  it('draws a pause that ends mid-week, its Paused until line in paused-ink (K166)', () => {
    const wrapper = mount(ProgrammeGridSection, { attachTo: document.body })
    const grid = wrapper.get('#sg-programme-grid-overview-part-pause').element
    expect(cell(grid, 'deadlift', 4).dataset.cell).toBe('current')
    expect(cell(grid, 'deadlift', 4).textContent).toContain('1 of 1 so far')
    expect(cell(grid, 'deadlift', 5).dataset.cell).toBe('paused')
    expect(cell(grid, 'deadlift', 6).querySelector('button[aria-haspopup="menu"]')).not.toBeNull()
    const lines = [...grid.querySelectorAll<HTMLElement>('[data-testid="paused-until"]')]
    expect(lines.map((l) => l.closest('td')!.dataset.week)).toEqual(['4', '6'])
    for (const line of lines) {
      expect(line.textContent).toBe('Paused until Wed 30 Dec')
      expect(line.classList).toContain('text-paused-ink')
      expect(line.classList).toContain('font-semibold')
    }
  })
})

describe('ProgrammeChartSection', () => {
  it('draws Back squat with its change, and Deadlift with its pause', () => {
    const wrapper = mount(ProgrammeChartSection, { attachTo: document.body })
    const squat = wrapper.get('#sg-programme-chart-squat-running')
    expect(squat.get('[data-testid="programme-chart"]').attributes('aria-label')).toBe(
      'Back squat: planned weight for each week, with the weeks done so far',
    )
    expect(squat.get('text[data-change]').text()).toBe('7.5% a week, from 3 Dec')
    expect(squat.find('[data-band]').exists()).toBe(true)
    const deadlift = wrapper.get('#sg-programme-chart-deadlift-paused')
    const pause = deadlift.findAll('text[data-pause]').map((t) => t.text())
    // jsdom has no layout, so the chart draws at its least width, where the gap is too narrow for
    // its words; the dashed lines at its ends are there at every width.
    expect(deadlift.findAll('line[data-pause]')).toHaveLength(2)
    expect(pause.every((t) => ['Paused', 'Knee'].includes(t))).toBe(true)
    expect(deadlift.get('text[data-count]').text()).toBe('2 of 3')
    expect(captions(wrapper.element)).toHaveLength(3)
  })

  it('puts the lede over each chart, a pause leading in paused-ink at 600 (K169)', () => {
    const wrapper = mount(ProgrammeChartSection, { attachTo: document.body })
    const squat = wrapper.get('#sg-programme-chart-squat-running p')
    expect(squat.text()).toBe('This week is a deload: 45 kg, 3 × 5. It goes up 7.5% a week.')
    expect(squat.find('[data-testid="programme-lede-lead"]').exists()).toBe(false)
    const ledes = [
      [
        '#sg-programme-chart-deadlift-paused p',
        'Paused until Mon 28 Dec.',
        ' Knee. It comes back at 75 kg.',
      ],
      [
        '#sg-programme-chart-lede-open',
        'Paused.',
        ' Knee. It comes back at 75 kg when you resume it.',
      ],
    ]
    for (const [at, lead, rest] of ledes) {
      const lede = wrapper.get(at!)
      expect(lede.text()).toBe(`${lead}${rest}`)
      const red = lede.get('[data-testid="programme-lede-lead"]')
      expect(red.text()).toBe(lead)
      expect(red.classes()).toEqual(expect.arrayContaining(['text-paused-ink', 'font-semibold']))
    }
  })
})

describe('ChangeSheetSection', () => {
  async function press(el: HTMLElement | null): Promise<void> {
    el!.click()
    await settle()
  }
  const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)

  async function typeValue(value: string): Promise<void> {
    const input = q('change-value') as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  }

  it('opens the card’s sheet from its trigger, and walks its states', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const wrapper = mount(ChangeSheetSection, { attachTo: document.body })
      expect(wrapper.get('#sg-change-sheet-offline-disabled').attributes()).toHaveProperty(
        'disabled',
      )
      expect(q('change-sheet')).toBeNull()
      await press(wrapper.get('#sg-change-sheet-change-open').element as HTMLElement)
      expect(q('change-sheet')!.dataset.step).toBe('1')
      expect(document.body.textContent).toContain('Week 5 is 40 kg now.')
      expect(document.body.textContent).toContain('Today, Wed 16 Dec, or any later day.')

      // A field the server refuses: the error on step 1.
      await press(q('change-preview-button'))
      expect(q('change-preview-button')!.getAttribute('aria-busy')).toBe('true')
      await vi.advanceTimersByTimeAsync(1000)
      await settle()
      expect(document.body.textContent).toContain('Give a number above 0 and at most 500.')

      // Step 2: week 6's hand-edit kept, then dropped.
      await typeValue('45')
      await press(q('change-preview-button'))
      await vi.advanceTimersByTimeAsync(1000)
      await settle()
      expect(q('change-sheet')!.dataset.step).toBe('2')
      expect(q('change-summary')!.textContent).toContain(
        'Weight 45 kg from Mon 21 Dec, from then on.',
      )
      const weeks = () =>
        [...document.querySelectorAll('[data-testid="change-preview-week"]')].map(
          (li) => (li as HTMLElement).dataset.week,
        )
      expect(weeks()).toEqual(['5', '7', '8'])
      expect(q('change-hand-edit')!.textContent).toContain('Week 6 keeps the 35 kg set on 12 Dec.')
      await press(q('change-drop-hand-edit'))
      await vi.advanceTimersByTimeAsync(1000)
      await settle()
      expect(weeks()).toEqual(['5', '6', '7', '8'])
      expect(q('change-hand-edit')!.textContent).toContain(
        'The 35 kg set by hand on 12 Dec goes too.',
      )
      expect(q('change-unchanged')!.textContent).toContain('Nothing before Mon 21 Dec changes.')

      await press(q('change-confirm'))
      await vi.advanceTimersByTimeAsync(1000)
      await settle()
      expect(wrapper.get('#sg-change-sheet-answer').text()).toContain('Confirm change')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the example server', () => {
  const setRow = (value: unknown, extra: Record<string, unknown> = {}) => ({
    change: { type: 'set-value' as const, activity: 'row', field: 'weight', value, ...extra },
    from: '2026-12-21',
  })

  it('previews the card’s change: 40 → 45 kg, and on by the row’s rule', () => {
    const res = previewChange(setRow(45))
    expect(res.ok && res.data.cells.map((c) => [c.programmeWeek, c.before, c.after])).toEqual([
      [5, 40, 45],
      [7, 45, 50],
      [8, 42.5, 47.5],
    ])
  })

  it('lists one week for That week only, with no hand-edit line', () => {
    const res = previewChange({
      change: { type: 'edit-week', activity: 'row', week: 5, field: 'weight', value: 45 },
      from: '2026-12-21',
    })
    expect(res.ok && [res.data.cells.length, res.data.blocking.length]).toEqual([1, 0])
  })

  it('refuses as the server does, and says what it does not preview', () => {
    const step = previewChange(setRow(44))
    expect(!step.ok && 'problems' in step && step.problems[0]!.message).toBe(
      'the weight goes in steps of 2.5, so give a multiple of 2.5.',
    )
    const early = previewChange({ ...setRow(45), from: '2026-12-14' })
    expect(!early.ok && 'problems' in early && early.problems[0]!.path).toBe('from')
    const other = previewChange({ change: { type: 'end-activity', activity: 'row' }, from: '' })
    expect(!other.ok && 'message' in other && other.message).toContain('Set weight only')
  })

  it('finds the plan changed on the first confirm when asked to, then applies', async () => {
    const server = exampleServer({ staleOnce: true })
    expect('stale' in (await server.confirm(setRow(45)))).toBe(true)
    expect((await server.confirm(setRow(45))).ok).toBe(true)
  })
})

describe('WeekGridSection, a programme tracker’s week', () => {
  it('reads a paused row in place of its boxes, “Paused until …” in paused-ink at 600 (K169)', () => {
    const wrapper = mount(WeekGridSection, { attachTo: document.body })
    const week = wrapper.get('#sg-week-grid-programme-paused')
    const row = week.get('[data-testid="paused-row"]')
    expect(row.element.textContent!.trim()).toBe('Paused until Mon 28 Dec. Knee.')
    expect(row.classes()).toContain('text-ink-secondary')
    const lead = row.get('[data-testid="paused-lead"]')
    expect(lead.text()).toBe('Paused until Mon 28 Dec.')
    expect(lead.classes()).toEqual(expect.arrayContaining(['text-paused-ink', 'font-semibold']))
    // Bench press keeps its seven boxes.
    expect(week.findAll('[data-slot="day-mark-button"]')).toHaveLength(7)
    wrapper.unmount()
  })
})

describe('WorkChartSection', () => {
  it('draws the whole programme, an activity without weight, and a long programme that scrolls', () => {
    const wrapper = mount(WorkChartSection, { attachTo: document.body })
    const total = wrapper.get('#sg-work-chart-total-running')
    expect(total.text()).toContain('Week 4: 2,400 kg of 5,650 kg planned. 29,775 kg done so far.')
    expect(total.findAll('rect[data-planned]')).toHaveLength(8)
    expect(total.findAll('rect[data-future]')).toHaveLength(4)
    expect(total.get('text[data-current]').text()).toBe('4')
    const plank = wrapper.get('#sg-work-chart-activity-seconds')
    expect(plank.text()).toContain('Week 4: 105 s of 315 s planned.')
    expect(plank.get('[data-testid="work-chart"]').attributes('height')).toBe('200')
    // Week 1 plans no plank: no column.
    expect(plank.findAll('rect[data-planned]')).toHaveLength(7)
    const long = wrapper.get('#sg-work-chart-long-scrolling')
    expect(long.get('[data-testid="work-chart-plot"]').attributes('data-scroll')).toBeDefined()
    expect(long.findAll('rect[data-planned]')).toHaveLength(104)
    expect(long.get('text[data-current]').text()).toBe('40')
    expect(captions(wrapper.element)).toHaveLength(3)
  })
})
