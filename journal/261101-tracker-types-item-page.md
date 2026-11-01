# Tracker types and the item page

> Purpose: how Tracker gained a tracker-type registry, notes and details kept once per item, and a
> full page per item. What was decided, what broke on the way, and what is left.

## 1. The ask

John asked for two things on 2026-11-01. The exercise tracker should have types of tracker,
"exercise" and "food" today and perhaps more later. And pressing an activity's or a food's name
should open a full-screen view for adding details and notes about it.

His answers to the clarifying questions:

- Types as groundwork: keep the two sections, make the type a real concept in the data and the
  code, and put nothing new on screen.
- The page holds long notes, fields per type, history and the plan's settings, and stays flexible
  because he will iterate on it.
- Notes and details are one copy for every week. The plan stays a copy per week.
- Pressing a name always opens the page, in the week and in Edit plan. The pencil still opens the
  quick dialog.

The work ran as six units (W1 to W6) in one engineering-team run, in the worktree
`eng-tracker-types`, one lane, solo. Two more followed John's looks at it running: W7 (layout A)
and W8. On seeing layout A, instead of approving the ship, he asked: "in the item view, add an edit
view to choose which sections are shown and what order they are in. lets remove the details view,
for example."

## 2. Decisions

From the plan, approved by John ("Go"):

- **D1.** `section` stays the stored name (`exercise`, `diet`) and the type is an attribute of it.
  Nothing is renamed, because `section` is in URLs, the database, the cache and the outbox.
  Recorded as P25.
- **D2.** Details are one JSON document per item, `{notes, fields}`, keyed `(user, section,
item_id)`, with a revision like a plan's. The field list lives in the registry, and unknown
  field keys survive validation, so changing fields needs no migration. P26.
- **D3.** Notes move from plan items into details. Migration 7 lifts the latest week's note, and an
  export of version 4 or a `-v3` cache lift notes the same way. P26 amends K43.
- **D4.** The plan settings stay per week. The page edits the opened week's plan through the
  stores' own actions and says so.
- **D5.** The page is `#/item/<section>/<id>`, a page like Settings: no bar, Back to the week, focus
  back on the name.
- **D6.** A details write retries on a 404 rather than dropping, so a web image that lands before
  the API can't lose queued edits. P28.
- **D7.** Migration and export numbers are whatever is free at rebase. The parallel `/ask` session
  (PR #53, merged as 2199382) added no migration and no export change. The MCP endpoint (PR #54,
  0483c1a) merged first with migration 6 (`api_tokens`), so at the merge of `origin/main` this
  branch's steps became 7 (`item_details`) and 8 (`settings.item_sections`). Export version 5
  stayed ours.

Made during the build:

- **K64, layout B first.** John picked B of three on the mockup
  `brand/design-system/mockups/261101-item-page`, in his words "B. Notes as the page". The notes
  filled the wider left column (1.5fr) a step larger, and the plan, Recent weeks and Details
  stacked on the right (1fr). A met week's count in Recent weeks is `pen`, underlined. W4 and W5
  built B. K65 replaced its layout.
- **K65, layout A, rows like Settings.** With B built, John looked at the mockup again: "i want to
  choose option A (rows like settings)". The page is now four rows, each heading in the week's
  320u name column: Notes, Details, This week's plan, Recent weeks. The notes read at the page's
  text size, as option A drew them, and `--item-notes` is gone. Folded, one column in the same
  order. W7 made the change.
- **K66, arranging the sections.** From the mockup `261101-item-sections`, John picked "A. Arrange
  on the page (Recommended)", "Each type (Recommended)", "With your account (Recommended)" and, for
  Details, "Start shown" (the mockup started with Details hidden). An "Arrange sections" quiet
  Button at the head's right puts the page in arranging: each section's heading over a Switch,
  "Show", and Move up and Move down, with "Shown" or "Hidden" beside it. Changes apply at once, to
  every page of the type, and the button reads "Done".
- **P29, the `itemSections` setting.** `{<type id>: {order, hidden}}`, normalised the same way in
  both languages through `fixtures/item-sections/normalise.json`, stored in
  `settings.item_sections` (migration 8). Reading drops a type the registry lacks.
  `PUT /api/settings` refuses a shape the app never sends with 400 `invalid`, and keeps the saved
  value when the key is missing, so a tab on older code can't reset it.
- **Recent weeks counts every mark** (K65). John: "count every mark because red is still a "done"
  mark. its just says "this was very difficult"". It already did; the RecentWeeks card now says
  so.
