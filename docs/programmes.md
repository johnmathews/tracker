# Programmes

> Purpose
>
> The `tracker-programme/1` format, for people and agents: how to write a programme, how the
> server turns it into weeks, how a run changes, and which past days are locked. The spec is
> [specs/2026-11-17-programmes.md](specs/2026-11-17-programmes.md). The endpoints are in
> [api.md](api.md) §3.4, the agent tools in [mcp.md](mcp.md) §1.1, and the engine's design in
> [architecture.md](architecture.md) §8. §11 covers the shared library.

## 1. Overview

A programme is a plan of several weeks, written as one JSON document. It lives in the account's
library. Starting it makes a **run**: a tracker of the programme's kind (strength, mobility or
cardio) whose weekly plans the server writes from the programme.

- An **activity** is one exercise, hold or cardio session in the programme. In the tracker it is
  an item, and the item's id is the activity's key (K155).
- A **programme week** counts 1 to N from the run's start. Weeks follow the calendar, Monday to
  Sunday.
- An **activity week** counts the programme weeks one activity has run. It falls behind the
  programme week while the activity is paused, and an activity added mid-run starts at its own
  week 1.
- A **change** is one entry in the run's log: a pause, a new value, a skip and so on (§8). The log
  is the source of truth. The weeks are what the server computes from it.
- **Today** is the date in the server's `TIMEZONE` (default Europe/Amsterdam), never the phone's.

The server alone computes the weeks. The app, Ask and every agent show what it computed, so the
numbers never disagree.

## 2. The document

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

| Field         | Rule                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `format`      | Exactly `tracker-programme/1`. A later version of the format gets a new string.                   |
| `name`        | 1 to 60 characters, trimmed. It becomes the tracker's name, which can be changed after the start. |
| `description` | Optional markdown, up to 2,000 characters.                                                        |
| `kind`        | `strength`, `mobility` or `cardio`. One kind per programme.                                       |
| `weeks`       | A whole number from 1 to 52.                                                                      |
| `dailyTarget` | 1 to 8 for strength and mobility, 3 when left out. A cardio programme has none.                   |
| `params`      | Optional, up to 20 parameters (§2.2).                                                             |
| `activities`  | 1 to 30 activities (§2.1).                                                                        |
| `overrides`   | Optional one-week exceptions for named programme weeks, such as deloads (§4).                     |

Any other key is refused: "this key is not part of the format."

### 2.1 Activities

Each activity has a `key` and a `name`, then the plan fields of its kind:

| Kind     | Plan fields                                                 |
| -------- | ----------------------------------------------------------- |
| strength | `target`, `sets`, `reps` or `duration`, `perSide`, `weight` |
| mobility | `target`, `sets`, `reps` or `duration`, `perSide`           |
| cardio   | `target`, `duration`, `distance`                            |

| Field      | Rule                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `key`      | 1 to 40 characters of `a-z`, `0-9` and `-`, unique in the programme. It becomes the item's id. |
| `name`     | 1 to 80 characters.                                                                            |
| `notes`    | Optional markdown, up to 20,000 characters. It becomes the item's notes.                       |
| `link`     | Optional, up to 500 characters. It becomes the item's Link field.                              |
| `target`   | Sessions a week, 0 to 7. Left out, 3.                                                          |
| `sets`     | 1 to 20.                                                                                       |
| `reps`     | 1 to 1,000. An activity has `reps` or `duration`, not both.                                    |
| `duration` | Seconds: 1 to 3,600 for a strength or mobility hold, 1 to 86,400 for a cardio session.         |
| `perSide`  | `true` or `false`.                                                                             |
| `weight`   | kg, above 0 and at most 500.                                                                   |
| `distance` | km, above 0 and at most 1,000.                                                                 |

A field another kind has is refused by name: "a mobility activity has no weight."

### 2.2 Parameters

A parameter is a value the person picks when the run starts, such as the squat's starting
weight. Its key follows the activity key's rule. It has a `label` (1 to 60 characters), a `unit`
(1 to 20 characters) and a `default`, and optionally a `min` and a `max`. A field names it with
`$` and its key: `"start": "$squat"`. Each value given at the start must lie between `min` and
`max`, and must fit every place that uses it.

