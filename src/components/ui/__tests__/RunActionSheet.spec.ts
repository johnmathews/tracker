import { settle } from './setup'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { mount } from '@vue/test-utils'
import { RunActionSheet } from '@/components/ui/change-sheet'
import type { Outcome, Run } from '@/lib/programmes'
import type {
  Confirmed,
  ReopenPreview,
  RestartPreview,
  RunAction,
  RunActionBody,
  RunActionPreview,
} from '@/lib/runActions'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'

const RUN = RUN_JSON as unknown as Run // today Thu 12 Nov, 8 weeks
const ENDED: Run = {
  ...RUN,
  status: 'ended',
  end: '2026-11-08',
  ended: { from: '2026-11-09', reason: 'Knee', seq: 5 },
  canReopen: true,
}
const ENDING: Run = { ...RUN, ended: { from: '2026-11-30', reason: null, seq: 5 }, canReopen: true }

const REOPEN: ReopenPreview = {
  preview: true,
  rev: 'o1',
  reopen: {
    from: '2026-11-12',
    reason: null,
    week: 4,
    paused: { from: '2026-11-09', to: '2026-11-11' },
    end: '2026-12-20',
    lastWeek: '2026-12-14',
  },
}
const RESTART: RestartPreview = {
  preview: true,
  rev: 'r1',
  restart: {
    name: 'Beginner 5×5',
    start: '2026-11-30',
    firstWeek: { from: '2026-11-30', to: '2026-12-06' },
    weeks: 8,
    end: '2027-01-24',
    oldEndsFrom: '2026-11-30',
  },
}

type PreviewFn = (body: RunActionBody) => Promise<Outcome<RunActionPreview>>
type ConfirmFn = (body: RunActionBody, rev: string) => Promise<Confirmed<unknown, RunActionPreview>>

function mountSheet(
  action: RunAction,
  {
    run = ENDED,
    preview = vi.fn<PreviewFn>(async () => ({
      ok: true,
      data: action === 'restart' ? RESTART : REOPEN,
    })),
    confirm = vi.fn<ConfirmFn>(async () => ({ ok: true, data: run })),
  }: { run?: Run; preview?: Mock<PreviewFn>; confirm?: Mock<ConfirmFn> } = {},
) {
  const onOpen = vi.fn<(open: boolean) => void>()
  const wrapper = mount(RunActionSheet, {
    props: {
      open: true,
      run,
      action,
      name: 'Beginner 5×5',
      preview,
      confirm,
      'onUpdate:open': onOpen,
    },
    attachTo: document.body,
  })
  return { wrapper, preview, confirm, onOpen }
}

function q<T extends HTMLElement = HTMLElement>(testid: string): T {
  const el = document.querySelector<T>(`[data-testid="${testid}"]`)
  if (!el) throw new Error(`${testid} not found`)
  return el
}
const has = (testid: string) => document.querySelector(`[data-testid="${testid}"]`) !== null

