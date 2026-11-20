An exception week in the programme builder, such as a deload: closed, a row that says what it changes; open in place, its weeks, its label, the activities it rests and its values.

## Use

- **Where:** the Exception weeks section of the ProgrammeBuilder card (the document's `overrides`, programmes.md §4), one per exception, then **Add exception week** (secondary, Lucide `plus`), which adds one, open, with every field empty.
- **Closed:** a row on 1px `line` rules: the weeks and the label in weight 600 at 19u ("Weeks 4 and 8 · Deload"; "Week 4" for one; no label, no "·"), then a line per group in `body`: "Every activity: 3 sets, 90% of the weight.", "Deadlift: 1 set." An exception week that rests activities says so first, the names in the programme's order: "Rest: Back squat, Deadlift.", or "Rest: every activity." A quiet IconButton, Lucide `pencil`, named "Change weeks 4 and 8", opens it.
- **Open** (option A of question 3 in the mockup `261120-programme-builder`): in place, in the ActivityCard's open frame (2px `ink`, `radius-lg`), with the closed row's words in its head; pressing the head closes it. The fields:
  - **Weeks**, a TextField with `inputmode="numeric"`, typed as numbers with commas ("4, 8"); hint "Week numbers from 1 to 8, with commas." (the programme's own last week).
  - **Label**, a TextField; hint "Optional. The grid shows it over each of these weeks."
  - **Rest these activities** (K191, option A of the mockup `261120-rest-activities`), on a `tile` (`radius-md`, 16u inside, 12px folded), headed in weight 600: a Checkbox row for **Every activity** (`"*"`), then one per activity in the programme's order, each row at least 48px with a 1px `control-border` rule between rows, the names at 19u (18n folded); hint "A rested activity has no sessions in these weeks." A tick writes a Times a week (`target`) of 0 for that key; an untick takes the `target` away, and the key's entry with it when nothing else is left. A row is ticked when its key's own `target` is 0. While Every activity is ticked, an activity with no Times a week of its own shows ticked and disabled: it rests through Every activity. An activity with its own Times a week doesn't rest (its own value beats Every activity's, K153), so its row stays unticked and can be ticked. The grid says "Rest week" in a rested cell (K170).
  - **A group per activity**, on a `tile` (`radius-md`, 16u inside, 12px folded), headed by its activity's name in weight 600: **Every activity** first (`"*"`), then one per activity with its own values. A Times a week of 0 is a rest: the list above shows it, so it has no row here, an activity whose entry holds only its rest has no group, and Add a value doesn't offer Times a week while the key rests. Any other Times a week (Set to 2, 50% of planned) is a row as usual. Each value is a row, separated by a 1px `control-border` rule: its field's name, an IconButton (Lucide `x`, "Remove sets from this group"), a SegmentedControl **Set to** | **% of planned** (a number, or `scale` as a percentage), and the number with its unit ("%" for % of planned). **Add a value** (a link) opens the Menu card on the fields the group doesn't set yet (for Every activity, every field some activity has). An activity's group ends with the hint "Deadlift’s own value beats the value for every activity."
  - **Add values for one activity** (secondary, Lucide `plus`) opens the Menu card on the activities without a group, a rested activity with no other value among them.
  - **Remove exception week** (quiet, Lucide `trash-2`) removes it at once, and focus moves to Add exception week.
- **Removing an activity** removes its group here too (spec F7). A changed activity key follows into its group (spec F5).
- **A problem** shows under its field, as TextField's error: "Week 9 is past the end. This programme has 8 weeks." under Weeks. A value's problem shows under its row, and a rest's problem under its Checkbox row.
- **Sizes:** at u = 1, labels and text 19u, fields and segments 60u, the number fields 110u wide. **Folded**, the system's n sizes: labels 16n, text 18n, fields and segments 48px.

## States

| State | Look |
| --- | --- |
| Closed | The row with its pencil |
| Open | The ink frame; Weeks, Label, the rest list, the groups, the two buttons |
| A rest | The rest list with Back squat and Deadlift ticked; the closed row reads "Rest: Back squat, Deadlift." |
| Add a value open | The Menu under the link |
| A problem | The field's error, its border in `error-ink` |

## Accessibility

- The pencil is named for the weeks ("Change weeks 4 and 8") and has `aria-expanded`. Opened, focus moves to Weeks; closing returns it to the pencil.
- The rest list is a `group` labelled "Rest these activities"; each row is a Checkbox (`role="checkbox"`, `aria-checked`), named by its activity, and a row with a problem is `aria-invalid` and described by it.
- Each group is a `group` labelled by its activity's name. Each row's SegmentedControl and number field are labelled by the row's field name.
- Add a value and Add values for one activity are Menu card triggers (`aria-haspopup="menu"`).
- Contrast, measured by the gate in both themes: `ink` and `ink-secondary` on `canvas` and `tile`, `error-ink` on `canvas`, `control-border` on `tile` and on `panel` (the Checkbox's box), `on-ink` on `ink` (a tick), `ink` on `canvas` for the frame.

## For the app

`src/components/ExceptionWeekEditor.vue` (W6). Test ids, as in the preview:

| Element | Test id |
| --- | --- |
| An exception week | `exception-week`; its pencil `exception-open` |
| The fields | `exception-weeks`, `exception-label` |
| The rest list | `exception-rest`; a row `exception-rest-row` with `data-rest="<key>"`; its problem `exception-rest-problem` |
| A group | `exception-group` with `data-activity="<key>"` (`*` for every activity) |
| A value | `exception-value` with `data-field="<field>"`; its `exception-value-mode`, `exception-value-remove` |
| The buttons | `exception-value-add`, `exception-group-add`, `exception-remove`, `exception-add` |

## You provide

The override as the draft holds it (its weeks, label and `activities`), the programme's number of weeks, the activities (key, name, fields), its words when closed (the draft model's), its problems (each a path and a sentence), and handlers that write each change to its path.
