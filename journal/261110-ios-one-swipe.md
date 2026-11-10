# One swipe, one screen on the iPhone (K98)

On 2026-11-10 John tried the deployed app on his iPhone: "a small scroll down or scroll up goes
past the next tracker. It scrolls 3 trackers down (or up) which gets me back where I started."

## Cause

- K94's "one push, one screen" lock (`spent`) only covers the wheel. The touch path had none.
- After a finger lifts, every scroll within FLING_MS (1.2s) that brings a line a step in sprints
  at once (K45).
- iOS doesn't stop its own momentum when the page calls `scrollTo`. The sprint set the position
  each frame for 260ms. Once it landed, the momentum still running carried the page over the next
  line, which sprinted again, and so on through the trackers.

## Fix

- `holdStill()`: a sprint that starts within FLING_MS of a lift sets `overflow: hidden` on
  `<html>`. On iOS that ends the momentum; `scrollTo` still moves the page. `letGo()` removes it
  when the sprint lands, when a wheel turns it round, when the planner is switched off, and on
  unmount.
- Desktops keep their scrollbar: the overflow is only hidden after a finger lifts.
- As a backstop, after a fling's sprint lands, the page is `pinned`. Any scroll without a finger
  goes back there until the scroll has been still for REST_MS. A new touch or a new wheel gesture
  unpins it.

## Tests

- A unit test replays a small swipe with iOS-style momentum that runs on for 900ms after the
  sprint lands. Before the fix, it ended at 3290px, two screens past Cardio; now it stays on
  Cardio, and the next swipe moves to Food.
- Two more check that the overflow is hidden only for a fling's sprint, never a wheel's.
- Neither jsdom nor Playwright has iOS momentum, so the real check is John's iPhone.
