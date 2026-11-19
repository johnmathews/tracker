A change to a running programme in two steps on the Dialog: the change first, then what it does to each week, and nothing happens until Confirm change.

## Use

- **Where:** every change to a programme from the app (spec §7). A later week's cell in the ProgrammeGrid opens it with **Change from here** (from that week's Monday) or **Edit this week** (That week only). The activity's controls on its item page open it too (ProgrammeChart: Set weight, Set increase, Pause activity, End activity), from today, as do the overview's Pause programme, Go to week and Add activity.
- **The Dialog card, nothing new** (K144): its scrim, panel, head with Close, sizes and focus rules, at the page's size, and 16px from each edge on a phone. One sheet at a time.
- **Two steps** (K144), and the plan too (K148). The first line of each, above the title, says which: "Step 1 of 2", "Step 2 of 2", in `caption` weight 600, `ink-secondary`.
- **The title** names the activity or the programme: "Change Barbell row", "Change Beginner 5×5".
- **Step 1, the change:**
  - **Change:** what to change, a Menu whose trigger is shaped like a field (its value, then Lucide `chevron-down`): Set weight, Set increase, Pause activity, End activity, and the programme's changes when opened from the overview. The value control is named for the field (Set weight, Set reps, Set time), as the activity's controls are.
  - **The value,** a TextField labelled with the field and its unit ("Weight in kg"), with the value in force on the from day under it as a hint ("Week 5 is 40 kg now.").
  - **From:** a date, a field-shaped button with Lucide `calendar`. The hint says the rule: "Today, Wed 16 Dec, or any later day." A past day can't be picked (spec §8).
  - **For:** a SegmentedControl, **From then on** or **That week only** (a hand-edit, spec §7.2), for a value.
  - **Reason,** a TextField, with the hint "It shows in Changes."
  - **Actions:** Cancel, and **Preview change** (primary). Preview change sends the change as a preview (spec §7.3).
  - The value and the from day sit side by side where the sheet is wide enough (at least 260u each), one over the other on a phone.
- **Step 2, the preview:**
  - **The change in a sentence,** on a `tile` (`radius-sm`, 12px by 14px of padding), with the reason after it in italics: "Weight 45 kg from Mon 21 Dec, from then on. *Rows feel light.*"
  - **What changes** (`label`, weight 600), over a rule: one line per changed week, the week in weight 600 with its dates under it in `caption` `ink-secondary` (", deload" after them for a deload week), and at the right "40 → 45 kg": the old value in `ink-secondary` at 400, the new one in `ink` at 600. Only the weeks that change are listed.
  - **A hand-edit that blocks the change** (spec §7.2, S5): Lucide `pencil` (18px, `ink-secondary`) and "Week 6 keeps the 35 kg set on 12 Dec.", with a small secondary Button, **Drop it too**. Pressed, week 6 joins the list and the line reads "The 35 kg set by hand on 12 Dec goes too.", with **Keep it**. Each press asks the server for a fresh preview.
  - **An activity that ends short** because of the change gets the overview's InlineMessage (info) line under the list: "Deadlift ends at its week 6 of 8, because of its pause."
  - **The line that calms**, in `caption` `ink-secondary`: "Nothing before Mon 21 Dec changes." For That week only: "Weeks 6 to 8 stay as they are. Nothing before Mon 21 Dec changes."
  - **Show it in the plan** (K148), a TextLink in `body` under the calm line. It puts the sheet away and shows the overview with the change in its cells and a bar at its foot, with Back to the change and Confirm change (ProgrammeGrid, Previewing a change). Back to the change brings the sheet back at step 2, as it was.
  - **Actions:** **Back** (secondary, Lucide `chevron-left`), which returns to step 1 with everything as entered, and **Confirm change** (primary), which applies the change with the preview's `rev`.
- **Closing** (Close, Escape, the scrim, Cancel) at either step changes nothing.
- The sheet doesn't print.

## Re-open, Restart and Cancel the end (K168)

The overview's controls on an ended run, and on one with an end set for a later day, open the same sheet with their own fields and preview (the run sheet). The look is the ChangeSheet's: the Dialog's panel, the step line, the sentence on a `tile`, a list under its `label` heading, the calm line, Back and a primary confirm.

