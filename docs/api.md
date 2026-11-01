# API

> Purpose
>
> The API service in `api/`: accounts, sessions, invites, email, the synced data, the admin CLI
> and backups. It is the reference for the endpoints the client calls and for running the service.

## 1. Overview

A FastAPI app on Python 3.13, served by uvicorn on port 8000 as one process. It stores everything
in SQLite at `$DATA_DIR/fitness.db` (WAL mode, foreign keys on). The web container's nginx forwards
`/api/` to it, so the browser sees one origin and the CSP stays unchanged. Every user's rows are
scoped by `user_id`, and no endpoint reads another user's data.

| Module        | Holds                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `config.py`   | `Config`, read from the environment (§6)                                                         |
| `db.py`       | connections, the schema and its migrations                                                       |
| `types.py`    | the tracker-type registry, the port of `src/lib/trackerTypes.ts`: sections, types, their fields  |
| `validate.py` | the port of `src/lib/storage.ts` and `src/lib/transfer.ts`; its sections come from `types.py`    |
| `auth.py`     | password hashing, lockout, sessions, sign-up and its caps, invite, reset and confirmation tokens |
| `outbox.py`   | which emails go out and when: the limits (§4.1), the links, the message                          |
| `emails.py`   | the two emails, built to the EmailLayout card, and that card's preview                           |
| `mail.py`     | the Resend client, and sending after the response                                                |
| `data.py`     | reading and writing plans, ticks, item details and settings; import, export; the quota (`usage`) |
| `app.py`      | the HTTP layer: routes, the write checks, error mapping                                          |
| `backup.py`   | the daily `VACUUM INTO` copy                                                                     |
| `cli.py`      | `tracker-admin`                                                                                  |
| `seed.py`     | `tracker-admin seed-demo`: a demo account, three weeks of marks and two items' details, locally  |

## 2. Data model

