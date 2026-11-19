import { describe, expect, it } from 'vitest'
import {
  activityKey,
  activityOptions,
  changeWords,
  increaseLabel,
  startLine,
  type StartPreview,
  barSentence,
  calmLine,
  changeBody,
  copyName,
  dayText,
  emptyForm,
  failureText,
  fieldsOf,
  goalText,
  increaseOf,
  logSentence,
  primaryField,
  problemsLine,
  programmeWeekOn,
  reasonText,
  runLine,
  runMeta,
  runsFromState,
  sentenceCase,
  setsLine,
  sourceText,
  stateWord,
  summarySentence,
  valueText,
  weekCount,
  weekDates,
  weekName,
  weekOf,
  type Grid,
  type LogEntry,
  type ProgrammeDoc,
  type Run,
  type RunSummary,
} from '@/lib/programmes'
import RUN_JSON from './programmes/run.json'
import PAUSED_JSON from './programmes/run-paused.json'
import START_JSON from './programmes/start-preview.json'

const RUN = RUN_JSON as unknown as Run
const PAUSED = PAUSED_JSON as unknown as Run
const NAMES = {
  squat: 'Back squat',
  bench: 'Bench press',
  row: 'Barbell row',
  deadlift: 'Deadlift',
}

describe('dates as the programme views write them', () => {
  it('names a day by its weekday, date and month', () => {
    expect(dayText('2026-12-21')).toBe('Mon 21 Dec')
    expect(dayText('2026-09-02')).toBe('Wed 2 Sep')
  })

  it('writes a week’s dates within a month and across one', () => {
    expect(weekDates('2026-12-14')).toBe('14–20 Dec')
    expect(weekDates('2026-11-30')).toBe('30 Nov–6 Dec')
  })

  it('names a week by its programme week, or both when a change split it', () => {
    expect(weekName({ programmeWeeks: [4] })).toBe('Week 4')
    expect(weekName({ programmeWeeks: [4, 7] })).toBe('Weeks 4 and 7')
    expect(weekName({ programmeWeeks: [] })).toBe('Before the start')
  })
})

describe('values as the cells write them (spec P4: the server computes, the app only words)', () => {
  it('writes each field with its unit', () => {
    expect(valueText('weight', 42.5)).toBe('42.5 kg')
    expect(valueText('duration', 30)).toBe('30 s')
    expect(valueText('duration', 90)).toBe('1 min 30 s')
    expect(valueText('distance', 2.5)).toBe('2.5 km')
    expect(valueText('reps', 8)).toBe('8 reps')
    expect(valueText('sets', 3)).toBe('3 sets')
    expect(valueText('target', 3)).toBe('3 a week')
    expect(valueText('perSide', 1)).toBe('1')
  })

  it('picks the value a cell leads with: weight, then time, then distance, then reps, then sets', () => {
    expect(primaryField({ target: 3, sets: 5, reps: 5, weight: 40 })).toBe('weight')
    expect(primaryField({ target: 3, sets: 3, duration: 30 })).toBe('duration')
    expect(primaryField({ target: 3, distance: 5 })).toBe('distance')
    expect(primaryField({ target: 3, sets: 3, reps: 8 })).toBe('reps')
    expect(primaryField({ target: 3, sets: 3 })).toBe('sets')
    expect(primaryField({ target: 3 })).toBeNull()
  })

  it('writes the line under the value: sets and reps, or the sets alone', () => {
    expect(setsLine({ sets: 5, reps: 5, weight: 40 }, 'strength')).toBe('5 × 5')
    expect(setsLine({ sets: 3, reps: 5, weight: 40, perSide: true }, 'strength')).toBe(
      '3 × 5 each side',
    )
    expect(setsLine({ sets: 3, duration: 30 }, 'strength')).toBe('3 sets')
    expect(setsLine({ sets: 2, duration: 45, perSide: true }, 'mobility')).toBe('2 sets, each side')
    expect(setsLine({ sets: 3, reps: 8 }, 'mobility')).toBe('3 sets')
    expect(setsLine({ reps: 8, weight: 20 }, 'strength')).toBe('8 reps')
    expect(setsLine({ weight: 20 }, 'strength')).toBeNull()
    expect(setsLine({ duration: 1200, distance: 3 }, 'cardio')).toBe('3 km')
    expect(setsLine({ distance: 3 }, 'cardio')).toBeNull()
  })

  it('writes the goal', () => {
    expect(goalText(3)).toBe('3 a week')
  })

  it('counts a past week as RecentWeeks does: any mark, against the week’s goal', () => {
    const week2 = RUN.grid.weeks[1]!
    expect(weekCount(week2.cells.squat!)).toEqual({ done: 3, target: 3, met: true })
    expect(weekCount(week2.cells.bench!)).toEqual({ done: 2, target: 3, met: false })
    expect(weekCount({ ...week2.cells.row!, marks: undefined })).toEqual({
      done: 0,
      target: 3,
      met: false,
    })
  })

  it('names the fields each kind plans', () => {
    expect(fieldsOf('strength')).toEqual(['weight', 'reps', 'duration', 'sets', 'target'])
    expect(fieldsOf('mobility')).toEqual(['reps', 'duration', 'sets', 'target'])
    expect(fieldsOf('cardio')).toEqual(['duration', 'distance', 'target'])
  })

  it('words an activity’s state', () => {
    expect(stateWord('running')).toBe('Active')
    expect(stateWord('paused')).toBe('Paused')
    expect(stateWord('ended')).toBe('Ended')
    expect(stateWord('not-started')).toBe('Not yet')
    expect(stateWord(null)).toBe('Not yet')
  })
})

