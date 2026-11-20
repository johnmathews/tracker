# Programmes

> Purpose
>
> The model for exercise programmes: a multi-week plan, written in a formal format an agent can
> produce, kept in a library, started as its own tracker, changed on any day without breaking
> trust, and shown in overview views. It is the authority for the build that follows the
> 2026-11-17 mockup round.

**Status:** implemented on 2026-11-18, amended on 2026-11-19 (K163 replaces Q1's default; K164–K166 add restart, re-open and the paused-ink line). Approved by John on 2026-11-17, with the defaults in §12.
The decisions made while building it are K142 to K166 in [decisions.md](../decisions.md) §4.32,
and the text below follows them. [programmes.md](../programmes.md) documents the format. The views
in §9 follow John's picks in the mockup round `brand/design-system/mockups/261117-programmes/`
(§10).

## 1. Principles

These decide every case the rest of the spec doesn't name.

- **P1. The past never changes.** A day before today is a historical record and evidence for
  decisions. No change, code fix or replay may alter what it says was planned.
- **P2. No surprises.** Every change shows a preview of what it does to each future week, and
  nothing happens until it is confirmed.
- **P3. No jumps.** A change continues from the value on screen now. Nothing recomputes from the
  programme's first week.
- **P4. One engine.** The server alone expands a programme into weeks. The app and every agent
  show what the server computed, so the numbers never disagree.
- **P5. Every change is recorded.** Each change goes into the run's log with when it was made,
  the day it takes effect, who made it (app, agent) and an optional reason.

## 2. Terms

- **Programme:** a document in the format (§3). It lives in the account's **library**.
- **Run:** a programme started on a date. A run is a tracker: the **programme tracker** (§4).
- **Activity:** one exercise, hold or cardio session in a programme. It becomes an item in the
  tracker's weeks.
- **Programme week:** week 1 to N of the programme. It is aligned to the calendar's Monday to
  Sunday, except that a change can start one mid-week (§6.2).
- **Activity week:** how many programme weeks one activity has run. It differs from the programme
  week once the activity has been paused or added late (§6.3).
- **Change:** one entry in the run's log (§7).
- **Today:** the date in the server's `TIMEZONE` (`config.today()`, default Europe/Amsterdam).

## 3. The format

A programme is a JSON document. The server publishes its JSON Schema at
`GET /api/programme.schema.json` (public, no sign-in) and through the MCP's `programme_format`
tool, with a worked example. `docs/programmes.md` documents it for people.

### 3.1 The document

```json
{
  "format": "tracker-programme/1",
  "name": "Beginner 5×5",
  "description": "Three full-body sessions a week, adding weight each week.",
  "kind": "strength",
  "weeks": 8,
  "dailyTarget": 2,
  "params": {
    "squat": { "label": "Squat start", "unit": "kg", "default": 40 },
    "rate": { "label": "Weekly increase", "unit": "%", "default": 5 }
  },
  "activities": [
    {
      "key": "squat",
      "name": "Back squat",
      "notes": "Belt from week 5.",
      "target": 3,
      "sets": 5,
      "reps": 5,
      "weight": { "start": "$squat", "rate": "$rate", "step": 2.5 }
    },
    {
      "key": "plank",
      "name": "Plank",
      "target": 3,
      "sets": 3,
      "duration": { "start": 30, "add": 5, "every": 2, "max": 90 }
    }
  ],
  "overrides": [
    {
      "weeks": [4, 8],
      "label": "Deload",
      "activities": { "*": { "sets": 3, "weight": { "scale": 0.9 } } }
    }
  ]
}
```

| Field         | Rule                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `format`      | Exactly `tracker-programme/1`. A later version gets a new string.                        |
| `name`        | 1 to 60 characters. It becomes the tracker's name, which can be changed after the start. |
| `description` | Optional, markdown, up to 2,000 characters.                                              |
| `kind`        | `strength`, `mobility` or `cardio` (S1). One kind per programme.                         |
| `weeks`       | 1 to 156 (K182; 52 before).                                                              |
| `dailyTarget` | 1 to 8 for strength and mobility; absent for cardio, which has none.                     |
| `params`      | Up to 20, each with a `label`, a `unit` and a `default`, and optional `min` and `max`.   |
| `activities`  | 1 to 30. Each `key` is unique, 1 to 40 characters of `a-z`, `0-9` and `-`.               |
| `overrides`   | Optional one-week exceptions for named programme weeks, such as deloads (§3.3).          |

An activity takes the kind's plan fields, as today's items do (`validate.py`):

- **strength:** `target` (sessions a week), `sets`, `reps` or `duration` (seconds), `perSide`,
  `weight` (kg);
- **mobility:** the same without `weight`;
- **cardio:** `target`, `duration` (seconds), `distance` (km).

It may also have `notes` (markdown), which become the item's notes, and a `link`.

### 3.2 Values and progressions

Each numeric field is a number, a parameter (`"$squat"`), or a **progression**:

| Key     | Meaning                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------- |
| `start` | The value in activity week 1. A number or a parameter.                                            |
| `add`   | Added every `every` weeks: a fixed increase. A number or a parameter.                             |
| `rate`  | Percent compounded every `every` weeks: a relative increase. A number or a parameter.             |
| `every` | Weeks between increases. Default 1.                                                               |
| `max`   | The value never passes it.                                                                        |
| `step`  | What the shown value rounds to. Defaults: weight 0.5 kg, distance 0.1 km, duration 5 s, others 1. |

A progression has `add` or `rate`, never both. The value for activity week `n` is:

- `add`: `start + add × floor((n − 1) / every)`;
- `rate`: `start × (1 + rate / 100) ^ floor((n − 1) / every)`;

then capped at `max`, then rounded to the nearest `step`, halves rounding up (S2). The engine
works in decimals, not floating point, so the same inputs give the same output on every machine.

### 3.3 Overrides

An override names programme weeks and, per activity key (or `"*"` for all), values that replace
the computed ones for those weeks only. A value is a number, or `{ "scale": f }` to scale the
computed value before rounding. An override doesn't change the series: the week after a deload
continues as if the deload hadn't happened.

### 3.4 Validation

`POST /api/programmes/validate` and the MCP's `save_programme` check a document and return every
error at once, each with a JSON path and a plain sentence ("activities[2].weight.rate: a
progression has add or rate, not both"). An agent can fix and resend in one loop. A document with
any error is never stored.

## 4. The programme tracker

- **A programme tracker is a tracker of the programme's kind** (strength, mobility or cardio) with
  a run attached (S1). It keeps the kind's fields, chips, marks and daily target. The app labels
  it as a programme ("Beginner 5×5 · Programme").
- **Several runs can be live at once**, each its own tracker, including two of the same programme.
- **Starting** a programme asks for a start date (today or later), the parameter values (each
  defaulting to the programme's) and a name. It creates the tracker with `start_week` at the start
  date's Monday, and writes every week of the run (§5).
- **The run keeps its own copy** of the programme document. Editing the library programme later
  never changes a run.
- **The run ends** after the last programme week's Sunday. The tracker's `end_week` is then set,
  so it shows in no later week. Its weeks, marks, notes and log stay.
- **Ending early** ("End programme") ends the run from a chosen day, today or later, as Delete
  tracker does today (K122). It never deletes history.
- **Restarting** (an agent's `restart_programme`) starts the run again from week 1 as a new
  tracker, from the run's own copy of the document. A run still going on the new start day ends
  from it (K164).
- **Re-opening** (an agent's `reopen_programme`) carries on a run that End programme stopped part
  way, from a day today or later (§6.1, K165). Ending is final otherwise.

## 5. Writing the weeks

- **The run's log is the source of truth** (§7). The weeks are computed from it by replaying the
  programme document plus every change, in order.
- **Future weeks are written** into the `plans` table, one row per calendar week, as any tracker's
  plans are. Every existing reader (the week view, history, insights, Ask, the MCP read tools,
  export) then works unchanged.
- **Every change rewrites today's week and every later week** from the replay. It never writes an
  earlier week.
- **Past days are sealed** (§8). The replay never reads its own output for a sealed day: it reads
  the sealed record.
- **An open-ended pause** (the programme, or an activity, paused with no resume date) writes the
  paused weeks as paused up to the run's last week. The overview shows what follows as "when
  resumed", without dates (§9.2).

## 6. Clocks

### 6.1 The programme week

- The programme week advances by one at each Monday while the run is running.
- **Pause** stops it. **Resume** asks which programme week to resume at: the one that was paused
  (default) or the next one.
- **Re-open** after End programme counts the days from the end to the re-open as a pause of the
  whole programme. The run resumes at the paused programme week: the one it stopped in (K165).
- **Go to week N** (rewind or skip) sets it to N from a chosen day. The overview previews the
  result first.

### 6.2 Changes mid-week

A change takes effect from a day: today or any later day. Weeks stay aligned to the calendar (S3):

- Going to week 5 on a Wednesday makes Wednesday to Sunday programme week 5, and the next Monday
  week 6.
- The record keeps both parts of a split week: Monday and Tuesday at week 4, the rest at week 5.
- An item's goal for a week counts its days. It is the sum of each day's target over 7, rounded
  up (§12, Q1).
- A day the activity isn't running counts 0: a day it is paused, a day before the run starts, and
  a day after the run ends.
- A week with one target all week keeps that target. The squat at 3, done Monday and Tuesday and
  paused from Wednesday, has a goal of 1 that week, so it reads "2 of 1". A Thursday start at 3
  has a goal of 2.

### 6.3 The activity week

- Each activity has an offset: activity week = programme week − offset.
- The offset grows by one at each Monday the activity spends paused. A paused activity therefore
  **resumes where it stopped**: after two weeks off, the squat comes back at the weight it paused
  on (S4).
- Going to week N moves every running activity with the programme. A paused activity stays where
  it is.
- An activity added mid-run starts at its own week 1.
- Overrides (deloads) follow the programme week, so a deload hits every activity at once.
- When the programme ends, an activity that was paused ends with it, short of its last weeks. The
  overview shows this ("Squat ends at its week 6 of 8"). See §12, Q2.

## 7. Changes

Each change has a **from** day (today or later), an optional **reason**, and a **source**: the
app, or the name of an agent's connection. It goes into the log, append-only. Ask never changes a
programme. It reads a run's log to explain it (§11.3).

| Change           | Does                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Pause programme  | Stops the programme from the day, for N weeks or until resumed.                                   |
| Resume programme | Restarts it at the paused programme week or the next one.                                         |
| Go to week N     | Rewinds or skips the programme.                                                                   |
| Pause activity   | Stops one activity, for N weeks or until resumed. The rest carry on.                              |
| Resume activity  | Restarts it where it stopped, optionally at a new value.                                          |
| Add activity     | Adds an activity of the run's kind, with its own values and progressions.                         |
| End activity     | Removes it from the day on. Past days keep it. An activity with no past days is deleted outright. |
| Set value        | Sets a field's value from the day on (absolute: "12.5 kg").                                       |
| Set increase     | Sets a progression's `add` or `rate` from the next programme week (relative: "15% a week").       |
| Set parameter    | Sets a parameter for every field that uses it, as Set value or Set increase would.                |
| Edit one week    | Sets a field for one programme week only: a hand-edit.                                            |
| Undo             | Reverses one change whose effect starts today or later. Itself a change in the log.               |

### 7.1 How a value change behaves

- **Set value** starts a new segment of the field's series at the activity week in force on the
  from day. The segment starts at the new value and keeps the progression's increase. The weeks
  after continue from the new value.
- **Set increase** keeps this week's value and applies the new increase from the next programme
  week. The series continues from the rule's value this week, rounded to the step, because that
  is the value lifted. A deload or a hand-edit in that week is a one-week exception, so the series
  doesn't continue from it (K150).
- Neither recomputes from activity week 1 (P3).

A 10 kg exercise at 10% a week, rounded to 0.5 kg, with the rate changed to 15% on week 3:

| Week   | 1   | 2   | 3   | 4    | 5    |
| ------ | --- | --- | --- | ---- | ---- |
| Before | 10  | 11  | 12  | 13.5 | 14.5 |
| After  | 10  | 11  | 12  | 14   | 16   |

### 7.2 Hand-edits

- A hand-edit (Edit one week) is a one-week exception, like an override. It doesn't bend the
  series: the week after follows the rule.
- It is keyed by programme week, so a pause moves it with its week.
- **A later change never overwrites an earlier hand-edit** (S5). When a hand-edit blocks part of a
  change, the preview says so, with the date of the hand-edit: "Week 6 keeps the 60 kg set on 12
  Nov". It offers to drop the hand-edit as part of the change.
- The overview and the week view mark a hand-edited value.

### 7.3 The preview

Every change is sent first as a preview (`preview: true`, the default). The answer is the
overview grid's data with each affected cell as before and after, the hand-edits that block it,
and any activity that ends short. Nothing is written until the same change comes back with
`preview: false` and the preview's `rev`. A stale `rev` gets 409 and a fresh preview.

## 8. Locking and evidence

- **Plans lock at midnight.** The server refuses any change with a from day before today.
- **Only the engine writes a programme tracker's plans.** The generic plan write refuses every
  week of a programme tracker, past, present and future, with 409 `programme-tracker`. Its plans
  change only through the run's changes (§7).
- **Marks stay open for one day** (S6). A mark for today or yesterday is accepted. One for
  yesterday is recorded as **late**. A mark for an earlier day gets 409 `locked-day`. A mark for
  a later day is accepted, as on any tracker (K159).
- **Sealing.** Before a start, a change or an end, and on the first read each day, the server
  seals every unsealed day up to yesterday. A mark doesn't seal: it needs no replay. It copies the plan in force that day, with its programme and
  activity weeks, into `programme_days`. A sealed day is what the history shows from then on, so
  a later bug fix in the engine can't rewrite it (P1).
- **Mark evidence.** Every mark on a programme tracker also goes into `mark_events`: the day, the
  item, the mark, when it was entered, the source, and whether it was late. The weekly bitmasks in
  `ticks` stay the fast path that every reader uses.
- **The app** gets today's date from the API with each sync, and greys and locks past days from
  it, not from the phone's clock.
- **Offline marks** queue as today. If one reaches the server after the grace day, it is refused.
  The app then names the day and the item in a notice. It never drops a mark silently.

## 9. Views

These follow John's picks in the mockup round (§10) and the Notebook design system.

### 9.1 Programmes page (`#/programmes`)

- **Started** (K161; "Running" is also an activity's name): each live run, with the tracker's name, "Week 4 of 8", when it started, or since when it is paused.
- **Library:** each programme, with its kind, weeks and activities. Each has Preview and start,
  Duplicate and Delete.
- **Add:** paste or upload a programme's JSON, with the validator's errors listed per line.
  Agents add through the MCP.
- **Start:** the parameters, start date and name, with the overview grid as a live preview.

### 9.2 Programme overview (`#/programme/<tracker>`)

- **Plan tab:** the overview grid, a table at every screen width. Each activity is a row and each
  programme week a column, with the calendar dates under the week. The activity column stays fixed
  and the table scrolls sideways. On a phone it opens with this week first after the activity
  column.
  - Past weeks sit on a `tile` and this week is framed in 2px `ink`.
  - A hand-edited value has a `pencil` after it. The folded corner keeps meaning only "has a note".
  - Past weeks are locked and show how they went (sessions done against the goal).
  - Future cells show the prescription. Tapping one offers Edit this week and Change from here.
  - Pauses, hand-edits, deloads and split weeks are visible in the cells.
  - "Paused" comes from a cell's state, never from its goal. A running week planned with a goal of
    0 reads "Rest week" over its value, with "1 done" when a day was marked (K170).
  - Weeks after an open pause show "When resumed" in place of dates.
- **Changes tab:** the log, newest first, with the from day, what changed, the reason and the
  source. Undo shows on changes whose effect starts today or later.
- **Controls:** Pause, Go to week, Add activity, End programme. An ended run has Re-open programme,
  only when End programme stopped it part way (the run's `canReopen`), and Restart from week 1 in
  their place. A run with an end set for a later day keeps its controls, with Cancel the end, a
  re-open from the end's own day, in End programme's place (K168). Each previews first in the
  ChangeSheet's look, and a confirmed restart opens the new tracker's overview. The line under the
  title says an ended run's last day and the end's reason: "Ended Sun 15 Nov. Knee."

### 9.3 The same grid, three places

The overview grid is one component used for the start preview (§9.1), the running programme
(§9.2) and the change preview (§7.3), where each changed cell reads "42.5 → 45".

### 9.4 The activity page

The item page gains a **Programme** section:

- a lede over the chart: this week's plan, or a pause, which leads in `paused-ink` at 600 as the
  week view does: "Paused until Mon 28 Dec. Knee. It comes back at 45 kg." (K169). An ended run
  says its last day, "Ended Sun 15 Nov.", as the overview does (K168);
- a step chart of the planned value for each week, with what was done on top, gaps for pauses,
  and a labelled point for each change;
- the activity's controls, named for the field: Set weight (or Set reps, Set time), Set
  increase, Pause activity, End activity.

### 9.5 The week view

- A programme tracker's title line ends with "Week 4 of 8", a link to the overview.
- A locked day has a `lock` by its name.
- A paused activity's row reads "Paused until Mon 28 Dec. Knee." in place of its boxes, with
  "Paused until Mon 28 Dec." in `paused-ink` at 600 (K169).
- Edit plan doesn't edit a programme tracker's items. Their rows link to the activity's controls.

## 10. Mockup round

One round, `brand/design-system/mockups/261117-programmes/`
([the page](https://claude.ai/artifact/LoqznRAqhGoe2ffy8ord4R)). John's picks on 2026-11-17:

1. **The overview at phone width:** A, the table that scrolls sideways, at every width.
2. **Cell states:** C with A's pencil. Past weeks sit on a `tile`, this week is framed in `ink`,
   and a hand-edit has a `pencil`.
3. **The change sheet:** B, two steps. The fields and Preview change come first, then the preview
   with Back and Confirm change.
4. **The activity page:** A, the step chart.
5. **The week view:** A, the "Week 4 of 8" link, a lock by locked days, and the paused row's
   sentence.

## 11. API and MCP

### 11.1 Storage

Schema 18 adds five tables:

| Table            | Holds                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `programmes`     | The library: `user_id`, `id`, `name`, `doc_json`, `rev`, `created_at`, `updated_at`.                                                                   |
| `programme_runs` | One per programme tracker: `user_id`, `tracker_id`, `programme_id` (may be gone), `doc_json` (the copy), `params_json`, `start_date`, `status`, `rev`. |
| `run_changes`    | The log: `user_id`, `tracker_id`, `seq`, `made_at`, `from_date`, `change_json`, `reason`, `source`, `undone_by`.                                       |
| `programme_days` | Sealed days: `user_id`, `tracker_id`, `date`, `programme_week`, `items_json` (with activity weeks), `sealed_at`.                                       |
| `mark_events`    | `user_id`, `tracker_id`, `date`, `item_id`, `mark`, `entered_at`, `source`, `late`.                                                                    |

`plans`, `ticks` and `item_details` don't change shape. A programme tracker's `plans` rows are
written only by the engine.

### 11.2 Endpoints

| Method and path                             | Does                                                |
| ------------------------------------------- | --------------------------------------------------- |
| `GET /api/programme.schema.json`            | The format's JSON Schema. Public.                   |
| `GET`, `POST /api/programmes`               | List the library; add a programme.                  |
| `GET`, `PUT`, `DELETE /api/programmes/{id}` | Read, replace (with `rev`) or delete one.           |
| `POST /api/programmes/validate`             | Check a document; every error with its path.        |
| `POST /api/programmes/{id}/preview`         | Expand with given parameters and start date.        |
| `POST /api/programmes/{id}/start`           | Start a run; returns the new tracker.               |
| `GET /api/runs/{tracker}`                   | The run: state, clocks, the grid, the log.          |
| `POST /api/runs/{tracker}/changes`          | Preview or apply a change (§7.3).                   |
| `POST /api/runs/{tracker}/end`              | End programme from today or a later day (§4, K156). |

Programme changes need the server, as Ask does. Offline, the controls are disabled with one line
saying why. Marks still queue.

The generic plan write refuses a programme tracker with 409 `programme-tracker`. Export and import
carry the library, the runs, their logs, the sealed days and the mark events.

### 11.3 MCP tools

| Tool                | Scope | Does                                                                                            |
| ------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `programme_format`  | read  | The schema and a worked example.                                                                |
| `list_programmes`   | read  | The library and every run, ended ones included.                                                 |
| `get_programme`     | read  | One programme, or one run with its clocks, upcoming weeks and log.                              |
| `save_programme`    | write | Validates and adds or replaces a library programme. Returns every error.                        |
| `start_programme`   | write | Starts a run from a date with parameters.                                                       |
| `change_programme`  | write | Any change in §7. Previews by default; `confirm: true` with the preview's `rev` applies it.     |
| `end_programme`     | write | End programme (§4), previewed first, as a change is.                                            |
| `restart_programme` | write | A new run from week 1 as a new tracker, from the run's own copy; a run still going ends (K164). |
| `reopen_programme`  | write | Carries on a run End programme stopped part way, at the week it stopped in (K165).              |

- `add_item`, `update_item` and `remove_item` refuse a programme tracker, and name
  `change_programme` in the error.
- `mark_day` follows the lock (§8).
- The read tools (`week_summary`, `weeks`, `item_history`, `goals`, `consistency`) work unchanged,
  because the weeks are ordinary plans.
- Ask reads the run's log, so it can answer "why did the squat drop in week 5".

## 12. Defaults to revisit

John approved these defaults on 2026-11-17. Each can change later if it reads wrong in practice.

- **Q1. A split week's goal.** Prorated by day (§6.2). John chose this on 2026-11-18 (K163). It
  replaces the first default, the target in force on Sunday, which read "2 of 0" for a week run on
  pace and then paused.
- **Q2. A paused activity at the end.** It ends with the programme, short of its last weeks. The
  alternative is to extend the run until every activity finishes.
- **Q3. Today when travelling.** The lock uses the server's `TIMEZONE`. A per-account time zone
  would follow John abroad.

## 13. Not in this version

- Training days within a week (day A, day B) and session-based clocks. The planner stays weekly.
- Mixed kinds in one programme.
- A form editor for library programmes. Agents write them, and people paste JSON. The programme
  builder added one later (K183, [2026-11-20-programme-builder.md](2026-11-20-programme-builder.md)).
- Food programmes.
- A start-of-week check-in that offers Repeat week or Carry on.
- Double progression (add reps, then weight).

## 14. Settled in the discussion

| ID  | Decision                                                                                  |
| --- | ----------------------------------------------------------------------------------------- |
| S1  | One kind per programme: strength, mobility or cardio. Several programmes can run at once. |
| S2  | Values round to the nearest step.                                                         |
| S3  | Mid-week changes keep weeks aligned to Monday to Sunday.                                  |
| S4  | A paused activity resumes where it stopped.                                               |
| S5  | A later change keeps an earlier hand-edit, and says so when the hand-edit blocks it.      |
| S6  | Marks stay open for one day after the day they mark, and a late mark is recorded as late. |
