/**
 * A programme tracker in the week (PlannerScreen card's programme screen, K146, spec §9.5): its
 * title line ends with "Week 4 of 8", a link to the overview; a locked day has a lock by its name
 * and boxes that don't press, by the server's today; a paused activity's row reads its sentence in
 * place of its boxes; and Edit plan leaves its items alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { usePlannerStore } from '@/stores/planner'
import { useTrackersStore } from '@/stores/trackers'
import { useSyncStore } from '@/stores/sync'
import type { Run } from '@/lib/programmes'
import type { Tracker } from '@/lib/trackers'
import { USER, emptySection, emptyState, signedIn } from '@/lib/__tests__/signedIn'
import type { FakeApi } from '@/lib/__tests__/fakeApi'
import { withProgrammes, type Call } from './programmesApi'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import PAUSED_JSON from '@/lib/__tests__/programmes/run-paused.json'

const RUN = RUN_JSON as unknown as Run
const PAUSED = PAUSED_JSON as unknown as Run
// Thursday 12 Nov 2026 on the device, in programme week 4.
const NOW = new Date(2026, 10, 12, 9, 0)
const WEEK = '2026-11-09'
const NEXT = '2026-11-16'
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

/** The run's activities as a week's items, with each one's values that week. */
function items(run: Run, monday: string) {
  const week = run.grid.weeks.find((w) => w.monday === monday)!
  return run.grid.activities.map((a) => ({
    id: a.key,
    name: a.name,
    ...week.cells[a.key]!.values,
    target: week.cells[a.key]!.target,
  }))
}

let wrapper: VueWrapper
let api: FakeApi
let calls: Call[]
let extra: { today?: string; runs: Record<string, unknown> }

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * The app signed in as alice, with the programme tracker t1 running `run`, the server's today
 * `today`, and the state's summary of the run changed by `summary`. `hold` keeps the run's own
 * read from answering.
 */
async function mountWeek(
  run: Run = RUN,
  today = '2026-11-12',
  { summary = {}, hold = false }: { summary?: object; hold?: boolean } = {},
): Promise<void> {
  const cache = emptyState()
  cache.trackers.push({ ...PROGRAMME })
  const plans = { [WEEK]: items(run, WEEK), [NEXT]: items(run, NEXT) }
  cache.sections.t1 = { ...emptySection(), plans, revs: { [WEEK]: 1, [NEXT]: 1 } }
  api = signedIn(cache)
  const account = api.accounts.get(USER)!
  account.trackers.push({ ...PROGRAMME })
  account.plans.t1 = {
    [WEEK]: { items: plans[WEEK], rev: 1 },
    [NEXT]: { items: plans[NEXT], rev: 1 },
  }
  const listed = { ...SUMMARY, rev: run.rev, status: run.status, ...summary }
  const read = hold ? () => new Promise<never>(() => {}) : { body: run }
  ;({ calls, extra } = withProgrammes(
    api,
    { 'GET /runs/t1': read },
    { today, runs: { t1: listed } },
  ))
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
}

const screen = (id: string) => wrapper.get(`section[data-tracker="${id}"]`)
const heads = (id: string) => screen(id).findAll('[data-testid="day-head"]')
const marks = (id: string, item: string) =>
  screen(id)
    .findAll('[data-slot="day-mark-button"]')
    .filter((b) => b.attributes('aria-label')!.startsWith(`${item},`))

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

