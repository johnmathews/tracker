import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { signedIn } from '@/lib/__tests__/signedIn'
import { withProgrammes, type Call, type Route } from './programmesApi'
import type { ChangePreview, Run, Work } from '@/lib/programmes'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import WORK_JSON from '@/lib/__tests__/programmes/work.json'
import PAUSED_JSON from '@/lib/__tests__/programmes/run-paused.json'
import PREVIEW_JSON from '@/lib/__tests__/programmes/change-preview.json'

const RUN = RUN_JSON as unknown as Run
const PAUSED = PAUSED_JSON as unknown as Run
const PREVIEW = PREVIEW_JSON as unknown as ChangePreview
const AFTER: Run = { ...RUN, rev: 'after', grid: PREVIEW.grid }
const WORK = WORK_JSON as unknown as Work
/** The run as a server with work charts sends it (K179, work-charts spec §3). */
const WORKED: Run = { ...RUN, work: WORK }
/** Ended by End programme from Mon 9 Nov, in week 3, for the knee: a re-open applies (K167). */
const ENDED_EARLY: Run = {
  ...RUN,
  status: 'ended',
  end: '2026-11-08',
  ended: { from: '2026-11-09', reason: 'Knee', seq: 5 },
  canReopen: true,
}
/** Still running, with an end set from Mon 30 Nov. */
const ENDING: Run = {
  ...RUN,
  end: '2026-11-29',
  ended: { from: '2026-11-30', reason: null, seq: 5 },
  canReopen: true,
}
const REOPEN = {
  preview: true,
  rev: 'o1',
  reopen: {
    from: RUN.today,
    reason: 'Knee is better' as string | null,
    week: 4,
    paused: { from: '2026-11-09', to: '2026-11-11' } as { from: string; to: string } | null,
    end: '2026-12-20',
    lastWeek: '2026-12-14',
  },
}
const FRESH = { ...REOPEN, rev: 'o2', reopen: { ...REOPEN.reopen, from: '2026-11-13' } }
const RESTART = {
  preview: true,
  rev: 'r1',
  restart: {
    name: 'Beginner again',
    start: '2026-11-16',
    firstWeek: { from: '2026-11-16', to: '2026-11-22' },
    weeks: 8,
    end: '2027-01-10',
    oldEndsFrom: null,
  },
}

let wrapper: VueWrapper
let calls: Call[]
let routes: Record<string, Route>

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function openOverview(table: Record<string, Route> = {}) {
  history.replaceState(null, '', '/#/programme/t1')
  const api = signedIn()
  ;({ calls, routes } = withProgrammes(api, {
    'GET /runs/t1': { body: RUN },
    'POST /runs/t1/changes': (body) =>
      (body as { preview?: boolean }).preview === false
        ? { body: { preview: false, change: {}, run: AFTER } }
        : { body: PREVIEW },
    ...table,
  }))
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
}

const overview = () => wrapper.get('[data-testid="programme-overview"]')
const byTestId = (id: string) => overview().get(`[data-testid="${id}"]`)
const inDoc = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const changeCalls = () => calls.filter((c) => c.path === '/runs/t1/changes')
const controlWords = () =>
  byTestId('programme-controls')
    .findAll('button')
    .map((b) => b.text())

function cell(activity: string, week: number): HTMLElement {
  return document.querySelector<HTMLElement>(
    `td[data-activity="${activity}"][data-week="${week}"]`,
  )!
}

async function press(target: HTMLElement): Promise<void> {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  target.click()
  await settle()
}

