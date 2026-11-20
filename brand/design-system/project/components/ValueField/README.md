One of an activity's numbers in the programme builder: a line that says its shape in words, which opens into the fields that set it, as None, Stays the same or Grows.

## Use

- **Where:** inside an open ActivityCard, one line per value: Times a week, Sets, Reps or Hold, Weight; for cardio Times a week, Time and Distance. The lines form a list with 1px `line` rules, one above the first (option A of question 2 in the mockup `261120-programme-builder`).
- **The line** is a button at least 60u tall (52px folded): the value's name in weight 600 at 19u in a 132u column, then its shape in words in `body`, then a Lucide `chevron-right` in `ink-secondary`. Folded, the name sits over the words. Under the pointer it takes a `tile` fill. The words:
  - a number: "3", "5";
  - a value chosen at start: "40 kg chosen at start";
  - a value that grows: "30 s, +5 s every 2 weeks, up to 90 s", "40 kg chosen at start, +5% a week chosen at start", "20 km chosen at start, +10% a week";
  - a value left out: "None", in `ink-secondary`.
- **Opening:** pressing a line opens its group under it and turns the chevron down. Opening one line closes the one open before in the same card.
- **The group:** on a `tile`, `radius-md`, 16u inside (12px folded), its fields on `panel`. First the shape, a SegmentedControl named for the value with its label hidden:
  - **None** (only where the activity can go without the value: Sets, Weight, and a cardio activity's Time and Distance; Reps and Hold are left out by Measure's Neither, and Times a week left out is 3). The hint says what None means: "Plank has no weight. Pick Stays the same to give it one." A value left out stays out of the saved programme.
  - **Stays the same:** **Value**, a number with its unit after it in `ink-secondary`, then the link **Use a value chosen at start**.
  - **Grows:** **Starts at** (a number, or a value chosen at start), **Use a value chosen at start**, then on one row **Grows by** (a SegmentedControl, the unit or **%**: the unit writes `add`, % writes `rate`), **Amount** (its unit follows Grows by) and **Every** (Stepper, "1 week" to "52 weeks"). Under them a hint with the most and the rounding: "Up to 90 s. Rounds to 5 s.", "No most. Rounds to 2.5 kg." Then **Change the most and the rounding**, a disclosure that opens **Most** (hint "Left empty, no most.") and **Round to**.
- **A value chosen at start** (spec §5.5): Use a value chosen at start turns the number into a field-shaped button with a Lucide `chevron-down`: "**Long ride** · 20 km" (the label in weight 600, then its default and unit), hint "Chosen when the programme starts. A number works too." It opens the Menu card on the values chosen at start, the chosen one with a Lucide `check`, then **Use a number** (Lucide `hash`), which turns it back into a number field with the default in it. Starts at and Amount take one; Every, Most and Round to take numbers only.
- **Switching shape** keeps what it can (spec F2): Stays the same to Grows makes the value the start; Grows to Stays the same keeps the start.
- **A problem** (spec F4): a problem whose path is one field shows under that field, as TextField's error: `caption` `error-ink` with the 16px Lucide `circle-alert`, the field's border in `error-ink` and `aria-invalid="true"`. A problem with the whole value's path, such as a week over the limit ("Week 6 comes to 520 kg. The most is 500."), shows under the line's words while it is closed, and at the foot of the group while it is open.
- **Sizes:** at u = 1, labels and text 19u, fields and segments 60u, the number fields 140u wide. **Folded**, the system's n sizes: labels 16n, text 18n, fields and segments 48px.

## States

| State | Look |
| --- | --- |
| Closed | The name, the words, `chevron-right` |
| Closed, None | "None" in `ink-secondary` |
| Closed, a problem | The problem under the words |
| Open, Stays the same | The shape, Value, Use a value chosen at start |
| Open, Grows | The shape, Starts at, Grows by, Amount, Every, the hint, the disclosure |
| Open, None | The shape and its hint |
| A value chosen at start | The pick with its label and default; its Menu under it while open |
| The most and the rounding open | Most and Round to in place of the hint |
| Open, a problem | The problem at the group's foot, or under its field |

## Accessibility

- The line is a `button` with `aria-expanded` and `aria-controls` naming its group; the name and the words are read together. A closed line's problem is tied to it with `aria-describedby`.
- The group is a `group` named for the value ("Hold"). The shape's SegmentedControl is named the same, since its visible label is the line above it.
- The number fields have visible labels and the right `inputmode` (`decimal`, `numeric` for whole numbers). Every is the Stepper card, with "Fewer weeks between increases" and "More weeks between increases".
- The pick is the Menu card's trigger (`aria-haspopup="menu"`), labelled by "Starts at" and its value; its items are `menuitemradio`s, the chosen one `aria-checked="true"`.
- Contrast, measured by the gate in both themes: `ink` and `ink-secondary` on `canvas` and `tile`, `error-ink` on `canvas` and `tile`, `control-border` on `tile`, `ink` on `panel` in the fields.

## For the app

`src/components/ValueField.vue` (W5). Test ids, as in the preview:

| Element | Test id |
| --- | --- |
| A line | `value-line` with `data-field="<field>"` (`target`, `sets`, `reps`, `duration`, `weight`, `distance`) |
| The shape | `value-shape` |
| The fields | `value-start`, `value-use-param`, `value-param-pick`, `value-by`, `value-amount`, `value-every`, `value-limits`, `value-max`, `value-step` |
| A problem | `value-error` |

## You provide

The field's name and unit, its value as the draft holds it (absent, a number, a `"$key"` reference or a progression), its words (the draft model's), the field's own defaults for the most and the rounding (programmes.md §3), whether the activity can go without it, the values chosen at start whose unit fits, its problems (each a path and a sentence), and whether it is open. A handler that writes the new value to its path.
