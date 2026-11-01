# API

> Purpose
>
> The API service in `api/`: accounts, sessions, invites, email, the synced data, the read-only
> insights over it, the MCP endpoint and its API tokens, the admin CLI and backups. It is the reference for the endpoints the client
> calls and for running the service.

## 1. Overview

A FastAPI app on Python 3.13, served by uvicorn on port 8000 as one process. It stores everything
in SQLite at `$DATA_DIR/fitness.db` (WAL mode, foreign keys on). The web container's nginx forwards
`/api/` to it, so the browser sees one origin and the CSP stays unchanged. Every user's rows are
scoped by `user_id`, and no endpoint reads another user's data.

| Module          | Holds                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `config.py`     | `Config`, read from the environment (§6)                                                                              |
| `db.py`         | connections, the schema and its migrations                                                                            |
| `validate.py`   | the port of `src/lib/storage.ts` and `src/lib/transfer.ts`, and the write checks REST and MCP share                   |
| `auth.py`       | password hashing, lockout, sessions, sign-up and its caps, invite, reset and confirmation tokens, personal API tokens |
| `outbox.py`     | which emails go out and when: the limits (§4.1), the links, the message                                               |
| `emails.py`     | the two emails, built to the EmailLayout card, and that card's preview                                                |
| `mail.py`       | the Resend client, and sending after the response                                                                     |
| `data.py`       | reading and writing plans, ticks and settings; import, export; the quota (`usage`)                                    |
| `insights.py`   | read-only views of a user's weeks, counted as the screen counts them (§1.1)                                           |
| `edits.py`      | the MCP write tools' rules: one item, one mark or the daily targets at a time, as the app changes them (§3.1)         |
| `app.py`        | the HTTP layer: routes, the write checks, error mapping, and where `/api/mcp` is served (§3.1)                        |
| `mcp_server.py` | the MCP endpoint: the SDK server, its token check, and the tools (§3.1)                                               |
| `backup.py`     | the daily `VACUUM INTO` copy                                                                                          |
| `cli.py`        | `tracker-admin`                                                                                                       |
| `seed.py`       | `tracker-admin seed-demo`: a demo account and three weeks of marks, on a local stack only                             |

### 1.1 Insights

`insights.py` is a read-only view of one user's weeks. The /ask page and the MCP server both read
through it. It counts the way the screen counts, so an answer never contradicts the week (§9).

The rules are ports of the web app's:

- `plan_source` is `planSource` (architecture.md §2): a week's own plan, else the latest earlier
  one, else the earliest. `week_items` gives the items a week shows, and `default_items` the
  defaults when nothing is planned.
- `total_for`, `day_counts`, `goal_met`, `goals_met` and `met_days` are `src/lib/tracker.ts`'s.
  Every mark counts towards a goal, a missed day included. A goal of 0 is never met. Only the
  items the week shows count. A day is met when its count reaches exercises or foods a day.

The readers each return a dict:

| Reader                                                        | Returns                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `week_summary(conn, user_id, section, week, today)`           | `week`, `plan_week` (None for the defaults), `carried`, `daily_target`; seven `days` (`date`, `count`, `met`, `future`); the `items` (`id`, `name`, `target`, `notes`, seven mark kinds, `done`, `great`, `partial`, `missed`, `goal_met`); `goals_met`, `days_met` |
| `weeks(conn, user_id, section, start, end, today)`            | `week_summary` for each week from `start` to `end`, oldest first, at most 26                                                                                                                                                                                        |
| `item_history(conn, user_id, section, item_id, weeks, today)` | one item over the last `weeks` weeks: per week `in_plan`, `target`, the marks and their counts. A week that doesn't show the item reads as empty, as on screen                                                                                                      |
| `goals(conn, user_id, today)`                                 | today's week's items with their goals, `exercises_a_day`, `foods_a_day`, and `note`, the "My goals" text (`""` until Settings has it)                                                                                                                               |
| `consistency(conn, user_id, section, weeks, today)`           | over the last `weeks` weeks: the days up to today, how many met the daily target and the rate; the goals of the finished weeks, how many were met and the rate; the current runs of met days and of weeks with every goal met                                       |

