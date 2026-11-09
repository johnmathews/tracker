# API

> Purpose
>
> The API service in `api/`: accounts, sessions, invites, email, the synced data, the read-only
> insights over it, Ask, the MCP endpoint, its API tokens and OAuth sign-in for Claude, the admin CLI
> and backups. It is
> the reference for the endpoints the client calls and for running the service.

## 1. Overview

A FastAPI app on Python 3.13, served by uvicorn on port 8000 as one process. It stores everything
in SQLite at `$DATA_DIR/fitness.db` (WAL mode, foreign keys on). The web container's nginx forwards
`/api/` to it, so the browser sees one origin and the CSP stays unchanged. Every user's rows are
scoped by `user_id`, and no endpoint reads another user's data.

| Module             | Holds                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `config.py`        | `Config`, read from the environment (§6)                                                                              |
| `db.py`            | connections, the schema and its migrations                                                                            |
| `types.py`         | the tracker-type registry, the port of `src/lib/trackerTypes.ts`: sections, types, their fields                       |
| `item_sections.py` | the item pages' arrangement per type (K66), the port of `src/lib/itemSections.ts`                                     |
| `validate.py`      | the port of `src/lib/storage.ts` and `src/lib/transfer.ts`, and the write checks REST and MCP share                   |
| `auth.py`          | password hashing, lockout, sessions, sign-up and its caps, invite, reset and confirmation tokens, personal API tokens, and the one helper that ends tokens and connections together |
| `outbox.py`        | which emails go out and when: the limits (§4.1), the links, the message                                               |
| `emails.py`        | the two emails, built to the EmailLayout card, and that card's preview                                                |
| `mail.py`          | the Resend client, and sending after the response                                                                     |
| `data.py`          | reading and writing plans, ticks, item details, settings and Ask's history; import, export; the quota (`usage`)       |
| `insights.py`      | read-only views of a user's weeks, counted as the screen counts them (§1.1)                                           |
| `ask.py`           | Ask (§3.2): the question's checks, the daily caps, the history sent, the prompt, the tools, the Claude loop, saving   |
| `edits.py`         | the MCP write tools' rules: one item, one mark, one item's notes or the daily targets at a time, as the app does      |
| `app.py`           | the HTTP layer: routes, the write checks, error mapping, and where `/api/mcp` is served (§3.1)                        |
| `mcp_server.py`    | the MCP endpoint: the SDK server, its token check, and the tools (§3.1)                                               |
| `oauth.py`         | OAuth connections: clients, consent requests, codes, grants, rotating refresh tokens, access tokens (§3.3)             |
| `oauth_api.py`     | OAuth's HTTP routes: discovery, authorize, the consent screen's calls, token, revoke, Connections (§3.3)               |
| `backup.py`        | the daily `VACUUM INTO` copy                                                                                          |
| `cli.py`           | `tracker-admin`                                                                                                       |
| `seed.py`          | `tracker-admin seed-demo`: a demo account, three weeks of marks and two items' details, locally                       |

### 1.1 Insights

`insights.py` is a read-only view of one user's weeks. The /ask page and the MCP server both read
through it. It counts the way the screen counts, so an answer never contradicts the week (§9).

While Daily goal is off (K85), the readers give no daily target and no met days. `goals` has
`exercises_a_day` and `foods_a_day` null and `daily_goal: false`. In `week_summary` and `weeks`,
`daily_target`, `days_met` and each day's `met` are null. In `consistency`, `daily_target`,
`days_met`, `met_day_rate` and `met_day_streak` are null. Item goals (`goal_met`, `goals_met`,
`goal_met_rate`, `goal_week_streak`) don't change. The rule functions stay as they are; the switch
applies where a reader builds its output.

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
| `item_history(conn, user_id, section, item_id, weeks, today)` | one item over the last `weeks` weeks: its `name`, its whole `notes` (uncut), and per week `in_plan`, `target`, the marks and their counts. A week that doesn't show the item reads as empty, as on screen                                                           |
| `goals(conn, user_id, today)`                                 | today's week's items with their goals, `exercises_a_day`, `foods_a_day`, and `note`, the My goals text from settings (`""` when there is none)                                                                                                                      |
| `consistency(conn, user_id, section, weeks, today)`           | over the last `weeks` weeks: the days up to today, how many met the daily target and the rate; the goals of the finished weeks, how many were met and the rate; the current runs of met days and of weeks with every goal met                                       |

Every reader keeps these rules:

- `today` is the asker's date, passed in. The server can't know the browser's date, so the
  module never reads the clock.
- Weeks are Monday `YYYY-MM-DD` keys. Another key, an unknown section, or a week count outside
  1–26 raises `InsightsError`, a `ValueError` whose `field` names the argument.
- Keys are snake_case, and no user or session field appears. The return types are `TypedDict`s.
- Names are cut to 100 characters, because they reach a model as text. The readers of many items
  (`week_summary`, `weeks`, `goals`) cut a note at 500 characters, a longer one ending in "…".
  `item_history`, one item's reader, gives its whole note (up to 20,000), so an agent reads it
  there before writing a note back. An item's `notes` are its details' (§3), the same in every
  week, never a week's plan's.
- A reader reads only `user_id`'s rows and writes nothing.
- A `missed` day counts in `done` and shows in `missed`. Read `goal_met` beside the kind counts.

## 2. Data model

