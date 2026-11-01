import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { HistoryList, groupHistory, type HistoryItem } from '@/components/ui/history-list'

// Sunday 1 November 2026, 21:00 local.
const NOW = new Date(2026, 10, 1, 21, 0)
const at = (month: number, day: number, hour = 12, minute = 0, year = 2026) =>
  Math.floor(new Date(year, month, day, hour, minute).getTime() / 1000)

const ITEMS: HistoryItem[] = [
  { id: 'c5', title: 'Is my diet good enough?', updatedAt: at(10, 1, 20) },
  { id: 'c4', title: 'Am I doing enough to meet my goals this month?', updatedAt: at(10, 1, 0) },
  { id: 'c3', title: 'Why do my knees ache after squats?', updatedAt: at(9, 28) },
  { id: 'c2', title: 'Should I add a rest day?', updatedAt: at(9, 19) },
  { id: 'c1', title: 'Am I eating enough fish?', updatedAt: at(9, 12) },
]

const ids = (groups: ReturnType<typeof groupHistory>) =>
  groups.map((g) => [g.label, g.items.map((i) => i.id)])

describe('groupHistory', () => {
  it('splits at local midnight today, and at midnight seven days before it', () => {
    const items: HistoryItem[] = [
      { id: 'later-today', title: 'a', updatedAt: at(10, 1, 22) },
      { id: 'midnight', title: 'b', updatedAt: at(10, 1, 0, 0) },
      { id: 'yesterday-late', title: 'c', updatedAt: at(9, 31, 23, 59) },
      { id: 'seventh-day', title: 'd', updatedAt: at(9, 25, 0, 0) },
      { id: 'eighth-day', title: 'e', updatedAt: at(9, 24, 23, 59) },
      { id: 'last-year', title: 'f', updatedAt: at(10, 1, 12, 0, 2025) },
    ]
    expect(ids(groupHistory(items, NOW))).toEqual([
      ['Today', ['later-today', 'midnight']],
      ['Last week', ['yesterday-late', 'seventh-day']],
      ['Earlier', ['eighth-day', 'last-year']],
    ])
  })

  it('leaves out a group with nothing in it, and keeps the order given', () => {
    expect(ids(groupHistory([ITEMS[3]!, ITEMS[0]!], NOW))).toEqual([
      ['Today', ['c5']],
      ['Earlier', ['c2']],
    ])
    expect(groupHistory([], NOW)).toEqual([])
  })
})

describe('HistoryList', () => {
  it('starts with New conversation, the panel’s width, its words at the start', () => {
    const list = mount(HistoryList, { props: { items: ITEMS, now: NOW } })
    const first = list.get('button')
    expect(first.text()).toBe('New conversation')
    expect(first.attributes('data-variant')).toBe('secondary')
    expect(first.classes()).toEqual(expect.arrayContaining(['w-full', 'justify-start']))
    expect(first.find('svg.lucide-square-pen').exists()).toBe(true)
  })

  it('shows each group under its label, a group named by it (not a landmark)', () => {
    const list = mount(HistoryList, { props: { items: ITEMS, now: NOW } })
    const sections = list.findAll('[role="group"]')
    expect(sections.map((s) => s.get('h3').text())).toEqual(['Today', 'Last week', 'Earlier'])
    for (const section of sections) {
      expect(section.element.tagName).toBe('DIV')
      expect(section.attributes('aria-labelledby')).toBe(section.get('h3').attributes('id'))
      expect(section.get('h3').classes()).toContain('text-ink-secondary')
    }
    expect(sections[2]!.findAll('[data-slot="history-open"]').map((b) => b.text())).toEqual([
      'Should I add a rest day?',
      'Am I eating enough fish?',
    ])
  })

  it('puts each title on one line that ends in an ellipsis, with a bin named for it', () => {
    const list = mount(HistoryList, { props: { items: ITEMS, now: NOW } })
    const item = list.findAll('li')[2]!
    expect(item.get('[data-slot="history-open"]').classes()).toContain('truncate')
    const bin = item.get('[data-slot="icon-button"]')
    expect(bin.attributes('aria-label')).toBe('Delete “Why do my knees ache after squats?”')
    expect(bin.attributes('data-history-delete')).toBe('c3')
    expect(bin.find('svg.lucide-trash-2').exists()).toBe(true)
  })

  it('shows a bin on hover, on focus and on a touch screen, and always on the open one', () => {
    const list = mount(HistoryList, { props: { items: ITEMS, now: NOW, currentId: 'c4' } })
    const bins = list.findAll('[data-history-delete]')
    const quiet = bins[0]!.classes()
    expect(quiet).toEqual(
      expect.arrayContaining([
        'opacity-0',
        'group-hover/item:opacity-100',
        'group-focus-within/item:opacity-100',
        '[@media(hover:none)]:opacity-100',
      ]),
    )
    expect(bins[1]!.classes()).toContain('opacity-100')
    expect(bins[1]!.classes()).not.toContain('opacity-0')
  })

  it('marks the open conversation current, on a tile and bold, and only that one', () => {
    const list = mount(HistoryList, { props: { items: ITEMS, now: NOW, currentId: 'c4' } })
    const opens = list.findAll('[data-slot="history-open"]')
    expect(opens.map((o) => o.attributes('aria-current'))).toEqual([
      undefined,
      'true',
      undefined,
      undefined,
      undefined,
    ])
    expect(opens[1]!.classes()).toContain('font-semibold')
    expect(list.findAll('li')[1]!.classes()).toContain('bg-tile')
    expect(list.findAll('li')[0]!.classes()).not.toContain('bg-tile')
  })

  it('ends with Delete all conversations, an underlined text button above a hairline', () => {
    const list = mount(HistoryList, { props: { items: ITEMS, now: NOW } })
    const foot = list.get('[data-slot="history-foot"]')
    expect(foot.classes()).toEqual(expect.arrayContaining(['border-t', 'border-line']))
    const button = foot.get('button')
    expect(button.text()).toBe('Delete all conversations')
    expect(button.attributes('type')).toBe('button')
    expect(button.classes()).toEqual(
      expect.arrayContaining(['text-ink-secondary', 'underline', 'hover:text-ink']),
    )
  })

  it('says which was pressed, and leaves the confirming to the page', async () => {
    const list = mount(HistoryList, { props: { items: ITEMS, now: NOW } })
    await list.findAll('[data-slot="history-open"]')[2]!.trigger('click')
    await list.findAll('[data-history-delete]')[0]!.trigger('click')
    await list.get('button').trigger('click')
    await list.get('[data-slot="history-foot"] button').trigger('click')
    expect(list.emitted('open')).toEqual([['c3']])
    expect(list.emitted('delete')).toEqual([['c5']])
    expect(list.emitted('new')).toEqual([[]])
    expect(list.emitted('deleteAll')).toEqual([[]])
    expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).toBeNull()
  })

  it('shows only New conversation and one line when there is nothing yet', () => {
    const list = mount(HistoryList, { props: { items: [], now: NOW } })
    expect(list.find('[role="group"]').exists()).toBe(false)
    expect(list.find('[data-slot="history-foot"]').exists()).toBe(false)
    expect(list.findAll('button').map((b) => b.text())).toEqual(['New conversation'])
    const empty = list.get('[data-slot="history-empty"]')
    expect(empty.text()).toBe('Past conversations show here.')
    expect(empty.classes()).toEqual(expect.arrayContaining(['caption', 'text-ink-secondary']))
  })
})
