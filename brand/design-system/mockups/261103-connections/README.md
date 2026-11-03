# Connections: claude.ai sign-in and your tokens

**Question:** how does the screen Claude sends you to ask what Claude may do, and how does
Settings list your connections and tokens? The sign-in card, the Settings frame and its other
rows stay as they are.

**Status:** decided (2026-11-03)

**Link:** https://claude.ai/artifact/YBb4piia1XFBAEKRRYH9F2 (private)

The page is live. `conn.js` draws both screens: the consent screen as the sign-in card
(AuthCard), and Settings on the shipped frame (`settings.css` and `icons.js`, copied from
`261101-ask-page`). `conn.css` adds what is new; the one new value is `--candidate-mono`, a
monospace face for tokens and addresses. `try.html` shows both full size, with a switch for the
screen, option, state and theme.

## Options

**1. The consent screen** (the sign-in card: warning, who is asking and where it goes back to,
Email, Password even when signed in, access, Cancel and Connect, the 90 days):

- **C1. A switch, “Allow changes”, off,** with a line saying what Claude can do in its current
  position. Recommended: read only is the safe answer, and one control says it is the default.
- **C2. Two RadioCards,** Read only (picked) and Read and change, each with one line.

**2. Settings › Connections** (a row between Your data and Account: the address with Copy, how
to connect claude.ai and Claude Code, then what is connected; Remove asks first; a new token is
shown once; a connection from the last day is marked New, with a banner):

- **L1. Two lists, Apps then Tokens,** each item a row with a line of facts and Remove beside
  it. Recommended: it reads like Settings and folds to a phone without change.
- **L2. One table** of apps and tokens: Name, Kind, Access, Since, Last used, Ends.

**3. Three short ones:** the token form's access control (SegmentedControl, or the consent
screen's); the monospace face; “New” for a day, with or without the banner.

States shown: consent signed in, signed out, wrong password, from Claude Code, an expired link;
Settings listed, new connection, empty, create, shown once, twenty tokens, the remove confirm.

## Decision

Round 1, 2026-11-03. John picked:

- **Consent:** C2, two RadioCards (Read only picked, Read and change).
- **Settings:** L1, two lists, Apps then Tokens.
- **Monospace:** yes, the system monospace for tokens, prefixes, the address and commands only.
- **New:** the mark and the banner, until dismissed.

Not asked, so the mockup's default stands: the Create token form chooses access with the
SegmentedControl (Read only | Read and change). The K entries are written with the build (W7) in
[decisions.md](../../../../docs/decisions.md).

## Rounds

- **1, 2026-11-03:** C1 and C2; L1 and L2; three short questions.