| Table               | Key                                 | Columns                                                                                                                                                                                                            |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`             | `id`                                | `username` (unique, case-insensitive; the lower-cased email for a signed-up account), `password_hash`, `disabled`, lockout counters, `created_at`, `email_confirmed_at`                                            |
| `sessions`          | `token_hash`                        | `user_id`, `created_at`, `last_seen`, `expires_at`                                                                                                                                                                 |
| `invites`           | `token_hash`                        | `kind` (`invite` or `reset`), `username`, `user_id` (resets), `expires_at`, `used_at`, `mailed` (a reset sent by email)                                                                                            |
| `confirmations`     | `token_hash`                        | `user_id`, `created_at`, `expires_at`, `used_at`: confirm-your-email links                                                                                                                                         |
| `mail_log`          | `id`                                | `user_id`, `kind` (`confirm` or `reset`), `sent_at`: one row per email attempted (a failed send still counts), for the limits                                                                                      |
| `api_tokens`        | `token_hash`                        | `user_id`, `name`, `prefix` (unique per user), `scope` (`read` or `write`), `created_at`, `last_used_at`: personal API tokens (§4)                                                                                 |
| `oauth_requests`    | `id_hash`                           | `client_id`, `client_name`, `client_host`, `redirect_uri`, `code_challenge`, `resource`, `scope`, `state`, `created_at`, `expires_at`: a request waiting for the consent screen. No `user_id`: it exists before anyone signs in (§3.3) |
| `oauth_grants`      | `id`                                | `user_id`, `client_id`, `client_name`, `client_host`, `scope` (`read` or `write`), `resource`, `created_at`, `expires_at`, `last_used_at`, `refresh_hash`, `prev_refresh_hash`, `grace_until`, `grace_pair`, `generation`: a connection (§3.3) |
| `oauth_retired`     | `(grant_id, refresh_hash)`          | the hashes of a grant's replaced refresh tokens, kept so a reused one is recognised |
| `oauth_codes`       | `code_hash`                         | `grant_id`, `client_id`, `redirect_uri`, `code_challenge`, `resource`, `expires_at`, `redeemed_at`: one authorization code |
| `oauth_access`      | `token_hash`                        | `grant_id`, `created_at`, `expires_at`: an access token |
| `settings`          | `user_id`                           | `accent`, `daily_pick`, `food_pick` (K57), `item_sections` (JSON or NULL, K66), `goals` (My goals, `''` for none)                                                                                                  |
| `plans`             | `(user_id, section, week)`          | `items_json`, `rev`                                                                                                                                                                                                |
| `ticks`             | `(user_id, section, week, item_id)` | `days`, `partial`, `missed`, `solid`, `hatch`: 7-bit masks (bit 0 is Monday); see below                                                                                                                            |
| `ask_log`           | `id`                                | `user_id`, `asked_at`: one row per question claimed (a failed answer still counts), for Ask's caps. It holds nothing of the question or the answer                                                                 |
| `ask_conversations` | `(user_id, id)`                     | `title` (the first question, trimmed and cut to 80 characters), `created_at`, `updated_at`: Ask's history (§3.2). The id is the account's own                                                                      |
| `ask_turns`         | `(user_id, conversation_id, seq)`   | `question`, `answer`, `stop` (`end_turn`, `max_tokens`, `refused`, `error` or `cancelled`), `asked_at`: one question and its answer, text only. Only `end_turn` and `max_tokens` keep an answer; any other is `''` |
| `item_details`      | `(user_id, section, item_id)`       | `details_json` (one document per item for every week: `{notes?, fields?}`), `rev`                                                                                                                                  |

`section` is `exercise` or `diet`, the registry's sections (`types.py`). `plans` and `ticks` CHECK
it in the schema, so a new section there needs a table rebuild. `item_details` has no such CHECK:
the API checks the section against the registry. Every row cascades from its user, and an Ask turn from its conversation. Tokens and session ids are
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

Version 7 adds `item_details` and moves each item's note into it. Per user, section and item, the
note comes from the latest week whose copy of the item has a non-blank one, the first such copy in
that week, trimmed. It is stored as `{"notes": …}` at revision 1. Items without a string `id` and
`name`, ids outside 1 to 128 characters and `__proto__` are skipped, as the normalisers skip them.
The step finishes on any `items_json` and can run again over a table already there. Plans keep
their notes in `items_json` until each is next written, but nothing reads them: `stored_items`
drops `notes` from every plan it loads.

Version 8 adds `item_sections` to `settings`, nullable: each type's item-page arrangement (K66) as
compact JSON in `item_sections.py`'s normal form, or NULL for every page in the default order with
every section shown. Existing rows read as NULL.

Version 9 adds `goals` to `settings` (default `''`), so every saved row reads as having no goals.
Version 10 adds `ask_log`, indexed by user and time and by time alone, for Ask's caps (§3.2).
Version 11 adds `ask_conversations` and `ask_turns`, Ask's history (§3.2). A conversation is keyed
by its account and its id, so the same id in two accounts, as after one imports the other's file,
is two conversations.

Version 13 adds Daily goal (K85): `settings.daily_goal`, 0 or 1 with a CHECK, default 1, so saved
settings read as on.

Version 12 adds OAuth's five tables: `oauth_requests`, `oauth_grants`, `oauth_retired`, `oauth_codes` and `oauth_access` (§3.3). It only adds, so it reshapes no data. Every code and token is stored as its SHA-256 only. `oauth_grants` cascades from its user, and the other three grant tables from the grant, so removing a grant removes its codes, access tokens and retired refresh tokens. Rolling the API back leaves the tables unused.

Migrations are a list in `db.py`, and the version is its length. A step is appended, never
inserted, and no code or test names its index: `test_db.py` finds each step by its text. When two
branches each append one, the one that merges second puts its step after the other's and
renumbers it in the paragraphs above; nothing else changes.

## 3. Endpoints

All paths start with `/api`. Bodies are JSON, and errors are `{"error": "<code>"}`. Every response
carries `Cache-Control: no-store`.

**`X-Expected-User`.** A data request may name the user it expects; if the session belongs to anyone
else, it gets 401 `auth`. The client sends it on every read and write, so a tab left open as one
person can never touch the data of someone who signed in later in another tab.

**Exceptions to `/api`.** The three OAuth discovery documents sit outside it (§3.3), and nginx and the Vite dev server forward just those paths to the API.

**Writes** (`POST`, `PUT`, `DELETE`) must send `Content-Type: application/json` and an `Origin`
header equal to `PUBLIC_ORIGIN`; otherwise they get 403 `origin` or 415 `content-type`.
`/api/mcp` follows its own rules (§3.1), and `/api/oauth/token` and `/api/oauth/revoke` theirs (§3.3). `SameSite=Lax` alone would not stop a request from
another `*.itsa-pizza.com` host, because the browser counts it as same-site. Bodies over 1 MiB
get 413 `too-large` (6 MiB for `POST /api/import`, so a full account's export goes back in
whole), counted as they stream in, so a chunked body is cut off at the limit rather than read
whole. A body with nothing to send, such as logout's, is `{}`. A `DELETE` sends no body at all,
but the same `Content-Type` header.

| Method and path                            | Auth    | Does                                                                                                                  |
| ------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                             | no      | `SELECT 1`; `{"ok": true}`                                                                                            |
| `POST /auth/login`                         | no      | `{username, password}` → the account and the session cookie                                                           |
| `POST /auth/signup`                        | no      | `{email, password}` creates an account → the account and the cookie                                                   |
| `POST /auth/logout`                        | session | ends this session and clears the cookie; 204                                                                          |
| `GET /auth/me`                             | session | the account: `{username}`, plus `confirmed` (below)                                                                   |
| `GET /auth/options`                        | no      | `{mail, ask}`: whether this API sends email (§4.1) and answers questions (§3.2)                                       |
| `POST /auth/forgot`                        | no      | `{email}` → 202 `{}` for any well-formed email; a reset link goes to a matching account (§4.1)                        |
| `POST /auth/confirm`                       | no      | `{token}` confirms the email → the account; 410 `gone` otherwise                                                      |
| `POST /auth/confirm/resend`                | session | a new confirm link → 202 `{}`; refusals in §4.1                                                                       |
| `POST /invites/lookup`                     | no      | `{token}` → `{kind, username}` for a live link; 410 `gone` otherwise                                                  |
| `POST /invites/redeem`                     | no      | `{token, password}` sets the password, consumes the link, signs in                                                    |
| `GET /state`                               | session | everything the client renders (below)                                                                                 |
| `PUT /plans/{section}/{week}`              | session | `{items, rev}` → `{rev}`; 409 `conflict` with the server copy                                                         |
| `PUT /ticks/{section}/{week}/{item}/{day}` | session | `{mark}` → `{days}`, the week's seven marks for that item                                                             |
| `PUT /details/{section}/{item}`            | session | `{details, rev}` → `{rev}`; 409 `conflict` with the server copy (below)                                               |
| `PUT /settings`                            | session | `{accent, dailyPick, foodPick, dailyGoal, goals, itemSections}` → the stored settings; a missing key keeps the saved one (below) |
| `GET /export`                              | session | the export file (`architecture.md` §4)                                                                                |
| `POST /import`                             | session | an export file, merged in; → `{weeks, ticks, details, settings, conversations}` added                                 |
| `GET /ask`                                 | session | `{remaining, limit}`: questions left today, and the per-account cap (§3.2)                                            |
| `POST /ask`                                | session | `{question, conversation?, today}` → Claude's answer as a stream of events (§3.2)                                     |
| `GET /ask/conversations`                   | session | `{conversations: [{id, title, updatedAt, turns}]}`, the one updated last first (§3.2)                                 |
| `GET /ask/conversations/{id}`              | session | `{id, title, createdAt, updatedAt, turns: [{question, answer, stop, askedAt}]}`                                       |
| `DELETE /ask/conversations/{id}`           | session | deletes the conversation and its turns; 204                                                                           |
| `DELETE /ask/conversations`                | session | deletes every conversation of the account; 204, also when there are none                                              |
| `POST /mcp`                                | token   | one MCP request, answered as JSON (§3.1); a personal or an OAuth token                                                                              |
| `GET /tokens`                              | session | `{tokens: [{name, prefix, scope, createdAt, lastUsedAt}]}`, the account's personal tokens (§4)                        |
| `POST /tokens`                             | session | `{name, scope}` → 201 `{token, info}`; the one response that holds the token (§4)                                    |
| `DELETE /tokens/{prefix}`                  | session | revokes one personal token; 204, or 404 `no-token`                                                                    |
| `GET /connections`                         | session | `{connections: [...]}`, the apps connected by OAuth (§3.3)                                                            |
| `DELETE /connections/{id}`                 | session | ends one connection; 204, or 404 `no-connection`                                                                      |
| `GET /oauth/authorize`                     | no      | Claude's browser arrives here; 302 to `/#/connect/<id>` (§3.3)                                                        |
| `GET /oauth/requests/{id}`                 | no      | what the consent screen shows (§3.3)                                                                                  |
| `POST /oauth/requests/{id}/approve`        | no      | `{email, password, write?}` → `{redirectTo}`; the password is the credential (§3.3)                                    |
| `POST /oauth/requests/{id}/deny`           | no      | `{}` → `{redirectTo}` with `error=access_denied`                                                                      |
| `POST /oauth/token`                        | no      | Claude's servers: a code or a refresh token for a new pair (§3.3)                                                     |
| `POST /oauth/revoke`                       | no      | Claude's servers: RFC 7009 revocation (§3.3)                                                                          |

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