| Table           | Key                                 | Columns                                                                                                                                                                 |
| --------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`         | `id`                                | `username` (unique, case-insensitive; the lower-cased email for a signed-up account), `password_hash`, `disabled`, lockout counters, `created_at`, `email_confirmed_at` |
| `sessions`      | `token_hash`                        | `user_id`, `created_at`, `last_seen`, `expires_at`                                                                                                                      |
| `invites`       | `token_hash`                        | `kind` (`invite` or `reset`), `username`, `user_id` (resets), `expires_at`, `used_at`, `mailed` (a reset sent by email)                                                 |
| `confirmations` | `token_hash`                        | `user_id`, `created_at`, `expires_at`, `used_at`: confirm-your-email links                                                                                              |
| `mail_log`      | `id`                                | `user_id`, `kind` (`confirm` or `reset`), `sent_at`: one row per email attempted (a failed send still counts), for the limits                                           |
| `settings`      | `user_id`                           | `accent`, `daily_pick`, `food_pick` (K57), `item_sections` (JSON or NULL, K66)                                                                                          |
| `plans`         | `(user_id, section, week)`          | `items_json`, `rev`                                                                                                                                                     |
| `ticks`         | `(user_id, section, week, item_id)` | `days`, `partial`, `missed`, `solid`, `hatch`: 7-bit masks (bit 0 is Monday); see below                                                                                 |
| `item_details`  | `(user_id, section, item_id)`       | `details_json` (one document per item for every week: `{notes?, fields?}`), `rev`                                                                                       |

`section` is `exercise` or `diet`, the registry's sections (`types.py`). `plans` and `ticks` CHECK
it in the schema, so a new section there needs a table rebuild. `item_details` has no such CHECK:
the API checks the section against the registry. Every row cascades from its user. Tokens and session ids are
stored only as SHA-256 hashes. A database lookup with a stolen copy of the file cannot recover a
working cookie or link. Times are Unix seconds. The theme is not stored: it belongs to the device.

**Marks.** Each day of a tick row is empty or holds one mark: a kind (`great`, `partial` or
`missed`) in one of three drawings. The zigzag is the plain kind; the solid and the hatch add
theirs: `great-solid`, `missed-hatch` (K17). `days` has a bit for every marked day, so it alone
says which days count. `partial` and `missed` are disjoint subsets of it, and a day in neither is
`great`; `solid` and `hatch` are disjoint subsets too, and a day in neither is the zigzag.

The schema version lives in `PRAGMA user_version`, and `db.migrate` applies each step in order at
startup inside a transaction. Version 1 is the first six tables; version 2 adds `partial` and
`missed` (default 0), so every tick stored before marks had kinds reads as `great`; version 3 adds
email: `email_confirmed_at`, `mailed`, `confirmations` and `mail_log`. Every account from before
it starts unconfirmed. Version 4 adds `solid` and `hatch` (default 0), so every older mark reads as
the zigzag. Version 5 adds `food_pick` to `settings` (default 2), foods a day (K57).

Version 6 adds `item_details` and moves each item's note into it. Per user, section and item, the
note comes from the latest week whose copy of the item has a non-blank one, the first such copy in
that week, trimmed. It is stored as `{"notes": …}` at revision 1. Items without a string `id` and
`name`, ids outside 1 to 128 characters and `__proto__` are skipped, as the normalisers skip them.
The step finishes on any `items_json` and can run again over a table already there. Plans keep
their notes in `items_json` until each is next written, but nothing reads them: `stored_items`
drops `notes` from every plan it loads.

Version 7 adds `item_sections` to `settings`, nullable: each type's item-page arrangement (K66) as
compact JSON in `item_sections.py`'s normal form, or NULL for every page in the default order with
every section shown. Existing rows read as NULL.

## 3. Endpoints

All paths start with `/api`. Bodies are JSON, and errors are `{"error": "<code>"}`. Every response
carries `Cache-Control: no-store`.

**`X-Expected-User`.** A data request may name the user it expects; if the session belongs to anyone
else, it gets 401 `auth`. The client sends it on every read and write, so a tab left open as one
person can never touch the data of someone who signed in later in another tab.

**Writes** (`POST`, `PUT`) must send `Content-Type: application/json` and an `Origin` header equal
to `PUBLIC_ORIGIN`; otherwise they get 403 `origin` or 415 `content-type`. `SameSite=Lax` alone
would not stop a request from another `*.itsa-pizza.com` host, because the browser counts it as
same-site. Bodies over 1 MiB get 413 `too-large`, counted as they stream in, so a chunked body is
cut off at the limit rather than read whole. A body with nothing to send, such as logout's, is `{}`.

| Method and path                            | Auth    | Does                                                                                                           |
| ------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                             | no      | `SELECT 1`; `{"ok": true}`                                                                                     |
| `POST /auth/login`                         | no      | `{username, password}` → the account and the session cookie                                                    |
| `POST /auth/signup`                        | no      | `{email, password}` creates an account → the account and the cookie                                            |
| `POST /auth/logout`                        | session | ends this session and clears the cookie; 204                                                                   |
| `GET /auth/me`                             | session | the account: `{username}`, plus `confirmed` (below)                                                            |
| `GET /auth/options`                        | no      | `{mail}`: whether this API sends email (§4.1)                                                                  |
| `POST /auth/forgot`                        | no      | `{email}` → 202 `{}` for any well-formed email; a reset link goes to a matching account (§4.1)                 |
| `POST /auth/confirm`                       | no      | `{token}` confirms the email → the account; 410 `gone` otherwise                                               |
| `POST /auth/confirm/resend`                | session | a new confirm link → 202 `{}`; refusals in §4.1                                                                |
| `POST /invites/lookup`                     | no      | `{token}` → `{kind, username}` for a live link; 410 `gone` otherwise                                           |
| `POST /invites/redeem`                     | no      | `{token, password}` sets the password, consumes the link, signs in                                             |
| `GET /state`                               | session | everything the client renders (below)                                                                          |
| `PUT /plans/{section}/{week}`              | session | `{items, rev}` → `{rev}`; 409 `conflict` with the server copy                                                  |
| `PUT /ticks/{section}/{week}/{item}/{day}` | session | `{mark}` → `{days}`, the week's seven marks for that item                                                      |
| `PUT /details/{section}/{item}`            | session | `{details, rev}` → `{rev}`; 409 `conflict` with the server copy (below)                                        |
| `PUT /settings`                            | session | `{accent, dailyPick, foodPick, itemSections}` → the stored settings; a missing key keeps the saved one (below) |
| `GET /export`                              | session | the export file (`architecture.md` §4)                                                                         |
| `POST /import`                             | session | an export file, merged in; → `{weeks, ticks, details, settings}` added                                         |

**The account** is `{username}`: the account's email (the field keeps its old name, so older
tabs and clients work unchanged). While mail is on it also carries `confirmed`, true once the
address is confirmed. A legacy account still named by a username (below), and every account while
mail is off, has no such key.

`GET /state` returns `{exercise, diet, settings}`. Each section is
`{plans, log, details, revs, detailRevs}`:

- `plans` and `log` have the same shape as in the app's cache (a log row is seven marks or nulls).
  Plan items never carry `notes`.
- `details` maps each item id to its `{notes?, fields?}`, leaving out items whose details were
  cleared.
- `revs` maps each planned week to its revision, and `detailRevs` each item id to its details'
  revision, cleared ones included.

`settings` is `{accent, dailyPick, foodPick, itemSections?}`, or null before any are saved.

**Settings.** `PUT /settings` normalises the accent and daily picks (a bad accent reads as the
default, a pick is clamped to 1 to 8) and returns what it stored. A body without `foodPick` (K57)
or `itemSections` (K66) keeps the saved value, so a tab on older code cannot reset it.
`itemSections` is each tracker type's item-page arrangement, keyed by type id (`exercise`,
`food`): `{"exercise": {"order": ["history", "notes", "details", "plan"], "hidden": ["details"]}}`.
The keys are `notes`, `details`, `plan` and `history`. A shape the app never sends is refused
with 400 `invalid` and nothing changes: `itemSections` not an object, a key that is not a
registry type id, or a type whose `order` or `hidden` is not a list of strings. Within that shape
it normalises like the other settings (P24): unknown and repeated section keys drop, missing ones
follow in the default order, `hidden` keeps known keys in the default order, and a type with the
default arrangement is left out. `{}` stores the default; the state and the export leave the key
out then. Reading a stored or exported arrangement never refuses: a type this version's registry
lacks is dropped, so a newer version's value still reads.

**Plans.** `rev` is the revision the client last saw, 0 for a week it has never seen planned.
A matching `rev` stores the items and returns `rev + 1`. A stale `rev` gets 409 with `{items, rev}`
from the server, unless the stored items already equal the sent ones after validation. That
happens when two devices tick the same carried-forward week and both create its plan from the same
source. That write succeeds and returns the current `rev`. Items are validated with the same
rules as stored data, so a bad item drops out rather than failing the write.

**Ticks** set or clear one day for one item (an item id of 1 to 128 characters), so two devices
marking different days never collide. `day` is 0 (Monday) to 6. The body is `{"mark": m}`, where
`m` is one of the nine marks (`great`, `partial-solid`, `missed-hatch` …) or null (clear the
day). The old `{"done": bool}` body, from a
tab or a queued write from before marks had kinds, still works: true is `great`, false clears.
A `mark` key is read first; any other value of it, or a `done` that is not a boolean, gets 400
`invalid`. The app sends both keys (`{"mark": m, "done": m !== null}`), so an API from
before marks had kinds, still running during a deploy, saves the day as done rather than refusing it. The server stores any mark in either section; only the client keeps foods to `great`.

**Item details** are one document per item, the same for every week, keyed by section and item id
(an id of 1 to 128 characters). The body of `PUT /details/{section}/{item}` is
`{"details": {...}, "rev": n}`, where `rev` is the revision the client last saw, 0 for an item it
has never seen with details. The rules follow plans:

- A matching `rev` stores the document and returns `{"rev": rev + 1}`.
- A stale `rev` gets 409 `{"error": "conflict", "details": d, "rev": n}`, where `d` is the server's
  copy, `{}` once cleared, or null when the item has never had details. A stale write of a document
  equal to the stored one after validation succeeds with the current `rev`, as P7 does for plans.
- An empty document is stored rather than deleted, so the revision keeps counting and a device
  holding an older copy still conflicts (P22 in [decisions.md](decisions.md)).
- `details` that is not an object, a `rev` that is not a whole number from 0, an unknown section
  or an item id over 128 characters get 400 `invalid`.
- A document over 32 KB as stored gets 413 `too-large`, and one that would take the account over
  its quota 413 `quota`. Neither changes anything.

The document is validated before it is stored (`normalise_details`), so a bad part drops out
rather than failing the write:

- `notes` is markdown, trimmed of spaces, tabs and line breaks at its ends and cut to 20,000 code
  points. A blank note, or one that isn't a string, is left out.
- `fields` keeps keys matching `[a-z][a-z0-9_]{0,31}`, listed by the type or not, so changing a
  type's field list never loses text. Values are trimmed and cut to 500 code points, blanks drop
  out, and the first 32 that remain are kept.
- Other keys are dropped. The stored form is compact JSON with text as written
  (`encode_details`), and the 32 KB cap counts its UTF-8 bytes.

The API stores the text as written and never renders it.

**Quota.** Each user may store 5 MiB: the bytes of their plans' and item details' JSON plus 64 for
each tick row. A plan or details write, a tick that would add a row, or an import that would take
the account over it gets 413 `quota` and changes nothing. Writes that keep usage level or shrink it always succeed, so a full
account can still change existing ticks and trim its plans and details. Settings do not count and are never
refused. The quota measures what the account holds, not the bytes on disk, which include keys and
indexes. The client drops a refused write with a notice that the account is full (`architecture.md`
§7), and an import says the same.

**Export** writes version 5 of the file. Each section carries `details`, each item id's
`{notes?, fields?}` without revisions, and each log row is seven marks, drawings included, or
nulls. Import reads:

- version 5;
- version 4, whose notes sit on plan items (K43). They lift into `details` by migration 6's rule
  (`lift_notes`: the latest week with a non-blank note, the first copy in it, cut to 500
  characters), and any `details` key in the file is ignored;
- version 3 (no notes) and version 2 (kinds only, which read as the zigzag);
- version 1, whose `true` days read as `great` and `false` days as empty.

Any other version gets `version`. A file's details document over 32 KB drops out.

**Import** applies the merge rule from `architecture.md` §4: existing weeks keep their plan; per
week, item and day a marked day keeps its mark and an empty one takes the file's; an item with
details keeps them, and one without takes the file's; and settings apply only when the account has
none. An item whose details were cleared counts as without, and takes the file's as a new
revision, so a device holding the cleared copy conflicts. It returns what it added (`ticks`
counts the empty days that gained a mark, `details` the items that gained details), in one
transaction. A file that fails to parse gets 400 with `json`,
`format` or `version`, the same codes the client shows.

## 4. Accounts and sessions

- **Sign-up.** `POST /auth/signup` with `{email, password}` creates an account and signs it in.
  The email is trimmed and lower-cased, then stored in `users.username`, so it is what the
  person signs in with and what `X-Expected-User`, the cache keys and `tracker-admin` name. It must be
  at most 254 characters, with printable ASCII before the `@` (no spaces, no second `@`) and a
  domain of letters, digits and hyphens with at least one dot; otherwise 400 `email`. It is ASCII
  because the name travels in a header. With mail on, a confirm-your-email link goes to the address (§4.1); the account
  works at once either way. A taken email gets 409 `exists`, a password outside 10 to 256
  characters 400 `password`. When `MAX_USERS` accounts exist (every account counts, invited or not)
  or `MAX_USERS` is 0, sign-up gets 403 `closed`; a disabled account still counts. At most 10
  sign-ups land in any rolling hour (accounts made from an invite do not count); beyond that, 429 `too-many`
  with `Retry-After` saying when the oldest of them leaves the hour. The caps are checked before the password is
  hashed and again under the write lock with the insert, so parallel sign-ups cannot pass them.
  Sign-ups wait for the same bounded hasher as logins and get 503 `busy` the same way.
- **Invites.** `tracker-admin invite <email>` mints a single-use link,
  `$PUBLIC_ORIGIN/#/invite/<token>`, valid for 7 days. The person opens it and chooses a password
  (10 to 256 characters). The account is the email the invite names, under sign-up's email rule
  and lower-cased, so every new account, invited or signed up, signs in with an email. Inviting
  an email that already has an account fails; use `reset`. With mail on, redeeming an invite
  sends a confirm link, as sign-up does. `tracker-admin reset <email>` mints a reset link the same
  way, valid for 24 hours. Using it ends every session of that user and clears any lockout.
  Minting a new link revokes the earlier unused `tracker-admin` links of the same kind for that account
  (a new invite leaves a reset link alone, and the reverse). A reset sent by email
  (§4.1) revokes nothing, and nothing revokes it but its hour running out. The token travels
  in the URL fragment and then in request bodies, never in a path, so no access log (Traefik, nginx
  or uvicorn) records it. Redeeming with a password outside 10 to 256 characters gets 400
  `password`, and a used, expired or unknown link gets 410 `gone`.
