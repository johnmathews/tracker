# Remove wording, the new tracker page's Kind row, and Delete tracker's dialog

Follow-ups to the account trackers release (K122–K126), from John on the local stack, 2026-11-15.

## 1. What changed

- **Remove on an item's page (K127).** New words: the row says "Remove ‘Back extensions’ from the
  Strength tracker for this week and future weeks. Existing data is not removed.", the button
  "Remove from this week on", and the dialog "Remove ‘Back extensions’ from this week’s plan and
  also future weeks. History is unchanged and existing data is not removed." The behaviour stays:
  week N's plan loses the item and later weeks follow it.
- **New tracker page (K128).** No Starts row, no line over the Kind control, no visible label on
  the control. Under it, one plain line per kind: "Log sets, reps, time and weight.", "Log time and
  distance.", "Log portions.", "Log sets, reps or hold time, each side." The registry's `records`
  became `settings`. Mockup `261115-new-tracker-kind`, four rounds.
- **Delete tracker's dialog, the new item page and food (K129).** "Remove Strength from this week
  and future weeks." over "History is not deleted."; a ConfirmDialog now keeps its message's line
  breaks. The new item page's plan heading is "Goals". Food reads "Log portions."

## 2. Calls made on the way

- A first pass removed the item from later weeks with their own plan too. John dropped it: editing
  a future week is "too complicated and niche", so week N's plan simply becomes week N+1's.
- The mockup's Kind control stretched across the row; the app's never did. The mockup used a
  plain flex column, which stretches its children.
- Some auto-replies on the mockup's comments promised to bring back the kind's name, which John
  had called superfluous. They were corrected in the threads.

## 3. Left for later

- A week-number option in Settings ("Week 46"), and "This week" next to the bar's `>` on every
  week but this one. Both need a mockup first; handed to a new session.
- An item's own page still heads its plan "This week’s plan"; only the new item page says "Goals".

## 4. What is deliberately not done

- No handling of later weeks that already have a plan of their own when an item is removed.
