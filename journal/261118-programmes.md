# Programmes

> Purpose
>
> Records the programmes build of 2026-11-17 and 2026-11-18. A programme is a multi-week exercise
> plan in a formal format an agent can push. It sits in a library and runs as its own tracker. It
> can be changed on any day, and its past days are locked. The authority is
> `docs/specs/2026-11-17-programmes.md`; the decisions are K142 to K162.

## 1. What changed

- **The format and the engine (W1, W2).**
  - `programme.py` checks a `tracker-programme/1` document and returns every error with its path.
    It expands values and progressions in decimals, rounded to the step with halves up.
  - `programme_replay.py` replays a run's document and change log into dated weeks. It covers:
    - pause, resume and go to week, with aligned mid-week splits;
    - activity offsets;
    - changes that continue from the value shown;
    - hand-edits that later changes keep and report;
    - undo, and the preview.
  - The mockup's numbers are its acceptance test.
- **Storage and the API (W3, W4).**
  - Schema 18 adds `programmes`, `programme_runs`, `run_changes`, `programme_days` and
    `mark_events`. The plan said "migration 16", but 16 and 17 were already on `main`.
  - Starting a run writes its weeks. A change rewrites today's week and later weeks, never an
    earlier one.
  - Days up to yesterday are sealed before writes and on the first read each day.
  - Plan writes refuse a programme tracker. Marks before yesterday get `locked-day`, and every
    mark is recorded as evidence, with yesterday's flagged late.
  - A stored run always loads, and one that can't be replayed never takes down `/api/state`, Ask
    or the MCP.
- **The MCP and Ask (W5).**
  - Six tools let an agent read the format, save, start and change a programme. A change previews
    first.
  - The item tools refuse a programme tracker, and `mark_day` follows the lock.
  - Ask reads each run's change log.
- **The views (W6 to W8).**
  - Cards come first, from John's picks: 1A, 2C with A's pencil, 3B, 4A and 5A in round 1, then
    6B and 7B in round 2.
  - The app gains the Programmes page, the overview grid, the two-step change sheet and the
    activity chart.
  - The week view gains "Week 4 of 8", locked days and paused rows.
  - A queued mark the server refuses is named in a notice.
- **John's feedback on the local stack (K160 to K162).**
  - Programmes stays in the bar, and Full screen hides at phone width.
  - "Started" replaces "Running", because Running is also an activity's name.
  - An overview opened from the Programmes page goes back there.
  - On a phone, Edit plan shows a 4px line along the top only.
- **Review fixes during /done.**
  - A confirm now has to match its preview: the token covers the log and the exact change.
  - A malformed `dropHandEdits` gives 400, not 500.
  - The quota counts the run tables, while sealing and marks are still never refused for it.

## 2. Process notes

- **Confirmed: a whole-codebase evaluation was skipped on purpose.** The run started from John's
  request, then a spec and two mockup rounds. Nine units ran through subagents, each test-first
  and each reviewed and committed on its own.
- **Confirmed:** the local preview ran on a copy of `api/.data`, made with SQLite's backup API, at
  `~/.local/share/tracker/eng-programmes-preview`. The original file's mtime did not change.
- **Confirmed:** the e2e suite failed in untouched flows while other agents saved files in the
  worktree (3 to 7 timeouts). With the worktree quiet it ran 142 of 142. The touch fling test
  failed once and passed three times running alone, as issue #75 already records.

## 3. What is deliberately not done

- **The spec's §13 items,** filed as #76 to #82: training days within a week, mixed kinds, a form
  editor, food programmes, the start-of-week check-in, double progression, and a per-account time
  zone.
- **Ending a programme through the MCP:** #83.
- **Style-guide sections for the three programme primitives:** #84.
- **A mid-week change's goal for the week's past days.** It still follows the spec's Q1 default
  (Sunday's target), so `plans` can show a past day of the current week against a changed goal.
  The sealed record is unchanged. This is John's call: #86.
- **Two small stale-screen cases** in the app's programme state: #85.
- **Marks on a full account.** A mark that would need a new tick row is still refused when the
  account is full. That rule is older than programmes and wasn't changed here.