- **Legacy usernames.** Invites before 2026-10-25 named a username (1 to 32 letters, digits, `.`,
  `_` or `-`). Such an account still signs in with it, and `reset`, `disable` and the rest still
  name it, but it has no email to confirm or reset by. Renaming it to its owner's email (one
  `UPDATE users SET username` while nobody needs its unsynced changes) gives it all of that; the
  planner's one such account, `john`, was renamed that way on 2026-10-25.
- **Passwords** are hashed with argon2id at argon2-cffi's defaults (64 MiB, 3 passes,
  parallelism 4). One hash runs at a time (a process-wide semaphore), so concurrent logins queue
  instead of multiplying memory. At most eight requests hold a place (one hashing, seven waiting,
  logins, sign-ups and invite redemptions alike), each waiting at most five seconds. The rest get 503
  `busy` with `Retry-After: 1`, so a flood of logins cannot occupy every worker thread.
- **Lockout.** Five wrong passwords within 15 minutes lock the account for 15 minutes. While
  locked, every login gets 423 `locked`, even with the right password. A success resets the count.
  The lock is read again after the hash, under the write lock, so a burst of parallel guesses
  cannot get past it or clear it. An unknown email costs the same hash as a known one and gets
  the same 401 `invalid`. So does a disabled user with the right password, and that attempt counts
  towards the lockout. Traefik's rate limit sits in front of all of it.
