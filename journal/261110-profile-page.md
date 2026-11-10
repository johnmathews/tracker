# A profile button and a Profile page (K106, K107)

John: "lets put a profile icon in the right of the navbar. from there a user can signout and can
access a \"profile page\" which will let a user write down their general goals and constraints."

My goals already existed in Settings, and Ask and the MCP's `goals` tool already read it. So John
chose to move it to the new page and add a second note beside it, rather than keep two places
for similar text. He picked option A in the mockup (`261110-profile-menu`): a BarAction named
"Profile", because every action in the bar has a name (K47).

- **The bar** ends with "Profile" (`circle-user-round`). It opens a new Menu component (a card
  first, then `src/components/ui/menu/` on Reka UI's DropdownMenu): "Signed in as" and the email,
  then "Profile" and "Sign out".
- **The Profile page** at `#/profile` uses the Settings page's frame. It has Account (who is
  signed in, Sign out), Your goals and Your limits ("What you have to work around"). Each note
  holds up to 1,000 characters and saves when typing pauses.
- **Settings** keeps Appearance, Daily goal (now a section of its own), Your data and
  Connections.
- **The limits note** runs everywhere My goals does:
  - a `limits` column (migration 15);
  - `PUT /api/settings`, export, import (filling only empty notes) and the sync store's
    `limitsKnown`;
  - Ask's first message (`<my_limits>`) and the MCP `goals` tool.
- **Fixed F1:** the old hint said only Ask reads My goals, but the MCP returns it too. The new
  hints say "Ask and your Claude connections read this".
- **The Menu is not modal and renders in place.** In Reka's default modal mode, axe flagged the
  page behind as hidden but still focusable. A menu portalled to `<body>` also sat outside every
  landmark. On the week, focus moving into it would have slid the keyboard-floated bar away, since
  the bar shows only while focus is inside it.

## What was observed

- Confirmed:
  - 1,390 web unit tests and 1,261 API tests passed, with coverage at the floors (98.02% branches
    on the web, 99% on the API).
  - Lint, types, the build, the tokens check and the design-system gate passed.
  - All 102 Playwright tests passed, including axe on the open menu and the Profile page in both
    themes, and the menu and page at 375px.
- Confirmed: Chromium screenshots show the open menu under its button in Edit plan (desktop and
  phone) and over the week from the keyboard.
- Not yet observed: John on his own machine, and the deploy.