`settings` is `{accent, dailyPick, foodPick, dailyGoal, goals, itemSections?}`, or null before any are saved.

**Settings.** `PUT /settings` normalises the accent and daily picks (a bad accent reads as the
default, a pick is clamped to 1 to 8) and returns what it stored. A body without `foodPick` (K57),
`itemSections` (K66) or `goals` keeps the saved value, so a tab on older code cannot reset it.
`dailyGoal` (boolean, default `true`) is Daily goal (K85): off, the daily targets (`dailyPick`,
`foodPick`) are kept but apply nowhere, so no day is met and the insights give no daily target
(§1.1). A body without `dailyGoal`, or with a value that isn't a boolean, keeps the saved one. The
state and the export always carry it; a file without it reads as on.
`itemSections` is each tracker type's item-page arrangement, keyed by type id (`exercise`,
`food`): `{"exercise": {"order": ["history", "notes", "details", "plan"], "hidden": ["details"]}}`.
The keys are `notes`, `details`, `plan` and `history`. A shape the app never sends is refused
with 400 `invalid` and nothing changes: `itemSections` not an object, a key that is not a
registry type id, or a type whose `order` or `hidden` is not a list of strings. Within that shape
it normalises like the other settings (P29): unknown and repeated section keys drop, missing ones
follow in the default order, `hidden` keeps known keys in the default order, and a type with the
default arrangement is left out. `{}` stores the default; the state and the export leave the key
out then. Reading a stored or exported arrangement never refuses: a type this version's registry
lacks is dropped, so a newer version's value still reads.

`goals` is My goals: the person's own words about what they are aiming for, which only Ask reads
(`insights.goals`). It is trimmed of spaces, tabs and line breaks at its ends and cut to 1,000
characters, counted as code points (`normalise_goals`); blank goals are `""`. Goals that aren't a
string count as not sent, so only a string, `""` included, replaces them. The web app never sends
goals it hasn't read (`architecture.md` §7).

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
  holding an older copy still conflicts (P27 in [decisions.md](decisions.md)).
- `details` that is not an object, a `rev` that is not a whole number from 0, an unknown section,
  an item id over 128 characters, or an id the path can't name get 400 `invalid`
  (`check_details_id`). That is an id holding `/` or one that is `.` or `..`: Starlette decodes
  `%2F` before routing, so `PUT /details/exercise/a%2Fb` never reaches the route (a 404
  `not-found`), and browsers fold dot segments out of a path. The app never sends one
  (`isDetailsId`, [architecture.md](architecture.md) §7). Plans and ticks still take any id of 1
  to 128 characters, since an import can carry one; such an item just can't have details.
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
each tick row, and for Ask's history the UTF-8 bytes of each title, question and answer plus 64
for each conversation and each turn. A plan or details write, a tick that would add a row, or an
import that would take the account over it gets 413 `quota` and changes nothing. An Ask turn
that would is not saved, and its answer says so (§3.2). Writes that keep usage level or shrink
it always succeed, so a full account can still change existing ticks and trim its plans and
details. Settings do not count and are never refused. The quota measures what the account holds, not the bytes on disk, which include keys and
indexes. The client drops a refused write with a notice that the account is full (`architecture.md`
§7), and an import says the same.

**Export** writes version 5 of the file. Each section carries `details`, each item id's
`{notes?, fields?}` without revisions, and each log row is seven marks, drawings included, or
nulls. Its settings carry `goals`, which took no new version, as `foodPick` didn't: a reader
from before them drops the key, and a file without them reads as no goals. The API's export
also carries `conversations`, Ask's history, the one updated last first, in the shape
`GET /ask/conversations/{id}` returns; it took no new version either. The browser keeps no
conversations, so Settings → Export writes the device's plans, marks and settings and takes
`conversations` from this export (`architecture.md` §4); with none, the file has no such key.
Import reads:

- version 5;
- version 4, whose notes sit on plan items (K43). They lift into `details` by migration 7's rule
  (`lift_notes`: the latest week with a non-blank note, the first copy in it, cut to 500
  characters), and any `details` key in the file is ignored;
- version 3 (no notes) and version 2 (kinds only, which read as the zigzag);
- version 1, whose `true` days read as `great` and `false` days as empty.

Any other version gets `version`. A file's details document over 32 KB drops out.

**Import** applies the merge rule from `architecture.md` §4: existing weeks keep their plan; per
week, item and day a marked day keeps its mark and an empty one takes the file's; an item with
details keeps them, and one without takes the file's; and settings apply only when the account has
none, except that the file's My goals fill the account's when those are empty and never replace
goals already saved. An item whose details were cleared counts as without, and takes the file's as a new
revision, so a device holding the cleared copy conflicts. It returns what it added (`ticks`
counts the empty days that gained a mark, `details` the items that gained details; `settings` is true when the file changed the account's
settings, its goals alone included; `conversations` counts the conversations added), in one
transaction. A file's conversation is added only when the account has none with its id, and one
the account has is never changed. The file's conversations are read as `normalise_conversations`
reads them (§9): an entry with a bad id, title, time or turns list is dropped, a bad turn drops
out of its conversation, the first of each id is kept, and at most 500 conversations of 200
turns each are read from a file. A file that fails to parse gets 400 with `json`, `format` or
`version`, the same codes the client shows.

