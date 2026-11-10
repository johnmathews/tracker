# Architecture

> Purpose
>
> How the planner is put together: the component tree, the Pinia stores, how data syncs with the
> API and what stays in `localStorage`, the decisions that depart from the design prototype, and
> how the design system reaches the screen.

## 1. Overview

A Vue 3 SPA with accounts. The API service in `api/` ([api.md](api.md)) holds each user's data, and
the app syncs with it through the same origin (§7). Four Pinia stores hold what the app shows:
`planner` (exercise plans, the log, the visible week, settings, the mode), `cardio` (cardio plans
and their log, K90) and `diet` (food plans and their log), which take their week from `planner`,
and `details` (each item's notes and fields, one
copy for every week, §3). Two more run the account: `session` (who is signed in, and whether the API sends email and
answers questions) and `sync` (the per-user cache, the outbox of unsent writes, and reads). A
seventh, `ask`, holds the Ask page's conversation and history (§3), read through `request` and
`stream` in `src/lib/api.ts`; `src/lib/ask.ts` holds the page's words. The three plan stores track
the same thing, a mark per day against a weekly goal, through the pure helpers in
`src/lib/tracker.ts`.

**Tracker types.** `src/lib/trackerTypes.ts` is the registry of tracker types. A section
(`exercise`, `cardio`, `diet`) is the stored name, in URLs, the database, the cache and the outbox.
Its type (`exercise`, `cardio`, `food`) is an attribute of it, mapped in `SECTIONS`, whose order is
the week's: Exercises, Cardio, Food (K90). Each type gives:

- the section's heading and the label of one item ("Exercises", "Exercise");
- the marks a press steps through in each mark set (§6.2);
- the chips under a name (`exerciseDetails` lives here, and `planner.ts` re-exports it;
  `cardioDetails` gives a cardio item's time, then its distance: "30 min", "5 km");
- the item page's fields, by key and label (exercise: Equipment, Works, Link; cardio: Route, Link;
  food: A serving, Examples);
- the setting that holds its daily target (`dailyPick`, `foodPick`), or `null` for a type with none
  (cardio), and a new item's goal.