- **Re-open programme** (Lucide `play`), only on a run End programme stopped part way (the run's `canReopen`). Title "Re-open Beginner 5×5".
  - **Step 1:** **From**, a date, today by default ("Today, Wed 16 Dec, or any later day."), and **Reason** ("It shows in Changes."). Cancel and **Preview** (primary).
  - **Step 2:** "Carries on from Wed 16 Dec, at week 4. _Knee is better._" Then **What it does**: Carries on ("At the week it stopped in", "Wed 16 Dec, week 4"), Paused ("The days since it ended count as a pause", "Mon 14 to Tue 15 Dec", or "No day"), Last day ("Week 8, as planned", "Sun 17 Jan"). The calm line: "Nothing before Mon 14 Dec changes." Back and **Re-open programme**.
- **Restart from week 1** (Lucide `rotate-ccw`), on every ended run. Title "Restart Beginner 5×5".
  - **Step 1:** **Name**, the tracker's own to start with ("The new tracker’s name."), and **Starts**, a date, today by default. Cancel and **Preview**.
  - **Step 2:** "A new Beginner 5×5, from week 1 on Mon 21 Dec." Then New tracker ("Beginner 5×5"), Week 1 ("21–27 Dec"), Last day ("8 weeks", "Sun 14 Feb"), and, for a run still going on the new start, The run now ("Ends Sun 20 Dec"). The calm line: "This run has ended and stays as it is, with its weeks, marks, notes and changes." Back and **Restart programme**. A confirmed restart opens the new tracker's overview.
- **Cancel the end** (Lucide `undo-2`), in End programme's place on a run with an end set for a later day. One step and no fields: a re-open can only be from the end's own day. Title "Cancel the end of Beginner 5×5". It asks for the preview as it opens: "Carries on past Sun 27 Dec, as planned.", the same three rows ("Mon 28 Dec, week 6", "No day", "Sun 17 Jan"), "Nothing before Mon 28 Dec changes." Then **Keep the end** (secondary, closes) and **Cancel the end** (primary).
- Every day, week and last day is the server's preview's (P4). Nothing changes until the confirm, which sends the preview's `rev`.

| State                                                   | Look                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Step 1                                                  | The fields, Cancel and Preview                                                                                 |
| Step 2                                                  | The sentence, What it does, the calm line, Back and the confirm                                                |
| Cancel the end                                          | No step line; while its preview comes, the confirm is busy and disabled                                        |
| A field the server refuses                              | Its TextField's error line on step 1; any other problem in an InlineMessage (error) over the actions           |
| The run changed since the preview (409)                 | The fresh preview, with "The plan changed since this preview. Check it, then confirm." Nothing is applied      |
| The run can't be re-opened any more (409 `cant-reopen`) | "This programme changed since its page opened, so it can’t be re-opened now." The overview reads the run again |
| Offline                                                 | The sheet doesn't open: the overview's controls are disabled                                                   |

Accessibility as the ChangeSheet's: described by the step line, or, for Cancel the end, by a visually hidden "Nothing changes until you cancel the end."; focus on the first field (From, Name), on the sentence after Preview, and on the sentence once Cancel the end's preview arrives.

## States

| State | Look |
| --- | --- |
| Step 1 | The fields, Cancel and Preview change |
| Step 2 | The sentence, What changes, the hand-edit line if one blocks, the calm line, Show it in the plan, Back and Confirm change |
| Hand-edit kept | "Week 6 keeps the 35 kg set on 12 Dec." and Drop it too; week 6 not in the list |
| Hand-edit dropped | Week 6 in the list ("35 → 47.5 kg"); "The 35 kg set by hand on 12 Dec goes too." and Keep it |
| That week only | One week in the list; no hand-edit line |
| Previewing or confirming | The pressed button keeps its label and gets `aria-busy="true"` (Dialog, Busy) |
| A field the server refuses | The field's TextField error line, on step 1, and the sheet stays open with what was entered |
| The plan changed since the preview (409, a stale `rev`) | Step 2 shows the fresh preview the server sent back, with an InlineMessage (info) above the actions: "The plan changed since this preview. Check it, then confirm." Nothing is applied |
| Offline | The sheet doesn't open: the controls that open it are disabled (ProgrammeGrid, Offline) |

## Accessibility

- The Dialog's: `role="dialog"`, `aria-modal`, labelled by the title, and described by the step line, so a screen reader hears "Step 1 of 2" with the title. Focus is trapped, Escape closes, and focus returns to the cell or button that opened it.
- On open, focus moves to the first field (the Change menu). **Preview change** moves focus to the sentence at the top of step 2 (`tabindex="-1"`), so it is read first. **Back** moves it to the value field. **Drop it too** and **Keep it** keep focus on the hand-edit's button.
- The Menu and the date are buttons named by their label and value ("Change, Set weight"); each hint is tied with `aria-describedby`.
- The preview is a list under its own heading ("What changes"), so a screen reader can count the weeks.
- Contrast, measured by the gate in both themes: `ink` and `ink-secondary` on `panel` and on `tile`, `on-ink` on `ink`, `control-border` and `focus` on `panel`.

## For the app

`src/components/ui/change-sheet/` (W7), on the app's `Dialog.vue`. Test ids, as in the preview:

| Element | Test id |
| --- | --- |
| The sheet | `change-sheet` (with `data-step="1"` or `"2"`) |
| The step line | `change-step` |
| Close, Cancel | `change-close`, `change-cancel` |
| The fields | `change-kind`, `change-value`, `change-from`, `change-scope`, `change-reason` |
| Preview change, Back, Confirm change | `change-preview-button`, `change-back`, `change-confirm` |
| The sentence | `change-summary` |
| The list, a week | `change-preview`, `change-preview-week` (with `data-week`) |
| The hand-edit | `change-hand-edit`, `change-drop-hand-edit`, `change-keep-hand-edit` |
| The calm line | `change-unchanged` |
| Show it in the plan | `change-show-in-plan` |

The run sheet is `RunActionSheet.vue` in the same folder (K168):

| Element                                  | Test id                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| The sheet                                | `run-sheet` (with `data-action`: `reopen`, `restart` or `cancel-end`, and `data-step`) |
| The step line, Close, Cancel             | `run-step`, `run-close`, `run-cancel`                                                  |
| The fields                               | `run-from`, `run-reason`, `run-name`, `run-start`                                      |
| Preview, Back, the confirm, Keep the end | `run-preview-button`, `run-back`, `run-confirm`, `run-keep`                            |
| The sentence, the list, a row            | `run-summary`, `run-preview`, `run-preview-row`                                        |
| The calm line, the stale line, errors    | `run-unchanged`, `run-stale`, `run-error`                                              |

## You provide

The activity or programme it changes and the changes it offers; the field and unit for a value, and the value in force on the from day; today's date from the server (the first day the from date allows); the opening values (the change, the from day, That week only for Edit this week). For step 2, the server's preview: the sentence, the changed weeks with their dates and before and after, the blocking hand-edits with their week, value and the day they were set, any activity that ends short, the from day, and the `rev` that Confirm change sends back.
