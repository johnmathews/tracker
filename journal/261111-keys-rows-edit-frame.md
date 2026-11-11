# The A key, a row cap, staying on a tracker, and Edit plan's frame

> Purpose
>
> Records the changes John asked for on 2026-11-11 (K109–K118): the four first asked for
> (K109–K112), and the ones that followed his look at the local stack and his iPhone. For each,
> what it does, why it took its shape, what was tried and dropped, and how it shipped.

## 1. The A key (K109)

- On the week, A opens Ask, but only while Ask is offered. With no Anthropic key, as on a local
  stack, it does nothing and leaves the key to the page.
- In Edit plan, A presses the Add button of the tracker on screen. "On screen" means the screen
  showing most of itself under the bar.
- Ask and every Add button carry `aria-keyshortcuts="A"`.

## 2. A row cap from John's screenshot (K110)

- The screenshot gave a row pitch of 115.7px and a name cap height of 25px, so a name of about
  38px. Rows were therefore about 3 × the name, and the name is 27u: a cap of 82u.
- The ratio holds whatever the screenshot's pixel ratio was. Measuring in pixels would have needed
  a guess about the screen.
- First try: capping each grid track at the max (`minmax(min, max)`). Rows stopped at the cap,
  but the grid then reported its rows at the max as its natural height. So a tracker with seven
  rows no longer shrank to fit, and its screen ran 65px past the window. Dropped.
- What shipped: the rows stay `minmax(min, 1fr)`. TrackerGrid's `max-height` now adds the header
  row's real height, `--grid-head-h`, where it used to allow 100u. The header is about 58u tall,
  so the old slack had spread about 40u over the rows.
- The formula matches the measured header to the hundredth of a pixel at 1440 × 900,
  2000 × 1033 and 1024 × 768. A short screen gets its own value for its 4px padding.
- At first Cardio and Food centred the capped grid, as Exercises did. John asked for every screen to
  start at the top "like a normal webpage" instead, so that went (K114, §5).

## 3. Staying on the tracker after Add (K111)

- Reproduced in Playwright before the fix. After Add, Exercises was taller than the window, and
  focus on the Add button scrolled just far enough to show it. That left Cardio's top inside the
  window, and the sprint finished the move down to Cardio.
- The fix: `focusOnScreen` places the page on the element's screen first, then focuses with
  `preventScroll`. The screen rests at its top, at its foot for an element near its end, or with
  the element in the middle.
