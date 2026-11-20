# Programme builder

> Purpose
>
> How a person builds a programme in the app, or changes one in their Library, without writing
> JSON (#78). It is the authority for the build. The format it writes is
> [programmes.md](../programmes.md) §2 to §4, and the look is option A of the mockup
> `brand/design-system/mockups/261120-programme-builder`.

**Status:** built, 2026-11-20. Approved by John the same day ("Design doc looks good"). His
picks and the build's calls are K183 to K192 in [decisions.md](../decisions.md) §4.32. Answers
taken from John on 2026-11-20: the builder makes new programmes and edits Library ones, nothing
else; it covers the whole format; it is for any user, built mainly on a laptop or desktop. He
picked option A, a form with the weeks beside it, in the mockup the same day, and option A of
round 2's two questions (§9).

**Amended 2026-11-20 (K190):** the builder has no Exercises a day field. John, on the local stack:
the times a week of each activity already say how often he trains, so a daily count adds nothing
and can contradict them. §5 and §8 say what changed.

**Amended 2026-11-20 (K191):** an exception week has a Rest these activities checklist. John, on
the local stack: "I might give my legs a rest one week and then chest and arms a rest another
week." He picked option A, a checklist, in the mockup `261120-rest-activities`. §5, §10 and §11
say what changed.

**Amended 2026-11-20 (K192):** a rest stops the activity's series for that week, and the week after
repeats the last week done: "back squat, 40, 42.5, 45, rest, 45, 47.5, 50". This holds for an
exception week's rest and for Edit one week to 0 on a run. Deloads still keep counting. The rule
lives in [programmes.md](../programmes.md) §4.

## 1. Why

Before the builder, a programme reached the Library only as JSON: an agent's `save_programme`, or
text pasted or a file chosen on the Add tab. A person without an agent can't write a programme, and can't change
one they copied from Reference. The builder lets any user write and adjust the rules of a
programme in a form, and see the weeks those rules make as they type.

## 2. Goals, non-goals, anti-goals

**Goals**

- **B1.** Build a new programme from an empty form and save it to the Library.
- **B2.** Open any Library programme in the same form, change it and save it in place.
- **B3.** Cover the whole `tracker-programme/1` format. Any valid Library programme opens, and
  saves again unchanged when nothing was touched. No field is lost on the way through the form.
- **B4.** The server's check is the only check. Each of its problems shows beside the field it
  belongs to.
- **B5.** The weeks beside the form are the server's, recomputed a moment after each change.
- **B6.** Works at 390px with no sideways page scroll, though built for a laptop first.

**Non-goals**

- Editing a started run. A run changes only through the change flow (programmes.md §8), with its
  preview and token. The builder never reads or writes a run.
- Editing a Reference programme directly. A person copies it to the Library first, then edits
  the copy. Copy already exists (K172).
- Food programmes (#79), mixed kinds (#77), training days (#76) and double progression (#81).
- Any change to the format, the validator's rules or the MCP tools.

**Anti-goals** (failures even if it works)

- A form that silently drops or rewrites part of a document: a `scale` turned into a number, a
  parameter reference turned into its default, an override's `"*"` expanded into each activity.
- A second validator in the browser that disagrees with the server's.
- Any path by which a Library edit reaches a run's weeks or its sealed days. Runs keep their own
  copy (programmes.md §7), and that stays true.

## 3. Approaches

Three were weighed in the mockup round (`261120-programme-builder`):

- **A. A form, with the weeks beside it.** Picked by John, 2026-11-20. A programme is a set of
  rules, and a form edits the rules themselves, so building and tweaking work the same way. The
  cost: on a laptop the grid beside the form shows about four weeks and scrolls sideways for the
  rest.
- **B. A step-by-step wizard.** Good for a first build, slow for changing one value, which is
  most edits. The server's problems come back for the whole document and would point at steps
  already left. Dropped before the mockup.
- **C. Edit on the week grid.** All weeks show at once, but the format stores rules. A typed cell
  can only become a one-week exception, and those pile up. The rule still needs a form, so C
  contains a smaller A. Shown in the mockup, not picked.

## 4. Where it lives

- **R1.** Two addresses, in the app's hash routing (`src/lib/routes.ts`):
  `#/programmes/new` and `#/programmes/<id>/edit`. Both are pages of their own, opened from the
  Programmes page and returning to it.
- **R2.** The Add tab gains **Build a programme** (primary) above the paste field. Paste and
  Choose file stay as they are.
- **R3.** Each Library row gains **Edit** beside Preview and start, Duplicate and Delete. The
  Library's empty line points at both: "Build one, or add one on the Add tab."
- **R4.** The page column is 1184u on a laptop: a 520u form and the grid side by side. It amends
  K176's 960u for this page only, and gets its own decision. Below the two-column breakpoint the
  grid moves under the form, headed **Preview**. The breakpoint is 1024px (K184).

## 5. The page

The layout and copy follow the mockup's option A. Sections, top to bottom:

1. **Head.** A back link to Programmes, the title ("Programmes" over "New programme", or "Edit
   programme" over the programme's name), and nothing else.
2. **The programme.** Name, Description (markdown, a TextArea), Kind (SegmentedControl: Strength,
   Mobility, Cardio), Weeks (Stepper, 1 to 156). There is no Exercises a day field (K190). A new
   programme leaves `dailyTarget` out, so its tracker starts at the kind's default. The person
   sets the goal on the tracker, as for any tracker. A loaded document keeps its `dailyTarget` as
   it is (B3). A problem at `dailyTarget`, or at any other programme key with no field, shows at
   the top of this section.
3. **Activities.** One card per activity, in document order.
   - Closed, a card shows the name and its rule in a line ("5 × 5 · 40 kg, +5% a week"), and any
     problem under it in `error-ink`.
   - One card opens at a time, in place, framed in 2px `ink` (K147).
   - Open, it holds the kind's fields (programmes.md §2.1): Name, Times a week, Sets, Measure
     (Reps, Time or Neither), Reps or Hold, Sides (Per set or Each side), Weight, and for cardio
     Time and Distance.
   - Each value is one line that says its shape in words, and opens on a press (K186). Open, it
     is one of the three shapes in programmes.md §3: **Stays the same** (a number or a
     parameter) or **Grows** (a progression). Grows shows Starts at, Grows by (the unit or %,
     which picks `add` or `rate`), Amount, and Every (weeks). Most (`max`) and Round to (`step`)
     sit behind "Change the most and the rounding".
   - Sets, Weight, and cardio's Time and Distance also offer **None**. A value left at None stays
     out of the saved document.
   - **More** opens the key, Notes and Link.
   - A card's menu holds Move up, Move down and Remove.
   - **Add activity** adds a card of the programme's kind, open.
4. **Exception weeks** (`overrides`). Each exception lists its weeks, typed as "4, 8", an
   optional label ("Deload"), and its values: a group for every activity (`"*"`) and one per
   activity. Each value is **Set to** a number or **% of planned** (`scale`) (K187). The closed
   row reads "Weeks 4 and 8 · Deload", then a line a group: "Every activity: 3 sets, 90% of the
   weight.", "Deadlift: 1 set."
   - **Rest these activities** (K191) sits under the label, before the values. It is a Checkbox
     row for Every activity, then one per activity in document order, with the hint "A rested
     activity has no sessions in these weeks." A tick writes `target: 0` into that key's entry,
     and makes the entry if there is none. An untick removes `target`, and the entry too when it
     is left empty. Keys keep their order.
   - A row is ticked when its key's own `target` is exactly 0. While Every activity is ticked, an
     activity with no `target` of its own shows ticked and disabled: it rests through Every
     activity. An activity with its own `target` that isn't 0 doesn't rest, since its own value
     beats `"*"` (K153), so its row stays unticked and can be ticked.
   - A `target` of 0 shows only in the list. The value groups leave it out: a group with nothing
     else is not drawn, Add a value doesn't offer Times a week while the key rests, and Add values
     for one activity still offers an activity whose entry holds only its rest. Any other `target`
     (Set to 2, % of planned) is a value row as before.
   - The closed row names the rests first: "Rest: Back squat, Deadlift.", or "Rest: every
     activity." for `"*"`. The groups' lines follow, without the rests.
   - A problem at `overrides[i].activities.<key>.target` for a rest shows under its Checkbox row.
     A loaded document whose overrides already hold `target: 0` shows those rows ticked, and saves
     unchanged when nothing is touched (B3).
5. **Values chosen at start** (`params`). Each has a Label, Unit, Default, and optional Lowest and
   Highest, with a "Used by" line naming the fields that use it. A Starts at or Amount field picks a value from here through a Menu
   ("Squat start · 40 kg"), or takes a number.
6. **The weeks.** ProgrammeGrid undated (K173), the server's plan at the default values. It stays
   in view while the form scrolls on a laptop. A week whose value breaks an item's limit shows
   that value in `error-ink` with Lucide `circle-alert`.
7. **The foot bar.** ProgrammeGrid's "Previewing a change" bar (K148): the check's result
   ("Checked. No problems." or "One problem, in Deadlift. Fix it to save."), Cancel, and **Save
   to library** (new) or **Save changes** (edit). A new programme nobody has changed yet reads
   "Not saved yet." (K189).

## 6. Behaviour

- **F1. The draft is the document.** The form's state is the `tracker-programme/1` document
  itself, plus only the UI state the document can't hold (which card is open, whether More is
  open). Each field reads and writes one path in the document. Opening a programme loads its
  document as it is stored.
- **F2. Shapes are read off the value.** A field holding a number shows Stays the same with a
  number; `"$key"` shows Stays the same with that parameter; an object shows Grows. Switching
  shape keeps what it can: Stays → Grows uses the value as `start`; Grows → Stays keeps `start`.
- **F3. The check.** About 400 ms after the last change, the page sends the draft to the server
  (§7). A newer draft cancels the answer to an older one. Saving needs the latest check to have
  no problems. A new programme shows no problems until its first change or a press of Save, which
  then shows them and saves nothing (K189).
- **F4. Problems by path.** Each problem's path (`activities[3].weight.add`) maps to the field
  that writes it, and shows under that field. A problem inside a closed card also shows on the
  card's closed line. A problem whose path has no field (the document's size) shows in the foot
  bar. The foot bar names how many problems there are and where the first one is; pressing it
  opens that card and focuses that field.
- **F5. Keys.** A key is an id agents and runs use: an activity's becomes the item id of every
  future run, and a parameter's is what a start takes (`params={"squat": 50}`). So a key changes
  only when the person means it to:
  - An activity or parameter added in this session gets a key made from its name or label:
    lowercased, runs of other characters turned into `-`, cut to 40, and given `-2`, `-3` until
    unique. Renaming it keeps the key in step until the person edits the key under More.
  - A loaded activity or parameter keeps its key through any rename. Only an edit under More
    changes it.
  - When an activity's key changes, its override entries follow. When a parameter's key changes,
    every `"$key"` reference to it follows.
  (Lead's call after the builder check, K185: a silent key change would change how agents address
  future runs.)
- **F6. Kind.** Changing the kind of a programme with activities first names the fields it would
  drop ("Weight goes from 4 activities.") in a ConfirmDialog. Cancel keeps the kind.
- **F7. Removing.** Removing an activity also removes its entries in exception weeks. Removing a
  parameter that a field uses is refused with a line naming the fields that use it: "Back squat’s
  weight uses Squat start. Give that field a number first, then remove it."
- **F8. Saving.** New: `POST /api/programmes`, then the Programmes page opens on Library with the
  new row landing, as a copy from Reference does (K177). Edit: `PUT /api/programmes/<id>` with the
  rev it loaded. A 409 conflict opens a Dialog that says the programme changed elsewhere and
  offers **Load the saved version** or **Save mine over it** (a PUT at the server's rev). Closing
  the Dialog, by Escape or a press outside, keeps the draft (K189). Save is disabled offline, as
  every write is.
- **F9. Leaving.** Cancel, the back link and closing the tab with unsaved changes ask first
  ("Leave without saving?").
- **F10. Runs are untouched.** Saving a programme that has runs changes no run. The page says so
  under the title when the programme has a run: "Runs already started keep their own copy."

## 7. The server

- **S1.** A new route, `POST /api/programmes/draft`, `{doc}` → `{errors, plan}`. It stores
  nothing and needs a session, as `validate` does.
  - `errors` are `validate`'s, in its format.
  - `plan` has the shape of `GET /api/shared-programmes/{id}/preview`'s `plan` (K173): the
    start's preview at the default values from today. It is `null` when the document can't be
    expanded.
- **S2.** A document whose only problems are week limits ("week 6 comes to 520 kg") still
  expands, and its `plan` marks each such cell with the problem's path. Any other problem makes
  `plan` `null`, and the page keeps the last plan with a line over it: "The weeks show the last
  version with no problems."
- **S3.** No other route, rule or tool changes. `validate`, POST and PUT keep their contracts.

## 8. Words

Copy follows `voice.md` and the memory `plain-copy-style`: one idea per sentence, named subjects,
concrete nouns. Field labels are the app's existing words where they exist ("Times a week";
"Sets"; "Reps"). The format's terms appear only under More: the key, as
"Key".

## 9. Mockup round 2

Option A's mockup decided the layout. Three parts it drew only closed, or only for Weight, were
new looks, so they got a second mockup round on the same artifact. John picked option A of both
questions on 2026-11-20: M1 and M2 as K186, M3 as K187.

- **M1. Every numeric field's three shapes.** Times a week, Sets, Reps, Hold, Time and Distance
  can each be a number, a parameter or a progression, as Weight can (the fixtures `mobility.json`,
  `cardio.json` and the plank use them). The round showed a compact field that opens into the
  Grows group only when needed, beside every field drawn as a full group.
- **M2. Leaving a field out.** An optional field can be absent: a plank has no weight, and an
  activity may have neither reps nor a hold. The round showed how a field reads and is set as
  "none", so an absent field stays absent on save (B3).
- **M3. The exception week and start value editors**, open: picking weeks out of up to 156, the
  label, each value for all activities or one, as a number or a percentage; and a start value's
  label, unit, default, min and max.

The server route, the draft model and the tests for both have no look, so they were built
while the round was open.

## 10. The design system and the style guide

New cards in `brand/design-system/project/components/`, each with a README and preview, before
the component is used: **ProgrammeBuilder** (the page), **ActivityCard** (closed and open), and
**ValueField** (Stays the same / Grows, with a parameter Menu), and the editors M3 settles. Each gets its `src/styleguide`
section in the same change. The ProgrammesPage card gains Edit and Build a programme. The rest
list (K191) adds **Checkbox**, a primitive in `src/components/ui/checkbox/`, with its card and
style guide section.

## 11. Testing

- API: pytest for `draft`: a valid document, shape problems (`plan` null), limit-only problems
  (`plan` with marked cells), no session, and that nothing is stored.
- Web: Vitest at the 100% threshold for the draft model (paths, shapes, keys, kind change,
  removals), the page, and the cards.
- Round trip: every fixture in `fixtures/programmes/valid/` loads into the draft and comes out
  equal to itself.
- e2e: build the beginner 5×5 from empty, see a problem beside its field, fix it, save, find it
  in the Library; edit it and save; a 409 conflict. Add week 3 as an exception week, tick Back
  squat and Deadlift, see Rest week in their week-3 cells only, and save (K191). Axe and the
  phone width check the open rest list.

## 12. Not in this version

- Undo and redo inside the form, beyond Cancel.
- Drag to reorder activities: Move up and Move down cover it.
- A preview at chosen parameter values or a start date: that is Preview and start's job.
- Everything in §2's non-goals.
