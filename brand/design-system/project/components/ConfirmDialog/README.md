A small modal question before something that can't be undone: what will happen, then two buttons. It replaces every `window.confirm` in the app.

## Use

- A Dialog without a close button or fields: `panel`, 1px `line` border, `radius-lg`, `shadow-overlay`, on the `scrim` at 40%, at the page's size (K55): max(24px, 32u) padding, at most max(400px, 600u) wide, buttons 60u tall.
- **Title** in `title-2` at max(22px, 27u): the question, naming the thing ("Remove Push-ups?").
- **Body** in `body` at max(18px, 19u): the facts, briefly, then what stays. No "Are you sure", no warning icon, no capitals.
- **Buttons:** secondary "Cancel", then primary with the verb from the title ("Remove", "Sign out"). Never "OK" or "Yes".
- **No red button.** A destructive action still uses the `ink` primary (K8); the verb does the work. `error-ink` is only for errors.
- Ask only when something is lost. Importing a file only adds plans and marks ("Existing plans and marks stay as they are"), so it confirms inline in Settings, not here.

The app's two cases, rewritten in voice:

| Where | Today (`window.confirm`) | ConfirmDialog |
| --- | --- | --- |
| `TrackerRow.vue`, remove in Edit plan | "Remove Push-ups?" | **Remove Push-ups?** It comes off this week's plan. Weeks with their own plan keep it, and its marks stay. · Cancel · Remove |
| `ProfilePage.vue` and the profile Menu, Sign out | "2 changes haven't synced yet. Sign out anyway?" | **Sign out now?** Two changes on this device haven't reached the server yet. Signing out now loses them. · Cancel · Sign out |

Removing a food uses the first pattern ("Remove Fish?"). The removal touches only this week's plan and the weeks that follow it without a plan of their own; it never deletes the log.

## States

| State | Look |
| --- | --- |
| Open | focus on Cancel |
| Busy (signing out) | the primary keeps its label, `aria-busy="true"` |
| Failed | an InlineMessage (error) above the buttons, saying what happened and what to do |

## Accessibility

- `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby` on the title and `aria-describedby` on the body, so a screen reader reads both on open.
- Focus starts on Cancel, the safe choice; Escape cancels; focus returns to the control that asked.
- Built on Reka UI's AlertDialog (K1), which handles the focus trap and the inert page.
- `on-ink` on `ink` and `control-border` on `panel` are measured by the gate.

## You provide

The title (a question with the thing's name), the body, the verb, and the confirm and cancel handlers.
