# Rest these activities

**Question:** how an exception week rests some activities, such as the legs in week 3. The
exception week's weeks, label, values and Remove stay as they are.

**Status:** decided: A (K191).

**Link:** https://claude.ai/artifact/7MvD8eZZYpDH9VrqYzLsDd

## Options

Both options put a "Rest these activities" list under Label, on a `tile`. Its first entry is
Every activity, for a week away. A rest sets the activity's Times a week (`target`) to 0 for the
exception's weeks. How the series continues after a rest is K192: John first picked "Where it
would have been", then corrected it to "pick up at the previous setting" (40, 42.5, 45, rest, 45,
47.5, 50).
The closed exception week reads "Rest: Back squat, Deadlift." The grid says "Rest week" in those
cells (K170). No colour is new.

- **A. A checklist.** One 48px row per activity with a checkbox. It adds a component, Checkbox: a
  24px box with a 2px `control-border` on `panel`, filled `ink` with an `on-ink` tick. (Recommended:
  the Switch card says a form with a Save uses a checkbox, and a list reads like the Activities
  section above it.)
- **B. Pressed buttons.** One 44px button per activity, wrapping. A pressed one is filled `ink`,
  as a SegmentedControl's choice is, with a tick before its name. Shorter, but nothing says several
  can be pressed.

## Decision

A, the checklist. John, 2026-11-20: "A. Checklist (Recommended)". Recorded as K191 in
`docs/decisions.md`.

## Rounds

- **1, 2026-11-20:** the first options, after John's feedback on the local stack: "I might give my
  legs a rest one week and then chest and arms a rest another week."
