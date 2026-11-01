An exercise's or a food's own page, at `#/item/<section>/<id>`, in rows like Settings: its notes, its details, this week's plan and its recent weeks, each type's page showing the sections chosen for it in the order chosen (K64, K65, K66).

## Use

- **Opening it:** pressing an item's name in the week opens its page, in the normal week and in Edit plan alike (WeekGrid, the name as a link). Edit plan's pencil still opens the quick Edit dialog. The page is one of the Settings page's family: no Header (K52), and every size from the PlannerScreen's `u` at the Settings page's sizes (K51, main.css's `--set-*`).
- **The head,** on the page's 48u margins: first a line with a TextLink at its left, "Back to the week", at 19u with a 26u `chevron-left`, and the quiet Button "Arrange sections" with a `list` icon at its right (see Arranging). Then the item's type, "Exercise" or "Food", in `label` `ink-secondary` at 19u, 16u below the link. Then the page's one `<h1>`, the item's name, in the `title-1` serif at 40u, with its Chips beside it on the same line (sets × reps, the weight), wrapping beneath when they don't fit. The chips are the Chip card at the page's label size (19u) and come from the plan. A food has none.
- **Layout A, rows like Settings (K65):** full width under the head, up to four rows, by default in this order: Notes, Details, This week's plan, Recent weeks. Which of them show, and their order, is the type's arrangement (below). Each row is laid out as a Settings row is (SettingsPage card, K51): a 1px `line` rule above it, its `<h2>` heading at 27u, weight 600, sentence case, in a 320u left column (the week's name column, `--grid-name-w`), its content to the right, with 32u above and below. Within a row, the content's parts sit 20u apart. (K64 first laid the page out as option B, the notes in a wider left column and the rest in a column beside them. K65 replaced that layout.)
- **Notes:** the item's notes, one copy for every week, read by default.
  - **Read:** the notes as written, in the `note` style (Source Serif 4 italic) at the page's text size, max(18px, 19u), in `ink`, held to 66ch. Markdown shows: paragraphs, lists, bold, italic and code. A link is underlined in `ink` and opens in a new tab, as in the note's Popover (K43).
  - **Edit notes,** a secondary Button with a `pencil` at the page's control height (60u), under the notes. Pressing it turns the notes into a TextArea in NoteEditor's skin (a `tile` fill, the `note` style at the notes' size, `control-border`, `radius-sm`), at least 240u tall and resizable vertically, with the cursor at the end. Under it, the hint in `caption` `ink-secondary`: "Markdown works: **bold**, *italic*, lists, links." The button becomes "Done" with a `check`.
  - **Saving:** the notes save as you type, the way a mark saves when it's pressed. There is no Save and no Cancel. "Done" only turns the field back into the notes.
  - **No notes:** the section holds only its button, "Add notes". The field opens empty, with no placeholder: notes belong to the person and are never asked for (voice.md).
  - **The limit:** 20,000 characters. The count shows under the hint from 19,000 ("19,620 of 20,000 characters"). Past the limit the field shows the TextArea's error, "These notes are 20,140 characters. Shorten them to 20,000 or fewer to save them.", and nothing is saved until they fit.
- **This week's plan:** the item's settings for the week the page was opened from, changed through the same store actions as the Edit dialog.
  - The heading reads "This week’s plan" for the current week, and "Plan for the week of 19 October" for any other.
  - A line in `body` `ink-secondary` says what it changes: "Changes this week’s plan, and the weeks after it that have no plan of their own." For another week: "Changes the plan for the week of 19 October, and the weeks after it that have no plan of their own."
  - **An exercise** has the Edit exercise dialog's controls without Name and Note, in this order: Sets (a narrow TextField), **Measure** (a SegmentedControl, Reps | Time), the amount ("Reps", or "Seconds" once Time is chosen), Weight in kg (placeholder "Bodyweight"), **Reps count** (Per set | Each side, "Timed" for Time) and **Times a week** (a Stepper, 0 to 7, "Fewer times a week" and "More times a week"). They sit in columns at least 300u wide, as many as the row has room for: two to a row on a laptop (Sets and Measure, the amount and Weight, Reps count and Times a week), three on a wide screen. **A food** has Times a week alone.
  - The controls are their own cards at the page's size (K55): labels and text 19u, every control 60u tall, 24u between rows, 28u between columns.
  - Each change applies at once. There is no Save button. A number that isn't valid shows the TextField's error and changes nothing until it is. The name changes only in the Edit dialog.
- **Recent weeks:** the RecentWeeks card, eight weeks ending with the week the page was opened from, newest first.
- **Details:** the fields of the item's type, one copy for every week. The list lives in the tracker-type registry (`src/lib/trackerTypes.ts`), so it changes without touching this card. Today an exercise has **Equipment**, **Works** and **Link**, and a food **A serving** and **Examples**.
  - Each field is a TextField at the page's size, label above, no placeholder, in the plan's columns (two to a row on a laptop). Link takes a row of its own, because a web address is long. A field saves as you type, like the notes.
  - Each field holds up to 500 characters. Past that it shows the TextField's error, "This is 540 characters. Shorten it to 500 or fewer to save it."
  - **Link,** when its value is a web address, shows a TextLink under the field naming the site and saying where it opens: "Open youtube.com in a new tab". Any other value stays plain text.
- **Arranging (K66):** each type has one arrangement, shared by every page of that type and saved with the account, so it reaches every device. Every section starts shown, in the default order.
  - **Arrange sections,** the quiet Button at the right of the head's first line, at the page's control size (60u, 48px folded), with a `list` icon. Pressing it puts the page in arranging, and the button reads "Done" with a `check`, drawn with the `control-border` while arranging. Pressing Done, or Escape anywhere on the page, leaves arranging.
  - **Arranging:** under the head, a line in `body` `ink-secondary`, "Choose which sections every exercise page shows, and their order. Changes apply at once." ("every food page" for a food). Then every section, hidden ones too, as a row in the arrangement's order. Each row keeps its `<h2>` in the left column, and under it a Switch, "Show", then IconButtons "Move up" (`arrow-up`) and "Move down" (`arrow-down`), 8u apart, at max(44px, 52u) with 26u icons. The content column says "Shown" in `ink` or "Hidden" in `ink-secondary`, in `body` at the page's text size, so the order reads at a glance. Rows are 14u above and below rather than 32u.
  - **Changes apply at once,** to this page and every page of the type, and sync like the other settings. There is no Save. The first row's Move up and the last row's Move down are at an end: `aria-disabled`, their icons faded to 40% (IconButton card), and a press does nothing.
  - **Folded,** each row's controls sit on its heading's line, to the right, with no gap between them, and the content column's word goes: the Switch says it.
  - **Outside arranging,** the page shows only the shown sections, in order. With every section hidden, a line in `body` `ink-secondary` under the head says "Every section is hidden. Arrange sections to show one."
  - **Print** follows the arrangement: the shown sections among those that print (Notes and Details), in its order.
- **An item not in the week** the page was opened from (an old address, or an item since removed) still opens. Its notes, details and recent weeks work as usual. Its plan section is read-only: the heading is "Latest plan", and a line in `body` `ink-secondary` says so, "Kettlebell swings isn’t in this week’s plan. This is its plan from the week of 12 October." The settings follow as words, each label in `label` over its value in `body`, two to a row. There are no controls, and nothing is faded. The chips in the head come from that same plan.
- **An address naming no item** opens the week instead.
- **Folded** (a phone, or an iPad held upright, as the week folds, K26): one column in the same order, the head, then the shown sections (by default Notes, Details, This week’s plan and Recent weeks), each heading over its content and each row opening with a `line` rule. Sizes move to `n`, as Settings' do: the title 30n, headings 22n, text and the notes 18n, labels 16n, controls 48px with 22px icons. The plan's controls and the details stack one to a row.
- **Print:** the page prints its head, then Notes and Details as the arrangement shows them, in one column, each heading over its content, with no rules, on white paper in the light theme's colours (K16). A printed copy of the notes can go to the gym. A detail prints as its label over its value, with no box. Back, the buttons, the plan section and Recent weeks stay off paper. The week's own print already carries the plan and the marks.

## States

| State | Look |
| --- | --- |
| Arrived | focus on the `<h1>` (it takes focus with `tabindex="-1"`, no ring), so a screen reader starts at the item's name |
| Notes, read | the notes in the note style, with "Edit notes" under them |
| Notes, editing | a TextArea with the notes, the hint, and "Done" |
| No notes | "Add notes" alone, and the field opens empty |
| Notes or a field too long | the TextArea's or TextField's error, in `error-ink`, with what to do |
| Another week | the plan's heading and line name that week |
| Not in the week | "Latest plan", the line saying so, the settings as words |
| Back to the week | the week as it was, with focus on the item's name in its row |
| Arranging | the line saying what it does, every section as its heading over Show, Move up and Move down, "Shown" or "Hidden" beside it, and "Done" in the head |
| A section hidden | its row is gone outside arranging; the rest keep their order |
| Every section hidden | the head, then "Every section is hidden. Arrange sections to show one." |

## Accessibility

- A real page: the hash changes, so the browser's Back works, and a `#/item/<section>/<id>` address opens it directly.
- One `<h1>` (the name), then an `<h2>` per section. Each row is a `<section>` labelled by its heading, in the order the page shows them, so reading order and visual order agree on every screen.
- The notes' TextArea is labelled by the Notes heading (`aria-labelledby`), and its hint and count by `aria-describedby`. Pressing "Edit notes" moves focus to the field. "Done", or Escape in the field, turns it back and puts focus on "Edit notes".
- The plan's controls and the details keep their own cards' keyboard and naming rules. A Stepper's buttons are named "Fewer times a week" and "More times a week".
- The Link's TextLink says in its words that it opens a new tab.
- Arranging: pressing Arrange sections keeps focus on the same button, now "Done", and Done or Escape leaves focus there. Each Switch is a `role="switch"` button named "Show Notes", "Show Details" and so on (its label, then the section's heading for screen readers only). Each move is named for its section, "Move Notes up", "Move Recent weeks down". After a move, focus stays on the moved section's same button; when the move takes it to an end, focus goes to its other move button, since the one pressed is now `aria-disabled`. The rows stay `<section>`s labelled by their headings, in the new order, so reading order follows each move.
- The read-only plan is a `<dl>`: each label a `<dt>`, each value a `<dd>`.
- Contrast is the system's own: `ink-secondary` on `canvas`, `ink` on `tile` (the notes being edited, a chip's fill), `pen` on `canvas` (a met week, in RecentWeeks), all measured by the gate.

## You provide

- The item, its section and its type, from the registry (the type's label and its fields).
- Its notes and details, with their change handlers.
- The plan for the week the page was opened from, with the Edit dialog's change handlers. When the item isn't in that week, its latest plan instead, read-only, with that plan's week.
- That week's Monday, and whether it is the current week.
- The weeks for RecentWeeks.
- The address of the week, for the link back.
- The type's arrangement (`{order, hidden}` of the keys `notes`, `details`, `plan`, `history`), and its change handler.
