The screen Claude sends you to when it asks to connect to your tracker: the sign-in card with a warning, who is asking and where it goes back to, your email and password, what the app may do, then Cancel and Connect.

## Use

- **Where:** `#/connect/<id>`, the address the API's `/api/oauth/authorize` sends the browser to. It is a link route, like a confirm or reset link: it shows signed in or signed out, nothing else on screen, and signing out in another tab doesn't drop it. The id is the pending request's; it lives ten minutes and works once.
- **Layout:** the sign-in card exactly (AuthCard: the Panel on `canvas`, at most 384px wide, the wordmark at 32px, the `title-1` heading), in this order:
  1. **Title:** "Connect Claude", with the app's own name from its metadata ("Connect Claude Code").
  2. **The warning first,** an InlineMessage in the caution tone: "Only continue if you just asked Claude to connect to your tracker. If you didn’t, choose Cancel."
  3. **Who is asking,** a two-line `dl` between two `line` rules, the terms in `ink-secondary` and the values in weight 600: **Asking** "Claude, from claude.ai" (the app's name and the host of its `client_id`), **Then back to** "claude.ai" (the redirect's host; a loopback redirect, as Claude Code's, reads "this computer (localhost)").
  4. **Email** (a TextField, filled with the signed-in account's email) and **Password**, empty. Signed in, the password's hint says why it is asked: "You’re signed in, but connecting an app asks for your password again."
  5. **What Claude can do,** a RadioCard with a line each: "Read only" ("See your plans, marks and notes.") and "Read and change" ("Also mark days, and add and edit items."). Read only is chosen every time the screen opens, whatever the app asked for.
  6. **Cancel** (secondary) and **Connect** (primary), side by side, each half the width.
  7. A `caption` footnote in `ink-secondary`: "The connection lasts 90 days. You can remove it sooner in Settings › Connections."
- **Connect** sends the email, the password and the choice; the API checks the password (the sign-in lockout counts it), and the browser goes back to the app. It never signs you in or out here. **Cancel** tells the app no, and the browser goes back to it too.
- Connected apps are listed, and removed, in Settings › Connections (ConnectionsSection).

## States

| State | Look |
| --- | --- |
| Loading | the card titled "Checking the link…", nothing else |
| Signed out | as above, Email empty, no hint under Password |
| Signed in | Email filled, the hint under Password |
| Wrong email or password | both fields `aria-invalid`, then an error InlineMessage under them: "Wrong email or password. Check them and try again." Focus returns to Password. |
| Too many tries | "Too many attempts. Try again in 15 minutes." (the sign-in lockout's words) |
| Too many connections | "You have ten connections, the most there can be. Remove one in Settings › Connections, then try again." |
| Busy | Connect reads "Connecting…" (Cancel, "Cancelling…"), `aria-busy`, full colour; a second press does nothing |
| Expired | the card titled "This link has expired": "It was already used, or it’s more than ten minutes old. Go back to the app and connect again.", then "Go to the week" (signed in) or "Go to sign in" (signed out). No form. |
| Can't check | offline or a server fault while loading: "Couldn’t check the link", the reason, and "Try again" |

## Accessibility

- One `<h1>`, the card's title; the card is a `<section>` labelled by it, inside the page's `<main>`.
- The warning is `role="status"` and comes before the form, so it is read first.
- One error message covers both fields (the server doesn't say which was wrong): each field is `aria-invalid` and `aria-describedby` the message, which is `role="alert"`.
- The choice keeps RadioCard's keyboard: Tab to the chosen row, arrows to move and choose.

## You provide

The request's id; from the API, the app's name, its host and the redirect host; the signed-in email, if any; the approve and deny calls, each of which answers with the address to go back to.
