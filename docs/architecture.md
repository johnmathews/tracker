# Architecture

> Purpose
>
> How the planner is put together: the component tree, the Pinia stores, how data syncs with the
> API and what stays in `localStorage`, the decisions that depart from the design prototype, how
> the design system reaches the screen, and how programmes are built on trackers.

## 1. Overview

A Vue 3 SPA with accounts. The API service in `api/` ([api.md](api.md)) holds each user's data, and
the app syncs with it through the same origin (§7). Three Pinia stores hold what the app shows:
`planner` (the visible week, the mode, the mark set and the settings), `trackers` (the account's
trackers and, per tracker, its plans and log, which take their week from `planner`; K123) and
`details` (each item's notes and fields, one copy for every week, by tracker, §3). Two more run the
account: `session` (who is signed in, and whether the API sends email and answers questions) and
`sync` (the per-user cache, the outbox of unsent writes, and reads). A sixth, `ask`, holds the Ask
page's conversation and history (§3), read through `request` and `stream` in `src/lib/api.ts`;
`src/lib/ask.ts` holds the page's words. A seventh, `programmes`, holds the programme library and
each programme run the page or the overview has read; `src/lib/programmes.ts` holds its types and
wording, and `sync` carries the server's `today` and the account's `runs` (§8). Every tracker tracks the same thing, a mark per day
against a weekly goal, through the pure helpers in `src/lib/tracker.ts`.

**Tracker kinds.** `src/lib/trackerTypes.ts` is the registry of tracker kinds: `strength` (the
old `exercise` type, K123), `cardio`, `food` and `mobility` (K126). A kind is code; a tracker is data, each account's
own (`src/lib/trackers.ts`, below). A tracker's id is the stored name, in URLs, the database, the
cache and the outbox, where the API's paths still call it `section`. The first three trackers keep
the old section names as their ids: `SECTIONS` maps `exercise`, `cardio` and `diet` to their kinds,
and `FIRST_NAMES` names them Strength, Cardio and Food. Each kind gives:

- its name on the new tracker page's Kind control and the two lines under it (`label`,
  `settings`: "Strength", "Log sets, reps, time and weight."; K128), the label of one item and of several (`itemLabel`, `itemsLabel`: "Exercise",
  "Exercises", as in "Exercises a day"), and the Add button's words (`addLabel`: "Add exercise",
  "Add cardio", "Add food", and "Add exercise" again for mobility, K140);
- the plan fields an item has (`plan`: an exercise's for strength and mobility, cardio's or a
  food's) and whether an exercise's plan has a weight (`weighted`: strength only);
- the marks a press steps through in each mark set (§6.2);
- the chips under a name (`exerciseDetails` lives here, and `planner.ts` re-exports it;
  `cardioDetails` gives a cardio item's time, then its distance: "30 min", "5 km");
- the item page's fields, by key and label (strength and mobility: Equipment, Works, Link; cardio:
  Route, Link; food: A serving, Examples);
- the daily target a new tracker of the kind starts with (`dailyTarget`: 3 for strength and
  mobility, none for cardio, 2 for food), the setting the first tracker of the kind keeps it in
  step with (`pickKey`: none for cardio and mobility), and a new item's goal;
- the normaliser its plan items go through (`normalise`; `normaliseMobility` is an exercise's
  without the weight).

`api/src/tracker_api/types.py` holds the same registry, and `fixtures/types/registry.json` keeps
the two in step: `trackerTypes.spec.ts` and `test_types.py` both read it. `defaultItems` gives the
items a tracker with no plan shows: today's default exercises and foods, on the `exercise` and
`diet` trackers only; every other tracker starts empty.

**Trackers** (K123, the spec `docs/specs/2026-11-14-account-trackers.md`). `src/lib/trackers.ts`
holds a tracker's shape, `{id, name, kind, position, dailyTarget, startWeek, endWeek}` (`Tracker`
adds the `rev`), and its rules, as the API's: `normaliseTracker` and `normaliseTrackers` (a URL-safe
id, a kind the registry has, the first three ids their own kind, a name of 1 to 60 characters, a
position from 0 to 10,000, a daily target of 1 to 8 or none), `showsIn` (a tracker shows in week W
when `startWeek <= W` or it has none, and `endWeek > W` or it has none), `inOrder` (by position,
then id), `nextPosition` and `firstTrackers`, the three as the API's migration made them.

**The item page.** `src/lib/routes.ts` reads and writes the item page's address,
`#/item/<tracker>/<id>`, and the new item page's, `#/new/<tracker>`; it checks their shape only, and
App checks the tracker against the loaded trackers once sync has loaded. `NEW_TRACKER_HREF`
(`#/new-tracker`, K124) is the new tracker page's address. It does the page's Back (`backToWeek`) and the Link field's site (`webHost`).
It also holds the Settings tabs' addresses (K119): `SETTINGS_TABS`, `settingsHref` and
`parseSettingsHash`, which reads `#/settings` as the first tab and returns null for a tab Settings
doesn't have.
`src/lib/history.ts` gives an item's recent weeks (`itemHistory`) and its latest plan
(`latestPlanWith`), from the log and the plans. `src/composables/itemSource.ts` reads a
tracker's plans, log and goal action from the trackers store, for the page and for the route that
checks the item exists.

**The item page's sections** (K66, P29). `src/lib/itemSections.ts` holds which of the page's
sections (`notes`, `details`, `plan`, `history`) each type's pages show, and in what order:
`{order, hidden}` per type id, every key once in `order`, `hidden` a subset in the default order.
The default order is `plan`, `notes`, `details`, `history` (K104 put the plan first).
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
(`src/composables/fullscreen.ts`, the browser's full screen). The Profile page and the bar's profile
menu share `useSignOut` (`src/composables/signOut.ts`: sign out at once, or ask first while changes
are unsent), and the Profile page's two notes share `useNoteDraft` (`src/composables/noteDraft.ts`:
a draft saved when typing pauses for 600 ms or the box loses focus, editable only once the note is
known).

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
and `Popover` primitives) take props, emit `toggle`, and serve every section. They are the same in
Edit plan: no Remove column (K120).
`TrackerGrid` runs the grid's keyboard model (`useGridNav`, §6.5) and links each name to its item's
page, the one place an item is renamed or removed. `TrackerSection` wires them to the trackers
store, one per tracker the week shows (K123), and its Add button opens the new item page (K104).
The item page and the new item page share the plan's controls, `PlanFields.vue`, which shows the
fields of the kind's `plan`, and an exercise's Weight only for a `weighted` kind. It takes an
exercise's field state and input cleaning through
`useExerciseForm` (`src/composables/exerciseForm.ts`) and the `PerSideToggle` segmented control,
and a cardio item's Minutes and Distance in km through `useCardioForm`
(`src/composables/cardioForm.ts`), which stores the minutes as seconds. `planErrors.ts` (in
`src/composables/`) says when a number is over its limit, and `src/lib/itemPage.ts` holds the two
pages' row and column classes. `src/lib/problems.ts` turns a sign-in, sign-up, link or
sign-out refusal into a sentence for the forms, and `describeConnectProblem` does the same for the consent screen; `src/composables/importSummary.ts` says what an import would add,
for Settings → Import… and the first-login prompt.