### 3.1 MCP

[mcp.md](mcp.md) says how to create a token and connect each Claude client.

`POST /api/mcp` serves the Model Context Protocol (MCP) over Streamable HTTP, so an agent such as
Claude Code can work with the account's data. The official `mcp` SDK (2.3) serves it from
the API process, through the same nginx route as every other `/api/` path. This section covers
the endpoint's rules. The tools are listed below.

- **The URL** is exactly `$PUBLIC_ORIGIN/api/mcp`. The API routes that path itself, so it never
  answers with a redirect. `/api/mcp/` is not the endpoint: it gets REST's guard, and past it a
  307 to the path without the slash.
- **Auth.** The request sends a bearer token in `Authorization: Bearer …`, and only there. It is
  a personal API token (§4, `trk_…`) or an OAuth access token (§3.3, `tka_…`). The route never
  reads the session cookie, and no REST route accepts a token. A `token` or `access_token` in the
  query string gets 400 `token-in-url` before anything else is checked, because nginx and uvicorn
  log query strings. No token, an unknown, expired or revoked one, a token with any other prefix,
  or a disabled account's token gets 401 with a `WWW-Authenticate: Bearer` header that carries
  `error="invalid_token"` (when a token was sent) and
  `resource_metadata="$PUBLIC_ORIGIN/.well-known/oauth-protected-resource/api/mcp"`. That URL is
  the protected-resource document (§3.3), and it is how a client finds the sign-in.
- **The verifier** (`Tokens` in `mcp_server.py`) reads the token's prefix and looks it up on a
  worker thread. `trk_` goes to `auth.token_user`, and the token is for this server. `tka_` goes
  to `oauth.access_user`, and the token is for the `resource` its grant was approved for; the SDK
  compares that with this server's `$PUBLIC_ORIGIN/api/mcp` and answers 401 on a mismatch.
  Expiry is checked on the server clock (`config.clock`), not the wall clock, inside each lookup:
  an access token ends at the sooner of its hour and its grant's 90 days. If the lookup itself
  fails (the database, not the token), the answer is 503 `{"error": "busy"}` with
  `Retry-After: 5`, never a 401, since a 401 tells Claude the connection is gone and it would ask
  the person to sign in again.
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

| Tool           | Arguments (defaults)                                                      | Returns                                                                   |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `week_summary` | `section` (`exercise`), `week` (this week)                                | One week: each item's marks against its goal, and the met days            |
| `weeks`        | `section` (`exercise`), `start` (3 weeks before `end`), `end` (this week) | `week_summary` for each week from `start` to `end`, 26 at most            |
| `item_history` | `item_id`, `section` (`exercise`), `weeks` (8)                            | One item's goal and marks over the last `weeks` weeks, and its whole note |
| `goals`        | none                                                                      | This week's goals for both sections, daily targets and the note           |
| `consistency`  | `section` (`exercise`), `weeks` (8)                                       | Met-day and goal-met rates over the last `weeks` weeks, streaks           |

`week_summary`, `weeks` and `goals` cut each item's `notes` at 500 characters, a longer note
ending in "…", and their descriptions say so. `item_history` returns the item's whole note as
`notes`. `NOTE_HELP` and the `note` argument of `add_item` and `update_item` tell the agent to read
it there before writing a note back, since a `note` replaces the whole note.

A refused argument (a `week` that is not a Monday, an unknown `section`, a `weeks` outside 1
to 26) returns a tool result with `isError: true` whose text names the field, as `week: must be a
Monday, written YYYY-MM-DD`. It is not a JSON-RPC error. A week so near the year 1 or 9999 that
the weeks around it can't be counted gets `date: a week or date is out of range`.

**Write tools.** These change John's plans, marks and daily targets as the app does. Each needs a
`write` token or connection. A `read` one gets a tool error, "this connection is read-only", which
tells the person to create a write token in Settings › Connections or to reconnect and allow changes. The rules live in `edits.py`, over `data.put_plan`'s rules, `data.set_tick`,
`data.put_settings` and, for a note, `data.set_notes_locked` (`put_details`' rules), so REST's
endpoints and limits are unchanged.

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
  copied, `defaults`, or null when nothing was copied: the week had its own plan, or the call
  changed only the note. `rev` is the week's plan revision, 0 for a week still without its own.
- **Item fields use the app's words.** An exercise has `name`, `sets` (0 to 20), `reps` (0 to
  9999), `seconds` (0 to 3600), `per_side`, `weight_kg` (0 to 500), `times_a_week` (0 to 7) and
  `note` (up to 20,000 characters). A food has `name`, `times_a_week` and `note`. They are stored
  as `name`, `sets`, `reps`, `duration`, `perSide`, `weight`, `target` and `notes`; `edits.WORDS`
  holds that mapping. A 0, or an empty `note`, clears the field.
- **A note is the item's, not the week's.** `note` is the item's notes in its details (§3), one
  copy for every week, which the app's row and item page read. It never goes into a plan. The
  plan write and the note are one transaction, so a note refused for the quota or for the 32 KB
  cap leaves the plan as it was. A call that changes only the note writes no plan, so a week
  without its own plan copies nothing and goes on following its source. The note moves the
  details' revision on, so a device holding the older copy gets a 409 on its next write and adopts
  the agent's, as after any details conflict. Setting the same note again writes nothing. An exercise counts reps or
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
  target not given keep their saved values, or the defaults while none are saved. It still saves
  the numbers while Daily goal is off, which only the app can turn on, and its result has
  `daily_goal`.
- **Conflicts.** A plan write that meets a newer `rev` re-reads the week and applies the change
  again, up to three tries in all, then fails with a tool error. The app adopts the server's copy
  on its next read, as after any 409 (architecture.md §7).
- **Refusals** are tool results with `isError: true`, whose text names the field, as
  `item_id: no item xq in the week of 2026-10-19`. They cover a week that is not a Monday, an
  unknown item id, an out-of-range or unknown field, a strict-validation problem, a note over
  32 KB as stored (`note: is too long to save`), three conflicts in a row and a full account
  (`quota`). Nothing is changed when a call is refused, with one
  exception, which the app shares: a mark refused for the quota on a week without its own plan
  leaves that week's copied plan in place. The week shows the same items either way.
  Arguments that don't fit a tool's schema (a `mark` outside the nine, text for a number) are
  refused by the SDK, whose text names the argument and what it accepts.

Each result gives what was there before, so a change can be undone by hand (there is no undo
table):

| Tool                 | Returns                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the three item tools | `section`, `week`, `item` (the item added, updated or removed), `before` and `after` (the week's items, in the app's words, each with its `note`), `rev`, `copied_from` |
| `mark_day`           | `section`, `date`, `week`, `day` (0 is Monday), `item_id`, `before` and `after` (the day's mark or null), `days` (the item's seven marks), `rev`, `copied_from`         |
| `set_daily_targets`  | `before` and `after`, each `{exercises_a_day, foods_a_day}`                                                                                                             |

`remove_item` leaves the item's marks in the log, uncounted, as the app does. Adding the item back
gives it a new id, so those marks stay detached; `before` holds the item for reference.

### 3.2 Ask

Ask answers a person's questions about their own tracking with Claude. It is on when
`ANTHROPIC_API_KEY` is set (§6). With no key, `GET /auth/options` says `"ask": false`, and `GET` and
`POST /ask` get 503 `ask-off`. Unsetting the key turns Ask off with no deploy. The history routes
(below) work with Ask off, so a person can always read and delete what was kept.