- **Sessions** are 32 random bytes in an `HttpOnly; Secure; SameSite=Lax; Path=/` cookie named
  `__Host-session`. They last 90 days from the last use: a request more than a day after the last
  refresh moves the expiry forward and re-sends the cookie. Logout ends one session.
  `tracker-admin revoke-sessions <email>` and a reset end them all. A disabled user's sessions stop
  working at once.

### 4.1 Email

Mail is on when `RESEND_API_KEY` is set (§6), and goes through [Resend](https://resend.com)'s
`POST /emails`, from `MAIL_FROM`, as HTML and plain text. With no key nothing is sent, the routes
that send get 503 `mail-off`, and the app hides "Forgot your password?" and the confirm banner;
resets are `tracker-admin`'s, as before.

- **Confirm your email.** Sign-up sends a link, `$PUBLIC_ORIGIN/#/confirm/<token>`, valid for 7
  days; `POST /auth/confirm/resend` sends a new one and revokes the old. Using it (no session
  needed, so it works on any device) sets `email_confirmed_at`. A resend for a confirmed account
  gets 409 `confirmed`, for an invited one 409 `no-email`. An unconfirmed account is not limited
  in anything; the flag only drives the banner, and later, who may get a report. `POST
/auth/confirm` works with mail off too, so a link sent before mail was turned off still
  confirms.
- **Forgot your password.** `POST /auth/forgot` with `{email}` mints a reset link (the same
  `#/reset/<token>` as `tracker-admin reset`, the same lookup and redeem) and emails it, valid for one
  hour. A malformed email gets 400 `email`; otherwise the answer is 202 `{}` whether or not an
  account has that email, it is disabled, or a limit was reached, so the reply tells nobody
  which addresses have accounts. A new request leaves earlier links working, so a stranger asking
  for resets for someone's address cannot cancel the link that person was just sent. Using a mailed reset also confirms the address, since only its
  owner could have opened it; a `tracker-admin` reset does not.
- **Limits.** Per account and kind, one email a minute and five a day; across the whole API,
  `MAIL_PER_HOUR` (30, at least 1) emails of any kind in any rolling hour, which keeps a flood of resets from
  spending the Resend quota. Each send is logged in `mail_log` under the write lock before the
  link is minted, so parallel requests cannot pass a limit. Over a limit, a resend gets 429
  `too-soon` with `Retry-After`; a reset request still gets its 202 and sends nothing; a sign-up
  just goes without its email (the banner can ask again).
- **Sending** happens after the response (FastAPI background tasks), so Resend's latency never
  shows in the reply and timing does not tell a real account from a missing one. A failed send is
  logged as a warning with its kind, never the address, and the person sees nothing; they can ask
  again. Each request carries a fresh `Idempotency-Key`.
- **The emails** are built by `emails.py` to the design system's EmailLayout card (inline styles,
  light only, the link written out) in the words of `voice.md`'s Email section. The card's
  preview is generated from the same code, and `test_mail.py` fails when they differ.