describe('a programme tracker’s screen (K146)', () => {
  it('ends its title line with the programme week, a link to the overview', async () => {
    await mountWeek()
    const link = screen('t1').get('[data-testid="programme-week-link"]')
    expect(link.text()).toBe('Week 4 of 8')
    expect(link.attributes('href')).toBe('#/programme/t1')
    expect(link.attributes('aria-label')).toBe('Week 4 of 8. Open the programme')
    expect(link.find('svg').attributes('aria-hidden')).toBe('true')
    // An ordinary tracker's title line has none.
    expect(screen('exercise').find('[data-testid="programme-week-link"]').exists()).toBe(false)
  })

  it('names the programme week of the week on screen, and a week a change split', async () => {
    await mountWeek()
    usePlannerStore().nextWeek()
    await settle()
    expect(screen('t1').get('[data-testid="programme-week-link"]').text()).toBe('Week 5 of 8')
    const split = structuredClone(RUN)
    split.grid.weeks[3]!.programmeWeeks = [4, 5]
    wrapper.unmount()
    await mountWeek(split)
    expect(screen('t1').get('[data-testid="programme-week-link"]').text()).toBe(
      'Weeks 4 and 5 of 8',
    )
  })

  it('words the state’s summary until the run has loaded', async () => {
    await mountWeek(RUN, '2026-11-12', { hold: true })
    expect(screen('t1').get('[data-testid="programme-week-link"]').text()).toBe('Week 4 of 8')
    wrapper.unmount()
    await mountWeek(RUN, '2026-11-12', { hold: true, summary: { status: 'upcoming', week: null } })
    expect(screen('t1').get('[data-testid="programme-week-link"]').text()).toBe('Starts Fri 23 Oct')
    wrapper.unmount()
    await mountWeek(RUN, '2026-11-12', { hold: true, summary: { status: 'ended', week: null } })
    expect(screen('t1').get('[data-testid="programme-week-link"]').text()).toBe('The programme')
  })
})

describe('locked days (spec §8)', () => {
  it('puts a lock by each day before yesterday, by the server’s today', async () => {
    await mountWeek()
    const locked = heads('t1').map((h) => h.attributes('data-locked') !== undefined)
    expect(locked).toEqual([true, true, false, false, false, false, false])
    expect(heads('t1')[0]!.find('svg[data-slot="lock"]').attributes('aria-hidden')).toBe('true')
    expect(heads('t1')[0]!.text()).toContain(', locked')
    expect(heads('t1')[2]!.find('svg[data-slot="lock"]').exists()).toBe(false)
    // An ordinary tracker has no locked day.
    expect(heads('exercise').some((h) => h.attributes('data-locked') !== undefined)).toBe(false)
  })

  it('leaves a locked day’s boxes as they are: they don’t press', async () => {
    await mountWeek()
    const [monday, , wednesday] = marks('t1', 'Back squat')
    expect(monday!.attributes('aria-disabled')).toBe('true')
    expect(monday!.attributes('aria-label')).toBe('Back squat, Monday 9 November, locked')
    await monday!.trigger('click')
    await settle()
    expect(useTrackersStore().markOf('t1', 'squat', 0)).toBeNull()
    expect(api.paths().some((p) => p.startsWith('PUT /ticks/t1'))).toBe(false)
    // Yesterday stays open for one day.
    expect(wednesday!.attributes('aria-disabled')).toBeUndefined()
    await wednesday!.trigger('click')
    await settle()
    expect(useTrackersStore().markOf('t1', 'squat', 2)).toBe('great')
  })

  it('follows the server’s today, not the device’s clock', async () => {
    await mountWeek(RUN, '2026-11-13')
    const locked = heads('t1').map((h) => h.attributes('data-locked') !== undefined)
    expect(locked).toEqual([true, true, true, false, false, false, false])
  })
})

