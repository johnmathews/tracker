A short list of actions that opens under the control that pressed it, with an optional line at the top saying whose they are.

## Use

- **The account menu (K106)** is the one in the app: the Header's last BarAction, "Profile" (Lucide `circle-user-round`), opens it. It reads "Signed in as" and the email, then "Profile" (Lucide `user-round`), which goes to the Profile page, and "Sign out" (Lucide `log-out`).
- **Panel:** `panel` fill, 1px `line` border, `radius-lg`, `shadow-overlay` (none in dark), `space-2` padding, 288px wide. It opens `space-2` below its trigger with their right edges aligned, and stays inside the screen with a 16px margin on a phone.
- **Header** (optional): the caption ("Signed in as") in `caption` and `ink-secondary` over the value (the email) in `label` type and `ink`, with `space-2` `space-3` `space-3` padding and a `line` rule under it. A long email breaks anywhere rather than run past the panel.
- **Items:** `space-2` under the header, 2px apart. Each is at least 48px tall, with `space-3` side padding, a 22px Lucide icon at the 1.5 stroke, then its name in `label` type: a verb or a place, in sentence case ("Profile", "Sign out"). `radius-md`, no border.
- A menu holds actions only. A setting that stays open while it changes belongs on a page (SettingsPage) or in a Popover; a yes-or-no question after an item is a ConfirmDialog ("Sign out" with unsent changes asks first).
- Doesn't print.

## States

| State | Look |
| --- | --- |
| Closed | the trigger alone |
| Open | the trigger on `tile`, the panel under it; it appears with at most a 120ms fade, none under reduced motion |
| Highlighted item | a `tile` fill, under the pointer or the arrow keys |
| Keyboard focus | the highlighted item also takes the solid 2px `focus` outline at 2px offset |

## Accessibility

- Built on Reka UI's DropdownMenu (K1): the trigger has `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`; the panel is `role="menu"`, named by its trigger ("Profile") and described by its header; each item is a `menuitem`.
- Enter, Space or Down Arrow on the trigger opens it with the first item focused; a press opens it with the panel focused. Up and Down Arrow move between the items and wrap; Home and End go to the first and last; typing a letter jumps to the item that starts with it.
- Enter, Space or a press on an item does what it says and closes the menu. Escape or a press outside closes it. Focus returns to the trigger. Tab stays inside the open menu.
- It is not modal: Tab or a press elsewhere closes it, and the page behind stays readable. It is drawn where its trigger is, not at the end of the page, so it stays in the trigger's landmark, and focus inside it keeps the Header in view (K106).
- The header is text, not an item: the arrow keys pass over it.

## You provide

The trigger (a BarAction or a Button), the header's caption and value if it has one, and each item's icon, name and select handler. `v-model:open` if you need to know whether it is open.