async function type(testid: string, value: string): Promise<void> {
  const input = q<HTMLInputElement>(testid)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

async function click(testid: string): Promise<void> {
  q(testid).click()
  await settle()
}

describe('RunActionSheet (the ChangeSheet card, K168)', () => {
  it('opens Re-open on From and Reason, with focus on From and nothing sent', async () => {
    const { preview } = mountSheet('reopen')
    await settle()
    const dialog = q('run-sheet')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.dataset.step).toBe('1')
    expect(dialog.querySelector('h2')!.textContent).toBe('Re-open Beginner 5×5')
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Step 1 of 2',
    )
    expect(document.activeElement).toBe(q('run-from'))
    expect(q<HTMLInputElement>('run-from').min).toBe(RUN.today)
    expect(dialog.textContent).toContain('Today, Thu 12 Nov, or any later day.')
    expect(dialog.textContent).toContain('It shows in Changes.')
    expect(preview).not.toHaveBeenCalled()
  })

  it('closes from Cancel and from Close with nothing sent', async () => {
    const { preview, onOpen } = mountSheet('restart')
    await settle()
    await click('run-cancel')
    expect(onOpen).toHaveBeenLastCalledWith(false)
    onOpen.mockClear()
    await click('run-close')
    expect(onOpen).toHaveBeenLastCalledWith(false)
    expect(preview).not.toHaveBeenCalled()
  })

  it('sends the day typed in From', async () => {
    const { preview } = mountSheet('reopen')
    await settle()
    await type('run-from', '2026-11-20')
    await click('run-preview-button')
    expect(preview).toHaveBeenCalledWith({ from: '2026-11-20' })
  })

  it('previews, moves focus to the sentence, and goes Back with the fields as entered', async () => {
    const { preview } = mountSheet('reopen')
    await settle()
    await type('run-reason', '  ')
    await click('run-preview-button')
    // A reason of spaces is no reason.
    expect(preview).toHaveBeenCalledWith({ from: RUN.today })
    expect(q('run-sheet').dataset.step).toBe('2')
    expect(document.activeElement).toBe(q('run-summary'))
    expect(q('run-summary').textContent!.trim()).toBe('Carries on from Thu 12 Nov, at week 4.')
    expect(q('run-sheet').textContent).toContain('What it does')
    await click('run-back')
    expect(q('run-sheet').dataset.step).toBe('1')
    expect(document.activeElement).toBe(q('run-from'))
    expect(q<HTMLInputElement>('run-from').value).toBe(RUN.today)
  })

  it('puts a refused field’s word under it, and anything else over the actions', async () => {
    const preview = vi.fn<PreviewFn>(async () => ({
      ok: false,
      problems: [
        { path: 'name', message: 'a name is at most 60 characters.' },
        { path: 'rev', message: 'give the rev of the preview.' },
      ],
      message: null,
    }))
    mountSheet('restart', { preview })
    await settle()
    await click('run-preview-button')
    expect(q('run-sheet').dataset.step).toBe('1')
    expect(q('run-sheet').textContent).toContain('A name is at most 60 characters.')
    expect(q('run-error').textContent).toContain('Give the rev of the preview.')
  })

  it('says a restart ends a run still going, with the day before the new start', async () => {
    const { preview, confirm, wrapper } = mountSheet('restart', { run: RUN })
    await settle()
    expect(q<HTMLInputElement>('run-name').value).toBe('Beginner 5×5')
    await type('run-start', '2026-11-30')
    await click('run-preview-button')
    expect(preview).toHaveBeenCalledWith({ name: 'Beginner 5×5', start: '2026-11-30' })
    const rows = [...document.querySelectorAll('[data-testid="run-preview-row"]')].map((r) =>
      [...r.querySelectorAll('[data-part]')].map((p) => p.textContent!.trim()).join(' | '),
    )
    expect(rows).toEqual([
      'New tracker |  | Beginner 5×5',
      'Week 1 |  | 30 Nov–6 Dec',
      'Last day | 8 weeks | Sun 24 Jan',
      'The run now |  | Ends Sun 29 Nov',
    ])
    expect(q('run-unchanged').textContent).toBe(
      'This run ends from Mon 30 Nov and keeps its weeks, marks, notes and changes.',
    )
    await click('run-confirm')
    expect(confirm).toHaveBeenCalledWith({ name: 'Beginner 5×5', start: '2026-11-30' }, 'r1')
    expect(wrapper.emitted('done')).toEqual([[RUN]])
  })

  it('opens Cancel the end on its preview, from the end’s own day, with no step line', async () => {
    const { preview, onOpen } = mountSheet('cancel-end', { run: ENDING })
    await settle()
    expect(preview).toHaveBeenCalledWith({ from: '2026-11-30' })
    expect(has('run-step')).toBe(false)
    expect(has('run-from')).toBe(false)
    const dialog = q('run-sheet')
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Nothing changes until you cancel the end.',
    )
    expect(document.activeElement).toBe(q('run-summary'))
    expect(q('run-confirm').textContent!.trim()).toBe('Cancel the end')
    await click('run-keep')
    expect(onOpen).toHaveBeenCalledWith(false)
  })

  it('keeps Cancel the end off while its preview failed, saying why', async () => {
    const preview = vi.fn<PreviewFn>(async () => ({
      ok: false,
      problems: [],
      message: 'Can’t reach the server, so nothing changed. Try again when you’re online.',
    }))
    const { confirm } = mountSheet('cancel-end', { run: ENDING, preview })
    await settle()
    expect(q('run-error').textContent).toContain('Can’t reach the server')
    expect(q<HTMLButtonElement>('run-confirm').disabled).toBe(true)
    await click('run-confirm')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('shows the fresh preview when the run changed since, and confirms it with its rev', async () => {
    const fresh: ReopenPreview = { ...REOPEN, rev: 'o2' }
    const confirm = vi
      .fn<ConfirmFn>()
      .mockResolvedValueOnce({ ok: false, stale: fresh })
      .mockResolvedValueOnce({ ok: true, data: RUN })
    const { wrapper } = mountSheet('reopen', { confirm })
    await settle()
    await click('run-preview-button')
    await click('run-confirm')
    expect(q('run-stale').textContent).toBe(
      'The plan changed since this preview. Check it, then confirm.',
    )
    expect(wrapper.emitted('done')).toBeUndefined()
    await click('run-confirm')
    expect(confirm).toHaveBeenLastCalledWith({ from: RUN.today }, 'o2')
    expect(wrapper.emitted('done')).toEqual([[RUN]])
  })

  it('shows why a confirm failed, and stays open on step 2', async () => {
    const confirm = vi.fn<ConfirmFn>(async () => ({
      ok: false,
      problems: [],
      message: 'Your account is full, so nothing was saved.',
    }))
    const { onOpen } = mountSheet('reopen', { confirm })
    await settle()
    await click('run-preview-button')
    await click('run-confirm')
    expect(q('run-sheet').dataset.step).toBe('2')
    expect(q('run-error').textContent).toContain('Your account is full')
    expect(onOpen).not.toHaveBeenCalled()
  })
})
