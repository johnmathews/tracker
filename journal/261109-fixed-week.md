# The week fixed at the top, and a wheel that turns straight back

On 2026-11-09 John asked for the date to stay put while he moves between trackers: "the date
(week) stays the same for both trackers and i want it to be fixed and not scroll, and i want only
the tracker content to scroll". The mockup `brand/design-system/mockups/261109-fixed-week` offered
a hairline under the date once a screen is beneath it (F1) or none (F2). He picked F1: K88.

## What changed

- **K88.** WeekHeader, the page's one `h1`, moved out of the Exercises section to sit before the
  screens.
  - On the planner's screens it is a sticky band on the canvas, `--week-band` tall. It has a
    hairline in `line` once `window.scrollY` is above 0.
  - Each screen is the window's height less the band, starting 12u under it.
  - SectionHeader lost its `week` prop: each screen used to draw its own copy of the date (K86).
  - Food's way-back arrow moved onto its title's line. At 48px down it had landed on the day
    names.
- **The sprint** (`useScreenSprint`).
  - `bandHeight()` measures the band while it is sticky.
  - `go()` takes the band off the window and off each screen's top, so `sprintTarget` sees only
    the part the screens move in, and each screen rests just under the band.
  - `sprintToScreen` (the arrows) does the same.
  - A phone on its side sets `--week-band: 0px` and hides the band, so nothing changes there.
- **K89.** John tried it: "if i scroll down i cant immediatly scroll back up, or vice versa". The
  cause predates K88.
  - After a sprint, every wheel event extended the 180ms quiet window, so a turn back was swallowed
    until the wheel paused.
  - Now `sprintTo` records the way it went, and a wheel the other way stops the sprint and scrolls.
    Momentum always runs the sprint's way, so it is still swallowed.
  - A new e2e test failed before the fix: down three steps, then up at once, and the page stayed
    on Food.
  - John: "ah yes that works better".

## Tests

- **Unit.** The App spec checks one `h1` in the band before the screens, with the hairline after a
  scroll. The sprint specs check the band's height, resting under it, the arrow sprint, and the
  wheel turning round mid-sprint and after.
- **e2e.** `screens.spec.ts` measures resting places from the band's foot rather than the window's
  top. Without that, Exercises ending under the band read as "both screens showing".

## Also

The main checkout's `node_modules` had gone stale while recent work ran in worktrees:
`markdown-it` was missing, and 15 suites failed to load. `npm ci` fixed it.
