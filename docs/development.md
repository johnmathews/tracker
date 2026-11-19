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
  `scripts/design_preview.py`) need only Python 3's standard library. So does
  `python3 scripts/app_icon.py --check`. Writing the icons' PNGs and `favicon.ico` also needs
  `rsvg-convert` and ImageMagick (`brew install librsvg imagemagick`).
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
  `paused-ink` is for a pause and nothing else: the programme grid's "Paused until …" line (K166),
  and the lead of the week view's paused row and of the item page's lede (K169).
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

A component that needs the server's data, as the programme primitives do, gets example data built
in the browser in the shapes the API sends (`sections/programmeExamples.ts`: a run, its grid, and a
fake server that answers the ChangeSheet's preview and confirm without a request). The web image
leaves the root `fixtures/` out and type-checks the style guide, so a section never imports it or
anything under `__tests__`. A test fails while a folder in `src/components/ui/` has no section
(`src/styleguide/__tests__/complete.spec.ts`).

### 3.2 The design gate and the tokens

The design system's source is `brand/design-system/` ([brand.md](brand.md)). After any change to
it, run the gate, which must exit 0:

```bash
python3 scripts/check_design_system.py brand/design-system --complete
```

It checks contrast in both themes for every role pair, the three pens included, the token shapes, the banned words,
and that every required component has a card. After a change to `tokens.json`, regenerate the app's
tokens with `npm run tokens` and commit `src/styles/tokens.css` with it. Never edit that file by
hand. After a change to the DayMark's box or tick paths, or to `pen` or `on-ink`, redraw the app
icon and favicon with `python3 scripts/app_icon.py` and commit what it writes in `public/` and
`brand/design-system/project/assets/AppIcon/` (K139).

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
clock is fixed to Wednesday 21 October 2026, so every run sees the same week. The mock
(`e2e/support.ts`) answers `GET /api/state` as a version 6 state and keeps the tracker, plan,
mark and details writes, so a later read returns what the app wrote.

- `a11y.spec.ts`: axe (WCAG 2.0–2.2 A and AA plus best practice) on the style guide in both themes,
  and on the app's (its mocked week holds every kind of mark) week view, the bar called up, Edit plan, another week with "View current week" in the bar and the band (K130), Settings on each of its tabs (K119), an item's page (desktop with its notes being edited, folded at 390px, and while arranging at both sizes, with nothing scrolling sideways), a cardio item's page with its pen and Remove, and renaming one in Edit plan (K120, K121), the new item page (K104), the new tracker page with Mobility chosen and its name asked for (desktop and folded at 390px, K124), the Delete tracker dialog (K122), a tracker being renamed in Edit plan, the Ask page (an answer with the history beside it, its Delete all question open, and at 375px with the history drawer open), the folded week at 375px,
  sign-in, and create an account (empty and with errors showing), in light and dark. The style
  guide's run first finds its tracker sections on the page: SectionHeader in Edit plan with its
  pen and Delete tracker, and the new tracker page's four kinds; and the focus ring's shape, a solid 2px outline at 2px offset. Two
  "dark really is dark" tests guard the audit: on the style guide and on the app, the `.dark` class
  must be set and `--canvas` must differ from light, so a dark audit can never quietly re-run
  light.
- `phone.spec.ts`: no sideways scroll at 375px on the style guide, sign-in, create an account,
  the folded week and Edit plan, the Ask page (empty with no goals yet, and with an answer and its
  history drawer open) and the Settings page (its four tabs wrapped onto two lines, and each tab), and every cell of the folded week stays on screen as the keyboard
  walks it. `callUpBar` in `support.ts` brings the navbar into view before a test presses its
  controls, since on the planner's screens it is out of sight. With Ask on, the folded bar (K160) shows
  no Full screen, and no action overlaps another.
- `programmes.spec.ts`: the Programmes page and a run's overview against a mocked API
  (`e2e/fixtures/programmes/`): starting a programme from the Library and the overview opening;
  pausing an activity from its page, then the overview and the week showing the pause; focus
  staying on the preview bar after Show it in the plan; at phone width, a locked day not pressing
  and the overview's table scrolling inside itself, not the page; a second, non-admin account
  copying from the shared library, the copy landing in view with focus on its name (K174), and seeing no publishing; Preview on a shared row opening its
  Dialog, by week number, and copying from it (K173); the admin publishing from a row's More
  menu, its preview, then the Shared chip; an ended-early run's overview offering Re-open and
  Restart, each through its sheet; and axe on the Programmes page (opened to start), the overview
  (with a paused activity), the Library tab with the shared section, a shared programme's Preview, the Publish dialog and the
  Re-open sheet, in both themes. The mock answers 415 to a write with no JSON content type, as the
  server does. `generate.py` writes the replies from the real API, with fixed ids.
- `connections.spec.ts`: Settings › Connections (its tab pressed, at `#/settings/connections`;
  creating a token, shown once with Copy, then removed; axe with the banner in both themes; no
  sideways scroll at 375px; the address opening the tab, the arrow keys moving to Your data and
  writing its address, and a reload keeping it, K119) and the consent
  screen (a wrong password shown on both fields, then Connect returning to the app; axe signed out
  and with a refusal in both themes; a phone).
- `notes.spec.ts`: an item's note on one line under the name and chips, and a press opening it
  whole in a popover whose link opens a new tab, focus moving to the link and back to the cell on
  Escape (K43), and a long note opening in a panel that fits the window and scrolls. The mocked
  state (`e2e/support.ts`) has details with notes for Push-ups and Kettlebell halos, so the axe
  checks cover the note line too.
- `item-page.spec.ts`: a press on a name opens its page, laid out in rows (This week's plan, Notes,
  Details, Recent weeks, each heading in the 320px name column, K65, K104), and Back returns with
  focus on the name. Enter on a name's cell opens it in one press. A note typed on the page shows
  in the row on every week, and a plan change in this week's row. Recent weeks match the log, print
  keeps the head, the notes and the details only, and at 390px the page folds to one column in the
  same order, each heading over its content, with nothing scrolling sideways. Arranging (K66),
  by keyboard: Space on Show Details hides it, Enter on Move Recent weeks up three times takes it to
  the top with focus kept and then on its Move down, Escape leaves with focus on Arrange sections;
  the arrangement reaches the mocked server's settings, every exercise's page follows, a food's
  page doesn't, and a reload reads it back. Folded, each section's controls sit on its heading's
  line. The mock keeps `PUT /api/settings` and returns it from `GET /api/state`, as the API does.
- `screens.spec.ts`: a tall Strength screen, a tall Cardio screen and a tall Food screen
  (`openApp`'s `moreExercises`, `moreCardio` and `moreFoods`), wheel-scrolled down and back up a notch at a time at 1280×800: the page never
  rests showing part of both, and it reaches Food (K38); a rotation (and back, and a phone on
  its side) never leaves it resting across two screens (K40); a short trackpad fling reaches
  Food before the fling has ended (K45); each resting place is measured from the fixed week's foot
  (K88); and a wheel turned round straight after a sprint goes straight back, both ways (K89).
  In Edit plan each screen is at least the window less the bar, a mouse wheel's notches never rest
  across two, and Cardio and then Food (by the arrow) rest just under the sticky bar (K99).
  Cardio's two rows stop at 82u, from the top of their screen, the arrow at its foot (K110, K114);
  each tracker's Add, then Delete tracker, ends its title line (K113, K122); print gives each
  tracker the week shows a page of its own (K97); Edit plan's frame is 8px of `edit` round the
  window and a press on it lands on the page (K112); after Add the page rests on Strength, not
  Cardio (K111); and Edit plan on and off keeps Cardio, then Food, just under the band (K115).
- `touch.spec.ts`: a phone held upright (390×844, `isMobile`, `hasTouch`), the browser snapping. Real
  flings through `Input.dispatchTouchEvent` (a touch start, ten moves a frame apart, and the lift
  while still moving; `Input.synthesizeScrollGesture` scrolls nothing in headless Linux): a fling up
  from Cardio onto a tall Strength ends at its top, in one movement, never turning back or setting
  off again after slowing (K116, K118); and Edit plan's frame is a 4px line along the top there (K117, K162).
- `week-title.spec.ts`: "View current week" (K130) follows the bar's next-week arrow in Edit plan
  and the band's title in the week view, the two centred together, only on another week;
  Settings' Week title (K131), "Date" or "Week number", titles the bar and the band "Week 43", the
  dates read aloud after it, and sends `weekTitle` (K132). At 390px the band's button sits under
  the title at its 30px, the band a row taller until this week is back, the first screen under
  it, nothing sticking out for "20–26 October 2025"; the bar puts it under the week.
- `trackers.spec.ts`: the account's own trackers (K122–K126). Add tracker in Edit plan's bar
  opens the new tracker page; a new tracker shows last with its name, focus on its Add, and the
  tracker before it gains an arrow to it. Its pen renames it: Enter saves, Escape restores, and
  Edit plan stays on. Cancel adds nothing, and an empty name is asked for. A Mobility tracker
  made in the week before takes an item by hold time with no Weight field, is marked, carries
  into this week, and Delete tracker takes it off this week and the next while the week before
  keeps it with its mark. At 375px Add tracker sits on the folded bar's second line beside
  Settings, and the new tracker page, its four kinds in view, scrolls nothing sideways.

CI (`.github/workflows/ci.yml`) runs three jobs on every pull request and every push to `main`.
`check` runs lint, format, types, unit tests with coverage, the build, the design gate and
"tokens.css is current" (`npm run tokens` followed by
`git diff --exit-code src/styles/tokens.css`), and "App icon is current"
(`python3 scripts/app_icon.py --check`). `e2e` installs Chromium and runs `npm run test:e2e`,
keeping traces of a failure. `api` checks the Python service. One convention has no check yet: unit
tests should not query styling classes.

## 4. Tests

The app's tests sit in `__tests__/` next to the code they cover (the API's are in `api/tests/`,
listed in [api.md](api.md) §10):

- `src/lib/__tests__/dates.spec.ts`: Monday maths, offsets, year boundary, the 2026-10-25 week (a
  DST change in EU timezones), labels, and the ISO week number across 2026's week 53 (K131).
- `src/lib/__tests__/storage.spec.ts`: v2 plan validation and round-trip, migration from the v1
  (prototype) format, log normalisation, sets and weight, diet parsing, settings parsing,
  skip-unchanged writes, storage that throws, a cardio item's time and distance and no default
  cardio (K90), and `migrateKeyPrefix` moving `fitness-planner-` and
  `exercise-planner-` keys to `tracker-`, the newer name's copy winning (K44).
- `src/lib/__tests__/plans.spec.ts`: which week's plan a week shows (own, carried forward, earliest,
  none) and plan copies.
