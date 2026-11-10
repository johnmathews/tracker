A tile in the Header for one of its actions: a Lucide icon with its name under it, as big as the week below it.

## Use

- Only in the Header (K47), for its actions, at its end: "This week" (`calendar`; K81), "Ask" (`message-circle`), "Settings" (`settings`), "Print…" (`printer`), "Full screen" (`maximize`, or `minimize` and "Exit full screen"; K49), "Profile" (`circle-user-round`; K106), the trigger of the account's Menu. Edit plan has no Done: a long press, E or Esc leave it (K91). Elsewhere, an action is a Button or an IconButton.
- The icon over its name, centred, `radius-md`, no border. The icon is Lucide outline at the 1.5 stroke in `currentColor`, `aria-hidden="true"`; the name is `label` type (600, sentence case) in `ink`, and it is the accessible name.
- Its sizes follow the screen with the Header (PlannerScreen's `u`): the icon max(26px, 32u), the name max(16px, 17u), 6u between them, 10u × 12u padding, at least max(76px, 96u) wide so a short name doesn't make a thin target. Folded (a phone or an upright iPad, `n`), the icon is 26n and the name 16n, and the tiles share the Header's second row equally.
- **A toggle** (`aria-pressed`) takes the selected segment's fill while on: `ink`, with the icon and name in `on-ink`. Never the pen. No Header action is a toggle now: the Edit plan toggle (K48) went with K82, and the filled Done (K82) with K91.
- **Its key** (K91): Settings, Print and Full screen each carry `aria-keyshortcuts` (S, P, F), the key that does the same on the week.

## States

- Hover: a `tile` fill, 120ms, none under reduced motion. Pressed and hovered keeps the `ink` fill.
- Focus: a solid 2px `focus` outline at 2px offset.
- Pressed (a toggle that is on): `ink` fill, `on-ink` icon and name.
- Every tile is at least 44px in both directions, on every layout.

## You provide

- `label`: the action's name, shown under the icon and used as the accessible name ("Full screen", "Settings", "Print…").
- The Lucide icon in the default slot.
- `pressed` for a toggle, left out for an ordinary action; `aria-keyshortcuts` for its key, if it has one. The click handler.
