# One page for an item, in the week and in Edit plan

**Question:** an item's page replaces the Edit and Add dialogs, in the week and in Edit plan alike,
with This week's plan first. Where does the page put the name, Remove and Add, which only the
dialogs had? The rest of the page (ItemPage card, K64–K66) stays as it is.

**Status:** decided (2026-11-10)

**Link:** https://claude.ai/artifact/HeUzYHhnemgZHUDbxW56Vy (private)

The stages are drawn by the script at the foot of `index.html` from the ItemPage card's own styles,
at a 1280×800 screen, scaled to fit; `.folded` is the card's phone layout. The dashed outline marks
what each option places. No new colours or sizes.

## Options

- **A. In the head.** In Edit plan the title turns into a Name field; Remove is a quiet Button
  beside Arrange sections; adding puts Cancel and Add exercise on that top line. (Recommended:
  everything that acts on the whole item sits together at the top, and the page keeps its shape.)
- **B. As rows.** The title stays; a Name row comes first; Remove is a last row with a line saying
  what it does; adding ends the page with Cancel and Add exercise.

## Decision

John picked **A** on 2026-11-10, changed: "option A. but "remove" goes to the bottom of the page in
its own section." Recorded as K104.

## Rounds

- **1, 2026-11-10:** A or B, with the page in the week (plan first) shown once for both.
- **2, 2026-11-10:** A with Remove as the page's last section; B taken off the page.
