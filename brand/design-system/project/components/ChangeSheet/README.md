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

## You provide

The activity or programme it changes and the changes it offers; the field and unit for a value, and the value in force on the from day; today's date from the server (the first day the from date allows); the opening values (the change, the from day, That week only for Edit this week). For step 2, the server's preview: the sentence, the changed weeks with their dates and before and after, the blocking hand-edits with their week, value and the day they were set, any activity that ends short, the from day, and the `rev` that Confirm change sends back.
