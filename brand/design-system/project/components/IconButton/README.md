A 44px square button that shows one Lucide icon and carries its meaning in an accessible label.

## Use

- For actions whose icon is understood at a glance and repeats often: previous and next week (`chevron-left`, `chevron-right`), close (`x`), a row's edit (`pencil`) and remove (`trash-2`) in Edit plan, clear a search, the Stepper's `minus` and `plus`, and a section's Move up and Move down (`arrow-up`, `arrow-down`) while the item page is arranged (K66, at Edit plan's max(44px, 52u)).
- **Quiet** (the default): no border, `ink` icon, a `tile` fill on hover and while its popover or menu is open (`aria-expanded="true"`).
- **Outlined:** 1px `control-border`, for a button that sits alone in a form or beside fields.
- The icon is 20px, Lucide outline at 1.5px stroke in `currentColor`, `aria-hidden="true"`. The hit area is 44 × 44px, `radius-md`, on every layout; where a page sizes it to the screen it only grows: the week's arrows in the Header (max(48px, 60u), K47), and Edit plan's edit and remove and a Dialog's Close (max(44px, 52u) with a 28u icon, K54, K55). The Header's Settings is a BarAction.
- Not for actions people meet once or rarely (sign out, import, export): use a Button with words. Never an emoji or a Unicode glyph in place of the icon.

## States

- Hover and open: `tile` fill, 120ms, none under reduced motion.
- Focus: a solid 2px `focus` outline at 2px offset.
- Disabled: 40% opacity, only when the action cannot happen at all. A step at its limit (the Stepper) or a move at an end (the item page's first section's Move up) uses `aria-disabled` so focus stays put: the press does nothing, the icon fades to 40% and there is no hover fill.

## You provide

- `label` (required): the accessible name, as a verb phrase or the thing it opens: "Previous week", "Next week", "Close", "Edit Push-ups", "Remove Push-ups", "Clear search", "Move Notes up". A row action names its row, since a list of "Remove" buttons is useless out of context. The component sets it as `aria-label`; a button without one must not render.
- `icon`: the Lucide name. `variant` (`quiet`, `outlined`), the click handler, and `aria-expanded` and `aria-controls` when it opens something.
