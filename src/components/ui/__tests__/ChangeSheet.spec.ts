import { settle } from './setup'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { mount } from '@vue/test-utils'
import { ChangeSheet } from '@/components/ui/change-sheet'
import {
  activityOptions,
  programmeOptions,
  type ChangePreview,
  type ChangeRequest,
  type ConfirmOutcome,
  type Outcome,
  type Run,
  type SheetStart,
} from '@/lib/programmes'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import PREVIEW_JSON from '@/lib/__tests__/programmes/change-preview.json'

const RUN = RUN_JSON as unknown as Run
const PREVIEW = PREVIEW_JSON as unknown as ChangePreview
const TODAY = RUN.today // Thu 12 Nov, programme week 4

/** Change from here on Barbell row's week 6 (Mon 23 Nov). */
const ROW_FROM_WEEK_6: SheetStart = {
  title: 'Change Barbell row',
  options: activityOptions(RUN, 'row'),
  kind: 'set-value',
  field: 'weight',
  activity: 'row',
  from: '2026-11-23',
  scope: 'on',
  undo: null,
}

type PreviewFn = (request: ChangeRequest) => Promise<Outcome<ChangePreview>>
type ConfirmFn = (request: ChangeRequest, rev: string) => Promise<ConfirmOutcome>

function mountSheet(
  start: SheetStart = ROW_FROM_WEEK_6,
  {
    preview = vi.fn<PreviewFn>(async () => ({ ok: true, data: PREVIEW })),
    confirm = vi.fn<ConfirmFn>(async () => ({ ok: true, data: RUN })),
    run = RUN,
  }: { preview?: Mock<PreviewFn>; confirm?: Mock<ConfirmFn>; run?: Run } = {},
) {
  const wrapper = mount(ChangeSheet, {
    props: { open: true, run, start, preview, confirm, 'onUpdate:open': () => {} },
    attachTo: document.body,
  })
  return { wrapper, preview, confirm }
}

function q<T extends HTMLElement = HTMLElement>(testid: string): T {
  const el = document.querySelector<T>(`[data-testid="${testid}"]`)
  if (!el) throw new Error(`${testid} not found`)
  return el
}
const has = (testid: string) => document.querySelector(`[data-testid="${testid}"]`) !== null
const sheet = () => q('change-sheet')

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

/** Opens the Change menu and picks an option by its words. */
async function choose(label: string): Promise<void> {
  const trigger = q('change-kind')
  trigger.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  trigger.click()
  await settle()
  const item = [...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')].find(
    (i) => i.textContent?.trim() === label,
  )
  if (!item) throw new Error(`no option ${label}`)
  item.click()
  await settle()
}

async function segment(label: string): Promise<void> {
  ;[...document.querySelectorAll<HTMLElement>('[data-testid="change-sheet"] button')]
    .find((b) => b.textContent?.trim() === label)!
    .click()
  await settle()
}