- **P27.** An empty details document is stored rather than deleted, so its revision keeps counting
  and a device holding an older copy still conflicts. W2 asked for it to be recorded.
- **First field lists.** Exercise: Equipment, Works, Link. Food: A serving, Examples. Plain text,
  and Link shows "Open youtube.com in a new tab" when it holds a web address.

Calls the cards made beyond the mockup, listed in the mockup README for John to see at the local
preview:

| Mockup                                | Cards and app                                   |
| ------------------------------------- | ----------------------------------------------- |
| rounder `ink` pills beside the name   | the Chip card's chips                           |
| a Stepper for the plan's Sets         | a TextField, as in the Edit dialog              |
| a marked day's box in `ink-secondary` | `control-border`, as DayMark draws it           |
| the Link field's text underlined      | "Open youtube.com in a new tab" under the field |
| figures in the line over Recent weeks | words, "three of the last eight weeks"          |
| "Edit notes" only                     | "Add notes" when there are none                 |
| A's 30u marks and 130u "when" column  | the RecentWeeks card's 24u marks, column to fit |

New copy for John to approve at the preview:

- "These notes are too long to save. Shorten them, then save again." The dialogs and the page show
  it for notes under 20,000 characters that pass 32 KB.
- "These details are too long to save. Shorten them or the notes, then save again." The page shows
  it for a field that fits while the whole document doesn't.
- "An item's notes or details were changed on another device, so this device now shows that
  version." This is the conflict notice.
- "…plus the notes and details of two items…" in the import summary.

## 3. Progress by unit

- **W1, the registry.** `src/lib/trackerTypes.ts` and `api/src/tracker_api/types.py`, held in step
  by `fixtures/types/registry.json`. The cycles and `exerciseDetails` moved into the registry, and
  `sync.ts`, `data.py` and `validate.py` read their sections from it. No behaviour changed, and
  the existing suites passed unchanged.
- **W2, details in the API.** Migration 7, built as 6 (`item_details`, no section CHECK, the note
  backfill),
  `normalise_details`, `PUT /api/details/{section}/{item_id}`, details in `GET /api/state`, the
  quota counting details bytes, and export version 5 with the version 4 lift. It left 29 web tests
  red on purpose (`transfer.spec.ts` and two `App.spec.ts` cases), for W3 to match the fixtures.
- **W3, details in the app.** `src/stores/details.ts`, the cache and outbox at `-v4` with `-v3`
  moved and its notes lifted, the `details` operation with a 1 s pause after typing, conflict
  adoption with its notice, the 404 retry, `send()` as an exhaustive switch, export version 5 in
  the app, and the row and the dialogs reading and writing details.
- **W4, the cards.** The ItemPage and RecentWeeks cards and the WeekGrid card's name-as-link
  states, with K64 in `docs/decisions.md` §4.14 and the gate passing with 33 cards.
- **W5, the page.** `ItemPage.vue`, `RecentWeeks.vue`, `src/lib/history.ts`, `src/lib/routes.ts`,
  `src/composables/itemSource.ts`, the route in `App.vue`, the name as a link in `TrackerRow.vue`,
  Enter on a name in `gridNav.ts`, the style guide sections, and `e2e/item-page.spec.ts`.
- **W6, docs and preview.** The architecture, API, deployment, development and brand docs and the
  README describe what shipped, and P25 to P28 are in `docs/decisions.md` §3.1. `seed-demo` now says
  what details it added (below).
- **W7, layout A.** `ItemPage.vue` moved from B's two columns to four rows like Settings, in the
  order Notes, Details, This week's plan, Recent weeks. The plan's SegmentedControls no longer
  take a row of their own, and the plan's and details' columns are at least 300u wide. The
  ItemPage card and its preview, the RecentWeeks card, the mockup README, K65 and the docs
  followed. The unit test for the section order failed against B first, then passed.
- **W8, choosing and ordering the sections.** `src/lib/itemSections.ts` and
  `api/src/tracker_api/item_sections.py` with their shared fixture; migration 8; `itemSections` in
  `PUT /api/settings`, the state, the export and the import; the planner store's `itemSections`,
  `arrangementFor` and `setArrangement`, synced as a settings operation; the Switch's `context`
  (words for its name only, "Show Notes"); the IconButton's look at an `aria-disabled` end; and the
  arranging state in `ItemPage.vue`. The ItemPage, Switch and IconButton cards came first. Each
  behaviour's test failed before its code: the normaliser on both sides (the Python test against a
  missing module, the web spec against a missing one), migration 8 (built as 7: `user_version` 6,
  not 7), the settings route (13 API cases, among them every malformed shape answering 200), the
  store (adopt, save, the settings body and the diff), the export, the Switch's hidden words
  ("ShowNotes" before the space was fixed), the IconButton's classes, and eight ItemPage cases
  (the button, the order, Show, the moves and focus, Escape, every section hidden). The e2e flow
  and the axe checks were written after the page and passed on their first run.
