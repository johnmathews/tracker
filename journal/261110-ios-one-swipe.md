# One swipe, one screen on the iPhone (K98)

On 2026-11-10 John tried the deployed app on his iPhone: "a small scroll down or scroll up goes
past the next tracker. It scrolls 3 trackers down (or up) which gets me back where I started."

## Cause

- K94's "one push, one screen" lock (`spent`) only covers the wheel. The touch path had none.
- After a finger lifts, every scroll within FLING_MS (1.2s) that brings a line a step in sprints
  at once (K45).
- iOS doesn't stop its own momentum when the page calls `scrollTo`. The sprint set the position
  each frame for 260ms; once it landed, the momentum still running carried the page over the next
  line, which sprinted again.

## First fix, reverted

- `9dbb1cf` hid the page's overflow during a fling's sprint, to end the momentum, and then held the
  page where the sprint put it with `scrollTo` until the scroll was still.
- The unit tests passed, but on John's iPhone (over Tailscale, against the local dev server) it
  jittered and then wouldn't leave Cardio: "It's all jittery. It doesn't work and is unusable."
- It had already deployed. `2cab505` reverted it.
- The lesson: a script can't fight iOS's momentum frame by frame. jsdom and Playwright have no iOS
  momentum, so only the phone could show it.

## The fix: let the browser snap on touch

- main.css, for `(hover: none) and (pointer: coarse)` on the planner's screens:
  `scroll-snap-type: y mandatory`, `scroll-padding-top: var(--week-band)`, and on each screen
  `scroll-snap-align: start` with `scroll-snap-stop: always`. `always` is what stops a hard swipe
  at the next screen.
- `touchSnaps()` in `screenSprint.ts` matches the same query. There the composable leaves scrolls,
  wheels and resizes to the browser; a swipe past an end still wraps round (K92).
- `sprintTo` turns snapping off (`snapOff`) while it moves and back on when it lands or stops, so
  the arrows and a wrap aren't pulled back to a snap point each frame.
- A mouse or trackpad keeps the sprint: K38's reason (a wheel stuck at a tall screen's end under
  mandatory snapping) still holds there.
- John on his iPhone: "The locally running version is scrolling well on iOS."

## Tests

- Unit: on a touch screen a swipe, its momentum, a wheel and a rotation call no `scrollTo`;
  `sprintTo` turns snapping off and back on when it lands or is stopped.
- iOS behaviour itself was checked by hand on John's iPhone.
