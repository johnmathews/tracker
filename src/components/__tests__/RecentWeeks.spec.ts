import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import RecentWeeks from '@/components/RecentWeeks.vue'
import type { RecentWeek } from '@/lib/history'
import type { Mark, MarkSet } from '@/lib/storage'

const _ = null
function week(
  day: number,
  goal: number | null,
  marks: (Mark | null)[],
  current = false,
): RecentWeek {
  return { week: `2026-10-${day}`, monday: new Date(2026, 9, day), current, marks, goal }
}

const WEEKS: RecentWeek[] = [
  week(26, 3, ['great', _, 'great', _, _, _, _], true),
  week(19, 3, ['great', _, 'partial', _, 'great', _, _]),
  week(12, 0, [_, _, 'missed', _, _, _, _]),
  week(5, 0, ['great', 'great', _, _, _, _, _]),
  // Not in that week's plan: seven empty boxes.
  {
    week: '2026-09-28',
    monday: new Date(2026, 8, 28),
    current: false,
    marks: Array(7).fill(_),
    goal: null,
  },
]

let wrapper: VueWrapper | undefined
afterEach(() => wrapper?.unmount())

function mountWeeks(weeks = WEEKS, markSet: MarkSet = 'stamped-ticks'): VueWrapper {
  wrapper = mount(RecentWeeks, { props: { weeks, markSet, labelledby: 'weeks-h' } })
  return wrapper
}

const lines = () => wrapper!.findAll('li')

describe('RecentWeeks', () => {
  it('is a list labelled by the section’s heading, a line a week, newest first', () => {
    mountWeeks()
    expect(wrapper!.get('ol').attributes('aria-labelledby')).toBe('weeks-h')
    expect(lines()).toHaveLength(5)
    expect(lines()[0]!.attributes('aria-current')).toBe('date')
    expect(lines()[1]!.attributes('aria-current')).toBeUndefined()
  })

  it('says when: “This week”, otherwise the short date for the eye and the full one aloud', () => {
    mountWeeks()
    expect(lines()[0]!.text()).toMatch(/^This week\./)
    const when = lines()[1]!.get('span')
    expect(when.get('[aria-hidden="true"]').text()).toBe('19 Oct')
    expect(when.get('.sr-only').text()).toBe('Week of 19 October.')
  })

  it('draws the seven marks as pictures in the mark set, hidden from a screen reader', () => {
    mountWeeks()
    const marks = lines()[1]!.get('[data-testid="recent-week-marks"]')
    expect(marks.attributes('aria-hidden')).toBe('true')
    expect(marks.findAll('svg')).toHaveLength(7)
    expect(marks.findAll('button')).toHaveLength(0)
    expect(marks.findAll('svg[data-mark]').map((s) => s.attributes('data-mark'))).toEqual([
      'great',
      'partial',
      'great',
    ])
  })

  it('reads each line as one sentence', () => {
    mountWeeks()
    const said = (i: number) =>
      lines()
        [i]!.findAll('.sr-only')
        .map((s) => s.text().trim())
        .join(' ')
    expect(said(1)).toBe(
      'Week of 19 October. Marked Monday, Wednesday (partly done) and Friday. , goal met',
    )
    expect(said(2)).toBe("Week of 12 October. Marked Wednesday (couldn't do it).")
    expect(said(4)).toBe('Week of 28 September. Nothing marked.')
  })

  it('counts the days against the goal, a met week in pen and underlined', () => {
    mountWeeks()
    const counts = wrapper!.findAll('[data-testid="recent-week-count"]')
    expect(counts.map((c) => c.text())).toEqual([
      '2 of 3',
      '3 of 3, goal met',
      '1 day',
      '2 days',
      'Not planned',
    ])
    expect(counts[1]!.attributes('data-met')).toBe('true')
    expect(counts[1]!.classes()).toEqual(expect.arrayContaining(['text-pen', 'underline']))
    for (const i of [0, 2, 3, 4]) {
      expect(counts[i]!.attributes('data-met')).toBeUndefined()
      expect(counts[i]!.classes()).toContain('text-ink-secondary')
    }
    // A count never breaks; "Not planned" may wrap on a phone.
    expect(counts[0]!.classes()).toContain('whitespace-nowrap')
    expect(counts[4]!.classes()).not.toContain('whitespace-nowrap')
  })

  it('says over the list how many weeks met their goal, in words, only when one did', () => {
    mountWeeks()
    const line = wrapper!.get('[data-testid="recent-weeks-line"]')
    expect(line.text()).toBe('The goal was met in one of the last five weeks.')
    expect(line.get('span').classes()).toContain('text-ink')
    wrapper!.unmount()
    mountWeeks([WEEKS[0]!, WEEKS[2]!])
    expect(wrapper!.find('[data-testid="recent-weeks-line"]').exists()).toBe(false)
  })
})
