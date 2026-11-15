Settings as a page of its own, at `#/settings`: a link back to the week, the heading, then a tab for each of Appearance, Daily goal, Your data and Connections, and the open tab's section under its own heading. My goals, Your limits and the account are on the ProfilePage (K106, K107).

## Use

- **Opening it:** the Settings BarAction in the Header (Lucide `settings`, named "Settings") goes to the page. The page has no Header (K52): a bar holding only the wordmark said nothing, so the page starts with its own link back to the week.
- **Layout, like the week (K51):** full width on the page's own 48u margins, every size from the PlannerScreen's `u` (main.css's `--set-*` sizes). First a TextLink, "Back to the week", at 19u with a 26u `chevron-left`, then the page's one `<h1>` "Settings" in the `title-1` serif at the section titles' 40u, 20u above the tabs. **The tabs (K119)** are a Tabs bar under the heading, one tab per section, in the order below: each name in the sans at 600 at the page's text size (19u, 18n folded) in `ink-secondary`, at least 44px tall, 32u apart; the open tab in `ink` with a 3px `ink` rule under it; a 1px `line` rule under the whole bar. On a phone the four tabs wrap onto two lines. Only the open tab's section shows. Each section is a row: its `<h2>` heading at 27u, weight 600, sentence case, in a 320u left column (the week's name column), its settings to the right, 28u apart; 32u above and below it. The row has no top rule of its own: the bar's rule is just above it. Labels, text and buttons are 19u; controls are 60u tall with 26u icons. A control sits beside the words it belongs to, using the width (K53): Export and Import… beside the data line (held to 34ch); they wrap under the words when the row is too narrow. The controls keep their own cards' shapes, tokens and behaviour at the page's size. **Folded**, the heading sits over its settings in one column, at the system's sizes on `n` (headings 22n, text 18n, labels 16n, controls 48px).
- **Contents, in order** (from `SettingsPage.vue`):
  1. **Appearance:** **Marks**, a RadioCard with an option per mark set: Squiggles (the default), Ticks, Stamped ticks, Faces, Stamped faces, each showing its set's great, partly done and couldn't do it marks as DayMark drawings (K20), 60u each. The options are tiles, three to a row, the dot and name over the marks; folded, one to a row with the marks (44n) beside the name. Then **Theme**, a SegmentedControl, System | Light | Dark, drawn exactly as its card (K59). Both are this device's. Then **Week title** (K131), a SegmentedControl, "Date" | "Week number", the date by default. It is saved with the account (K132). The `pen` colours are fixed, so there is no ink to choose. The daily targets, which were a Planner section here, are set in Edit plan (K56).
  2. **Daily goal** (K85, a section of its own since K107): a Switch, "Daily goal", on by default, its hint under it in `caption` `ink-secondary`: "A number of exercises and of foods to reach each day, set in Edit plan. A day that reaches it turns green." It takes the item page's switch sizes (max(44px, 52u), the label at the page's label size in 600) and saves at once, with the account. Off, Edit plan has no "N per day" steppers, no day turns green, and Ask and the AI connections get no daily target; the numbers are kept.
  3. **Your data:** one line in `body` `ink-secondary` saying what each does ("Export saves everything to a file. Import adds a file's plans and marks to yours and never deletes anything."), then secondary buttons "Export" (`download`) and "Import…" (`upload`), at their own width. Import's summary and its own Cancel then Import (secondary first, primary last) appear beneath.
  4. **Connections:** the address to paste into Claude, the apps connected by OAuth and the personal tokens, with Create token. Its own card is ConnectionsSection.
- **Addresses (K119):** `#/settings` opens Appearance. `#/settings/appearance`, `#/settings/daily-goal`, `#/settings/data` and `#/settings/connections` open their tabs. Choosing a tab replaces the address with its own, so a reload keeps the tab and Back still leaves the page. Anything that sends someone to Connections links to `#/settings/connections`. The Header's Settings button and **S** open `#/settings`.
- Every button is the page's control height (60u, 48px folded). Settings take effect at once; there is no Save.
- Outcomes (import done, import failed) appear as an InlineMessage at the end of the section that caused them. A file waiting to be imported, and its outcome, stay while you look at another tab, and go when you leave the page.
- Room to grow: a new setting goes in the section it belongs to, or a new section with a tab and an address of its own, never in the Header.
- Doesn't print.

## States

| State | Look |
| --- | --- |
| Arrived | focus on the `<h1>` (it takes focus with `tabindex="-1"`, no ring), so a screen reader starts at the top; the tab its address names is open |
| Another tab | its section in place of the last one; focus stays on the tab, and the address becomes the tab's |
| Import pending | the import summary and Cancel · Import under the data buttons |
| Result | an InlineMessage (success, or error with what to do) |
| Back to the week | the week as it was; focus on the Header's Settings button, from any tab |

## Accessibility

- A real page: the hash changes, so the browser's Back works, and a `#/settings` address opens it directly. Each tab's address opens that tab.
- One `<h1>`, then the tablist, labelled by the `<h1>`, with the Tabs card's keyboard (arrows, Home, End; automatic activation). The open section is a `tabpanel` labelled by its tab, holding an `<h2>` and a `<section>` labelled by it. The data buttons are a `group` labelled by their heading.
- Marks, Theme and Week title keep their own cards' keyboard and naming rules.

## You provide

The current mark set, theme and Daily goal with their change handlers; the export and import handlers; the address of the week for the link back; the open tab, from the address, with a handler that writes the chosen tab's address.
