An on/off control that takes effect at once, with its label inside the same 44px button.

## Use

- A `role="switch"` button holding the label (`body`, `ink`) and a 40 × 24px track with `radius-full`. The whole row is the target: 44px tall, padding `space-2`, `radius-md`.
- Off: 1px `control-border` track, `ink-secondary` thumb at the left. On: `ink` track, `on-ink` thumb at the right. The thumb's position says the state as much as the fill; never `pen` (pen means done).
- For a mode or setting that changes the screen straight away. **Edit plan** in the Header was a Switch until K48; it is a BarAction toggle now. The item page's arranging uses one per section, **Show**, beside that section's Move up and Move down (ItemPage card, K66). There it takes the page's sizes: max(44px, 52u) tall, the label at the page's label size (19u, 16n folded) in weight 600, as the page's other control labels are.
- Not for a choice between named options (SegmentedControl), and not inside a form that needs a Save: use a checkbox there.
- The label names the thing that is on, not the action: "Show", not "Turn on". On a phone it may shorten while the accessible name keeps the full label.
- In a list of the same switch, one per row, the visible label can stay short ("Show") while words for screen readers only name the row: the accessible name reads "Show Notes". The visible label comes first in the name, so speaking it still works.

## States

- Hover: `tile` fill on the row. Focus: a solid 2px `focus` outline at 2px offset around the row.
- Only colours transition (120ms, none under reduced motion); the thumb moves without animation.
- Disabled: 40% opacity, only when the setting truly cannot change.

## You provide

- `label` (required, also the accessible name), the state (`v-model`, reflected in `aria-checked`), and optionally a shorter visible label for narrow screens.
- Optionally `context`: words added after the label for screen readers only, naming the row ("Notes", so "Show" reads "Show Notes").