Every reader keeps these rules:

- `today` is the asker's date, passed in. The server can't know the browser's date, so the
  module never reads the clock.
- Weeks are Monday `YYYY-MM-DD` keys. Another key, an unknown section, or a week count outside
  1–26 raises `InsightsError`, a `ValueError` whose `field` names the argument.
- Keys are snake_case, and no user or session field appears. The return types are `TypedDict`s.
- Names are cut to 100 characters and notes to 500, because they reach a model as text.
- A reader reads only `user_id`'s rows and writes nothing.
- A `missed` day counts in `done` and shows in `missed`. Read `goal_met` beside the kind counts.

## 2. Data model

| Table           | Key                                 | Columns                                                                                                                                                                 |
| --------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`         | `id`                                | `username` (unique, case-insensitive; the lower-cased email for a signed-up account), `password_hash`, `disabled`, lockout counters, `created_at`, `email_confirmed_at` |
| `sessions`      | `token_hash`                        | `user_id`, `created_at`, `last_seen`, `expires_at`                                                                                                                      |
| `invites`       | `token_hash`                        | `kind` (`invite` or `reset`), `username`, `user_id` (resets), `expires_at`, `used_at`, `mailed` (a reset sent by email)                                                 |
| `confirmations` | `token_hash`                        | `user_id`, `created_at`, `expires_at`, `used_at`: confirm-your-email links                                                                                              |
| `mail_log`      | `id`                                | `user_id`, `kind` (`confirm` or `reset`), `sent_at`: one row per email attempted (a failed send still counts), for the limits                                           |
| `api_tokens`    | `token_hash`                        | `user_id`, `name`, `prefix` (unique per user), `scope` (`read` or `write`), `created_at`, `last_used_at`: personal API tokens (§4)                                      |
| `settings`      | `user_id`                           | `accent`, `daily_pick`, `food_pick` (K57)                                                                                                                               |
| `plans`         | `(user_id, section, week)`          | `items_json`, `rev`                                                                                                                                                     |
| `ticks`         | `(user_id, section, week, item_id)` | `days`, `partial`, `missed`, `solid`, `hatch`: 7-bit masks (bit 0 is Monday); see below                                                                                 |

`section` is `exercise` or `diet`. Every row cascades from its user. Tokens and session ids are
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
the zigzag. Version 5 adds `food_pick` to `settings` (default 2), foods a day (K57). Version 6 adds
`api_tokens` and its `(user_id, prefix)` index, personal API tokens (§4).

Version 6 only adds a table, so it reshapes no data, and it uses `IF NOT EXISTS`, so it can run
again. To back it out, revert the code: the empty table can stay, because `user_version` only
moves forward and older code never reads the table. A database that ran version 6 stays at 6, so
after such a revert, a different step must not ship as version 6: append it as version 7.

## 3. Endpoints

All paths start with `/api`. Bodies are JSON, and errors are `{"error": "<code>"}`. Every response
carries `Cache-Control: no-store`.

**`X-Expected-User`.** A data request may name the user it expects; if the session belongs to anyone
else, it gets 401 `auth`. The client sends it on every read and write, so a tab left open as one
person can never touch the data of someone who signed in later in another tab.

**Writes** (`POST`, `PUT`) must send `Content-Type: application/json` and an `Origin` header equal
to `PUBLIC_ORIGIN`; otherwise they get 403 `origin` or 415 `content-type`. `/api/mcp` follows its
own rules (§3.1). `SameSite=Lax` alone would not stop a request from another `*.itsa-pizza.com` host, because the browser counts it as
same-site. Bodies over 1 MiB get 413 `too-large`, counted as they stream in, so a chunked body is
cut off at the limit rather than read whole. A body with nothing to send, such as logout's, is `{}`.

| Method and path                            | Auth    | Does                                                                                           |
| ------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| `GET /healthz`                             | no      | `SELECT 1`; `{"ok": true}`                                                                     |
| `POST /auth/login`                         | no      | `{username, password}` → the account and the session cookie                                    |
| `POST /auth/signup`                        | no      | `{email, password}` creates an account → the account and the cookie                            |
| `POST /auth/logout`                        | session | ends this session and clears the cookie; 204                                                   |
| `GET /auth/me`                             | session | the account: `{username}`, plus `confirmed` (below)                                            |
| `GET /auth/options`                        | no      | `{mail}`: whether this API sends email (§4.1)                                                  |
| `POST /auth/forgot`                        | no      | `{email}` → 202 `{}` for any well-formed email; a reset link goes to a matching account (§4.1) |
| `POST /auth/confirm`                       | no      | `{token}` confirms the email → the account; 410 `gone` otherwise                               |
| `POST /auth/confirm/resend`                | session | a new confirm link → 202 `{}`; refusals in §4.1                                                |
| `POST /invites/lookup`                     | no      | `{token}` → `{kind, username}` for a live link; 410 `gone` otherwise                           |
| `POST /invites/redeem`                     | no      | `{token, password}` sets the password, consumes the link, signs in                             |
| `GET /state`                               | session | everything the client renders (below)                                                          |
| `PUT /plans/{section}/{week}`              | session | `{items, rev}` → `{rev}`; 409 `conflict` with the server copy                                  |
| `PUT /ticks/{section}/{week}/{item}/{day}` | session | `{mark}` → `{days}`, the week's seven marks for that item                                      |
| `PUT /settings`                            | session | `{accent, dailyPick, foodPick}` → the stored settings; no `foodPick` keeps the saved one       |
| `GET /export`                              | session | the export file (`architecture.md` §4)                                                         |
| `POST /import`                             | session | an export file, merged in; → `{weeks, ticks, settings}` added                                  |
| `POST /mcp`                                | token   | one MCP request, answered as JSON (§3.1)                                                       |

**The account** is `{username}`: the account's email (the field keeps its old name, so older
tabs and clients work unchanged). While mail is on it also carries `confirmed`, true once the
address is confirmed. A legacy account still named by a username (below), and every account while
mail is off, has no such key.

`GET /state` returns `{exercise, diet, settings}`. Each section is `{plans, log, revs}`: `plans`
and `log` have the same shape as in `localStorage` (a log row is seven marks or nulls), and `revs`
maps each planned week to its revision. `settings` is `{accent, dailyPick, foodPick}`, or null before any are saved.

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

**Quota.** Each user may store 5 MiB: the bytes of their plans' JSON plus 64 for each tick row.
A plan write, a tick that would add a row, or an import that would take the account over it gets
413 `quota` and changes nothing. Writes that keep usage level or shrink it always succeed, so a full
account can still change existing ticks and trim its plans. Settings do not count and are never
refused. The quota measures what the account holds, not the bytes on disk, which include keys and
indexes. The client drops a refused write with a notice that the account is full (`architecture.md`
§7), and an import says the same.

**Export** writes version 4 of the file: an exercise or a food may carry `notes`, and each log
row is seven marks, drawings included, or nulls. Import reads version 4, version 3 (no notes),
version 2 (kinds only, which read as the zigzag) and version 1, whose `true` days read as `great`
and `false` days as empty; any other version gets `version`.

**Notes** (K43) live in a plan's items, inside `items_json`, so they took no migration. An item's
`notes` is markdown, trimmed of spaces, tabs and line breaks at its ends and cut to 500 characters
(`normalise_notes`); a blank note, or one that isn't a string, is left out. The API stores the
text as written and never renders it.

**Import** applies the merge rule from `architecture.md` §4: existing weeks keep their plan; per
week, item and day a marked day keeps its mark and an empty one takes the file's; and settings
apply only when the account has none. It returns what it added (`ticks` counts the empty days
that gained a mark), in one transaction. A file that fails to parse gets 400 with `json`,
`format` or `version`, the same codes the client shows.

### 3.1 MCP

[mcp.md](mcp.md) says how to mint a token and connect each Claude client.

`POST /api/mcp` serves the Model Context Protocol (MCP) over Streamable HTTP, so an agent such as
Claude Code can work with the account's data. The official `mcp` SDK (2.3) serves it from
the API process, through the same nginx route as every other `/api/` path. This section covers
the endpoint's rules. The tools are listed below.

- **The URL** is exactly `$PUBLIC_ORIGIN/api/mcp`. The API routes that path itself, so it never
  answers with a redirect. `/api/mcp/` is not the endpoint: it gets REST's guard, and past it a
  307 to the path without the slash.
- **Auth.** The request sends a personal API token (§4) as `Authorization: Bearer trk_…`, and
  only there. The route never reads the session cookie, and no REST route accepts a token. A
  `token` or `access_token` in the query string gets 400 `token-in-url` before anything else is
  checked, because nginx and uvicorn log query strings. No token, an unknown or revoked one, or a
  disabled account's token gets 401 with `WWW-Authenticate: Bearer error="invalid_token"`. The
  header also names a `resource_metadata` URL, which answers 404: the endpoint has no OAuth flow.
- **The write guard** (§3) works differently on this path:
  - A request with no `Origin` passes, since an agent is not a browser and sends none.
  - An `Origin` other than `PUBLIC_ORIGIN` still gets 403 `origin`, the MCP spec's defence
    against DNS rebinding.
  - The guard skips its `Content-Type` check. The SDK answers a POST that is not JSON with 400.
  - The 1 MiB cap stays. A `Content-Length` over it gets 413 `too-large`, and the SDK cuts a
    chunked body off at the same size.
- **Host.** The SDK accepts a `Host` of `PUBLIC_ORIGIN`'s host without its port (nginx forwards
  `$host`), or `localhost` or `127.0.0.1` with any port. Any other `Host` gets 421, so the LAN
  port's address does not serve MCP. Use the public HTTPS URL, where the token travels encrypted.
- **Stateless JSON.** Each POST carries one JSON-RPC message and gets one JSON response. There is
  no `Mcp-Session-Id` and no SSE stream, so a deploy drops no session and nginx's 60-second idle
  cut never applies. Any other method gets 405 `method`: there is no GET stream to open and no
  session to end with `DELETE`. Both kinds of client work: one that starts with `initialize`
  (revisions 2024-11-05 to 2025-11-25), and one on the 2026-07-28 revision, which sends its
  protocol version with every request.

| Tool     | Scope | Returns                                                                   |
| -------- | ----- | ------------------------------------------------------------------------- |
| `whoami` | read  | `{email, scope}`: the token's account and its scope, to test a connection |

A token of either scope may call a `read` tool. Only a `write` token may call a write tool (below).

**Read tools.** Each wraps the reader of the same name in `insights.py` (§1.1) and returns its
result unchanged, with `this_week` (the Monday of today's week) and `today` added, both in the
account's timezone, so the agent knows "now". Every read tool has `readOnlyHint`. The server
passes `today` to the reader, since `insights.py` never reads the clock. `section` is `exercise`
(the default) or `diet` (food). A week is a Monday written `YYYY-MM-DD`.

| Tool           | Arguments (defaults)                                                      | Returns                                                         |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `week_summary` | `section` (`exercise`), `week` (this week)                                | One week: each item's marks against its goal, and the met days  |
| `weeks`        | `section` (`exercise`), `start` (3 weeks before `end`), `end` (this week) | `week_summary` for each week from `start` to `end`, 26 at most  |
| `item_history` | `item_id`, `section` (`exercise`), `weeks` (8)                            | One item's goal and marks over the last `weeks` weeks           |
| `goals`        | none                                                                      | This week's goals for both sections, daily targets and the note |
| `consistency`  | `section` (`exercise`), `weeks` (8)                                       | Met-day and goal-met rates over the last `weeks` weeks, streaks |

A refused argument (a `week` that is not a Monday, an unknown `section`, a `weeks` outside 1
to 26) returns a tool result with `isError: true` whose text names the field, as `week: must be a
Monday, written YYYY-MM-DD`. It is not a JSON-RPC error. A week so near the year 1 or 9999 that
the weeks around it can't be counted gets `date: a week or date is out of range`.

**Write tools.** These change John's plans, marks and daily targets as the app does. Each needs a
`write` token. A `read` token gets a tool error that says the token is read-only and how to mint
one with `--write`. The rules live in `edits.py`, over `data.put_plan`, `data.set_tick` and
`data.put_settings`, so REST's endpoints and limits are unchanged.

| Tool                | Arguments (defaults)                                                        | Annotations       |
| ------------------- | --------------------------------------------------------------------------- | ----------------- |
| `add_item`          | `name`, `section` (`exercise`), `week` (this week), the item fields below   | not idempotent    |
| `update_item`       | `item_id`, `section` (`exercise`), `week` (this week), the fields to change | `idempotentHint`  |
| `remove_item`       | `item_id`, `section` (`exercise`), `week` (this week)                       | `destructiveHint` |
| `mark_day`          | `item_id`, `mark`, `section` (`exercise`), `date` (today)                   | `idempotentHint`  |
| `set_daily_targets` | `exercises_a_day`, `foods_a_day` (each left as it is when not given)        | `idempotentHint`  |

Every write tool has `readOnlyHint` false and `openWorldHint` false; only `remove_item` has
`destructiveHint` true.

- **A change to a week is a change to that week and the weeks that carry it forward**, as in the
  app (architecture.md §2). A week with no plan of its own gets a copy of the plan it shows: its
  source week's, or the defaults when nothing is planned. An item tool creates the week at `rev`
  0 with the change already applied to the copy, in one write, as the app's sync sends `own()`
  and the edit. `mark_day` first creates the plain copy (`edits.own_week`), then sets the day, as
  a tick on the device does. A device creating the same week from the same source does not
  conflict (P7). The source week is never written. `copied_from` in the result names the week
  copied, `defaults`, or null when the week had its own plan.
- **Item fields use the app's words.** An exercise has `name`, `sets` (0 to 20), `reps` (0 to
  9999), `seconds` (0 to 3600), `per_side`, `weight_kg` (0 to 500), `times_a_week` (0 to 7) and
  `note` (up to 500 characters). A food has `name`, `times_a_week` and `note`. They are stored as
  `name`, `sets`, `reps`, `duration`, `perSide`, `weight`, `target` and `notes`; `edits.WORDS`
  holds that mapping. A 0, or an empty `note`, clears the field. An exercise counts reps or
  seconds, not both: giving `seconds` to an exercise with reps sets its reps to 0, and giving
  `reps` drops its seconds. Names are trimmed, may not be empty, and are capped at 80 characters.
  A new exercise's `times_a_week` is 3, as is a new food's.
- **Ids are made by the server**, in the app's shape: `x`, the time in milliseconds in base 36, and
  four random base-36 characters. An id already used in the section is never reused.
- **`mark_day`** marks one item on one date. The week is that date's Monday and the day its
  weekday. It may be in the future, as on screen. `mark` is one of the nine marks
  (§2), or null to clear the day. A food takes only `great`, `great-solid` or `great-hatch`, the
  marks the app gives a food. An item the week does not show is refused.
- **`set_daily_targets`** sets exercises a day and foods a day, each 1 to 8. The accent and the
  target not given keep their saved values, or the defaults while none are saved.
- **Conflicts.** A plan write that meets a newer `rev` re-reads the week and applies the change
  again, up to three tries in all, then fails with a tool error. The app adopts the server's copy
  on its next read, as after any 409 (architecture.md §7).
- **Refusals** are tool results with `isError: true`, whose text names the field, as
  `item_id: no item xq in the week of 2026-10-19`. They cover a week that is not a Monday, an
  unknown item id, an out-of-range or unknown field, a strict-validation problem, three conflicts
  in a row and a full account (`quota`). Nothing is changed when a call is refused, with one
  exception, which the app shares: a mark refused for the quota on a week without its own plan
  leaves that week's copied plan in place. The week shows the same items either way.
  Arguments that don't fit a tool's schema (a `mark` outside the nine, text for a number) are
  refused by the SDK, whose text names the argument and what it accepts.

Each result gives what was there before, so a change can be undone by hand (there is no undo
table):

| Tool                 | Returns                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the three item tools | `section`, `week`, `item` (the item added, updated or removed), `before` and `after` (the week's items, in the app's words), `rev`, `copied_from`               |
| `mark_day`           | `section`, `date`, `week`, `day` (0 is Monday), `item_id`, `before` and `after` (the day's mark or null), `days` (the item's seven marks), `rev`, `copied_from` |
| `set_daily_targets`  | `before` and `after`, each `{exercises_a_day, foods_a_day}`                                                                                                     |

`remove_item` leaves the item's marks in the log, uncounted, as the app does. Adding the item back
gives it a new id, so those marks stay detached; `before` holds the item for reference.

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
  way, valid for 24 hours. Using it ends every session and API token of that user and clears any
  lockout.
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
- **API tokens** let a program act as the account, for the MCP endpoint.
  `tracker-admin token create <email> --name <name>` prints one once: `trk_` and 43 random
  URL-safe characters. The database keeps only its SHA-256 hash and its `prefix`, the 8
  characters after `trk_`, which names the token without revealing it. A token has the
  `read` scope, or `write` with `--write`. Tokens do not expire, and `last_used_at` moves at most
  once a day. `token revoke` ends one; `revoke-sessions`, a reset (from `tracker-admin` or by
  email) and `disable` end them all. A disabled account cannot mint one, and its tokens stop
  working at once. No REST route accepts a token, and nothing logs one: the CLI prints it to its
  own output only.

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
docker compose exec fitness-api tracker-admin users            # email, created, disabled, sessions, tokens
docker compose exec fitness-api tracker-admin disable alice@example.com  # blocks login, ends sessions and tokens
docker compose exec fitness-api tracker-admin enable alice@example.com
docker compose exec fitness-api tracker-admin revoke-sessions alice@example.com  # ends sessions and tokens
docker compose exec fitness-api tracker-admin token create alice@example.com --name laptop  # a read token, printed once
docker compose exec fitness-api tracker-admin token create alice@example.com --name agent --write  # read and write
docker compose exec fitness-api tracker-admin token list alice@example.com  # name, prefix, scope, created, last used
docker compose exec fitness-api tracker-admin token revoke alice@example.com <prefix>
docker compose exec fitness-api tracker-admin token revoke alice@example.com --all
```

