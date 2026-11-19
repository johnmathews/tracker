import './setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { WorkChart, WorkLegend } from '@/components/ui/work-chart'
import type { Work, WorkSeries, WorkWeek } from '@/lib/programmes'
import WORK_JSON from '@/lib/__tests__/programmes/work.json'

/**
 * The WorkChart card (K180, K181, work-charts spec §6): a column per week, outlined at the work
 * planned and filled with pen to the work done, this week on a band; a long programme scrolls
 * sideways inside the chart with the axis fixed, its week numbers thinned to stay apart.
 */

// jsdom has no layout: the chart's box is as wide as each test says.
const box = vi.hoisted(() => ({ width: 0 }))
vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  const { ref } = await import('vue')
  return { ...actual, useElementSize: () => ({ width: ref(box.width), height: ref(0) }) }
})

const WORK = WORK_JSON as unknown as Work
const TOTAL = WORK.total!
const THIS_WEEK = '2026-11-09'

/** A Monday `i` weeks after Mon 2 Mar 2026. */
function monday(i: number): string {
  return new Date(Date.UTC(2026, 2, 2 + 7 * i)).toISOString().slice(0, 10)
}

/** A programme of `n` weeks in its week `at` (1-based), each week planning 1,000 kg. */
function long(n: number, at: number | null): { series: WorkSeries; current: string | null } {
  const weeks: WorkWeek[] = Array.from({ length: n }, (_, i) => ({
    monday: monday(i),
    programmeWeeks: [i + 1],
    planned: 1000,
    done: at === null || i < at ? 800 : null,
  }))
  return { series: { unit: 'kg', weeks }, current: at === null ? null : monday(at - 1) }
}

let wrapper: VueWrapper | undefined

function draw(
  series: WorkSeries = TOTAL,
  current: string | null = THIS_WEEK,
  width = 0,
  height = 300,
): void {
  box.width = width
  wrapper = mount(WorkChart, {
    props: { series, current, height, label: 'The whole programme: work in kg planned and done' },
    attachTo: document.body,
  })
}

const svg = () => wrapper!.get('[data-testid="work-chart"]')
const plot = () => wrapper!.get('[data-testid="work-chart-plot"]')
const axis = () => wrapper!.get('svg[data-axis]')
const tip = () => wrapper!.get('[data-testid="work-chart-tip"]')
const texts = (selector: string, root = svg()) => root.findAll(selector).map((t) => t.text())

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
})

