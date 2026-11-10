# A profile button in the bar, and a Profile page

**Question:** how does the profile button at the right end of the bar look? Both options open the
same menu (who is signed in, Profile, Sign out). The Profile page is one proposal for comment. The
week, the bar's other actions and Edit plan stay as they are.

**Status:** decided (2026-11-10)

**Link:** https://claude.ai/artifact/B9yrn71KKerSMU6xFmnQTN (private)

`profile.js` and `profile.css` draw the bar in Edit plan with the button and its menu, and the
Profile page on the Settings page's frame. New values are `--candidate-*`.

## Settled before the mockup

John answered these on 2026-11-10, before the first round:

- My goals moves from Settings to Profile, and Profile adds a second box for constraints. Ask and
  the MCP read both.
- Settings › Account (who is signed in, Sign out) moves to Profile.
- Settings keeps Appearance, Daily goal (its own section now), Your data and Connections.

## Options

1. **The profile button.**
   - **A. A BarAction named "Profile":** Lucide `circle-user-round` over its name, the size of
     Settings, last in the bar. (Recommended: every action in the bar has a name, K47.)
   - **B. The initial in a ring:** the account's first letter in the serif, in a round button
     max(44px, 56u) wide, after a `line` hairline, with no name ("Profile" for screen readers).
2. **The Profile page (one proposal):** Back to the week, "Profile", then Account (Signed in as,
   Sign out), Your goals ("What you're working towards") and Your limits ("What you have to work
   around"), each up to 1,000 characters and saved when typing pauses.

## Decision

John picked on 2026-11-10, in one round: **A** (a BarAction named "Profile", K106), and the
Profile page "as drawn" (K106, K107). Both are the recommended options.

## Rounds

- **1, 2026-11-10:** the first options, from John's request and his answers on My goals and the
  Account row.