`api/src/tracker_api/types.py` holds the same registry, and `fixtures/types/registry.json` keeps
the two in step: `trackerTypes.spec.ts` and `test_types.py` both read it. A second tracker of a type
would be a new section in `SECTIONS`, with no rename. There is no screen for adding one: a new
tracker is code (a store, a section component, the API's normaliser), as Cardio was (K90).

**The item page.** `src/lib/routes.ts` reads and writes the item page's address,
`#/item/<section>/<id>`, and does its Back (`backToWeek`) and the Link field's site (`webHost`).
`src/lib/history.ts` gives an item's recent weeks (`itemHistory`) and its latest plan
(`latestPlanWith`), from the log and the plans. `src/composables/itemSource.ts` reads each
section's plans, log and goal action from its store, for the page and for the route that checks
the item exists.

**The item page's sections** (K66, P29). `src/lib/itemSections.ts` holds which of the page's
sections (`notes`, `details`, `plan`, `history`) each type's pages show, and in what order:
`{order, hidden}` per type id, every key once in `order`, `hidden` a subset in the default order.
`normaliseItemSections` drops unknown, repeated and non-string keys, appends missing ones in the
default order, drops a type the registry lacks, and leaves out a type with the default
arrangement. `api/src/tracker_api/item_sections.py` normalises the same way, and
`fixtures/item-sections/normalise.json` keeps the two in step (`itemSections.spec.ts`,
`test_item_sections.py`). The arrangement is the settings field `itemSections` (§3), so it syncs
and exports with the account.

`src/lib/words.ts` writes
small counts as words: `numberWord` ("two", or "Two" to open a sentence, figures from 11 up) and
`countOf` ("one change", "two changes"). `src/lib/plans.ts` decides which week's plan a week
shows; `src/lib/dates.ts` holds the week maths (Monday of a week, `YYYY-MM-DD` keys and back,
labels, `DAY_NAMES`); `src/lib/theme.ts` holds the theme names and `isDark`. The planner's screens
(§6.6) use `src/lib/screens.ts` (a section's screen classes), `useScreenSprint`
(`src/composables/screenSprint.ts`, never resting across two screens), `useBarReveal`
(`src/composables/barReveal.ts`, the navbar out of sight) and `useFullscreen`
(`src/composables/fullscreen.ts`, the browser's full screen).

The API has a second client besides the app: agents that connect over MCP (`mcp_server.py`). Their
tools read through `insights.py` and write through `edits.py`, so they follow the same rules as the
app. [api.md](api.md) §3.1 describes the endpoint and [mcp.md](mcp.md) how to connect an agent.

An agent signs in one of two ways. A personal token (`trk_…`) is created in Settings ›
Connections and sent as a header. Or claude.ai and Claude Code connect by URL with OAuth, which
the API serves itself in two modules: `oauth.py` holds the rules (clients, pending requests,
codes, connections, rotating refresh tokens, access tokens) and knows nothing about HTTP, and
`oauth_api.py` holds the routes ([api.md](api.md) §3.3). `mcp_server.py` checks a bearer token by
its prefix, so the same endpoint takes both. The one place the browser app meets OAuth is the
consent screen: Claude sends the person's browser to `/api/oauth/authorize`, which answers a 302
to the app at `#/connect/<id>` (`ConnectPage.vue`). The page approves or denies through the API
and then leaves for the address the API gives, Claude's callback. The app's calls, for that page and for
Settings › Connections, are in `src/lib/connections.ts`. The OAuth discovery documents
live outside `/api/` (`/.well-known/…`), so nginx and the Vite dev server forward those three
paths to the API as well ([deployment.md](deployment.md) §2).

Every screen is built from the primitives in `src/components/ui/` (§6.3), which follow the design
system's cards ([brand.md](brand.md)). `TrackerGrid` and `TrackerRow` (on the `DayMark`, `Chip`
and `IconButton` primitives) take props, emit events, and serve every section.
`TrackerGrid` runs the grid's keyboard model (`useGridNav`, §6.5) and links each name to its item's
page. `TrackerRow` asks the
`ConfirmDialog` (through `useConfirm`, §6.4) before emitting `remove`, and names where focus goes
once the row has gone. `ExerciseGrid`, `CardioSection` and `DietSection` wire them to their store. `EditExerciseDialog` (which also adds an exercise when given none, K54) takes its field
state and input cleaning through `useExerciseForm` (`src/composables/exerciseForm.ts`) and the
`PerSideToggle` segmented control. `EditCardioDialog` and the item page take a cardio item's
Minutes and Distance in km through `useCardioForm` (`src/composables/cardioForm.ts`), which stores
the minutes as seconds. `src/lib/problems.ts` turns a sign-in, sign-up, link or
sign-out refusal into a sentence for the forms, and `describeConnectProblem` does the same for the consent screen; `src/composables/importSummary.ts` says what an import would add,
for Settings → Import… and the first-login prompt.

```
App.vue                 picks the screen (a link, planner, Settings, an item's page, Ask,
│                       sign-up, reset or sign-in), the .dark class, clock refresh, sync
│                       triggers (focus, visibility, online, minute tick, storage), the
│                       planner-screens class (§6.6), and the one ConfirmHost
├── ConfirmEmail.vue    a confirm-your-email link (#/confirm/<t>), signed in or out: confirms it
├── PasswordForm.vue    an invite or reset link (#/invite/<t>, #/reset/<t>): choose a password
├── SignupForm.vue      #/signup: email and password twice; field and form-level refusals
├── ForgotForm.vue      #/forgot: an email; then the same words whether or not it has an account
├── LoginForm.vue       email and password; explains refusals; notes an ended
│                       session; links to #/signup, and to #/forgot where the API sends email
│   (all five inside AuthCard.vue: a centred Panel with the BrandMark)
├── AppNavbar.vue       the Header card: Skip to today and a hidden Edit plan ("Done" in Edit
│                       plan) for the keyboard; ‹ the week › first, as the page's title (K81);
│                       then the BarActions This week, Ask (only while the API answers
│                       questions), Settings, Print… and Full screen (useFullscreen, where the
│                       browser has one); the week's keys E, Esc, F, P and S (useShortcuts,
│                       K91); full width, sized by main.css's --bar-* (K47, K49); on the
│                       planner's screens out of sight until a long press or the handle opens
│                       Edit plan (useBarReveal, §6.6)
├── ConnectPage.vue     an OAuth consent link (#/connect/<id>, K73), signed in or out: who is
│                       asking, email and password, Read only or Read and change, Cancel and
│                       Connect; then leaves for Claude's callback
├── SettingsPage.vue    the SettingsPage card, at #/settings: Back to the week, then Appearance
│   │                   (Marks, then Theme, K59), Your goals (My goals, saved when typing
│   │                   pauses), Your data (Export and Import…, see §4), Connections and
│   │                   Account (who is signed in, Sign out)
│   └── ConnectionsSection.vue   the Connections row (K74): the MCP address with Copy and how to
│                       connect Claude, the Apps connected by OAuth, and the personal Tokens
├── AskPage.vue         #/ask (K67–K71, K83, K84): the SidePanel with the HistoryList, and
│                       beside it Back to the week, the title with the View switch (Document or
│                       Conversation, kept per device), the Transcript and the question box with
│                       the QuotaChip; deleting asks in a ConfirmDialog of its own
├── ItemPage.vue        the ItemPage card, at #/item/<section>/<id> (K64, K65): Back to the week
│   │                   and Arrange sections, the type, the name and its chips; then rows like
│   │                   Settings: Notes, Details, the week's plan (or the latest, read-only) and
│   │                   Recent weeks, as the type's arrangement shows them (K66)
│   └── RecentWeeks.vue the RecentWeeks card: up to eight weeks, newest first, a met week's count
│                       in pen
├── SyncStatus.vue      loading, offline and conflict Banners above the planner
├── EmailStatus.vue     "Confirm your email." Banner, with Send it again, until it is confirmed
├── ImportPrompt.vue    this browser's log from before accounts, offered once (§7)
├── WeekHeader.vue      the page's h1, the week ("19–25 October"): on the planner's screens a band
│                       fixed at the top, with a hairline once a screen is under it (K88); visually
│                       hidden in Edit plan, on a short screen and on paper, where each
│                       SectionHeader prints the week over its own page (K97)
├── ExerciseGrid.vue    the Exercises section: SectionHeader (the section's heading; in config
│   │                   mode with the Exercises a day Stepper centred on its line while Daily
│   │                   goal is on, K62, K85)
│   ├── TrackerGrid.vue a <table> (WeekGrid card): day names, one TrackerRow per item, and
│   │   │               the days that met the daily pick
│   │   └── TrackerRow.vue  name (a link to the item's page) and chips on one line, the
│   │                       item's notes under them, from the details store (a button
│   │                       opening a Popover, K43); 7 × DayMark; in config
│   │                       mode the edit IconButton after the name, and the remove
│   │                       IconButton in a last cell of its own
│   └── EditExerciseDialog.vue  Dialog: Name; sets, Measure (Reps or Time), reps or seconds;
│                           PerSideToggle, weight (kg), Times a week (the goal); then Note (K55),
│                           the item's notes for every week (the details store);
│                           Edit exercise, or Add exercise from the button under the grid (K54)
├── CardioSection.vue   the Cardio section (K90): SectionHeader with no Stepper (no daily
│   │                   target), kept with its grid; on the screens "Back to Exercises" on its
│   │                   title line and "Go to Food" at its foot (K42)
│   ├── TrackerGrid.vue wired to cardio: a time and a distance as chips; no day turns green
│   └── EditCardioDialog.vue  Dialog: Name; Minutes, Distance in km, Times a week; then Note;
│                           Edit cardio, or Add cardio from the button under the grid (K54)
└── DietSection.vue     the Food section: SectionHeader (the week centred as the title, then the
                        heading; in config mode the heading alone, with the Foods a day Stepper
                        centred on its line while Daily goal is on, K62, K85), kept
                        with its grid, whose days that met foods a day turn green (K57); on the
                        screens, the "Back to Cardio" arrow (K42)
    ├── TrackerGrid.vue wired to diet: no chips
    └── EditFoodDialog.vue  Dialog: Name, Times a week (the goal), then Note (the food's notes
                            for every week); Edit food, or
                            Add food from the button under the grid (K54)
```

## 2. Weekly plans

Each week has its own **plan**: the exercises (with sets, reps or a duration, per-side, weight and goal), the
cardio (with a time, a distance and a goal) and the foods (with goals). Ticks live in a separate **log**, keyed by week and item id.

- **Carry forward.** A week without a plan of its own shows the plan of the latest earlier week that
  has one (`planSource` in `src/lib/plans.ts`); weeks before the first plan show the earliest one,
  and with no plans at all the stores show the defaults (none for cardio, K90). The API's `insights.py` ports this rule,
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
- An item's notes and fields are not part of any week's plan. They are its details, one copy for
  every week, keyed by section and item id (the details store, §3). Before 2026-11-01 each week's
  copy of an item carried its own note, so an edit on one week missed the weeks with their own plan.

## 3. Stores

`usePlannerStore` is a setup store.

| State                             | Kept by                                   | Notes                                                                       |
| --------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `plans`                           | the sync store: server and per-user cache | week → `{ id, name, sets?, reps, duration?, perSide?, weight?, target }[]`  |
| `log`                             | the sync store: server and per-user cache | week Monday `YYYY-MM-DD` → exercise id → seven marks (`Days`, below)        |
| `accent`, `dailyPick`, `foodPick` | the sync store: server and per-user cache | defaults `#30d158`, `3` and `2`. The accent is kept but draws nothing (K13) |
| `goals`, `goalsKnown`             | the sync store: server and per-user cache | My goals, `''` by default; only Ask reads them. `goalsKnown` is below       |
| `dailyGoal`, `dailyGoalKnown`     | the sync store: server and per-user cache | Daily goal (K85), `true` by default; sent only once known, like `goals`     |
| `itemSections`                    | the sync store: server and per-user cache | each type's item-page arrangement (K66); `{}` is every page as it comes     |
| `theme`                           | `tracker-settings-v1` (the device)        | `system` (default), `light` or `dark`                                       |
| `markSet`                         | `tracker-settings-v1` (the device)        | `squiggles` (default), `ticks`, `stamped-ticks`, `faces`, `stamped-faces`   |
| `configMode`                      | no                                        | `false` (normal mode) on every load                                         |
| `weekOffset`                      | no                                        | `0` is the current week                                                     |
| `now`                             | no                                        | a ref so "today" can move; see §5                                           |

The stores start empty (showing the defaults) and never write the user's data themselves. The sync
store fills them with `adopt` and saves their changes (§7).

**Derived:** `monday`, `weekKey`, `currentWeekKey`, `label`, `days` (`name` "Thu",
`date` "22", `full` "Thursday 22 October" for the DayMarks' names, `key`, `isToday`, and
`isFuture` for days still to come), `exercises` (the visible week's plan, see §2), `dayCounts`,
`grandTotal`, and the helpers `isDone(id, day)` and `totalFor(id)`. Totals count only the week's
exercises, so a removed exercise's history stays in `log` without inflating the numbers.

**Actions** (plan edits apply to the visible week only): `toggle`, `changeTarget` (clamps 0–7),
`addExercise` (returns the new id, or `null` for an empty name; new exercises get goal 3 unless
the input names one), `updateExercise` (replaces name, sets, reps or duration, per-side, weight and, when
given, the goal, keeping the id and history; `false` for an empty name or an id not in the week).
An exercise counts reps or time, never both: a duration stores reps as 0. Then `removeExercise`, `setConfigMode`,
`prevWeek`, `nextWeek`, `thisWeek`, `refreshNow`, `changeDailyPick` and `changeFoodPick` (each
clamps 1–8), `setGoals` (normalised as the API stores them; the same text again changes
nothing), `setTheme`, `portableSettings` (the accent, both daily picks and, once known, the
goals), `savedSettings` (the same, or null while the user has none of their own), `adopt`
(replace the data and settings wholesale), `adoptWeek` (replace one week's plan) and `clear` (forget
the user on sign-out, the details store included, keeping the theme).

**My goals** are the person's own words about what they are aiming for, set in Settings and read
only by Ask. `goalsKnown` turns true once the goals came from the server, from a cache that
carried them, or from `setGoals`. Until then `portableSettings` leaves them out, so a tab that
hasn't read them never sends or caches a stand-in `''` that would erase the saved ones (§7).
Settings that `adopt` receives without `goals` keep the ones the store has. `setGoals` doesn't
debounce: the Settings row commits its draft when the person stops typing, so one change is one
write. The module also re-exports
`exerciseDetails` from `src/lib/trackerTypes.ts`, which gives the chips after a name, on its line (K43):
"3 × 12" or "3 × 8 each side" (or "10 reps a set" and "8 each side" without sets, "3 sets" without
reps), "3 × 45 s" or "1 min 30 s each side" for a timed exercise (`durationText` in
`src/lib/words.ts`), then "16 kg" when weighted, and no chip at all for none of these (the Chip
card's words).

`useDietStore` holds `plans` of foods (`{ id, name, target }`) and its own `log`, kept by the sync
store like the planner's. It reads `planner.weekKey`, so week navigation moves every
section. It derives `foods`, `dayCounts`, `grandTotal` and `goalsMet`, and
offers `isEaten`, `totalFor`, `toggle`, `changeTarget` (0–7), `addFood` (a name, or a name with
its goal from the Add food dialog; goal 3 when none is given; the new id, or `null` for an empty
name), `updateFood` (name and goal from the Edit food dialog, `false` for an empty name or a food
not in the week), `removeFood`, `adopt`, `adoptWeek` and `clear`. Food goals work
like exercise goals (met once the count reaches a non-zero goal). The daily target, foods a day,
is the planner store's `foodPick`, with the other settings (K57).

`useCardioStore` (`src/stores/cardio.ts`, K90) holds `plans` of cardio items (`{ id, name,
duration?, distance?, target }`: seconds in all and km) and its own `log`, kept by the sync store
like the others, on the planner's week. With no plans at all it shows none (`defaultCardio()` is
empty), so an account from before Cardio has an empty section. It derives `items`, `dayCounts`
and `goalsMet`, and offers `markOf`, `totalFor`, `toggle` (the exercise's cycle: great, partial,
missed), `changeTarget` (0–7), `addCardio` and `updateCardio` (a name, a time, a distance and a
goal; seconds rounded and capped at 86,400, km to 2 places and capped at 1,000, zero leaving either
out; `updateCardio` keeps the goal when none is given), `removeCardio`, `adopt`, `adoptWeek` and
`clear`. It has no daily target: no setting, and no day turns green.

`Tracked` (`src/lib/tracker.ts`), the item shape the plan stores share, is `{ id, name, target }`.
It has no `notes`: they are the item's details.

`useDetailsStore` (`src/stores/details.ts`) holds `docs`, each section's details by item id. An
item's details are `{ notes?, fields? }` (`ItemDetails` in `src/lib/storage.ts`): its notes in
markdown, and its text fields by key. A blank key is left out, so `{}` is an item with none, and
the store drops an empty document. The sync store fills it through `adopt` and saves its changes
like the plans (§7). It offers:

- `get(section, id)` (a frozen `{}` when there are none), `notesOf` and `fieldOf(section, id, key)`;
- `canSetNotes(section, id, text)`, which a dialog asks before it saves anything (`id` null for an
  item not added yet);
- `setNotes` and `setField`, which store the document as the API would and return `false`, changing
  nothing, over a limit (§4), over 32 KB, for a bad field key, a 33rd field or an id the API can't
  name;
- `adopt` (every section), `adoptItem(section, id, doc)` (one item, from a conflict) and `clear`.

A page that saves as you type keeps its own draft of the text and calls a setter on each change,
so a trailing space stays in the field while the stored copy is trimmed.

`useSessionStore` also keeps what the API offers, from `GET /api/auth/options`: `mail` (it sends
email) and `ask`, three-state: `null` until the API has said, then `true` or `false`. It loads
after every sign-in, including a remembered user's (F9), and again when the browser comes back
online; a failed read leaves `ask` as it was, and `askOff()` sets it false when the API answers
503 `ask-off`. The bar's Ask button and the `#/ask` page show only while it is `true`.

`useAskStore` holds the Ask page (docs/api.md §3.2). Nothing of a conversation is kept in the
browser's storage; the history lives on the server.

| State                | Notes                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `turns`              | the open conversation, as the Transcript draws it (`done`, `streaming`, `stopped`, `error`) |
| `conversationId`     | the open conversation's id; `null` for a new one until `start` names it                     |
| `status`             | `idle` or `asking`                                                                          |
| `draft`              | the question box's words, kept while the person is on another page                          |
| `remaining`, `limit` | questions left today and the cap, from `GET /api/ask` and each `start`; `null` until read   |
| `openAt`             | when asking opens again (ms), from a 429's `retryAfter`; `null` when not known              |
| `conversations`      | the history list from `GET /api/ask/conversations`: `{ id, title, updatedAt }`              |
| `unsynced`           | changes still in the outbox when the last question went (F11)                               |
| `offline`, `notice`  | the last call couldn't reach the server; one line about the conversation (not kept, gone)   |

`ask()` sends the box's words (or a Try again's question): it awaits `sync.flush()` first, notes
what is still pending, and posts `{question, today, conversation?}` with `today` the browser's
date (F15) and `conversation` left out for a new one, or after a new one's first turn wasn't kept
(`done.saved` false). Text deltas collect in a buffer that is drawn once per animation frame.
`done` and `error` end the turn; a refused answer's text is discarded. A stream that ends with
neither is a failure, as is 30 seconds with no frame (`stream`, §7). Stop aborts the stream and
keeps what arrived. A question the server never took (429, 503 `ask-off`, offline, a deleted
conversation's 404) leaves no turn and goes back in the box. `open(id)` shows a past conversation,
`newConversation()` empties the page, and `remove(id)` and `removeAll()` delete on the server and
return the sentence for the ConfirmDialog when they can't. Every call sends `X-Expected-User`. The
store clears itself, with any answer still streaming, when the session signs out or changes user;
`App.vue` creates it so that watch always runs.

In `AskPage.vue`, Return in the question box sends, like Send, and Shift+Return starts a new
line. A Return that picks an input method's candidate (`isComposing`) is left to the input method.
While an answer is being written, Return does nothing, so a next question can wait in the box.

The planner writes only the theme and `markSet`, each merged into whatever
`tracker-settings-v1` already holds.
`writeKey` skips the write when the stored string already matches, and swallows storage errors, so
with storage blocked or full the app keeps working in memory.

## 4. Storage format and validation

| Key                                            | Holds                                                                           | Written |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| `tracker-session-v1`                           | `{ user }`: the last signed-in user                                             | yes     |
| `tracker-cache-v5:<user>`                      | the user's state as `GET /api/state` returns it, with `revs` and `detailRevs`   | yes     |
| `tracker-outbox-v5:<user>`                     | writes not yet sent (§7)                                                        | yes     |
| `tracker-import-v1:<user>`                     | the first-login prompt's answer, `imported` or `dismissed` (§7)                 | yes     |
| `tracker-settings-v1`                          | `theme`, read before first paint by `public/theme-init.js`, and `markSet`       | both    |
| `tracker-cache-v4:<user>`, `-outbox-v4:<user>` | the cache and outbox from before Cardio; moved at sign-in as they are           | never   |
| `tracker-cache-v3:<user>`, `-outbox-v3:<user>` | the cache and outbox from before item details; moved at sign-in, notes lifted   | never   |
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

The names went to `-v4` on 2026-11-01, when notes moved from plan items into item details. A
`-v4` cache holds each section's `details` and `detailRevs` beside its plans, log and `revs`, and
its plan items carry no `notes`. Moving a `-v3` cache lifts its notes into details by the export's
rule below (`liftNotes`, `normaliseState(v, true)`). The server lifted the same notes from its own
plans (migration 7, [api.md](api.md) §2), so lifted notes are not sent. The exception is a section
whose plan writes were still queued in the old outbox: a note there may have been edited or cleared
offline, after the copy the server lifted. Each of its lifted items queues a `details` write marked
`lifted`, and so does each item in a queued week's plan with no note in the cache, which sends a
cleared document. The server's rev 1 is migration 7's copy of the old note, so a 409 at rev 1 to a
lifted write sends it again at rev 1, and the device's copy wins, as the queued plan write would
have. A note the server already holds is accepted as it is (P7). A conflict at rev 2 or later means
the note changed after the migration, so it brings the server's copy in, as for any write. A newer
edit to the item before the lifted write is sent replaces it and stays `lifted`. An id the details
path can't name (§7) queues nothing.

The names went to `-v5` on 2026-11-09 with Cardio (K90). A `-v5` cache holds a third section,
`cardio`, whose items keep a `duration` and a `distance`. A tab still open on older code would
write the cache back without it, and drop queued cardio writes from the shared outbox, since it
doesn't know the section. A `-v4` cache and outbox already hold item details, so they move as they
are: nothing is lifted and no details write is queued (`WITH_DETAILS` in `src/stores/sync.ts`).
`normaliseState` reads a state with no `cardio` (the server mid-deploy) as no cardio.

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
- An exercise or a food keeps no `notes` (they are its details, below). A `notes` key on an item
  in an export of version 4 or a `-v3` cache (K43) is read only to lift it into details: trimmed
  of spaces, tabs and line breaks at its ends and cut to 500 characters, counted as code points so
  the API's Python agrees (`normaliseNotes`).
- Log weeks whose key is not `YYYY-MM-DD`, and entries that are not arrays, drop out; the rest
  normalise to exactly seven days (`normaliseMark`): `"great"`, `"partial"` and `"missed"` stay,
  a `true` from before marks had kinds reads as `"great"`, and anything else is an empty day (`null`).
- When migrating, a v1 payload that is not a JSON object, or whose list is not an array, yields the
  defaults; an empty list stays empty. The prototype trusted its stored data and crashed outright on
  a payload without `log`.

`parseDietData` applies the same rules to foods, with four default foods (Vegetables 7, Fruit 5,
Fish 2, Nuts 3).

**Item details** (`normaliseDetails`, `normaliseDetailsMap`), in the cache, an export and the
API's replies, follow the API's rules exactly ([api.md](api.md) §3):

- `notes` is a string trimmed of spaces, tabs and line breaks at its ends, cut to 20,000 code points
  (`MAX_DETAILS_NOTES`) and trimmed again. A blank note is left out.
- `fields` keeps keys matching `[a-z][a-z0-9_]{0,31}`, whether or not the type lists them, so
  changing a type's field list never loses text. Each value is trimmed and cut to 500 code points
  (`MAX_FIELD`), blanks drop out, and the first 32 that remain are kept.
- Any other key is dropped, and an empty `fields` is left out.
- A document over 32 KB as compact UTF-8 JSON (`detailsFit`) drops out of a map, as does an item id
  over 128 characters or `__proto__`. 20,000 characters of a multi-byte script can pass 32 KB, so
  the dialogs and the item page say "These notes are too long to save" for that case.

The notes render with `src/lib/markdown.ts` (markdown-it, raw HTML off, no images, headings, tables
or rules). The row shows one line of inline formatting, where a link is its underlined text. The
whole note opens in a Popover that scrolls when it is taller than the window, and the item page
shows it whole. Links there open in a new tab with `rel="noopener noreferrer"`. The notes are
edited on the item page and in the Note field of the Edit exercise, Edit cardio and Edit food
dialogs. The
field counts from 19,000 characters (`NOTES_COUNT_FROM`), and a blank one clears the notes.

`parseSettings` accepts any `#rrggbb` accent (K3a, K13), clamps the daily pick to
1–8, reads My goals with `normaliseGoals` (trimmed, cut to 1,000 code points, `''` when blank or
not a string), accepts only `system`, `light` or `dark` as the theme and only one of `MARK_SETS`
as the mark set, falling back to the defaults otherwise. Settings saved before the theme option existed
load as `system`, and before the mark set existed as `squiggles`.

**Export and import.** Settings → Export downloads `tracker-YYYY-MM-DD.json`:

```json
{
  "format": "tracker-export",
  "version": 5,
  "exportedAt": "2026-10-24T09:30:00.000Z",
  "exercise": { "plans": {}, "log": {}, "details": {} },
  "cardio": { "plans": {}, "log": {}, "details": {} },
  "diet": { "plans": {}, "log": {}, "details": {} },
  "settings": { "accent": "#30d158", "dailyPick": 3, "foodPick": 2, "goals": "" },
  "conversations": [{ "id": "Kq3x…", "title": "…", "createdAt": 0, "updatedAt": 0, "turns": [] }]
}
```

`details` maps each item id to its `{ notes?, fields? }`, without revisions. `settings` also
carries `itemSections` when a type's item page is arranged (K66); a file's arrangement is
normalised like the cache's, and applies with the other settings only to an account that has none.
The plans, marks and settings are the device's, unsynced changes included. Ask's conversations
live only on the server, so Export reads them from `GET /api/export` (`api.md` §3) and adds that
list; an account with none writes no `conversations` key, and offline the file downloads without
them and says so. The theme is not
exported, because it belongs to the device rather than the person. Import… reads a file through
`parseExport` (`src/lib/transfer.ts`), which rejects anything that is not JSON, has another
`format`, or has a `version` other than 1 to 5 (a version 1 file's `true` days read as `"great"`,
K12; version 4 added notes on plan items, K43; version 5 moved them into `details`). My goals
came without a new version, as `foodPick` did: an older reader drops the key, and a file without
it reads as no goals. The `cardio` section came the same way (K90): a file without it reads as no
cardio. A cardio item keeps `duration` in whole seconds (capped at 86,400) and `distance` in km to 2
places (capped at 1,000), each only when above zero (`normaliseCardio`, the API's
`normalise_cardio`).

A file of version 4 or older carries its notes on plan items, so `liftNotes` lifts them into
`details`, and any `details` key in it is ignored. Per item, the note comes from the latest week
whose copy of the item has a non-blank one, and from the first such copy in that week. Only items
the plan normaliser keeps count. The API's `lift_notes` and its migration 7 apply the same rule.

Files exported under the earlier names carry
`"format": "fitness-planner-export"` or `"exercise-planner-export"` and import the same way
(`OLD_EXPORT_FORMATS`, in both languages). It validates the rest with the same normalisers
as storage, so a hand-edited file loads the way a hand-edited `localStorage` value would. Missing
`settings`, or settings that are not an object, mean "no settings".

An import **merges and never deletes** (`mergeTracked`, `mergeSettings`; the API's `import_data`
applies the same rules):

- A week that already has a plan keeps it; a week with no plan takes the file's.
- Per week, item and day, a marked day keeps its mark and an empty one takes the file's, so an
  import can add marks but never clears or changes one.
- An item with details keeps them whole, and an item without takes the file's.
- The file's accent and daily pick apply only when the account has no settings of their own yet.
- The file's My goals fill the account's when those are empty, and never replace goals already
  saved (K72).
- The file's Ask conversations are added when the account has none with their id; one it has is
  never changed.

Confirming sends the file to `POST /api/import` (`sync.importFile`, with its `conversations` when
it has any): the server merges it against
the account's real state in one transaction, and the app then reads the account afresh (after any
read already in flight, which predates the import). Local writes still queued go out first, so the
server merges against everything this device has; if they cannot be sent, nothing is imported. When
the import cannot be done, the Settings page says why (offline, a server failure, an ended session,
a full account) and
keeps the file ready to try again. The confirm step names how many weeks and marked days the file
adds, and how many items gain notes or details ("…plus the notes and details of two items"), before
anything is written (`mergeSummary`, through `useImportSummary`, which the first-login prompt
shares), and names the rest: the exercises and foods a day, your goals (goals that only fill
empty ones count as a change on their own), and how many conversations from Ask the account
doesn't have yet (Settings reads the history list first when the file has any). It is computed from the current state, so it stays right if another tab or a settings
change lands while it is open. Importing the same file twice adds nothing the second time. Adding a week can change what
an unplanned week carries forward from (§2). The import took its history from the file, so that is
the intended result.

`fixtures/transfer/` holds the parse and merge cases as JSON, each with its expected result.
`src/lib/__tests__/transfer.spec.ts` runs every case. The format is the contract for the API's
import and export as well: the API's tests (`api/tests/test_parity.py`) run the same files.
`fixtures/types/registry.json` does the same for the tracker-type registry (§1).

## 5. Decisions beyond the design

- **Cells are buttons.** The prototype's cells were clickable `div`s. Each day is a `DayMark`: a
  `button` with `aria-pressed` and a name such as "Squats, Friday 23 October, today" (today also
  carries `aria-current="date"`), so the grid works from the keyboard and with a screen reader. The
  grid is a `<table role="grid">` with `row`, `columnheader`, `rowheader` and `gridcell` roles, and
  one tab stop (§6.5).
- **One screen per section, not a window.** The handoff drew the app as a macOS window (traffic
  lights, a framed window on a backdrop). The app fills the browser instead: Exercises, Cardio and
  Food are a screen each, the page sprints between them, and the navbar keeps out of sight until it is
  wanted (K24, K25; §6.6). Edit plan is an ordinary page with a sticky navbar (K27), full
  width at the week's sizes with rows a fixed 100u (K54). Settings has no navbar (K52) and is full
  width in rows like the week (K51), and an item's page follows it, rows and all (K64, K65). The navbar keeps the week controls, This week, Edit plan,
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
- **An item's own page** (K64, K65, the ItemPage card). The handoff has nowhere to keep more about
  an exercise or a food than its row. `ItemPage.vue`, at `#/item/<section>/<id>`, is one of
  Settings' family: no Header, Settings' sizes, full width on the page's margins. Its layout is
  option A of the mockup `261101-item-page`, rows like Settings (K65; K64 first built option B).
  Under the head (Back to the week, the type, "Exercise", and the name in `title-1` with its
  chips), each section is a row with its heading in the week's 320u name column
  (`--grid-name-w`), its content to the right and a `line` rule above it, in this order:
  - Notes, at the page's text size (`--set-text`), read as markdown, with Add notes or Edit notes
    turning them into a field that saves as you type, and Done or Escape turning it back;
  - Details, the type's fields, saving as you type, where a web address in Link adds "Open
    youtube.com in a new tab";
  - the plan, its controls in columns at least 300u wide;
  - Recent weeks (`RecentWeeks.vue`), up to eight weeks ending with the opened week, never before
    the item's first plan. Every mark counts toward a week's count, missed included (K9, K65).

  Folded, one column in the same order, each heading over its content.

  That is the default order. **Arrange sections** (K66), a quiet Button at the right of the head's
  first line, puts the page in arranging: a line saying the choice is every exercise page's (or
  every food page's), then every section as its heading over a Switch, "Show" (named "Show
  Notes"), and IconButtons "Move Notes up" and "Move Notes down", with "Shown" or "Hidden" beside
  it. Each change calls the planner store's `setArrangement` at once, so every page of the type
  follows and it syncs as a settings operation. The button reads "Done" while arranging; Done or
  Escape leaves. Focus stays on the button, and after a move on the moved section's same button,
  or on its other one when the move reaches an end (the end's button is `aria-disabled` and its
  press does nothing). Outside arranging the page renders only the shown sections, in order, so
  print follows too; with none shown it says "Every section is hidden. Arrange sections to show
  one."

  The plan section edits the week the planner shows through the stores' own actions (`updateExercise`,
  `changeTarget`), so a change shows in that week's row and in the weeks after it with no plan of
  their own, and the page says so. Its heading is "This week's plan", or "Plan for the week of 19
  October" for another week. An item not in that week (an old address, or an item since removed)
  shows "Latest plan", read-only, from the latest week whose own plan holds it.

- **The page's address and focus.** App opens the page for an address whose section is a registry
  section and whose id the API could name, once the data shows the item is in the visible week or
  in some week's plan. Any other `#/item/…` address opens the week and drops the hash, as does an
  item another tab removed from every plan. Arriving moves focus to the item's name. Opened from the
  week, the page marks its history entry (`markFromWeek`), so Back to the week goes back through
  history and the browser's Back agrees. Opened from an address, Back replaces the entry with the
  week. Either way focus returns to that item's name in its row. Signing out on the page drops the
  hash, as on Settings.
- **The name is a link.** In the week and in Edit plan, each row's name is an `<a href>` to its
  item's page (`data-slot="item-link"`). It looks as it always has, underlines under the pointer and
  prints as plain text. The pencil still opens the quick Edit dialog. In the grid the link is the
  name cell's widget, so Enter opens the page in one press, and F2 reaches the cell's other controls
  (§6.5).
- **Config mode and normal mode.** Normal mode, the default on every load, only marks cells. A
  long press, the handle, E, or the keyboard's hidden "Edit plan" button (K80, K82, K91) turns on
  config mode (Edit plan), where the bar is in view. Another long press, E, Esc or the hidden
  button (reading "Done") turns it off; the bar has no Done (K91). `useShortcuts`
  (`src/composables/shortcuts.ts`) carries the week's keys: E, Esc (full screen first, then Edit
  plan), F full screen, P print and S Settings. `ownedElsewhere` leaves a key alone in a field,
  with Ctrl, ⌘ or Alt, repeating, mid-composition, or while a dialog or popover is open. Edit plan
  shows the
  edit and remove IconButtons, an "Add exercise" and an "Add food" button under the grids, and
  the daily targets centred on each title line, under the bar's week: a Stepper at max(44px, 40u)
  reading "4 per day", its label ("Exercises a day", "Foods a day") for a screen reader only
  (K56, K62, K63). The week beside the titles is left out there. An item is added in its dialog and changed
  in its dialog or on its page (Add or Edit exercise, Add or Edit food; K54, K64), so rows have no Stepper; the remove button ends each
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
  `foodPick`). **Daily goal** (K85), `dailyGoal` beside them, turns all of it off: while it is
  false both grids get no met days and Edit plan shows no Stepper, and the picks are kept. Like
  `goals`, a tab sends it only once it knows it (from the server, its cache or the person):
  `PortableSettings.dailyGoal` is optional, absent reads as on, and the API keeps the saved value
  when it is absent, so a cache from before it can't switch it back on. The sections have no weekly figure (K31), Settings no totals switch (K32), and the grids no Week
  column (K33). The Header has a Full screen button where the browser supports one (K34).
