import { describe, expect, it } from 'vitest'
import type { Run, Work, WorkActivity } from '@/lib/programmes'
import {
  activityTitle,
  amountText,
  chartLabel,
  currentMonday,
  leftOutLine,
  listText,
  tickText,
  workLine,
} from '@/lib/work'
import RUN_JSON from './programmes/run.json'
import WORK_JSON from './programmes/work.json'

/** The work charts' words (K179–K181, work-charts spec §5), from the run's `work` (spec §3). */

const RUN = RUN_JSON as unknown as Run
const WORK = WORK_JSON as unknown as Work
const THIS_WEEK = '2026-11-09'
const activity = (key: string) => WORK.activities.find((a) => a.key === key)!

describe('amounts', () => {
  it('use a thousands separator, and no decimals but for km, which keeps one', () => {
    expect(amountText(12400, 'kg')).toBe('12,400 kg')
    expect(amountText(3150.4, 'kg')).toBe('3,150 kg')
    expect(amountText(180, 's')).toBe('180 s')
    expect(amountText(1200, 'reps')).toBe('1,200 reps')
    expect(amountText(12.5, 'km')).toBe('12.5 km')
    expect(amountText(3, 'km')).toBe('3.0 km')
    expect(amountText(0, 'min')).toBe('0 min')
  })

  it('write an axis’s ticks with a separator, and a half where a step has one', () => {
    expect(tickText(5000)).toBe('5,000')
    expect(tickText(2.5)).toBe('2.5')
    expect(tickText(0)).toBe('0')
  })
})

describe('the line over a chart', () => {
  it('says this week’s work, of its planned, and the work done so far', () => {
    expect(workLine(WORK.total!, THIS_WEEK, true)).toEqual({
      before: 'Week 4: ',
      value: '1,575 kg',
      after: ' of 5,400 kg planned. 23,601 kg done so far.',
    })
  })

  it('leaves out the work so far for an activity without weight', () => {
    expect(workLine(activity('plank'), THIS_WEEK, false)).toEqual({
      before: 'Week 4: ',
      value: '105 s',
      after: ' of 315 s planned.',
    })
  })

  it('names both weeks of a week a change split', () => {
    const split = {
      unit: 'kg',
      weeks: [{ monday: THIS_WEEK, programmeWeeks: [4, 5], planned: 900, done: 300 }],
    }
    expect(workLine(split, THIS_WEEK, false).before).toBe('Weeks 4 and 5: ')
  })

  it('counts the whole programme when no week is this week, and a week to come as nothing', () => {
    expect(workLine(WORK.total!, null, true)).toEqual({
      before: 'In all: ',
      value: '23,601 kg',
      after: ' of 67,039 kg planned.',
    })
    const ahead = {
      unit: 's',
      weeks: [{ monday: THIS_WEEK, programmeWeeks: [1], planned: 90, done: null }],
    }
    expect(workLine(ahead, THIS_WEEK, true)).toEqual({
      before: 'Week 1: ',
      value: '0 s',
      after: ' of 90 s planned. 0 s done so far.',
    })
  })
})

describe('what the total leaves out', () => {
  it('names one activity, two, or more, as a sentence says them', () => {
    expect(leftOutLine(['Plank'])).toBe('Plank has no weight, so it is not in the total.')
    expect(leftOutLine(['Plank', 'Run'])).toBe(
      'Plank and Run have no weight, so they are not in the total.',
    )
    expect(leftOutLine(['Plank', 'Run', 'Stretch'])).toBe(
      'Plank, Run and Stretch have no weight, so they are not in the total.',
    )
    expect(leftOutLine([])).toBeNull()
  })

  it('joins names naturally', () => {
    expect(listText([])).toBe('')
    expect(listText(['Plank'])).toBe('Plank')
    expect(listText(['A', 'B', 'C', 'D'])).toBe('A, B, C and D')
  })
})

describe('a chart’s names', () => {
  it('titles an activity by its name, and what it counts when that isn’t work', () => {
    expect(activityTitle(activity('squat'))).toBe('Back squat')
    expect(activityTitle(activity('plank'))).toBe('Plank, seconds held')
    const as = (measure: WorkActivity['measure']) =>
      activityTitle({ ...activity('plank'), measure })
    expect([as('reps'), as('distance'), as('time')]).toEqual([
      'Plank, total reps',
      'Plank, distance in km',
      'Plank, time in minutes',
    ])
  })

  it('names a chart for a screen reader', () => {
    expect(chartLabel('Back squat', 'work')).toBe(
      'Back squat: work in kg planned and done, week by week',
    )
  })

  it('finds this week in the run’s grid, or none', () => {
    expect(currentMonday(RUN)).toBe(THIS_WEEK)
    const ended = structuredClone(RUN)
    ended.grid.weeks.forEach((w) => (w.current = false))
    expect(currentMonday(ended)).toBeNull()
  })
})
