A modal panel for one focused task, such as editing an exercise or a food, over a dimmed page.

## Use

- **Scrim:** a full-viewport layer filled with `scrim` at 40% opacity. Put the opacity on the layer, never on the colour (no `color-mix`, no rgba), so the token stays the one source. The scrim appears only behind a dialog.
- **Panel:** `panel` fill, 1px `line` border (in dark there is no shadow, so the border is the edge), `radius-lg`, `shadow-overlay` (none in dark, where `panel` does the lifting). **At the page's size (K55):** max(24px, 32u) padding (`space-4` below 640px), at most max(416px, 720u) wide and 16px from each screen edge on a phone, so a dialog matches the full-size pages behind it.
- **Head:** the title in `title-2` at the page's heading size, max(22px, 27u), sentence case ("Edit exercise", "Add exercise"), with a Close IconButton (Lucide `x`) at the row buttons' size, max(44px, 52u) with a 28u icon, at its right.
- **Sizes inside:** the Settings page's (main.css's `--set-*`): labels and text 19u, fields, segments, Steppers and buttons 60u tall (48px folded), max(16px, 20u) between fields; the field's own cards keep their shapes and colours.
- **Body:** fields with visible labels above them (TextField, and SegmentedControl as its card, `label` type on every segment, single choice with `aria-pressed`), at the sizes above. Fields are not marked optional or required; an empty field that means something says so in its placeholder: "Weight in kg" shows "Bodyweight". Edit exercise reads, in rows: Name; Sets, **Measure** (Reps, Time) and the amount ("Reps", or "Seconds" once Time is chosen); **Reps count** ("Timed" for Time), Weight in kg and **Times a week**, the goal, as a Stepper from 0 to 7; then **Note** last, a TextArea for the item's markdown notes (K43), its hint "Markdown works: **bold**, *italic*, links.", up to 20,000 characters, with the TextArea's count from 19,000 ("19,620 of 20,000 characters"). The Note is the item's own, the same on every week (its details, K64); every other field edits this week's plan. Notes the server can't store (over 32 KB, which some scripts reach under 20,000 characters) show the TextArea's error, "These notes are too long to save. Shorten them, then save again.", and nothing is saved. That order lets the form fit a 1920×1200 screen at the page's size (K55); a row wraps where it is too narrow. Edit food reads: Name; **Times a week**, the same Stepper; then Note. **Add exercise** and **Add food** (K54) are the same dialogs with nothing to edit: the fields start empty (the goal at 3), and the primary action says what it does, "Add exercise" or "Add food", in place of Save.
- **Actions** at the end, right-aligned: secondary "Cancel", then primary (`ink` fill, K8) with a verb: "Save". They wrap rather than shrink.
- One dialog at a time. For a yes-or-no question use ConfirmDialog; for a small panel attached to a control use Popover.
- The dialog doesn't print.

## States

| State | Look |
| --- | --- |
| Open | scrim fades in, panel appears; no slide, scale or bounce. Under `prefers-reduced-motion` it appears at once. |
| Error on save | an InlineMessage (error) above the actions; the dialog stays open with the person's input |
| Busy | the primary button keeps its label and gets `aria-busy="true"` |

## Accessibility

- Built on Reka UI's Dialog (K1), as the app's `Dialog.vue` is: the panel is `role="dialog"` with `aria-modal="true"`, `aria-labelledby` pointing at the title (an `h2`), and `aria-describedby` pointing at the description when there is one (none otherwise). The scrim is Reka's overlay, `scrim` at 40% on the layer.
- On open, focus moves to the first field, not the Close button before it. Focus is trapped: Tab and Shift+Tab stay inside the dialog. Escape, the Close button and a click on the scrim close it.
- On close, focus returns to the control that opened it: the trigger, or whatever had focus when the dialog opened from code, also when the dialog mounts already open (an Edit button that shows the dialog with its item).
- While it is open, the page behind is hidden from assistive technology and takes no pointer input.
- Every field has a `<label>`; a hint is linked with `aria-describedby`.
- The focus ring is a solid 2px `focus` outline at 2px offset; `focus` and `control-border` on `panel` are measured by the gate.

## You provide

The title (and, when it helps, a short description under it), the content (usually a form), the primary verb and its handler, and how it opens: a trigger control, or `v-model:open` from code. The dialog finds the element to return focus to by itself.
