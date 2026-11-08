# Development

> Purpose
>
> The toolchain, the scripts, the code conventions, the style guide and the design gate, and how
> the tests are organised.

## 1. Toolchain

- Node `^22.18.0 || >=24.12.0` (from `engines` in `package.json`). CI runs Node 22.
- **npm 11.** npm 10.9, which ships with Node 22, crashes during install with
  `Cannot read properties of null (reading 'edgesOut')` while resolving this dependency tree's peer
  sets. Install npm 11 first (`npm install -g npm@11`) or run it ad hoc with
  `npx -y npm@11 install`. CI and the Dockerfile both do the former.
- Vue 3.5, Pinia 4, Vite 8, Tailwind CSS 4, TypeScript 6, Vitest 4 with jsdom, ESLint 10 + oxlint,
  Prettier with `prettier-plugin-tailwindcss`.
- The UI layer: shadcn-vue components on Reka UI 2 (owned source in `src/components/ui/`),
  Lucide icons (`@lucide/vue`), and the Source Serif 4 and Source Sans 3 Fontsource variable
  packages. The design system's scripts (`scripts/check_design_system.py`,
  `scripts/design_preview.py`) need only Python 3's standard library.
- Running the app needs the API: the README's Getting started shows how. `npm run dev` forwards
  `/api` and the three OAuth discovery paths to `http://127.0.0.1:8000` (`API_URL` overrides it), so the browser sees one origin as it
  does behind nginx. `scripts/compose-smoke.sh` runs both images together and checks them through
  nginx.
- The API in `api/` uses Python 3.13 with uv, FastAPI, pytest with coverage, ruff and mypy
  (strict). [api.md](api.md) §10 has its commands. Its tests run the same `fixtures/transfer/` cases
  as Vitest, so a validation rule changed in `src/lib/storage.ts` must change in
  `api/src/tracker_api/validate.py` too, and the reverse.

## 2. Scripts

| Script                            | Does                                                                        |
| --------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server with Vue devtools                                           |
| `npm run build`                   | `type-check` and `build-only` in parallel; either failing fails it          |
| `npm run build-only`              | `vite build` into `dist/` without type-checking (CI runs it last)           |
| `npm run preview`                 | serve `dist/`                                                               |
| `npm test`                        | run the Vitest suite once                                                   |
| `npm run test:watch`              | Vitest in watch mode                                                        |
| `npm run test:coverage`           | suite plus v8 coverage (per-file text table, HTML in `coverage/`)           |
| `npm run type-check`              | `vue-tsc --build` across the app, node and test configs                     |
| `npm run lint`                    | `lint:oxlint` then `lint:eslint`, read-only (CI runs this)                  |
| `npm run lint-fix`                | both linters with `--fix`                                                   |
| `npm run format` / `format:check` | Prettier over `src/`, `fixtures/`, `e2e/` and `playwright.config.ts`        |
| `npm run tokens`                  | regenerate `src/styles/tokens.css` from the design system's tokens          |
| `npm run test:e2e`                | the Playwright browser checks in `e2e/` against their own dev server (§3.3) |

The linters ignore `design_handoff_exercise_planner/`, which holds vendored prototype code, and
build and coverage output. ESLint also ignores Playwright's `playwright-report/` and
`test-results/`.

## 3. Conventions

- Prettier (`.prettierrc.json`): no semicolons, single quotes, print width 100. The Tailwind plugin
  sorts class lists in templates. It reads the theme from `src/styles/main.css`. `.prettierignore`
  keeps it off the generated `src/styles/tokens.css`. `.editorconfig` sets indentation for
  editors, and `.vscode/extensions.json` recommends the Vue and lint extensions.
- `@/` resolves to `src/` in Vite (`vite.config.ts`) and TypeScript (`tsconfig.app.json`).
- Components use `<script setup lang="ts">` and Tailwind utility classes, with no `<style>` blocks.
  A class list used more than once in a component goes in a constant in its script.
- **Role utilities only.** Colours come from the roles (`bg-canvas`, `text-ink-secondary`,
  `border-control-border`, `text-pen`), never a palette class, a hex value or an arbitrary colour.
  The palette is switched off, so a class such as `bg-red-500` silently draws nothing.
  [brand.md](brand.md) §3 says what each role means. `pen` is for done, a met day and a met week's count, nothing else.
  `caution-ink` is kept for InlineMessage's caution tone; nothing on the planner uses it (K28).