describe('a run in a line', () => {
  const summary: RunSummary = {
    programmeId: 'p',
    name: 'Beginner 5×5',
    status: 'running',
    week: 4,
    weeks: 8,
    start: '2026-11-23',
    end: '2027-01-17',
    pausedUntil: null,
    rev: 'r',
  }

  it('says the week, when it started and when it ends (“Running” is also an activity’s name)', () => {
    expect(runLine(summary)).toEqual({
      lead: 'Week 4 of 8.',
      rest: 'Started Mon 23 Nov. Ends Sun 17 Jan.',
    })
  })

  it('says since when a run is paused, and why, as the Started list reads (§8.8)', () => {
    const paused = { ...summary, status: 'paused' as const, end: null }
    expect(runLine({ ...paused, pausedSince: '2026-12-07', pauseReason: 'A cold' })).toEqual({
      lead: 'Week 4 of 8.',
      rest: 'Paused since Mon 7 Dec. A cold.',
    })
    expect(
      runLine({
        ...paused,
        pausedSince: '2026-12-07',
        pausedUntil: '2026-12-21',
        pauseReason: 'away for work!',
      }),
    ).toEqual({
      lead: 'Week 4 of 8.',
      rest: 'Paused since Mon 7 Dec until Mon 21 Dec. Away for work!',
    })
    expect(runLine({ ...paused, pausedSince: '2026-12-07', pauseReason: null })).toEqual({
      lead: 'Week 4 of 8.',
      rest: 'Paused since Mon 7 Dec.',
    })
  })

  it('words a reason as a sentence of its own', () => {
    expect(reasonText('knee')).toBe('Knee.')
    expect(reasonText(' A cold. ')).toBe('A cold.')
    expect(reasonText('Away?')).toBe('Away?')
    expect(reasonText('  ')).toBe('')
    expect(reasonText(null)).toBe('')
  })

  it('says paused, and until when', () => {
    expect(runLine({ ...summary, status: 'paused', pausedUntil: '2026-12-07', end: null })).toEqual(
      { lead: 'Week 4 of 8.', rest: 'Paused until Mon 7 Dec.' },
    )
    expect(runLine({ ...summary, status: 'paused', end: null })).toEqual({
      lead: 'Week 4 of 8.',
      rest: 'Paused.',
    })
  })

  it('says when an upcoming run starts', () => {
    expect(runLine({ ...summary, status: 'upcoming', week: null })).toEqual({
      lead: 'Starts Mon 23 Nov.',
      rest: 'Ends Sun 17 Jan.',
    })
  })

  it('heads the overview with the week, the start and the end', () => {
    expect(runMeta(RUN)).toEqual({
      lead: 'Week 4 of 8.',
      rest: 'Started Fri 23 Oct, ends Sun 13 Dec.',
    })
    expect(runMeta(PAUSED)).toEqual({
      lead: null,
      rest: 'Paused since Thu 12 Nov, in week 4 of 8. Resume it when you’re ready.',
    })
    const until = { ...RUN, status: 'paused', clock: { ...RUN.clock, until: '2026-11-26' } }
    expect(runMeta(until as Run)).toEqual({
      lead: null,
      rest: 'Paused until Thu 26 Nov, in week 4 of 8.',
    })
    expect(runMeta({ ...RUN, status: 'upcoming', week: null })).toEqual({
      lead: null,
      rest: 'Starts Fri 23 Oct, ends Sun 13 Dec.',
    })
    expect(runMeta({ ...RUN, status: 'ended' })).toEqual({ lead: null, rest: 'Ended Sun 13 Dec.' })
    expect(runMeta({ ...RUN, status: 'ended', end: null })).toEqual({ lead: null, rest: 'Ended.' })
    // An end with a reason says it after the last day (K168, the mockup's state (i)).
    const ended = { from: '2026-11-16', reason: 'knee', seq: 5 }
    expect(runMeta({ ...RUN, status: 'ended', end: '2026-11-15', ended })).toEqual({
      lead: null,
      rest: 'Ended Sun 15 Nov. Knee.',
    })
  })

  it('reads the runs and today from the state, leaving out anything else', () => {
    expect(runsFromState({ today: '2026-11-12', runs: { t1: summary, bad: 3 } })).toEqual({
      today: '2026-11-12',
      runs: { t1: summary },
    })
    expect(runsFromState(null)).toEqual({ today: null, runs: {} })
    expect(runsFromState({ runs: [] })).toEqual({ today: null, runs: {} })
  })
})

