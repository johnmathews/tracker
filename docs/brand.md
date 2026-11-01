# Brand and design system

> Purpose
>
> Where Tracker's brand lives, what its colours, type and marks mean, how the design
> system is kept, and how to change it. Read it before designing or building any screen.

## 1. The direction

The brand is **Notebook**: a paper fitness tracker made durable. It borrows the whiteboard's focus
on now (today and this week get one bold, obvious place), the restraint of Apple Notes, the quality
of a Moleskine without its nostalgia, and the star chart's mark per session made by hand. Two
layers keep the tension apart: **Now** (the week filling the screen) and
**Record** (months and years, quiet and dense). The reasons, goals, anti-goals and the calls K1–K8
are in the [brand design](specs/2026-10-24-brand-design.md), and the rulings in
[decisions.md](decisions.md) §4.

## 2. The design system

The design system is a claude.ai Design System artifact:
<https://claude.ai/artifact/9pkE17ugXFGGyBirapyCgH>. It holds the brand book, the tokens in a light
and a dark theme, 33 components with live previews and guidelines (Basics, Forms, Overlays, Planner,
Feedback, Screens), the cover and the assets. The artifact is private to its owner until it is shared, so
other readers work from the source below. Agents designing for Tracker read its README
first.

Its source lives in this repository, at the same paths the artifact uses:

| Path                                             | Contents                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `brand/design-system/SYSTEM.md`                  | The artifact's URL                                                           |
| `brand/design-system/checks.json`                | The gate's settings: required components, extra contrast pairs, banned words |
| `brand/design-system/project/design-system.json` | The index: title, asset records (upload ids)                                 |
| `brand/design-system/project/tokens.json`        | Every colour, type style, space, radius and shadow                           |
| `brand/design-system/project/*.md`               | The brand book: README, `foundations.md`, `voice.md`                         |
| `brand/design-system/project/components/<Name>/` | Each component's `README.md` and `preview.html`                              |
| `brand/design-system/project/assets/`, `fonts/`  | The wordmark and icon SVGs (uploaded), and the self-hosted fonts             |

`scripts/check_design_system.py` is the gate. It measures every contrast pair in both themes, checks
the token shapes and the banned words, and with `--complete` fails when a required component has no
card. `python3 scripts/design_preview.py brand/design-system` builds an offline gallery into the
git-ignored `brand/design-system/preview/`.

## 3. Colour roles

Every colour on screen comes from a role. The ten standard roles carry the screens: `canvas` (the
page), `panel` (dialogs, the popover), `tile` (quiet fills, hover, chips), `line` (hairline rules,
never a control border), `control-border` (inputs, outlined buttons, the day's box), `ink`
(text, icons, the primary button's fill), `on-ink` (text on an `ink` fill), `ink-secondary` (dates,
goals, hints), `error-ink` (form errors) and `focus` (the focus ring). `scrim` dims the page behind a
dialog.

Four project roles each mean one thing, and nothing else may use them:

| Role          | Means                                                                                                                               | Never                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `pen`         | Great: a day's mark, a day that met the daily pick (its name, underlined), and a met week's count in Recent weeks (underlined, K64) | Links, buttons, decoration |
| `pen-partial` | Partly done: a day's mark                                                                                                           | Over the pick, warnings    |
| `pen-missed`  | Tried and couldn't: a day's mark                                                                                                    | Errors                     |
| `caution-ink` | A caution, always with words; nothing on the planner uses it (K28)                                                                  | Errors                     |

The primary action is `ink`, not a brand colour (K8): one colour for "act", the pens for "done".
Outside the day's mark, no meaning rests on colour alone: a met day's name and a met week's count
are underlined as well as green (K60, K64), and today adds "today" to the name. The day's mark is the one exception, by the
owner's choice (K15): its pen alone tells great, partial and missed apart on screen, and the
accessible name says "partly done" or "couldn't do it".

## 4. The three pens

A day's mark comes in three kinds, like the green, yellow and red markers by a whiteboard (K9, K10,
K15, K18). The pens are fixed: there is no Ink setting any more.

| Pen           | Mark                    | Light     | Dark      |
| ------------- | ----------------------- | --------- | --------- |
| `pen`         | Great: the box filled   | `#2e7a4c` | `#3fd273` |
| `pen-partial` | Partial: the box filled | `#f2b300` | `#ffc21a` |
| `pen-missed`  | Missed: the box filled  | `#c0392b` | `#ff5c4d` |