- **Type-style classes for text.** Set text with `display`, `title-1`, `title-2`, `body-large`,
  `body`, `caption`, `label` or `note`, rather than font-size and line-height utilities. The type
  classes sit in Tailwind's `components` layer, so a utility beside one wins as it reads
  (`caption font-semibold` is semibold): add one only where a card asks for it. Numbers take
  `tabular-nums`.
- **Primitives before raw elements.** Use the components in `src/components/ui/` (Button,
  IconButton, TextField, Dialog, `useConfirm`) rather than a raw `<button>`, `<input>` or
  `window.confirm`. A component the system lacks starts as a card, then a primitive
  ([brand.md](brand.md) §10).
- **Icons** are Lucide (`@lucide/vue`) at `:stroke-width="1.5"`, 20px in buttons and 16px beside
  text, never a Unicode glyph or emoji. An icon-only button is an IconButton with a `label`.
- **Ids.** TextField and TextArea forward `id` (and `inputmode`, `autocomplete`, `data-*`) to the
  real control, and generate an id with Vue's `useId()` when none is given. Pass a fixed `id` only
  where a test or another element needs it (the sign-in, sign-up and link forms).
- Tests find elements by role, label, `data-testid`, `data-slot` or state attributes (`data-today`,
  `data-tone`, `data-met`, `data-shown`, `aria-pressed`, `aria-current`), never by styling classes.

### 3.1 The style guide