describe('the words around problems and failures', () => {
  it('counts the problems in words', () => {
    expect(problemsLine(1)).toBe('This programme has one problem. Fix it, then check it again.')
    expect(problemsLine(3)).toBe(
      'This programme has three problems. Fix them, then check it again.',
    )
  })

  it('starts the server’s sentence with a capital', () => {
    expect(sentenceCase('a change starts today or later.')).toBe('A change starts today or later.')
    expect(sentenceCase('')).toBe('')
  })

  it('says what went wrong with a request', () => {
    expect(failureText({ kind: 'offline' })).toBe(
      'Can’t reach the server, so nothing changed. Try again when you’re online.',
    )
    expect(failureText({ kind: 'server', status: 500 })).toBe(
      'The server had a problem, so nothing changed. Try again in a while.',
    )
    expect(failureText({ kind: 'auth' })).toBe('Your session has ended. Sign in again.')
    expect(failureText({ kind: 'conflict', body: { rev: 1 } })).toBe(
      'The plan changed on another device. Check it, then try again.',
    )
    expect(failureText({ kind: 'refused', status: 413, code: 'quota' })).toBe(
      'Your account is full, so nothing was saved.',
    )
    expect(failureText({ kind: 'refused', status: 413, code: 'too-large' })).toBe(
      'That programme is too big. A programme is at most 128 KB.',
    )
    expect(failureText({ kind: 'refused', status: 409, code: 'too-many' })).toBe(
      'There’s no room for another. Delete one you don’t need, then try again.',
    )
    expect(failureText({ kind: 'refused', status: 409, code: 'ended' })).toBe(
      'This programme has ended, so it can’t change.',
    )
    expect(failureText({ kind: 'refused', status: 404, code: 'not-found' })).toBe(
      'That programme is gone. It may have been deleted on another device.',
    )
    expect(failureText({ kind: 'refused', status: 400, code: 'invalid' })).toBe(
      'The server refused it, so nothing changed. Try again.',
    )
  })

  it('names a copy, within the 60 characters a name may have', () => {
    expect(copyName('Beginner 5×5')).toBe('Copy of Beginner 5×5')
    expect(copyName('x'.repeat(60))).toBe(`Copy of ${'x'.repeat(52)}`)
  })

  it('says where a change came from', () => {
    expect(sourceText('app')).toBe('From the app')
    expect(sourceText('ask')).toBe('From Ask')
    expect(sourceText('Claude')).toBe('From Claude')
  })
})

