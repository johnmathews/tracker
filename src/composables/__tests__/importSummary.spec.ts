import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useImportSummary } from '@/composables/importSummary'
import { useTrackersStore } from '@/stores/trackers'
import { useDetailsStore } from '@/stores/details'
import { firstTrackers, type TrackerInfo } from '@/lib/trackers'
import { emptySection, type ExportData } from '@/lib/transfer'

const WEEK = '2026-10-19'
const SWIM: TrackerInfo = {
  id: 'xswim',
  name: 'Swimming',
  kind: 'cardio',
  position: 3,
  dailyTarget: null,
  startWeek: null,
  endWeek: null,
}
const PLAN = { [WEEK]: [{ id: 'a', name: 'A', target: 2 }] }
const LOG = { [WEEK]: { a: ['great' as const, null, null, null, null, null, null] } }

/** A version 6 file's data with the first three trackers and `more`. */
function file(more: Partial<ExportData> = {}): ExportData {
  return {
    trackers: [],
    sections: { exercise: emptySection(), cardio: emptySection(), diet: emptySection() },
    settings: null,
    ...more,
  }
}

describe('what an import adds (K123)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useTrackersStore().adopt(firstTrackers(null), {})
  })

  it('counts the trackers the account doesn’t have, and their data', () => {
    const summary = useImportSummary()
    const data = file({
      trackers: [SWIM, { ...SWIM, id: 'cardio', name: 'Cardio' }],
      sections: {
        ...file().sections,
        xswim: { plans: PLAN, log: LOG, details: { a: { notes: 'Lido' } } },
      },
    })
    expect(summary.additions(data)).toMatchObject({ trackers: 1, plans: 1, ticks: 1, details: 1 })
    expect(summary.describe(data)).toBe(
      'Adds one weekly plan and one marked day, plus one tracker and the notes and details of one item. Existing plans and marks stay as they are.',
    )
    expect(summary.addsAnything(file({ trackers: [SWIM] }))).toBe(true)
    useTrackersStore().adoptTracker(SWIM)
    expect(summary.addsAnything(file({ trackers: [SWIM] }))).toBe(false)
  })

  it('skips data for a tracker the account has as another kind, as the API does', () => {
    const t = useTrackersStore()
    t.adoptTracker({ ...SWIM, kind: 'food' })
    useDetailsStore().setNotes('xswim', 'b', 'Mine')
    const summary = useImportSummary()
    const data = file({
      trackers: [SWIM],
      sections: { ...file().sections, xswim: { plans: PLAN, log: LOG, details: {} } },
    })
    expect(summary.additions(data)).toMatchObject({ trackers: 0, plans: 0, ticks: 0 })
    // The same kind counts against what the account holds.
    t.adoptTracker({ ...SWIM, kind: 'cardio' })
    expect(summary.additions(data)).toMatchObject({ plans: 1, ticks: 1 })
  })

  it('reads a file from before version 6 onto the first three trackers', () => {
    const summary = useImportSummary()
    const data = file({
      sections: { ...file().sections, diet: { plans: PLAN, log: {}, details: {} } },
    })
    expect(summary.additions(data)).toMatchObject({ trackers: 0, plans: 1 })
    // Data under an id no tracker of the file's names is the API's to skip, so it counts nothing.
    const stray = file({ sections: { xnope: { plans: PLAN, log: {}, details: {} } } })
    expect(summary.additions(stray)).toMatchObject({ plans: 0 })
  })
})