```
App.vue                 picks the screen (a link, planner, Settings, an item's page, the new
│                       item page, the new tracker page, Ask, sign-up, reset or sign-in), the .dark class, clock
│                       refresh, sync triggers (focus, visibility, online, minute tick,
│                       storage), the planner-screens class (§6.6), the one ConfirmHost, and
│                       H or B for back and L for forward on every page (K105)
├── ConfirmEmail.vue    a confirm-your-email link (#/confirm/<t>), signed in or out: confirms it
├── PasswordForm.vue    an invite or reset link (#/invite/<t>, #/reset/<t>): choose a password
├── SignupForm.vue      #/signup: email and password twice; field and form-level refusals
├── ForgotForm.vue      #/forgot: an email; then the same words whether or not it has an account
├── LoginForm.vue       email and password; explains refusals; notes an ended
│                       session; links to #/signup, and to #/forgot where the API sends email
│   (all five inside AuthCard.vue: a centred Panel with the BrandMark)
├── AppNavbar.vue       the Header card: Skip to today and a hidden Edit plan ("Done" in Edit
│                       plan) for the keyboard; ‹ the week › first, as the page's title (K81),
│                       by its dates or its number (K131), and "View current week" after the › while
│                       another week is on screen (K130); then the BarActions Ask (only while the API answers
│                       questions), Add tracker (in Edit plan only, K124), Settings, Programmes (K160), Print…
│                       and Full screen (useFullscreen, where the browser has one), both left out
│                       below 640px wide (K160), and Profile, which opens the profile Menu: Signed in
│                       as, Profile and Sign out (useSignOut, K106); the week's keys E, Esc,
│                       F, P, S and A, ← and → (useShortcuts, K91, K109, K133); full width, sized by main.css's --bar-* (K47, K49); on the
│                       planner's screens out of sight until a long press or the handle opens
│                       Edit plan (useBarReveal, §6.6)
├── ConnectPage.vue     an OAuth consent link (#/connect/<id>, K73), signed in or out: who is
│                       asking, email and password, Read only or Read and change, Cancel and
│                       Connect; then leaves for Claude's callback
├── SettingsPage.vue    the SettingsPage card, at #/settings: Back to the week, then a tab per
│   │                   section (K119, the Tabs primitive), each at #/settings/<tab>:
│   │                   Appearance (Week title, Marks, then Theme, K136), Daily goal (K85),
│   │                   Your data (Export and Import…, see §4) and Connections
│   └── ConnectionsSection.vue   the Connections row (K74): the MCP address with Copy and how to
│                       connect Claude, the Apps connected by OAuth, and the personal Tokens
├── ProfilePage.vue     the ProfilePage card, at #/profile (K106): Back to the week, then Account
│                       (who is signed in, Sign out through useSignOut), Your goals and Your
│                       limits (K107), each a TextArea that saves when typing pauses
│                       (useNoteDraft, F18)
├── AskPage.vue         #/ask (K67–K71, K83, K84): the SidePanel with the HistoryList, and
│                       beside it Back to the week, the title with the View switch (Document or
│                       Conversation, kept per device), the Transcript and the question box with
│                       the QuotaChip; deleting asks in a ConfirmDialog of its own
├── ItemPage.vue        the ItemPage card, at #/item/<tracker>/<id> (K64, K65): Back to the week
│   │                   and Arrange sections, the type, the name with its pen (renaming in
│   │                   a field in the title's type, K121) and its chips; then rows like
│   │                   Settings: the week's plan (or the latest, read-only), Notes, Details
│   │                   and Recent weeks, as the type's arrangement shows them (K66, K104);
│   │                   Remove last, in both modes (K120)
│   ├── PlanFields.vue  the plan's controls: an exercise's (a mobility item's without Weight), a
│   │                   cardio item's or a food's, with Times a week
│   ├── RecentWeeks.vue the RecentWeeks card: up to eight weeks, newest first, a met week's count
│   │                   in pen
│   └── ItemProgramme.vue  a programme activity's plan row (§8, K145): the step chart and the
│                       activity's controls, in place of PlanFields
├── NewItemPage.vue     the new item page, at #/new/<tracker> (K104): Back to the week, Cancel and
│                       the kind's Add ("Add exercise"); "New exercise" and the Name field; then the plan
│                       (PlanFields), Notes and Details as the type's arrangement shows them;
│                       nothing saved until Add
├── NewTrackerPage.vue  the NewTrackerPage card, at #/new-tracker (K124): Back to the week, Cancel
│                       and Add tracker; "New tracker" and the Name field; Kind, a
│                       SegmentedControl of the registry's kinds with the chosen kind's line;
│                       Starts, "This week, empty."; Add tracker adds it last, from the week on
│                       screen (K125), and goes back with focus on its Add
├── ProgrammesPage.vue  the Programmes page, at #/programmes (§8, K147, K161): the Started,
│                       Library and Add tabs; Preview and start opens in place in the library
├── ProgrammeOverview.vue  a run's overview, at #/programme/<tracker> (§8, K142, K148): the
│                       plan in ProgrammeGrid, the Changes tab with Undo and the ChangeSheet
├── SyncStatus.vue      loading, offline and conflict Banners above the planner
├── EmailStatus.vue     "Confirm your email." Banner, with Send it again, until it is confirmed
├── ImportPrompt.vue    this browser's log from before accounts, offered once (§7)
├── WeekHeader.vue      the page's h1, the week ("19–25 October"): on the planner's screens a band
│                       fixed at the top, with a hairline once a screen is under it (K88); visually
│                       hidden in Edit plan, on a short screen and on paper, where each
│                       SectionHeader prints the week over its own page (K97); by its dates or
│                       "Week 46" (K131); on another week, "View current week" after it, or under it when folded (K130)
└── TrackerSection.vue  one per tracker the week shows, in position order (K123): its
    │                   SectionHeader with the tracker's name; in Edit plan the pen (renaming
    │                   in a field in the title's type, Enter or Done saves, Escape restores),
    │                   the daily target's Stepper ("Exercises a day", from the kind's
    │                   itemsLabel) centred while Daily goal is on and the kind has a target
    │                   (K62, K85), then the kind's Add and Delete tracker (K113, K122); on the
    │                   screens "Back to <previous>" on its title line and "Go to <next>" at
    │                   its foot (K42)
    └── TrackerGrid.vue a <table> (WeekGrid card): day names, one TrackerRow per item, the
        │               kind's chips, and the days that met the tracker's daily target
        └── TrackerRow.vue  name (a link to the item's page) and chips on one line, the
                            item's notes under them, from the details store (a button
                            opening a Popover, K43); 7 × DayMark, the same in
                            Edit plan (K120)
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

`usePlannerStore` is a setup store. It keeps what is app-wide: the week, the mode, the mark set and
the settings.

| State                         | Kept by                                   | Notes                                                                       |
| ----------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `accent`                      | the sync store: server and per-user cache | default `#30d158`. The accent is kept but draws nothing (K13)               |
| `goals`, `goalsKnown`         | the sync store: server and per-user cache | My goals, `''` by default; Ask and the MCP read them. `goalsKnown` is below |
| `limits`, `limitsKnown`       | the sync store: server and per-user cache | Your limits (K107), `''` by default; read and sent like `goals`             |
| `dailyGoal`, `dailyGoalKnown` | the sync store: server and per-user cache | Daily goal (K85), `true` by default; sent only once known, like `goals`     |
| `weekTitle`, `weekTitleKnown` | the sync store: server and per-user cache | Week title (K131, K132), `dates` by default or `number`; sent once known    |
| `itemSections`                | the sync store: server and per-user cache | each kind's item-page arrangement (K66); `{}` is every page as it comes     |
| `theme`                       | `tracker-settings-v1` (the device)        | `system` (default), `light` or `dark`                                       |
| `markSet`                     | `tracker-settings-v1` (the device)        | `squiggles` (default), `filled`, `ticks`, `stamped-ticks`, `faces`, `stamped-faces` |
| `configMode`                  | no                                        | `false` (normal mode) on every load                                         |
| `weekOffset`                  | no                                        | `0` is the current week                                                     |
| `now`                         | no                                        | a ref so "today" can move; see §5                                           |

The stores start empty (showing the defaults) and never write the user's data themselves. The sync
store fills them with `adopt` and saves their changes (§7).

**Derived:** `monday`, `weekKey`, `currentWeekKey`, `otherWeek` (another week is on screen, so
"View current week" shows; K130), `dates` (the week's dates, with the year when it isn't this one),
`label` (the band's and print's title: `dates`, or "Week 46" by `weekTitle`; K131), `barLabel`
(the same without a year) and `days` (`name` "Thu", `date` "22",
`full` "Thursday 22 October" for the DayMarks' names, `key`, `isToday`, and `isFuture` for days
still to come).