`npm run dev` serves the living style guide at <http://localhost:5173/styleguide>: every primitive
and planner component, in each state, rendered by its real source. Its Theme menu switches the
look, and the address keeps it (`/styleguide?theme=dark`), so a link or a browser test opens
either theme. It needs no API and no sign-in, and the production build leaves it out.
Add a section for each new component in `src/styleguide/sections/` and one entry in
`src/styleguide/sections.ts`. A component that reads the stores, as ItemPage does, gets a Pinia of
its own in its section (`ItemPageSection.vue` sets one up with the card's items), so edits there
save nowhere. Show one example at a time if two would repeat the same landmarks: ItemPage's section
picks its state with a SegmentedControl, because two pages on one screen would repeat the same
named regions, which axe's `landmark-unique` rule fails.

### 3.2 The design gate and the tokens

The design system's source is `brand/design-system/` ([brand.md](brand.md)). After any change to
it, run the gate, which must exit 0:

```bash
python3 scripts/check_design_system.py brand/design-system --complete
```

It checks contrast in both themes for every role pair, the three pens included, the token shapes, the banned words,
and that every required component has a card. After a change to `tokens.json`, regenerate the app's
tokens with `npm run tokens` and commit `src/styles/tokens.css` with it. Never edit that file by
hand.

### 3.3 Lint rules, e2e suite and CI checks

`npm run lint` enforces the conventions above, so a break fails CI rather than review:

- **Tailwind classes** (`eslint-plugin-better-tailwindcss`, read against `src/styles/main.css`): an
  unknown class fails, and with the default palette switched off `bg-red-500` is unknown. So do
  conflicting, duplicate and deprecated classes, an arbitrary colour (`bg-[#…]`, `text-[rgb(…)]`)
  and a colour utility on a raw variable (`bg-[var(--canvas)]`). The type styles (`caption`,
  `title-2`, …) are known because `tokens.css` is imported into the `components` layer, which also
  lets a utility beside them win (`caption font-semibold` is semibold).
- **Template accessibility** (`eslint-plugin-vuejs-accessibility`, recommended rules): a click
  handler on a non-interactive element, a control without a label, and so on. The explicit grid roles
  on `tr` and `th` are allowed, since `gridNav` and the specs find cells by role. Two lines disable a
  rule with a reason: the hidden username field password managers use (`PasswordForm.vue`) and the
  Stepper's live-region `<output>`.
- **Single-word names** are kept where the design system or shadcn-vue gives them: Banner, Button,
  Chip, Dialog, Popover, Stepper and Switch in `src/components/ui/` each open with a comment that
  disables `vue/multi-word-component-names` and says whose name it is.
- **No `<style>` blocks** in components (`vue/no-restricted-block`): styling is utilities on roles.

`npm run test:e2e` runs the Playwright suite in `e2e/` against its own dev server (port 5179, with
`PLAYWRIGHT=1`, which turns the Vue DevTools overlay off). `/api` is mocked with `page.route` and the
clock is fixed to Wednesday 21 October 2026, so every run sees the same week.

- `a11y.spec.ts`: axe (WCAG 2.0–2.2 A and AA plus best practice) on the style guide in both themes,
  and on the app's (its mocked week holds every kind of mark) week view, the bar called up, Edit plan, open Settings, an item's page (desktop with its notes being edited, folded at 390px, and while arranging at both sizes, with nothing scrolling sideways), the Ask page (an answer with the history beside it, its Delete all question open, and at 375px with the history drawer open), the folded week at 375px,
  sign-in, and create an account (empty and with errors showing), in light and dark; and the focus ring's shape, a solid 2px outline at 2px offset. Two
  "dark really is dark" tests guard the audit: on the style guide and on the app, the `.dark` class
  must be set and `--canvas` must differ from light, so a dark audit can never quietly re-run
  light.
- `phone.spec.ts`: no sideways scroll at 375px on the style guide, sign-in, create an account,
  the folded week and Edit plan, the Ask page (empty with no goals yet, and with an answer and its
  history drawer open) and the Settings page, and every cell of the folded week stays on screen as the keyboard
  walks it. `callUpBar` in `support.ts` brings the navbar into view before a test presses its
  controls, since on the planner's screens it is out of sight.
- `connections.spec.ts`: Settings › Connections (creating a token, shown once with Copy, then
  removed; axe with the banner in both themes; no sideways scroll at 375px) and the consent
  screen (a wrong password shown on both fields, then Connect returning to the app; axe signed out
  and with a refusal in both themes; a phone).
- `notes.spec.ts`: an item's note on one line under the name and chips, and a press opening it
  whole in a popover whose link opens a new tab, focus moving to the link and back to the cell on
  Escape (K43), and a long note opening in a panel that fits the window and scrolls. The mocked
  state (`e2e/support.ts`) has details with notes for Push-ups and Kettlebell halos, so the axe
  checks cover the note line too.
- `item-page.spec.ts`: a press on a name opens its page, laid out in rows (Notes, Details, This
  week's plan, Recent weeks, each heading in the 320px name column, K65), and Back returns with
  focus on the name. Enter on a name's cell opens it in one press. A note typed on the page shows
  in the row on every week, and a plan change in this week's row. Recent weeks match the log, print
  keeps the head, the notes and the details only, and at 390px the page folds to one column in the
  same order, each heading over its content, with nothing scrolling sideways. Arranging (K66),
  by keyboard: Space on Show Details hides it, Enter on Move Recent weeks up three times takes it to
  the top with focus kept and then on its Move down, Escape leaves with focus on Arrange sections;
  the arrangement reaches the mocked server's settings, every exercise's page follows, a food's
  page doesn't, and a reload reads it back. Folded, each section's controls sit on its heading's
  line. The mock keeps `PUT /api/settings` and returns it from `GET /api/state`, as the API does.
- `screens.spec.ts`: a tall Exercises screen and a tall Food screen (`openApp`'s `moreExercises`
  and `moreFoods`), wheel-scrolled down and back up a notch at a time at 1280×800: the page never
  rests showing part of both, and it reaches Food (K38); a rotation (and back, and a phone on
  its side) never leaves it resting across two screens (K40); and a short trackpad fling reaches
  Food before the fling has ended (K45).

CI (`.github/workflows/ci.yml`) runs three jobs on every pull request and every push to `main`.
`check` runs lint, format, types, unit tests with coverage, the build, the design gate and
"tokens.css is current" (`npm run tokens` followed by
`git diff --exit-code src/styles/tokens.css`). `e2e` installs Chromium and runs `npm run test:e2e`,
keeping traces of a failure. `api` checks the Python service. One convention has no check yet: unit
tests should not query styling classes.

## 4. Tests

The app's tests sit in `__tests__/` next to the code they cover (the API's are in `api/tests/`,
listed in [api.md](api.md) §10):

- `src/lib/__tests__/dates.spec.ts`: Monday maths, offsets, year boundary, the 2026-10-25 week (a
  DST change in EU timezones), labels.
- `src/lib/__tests__/storage.spec.ts`: v2 plan validation and round-trip, migration from the v1
  (prototype) format, log normalisation, sets and weight, diet parsing, settings parsing,
  skip-unchanged writes, storage that throws, and `migrateKeyPrefix` moving `fitness-planner-` and
  `exercise-planner-` keys to `tracker-`, the newer name's copy winning (K44).
- `src/lib/__tests__/plans.spec.ts`: which week's plan a week shows (own, carried forward, earliest,
  none) and plan copies.
