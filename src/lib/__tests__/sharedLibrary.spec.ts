import { describe, expect, it } from 'vitest'
import type { StartPreview } from '@/lib/programmes'
import START_JSON from '@/lib/__tests__/programmes/start-preview.json'
import {
  activityChip,
  activityLink,
  copyQuestion,
  factsLine,
  planLine,
  publishTitle,
  replacesLine,
  stampDay,
} from '@/lib/sharedLibrary'

describe('the shared library’s words (shared library spec §7)', () => {
  it('writes a programme’s kind, weeks and activities, one of each in the singular', () => {
    expect(factsLine({ kind: 'strength', weeks: 8, activities: 5 })).toBe(
      'Strength · 8 weeks · 5 activities',
    )
    expect(factsLine({ kind: 'cardio', weeks: 1, activities: 1 })).toBe(
      'Cardio · 1 week · 1 activity',
    )
    expect(factsLine({ kind: 'mobility', weeks: 4, activities: 6 })).toBe(
      'Mobility · 4 weeks · 6 activities',
    )
  })

  it('writes the day of a publish from its time in seconds, in the browser’s day', () => {
    expect(stampDay(new Date(2026, 10, 17, 12).getTime() / 1000)).toBe('Tue 17 Nov')
    expect(stampDay(new Date(2026, 10, 17, 0, 0, 1).getTime() / 1000)).toBe('Tue 17 Nov')
  })

  it('names the shared copy a publish again replaces', () => {
    expect(replacesLine({ id: 's1', updatedAt: new Date(2026, 10, 17, 9).getTime() / 1000 })).toBe(
      'It replaces the shared copy from Tue 17 Nov. Copies people have made stay as they are.',
    )
  })

  it('titles the dialog for a first publish and for publishing again', () => {
    expect(publishTitle('Strength 5×5', false)).toBe('Publish Strength 5×5')
    expect(publishTitle('Strength 5×5', true)).toBe('Publish Strength 5×5 again')
  })

  it('gives an activity a chip only from plain sets and reps', () => {
    expect(activityChip({ key: 'squat', name: 'Back squat', sets: 5, reps: 5 })).toBe('5 × 5')
    expect(activityChip({ key: 'lunge', name: 'Lunge', sets: 3, reps: 8, perSide: true })).toBe(
      '3 × 8 each side',
    )
    expect(activityChip({ key: 'plank', name: 'Plank', sets: 3 })).toBeNull()
    expect(
      activityChip({ key: 'pu', name: 'Push-ups', sets: 3, reps: { start: 8, add: 1 } }),
    ).toBeNull()
  })

  it('makes a link only of a web address, named by its site', () => {
    expect(
      activityLink({ key: 'a', name: 'A', link: 'https://www.stronglifts.com/squat' }),
    ).toEqual({ href: 'https://www.stronglifts.com/squat', host: 'stronglifts.com' })
    expect(activityLink({ key: 'a', name: 'A', link: '  http://youtube.com/x ' })).toEqual({
      href: 'http://youtube.com/x',
      host: 'youtube.com',
    })
    expect(activityLink({ key: 'a', name: 'A', link: 'javascript:alert(1)' })).toBeNull()
    expect(activityLink({ key: 'a', name: 'A', link: 7 })).toBeNull()
    expect(activityLink({ key: 'a', name: 'A' })).toBeNull()
  })

  it('asks before a copy, and warns when the library already has that name (K172)', () => {
    expect(copyQuestion('Base miles', [{ name: 'Beginner 5×5' }])).toEqual({
      title: 'Copy Base miles to your library?',
      message: 'The copy is yours to change and start.',
      confirmLabel: 'Copy',
    })
    // Case and spaces aside, the same name.
    expect(copyQuestion('Base miles', [{ name: ' base MILES ' }]).message).toBe(
      'Your library already has a programme called Base miles. Copying adds another one.',
    )
  })

  it('says a shared preview’s plan is at the programme’s own values, with its week labels (K173)', () => {
    const plan = START_JSON as unknown as StartPreview
    const line = planLine(plan)
    expect(line.startsWith('Eight weeks, at the programme’s own values.')).toBe(true)
    expect(line).toContain('Deload in weeks 4 and 8.')
    expect(
      line.endsWith('You choose your own values and start day when you start your copy.'),
    ).toBe(true)
  })
})