describe('changes in sentences', () => {
  it('words End programme and a re-open for the log (K156, K165)', () => {
    expect(logSentence({ type: 'end-programme' }, '2026-12-21', NAMES, RUN.log)).toBe(
      'Programme ended, from Mon 21 Dec.',
    )
    expect(logSentence({ type: 'reopen-programme' }, '2026-12-28', NAMES, RUN.log)).toBe(
      'Programme re-opened, from Mon 28 Dec.',
    )
    expect(
      logSentence({ type: 'end-programme', restarted: true }, '2026-12-21', NAMES, RUN.log),
    ).toBe('Restarted from week 1, from Mon 21 Dec.')
  })

  it('words each kind of change for the log', () => {
    const say = (change: Record<string, unknown>, from = '2026-12-21') =>
      logSentence({ type: 'set-value', ...change } as never, from, NAMES, RUN.log)
    expect(say({ activity: 'row', field: 'weight', value: 45 })).toBe(
      'Barbell row set to 45 kg, from Mon 21 Dec.',
    )
    expect(say({ type: 'set-increase', activity: 'squat', field: 'weight', rate: 7.5 })).toBe(
      'Back squat increase set to 7.5% a week, from Mon 21 Dec.',
    )
    expect(say({ type: 'set-increase', activity: 'bench', field: 'weight', add: 2.5 })).toBe(
      'Bench press increase set to 2.5 kg a week, from Mon 21 Dec.',
    )
    expect(say({ type: 'edit-week', activity: 'row', week: 6, field: 'weight', value: 35 })).toBe(
      'Barbell row set to 35 kg in week 6 only.',
    )
    expect(say({ type: 'pause-activity', activity: 'deadlift', weeks: 2 })).toBe(
      'Deadlift paused for two weeks, from Mon 21 Dec.',
    )
    expect(say({ type: 'pause-activity', activity: 'deadlift', weeks: 1 })).toBe(
      'Deadlift paused for one week, from Mon 21 Dec.',
    )
    expect(say({ type: 'pause-activity', activity: 'deadlift' })).toBe(
      'Deadlift paused until resumed, from Mon 21 Dec.',
    )
    expect(say({ type: 'resume-activity', activity: 'deadlift' })).toBe(
      'Deadlift resumed, from Mon 21 Dec.',
    )
    expect(say({ type: 'end-activity', activity: 'deadlift' })).toBe(
      'Deadlift ended, from Mon 21 Dec.',
    )
    expect(say({ type: 'add-activity', activity: { key: 'dips', name: 'Dips' } })).toBe(
      'Dips added, from Mon 21 Dec.',
    )
    expect(say({ type: 'pause-programme', weeks: 3 })).toBe(
      'Programme paused for three weeks, from Mon 21 Dec.',
    )
    expect(say({ type: 'pause-programme' })).toBe(
      'Programme paused until resumed, from Mon 21 Dec.',
    )
    expect(say({ type: 'resume-programme' })).toBe(
      'Programme resumed at the paused week, from Mon 21 Dec.',
    )
    expect(say({ type: 'resume-programme', at: 'next' })).toBe(
      'Programme resumed at the next week, from Mon 21 Dec.',
    )
    expect(say({ type: 'go-to-week', week: 5 })).toBe('Programme moved to week 5, from Mon 21 Dec.')
    expect(say({ type: 'set-parameter', param: 'squat', value: 50 })).toBe(
      'Parameter squat set to 50, from Mon 21 Dec.',
    )
    expect(say({ type: 'undo', change: 3 })).toBe(
      'Undid: Bench press set to 30 kg, from Thu 12 Nov.',
    )
    expect(say({ type: 'undo', change: 99 })).toBe('Undid a change.')
    // An activity no longer in the grid keeps its key as its name.
    expect(say({ activity: 'gone', field: 'reps', value: 8 })).toBe(
      'gone set to 8 reps, from Mon 21 Dec.',
    )
  })

  it('words the change at the top of the preview, with the field first', () => {
    const body = { type: 'set-value', activity: 'row', field: 'weight', value: 45 } as const
    expect(summarySentence(body, '2026-12-21', NAMES, [])).toBe(
      'Weight 45 kg from Mon 21 Dec, from then on.',
    )
    expect(
      summarySentence(
        { type: 'edit-week', activity: 'row', week: 5, field: 'weight', value: 45 },
        '2026-12-21',
        NAMES,
        [],
      ),
    ).toBe('Weight 45 kg in week 5 only.')
    expect(summarySentence({ type: 'go-to-week', week: 2 }, '2026-12-21', NAMES, [])).toBe(
      'Programme moved to week 2, from Mon 21 Dec.',
    )
  })

  it('words the change on the preview bar', () => {
    const body = { type: 'set-value', activity: 'row', field: 'weight', value: 45 } as const
    expect(barSentence(body, '2026-12-21', NAMES, [])).toBe('Barbell row at 45 kg from Mon 21 Dec.')
    expect(barSentence({ type: 'end-activity', activity: 'row' }, '2026-12-21', NAMES, [])).toBe(
      'Barbell row ended, from Mon 21 Dec.',
    )
  })

  it('says what doesn’t change', () => {
    expect(calmLine({ type: 'set-value' }, '2026-12-21', 8)).toBe(
      'Nothing before Mon 21 Dec changes.',
    )
    expect(calmLine({ type: 'edit-week', week: 5 }, '2026-12-21', 8)).toBe(
      'Weeks 6 to 8 stay as they are. Nothing before Mon 21 Dec changes.',
    )
    expect(calmLine({ type: 'edit-week', week: 7 }, '2026-12-21', 8)).toBe(
      'Week 8 stays as it is. Nothing before Mon 21 Dec changes.',
    )
    expect(calmLine({ type: 'edit-week', week: 8 }, '2026-12-21', 8)).toBe(
      'Nothing before Mon 21 Dec changes.',
    )
  })
})