- `src/composables/__tests__/exerciseForm.spec.ts`: digits-only sets/reps and decimal weight
  cleaning, loading and resetting the shared exercise form.
- `src/lib/__tests__/markdown.spec.ts`: a note's markdown (K43): emphasis, code, lists and links
  opening a new tab; raw HTML, script links and images never rendered; headings and rules left as
  text; and the row's one line, where a link is its text.
- `src/lib/__tests__/format.spec.ts`: K14 as a test (K41). Each cache key version has a row
  recording what it stores (the marks, and the fields an exercise and a food keep). It fails when
  the stored format changes under the same key, and when an older key isn't moved at sign-in.
- `src/lib/__tests__/transfer.spec.ts`: every case in `fixtures/transfer/` (parsing an export and
  merging one), plus building an export, the merge summary and the download. Add a fixture rather
  than an inline case when the behaviour is part of the export contract: the API's tests
  (`api/tests/test_parity.py`) read the same files.
- `fixtures/transfer/sample/`: `storage.json` is a realistic `localStorage` snapshot: alice's cache
  under the current key, `tracker-cache-v4:alice`, as the sync store keeps it, and a
  `tracker-settings-v1` holding the dark theme. Each section holds `plans`, `log`, `details`,
  `revs` and `detailRevs`. It spans five weeks (2026-09-21 to 2026-10-19): four with data, and
  2026-09-28 left empty so it carries the plan before it forward. It has plans edited over time
  (sets, weights, Back extensions removed, Plank added), 102 ticks, a diet with an added food,
  details for Push-ups (notes and two fields) and Fish (one field), and non-default settings.
  `export.json` is the version 5 export it must produce. A new cache format needs a new snapshot:
  `App.spec.ts` fails when the key isn't `CACHE_PREFIX`'s. `App.spec.ts` seeds the snapshot and checks Export gives
  `export.json`. It also imports `export.json` into an empty account and checks the cache and the
  (fake) server both end up holding the sample, with the theme left on the device. To see the app populated while
  developing, import `fixtures/transfer/sample/export.json` from Settings → Import… on a scratch
  origin. Tests read fixtures through `src/lib/__tests__/fixtures.ts`.
- `fixtures/types/registry.json`: the tracker-type registry, each section's type and each type's
  fields, daily-target key and new-item goal. `src/lib/__tests__/trackerTypes.spec.ts` and the
  API's `test_types.py` both check their registry against it, so a field added on one side only
  fails a suite.
- `fixtures/item-sections/normalise.json`: the item pages' arrangement (K66, P29), inputs and their
  normal form. `src/lib/__tests__/itemSections.spec.ts` and the API's `test_item_sections.py` both
  run every case, and the web spec also covers showing, hiding and moving a section.
- `src/lib/__tests__/trackerTypes.spec.ts`: also each type's cycle, which `cycleFor` reads, its
  labels, an exercise's chips and a food's none, and `isSection`.
- `src/lib/__tests__/history.spec.ts`: an item's recent weeks (eight ending with the opened week,
  newest first, none before its first plan, goals from the plan each week shows, the default plan
  when nothing is planned), the latest plan holding an item, a week's count and whether it met its
  goal, and the line over the weeks in words.
- `src/lib/__tests__/routes.spec.ts`: the item page's address written and read back, addresses that
  name no section or no good id, the history mark for a page opened from the week, Back going back
  through history or replacing the entry, a modified press left to the browser, and `webHost`.
- `src/lib/__tests__/tracker.spec.ts`: the shared tick-per-day helpers (totals, day counts, goals
  met, toggling, ids), including that `toggleDay` changes a reactive log through its proxy.
