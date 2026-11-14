A row of tabs under a page's title, one per part of the page, that shows one part at a time; the Settings page has one (K119).

## Use

- **The bar:** each tab is its name alone, with no box and no fill, in the sans at weight 600 in `ink-secondary`. At the system's size the name is `body` (18/26) at 600. On the Settings page it takes the page's text size (`--set-text`: 19u, or 18n folded). Each tab is at least 44px tall, with its name centred and no side padding, so the rule under the open tab is as wide as its name. The tabs are `space-8` (32px) apart, and 32u apart on the Settings page. A 1px `line` rule runs under the whole bar.
- **The open tab** is in `ink`, with a 3px `ink` rule under its name. The rule is drawn inside the tab (an inset shadow), so it sits on the bar's rule and the tab's height never changes. Open and closed tabs use the same type, so the names never move.
- **Under the bar,** only the open tab's part shows. Each part keeps its own layout. On the Settings page that is the row, with its heading in the name column and its content beside it. The row has no top rule there, because the bar's rule is just above it.
- **On a phone** the tabs wrap onto a second line rather than shrink or scroll sideways. The bar's rule stays under the last line.
- **An address per tab:** where a page has an address, each tab has its own (`#/settings/connections`), so a link can open a tab directly. Choosing a tab replaces the address instead of adding to history. A reload keeps the tab, and the browser's Back still leaves the page.
- Use it for parts of one page that are read one at a time. A choice that changes a setting is a SegmentedControl, and going to another page is a TextLink. Keep to two to five tabs, each named in one or two words in sentence case, the same words as the parts' headings.
- Doesn't print.

## States

| State | Look |
| --- | --- |
| Closed | the name in `ink-secondary` |
| Hover | the name turns `ink`; colour changes take 120ms, none under reduced motion |
| Open | the name in `ink`, with a 3px `ink` rule under it |
| Focus | a solid 2px `focus` outline at 2px offset round the tab |

## Accessibility

- Built on Reka UI's Tabs (`TabsRoot`, `TabsList`, `TabsTrigger`, `TabsContent`). They render a `role="tablist"` of `role="tab"` buttons, each with `aria-selected` and `aria-controls`, and a `role="tabpanel"` labelled by its tab.
- Keyboard: Tab enters the bar on the open tab, and Tab again moves to the open part. The arrow keys move between tabs, and Home and End go to the first and the last. Activation is automatic: a tab opens as focus reaches it.
- The tablist has a name: the page's `<h1>` ("Settings") by `aria-labelledby`, or an `aria-label`.
- The open tab is told apart by its colour and its rule together, never by colour alone.

## You provide

- The tabs as `{ value, label }` in order, the open one (`v-model`), and a name for the tablist.
- Each tab's part, in a `TabsContent` with the same `value`.
- Where the page has an address: the address of each tab, written when the tab changes.
