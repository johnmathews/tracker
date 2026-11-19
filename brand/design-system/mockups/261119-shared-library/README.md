# Shared library: the Shared tab and Publish

**Question:** two questions about the shared library (#88), each answered on its own. (1) Where
any user finds the shared programmes on the Programmes page, and what a row offers. (2) How the
admin publishes, publishes again and unpublishes from the Library tab. Everything else on the
Programmes page stays as it is. The spec is
[2026-11-19-shared-library.md](../../../../docs/specs/2026-11-19-shared-library.md) (§2, §5, §7).

**Status:** decided

**Link:** https://claude.ai/artifact/Pdtch9KPbg2xVw2rUXhHrE

## Options

No option adds a colour or a `--candidate-*` value. Each uses the system's tokens and its existing
cards: ProgrammesPage, Tabs, Button, Chip, InlineMessage, TextLink, Dialog, ConfirmDialog, Menu,
IconButton and ProgrammeGrid. Every measure passes 4.5:1 for text and 3:1 for an outline. The
measures are light / dark.

### 1. The Shared tab (any user)

Each shared row shows the name, "Kind · N weeks · N activities" and the description, as a library
row does. The data: Strength 5×5, Couch to 5K and Desk mobility.

- **A.** A fourth tab, **Shared**, between Library and Add. Each row has one action, **Copy to
  library** (secondary, Lucide `copy-plus`). After a copy, an InlineMessage (success) at the top of
  the tab says "Strength 5×5 is in your library." with a TextLink, **Open in Library**. The row
  stays as it was, so copying again makes a second copy (S4). An empty shared library says "No
  shared programmes yet." Measures: the message and its link, `ink` on `canvas`, 15.8:1 / 14.4:1;
  the facts and the empty line, `ink-secondary` on `canvas`, 6.4:1 / 7.7:1; the button's
  `control-border` outline on `canvas`, 3.6:1 / 5.0:1. (Recommended: the shared programmes get a
  place of their own, and the page still fits four short tabs on one line at 390px.)
- **B.** No new tab. The Library tab lists the user's own programmes, then a section **From the
  shared library**, with the line "Programmes anyone with an account can copy. A copy is yours to
  change and start.", and the same rows as A. A copy appears in the list above, with the same
  message and no link. The section heading is an `h2`, so the shared names become `h3`s.
  Measures: the heading 15.8:1 / 14.4:1, its line 6.4:1 / 7.7:1.
- **C.** As A, and each row gains **Preview** (secondary, Lucide `eye`) before Copy to library.
  Preview opens the programme in place, framed in 2px `ink` as Preview and start is. It shows the
  ProgrammeGrid with weeks by number and no dates, at the programme's own values, then **Close**
  and **Copy to library** (primary). It costs a second action on every row, and the Library's
  Preview and start shows the same grid after the copy. Measures: the frame, `ink` on `canvas`,
  15.8:1 / 14.4:1; the primary, `on-ink` on `ink`, 15.8:1 / 14.4:1.

### 2. Publish (the admin only)

John's library holds Strength 5×5 and Couch to 5K, both shared, and Hip mobility, which isn't.

- **A.** Each row gains **Publish** (quiet, Lucide `share`) after Delete. A shared row shows a
  "Shared" Chip after its name, and offers **Publish again** (`refresh-cw`) and **Unpublish**
  (`eye-off`) in place of Publish. After a publish, an InlineMessage (success) says "Strength 5×5
  is in the shared library." Folded, the row's buttons sit two to a row.
  - **Publish** opens a Dialog on the server's preview, titled "Publish Strength 5×5". Under "What
    everyone will see", the programme sits on the page's `canvas` in a `line` frame: the name, the
    facts, the description, then each activity's name and chip, its notes in the `note` style,
    and its link as a TextLink ("Open stronglifts.com in a new tab"). An activity with no notes
    says "No notes." Under the frame: "Everyone with an account can see and copy it. Your name is
    not shown." Then **Cancel** and **Publish programme**, which sends the preview's `rev`. A stale
    `rev` shows the fresh preview with an InlineMessage (info): "The programme changed since this
    preview. Check it, then publish."
  - **Publish again** opens the same Dialog, titled "Publish Strength 5×5 again", with the line
    "It replaces the shared copy from Tue 17 Nov. Copies people have made stay as they are." and
    the button **Publish again**. The page describes it but doesn't draw it.
  - **Unpublish** asks in a ConfirmDialog: "Unpublish Strength 5×5?" / "It leaves the shared
    library. Copies people have made stay theirs." / Cancel, **Unpublish**.
  - Measures: the Chip, `ink-secondary` on `tile`, 5.9:1 / 6.4:1; the quiet buttons and the
    message, `ink` on `canvas`, 15.8:1 / 14.4:1; the Dialog's words, `ink` on `panel`, 16.7:1 /
    13.1:1; the preview's notes and links, `ink` on `canvas`, 15.8:1 / 14.4:1; its facts and "No
    notes.", `ink-secondary` on `canvas`, 6.4:1 / 7.7:1; an activity's chip 5.9:1 / 6.4:1; the
    primaries, `on-ink` on `ink`, 15.8:1 / 14.4:1; Cancel's outline, `control-border` on `panel`,
    3.8:1 / 4.5:1.
  - (Recommended: the state and the actions are in view on the row, and the preview shows exactly
    what S5 promises.)
- **B.** As A, but the publish actions live in a row's overflow Menu: a quiet IconButton **More**
  (Lucide `ellipsis`, named "More for Couch to 5K") after Delete opens a Menu with **Publish**, or
  **Publish again** and **Unpublish**. The Chip, the Dialog and the ConfirmDialog are as in A. The
  row looks as it does today, and the actions are one press further away. Measures: the Menu's
  items, `ink` on `panel`, 16.7:1 / 13.1:1; the highlighted item and the open trigger, `ink` on
  `tile`, 14.4:1 / 12.0:1.

**What either pick changes in the system.** Option 2A or 2B uses the Chip for a state ("Shared").
The Chip card says today that it is for "how much" under an exercise name, so its card gains that
use. Option 2B is the first Menu on a row; the Menu card covers only the account menu today.

## Decision

Picked by John on 2026-11-19:

1. **B**, "B. Section in Library". Recorded as K171.
2. **B**, "B. In a More menu". Recorded as K171.

Option 2B puts a Menu on a list row for the first time, so the Menu card gains that use. The "Shared"
Chip widens the Chip card's use from amounts to a status.

## Rounds

- **1, 2026-11-19:** the first options, from the approved spec.
- **1a, 2026-11-19:** the lead gave question 2's screens the Shared tab too, as every user has it.
