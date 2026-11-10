import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_FORMAT,
  buildExport,
  downloadExport,
  exportFilename,
  mergeConversations,
  mergeSettings,
  mergeSummary,
  mergeTracked,
  parseExport,
  type ExportData,
} from '@/lib/transfer'
import type { Conversation, DetailsMap, Exercise, Log } from '@/lib/storage'
import type { ItemSections } from '@/lib/itemSections'
import type { Plans } from '@/lib/plans'
import { fixtureCases, readFixture } from './fixtures'

type Tracked = { plans: Plans<Exercise>; log: Log; details: DetailsMap }
type ParseCase = { input?: unknown; inputText?: string; expected: unknown }
type MergeCase = {
  existing: Tracked
  incoming: Tracked
  expected: Tracked
  summary: { weeks: number; ticks: number; details: number }
}
type SettingsCase = { existing: unknown; incoming: unknown; expected: unknown }
type ConversationsCase = {
  description: string
  existing: Conversation[]
  incoming: Conversation[]
  expected: Conversation[]
  added: number
}

describe('parseExport fixtures', () => {
  it('finds the fixture files', () => {
    expect(fixtureCases('parse').length).toBeGreaterThanOrEqual(8)
    const conversations = fixtureCases('parse').filter(([n]) => n.startsWith('conversations'))
    expect(conversations.length).toBeGreaterThanOrEqual(4)
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

describe('mergeConversations fixtures', () => {
  const file = readFixture('merge-conversations.json') as { cases: ConversationsCase[] }
  it('finds the cases', () => {
    expect(file.cases.length).toBeGreaterThanOrEqual(5)
  })

  it.each(file.cases.map((c) => [c.description, c] as const))('%s', (_, c) => {
    const merged = mergeConversations(c.existing, c.incoming)
    expect(merged).toEqual(c.expected)
    expect(merged.length - c.existing.length).toBe(c.added)
  })
})

describe('mergeConversations', () => {
  it('copies what it adds, so later edits do not reach the imported data', () => {
    const incoming: Conversation[] = [
      {
        id: 'a',
        title: 'A',
        createdAt: 1,
        updatedAt: 1,
        turns: [{ question: 'Q', answer: 'A', stop: 'end_turn', askedAt: 1 }],
      },
    ]
    const merged = mergeConversations([], incoming)
    merged[0]!.turns[0]!.answer = 'Changed'
    expect(incoming[0]!.turns[0]!.answer).toBe('A')
  })
})

describe('mergeTracked', () => {
  it('copies what it adds, so later edits do not reach the imported data', () => {
    const incoming: Tracked = {
      plans: { '2026-10-19': [{ id: 'pu', name: 'Push-ups', reps: 10, target: 4 }] },
      log: { '2026-10-19': { pu: ['great', null, null, null, null, null, null] } },
      details: { pu: { notes: 'Slow.', fields: { equipment: 'Mat' } } },
    }
    const merged = mergeTracked({ plans: {}, log: {}, details: {} }, incoming)
    merged.plans['2026-10-19']![0]!.reps = 99
    merged.log['2026-10-19']!.pu![1] = 'missed'
    merged.details.pu!.fields!.equipment = 'Bar'
    expect(incoming.plans['2026-10-19']![0]!.reps).toBe(10)
    expect(incoming.log['2026-10-19']!.pu![1]).toBeNull()
    expect(incoming.details.pu!.fields!.equipment).toBe('Mat')
  })

  it('leaves the existing data untouched', () => {
    const existing: Tracked = {
      plans: {},
      log: { '2026-10-19': { pu: [null, null, null, null, null, null, null] } },
      details: { sq: { notes: 'Mine.' } },
    }
    const merged = mergeTracked(existing, {
      plans: {},
      log: {
        '2026-10-19': { pu: ['great', 'great', 'great', 'great', 'great', 'great', 'great'] },
      },
      details: { pu: { notes: 'Theirs.' } },
    })
    merged.details.sq!.notes = 'Changed.'
    expect(existing.log['2026-10-19']!.pu).toEqual([null, null, null, null, null, null, null])
    expect(existing.details).toEqual({ sq: { notes: 'Mine.' } })
  })
})

describe('buildExport', () => {
  it('stamps the format, version and time, and leaves the theme out', () => {
    const exercise: Tracked = {
      plans: { '2026-10-19': [{ id: 'pu', name: 'Push-ups', reps: 10, target: 4 }] },
      log: {},
      details: { pu: { notes: 'Slow.' } },
    }
    const file = buildExport({
      exercise,
      cardio: { plans: {}, log: {}, details: {} },
      diet: { plans: {}, log: {}, details: {} },
      settings: { accent: '#0a84ff', dailyPick: 4, foodPick: 3, goals: 'Run 5 km.', limits: '' },
      now: new Date('2026-10-24T09:30:00.000Z'),
    })
    expect(file).toEqual({
      format: EXPORT_FORMAT,
      version: 5,
      exportedAt: '2026-10-24T09:30:00.000Z',
      exercise,
      cardio: { plans: {}, log: {}, details: {} },
      diet: { plans: {}, log: {}, details: {} },
      settings: { accent: '#0a84ff', dailyPick: 4, foodPick: 3, goals: 'Run 5 km.', limits: '' },
    })
  })

  it('carries only plans, log and details from each section, never the revisions', () => {
    const cache = { plans: {}, log: {}, details: {}, revs: { '2026-10-19': 3 }, detailRevs: {} }
    const file = buildExport({
      exercise: cache,
      cardio: cache,
      diet: cache,
      settings: { accent: '#0a84ff', dailyPick: 4, foodPick: 3, goals: '', limits: '' },
    })
    expect(file.exercise).toEqual({ plans: {}, log: {}, details: {} })
    expect(file.cardio).toEqual({ plans: {}, log: {}, details: {} })
    expect(file.diet).toEqual({ plans: {}, log: {}, details: {} })
  })

  it('carries the item pages’ arrangement when there is one (K66)', () => {
    const itemSections: ItemSections = {
      exercise: { order: ['history', 'notes', 'details', 'plan'], hidden: ['details'] },
    }
    const base = {
      exercise: { plans: {}, log: {}, details: {} },
      cardio: { plans: {}, log: {}, details: {} },
      diet: { plans: {}, log: {}, details: {} },
    }
    const settings = { accent: '#0a84ff', dailyPick: 4, foodPick: 3, goals: '', limits: '' }
    expect(buildExport({ ...base, settings: { ...settings, itemSections } }).settings).toEqual({
      ...settings,
      itemSections,
    })
    expect(buildExport({ ...base, settings: { ...settings, itemSections: {} } }).settings).toEqual(
      settings,
    )
  })

  it('round-trips through parseExport, My goals included', () => {
    const data = {
      exercise: {
        plans: { '2026-10-19': [{ id: 'sq', name: 'Squats', sets: 3, reps: 15, target: 4 }] },
        log: { '2026-10-19': { sq: ['great', null, null, null, null, null, 'partial'] } },
        details: { sq: { notes: 'Knees out.', fields: { equipment: 'Kettlebell' } } },
      },
      cardio: {
        plans: {
          '2026-10-19': [{ id: 'cy', name: 'Cycling', duration: 1800, distance: 12.5, target: 2 }],
        },
        log: { '2026-10-19': { cy: [null, 'missed-hatch', null, null, null, null, null] } },
        details: { cy: { fields: { route: 'Along the river' } } },
      },
      diet: {
        plans: { '2026-10-19': [{ id: 'veg', name: 'Vegetables', target: 7 }] },
        log: {},
        details: {},
      },
      settings: {
        accent: '#bf5af2',
        dailyPick: 2,
        foodPick: 2,
        goals: 'Fish twice a week.',
        limits: '',
        itemSections: { food: { order: ['notes', 'details', 'plan', 'history'], hidden: [] } },
      },
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
      exercise: { plans: {}, log: {}, details: {} },
      cardio: { plans: {}, log: {}, details: {} },
      diet: { plans: {}, log: {}, details: {} },
      settings: { accent: '#30d158', dailyPick: 3, foodPick: 2, goals: '', limits: '' },
    })
    downloadExport(file, new Date(2026, 9, 24))
    expect(click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export')
    expect(blob!.type).toBe('application/json')
    expect(JSON.parse(await blob!.text())).toEqual(file)
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