async function menuItem(label: string): Promise<void> {
  ;[...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')]
    .find((i) => i.textContent?.trim() === label)!
    .click()
  await settle()
}

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
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('the programme overview (spec §9.2)', () => {
  it('is ItemPage’s head with no bar: Back, “Programme”, the name and its line', async () => {
    await openOverview()
    expect(wrapper.find('[data-slot="bar"]').exists()).toBe(false)
    expect(byTestId('back-to-week').text()).toBe('Back to the week')
    expect(overview().text()).toContain('Programme')
    expect(overview().get('h1').text()).toBe('Beginner 5×5')
    expect(byTestId('programme-meta').text()).toBe(
      'Week 4 of 8. Started Fri 23 Oct, ends Sun 13 Dec.',
    )
    expect(byTestId('programme-meta').get('b').text()).toBe('Week 4 of 8.')
  })

  it('goes back to Programmes when the Programmes page opened it', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    history.replaceState(null, '', '/#/programmes')
    const api = signedIn()
    ;({ calls, routes } = withProgrammes(api, { 'GET /runs/t1': { body: RUN } }))
    setActivePinia(createPinia())
    wrapper = mount(App, { global: { plugins: [getActivePinia()!] }, attachTo: document.body })
    await settle()
    location.hash = '#/programme/t1'
    await settle()
    const link = byTestId('back-to-programmes')
    expect(link.text()).toBe('Back to programmes')
    expect(link.attributes('href')).toBe('#/programmes')
    expect(overview().find('[data-testid="back-to-week"]').exists()).toBe(false)
    await link.trigger('click')
    expect(back).toHaveBeenCalledOnce()
  })

  it('has Plan and Changes tabs, opening on Plan with the grid from the server', async () => {
    await openOverview()
    expect(byTestId('programme-tab-plan').attributes('aria-selected')).toBe('true')
    expect(byTestId('programme-tab-changes').text()).toBe('Changes')
    expect(byTestId('programme-grid').attributes('aria-label')).toBe('The plan, week by week')
    expect(cell('squat', 4).dataset.cell).toBe('current')
    // Each activity links to its item page in the programme's tracker.
    expect(overview().get('tbody tr[data-activity="squat"] a').attributes('href')).toBe(
      '#/item/t1/squat',
    )
    expect(byTestId('programme-ends-short').text()).toContain('Deadlift ends at its week 7 of 8.')
  })

  it('has the programme’s controls: Pause, Go to week, Add activity and End', async () => {
    await openOverview()
    const controls = byTestId('programme-controls')
    expect(controls.findAll('button').map((b) => b.text())).toEqual([
      'Pause programme',
      'Go to week',
      'Add activity',
      'End programme',
    ])
  })

  it('offers Resume while paused, and shows the weeks to come when resumed', async () => {
    await openOverview({ 'GET /runs/t1': { body: PAUSED } })
    expect(byTestId('programme-meta').text()).toBe(
      'Paused since Thu 12 Nov, in week 4 of 8. Resume it when you’re ready.',
    )
    expect(byTestId('programme-resume').text()).toBe('Resume programme')
    expect(overview().find('[data-testid="programme-pause"]').exists()).toBe(false)
    expect(overview().findAll('thead th[data-when-resumed]').length).toBeGreaterThan(0)
    await click(inDoc('programme-resume'))
    expect(inDoc('change-kind')!.textContent).toContain('Resume programme')
  })

  it('opens the week a run named by its address doesn’t have: the Programmes page', async () => {
    await openOverview({ 'GET /runs/t1': { status: 404, body: { error: 'not-found' } } })
    expect(location.hash).toBe('#/programmes')
  })

  it('says when the run can’t be read', async () => {
    await openOverview({ 'GET /runs/t1': 'offline' })
    expect(wrapper.text()).toContain('Can’t reach the server')
  })

  it('offers Re-open and Restart once End programme has stopped the run part way (K168)', async () => {
    await openOverview({ 'GET /runs/t1': { body: ENDED_EARLY } })
    expect(byTestId('programme-meta').text()).toBe('Ended Sun 8 Nov. Knee.')
    expect(controlWords()).toEqual(['Re-open programme', 'Restart from week 1'])
    expect(cell('squat', 6).querySelector('button')).toBeNull()
  })

  it('offers only Restart once the run has ended any other way', async () => {
    await openOverview({ 'GET /runs/t1': { body: { ...RUN, status: 'ended', canReopen: false } } })
    expect(controlWords()).toEqual(['Restart from week 1'])
    expect(cell('squat', 6).querySelector('button')).toBeNull()
  })

  it('swaps End programme for Cancel the end while an end is set for a later day', async () => {
    await openOverview({ 'GET /runs/t1': { body: ENDING } })
    expect(controlWords()).toEqual([
      'Pause programme',
      'Go to week',
      'Add activity',
      'Cancel the end',
    ])
  })

  it('offers neither End nor Cancel the end when a restart set the end', async () => {
    await openOverview({ 'GET /runs/t1': { body: { ...ENDING, canReopen: false } } })
    expect(controlWords()).toEqual(['Pause programme', 'Go to week', 'Add activity'])
  })
})

