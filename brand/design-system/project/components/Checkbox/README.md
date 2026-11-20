A box to tick, with its label in the same row, for a choice inside a form that has a Save.

## Use

- One row per choice: a 24px box, then the label in `body` and `ink`. The whole row is the target, at least 48px tall, with `space-3` between the box and the label. In the programme builder the label takes the page's text size, 19u (18n folded).
- The box: a 2px `control-border` border on `panel`, `radius-sm`. Ticked, it fills `ink`, with a Lucide `check` in `on-ink` (16px, stroke 3). Never `pen`: pen means done.
- For a setting that waits for a Save, one or many: the exception week's **Rest these activities** list (ExceptionWeekEditor, K191) ticks the activities that rest in its weeks. A setting that takes effect at once is a Switch. One choice of several is a RadioCard or a SegmentedControl.
- In a list, the rows sit on the list's surface (`tile` in the builder) with a 1px `control-border` rule between rows.
- The label names the thing that is ticked, not the action: "Back squat", not "Rest Back squat". The list's heading says what a tick means.

## States

- Unticked, ticked, hover (the box's border goes `ink`), focus (a solid 2px `focus` outline at 2px offset around the row), disabled.
- Only colours transition (120ms, none under reduced motion).
- Disabled: the row at 40% opacity, only when the choice truly cannot change here. A disabled row may show ticked, when something else already ticks it: an activity that rests through Every activity.

## Accessibility

- Built on Reka UI's Checkbox: the row is a `<button role="checkbox">` with `aria-checked`, named by its label. Space ticks and unticks it. Tab moves from row to row.
- Contrast, measured by the gate in both themes: `control-border` on `panel` and on `tile` (at least 3:1), `on-ink` on `ink`, `ink` on `tile`.

## You provide

- `label` (required, also the accessible name) and the state (`v-model`, a boolean).
- Optionally `disabled`, and a class for the row's text size or width.