describe('the columns (K180)', () => {
  it('draws a column per week, outlined at planned and filled with pen to done', () => {
    draw()
    const planned = svg().findAll('rect[data-planned]')
    expect(planned).toHaveLength(8)
    // Weeks 1 to 4 are done or under way; this week counts its marks so far.
    expect(
      svg()
        .findAll('rect[data-done]')
        .map((r) => r.attributes('data-week')),
    ).toEqual(['0', '1', '2', '3'])
    expect(svg().get('rect[data-done]').classes()).toContain('fill-pen')
    // A full week's fill and its outline meet: the outline sits 0.75px inside its edges.
    const [fill, outline] = [svg().get('rect[data-done]'), planned[0]!]
    expect(Number(outline.attributes('y')) - Number(fill.attributes('y'))).toBeCloseTo(0.75)
    expect(outline.attributes('stroke-width')).toBe('1.5')
  })

  it('draws the weeks to come dashed in control-border, the others solid in ink-secondary', () => {
    draw()
    const planned = svg().findAll('rect[data-planned]')
    expect(planned.map((r) => r.attributes('data-future') !== undefined)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ])
    expect(planned[0]!.classes()).toContain('stroke-ink-secondary')
    expect(planned[0]!.attributes('stroke-dasharray')).toBeUndefined()
    expect(planned[5]!.classes()).toContain('stroke-control-border')
    expect(planned[5]!.attributes('stroke-dasharray')).toBe('4 3')
  })

  it('leaves out a week that plans nothing, and fills nothing where nothing was done', () => {
    const deadlift = WORK.activities.find((a) => a.key === 'deadlift')!
    draw(deadlift, THIS_WEEK, 0, 200)
    // Week 5 is paused (W6); week 4 is under way with nothing done yet.
    expect(
      svg()
        .findAll('rect[data-planned]')
        .map((r) => r.attributes('data-week')),
    ).not.toContain('4')
    expect(
      svg()
        .findAll('rect[data-done]')
        .map((r) => r.attributes('data-week')),
    ).toEqual(['0', '1', '2'])
    expect(svg().attributes('height')).toBe('200')
  })

  it('sits this week on a tile band, and has none when no week is this week', () => {
    draw()
    const band = svg().get('rect[data-band]')
    expect(band.classes()).toContain('fill-tile')
    const hit = svg().findAll('rect[data-hit]')[3]!
    expect(Number(band.attributes('x'))).toBeGreaterThan(Number(hit.attributes('x')))
    wrapper!.unmount()
    draw(TOTAL, null)
    expect(svg().find('rect[data-band]').exists()).toBe(false)
    expect(svg().find('text[data-current]').exists()).toBe(false)
  })

  it('puts the value axis at the left, from nothing, with its unit above it', () => {
    draw()
    expect(texts('text[data-tick]', axis())).toEqual(['0', '5,000', '10,000', '15,000'])
    expect(axis().get('text[data-unit]').text()).toBe('kg')
    expect(axis().attributes('aria-hidden')).toBe('true')
    // The axis is wide enough for "15,000".
    expect(Number(axis().attributes('width'))).toBe(70)
    expect(svg().findAll('line[data-rule]')).toHaveLength(4)
  })

  it('spaces its axis in steps of 1, 2 or 5 times a power of ten', () => {
    const flat = (planned: number): WorkSeries => ({
      unit: 's',
      weeks: [{ monday: THIS_WEEK, programmeWeeks: [1], planned, done: null }],
    })
    const ticks = (planned: number) => {
      draw(flat(planned))
      const out = texts('text[data-tick]', axis())
      wrapper!.unmount()
      return out
    }
    expect(ticks(400)).toEqual(['0', '100', '200', '300', '400'])
    expect(ticks(405)).toEqual(['0', '200', '400', '600'])
    expect(ticks(28)).toEqual(['0', '10', '20', '30'])
    expect(ticks(0)).toEqual(['0', '1'])
  })

  it('lays a shorter series on the grid’s weeks by Monday, so it lines up with the total', async () => {
    // Plank, added in week 2 and ended after week 6: no entries for weeks 1, 7 and 8.
    const plank = WORK.activities.find((a) => a.key === 'plank')!
    const short: WorkSeries = { unit: 's', weeks: plank.weeks.slice(1, 6) }
    const frame = TOTAL.weeks.map((w) => ({ monday: w.monday, programmeWeeks: w.programmeWeeks }))
    box.width = 0
    wrapper = mount(WorkChart, {
      props: { series: short, frame, current: THIS_WEEK, height: 200, label: 'Plank' },
      attachTo: document.body,
    })
    const planned = svg().findAll('rect[data-planned]')
    expect(planned.map((r) => r.attributes('data-week'))).toEqual(['1', '2', '3', '4', '5'])
    // Every week keeps its place and its number; this week is still the fourth.
    expect(svg().findAll('rect[data-hit]')).toHaveLength(8)
    expect(texts('text[data-label]')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(svg().get('text[data-current]').text()).toBe('4')
    const atWeek2 = Number(planned[0]!.attributes('x'))
    wrapper.unmount()
    // The whole series, with an axis as wide, draws week 2 in the same place.
    draw(plank, THIS_WEEK, 0, 200)
    expect(Number(svg().findAll('rect[data-planned]')[1]!.attributes('x'))).toBe(atWeek2)
    wrapper!.unmount()
    wrapper = mount(WorkChart, {
      props: { series: short, frame, current: THIS_WEEK, height: 200, label: 'Plank' },
      attachTo: document.body,
    })
    // The table lists the weeks it has; a week with none shows no panel.
    expect(wrapper.findAll('[data-testid="work-chart-table"] tbody tr')).toHaveLength(5)
    await svg().findAll('rect[data-hit]')[0]!.trigger('pointerenter')
    expect(tip().attributes('hidden')).toBeDefined()
    await svg().findAll('rect[data-hit]')[1]!.trigger('pointerenter')
    expect(tip().text()).toContain('Week 2 ·')
  })

  it('draws an empty series as its axis alone', () => {
    draw({ unit: 'reps', weeks: [] }, THIS_WEEK)
    expect(svg().findAll('rect[data-planned]')).toHaveLength(0)
    expect(svg().findAll('text[data-label]')).toHaveLength(0)
    expect(texts('text[data-tick]', axis())).toEqual(['0', '1'])
    expect(axis().get('text[data-unit]').text()).toBe('reps')
  })
})