- `src/composables/__tests__/exerciseForm.spec.ts`: digits-only sets/reps and decimal weight
  cleaning, loading and resetting the shared exercise form, a new exercise's one set of one rep
  (K104), an exercise saved without sets or reps loading as it is, a cleared field left out, and
  the Measure and per-side handlers.
- `src/composables/__tests__/cardioForm.spec.ts`: the cardio form (K90): empty for a new item, and
  an item's minutes loaded to two places and reported as seconds.
- `src/lib/__tests__/markdown.spec.ts`: a note's markdown (K43): emphasis, code, lists and links
  opening a new tab; raw HTML, script links and images never rendered; headings and rules left as
  text; and the row's one line, where a link is its text.
- `src/lib/__tests__/format.spec.ts`: K14 as a test (K41). Each cache key version has a row
  recording what it stores (the marks, the fields an exercise, a cardio item and a food keep, the
  keys a cache holds, a cached section's and a cached tracker's; `-v5` added Cardio, K90; `-v6` the
  account's trackers, K123). It fails when the stored format changes under the same key, and when
  an older key isn't moved at sign-in.
- `src/lib/__tests__/transfer.spec.ts`: every case in `fixtures/transfer/` (parsing an export and
  merging one), plus building an export, the merge summary and the download. Add a fixture rather
  than an inline case when the behaviour is part of the export contract: the API's tests
  (`api/tests/test_parity.py`) read the same files.
- `fixtures/transfer/parse/v6-*.json`: the version 6 cases: an empty file, sections by tracker id
  (a kind's unknown fields dropped, such as a mobility item's weight), the trackers list and its
  normal form, and a `trackers` that isn't a list.
- `fixtures/transfer/sample/`: two pairs of a realistic `localStorage` snapshot and the export it
  makes. `storage-v6.json` is alice's cache under the current key, `tracker-cache-v6:alice`, as the
  sync store keeps it, and a `tracker-settings-v1` holding the dark theme; `export-v6.json` is the
  version 6 export it must produce. It has the first three trackers and two of the account's own
  (Upper body, and Swimming, ended), each tracker's `plans`, `log`, `details`, `revs` and
  `detailRevs`. `storage.json` and `export.json` are the version 5 pair, from before trackers: five
  weeks (2026-09-21 to 2026-10-19), four with data, and 2026-09-28 left empty so it carries the plan
  before it forward; plans edited over time (sets, weights, Back extensions removed, Plank added),
  108 ticks, a diet with an added food, cardio (Cycling with a time, Running with a distance and a
  Route, K90), details for Push-ups (notes and two fields), Fish (one field) and Running, and
  non-default settings. A new cache format needs a new snapshot: `App.spec.ts` fails when the key
  isn't `CACHE_PREFIX`'s. `App.spec.ts` seeds `storage-v6.json` and checks Export gives
  `export-v6.json`. It also imports each export into an empty account and checks the cache and the
  (fake) server both end up holding the sample, with the theme left on the device. To see the app
  populated while developing, import `fixtures/transfer/sample/export-v6.json` from Settings →
  Import… on a scratch origin. Tests read fixtures through `src/lib/__tests__/fixtures.ts`.
- `fixtures/types/registry.json`: the tracker-kind registry, the first three trackers' kinds and
  names, and each kind's fields, daily-target key, new tracker's daily target and new-item goal. `src/lib/__tests__/trackerTypes.spec.ts` and the
  API's `test_types.py` both check their registry against it, so a field added on one side only
  fails a suite.
- `fixtures/item-sections/normalise.json`: the item pages' arrangement (K66, P29), inputs and their
  normal form. `src/lib/__tests__/itemSections.spec.ts` and the API's `test_item_sections.py` both
  run every case, and the web spec also covers showing, hiding and moving a section.
- `src/lib/__tests__/trackerTypes.spec.ts`: also each type's cycle, which `cycleFor` reads, its
  labels, an exercise's chips, cardio's time and distance and a food's none, cardio's missing daily
  target, mobility (its words, an exercise's plan without weight, its marks and daily target), the
  first three trackers' order (Strength, Cardio, Food) and `isSection`.
- `src/lib/__tests__/history.spec.ts`: an item's recent weeks (eight ending with the opened week,
  newest first, none before its first plan, goals from the plan each week shows, the default plan
  when nothing is planned), the latest plan holding an item, a week's count and whether it met its
  goal, and the line over the weeks in words.
- `src/lib/__tests__/routes.spec.ts`: the item page's address written and read back, addresses that
  name no section or no good id, the new item page's `#/new/<section>` (K104), the Settings tabs'
  `#/settings/<tab>` (K119: `#/settings` as the first, a tab Settings doesn't have read as none), the history mark for
  a page opened from the week, Back and `leaveForWeek` going back through history or replacing the
  entry, a modified press left to the browser, and `webHost`.
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
  once, a short one after a pause, a finger waiting to lift, the wheel swallowed during and after
  but let through the other way, every step let through cancelled and scrolled by script while a
  pinch, a sideways swipe, an inner scroll area and an uncancellable step stay the browser's
  (`wheeled()`, `scrollsInside`, K108), the eased `sprintTo`, a resize, reduced motion, switching off,
  the fixed week's height taken off the window, or Edit plan's sticky bar where the week isn't
  fixed, and a touch screen left to the browser's snapping, with snapping off during a sprint;
  on a touch screen, the copies beyond each end, resting on the real screen after a swipe onto one
  (by `scrollend` or a timer, never with a finger down or a sprint running), and the copies made
  afresh when a screen or `<html>`'s class changes, but not for a change elsewhere or inside a copy;
  `stopOffsets` and a tall screen's stops, only on the screen shown and never on a copy, left alone
  when right and following the window's and the screen's size, and only a changed screen's copy made
  afresh; `turnTarget`, and a slow drag past a fifth of the window turning to the next screen or
  back, with snapping off while it would, a shorter drag or a fling left to the browser, a still
  finger counting as slow, a touch stopping the glide, snapping back on when it lands or after
  `GLIDE_MS`, and a jump when motion is reduced; `restOn` (a screen's top, its foot or the
  element in the middle, never across two) and `focusOnScreen` resting the page before focusing
  with `preventScroll`; `screenInView` and `restOnScreen`; `tallAbove`, and a touch from a screen's
  top freeing a tall screen above until the page rests (K38, K40, K45, K88, K89, K98, K99, K100,
  K101, K102, K103, K108, K111, K115, K118).
- `src/composables/__tests__/fullscreen.spec.ts`: full screen unsupported (an iPhone), entering and
  leaving it, and a refusal leaving the page as it is (K34).
- `src/styles/__tests__/print.spec.ts`: the print block's literal colours match `tokens.json`'s light
  values, and the surfaces go transparent.
- `src/composables/__tests__/gridNav.spec.ts`: the grid keyboard model on a small table: the one
  tab stop (today, the first day, the last cell focused), arrows, Home and End with and without
  Ctrl, Space and Enter left to the DayMark, a cell's other
  controls (F2 in, not Enter, Escape out, parked when focus leaves), rows coming and going, and a name
  that is a link (its cell's widget, Enter its own in one press, Space doing nothing, F2 into the
  cell's other controls and Escape back to the link).
- `src/components/ui/__tests__/`: one spec per primitive (AnswerProgress, BarAction, Banner,
  BrandMark, Button, ChangeSheet, Chip, ConfirmDialog, DayMark, Dialog, HistoryList, IconButton,
  InlineMessage, Menu, Popover, ProgrammeChart, ProgrammeGrid, QuotaChip, RadioCard, SectionHeader, SegmentedControl, SidePanel, Stepper, Switch,
  Tabs, TextArea, TextField, TextLink, Transcript), each checking its
  roles, accessible names, sizes, states and the role colours its card names. Examples: an
  IconButton renders nothing without a label, the Popover closes when focus leaves it (F14), the
  Stepper's limits stay focusable with `aria-disabled`.
  `transitions.spec.ts` checks no primitive animates `outline-color`, so the focus ring never fades
  in. `setup.ts` fills the jsdom gaps Reka UI's overlays reach for.
- `src/lib/__tests__/programmes.spec.ts`: the words around programmes (the app computes no plan
  value, P4): dates and a week's dates, each field's value and unit, the line under a value, the
  run's line (Started, paused, upcoming; K161), the validator's and the requests' problems, and
  each change's sentence. It reads the JSON in `src/lib/__tests__/programmes/`.
- `src/stores/__tests__/programmes.spec.ts`: the programmes store against a fake API: the page's
  data and why it couldn't load, offline, the library (add, problems, duplicate, delete), a start
  and its preview, a run's overview, a change's preview and confirm (a stale `rev` handing back a
  fresh preview), ending, and each tracker's run read once.
- `src/stores/__tests__/syncProgrammes.spec.ts`: the sync store's `today` and `runs`: kept for the
  next start, a damaged copy read as none, days before yesterday locked by the server's today,
  refused late marks and programme plan writes dropped with a notice (§8), and an import passing
  the library and runs through.
- `src/components/__tests__/ProgrammesPage.spec.ts`, `ProgrammeOverview.spec.ts`,
  `ProgrammeWeek.spec.ts` and `ItemProgramme.spec.ts`: the Programmes page (its tabs, the start
  opened in place, the library's actions, adding, offline, the bar's way in), a run's overview
  (the plan, Changes, the controls, Show it in the plan), a programme tracker's week (the week
  link, locked days, a paused activity's sentence, no Add in Edit plan) and an activity's
  Programme row (the step chart and its controls), all against `programmesApi.ts`, a helper.
- `src/styleguide/__tests__/look.spec.ts`: the style guide's theme from the query string, the
  round trip back to it, and the class it sets.
- `src/styleguide/__tests__/complete.spec.ts`: a style guide section for every folder in
  `src/components/ui/`, and no two sections with one id.
- `src/styleguide/__tests__/programmeSections.spec.ts`: the ProgrammeGrid, ChangeSheet and
  ProgrammeChart sections draw each state their cards show under its id, and the fake server
  previews, refuses and finds a stale plan as the real one does.
- `src/stores/__tests__/planner.spec.ts`: stepping a day through its marks, totals, week navigation, goal clamping, adding,
  removal's effect on totals, settings, detail chips, editing exercises, sets, weekly plans
  (defaults, carry forward, a week getting its own plan), config mode,
  the midnight refresh, `adopt`, `adoptWeek` and `clear`, the theme being the only thing stored
  (merged into the settings key), the keys from before accounts never being written, and
  `savedSettings` (tracked in memory, set by adopting or changing settings, never by the theme),
  no note kept in the week (an exercise's notes are its details), and `clear` forgetting the
  details too.
- `src/stores/__tests__/trackers.spec.ts`: the trackers store (K123): the account's trackers in
  the week's order, the weeks a tracker shows in (spec §2), creating one last and empty in the week
  on screen, the name rules and the 100-tracker cap, renaming, ending from the week on screen while
  earlier weeks keep its plans and marks, daily targets (none for cardio), and adopting and
  clearing. Per kind: the strength tracker's default exercises, marks, goals and plan fields; a
  mobility tracker by hold time or reps with no weight (K126); cardio (K90) with no default items,
  a time and a distance; food's default foods and eaten marks; weekly plans carried forward and kept
  apart per tracker; and the keys from before accounts never being read or written.
- `src/lib/__tests__/trackerView.ts`: a test helper, not a spec. It reads a tracker's items, plans
  and marks from the trackers store in one shape for every kind.
- `src/composables/__tests__/importSummary.spec.ts`: what an import adds (K123): trackers the account
  doesn't have and their data, data skipped for a tracker the account holds as another kind (as the
  API does), and a file from before version 6 read onto the first three trackers.
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
  - diet, cardio and settings writes, a cardio conflict, a state with no cardio read as none
    (K90), and a toggle made while its write is in flight;
  - offline queueing, the backing-off retry timer, gateway errors as offline, and 401s handing
    control back;
  - conflicts (taking the server's copy with a notice, re-creating when the server has none, no
    notice for identical creates), and refused writes being dropped (with the account-full notice
    for `quota`);
  - reads that must not undo local edits, including one the watcher has not seen;
  - other tabs' cache and outbox writes (a cache adopted, never written back, even from older
    code), stop and forget, the old keys never written, `diff` and
    `normaliseState`;
  - the older caches and outboxes moved at sign-in, the newer winning, a `-v4` one moved as it
    is with nothing lifted (K90), and a tab from before
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
- `src/components/__tests__/SettingsAsk.spec.ts`: Settings' tabs (Appearance, Daily goal, Your
  data, Connections; no goals and no Sign out on any, K107, K119), each test opening its tab by
  address; Daily goal, on by default, unknown until read
  (K85); turned off it saves with the account, hides both steppers and every met day (exercises and
  foods), and back on the numbers return; an off read from the account goes with the next settings
  write. Then Export and Import with Ask's history (the server's conversations in the file, none
  or offline, goals or limits that fill empty ones, conversations already here left out of the
  count).