describe('a paused activity (spec §9.5)', () => {
  it('reads its sentence in place of its boxes, its name and chips staying', async () => {
    await mountWeek()
    // This week the deadlift ran until Thursday: its boxes show.
    expect(screen('t1').find('[data-testid="paused-row"]').exists()).toBe(false)
    usePlannerStore().nextWeek()
    await settle()
    const row = screen('t1').get('[data-testid="paused-row"]')
    expect(row.text()).toBe('Paused until Thu 26 Nov. Knee.')
    expect(row.attributes('colspan')).toBe('7')
    expect(row.find('svg').attributes('aria-hidden')).toBe('true')
    expect(marks('t1', 'Deadlift')).toHaveLength(0)
    expect(marks('t1', 'Back squat')).toHaveLength(7)
    expect(
      screen('t1')
        .findAll('[data-testid="item-name"]')
        .map((n) => n.text()),
    ).toContain('Deadlift')
  })

  it('says only why when the pause has no end', async () => {
    await mountWeek(PAUSED)
    usePlannerStore().nextWeek()
    await settle()
    const rows = screen('t1').findAll('[data-testid="paused-row"]')
    expect(rows.map((r) => r.text())).toEqual([
      'Paused. A cold.',
      'Paused. A cold.',
      'Paused. A cold.',
      'Paused until Thu 26 Nov. Knee.',
      'Paused. A cold.',
    ])
  })

  it('leads with “Paused until …” in paused-ink at 600; the reason and icon stay quiet (K169)', async () => {
    await mountWeek()
    usePlannerStore().nextWeek()
    await settle()
    const row = screen('t1').get('[data-testid="paused-row"]')
    // The cell keeps ink-secondary at 400 for the reason and the icon.
    expect(row.classes()).toContain('text-ink-secondary')
    expect(row.classes()).not.toContain('font-semibold')
    const lead = row.get('[data-testid="paused-lead"]')
    expect(lead.text()).toBe('Paused until Thu 26 Nov.')
    expect(lead.classes()).toEqual(expect.arrayContaining(['text-paused-ink', 'font-semibold']))
    expect(row.findAll('.text-paused-ink')).toHaveLength(1)
    expect(row.find('svg').classes()).not.toContain('text-paused-ink')
    // Read aloud, the row is one sentence: the lead, a space, the reason.
    expect(row.element.textContent!.trim()).toBe('Paused until Thu 26 Nov. Knee.')
  })

  it('leads with “Paused.” alone in paused-ink when the pause has no end (K169)', async () => {
    await mountWeek(PAUSED)
    usePlannerStore().nextWeek()
    await settle()
    const row = screen('t1').findAll('[data-testid="paused-row"]')[0]!
    const lead = row.get('[data-testid="paused-lead"]')
    expect(lead.text()).toBe('Paused.')
    expect(lead.classes()).toEqual(expect.arrayContaining(['text-paused-ink', 'font-semibold']))
    expect(row.element.textContent!.trim()).toBe('Paused. A cold.')
  })

  it('reads the lead alone when the pause has no reason', async () => {
    const run: Run = structuredClone(RUN)
    const next = run.grid.weeks.find((w) => w.monday === NEXT)!
    next.cells.deadlift = { ...next.cells.deadlift!, reason: null }
    await mountWeek(run)
    usePlannerStore().nextWeek()
    await settle()
    const row = screen('t1').get('[data-testid="paused-row"]')
    expect(row.element.textContent!.trim()).toBe('Paused until Thu 26 Nov.')
    expect(row.get('[data-testid="paused-lead"]').text()).toBe('Paused until Thu 26 Nov.')
  })

  it('reads the run once, and again when the state says it changed', async () => {
    await mountWeek()
    const reads = () => calls.filter((c) => c.path === '/runs/t1').length
    expect(reads()).toBe(1)
    usePlannerStore().nextWeek()
    await useSyncStore().refresh()
    await settle()
    expect(reads()).toBe(1)
    ;(extra.runs.t1 as { rev: string }).rev = 'changed'
    await useSyncStore().refresh()
    await settle()
    expect(reads()).toBe(2)
  })
})

describe('Edit plan on a programme tracker (spec §9.5)', () => {
  it('offers no Add: its rows link to each activity’s own page', async () => {
    await mountWeek()
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    await settle()
    expect(screen('t1').find('[data-testid="add-t1"]').exists()).toBe(false)
    expect(screen('t1').find('[data-testid="delete-t1"]').exists()).toBe(true)
    expect(screen('t1').find('[data-testid="programme-week-link"]').exists()).toBe(false)
    expect(screen('t1').get('[data-testid="item-name"]').attributes('href')).toBe('#/item/t1/squat')
    // An ordinary tracker keeps its Add.
    expect(screen('exercise').find('[data-testid="add-exercise"]').exists()).toBe(true)
  })
})