describe('the week numbers', () => {
  it('reads “Wk 1” to the last week under a wide plot, this week’s in ink at 600', () => {
    draw(TOTAL, THIS_WEEK, 800)
    expect(texts('text[data-label]')).toEqual(['Wk 1', '2', '3', '4', '5', '6', '7', '8'])
    expect(axis().find('text[data-wk]').exists()).toBe(false)
    const now = svg().get('text[data-current]')
    expect(now.text()).toBe('4')
    expect(now.classes()).toEqual(expect.arrayContaining(['fill-ink', 'font-semibold']))
    expect(svg().get('text[data-label]').classes()).toContain('fill-ink-secondary')
    // Wide columns: the band keeps 2px each side and its corners 4px; the weeks to come dash 5 4.
    expect(svg().get('rect[data-band]').attributes('rx')).toBe('4')
    expect(svg().find('rect[data-future]').attributes('stroke-dasharray')).toBe('5 4')
  })

  it('moves “Wk” to the axis when a column has no room for “Wk 1”', () => {
    draw()
    expect(axis().get('text[data-wk]').text()).toBe('Wk')
    expect(texts('text[data-label]')[0]).toBe('1')
  })

  it('reads a split week as both numbers, and a week with none as a dash', () => {
    const weeks: WorkWeek[] = [
      { monday: monday(0), programmeWeeks: [], planned: 0, done: 0 },
      { monday: monday(1), programmeWeeks: [1, 2], planned: 500, done: 500 },
    ]
    draw({ unit: 'kg', weeks }, monday(1), 800)
    expect(texts('text[data-label]')).toEqual(['Wk –', '1/2'])
  })
})

describe('a long programme (K181)', () => {
  it('keeps a column per week, 18px apart, the plot scrolling inside itself', () => {
    const { series, current } = long(104, 40)
    draw(series, current)
    expect(plot().attributes('data-scroll')).toBeDefined()
    expect(plot().classes()).toContain('overflow-x-auto')
    expect(svg().findAll('rect[data-planned]')).toHaveLength(104)
    expect(svg().attributes('width')).toBe(String(104 * 18 + 8))
    const hits = svg().findAll('rect[data-hit]')
    expect(Number(hits[1]!.attributes('x')) - Number(hits[0]!.attributes('x'))).toBe(18)
    // The axis and "Wk" stay outside the scrolling box, at the left.
    expect(plot().find('svg[data-axis]').exists()).toBe(false)
    expect(axis().get('text[data-wk]').text()).toBe('Wk')
    // Narrow columns: the band keeps 1px each side, its corners 3px.
    expect(svg().get('rect[data-band]').attributes('rx')).toBe('3')
  })

  it('fits the same weeks across a wide box without scrolling', () => {
    const { series, current } = long(20, 8)
    draw(series, current, 1200)
    expect(plot().attributes('data-scroll')).toBeUndefined()
    expect(plot().classes()).not.toContain('overflow-x-auto')
  })

  it('thins the numbers to stay apart, this week’s always showing and touching none', async () => {
    const { series, current } = long(104, 40)
    draw(series, current)
    const shown = () =>
      svg()
        .findAll('text[data-label]')
        .map((t) => ({ x: Number(t.attributes('x')), text: t.text() }))
        .sort((a, b) => a.x - b.x)
    await wrapper!.vm.$nextTick()
    // Opened on week 40 (jsdom's box has no width, so it starts at week 40's centre, 711px in).
    // Its neighbours on the thinned rhythm, 39 and 41, would touch it; numbers the box's edges
    // would cut are left out.
    expect(shown().map((l) => l.text)).toEqual(['40', '43', '45', '47', '49', '51'])
    expect(svg().get('text[data-current]').text()).toBe('40')
    const list = shown()
    for (let k = 1; k < list.length; k++) {
      const [a, b] = [list[k - 1]!, list[k]!]
      expect(b.x - a.x).toBeGreaterThanOrEqual(((a.text.length + b.text.length) * 9) / 2 + 8)
    }
    // Scrolled back to the start, the rhythm reads 1, 3, 5, 7…, and this week's still shows.
    plot().element.scrollLeft = 0
    await plot().trigger('scroll')
    expect(
      shown()
        .map((l) => l.text)
        .slice(0, 4),
    ).toEqual(['1', '3', '5', '7'])
    expect(shown().at(-1)!.text).toBe('40')
  })

  it('opens with this week about two thirds across', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const { series, current } = long(104, 40)
    draw(series, current)
    // Week 40's centre, 711px in, sits 200px from the box's left edge.
    expect(plot().element.scrollLeft).toBe(39 * 18 + 9 - 200)
  })

  it('opens an ended programme at its end, and one still to start at its start', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const ended = long(104, null)
    draw(ended.series, null)
    expect(plot().element.scrollLeft).toBe(103 * 18 + 9 - 200)
    wrapper!.unmount()
    const upcoming = long(104, 0)
    draw(upcoming.series, null)
    expect(plot().element.scrollLeft).toBe(0)
  })

  it('keeps a week moved to with the arrows in view, and its panel over its column', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const { series, current } = long(104, 40)
    draw(series, current, 800)
    const L = Number(axis().attributes('width'))
    await svg().trigger('focus')
    expect(plot().element.scrollLeft).toBe(511)
    expect(tip().attributes('style')).toContain(`left: ${L + 711 - 511}px`)
    await svg().trigger('keydown', { key: 'Home' })
    expect(plot().element.scrollLeft).toBe(0)
    await svg().trigger('keydown', { key: 'End' })
    expect(plot().element.scrollLeft).toBe(104 * 18 - 300)
    await svg().trigger('keydown', { key: 'ArrowLeft' })
    expect(plot().element.scrollLeft).toBe(104 * 18 - 300)
    // Scrolled by hand, the panel follows the column.
    plot().element.scrollLeft = 1000
    await plot().trigger('scroll')
    await svg().findAll('rect[data-hit]')[60]!.trigger('pointerenter')
    expect(tip().attributes('style')).toContain(`left: ${L + 60 * 18 + 9 - 1000}px`)
  })
})