describe('Re-open, Restart and Cancel the end (K168)', () => {
  const sheetText = () => inDoc('run-sheet')!.textContent!.replace(/\s+/g, ' ')
  const rows = () =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="run-preview-row"]')].map((r) =>
      [...r.querySelectorAll('[data-part]')].map((p) => p.textContent!.trim()),
    )
  const reopenCalls = () => calls.filter((c) => c.path === '/runs/t1/reopen')

  it('re-opens after a preview of what it does', async () => {
    await openOverview({
      'GET /runs/t1': { body: ENDED_EARLY },
      'POST /runs/t1/reopen': (body) =>
        (body as { preview?: boolean }).preview === false
          ? { body: { preview: false, tracker: { id: 't1' }, run: RUN } }
          : { body: REOPEN },
    })
    await click(inDoc('programme-reopen'))
    expect(inDoc('run-sheet')!.querySelector('h2')!.textContent).toBe('Re-open Beginner 5×5')
    expect(inDoc('run-step')!.textContent).toBe('Step 1 of 2')
    expect((inDoc('run-from') as HTMLInputElement).value).toBe(RUN.today)
    await type('run-reason', 'Knee is better')
    await click(inDoc('run-preview-button'))
    expect(reopenCalls()[0]!.body).toEqual({
      from: RUN.today,
      reason: 'Knee is better',
      preview: true,
    })
    expect(inDoc('run-step')!.textContent).toBe('Step 2 of 2')
    expect(inDoc('run-summary')!.textContent!.trim()).toBe(
      'Carries on from Thu 12 Nov, at week 4. Knee is better.',
    )
    expect(rows()).toEqual([
      ['Carries on', 'At the week it stopped in', 'Thu 12 Nov, week 4'],
      ['Paused', 'The days since it ended count as a pause', 'Mon 9 to Wed 11 Nov'],
      ['Last day', 'Week 8, as planned', 'Sun 20 Dec'],
    ])
    expect(inDoc('run-unchanged')!.textContent).toBe('Nothing before Mon 9 Nov changes.')
    expect(reopenCalls()).toHaveLength(1)
    expect(inDoc('run-confirm')!.textContent!.trim()).toBe('Re-open programme')
    await click(inDoc('run-confirm'))
    expect(reopenCalls()[1]!.body).toEqual({
      from: RUN.today,
      reason: 'Knee is better',
      preview: false,
      rev: 'o1',
    })
    expect(inDoc('run-sheet')).toBeNull()
    expect(controlWords()).toEqual([
      'Pause programme',
      'Go to week',
      'Add activity',
      'End programme',
    ])
  })

  it('shows the fresh preview, with a line, when the run changed since', async () => {
    await openOverview({
      'GET /runs/t1': { body: ENDED_EARLY },
      'POST /runs/t1/reopen': (body) =>
        (body as { preview?: boolean }).preview === false
          ? { status: 409, body: { error: 'conflict', rev: 'o2', preview: FRESH } }
          : { body: REOPEN },
    })
    await click(inDoc('programme-reopen'))
    await click(inDoc('run-preview-button'))
    expect(inDoc('run-stale')).toBeNull()
    await click(inDoc('run-confirm'))
    expect(inDoc('run-sheet')!.dataset.step).toBe('2')
    expect(inDoc('run-stale')!.textContent).toContain('The plan changed since this preview.')
    expect(rows()[0]![2]).toBe('Fri 13 Nov, week 4')
    await click(inDoc('run-confirm'))
    expect(reopenCalls().at(-1)!.body).toMatchObject({ preview: false, rev: 'o2' })
  })

  it('keeps step 1 with the server’s word on a field it refuses', async () => {
    const errors = [{ path: 'from', message: 'the programme re-opens today or later.' }]
    await openOverview({
      'GET /runs/t1': { body: ENDED_EARLY },
      'POST /runs/t1/reopen': { status: 400, body: { error: 'invalid', errors } },
    })
    await click(inDoc('programme-reopen'))
    await click(inDoc('run-preview-button'))
    expect(inDoc('run-sheet')!.dataset.step).toBe('1')
    expect(sheetText()).toContain('The programme re-opens today or later.')
  })

  it('restarts from week 1 after a preview, then opens the new tracker', async () => {
    await openOverview({
      'GET /runs/t1': { body: ENDED_EARLY },
      'GET /runs/t2': { body: { ...RUN, tracker: 't2', name: 'Beginner again' } },
      'POST /runs/t1/restart': (body) =>
        (body as { preview?: boolean }).preview === false
          ? {
              body: {
                preview: false,
                tracker: { id: 't2', name: 'Beginner again' },
                run: { ...RUN, tracker: 't2' },
                old: { id: 't1' },
              },
            }
          : { body: RESTART },
    })
    await click(inDoc('programme-restart'))
    expect(inDoc('run-sheet')!.querySelector('h2')!.textContent).toBe('Restart Beginner 5×5')
    expect((inDoc('run-name') as HTMLInputElement).value).toBe('Beginner 5×5')
    expect((inDoc('run-start') as HTMLInputElement).value).toBe(RUN.today)
    await type('run-name', 'Beginner again')
    await type('run-start', '2026-11-16')
    await click(inDoc('run-preview-button'))
    const restarts = () => calls.filter((c) => c.path === '/runs/t1/restart')
    expect(restarts()[0]!.body).toEqual({
      name: 'Beginner again',
      start: '2026-11-16',
      preview: true,
    })
    expect(inDoc('run-summary')!.textContent!.trim()).toBe(
      'A new Beginner again, from week 1 on Mon 16 Nov.',
    )
    expect(rows()).toEqual([
      ['New tracker', '', 'Beginner again'],
      ['Week 1', '', '16–22 Nov'],
      ['Last day', '8 weeks', 'Sun 10 Jan'],
    ])
    expect(inDoc('run-unchanged')!.textContent).toBe(
      'This run has ended and stays as it is, with its weeks, marks, notes and changes.',
    )
    expect(inDoc('run-confirm')!.textContent!.trim()).toBe('Restart programme')
    await click(inDoc('run-confirm'))
    expect(restarts()[1]!.body).toEqual({
      name: 'Beginner again',
      start: '2026-11-16',
      preview: false,
      rev: 'r1',
    })
    expect(location.hash).toBe('#/programme/t2')
    await settle()
    expect(calls.some((c) => c.method === 'GET' && c.path === '/runs/t2')).toBe(true)
  })

  it('cancels an end set for a later day, from the end’s own day, in one step', async () => {
    const cancel = {
      ...REOPEN,
      reopen: { ...REOPEN.reopen, from: '2026-11-30', reason: null, week: 6, paused: null },
    }
    await openOverview({
      'GET /runs/t1': { body: ENDING },
      'POST /runs/t1/reopen': (body) =>
        (body as { preview?: boolean }).preview === false
          ? { body: { preview: false, tracker: { id: 't1' }, run: RUN } }
          : { body: cancel },
    })
    await click(inDoc('programme-cancel-end'))
    expect(inDoc('run-sheet')!.querySelector('h2')!.textContent).toBe(
      'Cancel the end of Beginner 5×5',
    )
    expect(inDoc('run-step')).toBeNull()
    expect(reopenCalls()[0]!.body).toEqual({ from: '2026-11-30', preview: true })
    expect(inDoc('run-summary')!.textContent!.trim()).toBe(
      'Carries on past Sun 29 Nov, as planned.',
    )
    expect(rows()).toEqual([
      ['Carries on', 'From the day it was to end', 'Mon 30 Nov, week 6'],
      ['Paused', '', 'No day'],
      ['Last day', 'Week 8, as planned', 'Sun 20 Dec'],
    ])
    expect(inDoc('run-unchanged')!.textContent).toBe('Nothing before Mon 30 Nov changes.')
    await click(inDoc('run-keep'))
    expect(inDoc('run-sheet')).toBeNull()
    expect(reopenCalls()).toHaveLength(1)
    await click(inDoc('programme-cancel-end'))
    await click(inDoc('run-confirm'))
    expect(reopenCalls().at(-1)!.body).toEqual({
      from: '2026-11-30',
      preview: false,
      rev: 'o1',
    })
    expect(inDoc('run-sheet')).toBeNull()
    expect(controlWords().at(-1)).toBe('End programme')
  })

  it('disables Re-open and Restart offline, as the other controls', async () => {
    await openOverview({ 'GET /runs/t1': { body: ENDED_EARLY } })
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(byTestId('programme-offline').text()).toContain('Can’t reach the server')
    for (const b of byTestId('programme-controls').findAll('button'))
      expect(b.attributes('disabled')).toBeDefined()
    window.dispatchEvent(new Event('online'))
    await settle()
  })
})

