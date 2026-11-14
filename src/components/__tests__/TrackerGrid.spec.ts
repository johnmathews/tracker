import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import TrackerGrid from '@/components/TrackerGrid.vue'
import type { Day } from '@/stores/planner'

const DAYS: Day[] = Array.from({ length: 7 }, (_, i) => ({
  name: `D${i + 1}`,
  date: String(19 + i),
  full: `Day ${i + 1}`,
  key: `2026-10-${19 + i}`,
  isToday: false,
  isFuture: false,
}))

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

function mountGrid(): VueWrapper {
  wrapper = mount(TrackerGrid, {
    props: {
      section: 'exercise',
      label: 'Exercise',
      tableLabel: 'Exercises, week of 19 October',
      items: [
        { id: 'pu', name: 'Push-ups', target: 3 },
        { id: 'sq', name: 'Squats', target: 2 },
      ],
      days: DAYS,
      marksFor: () => Array(7).fill(null),
    },
    attachTo: document.body,
  })
  return wrapper
}

describe('TrackerGrid (K120)', () => {
  it('has the names and the seven days, and no Remove column', () => {
    mountGrid()
    const table = wrapper!.get('table')
    expect(table.classes()).toContain(
      'screen:grid-cols-[var(--grid-name-w)_repeat(7,minmax(0,1fr))]',
    )
    expect(table.html()).not.toContain('--grid-remove-w')
    expect(table.findAll('col')).toHaveLength(8)
    const heads = table.findAll('thead th')
    expect(heads).toHaveLength(8)
    expect(heads.at(-1)!.text()).toBe('D7 25')
    expect(table.text()).not.toContain('Remove')
    for (const row of table.findAll('tbody tr')) expect(row.findAll('td')).toHaveLength(7)
  })

  it('passes a day’s press up as the item and the day, and emits nothing else', async () => {
    mountGrid()
    await wrapper!.findAll('[data-slot="day-mark-button"]')[8]!.trigger('click')
    expect(wrapper!.emitted('toggle')).toEqual([['sq', 1]])
    expect(Object.keys(wrapper!.emitted())).not.toContain('remove')
  })
})
