The programme builder: a page of its own where a person builds a programme, or changes one in their Library, in a form with the weeks beside it, then saves it to the Library.

## Use

- **Where** (spec R1): `#/programmes/new` from **Build a programme** on the Programmes page's Add tab, and `#/programmes/<id>/edit` from **Edit** on a Library row (the ProgrammesPage card). Both return to the Programmes page. A Reference programme is changed by copying it first; a started run changes through the ChangeSheet, never here.
- **The column** (spec R4; option A of the mockup `261120-programme-builder`): on a laptop the page sits in a centred column **1184u** wide on the page's 48u margins (the 1280u screen less 48u each side), so the **520u form** and the weeks sit side by side with a 48u gap. It amends K176's 960u for this page only (K184). The system has no width tokens, so the 1184u lives here, as K176's 960u lives in the page cards' READMEs. Below 1024px wide, and on a phone, the column is one: the weeks move under the form, headed **Preview**.
- **The head**, as ItemPage's with no bar: **Back to programmes** (TextLink with Lucide `chevron-left`), a line in `label` `ink-secondary`, then the `h1` in `title-1`. New: "Programmes" over "New programme". Edit: "Edit programme" over the programme's name as it was loaded. Editing a programme that has a run adds a line in `body` `ink-secondary` under the title: "Runs already started keep their own copy." (spec F10). Nothing else sits in the head.
- **The form**, four sections, each an `h2` at 27u (22n folded) on a 1px `line` rule, as the Programmes page's sections (K171), with a lead line in `body` `ink-secondary` under the title where one is given:
  1. **The programme:** **Name** (TextField), **Description** (TextArea, three lines; hint "Markdown. Anyone who copies the programme sees it."), **Kind** (SegmentedControl: Strength, Mobility, Cardio), then **Weeks** (Stepper, 1 to 156). The section has no Exercises a day (K190). A new programme leaves the daily target out, so its tracker starts at the kind's default. The person sets the goal on the tracker, as for any tracker. A loaded programme keeps its daily target as it is.
  2. **Activities:** "Five of at most 30. Press one to change it.", then one ActivityCard per activity in the document's order, 12u apart, then **Add activity** (secondary, Lucide `plus`), which adds a card of the programme's kind, open. One card is open at a time.
  3. **Exception weeks:** "A week whose values differ, such as a deload or a rest. After a deload the plan carries on as planned. After a rest, an activity picks up where it stopped.", then the ExceptionWeekEditor card's rows and **Add exception week**.
  4. **Values chosen at start:** "Each one is asked for when the programme starts, with its default filled in.", then the StartValueEditor card's rows and **Add a value**.
- **The weeks:** headed **The weeks** on a laptop and **Preview** on a phone, in the sections' `h2` style, then a hint in `caption` `ink-secondary`: "Weeks by number, at the default values. It updates a moment after each change." ("Swipe for later weeks." on a phone, in place of the second sentence). Then the ProgrammeGrid card undated (K173): the server's plan at the default values, every week a later week, no buttons. On a laptop the weeks are `position: sticky` 16u from the top, so they stay in view while the form scrolls. A week over an item's limit shows its value in `error-ink` with Lucide `circle-alert` (the ProgrammeGrid card).
- **When the draft can't be expanded** (spec S2: any problem but a week limit), the grid keeps the last plan with no problems, and an InlineMessage (info) over it says "The weeks show the last version with no problems." Before any plan at all, the grid is left out and only the line shows.
- **The check** (spec F3): about 400 ms after the last change, the page sends the draft to `POST /api/programmes/draft`. A newer draft drops the answer to an older one.
- **Problems by path** (spec F4): each problem shows under the field that writes its path, as TextField's error, and on its card's closed line (ActivityCard). A programme problem with no field of its own, such as a loaded document's daily target, shows as an InlineMessage (error) under **The programme**'s title. Its sentence is the server's, with its first letter capitalised: "Week 6 comes to 520 kg. The most is 500.", "Give a name of 1 to 60 characters."
- **The foot bar** (spec §5.7): ProgrammeGrid's "Previewing a change" bar (K148), sticky at the window's foot, on `panel` with a 1px `line` rule above it and `shadow-overlay`. The page scrolls above it, never under it. Left, the check's line at 19u (16n folded); right, **Cancel** (secondary) and **Save to library** (primary; **Save changes** when editing). Folded, the line takes its own row and the two buttons share the next, half each.

