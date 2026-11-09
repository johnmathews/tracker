# Keys on the week, no Done, and screens that wrap round

On 2026-11-09, after trying the fixed week (K88), John asked for several changes at once. The
keys came first: "lets make the e key toggle between edit mode and tracker mode", then "f", "p"
and "s", and Esc to leave. He also asked to drop the bar's Done, "its not necessary if both esc
key and a long press will exit edit mode". Then: "can we make scrolling wrap around?". These are
K91 and K92; Cardio, asked for in the same message, is K90 (its own journal entry).

## Keys (K91)

- `src/composables/shortcuts.ts` has two parts:
  - `ownedElsewhere(event)` decides when a key belongs to something else. That covers a field or
    contenteditable, Ctrl, ⌘ or Alt, a repeat, mid-composition, a handler that already took it,
    and any open dialog or popover, which has its own keys.
  - `useShortcuts(() => map)` reads the map on each press, so it can depend on state.
- AppNavbar maps the keys:
  - E toggles Edit plan.
  - Esc leaves full screen first, then Edit plan, and does nothing on the plain week.
  - F is mapped only where the browser has full screen.
  - P prints and S opens Settings.
- Whether Esc reaches the page in full screen depends on the browser. Chrome uses it to leave
  full screen, so the page never sees it; where the page does, it leaves full screen too.
- **Done went** (supersedes K82's visible one). Without it, a keyboard user who doesn't know the
  keys would have no way out. So the hidden second Tab stop, "Edit plan", now toggles and reads
  "Done" in Edit plan. It, Settings, Print and Full screen carry `aria-keyshortcuts`.
- BarAction lost its `filled` variant, whose only user was Done, and its card dropped the
  "Filled" state.
- Removing the button had no mockup: there was nothing to choose between.

## Wrap round (K92)

John chose both ways.

- `wrapAround(way)` in `screenSprint.ts` clones the screen to wrap to and places the copy:
  - The copy is inert, `aria-hidden`, has no ids, and lacks `data-planner-screen` so the sprint
    ignores it.
  - Going down, it goes after the last screen.
  - Going up, it goes before the first, and the page scrolls by its height in the same task, so
    nothing moves on screen.
- The page then sprints onto the copy. On landing, the copy goes and the page jumps to the same
  offset on the real screen, which looks identical.
- `stopSprint` removes any copy. `sprintTo` now calls `halt()` instead, which leaves a copy in
  place, because `sprintTo` stopping the previous sprint would otherwise delete the copy it is
  moving to.
- **What starts a wrap.** A wheel gesture that *starts* at an end (the first event after 150ms of
  wheel silence) and goes a step (4%, at least 16px) past it, or a swipe that starts and ends at an
  end and goes a step. A fling that runs down a tall Food screen and reaches its foot mid-gesture
  never wraps.
  - The first e2e version of that test started from Exercises. The fling sprinted to Food, and K45
    then swallowed the rest of its momentum, so the test never reached the foot. It now steps to
    Food first.
- A wrap can't be turned round halfway: K89's reversal is off while `wrapping`.
- **Turning round after a wrap.** John: "it looks like the scrolling bug is back".
  - A wrap down sprints the way down, so after it lands on Exercises the page still recorded
    "down". A wheel up at once then hit K89's turn-round, which stopped and let the page scroll.
    But the page was at its top, so nothing moved, and the rest of that gesture (no 150ms gap)
    could never start a wrap.
  - Now turning round counts as a fresh gesture: at an end it starts a wrap at once.
  - A repro e2e test, wrap down then straight up, failed before the fix. Plain down-then-up and
    wrap-up-then-down already passed.

## Scrolling on and on (K93)

- John: "the bug is still there, i cant keep scrolling up and up, or down and down".
  - After each sprint, K45 swallowed every wheel event the sprint's way until the wheel had been
    still for 180ms, and each event restarted that wait.
  - A repro e2e test with notches 300ms apart landed on Food, Food, Exercises, Exercises: every
    second push was lost.
- **The fix** tells a push from momentum the way fullPage.js does: by whether the wheel is speeding
  up.
  - `pushing(steps)`: the latest steps (10, or the later half of a shorter run) average at least
    the last 70.
  - Momentum only shrinks. A trackpad's new push grows. Mouse notches stay the same size.
  - Steps more than 200ms apart start a new history.
  - The first version compared the last 10 with the last 70, which for fewer than 10 steps are the
    same steps, so it always said "pushing". Hence the later half for short runs.
- **Tests.** e2e: four notches each way go Food, Exercises, Food, Exercises. A realistic trackpad
  flick (speeding up, then dying away over 1.5s) moves exactly one screen from Exercises, and one
  wrap from Food.
  - The unit tests' momentum was a run of identical steps with the clock jumped forward, which now
    reads as a push. A `coast()` helper sends a dying step every 16ms instead, as a trackpad does.

## One swipe, one screen (K94)

- K93 didn't survive John's trackpad: "1 swipe can only scroll to the next tracker. at the moment
  the scroll "momentum" will go through several trackers per scroll".
  - A hard flick ramps up over about 100ms, then its momentum fades slowly. Against those small
    ramp steps in the last 70, the slow fade's last 10 still averaged higher, so it read as a
    push.
  - The synthetic e2e flick faded at 4% a step, quickly enough to hide this.
- **The fix drops the guessing.** A gesture is a run of wheel events less than 150ms apart, and it
  moves one screen at most (`spent`).
  - Momentum is a steady stream, so it never ends a gesture.
  - A separate swipe or notch does, so 300ms notches still go Cardio, Food, Exercises, Cardio.
  - What's lost: a second swipe made *during* the first one's momentum joins that gesture and is
    swallowed.
- **e2e** now flicks light (fading 4% a step) and hard (peaking at 45, fading 1% a step). Each
  moves exactly one screen, three times over, including a wrap.

## Tests

- **Unit.** PlannerScreen spec: each key, Esc ordering, the exclusions, and `aria-keyshortcuts`.
  Sprint spec: `pageEnd`, wrapping down and up, no copy left after a stop, gesture starts,
  momentum, wheel lines, and swipes.
- **e2e** (`screens.spec.ts`): wrapping both ways with no copy left, a fling at a tall screen's
  foot not wrapping, and the keys in a real browser.
- **Test isolation.** The new S-key unit test set `#/settings`, and every later test in the file
  mounted Settings instead of the week; the test now resets the URL.
- **Running Vitest.** With the Cardio worktree under `.claude/worktrees/`, Vitest also collected
  that worktree's tests. Pass `--dir ./src` while one exists.