**Actions:** `setConfigMode`, `prevWeek`, `nextWeek`, `thisWeek`, `refreshNow`, `setGoals` and
`setLimits` (normalised as the API stores them; the same text again changes nothing),
`setDailyGoal`, `setWeekTitle`, `setTheme`, `arrangementFor` and `setArrangement` (by kind), `portableSettings`
(the accent and, once known, Daily goal, the goals and the limits, and the arrangement),
`savedSettings` (the same, or null while the user has none of their own), `adopt` (replace the
settings wholesale) and `clear` (forget the user on sign-out, the details store included, keeping
the theme). The daily picks are not the planner's: they are the trackers' daily targets (K123), and
the sync store adds them to the settings it sends and caches.

`useTrackersStore` (`src/stores/trackers.ts`, K123) holds `list`, the account's trackers, ended
ones included, and `data`, each tracker's `{ plans, log }` by tracker id. It reads the planner's
week, so week navigation moves every tracker, and each tracker's plans carry forward as §2 says.
A plan item is a strength item (`{ id, name, sets?, reps, duration?, perSide?, weight?, target }`),
a cardio item (`{ id, name, duration?, distance?, target }`: seconds in all and km) or a food
(`{ id, name, target }`), by the tracker's kind.

- **The trackers:** `ordered` (by position, then id), `shown` (the ones the visible week shows,
  `showsIn`, in that order), `get`, `has`, `kindOf` and `typeOf` (a tracker's kind and its registry
  entry; an id not loaded yet reads as its fixed kind for the first three) and `dailyTarget`
  (the tracker's, null for cardio; the kind's default until the trackers load).
- **A tracker's week:** `plansOf`, `logOf`, `itemsOf` (its own plan, the one it carries forward,
  or `defaultItems`), `markOf`, `isDone`, `totalFor`, `dayCounts`, `grandTotal` and `goalsMet`.
  Totals count only the week's items, so a removed item's history stays in the log without
  inflating the numbers.
- **Changing a week** (the visible week only): `toggle` (the kind's cycle in the device's mark set:
  great, partial and missed in each drawing for strength and cardio, eaten in each drawing for
  food), `changeTarget` (0–7), `addItem` (a name and the fields the kind records, `NewItem`; goal 3
  unless the input names one; the new id, or `null` for an empty name), `updateItem` (keeps the id,
  the history and, when the input names none, the goal; `false` for an empty name or an item not
  in the week) and `removeItem`. An exercise counts reps or time, never both: a duration stores reps
  as 0; sets are whole and at most 20, a weight positive and at most 500 kg; a cardio item's time is
  whole seconds up to 86,400 and its distance km to 2 places up to 1,000, each left out at zero.
- **Changing a tracker:** `createTracker({ name, kind })` (after every other, empty, with its kind's
  daily target, from the week on screen; the id is made here with `newId`; `null` for a blank name
  or past 100 trackers), `renameTracker` (1 to 60 characters), `setDailyTarget` and
  `changeDailyTarget` (1–8; `false` for cardio) and `endTracker` (Delete tracker, K122: it ends
  from the week on screen, and an earlier end stays). Nothing removes a tracker.
- **From the sync store:** `adopt` (the trackers and their data wholesale), `adoptWeek`,
  `adoptTracker` and `clear`.

Food and cardio goals work like exercise goals (met once the count reaches a non-zero goal). A day
turns green once its marks reach the tracker's daily target (K30, K57); cardio has none (K90).

**My goals** are the person's own words about what they are aiming for, and **Your limits**
(K107) what they have to work around: injuries, equipment, time, food. Both are set on the Profile
page and read by Ask and the MCP's `goals` tool. `goalsKnown` turns true once the goals came from
the server, from a cache that carried them, or from `setGoals`. Until then `portableSettings`
leaves them out, so a tab that hasn't read them never sends or caches a stand-in `''` that would
erase the saved ones (§7). Settings that `adopt` receives without `goals` keep the ones the store
has. The limits follow the same rules with `limitsKnown`, `setLimits` and their own key, so a
cache from before them, which carries goals but no limits, can't erase saved limits. Neither
setter debounces: the Profile page commits a box's draft when the person stops typing, so one
change is one write. The module also re-exports
`exerciseDetails` from `src/lib/trackerTypes.ts`, which gives the chips after a name, on its line (K43):
"3 × 12" or "3 × 8 each side" (or "10 reps a set" and "8 each side" without sets, "3 sets" without
reps), "3 × 45 s" or "1 min 30 s each side" for a timed exercise (`durationText` in
`src/lib/words.ts`), then "16 kg" when weighted, and no chip at all for none of these (the Chip
card's words).

`Tracked` (`src/lib/tracker.ts`), the item shape every kind's items share, is `{ id, name, target }`.
It has no `notes`: they are the item's details.

`useDetailsStore` (`src/stores/details.ts`) holds `docs`, each tracker's details by item id, keyed
by tracker id (a tracker with none may have no entry). An
item's details are `{ notes?, fields? }` (`ItemDetails` in `src/lib/storage.ts`): its notes in
markdown, and its text fields by key. A blank key is left out, so `{}` is an item with none, and
the store drops an empty document. The sync store fills it through `adopt` and saves its changes
like the plans (§7). It offers:

- `get(section, id)` (a frozen `{}` when there are none), `notesOf` and `fieldOf(section, id, key)`;
- `canSetNotes(section, id, text)`, which the new item page asks before it adds anything (`id` null
  for an item not added yet);
- `setNotes` and `setField`, which store the document as the API would and return `false`, changing
  nothing, over a limit (§4), over 32 KB, for a bad field key, a 33rd field or an id the API can't
  name;
- `adopt` (every tracker), `adoptItem(section, id, doc)` (one item, from a conflict) and `clear`.

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
| `tracker-cache-v6:<user>`                      | the user's trackers with their `rev`, each one's data by id, and the settings    | yes     |
| `tracker-outbox-v6:<user>`                     | writes not yet sent (§7)                                                        | yes     |
| `tracker-import-v1:<user>`                     | the first-login prompt's answer, `imported` or `dismissed` (§7)                 | yes     |
| `tracker-settings-v1`                          | `theme`, read before first paint by `public/theme-init.js`, and `markSet`       | both    |
| `tracker-cache-v5:<user>`, `-outbox-v5:<user>` | the cache and outbox from before trackers; moved at sign-in onto the first three | never   |
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
A cache from before Cardio reads as no cardio.

The names went to `-v6` on 2026-11-14, when trackers became the account's own (K123). A `-v6`
cache is `{ trackers, sections, settings }`: the trackers as `GET /api/state` lists them, each with
its `rev`, and under `sections` each tracker's `{ plans, log, details, revs, detailRevs }` by
tracker id (`normaliseState`, which drops data for an id with no tracker and reads each tracker's
plans by its kind). The API's state carries each tracker's details and their revisions under keys
of their own; `stateFromApi` moves them into its section, and reads none of the version 5 keys
the API still sends for older tabs. Every older cache holds the first three trackers under fixed
keys: `legacyState` maps it onto them, named, with the daily targets its settings hold, their
revisions not known yet (0). One it can't read is dropped, and the app loads afresh. Every older
outbox names those trackers' ids already, so its writes move as they are and go out as they were
queued: marks and plans made offline on older code still reach the server. A tracker write at
revision 0 that conflicts goes again at the server's revision, since this device never saw one.

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
  the item page and the new item page say "These notes are too long to save" for that case.

The notes render with `src/lib/markdown.ts` (markdown-it, raw HTML off, no images, headings, tables
or rules). The row shows one line of inline formatting, where a link is its underlined text. The
whole note opens in a Popover that scrolls when it is taller than the window, and the item page
shows it whole. Links there open in a new tab with `rel="noopener noreferrer"`. The notes are
edited on the item page, and a new item's on the new item page (K104). The
field counts from 19,000 characters (`NOTES_COUNT_FROM`), and a blank one clears the notes.

`parseSettings` accepts any `#rrggbb` accent (K3a, K13), clamps the daily pick to
1–8, reads My goals with `normaliseGoals` and Your limits with `normaliseLimits` (each trimmed, cut
to 1,000 code points, `''` when blank or not a string), accepts only `system`, `light` or `dark` as the theme and only one of `MARK_SETS`
as the mark set, falling back to the defaults otherwise. Settings saved before the theme option existed
load as `system`, and before the mark set existed as `squiggles`.

**Export and import.** Settings → Export downloads `tracker-YYYY-MM-DD.json` (`sync.exportFile`):

```json
{
  "format": "tracker-export",
  "version": 6,
  "exportedAt": "2026-10-24T09:30:00.000Z",
  "trackers": [
    {
      "id": "exercise",
      "name": "Strength",
      "kind": "strength",
      "position": 0,
      "dailyTarget": 3,
      "startWeek": null,
      "endWeek": null
    }
  ],
  "sections": { "exercise": { "plans": {}, "log": {} } },
  "details": { "exercise": {} },
  "settings": { "accent": "#30d158", "dailyPick": 3, "foodPick": 2, "goals": "" },
  "conversations": [{ "id": "Kq3x…", "title": "…", "createdAt": 0, "updatedAt": 0, "turns": [] }]
}
```

`trackers` lists every tracker, ended ones too, in the week's order and without revisions;
`sections` and `details` hold each one's data by id. `details` maps each item id to its
`{ notes?, fields? }`, without revisions. `dailyPick` and `foodPick` are the `exercise` and `diet`
trackers' targets, kept for a reader from before trackers. `settings` also
carries `itemSections` when a type's item page is arranged (K66); a file's arrangement is
normalised like the cache's, and applies with the other settings only to an account that has none.
The plans, marks and settings are the device's, unsynced changes included. Ask's conversations
live only on the server, so Export reads them from `GET /api/export` (`api.md` §3) and adds that
list; an account with none writes no `conversations` key, and offline the file downloads without
them and says so. The theme is not
exported, because it belongs to the device rather than the person. Import… reads a file through
`parseExport` (`src/lib/transfer.ts`), which rejects anything that is not JSON, has another
`format`, or has a `version` other than 1 to 6 (a version 1 file's `true` days read as `"great"`,
K12; version 4 added notes on plan items, K43; version 5 moved them into `details`; version 6
carries the trackers, K123). Every version reads as `{ trackers, sections, settings,
conversations? }`: a file of version 5 or older has no trackers of its own, and its fixed keys
(`exercise`, `cardio`, `diet`) become the first three trackers' sections. A version 6 file's data
is read for the first three ids and each of its trackers, by that tracker's kind; data under any
other id drops (`parseExport`, the API's `parse_export`; the parse fixtures hold the two to it). My goals
came without a new version, as `foodPick` did: an older reader drops the key, and a file without
it reads as no goals. Your limits (`limits`) came the same way. The `cardio` section came the same way (K90): a file without it reads as no
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
  saved (K72). Its limits do the same with the account's limits (K107).
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
shares), and names the rest: the exercises and foods a day, your goals and your limits (each
filling empty ones counts as a change on its own), and how many conversations from Ask the account
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
  lights, a framed window on a backdrop). The app fills the browser instead: each tracker the
  week shows is a screen (K123), the page sprints between them, and the navbar keeps out of sight until it is
  wanted (K24, K25; §6.6). Edit plan has a sticky navbar (K27) and is one tracker per screen under
  it too (K99), full width at the week's sizes with rows a fixed 100u (K54). Settings has no navbar (K52) and is full
  width in rows like the week (K51), and an item's page follows it, rows and all (K64, K65). The navbar keeps the week controls with View current week after them (K130), Ask,
  Add tracker (Edit plan only, K124), Settings, Programmes (K160), Print…, Full screen and Profile (K106). Below 640px wide Print and Full screen are left out (K160).