- **Print is the light theme on white paper, from either theme** (§6.7).
- **Narrow screens.** Folded (held upright under 1000px wide, or under 760px wide), the navbar
  puts the week across its first row (by CSS order) and shares its second row equally among the
  BarActions, This week first when shown. There is no wordmark on any screen (K81). Below 640px
  it drops Print…. The markup keeps the desktop order, which is the
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
  block is unlayered on purpose: the page sizes of Settings, an item's page and the dialogs (K51,
  K65, K55), scoped to `:is([data-slot='settings-page'], [data-slot='item-page'],
[data-slot='dialog'], [data-slot='confirm-dialog'])` and keyed on the primitives' `data-slot`
  names, so it beats their fixed utilities there and nowhere else. After it, one rule gives the item
  page's notes field NoteEditor's skin: a `tile` fill and the italic serif at the page's text size
  (`--set-text`), at least 240u tall. Numbers use `tabular-nums`. The fonts are the Fontsource variable
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
with `cycleDay` and `nextMark` (`src/lib/tracker.ts`) over `cycleFor(type, markSet)`, which reads
the type's `cycle` from the registry. The cycles live in `src/lib/trackerTypes.ts`, and `tracker.ts`
re-exports them. In the squiggles `EXERCISE_CYCLE` is every mark, drawing first, and `FOOD_CYCLE`
the three green ones; in a symbol set the plain kinds once (`EXERCISE_KIND_CYCLE`,
`FOOD_KIND_CYCLE`). A squiggle drawing there steps on from its kind.
`isDone` and the totals count every kind. [brand.md](brand.md) §4 has the values.