- **The merge of `origin/main`** (PRs #53 and #54). Main's `api_tokens` kept migration 6; this
  branch's steps became 7 and 8, and `test_db.py` finds each step by its SQL and checks the
  numbers. Main's P20 to P24 (the MCP endpoint) kept their numbers too, and this branch's became
  P25 to P29 in `docs/decisions.md` §3.1 and everywhere that cites them. Main's REST checks (`check_item_id`, `Invalid`) now guard the details route too, beside
  a new `check_details_body`. Two adaptations to notes living in details:
  - `insights.py` reads each item's notes from its details (`data.notes_of`), the same in every
    week, still cut to 500. Its tests failed first: every reader gave `""`, since plan items no
    longer carry notes. `fixtures/insights/carry-forward.json` holds the note as details now, and
    both suites check it, the web one through the details store.
  - The MCP `note` argument writes the item's details (`data.set_notes_locked`), in one
    transaction with the plan write, up to 20,000 characters as the item page allows. A note alone
    writes no plan, so it copies no week. Results show each item with its note. Its tests failed
    first: the note was dropped by the plan normaliser and never reached `item_details`.

## 4. Issues found, and what happened to each

The evaluation listed nine findings before the build:

- **F1, notes were per week.** Each week's copy of an item carried its own note, so an edit on one
  week missed every week with its own plan. Fixed by D2 and D3. Tests reproduced it first: in the
  API, in the details store and in the mounted app.
- **F2, unknown operations went out as settings.** `send()` treated anything that wasn't a plan or
  a tick as a settings write. It is now a switch with a branch per kind, and an unhandled kind fails
  to type-check (`unhandled(op: never)`).
- **F3, `plans` and `ticks` CHECK the section.** A new section there still needs a table rebuild.
  Left alone on purpose, and `item_details` has no such CHECK.
- **F4, the quota didn't see new tables.** `usage()` now adds the details' bytes.
- **F5, the outbox whitelist.** `isQueued` accepts `details` with a registry section and an item
  id the API can name.
- **F6, conflicts adopted plans only.** Details conflicts now adopt the server's copy, `{}` reading
  as cleared and null as never stored.
- **F7, routing knew only Settings.** `App.vue` routes `#/item/…`, returns focus to the name, and
  drops the hash on sign-out.
- **F8, deploy order.** A web image landing before the API would have dropped queued details
  writes as refused. A 404 on a details write now retries and holds the outbox, and
  `docs/deployment.md` §3.1 says to deploy the API first.
- **F9, Enter on a name took two presses.** The link is now the name cell's widget, so Enter opens
  the page in one press, and F2 reaches the cell's other controls.

Found during the build:

- **W3's details store didn't update a page that read an item before its first details arrived.**
  `get` checked `Object.hasOwn` before reading the key, and Vue tracks only the read. W5
  found it and fixed it by reading the key first, with a test ("updates what reads an item's
  details when its first details arrive").
- **`seed-demo` printed "Nothing to add" when it only added details** (an account seeded before W2,
  whose weeks and marks were already there). W6 fixed it: `SeedResult` carries `details`, and the
  CLI prints "Added details for 2 items." A test that deletes the details and seeds again failed
  first, printing "Nothing to add: the demo weeks are already there.", and passes now.

## 5. Checks

Test counts before the run, after W5, after W6, and after W8:

| Suite            | Before | After W5 | After W6 | After W8 |
| ---------------- | ------ | -------- | -------- | -------- |
| API (pytest)     | 284    | 332      | 333      | 387      |
| Web (Vitest)     | 739    | 865      | 865      | 912      |
| e2e (Playwright) |        | 57       | 57       | 63       |

W8 ran the same checks: the API suite with coverage (99%, every new line covered), ruff, ruff
format, mypy, Vitest with coverage (99.93% of lines), `vue-tsc --build`, `npm run lint`,
`prettier --check src fixtures e2e`, the whole Playwright suite, and the design gate with
`--complete`. The cards' previews rendered at 375px with only the Cover overflowing.

W6 ran the API suite (333 passed, coverage 99%), ruff, ruff format and mypy, Vitest, and
`npx prettier --check src fixtures e2e`.

## 6. Follow-ups

- **SettingsPage preview heading sizes.** A review during the run found the heading sizes in
  `brand/design-system/project/components/SettingsPage/preview.html` off (verified, low). They are
  not changed here.
- **TextArea's count counts UTF-16 units** (`src/components/ui/text-area/TextArea.vue:38`, `.length`)
  while the notes' limit counts code points, so text with emoji shows a higher count than the limit
  measures.
- **"Latest plan" may pick a week after the opened week** (`src/lib/history.ts:38`):
  `latestPlanWith` takes the latest plan of all. The latest up to the week the page was opened
  from may be the better choice.
- **`main.css`'s page-size selector lists are long.** Each rule repeats the four-slot `:is(…)`, and a
  shared custom selector or a wrapper slot would shorten them.
- **A long note's popover with no link in it may not scroll from the keyboard.** Suspected, not
  checked: the panel scrolls with a pointer, but nothing in it takes focus.
- **The design system artifact** needs republishing with the ItemPage and RecentWeeks cards, and
  after W8 the Switch and IconButton cards.
- **The API deploys before the web again** (W8): an API from before migration 8 answers 200 to a
  settings write and drops `itemSections`, so an arrangement made against it lasts only until the
  next read. `docs/deployment.md` §3.1 says so.
- **The gate's `@dsCard` marker check misses a missing space** (`height=820subtitle=…`). Both
  slips, in the ItemPage and RecentWeeks cards, are fixed; the check itself is unchanged.
- **An MCP note write checks only the id's length** (`edits.py`), so an agent could set a note on
  an imported item whose id has a slash, which the app shows but can't edit. Rare.

## 7. Code review fixes (2026-11-01)

A code review of the branch found five problems. Each got a failing test first, then the fix.

1. **An offline note edit under the old app was lost on upgrade** (medium). `moveOldKeys` queued
   the lifted notes at rev 0, but migration 7 had already put the server's old note at rev 1. The
   write got a 409, and the app adopted the old note with a false "changed on another device"
   notice. Lifted writes are now marked `lifted`; a 409 at rev 1 sends them again at rev 1, so the
   device's copy wins. An item in a queued week with no note in the cache sends a cleared
   document, so an offline clear goes too. A newer edit before the send stays `lifted`. Red: the
   server kept `{notes: 'Old note'}` at rev 1.
2. **An item id the details route can't name stalled sync for good** (medium). A details 404 is
   retried (D6), and `a%2Fb` always 404s. `isDetailsId` (no `/`, not `.` or `..`) now guards the
   details store's setters, the `-v3` lift and `sendDetails`, which drops an old queued one as
   refused. The item page and both dialogs say "This item’s notes can’t be saved: its id has a
   slash in it." The API's details route refuses the same ids (`check_details_id`). The app never
   makes such an id; an import can. Red: `PUT /api/details/exercise/%2E%2E` answered 200.
3. **MCP agents couldn't read a long note in full** (medium). Every read cut notes at 500.
   `item_history` now returns the item's whole `notes`; the tool descriptions, `NOTE_HELP`, the
   `note` argument and the docs say to read it there before writing a note back. Red: `KeyError:
'notes'`.
4. **The edit dialogs wrote back an untouched stale note** (medium). Save now calls `setNotes` only
   when the text differs from what the dialog opened with. This also lets an item with a slashed
   id save its plan. Red: the dialog's `'Knees out'` replaced the adopted `'From the phone'`.
5. **A refresh within a second of typing skipped reading the server** (low). A read skipped while
   held details keep the outbox busy is now marked `readPending`, and runs after the held details
   are sent. Red: the last request was the details `PUT`, with no `GET /state` after it.

Checks after the fixes: Vitest 951 passed with coverage (99.93% of statements, 100% of lines),
`vue-tsc --build`, `npm run lint`, `npm run format:check`, Playwright 63 passed, the design gate
with `--complete`, the API suite 727 passed (coverage 99%), ruff, ruff format and mypy.

## 8. What is deliberately not done

- **No UI to add a tracker or pick a type.** Types exist in a registry (W1); a third tracker or a
  type of John's own is the next step, not this one.
- **No change to `plans` and `ticks` CHECK constraints** (F3). A new section still needs those
  tables rebuilt; `item_details` has no such CHECK.
- **Plans keep their old `notes` until next written.** The API ignores them on read; removing
  them would have meant rewriting every plan row in a migration for no visible gain.
- **No dragging to reorder sections.** Move up and Move down work by mouse, keyboard and screen
  reader; dragging could come later.
- **The missed mark's spoken words stay "couldn't do it"**, though John reads a red mark as "this
  was very difficult". Asked after this run, not changed in it.
