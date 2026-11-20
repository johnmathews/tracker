# Programme builder: form or grid

**Question:** where a person types a programme's values when building one in the app, or changing
one in their Library, without writing JSON (#78). The Programmes page and its tabs stay as they
are. So do the Add tab's paste and file, and the change flow for a started run.

**Status:** decided. Question 1: A; question 2: A; question 3: A.

**Link:** https://claude.ai/artifact/8cEPoRGncaHoAfysyAk2cz

## Options

Both options are a page of its own: `/programmes/new` from the Add tab, and
`/programmes/<id>/edit` from Edit on a Library programme. Both send the draft to the server a
moment after each change. The server checks it and computes the weeks. Each problem shows beside
what caused it. A bar at the foot holds the check's result, Cancel and **Save to library**. It is
ProgrammeGrid's "Previewing a change" bar (K148). Editing reads "Edit Beginner 5×5" over the title,
and Save reads **Save changes**. The grid is ProgrammeGrid undated (K173). A week over an item's
limit shows its value in `error-ink` with Lucide `circle-alert`. No colour is new.

- **A. A form, with the weeks beside it.** The form holds four sections: The programme, Activities,
  Exception weeks and Values chosen at start. Each activity is a card. Closed, it says its rule in a
  line ("1 × 5 · 70 kg, +90 kg a week") and any problem under it. Opened in place, framed in 2px
  `ink` (K147), it holds the activity's fields. Weight is a group on a `tile`: Stays the same or
  Grows, Starts at, Grows by kg or %, Amount and Every. A value chosen at start fills a field as a
  Menu ("Squat start · 40 kg"). **More** opens the rarer fields: the most, the rounding, the key,
  notes and link. The grid sits to the right and stays in view while the form scrolls. On a phone
  it moves under the form as Preview. The page column is `--candidate-builder-width: 1184u`, the
  screen less its 48u margins, so the 520u form and the grid fit side by side. That would amend
  K176's 960u for this page only. (Recommended: a programme is a set of rules, and a form edits the
  rules themselves, so building and tweaking work the same way.)
- **C. Edit on the week grid.** The name, kind, weeks and exercises a day sit in a strip over the
  grid. The grid is the editor. An activity's head shows its rule, and pressing it opens the rule.
  A week's cell opens a Menu, as a later week does on a run: **This week only** or **Change the
  rule**. A week's head opens **Make week 4 an exception**, for a deload. The trade-off: the format
  stores rules, so a typed cell can only become a one-week exception. Each shows a pencil, as a
  hand-edit does on a run (K143), and they pile up as a person tweaks. The rule still needs a form,
  so C contains a smaller A. On a phone about two weeks show at a time.

## Round 2: the fields and the editors (spec §9, M1–M3)

Round 1 drew Weight's shape only, and drew the exception weeks and the values chosen at start
closed. Two questions are open. Question 1 (the layout) is settled, and option C is off the page.
Each stage is drawn on a phone first, then on a laptop. The programme is Beginner 5×5 with no
mistakes. No colour or value is new.

### 2. How a value shows its shape, and how a field is left out

Each number in an activity is a plain number, a value chosen at start, or a value that grows.
Times a week, Sets, Reps, Time, Distance and Weight all work this way. In every option, Measure
gains a third choice, **Neither**. A field that can be left out offers **None**, and a field left
out stays out of the saved programme. The card shown is Plank: 3 sets, a 30 s hold growing 5 s
every 2 weeks up to 90 s, and no weight.

- **A. One line per value, opened one at a time.** Each value is a line: its name, then its
  shape in words ("30 s, +5 s every 2 weeks, up to 90 s", "None"). Pressing a line opens round
  1's group under it and closes the one open before. A second phone stage shows Base miles'
  Long ride, whose distance starts at a value chosen at start. (Recommended: the card stays
  short, and each value reads as a sentence before it is opened.)
- **B. Every value drawn in full.** Each value is its own group, always open. Nothing needs
  pressing. Plank alone runs to about two phone screens.
- **C. A Grows switch on each field.** Each value is a plain field with the Switch card's
  **Grows** beside its name, and the increase shows under it when on. A value chosen at start
  sits in the field's menu, and an empty Weight means none. Both are less visible.

### 3. An exception week, opened

An exception names its weeks (1 to 156), an optional label, and values for every activity or
for one, each a number or a percentage of the planned value. Both options open it in place in
the 2px `ink` frame (K147).

- **A. Weeks typed as a list, values as rows.** "4, 8" in a text field. A group for every
  activity and one per activity with its own values. Each row reads **Set to** or **% of
  planned**. (Recommended: the same for 8 weeks or 156, and each row says what it does.)
- **B. Weeks pressed on a grid of numbers, values in a table.** A 156-week programme shows 156
  numbers. A cell takes "3" or "90%", and an empty cell keeps the plan. The table scrolls
  sideways on a phone and in the laptop's 520u form.

Both options open a value chosen at start the same way: Label, Unit, Default, Lowest and
Highest, a "Used by" line, More for the key, and Remove (refused while a field uses it, F7).

## Decision

A, a form with the weeks beside it: "A. Form + preview (Recommended)", John, 2026-11-20. It is
K183 in `docs/decisions.md`, and its 1184u column is K184. Round 2's picks: question 2, "A. One
line, tap to open (Recommended)", is K186, and question 3, "A. Typed weeks + groups
(Recommended)", is K187, John, 2026-11-20.

## Rounds

- **1, 2026-11-20:** the first options.
- **2, 2026-11-20:** field shapes and the exception week and start value editors (spec §9 M1–M3).
