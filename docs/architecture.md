# Architecture

> Purpose
>
> How the planner is put together: the component tree, the Pinia stores, how data syncs with the
> API and what stays in `localStorage`, the decisions that depart from the design prototype, and
> how the design system reaches the screen.

## 1. Overview

A Vue 3 SPA with accounts. The API service in `api/` ([api.md](api.md)) holds each user's data, and
the app syncs with it through the same origin (§7). Two Pinia stores hold what the app shows:
`planner` (exercise plans, the log, the visible week, settings, the mode) and `diet` (food plans and
their log), which takes its week from `planner`. Two more run the account: `session` (who is signed
in) and `sync` (the per-user cache, the outbox of unsent writes, and reads). Both data stores track
the same thing, a mark per day against a weekly goal, through the pure helpers in
`src/lib/tracker.ts`. `src/lib/words.ts` writes
small counts as words: `numberWord` ("two", or "Two" to open a sentence, figures from 11 up) and
`countOf` ("one change", "two changes"). `src/lib/plans.ts` decides which week's plan a week
shows; `src/lib/dates.ts` holds the week maths (Monday of a week, `YYYY-MM-DD` keys and back,
labels, `DAY_NAMES`); `src/lib/theme.ts` holds the theme names and `isDark`. The planner's screens
(§6.6) use `src/lib/screens.ts` (a section's screen classes), `useScreenSprint`
(`src/composables/screenSprint.ts`, never resting across two screens), `useBarReveal`
(`src/composables/barReveal.ts`, the navbar out of sight) and `useFullscreen`
(`src/composables/fullscreen.ts`, the browser's full screen).

Every screen is built from the primitives in `src/components/ui/` (§6.3), which follow the design
system's cards ([brand.md](brand.md)). `TrackerGrid` and `TrackerRow` (on the `DayMark`, `Chip`
and `IconButton` primitives) take props, emit events, and serve both sections.
`TrackerGrid` runs the grid's keyboard model (`useGridNav`, §6.5). `TrackerRow` asks the
`ConfirmDialog` (through `useConfirm`, §6.4) before emitting `remove`, and names where focus goes
once the row has gone. `ExerciseGrid` and `DietSection` wire them to their store. `EditExerciseDialog` (which also adds an exercise when given none, K54) takes its field
state and input cleaning through `useExerciseForm` (`src/composables/exerciseForm.ts`) and the
`PerSideToggle` segmented control. `src/lib/problems.ts` turns a sign-in, sign-up, link or
sign-out refusal into a sentence for the forms; `src/composables/importSummary.ts` says what an import would add,
for Settings → Import… and the first-login prompt.

```
App.vue                 picks the screen (a link, planner, sign-up, reset or sign-in), the
│                       .dark class, clock refresh, sync triggers (focus, visibility, online, minute
│                       tick, storage), the planner-screens class (§6.6), and the one ConfirmHost
├── ConfirmEmail.vue    a confirm-your-email link (#/confirm/<t>), signed in or out: confirms it
├── PasswordForm.vue    an invite or reset link (#/invite/<t>, #/reset/<t>): choose a password
├── SignupForm.vue      #/signup: email and password twice; field and form-level refusals
├── ForgotForm.vue      #/forgot: an email; then the same words whether or not it has an account
├── LoginForm.vue       email and password; explains refusals; notes an ended
│                       session; links to #/signup, and to #/forgot where the API sends email
│   (all five inside AuthCard.vue: a centred Panel with the BrandMark)
├── AppNavbar.vue       the Header card: Skip to today, BrandMark, This week beside ‹ › and the
│                       week, then the BarActions Edit plan (a toggle), Settings (to the
│                       Settings page), Print… and Full screen (useFullscreen, where the browser
│                       has one); full width, sized by main.css's --bar-* (K47, K49, K50); on
│                       the planner's screens out of sight until wanted (useBarReveal, §6.6)
├── SettingsPage.vue    the SettingsPage card, at #/settings: Back to the week, then Appearance
│                       (Marks, then Theme, K59), Your data (Export and Import…, see §4) and
│                       Account (who is signed in, Sign out)
├── SyncStatus.vue      loading, offline and conflict Banners above the planner
├── EmailStatus.vue     "Confirm your email." Banner, with Send it again, until it is confirmed
├── ImportPrompt.vue    this browser's log from before accounts, offered once (§7)
├── WeekHeader.vue      the page's h1, the week ("19–25 October"), visually hidden on screen (each
│                       SectionHeader shows the week); set in display on paper
├── ExerciseGrid.vue    the Exercises section: SectionHeader (the title and the week; in config
│   │                   mode the title alone, with the Exercises a day Stepper centred on its line, K62)
│   ├── TrackerGrid.vue a <table> (WeekGrid card): day names, one TrackerRow per item, and
│   │   │               the days that met the daily pick
│   │   └── TrackerRow.vue  name and chips on one line, the note under them
│   │                       (a button opening a Popover, K43); 7 × DayMark; in config
│   │                       mode the edit IconButton after the name, and the remove
│   │                       IconButton in a last cell of its own
│   └── EditExerciseDialog.vue  Dialog: Name; sets, Measure (Reps or Time), reps or seconds;
│                           PerSideToggle, weight (kg), Times a week (the goal); then Note (K55);
│                           Edit exercise, or Add exercise from the button under the grid (K54)
└── DietSection.vue     the Food section: SectionHeader (the title and the week; in config mode
                        the title alone, with the Foods a day Stepper centred on its line, K62), kept
                        with its grid, whose days that met foods a day turn green (K57); on the
                        screens, the "Back to Exercises" arrow (K42)
    ├── TrackerGrid.vue wired to diet: no chips
    └── EditFoodDialog.vue  Dialog: Name, Times a week (the goal), then Note; Edit food, or
                            Add food from the button under the grid (K54)
```

## 2. Weekly plans

Each week has its own **plan**: the exercises (with sets, reps or a duration, per-side, weight and goal) and the
foods (with goals). Ticks live in a separate **log**, keyed by week and item id.

- **Carry forward.** A week without a plan of its own shows the plan of the latest earlier week that
  has one (`planSource` in `src/lib/plans.ts`); weeks before the first plan show the earliest one,
  and with no plans at all the stores show the defaults. The API's `insights.py` ports this rule,
  the defaults and the goal and met-day rules, and the shared cases in `fixtures/insights/` keep
  the two in step ([api.md](api.md) §1.1, §9).
- **A week gets its own plan when it first changes**, ticks included: the store copies what the week
  shows into `plans[week]` and edits that copy (`own()`). Until then, an unplanned week follows its
  source, so changing this week's plan also changes the weeks ahead that haven't been touched.
- There is no "Copy plan to next week" any more (K58): carry-forward already gives an untouched
  week the latest plan, and a week with its own plan changes by editing it.
- Items keep their ids when copied, so a week's ticks stay attached to the same exercise or food.
  Removing an item from one week leaves weeks with their own plan alone; its ticks stay in the log,
  uncounted.

## 3. Stores

`usePlannerStore` is a setup store.

| State                             | Kept by                                   | Notes                                                                              |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `plans`                           | the sync store: server and per-user cache | week → `{ id, name, sets?, reps, duration?, perSide?, weight?, target, notes? }[]` |
| `log`                             | the sync store: server and per-user cache | week Monday `YYYY-MM-DD` → exercise id → seven marks (`Days`, below)               |
| `accent`, `dailyPick`, `foodPick` | the sync store: server and per-user cache | defaults `#30d158`, `3` and `2`. The accent is kept but draws nothing (K13)        |
| `theme`                           | `tracker-settings-v1` (the device)        | `system` (default), `light` or `dark`                                              |
| `markSet`                         | `tracker-settings-v1` (the device)        | `squiggles` (default), `ticks`, `stamped-ticks`, `faces`, `stamped-faces`          |
| `configMode`                      | no                                        | `false` (normal mode) on every load                                                |
| `weekOffset`                      | no                                        | `0` is the current week                                                            |
| `now`                             | no                                        | a ref so "today" can move; see §5                                                  |

The stores start empty (showing the defaults) and never write the user's data themselves. The sync
store fills them with `adopt` and saves their changes (§7).

**Derived:** `monday`, `weekKey`, `currentWeekKey`, `label`, `days` (`name` "Thu",
`date` "22", `full` "Thursday 22 October" for the DayMarks' names, `key`, `isToday`, and
`isFuture` for days still to come), `exercises` (the visible week's plan, see §2), `dayCounts`,
`grandTotal`, and the helpers `isDone(id, day)` and `totalFor(id)`. Totals count only the week's
exercises, so a removed exercise's history stays in `log` without inflating the numbers.

**Actions** (plan edits apply to the visible week only): `toggle`, `changeTarget` (clamps 0–7),
`addExercise` (returns `false` for an empty name; new exercises get goal 3 unless the input
names one), `updateExercise` (replaces name, sets, reps or duration, per-side, weight and, when
given, the goal, keeping the id and history; `false` for an empty name or an id not in the week).
An exercise counts reps or time, never both: a duration stores reps as 0. Then `removeExercise`, `setConfigMode`,
`prevWeek`, `nextWeek`, `thisWeek`, `refreshNow`, `changeDailyPick` and `changeFoodPick` (each
clamps 1–8), `setTheme`, `savedSettings` (the accent and both daily picks, or null while the user
has none of their own), `adopt`
(replace the data and settings wholesale), `adoptWeek` (replace one week's plan) and `clear` (forget
the user on sign-out, keeping the theme). The module also exports `exerciseDetails`, which gives the chips after a name, on its line (K43):
"3 × 12" or "3 × 8 each side" (or "10 reps a set" and "8 each side" without sets, "3 sets" without
reps), "3 × 45 s" or "1 min 30 s each side" for a timed exercise (`durationText` in
`src/lib/words.ts`), then "16 kg" when weighted, and no chip at all for none of these (the Chip
card's words).

`useDietStore` holds `plans` of foods (`{ id, name, target, notes? }`) and its own `log`, kept by the sync
store like the planner's. It reads `planner.weekKey`, so week navigation moves both
sections. It derives `foods`, `dayCounts`, `grandTotal` and `goalsMet`, and
offers `isEaten`, `totalFor`, `toggle`, `changeTarget` (0–7), `addFood` (a name, or a name with
its goal and note from the Add food dialog; goal 3 when none is given, `false` for an empty name),
`updateFood` (name, goal and note from the Edit food dialog, `false` for an empty name or a food
not in the week), `removeFood`, `adopt`, `adoptWeek` and `clear`. Food goals work
like exercise goals (met once the count reaches a non-zero goal). The daily target, foods a day,
is the planner store's `foodPick`, with the other settings (K57).

The planner writes only the theme and `markSet`, each merged into whatever
`tracker-settings-v1` already holds.
`writeKey` skips the write when the stored string already matches, and swallows storage errors, so
with storage blocked or full the app keeps working in memory.

## 4. Storage format and validation

| Key                                            | Holds                                                                           | Written |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| `tracker-session-v1`                           | `{ user }`: the last signed-in user                                             | yes     |
| `tracker-cache-v3:<user>`                      | the user's state as `GET /api/state` returns it, with `revs`                    | yes     |
| `tracker-outbox-v3:<user>`                     | writes not yet sent (§7)                                                        | yes     |
| `tracker-import-v1:<user>`                     | the first-login prompt's answer, `imported` or `dismissed` (§7)                 | yes     |
| `tracker-settings-v1`                          | `theme`, read before first paint by `public/theme-init.js`, and `markSet`       | both    |
| `tracker-cache-v2:<user>`, `-outbox-v2:<user>` | the cache and outbox from before the solid and hatch drawings; moved at sign-in | never   |
| `tracker-cache-v1:<user>`, `-outbox-v1:<user>` | the cache and outbox from before marks had kinds; moved at sign-in (below)      | never   |
| `tracker-v2`, `-diet-v2`                       | exercise and food `{ plans, log }` from before accounts                         | never   |
| `tracker-v1`, `-diet-v1`                       | the single-list format from before weekly plans                                 | never   |

Since accounts, nothing writes the keys from before them. They stay because they hold what a browser
recorded locally, which the first-login import (§7) reads with the parsing, migration and
validation below (`readLegacyData`, `src/lib/legacy.ts`). Signing out does not remove them. Browsers isolate storage per origin, so a cache belongs to
one origin and one user.

**The renames.** Every key began `exercise-planner-` until 2026-10-24, then `fitness-planner-`
until 2026-10-26, when the app became Tracker (K44). `migrateKeyPrefix` (`src/lib/storage.ts`),
called from `src/main.ts` before the stores start, moves each key under an earlier name to its
`tracker-` name, newest name first, outbox included, so unsent writes survive. A value already
under the new name wins (so a `fitness-planner-` copy beats an `exercise-planner-` one), and a copy
that fails (storage full) leaves the old key for the next load to retry. `public/theme-init.js`
runs before that, so it reads the old settings keys when the new one is absent. The sync store's
earlier cache versions (`OLD_CACHE_PREFIXES`) are named under `tracker-`, since the move has run by
sign-in.

**The cache and outbox took new names with the marks** (K14 in [decisions.md](decisions.md)). A tab
left open on the code from before the marks reads `"great"` as an empty day, and on another tab's
`storage` event it adopted the cache and wrote it back with every box empty, which the newer tab then
adopted in turn: a press flickered and left the box empty, though the server kept the mark. It could
also drop the newer tab's queued marks from the shared outbox. Under the `-v2` names the two never
read each other. At sign-in `start` walks the old names newest first (`OLD_CACHE_PREFIXES`,
`OLD_OUTBOX_PREFIXES`): it moves this user's cache from the newest one that has it (unless one under
the current name already exists, which is newer), merges each old outbox in, the newer write
winning for the same cell, then deletes the old keys; signing out deletes them too.

The solid and hatch drawings (#38) added mark values without a new version, so a tab left open on
the code before them emptied every solid or hatch day in newer tabs, the same way. The names went
to `-v3` on 2026-10-26 (K41). `src/lib/__tests__/format.spec.ts` now records what each version
stores (the marks, and the fields an exercise and a food keep) and fails when the stored format
changes under the same names.

**Migration.** Before weekly plans, one list served every week: `{ exercises, log }` under
`tracker-v1` (the design prototype's shape, under its key renamed) and `{ foods, log }` under
`tracker-diet-v1`. When a v2 key is missing and its v1 key exists, `parsePlannerData` and
`parseDietData` convert it: the list becomes the plan for every week in the log and for the current
week, so every week looks as it did. A v2 value that is not a JSON object also falls back to
migrating v1 (or to nothing without one). Before accounts, the stores saved the converted result as
v2; now the conversion only feeds the import.

`parsePlannerData` (`src/lib/storage.ts`) validates field by field:

- Plans whose week key is not `YYYY-MM-DD`, or whose value is not an array, drop out.
- Items without a string `id` and `name` drop out; `reps` rounds and floors at 0; `target` rounds
  and clamps to 0–7, defaulting to 3.
- `duration` (seconds per set) is kept only as a whole number above 0, capped at 3600.
- `sets` is kept only as a whole number from 1 to 20 (larger values cap at 20); `weight` (kg) only
  as a positive number, rounded to 2 decimals and capped at 500. Otherwise the key is left out.
- `notes`, on an exercise or a food (K43), is kept only as a string, trimmed of spaces, tabs and
  line breaks at its ends and cut to 500 characters, counted as code points so the API's Python
  agrees (`normaliseNotes`). A blank note is left out. The row renders it with `src/lib/markdown.ts`
  (markdown-it, raw HTML off, no images, headings, tables or rules): one line of inline formatting
  in the row, where a link is its underlined text, and the whole note in a Popover, where links
  open in a new tab with `rel="noopener noreferrer"`. The note is edited in the Edit exercise and
  Edit food dialogs; an update that leaves `notes` out keeps the note, and an empty one clears it.
- Log weeks whose key is not `YYYY-MM-DD`, and entries that are not arrays, drop out; the rest
  normalise to exactly seven days (`normaliseMark`): `"great"`, `"partial"` and `"missed"` stay,
  a `true` from before marks had kinds reads as `"great"`, and anything else is an empty day (`null`).
- When migrating, a v1 payload that is not a JSON object, or whose list is not an array, yields the
  defaults; an empty list stays empty. The prototype trusted its stored data and crashed outright on
  a payload without `log`.

`parseDietData` applies the same rules to foods, with four default foods (Vegetables 7, Fruit 5,
Fish 2, Nuts 3).

`parseSettings` accepts any `#rrggbb` accent (K3a, K13), clamps the daily pick to
1–8, accepts only `system`, `light` or `dark` as the theme and only one of `MARK_SETS` as the
mark set, falling back to the defaults otherwise. Settings saved before the theme option existed
load as `system`, and before the mark set existed as `squiggles`.

**Export and import.** Settings → Export downloads `tracker-YYYY-MM-DD.json`:

```json
{
  "format": "tracker-export",
  "version": 4,
  "exportedAt": "2026-10-24T09:30:00.000Z",
  "exercise": { "plans": {}, "log": {} },
  "diet": { "plans": {}, "log": {} },
  "settings": { "accent": "#30d158", "dailyPick": 3, "foodPick": 2 }
}
```

The theme is not exported, because it belongs to the device rather than the person. Import… reads a
file through `parseExport` (`src/lib/transfer.ts`), which rejects anything that is not JSON, has
another `format`, or has a `version` other than 1 to 4 (a version 1 file's `true` days read as
`"great"`, K12; version 4 added notes, K43). Files exported under the earlier names carry
`"format": "fitness-planner-export"` or `"exercise-planner-export"` and import the same way
(`OLD_EXPORT_FORMATS`, in both languages). It validates the rest with the same normalisers
as storage, so a hand-edited file loads the way a hand-edited `localStorage` value would. Missing
`settings`, or settings that are not an object, mean "no settings".

An import **merges and never deletes** (`mergeTracked`, `mergeSettings`; the API's `import_data`
applies the same rules):

- A week that already has a plan keeps it; a week with no plan takes the file's.
- Per week, item and day, a marked day keeps its mark and an empty one takes the file's, so an
  import can add marks but never clears or changes one.
- The file's accent and daily pick apply only when the account has no settings of their own yet.

Confirming sends the file to `POST /api/import` (`sync.importFile`): the server merges it against
the account's real state in one transaction, and the app then reads the account afresh (after any
read already in flight, which predates the import). Local writes still queued go out first, so the
server merges against everything this device has; if they cannot be sent, nothing is imported. When
the import cannot be done, the Settings page says why (offline, a server failure, an ended session,
a full account) and
keeps the file ready to try again. The confirm step names how many weeks and marked days the file adds
(`mergeSummary`, through `useImportSummary`, which the first-login prompt shares) before anything
is written. It is computed from the current state, so it stays right if another tab or a settings
change lands while it is open. Importing the same file twice adds nothing the second time. Adding a week can change what
an unplanned week carries forward from (§2). The import took its history from the file, so that is
the intended result.

`fixtures/transfer/` holds the parse and merge cases as JSON, each with its expected result.
`src/lib/__tests__/transfer.spec.ts` runs every case. The format is the contract for the API's
import and export as well: the API's tests (`api/tests/test_parity.py`) run the same files.

## 5. Decisions beyond the design

- **Cells are buttons.** The prototype's cells were clickable `div`s. Each day is a `DayMark`: a
  `button` with `aria-pressed` and a name such as "Squats, Friday 23 October, today" (today also
  carries `aria-current="date"`), so the grid works from the keyboard and with a screen reader. The
  grid is a `<table role="grid">` with `row`, `columnheader`, `rowheader` and `gridcell` roles, and
  one tab stop (§6.5).
- **One screen per section, not a window.** The handoff drew the app as a macOS window (traffic
  lights, a framed window on a backdrop). The app fills the browser instead: Exercises and Food are
  a screen each, the page sprints between them, and the navbar keeps out of sight until it is
  wanted (K24, K25; §6.6). Edit plan is an ordinary page with a sticky navbar (K27), full
  width at the week's sizes with rows a fixed 100u (K54). Settings has no navbar (K52) and is full
  width in rows like the week (K51). The navbar keeps the week controls, This week, Edit plan,
  Settings, Print… and Full screen.
- **Light and dark themes.** The handoff is dark-only. Settings offers System (the default, which
  follows `prefers-color-scheme` live), Light and Dark. `App.vue` toggles a `dark` class on
  `<html>`; `public/theme-init.js` applies the saved choice before first paint so a dark preference
  does not flash light while the bundle loads. It is a plain file rather than an inline script
  because the nginx CSP allows scripts only from `'self'`.
- **Settings page.** The handoff calls accent and daily pick user settings but shows no UI for
  them. Settings started as a popover and became a page of its own (`SettingsPage.vue`, at
  `#/settings`) so it has room to grow. App reads the hash (as it does for invite and reset links)
  and shows the page in place of the week, without the Header (K52). Arriving moves
  focus to the page's heading, and coming back to the week puts it on the Settings button. Signing
  out there drops the hash, so the next sign-in opens on the week. The marks' pens are fixed, so
  there is no Ink setting (K10). The theme and per-side choices are SegmentedControls: `aria-pressed` buttons in a
  `role="group"`. Marks is a RadioCard (a `radiogroup` of `role="radio"` rows), each row showing
  its set's three marks with `DayMarkDrawing`, the mark without its button (K20).
- **Config mode and normal mode.** Normal mode, the default on every load, only marks cells. The
  "Edit plan" BarAction in the navbar (a toggle button with `aria-pressed`, filled while on; K48)
  turns on config mode, which shows the
  edit and remove IconButtons, an "Add exercise" and an "Add food" button under the grids, and
  the daily targets centred on each title line, under the bar's week: a Stepper at max(44px, 40u)
  reading "4 per day", its label ("Exercises a day", "Foods a day") for a screen reader only
  (K56, K62, K63). The week beside the titles is left out there. An item is added and changed only in its
  dialog (Add or Edit exercise, Add or Edit food; K54), so rows have no Stepper; the remove button ends each
  row, in a "Remove" column after the days. The mode is not saved, so the
  app always opens ready for ticking.
- **Exercises and foods are editable.** The handoff had no way to change an item after adding it.
  An Edit IconButton (`pencil`) on each exercise row opens `EditExerciseDialog` (and on each food
  row `EditFoodDialog`: name, Times a week and Note), on the Dialog primitive (Reka UI),
  which traps focus, closes on Escape and returns focus to the button. Sets and
  weight can be left empty (an empty weight shows a grey "Bodyweight" placeholder; no field is
  marked optional), weight in kg; the sets/reps chip and the weight chip are separate so they
  wrap in the narrow name column.
- **Steppers mark their bounds** (goal 0/7, daily pick 1/8) with `aria-disabled` and ignore the
  click there. `disabled` would drop keyboard focus mid-press. The store still clamps as a backstop.
- **Today refreshes.** A one-minute tick and `visibilitychange` both call `refreshNow`, which
  updates `now` only when the date has changed. A tab left open past midnight moves today (its tab
  stop and screen-reader name) within a minute.
- **Export and import live in Settings.** Before accounts, data lived in one browser and the export
  file was the only way to move it or back it up. It is still each person's own copy of their data.
  Import is additive by design: restoring an old backup over newer data cannot lose the newer
  data.
- **Tabs stay in sync** through `storage` events on the user's cache key: a tab adopts another tab's
  state instead of overwriting it, and their writes share one outbox (§7). The plan had proposed a
  `BroadcastChannel`; the cache already lives in `localStorage`, whose events carry the same news
  with no second channel to keep in step.
- **Food is the screen after the exercises**, sharing the week navigation and the print sheet.
- **No Picked row, no dates in the header** (K28, K29): the grids show each day by its name alone,
  and nothing counts a day against the daily pick. A day that reaches it turns green instead
  (K30): `ExerciseGrid` passes `metDays` to the grid, which draws the day's name in `pen`,
  underlined (K60). The rule is `metDays` in `src/lib/tracker.ts`: a day is met when the items
  marked on it reach the day's target. The day names are max(20px, 27u), the rows' name size. `DietSection` does
  the same against foods a day (K57). Both picks are stored, synced and exported (`dailyPick`,
  `foodPick`). The sections have no weekly figure (K31), Settings no totals switch (K32), and the grids no Week
  column (K33). The Header has a Full screen button where the browser supports one (K34).
- **Print is the light theme on white paper, from either theme** (§6.7).
- **Narrow screens.** Folded (held upright under 1000px wide, or under 760px wide), the navbar
  puts the week across its first row (by CSS order) and shares its second row equally among the
  BarActions, This week first when shown; the
  bar leaves the wordmark out there (no monogram, K44). Below 640px it drops Print…. The markup keeps the desktop order, which is the
  tab order. Held upright under 1000px wide,
  or on any screen under 760px wide, the grids fold (K26): each row's name line spans the seven
  days above its boxes, so nothing scrolls sideways down to 320px. A phone opens on the week, like
  every other screen. This supersedes the phone's Today list and the sticky name column (K5).

## 6. Styling and the design system

Tailwind CSS 4, through `@tailwindcss/vite`, on the design system in `brand/design-system/`
([brand.md](brand.md)). Components style themselves with utility classes in their templates and
have no `<style>` blocks. Everything global is in `src/styles/main.css`.

### 6.1 Tokens and roles

- **Generated tokens.** `npm run tokens` writes `src/styles/tokens.css` from
  `brand/design-system/project/tokens.json` (through `scripts/design_preview.py --tokens-css` with
  `--dark-selector .dark`) and drops the generated `@font-face` rules. It holds every role's light
  value on `:root` and dark value on `.dark`, spacing, radius, the font
  families and the type-style classes. Nobody edits it by hand, and `.prettierignore` keeps
  Prettier off it, so a regeneration diff is always the tokens' own change.
- **Role utilities.** `main.css` imports Tailwind, then `tokens.css` into Tailwind's `components`
  layer (above the theme, below the utilities), then maps each role to a
  Tailwind colour in `@theme inline` (`--color-canvas: var(--canvas)`). Templates write
  `bg-canvas`, `text-ink-secondary` or `border-control-border`, and both themes follow without
  `dark:` variants. The roles are `canvas`, `panel`, `tile`, `line`, `control-border`, `ink`,
  `on-ink`, `ink-secondary`, `error-ink`, `focus`, `pen`, `pen-partial`, `pen-missed`,
  `caution-ink` and `scrim`.
- **No palette.** `--color-*: initial` switches Tailwind's default colours off, keeping only
  `transparent` and `current`, so a palette class such as `bg-red-500` or `text-white` generates
  nothing. Every colour on screen comes from a role.
- **Dark variant.** `@custom-variant dark` keys `dark:` to the `.dark` class rather than the media
  query, so the Light and Dark settings can override the OS. `public/theme-init.js` sets the class
  before first paint, and `App.vue` keeps it in step afterwards.
- **Type.** The type-style classes (`display`, `title-1`, `title-2`, `body-large`, `body`,
  `caption`, `label`, `note`) come from `tokens.css`. `main.css` adds the note's italic and the
  smaller `display` below 640px, in the same layer, so a utility beside a type class wins. One
  block is unlayered on purpose: the Settings page's and the dialogs' page sizes (K51, K55),
  scoped to `:is([data-slot='settings-page'], [data-slot='dialog'], [data-slot='confirm-dialog'])`
  and keyed on the primitives' `data-slot` names, so it beats their fixed utilities there and
  nowhere else. Numbers use `tabular-nums`. The fonts are the Fontsource variable
  packages, imported in `src/main.ts` so Vite bundles them under `/assets/` (the CSP allows only
  `'self'`), with the latin files preloaded in `index.html`.
- **Shape, focus and scroll.** `rounded-sm`, `rounded-md` and `rounded-lg` follow the radius tokens,
  and `shadow-overlay` is the one shadow. A global `:focus-visible` rule draws a solid 2px `focus`
  outline at a 2px offset on every interactive element. `scroll-padding-top` on `<html>` keeps
  keyboard-focused content from scrolling under the sticky navbar; on the planner's screens it is
  0, since the navbar is out of sight there.

### 6.2 The marks' pens

`pen`, `pen-partial` and `pen-missed` are ordinary roles with fixed values (K10), mapped to
`text-pen`, `text-pen-partial` and `text-pen-missed`. A mark is a kind with its drawing (`Mark` in
`src/lib/storage.ts`): `great`, `partial` and `missed` are the zigzag, and `-solid` or `-hatch` names
the others (K17); `markKind` and `markDrawing` read them back. For a marked day `DayMark` fills the
mark's drawing (`MARK_DRAWINGS`, traced outlines filled with `fill-rule: evenodd`) in its kind's pen
(`MARK_PENS` in `src/components/ui/day-mark`), then draws the box over it. The ink runs a little
past the box. The device's mark set (`markSet` in the planner store, passed to DayMark as `set`)
changes only the drawing (K20, K21): `markLook` gives the squiggle drawing, or a tick or face
symbol (`MARK_SYMBOLS`) stroked in the pen, or stamped: the solid drawing in the pen with the
symbol in `canvas` (in print, the light canvas). A press emits `toggle`; the stores step the day
with `cycleDay` and `nextMark` (`src/lib/tracker.ts`) over `cycleFor(item, markSet)`: in the
squiggles `EXERCISE_CYCLE` is every mark, drawing first, and `FOOD_CYCLE` the three green ones; in
a symbol set the plain kinds once (`EXERCISE_KIND_CYCLE`, `FOOD_KIND_CYCLE`). A squiggle drawing
there steps on from its kind.
`isDone` and the totals count every kind. [brand.md](brand.md) §4 has the values.

### 6.3 The primitives

`src/components/ui/<name>/` holds the shared components, one folder each with the `.vue` file and
an `index.ts`. They are shadcn-vue (K1): owned source on Reka UI, added with the shadcn-vue CLI
(`components.json`: the Lucide icon library, `src/styles/main.css` as the stylesheet) and restyled
to the tokens and the cards. `cn` (`src/lib/utils.ts`) merges a consumer's classes over a
component's own.

| Group    | Primitives                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basics   | Button (primary, secondary and quiet, 44px tall, `sm` 36px from 640px up), IconButton (44px, a required `label`), TextLink, BrandMark, BarAction (the Header's actions, K47) |
| Forms    | TextField, TextArea, SegmentedControl, Switch, Stepper, RadioCard                                                                                                            |
| Overlays | Dialog, ConfirmDialog with ConfirmHost, Popover                                                                                                                              |
| Planner  | DayMark, Chip, SectionHeader                                                                                                                                                 |
| Feedback | InlineMessage, Banner                                                                                                                                                        |

The other cards are composed in the screens: Header in `AppNavbar.vue`, Panel in `AuthCard.vue`
and `ImportPrompt.vue`, WeekGrid in `TrackerGrid.vue` and `TrackerRow.vue`, PlannerScreen in
`ExerciseGrid.vue` and `DietSection.vue` (the class lists in `src/lib/screens.ts`). Icons are `@lucide/vue` at a 1.5px stroke, `aria-hidden` beside words. A
primitive's colour transitions last 120ms at most, stop under `prefers-reduced-motion`, and name
the properties they animate, so the focus ring never fades in.

### 6.4 Confirmations

`useConfirm()` (`src/composables/useConfirm.ts`) asks a yes-or-no question and returns a promise:
true for the verb, false for Cancel or Escape. One `<ConfirmHost />`, mounted once in `App.vue`,
shows the open question in a ConfirmDialog (Reka's AlertDialog). A newer question answers an older
one false. `returnFocus` names where focus goes on closing when the control that asked has gone, as
after a removal. Removing a row (`TrackerRow`) asks this way. Sign out uses a ConfirmDialog of its own on the Settings page, because it shows the
unsynced count, a busy state and an error.

A question never outlives what it asked about. It is answered false when the component that asked
goes away, and `App.vue` closes any open question (`dismissConfirm()`) when the signed-in user
changes, as when another tab signs in as someone else. Remove also notes the week before
asking and do nothing if the week changed while the question was open (past midnight on Sunday).

### 6.5 Keyboard in the grids

Each grid is one tab stop, following the WAI-ARIA grid pattern with a roving tabindex
(`createGridNav` in `src/composables/gridNav.ts`, run by `useGridNav` from `TrackerGrid`):

- **The stop** starts on today's DayMark in the first row (`[aria-current="date"]`), else the first
  day, else the first cell, and then stays on the last cell focused. A `MutationObserver` keeps
  exactly one stop as rows come and go.
- **Keys.** Arrows move cell by cell over the names and days, and never
  wrap. Home and End go along the row, Ctrl+Home and Ctrl+End to the grid's ends. Space and Enter
  belong to the DayMark. An `aria-hidden` cell is skipped.
- **Edit plan.** The controls in a cell (Edit in the name cell, Remove in the
  last cell) stay out of the Tab order. Enter or F2 on the cell lets them in, Tab moves among them,
  and Escape puts focus back on the cell.

"Skip to today", first in the tab order in `AppNavbar.vue`, focuses today's first mark in the
first grid that has today. Tabbing to it brings the navbar into view on the planner's screens.

### 6.6 The planner's screens

`App.vue` puts `planner-screens` on `<html>` while the planner shows outside Edit plan (K27). That
class turns on main.css's `full:` variant. With it, each section is a screen (`SCREEN` in
`src/lib/screens.ts`: `min-h-dvh`, a centred column, and `data-planner-screen`) and its grid takes
the height left (`SCREEN_GRID`). `useScreenSprint` (`src/composables/screenSprint.ts`) keeps the
page from resting across two screens. A wheel or a fling sprints as soon as the line between two
screens is a step (4% of the window, at least 16px) inside it, while it is still moving (K45); a finger on the
screen waits until it lifts; a scrollbar drag or the keyboard 120ms after the scroll stops (K38).
`sprintTarget` picks the place, in the direction of travel, and `sprintTo` moves there in 260ms,
eased out, setting the position each frame so a fling's momentum can't carry the page past it. The
wheel is swallowed until it has been quiet for 180ms after. After a resize or rotation, the page
settles on the screen that fills more of the window (K40). It replaced `scroll-snap-type: y mandatory`, which a mouse wheel couldn't
cross from the end of a tall screen. Four custom variants in main.css carry
the layout, all screen-only so paper keeps the table: `screen:` (the WeekGrid is a CSS grid),
`full:`, `folded:` (upright under 1000px wide, or under 760px wide) and `short:` (landscape, 540px
tall or less).

- **Sizes follow the screen.** `--u` in main.css is 1 at 1280×800, clamped between 0.75 and 1.6.
  The named sizes (`--fs-name`, `--grid-name-w`, `--screen-pad-x`, …) derive from it, and folded
  they switch to `--n` (1 on a phone, up to 1.4). Components set `text-(length:--fs-name)` beside a
  type class, so the class keeps the font and weight and the size follows the screen. The other
  families: `--bar-*` sizes the Header and its BarActions (K47); `--set-*` the Settings page's and
  the dialogs' type and controls (K51, K55); `--edit-ib`, `--edit-ib-icon`, `--grid-edit-w` and
  `--grid-remove-w` Edit plan's row buttons and their columns (K54). Outside the planner's screens
  (Edit plan) `--grid-row-min` and `--grid-row-max` are a fixed max(76px, 100u), since that page
  scrolls rather than filling the window.
- **The grid.** `TrackerGrid` makes the table `display: grid` with its row groups and rows
  `display: contents`, so the cells place themselves and gridNav still walks `table.rows`. Rows
  share the height (`minmax(--grid-row-min, 1fr)`), and a `max-height` stops them at 1.25 × a day's
  width. Each day cell is a size container that `DayMark fill` fills (86%, up to 128px). Folded,
  each `TrackerRow` sets `--line-row` and `--box-row`, the two grid lines it takes. There is no
  band for today (K36).
- **The navbar.** `useBarReveal` (`src/composables/barReveal.ts`) shows it from a 14px strip at the
  top edge (a pointer that can hover), the handle button (wherever a coarse pointer is present;
  out of the Tab order), and `focus-within`; it hides on leaving, Escape or a press elsewhere. The
  bar is moved out of view with a transform, never hidden, so its controls stay reachable by Tab.
- **The arrows between the screens** (K42). A chevron IconButton, "Go to Food", at the foot of the
  Exercises screen, and one pointing up, "Back to Exercises", 48px from the top of Food, below the
  bar's strip and handle. Each sprints to the other screen's top with `sprintToScreen`. A short
  screen leaves them out.

### 6.7 Print

The `@media print` block in `main.css` gives a landscape sheet in the light theme's colours on
white paper from either theme (K16). It re-points the roles at the light theme's values, the only
literal colours the system allows (`src/styles/__tests__/print.spec.ts` holds them to
`tokens.json`): words, boxes and marks keep their light colours, chips are outlined, and `--canvas`,
`--panel` and `--tile` go transparent. Shadows and transitions are off.

- Anything marked `data-noprint` is hidden: the navbar and its handle, the arrows between the screens, the sync status,
  the import prompt, Edit plan's controls and Add buttons, and a section's hint line if it has one. Dialogs, the
  popover and Banners carry `print:hidden`.
- A met day's name keeps its `pen` and its underline (K60). A table split across pages repeats its
  header.
- The Food section's heading stays with its grid (`print:break-inside-avoid`), and a section header never ends
  a page (`print:break-after-avoid`).

### 6.8 The style guide

`src/styleguide/` is the living style guide (K2): every primitive and planner component rendered by
its real source, in each state. `src/main.ts` mounts it instead of the app at `/styleguide` when
`import.meta.env.DEV` is true, so a production build drops it. The page's Theme menu sets the same
`.dark` class the app does (`src/styleguide/look.ts`), and the address carries it
(`/styleguide?theme=dark`), so a browser test can open either theme.
Each section is one entry in `src/styleguide/sections.ts`. Coverage excludes the folder, and the
browser checks run against it.

## 7. Accounts and sync

**Signing in.** `session.init()` runs before the first render. A user remembered in
`tracker-session-v1` is signed in at once and their cache shown, then `GET /api/auth/me`
confirms it. A 401 asks them to sign in again, keeping unsent writes; being offline keeps them
working from the cache. With nobody remembered the app waits for the server, then shows the
sign-in form, which asks for an email and links to `#/signup`. That form creates an
account (`POST /api/auth/signup`) and signs straight in; once anyone is signed in, `App.vue` drops
`#/signup` from the address. A taken or malformed email and a password outside 10 to 256 characters
show on their own fields; a closed sign-up, the hourly limit and connection trouble show once above the button.
`request` treats only a 409 `conflict` as a plan conflict, so a sign-up's 409 `exists` arrives as
a refusal like any other. Invite and reset links arrive as `#/invite/<token>` and
`#/reset/<token>`. The token goes to the API in request bodies only, and the fragment is cleared once the link is used or turns
out to be invalid; offline or busy, the page offers to try again.

**Email** (`api.md` §4.1). The sign-in form asks `GET /api/auth/options` whether the API sends
email, and only then links "Forgot your password?" to `#/forgot`. That form posts the email and
then always says a link is on its way if there is an account, whatever the server found. The
account the API returns on sign-in and from `/auth/me` carries `confirmed` for an email account
while mail is on; the session store keeps it, and `EmailStatus` shows the confirm banner while it
is false, with "Send it again" (`POST /api/auth/confirm/resend`). A confirm link,
`#/confirm/<token>`, opens `ConfirmEmail` whether or not anyone is signed in, ahead of every other
screen; it posts the token, clears the fragment once used or dead, and, when the link was for the
signed-in user, ends the banner. A mailed reset link is the same `#/reset/<token>` as before. Signing out ends the server
session, then deletes the user's cache and outbox from the device. It is refused while offline: the
cookie is HttpOnly, so only the server can end it.

**One user per tab, always.** Every read and write sends `X-Expected-User` with the user the tab
shows, and the API refuses any other with 401 (`api.md` §3). A tab left open as one person can then
never read or write the account of someone who signed in afterwards in another tab: the cookie is
shared, the name is not. The session store also follows `storage` events on the session key, so
when another tab signs out or in as someone else, this tab stops syncing, clears the stores, and
follows. Every request gives up after 15 seconds and counts as offline, so one dead connection
cannot stall syncing; replies that arrive after a sign-out or a user switch are ignored.

**Writes.** The stores change state at once. A deep watcher in the sync store diffs their state
against `base`, the state the server is known to hold, and turns each difference into an operation
in the outbox:

- `plan`: a week's plan, sent as `PUT /api/plans/<section>/<week>` with the revision last seen;
- `tick`: one day of one item and its mark (or `null`), `PUT /api/ticks/…` with `{ "mark": … }`,
  so devices marking different days never collide. An outbox saved before marks had kinds holds
  `done` instead; it is read as `"great"` or `null` on load;
- `settings`: the accent and daily pick.

A newer operation for the same plan, cell or settings replaces a queued one. Each carries an id, so
the reply to one already in flight removes only that one. Plan and settings operations read their
values when sent, so the server always gets the latest. Operations go out one at a time, in order.
A tick on a week with no plan of its own creates the plan first, as on the device.

| Reply                                               | What happens                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| success                                             | dequeued; a plan's new revision is stored                                                                                     |
| 409 with the server copy                            | that week shows the server's plan, with a notice                                                                              |
| 409 with no server plan                             | sent again as a create                                                                                                        |
| offline, a timeout, or a 5xx with no API error code | kept; retried after 5 s, doubling to 60 s, and at once when the browser is back online                                        |
| 401                                                 | kept; the sign-in form appears, and sending resumes after signing in                                                          |
| any other refusal                                   | dropped, so one bad write cannot block the rest, with a notice that it was undone (for 413 `quota`, that the account is full) |

Two devices creating the same week from the same carried plan send identical items, which the API
accepts without a conflict (P7 in [decisions.md](decisions.md)), so the common case raises no notice.

**Reads.** `GET /api/state` runs at start, on focus, on returning to a visible tab, and every minute
while visible. It replaces local state only when the outbox is empty, and only if nothing changed
locally while the read was in flight. A read first diffs the stores against `base` itself, because
Vue runs the watcher after a reply can already have landed. Without that, an edit made in the same
tick as the reply would be overwritten before it was ever queued. A refresh therefore never undoes
an edit that has not reached the server.

**The cache** holds the last state the stores showed, with each plan's revision, so a reload or a
cold start offline shows data at once. It is written on every change and every read. Another tab's
write to it arrives as a `storage` event, and this tab adopts it as both its state and its `base`:
that tab's own writes are already in the shared outbox. Adopting it also counts as a local change,
so a read this tab already had in flight cannot overwrite it. Adopting never writes the cache back:
a tab still open on older code words the cache differently (before K57 its settings had no
`foodPick`), and a write-back would set the two tabs echoing it between them, each undoing the
other's marks as they were made. The cache is validated with the
storage normalisers when read, and outbox entries one by one, so a damaged key cannot break the app
or stick the outbox. A plan write for a week the stores no longer hold is dropped rather than sent
as an empty plan.

`SyncStatus` shows "Loading your data…" before the first state arrives. Offline, it shows a retry
button and how many changes are waiting. Conflict and refused-write notices stay until dismissed.
It sits in a live region that is always present, so screen readers announce each message.

**The first-login import.** Before accounts, each browser kept its own log under the keys in §4.
After sign-in, once the app has read the account from the server in this session (`sync.fresh`; a
cached copy could be stale), `ImportPrompt` reads those keys (`readLegacyData`). If they hold
anything the account lacks, it offers to add it, naming what it would add:

- **Add to my account** sends it through `importFile`, the same server merge as a file import, so
  nothing in the account is replaced or deleted.
- **Not mine** remembers the answer for this user on this browser.
- **Later** asks again on the next load.

The answer is kept in `tracker-import-v1:<user>` (`imported` or `dismissed`), which signing
out leaves in place. If the account already holds everything the keys do (imported from another
device, say), the prompt records `imported` and never appears. Only an accent or daily pick in the
settings key counts as data: every device still writes its theme there. The old keys are never
changed, so a browser shared by two people offers its log to each until each answers.

The single-list format (v1) needs trimming first. The old app copied its one list onto every
logged week and onto the current week, so the screen looked as before. Imported into an account,
that copy on the current week would replace the account's own carried-forward plan for this week
and later ones, and an empty list would empty them. So the import puts the list only on the weeks
it was ticked in (on the current week only if it was never ticked), adds no plan for an empty list,
and reads a damaged v1 key as nothing rather than as the default exercises.

**Accepted limits.**

- Tabs share one outbox through `localStorage`, which Chrome copies between tab processes
  asynchronously. Two tabs of one user editing within that delay can each rewrite the outbox from
  a stale copy and lose the other's queued write. Duplicate sends are harmless (ticks carry their
  value, identical plans are accepted); this narrower case would need one outbox per tab.
- When a session ends by itself (expiry, a reset elsewhere), the device keeps that user's cache and
  outbox so unsent changes survive, and the sign-in form fills in their email. Only signing out
  on purpose clears the device.