- **Light and dark themes.** The handoff is dark-only. Settings offers System (the default, which
  follows `prefers-color-scheme` live), Light and Dark. `App.vue` toggles a `dark` class on
  `<html>`; `public/theme-init.js` applies the saved choice before first paint so a dark preference
  does not flash light while the bundle loads. It is a plain file rather than an inline script
  because the nginx CSP allows scripts only from `'self'`.
- **Settings page.** The handoff calls accent and daily pick user settings but shows no UI for
  them. Settings started as a popover and became a page of its own (`SettingsPage.vue`, at
  `#/settings`) so it has room to grow. App reads the hash (as it does for invite and reset links)
  and shows the page in place of the week, without the Header (K52). Arriving moves
  focus to the page's heading, and coming back to the week puts it on the Settings button. The
  page is in tabs (K119), one per section: Appearance, Daily goal, Your data and Connections, on
  Reka UI's Tabs with automatic activation, and only the open tab's section renders. Each tab has
  an address: `#/settings` and `#/settings/appearance` open Appearance, and
  `#/settings/daily-goal`, `#/settings/data` and `#/settings/connections` open theirs. App keeps
  the open tab (`v-model:tab`), from the address on a hash change; choosing a tab writes its
  address with `history.replaceState`, so a reload keeps it and Back still leaves the page. A tab
  Settings doesn't have opens the week. The bar's Settings button and **S** open `#/settings`. The
  **Profile page** (`ProfilePage.vue`, at `#/profile`, K106) works the same way, opened from the
  profile Menu at the end of the bar, and focus comes back to the Profile button. Signing out (on
  the Profile page or from the Menu) drops any page's hash, so the next sign-in opens on the week. The marks' pens are fixed, so
  there is no Ink setting (K10). The theme and per-side choices are SegmentedControls: `aria-pressed` buttons in a
  `role="group"`. Marks is a RadioCard (a `radiogroup` of `role="radio"` rows), each row showing
  its set's three marks with `DayMarkDrawing`, the mark without its button (K20).
- **An item's own page** (K64, K65, the ItemPage card). The handoff has nowhere to keep more about
  an exercise or a food than its row. `ItemPage.vue`, at `#/item/<section>/<id>`, is one of
  Settings' family: no Header, Settings' sizes, full width on the page's margins. Its layout is
  option A of the mockup `261101-item-page`, rows like Settings (K65; K64 first built option B).
  Under the head (Back to the week, the type, "Exercise", and the name in `title-1` with its
  chips), each section is a row with its heading in the week's 320u name column
  (`--grid-name-w`), its content to the right and a `line` rule above it, in this order (K104 put
  the plan first):
  - the plan, its controls (`PlanFields.vue`) in columns at least 300u wide;
  - Notes, at the page's text size (`--set-text`), read as markdown, with Add notes or Edit notes
    turning them into a field that saves as you type, and Done or Escape turning it back;
  - Details, the type's fields, saving as you type, where a web address in Link adds "Open
    youtube.com in a new tab";
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

  The plan section edits the week the planner shows through the trackers store's own actions
  (`updateItem`, `changeTarget`), so a change shows in that week's row and in the weeks after it with no plan of
  their own, and the page says so. Its heading is "This week's plan", or "Plan for the week of 19
  October" for another week. An item not in that week (an old address, or an item since removed)
  shows "Latest plan", read-only, from the latest week whose own plan holds it.

  **The name and Remove** (K120, K121) are the same in Edit plan and outside it, for an item in the
  week the page shows: the page is the one place an item changes. The `<h1>` (`title-1` at
  `--fs-title`) is followed by the pen, an IconButton named "Rename <name>" (`data-testid=
  "item-rename"`), then the chips. The pen swaps the title for an input in the title's own type
  with "Done" beside it, the `<h1>` staying visually hidden and the chips hiding; focus goes to the
  input with its text selected. Enter or Done saves the trimmed name into the week's plan
  (`updateItem`) on commit, not per keystroke; Escape puts the old
  name back (and stops there, so arranging stays on); either way focus returns to the pen. An empty
  name shows "Enter a name." and saves nothing. Outside renaming the title is the store's name; a
  rename from elsewhere replaces the draft only while it is untouched. A Remove row ends the page,
  outside the arrangement and hidden while arranging: a line saying what it does and "Remove from
  this week", which asks through `useConfirm`, notes the week, and removes the item and leaves for
  the week (`leaveForWeek`) only when that week still shows.

  **The new item page** (`NewItemPage.vue`, K104), at `#/new/<section>`, is what Edit plan's Add
  opens. It shares the item page's `data-slot`, so it takes the same sizes. The head's first line
  has Back to the week, then Cancel and "Add exercise"; then "New exercise" (the `<h1>`, in `label`
  style) and an empty Name field, which takes focus. The plan always shows and Recent weeks never;
  Notes and Details follow the type's arrangement. A new exercise starts at one set of one rep
  (`NEW_EXERCISE_AMOUNT`), three times a week. The page is a form: nothing reaches a store until Add,
  which checks every field (focus on the first error), then calls the store's `add…` action, sets
  the notes and fields on the new id, and leaves for the week.

