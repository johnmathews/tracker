import { settle } from '@/components/ui/__tests__/setup'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ChangeSheetSection from '../sections/ChangeSheetSection.vue'
import { ENDED_EARLY, ENDING, runActionServer } from '../sections/runActionExamples'

/** The ChangeSheet section's run sheet (K168): Re-open, Restart and Cancel the end. */

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)

async function press(el: HTMLElement | null): Promise<void> {
  el!.click()
  await settle()
}

async function type(testid: string, value: string): Promise<void> {
  const input = q(testid) as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

describe('ChangeSheetSection, the run sheet', () => {
  it('opens Re-open, Restart and Cancel the end from their triggers, and walks them', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const step = async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await settle()
    }
    try {
      const wrapper = mount(ChangeSheetSection, { attachTo: document.body })
      expect(q('run-sheet')).toBeNull()

      // Re-open: a day before today is refused on step 1, then today previews.
      await press(wrapper.get('#sg-change-sheet-reopen-open').element as HTMLElement)
      expect(q('run-sheet')!.querySelector('h2')!.textContent).toBe('Re-open Beginner 5×5')
      await type('run-from', '2026-12-15')
      await press(q('run-preview-button'))
      await step()
      expect(q('run-sheet')!.textContent).toContain('The programme re-opens today or later.')
      await type('run-from', '2026-12-16')
      await type('run-reason', 'Knee is better')
      await press(q('run-preview-button'))
      await step()
      expect(q('run-summary')!.textContent!.trim()).toBe(
        'Carries on from Wed 16 Dec, at week 4. Knee is better.',
      )
      expect(q('run-preview')!.textContent).toContain('Mon 14 to Tue 15 Dec')
      await press(q('run-confirm'))
      await step()
      expect(wrapper.get('#sg-change-sheet-answer').text()).toContain('Re-open programme')

      // Restart: the name to start with, then the new tracker and week 1.
      await press(wrapper.get('#sg-change-sheet-restart-open').element as HTMLElement)
      expect((q('run-name') as HTMLInputElement).value).toBe('Beginner 5×5')
      await press(q('run-preview-button'))
      await step()
      expect(q('run-summary')!.textContent!.trim()).toBe(
        'A new Beginner 5×5, from week 1 on Wed 16 Dec.',
      )
      expect(q('run-preview')!.textContent).toContain('16–20 Dec')

      // Cancel the end: one step, previewed as it opens.
      await press(wrapper.get('#sg-change-sheet-cancel-end-open').element as HTMLElement)
      await step()
      expect(q('run-step')).toBeNull()
      expect(q('run-summary')!.textContent!.trim()).toBe('Carries on past Sun 27 Dec, as planned.')

      // The stale case: the first confirm brings the fresh preview with a line.
      await press(wrapper.get('#sg-change-sheet-reopen-stale-open').element as HTMLElement)
      await press(q('run-preview-button'))
      await step()
      await press(q('run-confirm'))
      await step()
      expect(q('run-stale')!.textContent).toContain('The plan changed since this preview.')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('words its server’s problems as the server does', async () => {
    const server = runActionServer(ENDED_EARLY)
    expect(await server.preview({ name: ' ', start: '2026-12-16' })).toMatchObject({
      ok: false,
      problems: [{ path: 'name' }],
    })
    expect(await server.preview({ name: 'A', start: '2026-12-01' })).toMatchObject({
      ok: false,
      problems: [{ path: 'start' }],
    })
    const ending = await runActionServer(ENDING).preview({ from: '2026-12-28' })
    expect(ending).toMatchObject({ ok: true, data: { reopen: { week: 6, paused: null } } })
  })
})
