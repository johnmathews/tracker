One activity in the programme builder: closed, a card with its name and its rule in a line; open in place, the activity's fields.

## Use

- **Where:** the Activities section of the ProgrammeBuilder card, one card per activity in the document's order, 12u apart. **Add activity** under the list adds a card of the programme's kind, open, at the end.
- **Closed:** a card on `canvas` with a 1px `line` border and `radius-lg`. Its head is one button: a Lucide `chevron-right` in `ink-secondary`, the name in weight 600 at 22u, and under it the rule in `body` `ink-secondary`, in words: "5 × 5 · 40 kg, +5% a week, chosen at start", "3 × 30 s · +5 s every 2 weeks, up to 90 s", "60 min, +10 min every 2 weeks · 20 km chosen at start, +10% a week". Under the pointer the head takes a `tile` fill.
- **A problem** (spec F4): any problem inside the activity shows under its rule in `caption` `error-ink` with the 16px Lucide `circle-alert` ("Week 6 comes to 520 kg. The most is 500."), and the card's border turns `error-ink`. Two or more problems show a line each.
- **Open** (K147's open frame): the card's border becomes 2px `ink`, the chevron turns down, and the fields follow the head, indented to the name (12px folded). Pressing the head again closes it. One card is open at a time: opening one closes the one before. The fields, top to bottom:
  - **Name** (TextField).
  - **Measure** (SegmentedControl): **Reps**, **Time** or **Neither**. Reps keeps a Reps value, Time a Hold value, Neither leaves both out. Strength and mobility only.
  - **Sides** (SegmentedControl): **Per set** or **Each side**. Strength and mobility only.
  - **The values,** a ValueField line each: Times a week, Sets, then Reps or Hold (by Measure), then Weight (strength only). A cardio activity has Times a week, Time and Distance.
  - **More: key, notes, link** (a disclosure link with a Lucide chevron), which opens **Key** (TextField; hint "Runs started from now use it as the item’s id. Lowercase letters, numbers and dashes."), **Notes** (TextArea, three lines; hint "Markdown. Each run’s item shows it.") and **Link** (TextField, `inputmode="url"`).
- **The key** (spec F5): an activity added in this session takes its key from its name, and the key follows renames until the person edits it under More. A loaded activity keeps its key through any rename. When a key changes, the exception weeks' entries for it follow.
- **The ⋯ menu:** an IconButton (Lucide `ellipsis`, named "More for Deadlift") at the right of the head, opening the Menu card with **Move up** (Lucide `arrow-up`), **Move down** (`arrow-down`) and **Remove** (`trash-2`). The first card has no Move up and the last no Move down. After a move, focus stays on the moved card's ⋯. **Remove** takes the activity out, with its entries in the exception weeks (spec F7), and focus moves to the next card, or to Add activity.
- **Sizes:** at u = 1, the name 22u, text and fields 19u, controls 60u, the ⋯ 52u. **Folded**, the system's n sizes: name and text 18n, labels 16n, controls 48px, the ⋯ 44 by 48px.

## States

| State | Look |
| --- | --- |
| Closed | 1px `line` border; the name and the rule |
| Closed, a problem | 1px `error-ink` border; the problem under the rule |
| Hover on the head | `tile` fill |
| Open | 2px `ink` border; the fields under the head; the problem moves to its field |
| More open | Key, Notes and Link under the link |
| Menu open | The ⋯ on `tile`, the Menu under it, right edges aligned |

## Accessibility

- The head is one `button` with `aria-expanded` and `aria-controls` naming the body, so the name and the rule are read together. A closed card's problem is tied to it with `aria-describedby`.
- The open body is a `group` labelled by the activity's name. On opening, focus stays on the head; Tab moves into the fields.
- Measure and Sides are SegmentedControls with visible labels. More is a disclosure with `aria-expanded`.
- The ⋯ is the Menu card's trigger: `aria-haspopup="menu"`, `aria-expanded`, named for its card.
- Contrast, measured by the gate in both themes: `ink`, `ink-secondary` and `error-ink` on `canvas`, `ink` on `canvas` for the open frame, `control-border` and `focus` on `canvas`.

## For the app

`src/components/ActivityCard.vue` (W5). Test ids, as in the preview:

| Element | Test id |
| --- | --- |
| A card | `activity-card` with `data-activity="<key>"` |
| Its problem | `activity-problem` |
| The fields | `activity-name`, `activity-measure`, `activity-sides`, `activity-more`, `activity-key`, `activity-notes`, `activity-link`; each value is a ValueField's `value-line` |
| The menu | `activity-menu`, its items `activity-move-up`, `activity-move-down`, `activity-remove` |
| Add activity | `activity-add` |

## You provide

The activity (its key, name, kind's fields, notes and link) as the draft holds it, its rule in words (the draft model's closed line), its problems (each a path and a sentence), whether it is open, whether it is first or last, and the values chosen at start for its ValueFields. Handlers for open, close, move up, move down and remove.