- `src/lib/__tests__/api.spec.ts`: how every kind of reply becomes a typed result (success, 204,
  401 for an ended session versus a wrong password, a 409 `conflict` versus any other 409 (a
  refusal with its code), gateway errors and network failures as
  offline, the API's own refusals with `Retry-After`).
- `src/lib/__tests__/nginx.spec.ts`: reads `nginx.conf`: the CSP is unchanged, and `/api/` proxies
  to `fitness-api:8000` through a variable upstream with the body cap and one `Cache-Control`.
  Each of the three OAuth discovery paths proxies the same way, any other `/.well-known/` path is
  a 404, and discovery answers carry `no-store`.
- `src/lib/__tests__/fakeApi.ts` (a helper, not a spec): an in-memory API installed as `fetch`. It
  keeps plan and details revisions and 409s, identical writes on a stale revision, a cleared
  details document keeping its revision, single-day marks (in the API's three masks,
  and the old `done` body), settings, sessions,
  sign-up (`email`, `password` and `exists` refusals) and invite links. Controls let a test go offline, fail the next matching request, `hold()` every
  reply, `holdNext()` one, or `stall()` one forever. `signedIn.ts` sets up a browser already signed
  in as alice: the fake API, the remembered session, and an empty or given cache.
- `src/lib/__tests__/theme.spec.ts`: theme names and how System, Light and Dark resolve.
- `src/lib/__tests__/words.spec.ts`: small numbers as words (capitalised to open a sentence),
  singular and plural, and the app name (Tracker, with no monogram: K44).
- `src/lib/__tests__/utils.spec.ts`: `cn` (conflicting utilities, role colours kept apart from text
  sizes) and `joinIds`.
- `src/composables/__tests__/useConfirm.spec.ts`: the question, its verb and Cancel, true and false
  answers, Escape, focus returned, a newer question answering an older one false, and an open
  question answered false when the component that asked goes away or `dismissConfirm()` runs.
- `src/composables/__tests__/useMediaQuery.spec.ts`: the media query's match, its updates, the
  listener removed with the scope, and a browser without `matchMedia`.
- `src/composables/__tests__/screenSprint.spec.ts`: where a scroll goes (`sprintTarget`: nowhere
  inside a screen, on in the direction of travel across a line, to the larger screen with no
  direction, and only past a step when given one) and the composable: a moving scroll sprinting at
  once, a short one after a pause, a finger waiting to lift, the wheel swallowed during and after,
  the eased `sprintTo`, a resize, reduced motion and switching off (K38, K40, K45).
- `src/composables/__tests__/fullscreen.spec.ts`: full screen unsupported (an iPhone), entering and
  leaving it, and a refusal leaving the page as it is (K34).
- `src/styles/__tests__/print.spec.ts`: the print block's literal colours match `tokens.json`'s light
  values, and the surfaces go transparent.
- `src/composables/__tests__/gridNav.spec.ts`: the grid keyboard model on a small table: the one
  tab stop (today, the first day, the last cell focused), arrows, Home and End with and without
  Ctrl, Space and Enter left to the DayMark, Edit plan's
  controls (Enter or F2 in, Escape out, parked when focus leaves), rows coming and going, and a name
  that is a link (its cell's widget, Enter its own in one press, Space doing nothing, F2 into the
  cell's other controls and Escape back to the link).
- `src/components/ui/__tests__/`: one spec per primitive (AnswerProgress, BarAction, Banner,
  BrandMark, Button, Chip, ConfirmDialog, DayMark, Dialog, HistoryList, IconButton, InlineMessage,
  Popover, QuotaChip, RadioCard, SectionHeader, SegmentedControl, SidePanel, Stepper, Switch,
  TextArea, TextField, TextLink, Transcript), each checking its
  roles, accessible names, sizes, states and the role colours its card names. Examples: an
  IconButton renders nothing without a label, the Popover closes when focus leaves it (F14), the
  Stepper's limits stay focusable with `aria-disabled`.
  `transitions.spec.ts` checks no primitive animates `outline-color`, so the focus ring never fades
  in. `setup.ts` fills the jsdom gaps Reka UI's overlays reach for.
- `src/styleguide/__tests__/look.spec.ts`: the style guide's theme from the query string, the
  round trip back to it, and the class it sets.
- `src/stores/__tests__/planner.spec.ts`: stepping a day through its marks, totals, week navigation, goal clamping, adding,
  removal's effect on totals, settings, detail chips, editing exercises, sets, weekly plans
  (defaults, carry forward, a week getting its own plan), config mode,
  the midnight refresh, `adopt`, `adoptWeek` and `clear`, the theme being the only thing stored
  (merged into the settings key), the keys from before accounts never being written, and
  `savedSettings` (tracked in memory, set by adopting or changing settings, never by the theme),
  no note kept in the week (an exercise's notes are its details), and `clear` forgetting the
  details too.
- `src/stores/__tests__/diet.spec.ts`: food toggling in the planner's week, shared week navigation,
  goal clamping, renaming, add/remove, carrying food plans forward, `adopt`, `adoptWeek` and `clear`, the
  old diet keys never being written, and no note kept in the week.
- `src/stores/__tests__/details.spec.ts`: the details store: a note edited on one week showing on
  every week (owned plans included), readers updating when an item's first details arrive, storing
  as the API would, fields beside the notes (unknown keys kept), and refusing a bad field key, notes
  over 20,000 characters or 32 KB, a field over 500 characters, a 33rd field and an id the API
  can't name.
- `src/stores/__tests__/syncDetails.spec.ts`: details through the sync store against the fake API:
  reading them and their revisions, sending with the revision last seen (a food's under `diet`, an
  id as a path segment), clearing as `{}`, waiting for the typing to pause while a tick goes at
  once, an offline edit surviving a reload, conflicts (the server's copy with the notice, a cleared
  copy, a create again, no notice for the same details), a 404 kept and retried while a tick's 404
  is dropped, `too-large` and `quota` dropped with a notice, the outbox read back, an import sending
  held details first, and sign-out. Also moving a `-v3` cache and outbox (notes lifted with the
  latest week winning, lifted notes sent only for a section with queued plan writes, an old tab
  ignored), and details in `diff` and `normaliseState`.
- `src/stores/__tests__/sync.spec.ts`: the sync store against the fake API:
  - the cache shown at once, then the server's state; no cache, or a broken one;
  - a first tick creating the week's plan before the tick, and revisions carried forward;
  - diet and settings writes, and a toggle made while its write is in flight;
  - offline queueing, the backing-off retry timer, gateway errors as offline, and 401s handing
    control back;
  - conflicts (taking the server's copy with a notice, re-creating when the server has none, no
    notice for identical creates), and refused writes being dropped (with the account-full notice
    for `quota`);
  - reads that must not undo local edits, including one the watcher has not seen;
  - other tabs' cache and outbox writes (a cache adopted, never written back, even from older
    code), stop and forget, the old keys never written, `diff` and
    `normaliseState`;
  - the older caches and outboxes moved at sign-in, the newer winning, and a tab from before
    the solid and hatch drawings unable to empty a `great-solid` day (K41);
  - `importFile`: queued writes first, then one server import and a read; offline, refused, a
    full account (`quota`), 401, and nobody signed in.
- `src/lib/__tests__/problems.spec.ts`: the sentence for every sign-in, sign-up, link and sign-out refusal,
  including the minutes left on a lockout.
- `src/lib/__tests__/legacy.spec.ts`: reading the keys from before accounts (v2, the v1 migration,
  the accent and daily pick but never the theme, broken JSON, nothing worth offering).
- `src/components/__tests__/ImportPrompt.spec.ts`: the first-login prompt through the app: what it
  offers, Add (merged on the fake server, shown, remembered), Not mine, Later, offline, refused and
  over-quota imports, an account that already holds everything, a browser with no earlier log, waiting for
  the account's state, and per-user answers.
- `src/lib/__tests__/ask.spec.ts`: the Ask page's words: when asking opens again (a time today or
  tomorrow from `Retry-After`, or within a day), the unsynced-changes note in words, a kept turn as
  the Transcript draws it, and the history list's well-formed items.
- `src/stores/__tests__/ask.spec.ts`: the Ask store against the fake API: the questions left and
  the history, a question with the local date streamed and then listed, a blank or second
  question ignored, this device's changes sent first (F11), one draw per animation frame, Stop, a
  stream that ends without `done` or `error`, a refusal's text dropped, a full account, 429, 503
  `ask-off`, a deleted conversation's 404, opening and deleting conversations and why a delete
  failed, offline, Try again, an ended session, and everything forgotten on sign-out or another
  user.
- `src/stores/__tests__/session.spec.ts`: sign-in from a remembered user (online, offline, ended), a
  still-valid cookie, switching user, every login refusal, invite links, sign-out forgetting the
  device's data, and sign-out refused offline.
- `src/components/__tests__/Ask.spec.ts`: the Ask page in the mounted app: the bar's Ask button
  only while the API says Ask is on, `#/ask` falling back to the week while it is off or unknown,
  focus in and out, signing out on it, the empty page with and without goals, the box named "Ask"
  with nothing beside it and the intro at 72ch (K83), the View switch (Document first, Conversation
  remembered per device, an unknown stored value falling back; K84), an answer streamed
  and counted, Return sending (Shift+Return a new line, an input method's Return its own, nothing
  while an answer is written), Stop, a failed answer and Try again, the cap, offline, unsynced
  changes, a full account, and the history panel: grouped by Today, Last week and Earlier,
  deleting one or all after asking with focus kept in place, a failed delete, the strip the
  device remembers, and the drawer on a phone.
- `src/components/__tests__/SettingsAsk.spec.ts`: Settings → Your goals (its place and label, one
  save per pause in typing, at once on leaving the box or closing the page, nothing kept of a
  draft another tab signed out under, goals saved elsewhere never over a draft, closed until the
  saved goals are known, a new account), and Export and Import with Ask's history (the server's
  conversations in the file, none or offline, goals that fill empty ones, conversations already
  here left out of the count).