describe('changing a programme from its overview', () => {
  it('opens the sheet from a later week’s cell, from that week’s Monday', async () => {
    await openOverview()
    await press(cell('row', 6).querySelector('button')!)
    await menuItem('Change from here')
    expect(inDoc('change-sheet')!.querySelector('h2')!.textContent).toBe('Change Barbell row')
    expect((inDoc('change-from') as HTMLInputElement).value).toBe('2026-11-23')
    expect(inDoc('change-kind')!.textContent).toContain('Set weight')
  })

  it('opens Edit this week as That week only', async () => {
    await openOverview()
    await press(cell('row', 6).querySelector('button')!)
    await menuItem('Edit this week')
    await type('change-value', '40')
    await click(inDoc('change-preview-button'))
    expect(changeCalls()[0]!.body).toMatchObject({
      change: { type: 'edit-week', activity: 'row', week: 6, field: 'weight', value: 40 },
      from: '2026-11-23',
      preview: true,
    })
  })

  it('previews, then confirms, and the grid takes the server’s new plan', async () => {
    await openOverview()
    await press(cell('row', 6).querySelector('button')!)
    await menuItem('Change from here')
    await type('change-value', '45')
    await click(inDoc('change-preview-button'))
    expect(changeCalls()).toHaveLength(1)
    expect(cell('row', 6).textContent).toContain('42.5 kg')
    await click(inDoc('change-confirm'))
    expect(changeCalls()[1]!.body).toMatchObject({ preview: false, rev: PREVIEW.rev })
    expect(inDoc('change-sheet')).toBeNull()
    expect(cell('row', 6).textContent).toContain('47.5 kg')
  })

  it('opens the programme’s changes from its controls', async () => {
    await openOverview()
    await click(inDoc('programme-pause'))
    expect(inDoc('change-sheet')!.querySelector('h2')!.textContent).toBe('Change Beginner 5×5')
    expect(inDoc('change-kind')!.textContent).toContain('Pause programme')
    expect((inDoc('change-from') as HTMLInputElement).value).toBe(RUN.today)
    await click(inDoc('change-cancel'))
    await click(inDoc('programme-go-to-week'))
    expect(inDoc('change-kind')!.textContent).toContain('Go to week')
    await click(inDoc('change-cancel'))
    await click(inDoc('programme-add-activity'))
    expect(inDoc('change-kind')!.textContent).toContain('Add activity')
  })

  it('ends the programme after asking', async () => {
    await openOverview({
      'POST /runs/t1/end': { body: { tracker: { id: 't1' }, run: { ...RUN, status: 'ended' } } },
    })
    await click(inDoc('programme-end'))
    const dialog = () =>
      new DOMWrapper(document.querySelector<HTMLElement>('[role="alertdialog"]')!)
    expect(dialog().text()).toContain('End Beginner 5×5?')
    expect(dialog().text()).toContain(
      'It ends today, Thu 12 Nov. Its weeks, marks and changes stay.',
    )
    await dialog()
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')
    await settle()
    expect(calls.some((c) => c.path === '/runs/t1/end')).toBe(false)
    await click(inDoc('programme-end'))
    await dialog()
      .findAll('button')
      .find((b) => b.text() === 'End programme')!
      .trigger('click')
    await settle()
    expect(calls.find((c) => c.path === '/runs/t1/end')!.body).toEqual({})
    // Ended today, from its start: nothing to re-open, so Restart alone (K168).
    expect(controlWords()).toEqual(['Restart from week 1'])
  })

  it('says why ending failed', async () => {
    await openOverview({ 'POST /runs/t1/end': 'offline' })
    await click(inDoc('programme-end'))
    await new DOMWrapper(document.querySelector<HTMLElement>('[role="alertdialog"]')!)
      .findAll('button')
      .find((b) => b.text() === 'End programme')!
      .trigger('click')
    await settle()
    expect(byTestId('programme-error').text()).toContain('Can’t reach the server')
  })
})

