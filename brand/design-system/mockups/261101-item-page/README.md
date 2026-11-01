# An item's own page

**Question:** pressing an exercise's or a food's name opens a page of its own, with Notes,
Details for its type, This week's plan and Recent weeks. How is that page laid out? The week, its
rows and the Edit dialogs stay as they are; the name only underlines under the pointer.

**Status:** decided (2026-11-01)

**Link:** https://claude.ai/artifact/CXY5ppcBZ9nLDYSAk5FmuM (private)

The page is live (`item.js`, `item.css`). `marks.js` and `icons.js` hold the app's drawings and
the Lucide icons, copied from the 261027 Edit plan mockup. `try.html` shows the page full size,
with a switch for the option, the item (Kettlebell swings or Nuts) and the theme.

## Options

Shared by all three: the Settings page's sizes and no bar (K51, K52); "Back to the week", the
type in `label` `ink-secondary`, the name in the `title-1` serif with the plan's chips beside it;
notes in the note style (serif italic), read by default, with Edit notes turning them into a
TextArea; fields that save as you type; a plan section that says it changes this week's plan;
eight recent weeks, newest first, a met week's count in `pen`, underlined (K60). Folded, one
column.

- **A. Rows like Settings.** Full width; each section a row with its heading in the 320u left
  column and hairlines between rows. Order: Notes, Details, Plan, Recent weeks. Recommended: it
  reads like the week and Settings, and has room for more sections as the page grows.
- **B. Notes as the page.** Two columns under the name: the notes in the wider left column, a step
  larger; plan, recent weeks and details in a narrower right column.
- **C. How it's going, first.** One centred 880u column with Recent weeks straight under the name,
  then Notes, Details and the plan.

## Decision

**A. Rows like Settings**, chosen by John on 2026-11-01 on a second look at round 1, after B was
built. In his words: "im looking at the artifact at
https://claude.ai/artifact/CXY5ppcBZ9nLDYSAk5FmuM and i want to choose option A (rows like
settings)". Recorded as K65 in [docs/decisions.md](../../../../docs/decisions.md) §4.14. The
order is option A's: Notes, Details, This week's plan, Recent weeks. The notes read at the page's
text size, as A draws them. The page is described in the ItemPage card, its recent weeks in the
RecentWeeks card, and the name as a link in the WeekGrid card.

John first picked **B. Notes as the page**, in his words "B. Notes as the page", recorded as K64.
The ItemPage and RecentWeeks cards and the app were built from B, then moved to A. K64 still
records that first pick and everything about the page other than its layout and the notes' size.

On Recent weeks, John also settled what counts: "count every mark because red is still a "done"
mark. its just says "this was very difficult"". Every mark counts, missed included, as the mockup
already drew it.

Building the cards settled a few things the mockup left open. They still apply under A:

- The chips beside the name are the Chip card (`ink-secondary` on `tile`, `radius-sm`), not the
  mockup's rounder `ink` pills.
- The plan's Sets is a TextField, as in the Edit dialog, not the mockup's Stepper.
- A marked day's box in Recent weeks stays `control-border`, as DayMark draws it in every state.
  The mockup drew it in `ink-secondary`.
- The Link field shows a link under it, "Open youtube.com in a new tab", rather than underlining
  the text inside the field.
- The line over Recent weeks writes its numbers as words ("three of the last eight weeks"), as
  voice.md asks of running sentences.
- An item with no notes shows "Add notes" alone, and the field opens empty. The mockup drew only
  "Edit notes".
- The Link field takes a row of its own. Recent weeks keeps the RecentWeeks card's 24u marks and
  its "when" column as wide as its longest label; option A drew 30u marks and a 130u column.

## Rounds

- **1, 2026-11-01:** A, B and C, each with an exercise and a food, desktop and phone, both themes.
  Contrast: the met count is `pen` on `canvas` at 4.9:1 light and 8.8:1 dark; every other pairing
  is already in the system.
- **2026-11-01, first pick:** John picked B, "B. Notes as the page". The ItemPage and
  RecentWeeks cards and the WeekGrid card's name as a link were built from B (K64).
- **2, 2026-11-01, decided:** no new mockup. Looking at round 1 again with B built, John chose A,
  "option A (rows like settings)" (K65). The ItemPage card, its preview and the app moved to A.
