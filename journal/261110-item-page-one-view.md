# One page for an item, and keys for back and forward (K104, K105)

John: "whether in edit more or tracker mode, clicking on an activity should bring up the same view,
not a modal. the view should have the "this weeks plan" section at the top." He also asked for sets
and reps to start at 1, for `b` and `f` to be back and forward, and for Esc to close a dialog before
it leaves full screen.

- **K104.** The Edit and Add dialogs are gone, and so is Edit plan's pencil. The name opens the
  item's page in both modes. The page puts This week's plan first. In Edit plan the title is a Name
  field, and a Remove section ends the page. Add opens a new item page at `#/new/<section>`
  (`NewItemPage.vue`), which holds its fields until Add. John picked mockup option A
  (`261110-item-page-one-view`), with Remove moved to the foot.
- **Sets and reps start at 1** for a new exercise (`NEW_EXERCISE_AMOUNT`). An exercise saved
  without them still loads empty.
- **K105.** H or B goes back and L forward, on every signed-in page. F was already Full screen
  (K91); John kept it there and chose H, B and L.
- **Esc in full screen: not done.** Chrome exits full screen on Esc before the page sees the key.
  Only the Keyboard Lock API (Chrome and Edge) changes that, and it makes leaving full screen a
  2-second hold. John chose no change.
- The plan's controls moved into `PlanFields.vue`, shared by both pages. The page layout classes
  moved to `lib/itemPage.ts`, and the plan-limit messages to `composables/planErrors.ts`.
- The default section order changed in `itemSections.ts` and `item_sections.py`. The shared
  fixture gained a case: an arrangement saved in the old default order stays as it is.

## What was observed

- Confirmed: 1340-odd unit tests, the API suite and 99 Playwright tests pass locally. Branch
  coverage is 98.08% against a 98% floor.
- Confirmed: in Chromium against the local stack (demo account), Edit plan shows no pencils. A
  name opens the page with the Name field and Remove. H goes back. Add opens the new page at the
  top with Sets 1 and Reps 1. Enter adds "Lunges 1 × 1", and Remove asks, then takes it off.

## What is deliberately not done

- Adding hides Recent weeks; a new item has none.
- A section the type hides stays hidden on the new item page, except the plan, which always shows.
