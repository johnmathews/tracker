import './setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { activityChart, type ActivityChart } from '@/components/ui/programme-chart/chart'
import { ProgrammeChart } from '@/components/ui/programme-chart'
import type { Cell, LogEntry, Run } from '@/lib/programmes'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import PAUSED_JSON from '@/lib/__tests__/programmes/run-paused.json'

/**
 * The ProgrammeChart card (K145, spec §9.4): an activity's planned value week by week from the
 * run's grid (P4: nothing computed here but where to draw it), with what was done on top, gaps for
 * pauses and a labelled line for each change, its numbers in a hidden table and on hover.
 */

const RUN = RUN_JSON as unknown as Run
const PAUSED = PAUSED_JSON as unknown as Run

/** A copy of the run, changed by `edit`. */
function runWith(edit: (run: Run) => void, from: Run = RUN): Run {
  const run = structuredClone(from)
  edit(run)
  return run
}

function chart(key: string, run: Run = RUN): ActivityChart {
  return activityChart(run, key)!
}

describe('the chart’s data, from the run’s grid', () => {
  it('charts the field the activity progresses, a value per week, solid up to this week', () => {
    const c = chart('squat')
    expect([c.name, c.field, c.unit]).toEqual(['Back squat', 'weight', 'kg'])
    expect(c.weeks.map((w) => w.number)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(c.weeks.map((w) => w.value)).toEqual([40, 42.5, 45, 42.5, 47.5, 50, 52.5, 50])
    expect(c.weeks.map((w) => w.dates)).toEqual([
      '19–25 Oct',
      '26 Oct–1 Nov',
      '2–8 Nov',
      '9–15 Nov',
      '16–22 Nov',
      '23–29 Nov',
      '30 Nov–6 Dec',
      '7–13 Dec',
    ])
    expect(c.now).toBe(3)
    expect(c.weeks[3]).toMatchObject({ current: true, label: 'Deload', plan: '42.5 kg, 3 × 5' })
    expect(c.label).toBe('Back squat: planned weight for each week, with the weeks done so far')
  })

  it('counts the weeks done so far against each week’s goal, any mark counting', () => {
    const c = chart('squat')
    // Week 1 started on a Friday, so its goal counts Friday to Sunday: 3 x 3 / 7, rounded up (K163).
    expect(c.weeks.map((w) => w.done)).toEqual([
      { done: 2, target: 2, met: true },
      { done: 3, target: 3, met: true },
      { done: 0, target: 3, met: false },
      { done: 0, target: 3, met: false },
      null,
      null,
      null,
      null,
    ])
    expect(c.weeks.map((w) => w.doneText)).toEqual([
      '2 of 2, goal met',
      '3 of 3, goal met',
      '0 of 3',
      '0 of 3 so far',
      '',
      '',
      '',
      '',
    ])
  })

  it('says this week’s plan and how it goes up', () => {
    expect(chart('squat').lede).toEqual({
      before: 'This week is a deload: ',
      value: '42.5 kg',
      after: ', 3 × 5. It goes up 5% a week.',
    })
    expect(chart('row').lede.after).toBe(', 3 × 5. It goes up 2.5 kg a week.')
    // A time that goes up every two weeks; no label on a week that has none.
    const plank = chart('plank')
    expect([plank.field, plank.unit]).toEqual(['duration', 's'])
    expect(plank.lede).toEqual({
      before: 'This week is a deload: ',
      value: '35 s',
      after: ', 3 sets. It goes up 5 s every 2 weeks.',
    })
    const week5 = runWith((r) => {
      for (const w of r.grid.weeks) w.current = w.monday === '2026-11-16'
    })
    expect(chart('squat', week5).lede.before).toBe('This week: ')
  })

  it('takes the increase from the latest Set increase in force, not the document', () => {
    const entry = (seq: number, from: string, change: object, undoneBy: number | null = null) =>
      ({
        seq,
        madeAt: 0,
        from,
        change: { type: 'set-increase', activity: 'squat', field: 'weight', ...change },
        reason: null,
        source: 'app',
        undoneBy,
        undoable: false,
      }) as LogEntry
    const run = runWith((r) => {
      r.log = [
        entry(7, '2026-11-30', { rate: 10 }), // not in force yet
        entry(6, '2026-11-02', { rate: 9 }, 8), // undone
        entry(5, '2026-10-30', { rate: 7.5 }),
        ...r.log,
      ]
    })
    const c = chart('squat', run)
    expect(c.lede.after).toBe(', 3 × 5. It goes up 7.5% a week.')
    // Each change of the charted field is a labelled line where it took effect.
    expect(c.changes).toEqual([
      { at: 1 + 4 / 7, label: '7.5% a week, from 30 Oct' },
      { at: 6, label: '10% a week, from 30 Nov' },
    ])
    const add = runWith((r) => {
      r.log = [entry(5, '2026-11-02', { rate: undefined, add: 5 }), ...r.log]
    })
    expect(chart('squat', add).lede.after).toBe(', 3 × 5. It goes up 5 kg a week.')
    expect(chart('squat', add).changes).toEqual([{ at: 2, label: '5 kg a week, from 2 Nov' }])
  })

  it('draws a value changed mid-week as two steps, and labels the change', () => {
    const c = chart('bench')
    expect(c.weeks[3]!.segments).toEqual([
      { from: 0, value: 35 },
      { from: 3 / 7, value: 27.5 },
    ])
    expect(c.weeks[3]!.plan).toBe('35 kg, then 27.5 kg from Thu, 3 × 5')
    expect(c.changes).toEqual([{ at: 3 + 3 / 7, label: '30 kg, from 12 Nov' }])
    // A change outside the grid, an undone one and another activity's draw nothing.
    const run = runWith((r) => {
      r.log[0] = { ...r.log[0]!, from: '2027-03-01' }
    })
    expect(chart('bench', run).changes).toEqual([])
  })

  it('leaves a gap for a paused week, with the reason, and says when it comes back', () => {
    const c = chart('deadlift')
    expect(c.weeks[4]).toMatchObject({ state: 'paused', value: null, segments: [] })
    expect(c.weeks[4]!.plan).toBe('Paused, knee')
    expect(c.pauses).toEqual([{ from: 4, to: 4, reason: 'Knee' }])
    expect(c.lede).toEqual({
      before: 'Paused since Thu 12 Nov. Knee. It comes back on Thu 26 Nov at ',
      value: '80 kg',
      after: '.',
    })
    expect(c.endsShort).toBe('Deadlift ends at its week 7 of 8.')
    expect(chart('squat').endsShort).toBeNull()
  })

  it('says an activity paused until resumed comes back at its value when resumed', () => {
    const run = runWith((r) => {
      const clock = r.clock as unknown as { activities: Record<string, { until: string | null }> }
      clock.activities.deadlift!.until = null
      r.log[1] = { ...r.log[1]!, reason: null }
    })
    expect(chart('deadlift', run).lede).toEqual({
      before: 'Paused since Thu 12 Nov. Knee. It comes back at ',
      value: '67.5 kg',
      after: ' when you resume it.',
    })
    // A pause the log doesn't hold (an older run) says only that it is paused.
    const unlogged = runWith((r) => {
      r.log = r.log.filter((e) => e.change.type !== 'pause-activity')
    })
    expect(chart('deadlift', unlogged).lede.before).toBe(
      'Paused. Knee. It comes back on Thu 26 Nov at ',
    )
  })

  it('says the programme is paused while it is, with the reason', () => {
    const c = chart('squat', PAUSED)
    expect(c.lede).toEqual({ before: 'The programme is paused. A cold.', value: null, after: '' })
    expect(c.pauses).toEqual([{ from: 4, to: 7, reason: 'A cold' }])
    const until = runWith((r) => {
      r.clock.until = '2026-11-30'
      ;(r.clock as Record<string, unknown>).reason = null
    }, PAUSED)
    expect(chart('squat', until).lede.before).toBe('The programme is paused until Mon 30 Nov.')
  })

  it('says when an upcoming run starts, every week still to come', () => {
    const run = runWith((r) => {
      r.status = 'upcoming'
      r.today = '2026-10-01'
      for (const w of r.grid.weeks) {
        w.current = false
        w.locked = false
      }
    })
    const c = chart('squat', run)
    expect(c.now).toBe(-1)
    expect(c.weeks.every((w) => w.done === null)).toBe(true)
    expect(c.lede).toEqual({ before: 'It starts on Fri 23 Oct at ', value: '40 kg', after: '.' })
  })

  it('draws an ended run solid to its end, and says when it ended', () => {
    const run = runWith((r) => {
      r.status = 'ended'
      r.today = '2027-01-04'
      for (const w of r.grid.weeks) {
        w.current = false
        w.locked = true
      }
    })
    const c = chart('squat', run)
    expect(c.now).toBe(7)
    expect(c.weeks[7]!.doneText).toBe('0 of 3')
    expect(c.lede).toEqual({ before: 'The programme ended on Sun 13 Dec.', value: null, after: '' })
    const early = runWith((r) => {
      r.end = null
      r.ended = { from: '2026-12-01', reason: null, seq: 9 }
    }, run)
    expect(chart('squat', early).lede.before).toBe('The programme ended on Tue 1 Dec.')
  })

  it('says when an activity ended, and draws its weeks after as nothing', () => {
    const run = runWith((r) => {
      r.grid.activities.find((a) => a.key === 'row')!.endedOn = '2026-11-10'
      for (const w of r.grid.weeks.slice(4)) w.cells.row = { ...w.cells.row!, state: 'ended' }
    })
    const c = chart('row', run)
    expect(c.lede).toEqual({ before: 'It ended on Tue 10 Nov.', value: null, after: '' })
    expect(c.weeks[5]).toMatchObject({ value: null, plan: 'Ended', done: null })
    expect(c.pauses).toEqual([])
  })

  it('says when an activity added for later starts, and draws nothing before it', () => {
    const run = runWith((r) => {
      for (const w of r.grid.weeks.slice(0, 5)) {
        w.cells.plank = { ...w.cells.plank!, state: 'not-started', values: null, target: 0 }
      }
    })
    const c = chart('plank', run)
    expect(c.weeks[0]).toMatchObject({ plan: 'Not started', value: null, done: null })
    expect(c.lede).toEqual({ before: 'It starts on Mon 23 Nov at ', value: '40 s', after: '.' })
  })

  it('charts a cardio session’s time in minutes, and its distance when it has no time', () => {
    const cell = (values: Cell['values']): Cell => ({
      state: 'running',
      activityWeek: 1,
      values,
      target: 2,
      splits: {},
      hand: {},
      until: null,
      reason: null,
      marks: [null, null, null, null, null, null, null],
    })
    const run = runWith((r) => {
      r.kind = 'cardio'
      r.doc = { ...r.doc, kind: 'cardio', activities: [{ key: 'run', name: 'Run' }] }
      r.grid.activities = [
        { key: 'run', name: 'Run', addedOn: r.start, addedBy: null, endedOn: null },
      ]
      r.grid.weeks.forEach(
        (w, i) => (w.cells = { run: cell({ duration: 1200 + 300 * i, target: 2 }) }),
      )
      r.endsShort = []
    })
    const c = chart('run', run)
    expect([c.field, c.unit]).toEqual(['duration', 'min'])
    expect(c.weeks[1]!.value).toBe(25)
    expect(c.weeks[1]!.plan).toBe('25 min')
    expect(c.lede).toEqual({ before: 'This week is a deload: ', value: '35 min', after: '.' })
    const far = runWith((r) => {
      r.grid.weeks.forEach((w) => (w.cells = { run: cell({ distance: 5, target: 2 }) }))
    }, run)
    expect([chart('run', far).field, chart('run', far).unit]).toEqual(['distance', 'km'])
  })

  it('reads the increase of an activity added to the run from the change that added it', () => {
    const run = runWith((r) => {
      r.grid.activities.push({
        key: 'dips',
        name: 'Dips',
        addedOn: r.start,
        addedBy: 4,
        endedOn: null,
      })
      for (const w of r.grid.weeks)
        w.cells.dips = { ...w.cells.row!, values: { weight: 10, target: 2 } }
      r.log = [
        {
          seq: 4,
          madeAt: 0,
          from: r.start,
          change: {
            type: 'add-activity',
            activity: { key: 'dips', name: 'Dips', weight: { start: 10, add: 5 } },
          },
          reason: null,
          source: 'app',
          undoneBy: null,
          undoable: false,
        },
        ...r.log,
      ]
    })
    expect(chart('dips', run).lede.after).toBe('. It goes up 5 kg a week.')
  })

  it('draws what the grid leaves out as nothing', () => {
    const run = runWith((r) => {
      // No cell in the first week, no programme week in the second, a pause with no reason.
      delete r.grid.weeks[0]!.cells.deadlift
      r.grid.weeks[1]!.programmeWeeks = []
      r.grid.weeks[4]!.cells.deadlift!.reason = null
      // Comes back after the grid ends, with no value that week either.
      const clock = r.clock as unknown as { activities: Record<string, { until: string | null }> }
      clock.activities.deadlift!.until = '2027-02-01'
      r.grid.weeks[3]!.cells.deadlift!.values = null
    })
    const c = chart('deadlift', run)
    expect(c.weeks[0]).toMatchObject({ state: 'not-started', plan: 'Not started', value: null })
    expect(c.weeks[1]!.number).toBe('–')
    expect(c.weeks[4]!.plan).toBe('Paused')
    expect(c.lede).toEqual({
      before: 'Paused since Thu 12 Nov. Knee. It comes back on Mon 1 Feb at ',
      value: null,
      after: '.',
    })
    // An activity with no values in any week has no lede and charts its goal.
    const empty = runWith((r) => {
      for (const w of r.grid.weeks)
        w.cells.plank = { ...w.cells.plank!, state: 'ended', values: null }
    })
    expect(chart('plank', empty).field).toBe('target')
    expect(chart('plank', empty).lede).toEqual({ before: '', value: null, after: '' })
    // A run whose clock lists no activities reads each as running.
    const bare = runWith((r) => {
      delete (r.clock as Record<string, unknown>).activities
    })
    expect(chart('deadlift', bare).lede.before).toBe('This week is a deload: ')
  })

  it('has no chart for an activity the run doesn’t have', () => {
    expect(activityChart(RUN, 'nope')).toBeNull()
  })
})

describe('the chart (K145)', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
  })

  function draw(c: ActivityChart = chart('squat')): VueWrapper {
    wrapper = mount(ProgrammeChart, { props: { chart: c }, attachTo: document.body })
    return wrapper
  }

  const svg = () => wrapper!.get('[data-testid="programme-chart"]')

  it('is an image named for what it shows, with its legend’s words', () => {
    draw()
    expect(svg().attributes('role')).toBe('img')
    expect(svg().attributes('aria-label')).toBe(
      'Back squat: planned weight for each week, with the weeks done so far',
    )
    const legend = wrapper!.get('[data-testid="programme-chart-legend"]')
    expect(legend.findAll('li').map((l) => l.text())).toEqual([
      'Planned',
      'Still to come',
      'Goal met',
      'Goal not met',
    ])
    expect(legend.findAll('svg').every((s) => s.attributes('aria-hidden') === 'true')).toBe(true)
  })

  it('draws the plan solid to this week and dashed after, with this week’s band', () => {
    draw()
    expect(svg().findAll('path[data-plan="done"]')).toHaveLength(1)
    expect(svg().findAll('path[data-plan="ahead"]').length).toBeGreaterThan(0)
    expect(svg().find('rect[data-band]').exists()).toBe(true)
    // The week numbers under the plot, this week's in ink.
    const numbers = svg().findAll('text[data-week]')
    expect(numbers.map((t) => t.text())).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(numbers[3]!.attributes('data-current')).toBe('')
    // The unit over the value axis; this week's value and the last week's written.
    expect(svg().get('text[data-unit]').text()).toBe('kg')
    expect(
      svg()
        .findAll('text[data-value]')
        .map((t) => t.text()),
    ).toEqual(['42.5', '50'])
  })

  it('puts a pen dot on a week that met its goal, and a ring with its count on one that didn’t', () => {
    draw()
    expect(svg().findAll('circle[data-met]')).toHaveLength(2)
    expect(svg().findAll('circle[data-unmet]')).toHaveLength(2)
    expect(
      svg()
        .findAll('text[data-count]')
        .map((t) => t.text()),
    ).toEqual(['0 of 3', '0 of 3'])
  })

  it('draws a labelled line for each change, and a gap with its reason for a pause', () => {
    draw(chart('bench'))
    expect(svg().findAll('line[data-change]')).toHaveLength(1)
    expect(svg().get('text[data-change]').text()).toBe('30 kg, from 12 Nov')
    wrapper!.unmount()
    draw(chart('squat', PAUSED))
    expect(svg().findAll('line[data-pause]')).toHaveLength(2)
    expect(
      svg()
        .findAll('text[data-pause]')
        .map((t) => t.text()),
    ).toEqual(['Paused', 'A cold'])
    // A gap too narrow for its words keeps its lines; the lede, the table and the panel say why.
    wrapper!.unmount()
    draw(chart('deadlift'))
    expect(svg().findAll('line[data-pause]')).toHaveLength(2)
    expect(svg().findAll('text[data-pause]')).toHaveLength(0)
  })

  it('labels a change near the right edge on its left', () => {
    const c = chart('squat')
    draw({ ...c, changes: [{ at: 7.9, label: 'A long label near the end of the chart' }] })
    expect(svg().get('text[data-change]').attributes('text-anchor')).toBe('end')
    wrapper!.unmount()
    draw({ ...c, changes: [{ at: 0, label: '5 kg' }] })
    expect(svg().get('text[data-change]').attributes('text-anchor')).toBe('start')
  })

  it('spaces its value axis for a flat line, and for one at nothing', () => {
    const c = chart('squat')
    const flat = (value: number) => ({
      ...c,
      weeks: c.weeks.map((w) => ({ ...w, value, segments: [{ from: 0, value }] })),
    })
    draw(flat(50))
    expect(
      svg()
        .findAll('text[data-tick]')
        .map((t) => t.text()),
    ).toEqual(['40', '60'])
    wrapper!.unmount()
    draw(flat(0))
    expect(
      svg()
        .findAll('text[data-tick]')
        .map((t) => t.text()),
    ).toEqual(['0', '0.5'])
  })

  it('draws an upcoming run all dashed, and one with nothing to draw still has its axis', () => {
    const c = chart('squat')
    draw({ ...c, now: -1, weeks: c.weeks.map((w) => ({ ...w, done: null, current: false })) })
    expect(svg().findAll('path[data-plan="done"]')).toHaveLength(0)
    expect(svg().find('rect[data-band]').exists()).toBe(false)
    wrapper!.unmount()
    draw({ ...c, weeks: c.weeks.map((w) => ({ ...w, value: null, segments: [], done: null })) })
    expect(svg().findAll('path[data-plan]')).toHaveLength(0)
    expect(svg().findAll('text[data-tick]').length).toBeGreaterThan(1)
  })

  it('gives a screen reader the same numbers as a table, in a hidden box', () => {
    draw()
    const table = wrapper!.get('[data-testid="programme-chart-table"]')
    expect(table.element.parentElement!.className).toContain('sr-only')
    expect(table.get('caption').text()).toBe('Back squat, week by week')
    const rows = table.findAll('tbody tr').map((r) => r.findAll('th, td').map((c) => c.text()))
    expect(rows[3]).toEqual(['Week 4, 9–15 Nov', '42.5 kg, 3 × 5, deload', '0 of 3 so far'])
    expect(rows[1]).toEqual(['Week 2, 26 Oct–1 Nov', '42.5 kg, 5 × 5', '3 of 3, goal met'])
  })

  it('shows a week’s numbers under the pointer, and none once it leaves', async () => {
    draw()
    const tip = () => wrapper!.get('[data-testid="programme-chart-tip"]')
    expect(tip().attributes('hidden')).toBeDefined()
    await svg().findAll('rect[data-hit]')[3]!.trigger('pointerenter')
    expect(tip().attributes('hidden')).toBeUndefined()
    expect(tip().text()).toBe('Week 4 · 9–15 Nov42.5 kg, 3 × 5, deload0 of 3 so far')
    await svg().findAll('rect[data-hit]')[3]!.trigger('pointerleave')
    expect(tip().attributes('hidden')).toBeDefined()
    // A week to come has no count.
    await svg().findAll('rect[data-hit]')[6]!.trigger('pointerenter')
    expect(tip().findAll('span')).toHaveLength(1)
  })

  it('shows a week’s numbers on focus too, the arrows moving between weeks', async () => {
    draw()
    const tip = () => wrapper!.get('[data-testid="programme-chart-tip"]')
    expect(svg().attributes('tabindex')).toBe('0')
    await svg().trigger('focus')
    expect(tip().text()).toContain('Week 4 ·')
    await svg().trigger('keydown', { key: 'ArrowRight' })
    expect(tip().text()).toContain('Week 5 ·')
    await svg().trigger('keydown', { key: 'ArrowLeft' })
    await svg().trigger('keydown', { key: 'ArrowLeft' })
    expect(tip().text()).toContain('Week 3 ·')
    await svg().trigger('keydown', { key: 'End' })
    await svg().trigger('keydown', { key: 'ArrowRight' })
    expect(tip().text()).toContain('Week 8 ·')
    await svg().trigger('keydown', { key: 'Home' })
    await svg().trigger('keydown', { key: 'ArrowLeft' })
    expect(tip().text()).toContain('Week 1 ·')
    await svg().trigger('keydown', { key: 'a' })
    expect(tip().text()).toContain('Week 1 ·')
    await svg().trigger('blur')
    expect(tip().attributes('hidden')).toBeDefined()
    // An upcoming run's focus starts on its first week.
    wrapper!.unmount()
    draw({ ...chart('squat'), now: -1 })
    await svg().trigger('focus')
    expect(tip().text()).toContain('Week 1 ·')
  })

  it('draws at its own width, folded at the phone’s height', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    draw()
    expect(svg().attributes('height')).toBe('240')
    expect(Number(svg().attributes('width'))).toBeGreaterThanOrEqual(280)
  })
})
