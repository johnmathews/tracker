# A bar led by the week, and a smaller Ask page with two views

**Question:** with Edit plan and the bar now one thing (K80), how does the bar look with no
wordmark and no Edit plan button, how does the keyboard leave Edit plan, how small should the Ask
page be, and what is its Document view beside a Conversation view? The week grid, the bar's other
actions and Ask's states stay as they are.

**Status:** decided (2026-11-08)

**Link:** https://claude.ai/artifact/CUFVgWwxKzmxcHbUiZFqfg (private)

`bar.js` and `bar.css` draw the bar in Edit plan at its real width. `ask.js` draws the Ask page live
on the shipped Settings frame (`settings.css`, `ask.css`, `side.css` and `icons.js`, copied from
`261101-ask-page`). New values are `--candidate-*`.

## Options

Not options, in every picture: no wordmark; no Edit plan button; the week picker first at the left;
"This week" first among the actions. On Ask: the intro at about 72 characters a line, no "Ask"
beside the question box (the box starts at the left edge), and a View switch (Document, the
default, or Conversation) at the end of the title line.

1. **The week's type.**
   - **A. The serif, like "Exercises":** title face, 600, max(30px, 40u). (Recommended: it reads
     as the page's title and matches the titles under it.)
   - **B. The bar's sans, bolder:** 700, max(24px, 30u).
2. **The keyboard and Edit plan.**
   - **K1. A hidden toggle, like "Skip to today":** the second Tab stop, out of sight until
     focused; "Edit plan" on the week, "Done editing" in Edit plan. (Recommended: nothing returns
     to the bar for a mouse or a finger.)
   - **K2. A "Done" button** ending the actions in Edit plan, in the ink fill.
3. **Ask's size.**
   - **S2. About 70%:** text max(14px, 14u), title max(24px, 28u), controls 44px, history 230u.
     (Recommended: it is what John saw at 70% zoom.)
   - **S1. About 80%:** text max(15px, 16u), title max(26px, 32u), controls 44px, history 260u.
4. **The Document view.** Conversation is one centred column, questions in tiles on the right.
   - **D1. Rows, as now.** (Recommended: John called the page "mostly fine".)
   - **D2. Headings over answers** at one 900u measure.

## Decision

John picked on 2026-11-08, in one round: **A** (the serif week, K81), **K2** (a visible "Done"
in Edit plan, with the hidden "Edit plan" toggle for the keyboard on the week, K82), **S2** (about
70%, K83) and **D1** (Document as rows, with Conversation beside it, K84). He chose K2 over the
recommended K1; the others are the recommended options.

## Rounds

- **1, 2026-11-08:** the first options, from John's request and four screenshots.