| The check | Line |
| --- | --- |
| Checking | Lucide `loader-circle`, "Checking…", in `ink` |
| No problems | Lucide `check`, "Checked. No problems.", in `ink` |
| Not saved yet | "Not saved yet.", in `ink-secondary`: a new programme before its first change. Its problems wait for that change or a press of Save, which shows them and saves nothing |
| Problems | Lucide `circle-alert`, "One problem, in Deadlift. Fix it to save." or "Three problems, the first in Deadlift. Fix them to save.", in `error-ink`, underlined. It is a button: pressing it opens that card and focuses that field. A problem with no field (the document's size) is named here only |
| Offline | Lucide `cloud-off`, "Offline. Saving needs the server.", in `ink-secondary`. The check waits too |

- **Save** is disabled (40%) while a check is on its way, while the last check's problems show, and offline. Saving needs the latest check to have no problems (spec F3).
- **Saving** (spec F8): new, it adds the programme, and the Programmes page opens on Library with the new row landing as a copy does (K174, K177). Edit, it saves with the rev it loaded. While it saves, Save keeps its label and gets `aria-busy="true"`.
- **Questions,** each the ConfirmDialog card:
  - Changing the kind with activities (spec F6): "Change to Mobility?" / "Weight goes from 4 activities." / Cancel, **Change kind**. Cancel keeps the kind.
  - Leaving with unsaved changes (spec F9), by Cancel, the back link or closing the tab: "Leave without saving?" / "Your changes to Beginner 5×5 are not saved anywhere." ("This programme is not saved anywhere." while it has no name) / Cancel, **Leave**. Closing the tab uses the browser's own question.
- **A conflict on save** (spec F8, a 409) opens the Dialog card: "Beginner 5×5 changed since you opened it" / "It was saved somewhere else. Load the saved version to see it, or save yours over it." / **Load the saved version** (secondary), **Save mine over it** (primary, a save at the server's rev). Closing the Dialog, by Escape, its Close or a press outside, keeps the draft and the page. Only Load the saved version replaces the draft (K189).
- **Sizes:** at u = 1, text and fields 19u, controls 60u (the section buttons 52u), names 22u, section titles 27u, the title 40u. **Folded**, the system's n sizes: text 18n, labels 16n, controls 48px, the title 30n, section titles 22n, 16px margins, and the grid bleeds to the screen's edges as ProgrammeGrid's does.

## States

| State | Look |
| --- | --- |
| New, untouched | "Programmes" over "New programme"; Not saved yet.; Save to library ready |
| New, checked | "Programmes" over "New programme"; Checked. No problems.; Save to library ready |
| Edit | "Edit programme" over the name; Save changes |
| Edit, with a run | The runs line under the title |
| A week over a limit | The card's problem line and its `error-ink` border; the grid's cells in `error-ink`; the bar's problem line; Save disabled |
| Can't be expanded | The field's error; the info line over the last plan; the bar's problem line; Save disabled |
| Checking | "Checking…" in the bar; Save disabled |
| Saving | Save keeps its label, `aria-busy="true"` |
| Offline | The bar's offline line; Save disabled |

## Accessibility

- The page is a `main` labelled by its `h1`. Each section is a `section` labelled by its `h2`; the weeks are an `aside` labelled by theirs.
- The bar is a `region` named "Check and save". Its line sits in a `role="status"` box, so a screen reader hears each new result without losing its place. The problem line is a button, and pressing it moves focus to the field.
- Each field with a problem has `aria-invalid="true"` and `aria-describedby` pointing at its error (TextField). A closed card's problem is tied to its toggle the same way (ActivityCard).
- The grid is ProgrammeGrid's: a real table in a focusable, labelled scrolling box ("The weeks, at the default values"). A cell over a limit adds ", over the limit" for a screen reader.
- Contrast, measured by the gate in both themes: `ink`, `ink-secondary` and `error-ink` on `canvas` and `panel`, `ink-secondary` on `tile`, `control-border` and `focus` on `canvas`, `ink` on `canvas` for an open card's frame.

## For the app

`src/components/ProgrammeBuilder.vue` (W5), with ActivityCard, ValueField, ExceptionWeekEditor and StartValueEditor. Test ids, as in the preview:

| Element | Test id |
| --- | --- |
| The page, Back | `programme-builder`, `builder-back` |
| The head | `builder-runs` (the runs line) |
| The programme | `builder-programme`; `builder-name`, `builder-description`, `builder-kind`, `builder-weeks` |
| The sections | `builder-activities`, `builder-exceptions`, `builder-params` |
| The weeks | `programme-grid` (ProgrammeGrid's), `builder-kept` (the last-version line) |
| The bar | `builder-bar`, `builder-check`, `builder-cancel`, `builder-save` |

## You provide

The programme's document as stored (edit) or an empty one of the chosen kind (new), and for edit its id, rev and whether it has a run. From the server after each check: the problems, each with its JSON path and sentence, and the plan (`POST /api/programmes/draft`'s `plan`, ProgrammeGrid's undated shape), whose cells over a limit carry `limits` (a field's name to the problem's path). Whether the app is online.