describe('the change a sheet sends', () => {
  const grid: Grid = RUN.grid
  const doc = RUN.doc as ProgrammeDoc
  const ctx = { grid, doc, log: RUN.log, kind: 'strength' as const, drop: [] as number[] }

  it('finds the grid week and the programme week of a day', () => {
    expect(weekOf(grid, '2026-11-18')?.monday).toBe('2026-11-16')
    expect(weekOf(grid, '2027-03-01')).toBeNull()
    expect(programmeWeekOn(grid, '2026-11-18')).toBe(5)
    expect(programmeWeekOn(grid, '2027-03-01')).toBeNull()
  })

  it('finds the field an activity’s increase works on, and how', () => {
    expect(increaseOf(doc, [], 'squat')).toEqual({ field: 'weight', how: 'rate' })
    expect(increaseOf(doc, [], 'bench')).toEqual({ field: 'weight', how: 'add' })
    expect(increaseOf(doc, [], 'plank')).toEqual({ field: 'duration', how: 'add' })
    expect(increaseOf(doc, [], 'nope')).toBeNull()
    const added: LogEntry = {
      seq: 9,
      madeAt: 0,
      from: '2026-11-12',
      change: { type: 'add-activity', activity: { key: 'dips', name: 'Dips', reps: 8 } },
      reason: null,
      source: 'app',
      undoneBy: null,
      undoable: true,
    }
    expect(increaseOf(doc, [added], 'dips')).toBeNull()
    const growing: LogEntry = {
      ...added,
      change: {
        type: 'add-activity',
        activity: { key: 'dips', name: 'Dips', reps: { start: 8, add: 1 } },
      },
    }
    expect(increaseOf(doc, [growing], 'dips')).toEqual({ field: 'reps', how: 'add' })
  })

  it('sends a value from then on as Set value, its number parsed', () => {
    const form = {
      ...emptyForm('set-value', '2026-11-16'),
      activity: 'row',
      field: 'weight' as const,
      value: '45',
      reason: '  Rows feel light ',
    }
    expect(changeBody(form, ctx)).toEqual({
      change: { type: 'set-value', activity: 'row', field: 'weight', value: 45 },
      from: '2026-11-16',
      reason: 'Rows feel light',
    })
    expect(changeBody({ ...form, value: '42,5', reason: ' ' }, { ...ctx, drop: [1] })).toEqual({
      change: {
        type: 'set-value',
        activity: 'row',
        field: 'weight',
        value: 42.5,
        dropHandEdits: [1],
      },
      from: '2026-11-16',
    })
  })

  it('leaves a value that isn’t a number for the server to refuse', () => {
    const form = {
      ...emptyForm('set-value', '2026-11-16'),
      activity: 'row',
      field: 'weight' as const,
    }
    expect(changeBody({ ...form, value: 'heavy' }, ctx).change).toMatchObject({ value: 'heavy' })
    expect(changeBody({ ...form, value: '' }, ctx).change).toMatchObject({ value: '' })
  })

  it('sends That week only as a hand-edit of the from day’s programme week', () => {
    const form = {
      ...emptyForm('set-value', '2026-11-25'),
      activity: 'row',
      field: 'weight' as const,
      value: '35',
      scope: 'once' as const,
    }
    expect(changeBody(form, { ...ctx, drop: [4] })).toEqual({
      change: { type: 'edit-week', activity: 'row', week: 6, field: 'weight', value: 35 },
      from: '2026-11-25',
    })
    expect(changeBody({ ...form, from: '2027-05-01' }, ctx).change).toMatchObject({ week: null })
  })

  it('sends Set increase as add or rate, as the activity’s progression has it', () => {
    const form = { ...emptyForm('set-increase', '2026-11-16'), value: '7.5' }
    expect(changeBody({ ...form, activity: 'squat' }, ctx).change).toEqual({
      type: 'set-increase',
      activity: 'squat',
      field: 'weight',
      rate: 7.5,
    })
    expect(
      changeBody({ ...form, activity: 'bench', value: '5' }, { ...ctx, drop: [2] }).change,
    ).toEqual({
      type: 'set-increase',
      activity: 'bench',
      field: 'weight',
      add: 5,
      dropHandEdits: [2],
    })
    expect(changeBody({ ...form, activity: 'nope' }, ctx).change).toEqual({
      type: 'set-increase',
      activity: 'nope',
      field: null,
      add: 7.5,
    })
  })

  it('sends pauses for some weeks or until resumed, and resumes', () => {
    const at = '2026-11-16'
    expect(
      changeBody({ ...emptyForm('pause-activity', at), activity: 'deadlift', weeks: '2' }, ctx),
    ).toEqual({
      change: { type: 'pause-activity', activity: 'deadlift', weeks: 2 },
      from: at,
    })
    expect(changeBody({ ...emptyForm('pause-programme', at), weeks: ' ' }, ctx).change).toEqual({
      type: 'pause-programme',
    })
    expect(changeBody({ ...emptyForm('resume-programme', at), at: 'next' }, ctx).change).toEqual({
      type: 'resume-programme',
      at: 'next',
    })
    expect(
      changeBody(
        { ...emptyForm('resume-activity', at), activity: 'deadlift' },
        { ...ctx, drop: [7] },
      ).change,
    ).toEqual({
      type: 'resume-activity',
      activity: 'deadlift',
      dropHandEdits: [7],
    })
    expect(changeBody({ ...emptyForm('end-activity', at), activity: 'plank' }, ctx).change).toEqual(
      {
        type: 'end-activity',
        activity: 'plank',
      },
    )
    expect(changeBody({ ...emptyForm('go-to-week', at), week: '5' }, ctx).change).toEqual({
      type: 'go-to-week',
      week: 5,
    })
    expect(changeBody({ ...emptyForm('undo', at), undo: 3 }, ctx).change).toEqual({
      type: 'undo',
      change: 3,
    })
  })

  it('sends a new activity with the fields given and a key from its name', () => {
    const form = emptyForm('add-activity', '2026-11-16')
    form.add = { ...form.add, name: 'Dips', target: '2', sets: '3', reps: '8', weight: '' }
    expect(changeBody(form, ctx).change).toEqual({
      type: 'add-activity',
      activity: { key: 'dips', name: 'Dips', target: 2, sets: 3, reps: 8 },
    })
  })

  it('makes a key from a name that no other activity has', () => {
    expect(activityKey('Push-ups (wide)', [])).toBe('push-ups-wide')
    expect(activityKey('Squat', ['squat'])).toBe('squat-2')
    expect(activityKey('Squat', ['squat', 'squat-2'])).toBe('squat-3')
    expect(activityKey('', [])).toBe('activity')
    expect(activityKey('Überzug ×3', [])).toBe('berzug-3')
    expect(activityKey('x'.repeat(60), [])).toBe('x'.repeat(40))
  })
})

