import { describe, expect, it } from 'vitest'
import { ASK_COPY, askAgainNote, historyItems, savedTurn, unsyncedNote } from '@/lib/ask'

describe('askAgainNote', () => {
  it('says the time asking opens again, today or tomorrow, from Retry-After', () => {
    const morning = new Date(2026, 10, 1, 8, 14)
    expect(askAgainNote(morning.getTime() + 3600_000, morning)).toBe(
      'You can ask again from 09:14 today.',
    )
    const late = new Date(2026, 10, 1, 23, 30)
    expect(askAgainNote(late.getTime() + 9.75 * 3600_000, late)).toBe(
      'You can ask again from 09:15 tomorrow.',
    )
  })

  it('says within a day when the time isn’t known, as when the count alone said none', () => {
    expect(askAgainNote(null, new Date())).toBe('You can ask again within 24 hours.')
  })
})

describe('unsyncedNote', () => {
  it('counts the changes still on this device in words (F11)', () => {
    expect(unsyncedNote(1)).toBe(
      'One change on this device isn’t synced yet, so the answer won’t include it.',
    )
    expect(unsyncedNote(2)).toBe(
      'Two changes on this device aren’t synced yet, so the answer won’t include them.',
    )
    expect(unsyncedNote(12)).toBe(
      '12 changes on this device aren’t synced yet, so the answer won’t include them.',
    )
  })
})

describe('savedTurn', () => {
  const turn = { question: 'Is my diet good enough?', answer: 'Mostly.', askedAt: 1 }

  it('shows a kept turn as the Transcript draws it, by how it ended', () => {
    expect(savedTurn({ ...turn, stop: 'end_turn' }, 3)).toEqual({
      id: 3,
      question: 'Is my diet good enough?',
      answer: 'Mostly.',
      state: 'done',
    })
    expect(savedTurn({ ...turn, stop: 'max_tokens' }, 1)).toMatchObject({
      state: 'stopped',
      answer: 'Mostly.',
      message: ASK_COPY.long,
    })
    expect(savedTurn({ ...turn, answer: '', stop: 'refused' }, 1)).toMatchObject({
      state: 'stopped',
      message: ASK_COPY.refused,
    })
    expect(savedTurn({ ...turn, answer: '', stop: 'cancelled' }, 1)).toMatchObject({
      state: 'stopped',
      message: ASK_COPY.cancelled,
    })
    expect(savedTurn({ ...turn, answer: '', stop: 'error' }, 1)).toMatchObject({
      state: 'error',
      message: ASK_COPY.failedEarlier,
    })
  })
})

describe('historyItems', () => {
  it('keeps the list’s well-formed items, in order', () => {
    expect(
      historyItems([
        { id: 'a', title: 'First', updatedAt: 5, turns: 2 },
        { id: 'b', title: 7, updatedAt: 5 },
        { id: 'c', title: 'No time' },
        'junk',
        { id: 'd', title: 'Second', updatedAt: 4 },
      ]),
    ).toEqual([
      { id: 'a', title: 'First', updatedAt: 5 },
      { id: 'd', title: 'Second', updatedAt: 4 },
    ])
    expect(historyItems(null)).toEqual([])
  })
})