`pen` reaches 4.5:1 as text on `canvas` and `panel` (a met day's name, a met week's count), and `pen` and `pen-missed` reach
3:1 as a mark on `canvas`, `panel` and `tile` in both themes; the gate measures every
pair. `pen-partial` is a sunny marker yellow by the owner's choice (K18): 1.5–1.9:1 on the light
grounds, below the 3:1 a mark should reach, and above 7:1 in dark. The dark pens are vivid, a grass
green, a sunflower yellow and a tomato red (K22). The gate holds it to 1.5:1 so it
can't fade further, and the box drawn over every mark keeps a yellow day findable. Today has no band
(K36); `control-border` (`#888175`) keeps the box at 3:1 on every ground.
`pen-missed` is not `error-ink`: a missed day is a record, not a fault, and `pen-partial` is not
`caution-ink`.

**The stored accent stays.** The API, the export file and the shared fixtures still carry the old
setting as `accent`, any `#rrggbb`, with `#30d158` as the default (K3a). Nothing draws it now and
nothing in the app changes it; it is kept so older data and exports round-trip unchanged.

## 5. Type

The type is set for the gym, not the desk (K19): big enough to read at arm's length, never
delicate. Source Serif 4 sets the display date, section titles, the wordmark and notes (italic).
Source Sans 3 sets everything else, numbers included, with tabular figures (K4: no monospace). Both are
self-hosted from the Fontsource variable packages, because the CSP allows fonts only from `'self'`.

| Class        | Size and weight                     | Use                                                                            |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------ |
| `display`    | 44/48 serif 600 (36/40 below 640px) | The week heading, on paper only                                                |
| `title-1`    | 30/36 serif 600                     | Section titles                                                                 |
| `title-2`    | 22/28 sans 600                      | Dialog, popover and prompt titles                                              |
| `body-large` | 20/28                               | Summary lines, row names (600)                                                 |
| `body`       | 18/26                               | Running text, inputs, buttons                                                  |
| `caption`    | 16/22                               | Goals, hints, dates                                                            |
| `label`      | 16/22 600                           | Field labels, chips (18 in a row, K46); day names at the rows' name size (K60) |
| `note`       | 18/26 serif italic                  | A person's note                                                                |

Labels are sentence case, never uppercase with letter-spacing.

## 6. The marks

| Mark    | Look                                                      | Also carried by                            |
| ------- | --------------------------------------------------------- | ------------------------------------------ |
| Great   | The hand-drawn box filled in `pen`, in a 64px button      | `aria-pressed="true"`                      |
| Partial | The box filled in `pen-partial`                           | `aria-pressed="true"`, "partly done"       |
| Missed  | The box filled in `pen-missed`                            | `aria-pressed="true"`, "couldn't do it"    |
| Empty   | The empty hand-drawn box, about 45px, in `control-border` | `aria-pressed="false"`                     |
| Today   | Nothing on screen (K36)                                   | "today" in the name, `aria-current="date"` |
| Note    | A 10px folded corner in `ink-secondary` (NoteMark)        | "has a note" in the name                   |

A marked box is filled with one of three marker drawings, each the outline of the owner's own
marker ink traced from a photo (K17): an open zigzag, a solid fill and a dense hatch. The drawing
carries no meaning; the person chooses it by pressing, and it is saved with the day. A press steps
an exercise's day drawing first: great, partial and missed in the zigzag, then in the solid, then in
the hatch, then back to empty. A food has one kind, so it steps through great in each drawing, then
empty. The box is drawn over the fill, and the ink runs a little past the box, as a quick hand does. Every mark counts towards the week and the day's count against the daily pick.

**Mark sets** (K20, K21). Settings' **Marks** chooses how marked days are drawn on this device:
Squiggles (the drawings above, the default), Ticks (a tick, a circle, a cross), Stamped ticks,
Faces (happy, so-so, sad) and Stamped faces. Ticks and faces are a marker stroke in the pen with
the box drawn over it; a stamped set colours the box solid in the pen and leaves the symbol in
paper (`canvas`, the light canvas in print). In light, paper on `pen-partial` is 1.8:1, below 3:1,
by the owner's choice (K23); the gate holds it to 1.5:1. A set changes only the look: the stored
mark stays, so a squiggle drawing comes back on switching back. In a tick or face set a press steps
an exercise great, partial, missed, then empty, and a food great, then empty. The symbols give
each kind its own shape, so in those sets the kinds no longer rest on colour alone.

Print is the light theme on white paper, from either theme (K16): words, boxes and marks keep their
light colours, the surfaces go transparent and chips are outlined. Icons are Lucide outline at 1.5px stroke, never Unicode glyphs or emoji. Colour transitions
last 120ms at most and stop under `prefers-reduced-motion`. Nothing celebrates.

## 7. Voice

