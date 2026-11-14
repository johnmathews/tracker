# The item name's pen, and Remove only on the item page

> Purpose
>
> Records how K120 and K121 (picked on 2026-11-14, mockup `261114-item-name-pen`, options A and
> E1) were built: what changed, the calls the brief left open, and what was not run.

## 1. No Remove column in Edit plan (K120)

- TrackerRow lost its Remove cell, its `confirm` call and the `neighbours()` focus logic.
  TrackerGrid lost the Remove header, the colgroup's column and the `--grid-remove-w` template.
  Edit plan's grid now has the week's columns.
- `configMode` was only there for the Remove column, so TrackerGrid and TrackerRow no longer take
  it. The `remove` emits and the sections' `@remove` wiring are gone.
- gridNav: Enter on a cell without a widget used to let that cell's controls in. Only Remove's
  cell was like that, so the branch is gone and F2 is the one way in. Enter stays the widget's own.
- main.css: `--grid-remove-w` is gone. `--edit-ib` and `--edit-ib-icon` stay: the pen, a dialog's
  Close, and arranging's moves and Show use them.
- The folded name's `folded:pr-[15%]` in Edit plan is gone, so the name takes its whole line.

## 2. Remove on the item page in both modes (K120)

- The Remove section shows whenever the item is in the week on show, in Edit plan or not, and not
  while arranging. Its copy and behaviour are as before.

## 3. The name's pen (K121)

- The title (`title-1` at `--fs-title`) and the chips show in both modes. Edit plan's Name
  TextField is gone.
- The pen is an IconButton right after the `<h1>`, sized like the pages' other IconButtons
  (`--edit-ib`, `--edit-ib-icon`), in `ink-secondary` with `ink` on hover. It is named
  "Rename <name>".
- Pressing it shows a plain `<input>` in the title's own classes, in a `panel` box with a 1px
  `control-border`, at most `min(100%, max(20rem, 640u))` wide, with a quiet "Done" Button. It is a
  plain input, not the TextField: the page's CSS gives a TextField's input the controls' size,
  and this input keeps the title's. The `<h1>` stays visually hidden, so the page keeps one
  heading.
- Enter (but not one that ends an IME composition) or Done saves the trimmed name, through the
  store calls the old Name field used, once on commit. Escape puts the old name back and stops
  there, so arranging stays on. Either way focus returns to the pen. An empty name shows
  "Enter a name." in an InlineMessage linked by `aria-describedby`, and saves nothing.
- A rename from another tab while renaming replaces the draft only while the draft is untouched.
  Renaming ends if another tab takes the item out of the week.

## 4. Calls the brief left open

- Done is the quiet Button, like the head's Arrange sections, as the mockup draws it. The notes'
  Done is the secondary Button.
- The pen shows only for an item in the week on show, since renaming writes to that week's plan.
  An item read from its latest plan has neither the pen nor Remove.
- The style guide's WeekGrid example lost its Edit plan toggle, since the grid no longer changes.

## 5. Checks

- Run green: lint, format check, type-check, unit tests with coverage, build, the design system
  gate, and the tokens check.
- Not run: Playwright. `e2e/a11y.spec.ts` now opens Running's page and checks it with its pen and
  Remove, then presses Cycling's pen in Edit plan and checks the renaming state.