**The question.** `POST /ask` is a write, so it passes the same Origin and Content-Type checks as
every other write, and it needs a session. The body is `{question, conversation?, today}`:

- `question` is 1 to 2,000 characters after trimming spaces and line breaks at its ends.
- `conversation` is the id of the conversation the question continues, as `start` gave it. Left
  out, the question starts a new conversation. It is a string of 1 to 64 letters, digits, `_` or
  `-`. An id the account doesn't have, someone else's included, gets 404 `not-found` before the
  question is claimed, so it costs nothing.
- `today` is the browser's date, `YYYY-MM-DD`. It must be within a day of the server's date in
  `TIMEZONE` (§6, `config.today()`), as the date in any zone within a day of it is. The server
  can't know the browser's date, and "this week" depends on it.

Anything else gets 400 `invalid` and costs no question, and so does any other key in the body.
A `history`, which the browser sent before the server kept the history, is one of them.

**The caps.** Each account may ask `ASK_PER_DAY` questions (30) in any rolling 24 hours. All
accounts together may ask `ASK_PER_DAY_TOTAL` (300). A question is claimed in `ask_log` under the
write lock before Claude is called, as `mail_log` is, so parallel questions can't pass a cap.
Over a cap, the answer is 429 `too-many` with `Retry-After` and `retryAfter`: the seconds until the
oldest question in the way leaves the rolling day. A claimed question counts even when the answer
then fails, as a failed email does: a failed call to Anthropic can still cost tokens. `GET /ask`
returns `{remaining, limit}`. `remaining` is the smaller of the account's questions left and
everyone's; `limit` is `ASK_PER_DAY`. Outside the app, a spend limit in the Anthropic Console
bounds the cost too (deployment.md §4).

**The stream.** After the checks, the answer is `text/event-stream` with `Cache-Control:
no-store` and `X-Accel-Buffering: no`, so nginx passes each event on at once. Each event is an
`event:` line and one `data:` line of JSON:

| Event   | Data                                         | When                                                                     |
| ------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `start` | `{"remaining": 29, "conversation": "Kq3x…"}` | first, with the questions left after this one and the conversation's id  |
| `tool`  | `{"name": "week_summary"}`                   | as each tool runs, before its result goes back to Claude                 |
| `text`  | `{"delta": "Three of four"}`                 | each piece of the answer, in order; join them for the markdown           |
| `done`  | `{"stop": "end_turn", "saved": true}`        | last, when the answer is complete: `end_turn`, `max_tokens` or `refused` |
| `error` | `{"error": "busy"}` or `{"error": "error"}`  | last, in place of `done`, when the answer failed                         |

- `end_turn` is a complete answer. `max_tokens` is an answer cut short: it ran out of output
  tokens, or reached the last round still wanting a tool. `refused` means Claude declined. The
  text sent before a refusal is partial and should be discarded.
- `busy` means Anthropic was unreachable, rate limited or overloaded; asking again later can
  work. `error` means the request was refused (a bad key, say) or something failed here.
- A `text` delta of `"\n\n"` separates a new block of text from the one before, such as the text
  after a tool round.
- During a silence of 15 seconds the stream sends the comment `: keep-alive`, so nginx's 60-second
  read timeout never fires while Claude thinks or a tool runs. Clients skip comments.
- A client that disconnects ends the stream, and the request to Anthropic is cancelled with it.
- `saved` says whether the turn was kept. It is false when the account is full (§3), and when
  the conversation was deleted while the answer streamed. The answer was still streamed. When a
  new conversation's first turn isn't kept, the conversation isn't either: the next question
  leaves `conversation` out.

**The history.** The server keeps each conversation, and the browser names it by its id.

- A new conversation is created when its first question is claimed. Its id is 16 random
  URL-safe characters (`secrets.token_urlsafe(12)`), and its title is that question, trimmed
  and cut to 80 characters (code points).
- Each question and its answer are saved as one turn when the answer ends, on a worker thread
  with its own connection, before `done` goes out. After `end_turn` or `max_tokens` the turn
  keeps the whole answer as streamed, the `"\n\n"` breaks included, trimmed and cut at 64,000
  characters. A refused or failed answer (`error`, for `busy` too), or one whose client left
  (`cancelled`), keeps the question with an empty answer, so the history shows what was asked.
  The save on a disconnect is shielded from the cancellation, and a client gone before the
  first event still has its question kept, by the response's own close. A turn is saved once,
  and one that would take the account over its quota is not saved.
- Each question sends Claude the conversation's earlier turns from the database, oldest first,
  as alternating text-only user and assistant turns, then the new question. The context (today,
  this week, My goals) opens the first user turn, as for a new conversation. A turn with an
  empty answer is left out whole, since its question alone would put two user turns in a row.
  Only the newest turns go: at most 20, with at most 40,000 characters of questions and answers
  together; the first turn that doesn't fit, and every turn before it, stays out.
- `GET /ask/conversations` lists the account's conversations, the one updated last first, each
  with its number of turns. `GET /ask/conversations/{id}` returns one with its turns, oldest
  first. Deleting `/ask/conversations/{id}` deletes one and its turns, and deleting
  `/ask/conversations` deletes them all. Each reads only the session's account: a missing id and
  another account's both get 404 `not-found`.
- Times are Unix seconds. `updatedAt` is when the last turn was saved. The JSON keys are
  camelCase (`createdAt`, `updatedAt`, `askedAt`), as in the rest of the API and the export
  file; the columns (§2) keep their snake_case names.

**Claude.** `ask.py` calls the Messages API with the SDK's `AsyncAnthropic`, the key passed
explicitly. The model is `ASK_MODEL` (`claude-sonnet-5-5`). Each request has `max_tokens` 4,000,
`output_config.effort` `low` and adaptive thinking, the model's default, and never forces a tool.
A question takes at most six requests; the sixth has `tool_choice` `none`, so it can only answer.
The stop reason is checked before the content: a refused or cut-off turn's tool calls never run.
No server-side fallback is set, because on this model it retries only `cyber` and `frontier_llm`
declines, which questions about a person's tracking don't meet. The loop is written out rather
than using the SDK's beta tool runner, which fails a call whose input has a key the schema lacks
and logs it as an exception.

