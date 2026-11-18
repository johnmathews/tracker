The Programmes page: the programmes running now, the library to start one from, and a way to add one, under three tabs.

## Use

- **Where:** `#/programmes`, opened from the bar (spec §9.1). It is a page like an item's page: no bar, Back to the week at the top, then "Programmes" in `title-1`.
- **Three tabs** (K147), the Tabs card: **Started**, **Library**, **Add** (K161: "Running" is also an activity's name, so the tab and a run's line say Started). The page opens on Started. A tab's content starts 8u under the tabs' rule.
- **Started:** one line per live run, each a link to its overview (`#/programme/<tracker>`, the ProgrammeGrid card). The tracker's name in weight 600 (22u), then one line in `body` `ink-secondary` with its first sentence in `ink` at 600: "**Week 4 of 8.** Running. Ends Sun 17 Jan." or "**Week 3 of 9.** Paused since Mon 7 Dec. A cold." A Lucide `chevron-right` in `ink-secondary` ends the line. Lines are separated by 1px `line` rules, with none above the first (the tabs' rule is there). Under the pointer the name underlines, 2px.
- **Library:** one entry per programme in the account's library. Its name in weight 600 (an `h2` under the page's `h1`, so the headings never skip a level; "Preview" inside it is an `h3`), its kind, weeks and activities in `body` `ink-secondary` ("Strength · 8 weeks · 5 activities"), its description in `body`, then its actions: **Preview and start** (secondary, Lucide `play`), **Duplicate** (quiet, `copy`) and **Delete** (quiet, `trash-2`; it asks first, in the ConfirmDialog). Folded, Preview and start takes a row of its own, and Duplicate and Delete share the next.
- **Opened in place to start** (K147): Preview and start opens the programme where it is in the list, in a box framed in 2px `ink` (`radius-lg`, 16px inside, 16px out past the list's edges; 8px folded). Its actions give way to:
  - **Name** (TextField, the programme's name to begin with; hint "Its tracker's name. You can change it later."), **Start** (a field-shaped date button with Lucide `calendar`; hint "Today, Wed 16 Dec, or any later day. Week 1 starts on its Monday.") and one TextField per parameter, labelled with its label and unit ("Hold start in seconds"), its hint giving the programme's own value ("The programme's own: 30."). The fields sit two to a row where there is room (at least 260u each).
  - **Preview** (`label`, weight 600), a line in `body` `ink-secondary` ("Six weeks, Mon 21 Dec to Sun 31 Jan. Week 6 is lighter."), then the ProgrammeGrid as the start preview: every week still to come, no week framed, no `tile`, no buttons. It follows each field as it changes.
  - **Cancel** (secondary) and **Start programme** (primary) at the end. Cancel closes the box and the entry's actions come back. Start programme starts the run and opens its overview. Only one programme is open at a time.
- **Add:** **Programme JSON**, TextArea's box seven lines tall in `body` at 17u, its hint "Paste a programme in the tracker-programme/1 format, or choose a file. Claude can add one for you through your connection." Then **Choose file** (secondary, Lucide `upload`) and **Check and add** (primary), which sends the text to the validator and adds the programme when it has no problems.
- **The validator's problems** (spec §3.4) show between the box and the buttons: an InlineMessage (error) with the count in words ("This programme has three problems. Fix them, then check it again."), then one line each in `caption`, its JSON path first in weight 600 and a colon: "**activities[2].weight.rate:** a progression has add or rate, not both." The box's border turns `error-ink`. The text the person pasted stays as it was.
- **Offline,** Preview and start, Duplicate, Delete and Check and add are disabled, with one InlineMessage (info) at the top of the tab saying why (spec §11.2). The lists still show what was last synced.
- **Sizes:** the ItemPage's at u = 1: text 19u, names 22u, controls 60u (the library's actions 52u). **Folded**, the system's n sizes: text 18n, labels and names 16n and 18n, controls 48px.

## States

| State | Look |
| --- | --- |
| Started, a run running | "**Week 4 of 8.** Started Mon 23 Nov. Ends Sun 17 Jan." (`data-state="running"`) |
| Started, a run paused | "**Week 3 of 9.** Paused since Mon 7 Dec. A cold." (`data-state="paused"`) |
| Library | Each programme with its actions |
| A programme opened to start | The ink frame with the fields, the preview and Cancel and Start programme; its own actions hidden |
| Add | The box, its hint, Choose file and Check and add |
| Add with problems | The InlineMessage (error), one line per problem, the box's border in `error-ink` |
| Starting or checking | The pressed button keeps its label and gets `aria-busy="true"` |

## Accessibility

- Tabs as the card: `role="tablist"`, one tab stop, the arrow keys move between tabs, and the panel is labelled by its tab.
- Each run is one link, so a screen reader reads its name and its line together.
- Preview and start has `aria-expanded`; on opening, focus moves to Name, and Cancel returns it to Preview and start. The open box is a `group` labelled by the programme's name.
- The preview grid is the ProgrammeGrid's: a real table in a focusable, labelled scrolling box ("Preview").
- The problems are tied to the box with `aria-describedby`, the box has `aria-invalid="true"`, and the InlineMessage is `role="alert"`, so the count is read out when it appears.
- Contrast, measured by the gate in both themes: `ink`, `ink-secondary` and `error-ink` on `canvas` and `panel`, `control-border` and `focus` on `canvas`; `ink` on `canvas` for the open box's frame.

## For the app

`src/components/ProgrammesPage.vue` (W7). Test ids, as in the preview:

| Element | Test id |
| --- | --- |
| The page, Back | `programmes-page`, `back-to-week` |
| The tabs | `programmes-tab-running`, `programmes-tab-library`, `programmes-tab-add` |
| Started | `programmes-running`; each run `programme-run` with `data-state="running"` or `"paused"` |
| Library | `programmes-library`; each `library-programme` with `data-programme="<id>"`; its `library-start`, `library-duplicate`, `library-delete` |
| Opened to start | `programme-start`; `start-name`, `start-date`, each `start-param` with `data-param="<key>"`; `start-preview` (holding the `programme-grid`); `start-cancel`, `start-confirm` |
| Add | `programme-add`, `add-json`, `add-choose-file`, `add-check`; the problems `add-errors`, each `add-error` with `data-path="<JSON path>"` |

## You provide

From the server: the live runs (tracker, name, programme week and length, running or paused with the day and reason, the end day); the library (id, name, kind, weeks, activity count, description, and its parameters with label, unit and default); for a programme opened to start, the preview grid for the entered name, start day and parameter values, and the sentence over it; for Add, the validator's problems, each with its JSON path and sentence. Today's date from the server (the first start day allowed).
