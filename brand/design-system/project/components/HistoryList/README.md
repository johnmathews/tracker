The past conversations inside the SidePanel on the Ask page: "New conversation", then every conversation grouped by Today, Last week and Earlier, and "Delete all conversations" at the foot.

## Use

- **S1, John's pick (2026-11-01).** It fills the SidePanel's body. The groups scroll on their own between the button and the foot.
- **New conversation:** a secondary Button with Lucide `square-pen`, the full width of the panel, its words at the start.
- **The groups:** Today (since local midnight), Last week (the seven days before today) and Earlier, newest first within each. A group with nothing in it isn't shown. Each label is `label` weight in `ink-secondary` at 16px, 8u in from the side and 4u above its list. The groups are 16u apart.
- **An item:** a button the width of the panel, `radius-md`, 9u by 8u inside. The title (the conversation's first question) runs on one line in `ink` at the page's label size (19u), ending in an ellipsis. Items are 2px apart.
  - Hover or focus inside: a `tile` fill.
  - The open conversation: `aria-current="true"`, a `tile` fill and weight 600.
  - The bin: an IconButton (Lucide `trash-2` at 18px, `ink-secondary`, `ink` on a `canvas` fill on hover) named `Delete “Is my diet good enough?”`. It shows on the open item, on hover and on focus, and always on a touch screen. It stays a 44px target, the item's own height.
- **The foot:** a 1px `line` rule, 8u, then "Delete all conversations", a text button in `ink-secondary` at 16px, underlined, turning `ink` on hover. Shown only when there is a conversation.
- **Empty:** New conversation, then one line in `caption` `ink-secondary`: "Past conversations show here."
- Deleting asks first. The page confirms with a ConfirmDialog, as Edit plan's Remove does: the list only says which was pressed.

## States

| State | Look |
| --- | --- |
| Conversations | New conversation, the groups that have any, and Delete all. |
| One open | Its item on a `tile`, bold, the bin showing. |
| Hover or focus | The item on a `tile`, its bin showing. |
| Touch screen | Every bin showing. |
| Empty | New conversation and "Past conversations show here." |

## Accessibility

- Each group is a `role="group"` named by its `<h3>` label, under the panel's "History" heading. Not a landmark: three small groups would crowd the landmarks list.
- An item's name is its whole title, even where the ellipsis cuts it. The bin's name says which conversation it deletes. A hidden bin still takes focus, and shows when it has it.
- After a delete, the page moves focus to the next item's bin, else to New conversation.
- `ink` on `tile` is 14.4:1 in light and 12.0:1 in dark; `ink-secondary` on `panel` 6.8:1 and 7.1:1 (measured on the mockup).

## You provide

- `items`: each conversation's `id`, `title` and `updatedAt` (Unix seconds), newest first.
- `currentId`, the open conversation, if any, and `now`, for the groups.
- Handlers for `open` and `delete` (both carry the id), `new` and `deleteAll`, and the confirmations before the two deletes.
