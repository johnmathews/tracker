The Profile page, at `#/profile`: a link back to the week, the heading, then Account, Your goals and Your limits, each a section under its own heading (K106, K107).

## Use

- **Opening it:** "Profile" in the Menu under the Header's last BarAction, "Profile" (Lucide `circle-user-round`). Like the SettingsPage, the page has no Header (K52) and starts with its own link back to the week.
- **Layout:** the SettingsPage's frame, exactly: full width on the page's own 48u margins, every size from the PlannerScreen's `u` (main.css's `--set-*` sizes); a TextLink "Back to the week", the `<h1>` "Profile" in the `title-1` serif at 40u, then a row per section, its `<h2>` in the 320u left column and its content to the right, a 1px `line` rule above each. **Folded**, the heading sits over its content in one column at the system's sizes on `n`.
- **Contents, in order:**
  1. **Account:** "Signed in as" and the email in `body` `ink-secondary` (the email in 600 `ink`), and beside it a secondary Button "Sign out" (`log-out`), wrapping under the words when the row is narrow (K53). Sign out with unsent changes asks first with a ConfirmDialog; a refusal shows as an InlineMessage under the row.
  2. **Your goals:** a TextArea, "What you’re working towards", hint "Ask and your Claude connections read this. Nothing else does." (F1).
  3. **Your limits:** a TextArea, "What you have to work around", hint "Injuries, equipment, time and food. Ask and your Claude connections read this too."
- Both TextAreas are at most 900u wide, four rows tall, hold up to 1,000 characters each, have no placeholder, and save when typing pauses (600ms) or when the box loses focus. There is no Save.
- A box takes typing only once its note is known (read from the server or a cache that carried it, or a new account with nothing saved), so a stand-in never writes over a saved note (F1).
- Doesn't print.

## States

| State | Look |
| --- | --- |
| Arrived | focus on the `<h1>` (`tabindex="-1"`, no ring), so a screen reader starts at the top |
| A note not yet known | its TextArea disabled (40% opacity) until a read brings the note |
| Sign out refused | an InlineMessage (error) under the Account row: what happened and what to do |
| Sign out with unsent changes | a ConfirmDialog, "Sign out now?", with how many changes would be lost |
| Back to the week | the week as it was; focus on the Header's Profile button |

## Accessibility

- A real page: the hash changes, so the browser's Back works, and a `#/profile` address opens it directly.
- One `<h1>`, then an `<h2>` per section; each section is a `<section>` labelled by its heading.
- Each TextArea's label is always visible, and its hint is tied with `aria-describedby`.
- After the sign-out question closes without signing out, focus returns to Sign out.

## You provide

The signed-in email and the sign-out handler; the saved goals and limits, whether each is known, and their save handlers; the address of the week for the link back.
