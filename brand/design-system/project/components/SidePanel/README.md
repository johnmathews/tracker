A full-height panel beside the page that hides to a strip of icons, and becomes a drawer over the page on a phone; the Ask page keeps its history in it.

## Use

- **S1, John's pick (2026-11-01).** The panel runs the full height of the screen on a `panel` fill, 300u wide and never under 260px, with a 1px `line` on its right edge. The page sits beside it. Each side scrolls on its own.
- **The head:** the title ("History") at the Settings page's section-heading size (27u, weight 600), and a 44px IconButton with Lucide `panel-left`, "Hide history". 20u above, 12u at the right and 8u below, 20u at the left.
- **The body:** whatever the page puts there (HistoryList on Ask), 12u in from each side, 16u above the bottom, its parts 12u apart.
- **Hidden:** a strip 64u wide (never under 56px), the `line` kept. It holds "Show history" (`panel-left`), then the page's own icons (on Ask, "New conversation"), 8px apart, 20u from the top. The width changes over 200ms, and at once under reduced motion.
- **Remembered:** open or hidden is kept on this device, under the page's key. When storage is blocked it opens, and works the same.
- **Folded** (a phone, or an iPad held upright, the app's `folded` rule): the panel is a drawer over the page, 85% of the screen wide and at most 320px, on the overlay shadow, over the `scrim` at 40%. It is closed when the page opens. A toggle beside "Back to the week" opens it (`panel-left`, "Show history"). The scrim, Escape, the hide button or picking a conversation closes it. It slides in over 200ms (at once under reduced motion) and goes at once.
- For a page that needs a list to come back to beside its work. Not for settings or forms: those are a page or a Dialog.

## States

| State | Look |
| --- | --- |
| Open | The panel, its head and body, the line on its right. |
| Hidden | The 64u strip: Show history, then the page's icons. |
| Drawer closed | Nothing: the page fills the screen, the toggle beside "Back to the week". |
| Drawer open | The panel over the page from the left, the scrim behind it. |
| Focus | A solid 2px `focus` outline at 2px offset on each button. |

## Accessibility

- Docked, it is a `<section>` named by `label` ("Conversation history"): a region landmark, which may sit inside the page's `<main>`, where an `<aside>` may not. Hide and Show carry `aria-expanded` and `aria-controls` pointing at it, and focus moves from one to the other as they swap.
- The drawer is a modal dialog with the same name: focus moves into it on open, stays inside, and returns to the toggle on close. Escape closes it.
- `ink` on `panel` is 16.7:1 in light and 13.1:1 in dark; `ink-secondary` on `panel` 6.8:1 and 7.1:1 (measured on the mockup; the gate measures `panel` pairs too).

## You provide

- `open` (v-model), and `storageKey`, the name it is remembered under.
- `label`, the panel's name, and `showLabel` and `hideLabel` if not "Show history" and "Hide history".
- Slots: `title` (the words of the heading), `panel` (the body), `strip` (the icons beside Show history when hidden) and the default slot (the page). The default slot is given `folded`, `open` and `panelId`, for the page's own toggle: an IconButton beside "Back to the week", shown only when `folded`, that sets `open`, with `aria-expanded` and `aria-controls`.
- `close()`, to close the drawer when a conversation is picked. Docked, it does nothing.