describe('Show it in the plan (K148)', () => {
  async function showInPlan() {
    await openOverview()
    await press(cell('row', 6).querySelector('button')!)
    await menuItem('Change from here')
    await type('change-value', '45')
    await click(inDoc('change-preview-button'))
    await click(inDoc('change-show-in-plan'))
  }

  it('shows the change in the cells, with the bar at the foot and no tabs or controls', async () => {
    await showInPlan()
    expect(inDoc('change-sheet')).toBeNull()
    expect(overview().attributes('data-previewing')).toBeDefined()
    expect(cell('row', 6).dataset.cell).toBe('changed')
    expect(cell('row', 6).textContent).toContain('42.5 → 47.5 kg')
    expect(byTestId('programme-grid').attributes('aria-label')).toBe(
      'The plan with the change, week by week',
    )
    expect(overview().find('[data-testid="programme-controls"]').exists()).toBe(false)
    expect(overview().find('[role="tablist"]').exists()).toBe(false)
    const bar = inDoc('change-preview-bar')!
    expect(bar.getAttribute('role')).toBe('region')
    expect(bar.textContent).toContain(
      'Previewing a change. Barbell row at 45 kg from Mon 16 Nov. Nothing is saved yet.',
    )
    expect(document.activeElement).toBe(bar)
  })

  it('keeps focus on the bar once the sheet has gone and handed focus back', async () => {
    await showInPlan()
    const bar = inDoc('change-preview-bar')!
    // The sheet leaves after its closing animation; its focus scope hands focus back a task
    // later. The bar must hold focus after that, not lose it to the cell that opened the sheet.
    await vi.waitFor(() => expect(inDoc('change-sheet')).toBeNull())
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.activeElement).toBe(bar)
  })

  it('goes back to the change at step 2, as it was', async () => {
    await showInPlan()
    await click(inDoc('change-preview-back'))
    expect(inDoc('change-sheet')!.dataset.step).toBe('2')
    expect(inDoc('change-preview-bar')).toBeNull()
    expect(overview().attributes('data-previewing')).toBeUndefined()
  })

  it('confirms from the bar with the preview’s rev', async () => {
    await showInPlan()
    await click(inDoc('change-preview-confirm'))
    expect(changeCalls()[1]!.body).toMatchObject({ preview: false, rev: PREVIEW.rev })
    expect(inDoc('change-preview-bar')).toBeNull()
    expect(cell('row', 6).dataset.cell).toBe('planned')
  })

  it('brings the sheet back with the fresh preview when the plan changed since', async () => {
    await showInPlan()
    routes['POST /runs/t1/changes'] = {
      status: 409,
      body: { error: 'conflict', rev: 'fresh', preview: { ...PREVIEW, rev: 'fresh' } },
    }
    await click(inDoc('change-preview-confirm'))
    expect(inDoc('change-sheet')!.dataset.step).toBe('2')
    expect(inDoc('change-stale')!.textContent).toContain('The plan changed since this preview.')
    expect(inDoc('change-preview-bar')).toBeNull()
  })
})

