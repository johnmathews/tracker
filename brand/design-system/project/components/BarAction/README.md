A tile in the Header for one of its actions: a Lucide icon with its name under it, as big as the week below it.

## Use

- Only in the Header (K47), for its actions, at its end: "This week" (`calendar`; K81), "Ask" (`message-circle`), "Settings" (`settings`), "Print…" (`printer`), "Full screen" (`maximize`, or `minimize` and "Exit full screen"; K49) and, in Edit plan, "Done" (`check`; K82). Elsewhere, an action is a Button or an IconButton.
- The icon over its name, centred, `radius-md`, no border. The icon is Lucide outline at the 1.5 stroke in `currentColor`, `aria-hidden="true"`; the name is `label` type (600, sentence case) in `ink`, and it is the accessible name.
- Its sizes follow the screen with the Header (PlannerScreen's `u`): the icon max(26px, 32u), the name max(16px, 17u), 6u between them, 10u × 12u padding, at least max(76px, 96u) wide so a short name doesn't make a thin target. Folded (a phone or an upright iPad, `n`), the icon is 26n and the name 16n, and the tiles share the Header's second row equally.
- **Filled** (Done; K82): the one action that ends a mode takes the selected segment's fill always: `ink`, with the icon and name in `on-ink`. It is a plain button, not a toggle. Never the pen.
- **A toggle** (`aria-pressed`) takes the same fill while on. No Header action is a toggle now: the Edit plan toggle (K48) went with K82.

## States

- Hover: a `tile` fill, 120ms, none under reduced motion. Filled, or pressed, and hovered keeps the `ink` fill.
- Focus: a solid 2px `focus` outline at 2px offset.
- Filled, or pressed (a toggle that is on): `ink` fill, `on-ink` icon and name.
- Every tile is at least 44px in both directions, on every layout.

## You provide

- `label`: the action's name, shown under the icon and used as the accessible name ("Done", "Full screen", "Settings", "Print…").
- The Lucide icon in the default slot.
- `filled` for the action that ends a mode (Done), or `pressed` for a toggle; neither for an ordinary action. The click handler.
