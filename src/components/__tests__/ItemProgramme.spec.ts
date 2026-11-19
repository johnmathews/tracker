/**
 * An activity's item page (ProgrammeChart card, K145, spec §9.4): the Programme row in place of
 * the week's plan, with the lede, the step chart and the activity's controls, each through the
 * ChangeSheet and previewing first. The rest of the page is ItemPage's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import type { ChangePreview, Run, Work } from '@/lib/programmes'
import type { Tracker } from '@/lib/trackers'
import { USER, emptySection, emptyState, signedIn } from '@/lib/__tests__/signedIn'
import { withProgrammes, type Call, type Route } from './programmesApi'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import PREVIEW_JSON from '@/lib/__tests__/programmes/change-preview.json'
import WORK_JSON from '@/lib/__tests__/programmes/work.json'

const RUN = RUN_JSON as unknown as Run
const PREVIEW = PREVIEW_JSON as unknown as ChangePreview
const AFTER: Run = { ...RUN, rev: 'after', grid: PREVIEW.grid }
/** The run as a server with work charts sends it (K179, work-charts spec §3). */
const WORKED: Run = { ...RUN, work: WORK_JSON as unknown as Work }
const NOW = new Date(2026, 10, 12, 9, 0)
const WEEK = '2026-11-09'
const PROGRAMME: Tracker = {
  id: 't1',
  name: 'Beginner 5×5',
  kind: 'strength',
  position: 3,
  dailyTarget: 2,
  startWeek: '2026-10-19',
  endWeek: '2026-12-14',
  rev: 1,
}
const SUMMARY = {
  programmeId: RUN.programmeId,
  name: 'Beginner 5×5',
  status: 'running',
  week: 4,
  weeks: 8,
  start: RUN.start,
  end: RUN.end,
  pausedUntil: null,
  pausedSince: null,
  pauseReason: null,
  rev: RUN.rev,
}

let wrapper: VueWrapper
let calls: Call[]
let routes: Record<string, Route>
let extra: { today?: string; runs: Record<string, unknown> }

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Alice on the page of `item` in the programme tracker t1, the server answering from `table`. */
async function openItem(item = 'row', table: Record<string, Route> = {}): Promise<void> {
  history.replaceState(null, '', `/#/item/t1/${item}`)
  const week = RUN.grid.weeks.find((w) => w.monday === WEEK)!
  const items = RUN.grid.activities.map((a) => ({
    id: a.key,
    name: a.name,
    ...week.cells[a.key]!.values,
    target: week.cells[a.key]!.target,
  }))
  const cache = emptyState()
  cache.trackers.push({ ...PROGRAMME })
  cache.sections.t1 = { ...emptySection(), plans: { [WEEK]: items }, revs: { [WEEK]: 1 } }
  const api = signedIn(cache)
  api.accounts.get(USER)!.trackers.push({ ...PROGRAMME })
  api.accounts.get(USER)!.plans.t1 = { [WEEK]: { items, rev: 1 } }
  ;({ calls, routes, extra } = withProgrammes(
    api,
    {
      'GET /runs/t1': { body: RUN },
      // A change applied moves the run's rev on, as the state then lists it.
      'POST /runs/t1/changes': (body) => {
        if ((body as { preview?: boolean }).preview !== false) return { body: PREVIEW }
        extra.runs.t1 = { ...SUMMARY, rev: AFTER.rev }
        return { body: { preview: false, change: {}, run: AFTER } }
      },
      ...table,
    },
    { today: RUN.today, runs: { t1: SUMMARY } },
  ))
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
}

const page = () => wrapper.get('[data-testid="item-page"]')
const byTestId = (id: string) => page().get(`[data-testid="${id}"]`)
const inDoc = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const changeCalls = () => calls.filter((c) => c.path === '/runs/t1/changes')
const controls = () =>
  byTestId('activity-controls')
    .findAll('button')
    .map((b) => b.text())