describe('the Changes tab', () => {
  async function openChanges(run: Run = RUN) {
    await openOverview({ 'GET /runs/t1': { body: run } })
    await byTestId('programme-tab-changes').trigger('mousedown')
    await settle()
  }

  it('lists the log newest first: the day, what changed, the reason and where it came from', async () => {
    await openChanges()
    const entries = overview().findAll('[data-testid="programme-change"]')
    expect(entries).toHaveLength(4)
    expect(entries[0]!.text()).toContain('Thu 12 Nov')
    expect(entries[0]!.text()).toContain('Bench press set to 30 kg, from Thu 12 Nov.')
    expect(entries[0]!.text()).toContain('Shoulder')
    expect(entries[0]!.text()).toContain('From the app')
    expect(entries[2]!.text()).toContain('Barbell row set to 35 kg in week 5 only.')
    expect(entries[3]!.text()).toContain('Started on Fri 23 Oct.')
    // Undo shows only on a change whose effect starts today or later.
    expect(entries.map((e) => e.find('[data-testid="programme-change-undo"]').exists())).toEqual([
      true,
      true,
      false,
      false,
    ])
  })

  it('marks a change that was undone', async () => {
    const log = RUN.log.map((e) => (e.seq === 2 ? { ...e, undoneBy: 4, undoable: false } : e))
    await openChanges({ ...RUN, log })
    expect(overview().findAll('[data-testid="programme-change"]')[1]!.text()).toContain('Undone.')
  })

  it('previews Undo before it applies (spec P2)', async () => {
    await openChanges()
    await click(inDoc('programme-change-undo'))
    expect(inDoc('change-kind')!.textContent).toContain('Undo')
    expect(inDoc('change-undoes')!.textContent).toContain('Bench press set to 30 kg')
    await click(inDoc('change-preview-button'))
    expect(changeCalls()[0]!.body).toMatchObject({
      change: { type: 'undo', change: 3 },
      from: RUN.today,
      preview: true,
    })
  })
})

