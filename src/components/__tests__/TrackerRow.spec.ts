import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import TrackerRow from '@/components/TrackerRow.vue'
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

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function mountRow(note?: string): VueWrapper {
  const Table = defineComponent({
    setup: () => () =>
      h('table', [
        h('tbody', [
          h(TrackerRow, {
            index: 0,
            item: { id: 'pu', name: 'Push-ups', target: 3 },
            href: '#/item/exercise/pu',
            details: ['3 × 12'],
            note,
            configMode: false,
            days: DAYS,
            marks: Array(7).fill(null),
          }),
        ]),
      ]),
  })
  wrapper = mount(Table, { attachTo: document.body })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
})

describe('TrackerRow notes (K43)', () => {
  it('opens the whole note, rendered, with its link opening a new tab', async () => {
    mountRow('Slow **down**. [Form video](https://example.com/push-ups)')
    const note = document.querySelector<HTMLElement>('[data-testid="item-note"]')!
    note.focus()
    note.click()
    await settle()
    const body = document.querySelector('[data-testid="item-note-body"]')
    expect(body?.innerHTML).toContain('<strong>down</strong>')
    const link = body!.querySelector('a')!
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('has no note line without a note, or with an empty one', () => {
    mountRow()
    expect(document.querySelector('[data-testid="item-note"]')).toBeNull()
    wrapper!.unmount()
    mountRow('')
    expect(document.querySelector('[data-testid="item-note"]')).toBeNull()
  })

  it('keeps a long note to one line in the row, and the whole of it in a panel that scrolls', async () => {
    const long = Array.from({ length: 400 }, (_, i) => `Line ${i + 1} of a long note.`).join('\n\n')
    mountRow(long)
    const note = document.querySelector<HTMLElement>('[data-testid="item-note"]')!
    expect(note.classList).toContain('truncate')
    note.click()
    await settle()
    const body = document.querySelector('[data-testid="item-note-body"]')!
    expect(body.querySelectorAll('p')).toHaveLength(400)
    // The Popover card's panel: never taller than the screen allows, scrolling inside.
    const panel = body.closest<HTMLElement>('[data-slot="popover-content"]')!
    expect(panel.className).toContain('overflow-y-auto')
    expect(panel.className).toContain('max-h-(--reka-popover-content-available-height)')
  })
})