`token create` and `token list` show each token's prefix as `trk_` and its 8 characters, and
`token revoke` takes it in that form or without the `trk_`. The `trk_` form never starts with
`-`, so the shell and the CLI read it as an argument. A prefix that names no token of that account
fails with status 1 and revokes nothing.

`tracker-admin seed-demo [email] [--password …]` is for a local stack only. It refuses unless
`PUBLIC_ORIGIN` is `http://localhost` or `http://127.0.0.1` (any port) and `COOKIE_SECURE=false`.
It creates the account when it doesn't exist (`demo@example.com` with the password
`demo-password` by default), confirms its email, and merges in three weeks of plans and marks
ending today through the same merge as Settings → Import. That merge adds a week's plan only where
the account has none and fills only empty days, so a second run adds nothing, and an existing
account keeps its password and every mark it has. The demo uses the default plan's ids, and shows
every kind in every drawing, met and unmet goals, and a day over the pick.

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
| `TIMEZONE`       | `Europe/Amsterdam`    | the IANA zone that decides today and this week for the MCP tools          |

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
- **API tokens have no lifetime at all.** A token works until something revokes it:
  `token revoke`, `revoke-sessions`, a reset or `disable`. `token list` shows when each was last
  used, to the day, so a forgotten one is easy to spot and revoke.

