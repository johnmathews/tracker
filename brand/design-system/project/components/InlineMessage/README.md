A one- or two-line message next to the thing it is about, in one of four tones, always an icon and words together.

## Use

- `caption` text with a 16px Lucide icon, `space-2` apart, no box and no fill. It sits `space-2` below the field, button row or setting it concerns.
- **Error** (`error-ink`, `circle-alert`, `role="alert"`): something failed and needs the person. Say what happened, then what to do: "Can’t reach the server. Check the connection and try again."
- **Caution** (`caution-ink`, `triangle-alert`, `role="status"`): a caution the person should notice, always with the words. Nothing on the planner uses it since the Picked row went (K28); the consent screen's warning does (K73). Never for errors.
- **Success** (`ink`, `check`, `role="status"`): something finished that the person may not see otherwise: "Added to your account…", "Imported." Never `pen`: pen means a done session, not a done task. Never celebrate.
- **Info** (`ink-secondary`, `info`, `role="status"`): a neutral fact: "Nothing new: everything in that file is already here."
- For errors on a single field, TextField's own error line is this component; tie it with `aria-describedby`. A form-level error (one message for several fields, such as "Wrong email or password. Check them and try again.") is this component placed once below the fields, each field `aria-invalid` and described by it. For connection and sync state across the app, use a Banner.

## States

- Appears and disappears without motion. Error and caution stay until their cause is gone; success and info may clear on the next action.
- The live role is on the message element itself: `role="alert"` for an error, which interrupts, and `role="status"` for caution, success and info, which wait their turn. The message is added with its words in it, so an error is read out as it appears.

## You provide

- `tone` (`error`, `caution`, `success`, `info`) and the words. No exclamation marks, no blame, small numbers as words.
- The app's "That file isn’t a Tracker export." becomes "That file isn’t a Tracker export. Choose a file made with Export."; "The server refused the import, so nothing changed." gains "Try again, or export a fresh file."
