# How a programme looks

**Question:** how a programme shows up in the app (spec `docs/specs/2026-11-17-programmes.md` §10),
in seven questions. Round 2 added question 6, the Programmes page (§9.1), which round 1 didn't
draw, and question 7, where a change's preview shows (§9.3 against pick 3B). Round 1's five: the overview at phone width, its locked, hand-edited and paused cells, the change
sheet with its preview, the activity page's Programme row, and the week view's programme header.
The week view outside its header, a paused row and a locked day stays as PlannerScreen draws it.
So do the item page's other rows, and the Dialog, Button, Chip and DayMark cards.

**Status:** decided

**Link:** https://claude.ai/artifact/LoqznRAqhGoe2ffy8ord4R

## Options

1. **The overview at phone width** (live prototype; `try.html#overview-a|b|c`)
   - **A.** A table that scrolls sideways. The activity column is fixed, there is one column per
     week, and on a phone it opens on this week.
   - **B.** A timeline of weeks down the page. Past weeks fold to one line ("All five goals met"),
     this week sits on a `tile`, and later weeks show what to lift.
   - **C.** Both: the table on a wide screen and the timeline on a phone, folding by the week's own
     rule (K26). (Recommended: each screen gets the shape it reads best in, and the phone never
     scrolls sideways.)
2. **Locked, hand-edited and paused cells**
   - **A.** Icons: a `lock` by each past week's name, a `pencil` after a hand-edited value, and a
     `pause` sign with "Paused" and the reason. This week sits on a `tile`. (Recommended: the
     smallest marks, the same in the table and the timeline, each one named for a screen reader.)
   - **B.** Words: "Locked" under past weeks' dates, "By hand, 12 Dec" under the value, and
     "Paused" over the reason.
   - **C.** Fill and corner: past weeks on a `tile`, this week framed in 2px `ink`, and a
     hand-edit marked with NoteMark's folded corner. This makes the corner mean two things.
   - In every option: weeks after an open pause read "When resumed" in place of their dates.
3. **The change sheet and its preview** (the Dialog card; `try.html#change-a|b`)
   - **A.** One sheet: Change, Weight in kg, From, For (From then on | That week only), Reason, then
     "What changes" (before → after per week, the blocking hand-edit with "Drop it too") and Confirm
     change. (Recommended: the preview follows each choice, and Confirm sits right after it.)
   - **B.** Two steps: the fields and "Preview change", then a summary, the same preview, Back and
     Confirm change.
4. **The activity page's Programme row** (`try.html#activity-a|b`)
   - **A.** A step chart. The planned weight is solid up to this week and dashed after it. Each week
     done gets a dot, filled in `pen` when its goal was met. The chart leaves a gap for a pause and
     marks each change with a labelled dashed line. Hovering a week shows its numbers, and a
     screen reader gets a hidden table. (Recommended: the shape reads at a glance.)
   - **B.** A week a line, in the shape of Recent weeks: dates, planned weight and result, with each
     change on a line of its own.
