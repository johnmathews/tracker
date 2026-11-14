# Edit plan: Delete tracker

**Question:** which look does Edit plan's "Delete tracker" take, to the right of Add? Decided by
John's request: the row's trash can goes (an item is removed from its own page), and Delete
tracker asks first in the ConfirmDialog.

**Status:** decided

**Link:** https://claude.ai/artifact/GnVAZJzktVX4bG2bmCzVPY

## Options

- **A.** A secondary Button, bordered like Add, with `trash-2`.
- **B.** A quiet Button (no border until hover), with `trash-2`. (Recommended: rare and can't be
  undone, so less weight than Add.)

The question: **Delete Exercises?** "Its 5 exercises, their marks in every week and their notes
are deleted. This can't be undone." · Cancel · Delete. The words wait on what deleting means
(asked in chat), and adding a tracker waits on the same answer.

## Decision

**A**, picked by John on 2026-11-14 ("option A"), recorded as K122 with K123. Deleting ends the tracker from the week on show: past weeks keep it, with its marks and notes ("its just removing the tracker from future weeks, and this week. let the modal say that history wont be deleted").

## Rounds

- **1, 2026-11-14:** the first options, drawn into the running app's DOM and screenshotted at
  1280 × 800 and 390 × 844, light and dark.
- **2, 2026-11-14:** A chosen; the question reworded: "Delete Strength?" "Strength comes off this week and every week after it. Your history stays: past weeks keep Strength, with its marks and notes." · Cancel · Delete.