- `src/components/__tests__/Connections.spec.ts`, `Connect.spec.ts` and
  `src/lib/__tests__/connections.spec.ts`: Settings › Connections (the address and Copy, the Apps
  and Tokens lists, the New banner, creating a token and showing it once, Remove after a
  confirm, the caps and the refusals), the consent screen at `#/connect/<id>` (signed in and
  out, Read only chosen, a wrong password, the lockout, an expired link, Deny) and the calls and
  wording behind them, all against the fake API.
- `src/components/__tests__/App.spec.ts`: the mounted app in jsdom. Covers rendering, the today
  column, stepping a cell through its marks with `aria-pressed` (a food only on and off), the goal stepper and its bounds,
  navigation, confirm-before-remove, print, the visibility and one-minute clock refresh, another
  tab's writes to the cache, the Add exercise and Add food dialogs, the Settings page (the hash, focus on arrival and on the way back; no Ink setting, and a saved accent kept as it is), and the
  theme: the `dark` class following the OS (with a stubbed `matchMedia`), the theme control and
  its persistence. Also the weight and sets fields, the edit dialog (found by `role="dialog"` on
  `document.body`, where Reka's portal renders it), normal mode hiding every editing control, export (with
  `URL.createObjectURL` stubbed) and import through the file input (summary, confirm, cancel,
  errors), Edit plan's daily targets (centred on each title line, reading "per day", 1–8,
  synced), and no Copy plan button (K58). Also an item's page: each name a link in both grids and
  Edit plan, the page with no bar and focus on its name, Back through history or replacing an
  address with focus on the name again, an address naming no item, an old address showing the
  latest plan, waiting for the data, signing out on the page, another tab removing the item, and a
  note, a field or a plan change typed there showing on the week. The dialogs' Note field saves
  the notes for every week, counts near the limit and keeps everything when they're too big to
  save. Tests that
  edit the plan mount with `mountConfig()`, which turns config mode on. Queries that would also
  match the diet grid scope to `[data-testid="exercise-grid"]`; the rest rely on exercise-only
  labels or on the exercise form coming first in the DOM. Every mount is signed in as alice through
  `signedIn()`.