5. **The week view's programme header** (`try.html#week-a|b`)
   - **A.** "Week 4 of 8" as a link at the end of the title's line, a `lock` by a locked day's name,
     and a paused row that reads "Paused until Mon 28 Dec. Knee." in place of its boxes.
     (Recommended: one line of header, and a paused row that can't be taken for a week off.)
   - **B.** A line under the title ("Programme week 4 of 8, a deload." and "Open the programme"),
     a locked day on a `tile`, and a paused row drawn as dashed boxes with a "Paused" chip.

6. **The Programmes page** (round 2; `try.html#programmes-a|b|c`). The page the bar opens: the runs
   now going, the library, adding a programme an agent wrote, and starting one with the plan as a
   preview.
   - **A.** One page in rows, the shape of an item's page (K65): Running, Library and Add a
     programme. Preview and start opens a page of its own, like the new item page (K104): Name,
     Start and the starting values in a row, then the plan full width as the preview.
     (Recommended: the shape the app already uses for a page of things and for adding one, and
     the preview gets the whole width the table needs.)
   - **B.** Tabs, Running, Library and Add, as Settings has. Preview and start opens the programme
     in place in the Library list, framed in `ink`, with the fields and the plan inside it.
   - **C.** One page with two plain lists and Add programme on the title's line. Adding and
     starting each open a sheet (the Dialog card) over the list, the plan's preview inside it.
   - In every option: a run is a line linking to its overview ("**Week 4 of 8.** Running. Ends Sun
     17 Jan."; "**Week 3 of 9.** Paused since Mon 7 Dec. A cold."); a library programme shows its
     kind, weeks and activities and a line about it, with Preview and start, Duplicate and Delete;
     a pasted programme with mistakes gets an InlineMessage (error) and one line per problem, its
     JSON path first ("activities[2].weight.rate: a progression has add or rate, not both.").
7. **Where a change's preview shows** (round 2; `try.html#preview-a|b`). Spec §9.3 says the plan's
   table shows a change's preview ("40 → 45 kg"); pick 3B shows it as a list in the sheet.
   - **A.** The sheet's list only, as picked in 3B. The plan changes once the change is confirmed.
     (Recommended: one place to read a change, as John picked it, and one thing less to build.)
   - **B.** The sheet's list, plus "Show it in the plan" on step 2. It puts the sheet away and shows
     the overview with each changed cell as "40 → 45 kg", and a bar at its foot: "Previewing a
     change." with Back to the change and Confirm change.

## Data

The data is the same on every screen. The programme is "Beginner 5×5": eight weeks from Mon 23 Nov
2026, with deloads in weeks 4 and 8 (3 sets, weight × 0.9). Today is Wed 16 Dec, in week 4. Weights
come from the spec's §3.2 engine, worked in decimals, rounded to 2.5 kg with halves up.

- **Back squat:** 40 kg at 5% a week, changed to 7.5% on Thu 3 Dec. It runs 40, 42.5, 45, 45
  (deload), 52.5, 57.5, 60, 60 (deload).
- **Bench press:** 30 kg plus 2.5 kg a week, lowered to 32.5 kg on Wed 9 Dec. That change splits
  week 3: "35 → 32.5 kg from Wed". It runs 30, 32.5, 32.5, 32.5 (deload), 37.5, 40, 42.5, 40.
  The lowering was added so a split week has data to show.
- **Barbell row:** 30 kg plus 2.5 kg a week, with week 6 set by hand to 35 kg on 12 Dec.
- **Deadlift:** 60 kg plus 5 kg a week, paused from Mon 14 Dec for two weeks (knee). It comes
  back at 75 kg and ends at its week 6 of 8. It stays 1 × 5 on deloads.
- **Plank:** 3 × 30 s, plus 5 s every second week.
- **Round 2's Programmes page:** two runs, Beginner 5×5 (week 4 of 8, running) and Couch to 5K
  (week 3 of 9, paused since Mon 7 Dec, a cold). The library holds Beginner 5×5 (strength, 8
  weeks, 5 activities), Hip mobility (mobility, 6 weeks, 4 activities) and Couch to 5K (cardio,
  9 weeks, 1 activity). Starting Hip mobility from Mon 21 Dec with a hold start of 30 s and 10 s
  more a week (90 s at most), week 6 lighter. The pasted programme has three problems: `weeks` 60,
  `activities[2].weight.rate` beside an `add`, and `activities[4].key` with capitals.
- **Change example:** Barbell row set to 45 kg from Mon 21 Dec. That gives 40 → 45, 45 → 50 and
  42.5 → 47.5 (deload). Week 6 keeps its 35 kg unless the hand-edit is dropped, which makes it
  35 → 47.5.

## Measured

- `pen` as text on the light `tile` measures 4.49:1, just under 4.5:1. So a met count on a tile
  (this week, or 2C's locked weeks) is drawn in `ink` with its underline in `pen`. The page shows
  both measures.
- The other new pairings pass in both themes:
  - `ink` and `ink-secondary` on `tile`;
  - the chart's `pen` dot (4.9:1) and its `ink-secondary` ring (6.4:1);
  - the change line in `control-border` (3.6:1);
  - in 5B, `control-border` on `tile` (3.3:1).

Round 2's new pairings: `error-ink` as text on `canvas` and on `panel` (a sheet, C), and as the
pasted box's border, all measured on the page; the gate holds `error-ink` on `canvas` and `panel`
at 4.5:1.

## Decision

John picked on 2026-11-17, in his words: "1. A 2. C 3. B 4. A 5. A". Recorded as K142 to K146,
the next free numbers on `origin/main` when the build began (K141 was the last there on
2026-11-18). The cards are ProgrammeGrid (K142, K143), ChangeSheet (K144), ProgrammeChart (K145)
and PlannerScreen's programme screen (K146).

1. **A** (K142), the table that scrolls sideways, on every screen width (not the recommended C).
2. **C with A's pencil** (K143): past weeks on a `tile`, this week framed in 2px `ink`, and a hand-edit
   marked by the `pencil` after its value. The folded corner keeps meaning only "has a note". John
   chose this when asked about the clash, the same day.
3. **B** (K144), two steps: the fields and "Preview change", then the preview with Back and Confirm change
   (not the recommended A).
4. **A** (K145), the step chart.
5. **A** (K146), "Week 4 of 8" as a link on the title's line, a lock by a locked day, and the paused row's
   sentence.

Round 2: John picked on 2026-11-18, in his words: "6 = B, 7 = B". Recorded as K147 and K148, the
next free numbers on `origin/main` that day (K141 still the last there). The cards are
ProgrammesPage (K147), and ProgrammeGrid and ChangeSheet (K148).

6. **B** (K147), tabs for Running, Library and Add. Preview and start opens the programme in place
   in the Library list, framed in 2px `ink`, with its fields and the plan inside it (not the
   recommended A).
7. **B** (K148), the sheet's list and the plan too: step 2 has "Show it in the plan", which shows
   the overview with each changed cell as "40 → 45 kg" and a bar at its foot, "Previewing a
   change.", with Back to the change and Confirm change (not the recommended A).

## Rounds

- **2, 2026-11-18:** questions 6 (the Programmes page) and 7 (where a change's preview shows)
  added at the top; questions 1 to 5 marked decided and left as they were. John picked 6B and
  7B the same day. `try.html`
  gains the screens 6 Programmes and 7 Preview.
- **1, 2026-11-17:** the first options for all five questions. The screens are live
  (`proto.js`, `proto.css`, `marks.css` from DayMark's masks), and `try.html` shows them full size
  with a switch for screen, option, cells, activity and theme.