## 3. Values and progressions

Each numeric plan field is one of three things:

- **A bare number**, the same every week: `"sets": 5`. It is used as written. It is not rounded to
  the step defaults below (K154).
- **A parameter**, the same every week: `"start": "$squat"` inside a progression, or
  `"weight": "$squat"` alone.
- **A progression**, an object that grows week by week.

| Key     | Meaning                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| `start` | The value in activity week 1. A number or a parameter. Required.                                           |
| `add`   | A fixed increase every `every` weeks. A number or a parameter, from minus to plus the field's cap.         |
| `rate`  | A percent increase every `every` weeks, compounded. A number or a parameter, above −100 and at most 1,000. |
| `every` | Weeks between increases, 1 to 52. Default 1.                                                               |
| `max`   | The value never passes it.                                                                                 |
| `step`  | What the value rounds to. Defaults: weight 0.5 kg, distance 0.1 km, duration 5 s, every other field 1.     |

A progression has `add` or `rate`, never both. For activity week `n`:

- with `add`: `start + add × floor((n − 1) / every)`;
- with `rate`: `start × (1 + rate / 100) ^ floor((n − 1) / every)`.

The server then caps the value at `max`, applies an override's `scale` (§4), and rounds to the
nearest `step`, halves up. A weight or distance `step` has at most two decimals. The arithmetic is
in decimals, not floating point, so the same document gives the same numbers on every machine.

Increases fall on activity weeks 1, 1 + `every`, 1 + 2 × `every` and so on. A later change keeps
those weeks: it never restarts the count (K149). With `"every": 2`, the plank above runs 30, 30,
35, 35, 40 seconds, and a change in week 4 still increases it in week 5.

## 4. Overrides

