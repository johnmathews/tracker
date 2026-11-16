A link in `ink` with a visible underline, for going somewhere rather than doing something.

## Use

- `ink` text, a 1px underline at 3px offset, in the size of the text around it (`body` or `caption`). Inside an `ink-secondary` caption the link stays `ink`, so it reads as the one thing to press.
- For navigation and help: "Go to sign in" on its own line under "This link has expired or was already used. Ask for a new one." and at the foot of the create-an-account and reset-your-password cards; "Forgot your password?" on its own line under the sign-in form (only where the planner sends email); "Create an account" after "New here?" at the foot of the sign-in card; "Go to the week" (or "Go to sign in", signed out) under "Email confirmed" and under an expired confirm link; a link to the privacy page. Actions that change data are Buttons.
- The underline is the cue, not the colour: never remove it, never colour a link `pen` or `focus`.
- Write the destination as words ("Go to sign in"), never "click here" or a bare URL.

## States

- Hover: the underline thickens to 2px. No colour change.
- Focus: a solid 2px `focus` outline at 2px offset around the words.
- Visited links look the same as unvisited ones.
- There is no disabled link: if the destination is not available, show plain text.

## You provide

- The words and the `href` (or a router target). The words alone must say where the link goes.
- For an external page, open it in the same tab; if a new tab is unavoidable, say so in the words ("opens in a new tab").