describe('the overview offline (spec §11.2)', () => {
  it('disables the controls, the cells and Undo, with one line saying why', async () => {
    await openOverview()
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(byTestId('programme-offline').text()).toBe(
      'Can’t reach the server, so the programme can’t change now. Try again when you’re online.',
    )
    for (const b of byTestId('programme-controls').findAll('button'))
      expect(b.attributes('disabled')).toBeDefined()
    expect(cell('squat', 6).querySelector('button')!.disabled).toBe(true)
    await byTestId('programme-tab-changes').trigger('mousedown')
    await settle()
    expect(byTestId('programme-change-undo').attributes('disabled')).toBeDefined()
    window.dispatchEvent(new Event('online'))
    await settle()
  })
})

describe('the Work tab (K180)', () => {
  async function openWork(run: Run = WORKED) {
    await openOverview({ 'GET /runs/t1': { body: run } })
    await byTestId('programme-tab-work').trigger('mousedown')
    await settle()
  }
  const work = () => byTestId('programme-work')
  const activityRow = (key: string) =>
    work().get(`[data-testid="work-activity"][data-activity="${key}"]`)

  it('sits between Plan and Changes', async () => {
    await openOverview({ 'GET /runs/t1': { body: WORKED } })
    expect(
      overview()
        .findAll('[role="tab"]')
        .map((t) => t.text()),
    ).toEqual(['Plan', 'Work', 'Changes'])
  })

  it('shows the whole programme: its line, the legend, its chart and what it leaves out', async () => {
    await openWork()
    expect(
      work()
        .findAll('h2')
        .map((h) => h.text()),
    ).toEqual(['The whole programme', 'By activity'])
    const line = byTestId('work-total-line')
    expect(line.text()).toBe('Week 4: 1,575 kg of 5,400 kg planned. 23,601 kg done so far.')
    expect(line.get('b').text()).toBe('1,575 kg')
    expect(work().findAll('[data-testid="work-chart-legend"]')).toHaveLength(1)
    const total = byTestId('work-total')
    expect(total.get('[data-testid="work-chart"]').attributes('height')).toBe('300')
    expect(total.get('[data-testid="work-chart"]').attributes('aria-label')).toBe(
      'The whole programme: work in kg planned and done, week by week',
    )
    expect(total.find('rect[data-band]').exists()).toBe(true)
    expect(byTestId('work-left-out').text()).toBe('Plank has no weight, so it is not in the total.')
  })

  it('then a chart per activity, with its name and line, two to a row', async () => {
    await openWork()
    const rows = work().findAll('[data-testid="work-activity"]')
    expect(rows.map((r) => r.get('h3').text())).toEqual([
      'Back squat',
      'Bench press',
      'Barbell row',
      'Deadlift',
      'Plank, seconds held',
    ])
    expect(rows[0]!.get('[data-testid="work-activity-line"]').text()).toBe(
      'Week 4: 638 kg of 1,912 kg planned. 8,076 kg done so far.',
    )
    // An activity without weight leaves out the work so far (spec §5).
    expect(rows[4]!.get('[data-testid="work-activity-line"]').text()).toBe(
      'Week 4: 105 s of 315 s planned.',
    )
    expect(rows[4]!.get('[data-testid="work-chart"]').attributes('height')).toBe('200')
    expect(rows[4]!.get('[data-testid="work-chart"]').attributes('aria-label')).toBe(
      'Plank: seconds held planned and done, week by week',
    )
    expect(rows[0]!.element.parentElement!.className).toContain('grid-cols-2')
    expect(rows[0]!.element.parentElement!.className).toContain('folded:grid-cols-1')
  })

  it('starts at By activity, with the legend, when no activity has weight', async () => {
    await openWork({ ...RUN, work: { ...WORK, total: null } })
    expect(
      work()
        .findAll('h2')
        .map((h) => h.text()),
    ).toEqual(['By activity'])
    expect(work().find('[data-testid="work-total"]').exists()).toBe(false)
    expect(work().find('[data-testid="work-left-out"]').exists()).toBe(false)
    expect(work().findAll('[data-testid="work-chart-legend"]')).toHaveLength(1)
    expect(byTestId('work-by-activity').classes()).not.toContain('border-t')
  })

  it('names nothing left out when every activity has weight', async () => {
    await openWork({ ...RUN, work: { ...WORK, total: { ...WORK.total!, leftOut: [] } } })
    expect(work().find('[data-testid="work-left-out"]').exists()).toBe(false)
    expect(byTestId('work-by-activity').classes()).toContain('border-t')
  })

  it('lines an activity added later up with the total, week for week', async () => {
    // Plank added in week 2: the server sends no entry for week 1.
    const work = structuredClone(WORK)
    const plank = work.activities.find((a) => a.key === 'plank')!
    plank.weeks = plank.weeks.slice(1)
    await openWork({ ...RUN, work })
    const row = activityRow('plank')
    expect(row.findAll('rect[data-hit]')).toHaveLength(8)
    expect(row.findAll('rect[data-planned]').map((r) => r.attributes('data-week'))[0]).toBe('1')
    expect(row.get('text[data-current]').text()).toBe('4')
  })

  it('has no Work tab when an older server sends no work', async () => {
    await openOverview()
    expect(overview().find('[data-testid="programme-tab-work"]').exists()).toBe(false)
    expect(
      overview()
        .findAll('[role="tab"]')
        .map((t) => t.text()),
    ).toEqual(['Plan', 'Changes'])
  })
})