## 9. Validation parity

`validate.py` mirrors the TypeScript normalisers rule for rule, including the places where Python
differs by default:

- Numbers round half up like `Math.round`, not to even.
- `true` is not a number.
- An integer past a double's range is `Infinity`, and so falls back; a large one rounds to the
  nearest double.
- `NaN` and `Infinity` are not JSON.
- Week keys need ASCII digits, and a trailing newline is not allowed.
- A log entry keyed `__proto__` is dropped.
- A day's mark is `great`, `partial` or `missed` exactly; a literal `true` reads as `great`, and
  anything else (`1`, `"true"`, `"GREAT"`) is empty.

`tests/test_parity.py` runs every case in `fixtures/transfer/`, the same files the Vitest suite
runs. A rule changed on one side without the other fails one of the two suites.

`fixtures/insights/` holds the same contract for what a week shows (§1.1). Each case gives a
section's plans and log, a week, today and the daily target, and expects the plan week, the
day counts, the met days, the days still to come and each item's counts. The cases cover carry
forward, a week before the first plan, the defaults of each section, an empty plan, marks of a
removed item, a goal of 0, missed and partial days, met days, and future days and weeks.
`tests/test_insights.py` runs each case through the pure rules and through `week_summary` over a
real database. `src/lib/__tests__/insights-parity.spec.ts` runs each through `planSource`, the
defaults and `src/lib/tracker.ts`, and again through the planner and diet stores.

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
- `test_insights.py`: every case in `fixtures/insights/` (§9), then each reader over a real
  database: the defaults, missed days, the output's shape and cuts, user isolation, no writes,
  the 26-week bound, Monday keys, item history, goals and consistency.