describe('the edges of the words', () => {
  it('says paused with no end day', () => {
    const paused = { ...RUN, status: 'paused', clock: { ...RUN.clock, until: null } }
    expect(runMeta(paused as Run).rest).toBe('Paused, in week 4 of 8.')
  })

  it('keeps an unknown activity’s key on the bar', () => {
    expect(
      barSentence(
        { type: 'set-value', activity: 'gone', field: 'weight', value: 5 },
        '2026-12-21',
        NAMES,
        [],
      ),
    ).toBe('gone at 5 kg from Mon 21 Dec.')
  })

  it('words a change of a value that wasn’t there before, or a time', () => {
    const base = { monday: '2026-11-16', key: 'x', starts: '2026-11-16', programmeWeek: 5 }
    expect(changeWords({ ...base, field: 'reps', before: null, after: 8 })).toEqual({
      was: '– → ',
      now: '8 reps',
    })
    expect(changeWords({ ...base, field: 'duration', before: 60, after: 90 })).toEqual({
      was: '1 min → ',
      now: '1 min 30 s',
    })
  })

  it('offers an activity’s changes on a day past the plan, and for one with no values', () => {
    expect(activityOptions(RUN, 'plank', '2027-03-01').map((o) => o.kind)).toEqual([
      'set-value',
      'set-value',
      'set-value',
      'set-increase',
      'pause-activity',
      'end-activity',
    ])
    expect(activityOptions(RUN, 'nope').map((o) => o.kind)).toEqual([
      'pause-activity',
      'end-activity',
    ])
    // Back on the day its pause ends: it can be paused again.
    expect(activityOptions(RUN, 'deadlift', '2026-11-26').map((o) => o.kind)).toContain(
      'pause-activity',
    )
  })

  it('labels an increase by its unit', () => {
    expect(increaseLabel({ field: 'weight', how: 'add' })).toBe('Increase in kg a week')
    expect(increaseLabel({ field: 'duration', how: 'add' })).toBe('Increase in s a week')
    expect(increaseLabel({ field: 'weight', how: 'rate' })).toBe('Increase in % a week')
  })

  it('says how long a start runs, with or without its last day', () => {
    const preview = START_JSON as unknown as StartPreview
    expect(startLine(preview)).toBe(
      'Eight weeks, Mon 26 Oct to Sun 20 Dec. Deload in weeks 4 and 8.',
    )
    const open = { ...preview, end: null, grid: { ...preview.grid, weeks: [] } }
    expect(startLine(open)).toBe('Eight weeks from Mon 26 Oct.')
  })
})
