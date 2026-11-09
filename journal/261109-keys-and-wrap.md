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