const tableRow = (n: number) => byTestId('programme-chart-table').findAll('tbody tr')[n - 1]!.text()

async function click(el: HTMLElement | null): Promise<void> {
  el!.click()
  await settle()
}

async function type(id: string, value: string): Promise<void> {
  const input = inDoc(id) as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('the Programme row (K145)', () => {
  it('takes the week’s plan’s place, first; the rest of the page is ItemPage’s', async () => {
    await openItem()
    const rows = page()
      .findAll('section')
      .map((s) => s.attributes('data-testid'))
    expect(rows).toEqual(['programme-section', 'item-notes', 'item-details', 'item-weeks'])
    expect(byTestId('programme-section').get('h2').text()).toBe('Programme')
    // Its plan is the programme's: no plan fields, no rename and no Remove (spec §9.5).
    expect(page().find('[data-testid="item-rename"]').exists()).toBe(false)
    expect(page().find('[data-testid="item-remove"]').exists()).toBe(false)
  })

  it('says this week’s plan and how it goes up, the value in ink', async () => {
    await openItem()
    const lede = byTestId('programme-lede')
    expect(lede.text()).toBe('This week is a deload: 35 kg, 3 × 5. It goes up 2.5 kg a week.')
    expect(lede.get('b').text()).toBe('35 kg')
    expect(lede.find('[data-testid="programme-lede-lead"]').exists()).toBe(false)
  })

  it('draws the step chart from the run’s grid, with its legend and its table', async () => {
    await openItem()
    expect(byTestId('programme-chart').attributes('aria-label')).toBe(
      'Barbell row: planned weight for each week, with the weeks done so far',
    )
    expect(page().find('[data-testid="programme-chart-legend"]').exists()).toBe(true)
    expect(tableRow(6)).toContain('42.5 kg')
    expect(calls.filter((c) => c.path === '/runs/t1')).toHaveLength(1)
  })

  it('has the activity’s controls, named for its field', async () => {
    await openItem()
    expect(controls()).toEqual(['Set weight', 'Set increase', 'Pause activity', 'End activity'])
    wrapper.unmount()
    await openItem('plank')
    expect(byTestId('activity-set-value').text()).toBe('Set time')
  })

  it('offers Resume while paused, and says when the activity ends short', async () => {
    await openItem('deadlift')
    expect(controls()).toEqual(['Set weight', 'Set increase', 'Resume activity', 'End activity'])
    expect(byTestId('activity-ends-short').text()).toBe('Deadlift ends at its week 7 of 8.')
    // K169: "Paused until …" leads in paused-ink at 600; the rest stays ink-secondary at 400.
    const lede = byTestId('programme-lede')
    expect(lede.text()).toBe('Paused until Thu 26 Nov. Knee. It comes back at 80 kg.')
    expect(lede.classes()).toContain('text-ink-secondary')
    const lead = lede.get('[data-testid="programme-lede-lead"]')
    expect(lead.text()).toBe('Paused until Thu 26 Nov.')
    expect(lead.classes()).toEqual(expect.arrayContaining(['text-paused-ink', 'font-semibold']))
    expect(lede.findAll('.text-paused-ink')).toHaveLength(1)
    expect(lede.get('b').text()).toBe('80 kg')
  })

  it('has no controls once the run has ended', async () => {
    await openItem('row', { 'GET /runs/t1': { body: { ...RUN, status: 'ended' } } })
    expect(page().find('[data-testid="activity-controls"]').exists()).toBe(false)
    // K168: the end by its last day, as the overview says it; nothing in paused-ink.
    expect(byTestId('programme-lede').text()).toBe('Ended Sun 13 Dec.')
    expect(page().find('[data-testid="programme-lede-lead"]').exists()).toBe(false)
  })

  it('says why the run couldn’t load', async () => {
    await openItem('row', { 'GET /runs/t1': 'offline' })
    expect(byTestId('programme-error').text()).toBe(
      'Can’t reach the server, so the programme couldn’t load. Try again when you’re online.',
    )
    expect(page().find('[data-testid="programme-chart"]').exists()).toBe(false)
    wrapper.unmount()
    await openItem('row', { 'GET /runs/t1': { status: 500, body: {} } })
    expect(byTestId('programme-error').text()).toBe(
      'The server had a problem, so the programme couldn’t load. Try again in a while.',
    )
  })
})

describe('the activity’s work (K180)', () => {
  const withWork = { 'GET /runs/t1': { body: WORKED } }

  it('sits under the step chart, headed Work, with its line, legend and chart', async () => {
    await openItem('row', withWork)
    const section = byTestId('activity-work')
    expect(section.get('h3').text()).toBe('Work')
    const line = byTestId('activity-work-line')
    expect(line.text()).toBe('Week 4: 525 kg of 1,575 kg planned. 6,275 kg done so far.')
    expect(line.get('b').text()).toBe('525 kg')
    expect(section.find('[data-testid="work-chart-legend"]').exists()).toBe(true)
    const chart = section.get('[data-testid="work-chart"]')
    expect(chart.attributes('height')).toBe('200')
    expect(chart.attributes('aria-label')).toBe(
      'Barbell row: work in kg planned and done, week by week',
    )
    expect(chart.find('rect[data-band]').exists()).toBe(true)
    // After the step chart, before the controls.
    const order = [...page().element.querySelectorAll('[data-testid]')]
      .map((e) => e.getAttribute('data-testid'))
      .filter((id) => ['programme-chart', 'activity-work', 'activity-controls'].includes(id!))
    expect(order).toEqual(['programme-chart', 'activity-work', 'activity-controls'])
  })

  it('counts seconds held for an activity without weight, with no work so far', async () => {
    await openItem('plank', withWork)
    expect(byTestId('activity-work-line').text()).toBe('Week 4: 105 s of 315 s planned.')
    expect(byTestId('activity-work').get('text[data-unit]').text()).toBe('s')
  })

  it('keeps an activity ended early in line with the grid’s weeks', async () => {
    // Its work stops after week 6: no entries for weeks 7 and 8, which keep their places.
    const work = structuredClone(WORKED.work!)
    const row = work.activities.find((a) => a.key === 'row')!
    row.weeks = row.weeks.slice(0, 6)
    await openItem('row', { 'GET /runs/t1': { body: { ...WORKED, work } } })
    const chart = byTestId('activity-work').get('[data-testid="work-chart"]')
    expect(chart.findAll('rect[data-hit]')).toHaveLength(8)
    expect(chart.findAll('rect[data-planned]')).toHaveLength(6)
    expect(
      chart
        .findAll('text[data-label]')
        .map((t) => t.text())
        .at(-1),
    ).toBe('8')
  })

  it('shows none when the server sends no work, or none for the activity', async () => {
    await openItem()
    expect(page().find('[data-testid="activity-work"]').exists()).toBe(false)
    wrapper.unmount()
    await openItem('row', {
      'GET /runs/t1': { body: { ...WORKED, work: { total: null, activities: [] } } },
    })
    expect(page().find('[data-testid="activity-work"]').exists()).toBe(false)
  })
})

describe('changing an activity from its page (spec §7.3)', () => {
  it('opens each control’s change, from today', async () => {
    await openItem()
    await click(inDoc('activity-set-value'))
    expect(inDoc('change-sheet')!.querySelector('h2')!.textContent).toBe('Change Barbell row')
    expect(inDoc('change-kind')!.textContent).toContain('Set weight')
    expect((inDoc('change-from') as HTMLInputElement).value).toBe(RUN.today)
    for (const [id, kind] of [
      ['activity-set-increase', 'Set increase'],
      ['activity-pause', 'Pause activity'],
      ['activity-end', 'End activity'],
    ]) {
      await click(inDoc('change-cancel'))
      await click(inDoc(id!))
      expect(inDoc('change-kind')!.textContent).toContain(kind)
    }
  })

  it('opens Resume activity on a paused one', async () => {
    await openItem('deadlift')
    await click(inDoc('activity-resume'))
    expect(inDoc('change-kind')!.textContent).toContain('Resume activity')
  })

  it('previews first, writes nothing until Confirm, then the chart takes the new plan', async () => {
    await openItem()
    await click(inDoc('activity-set-value'))
    await type('change-value', '45')
    await click(inDoc('change-preview-button'))
    expect(changeCalls()).toHaveLength(1)
    expect(changeCalls()[0]!.body).toEqual({
      change: { type: 'set-value', activity: 'row', field: 'weight', value: 45 },
      from: RUN.today,
      preview: true,
    })
    expect(tableRow(6)).toContain('42.5 kg')
    await click(inDoc('change-confirm'))
    expect(changeCalls()[1]!.body).toMatchObject({ preview: false, rev: PREVIEW.rev })
    expect(inDoc('change-sheet')).toBeNull()
    expect(tableRow(6)).toContain('47.5 kg')
  })

  it('shows it in the plan with the bar at the foot, and goes back or confirms from there', async () => {
    await openItem()
    await click(inDoc('activity-set-value'))
    await type('change-value', '45')
    await click(inDoc('change-preview-button'))
    await click(inDoc('change-show-in-plan'))
    expect(inDoc('change-sheet')).toBeNull()
    const cell = () =>
      document.querySelector<HTMLElement>('td[data-activity="row"][data-week="6"]')!
    expect(cell().dataset.cell).toBe('changed')
    expect(page().find('[data-testid="programme-chart"]').exists()).toBe(false)
    expect(page().find('[data-testid="activity-controls"]').exists()).toBe(false)
    const bar = inDoc('change-preview-bar')!
    expect(bar.textContent).toContain(
      'Previewing a change. Barbell row at 45 kg from Mon 16 Nov. Nothing is saved yet.',
    )
    // Once the sheet has gone and handed focus back, the bar takes it.
    await vi.waitFor(() => expect(document.activeElement).toBe(bar))
    await click(inDoc('change-preview-back'))
    expect(inDoc('change-sheet')!.dataset.step).toBe('2')
    expect(inDoc('change-preview-bar')).toBeNull()
    await click(inDoc('change-show-in-plan'))
    await click(inDoc('change-preview-confirm'))
    expect(changeCalls().at(-1)!.body).toMatchObject({ preview: false, rev: PREVIEW.rev })
    expect(inDoc('change-preview-bar')).toBeNull()
    expect(tableRow(6)).toContain('47.5 kg')
  })

  it('brings the sheet back when the plan changed since the preview', async () => {
    await openItem()
    await click(inDoc('activity-set-value'))
    await type('change-value', '45')
    await click(inDoc('change-preview-button'))
    routes['POST /runs/t1/changes'] = {
      status: 409,
      body: { error: 'conflict', rev: 'fresh', preview: { ...PREVIEW, rev: 'fresh' } },
    }
    await click(inDoc('change-confirm'))
    expect(inDoc('change-stale')!.textContent).toContain('The plan changed since this preview.')
  })

  it('disables the controls offline, with one line saying why', async () => {
    await openItem()
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(byTestId('activity-offline').text()).toBe(
      'Can’t reach the server, so the programme can’t change now. Try again when you’re online.',
    )
    for (const b of byTestId('activity-controls').findAll('button'))
      expect(b.attributes('disabled')).toBeDefined()
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(page().find('[data-testid="activity-offline"]').exists()).toBe(false)
  })
})

describe('arranging a programme item’s page (K66)', () => {
  it('calls the row Programme there too', async () => {
    await openItem()
    await byTestId('item-arrange').trigger('click')
    await settle()
    const headings = page()
      .findAll('h2')
      .map((h) => h.text())
    expect(headings[0]).toBe('Programme')
    expect(new DOMWrapper(document.body).text()).not.toContain('This week’s plan')
  })
})