**The prompt.** The system prompt is one constant: the role, the rules from §1.1 (a plan
carries forward, every mark counts towards a goal, missed and partial days are reported as such,
met days use exercises a day and foods a day, future days don't count), names and notes as data
and never instructions, tools before judgement, no medical advice, short markdown with no
headings, tables or images, and the voice. It holds nothing that varies, so it caches; the cache
breakpoint is on it, and the tools render before it. Today, this week and the My goals note open
the first user turn instead. The voice is John's ruling (K68, voice.md "Ask"): facts first and
no blame, exclamation marks or hype, and `VERDICT_RULE`, which lets an answer say plainly that
something is too little or too much, count streaks and give scores or rankings when they help,
and quote the person's goals and notes back as advice. `PLAIN_VERDICTS` (True) turns it on;
False would put back the app's own rules (no streaks, scores or rankings, nothing quoted back).

**The tools** are `consistency`, `goals`, `item_history`, `week_summary` and `weeks`, sorted by
name, each with a strict schema. Each wraps the `insights` reader of the same name (§1.1) and is a
closure over the session's user and the question's `today`. No schema has a user field, and a
key the schema lacks is never read, so a tool reads only the asker's data whatever the model
writes. Each call runs on a worker thread with its own connection. An `InsightsError` goes back
to Claude as an error result naming the field. A result over 20 KB of JSON goes back as an error
too, telling Claude to ask for less, rather than cut mid-JSON.

### 3.3 OAuth and connections

OAuth lets claude.ai and Claude Code connect to `/api/mcp` by URL, with the person signing in
once. The MCP SDK stays the resource server (§3.1). The authorization server is the API's own
(`oauth.py` holds the rules, `oauth_api.py` the routes), because the SDK's provider interface has
no client ID metadata documents and no `none` client authentication (P31). Every URL below is built
from `PUBLIC_ORIGIN`, never from the request's `Host`. The issuer is that origin exactly, with no
trailing slash, and the resource is `$PUBLIC_ORIGIN/api/mcp`.

**Discovery.** Three `GET` routes answer JSON with no sign-in. They sit outside `/api`, and nginx
forwards exactly these paths to the API; any other `/.well-known/` path is a 404 there
([deployment.md](deployment.md) §2).

| Path                                                 | Answers                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/.well-known/oauth-protected-resource/api/mcp`      | RFC 9728: `resource`, `authorization_servers` (the origin), `scopes_supported` (`read`, `write`), `bearer_methods_supported` (`header`). The 401 from `/api/mcp` names this URL.                                                                                                                         |
| `/.well-known/oauth-protected-resource`              | the same document, for a client that asks at the root                                                                                                                                                                                                                                                    |
| `/.well-known/oauth-authorization-server`            | RFC 8414: `issuer`, the `authorization_endpoint`, `token_endpoint` and `revocation_endpoint` under `/api/oauth/`, `response_types_supported: ["code"]`, grant types `authorization_code` and `refresh_token`, `code_challenge_methods_supported: ["S256"]`, `none` for client authentication, `client_id_metadata_document_supported: true` and `authorization_response_iss_parameter_supported: true`. No registration endpoint. |

**Clients are client ID metadata documents (CIMD).** There is no Dynamic Client Registration and no
pre-registered client ID (P32). A `client_id` is an `https://` URL, such as
`https://claude.ai/oauth/mcp-oauth-client-metadata` (claude.ai), Claude Code's document on the
same host, or `https://chatgpt.com/oauth/client.json` (ChatGPT). The API accepts one only when:

- its host is in `OAUTH_CLIENT_HOSTS` (§6), matched exactly: no subdomain, port, user, query,
  fragment or dot segment, and at most 255 characters;
- the document fetches within 5 seconds, with no redirect followed, answers 200 and is at most 5
  KiB of JSON;
- the document's `client_id` equals the URL; the client can sign in without a secret, because
  its `token_endpoint_auth_method` is `none` or its `token_endpoint_auth_methods_supported` list
  holds `none` (ChatGPT's prefers `private_key_jwt` and lists `none` too: MCP SEP-3149, where the
  list is what the client can use and the singular only a preference);
- `redirect_uris` holds at least one `https://` or plain-`http` loopback address (any other
  entry, such as `javascript:`, is dropped), `grant_types` (if present) includes
  `authorization_code` and `response_types` (if present) includes `code`;
- the `redirect_uri` of the request is in `redirect_uris`, or is a plain-`http` loopback address
  (`localhost`, `127.0.0.1`, `::1`) that matches a registered loopback one in host, path and query on
  any port (RFC 8252, for Claude Code's local callback).

The document's `client_name` (1 to 64 printable characters; else the host) is stored with the
grant, so Settings can say "Claude · claude.ai". Good documents are cached in memory for an hour
(32 at most); a refusal is never cached.

**`GET /api/oauth/authorize`** is where Claude sends the person's browser. A request whose
client or redirect cannot be checked gets a 400 text page and is never redirected to. After
that, an error goes back to the client's `redirect_uri` as a 302 with `error`, `state` and `iss`:
`invalid_request` (a repeated parameter; a missing or malformed PKCE challenge, which must be
`S256` and 43 to 128 characters from the unreserved set; a `state` over 1024 characters or not
printable), `unsupported_response_type` (anything but `code`), `invalid_target` (a `resource`
other than ours), `invalid_scope` (a `scope` of anything but `read` and `write`) and
`temporarily_unavailable` (1,000 requests are already pending). A good request is held server-side
for 10 minutes under a random id, and the browser gets a 302 to `$PUBLIC_ORIGIN/#/connect/<id>`
(P35). The `scope` asked is only shown on that screen; the person's choice decides the grant.

**The consent screen's calls.** The app route `#/connect/<id>` shows signed in and signed out,
and survives a sign-out. These calls all answer with `Cache-Control: no-store`.

- `GET /api/oauth/requests/{id}` → `{clientName, clientHost, redirectHost, scope, expiresAt}`
  (`scope` is `"read"`, `"write"`, `"read write"` or null). It needs no session: the id, which
  only the browser sent here holds, is the credential. 404 `no-request` when the id is unknown or
  past its 10 minutes.
- `POST /api/oauth/requests/{id}/approve` with `{email, password, write?}` → 200 `{redirectTo}`,
  the client's redirect with `code`, `state` and `iss`. It follows REST's write guard (§3). The
  password is asked even when the person is signed in, goes through the same hasher, lockout and
  `busy` queue as a login (§4), and creates no session or cookie (P34). `write` must be a boolean
  and defaults to false, so the grant is `read` unless the box was ticked. Errors: 400 `invalid`
  (a missing or mistyped field), 404 `no-request`, 401 `invalid` (a wrong email or password; it
  counts towards the lockout), 423 `locked` with `retryAfter` and `Retry-After`, 503 `busy` with
  `retryAfter: 1`, 403 `disabled` (only when the account is turned off between the password
  check and the approval; before it, the password check answers 401 `invalid`), and 409
  `too-many` when the account already holds 10
  connections (the request is kept for another try).
- `POST /api/oauth/requests/{id}/deny` with `{}` → 200 `{redirectTo}`, the client's redirect with
  `error=access_denied`, `state` and `iss`. The body must be JSON, even empty, or the write guard
  answers 415.

**`POST /api/oauth/token`** and **`POST /api/oauth/revoke`** are for Claude's servers. They take
`application/x-www-form-urlencoded` and send no `Origin` and no cookie, so `guard` applies
`form_refusal` instead of REST's write rules: POST only (405), nothing in the query string
(400, since a URL lands in logs), an `Origin` that is absent or equal to `PUBLIC_ORIGIN` (403),
the form content type (400), and a body of at most 8 KiB (413, counted as it streams) with at most
16 fields and none repeated. Their errors are OAuth's (RFC 6749 §5.2): `{"error": …,
"error_description"?}`, with `Cache-Control: no-store` and `Pragma: no-cache`.

- `grant_type=authorization_code` needs `client_id`, `code`, `redirect_uri` and `code_verifier`.
  The code is bound to the client, the redirect, the PKCE challenge and the resource. Redeeming
  it a second time, within its 60 seconds and with the same client, redirect, resource and
  verifier, ends the whole connection; a second try that fails any of those ends nothing.
- `grant_type=refresh_token` needs `client_id` and `refresh_token`. Each refresh rotates both
  tokens. For 60 seconds the replaced refresh token still gets the same new pair, so a client
  that retried after a lost reply is not cut off: the new pair is kept for those 60 seconds,
  sealed with the replaced token, and the next sweep clears that copy once they are over. After
  that the old token is retired, and presenting it ends the connection. A token that matches nothing ends nothing, so a guess cannot cut a person
  off.
- Success is 200 `{access_token, token_type: "Bearer", expires_in, refresh_token, scope}`, with
  `scope` as `"read"` or `"read write"`. A `resource` sent must equal ours, else 400
  `invalid_target`.
- Failures: 400 `invalid_request` (a missing field, a bad form), 400 `unsupported_grant_type`, 401
  `invalid_client` (no `client_id`; this API has no client secrets), 400 `invalid_grant` (a wrong
  or spent code, verifier, redirect or client, an ended or expired connection; the description
  names why only when the connection ended), and 503 `temporarily_unavailable` with
  `Retry-After: 1` when the write lock stayed busy.
- `/revoke` takes `token` and `client_id` and answers 200 `{}` for any well-formed request. An
  access token ends itself; the current refresh token ends its connection. A grant id alone ends
  nothing.

**Connections in Settings.** `GET /api/connections` (session) →
`{connections: [{id, clientName, clientHost, scope, createdAt, lastUsedAt, expiresAt, isNew}]}`,
newest first. `scope` is `"read"` or `"write"`, `lastUsedAt` is null until first use, and
`isNew` is true for 24 hours after approval, on the server's clock. An approval whose code was
never redeemed is not listed. `DELETE /api/connections/{id}` (session, REST's write guard) → 204,
or 404 `no-connection` for an unknown id or another account's; the connection's tokens stop
working at once.

**Lifetimes and caps** (P33, P36):

| What                                   | Value                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------- |
| A connection                           | 90 days from approval, however much it is used; the person reconnects after |
| An access token (`tka_`)               | 1 hour, never past its connection                                           |
| An authorization code (`tkc_`)         | 60 seconds, single use                                                      |
| A replaced refresh token's grace       | 60 seconds                                                                  |
| A pending request                      | 10 minutes                                                                  |
| Personal tokens per account            | 20; the 21st gets 409 `too-many` (§4)                                       |
| Connections per account                | 10; an approval beyond it gets 409 `too-many`                               |
| Pending requests, all accounts         | 1,000; `/authorize` then answers `temporarily_unavailable`                  |

Access tokens are `tka_` and 43 random characters. A refresh token is `tkr_<grant id>.<43
characters>`, so a wrong secret can be logged against its connection. A code is `tkc_` and 43
characters. All are stored as SHA-256 hashes. Expired rows are swept when a request is created, when one is
approved and when connections are listed.

**Ending a connection.** Removing it in Settings, a client's revoke, reusing a spent code or a
retired refresh token, its 90 days, a password reset, `tracker-admin disable` and
`tracker-admin revoke-sessions` all end it. The last three go through `auth.end_credentials`,
which deletes the account's personal tokens and connections in the same transaction as the rest
of the change (P37). `revoke-sessions` prints how many connections it ended.

**Logging.** Nothing here logs a token, a code, a password or a request id. The API logs
`oauth authorize from <host>: waiting for consent`, `oauth grant <id> approved for user <n> by
<client_id>`, refusals with a reason (`oauth authorize … refused: …`, `oauth <grant type>
refused: …`), a connection's end with its reason (`ended: expired`, `revoked by its client`,
`used twice`, `ended in Settings`), and, at most once a minute per connection, a refresh with a
wrong secret.

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
- **API tokens** let a program act as the account, for the MCP endpoint. A person creates one in
  Settings › Connections (below), and an admin with `tracker-admin token create <email> --name
  <name>`. Either way it is `trk_` and 43 random URL-safe characters, shown once. The database
  keeps only its SHA-256 hash and its `prefix`, the 8 characters after `trk_`, which names the
  token without revealing it. A token has the `read` scope, or `write`. A name is 1 to 64
  printable characters once trimmed. Tokens do not expire, and `last_used_at` moves at most once
  a day. Removing one in Settings or `token revoke` ends it; `revoke-sessions`, a reset (from
  `tracker-admin` or by email) and `disable` end them all. A disabled account cannot create one,
  and its tokens stop working at once. No REST route accepts a token, and nothing logs one: the
  CLI prints it to its own output only.
  - `GET /api/tokens` → `{tokens: [{name, prefix, scope, createdAt, lastUsedAt}]}`, oldest first;
    never a hash or a token. `prefix` is the 8 characters, without `trk_`.
  - `POST /api/tokens` with `{name, scope}` (`scope` is `read` or `write`) → 201
    `{token, info}`, where `info` has the list's shape. This is the one response that holds the
    token. 400 `invalid` for a missing or mistyped field or any other scope; 400 `token-name` for
    a name outside 1 to 64 printable characters; 409 `too-many` at 20 tokens (P36). The count and
    the insert share one write transaction, so two requests cannot both take the last place. The
    CLI is not limited.
  - `DELETE /api/tokens/{prefix}` → 204, or 404 `no-token` for a prefix that is unknown or
    another account's. The prefix is the 8 characters, with or without `trk_`.

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
docker compose exec fitness-api tracker-admin disable alice@example.com  # blocks login, ends sessions, tokens and connections
docker compose exec fitness-api tracker-admin enable alice@example.com
docker compose exec fitness-api tracker-admin revoke-sessions alice@example.com  # ends sessions, tokens and connections
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
the account has none, fills only empty days and gives details only to items that have none, so a
second run adds nothing, and an existing account keeps its password and every mark and note it
has. The demo uses the default plan's ids, and shows every kind in every drawing, met and unmet
goals, and a day over the pick. Push-ups and Fish get notes and fields, so the item page has
something to show. The command prints what it added ("Added 6 week plans, `<n>` marks and
details for 2 items.", the marks depending on the day of the week), or "Nothing to add" when the account already has all of it.

## 6. Configuration

| Variable            | Default               | Meaning                                                                   |
| ------------------- | --------------------- | ------------------------------------------------------------------------- |
| `DATA_DIR`          | `/data`               | holds `fitness.db` and `backup/`                                          |
| `PUBLIC_ORIGIN`     | (required)            | e.g. `https://tracker.itsa-pizza.com`; checked on writes, used in links   |
| `COOKIE_SECURE`     | `true`                | `false` for plain-http local runs; the cookie is then `session`           |
| `BACKUP_KEEP`       | `7`                   | daily copies kept in `$DATA_DIR/backup/`                                  |
| `MAX_USERS`         | `50`                  | sign-up closes once this many accounts exist; `0` turns sign-up off       |
| `RESEND_API_KEY`    | (unset)               | turns mail on (§4.1); a key with sending access is enough. Never logged   |
| `MAIL_FROM`         | (required with a key) | the From line, `Name <address>` on a domain verified in Resend            |
| `MAIL_PER_HOUR`     | `30`                  | emails of every kind, across all accounts, in any rolling hour; 1 or more |
| `TIMEZONE`          | `Europe/Amsterdam`    | the IANA zone that decides today and this week for the MCP tools and Ask  |
| `ANTHROPIC_API_KEY` | (unset)               | turns Ask on (§3.2). Never logged                                         |
| `ASK_MODEL`         | `claude-sonnet-5-5`   | the Claude model Ask uses                                                 |
| `ASK_PER_DAY`       | `30`                  | questions per account in any rolling 24 hours; 1 or more                  |
| `ASK_PER_DAY_TOTAL` | `300`                 | questions across all accounts in any rolling 24 hours; 1 or more          |
| `OAUTH_CLIENT_HOSTS` | `claude.ai,claude.com,chatgpt.com` | the hosts whose client metadata documents may name an OAuth client (§3.3): host names separated by commas, matched exactly. A bad value stops the API at startup |

**Logging.** The API's own lines go to stderr at info and above (`docker logs fitness-api`), once
each, as `INFO:  tracker_api.<module> …`. They don't also go on to the root logger, which the MCP
SDK sets up with a plain handler of its own (`logging.basicConfig`). The
logs never hold what a person wrote or was told: no question, history, answer, note, goals or
item name, and no email address. For Ask they hold, per request to Anthropic, the request id, the
stop reason and the token counts (input, output, cache read, cache write), and per question the
outcome, the rounds and the totals. An error is logged by its class, status and request id, since
an error's message can quote the request. `ANTHROPIC_LOG` stays unset in production: at `debug`
the SDK logs every request body.

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
- **Personal API tokens have no lifetime at all.** A token works until something revokes it:
  removing it in Settings, `token revoke`, `revoke-sessions`, a reset or `disable`. Settings and
  `token list` show when each was last used, to the day, so a forgotten one is easy to spot and
  revoke. A claude.ai or Claude Code connection, by contrast, ends after 90 days (§3.3).
- **A pending connection request's id is in the access logs.** `/api/oauth/authorize` sends the
  browser to `/#/connect/<id>`, and the consent screen fetches `/api/oauth/requests/<id>`, so nginx
  logs the id. It is good for 10 minutes and for one approval, and approving still needs the
  account's password, so a leaked id alone lets nobody connect. The API's own logs never hold it.
- **Anyone can start a connection request.** `/api/oauth/authorize` needs no sign-in, so a
  stranger can fill the 1,000 pending slots for 10 minutes at a time; real requests then get
  `temporarily_unavailable` until they expire. Nothing else is harmed. The request fetches a
  client document only from an allow-listed host, so it is no open fetcher.
- **Ask sends a person's data to Anthropic.** A question goes to Anthropic's API with the
  conversation so far, the person's My goals note, and whatever the tools read for it: the plans,
  marks, item names, notes and goals of the weeks Claude asks about. The logs hold none of it
  (§6). Anthropic's own retention applies to what it receives. A person's names
  and notes can't steer the answer to anyone else, because every tool reads only the asker's data.
  At worst they steer the asker's own answer.
- **Ask's questions and answers are stored.** Each conversation's questions and answers are
  kept in the database (§2) and so in the daily backup (§7), which PBS copies off the VM. They
  can be personal, about diet or health. They are deleted with their conversation, by the
  person one by one or all at once, or with the account; a backup taken before keeps them
  until it ages out (seven days on the VM, longer in PBS). They are never logged (§6). The
  model's thinking and tool calls are never stored.
- **Ask can spend money until a cap stops it.** With the defaults, 300 questions a day across
  everyone, each up to six requests of at most 4,000 output tokens. The spend limit in the
  Anthropic Console is the bound that holds whatever the app does.

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
- Notes and My goals are cut in code points, as Python counts a string, so an emoji is one
  character on both sides (`Array.from` in TypeScript).

`tests/test_parity.py` runs every case in `fixtures/transfer/`, the same files the Vitest suite
runs. A rule changed on one side without the other fails one of the two suites. The
`parse/goals*.json` cases hold My goals to one normaliser, and `merge-settings.json` holds the
import's settings rule, goals filling only empty ones included. The `parse/conversations*.json`
cases hold Ask's conversations to one normaliser (`normalise_conversations`,
`normaliseConversations`): the id rule, the cuts at 80, 2,000 and 64,000 code points, the times
as whole numbers from 0 to 2^53 − 1, the five stops, no answer kept without `end_turn` or
`max_tokens`, the first of each id, and the limits of 500 conversations and 200 turns.
`merge-conversations.json` holds the import's rule: only ids the account doesn't have are added.
`tests/test_types.py` and the app's `trackerTypes.spec.ts` both read `fixtures/types/registry.json`,
so the two registries keep the same sections, types, fields, daily-target keys and new-item goals.

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
- `test_ask.py`: Ask with no network. An `httpx2.MockTransport` behind the SDK replays Messages
  API event streams, built in the documented wire format: a plain answer, a tool round, every
  tool, a refusal, `max_tokens`, the last round, 529, 429, 500, a dropped connection, a timeout,
  an error mid-stream, and 400, 401, 403 and 404. It covers the request's settings, the context
  turn, the event order, user isolation against forged tool input, error results, the 20 KB cap,
  every validation refusal (forged tool and thinking blocks included), both caps and their
  `Retry-After`, parallel claims, keep-alives, a disconnect cancelling the answer, the prompt's
  rules and the verdict switch, and that no question, history, answer or goals reach the logs.
  For the history: the earlier turn in a follow-up's request, read from the database; a
  `history` or any other key refused; what each stop saves, a client that leaves included; the
  title; the 20-turn and 40,000-character caps; another account's id refused on read, delete and
  ask; listing, deleting one and deleting all; a full account; and a conversation deleted while
  it answers.
