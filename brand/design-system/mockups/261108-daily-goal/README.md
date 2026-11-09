# A Daily goal switch, and the date as the week's title

**Question:** where Settings puts the Daily goal switch (one switch, on the account, on by
default), and how the week screen's title line looks with the date as its title. The rest of
Settings, the grids and Edit plan's bar stay as they are.

**Status:** decided (2026-11-08)

**Link:** https://claude.ai/artifact/MLE6zpXaB7QnkTwFQu2eHo (private)

`goal.js` draws the Settings page on the shipped frame (`settings.css`, from `261101-ask-page`
by way of `261108-navbar-and-ask`); `week.js` and `week.css` draw the Exercises screen. New values
are `--candidate-*`.

## Options

1. **The switch.**
   - **A. In Your goals, above the text.** (Recommended: a daily target is a goal, and it changes
     what Ask says.)
   - **B. In Appearance, after Theme.**
2. **The week's title line.** Both: the date centred at the top in the title serif at
   `--fs-title`, in `ink`.
   - **T1. The section in the sans**, 600, max(22px, 27u). (Recommended: the serif is left to the
     one title.)
   - **T2. The section in a smaller serif**, max(24px, 30u).

## Decision

John picked **A** (K85) and **T1** (K86) on 2026-11-08, both the recommended options, then,
having seen T1 built, asked for the section's name to be "more like a title ... a serif font and a
bit larger": round 3 offered **H1** (the serif at 32u, the week at 40u, recommended) and **H2**
(36u, the week at 46u), and he picked **H1** (K87). He also
wrote: "daily goal should be in the "your goals" section of the settings view".

## Rounds

- **1, 2026-11-08:** the switch's place.
- **3, 2026-11-09:** the section's name as a serif title: H1 or H2.
- **2, 2026-11-08:** the date as the title, added from John's next message ("lets put the date in
  the center (horizontall centered) at the top of the tracker, like a title").
