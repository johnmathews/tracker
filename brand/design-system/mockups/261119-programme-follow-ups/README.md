# Programme follow-ups: Restart and Re-open, paused in red, a planned break

**Question:** three questions, each answered on its own. (1) How an ended run's overview offers
Restart and Re-open (#87). (2) Whether the week's paused row and the item page's lede take
`paused-ink` at 600, as the grid's "Paused until" line does (#90). (3) What the grid says for a
week planned with a goal of 0 (#91). Everything else on each screen stays as it is.

**Status:** decided

**Link:** https://claude.ai/artifact/H26ukMW86iidWMWUifBTTw

## Options

No option adds a colour or a `--candidate-*` value. Each uses the system's tokens, `paused-ink`
(K166) included. Every measure passes 4.5:1 for text and 3:1 for an outline.

### 1. Restart and Re-open on an ended run (#87)

Drawn in three states: (i) ended early by End programme ("Ended Sun 15 Nov. Knee."), (ii) ran to
its last Sunday, and (iii) still running with an end set for a later day.

- **A.** Two secondary Buttons where the controls row sits: **Re-open programme** (Lucide `play`,
  state (i) only) and **Restart from week 1** (`rotate-ccw`). In state (iii), End programme
  becomes **Cancel the end** (`undo-2`). Each opens a ChangeSheet. Step 1 holds the fields: From
  and Reason for Re-open, Name and Starts for Restart. Step 2 is the server's preview, a "What it
  does" list, with **Re-open programme** or **Restart programme** to confirm. Cancel the end opens
  the re-open's preview in one step, because its day can only be the end's own day. Its buttons
  are **Keep the end** and **Cancel the end**. Measures: ink on canvas 15.8:1 / 14.4:1 (light /
  dark), the control-border outline 3.6:1 / 5.0:1, ink-secondary on panel 6.8:1 / 7.1:1, ink on
  the summary's tile 14.4:1 / 12.0:1, on-ink on ink 15.8:1 / 14.4:1. (Recommended: each button
  says what it does, and only a run ended early shows Re-open.)
- **B.** One Button, **Start again**. Step 1 of its sheet is a RadioCard choice, **Carry on where
  it stopped** or **Start from week 1**, each with a line, and then that choice's fields. Step 2
  is A's preview. In state (ii) the sheet opens on Start from week 1 with no choice. State (iii)
  is as in A. Measures: the RadioCard outline on panel 3.8:1 / 4.5:1, its line 6.8:1 / 7.1:1.
- **C.** As A, with the buttons under the run's line and above the tabs. The first button is
  primary. A full grid runs past a laptop's screen, so buttons at the foot are out of sight. State
  (iii) is as in A. Measures: on-ink on ink 15.8:1 / 14.4:1.

**Also, a wording fix.** The overview says "Ended Sun 15 Nov", the last day. The item page's lede
says "The programme ended on Mon 16 Nov.", the first day without it. The proposal is that both
name the last day, so the lede reads "Ended Sun 15 Nov."

### 2. "Paused until" in paused-ink, in two more places (#90)

- **A.** In the week's paused row, "Paused until Mon 28 Dec." is `paused-ink` at 600. "Knee." and
  the pause icon stay `ink-secondary` at 400. The item page's lede is reworded to lead as the
  grid and the week do: "Paused until Mon 28 Dec. Knee. It comes back at **45 kg**.", with its
  first sentence red. With no end date, it reads "Paused. Knee. It comes back at **45 kg** when you
  resume it.", with "Paused." red. Measures: `paused-ink` on canvas 7.4:1 / 7.2:1, the reason in
  `ink-secondary` 6.4:1 / 7.7:1. (Recommended: the same red sentence names the same day in all
  three places.)
- **B.** The week as in A. The item page keeps today's wording, with "Paused since Mon 16 Nov."
  in red, so the red names the pause's start there and its end in the week. Measures: 7.4:1 /
  7.2:1.
- **C.** The whole line in `paused-ink` at 600, in both places: the week's reason and icon too,
  and the whole lede in A's wording, value included. Measures: 7.4:1 / 7.2:1.

Choosing A, B or C widens `paused-ink`'s usage in `tokens.json`, which today says "and nothing
else" (K166).

### 3. A week planned with a goal of 0 (#91)

"Paused" comes only from the cell's state. The grid shows Back squat resting in week 3 (past) and
week 6 (to come), with a real pause in week 5 for contrast. Beside it is week 3 again, with one day
marked.

- **A.** "Rest week" in the cell value's style, in `ink-secondary`, with the planned value under
  it ("42.5 kg"). A marked rest week adds "1 done". A later rest week reads "Rest week" over its
  value and sets. Measures: `ink-secondary` on a past week's tile 5.9:1 / 6.4:1, and on canvas
  6.4:1 / 7.7:1. (Recommended: plain words that don't read as a pause or a miss.)
- **B.** Numbers only. A past rest week reads "0 of 0" in plain `ink` at 400, with no met
  underline ("1 of 0" with a mark). A later one shows its value, its sets and "0 a week".
  Measures: `ink` on tile 14.4:1 / 12.0:1.
- **C.** As A, with "Planned break" in place of "Rest week". Measures: 5.9:1 / 6.4:1.

The page also draws today's grid for comparison. The past rest week reads "Paused" with no reason.
With only the Paused rule dropped, it would read "0 of 0", underlined as met.

## Decision

Picked by John on 2026-11-19:

1. **A**, "A. Two buttons (Recommended)". Recorded as K168.
2. **A**, "A. \"Paused until\" leads (Recommended)". Recorded as K169.
3. **A**, "A. \"Rest week\" (Recommended)". Recorded as K170.

The "Ended" wording note (both pages say the last day) goes with K168.

## Rounds

- **1, 2026-11-19:** the first options, from #87, #90 and #91.