- `test_db.py`, `test_config.py`, `test_backup.py`, `test_cli.py`: migrations (including racing
  ones, the WAL switch, old ticks reading as `great` after step 2, every row surviving step 6
  from a populated database, step 7 lifting each item's latest note, rerunning and on an empty
  database, step 8's empty column, step 9's goals reading as none, and Ask's tables after steps 10
  and 11 holding text only and going with their user), configuration from the environment (`TIMEZONE`, and the
  week turning over at local midnight), daily copies, `tracker-admin`.
- `test_mcp.py`: the MCP endpoint through `TestClient`: `initialize`, `tools/list` and `whoami`
  with a token, on both protocol kinds, and each refusal (no, bad, revoked or disabled token; a
  cookie alone; a token in the query string; a foreign `Origin` or `Host`; a method other than
  POST; an oversized body; a redirect). Where the endpoint's rule differs from REST's, the same
  test checks a REST route too, so an exemption wider than `/api/mcp` fails. Then every tool:
  the parity cases through `week_summary`, the read tools' defaults and refusals (a week at the
  calendar's end included), a read token refused on writes, and each write's result.
- `test_oauth.py`, `test_oauth_api.py`, `test_tokens_api.py`: OAuth's storage and rules (clients and
  redirects, codes, rotation and its grace, reuse, expiry, the caps, sweeping, ending credentials
  together), then its routes (discovery, authorize and each of its errors, the consent calls, the
  token and revoke guard, Connections) and the personal-token routes. `test_mcp.py` also covers the
  verifier's prefix dispatch, expiry on the clock, the grant's resource and the 503.
- `test_edits.py`: the plan edits behind the write tools: copying a carried week first, the ids
  the server makes, each field's bounds, replaying a conflict, the quota, and marks per section.
- `test_validate.py`: the write checks REST and MCP share: week keys, plan bodies, item ids, days,
  marks and the stricter item shape for MCP writes.
- `conftest.py` gives each test a temporary database, a controllable clock, a cheap hasher and a
  mailer that records instead of sending (`mail_client`), and puts the package logger back after
  each test;
  `fixtures.py` reads `fixtures/transfer/`.
