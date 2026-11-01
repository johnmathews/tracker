import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  buildExport,
  downloadExport,
  exportFilename,
  mergeSettings,
  mergeSummary,
  mergeTracked,
  parseExport,
  type ExportData,
} from '@/lib/transfer'
import type { Exercise, Log } from '@/lib/storage'
import type { Plans } from '@/lib/plans'
import { fixtureCases, readFixture } from './fixtures'

type Tracked = { plans: Plans<Exercise>; log: Log }
type ParseCase = { input?: unknown; inputText?: string; expected: unknown }
type MergeCase = {
  existing: Tracked
  incoming: Tracked
  expected: Tracked
  summary: { weeks: number; ticks: number }
}
type SettingsCase = { existing: unknown; incoming: unknown; expected: unknown }

describe('parseExport fixtures', () => {
  it('finds the fixture files', () => {
    expect(fixtureCases('parse').length).toBeGreaterThanOrEqual(8)
  })

  it.each(fixtureCases<ParseCase>('parse'))('%s', (_, c) => {
    const text = c.inputText ?? JSON.stringify(c.input)
    expect(parseExport(text)).toEqual(c.expected)
  })
})

describe('mergeTracked fixtures', () => {
  it('finds the fixture files', () => {
    expect(fixtureCases('merge').length).toBeGreaterThanOrEqual(5)
  })

  it.each(fixtureCases<MergeCase>('merge'))('%s', (_, c) => {
    expect(mergeTracked(c.existing, c.incoming)).toEqual(c.expected)
    expect(mergeSummary(c.existing, c.incoming)).toEqual(c.summary)
  })
})

describe('mergeSettings fixtures', () => {
  const file = readFixture('merge-settings.json') as { cases: SettingsCase[] }
  it.each(file.cases.map((c) => [JSON.stringify(c.existing), c] as const))(
    'existing %s',
    (_, c) => {
      expect(mergeSettings(c.existing as never, c.incoming as never)).toEqual(c.expected)
    },
  )
})

describe('mergeTracked', () => {
  it('copies what it adds, so later edits do not reach the imported data', () => {
    const incoming: Tracked = {
      plans: { '2026-10-19': [{ id: 'pu', name: 'Push-ups', reps: 10, target: 4 }] },
      log: { '2026-10-19': { pu: ['great', null, null, null, null, null, null] } },
    }
    const merged = mergeTracked({ plans: {}, log: {} }, incoming)
    merged.plans['2026-10-19']![0]!.reps = 99
    merged.log['2026-10-19']!.pu![1] = 'missed'
    expect(incoming.plans['2026-10-19']![0]!.reps).toBe(10)
    expect(incoming.log['2026-10-19']!.pu![1]).toBeNull()
  })

  it('leaves the existing data untouched', () => {
    const existing: Tracked = {
      plans: {},
      log: { '2026-10-19': { pu: [null, null, null, null, null, null, null] } },
    }
    mergeTracked(existing, {
      plans: {},
      log: {
        '2026-10-19': { pu: ['great', 'great', 'great', 'great', 'great', 'great', 'great'] },
      },
    })
    expect(existing.log['2026-10-19']!.pu).toEqual([null, null, null, null, null, null, null])
  })
})

describe('buildExport', () => {
  it('stamps the format, version and time, and leaves the theme out', () => {
    const exercise: Tracked = {
      plans: { '2026-10-19': [{ id: 'pu', name: 'Push-ups', reps: 10, target: 4 }] },
      log: {},
    }
    const file = buildExport({
      exercise,
      diet: { plans: {}, log: {} },
      settings: { accent: '#0a84ff', dailyPick: 4, foodPick: 3, goals: 'Run 5 km.' },
      now: new Date('2026-10-24T09:30:00.000Z'),
    })
    expect(file).toEqual({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: '2026-10-24T09:30:00.000Z',
      exercise,
      diet: { plans: {}, log: {} },
      settings: { accent: '#0a84ff', dailyPick: 4, foodPick: 3, goals: 'Run 5 km.' },
    })
  })

  it('round-trips through parseExport, My goals included', () => {
    const data = {
      exercise: {
        plans: { '2026-10-19': [{ id: 'sq', name: 'Squats', sets: 3, reps: 15, target: 4 }] },
        log: { '2026-10-19': { sq: ['great', null, null, null, null, null, 'partial'] } },
      },
      diet: {
        plans: { '2026-10-19': [{ id: 'veg', name: 'Vegetables', target: 7 }] },
        log: {},
      },
      settings: { accent: '#bf5af2', dailyPick: 2, foodPick: 2, goals: 'Fish twice a week.' },
    } satisfies ExportData
    expect(parseExport(JSON.stringify(buildExport(data)))).toEqual({ ok: true, data })
  })
})

describe('exportFilename', () => {
  it('names the file by the local date', () => {
    expect(exportFilename(new Date(2026, 9, 24, 23, 59))).toBe('tracker-2026-10-24.json')
  })
})

describe('downloadExport', () => {
  afterEach(() => vi.restoreAllMocks())

  it('downloads the export as a JSON file and releases the object URL', async () => {
    // jsdom has no object URLs; stub them and capture the blob.
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn<(b: Blob) => string>((b) => {
      blob = b
      return 'blob:export'
    })
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('tracker-2026-10-24.json')
      expect(this.href).toBe('blob:export')
      expect(this.isConnected).toBe(true)
    })
    const file = buildExport({
      exercise: { plans: {}, log: {} },
      diet: { plans: {}, log: {} },
      settings: { accent: '#30d158', dailyPick: 3, foodPick: 2, goals: '' },
    })
    downloadExport(file, new Date(2026, 9, 24))
    expect(click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export')
    expect(blob!.type).toBe('application/json')
    expect(JSON.parse(await blob!.text())).toEqual(file)
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