- The e2e test fails without the fix (Cardio's top at 109px, under the bar) and passes with it.
- Back from an item's page uses the same helper.

## 4. Edit plan's frame (K112)

- The mockup `261111-edit-frame` showed three options on screenshots of the real app. John picked
  B: a new `edit` role (#2563c9 in light, #6b9ef2 in dark), 8px wide.
- `focus` was the only blue in the system, and a colour carries one meaning, so the frame needed
  a role of its own.
- The frame is a fixed, click-through element at z-40: over the bar, under a dialog's scrim.

## 5. After John tried the local stack (K113–K115)

- **Add on the title line (K113).** At the foot of a tall tracker, Add needed careful scrolling to
  reach without sprinting on. The mockup `261111-add-on-title` moved the real button in the
  running app three ways. John picked A: the end of the title line, over the Remove column.
  SectionHeader gained an `end` slot for it.
- **Screens start at the top (K114).** John: "it should start at the top like a normal webpage".
  The screens' centring went, and the arrow to the next screen keeps to the foot with `mt-auto`.
- **Edit plan keeps the tracker on show (K115).** E changed the rows' height and docked the bar,
  but kept the scroll position. So on Cardio it showed the foot of Exercises, and on Food 200px of
  Cardio's empty foot.
  - The fix notes the screen on show in a sync watcher, the moment `configMode` flips.
  - A post watcher then rests the page on that screen's top once the new layout is in.
  - First try: a `nextTick` taken from the sync watcher. It resolved before Vue's render queue
    ran, so the page rested on the old layout.
  - The e2e test is red without the fix (Cardio 60px off) and green with it.

## 6. After the iPhone (K116, K117)

- **The frame at half width on a phone (K117).** `--edit-frame` is 8px, and 4px on a touch screen
  whose shorter side is under 600px. That covers an iPhone held either way and leaves out iPads.
- **A new tracker ends at its top (K116).** Touch swipes driven through Chrome's input pipeline
  (`Input.synthesizeScrollGesture`) showed that going down already ended at each tracker's top.
  - Going up into a tall tracker rested at its foot, because a snap area covering the window is
    itself a snap position. The wrap round rested at Food's foot too.
  - The script now notes the tracker the page rests on. When a swipe rests on a different one
    partway down, the page glides on to its top.
  - The app's own moves mark their tracker, so they are not undone.
  - The e2e test (`e2e/touch.spec.ts`) is red without the glide (Exercises 442px and 684px off)
    and green with it.
- **Not settled by the emulator:** a phone on its side. Emulated sideways swipes misbehave with
  and without this change. Short swipes don't move, and a swipe up can leave the page waiting
  for a finger that already lifted. John's iPhone is the test for that.

## 7. One movement, not two (K118)

- John on the iPhone: K116's destination was right, but the motion flickered. K116 lets the fling
  rest at the tall tracker's foot, then glides on: two movements.
- Measured per frame through Chrome's touch pipeline, with real flings (`preventFling: false`).
  The default synthetic gesture holds the finger still before lifting, which takes K103's
  slow-drag path instead and hides the problem.
- Tried and dropped:
  - A 1px snap mark on every screen in place of the screen. A swipe up could no longer reach a
    far top, and stayed put.
  - A script glide at the lift, snapping off. When snapping came back, Chrome re-snapped to where
    its fling had been going, past the top.
  - The same glide with snapping on. Chrome's fling ran on underneath and snapped back to the foot
    halfway.
- What works: the finger coming down on a tracker's top frees a tall tracker above it for that
  touch. The tracker stops being a snap area, and its top mark is its one snap position. The
  browser's own momentum then ends at that top, with no script scroll involved.
- Result: 44 flings, upright and on its side, the week and Edit plan, each one movement.
- The e2e test checks the shape of the motion as well as where it ends. Once moving, the page may
  not slow to 6px over three frames and then speed up again. It is red without the freeing and
  green with it.

## 8. Page turns, tried and reverted

- John, after K118: "scrolling within a long tracker sometimes goes too far and skips onto the
  next tracker". Two causes reproduced with real flings in Chrome:
  - a long tracker had no stops until the page rested on it, so a swipe made while it still moved
    ran through;
  - a fling could pass a stop despite `scroll-snap-stop: always`.
- Tried: every long tracker keeping its stops, and each swipe a page turn, with only the snap
  positions either side of the page allowed while a finger was down. In Chrome every swipe moved
  one step, with short ease-backs when a drag went past a near stop.
- On the iPhone John found it "much worse", and it was reverted the same day to K118. The skipping
  inside a long tracker is still open.

## 9. Shipping, and two red runs on `main`

All of this went to `main` by direct push (`CLAUDE.md`'s Shipping), after the local CI steps.
`main` went red twice before it went green.

- **Run 1 (`91a7566`), e2e red.** Both K116/K118 touch tests: the page never moved. Confirmed:
  `Input.synthesizeScrollGesture` scrolls nothing in headless Chromium on Linux, in either its
  touch or mouse mode. Reproduced in the `mcr.microsoft.com/playwright:v1.64.1-noble` image. The
  full Chromium (`channel: 'chromium'`) behaved the same, so the headless shell was not the cause.
  Plain `Input.dispatchTouchEvent` sequences scroll and fling there and on a Mac. The spec now uses
  them, green in the image as committed and red with the K118 freeing switched off (`36377d2`).
- **Run 2 (`36377d2`), check red.** Line coverage was 99.97% against a 100% threshold: `place()`'s
  un-freeing was reached only by e2e. A unit test now covers it (`8e4d5c1`). The local runs had
  printed the same 99.97% and the threshold error. They were judged by a filtered summary rather
  than the step's exit code, which is how it was missed.
- **Run 3 (`8e4d5c1`), green:** `check`, `e2e` and `api`. Docker published `tracker` and
  `tracker-api`.
- **Live, confirmed:** the bundle served at tracker.itsa-pizza.com contains `data-snap-free`,
  `edit-frame` and `section-end`, which exist only in this release. The site answered 502 for a few
  seconds around 14:14 CET and then 200. That is strongly supported as What's Up Docker replacing
  the containers, not observed.
- The design system was republished as version 80, after checking that its live files matched
  `cf4a4f2` so no edit made on the page was overwritten.

## 10. What is deliberately not done

- **Skipping inside a long tracker on touch.** A swipe made before the page settles on a long
  tracker, which has no stops until then, can run through to the next tracker. A fling can also
  pass a stop despite `scroll-snap-stop: always`. Both are confirmed in Chrome's touch pipeline.
  The fix tried (K119, page turns, section 8) felt much worse on John's iPhone and was reverted. He
  chose to ship without a fix. Filed as #70.
- **A tap leaves a screen freed** (code review). With no scroll, `place()` doesn't run, so
  `data-snap-free` stays until the next rest or DOM change. Strongly supported as harmless: a freed
  screen's one snap position is its top, which is where K116 wants a swipe up to end. Left alone
  rather than changing shipped touch code without an iPhone check. Filed as #71, with the review's
  note that `onTouchStart` re-reads the screens' tops beside `snapPoints()`.
- **The print value for `edit`.** None was added. The frame never prints (`print:hidden`), and
  `focus` has none either.
