# Add on the title line

**Question:** where does Edit plan's Add button go on the tracker's title line, so it is in view
whenever the tracker is (K113)? The grid, the rows, the per-day stepper and the arrow to the next
tracker stay as they are.

**Status:** decided (A)

**Link:** https://claude.ai/artifact/QBvAeVkTgvt88MoprwaAKj

## Options

- **A.** At the end of the title line, in its empty right-hand column, over the Remove buttons.
  (Recommended: adding and removing down one edge, and the centre stays the stepper's.)
- **B.** Right after the title, the button as it is now.
- **C.** Only a plus, a square button after the title, named "Add exercise" for a screen reader.

## Decision

**A**, picked by John on 2026-11-11 ("A: end of title line"), recorded as K113 in
[decisions.md](../../../../docs/decisions.md): SectionHeader's new `end` slot holds each
section's Add in Edit plan.

## Rounds

- **1, 2026-11-11:** the first options, on screenshots of the real app in Edit plan with the
  button moved in place (desktop 1280 × 800 and phone 390 × 844, light and dark). John asked for
  it: "lets put the "add exercise" button next to the tracker title".