- **The page's address and focus.** App opens the page for an address whose section is a registry
  section and whose id the API could name, once the data shows the item is in the visible week or
  in some week's plan. Any other `#/item/…` address opens the week and drops the hash, as does an
  item another tab removed from every plan. Arriving moves focus to the item's name. Opened from the
  week, the page marks its history entry (`markFromWeek`), so Back to the week goes back through
  history and the browser's Back agrees. Opened from an address, Back replaces the entry with the
  week. Either way focus returns to that item's name in its row. The new item page's
  `#/new/<section>` (`newItemHref`, `parseNewHash`) works the same way: Back, Cancel, Add and an
  item page's Remove all leave through `leaveForWeek` (`src/lib/routes.ts`), and back on the week
  focus goes to the section's Add button. Signing out on the page drops the
  hash, as on Settings.
- **The name is a link.** In the week and in Edit plan, each row's name is an `<a href>` to its
  item's page (`data-slot="item-link"`). It looks as it always has, underlines under the pointer and
  prints as plain text. There is no Edit button and no Remove: the page is where an item changes (K104, K120). In the grid the link is the
  name cell's widget, so Enter opens the page in one press, and F2 reaches the cell's other controls
  (§6.5).
- **Config mode and normal mode.** Normal mode, the default on every load, only marks cells. A
  long press, the handle, E, or the keyboard's hidden "Edit plan" button (K80, K82, K91) turns on
  config mode (Edit plan), where the bar is in view. Another long press, E, Esc or the hidden
  button (reading "Done") turns it off; the bar has no Done (K91). `useShortcuts`
  (`src/composables/shortcuts.ts`) carries the week's keys: E, Esc (full screen first, then Edit
  plan), F full screen, P print, S Settings, and A for Ask, or in Edit plan the Add button of the
  screen showing most under the bar (K109), and ← and → for the previous and the next week, unless
  focus is in a grid, a SegmentedControl, tabs, a menu, a list or a slider, which move by the
  arrows themselves (K133). `App.vue` adds H or B for back and L for forward,
  signed in, on every page (K105). `ownedElsewhere` leaves a key alone in a field,
  with Ctrl, ⌘ or Alt, repeating, mid-composition, or while a dialog or popover is open. Edit plan
  shows "Add exercise", "Add cardio" and "Add food" buttons at the end of each title line (K113), and
  the daily targets centred on each title line, under the bar's week: a Stepper at max(44px, 40u)
  reading "4 per day", its label ("Exercises a day", "Foods a day") for a screen reader only
  (K56, K62, K63). The week beside the titles is left out there. An item is added on the new item page, and changed
  and removed on its page (K64, K104, K120), so rows have no Stepper and no Remove: Edit plan's grid
  has the week's columns. The mode is not saved, so the
  app always opens ready for ticking.
- **Exercises and foods are editable.** The handoff had no way to change an item after adding it.
  The item's page changes everything about it, the same in both modes: its name (the pen, K121),
  its plan, and Remove (K104, K120). The Edit dialogs of K54 are gone. Sets and
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
- **Every tracker is a screen of the same week**, in position order, sharing the week navigation
  and the print sheet (K123).
- **No Picked row, no dates in the header** (K28, K29): the grids show each day by its name alone,
  and nothing counts a day against the daily pick. A day that reaches it turns green instead
  (K30): `TrackerSection` passes `metDays` to the grid for a tracker with a daily target, which
  draws the day's name in `pen`, underlined (K60). The rule is `metDays` in `src/lib/tracker.ts`:
  a day is met when the items marked on it reach the tracker's daily target. The day names are
  max(20px, 27u), the rows' name size. Each tracker keeps its own target (K123); the `exercise` and
  `diet` trackers' also stay in the settings `dailyPick` and `foodPick` for older tabs (K57). **Daily goal** (K85), `dailyGoal` beside them, turns all of it off: while it is
  false both grids get no met days and Edit plan shows no Stepper, and the picks are kept. Like
  `goals`, a tab sends it only once it knows it (from the server, its cache or the person):
  `PortableSettings.dailyGoal` is optional, absent reads as on, and the API keeps the saved value
  when it is absent, so a cache from before it can't switch it back on. The sections have no weekly figure (K31), Settings no totals switch (K32), and the grids no Week
  column (K33). The Header has a Full screen button where the browser supports one and the window is at least 640px wide (K34, K160).
- **Print is the light theme on white paper, from either theme** (§6.7).
- **Narrow screens.** Folded (held upright under 1000px wide, or under 760px wide), the navbar
  puts the week across its first row (by CSS order), "View current week" after it or, without room, under
  it (K130), and shares its second row equally among the BarActions. There is no wordmark on any screen (K81). Below 640px
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
  `caution-ink`, `edit` and `scrim`. `edit` draws only Edit plan's frame (K112): App.vue's
  `data-slot="edit-frame"`, fixed round the window, `--edit-frame` wide (8px; on a phone a 4px line along the top only, K117, K162).
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
changes only the drawing (K20, K21): `markLook` gives the zigzag or hatch drawing (squiggles, which
draw a stored solid fill as the zigzag), the solid drawing (Filled in, K141), or a tick or face
symbol (`MARK_SYMBOLS`) stroked in the pen, or stamped: the solid drawing in the pen with the
symbol in `canvas` (in print, the light canvas). A press emits `toggle`; the stores step the day
with `cycleDay` and `nextMark` (`src/lib/tracker.ts`) over `cycleFor(type, markSet)`, which reads
the type's `cycle` from the registry. The cycles live in `src/lib/trackerTypes.ts`, and `tracker.ts`
re-exports them. In the squiggles `EXERCISE_CYCLE` is every zigzag and hatch mark, drawing first, and
`FOOD_CYCLE` the two green ones; in Filled in the solid fill's kinds once
(`EXERCISE_FILLED_CYCLE`, `FOOD_FILLED_CYCLE`, K141); in a symbol set the plain kinds once
(`EXERCISE_KIND_CYCLE`, `FOOD_KIND_CYCLE`). A drawing another set chose steps on from the first of
its kind there.
`isDone` and the totals count every kind. [brand.md](brand.md) §4 has the values.

### 6.3 The primitives

`src/components/ui/<name>/` holds the shared components, one folder each with the `.vue` file and
an `index.ts`. They are shadcn-vue (K1): owned source on Reka UI, added with the shadcn-vue CLI
(`components.json`: the Lucide icon library, `src/styles/main.css` as the stylesheet) and restyled
to the tokens and the cards. `cn` (`src/lib/utils.ts`) merges a consumer's classes over a
component's own.

