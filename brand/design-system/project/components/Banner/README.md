A full-width bar above the week that says how the data stands with the server, or that the account's email is not confirmed yet, in words, with the one action that helps.

## Use

- One live region (`aria-live="polite"`), always in the page, under the Header; a banner appears inside it only when there is something to say. Nothing prints.
- Layout: a 20px Lucide icon, a short lead in weight 600, then one sentence in `body`; the action (a secondary or quiet Button, sm (36px) on desktop, md (44px) below 640px) at the right, wrapping below on a phone. `radius-md`, padding `space-2` to `space-4`.
- **Offline** (neutral): `tile` fill, 1px `line` border, `cloud-off` icon, `ink` text, a "Retry" button. "Not synced. Your changes are saved on this device and will sync when you're back online."; with nothing waiting, "Offline. Showing the data saved on this device."; before the first load, "Can’t reach the server. This device has no saved copy of your data yet."
- **Lost change** (error tone): `panel` fill, 1px `error-ink` border, `circle-alert` icon and lead in `error-ink`, the sentence in `ink`, a "Dismiss" button. Conflict: "Your change wasn’t kept. A plan was changed on another device, so this device now shows that version." Refused: "Your change wasn’t saved. The server refused it, so it was undone here. Reload to see what was saved."
- **Email not confirmed** (neutral, under the sync banners, in its own live region): `mail` icon, lead "Confirm your email.", then "The link is in the email sent to sam@example.com." and a "Send it again" button (busy: "Sending…"). Once a new link is sent the sentence becomes "A new link is on its way to sam@example.com." and the button goes; a refusal takes the sentence's place ("Can’t send another email yet. Try again in one minute."). It shows only while the planner sends email and the account was created with an email; it goes for good once the link is used. Neutral, because nothing is wrong.
- **A new connection** (neutral, no icon, at the top of Settings › Connections, in its own live region; ConnectionsSection): while an app connected in the last 24 hours is listed, "**Claude was connected just now**, with read only. If that wasn’t you, remove it and change your password." (the app's name in weight 600, then its access), with two buttons, "Remove" (asks first) and "Dismiss". Dismissed, it stays away in that tab.
- Loading needs no banner unless it is slow; then "Loading your data…" in the neutral style without an icon.
- Not for form errors (InlineMessage) or anything the person just did on purpose.

## States

- Retry busy: the button keeps full colour, reads "Retrying…" and is `aria-busy="true"`.
- Focus on its buttons: a solid 2px `focus` outline at 2px offset.
- Offline banners clear themselves when sync resumes; error banners stay until dismissed; the email banner stays until the email is confirmed.

## You provide

- `tone` (`neutral`, `error`), `icon`, `lead`, the sentence, and the action's label and handler.
- Copy from the sync store. The app's "Offline. 2 changes will sync when the connection is back." becomes the "Not synced…" line above (with a count, "Two changes are saved on this device…"), and its notices gain the lead that says what happened to the person's change.
