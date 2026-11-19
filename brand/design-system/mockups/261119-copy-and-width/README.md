# Programmes: the copy landing, and the preview's width

**Question:** two questions from John's look at the build (#88), each answered on its own. (1) After
Copy to library, how the page shows where the copy went: a scroll to the top of the account's
library, and a short mark on the copy. (2) How wide the open Preview and start frame (and the shared
Preview dialog) is on a wide screen. Everything else on the Programmes page stays as it is.

**Status:** decided

**Link:** https://claude.ai/artifact/DT4qBw87TnFq6qMJhQ7GkE

## Options

No option adds a colour. The motion values are the candidates. With reduced motion on, every option
scrolls at once and shows its mark without moving or fading.

### 1. The copy landing

Every option first scrolls smoothly to the top of the library, where the copy is first, and moves
focus to the copy's name. The success line at the top of the tab goes; the shared row's button still
reads Added to library.

- **A.** The row slides down 8px and fades in over 240ms on a `tile` ground, holds the tile for
  1.5s, then fades it over 600ms. (Recommended: the system's own selected ground, no new colour,
  nothing left behind.)
- **B.** The row fades in over 300ms with a 2px `ink` rule on its left, which holds 2s, then fades
  over 600ms.
- **C.** No motion but the scroll: a "Just added" Chip after the copy's name for the rest of the
  visit.

### 2. The preview's width

Today the open frame stops at 820px. The fields keep their width in every option, and a phone is
unchanged.

- **A.** The open frame runs to the page's right margin and the grid fills it; closed rows stay at
  820px. The shared Preview dialog widens to the screen less 48px each side. (Recommended: it uses
  the screen there is.)
- **B.** The frame and the dialog widen to at most 1280px.

## Decision

John, 2026-11-19: 1. "A. Tile, then fade (Recommended)" and 2. "A. The page's full width
(Recommended)". They became K174 and K175 in `docs/decisions.md`.

## Rounds

- **1, 2026-11-19:** the first options; question 1 is a live prototype with Replay.