| Group      | Primitives                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Basics     | Button (primary, secondary and quiet, 44px tall, `sm` 36px from 640px up), IconButton (44px, a required `label`), TextLink, Tabs with TabsList, TabsTrigger and TabsContent (K119), BrandMark, BarAction (the Header's actions, K47) |
| Forms      | TextField, TextArea, SegmentedControl, Switch, Stepper, RadioCard                                                                                                                                                                    |
| Overlays   | Dialog, ConfirmDialog with ConfirmHost, Popover, Menu with MenuItem (K106)                                                                                                                                                           |
| Planner    | DayMark, Chip, SectionHeader                                                                                                                                                                                                         |
| Feedback   | InlineMessage, Banner                                                                                                                                                                                                                |
| Programmes | ProgrammeGrid (`programme-grid`, the plan's weeks, K142), ChangeSheet (`change-sheet`, the two-step change, K144), ProgrammeChart (`programme-chart`, an activity's step chart, K145)                                                |
| Ask        | Transcript (the turns in rows, answers through `answer()` in `src/lib/markdown.ts`), AnswerProgress (main.css's `pen-write` keyframe), QuotaChip, SidePanel (S1), HistoryList                                                        |

The other cards are composed in the screens: Header in `AppNavbar.vue`, Panel in `AuthCard.vue`
and `ImportPrompt.vue`, WeekGrid in `TrackerGrid.vue` and `TrackerRow.vue`, PlannerScreen in
`TrackerSection.vue` (the class lists in `src/lib/screens.ts`), NewTrackerPage in
`NewTrackerPage.vue`, SettingsPage in
`SettingsPage.vue`, ProgrammesPage in `ProgrammesPage.vue`, ConnectionsSection in `ConnectionsSection.vue`, ConnectPage in `ConnectPage.vue`. Icons are `@lucide/vue` at a 1.5px stroke, `aria-hidden` beside words. A
primitive's colour transitions last 120ms at most, stop under `prefers-reduced-motion`, and name
the properties they animate, so the focus ring never fades in.

### 6.4 Confirmations

`useConfirm()` (`src/composables/useConfirm.ts`) asks a yes-or-no question and returns a promise:
true for the verb, false for Cancel or Escape. One `<ConfirmHost />`, mounted once in `App.vue`,
shows the open question in a ConfirmDialog (Reka's AlertDialog). A newer question answers an older
one false. `returnFocus` names where focus goes on closing when the control that asked has gone, as
after a removal. Removing an item on its page (`ItemPage`, K120) asks this way. Sign out uses a ConfirmDialog of its own, on the Profile page and from the bar's profile menu
(`useSignOut`), because it shows the unsynced count, a busy state and an error. From the menu, a
sign-out the server refuses opens the same dialog with the reason, since the bar has no room for it. So do the Ask page's two deletes (one conversation,
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
- **Controls in a cell.** The other controls in a cell (the note's button beside the name's link)
  stay out of the Tab order. F2 on the cell lets them in; Enter stays the widget's own. Tab moves
  among them, and Escape puts focus back on the cell, or on its widget: the name's link, in a name
  cell.

"Skip to today", first in the tab order in `AppNavbar.vue`, focuses today's first mark in the
first grid that has today. Tabbing to it brings the navbar into view on the planner's screens.

### 6.6 The planner's screens

`App.vue` puts `planner-screens` on `<html>` while the planner shows outside Edit plan. That
class turns on main.css's `full:` variant. In Edit plan it puts `edit-screens` there instead, which
turns on the `edit:` variant (K99): each section is at least the window less the sticky bar, whose
height AppNavbar publishes as `--bar-height` from a ResizeObserver, with Edit plan's fixed rows
from the top. Settings and an item's page are ordinary pages that scroll, so neither has either
class. With it, each section is a screen (`SCREEN` in
`src/lib/screens.ts`: the window's height less the fixed week's `--week-band`, a column that
starts at the top with the arrow to the next screen at its foot (K114),
and `data-planner-screen`) and its grid takes the height left (`SCREEN_GRID`). WeekHeader, before
the sections, is the fixed week: `sticky` at the top on the canvas, so the screens move under it
(K88). `bandHeight()` measures it while it is sticky, or else Edit plan's sticky bar (K99), and the
sprint takes it off the window's top, so each screen rests just under it. `useScreenSprint` (`src/composables/screenSprint.ts`) keeps the
page from resting across two screens. A wheel or a fling sprints as soon as the line between two
screens is a step (4% of the window, at least 16px) inside it, while it is still moving (K45); a finger on the
screen waits until it lifts; a scrollbar drag or the keyboard 120ms after the scroll stops (K38).
`sprintTarget` picks the place, in the direction of travel, and `sprintTo` moves there in 260ms,
eased out, setting the position each frame so a fling's momentum can't carry the page past it. A
push moves one screen (K94, K95). Once a wheel gesture (events less than 150ms apart) has moved
one, it is `spent` and its momentum is swallowed, but `MomentumWatch` still looks for a new push
in it: steps that fall below 70% of their peak and then rise twice, or a mouse wheel's click after
100ms of silence, judged by speed (px a ms) so steps the browser sends merged mid-sprint can't
pass for one. A new push moves on once the sprint has landed; nothing queues while one runs (K96).
The screens scroll the wheel themselves (K108): a step they let through is cancelled and scrolled
by `window.scrollBy`, because Chrome lets a page cancel only a scroll sequence's first wheel event
and sends the rest uncancellable once that one goes through, which left a swipe's momentum free to
drift the page into a second sprint. A pinch (Ctrl), a mostly sideways step (a Mac's Back and
Forward), a step over an inner area that can scroll that way, and one already uncancellable stay
the browser's (`ownWheel`). A wheel the other way stops the sprint and scrolls back (K89). After a resize or rotation, the page
settles on the screen that fills more of the window (K40). It replaced `scroll-snap-type: y mandatory`, which a mouse wheel couldn't
cross from the end of a tall screen. On a touch screen (`(hover: none) and (pointer: coarse)`) the
script mostly stands aside and main.css snaps instead (K98): `mandatory` with `scroll-snap-stop: always`, so
one swipe moves one screen and a fling keeps iOS's own momentum. The script still runs the arrows there,
turning snapping off while they move (`touchSnaps`, `snapOff`). The wrap round on touch is a snap
too (K100): an inert copy of the last screen stands above the first and of the first below the last
(`data-snap-copy`, snap points in main.css). Once the page rests on one (`scrollend`, or 120ms
still), `place()` jumps it to the same spot on the real screen. A MutationObserver remakes the
copy of a screen that changes, or all of them when the screens' class on `<html>` changes or a
screen comes or goes, waiting for rest if the page is moving. The screen the page rests on, when taller than the window, gets stops
inside it (K101, K102): `layStops()` adds an absolutely placed `data-snap-stop` mark at each of
`stopOffsets()` (every 80% of the window, and the screen's foot), snap points in main.css, because
iOS won't scroll freely inside a snap area taller than the window. Every other screen, and every
copy, has none, so a swipe up onto a screen lands on its top. A swipe up from a screen's top onto a
tall screen frees that screen for the touch (K118, `tallAbove`, `data-snap-free`): its top mark,
`data-snap-top` in each section, is its one snap position, so the browser's fling ends at its top.
A copy is remade only when the screen it copies changes. A ResizeObserver on the body and the window's resize keep
them where they belong. A slow drag turns sooner than the snap would (K103): from `touchstart` the
script notes the snap positions (`snapPoints`) and the finger's places; while the finger is slower
than 0.3px a ms over the last 100ms, or still, and `turnTarget()` finds the drag has gone a fifth
of the window, snapping is off. On `touchend` the browser's smooth `scrollTo` carries the page to
the next snap point the way it went, and snapping comes back on when it rests there, or after
`GLIDE_MS`. A faster finger turns snapping back on, so a fling stays iOS's own. A `touchcancel` counts as a lift.
When a swipe rests partway into a different screen than the last one it rested on (`restingOn`),
`place(swiped)` glides on to that screen's top (K116). The app's own moves set `restingOn` so they
stay where they chose: `focusOnScreen()` rests the page on the focused element's screen
(`restOn()`: its top, its foot, or the element in the middle) before focusing with
`preventScroll`, which App.vue uses back on the week from the new item page or an item's page
(K111); `screenInView()` names the screen showing most under the band, and App.vue notes it the
moment `configMode` flips (a sync watcher) and calls `restOnScreen()` once the new layout has
rendered (a post watcher), so Edit plan on or off keeps the tracker on show (K115); AppNavbar's
A key presses that screen's `[data-add]` (K109). Four custom variants in main.css carry
the layout, all screen-only so paper keeps the table: `screen:` (the WeekGrid is a CSS grid),
`full:`, `edit:` (Edit plan's screens, K99), `folded:` (upright under 1000px wide, or under 760px
wide) and `short:` (landscape, 540px tall or less).

- **Sizes follow the screen.** `--u` in main.css is 1 at 1280×800, clamped between 0.75 and 1.6.
  The named sizes (`--fs-name`, `--grid-name-w`, `--screen-pad-x`, …) derive from it, and folded
  they switch to `--n` (1 on a phone, up to 1.4). Components set `text-(length:--fs-name)` beside a
  type class, so the class keeps the font and weight and the size follows the screen. The other
  families: `--bar-*` sizes the Header and its BarActions (K47); `--set-*` the Settings and Ask
  pages' and the dialogs' type and controls (K51, K55); `--edit-ib` and `--edit-ib-icon` the
  pages' IconButtons: the item name's pen (K121), a dialog's Close, arranging's moves (K54's row
  button; K104 dropped the edit button's `--grid-edit-w`, K120 the Remove column's
  `--grid-remove-w`). Outside the planner's screens
  (Edit plan) `--grid-row-min` and `--grid-row-max` are a fixed max(76px, 100u), since that page
  scrolls rather than filling the window.
- **The grid.** `TrackerGrid` makes the table `display: grid` with its row groups and rows
  `display: contents`, so the cells place themselves and gridNav still walks `table.rows`. Rows
  share the height (`minmax(--grid-row-min, 1fr)`), and a `max-height` of the rows at
  `--grid-row-max` plus the header row's `--grid-head-h` stops them at 82u, or 1.25 × a day's
  width where that is less (K110). Every screen's content starts at its top, with the arrow
  to the next screen at its foot (K114). Each day cell is a size container that `DayMark fill` fills (86%, up to 128px). Folded,
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
  the fixed week. Each names the tracker it goes to: on a new account Strength has "Go to
  Cardio"; Cardio has "Back to Strength" and "Go to Food"; Food has "Back to Cardio". Each sprints
  to its screen's top with `sprintToScreen`, by the heading's id. A short screen leaves them out.
- **Test ids and heading ids** follow the tracker's id: the heading is `tracker-<id>-heading`
  (the skip link goes to the first one), the grid `<id>-grid`, the arrows `to-<id>` and
  `back-to-<id>` (named for the tracker they go to), and in Edit plan the pen `rename-<id>`, its
  field `name-field-<id>`, the daily target `<id>-a-day`, Add `add-<id>` and Delete tracker
  `delete-<id>`. The bar's Add tracker is `add-tracker-button`, and the new tracker page
  `new-tracker-page`, with `new-tracker-name`, `new-tracker-add` and `new-tracker-cancel`.
- **Settings, Profile and Ask** are pages of their own (`#/settings` with its tabs' `#/settings/<tab>`, `#/profile`, `#/ask`), outside the screens and with
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
- Each tracker prints on a page of its own (`print:break-before-page` on every screen after the
  first, K97),
  under the week in display: SectionHeader's `week`, shown only on paper. The page's `<h1>`
  (WeekHeader) stays for a screen reader but doesn't print.
- A met day's name keeps its `pen` and its underline (K60). A table split across pages repeats its
  header.
- After the first, each tracker's heading stays with its grid (`print:break-inside-avoid`), and a
  section header never ends a page (`print:break-after-avoid`). The trackers print in the week's
  order, each after the first set apart by a rule.
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
- `tracker-create`: a tracker made here, `POST /api/trackers` with its own `id` (from `newId`),
  `name`, `kind` and the `week` it starts in, so sending it again returns the stored one. The
  server places it last: its position is taken here, and a name or daily target changed since is
  queued as a patch;
- `tracker-patch`: a tracker's `name`, `position` and `dailyTarget`, `PATCH /api/trackers/<id>`
  with the revision last seen; a 409 brings the server's copy in, with a notice, as for a plan;
- `tracker-end`: Delete tracker (K122), `POST /api/trackers/<id>/end` with the `week` that was on
  screen. The server keeps an earlier end, and so does the device;
- `settings`: the accent, both daily picks (the `exercise` and `diet` trackers' targets, which the
  API keeps in step with them: a missing `dailyPick` would reset one), My goals, Your limits and
  the item pages' arrangement, `PUT /api/settings`. The goals go only when `goalsKnown` and the limits only when
  `limitsKnown`; a body without either keeps the saved one on the server.
  `itemSections` always goes, `{}` for the default: the API keeps the saved arrangement when the
  key is missing (a tab on older code), so leaving it out could never reset one.

`send()` is a switch with a branch per kind, and a kind without one fails to type-check
(`unhandled(op: never)`). Before 2026-11-01 anything that was not a plan or a tick went out as
settings, which a fourth kind would have done silently. `isQueued` checks each kind's own fields,
so an outbox entry of another kind, or whose tracker id isn't a tracker id, is dropped on load.
Tracker operations come first in each batch the diff makes, so a new tracker exists on the server
before its plans, marks and details reach it; a daily target change is a `tracker-patch`, not a
settings write.

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
details store's setters refuse any other id (false, so nothing is queued), and the item page says "This item’s notes can’t be saved: its id has a slash in it." (or "…details…",
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

**My goals, Your limits and older tabs (F1).** A tab from before My goals neither reads nor sends
them, and one from before Your limits neither reads nor sends those. The rules below are written
for the goals; the limits follow each of them with their own key. Three rules keep an older tab's
writes from erasing them. The API keeps the saved goals when a settings write
leaves them out. `normaliseState` keeps `goals` only when a cache or reply carries them as text,
so adopting that tab's cache keeps the goals this tab has. And a tab that has never read them
(it started from that tab's cache, offline) sends and caches settings without them until a
read brings them. The diff compares the goals, so an edit to them is sent. The Profile page's
boxes follow the same rule: a box takes typing only once its note is known, or once the last read
from the server found an account with no settings at all (`sync.blank`: a new one, whose notes are
empty). That stays true when this tab saves one note, until the next read, so the other box stays
open; it never makes a note known, so nothing is sent for a note the person didn't type in. A box
saves
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

## 8. Programmes

A programme is a plan of several weeks that the server writes into a tracker's weeks (the spec
[specs/2026-11-17-programmes.md](specs/2026-11-17-programmes.md)). [programmes.md](programmes.md)
documents the format and the changes, and [api.md](api.md) §3.4 the routes. This section is how
it is built: the API side first, then the web side (**In the app**, below).

**A run is a tracker.** Starting a programme makes a tracker of its kind (strength, mobility or
cardio) and a row in `programme_runs`: the run's own copy of the document, its parameters and its
start date. The run's weeks are ordinary `plans` rows, one per calendar week, so every reader
works unchanged: the week view, history, insights, Ask, the MCP read tools and the export. Each
activity's item id is its key (K155), so a week's ticks stay on the same activity whatever the
engine writes. Only the engine writes a programme tracker's plans: the generic plan write and the
MCP's item tools refuse one.

**The modules.**

- `programme.py` is pure: no database, no clock. It parses a document and reports every problem
  with its JSON path, resolves the parameters, and computes a field's value for an activity week
  (`Series`) in decimals under one fixed context. It also builds the JSON Schema.
- `programme_replay.py` is pure too, with today always an argument. `replay` steps day by day from
  the run's first Monday and applies each change on its from day. `check_change` and
  `preview_change` check and preview a change, `week_items` turns a calendar week into plan items,
  and `day_to_json` and `day_from_json` store a day for sealing. Its docstring is the reference for
  the change format.
- `data.py` stores and loads runs, seals days, writes the weeks, holds the lock and builds the run
  object and its grid. `app.py`, `mcp_server.py` and `ask.py` call it, each with a `data.When`: now
  in Unix seconds and the server's `TIMEZONE`, from which today and the lock follow.

**The five principles** (spec §1) and what holds each:

- **P1, the past never changes.** A change takes effect today or later, and a write rewrites today's
  calendar week and later ones only. Past days are sealed (below), and the replay reads a sealed day
  from the record, never from its own output. A stored run loads without the week-by-week range
  check (K158), so an engine change can't stop it loading.
- **P2, no surprises.** A change is a preview until it comes back with the preview's `rev`,
  `confirm_token`: a hash of the log's revision and of the change itself (its body with
  `dropHandEdits`, its from day and its reason). A different `rev` means the log moved or the
  change isn't the one previewed, and the answer is a fresh preview of the change sent. The run's
  own `rev`, the log's alone, never confirms a change.
- **P3, no jumps.** A value change adds a segment to the field's series at the activity week in
  force (`Series.origin`), so the weeks after continue from the value shown (K150). Increases keep
  the activity's own weeks (K149).
- **P4, one engine.** Only the server expands a programme. The run object carries the grid it
  computed, and every client shows that grid rather than computing a week.
- **P5, every change recorded.** `run_changes` keeps each change with when it was made, its from
  day, the change, the reason, the source (`app`, or an MCP connection's name) and the undo that
  reversed it. End programme is a row there too (K156), which the replay passes by.

**The log is the source of truth.** The weeks are what the replay computes from the run's
document, parameters, start date and log. Changes apply in from-day order, then by `seq`. An undo
leaves its change out of the replay. The same log gives the same weeks on every machine, since the
engine works in decimals and never reads the clock.

**Writing the weeks.** A start writes every week of the run. A change writes today's calendar
week and every later one from the new replay (`_write_weeks`), never an earlier one. A week whose
items read as stored keeps its revision, and a later week the run no longer has is deleted. A
week's row holds one value per item, so the current week carries Sunday's values and target; its
days before today keep their own in the sealed record, which the grid reads (`splits`). The
tracker's `endWeek` follows the run's last day: the Monday after it, or none while the programme is
paused with no end date.

**Sealing** (spec §8). Before every start, change and end, and on the first read each day, every
unsealed day up to yesterday is copied into `programme_days`: the day's plan as the replay gives
it, with its programme and activity weeks, as `day_to_json` writes it. Each day is read back as a
later read will read it. A read takes the write lock only when it has a day to seal or a status to
store, so only the first read each day writes. Sealing never checks the quota. A change that
continues from a sealed day's value reads it from the record (`ActivityDay.base`), so a later
engine fix can't move it. Days from End programme's day on are no longer the run's and are never
sealed.

**The lock.** A change's from day is today or later. `data.set_tick` on a programme tracker takes
today, any later day (K159) and yesterday, which it records as late; it raises `LockedDay` for an
earlier day, and for any day when the caller gives no `When`, so a path that forgets today fails
closed. `/api/state` carries `today`, so a client can lock past days by the server's date rather
than its own clock.

**The evidence.** Every mark on a programme tracker, a cleared day included, also goes into
`mark_events`: the day, the item, the mark, when it was entered, its source and whether it was
late. The weekly bitmasks in `ticks` stay the fast path every reader uses. The run's tables count
towards the quota (`data.usage`): its document and parameters, each log entry, each sealed day and
`RUN_ROW_BYTES` a row, mark events included. Only a start, a change and a library save check it,
so a full account still seals and takes marks (P1).

**Status.** A run reads as `upcoming` before its start, `running`, `paused` while the whole
programme is paused, or `ended` (K157). `programme_runs.status` stores it as at the last write or
seal, so a read can tell whether it has a status to store.

**Stored runs always load.** A run's document was checked against each week's limits when it
started, so loading it again skips that check (`check_ranges=False`). A run that still fails to
load, seal or replay raises `RunUnreadable` and never takes another tracker down: `/api/state`
leaves its summary out and logs it, `seal_runs` passes over it, and its own routes answer 500
`run-unreadable`. Ask's context leaves it out and logs it (`ask.programme_runs`), so Ask still
answers. The MCP's `list_programmes` lists the other runs, and `get_programme` and
`change_programme` refuse it with a sentence that names the tracker.

**Export and import.** The export carries the library and each run whole: its copy, parameters,
log, sealed days and mark events, with no new file version. An import adds a run only with a
tracker it adds, and only when the run's document, parameters, sealed days and log all read; a
programme tracker the account has takes nothing from a file.

**In the app.** The web app computes no plan value (P4). Every number it shows comes from the
server: the start preview, the run's grid, a change's preview and the run a confirmed change sends
back.

- **The sync store** (`src/stores/sync.ts`) keeps `today` and `runs` from each `/api/state`, and
  stores them under `tracker-runs-v1:<user>` (`RUNS_PREFIX`), apart from the cache, so a device
  offline still knows which trackers are programmes and which days are locked. `locked(tracker,
  day)` is true for a programme tracker's days before yesterday by the server's `today`, never the
  device's clock; nothing is locked before the server has said what today is. It passes the run
  ids to the trackers store (`setProgrammes`). There `isProgramme` stops `addItem`, `updateItem`,
  `removeItem` and `changeTarget` on a programme tracker, so Edit plan never writes its plan.
- **The programmes store** (`src/stores/programmes.ts`) holds the library, the open overview's run
  (`run`) and each tracker's run as last read (`byTracker`). `loadPage` reads `/programmes` and
  `/state` for the Programmes page. `previewStart`, `start`, `loadRun`, `previewChange`,
  `confirmChange` and `endRun` call the routes in [api.md](api.md) §3.4; `ensureRun` reads a
  tracker's run again when the state lists a newer `rev`. A start, a confirmed change and an end
  call `sync.refresh()`, so the week reads the plans the server wrote. Nothing here queues: offline
  (`offline`), the controls are disabled with one line saying why. `src/lib/programmes.ts` holds
  the API types, the wording, the change bodies and `runsFromState`.
- **The views.** `ProgrammesPage.vue` is `#/programmes`: the Started, Library and Add tabs (K161), and
  Preview and start in place in the library list (K147). `ProgrammeOverview.vue` is
  `#/programme/<tracker>`: the plan in `ui/programme-grid/ProgrammeGrid.vue` (K142, K143), the
  Changes tab with Undo, the controls, and Show it in the plan with its bar at the foot (K148).
  `ui/change-sheet/ChangeSheet.vue` is the two-step change sheet (K144) that the overview and the
  item page open. On an item page a programme activity's plan row is `ItemProgramme.vue`, with the
  step chart (`ui/programme-chart/`, K145) and the activity's controls. In the week view,
  `TrackerSection.vue` puts "Week 4 of 8" at the end of the title line, linked to the overview, and
  reads the run's week for each paused activity's sentence, which `TrackerRow.vue` shows in place
  of its boxes; `TrackerGrid.vue` puts a lock by a locked day's name, and `DayMark`'s `locked`
  keeps its box from pressing (K146). App.vue routes the two addresses (`src/lib/routes.ts`), and
  the bar's Programmes action opens the page (K160).
- **Refused writes.** The outbox can hold a mark made offline that reaches the server after its
  grace day, or a plan write to a programme tracker. The server refuses them with 409
  `locked-day` and `programme-tracker`. The sync store then drops the write, reads
  the state again so the change is undone here, and names it in its notice: `lateNotice` names
  the first refused mark's item and day and counts the rest, and `programmeNotice` names the
  tracker. A mark is never dropped silently.
- **Import.** The app's import passes the file's `programmes` and `runs` through to
  `POST /api/import` as they are (`src/lib/transfer.ts`, `importFile` in the sync store). The
  server reads and checks them, so a run imported through the app keeps its log and its locked
  days.