describe('ChangeSheet, step 1 (K144)', () => {
  it('opens on the change, named for its activity, with focus on the Change menu', async () => {
    mountSheet()
    await settle()
    expect(sheet().dataset.step).toBe('1')
    expect(sheet().getAttribute('role')).toBe('dialog')
    expect(q('change-step').textContent).toBe('Step 1 of 2')
    expect(sheet().getAttribute('aria-describedby')).toBe(q('change-step').id)
    expect(sheet().querySelector('h2')!.textContent).toBe('Change Barbell row')
    expect(q('change-kind').textContent).toContain('Set weight')
    expect(document.activeElement).toBe(q('change-kind'))
  })

  it('labels the value with its field and unit, and says the value in force on the from day', async () => {
    mountSheet()
    await settle()
    const value = q<HTMLInputElement>('change-value')
    expect(document.querySelector(`label[for="${value.id}"]`)!.textContent).toBe('Weight in kg')
    expect(value.closest('[data-slot="text-field"]')!.textContent).toContain(
      'Week 6 is 42.5 kg now.',
    )
    const from = q<HTMLInputElement>('change-from')
    expect(from.type).toBe('date')
    expect(from.value).toBe('2026-11-23')
    expect(from.min).toBe(TODAY)
    expect(from.closest('[data-slot="text-field"]')!.textContent).toContain(
      'Today, Thu 12 Nov, or any later day.',
    )
    expect(q('change-scope').textContent).toContain('From then on')
    expect(
      q<HTMLInputElement>('change-reason').closest('[data-slot="text-field"]')!.textContent,
    ).toContain('It shows in Changes.')
  })

  it('offers the activity’s changes, named for its fields', async () => {
    mountSheet()
    await settle()
    const trigger = q('change-kind')
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
    )
    trigger.click()
    await settle()
    expect(
      [...document.querySelectorAll('[data-slot="menu-item"]')].map((i) => i.textContent?.trim()),
    ).toEqual([
      'Set weight',
      'Set reps',
      'Set sets',
      'Set goal',
      'Set increase',
      'Pause activity',
      'End activity',
    ])
  })

  it('changes nothing on Cancel or Close', async () => {
    const { wrapper, preview, confirm } = mountSheet()
    await settle()
    await click('change-cancel')
    expect(wrapper.emitted('update:open')![0]).toEqual([false])
    await click('change-close')
    expect(wrapper.emitted('update:open')![1]).toEqual([false])
    expect(preview).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('ChangeSheet, step 2: nothing applies before Confirm (spec P2, §7.3)', () => {
  async function toStep2(options: Parameters<typeof mountSheet>[1] = {}) {
    const mounted = mountSheet(ROW_FROM_WEEK_6, options)
    await settle()
    await type('change-value', '47.5')
    await type('change-reason', 'Rows feel light')
    await click('change-preview-button')
    return mounted
  }

  it('previews the change, and applies nothing', async () => {
    const { preview, confirm } = await toStep2()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview).toHaveBeenCalledWith({
      change: { type: 'set-value', activity: 'row', field: 'weight', value: 47.5 },
      from: '2026-11-23',
      reason: 'Rows feel light',
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(sheet().dataset.step).toBe('2')
    expect(q('change-step').textContent).toBe('Step 2 of 2')
    expect(document.activeElement).toBe(q('change-summary'))
  })

  it('says the change in a sentence, then each week it changes, before → after', async () => {
    await toStep2()
    // The server's preview: the change it read back, set to 45 kg from Mon 16 Nov.
    expect(q('change-summary').textContent).toBe('Weight 45 kg from Mon 16 Nov, from then on.')
    const weeks = [...document.querySelectorAll<HTMLElement>('[data-testid="change-preview-week"]')]
    expect(weeks.map((w) => w.dataset.week)).toEqual(['6', '7', '8'])
    expect(weeks[0]!.textContent).toContain('Week 6')
    expect(weeks[0]!.textContent).toContain('23–29 Nov')
    expect(weeks[0]!.textContent).toContain('42.5 → 47.5 kg')
    expect(weeks[2]!.textContent).toContain('7–13 Dec, deload')
    expect(q('change-unchanged').textContent).toBe('Nothing before Mon 16 Nov changes.')
    expect(
      document.querySelector('[data-testid="change-sheet"] [data-slot="inline-message"]')!
        .textContent,
    ).toContain('Deadlift ends at its week 7 of 8.')
  })

  it('says a hand-edit blocks it, and drops it only when asked, previewing again', async () => {
    const { preview } = await toStep2()
    expect(q('change-hand-edit').textContent).toContain('Week 5 keeps the 35 kg set on 23 Oct.')
    await click('change-drop-hand-edit')
    expect(preview).toHaveBeenCalledTimes(2)
    expect(preview.mock.calls[1]![0].change).toMatchObject({ dropHandEdits: [1] })
    expect(q('change-hand-edit').textContent).toContain('The 35 kg set by hand on 23 Oct goes too.')
    expect(document.activeElement).toBe(q('change-keep-hand-edit'))
    await click('change-keep-hand-edit')
    expect(preview).toHaveBeenCalledTimes(3)
    expect(preview.mock.calls[2]![0].change).not.toHaveProperty('dropHandEdits')
    expect(q('change-hand-edit').textContent).toContain('Week 5 keeps')
  })

  it('goes Back with everything as entered', async () => {
    await toStep2()
    await click('change-back')
    expect(sheet().dataset.step).toBe('1')
    expect(q<HTMLInputElement>('change-value').value).toBe('47.5')
    expect(q<HTMLInputElement>('change-reason').value).toBe('Rows feel light')
    expect(document.activeElement).toBe(q('change-value'))
  })

  it('applies the change on Confirm with the preview’s rev, then closes', async () => {
    const { wrapper, confirm } = await toStep2()
    await click('change-confirm')
    expect(confirm).toHaveBeenCalledWith(
      {
        change: { type: 'set-value', activity: 'row', field: 'weight', value: 47.5 },
        from: '2026-11-23',
        reason: 'Rows feel light',
      },
      PREVIEW.rev,
    )
    expect(wrapper.emitted('done')![0]).toEqual([RUN])
    expect(wrapper.emitted('update:open')!.at(-1)).toEqual([false])
  })

  it('shows the fresh preview when the plan changed since (409, a stale rev), applying nothing', async () => {
    const fresh: ChangePreview = { ...PREVIEW, rev: 'fresh', blocking: [] }
    const confirm = vi.fn<ConfirmFn>(async () => ({ ok: false, stale: fresh }))
    const { wrapper } = await toStep2({ confirm })
    await click('change-confirm')
    expect(wrapper.emitted('done')).toBeUndefined()
    expect(sheet().dataset.step).toBe('2')
    expect(q('change-stale').textContent).toContain(
      'The plan changed since this preview. Check it, then confirm.',
    )
    expect(has('change-hand-edit')).toBe(false)
    await click('change-confirm')
    expect(confirm.mock.calls[1]![1]).toBe('fresh')
  })

  it('says why a confirm failed, and stays', async () => {
    const confirm = vi.fn<ConfirmFn>(async () => ({
      ok: false,
      problems: [],
      message: 'This programme has ended, so it can’t change.',
    }))
    const { wrapper } = await toStep2({ confirm })
    await click('change-confirm')
    expect(q('change-error').textContent).toContain('This programme has ended, so it can’t change.')
    expect(wrapper.emitted('done')).toBeUndefined()
  })

  it('puts the sheet away to show the change in the plan', async () => {
    const { wrapper } = await toStep2()
    await click('change-show-in-plan')
    expect(wrapper.emitted('show-in-plan')![0]).toEqual([
      PREVIEW,
      'Barbell row at 45 kg from Mon 16 Nov.',
    ])
    expect(wrapper.emitted('update:open')!.at(-1)).toEqual([false])
  })

  it('confirms from outside, as the plan’s preview bar does', async () => {
    const { wrapper, confirm } = await toStep2()
    await (wrapper.vm as unknown as { confirmChange: () => Promise<void> }).confirmChange()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('done')).toHaveLength(1)
  })
})

describe('ChangeSheet, refusals at step 1', () => {
  it('puts the server’s problems on their fields, and stays on step 1', async () => {
    const preview = vi.fn<PreviewFn>(async () => ({
      ok: false,
      problems: [
        {
          path: 'change.value',
          message: 'the weight goes in steps of 2.5, so give a multiple of 2.5.',
        },
        { path: 'from', message: 'a change starts today or later.' },
        { path: 'reason', message: 'a reason is at most 200 characters.' },
        { path: 'change', message: 'nothing is paused.' },
      ],
      message: null,
    }))
    mountSheet(ROW_FROM_WEEK_6, { preview })
    await settle()
    await click('change-preview-button')
    expect(sheet().dataset.step).toBe('1')
    const field = (id: string) => q(id).closest('[data-slot="text-field"]')!.textContent
    expect(field('change-value')).toContain(
      'The weight goes in steps of 2.5, so give a multiple of 2.5.',
    )
    expect(field('change-from')).toContain('A change starts today or later.')
    expect(field('change-reason')).toContain('A reason is at most 200 characters.')
    expect(q('change-error').textContent).toContain('Nothing is paused.')
  })

  it('says why a preview failed', async () => {
    const preview = vi.fn<PreviewFn>(async () => ({
      ok: false,
      problems: [],
      message: 'Can’t reach the server, so nothing changed. Try again when you’re online.',
    }))
    mountSheet(ROW_FROM_WEEK_6, { preview })
    await settle()
    await click('change-preview-button')
    expect(q('change-error').textContent).toContain('Can’t reach the server')
  })

  it('says why dropping a hand-edit failed', async () => {
    const preview = vi
      .fn<PreviewFn>()
      .mockResolvedValueOnce({ ok: true, data: PREVIEW })
      .mockResolvedValueOnce({ ok: false, problems: [], message: 'Offline.' })
    mountSheet(ROW_FROM_WEEK_6, { preview })
    await settle()
    await click('change-preview-button')
    await click('change-drop-hand-edit')
    expect(q('change-error').textContent).toContain('Offline.')
    expect(q('change-hand-edit').textContent).toContain('Week 5 keeps')
  })
})

describe('ChangeSheet, each change it sends', () => {
  async function previewed(start: SheetStart, steps: () => Promise<void> = async () => {}) {
    const mounted = mountSheet(start)
    await settle()
    await steps()
    await click('change-preview-button')
    const sent = mounted.preview.mock.calls[0]![0]
    mounted.wrapper.unmount()
    await settle()
    return sent
  }

  it('sends That week only as a hand-edit, and says the weeks after stay', async () => {
    const request = await previewed({ ...ROW_FROM_WEEK_6, scope: 'once' }, async () => {
      await type('change-value', '40')
    })
    expect(request.change).toEqual({
      type: 'edit-week',
      activity: 'row',
      week: 6,
      field: 'weight',
      value: 40,
    })
  })

  it('switches between From then on and That week only', async () => {
    const request = await previewed(ROW_FROM_WEEK_6, async () => {
      await segment('That week only')
      await type('change-value', '40')
    })
    expect(request.change).toMatchObject({ type: 'edit-week', week: 6 })
  })

  it('sends Set increase, the hint saying when it starts', async () => {
    const request = await previewed(ROW_FROM_WEEK_6, async () => {
      await choose('Set increase')
      const value = q<HTMLInputElement>('change-value')
      expect(document.querySelector(`label[for="${value.id}"]`)!.textContent).toBe(
        'Increase in kg a week',
      )
      expect(value.closest('[data-slot="text-field"]')!.textContent).toContain(
        'From the next programme week.',
      )
      await type('change-value', '5')
    })
    expect(request.change).toEqual({
      type: 'set-increase',
      activity: 'row',
      field: 'weight',
      add: 5,
    })
  })

  it('labels a rate in percent', async () => {
    mountSheet({
      ...ROW_FROM_WEEK_6,
      title: 'Change Back squat',
      activity: 'squat',
      options: activityOptions(RUN, 'squat'),
    })
    await settle()
    await choose('Set increase')
    const value = q<HTMLInputElement>('change-value')
    expect(document.querySelector(`label[for="${value.id}"]`)!.textContent).toBe(
      'Increase in % a week',
    )
  })

  it('sends Pause activity for some weeks, or until resumed', async () => {
    const request = await previewed(ROW_FROM_WEEK_6, async () => {
      await choose('Pause activity')
      expect(has('change-value')).toBe(false)
      expect(q('change-weeks').closest('[data-slot="text-field"]')!.textContent).toContain(
        'Leave it empty to pause until you resume it.',
      )
      await type('change-weeks', '2')
    })
    expect(request.change).toEqual({ type: 'pause-activity', activity: 'row', weeks: 2 })
  })

  it('sends End activity, and Set for another field', async () => {
    expect((await previewed(ROW_FROM_WEEK_6, () => choose('End activity'))).change).toEqual({
      type: 'end-activity',
      activity: 'row',
    })
    const request = await previewed(ROW_FROM_WEEK_6, async () => {
      await choose('Set reps')
      const value = q<HTMLInputElement>('change-value')
      expect(document.querySelector(`label[for="${value.id}"]`)!.textContent).toBe('Reps')
      expect(value.closest('[data-slot="text-field"]')!.textContent).toContain(
        'Week 6 is 5 reps now.',
      )
      await type('change-value', '6')
    })
    expect(request.change).toEqual({ type: 'set-value', activity: 'row', field: 'reps', value: 6 })
  })

  it('offers Resume activity for a paused one', async () => {
    const options = activityOptions(RUN, 'deadlift', '2026-11-18')
    expect(options.map((o) => o.kind)).toContain('resume-activity')
    expect(options.map((o) => o.kind)).not.toContain('pause-activity')
    const request = await previewed({
      ...ROW_FROM_WEEK_6,
      title: 'Change Deadlift',
      activity: 'deadlift',
      options,
      kind: 'resume-activity',
      field: null,
      from: '2026-11-18',
    })
    expect(request.change).toEqual({ type: 'resume-activity', activity: 'deadlift' })
  })

  const PROGRAMME: SheetStart = {
    title: 'Change Beginner 5×5',
    options: programmeOptions(RUN),
    kind: 'pause-programme',
    field: null,
    activity: null,
    from: TODAY,
    scope: 'on',
    undo: null,
  }

  it('offers the programme’s changes from the overview', () => {
    expect(programmeOptions(RUN).map((o) => o.kind)).toEqual([
      'pause-programme',
      'go-to-week',
      'add-activity',
    ])
    expect(programmeOptions({ ...RUN, status: 'paused' }).map((o) => o.kind)).toEqual([
      'resume-programme',
      'go-to-week',
      'add-activity',
    ])
  })

  it('sends Pause programme, Go to week and Resume programme', async () => {
    expect((await previewed(PROGRAMME, () => type('change-weeks', '3'))).change).toEqual({
      type: 'pause-programme',
      weeks: 3,
    })
    const go = await previewed(PROGRAMME, async () => {
      await choose('Go to week')
      expect(q('change-week').closest('[data-slot="text-field"]')!.textContent).toContain(
        'From week 1 to week 8.',
      )
      await type('change-week', '6')
    })
    expect(go.change).toEqual({ type: 'go-to-week', week: 6 })
    const paused = {
      ...PROGRAMME,
      options: programmeOptions({ ...RUN, status: 'paused' }),
      kind: 'resume-programme' as const,
    }
    const resume = await previewed(paused, () => segment('The week after'))
    expect(resume.change).toEqual({ type: 'resume-programme', at: 'next' })
  })

  it('sends Add activity with its name and values', async () => {
    const request = await previewed(PROGRAMME, async () => {
      await choose('Add activity')
      await type('change-add-name', 'Dips')
      await type('change-add-target', '2')
      await type('change-add-sets', '3')
      await type('change-add-reps', '8')
      await type('change-add-weight', '10')
    })
    expect(request.change).toEqual({
      type: 'add-activity',
      activity: { key: 'dips', name: 'Dips', target: 2, sets: 3, reps: 8, weight: 10 },
    })
  })

  it('sends Undo for a change, saying which', async () => {
    const start: SheetStart = {
      ...PROGRAMME,
      options: [{ kind: 'undo', field: null }],
      kind: 'undo',
      undo: 3,
    }
    const request = await previewed(start, async () => {
      expect(q('change-undoes').textContent).toBe(
        'Undoes “Bench press set to 30 kg, from Thu 12 Nov.”',
      )
    })
    expect(request.change).toEqual({ type: 'undo', change: 3 })
  })
})

describe('ChangeSheet, its edges', () => {
  it('says nothing about the value in force on a day past the plan', async () => {
    mountSheet()
    await settle()
    await type('change-from', '2027-06-07')
    const value = q<HTMLInputElement>('change-value')
    expect(value.closest('[data-slot="text-field"]')!.textContent).not.toContain('now.')
  })

  it('says nothing about a change to undo that isn’t in the log', async () => {
    mountSheet({
      ...ROW_FROM_WEEK_6,
      options: [{ kind: 'undo', field: null }],
      kind: 'undo',
      undo: 99,
    })
    await settle()
    expect(has('change-undoes')).toBe(false)
  })

  it('puts a new activity’s problems on its fields, and clears them once it previews', async () => {
    const preview = vi
      .fn<PreviewFn>()
      .mockResolvedValueOnce({
        ok: false,
        problems: [{ path: 'change.activity.name', message: 'give a name of 1 to 60 characters.' }],
        message: null,
      })
      .mockResolvedValueOnce({ ok: true, data: PREVIEW })
    mountSheet(
      {
        ...ROW_FROM_WEEK_6,
        options: programmeOptions(RUN),
        kind: 'add-activity',
        field: null,
        activity: null,
      },
      { preview },
    )
    await settle()
    await click('change-preview-button')
    expect(q('change-add-name').closest('[data-slot="text-field"]')!.textContent).toContain(
      'Give a name of 1 to 60 characters.',
    )
    await type('change-add-name', 'Dips')
    await click('change-preview-button')
    expect(sheet().dataset.step).toBe('2')
    await click('change-back')
    expect(q('change-add-name').closest('[data-slot="text-field"]')!.textContent).not.toContain(
      'Give a name',
    )
  })

  it('previews once, however often Preview change is pressed, and confirms nothing before', async () => {
    const { wrapper, preview, confirm } = mountSheet()
    await settle()
    await (wrapper.vm as unknown as { confirmChange: () => Promise<void> }).confirmChange()
    expect(confirm).not.toHaveBeenCalled()
    q('change-preview-button').click()
    q('change-preview-button').click()
    await settle()
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it('names each activity when a change reaches several, with its reason after the sentence', async () => {
    const several: ChangePreview = {
      ...PREVIEW,
      change: { ...PREVIEW.change, reason: 'A cold' },
      blocking: [],
      cells: [
        {
          monday: '2026-11-16',
          key: 'squat',
          field: null,
          before: 'running',
          after: 'paused',
          starts: '2026-11-16',
          programmeWeek: 5,
        },
        {
          monday: '2026-11-16',
          key: 'gone',
          field: 'weight',
          before: null,
          after: 40,
          starts: '2026-11-16',
          programmeWeek: null,
        },
      ],
    }
    mountSheet(ROW_FROM_WEEK_6, {
      preview: vi.fn<PreviewFn>(async () => ({ ok: true, data: several })),
    })
    await settle()
    await click('change-preview-button')
    expect(q('change-summary').textContent).toBe(
      'Weight 45 kg from Mon 16 Nov, from then on. A cold',
    )
    const weeks = [...document.querySelectorAll<HTMLElement>('[data-testid="change-preview-week"]')]
    expect(weeks[0]!.textContent).toContain('Week 5, Back squat')
    expect(weeks[0]!.textContent).toContain('Running → Paused')
    expect(weeks[1]!.textContent).toContain('Not started, gone')
    expect(weeks[1]!.dataset.week).toBeUndefined()
    expect(weeks[1]!.textContent).toContain('– → 40 kg')
  })

  it('says when no week changes', async () => {
    const none: ChangePreview = { ...PREVIEW, cells: [], blocking: [] }
    mountSheet(ROW_FROM_WEEK_6, {
      preview: vi.fn<PreviewFn>(async () => ({ ok: true, data: none })),
    })
    await settle()
    await click('change-preview-button')
    expect(q('change-preview').closest('section')!.textContent).toContain('No week changes.')
  })
})
