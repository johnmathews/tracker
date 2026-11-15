import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  BOX_PATH,
  DayMark,
  MARK_DRAWINGS,
  MARK_PENS,
  MARK_SYMBOLS,
  dayMarkLabel,
} from '@/components/ui/day-mark'
import { MARKS, MARK_SETS, markDrawing, markKind } from '@/lib/storage'

const PROPS = { name: 'Squats', date: 'Thursday 22 October', mark: null }

describe('DayMark', () => {
  it('is a toggle button named by its row and full date when empty', () => {
    const button = mount(DayMark, { props: PROPS }).get('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toBe('Squats, Thursday 22 October')
    expect(button.attributes('aria-pressed')).toBe('false')
    expect(button.attributes('aria-current')).toBeUndefined()
    expect(button.text()).toBe('')
  })

  it('says "today" in the name and sets aria-current, so today never rests on the band', () => {
    const wrapper = mount(DayMark, { props: { ...PROPS, mark: 'great', today: true } })
    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('Squats, Thursday 22 October, today')
    expect(button.attributes('aria-current')).toBe('date')
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(wrapper.attributes('data-today')).toBe('true')
    // The band belongs to the grid's cell, not to the mark.
    expect(wrapper.classes()).not.toContain('bg-highlight')
  })

  it('draws an empty hand-drawn box, and fills a marked one in its pen under the box', async () => {
    const wrapper = mount(DayMark, { props: PROPS })
    const box = () => wrapper.get('[data-slot="day-mark-box"]')
    const outline = () => wrapper.get('[data-slot="day-mark-outline"]')
    const stroke = () => wrapper.find('[data-slot="day-mark-stroke"]')
    expect(box().attributes('aria-hidden')).toBe('true')
    expect(box().attributes('data-mark')).toBeUndefined()
    expect(box().classes()).toEqual(expect.arrayContaining(['size-15', 'overflow-visible']))
    expect(outline().attributes('d')).toBe(BOX_PATH)
    expect(outline().classes()).toEqual(
      expect.arrayContaining(['stroke-control-border', 'group-hover:stroke-ink']),
    )
    expect(stroke().exists()).toBe(false)
    for (const mark of MARKS) {
      await wrapper.setProps({ mark })
      // The mark names both: its kind picks the pen, its drawing the path.
      expect(box().attributes('data-mark')).toBe(markKind(mark))
      expect(stroke().attributes('data-drawing')).toBe(markDrawing(mark))
      expect(stroke().attributes('d')).toBe(MARK_DRAWINGS[markDrawing(mark)])
      expect(stroke().classes()).toContain(MARK_PENS[markKind(mark)])
      expect(stroke().attributes('fill')).toBe('currentColor')
      expect(stroke().attributes('fill-rule')).toBe('evenodd')
      expect(wrapper.get('button').attributes('aria-pressed')).toBe('true')
      // Marked, the box no longer darkens on hover: the fill says it all.
      expect(outline().classes()).not.toContain('group-hover:stroke-ink')
    }
    // The box is drawn last, over the fill, as a pen line shows through marker.
    const paths = box().findAll('path')
    expect(paths.map((p) => p.attributes('data-slot'))).toEqual([
      'day-mark-stroke',
      'day-mark-outline',
    ])
  })

  it('has three different drawings, each traced as a filled outline', () => {
    expect(new Set(Object.values(MARK_DRAWINGS)).size).toBe(3)
    for (const d of Object.values(MARK_DRAWINGS)) expect(d).toMatch(/^M[\d. MCLZ-]+Z$/)
  })

  it('gives each kind its own pen', () => {
    expect(MARK_PENS).toEqual({
      great: 'text-pen',
      partial: 'text-pen-partial',
      missed: 'text-pen-missed',
    })
  })

  it('names a partial or missed day’s kind; a great day is said by aria-pressed alone', async () => {
    const wrapper = mount(DayMark, { props: { ...PROPS, mark: 'great' } })
    const label = () => wrapper.get('button').attributes('aria-label')
    expect(label()).toBe('Squats, Thursday 22 October')
    await wrapper.setProps({ mark: 'partial', today: true })
    expect(label()).toBe('Squats, Thursday 22 October, today, partly done')
    await wrapper.setProps({ mark: 'missed', today: false })
    expect(label()).toBe('Squats, Thursday 22 October, too difficult')
    // The drawing carries no meaning, so the name never says it.
    await wrapper.setProps({ mark: 'partial-hatch' })
    expect(label()).toBe('Squats, Thursday 22 October, partly done')
    await wrapper.setProps({ mark: 'great-solid' })
    expect(label()).toBe('Squats, Thursday 22 October')
  })

  it('centres a 64px button in a 76px cell, and changes colour in 120ms at most', () => {
    const wrapper = mount(DayMark, { props: PROPS })
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['size-19', 'relative']))
    expect(wrapper.get('button').classes()).toContain('size-16')
    expect(wrapper.get('[data-slot="day-mark-box"]').classes()).toContain('size-15')
    expect(wrapper.get('[data-slot="day-mark-outline"]').classes()).toContain(
      'motion-safe:duration-120',
    )
  })

  it('strokes a tick set’s symbol in its pen at a marker’s width, under the box', () => {
    const wrapper = mount(DayMark, { props: { ...PROPS, mark: 'partial', set: 'ticks' } })
    const symbol = wrapper.get('[data-slot="day-mark-symbol"]')
    expect(wrapper.find('[data-slot="day-mark-stroke"]').exists()).toBe(false)
    expect(symbol.classes()).toContain('text-pen-partial')
    expect(symbol.attributes('data-stamped')).toBe('false')
    expect(symbol.get('path').attributes('d')).toBe(MARK_SYMBOLS.ticks.partial.path)
    expect(symbol.get('path').attributes('stroke-width')).toBe('4.5')
    expect(symbol.findAll('circle')).toHaveLength(0)
    // The box is drawn last, over the symbol.
    const paths = wrapper.findAll('svg > *')
    expect(paths.at(-1)!.attributes('data-slot')).toBe('day-mark-outline')
  })

  it('draws a face with two eyes, and its mouth by kind', () => {
    for (const mark of ['great', 'partial', 'missed'] as const) {
      const wrapper = mount(DayMark, { props: { ...PROPS, mark, set: 'faces' } })
      const symbol = wrapper.get('[data-slot="day-mark-symbol"]')
      expect(symbol.classes()).toContain(MARK_PENS[mark])
      expect(symbol.get('path').attributes('d')).toBe(MARK_SYMBOLS.faces[mark].path)
      expect(symbol.findAll('circle')).toHaveLength(2)
    }
  })

  it('draws partial and too difficult as a wave in the tick sets and a so-so face in the face sets (K134, K135, K137)', () => {
    // A wave is one stroke; a cross was two.
    expect(MARK_SYMBOLS.ticks.missed.path.match(/M/g)).toHaveLength(1)
    expect(MARK_SYMBOLS.ticks.partial.path).toBe(MARK_SYMBOLS.ticks.missed.path)
    expect(MARK_SYMBOLS.faces.missed.path).toBe(MARK_SYMBOLS.faces.partial.path)
    const wrapper = mount(DayMark, { props: { ...PROPS, mark: 'missed', set: 'faces' } })
    expect(wrapper.get('[data-slot="day-mark-symbol"]').classes()).toContain('text-pen-missed')
    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Squats, Thursday 22 October, too difficult',
    )
  })

  it('stamps: the box filled solid in the pen, the symbol in paper on it', () => {
    const wrapper = mount(DayMark, { props: { ...PROPS, mark: 'missed', set: 'stamped-faces' } })
    const fill = wrapper.get('[data-slot="day-mark-stroke"]')
    expect(fill.attributes('d')).toBe(MARK_DRAWINGS.solid)
    expect(fill.classes()).toContain('text-pen-missed')
    const symbol = wrapper.get('[data-slot="day-mark-symbol"]')
    expect(symbol.classes()).toContain('text-canvas')
    expect(symbol.attributes('data-stamped')).toBe('true')
    expect(symbol.get('path').attributes('stroke-width')).toBe('3.25')
  })

  it('draws a squiggle mark as its kind’s symbol in a symbol set, keeping the name', () => {
    const wrapper = mount(DayMark, { props: { ...PROPS, mark: 'partial-hatch', set: 'ticks' } })
    expect(wrapper.get('[data-slot="day-mark-symbol"] path').attributes('d')).toBe(
      MARK_SYMBOLS.ticks.partial.path,
    )
    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Squats, Thursday 22 October, partly done',
    )
  })

  it('draws an empty day as the box alone in every set', () => {
    for (const set of MARK_SETS) {
      const wrapper = mount(DayMark, { props: { ...PROPS, set } })
      expect(wrapper.findAll('svg > *')).toHaveLength(1)
    }
  })

  it('emits toggle on click', async () => {
    const wrapper = mount(DayMark, { props: PROPS })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('shows the folded corner and says "has a note" only when a note exists', async () => {
    const wrapper = mount(DayMark, { props: PROPS })
    expect(wrapper.find('[data-slot="note-mark"]').exists()).toBe(false)
    await wrapper.setProps({ note: true, today: true })
    const corner = wrapper.get('[data-slot="note-mark"]')
    expect(corner.attributes('aria-hidden')).toBe('true')
    expect(corner.classes()).toEqual(expect.arrayContaining(['absolute', 'top-0', 'right-0']))
    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Squats, Thursday 22 October, today, has a note',
    )
  })

  it('builds the name the same way for other views (TodayList)', () => {
    expect(dayMarkLabel({ name: 'Fish', date: 'Saturday 24 October' })).toBe(
      'Fish, Saturday 24 October',
    )
    expect(dayMarkLabel({ name: 'Fish', date: 'Saturday 24 October', note: true })).toBe(
      'Fish, Saturday 24 October, has a note',
    )
  })
})
