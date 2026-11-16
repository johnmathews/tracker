A row of two or three toggle buttons, exactly one chosen, for a setting whose options all fit on screen at once.

## Use

- The canonical drawing, wherever a SegmentedControl appears (the Settings page, the exercise's Dialog): On the Settings page and in dialogs it takes the page's `--set-*` size instead, 60u tall (48px folded), its type at 19u (K51, K55). At the system's size: a 1px `control-border` outline with `radius-md`, 44px tall overall, no inset between the outline and the segments; each segment 42px tall, padding `space-4`, `radius-sm`, in `label` style (16px/22px, weight 600) in `ink`. Chosen and unchosen segments use the same type, so the width never jumps when the choice changes.
- **Single choice.** The chosen segment is filled `ink` with `on-ink` text (the same "act" colour as the primary Button), and carries `aria-pressed="true"`; the others `aria-pressed="false"`. Pressing the chosen segment keeps it chosen: a segment never un-presses itself, so there is always exactly one choice. Never `pen`: pen means done.
- **Label:** the `role="group"` has a visible label above it in `label` style, tied with `aria-labelledby`. The one exception: when the segment words name the choice by themselves, the visible label may be left out, and the group then takes an `aria-label` instead.
- Real uses: **Theme** (System, Light, Dark; System first, as the default), **Measure** (Reps, Time) and **Sides** (Per set, Each side; K140).
- At most three short options. Four or more, long labels, or options best told apart by a picture, take a RadioCard. A single on/off choice is a Switch.

## States

- Hover on an unchosen segment: `tile` fill. Colour changes take 120ms, none under reduced motion.
- Focus: a solid 2px `focus` outline at 2px offset on the segment, drawn above its neighbours.
- Disabled: the whole control at 40% opacity, only when the setting cannot change.
- On a phone the control may wrap onto two lines rather than shrink its type.

## Accessibility

- Built on Reka UI's ToggleGroup (`type="single"`), which renders exactly this: a `role="group"` of `<button aria-pressed>` segments. The app keeps the chosen value from being cleared, so the pressed segment stays pressed.
- Keyboard: Tab enters the group on one segment (the chosen one, or the last one focused) and Tab again leaves it; arrow keys move focus between segments (Reka's roving focus); Space or Enter chooses the focused segment.

## You provide

- `label` (required; an `aria-label` only under the exception above), the options as `{ value, label }`, and the chosen value (`v-model`).
- Option labels in sentence case. Keep them short enough to sit side by side on a phone: the reps count reads "Per set" and "Each side", not "Each side, per set".
