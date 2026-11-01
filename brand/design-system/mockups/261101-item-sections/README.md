# Choosing the item page's sections

**Question:** the item page (layout A, K65) gets a way to choose which sections it shows and in
what order. Where is that choice made? The page's sections and their content stay as they are.

**Status:** decided (2026-11-01): option A, one arrangement per type, saved with the account (K66,
P29 in [decisions.md](../../../../docs/decisions.md))

**Link:** https://claude.ai/artifact/4j9Q3zPxTeVWSuWR7cSmoF (private)

The page is live (`item.js`, `item.css` from the 261101 item-page mockup, plus `arrange.css`).
`marks.js` and `icons.js` hold the app's drawings and the Lucide icons. `try.html` shows it full
size, with a switch for the option, the item, the state (the page, or arranging) and the theme.

## Options

Shared by all three: each section has a Switch, "Show", and IconButtons "Move up" and "Move
down" (buttons, so the keyboard and a screen reader can reorder; dragging could come later);
changes apply at once, with no Save; one layout per type (every exercise's page, every food's
page). Each option starts with Details hidden, John's example.

- **A. Arrange on the page.** An "Arrange sections" quiet Button at the top right of the page.
  Pressing it folds each section to its heading with its controls under it, and the button reads
  "Done". Recommended: the choice lives where it shows, like Edit plan in the week.
- **B. A Sections dialog.** The same button opens a Dialog, "Sections", listing the four with
  their controls, and "Done". The page behind updates as you go.
- **C. On the Settings page.** No button on the item page; Settings gets an "Item pages" row with
  one list for Exercises and one for Food.

## Decision

John, 2026-11-01, his answers in his words:

- Where: **"A. Arrange on the page (Recommended)"**.
- Scope: **"Each type (Recommended)"**: one arrangement for every exercise's page, one for every
  food's.
- Saved: **"With your account (Recommended)"**: a synced setting (`itemSections`), so it reaches
  every device and the export.
- Details: **"Start shown"**. The mockup started each option with Details hidden, John's example;
  the built page starts with every section shown, in the default order.

Recorded as K66 (the design) and P29 (the settings field and its normalisation). The ItemPage card
has the arranging state.

Calls made while building, beyond the mockup:

- The Switch reads its label then its track, as its card draws it; the mockup drew the track first.
- At an end, a move's icon fades to 40% with no hover fill, the Stepper's rule (IconButton card);
  the mockup drew it in `ink-secondary`.
- The Arrange sections button carries no `aria-pressed`: its words change to "Done", which says the
  state. It keeps the mockup's `control-border` while arranging.
- The plan section's heading names its controls as it reads on the page: "Show Latest plan" for an
  item not in the week, "Move Plan for the week of 19 October up" for another week.
- Escape anywhere on the page leaves arranging, with focus on the button.

## Rounds

- **1, 2026-11-01:** A, B and C, each on desktop and phone, both themes. Contrast: every pairing
  is already in the system (ink-secondary on canvas 6.4:1 light, 7.7:1 dark; on panel 6.8:1 and
  7.1:1; the Switch's off track edge 3.6:1 and 5.0:1).