Plain, calm and brief, in the second person. Small numbers in running sentences are words ("Two of
three. One to go."), and figures stay figures in data ("10 of 12 this week"). No exclamation marks,
no hype, no guilt: facts, then the next step. A confirmation names the thing and uses the verb
("Remove Push-ups?", Remove), never OK or Yes. `voice.md` in the system has the rules and examples,
and its corrected copy is the source for screen strings. Its "Signing in and creating an account" section
sets the account screens' words: every account is an email, the sign-in field is "Email", a failed
sign-in names both and blames neither, creating an account asks for an email and a password (twice) under
"Create account", and where the planner sends email, "confirm" (never "verify") and "Forgot your
password?" join them. Its "Email" section sets the two emails' words: a subject naming the one
thing, one sentence, one button, how long the link works, and what to do if it wasn't you. The
gate rejects the banned words in
`checks.json`. The app's name, "Tracker" since 2026-10-26 (K44), is held in one constant,
`APP_NAME` in `src/lib/app.ts`.

## 8. In the app

The tokens reach the app as `src/styles/tokens.css`, generated by `npm run tokens`, and
`src/styles/main.css` maps each role to a Tailwind utility (`bg-canvas`, `text-ink-secondary`).
Components are built from the primitives in `src/components/ui/`, which follow the cards, and the
dev-only `/styleguide` route renders them in both themes. The planner is a screen per section, the
week filling each (K24–K27; the PlannerScreen card); main.css's `screen:`, `full:`, `folded:` and
`short:` variants and its `--u` sizes carry that layout.
[architecture.md](architecture.md) §6 describes the pipeline, and [development.md](development.md)
§3 the rules for writing components.

## 9. Changing a token

1. Edit `brand/design-system/project/tokens.json`.
2. Run the gate. It must exit 0 in both themes:

   ```bash
   python3 scripts/check_design_system.py brand/design-system --complete
   ```

3. Regenerate the app's tokens, then run the tests:

   ```bash
   npm run tokens && npm test
   ```

   A new role also needs its `--color-<role>` line in `main.css`'s `@theme inline` block, and a
   print value in its `@media print` block.

4. Publish the changed files to the artifact with `root: brand/design-system`. Send
   `design-system.json` only when its own keys change, and last.

Edits made on the artifact page itself are not in the repository. Read the changed files back
before editing here.

## 10. Adding a component

1. **The card first.** Write `project/components/<Name>/README.md` (the first sentence is the
   summary, then use, states, accessibility and what the consumer provides) and `preview.html`
   (line 1 is the `<!-- @dsCard group="…" height=N -->` marker, then a small page using only
   `var(--token)` and the type classes, in real copy). Add the name to `checks.json`
   `required_components`, run the gate, and render the previews at 375px with the
   design-system skill's `render_previews.mjs`: only the Cover may overflow.
2. **Then the Vue primitive,** in `src/components/ui/<name>/` (`<Name>.vue` and an `index.ts`). Start
   from shadcn-vue on Reka UI wherever the component has behaviour (focus, keyboard, overlays),
   style it with role utilities and type classes only, and add a spec in
   `src/components/ui/__tests__/`.
3. **Then the style guide section,** `src/styleguide/sections/<Name>Section.vue`, with one entry in
   `src/styleguide/sections.ts`, showing every state from the card.
4. Publish the card to the artifact as in §9.

PlannerScreen is a layout, not a primitive, so it has no Vue primitive or style guide section.
Its class lists are `src/lib/screens.ts`, its preview draws the layout live, and the app is where
it is checked.

The EmailLayout card is the other exception to steps 1 to 3: its preview reverses step 1's rule, with
the light theme's values written inline and no `var(--token)` (email clients read neither; the gate
checks it), and an email is not app UI, so it has no Vue primitive or style guide section. Its code is `api/src/tracker_api/emails.py`, which
writes the card's preview; a test fails when the two differ.

## 11. Mockups

A visual change starts as a mockup and waits for John's pick before any code changes. Each
question gets a folder in `brand/design-system/mockups/<yymmdd>-<slug>/`:

| File         | Contents                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `index.html` | The options, built from the system's tokens, fonts and card CSS, each in light and dark side by side, contrast measured |
| `README.md`  | The question, the options, the decision (and its ID in [decisions.md](decisions.md)) and the private artifact's link    |
| `dist/`      | The build that is published and rendered; git-ignored                                                                   |

The design-system skill's `references/mockups.md` has the loop and its commands: `mockup.py new`
starts one, `mockup.py build` and `render_mockup.mjs` render it at desktop and phone width in both
themes, and the build is published as a private artifact that John picks from and comments on.
The first one, `261025-pen-partial-yellow`, records the choice of yellow (K18), and
`261025-full-screen-week` the full-screen planner (K24–K26).