## 5. Admin CLI

`tracker-admin` runs in the API container against the same database:

```sh
docker compose exec fitness-api tracker-admin invite alice@example.com   # prints the invite link
docker compose exec fitness-api tracker-admin reset alice@example.com    # prints a reset link
docker compose exec fitness-api tracker-admin users            # email, created, disabled, sessions
docker compose exec fitness-api tracker-admin disable alice@example.com  # blocks login, ends sessions
docker compose exec fitness-api tracker-admin enable alice@example.com
docker compose exec fitness-api tracker-admin revoke-sessions alice@example.com
```

`tracker-admin seed-demo [email] [--password …]` is for a local stack only. It refuses unless
`PUBLIC_ORIGIN` is `http://localhost` or `http://127.0.0.1` (any port) and `COOKIE_SECURE=false`.
It creates the account when it doesn't exist (`demo@example.com` with the password
`demo-password` by default), confirms its email, and merges in three weeks of plans and marks
ending today through the same merge as Settings → Import. That merge adds a week's plan only where
the account has none, fills only empty days and gives details only to items that have none, so a
second run adds nothing, and an existing account keeps its password and every mark and note it
has. The demo uses the default plan's ids, and shows every kind in every drawing, met and unmet
goals, and a day over the pick. Push-ups and Fish get notes and fields, so the item page has
something to show. The command prints what it added ("Added 6 week plans, `<n>` marks and
details for 2 items.", the marks depending on the day of the week), or "Nothing to add" when the account already has all of it.

## 6. Configuration

| Variable         | Default               | Meaning                                                                   |
| ---------------- | --------------------- | ------------------------------------------------------------------------- |
| `DATA_DIR`       | `/data`               | holds `fitness.db` and `backup/`                                          |
| `PUBLIC_ORIGIN`  | (required)            | e.g. `https://fitness.itsa-pizza.com`; checked on writes, used in links   |
| `COOKIE_SECURE`  | `true`                | `false` for plain-http local runs; the cookie is then `session`           |
| `BACKUP_KEEP`    | `7`                   | daily copies kept in `$DATA_DIR/backup/`                                  |
| `MAX_USERS`      | `50`                  | sign-up closes once this many accounts exist; `0` turns sign-up off       |
| `RESEND_API_KEY` | (unset)               | turns mail on (§4.1); a key with sending access is enough. Never logged   |
| `MAIL_FROM`      | (required with a key) | the From line, `Name <address>` on a domain verified in Resend            |
| `MAIL_PER_HOUR`  | `30`                  | emails of every kind, across all accounts, in any rolling hour; 1 or more |

## 7. Backups

A background thread writes `$DATA_DIR/backup/fitness-YYYYMMDD.db` with `VACUUM INTO` once a day
(checked hourly, and at startup) and keeps the newest seven. The copy is a consistent, compact
database even while the API is writing. PBS backs up the whole directory on infra-vm. Settings →
Export gives each person a JSON copy of their own data as well.

## 8. Accepted risks

Reviewed and kept on purpose, for a small service with open sign-up (D9 in
[decisions.md](decisions.md)):

- **Sign-up reveals which emails have accounts.** A taken email gets 409 `exists`. Hiding it would
  mean nobody is signed in at sign-up (everyone would have to wait for an email), which is not worth
  it at this size. It widens the lockout's existing leak (below) rather than opening a new kind;
  "Forgot your password?" does not add to it, since it answers the same for everyone.
- **Anyone can claim any email until it is confirmed.** A person can sign up with an address that
  is not theirs; its owner then gets 409 `exists`, but "Forgot your password?" sends them a reset
  link, which takes the account back and confirms the address. With mail off, `tracker-admin disable`
  blocks such an account or `tracker-admin reset` hands it over.
- **An inbox can reset the password.** Whoever controls an account's email can choose a new
  password from it, as on most sites. The link lasts an hour, works once, and ends every session.
- **Strangers can spend the email limits.** Anyone who knows an address can ask for its resets:
  five a day stop that account's own requests for up to 24 hours, and enough accounts can
  use up `MAIL_PER_HOUR`, after which sign-ups go without their confirm email for the hour. Links
  already sent keep working. And an existing account's request writes to the database where a
  missing one only reads, so its reply can be a few milliseconds slower: a statistical hint, not
  an answer.
- **Resend sees the addresses and the links.** Every email passes through Resend (EU region), with
  its reset or confirm link in it. A leaked reset link from their logs would be good for at most
  an hour, and only until used.
- **Strangers can fill the account cap, or the hour.** Ten sign-ups an hour fill the default
  `MAX_USERS` of 50 in five hours, after which sign-up says it is closed; ten at once block real
  sign-ups for up to an hour. Nothing else is harmed: invited and existing accounts keep working,
  and each stranger's data is bounded by the quota. `tracker-admin users` shows who signed up and
  `disable` blocks one, but a disabled account still counts towards `MAX_USERS`, so only raising
  it reopens sign-up.
- **Lockout reveals and can block an account.** Five wrong passwords lock a real account, but an
  unknown email never locks, so guessing shows which emails have accounts. Emails are easier to
  guess than the invite usernames accounts once had. The same five guesses every 15
  minutes keep someone out. The lock is per account because the LAN port means no client IP can
  be trusted. `tracker-admin reset` clears it.
- **Sessions have no absolute lifetime.** A session used at least every 90 days lasts
  indefinitely. Logout, `revoke-sessions`, a reset and `disable` all end it.

## 9. Validation parity

`validate.py` mirrors the TypeScript normalisers rule for rule, including the places where Python
differs by default:

- Numbers round half up like `Math.round`, not to even.
- `true` is not a number.
- An integer past a double's range is `Infinity`, and so falls back; a large one rounds to the
  nearest double.
- `NaN` and `Infinity` are not JSON.
- Week keys need ASCII digits, and a trailing newline is not allowed.
- A log entry keyed `__proto__` is dropped, and so are an item's details keyed `__proto__`.
- Notes and field values count code points, as Python's `len` does. The app counts them with
  `codePoints`, since a JavaScript string's `length` counts UTF-16 units.
- A day's mark is `great`, `partial` or `missed` exactly; a literal `true` reads as `great`, and
  anything else (`1`, `"true"`, `"GREAT"`) is empty.

`tests/test_parity.py` runs every case in `fixtures/transfer/`, the same files the Vitest suite
runs. A rule changed on one side without the other fails one of the two suites.
`tests/test_types.py` and the app's `trackerTypes.spec.ts` both read `fixtures/types/registry.json`,
so the two registries keep the same sections, types, fields, daily-target keys and new-item goals.

Two inputs that JavaScript parses are refused on purpose as `json`. One is nesting deep enough to
exhaust Python's recursion limit. The other is a string holding a lone surrogate, which SQLite
cannot store as UTF-8. Neither can come from the app. The API also accepts a body that starts with
a UTF-8 byte-order mark, as the browser's `File.text()` does.

## 10. Development

```sh
cd api
uv sync                                  # Python 3.13 and the dev tools
uv run pytest                            # tests
uv run coverage run -m pytest && uv run coverage report   # fails under 98%
uv run ruff check . && uv run ruff format --check .
uv run mypy
PUBLIC_ORIGIN=http://localhost:5173 COOKIE_SECURE=false DATA_DIR=./.data \
  uv run uvicorn --factory tracker_api.app:create_app_from_env --port 8000
```

Tests sit in `api/tests/`:

- `test_parity.py`: every case in `fixtures/transfer/`, the same files Vitest runs, plus the
  deliberate divergences from JavaScript (§9).
- `test_api.py`: the HTTP layer: the write guard, error shapes, body limits (chunked too), every
  data endpoint, user isolation, `X-Expected-User`, sign-up and its refusals (closed included),
  the quota on plans, ticks and imports, every mark and the old `done` body, import and export
  (the sample round trip, version 1 files, existing marks winning).
- `test_auth.py`: hashing one at a time and the busy queue, login, lockout and its window and
  races, sessions sliding and expiring, invite and reset links, races between redemptions;
  sign-up's email rule (254 characters, ASCII), password length, taken emails, `MAX_USERS`, the
  hourly limit (invites not counted), parallel sign-ups against the cap and for one email, and a
  reset for an email account.
- `test_mail.py`: the Resend request's shape and its errors, the two emails (words, escaping,
  the email rules) and the EmailLayout card being current, `GET /auth/options`, confirming
  (links, expiry, resend and its limits, invited accounts, mail off, a failed send), forgot
  password (same answer for anyone, the hour's lifetime, confirming by a mailed reset only, silent
  limits) and `MAIL_PER_HOUR` across kinds.
- `test_details.py`: item details: one copy for every week, plans stored with notes read without
  them, validation (trimming, the 20,000 and 500 code-point cuts, field keys and their count, the
  32 KB cap as stored), revisions and conflicts, an empty document keeping its revision, sections
  and users kept apart, 400s, the quota, export version 5, import keeping existing details, and a
  version 4 file's notes lifting into details.
- `test_types.py`: the registry against `fixtures/types/registry.json`, the `Section` literal and
  `validate.py` reading it.
- `test_seed.py`: `seed-demo` only on a local stack, a confirmed account, three weeks of every mark,
  details for two items, an account's own marks and details kept, a second run adding nothing,
  and what the CLI prints.
- `test_db.py`, `test_config.py`, `test_backup.py`, `test_cli.py`: migrations (including racing
  ones, the WAL switch, old ticks reading as `great` after step 2, and step 6 lifting each item's
  latest note, rerunning and on an empty database), configuration from the environment, daily
  copies, `tracker-admin`.
- `conftest.py` gives each test a temporary database, a controllable clock, a cheap hasher and a
  mailer that records instead of sending (`mail_client`);
  `fixtures.py` reads `fixtures/transfer/`.