### 6.3 The primitives

`src/components/ui/<name>/` holds the shared components, one folder each with the `.vue` file and
an `index.ts`. They are shadcn-vue (K1): owned source on Reka UI, added with the shadcn-vue CLI
(`components.json`: the Lucide icon library, `src/styles/main.css` as the stylesheet) and restyled
to the tokens and the cards. `cn` (`src/lib/utils.ts`) merges a consumer's classes over a
component's own.

| Group    | Primitives                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basics   | Button (primary, secondary and quiet, 44px tall, `sm` 36px from 640px up), IconButton (44px, a required `label`), TextLink, BrandMark, BarAction (the Header's actions, K47)  |
| Forms    | TextField, TextArea, SegmentedControl, Switch, Stepper, RadioCard                                                                                                             |
| Overlays | Dialog, ConfirmDialog with ConfirmHost, Popover                                                                                                                               |
| Planner  | DayMark, Chip, SectionHeader                                                                                                                                                  |
| Feedback | InlineMessage, Banner                                                                                                                                                         |
| Ask      | Transcript (the turns in rows, answers through `answer()` in `src/lib/markdown.ts`), AnswerProgress (main.css's `pen-write` keyframe), QuotaChip, SidePanel (S1), HistoryList |

The other cards are composed in the screens: Header in `AppNavbar.vue`, Panel in `AuthCard.vue`
and `ImportPrompt.vue`, WeekGrid in `TrackerGrid.vue` and `TrackerRow.vue`, PlannerScreen in
`ExerciseGrid.vue` and `DietSection.vue` (the class lists in `src/lib/screens.ts`), SettingsPage in
`SettingsPage.vue`, ConnectionsSection in `ConnectionsSection.vue`, ConnectPage in `ConnectPage.vue`. Icons are `@lucide/vue` at a 1.5px stroke, `aria-hidden` beside words. A
primitive's colour transitions last 120ms at most, stop under `prefers-reduced-motion`, and name
the properties they animate, so the focus ring never fades in.

### 6.4 Confirmations

`useConfirm()` (`src/composables/useConfirm.ts`) asks a yes-or-no question and returns a promise:
true for the verb, false for Cancel or Escape. One `<ConfirmHost />`, mounted once in `App.vue`,
shows the open question in a ConfirmDialog (Reka's AlertDialog). A newer question answers an older
one false. `returnFocus` names where focus goes on closing when the control that asked has gone, as
after a removal. Removing a row (`TrackerRow`) asks this way. Sign out uses a ConfirmDialog of its own on the Settings page, because it shows the
unsynced count, a busy state and an error. So do the Ask page's two deletes (one conversation,
or all): Cancel returns focus to the bin that asked (its `data-history-delete`), and a delete moves
it to the next conversation's bin, else to New conversation.

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
- **Widgets.** A day cell's focus is its DayMark, and a name cell's is the name's link. Space and
  Enter belong to the DayMark. Enter on a name follows the link, opening the item's page in one
  press, and Space on it does nothing.
- **Keys.** Arrows move cell by cell over the names and days, and never
  wrap. Home and End go along the row, Ctrl+Home and Ctrl+End to the grid's ends. An `aria-hidden`
  cell is skipped.
- **Controls in a cell.** The other controls in a cell (the note's button, and in Edit plan the Edit
  button in the name cell and Remove in the last cell) stay out of the Tab order. F2 on the cell
  lets them in, as does Enter on a cell without a widget (Remove's). Tab moves among them, and
  Escape puts focus back on the cell, or on its widget: the name's link, in a name cell.

"Skip to today", first in the tab order in `AppNavbar.vue`, focuses today's first mark in the
first grid that has today. Tabbing to it brings the navbar into view on the planner's screens.

### 6.6 The planner's screens

`App.vue` puts `planner-screens` on `<html>` while the planner shows outside Edit plan (K27). That
class turns on main.css's `full:` variant. Settings and an item's page are ordinary pages that
scroll, so neither has it. With it, each section is a screen (`SCREEN` in
`src/lib/screens.ts`: the window's height less the fixed week's `--week-band`, a centred column,
and `data-planner-screen`) and its grid takes the height left (`SCREEN_GRID`). WeekHeader, before
the sections, is the fixed week: `sticky` at the top on the canvas, so the screens move under it
(K88). `bandHeight()` measures it while it is sticky, and the sprint takes it off the window's
top, so each screen rests just under it. `useScreenSprint` (`src/composables/screenSprint.ts`) keeps the
page from resting across two screens. A wheel or a fling sprints as soon as the line between two
screens is a step (4% of the window, at least 16px) inside it, while it is still moving (K45); a finger on the
screen waits until it lifts; a scrollbar drag or the keyboard 120ms after the scroll stops (K38).
`sprintTarget` picks the place, in the direction of travel, and `sprintTo` moves there in 260ms,
eased out, setting the position each frame so a fling's momentum can't carry the page past it. A
push moves one screen (K94, K95). Once a wheel gesture (events less than 150ms apart) has moved
one, it is `spent` and its momentum is swallowed, but `MomentumWatch` still looks for a new push
in it: steps that fall below 70% of their peak and then rise twice, or a mouse wheel's click after
100ms of silence, judged by speed (px a ms) so steps the browser sends merged mid-sprint can't
pass for one. A new push moves on once the sprint has landed; nothing queues while one runs (K96). A wheel the other way stops the sprint and scrolls back (K89). After a resize or rotation, the page
settles on the screen that fills more of the window (K40). It replaced `scroll-snap-type: y mandatory`, which a mouse wheel couldn't
cross from the end of a tall screen. On a touch screen (`(hover: none) and (pointer: coarse)`) the
script stands aside and main.css snaps instead (K98): `mandatory` with `scroll-snap-stop: always`, so
one swipe moves one screen and iOS keeps its own momentum. The script still wraps round and runs
the arrows there, turning snapping off while it moves (`touchSnaps`, `snapOff`). Four custom variants in main.css carry
the layout, all screen-only so paper keeps the table: `screen:` (the WeekGrid is a CSS grid),
`full:`, `folded:` (upright under 1000px wide, or under 760px wide) and `short:` (landscape, 540px
tall or less).

- **Sizes follow the screen.** `--u` in main.css is 1 at 1280×800, clamped between 0.75 and 1.6.
  The named sizes (`--fs-name`, `--grid-name-w`, `--screen-pad-x`, …) derive from it, and folded
  they switch to `--n` (1 on a phone, up to 1.4). Components set `text-(length:--fs-name)` beside a
  type class, so the class keeps the font and weight and the size follows the screen. The other
  families: `--bar-*` sizes the Header and its BarActions (K47); `--set-*` the Settings and Ask
  pages' and the dialogs' type and controls (K51, K55); `--edit-ib`, `--edit-ib-icon`, `--grid-edit-w` and
  `--grid-remove-w` Edit plan's row buttons and their columns (K54). Outside the planner's screens
  (Edit plan) `--grid-row-min` and `--grid-row-max` are a fixed max(76px, 100u), since that page
  scrolls rather than filling the window.
- **The grid.** `TrackerGrid` makes the table `display: grid` with its row groups and rows
  `display: contents`, so the cells place themselves and gridNav still walks `table.rows`. Rows
  share the height (`minmax(--grid-row-min, 1fr)`), and a `max-height` stops them at 1.25 × a day's
  width. Each day cell is a size container that `DayMark fill` fills (86%, up to 128px). Folded,
  each `TrackerRow` sets `--line-row` and `--box-row`, the two grid lines it takes. There is no
  band for today (K36).
- **The navbar.** `useBarReveal` (`src/composables/barReveal.ts`) listens on the document for a
  long press (K79: 500ms, within 10px, primary button). `AppNavbar` turns it into a toggle of
  Edit plan, from the screens and from Edit plan alike, and the handle button (wherever a coarse
  pointer is present; out of the Tab order) into Edit plan on (K80). Edit plan's bar is sticky, so
  the page sits below it and it covers nothing. The only floating bar left is `focus-within`,
  which slides the fixed bar over the screens for the keyboard; Escape takes focus out of it. A
  long press arms a capture-phase `click` guard on `window` that swallows the click ending it, so
  the held cell or button is not pressed; the guard lapses on the next `pointerdown`, any key, a
  window `blur` or a hidden page, or 300ms after `pointerup`, since a touch hold may end with no
  click. A finger's or pen's hold has its `contextmenu` prevented. A press in a field, a popover,
  `[role="dialog"]` or the bar starts no hold, and `html.planner-screens` turns off text selection
  and the iOS callout outside fields, popovers and dialogs. The bar is moved out of view with a
  transform, never hidden, so its controls stay reachable by Tab.
- **The arrows between the screens** (K42, K90). A chevron IconButton at the foot of each screen
  but the last, and one pointing up on each screen but the first, on its title's line just under
  the fixed week. Exercises has "Go to Cardio"; Cardio has "Back to Exercises" and "Go to Food";
  Food has "Back to Cardio". Each sprints to its screen's top with `sprintToScreen`, by the
  heading's id. A short screen leaves them out.
- **Settings and Ask** are pages of their own (`#/settings`, `#/ask`), outside the screens and with
  no bar (K52): each starts with "Back to the week", and leaving one returns focus to the bar button
  that opened it. Ask fills the window (K67, K70): the SidePanel (`h-dvh`) and the page beside it
  scroll on their own, the page in Settings' rows at about 70% of its sizes (K83:
  `[data-slot="ask-page"]` in main.css sets smaller `--set-*`, `--set-caption`, `--fs-title`,
  `--side-panel-w` and `--ask-q-col`), with the question box as the last row, at the page's left
  edge with nothing beside it. A SegmentedControl named "View" at the end of the title line
  chooses the Transcript's `view` (K84): Document, the default (rows, layout A), or Conversation
  (one centred 760u column, questions in tiles at the right); `localStorage`
  `tracker-ask-view-v1` keeps it per device. Folded, the panel is a
  drawer opened from beside "Back to the week". `#/ask` shows the week while `session.ask` is not
  `true`, and drops the address once it is `false`; signing out on either page drops it too.

### 6.7 Print

The `@media print` block in `main.css` gives a landscape sheet in the light theme's colours on
white paper from either theme (K16). It re-points the roles at the light theme's values, the only
literal colours the system allows (`src/styles/__tests__/print.spec.ts` holds them to
`tokens.json`): words, boxes and marks keep their light colours, chips are outlined, and `--canvas`,
`--panel` and `--tile` go transparent. Shadows and transitions are off.

- Anything marked `data-noprint` is hidden: the navbar and its handle, the arrows between the screens, the sync status,
  the import prompt, Edit plan's controls and Add buttons, and a section's hint line if it has one. Dialogs, the
  popover and Banners carry `print:hidden`.
- Each section prints on a page of its own (`print:break-before-page` on Cardio and Food, K97),
  under the week in display: SectionHeader's `week`, shown only on paper. The page's `<h1>`
  (WeekHeader) stays for a screen reader but doesn't print.
- A met day's name keeps its `pen` and its underline (K60). A table split across pages repeats its
  header.
- The Cardio and Food sections' headings stay with their grids (`print:break-inside-avoid`), and a
  section header never ends a page (`print:break-after-avoid`). Cardio prints after Exercises and
  before Food, set apart by a rule, as Food is.
- An item's page prints its head (the type, the name and its chips), its notes and its filled
  details, each detail as its label over its value with no box. Back to the week, the plan, Recent
  weeks, the notes' field and its button are `data-noprint`, and each row prints its heading over
  its content, with no rule. The
  notes print as read even while they are being edited. In the week, a name's link prints as plain
  text.

### 6.8 The style guide

`src/styleguide/` is the living style guide (K2): every primitive and planner component rendered by
its real source, in each state. `src/main.ts` mounts it instead of the app at `/styleguide` when
`import.meta.env.DEV` is true, so a production build drops it. The page's Theme menu sets the same
`.dark` class the app does (`src/styleguide/look.ts`), and the address carries it
(`/styleguide?theme=dark`), so a browser test can open either theme.
Each section is one entry in `src/styleguide/sections.ts`. Coverage excludes the folder, and the
browser checks run against it.

The RecentWeeks section draws the card's eight weeks in two mark sets. The ItemPage section renders
the app's own `ItemPage` with `example` set, so it doesn't take focus as it arrives. ItemPage reads
the stores, so the section sets up a Pinia of its own with the card's items, and edits there save
nowhere. It shows one state at a time, chosen with a SegmentedControl, because two pages on one
screen would repeat the same named regions, which axe's `landmark-unique` rule fails. The WeekGrid
section's key
table names Enter on a name (opens its page) and F2 (into the cell's other controls).

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
email, and only then links "Forgot your password?" to `#/forgot`. The session store asks again
after every sign-in and when the browser comes back online, for the `ask` flag too (§3). That form posts the email and
then always says a link is on its way if there is an account, whatever the server found. The
account the API returns on sign-in and from `/auth/me` carries `confirmed` for an email account
while mail is on; the session store keeps it, and `EmailStatus` shows the confirm banner while it
is false, with "Send it again" (`POST /api/auth/confirm/resend`). A confirm link,
`#/confirm/<token>`, opens `ConfirmEmail` whether or not anyone is signed in, ahead of every other
screen; it posts the token, clears the fragment once used or dead, and, when the link was for the
signed-in user, ends the banner. A connect link, `#/connect/<id>`, works the same way for
`ConnectPage`: it shows signed in or out, comes ahead of every other screen, and survives a
sign-out, so the person arriving from Claude never loses the request. The page never creates a
session: approving takes the account's email and password, even when signed in. A mailed reset link is the same `#/reset/<token>` as before. Signing out ends the server
session, then deletes the user's cache and outbox from the device. It is refused while offline: the
cookie is HttpOnly, so only the server can end it.

**One user per tab, always.** Every read and write sends `X-Expected-User` with the user the tab
shows, and the API refuses any other with 401 (`api.md` §3). A tab left open as one person can then
never read or write the account of someone who signed in afterwards in another tab: the cookie is
shared, the name is not. The session store also follows `storage` events on the session key, so
when another tab signs out or in as someone else, this tab stops syncing, clears the stores, and
follows. Every request gives up after 15 seconds and counts as offline, so one dead connection
cannot stall syncing; replies that arrive after a sign-out or a user switch are ignored. A
`DELETE` sends no body but still sends `Content-Type: application/json`, which the API asks of
every write.

**Ask's stream** (`api.md` §3.2). `stream()` in `src/lib/api.ts` posts the question with `fetch`
and reads the reply's body with `getReader()`, since `EventSource` can't post. It splits the
server-sent events at blank lines, wherever the chunks break, skips `:` comments (the 15-second
keep-alives) and frames whose data isn't a JSON object, and hands each event to the store in
order. A refusal before the stream maps exactly as `request` maps it (one `errorFor`), so 503
`ask-off` is a refusal and a 503 from the proxy is offline. The stream ends well only at `done` or
`error`. Ending without either, a dropped connection, or 30 seconds with no frame at all
(keep-alives count) is `cut`: a proxy that cuts a stream still answered 200 (W5's C3). Stop aborts
it as `stopped`. Either way the reader is cancelled, so the request closes and the API stops the
answer and keeps the question. Before asking, the store awaits `sync.flush()`: marks still in the
outbox aren't on the server, so the page says how many the answer won't include (F11).

**Writes.** The stores change state at once. A deep watcher in the sync store diffs their state
against `base`, the state the server is known to hold, and turns each difference into an operation
in the outbox:

- `plan`: a week's plan, sent as `PUT /api/plans/<section>/<week>` with the revision last seen;
- `tick`: one day of one item and its mark (or `null`), `PUT /api/ticks/…` with `{ "mark": … }`,
  so devices marking different days never collide. An outbox saved before marks had kinds holds
  `done` instead; it is read as `"great"` or `null` on load;
- `details`: one item's details, sent as `PUT /api/details/<section>/<item>` with
  `{ details, rev }`, the revision last seen (`detailRevs`). Clearing them sends `{}`. An item
  whose id holds `/`, or is `.` or `..`, can't be named in that path, so it has no details
  (`isDetailsId`, below);
- `settings`: the accent, both daily picks, My goals and the item pages' arrangement,
  `PUT /api/settings`. The goals go only when `goalsKnown`; a body without them keeps the saved
  ones on the server.
  `itemSections` always goes, `{}` for the default: the API keeps the saved arrangement when the
  key is missing (a tab on older code), so leaving it out could never reset one.

`send()` is a switch with a branch per kind, and a kind without one fails to type-check
(`unhandled(op: never)`). Before 2026-11-01 anything that was not a plan or a tick went out as
settings, which a fourth kind would have done silently. `isQueued` checks each kind's own fields,
so an outbox entry of another kind, or with a section outside the registry, is dropped on load.

A newer operation for the same plan, cell, item's details or settings replaces a queued one. Each
carries an id, so the reply to one already in flight removes only that one. Plan, details and
settings operations read their values when sent, so the server always gets the latest. Operations
go out one at a time, in order. A tick on a week with no plan of its own creates the plan first, as
on the device.

**Details wait for the typing to pause.** Notes save as you type, so a details operation is queued
and cached at once, then held for `DETAILS_DELAY` (1 s) after its item's last change, and sent once
with the latest text. A reload in that second keeps the edit, since it is already in the outbox.
Other operations go past held details, because nothing depends on an item's details being sent
first. An import sends held details at once, so the server merges against them. A read in that
second (focus, the minute timer) finds the outbox busy and skips `GET /api/state`; it is marked
pending (`readPending`), and runs once the held details are sent and the outbox is empty.

| Reply                                               | What happens                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| success                                             | dequeued; a plan's or details' new revision is stored                                                                         |
| 409 with the server copy                            | that week shows the server's plan, or that item the server's details, with a notice                                           |
| 409 with no server plan or details                  | sent again as a create                                                                                                        |
| offline, a timeout, or a 5xx with no API error code | kept; retried after 5 s, doubling to 60 s, and at once when the browser is back online                                        |
| 404 to a details write                              | kept and retried as for a 5xx, holding the operations behind it (below)                                                       |
| 401                                                 | kept; the sign-in form appears, and sending resumes after signing in                                                          |
| any other refusal                                   | dropped, so one bad write cannot block the rest, with a notice that it was undone (for 413 `quota`, that the account is full) |

Two devices creating the same week from the same carried plan send identical items, which the API
accepts without a conflict (P7 in [decisions.md](decisions.md)), so the common case raises no notice.
Details follow the same rule.

**A details conflict** brings the server's copy in: the sync store writes it into `base` first, so
adopting it is no change to send back, then `adoptItem` puts it in the details store. A cleared copy
(`{}`) reads as no details. A write lifted from a `-v3` cache (§4) is the exception: a 409 at rev 1
is migration 7's copy of the old note, so it is sent again at rev 1 instead. `SyncStatus` shows `DETAILS_CONFLICT_NOTICE`: "An item's notes or
details were changed on another device, so this device now shows that version." An item page open
on that item takes the server's copy into its field instead of overwriting it on the next keystroke.

**A 404 on a details write** comes from an API older than details, which has no such route. The web
image can land before the API's (P28), so the write is treated as a server failure: kept, retried
with the backoff, and holding the outbox behind it. Dropping it, as for any other refusal, would
lose the notes typed while the API was behind. The API must therefore deploy first
([deployment.md](deployment.md) §3.1). A 404 to any other write is still dropped.

A write that would 404 for good must therefore never be queued: it would hold the outbox forever.
That is a details write for an id the path can't name. Starlette decodes `%2F` before routing, so
`PUT /api/details/exercise/a%2Fb` gets 404 `not-found`, and the browser folds `.` and `..` out of
a path. `isDetailsId` (`src/lib/storage.ts`) is `isItemId` without a `/` and not `.` or `..`. The
details store's setters refuse any other id (false, so nothing is queued), and the item page and
the edit dialogs say "This item’s notes can’t be saved: its id has a slash in it." (or "…details…",
or "its id isn’t one the server takes" for the rest). A `-v3` lift queues nothing for one, and
`sendDetails` drops one already queued by older code as refused. The API's details route refuses
the same ids with 400 `invalid` (`check_details_id`, [api.md](api.md) §3). The app makes no such
id: `newId()` is `x` and base36, and MCP's are made the same way. Only an import or a plan from
elsewhere can carry one; plans and ticks keep any id of 1 to 128 characters, so its plan and marks
still work.

**Reads.** `GET /api/state` runs at start, on focus, on returning to a visible tab, and every minute
while visible. It replaces local state only when the outbox is empty, and only if nothing changed
locally while the read was in flight. A read first diffs the stores against `base` itself, because
Vue runs the watcher after a reply can already have landed. Without that, an edit made in the same
tick as the reply would be overwritten before it was ever queued. A refresh therefore never undoes
an edit that has not reached the server.

**The cache** holds the last state the stores showed, with each plan's and each item's details'
revision, so a reload or a
cold start offline shows data at once. It is written on every change and every read. Another tab's
write to it arrives as a `storage` event, and this tab adopts it as both its state and its `base`:
that tab's own writes are already in the shared outbox. Adopting it also counts as a local change,
so a read this tab already had in flight cannot overwrite it. Adopting never writes the cache back:
a tab still open on older code words the cache differently (before K57 its settings had no
`foodPick`, and before My goals no `goals`), and a write-back would set the two tabs echoing it
between them, each undoing the other's marks as they were made.

**My goals and older tabs (F1).** A tab from before My goals neither reads nor sends them. Three
rules keep its writes from erasing them. The API keeps the saved goals when a settings write
leaves them out. `normaliseState` keeps `goals` only when a cache or reply carries them as text,
so adopting that tab's cache keeps the goals this tab has. And a tab that has never read them
(it started from that tab's cache, offline) sends and caches settings without them until a
read brings them. The diff compares the goals, so an edit to them is sent. The Settings row
follows the same rule: its box takes typing only once the goals are known, or once a read from the
server found an account with no settings at all (a new one, whose goals are empty), and it saves
its draft when typing pauses for 600 ms or the box loses focus, so one pause is one write (F18).
Goals that change elsewhere show in the box unless the person is mid-pause. The cache is validated with the
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
