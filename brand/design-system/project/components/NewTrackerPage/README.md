The page Edit plan's Add tracker opens, at `#/new-tracker`: a name, a kind with a line saying what it records, and when the tracker starts (K124). It is framed like the new item page (ItemPage, K104).

## Use

- **Opening it:** the Header's "Add tracker" BarAction, shown in Edit plan only, before Settings (K124). The page has no bar, like Settings and an item's page (K52), and opens at its top with the cursor in Name.
- **The head,** on the page's 48u margins: a TextLink at its left, "Back to the week", at 19u with a 26u `chevron-left`, and at its right Cancel (a quiet Button) and "Add tracker" (the primary Button), so Add tracker is in view while the page fills. Then "New tracker" in `label` `ink-secondary`, the page's `<h1>`, over a TextField labelled "Name", up to 560u wide, 28u above the first row.
- **The rows,** like an item's page (Layout A, K65): a `line` rule above each, its heading in `title-2` in the week's 320u name column, its content beside it.
  - **Kind:** a line in `body` `ink-secondary`, "What each item in it records. The kind is set once.", then a SegmentedControl labelled "Kind" with the registry's kinds in its order, Strength first and chosen, then Cardio and Food. Under it, in `body` `ink`, the chosen kind's line: "Strength: sets, then reps or time, and weight. Marked great, partial or missed." "Cardio: time and distance. Marked great, partial or missed." "Food: a number of times a week. Marked eaten." The line is a polite live region, so a screen reader hears it change. A kind added to the registry (`src/lib/trackerTypes.ts`), Mobility next, joins the control with its own line; the mockup draws four.
  - **Starts:** "This week, empty. Add items to it in Edit plan.", in `body` `ink-secondary`. "This week" is the week on screen, as Delete tracker's (K122).
- **Add tracker,** or Enter in Name, adds the tracker after every other, empty, with its kind's daily target, starting in the week on screen. The page goes back to the week, still in Edit plan, with focus on the new tracker's Add button. Cancel and Back to the week add nothing and put focus back on Add tracker.
- **The name** is trimmed and holds up to 60 characters (the field stops there). An empty name shows the TextField's error, "Enter a name.", adds nothing and puts focus in Name. An account holds at most 100 trackers, deleted ones included; past that the error says "An account holds at most 100 trackers, deleted ones included."
- The sizes are the item page's (main.css): labels and text 19u, every control 60u tall. Folded, each row's heading sits over its content and the head's buttons wrap under Back.

## States

| State | Look |
| --- | --- |
| Opened | Name empty and focused, Strength chosen, its line under the control |
| A kind chosen | that segment in `ink` with `on-ink` words, its line under the control |
| No name | the Name field's error, "Enter a name." |
| Folded | the head on two lines, each row's heading over its content |

## Accessibility

- One `<h1>`, "New tracker"; each row a `<section aria-labelledby>` on its `<h2>`.
- The SegmentedControl is a single-choice toggle group named by its visible label, "Kind"; the kind's line is `aria-live="polite"`.
- Add tracker is the form's submit button, so Enter in Name adds.

## You provide

The kinds and their lines (the tracker-type registry), and what Add tracker, Cancel and Back do.
