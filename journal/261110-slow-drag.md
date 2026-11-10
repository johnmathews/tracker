# A slow drag turns after a fifth (K103)

John, once K100–K102 were live: "if I scroll slowly without momentum I find I have to “push” or
“pull” quite a long way before the next page will rotate into view".

A mandatory snap rests at the point nearest the page when the finger lifts, so a slow drag had to
go past half the window. No CSS property sets that threshold.

- `useScreenSprint` now watches a drag on a touch screen. While the finger is slow (under 0.3px a
  ms over the last 100ms, or still) and the page has moved a fifth of the window, snapping is off.
  On lifting, `scrollTo({ behavior: 'smooth' })` takes the page to the next snap point the way it
  went (`turnTarget`), and snapping comes back on once it rests there.
- Snapping goes off before the finger lifts, so iOS never starts a snap-back the script would then
  have to fight; that fight is what made K98's first try jitter. A faster finger turns it back on,
  so a fling is unchanged.
- Checked in WebKit (iPhone 15, 393×793) with a simulated slow drag: down to Cardio, up from
  Exercises onto the copy of Food and then the real Food, and a 90px drag springing back. 1339
  unit tests green. John on his iPhone over Tailscale: "It works well".

## What was observed

- Confirmed: CI and the Docker publish passed on `74267b9` (16:19 and 16:20 UTC), and the live
  site's bundle at 17:20 CET held the new `snapPoints` selector, so What's Up Docker had pulled it.
- Confirmed: the WebKit runs above, which were simulated: the script dispatched touch events and
  set the scroll position itself, with snapping held off by a test style while it did. They show
  where the page goes, not how a real finger feels.
- Strongly supported: the glide is smooth on iOS because snapping goes off before the finger
  lifts, so iOS never starts a snap-back. Only John's iPhone tried it, on one iOS version (not
  recorded).

## What is deliberately not done

- The thresholds (a fifth of the window, 0.3px a ms) are not settings. John found a fifth right;
  they are one constant each in `screenSprint.ts`.
- No e2e test drives a real slow drag: Playwright can't make WebKit scroll by touch, so the unit
  tests and the simulated WebKit runs cover it.
- The touch listener is still not passive at all times (F2 of the iOS scroll review,
  manual-20261110T122605Z); it now also measures the drag. Left for its own change.

## Wrap-up (/done)

- Added a `## Shipping` section to `CLAUDE.md`: lands by direct push; production is the Docker
  publish on `main` that What's Up Docker pulls.
- A docs audit against the shipped code found eight places still describing touch scrolling as the
  browser's snap alone (architecture, the PlannerScreen README, the main.css comment and four
  comments in `screenSprint.ts`); all now name K103. K98's row keeps its body and carries the
  amendment in its lead-in, as the other amended rows do.
