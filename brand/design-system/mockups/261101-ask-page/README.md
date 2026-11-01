# An Ask page for questions about your week

**Question:** how does a new Ask page look, where does it open from, and how plainly may its
answers judge? The week, the bar's other actions and the other Settings rows stay as they are.

**Status:** decided (2026-11-01)

**Link:** https://claude.ai/artifact/5TWTzdDdMhbtKAypDhCStw (private)

The page is live. `ask.js` draws it on the shipped Settings page's frame (`settings.css` and
`icons.js`, copied from `261026-settings-page`), and `ask.css` adds what is new as
`--candidate-*` values. `try.html` shows it full size, with a switch for the layout, the state and
the theme. The second answer streams in.

## Options

Both start from the Settings page (K51, K52): no bar, "Back to the week", the serif title, the
page's margins and sizes from `u`. On a phone, both fold to one column.

- **A. Rows like Settings.** Full width. Each question and answer is a row: the question sits in
  the 320u left column, where Settings puts its headings, and the answer sits to its right at
  about 68 characters a line, with hairlines between rows. The box is the last row.
  Recommended: it reads like Settings and the week.
- **B. One reading column.** 760u wide and centred. The question is a tile on the right, and the
  answer is plain text under it.

Also on the page:

- **The bar:** an Ask action (Lucide `message-circle`) before Settings, shown only when the
  planner has an AI key.
- **Settings:** a "Your goals" row between Planner and Your data.
- **Voice:** V1 (the rules as they stand) or V2 (a plain verdict, recommended).
- **Three short questions:** a reload keeps the conversation in the tab; import fills only empty
  goals; how the questions-left chip shows.
- **States:** empty, no goals, none left, error, offline and unsynced.

## Decision

Round 1, 2026-11-01. John picked:

- **Layout:** A.
- **Voice:** V2, in his words: "V2 - plain verdict, the app may qote a note back as advice. and also may include streaks scores or rankings."
- **Reload:** "save the conversations as history. there should be a conversation history section." History is stored on the server and listed on the Ask page.
- **Chip:** always shown.

The K entries are written with the build (W7). Round 2, 2026-11-01: John picked **H2**, a rail, then asked for it as a proper side panel (round 3). Round 3, 2026-11-01: John picked **S1**. The history is a full-height side panel on the panel surface, with a 1px line on its right. It hides to a 64u strip with two icons (show history, new conversation), the line kept. It is grouped Today / Last week / Earlier. The bin shows on the open conversation and on hover or focus. On a phone it is a drawer over a scrim. Values in `side.css`.

## Rounds

- **1, 2026-11-01:** A and B, the bar, the goals row, the voice question (V1 or V2), and three
  short questions.
- **2, 2026-11-01:** the history list: H1, a History row above the conversation, or H2, a rail beside it. John picked H2.
- **3, 2026-11-01:** from John's note on H2: "lets make the history rail a proper side panel that can be hidden/shown. lets copy how anthropic apps do it. show me a better mockup. we need a vertical border between the history section and conversation section". A full-height side panel (`side.css`) with a vertical line. S1 hides it to a strip of icons; S2 hides it entirely. On a phone it is a drawer. John picked **S1**.
