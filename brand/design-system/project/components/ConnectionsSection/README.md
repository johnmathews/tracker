Settings' Connections row: the address to give Claude with how to connect claude.ai and Claude Code, then the apps connected by signing in and the tokens you made, each with a line of facts and Remove.

## Use

- **Where:** a row of the Settings page (SettingsPage), between Your data and Account, in the page's grid and sizes: "Connections" in the 320u heading column, the contents to the right, folded to one column like the other rows.
- **Contents, in order** (from `ConnectionsSection.vue`):
  1. **The new-connection Banner,** only while an app connected in the last 24 hours is listed and not dismissed in this tab: "**Claude was connected just now**, with read and change. If that wasn’t you, remove it and change your password." with Remove (asks first) and Dismiss.
  2. **The lede** in `ink-secondary`: "Let Claude or ChatGPT read your weeks and, if you allow it, mark days and edit your plans."
  3. **The address,** a copy tile: a `tile` box with a `line` border and `radius-md`, the address (`https://tracker.itsa-pizza.com/api/mcp`, from the page's own origin) in the monospace face, and a secondary "Copy" button (`copy`) at the right that reads "Copied" (`check`) for a moment once done.
  4. **How to connect,** three short paragraphs in `ink-secondary`, each led in `ink` weight 600: "**Claude (claude.ai, desktop and phone):** in Claude’s Settings › Connectors, choose Add custom connector and paste this address. Claude opens this page to ask for your password." and "**Claude Code:** run `claude mcp add --transport http tracker https://…/api/mcp`, then `/mcp` to sign in. Or use a token below." and "**ChatGPT (on the web):** in ChatGPT’s Plugins, choose + then Add custom MCP server, paste this address and choose OAuth. ChatGPT opens this page to ask for your password." The commands are in the monospace face.
  5. **Apps,** a sub-heading (`h3`, weight 600 at the label size), the line "Connected by signing in from Claude or ChatGPT. Each lasts 90 days.", then a list: each app a row between `line` rules, its name in weight 600 with "· claude.ai" in `ink-secondary`, a line of facts under it ("**New** · Read and change · connected 3 Nov at 14:02 · last used today at 14:05 · ends 1 Feb"; "New" only in the first 24 hours, in `ink` weight 600), and a secondary "Remove" at the right. None: "No apps are connected."
  6. **Tokens,** a sub-heading, the line "For Claude Code, Claude Desktop and scripts. A token works until you remove it.", then a list of the same rows: the name, then "`trk_Xq7mPa2L…` · Read only · created 24 Oct · last used 2 Nov" (the prefix in the monospace face; "never used" until it is). None: "No tokens yet." Then a secondary "Create token" (`plus`).
- **Create token** opens a form in its place: Name (a TextField, up to 64 characters) and Access (a SegmentedControl, "Read only | Read and change", Read only chosen), then Cancel and a primary "Create token" ("Creating token…" while busy).
- **Shown once:** a created token appears above the list, which gains its row: "Copy your new token now. It won’t be shown again." in weight 600, the token in a copy tile, "Give it to the app as a header: `Authorization: Bearer trk_Hn3vY8sE…`", and "Done", which hides it for good.
- **Remove** asks first, with a ConfirmDialog naming the thing. A token: "Remove Laptop?", "Anything using this token stops working at once. You can create a new one.", Remove. An app: "Disconnect Claude?", "Claude can’t reach your tracker any more, from now on. You can connect it again from Claude.", Disconnect. The row goes when the server agrees.
- Dates are short and local: "today", "yesterday", "24 Oct", with the year when it isn't this one; an app's connected time is "3 Nov at 14:02".

## States

| State | Look |
| --- | --- |
| Loading | the address and how to connect show at once; the lists appear when the server answers |
| Listed | both lists, each row with its facts and Remove |
| New connection | the Banner on top, "New" first in that app's facts |
| Empty | "No apps are connected." and "No tokens yet." |
| Creating | the form in place of Create token |
| No name | the Name field's error: "Give the token a name, like Laptop." |
| Too many tokens | an error InlineMessage under the form: "You have 20 tokens, the most there can be. Remove one you don’t use, then create this one." |
| Shown once | the box above the tokens, the new row at the top of the list |
| Copied | the button reads "Copied", and a status says so |
| Can't copy | "Couldn’t copy. Select the text and copy it yourself." |
| Can't list | an error InlineMessage: "Can’t reach the server, so your apps and tokens can’t be listed. Try again when you’re online." and Try again |
| Remove failed | the ConfirmDialog's error: "Can’t reach the server, so nothing was removed. Try again when you’re online." |

## Accessibility

- The row is a `<section>` labelled by its `h2`; Apps and Tokens are `h3`s, and each list is a `ul` labelled by its heading.
- Each Remove has a name that says which: "Remove Laptop", "Remove Claude".
- The Banner sits in its own `aria-live="polite"` region; the shown-once box takes focus when it appears, so the token is read first.
- After a removal, focus goes to the next row's Remove, or to the list's heading when none is left.

## You provide

The page's origin (for the address); from the API, the signed-in user's connections (`GET /api/connections`) and tokens (`GET /api/tokens`); the create and remove calls.