- `test_api.py`: the HTTP layer: the write guard, error shapes, body limits (chunked too), every
  data endpoint, user isolation, `X-Expected-User`, sign-up and its refusals (closed included),
  the quota on plans, ticks and imports, every mark and the old `done` body, import and export
  (the sample round trip, version 1 files, existing marks winning).
- `test_auth.py`: hashing one at a time and the busy queue, login, lockout and its window and
  races, sessions sliding and expiring, invite and reset links, races between redemptions;
  sign-up's email rule (254 characters, ASCII), password length, taken emails, `MAX_USERS`, the
  hourly limit (invites not counted), parallel sign-ups against the cap and for one email, and a
  reset for an email account; API tokens: lookup and scope, malformed and unknown tokens, disabled
  accounts, revocation by a reset, `disable` and `revoke-sessions`, hash-only storage, and the
  daily `last_used_at`.
- `test_mail.py`: the Resend request's shape and its errors, the two emails (words, escaping,
  the email rules) and the EmailLayout card being current, `GET /auth/options`, confirming
  (links, expiry, resend and its limits, invited accounts, mail off, a failed send), forgot
  password (same answer for anyone, the hour's lifetime, confirming by a mailed reset only, silent
  limits) and `MAIL_PER_HOUR` across kinds.
- `test_db.py`, `test_config.py`, `test_backup.py`, `test_cli.py`: migrations (including racing
  ones, the WAL switch, old ticks reading as `great` after step 2, and every row surviving step
  6 from a populated database), configuration from the environment (`TIMEZONE`, and the week
  turning over at local midnight), daily copies, `tracker-admin`.
- `test_mcp.py`: the MCP endpoint through `TestClient`: `initialize`, `tools/list` and `whoami`
  with a token, on both protocol kinds, and each refusal (no, bad, revoked or disabled token; a
  cookie alone; a token in the query string; a foreign `Origin` or `Host`; a method other than
  POST; an oversized body; a redirect). Where the endpoint's rule differs from REST's, the same
  test checks a REST route too, so an exemption wider than `/api/mcp` fails. Then every tool:
  the parity cases through `week_summary`, the read tools' defaults and refusals (a week at the
  calendar's end included), a read token refused on writes, and each write's result.
- `test_edits.py`: the plan edits behind the write tools: copying a carried week first, the ids
  the server makes, each field's bounds, replaying a conflict, the quota, and marks per section.
- `test_validate.py`: the write checks REST and MCP share: week keys, plan bodies, item ids, days,
  marks and the stricter item shape for MCP writes.
- `test_seed.py`: `seed-demo` against a local stack only, adding what is missing and never
  overwriting a mark.
- `conftest.py` gives each test a temporary database, a controllable clock, a cheap hasher and a
  mailer that records instead of sending (`mail_client`);
  `fixtures.py` reads `fixtures/transfer/`.
