# Edit plan, one tracker per screen (K99)

On 2026-11-10 John asked: "the tracker app shows one tracker per screen. This is good. In edit mode
it should also show one tracker per screen. Currently it doesn't."

## Why it didn't

- K27 (2026-10-25) chose free scrolling for Edit plan on purpose, when the add forms sat under each
  grid. `App.vue` left `planner-screens` off in Edit plan, so the sections were as tall as their
  content and nothing sprinted.

## The pick

- Mockup `brand/design-system/mockups/261110-edit-plan-screens/`, two options as live frames.
- A: the week's rows, grown to fill the screen. B: Edit plan's fixed rows from the top, the space
  over left empty. John chose B.

## What changed

- A second class, `edit-screens`, on `<html>` in Edit plan, with its own `edit:` variant. Reusing
  `planner-screens` would have brought the hidden bar, the fixed week and the week's row sizes.
- Each section is at least `100dvh - --bar-height`. AppNavbar measures the sticky bar with a
  ResizeObserver, since it wraps onto a second line when folded.
- `bandHeight()` falls back to the sticky bar when the week isn't fixed, so the sprint, the wraps
  and the arrows rest each screen under the bar. The touch snap gets the same rules.
- The way-on arrow now sits in a row with Add (a 1fr/auto/1fr grid), so in Edit plan it is centred
  on Add's line; on the week the row holds only the arrow.
- The way-back arrow sits on its own line above the title in Edit plan, clear of the per-day
  Stepper centred on the title line.

## Checked

- Unit tests (1305, coverage at 100%) and e2e (97) green locally; a new e2e test wheels through
  Edit plan at 1280×800 and checks no rest shows two trackers.
- At 1280×800 the demo's five exercises make Exercises taller than the window, so it scrolls inside
  before moving on, as a tall screen on the week does.

## The wrap round on a touch screen (K100)

John tried K99 on his iPhone: "much better. The only problem now is the wrap around part, which
works fine but isn't as visually smooth as the other scroll actions". The same day's review of iOS
scrolling (run manual-20261110T122605Z, F3) had flagged it. The wrap was the one move on touch still
made by script, frame by frame, during iOS's bounce, with snapping off and on.

- On a touch screen, inert copies now stand beyond each end as snap points. A swipe past an end is
  the browser's own snap onto a copy; at rest the page jumps to the same spot on the real screen.
- The copies are remade by a MutationObserver when a screen changes, or when `<html>`'s class does
  (Edit plan on or off), waiting for rest while the page moves.
- Checked in WebKit at 393×793: past the top lands on Food, past the foot on Exercises, under the
  week band and under Edit plan's bar. 1315 unit tests green, coverage gates met.

## Tall screens on a touch screen (K101)

John, trying the wrap: "It's good! It's better." In Edit plan: "any content that is below the fold
cannot be scrolled into view without trigger a bigger scroll onto the next tracker". On an iPhone 15
Edit plan's Exercises is 762px under a 653px window. The spec lets a page scroll freely inside a
snap area taller than the window; iOS doesn't, so a swipe went to Cardio.

- A tall screen now gets snap stops inside it (`stopOffsets`, `layStops`): every 80% of the window
  and at its foot. The week gets them too, where a screen is taller than the window (an iPhone SE,
  a Safari tab).
- Checked in WebKit at 393×793: Exercises gets one stop at 109px, its copy too; a nudge of 80px
  settles on it, with Add exercise in view. 1323 unit tests green, coverage gates met.

## Up onto a tracker lands on its top (K102)

John: "If I scroll up onto a tracker I want to go to the beginning of that tracker not the end of
it", and "Scrolling is still a bit flickery" with a long Food tracker.

- Stops now go only on the screen the page rests on. Going up from Cardio the next snap point is
  Exercises' top; once there, its stops appear and each swipe down shows the next part.
- Copies carry no stops, and a copy is remade only when the screen it copies changes. Before, any
  change in any screen remade both copies (a large clone of a long Food), and laying stops counted
  as a change. Checked in WebKit: four rests across Edit plan remade no copy.
- Finding the screen shown allows 2px, so a screen resting a pixel low still counts.
