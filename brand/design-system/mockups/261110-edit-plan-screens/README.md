# Edit plan, one tracker per screen

**Question:** Edit plan gets one tracker per screen, as the week has (K24, K38, K98), under its
sticky bar. How does a tracker fill its screen? The bar, the pencils, the bins, the "per day"
Stepper and the Add buttons stay as they are. Reverses K27's free scrolling for Edit plan.

**Status:** decided (2026-11-10)

**Link:** https://claude.ai/artifact/99qyJKWwMsg7CcHvm67kG5 (private)

`edit.js` and `edit.css` draw a frame you can scroll, with the bar sticky and each tracker at least
the frame's height less the bar's. Scroll snapping stands in for the app's sprint (K38, K98). New
values are `--candidate-*`.

## Options

- **A. Like the week: the rows fill the screen.** Rows share the screen's height, 56px to
  1.25 × a day's width (`--candidate-row-max`); a short tracker sits in the middle; Add under the
  grid, the down arrow centred at the foot. (Recommended: the grid stays in nearly the same place
  going between the week and Edit plan.)
- **B. Edit plan's rows, from the top.** Rows keep the fixed max(76px, 100u) (K54); the tracker
  starts at the top of its screen; the space left over stays empty.

On a phone held upright the two look the same.

## Decision

John picked **B** on 2026-11-10: "Rows should keep todays fixed edit plan size and start at the
top of each screen. any space left over stays expty at the foot." Recorded as K99.

## Rounds

- **1, 2026-11-10:** A or B, with today's Edit plan for comparison.