- `src/components/__tests__/Profile.spec.ts`: the Profile page at `#/profile` (K106): its sections,
  labels and hints, and Back to the week onto the Profile button. Your goals and Your limits (K107):
  one save per pause in typing, at once on leaving the box or closing the page, nothing kept of a
  draft another tab signed out under, a note saved elsewhere never over a draft, closed until the
  saved note is known, a new account, and on a new account the other box still open once one note
  is saved. The profile Menu: the last action, its header and items, Profile, Sign out at once,
  asking first with unsent changes (focus back on the Profile button), and a refusal offline shown
  in the question.
- `src/components/__tests__/Connections.spec.ts`, `Connect.spec.ts` and
  `src/lib/__tests__/connections.spec.ts`: Settings › Connections, opened at
  `#/settings/connections`, the last tab (the address and Copy, the Apps
  and Tokens lists, the New banner, creating a token and showing it once, Remove after a
  confirm, the caps and the refusals), the consent screen at `#/connect/<id>` (signed in and
  out, Read only chosen, a wrong password, the lockout, an expired link, Deny) and the calls and
  wording behind them, all against the fake API.
- `src/components/__tests__/App.spec.ts`: the mounted app in jsdom. Covers rendering, the today
  column, stepping a cell through its marks with `aria-pressed` (a food only on and off), the goal stepper and its bounds,
  navigation, confirm-before-remove on the item's page outside Edit plan too (K120), print, the visibility and one-minute clock refresh, another
  tab's writes to the cache, Add opening the new item page with no bar and coming back with focus on that Add button (K104), the Settings page (the hash, focus on arrival and on the way back; no Ink setting, and a saved accent kept as it is; its tabs, K119: the order, only the open tab's section, each tab's address opening it, choosing a tab replacing the address so a reload keeps it, the address followed from tab to tab, focus back on the Settings button from any tab, and a tab Settings doesn't have opening the week), and the
  theme: the `dark` class following the OS (with a stubbed `matchMedia`), the theme control and
  its persistence. Also adding an exercise with sets from the new item page, Edit plan's rows with
  no Stepper and no Edit button (K104), normal mode hiding every editing control, export (with
  `URL.createObjectURL` stubbed) and import through the file input (summary, confirm, cancel,
  errors), Edit plan's daily targets (centred on each title line, reading "per day", 1–8,
  synced), and no Copy plan button (K58). Also an item's page: each name a link in both grids and
  Edit plan, the page with no bar and focus on its name, Back through history or replacing an
  address with focus on the name again, an address naming no item, an old address showing the
  latest plan, waiting for the data, signing out on the page, another tab removing the item, and a
  note, a field or a plan change typed there showing on the week, and a food's goal set lower
  there. Tests that
  edit the plan mount with `mountConfig()`, which turns config mode on. Queries that would also
  match the diet grid scope to `[data-testid="exercise-grid"]`; the rest rely on exercise-only
  labels. Every mount is signed in as alice through
  `signedIn()`.
