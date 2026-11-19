import { describe, expect, it } from 'vitest'
import type { Run } from '@/lib/programmes'
import {
  datesText,
  dayBefore,
  daysText,
  previewWords,
  runControls,
  type ReopenPreview,
} from '@/lib/runActions'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'

const RUN = RUN_JSON as unknown as Run

describe('the run sheet’s words (K168)', () => {
  it('writes days as a span, and dates as week 1’s', () => {
    expect(daysText('2026-11-16', '2026-11-18')).toBe('Mon 16 to Wed 18 Nov')
    expect(daysText('2026-11-30', '2026-12-02')).toBe('Mon 30 Nov to Wed 2 Dec')
    expect(daysText('2026-11-16', '2026-11-16')).toBe('Mon 16 Nov')
    expect(datesText('2026-11-23', '2026-11-29')).toBe('23–29 Nov')
    expect(datesText('2026-11-30', '2026-12-06')).toBe('30 Nov–6 Dec')
    expect(datesText('2026-12-28', '2027-01-03')).toBe('28 Dec–3 Jan')
    expect(dayBefore('2026-12-01')).toBe('2026-11-30')
    expect(dayBefore('2027-01-01')).toBe('2026-12-31')
  })

  it('words a re-open with no week and no last day plainly', () => {
    const preview: ReopenPreview = {
      preview: true,
      rev: 'r',
      reopen: {
        from: '2026-11-12',
        reason: null,
        week: null,
        paused: null,
        end: null,
        lastWeek: null,
      },
    }
    const words = previewWords('reopen', preview, RUN)
    expect(words.summary).toBe('Carries on from Thu 12 Nov.')
    expect(words.rows.map((r) => r.value)).toEqual(['Thu 12 Nov', 'No day', 'No last day'])
    expect(words.calm).toBe('Nothing before Thu 12 Nov changes.')
  })

  it('reads the controls from the status, the end and canReopen, not the status alone (F8)', () => {
    const ended = { from: '2026-11-30', reason: null, seq: 5 }
    expect(runControls({ status: 'ended', ended, canReopen: true })).toBe('ended-early')
    expect(runControls({ status: 'ended', ended, canReopen: false })).toBe('ended')
    expect(runControls({ status: 'running', ended, canReopen: true })).toBe('ending')
    expect(runControls({ status: 'paused', ended, canReopen: false })).toBe('ending')
    expect(runControls({ status: 'running', ended: null, canReopen: false })).toBe('running')
  })
})