- `src/components/__tests__/Auth.spec.ts`: the sign-in form and its messages, an ended session, a
  double submit, creating an account (the link from sign-in, signing in by email, matching
  passwords, each refusal on its field or the form, offline, a double submit, back to sign in, and
  `#/signup` while signed in), invite and reset links (matching passwords, the length rule, expired links, a link
  pasted into a running tab), sign-out (with unsynced changes, and refused offline), and the sync
  status messages and triggers (loading, offline with and without a copy, retry, the conflict
  notice, focus, visibility and the minute tick).
- `src/components/__tests__/Planner.spec.ts`: the planner on the design system's marks, in the
  mounted app: a day that meets the daily pick (its name in pen, underlined, and its words, K30, K60),
  today (full-date names with "today", `aria-current`, no band, K36), rows with no goal or total
  (K33), Edit plan's rows (Edit in the name
  cell, Remove in its own last column, stable row height, focus after a removal), the keyboard (one tab stop per grid,
  arrows, the skip link, the arrows between the screens, Edit plan's controls reached with F2), an
  item's note on its own line, parked behind its cell and the same on every week (K43), and headings
  and print attributes. The layouts themselves (filling, folding, the out-of-sight navbar) depend on media
  queries jsdom doesn't apply, so the e2e suite covers them.
- `src/components/__tests__/TrackerRow.spec.ts`: one row on its own: a note's popover opening with
  the note rendered and its link opening a new tab, no note line without a note or with an empty
  one (K43), and a long note kept to one line in the row and whole in a panel that scrolls.
- `src/components/__tests__/ItemPage.spec.ts`: the item page on its own: the head and focus on the
  name, layout A's rows in order, each labelled by its heading (K65), notes (markdown, Add or Edit notes, saving
  as you type, Done and Escape, the count from 19,000, over 20,000 and over 32 KB, the server's copy
  arriving while editing), details (the type's fields, the 500 limit, the Link's "Open … in a new
  tab", printing filled fields), this week's plan (each change applied at once, a number that isn't
  valid, another week, a food's goal), an item not in the week (its latest plan, read-only),
  recent weeks, and arranging (K66: the shown sections in the type's order, Show, Move up and
  Move down, focus kept on the moved section's button, the ends, Escape, every section hidden).
- `src/components/__tests__/RecentWeeks.spec.ts`: the list labelled by its heading, newest first,
  "This week" and the dates read aloud, the marks as pictures hidden from a screen reader, each line
  as one sentence, the count against the goal with a met week in pen and underlined, and the line
  over the list.
- `src/components/__tests__/Email.spec.ts`: Forgot your password? (offered only when the planner
  sends email, the same words whatever the answer, a malformed email, one request however often
  it's pressed) and confirming an email (the banner, Send it again, too soon, already confirmed,
  the link while signed in).
- `src/components/__tests__/PlannerScreen.spec.ts`: the planner's screens in the mounted app
  (K24–K27, K79–K82): the `planner-screens` class and Edit plan's sticky bar, no top-edge strip,
  the bar led by the week in `title-1` with no wordmark and "This week" first among the actions,
  no Edit plan BarAction but "Done" (filled) in Edit plan and the keyboard's hidden "Edit plan"
  after "Skip to today",
  a long press turning Edit plan on and a second one off (by mouse or finger; not when let go
  early, moved, cancelled, held with another button, or in a field, popover, dialog or the bar),
  the held day cell or button left unpressed, a later click not swallowed, a finger's or pen's
  context menu kept back, the handle's press and pull opening Edit plan, Escape taking focus out
  of the floating bar, and the arrows between the screens, named for where they go (K42).
- `src/components/__tests__/DietSection.spec.ts`: the diet section in the mounted app: default
  foods, ticking (totals checked in the store), shared week navigation, add and remove (after
  a confirmation) and the goal set in the Edit food dialog (in config mode), cross-tab sync.

`vitest.config.ts` sets coverage thresholds (100% lines and functions, 99% statements, 98%
branches), so `npm run test:coverage` and CI fail when coverage drops below them. Coverage covers
`src/` except `src/main.ts`, the tests themselves and the development-only `src/styleguide/`. The
copied shadcn-vue source in `src/components/ui/` counts like any other code.

Every test that depends on the date pins the clock with `vi.useFakeTimers({ toFake: ['Date'] })`
(the minute-tick test also fakes `setInterval`), and all tests build dates with local-time
constructors, so they pass in any timezone. The browser checks are in §3.3.
