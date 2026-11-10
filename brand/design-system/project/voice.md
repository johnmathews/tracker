## How Tracker writes

Plain, calm and brief, in the second person. Facts first, then the next step. The app is a record of someone showing up; the words never pretend the work is easier, more fun or more heroic than it is.

## Rules

- **Small numbers as words** in sentences: "Two of three. One to go." Figures in grids and totals.
- **No exclamation marks.** Nothing is that surprising.
- **No hype:** never "crushed it", "beast mode", "amazing", "awesome".
- **No guilt:** never "You missed 3 days". An empty box says it already.
- **No streaks**, scores or rankings, in words or numbers. Ask's answers are the one exception (see Ask).
- **Notes belong to the person.** The app never prompts for one and never quotes one back as advice. Ask's answers may (see Ask).
- **Errors say what happened and what to do:** "That password didn't match. Try again, or ask for a new invite."
- **Sentence case everywhere**, including buttons and labels. No uppercase eyebrows.

## Examples

| Instead of | Write |
| --- | --- |
| Great job! You crushed today's workout! | Three of three today. |
| You missed 2 days this week | Two of four this week. |
| Sync failed!! | Not synced. Your changes are saved on this device and will sync when you're back online. |
| Invalid link | This link has expired or was already used. Ask for a new one. (Then, on its own line, a "Go to sign in" link.) |
| Accounts are by invitation. | New here? Create an account ("Create an account" is the link, with no full stop after it) |
| Email address invalid | Enter an email address, like name@example.com. |
| Account already exists | There’s already an account for that email. Go to sign in. |
| Registration disabled | New accounts are closed for now. Ask whoever runs this planner for an invite. |
| Rate limit exceeded | Too many new accounts at once. Try again in 12 minutes. |
| Storage quota exceeded | Your account is full, so nothing was imported. |
| Quota exceeded (on a change) | Your change wasn’t saved. Your account is full, so it was undone here. Ask whoever runs this planner for more room. |

## Signing in and creating an account

Every account is an email: people who sign up type theirs, and an invite names one. The sign-in field is "Email". A failed sign-in names both and blames neither: "Wrong email or password. Check them and try again." The app never says "username". Creating an account asks only for an email and a password, twice; the button says "Create account", and the card's last line is a "Go to sign in" link. Where the planner sends email, the new account is signed in at once and gets one email, to confirm the address; the word is "confirm", never "verify". Until then a neutral banner over the week says "Confirm your email. The link is in the email sent to sam@example.com." with a "Send it again" button. A planner that sends no email says none of this.

"Forgot your password?" sits on its own line under the sign-in form, only where the planner sends email. Its card is "Reset your password": "Enter the email you signed up with, and a link to choose a new password goes there.", one Email field, and "Send link" ("Sending link…"). Afterwards it says the same whether or not there is an account, so it gives nothing away: "If there’s an account for sam@example.com, a link to choose a new password is on its way. It works for one hour."

The confirm link opens "Email confirmed": "Password resets for sam@example.com will reach you there." A used or expired one says "This link has expired or was already used. Sign in and choose “Send it again” for a new one." ("Choose “Send it again”…" to someone signed in).

## Email

The planner sends two emails, both in the EmailLayout card, both from "Tracker". The voice is the app's: plain, calm, second person, no exclamation marks.

- **Subject:** the one thing the email is for, with the app's name, in sentence case: "Confirm your email for Tracker", "Reset your Tracker password".
- **Heading, then one sentence:** what happened, and what the link does. "You created a Tracker account with this address. Confirm it, so a password reset can reach you here." "Someone asked to reset the password for sam@example.com. If it was you, choose a new one with this link." Someone, not you: the email can't know who asked.
- **One button,** a verb phrase: "Confirm email", "Choose a new password". Never "Click here".
- **How long the link works,** in words, and what using it does: "The link works for seven days." "The link works once, for one hour. Choosing a password signs you out on your other devices."
- **The link, written out,** under "If the button doesn’t work, paste this link into your browser:".
- **If it wasn't them,** last and without alarm: "If you didn’t create this account, you can ignore this email." "If you didn’t ask, ignore this email. Your password stays as it is."
- **No reply address.** Nobody reads replies, so no email asks for one, promises help, or signs off with a name.
- **Nothing else:** no tips, no marketing, no tracking pixels, no images.

| Instead of | Write |
| --- | --- |
| Verify your email address! | Confirm your email |
| Click here to reset | Choose a new password |
| This link expires in 60 minutes | The link works once, for one hour. |
| If you did not request this, please contact support | If you didn’t ask, ignore this email. Your password stays as it is. |
| Email sent! | A new link is on its way to sam@example.com. |
| Please wait before requesting another email | Can’t send another email yet. Try again in one minute. (It doesn't say why: a minute's gap, five a day, or the whole planner's hour.) |

## Ask

Ask's answers are an AI's, written to a ruling of John's (2026-11-01, K68): "V2 - plain verdict, the app may qote a note back as advice. and also may include streaks scores or rankings." So in an answer, and only there:

- **A plain verdict:** "A little too little for March." "Too much" when it is. Facts still come first, then one next step.
- **Goals and notes quoted back as advice:** "Your goal says “Ten pull-ups in a row by March”. One more rep a set every second week would get you there."
- **Streaks, scores and rankings** when they help answer the question: "Four weeks running at four days."

The rest of the rules hold in answers too: no exclamation marks, no hype, no blame ("Two of four this week", never "You missed two days"), small numbers as words, sentence case. The carve-out is for answers, not the app: the Ask page's own words, the previews and every other screen keep the rules above, and the gate still bans "streak" in previews. The prompt carries the ruling as `VERDICT_RULE` in `api/src/tracker_api/ask.py`.

The page's own words, from the mockup:

| Instead of | Write |
| --- | --- |
| Thinking… | Reading your weeks… |
| 3 questions remaining | Three questions left today (figures from four up: "27 questions left today") |
| Daily limit reached | No questions left today. Under the box: You can ask again from 09:14 tomorrow. |
| Network error | The answer stopped before it finished, because the AI service didn’t respond. Your question is kept. (Then a "Try again" button.) |
| You have unsynced changes | Two changes on this device aren’t synced yet, so the answer won’t include them. |
| Save failed: storage full | Your account is full, so this answer wasn’t saved. |
| Disclaimer: AI can make mistakes | Answers come from an AI and can be wrong. They aren’t medical advice. |

On the Profile page, Your goals is "What you’re working towards", with "Ask and your Claude connections read this. Nothing else does." under it, and Your limits is "What you have to work around", with "Injuries, equipment, time and food. Ask and your Claude connections read this too." With no goals, Ask says "Your goals in Profile are empty, so answers can only compare you with the times a week you set." and links "Add your goals". Deleting history asks first and names the thing: "Delete “Is my diet good enough?”?", Delete; "Delete all conversations?", Delete all.