- `src/components/__tests__/Auth.spec.ts`: the sign-in form and its messages, an ended session, a
  double submit, creating an account (the link from sign-in, signing in by email, matching
  passwords, each refusal on its field or the form, offline, a double submit, back to sign in, and
  `#/signup` while signed in), invite and reset links (matching passwords, the length rule, expired links, a link
  pasted into a running tab), sign-out on the Profile page (with unsynced changes, and refused offline), and the sync
  status messages and triggers (loading, offline with and without a copy, retry, the conflict
  notice, focus, visibility and the minute tick).
- `src/components/__tests__/Planner.spec.ts`: the planner on the design system's marks, in the
  mounted app: a day that meets the daily pick (its name in pen, underlined, and its words, K30, K60),
  today (full-date names with "today", `aria-current`, no band, K36), rows with no goal or total
  (K33), Edit plan's rows (the week's columns: only the name in the
  name cell, K104, and no Remove, K120; stable row height), the keyboard (one tab stop per grid,
  arrows, the skip link, the arrows between the screens, the name as its cell's one control in Edit plan), an
  item's note on its own line, parked behind its cell and the same on every week (K43), and headings
  and print attributes. The layouts themselves (filling, folding, the out-of-sight navbar) depend on media
  queries jsdom doesn't apply, so the e2e suite covers them.
- `src/components/__tests__/TrackerRow.spec.ts`: one row on its own: a note's popover opening with
  the note rendered and its link opening a new tab, no note line without a note or with an empty
  one (K43), a long note kept to one line in the row and whole in a panel that scrolls, and no
  Remove cell (K120).
- `src/components/__tests__/TrackerGrid.spec.ts`: one grid on its own: the names and the seven days
  with no Remove column or header (K120), and a day's press emitted as the item and the day.
- `src/components/__tests__/ItemPage.spec.ts`: the item page on its own: the head and focus on the
  name, layout A's rows in order, each labelled by its heading (K65), notes (markdown, Add or Edit notes, saving
  as you type, Done and Escape, the count from 19,000, over 20,000 and over 32 KB, the server's copy
  arriving while editing), details (the type's fields, the 500 limit, the Link's "Open … in a new
  tab", printing filled fields), this week's plan (each change applied at once, a number that isn't
  valid, another week, a food's goal, a cardio item's Minutes and Distance in km with their limits,
  K90, a mobility item's fields without Weight, K126), an item not in the week (its latest plan, read-only), the name's pen and Remove
  (K120, K121: the same title, pen and chips with Edit plan on and off; the pen turning the title
  into a field in its type with the name selected, saving on Enter and on Done for every type,
  Escape putting the old name back, "Enter a name." for an empty name, a rename from elsewhere, and
  Remove outside Edit plan too, asking first, going back to the week, and doing nothing when the
  week changes while it asks),
  recent weeks, and arranging (K66: the shown sections in the type's order, Show, Move up and
  Move down, focus kept on the moved section's button, the ends, Escape, every section hidden).
- `src/components/__tests__/NewItemPage.spec.ts`: the new item page (K104): an empty Name, one set
  of one rep three times a week, the type's arrangement with the plan always shown, another week's
  heading and line, adding an exercise (timed and each side too), a mobility item by hold time
  with no Weight field (K126), a cardio item and a food with
  their notes and details, nothing added without a name, over a number's limit or with notes or a
  detail too long (focus on the field), and Cancel going back through history.
- `src/components/__tests__/RecentWeeks.spec.ts`: the list labelled by its heading, newest first,
  "This week" and the dates read aloud, the marks as pictures hidden from a screen reader, each line
  as one sentence, the count against the goal with a met week in pen and underlined, and the line
  over the list.
- `src/components/__tests__/Email.spec.ts`: Forgot your password? (offered only when the planner
  sends email, the same words whatever the answer, a malformed email, one request however often
  it's pressed) and confirming an email (the banner, Send it again, too soon, already confirmed,
  the link while signed in).
- `src/components/__tests__/PlannerScreen.spec.ts`: the planner's screens in the mounted app
  (K24–K27, K79–K82, K99, K109, K113, K114): the `planner-screens` class, and Edit plan's sticky bar with its
  `edit-screens` class, screens at least the window less the bar, the arrows and `--bar-height`
  (the way on at the screen's foot, each Add in its section's title line), no top-edge strip,
  the bar led by the week in `title-1` with no wordmark and "View current week" after its next-week arrow (K130),
  no Edit plan or Done BarAction and the keyboard's hidden "Edit plan" ("Done" in Edit plan)
  after "Skip to today", the week's keys (E in and out, Esc out of full screen and then Edit plan,
  F, P and S, and none in a field, with a modifier, repeating or under a dialog; K91; A for Ask,
  only while Ask is offered, and in Edit plan for the Add of the tracker on screen, K109), H and B
  back and L forward on every page (K105),
  a long press turning Edit plan on and a second one off (by mouse or finger; not when let go
  early, moved, cancelled, held with another button, or in a field, popover, dialog or the bar),
  the held day cell or button left unpressed, a later click not swallowed, a finger's or pen's
  context menu kept back, the handle's press and pull opening Edit plan, Escape taking focus out
  of the floating bar, and the four arrows between the three screens, named for where they go
  and each sprinting to its screen (K42, K90).
- `src/components/__tests__/TrackerSection.spec.ts`: one TrackerSection per tracker in the
  mounted app (K123): the first three in order with their heading ids (`tracker-<id>-heading`),
  grids (`<id>-grid`), arrows (`to-<id>`, `back-to-<id>`) and kinds; four trackers, a new one
  last; adding items by kind (each kind's Add words, the new item page); renaming with the pen
  (K121, K124: Enter and Done save, Escape restores, an empty name refused, Edit plan kept);
  Delete tracker (K122: asking first, gone from this week and the weeks after, the week before
  keeping it with its marks, focus on the next tracker's Add or the bar's Add tracker); the skip
  link going to the first tracker; and Add tracker and the new tracker page (K124, K125: the
  registry's kinds with their lines, Mobility included, a name asked for, the cap, adding last
  from the week on screen with focus on its Add, Cancel and Back adding nothing).

`vitest.config.ts` sets coverage thresholds (100% lines and functions, 99% statements, 98%
branches), so `npm run test:coverage` and CI fail when coverage drops below them. Coverage covers
`src/` except `src/main.ts`, the tests themselves and the development-only `src/styleguide/`. The
copied shadcn-vue source in `src/components/ui/` counts like any other code.

Every test that depends on the date pins the clock with `vi.useFakeTimers({ toFake: ['Date'] })`
(the minute-tick test also fakes `setInterval`), and all tests build dates with local-time
constructors, so they pass in any timezone. The browser checks are in §3.3.