describe('the numbers', () => {
  it('gives a screen reader every week’s planned and done, in a hidden box', () => {
    draw()
    const table = wrapper!.get('[data-testid="work-chart-table"]')
    expect(table.element.parentElement!.className).toContain('sr-only')
    expect(table.get('caption').text()).toBe('The whole programme: work in kg planned and done')
    const rows = table.findAll('tbody tr').map((r) => r.findAll('th, td').map((c) => c.text()))
    expect(rows).toHaveLength(8)
    expect(rows[0]).toEqual(['Week 1, 19–25 Oct', '5,600 kg', '5,600 kg'])
    expect(rows[3]).toEqual(['Week 4, 9–15 Nov', '5,400 kg', '1,575 kg so far'])
    expect(rows[6]).toEqual(['Week 7, 30 Nov–6 Dec', '11,400 kg', ''])
    expect(svg().attributes('role')).toBe('img')
    expect(svg().attributes('aria-label')).toBe('The whole programme: work in kg planned and done')
  })

  it('shows a week’s numbers under the pointer, tinting its column, and none once it leaves', async () => {
    draw()
    expect(tip().attributes('hidden')).toBeDefined()
    const hit = () => svg().findAll('rect[data-hit]')[3]!
    await hit().trigger('pointerenter')
    expect(tip().attributes('hidden')).toBeUndefined()
    expect(tip().text()).toBe('Week 4 · 9–15 NovPlanned 5,400 kgDone 1,575 kg so far')
    expect(hit().classes()).toContain('fill-ink/6')
    await hit().trigger('pointerleave')
    expect(tip().attributes('hidden')).toBeDefined()
    expect(hit().classes()).toContain('fill-transparent')
    // A week to come has no done.
    await svg().findAll('rect[data-hit]')[6]!.trigger('pointerenter')
    expect(tip().findAll('span')).toHaveLength(1)
    // The panel stays inside the chart: at least 80px from its right edge (280px wide here).
    await svg().findAll('rect[data-hit]')[7]!.trigger('pointerenter')
    expect(tip().attributes('style')).toContain('left: 200px')
  })

  it('shows a week’s numbers on focus too, the arrows moving between weeks', async () => {
    draw()
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
    // With no week this week, focus starts on the first.
    wrapper!.unmount()
    draw(TOTAL, null)
    await svg().trigger('focus')
    expect(tip().text()).toContain('Week 1 ·')
    expect(tip().text()).not.toContain('so far')
  })

  it('opens again on this week when the weeks change', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    draw()
    expect(plot().element.scrollLeft).toBe(0)
    await wrapper!.setProps({ series: long(104, 40).series, current: monday(39) })
    expect(plot().element.scrollLeft).toBe(511)
  })
})

describe('the legend', () => {
  it('says Planned, Still to come and Done, its swatches hidden from a screen reader', () => {
    const legend = mount(WorkLegend)
    expect(legend.findAll('li').map((li) => li.text())).toEqual([
      'Planned',
      'Still to come',
      'Done',
    ])
    expect(legend.findAll('span[aria-hidden="true"]')).toHaveLength(3)
    expect(legend.findAll('li')[1]!.get('span').classes()).toContain('border-dashed')
    expect(legend.findAll('li')[2]!.get('span').classes()).toContain('bg-pen')
    legend.unmount()
  })
})
