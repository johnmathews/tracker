# The week title and This week

**Question:** where the "This week" button goes now that it sits next to the bar's › arrow and shows in the week view too, and how Settings › Appearance picks the week title (the dates or "Week 46"). The rest of the bar, the band and Settings stay as they are.

**Status:** decided: A, S1 and P2 (K130, K131)

**Link:** https://claude.ai/artifact/AUmSUupbcwmofXXXp4Cp6U

## Options

Question 1, the button:

- **A.** A secondary Button, "This week", in words only: after the › arrow in the bar (48px tall, 19px), and after the title in the band, centred with it. On a phone a long week puts it under the week. (Recommended: one look in both places, and the word is always there.)
- **B.** Today's BarAction (calendar over "This week") moves to after the › arrow; in the band, a quiet calendar and name at the right edge (calendar only on a phone).
- **C.** As A, and the band gets the week's arrows too, so the week view changes weeks without Edit plan. On a phone the button sits under the week.

Question 2, the setting (Settings › Appearance, after Theme; defaults to the dates):

- **S1.** A SegmentedControl, "Week title": "9–15 November" | "Week 46", this week's own. (Recommended: small, like Theme, and each choice shows what it does.)
- **S2.** A RadioCard, like Marks: "Dates" and "Week number", each with this week's title in the serif.

Either way: the bar, the band and print follow it; a screen reader hears "Week 46, 9–15 November"; a week in another year adds its year, "Week 2, 2027".

## Decision

A and S1, 2026-11-15, chosen from the options in the question ("A: worded button", "S1: segmented"). John also chose to save the week title with the account, so it is the same on every device ("With the account"), unlike Marks and Theme. Recorded as K130 (the button), K131 (the setting) and K132 (synced). Round 2, the same day: the button reads "View current week", the segments "Date" and "Week number" (John's comments), and on a phone the band's button sits under the title (P2, "under the title").

## Rounds

- **1, 2026-11-15:** the first options.
- **2, 2026-11-15:** John's comments: the button reads "View current week" ("the button is an action. its a \"GO to this week\". so the wording should be active."), and the segments "Date" and "Week number". The longer name leaves no room beside a long title on a 390-wide phone, so a new question: P2 (under the title, the band a row taller while it shows; recommended) or P1 (beside it, the title shrinking to about 19.5px).
