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