An override names programme weeks (`weeks`, each 1 to the programme's `weeks`), an optional
`label` of 1 to 40 characters ("Deload"), and the values that replace the computed ones for those
weeks only. `activities` maps an activity key, or `"*"` for every activity, to its fields:

- a number replaces the value as written, unrounded;
- `{ "scale": f }`, with `f` above 0, multiplies the computed value before it is rounded.

An activity's own entry beats `"*"` field by field (K153). In the worked example (§6) `"*"` gives
every activity 3 sets and 90% of its weight in weeks 4 and 8, and the deadlift's own entry keeps
it at 1 set while it still takes the 90%.

An override doesn't bend the series: the week after a deload continues as if the deload hadn't
happened. A week has at most one override. An override names only activities the programme has,
changes only fields each activity has, and never changes `perSide`. Overrides follow the
programme week, not the activity week, so a deload reaches every running activity in the same
week.

## 5. Validation

The server checks a document and returns every problem at once, each with a JSON path and a
sentence. A document with any problem is never stored. The same check runs in three places:

- `POST /api/programmes/validate` returns `{errors}` and stores nothing ([api.md](api.md) §3.4);
- `POST /api/programmes` and `PUT /api/programmes/{id}` answer 400 `invalid` with `errors`;
- the MCP's `save_programme` lists the problems one a line ([mcp.md](mcp.md) §1.1).

The fixture's beginner programme with `weeks` set to 60, a `rate` beside the row's `add`, and the
plank's key written `Plank` gives:

```json
{
  "errors": [
    { "path": "weeks", "message": "give a whole number from 1 to 52." },
    {
      "path": "activities[2].weight.rate",
      "message": "a progression has add or rate, not both."
    },
    {
      "path": "activities[4].key",
      "message": "give a key of 1 to 40 characters of a-z, 0-9 and -."
    }
  ]
}
```

Besides each field's own rule, the check covers what a JSON Schema can't express:

- activity keys are unique, and each `$` reference names a parameter the programme has;
- a parameter's `min`, `max` and `default` agree, and its value fits each place that uses it;
- every week's value fits the item, with its override, as a run with no pauses would compute it:
  "week 6 comes to 520 kg. The most is 500.";
- overrides name weeks within the programme, at most one override a week, real activities, and
  fields those activities have;
- the document is at most 128 KiB as stored.

**The JSON Schema.** `GET /api/programme.schema.json` serves the format's schema (draft 2020-12)
with no sign-in, so an editor or an agent can read it before it has a token. The MCP's
`programme_format` gives the same schema. The server builds it from the same rules as the check,
and the check is the authority.

## 6. A worked example

`fixtures/programmes/valid/beginner-5x5.json` is the spec's programme with five activities:
Back squat at the `squat` parameter (40 kg) and the `rate` parameter (5% a week), Bench press and
Barbell row at 30 kg plus 2.5 kg a week, Deadlift at 60 kg plus 5 kg a week, and Plank at 3 × 30 s
plus 5 s every second week, up to 90 s. Weights round to 2.5 kg. Weeks 4 and 8 are deloads: 3
sets and 90% of the weight, with the deadlift kept at 1 set.

`fixtures/programmes/expansions/beginner-5x5.json` holds what the server computes for it with the
default parameters:

| Week | Label  | Back squat | Bench press | Barbell row | Deadlift | Plank    |
| ---- | ------ | ---------- | ----------- | ----------- | -------- | -------- |
| 1    |        | 5 × 40     | 5 × 30      | 5 × 30      | 1 × 60   | 3 × 30 s |
| 2    |        | 5 × 42.5   | 5 × 32.5    | 5 × 32.5    | 1 × 65   | 3 × 30 s |
| 3    |        | 5 × 45     | 5 × 35      | 5 × 35      | 1 × 70   | 3 × 35 s |
| 4    | Deload | 3 × 42.5   | 3 × 35      | 3 × 35      | 1 × 67.5 | 3 × 35 s |
| 5    |        | 5 × 47.5   | 5 × 40      | 5 × 40      | 1 × 80   | 3 × 40 s |
| 6    |        | 5 × 50     | 5 × 42.5    | 5 × 42.5    | 1 × 85   | 3 × 40 s |
| 7    |        | 5 × 52.5   | 5 × 45      | 5 × 45      | 1 × 90   | 3 × 45 s |
| 8    | Deload | 3 × 50     | 3 × 42.5    | 3 × 42.5    | 1 × 85   | 3 × 45 s |

The squat shows the arithmetic. Week 5 is 40 × 1.05⁴ = 48.62 kg, which rounds to 47.5. Week 4 is
40 × 1.05³ = 46.31 kg, scaled by 0.9 to 41.67 kg, which rounds to 42.5. Week 5 still follows the
rule, not the deload.

Each lift is 5 reps, and each activity's target is 3 sessions a week. `seed-demo` starts this
programme on a local stack ([api.md](api.md) §5).

## 7. Running a programme

**Starting.** A run starts on a date, today or later (today when left out), with a value for any
parameter (each defaults to the programme's) and a name (the programme's when left out). The
start makes a new tracker of the programme's kind, after the account's others:

- its `startWeek` is the start date's Monday, and the start's calendar week is programme week 1;
- its `endWeek` is the Monday after the run's last Sunday, so it shows in no later week;
- its daily target is the programme's `dailyTarget`;
- each activity's `notes` and `link` become its item's details;
- every week of the run is written into the tracker's plans, so the week view, history, insights,
  Ask, the MCP read tools and the export read them as any tracker's.

The run keeps its own copy of the document. Editing or deleting the library programme later never
changes a run. Several runs can be live at once, two of the same programme included.

**A run's status** is `upcoming` before its start, `running`, `paused` while the whole programme
is paused, or `ended` (K157). A re-opened run reads `paused` until its re-open day, then `running`.

**Ending.** A run ends after its last programme week's Sunday. **End programme** ends it early,
from today or a later day: the tracker shows in no week after the one before that day, and its
weeks, marks, notes and log stay. In the week holding that day, each goal counts the days before
it only (K163). It is its own route, `POST /api/runs/{tracker}/end`, and goes
into the log, not a change type (K156). Delete tracker on a programme tracker ends the run the
same way, from the week on screen's Monday or today, whichever is later. A run ended this way
takes no more changes unless it is re-opened.

**Restarting.** A restart starts a run again from week 1, as a new tracker, from today or a later
day (K164). An agent's `restart_programme` does it, and so does `POST /api/runs/{tracker}/restart`,
each after a preview confirmed with its token (K167). The new run starts from the old run's own copy of the document
and the parameters the old run started with, so it works after the library programme is edited or
deleted. The new tracker takes the old one's name unless the agent gives another. A run still
going on the new start day ends from that day in the same confirm, as End programme ends it, with
the reason "Restarted from week 1.". Its weeks, marks, notes and log stay. That end carries a
`restarted` marker, so the old run can't be re-opened: the new run replaces it (K167). A run End
programme had already ended gains the same marker in its log, from its end's own day, and nothing
else about it changes.

**Re-opening.** A re-open carries on a run that End programme stopped part way, from today or a
later day, and no earlier than the end's own day (K165). An agent's `reopen_programme` does it, and
so does `POST /api/runs/{tracker}/reopen`, each after a preview confirmed with its token (K167). The days from the
end to the day before the re-open count as a pause of the whole programme. The run resumes at the
programme week it stopped in, and each activity's week moves as it does across any programme
pause (§8.2). The re-open goes into the log as a `reopen-programme` row. The tracker shows again in
the weeks the end had hidden, which read as paused, and in every week to the run's new last day.
Days before the end keep their sealed record, and the days from the end to yesterday are sealed as
paused. A run that ran to its last Sunday, or was ended before it started, has nothing to
re-open: restart it instead. A run a restart ended has nothing to re-open either. The run's
`canReopen` says whether a re-open applies today. An end set for a later day leaves the run
`running`, and it can still be re-opened from that day. A re-opened run takes changes again, and can be ended and re-opened
again. Undo never applies to an end or a re-open; ending again is the way back. The overview's
log reads "Programme re-opened, from Wed 11 Nov.", as it reads "Programme ended, from Wed 4 Nov."
for the end.

**On the overview** (K168). An ended run's line says its last day and the end's reason ("Ended Sun
15 Nov. Knee."), and in place of the controls it has **Re-open programme**, when `canReopen` is
true, and **Restart from week 1**. A run with an end set for a later day keeps its controls, with
**Cancel the end** in End programme's place: a re-open from the end's own day. Each opens a sheet
in the ChangeSheet's look. Re-open asks for From and Reason, Restart for Name (the tracker's to
start with) and Starts. Step 2 is the server's preview, and nothing changes until the confirm.
Cancel the end opens on its preview, with Keep the end and Cancel the end. A stale preview shows
the fresh one with a line saying so. A confirmed restart opens the new tracker's overview, and the
old run stays as it is.

**Its plans are the engine's.** A programme tracker's plans can't be written by hand: the generic
plan write answers 409 `programme-tracker`, and the MCP's `add_item`, `update_item` and
`remove_item` refuse it and name `change_programme`. An item's note can still change, since it is
no part of a plan.

## 8. Changes

A change takes effect from a **from** day: today or any later day, within the run. It has an
optional reason (up to 500 characters) and records its source: `app`, or an agent's connection by
the name Settings › Connections shows. Changes go into the log in order and are never removed:
an undo is a change of its own, and marks the change it reverses.

| `type`             | Keys                                              | Does                                                                                                                |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pause-programme`  | `weeks` (1 to 52; left out, until resumed)        | Stops the whole programme from the day.                                                                             |
| `resume-programme` | `at`: `"paused"` (default) or `"next"`            | Restarts it at the week it paused on, or the week after.                                                            |
| `go-to-week`       | `week` (1 to the programme's weeks)               | Moves the programme to that week from the day: back to repeat weeks, on to skip them. A paused activity stays put.  |
| `pause-activity`   | `activity`, `weeks` (as above)                    | Stops one activity. The rest carry on, and it resumes where it stopped.                                             |
| `resume-activity`  | `activity`, `values` (optional, `{"weight": 70}`) | Restarts it where it stopped, each value in `values` set as Set value would.                                        |
| `add-activity`     | `activity`, written as §2.1 writes one            | Adds an activity of the run's kind with a new key. It starts at its own week 1.                                     |
| `end-activity`     | `activity`                                        | Ends it from the day. Past days keep it. One with no day yet is deleted outright, with its item's details.          |
| `set-value`        | `activity`, `field`, `value`                      | Sets a field from the day on, keeping its increase. The weeks after continue from the new value.                    |
| `set-increase`     | `activity`, `field`, `add` or `rate`              | Keeps this week's value and applies the new increase from the activity's next week.                                 |
| `set-parameter`    | `param`, `value`                                  | Sets a parameter: Set value for each field whose `start` uses it, Set increase for each whose `add` or `rate` does. |
| `edit-week`        | `activity`, `week`, `field`, `value`              | Sets one field for one programme week only: a hand-edit (§8.3).                                                     |
| `undo`             | `change` (a `seq` in the log)                     | Reverses one change whose effect starts today or later. The undo is itself a change in the log.                     |

`set-value`, `set-increase`, `set-parameter` and `resume-activity` also take `dropHandEdits`: the
`seq` of each hand-edit the change drops (§8.3).

A change is checked against the run as it stands on its from day. Each problem comes back at its
path in the change, as a document's do: "deadlift is already paused on Wed 7 Oct.", "the weight
goes in steps of 2.5, so give a multiple of 2.5." A set value must be a multiple of the field's
step (K152); a hand-edit's needn't be. Every later week is then checked against the item's
limits, as a document's are. Changes on the same day apply in log order.

Undo is refused for an undo ("Make the change again instead."), for a change already undone, and
for a change that took effect before today. A change that no longer applies because one before it
was undone, such as a resume with nothing paused, does nothing.

### 8.1 How a value change continues

Nothing recomputes from week 1. A change continues from the value on screen now (spec P3):

- **Set value** starts a new segment of the field's series at the activity week in force on the
  from day, at the new value, keeping the progression's increase.
- **Set increase** starts one at this week's value and applies the new `add` or `rate` from the
  activity's next week. It continues from the rule's value, rounded to the step, before any
  override or hand-edit, so a deload or a hand-edit this week never becomes the new base (K150).

Both keep the field's step, its `max` and its increase weeks (K149). Going back to an earlier
week with Go to week shows that week's values again.

`fixtures/programmes/valid/ten-kg.json` is the spec's example: 10 kg at 10% a week, rounded to
0.5 kg, with the rate changed to 15% in week 3.

| Week   | 1   | 2   | 3   | 4    | 5    |
| ------ | --- | --- | --- | ---- | ---- |
| Before | 10  | 11  | 12  | 13.5 | 14.5 |
| After  | 10  | 11  | 12  | 14   | 16   |

Week 3's rule value is 12.1 kg, shown as 12. The new rate continues from 12: 12 × 1.15 = 13.8,
shown as 14, then 15.87, shown as 16.

### 8.2 Pauses, resumes and the week a change lands in

- Weeks stay aligned to the calendar. Going to week 5 on a Wednesday makes Wednesday to Sunday
  week 5 and the next Monday week 6. The log keeps both parts of a split week.
- A week's plan holds one value per item, so its row carries Sunday's values, or the last values
  the activity ran with that week. A split week's days before the change keep theirs in the run's
  grid, which shows "35 → 32.5 kg from Wed".
- An item's goal for the week counts its days (K163). It is the sum of each day's target over 7,
  rounded up. A day the activity is paused, a day before the run starts, and a day from End
  programme's on count 0. A week with one target all week keeps it.
- The squat at 3, done Monday and Tuesday and paused from Wednesday, has a goal of 1 that week:
  "2 of 1", met. Done on neither day, it reads "0 of 1". A Thursday start at 3 has a goal of 2.
- The week view, the history, the grid, the insights, Ask and the MCP tools all read this goal,
  since each reads the week's plan. A week written under the old rule, the target in force on
  Sunday, gets the new goal at the run's next seal, the first read of a day. Earlier weeks keep
  theirs (P1).
- A week planned with a goal of 0 is a **rest week**, a planned break, not a pause (K170). The
  week runs: its state is `running`, and "paused" comes only from paused days. The overview's grid
  says "Rest week" over the planned value, adds "1 done" when a day was marked, and never reads
  "0 of 0". A rest week to come says "Rest week" in place of "0 a week".
- A paused activity's activity week stops while the programme week runs on, so it comes back at
  the value it paused on. A resume on any day of a week gives the same value as a resume on its
  Monday (K151).
- When the programme ends, an activity still short of its last weeks ends with it: "Deadlift ends
  at its week 6 of 8."
- A programme paused with no end date writes the paused weeks up to the run's last week. The
  overview shows the weeks after as "When resumed", without dates, and the tracker shows in every
  week until the run has an end again.

### 8.3 Hand-edits

Edit one week sets a field for one programme week: a one-week exception, like an override. It is
keyed by programme week, so a pause moves it with its week. A later change never overwrites it.
When a hand-edit keeps its value though a change alters its week's rule, the preview names it:
"Week 6 keeps the 35 kg set on 12 Dec." Sending its `seq` in the change's `dropHandEdits` drops
it with the change.

### 8.4 The preview and the rev

Every change is sent first as a preview, which writes nothing. The preview gives:

- `cells`: each changed cell, by week and activity, with `before` and `after`, the first day it
  differs and its programme week;
- `blocking`: the hand-edits that keep their value;
- `endsShort`: each activity that ends before its last week;
- `rev`: the token that confirms this change. It is the first 16 hex characters of a SHA-256 over
  the log's revision and the change as sent: its body (`dropHandEdits` included), its from day and
  its reason, written as sorted-key compact JSON.

Nothing changes until the same change comes back with `preview: false` (REST) or `confirm: true`
(MCP) and the preview's `rev`. A different `rev` means the log changed since, or the change, its
from day or its reason isn't the one previewed. The server then changes nothing and answers with
the change it was sent, previewed on the log as it is now. The run's own `rev` (`GET
/api/runs/{tracker}`, `get_programme`) is the log's revision alone: it shows that the run changed,
and it never confirms a change.

## 9. Locked days and late marks

Past days are a record, and evidence for later decisions. They never change (spec P1).

- **Plans lock at midnight.** No change takes effect before today. Every change rewrites today's
  calendar week and later ones, never an earlier one.
- **Sealing.** Before any change, any start or end, and on the first read each day, the server
  copies every unsealed day up to yesterday into the run's sealed days: the plan in force that
  day, with its programme and activity weeks. From then on the replay reads a sealed day from the
  record, never from its own output. A change that continues from a sealed day's value reads it
  from the record too. So a later fix to the engine can't rewrite what a past day planned.
- **A stored run always loads.** A run's document was checked when the run started. Loading it
  again skips the check of each week's value against the item's limits, so an engine change since
  can't stop it loading (K158).
- **Marks stay open for one day.** A mark for today or yesterday is accepted, and one for yesterday
  is recorded as late. A mark for an earlier day gets 409 `locked-day` with its `date`. A mark for
  a later day is accepted, as on any tracker (K159).
- **Mark evidence.** Every mark on a programme tracker, a cleared day included, also goes into the
  run's mark events: the day, the item, the mark, when it was entered, its source and whether it
  was late. The week's ticks stay the fast path every reader uses.

## 10. For agents: the MCP tools

An agent connected over MCP ([mcp.md](mcp.md)) writes, saves, starts, changes, ends, restarts and
re-opens a programme with nine tools, and reaches the shared library with two more (below):

1. `programme_format` gives the schema, the example in §2, each change type with its keys and what
   it does, and short notes. Call it first.
2. `save_programme` with `doc` checks the document. With problems, it lists every one as
   `path: sentence` and stores nothing: fix them all and send the whole document again. Without,
   it adds the programme and returns its `id` and `rev`. With `programme` and `rev` it replaces
   that programme.
3. `start_programme` with the library `programme`, and optionally `start`, `params` and `name`,
   starts a run and returns the new tracker and its run.
4. `change_programme` with `tracker` and `change` (one of §8's bodies), and optionally `from_date`
   (today by default) and `reason`, returns a preview. Show the person its `cells`, `blocking` and
   `endsShort`. Then call it again with the same arguments, `confirm: true` and the preview's
   `rev`. A result with `stale: true` is a fresh preview: nothing changed.
5. `end_programme` with `tracker`, and optionally `from_date` (today by default) and `reason`,
   returns a preview of End programme (§7): the from day and the last week the tracker shows. Show
   it to the person, then call it again with the same arguments, `confirm: true` and the
   preview's `rev`. The run's marks, weeks, notes and log stay, and it takes no more changes.
6. `restart_programme` with `tracker`, and optionally `start` (today by default) and `name`,
   returns a preview of a new run from week 1 (§7): the new tracker's name, its start, week 1's
   dates, its weeks, and the day the old run ends from when it is still going then. Confirm it as
   above. The result is the new tracker and its run, and the old tracker.
7. `reopen_programme` with `tracker`, and optionally `from_date` (today by default) and `reason`,
   returns a preview of a re-open (§7): its day, the programme week it resumes at, the paused days
   from the end, and the new last day and week. Confirm it as above. The result is the tracker and
   its run, running again.

`list_programmes` lists the library and every run, and `get_programme` reads one library
programme or one run with its clock, its log and its weeks from this one on.

```text
programme_format()
save_programme(doc={...})                       → error: 2 problems, one a line
save_programme(doc={...fixed})                  → {programme: {id: "x…", rev: 1, ...}}
start_programme(programme="x…", params={"squat": 50})
change_programme(tracker="Beginner 5×5",
                 change={"type": "pause-activity", "activity": "squat", "weeks": 2},
                 reason="Knee")                 → {preview: true, rev: "3f…", cells: [...]}
change_programme(tracker="Beginner 5×5", change={...the same}, reason="Knee",
                 confirm=true, rev="3f…")       → {preview: false, change: {...}, run: {...}}
end_programme(tracker="Beginner 5×5", reason="Moving house")
                                                → {preview: true, rev: "9a…", end: {...}}
end_programme(tracker="Beginner 5×5", reason="Moving house", confirm=true, rev="9a…")
                                                → {preview: false, tracker: {...}, run: {...}}
restart_programme(tracker="Beginner 5×5", start="2027-01-04")
                                                → {preview: true, rev: "c4…", restart: {...}}
restart_programme(tracker="Beginner 5×5", start="2027-01-04", confirm=true, rev="c4…")
                                                → {preview: false, tracker: {...}, run: {...}, old: {...}}
reopen_programme(tracker="Beginner 5×5", reason="Knee is better")
                                                → {preview: true, rev: "71…", reopen: {...}}
reopen_programme(tracker="Beginner 5×5", reason="Knee is better", confirm=true, rev="71…")
                                                → {preview: false, tracker: {...}, run: {...}}
```

The read tools (`week_summary`, `weeks`, `item_history`, `goals`, `consistency`) read a
programme tracker as any other, since its weeks are ordinary plans. `mark_day` follows §9's lock.

Two more tools reach the shared library (§11): `list_shared_programmes` lists it, or reads one
shared programme with its document, and `copy_programme` copies one into the person's library.
The copy is then adjusted with `save_programme` and started with `start_programme`, as above.

## 11. Shared library

The shared library holds programmes every signed-in user can see. Only an admin adds to it, by
publishing one of their own library programmes. Any user copies a shared programme into their own
library, then adjusts it and runs it like any other. The spec is
[specs/2026-11-19-shared-library.md](specs/2026-11-19-shared-library.md) (K171), and the routes
are in [api.md](api.md) §3.5.

- **Publishing is a snapshot.** The shared library keeps its own copy of the document. A later
  edit or delete in the admin's library changes nothing shared. Publishing the same programme
  again replaces its shared copy.
- **Publishing previews.** The preview shows the document as every user will see it: the name,
  the description, and each activity's notes and links. Nothing is shared until the admin
  confirms.
- **A copy is the user's own.** It is an ordinary library programme with a new id and the shared
  programme's name. It keeps no link to the shared one, and later publishes don't reach it. It
  counts towards the library's 100 programmes and the account's quota.
- **A shared programme names no one.** No shared answer carries an owner, a user id or a username.
- **Adjusting a copy.** There is no form editor. A copy changes through the start options (the
  parameters, the start day and the tracker's name) or through an agent's `save_programme`.

An admin is an account with the admin flag, set with `tracker-admin admin <email>` ([api.md](api.md)
§5). Publishing is in the app only: no MCP tool publishes.
