Settings as a page of its own, at `#/settings`: a link back to the week, the heading, then Appearance, Your goals, Your data, Connections and Account, each a section under its own heading.

## Use

- **Opening it:** the Settings BarAction in the Header (Lucide `settings`, named "Settings") goes to the page. The page has no Header (K52): a bar holding only the wordmark said nothing, so the page starts with its own link back to the week.
- **Layout, like the week (K51):** full width on the page's own 48u margins, every size from the PlannerScreen's `u` (main.css's `--set-*` sizes). First a TextLink, "Back to the week", at 19u with a 26u `chevron-left`, then the page's one `<h1>` "Settings" in the `title-1` serif at the section titles' 40u. Each section is a row: its `<h2>` heading at 27u, weight 600, sentence case, in a 320u left column (the week's name column), its settings to the right, 28u apart; a 1px `line` rule opens every row, with 32u above and below. Labels, text and buttons are 19u; controls are 60u tall with 26u icons. A control sits beside the words it belongs to, using the width (K53): Export and Import… beside the data line (held to 34ch), Sign out beside "Signed in as"; they wrap under the words when the row is too narrow. The controls keep their own cards' shapes, tokens and behaviour at the page's size. **Folded**, the heading sits over its settings in one column, at the system's sizes on `n` (headings 22n, text 18n, labels 16n, controls 48px).
- **Contents, in order** (from `SettingsPage.vue`):
  1. **Appearance:** **Marks**, a RadioCard with an option per mark set: Squiggles (the default), Ticks, Stamped ticks, Faces, Stamped faces, each showing its set's great, partly done and couldn't do it marks as DayMark drawings (K20), 60u each. The options are tiles, three to a row, the dot and name over the marks; folded, one to a row with the marks (44n) beside the name. Then **Theme**, a SegmentedControl, System | Light | Dark, drawn exactly as its card (K59). Both are this device's. The `pen` colours are fixed, so there is no ink to choose. The daily targets, which were a Planner section here, are set in Edit plan (K56).
  2. **Your goals:** a TextArea, "What you’re working towards", that Ask reads; it saves when typing pauses.
  3. **Your data:** one line in `body` `ink-secondary` saying what each does ("Export saves everything to a file. Import adds a file's plans and marks to yours and never deletes anything."), then secondary buttons "Export" (`download`) and "Import…" (`upload`), at their own width. Import's summary and its own Cancel then Import (secondary first, primary last) appear beneath.
  4. **Connections:** the address to paste into Claude, the apps connected by OAuth and the personal tokens, with Create token. Its own card is ConnectionsSection.
  5. **Account:** "Signed in as alex" in `body` (the name in `ink`), then a secondary "Sign out" (`log-out`). Sign out with unsynced changes asks first with a ConfirmDialog.
- Every button is the page's control height (60u, 48px folded). Settings take effect at once; there is no Save.
- Outcomes (import done, import failed, sign-out failed) appear as an InlineMessage at the end of the section that caused them.
- Room to grow: a new setting goes in the section it belongs to, or a new section, never in the Header.
- Doesn't print.

## States

| State | Look |
| --- | --- |
| Arrived | focus on the `<h1>` (it takes focus with `tabindex="-1"`, no ring), so a screen reader starts at the top |
| Import pending | the import summary and Cancel · Import under the data buttons |
| Result | an InlineMessage (success, or error with what to do) |
| Back to the week | the week as it was; focus on the Header's Settings button |

## Accessibility

- A real page: the hash changes, so the browser's Back works, and a `#/settings` address opens it directly.
- One `<h1>`, then an `<h2>` per section; each section is a `<section>` labelled by its heading, and the data buttons are a `group` labelled by theirs.
- Marks and Theme keep their own cards' keyboard and naming rules.
- After the sign-out question closes without signing out, focus returns to Sign out.

## You provide

The current mark set and theme with their change handlers; the export and import handlers; the signed-in name and the sign-out handler; the address of the week for the link back.
