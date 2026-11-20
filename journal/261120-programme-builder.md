# The programme builder

> Purpose
>
> Records the work of 2026-11-20: a form in the app that builds a programme, or changes one in
> the Library, without JSON (#78). The spec is `docs/specs/2026-11-20-programme-builder.md`, the
> mockup `brand/design-system/mockups/261120-programme-builder`, and the decisions K183 to K189.

## 1. What changed

- **The builder (K183).** John asked for "a way to build a programme". He answered the scope
  questions with "yes", "yes" and "it should be for any user. its fine to do it on a desktop or
  laptop primarily." He approved the spec ("Design doc looks good"), then picked "A. Form +
  preview (Recommended)". `ProgrammeBuilder.vue` is a page of its own at `#/programmes/new` and
  `#/programmes/<id>/edit`. The Add tab gains Build a programme above the paste field, and each
  Library row gains Edit.
- **The column (K184).** The page is 1184u wide from 1024px up, with a 520u form and the weeks
  beside it. The weeks stay in view while the form scrolls. Below 1024px the weeks move under the
  form as Preview. It amends K176's 960u for this page only.
- **The draft route (K188).** `POST /api/programmes/draft` returns the validator's problems and
  the weeks a start today would write, and stores nothing. A document whose only problems are
  week limits still gets its weeks, and each cell over a limit carries `limits`, its field to the
  problem's path. `programme.py` now carries the activity, field and weeks on a limit problem, so
  `data.draft_programme` marks the cells without parsing the message.
- **The draft model.** `src/lib/programmeDraft.ts` keeps the form's state as the document itself,
  read and written by path, keys in order. Every valid fixture loads and saves back equal.
- **Fields and editors (K186, K187).** Round 2 of the mockup: "A. One line, tap to open
  (Recommended)" and "A. Typed weeks + groups (Recommended)". Each value is a line that opens into
  None, Stays the same or Grows, and Measure gains Neither. An exception week takes typed weeks,
  "4, 8", with a group for every activity and one per activity, each value Set to or % of
  planned. Five new design-system cards: ProgrammeBuilder, ActivityCard, ValueField,
  ExceptionWeekEditor and StartValueEditor, each with its style-guide section.
- **The store.** `replace` saves an edit at its rev and hands back the server's copy on a 409.
  `draft` drops an older answer. `landing` lands the saved row in Library, as a copy does (K174).

## 2. Calls made for John

- **Keys (K185).** A loaded activity or start value keeps its key through a rename. Only an edit
  under More changes it, and the change follows into exception weeks and `"$key"` references. An
  activity's key is every future run's item id, so a silent change would move how agents address
  it.
- **An untouched new programme (K189).** It reads "Not saved yet." and shows no problems until its
  first change or a press of Save. An empty form opening on a list of problems read as a mistake.
- **The conflict (K189).** A 409 opens a Dialog with Load the saved version and Save mine over
  it. Escape, Close or a press outside keeps the draft. The first build discarded the edits on
  close, and the lead's review caught it.
- **Copy.** "One problem, in Deadlift." spells the number, as voice.md asks. The edit head is
  "Edit programme" over the name. The start value editor says Lowest and Highest where the spec
  said Min and Max. Sets, Weight, and cardio's Time and Distance offer None.
- **The refused removal.** The code said "Change that field first." and the StartValueEditor card
  said "Give that field a number first, then remove it." The code now uses the card's sentence.
- **No Exercises a day (K190).** John tried the page on the local stack and dropped the field.
  Each activity's times a week already say how often he trains, so a daily count adds nothing and
  can contradict them. A new programme leaves `dailyTarget` out, and its tracker starts at the
  kind's default of 3. The tracker's own Stepper changes it, as for any tracker. A loaded
  document keeps its `dailyTarget`, and the format keeps the key. A problem at `dailyTarget` now
  shows at the top of The programme, so it can't go unseen. A kind change to cardio still drops
  the key, and its ConfirmDialog line reads "The daily target goes."
- **Rest these activities (K191).** John wants to rest his legs one week and his chest and arms
  another. Resting an activity took Add values for one activity, Add a value, Times a week and
  Set to 0, once per activity. An exception week now has a checklist under its label: Every
  activity, then each activity. A tick writes `target: 0`, which the grid already showed as Rest
  week (K170). He picked option A, the checklist, in the mockup `261120-rest-activities`. It adds
  the Checkbox primitive, on Reka UI's Checkbox, with its card and style guide section. A rest
  shows only in the list, so its Times a week row is hidden, and the closed week reads "Rest: Back
  squat, Deadlift." first.
- **A rest picks up where it stopped (K192).** John first chose that a rest keeps the series
  counting, then corrected it: "the progression should stop for that week and pick up at the
  previous setting. for the example, back squat, 40, 42.5, 45, rest, 45, 47.5, 50". A week an
  activity is planned at 0 sessions, by an exception week or by Edit one week on a run, doesn't
  advance its activity week, and the week after repeats the last week done. Deloads still don't
  bend the series. The static range check, the replay, its projection, Go to week and the draft
  route all follow the same plan, so Go to week lands where the grid says. A planned rest never
  makes an activity end short. No stored programme had a rest, so no run shifted.

## 3. Found on the way

- The validator already skipped week limits on request (`check_ranges`), so a limit-only
  document could still expand. The route needed one helper factored out of `preview_shared`.
- There are two `ProgrammeDoc` types: the strict one in `programmeDraft.ts`, which the builder
  uses, and a loose one in `programmes.ts`.
- Several agents shared one worktree, so none of them stashed, checked out or reset. The K numbers
  start at K183 and need re-checking against `origin/main` before the push, since parallel
  sessions take the same next numbers.
