# API

> Purpose
>
> The API service in `api/`: accounts, sessions, invites, email, the synced data, the read-only
> insights over it, programmes, Ask, the MCP endpoint, its API tokens and OAuth sign-in for Claude,
> the admin CLI and backups. It is
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
| `types.py`         | the tracker-kind registry, the port of `src/lib/trackerTypes.ts`: kinds, their fields, the first three trackers' ids  |
| `item_sections.py` | the item pages' arrangement per type (K66), the port of `src/lib/itemSections.ts`                                     |
| `validate.py`      | the port of `src/lib/storage.ts` and `src/lib/transfer.ts`, and the write checks REST and MCP share                   |
| `programme.py`     | the `tracker-programme/1` format: its check (every problem with its path), the parameters, each field's expansion, and the JSON Schema it writes to `programme.schema.json` ([programmes.md](programmes.md)) |
| `programme_replay.py` | a run's change log and its replay into dated weeks: the clocks, each change type, hand-edits, the preview and its `rev`, and a sealed day's form (§3.4) |
| `auth.py`          | password hashing, lockout, sessions, sign-up and its caps, invite, reset and confirmation tokens, personal API tokens, and the one helper that ends tokens and connections together |
| `outbox.py`        | which emails go out and when: the limits (§4.1), the links, the message                                               |
| `emails.py`        | the two emails, built to the EmailLayout card, and that card's preview                                                |
| `mail.py`          | the Resend client, and sending after the response                                                                     |
| `data.py`          | reading and writing trackers, plans, ticks, item details, settings and Ask's history; the programme library and runs (start, change, end, sealing, the lock, §3.4); import, export; the quota |
| `insights.py`      | read-only views of a user's weeks, counted as the screen counts them (§1.1)                                           |
| `ask.py`           | Ask (§3.2): the question's checks, the daily caps, the history sent, the prompt, the tools, the Claude loop, saving   |
| `edits.py`         | the MCP write tools' rules: one item, one mark, one item's notes or the daily targets at a time, as the app does      |
| `app.py`           | the HTTP layer: routes, the write checks, error mapping, and where `/api/mcp` is served (§3.1)                        |
| `mcp_server.py`    | the MCP endpoint: the SDK server, its token check, and the tools (§3.1)                                               |
| `oauth.py`         | OAuth connections: clients, consent requests, codes, grants, rotating refresh tokens, access tokens (§3.3)             |
| `oauth_api.py`     | OAuth's HTTP routes: discovery, authorize, the consent screen's calls, token, revoke, Connections (§3.3)               |
| `backup.py`        | the daily `VACUUM INTO` copy                                                                                          |
| `cli.py`           | `tracker-admin`                                                                                                       |
| `seed.py`          | `tracker-admin seed-demo`: a demo account, three weeks of marks, three items' details and a running programme, locally |

### 1.1 Insights

`insights.py` is a read-only view of one user's weeks. The /ask page and the MCP server both read
through it. It counts the way the screen counts, so an answer never contradicts the week (§9).

Each reader of one tracker takes `tracker`: an id, or a name matched without regard to case or
surrounding spaces (`find_tracker`, `tracker_of`). The user's trackers count, ended ones too. An
id the user lacks, or a name two trackers share, raises `InsightsError` naming `tracker`, with the
user's trackers or the matching ids in its text. The readers follow `data.shows_in` (spec §2):

- `week_summary` refuses a week the tracker doesn't show in, naming `week`, with why: it starts
  later, or it was deleted from that week on.
- `weeks` leaves those weeks out, so a range can come back with fewer weeks, or none.
- `item_history` reads them as weeks that don't show the item: `in_plan` false.
- `consistency` counts only the weeks the tracker shows in. The allowance for today applies only
  when the last day counted is today.
- `goals` lists only the trackers today's week shows.

A tracker keeps its own daily target (W4). While Daily goal is off (K85), the readers give no
daily target and no met days. In `goals` and `trackers`, each tracker's `daily_target` is null and
`daily_goal` is false. In `week_summary` and `weeks`,
`daily_target`, `days_met` and each day's `met` are null. In `consistency`, `daily_target`,
`days_met`, `met_day_rate` and `met_day_streak` are null. Item goals (`goal_met`, `goals_met`,
`goal_met_rate`, `goal_week_streak`) don't change. The rule functions stay as they are; the switch
applies where a reader builds its output.

A cardio tracker (K90) has no daily target at all. Its `daily_target`, `days_met`, each day's
`met` and the met-day fields of `consistency` are always null, whatever Daily goal says. A cardio item in
`week_summary`, `weeks` and `goals` also carries its session in the edit tools' words: `seconds`
(the whole session) and `distance_km`, each only when it has one. An exercise's sets, reps and
timed sets stay out of the readers.

The rules are ports of the web app's:

- `plan_source` is `planSource` (architecture.md §2): a week's own plan, else the latest earlier
  one, else the earliest. `week_items` gives the items a week shows, and `default_items` the
  defaults when nothing is planned. Only the `exercise` and `diet` trackers have defaults
  (spec §4). `cardio` and every tracker the person makes start empty.
- `total_for`, `day_counts`, `goal_met`, `goals_met` and `met_days` are `src/lib/tracker.ts`'s.
  Every mark counts towards a goal, a missed day included. A goal of 0 is never met. Only the
  items the week shows count. A day is met when its count reaches the tracker's daily target.

The readers each return a dict:

| Reader                                                        | Returns                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trackers(conn, user_id, today)`                              | every tracker, ended ones too, in the week's order: `id`, `name`, `kind`, `daily_target`, `start_week`, `end_week`, `shows_this_week`; and `daily_goal`                                                                                                             |
| `week_summary(conn, user_id, tracker, week, today)`           | `week`, `plan_week` (None for the defaults), `carried`, `daily_target`; seven `days` (`date`, `count`, `met`, `future`); the `items` (`id`, `name`, `target`, `notes`, seven mark kinds, `done`, `great`, `partial`, `missed`, `goal_met`); `goals_met`, `days_met` |
| `weeks(conn, user_id, tracker, start, end, today)`            | `tracker` (its id), `start`, `end`, and `week_summary` for each week from `start` to `end` that shows the tracker, oldest first, at most 26                                                                                                                         |
| `item_history(conn, user_id, tracker, item_id, weeks, today)` | one item over the last `weeks` weeks: `tracker`, its `name`, its whole `notes` (uncut), and per week `in_plan`, `target`, the marks and their counts. A week that doesn't show the item reads as empty, as on screen                                                |
| `goals(conn, user_id, today)`                                 | `trackers`: each tracker today's week shows, in order, with its `id`, `name`, `kind`, `daily_target` and `items` (each item's goal); then `daily_goal`, `note`, the My goals text from settings, and `limits`, the limits note (each `""` when there is none)       |
| `consistency(conn, user_id, tracker, weeks, today)`           | over the last `weeks` weeks that show the tracker: the days up to today, how many met the daily target and the rate; the goals of the finished weeks, how many were met and the rate; the current runs of met days and of weeks with every goal met                 |

Every reader keeps these rules:

- `today` is the asker's date, passed in. The server can't know the browser's date, so the
  module never reads the clock.
- Weeks are Monday `YYYY-MM-DD` keys. Another key, an unknown tracker, or a week count outside
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
| `settings`          | `user_id`                           | `accent`, `daily_pick`, `food_pick` (K57), `item_sections` (JSON or NULL, K66), `goals` (My goals, `''` for none), `limits` (the limits note, `''` for none)                                                    |
| `plans`             | `(user_id, section, week)`          | `items_json`, `rev`                                                                                                                                                                                                |
| `ticks`             | `(user_id, section, week, item_id)` | `days`, `partial`, `missed`, `solid`, `hatch`: 7-bit masks (bit 0 is Monday); see below                                                                                                                            |
| `ask_log`           | `id`                                | `user_id`, `asked_at`: one row per question claimed (a failed answer still counts), for Ask's caps. It holds nothing of the question or the answer                                                                 |
| `ask_conversations` | `(user_id, id)`                     | `title` (the first question, trimmed and cut to 80 characters), `created_at`, `updated_at`: Ask's history (§3.2). The id is the account's own                                                                      |
| `ask_turns`         | `(user_id, conversation_id, seq)`   | `question`, `answer`, `stop` (`end_turn`, `max_tokens`, `refused`, `error` or `cancelled`), `asked_at`: one question and its answer, text only. Only `end_turn` and `max_tokens` keep an answer; any other is `''` |
| `item_details`      | `(user_id, section, item_id)`       | `details_json` (one document per item for every week: `{notes?, fields?}`), `rev`                                                                                                                                  |
| `trackers`          | `(user_id, id)`                     | `kind`, `name`, `position`, `daily_target` (NULL for a kind without one), `start_week` and `end_week` (a Monday, `YYYY-MM-DD`, or NULL), `rev`: the account's trackers (K123, §3)                                  |
| `programmes`        | `(user_id, id)`                     | `name` (the document's), `doc_json` (the document as sent, compact), `rev`, `created_at`, `updated_at`: the programme library (§3.4) |
| `programme_runs`    | `(user_id, tracker_id)`             | `programme_id` (the library programme it started from, which may be gone), `doc_json` (the run's own copy), `params_json`, `start_date`, `status` (`upcoming`, `running`, `paused` or `ended`, as at the last write or seal), `rev`: one per programme tracker |
| `run_changes`       | `(user_id, tracker_id, seq)`        | `made_at`, `from_date`, `change_json`, `reason` (`''` for none), `source` (`app`, or a connection's name), `undone_by` (the undo's `seq`, above `seq`): a run's log |
| `programme_days`    | `(user_id, tracker_id, date)`       | `programme_week` (NULL before the start), `items_json` (the day's plan as sealed, with its activity weeks), `sealed_at`: a run's sealed days |
| `mark_events`       | `id`                                | `user_id`, `tracker_id`, `date`, `item_id`, `mark` (NULL for a cleared day), `entered_at`, `source`, `late` (0 or 1): every mark on a programme tracker, indexed by user, tracker and date |

`section` in `plans`, `ticks` and `item_details` holds a tracker id: `exercise`, `cardio` or
`diet` for each account's first three trackers, or a random id for one the person made. No table
CHECKs it since version 14: every write checks the id against the user's `trackers` rows. Every row cascades from its user, and an Ask turn from its conversation. Tokens and session ids are
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

Version 14 takes the CHECK on `section` off `plans` and `ticks`, for Cardio (K90), as
`item_details` never had one. SQLite can't drop a CHECK, so each table is built again under a new
name, filled from the old one, and renamed into place. Every other column, CHECK, key and the
cascade from `users` stay, as do `STRICT` and `WITHOUT ROWID`. Nothing references either table.
Every row is kept. Older code reads the rebuilt tables unchanged, so a rollback needs only the
code.

Version 15 adds `limits` to `settings` (default `''`), the limits note (K107), so every saved row
reads as having none. It only adds a column, so rolling the code back leaves it unused.

Version 16 adds `trackers` (K123). Every user gets three rows: `exercise` (kind `strength`,
"Strength", `daily_target` from `settings.daily_pick`), `cardio` (kind `cardio`, "Cardio", no
target) and `diet` (kind `food`, "Food", `daily_target` from `settings.food_pick`), at positions
0 to 2, with no start or end week and revision 1. A user with no settings row gets the defaults,
3 and 2. A trigger, `users_get_trackers`, gives every user added later the same three. The kind
`exercise` is `strength` now, so each `settings.item_sections` that holds an object under
`exercise` moves it to `strength`; anything else in the column is left as it was. Plans, ticks and
item details don't change. To roll back, run `db.REVERT_TRACKERS` in one transaction before
starting the older API: it moves the key back, drops the trigger and the table, and sets the
version to 15. The daily targets need nothing, since the settings kept them in step. Rows of
trackers made since stay in `plans`, `ticks` and `item_details`, where older code never reads them.
`REVERT_TRACKERS` undoes step 16 only, so on a later version each later step is undone first.

Version 17 adds the week title (K131): `settings.week_title`, `'dates'` or `'number'` with a CHECK,
default `'dates'`, so saved settings read as dates. It only adds a column, so rolling the code back
leaves it unused.

Version 18 adds the programme tables (§3.4): `programmes`, `programme_runs`, `run_changes`,
`programme_days` and `mark_events`, each `STRICT`. It only adds tables, with `IF NOT EXISTS`, so it
can run again, and rolling the code back leaves them unused: a programme tracker's written plans
then read as ordinary plans. `programmes` cascades from its user. A run references its tracker,
and its log, sealed days and mark events reference the run, each `ON DELETE CASCADE`, so deleting
an account takes them all through its trackers. `programme_id` references nothing, since a
library programme can be deleted while its runs go on. `status`, `source` and `mark` have no
CHECK: the API checks them, so a new value needs no table rebuild.

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

**Writes** (`POST`, `PUT`, `PATCH`, `DELETE`) must send `Content-Type: application/json` and an `Origin`
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
| `GET /trackers`                            | session | `{trackers: [...]}`, the account's trackers, ended ones included (below)                                              |
| `POST /trackers`                           | session | `{name, kind, id?, week?}` → 201 the new tracker; 200 and the stored one for an id it has (below)                     |
| `PATCH /trackers/{id}`                     | session | `{rev, name?, position?, dailyTarget?}` → the tracker; 409 `conflict` with the server copy                           |
| `POST /trackers/{id}/end`                  | session | `{week?}` → the tracker, ended from that week (Delete tracker, K122); a programme tracker's run ends (§3.4)            |
| `PUT /plans/{section}/{week}`              | session | `{items, rev}` → `{rev}`; 409 `conflict` with the server copy. `section` is a tracker id; 409 `programme-tracker` for a programme tracker |
| `PUT /ticks/{section}/{week}/{item}/{day}` | session | `{mark}` → `{days}`, the week's seven marks for that item; 409 `locked-day` for a programme tracker's day before yesterday |
| `PUT /details/{section}/{item}`            | session | `{details, rev}` → `{rev}`; 409 `conflict` with the server copy (below)                                               |
| `PUT /settings`                            | session | `{accent, dailyPick, foodPick, dailyGoal, weekTitle, goals, limits, itemSections}` → the stored settings; a missing key keeps the saved one (below) |
| `GET /export`                              | session | the export file (`architecture.md` §4)                                                                                |
| `POST /import`                             | session | an export file, merged in; → `{trackers, weeks, ticks, details, settings, conversations}` added, and `programmes` and `runs` for a file with them |
| `GET /programme.schema.json`               | no      | the programme format's JSON Schema (§3.4)                                                                             |
| `GET /programmes`                          | session | `{programmes: [...]}`, the library without its documents, the one changed last first (§3.4)                          |
| `POST /programmes`                         | session | `{doc}` → 201 the stored programme; 400 `invalid` with every problem in `errors`                                      |
| `POST /programmes/validate`                | session | `{doc}` → `{errors}`, every problem an add would refuse it for; stores nothing                                        |
| `GET /programmes/{id}`                     | session | one programme with its document                                                                                       |
| `PUT /programmes/{id}`                     | session | `{doc, rev}` → the programme at its next rev; 409 `conflict` with the server copy                                     |
| `DELETE /programmes/{id}`                  | session | deletes it; 204. Runs started from it keep their copy                                                                 |
| `POST /programmes/{id}/preview`            | session | `{params?, start?}` → what a start would write; writes nothing                                                        |
| `POST /programmes/{id}/start`              | session | `{params?, start?, name?}` → 201 `{tracker, run}`: a programme tracker and its run                                    |
| `GET /runs/{tracker}`                      | session | the run: its state, clocks, log and overview grid                                                                     |
| `POST /runs/{tracker}/changes`             | session | `{change, from, reason?, preview?, rev?}` → a change's preview, or the change applied with the preview's `rev`        |
| `POST /runs/{tracker}/end`                 | session | `{from?, reason?}` → `{tracker, run}`: End programme                                                                  |
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

`GET /state` returns `{trackers, sections, details, detailRevs, settings, today, runs}`, plus
the keys of the version 5 state, below:

- `trackers` is the account's trackers, ended ones included, in the week's order (§3, Trackers).
- `sections` maps each tracker id to `{plans, log, revs}`. `plans` and `log` have the same shape
  as in the app's cache (a log row is seven marks or nulls). Plan items never carry `notes`.
  `revs` maps each planned week to its revision.
- `details` maps each tracker id to its items' details: each item id to its `{notes?, fields?}`,
  leaving out items whose details were cleared.
- `detailRevs` maps each tracker id to its details' revisions by item id, cleared ones included.
- `today` is the date in `TIMEZONE` (§6), `YYYY-MM-DD`. The app locks a programme tracker's past
  days by it, not by the device's clock.
- `runs` maps each programme tracker's id to its run's summary: `{programmeId, name, status, week,
  weeks, start, end, pausedUntil, rev}` (§3.4). `week` is today's programme week, null unless the
  run is running or paused. `end` is the run's last day, null while it is paused with no end
  date. `pausedUntil` is the day a paused programme resumes, null for none. Every run is sealed up
  to yesterday first. A run that can't be read is left out and logged, so the state still
  answers with every tracker.

The first three trackers' data also goes under `exercise`, `cardio` and `diet`, each
`{plans, log, details, revs, detailRevs}`, as the version 5 state sent it. A tab still running
that code reads them; a later run removes them. A tracker the person made is only under the new
keys. Plan items differ by kind:

- a strength item (an exercise) is `{id, name, sets?, reps, duration?, perSide?, weight?, target}`;
- a mobility item (K126) is a strength item without `weight`: `{id, name, sets?, reps,
  duration?, perSide?, target}`. `duration` is a hold's seconds, and a weight sent drops out;
- a cardio item (K90) is `{id, name, duration?, distance?, target}`. `duration` is the whole
  session in seconds, 1 to 86,400. `distance` is km, 0.01 to 1,000, rounded to two places as a
  weight is. Each is left out when not set, and an exercise's fields drop;
- a food is `{id, name, target}`.

`settings` is `{accent, dailyPick, foodPick, dailyGoal, weekTitle, goals, limits, itemSections?}`, or null before any are saved.

**Trackers** (K123, the spec `docs/specs/2026-11-14-account-trackers.md`). A tracker is
`{id, name, kind, position, dailyTarget, startWeek, endWeek, rev}`:

- `kind` is `strength`, `cardio`, `food` or `mobility` (`types.py`). It is set once.
- `name` is 1 to 60 characters, trimmed, and need not be unique.
- `position` is a sort key from 0 to 10,000. The week shows trackers by position, then by id.
- `dailyTarget` is 1 to 8 for a kind with a daily goal (strength, food, mobility) and null for
  cardio.
- `startWeek` is the Monday of the week the tracker was created in, null for the first three.
  `endWeek` is the first week it no longer shows in, null while it is live.
- `rev` counts its changes, as a plan's revision does.

A tracker shows in the week whose Monday is W when `startWeek <= W` (or it is null) and
`endWeek > W` (or it is null). `data.shows_in` and `data.trackers_in` hold the rule for the week
view, the Claude tools and Ask. Each account has at most 100 trackers, ended ones included.

`POST /trackers` takes `{name, kind}`. The tracker goes after the account's others, empty, with
its kind's default daily target (3 for strength and mobility, 2 for food) and `startWeek` the
Monday of
`week` (any day of it, `YYYY-MM-DD`), or of today's week in `TIMEZONE` without one. A client that
makes the id itself (`newId`: 1 to 64 letters, digits, `-` or `_`, not `__proto__`) sends it as
`id`, so an outbox that sends the create again gets the stored tracker back with 200, unchanged.
An id the account has for another kind gets 409 `exists`, and a create past the cap 409
`too-many`. Without `id`, the server makes one the same way (`edits.new_id`). A name or kind that
breaks the rules, a bad `id` or a `week` that isn't a date gets 400 `invalid`.

`PATCH /trackers/{id}` takes `rev` and any of `name`, `position` and `dailyTarget`, by the rules
above. A matching `rev` stores the change and returns the tracker at `rev + 1`. A stale `rev`
gets 409 `{"error": "conflict", "tracker": t, "rev": n}`, unless the tracker already reads as sent,
which returns it unchanged. A body with none of the three, a `kind`, or a value outside its rule
gets 400 `invalid`.

`POST /trackers/{id}/end` is Delete tracker (K122). It sets `endWeek` to the Monday of `week`,
the week on screen, or of today's week without one, and returns the tracker. Its plans, marks and
details stay, and earlier weeks still show it. An earlier end stays: ending never brings a week
back. Nothing brings an ended tracker back yet. On a programme tracker it ends the run instead
(End programme, §3.4), from that week's Monday or today, whichever is later, so the locked days
stay in view.

An unknown tracker id gets 404 `not-found` on these routes. A plan, tick or details write whose
`section` is not one of the account's trackers gets 400 `invalid`, as a section outside the fixed
three did, and an ended tracker still takes writes, for its earlier weeks. Items are validated
by the tracker's kind.

**Daily targets** live on the trackers. The `exercise` tracker's is kept in step with
`settings.dailyPick` and the `diet` tracker's with `foodPick`, both ways, so a tab on older code
reads and writes them as before. `PUT /settings` moves each tracker's target (and its revision,
when the number changes), and a `PATCH` of either tracker's `dailyTarget` writes the setting. With
no settings saved, the tracker holds its target alone. A later run drops the two settings.

**Settings.** `PUT /settings` normalises the accent and daily picks (a bad accent reads as the
default, a pick is clamped to 1 to 8) and returns what it stored. A body without `foodPick` (K57),
`itemSections` (K66), `goals` or `limits` keeps the saved value, so a tab on older code cannot reset it.
`dailyGoal` (boolean, default `true`) is Daily goal (K85): off, the daily targets (`dailyPick`,
`foodPick`) are kept but apply nowhere, so no day is met and the insights give no daily target
(§1.1). A body without `dailyGoal`, or with a value that isn't a boolean, keeps the saved one. The
state and the export always carry it; a file without it reads as on.
`weekTitle` (`"dates"` or `"number"`, default `"dates"`) is how the app titles a week (K131):
`"dates"` gives "9–15 November", and `"number"` gives "Week 46". It is saved with the account
(K132), so every device shows the same title. Only the app reads it: Ask and the MCP tools don't.
A body without `weekTitle`, or with any other value, keeps the saved one. The state and the export
always carry it. A file without it reads as dates, and an import applies a file's only where no
settings are saved.
`itemSections` is each tracker kind's item-page arrangement, keyed by kind (`strength`, `cardio`,
`food`, `mobility`; a kind left out has the default): `{"strength": {"order": ["history", "notes", "details", "plan"], "hidden": ["details"]}}`.
The key `exercise`, the kind's name before K123, reads as `strength`, and a `strength` key wins
over it. The state and `PUT /settings` send the strength arrangement under both keys, so a tab on
older code keeps it; an export sends `strength` alone.
The keys are `notes`, `details`, `plan` and `history`. A shape the app never sends is refused
with 400 `invalid` and nothing changes: `itemSections` not an object, a key that is not a
registry type id, or a type whose `order` or `hidden` is not a list of strings. Within that shape
it normalises like the other settings (P29): unknown and repeated section keys drop, missing ones
follow in the default order (`plan`, `notes`, `details`, `history`, K104), `hidden` keeps known keys in the default order, and a type with the
default arrangement is left out. `{}` stores the default; the state and the export leave the key
out then. Reading a stored or exported arrangement never refuses: a type this version's registry
lacks is dropped, so a newer version's value still reads.

`goals` is My goals: the person's own words about what they are aiming for. Ask and the MCP
(Claude connections) read it, through `insights.goals`. It is trimmed of spaces, tabs and line breaks at its ends and cut to 1,000
characters, counted as code points (`normalise_goals`); blank goals are `""`. Goals that aren't a
string count as not sent, so only a string, `""` included, replaces them. The web app never sends
goals it hasn't read (`architecture.md` §7).

`limits` is the limits note (K107): what the person has to work around, such as injuries,
equipment, time or food. Ask and the MCP read it beside My goals. It follows every rule of
`goals`: the same trim, the 1,000 code-point cut (`normalise_limits`), `""` when blank, and a
value that isn't a string counts as not sent.

**Plans.** `rev` is the revision the client last saw, 0 for a week it has never seen planned.
A matching `rev` stores the items and returns `rev + 1`. A stale `rev` gets 409 with `{items, rev}`
from the server, unless the stored items already equal the sent ones after validation. That
happens when two devices tick the same carried-forward week and both create its plan from the same
source. That write succeeds and returns the current `rev`. Items are validated with the same
rules as stored data, so a bad item drops out rather than failing the write. A programme
tracker's plans are its run's: any write to one gets 409 `programme-tracker`, at any week and any
`rev`, and changes nothing (§3.4).

**Ticks** set or clear one day for one item (an item id of 1 to 128 characters), so two devices
marking different days never collide. `day` is 0 (Monday) to 6. The body is `{"mark": m}`, where
`m` is one of the nine marks (`great`, `partial-solid`, `missed-hatch` …) or null (clear the
day). The old `{"done": bool}` body, from a
tab or a queued write from before marks had kinds, still works: true is `great`, false clears.
A `mark` key is read first; any other value of it, or a `done` that is not a boolean, gets 400
`invalid`. The app sends both keys (`{"mark": m, "done": m !== null}`), so an API from
before marks had kinds, still running during a deploy, saves the day as done rather than refusing it. The server stores any mark in either section; only the client keeps foods to `great`.
On a programme tracker the lock applies (§3.4): a day before yesterday gets 409
`{"error": "locked-day", "date": "2026-11-16"}`, yesterday's mark is recorded as late, and each
mark also goes into `mark_events`.

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

**Quota.** Each user may store 5 MiB: the bytes of their plans', item details' and library
programmes' JSON plus 64 for each tick row, and for Ask's history the UTF-8 bytes of each title, question and answer plus 64
for each conversation and each turn. A plan or details write, a tick that would add a row, or an
import that would take the account over it gets 413 `quota` and changes nothing. An Ask turn
that would is not saved, and its answer says so (§3.2). Writes that keep usage level or shrink
it always succeed, so a full account can still change existing ticks and trim its plans and
details. Settings do not count and are never refused. A programme run counts too: the bytes of
its copy of the document and its parameters, each log entry's change and reason, and each sealed
day's JSON, plus 64 for each of those rows and for each mark event. A programme start or change
that would take the account over gets 413 `quota` and changes nothing. Sealing and a mark's
event never check the quota, so the record is never refused: a full account still seals its days
and takes marks on a week whose tick row exists. The quota measures what the account holds, not the bytes on disk, which include keys and
indexes. The client drops a refused write with a notice that the account is full (`architecture.md`
§7), and an import says the same.

**Export** writes version 6 of the file: `{format, version, exportedAt, trackers, sections,
details, settings, conversations}`. `trackers` is the account's trackers, ended ones included,
without revisions. `sections` maps each tracker id to its `{plans, log}`, and `details` each
tracker id to its items' `{notes?, fields?}` without revisions. Each log row is seven marks,
drawings included, or nulls. Its settings carry `goals` and `limits`, which took no new version, as `foodPick` didn't: a
reader from before them drops the keys, and a file without them reads as no goals and no limits. The API's export
also carries `conversations`, Ask's history, the one updated last first, in the shape
`GET /ask/conversations/{id}` returns; it took no new version either. The browser keeps no
conversations, so Settings → Export writes the device's plans, marks and settings and takes
`conversations` from this export (`architecture.md` §4); with none, the file has no such key.
When the account has any, the export also carries `programmes`, the library, each
`{id, doc, createdAt, updatedAt}`, and `runs`, each `{tracker, programmeId, doc, params, start,
changes, days, marks}`: the run's copy and parameters, its log as
`{seq, madeAt, from, change, reason, source, undoneBy}`, its sealed days as
`{date, programmeWeek, plan, sealedAt}` and its mark events as
`{date, item, mark, enteredAt, source, late}`. They took no new version either: a reader from
before them drops the keys, and a run's tracker then reads as an ordinary one, with its plans and
marks. `GET /export` seals every run up to yesterday first.
Version 5 kept the first three trackers under fixed keys (`exercise`, `cardio`, `diet`), each
`{plans, log, details}`. Its `cardio` section (K90) took no new version: a file without it has
no cardio.
Import reads:

- version 6. Its trackers normalise: each needs an id by `POST /trackers`' rule, a kind the
  registry has (the first three ids their own kind) and a name that isn't blank, cut to 60
  characters. The first of each id is kept, at most 100. A bad position reads as the tracker's
  place in the list, a daily target is clamped to 1 to 8 (null for cardio), and a week that isn't
  a week key reads as null. Data is read for the first three ids and for each of the file's
  trackers, by that tracker's kind; data under any other id is dropped;
- version 5, whose fixed keys map onto the first three trackers' ids;
- version 4, whose notes sit on plan items (K43). They lift into `details` by migration 7's rule
  (`lift_notes`: the latest week with a non-blank note, the first copy in it, cut to 500
  characters), and any `details` key in the file is ignored;
- version 3 (no notes) and version 2 (kinds only, which read as the zigzag);
- version 1, whose `true` days read as `great` and `false` days as empty.

Any other version gets `version`. A file's details document over 32 KB drops out.

**Import** adds the file's trackers the account has no id for, after the account's own and in the
file's order, each with its name, kind, daily target and weeks, up to the cap. It never changes a
tracker the account has, and never ends one. Data for a tracker the account lacks, or has with
another kind, is passed over. Each tracker's data then merges by id under the rule from
`architecture.md` §4: existing weeks keep their plan; per
week, item and day a marked day keeps its mark and an empty one takes the file's; an item with
details keeps them, and one without takes the file's; and settings apply only when the account has
none, except that the file's My goals fill the account's when those are empty and never replace
goals already saved, and the limits note does the same. An item whose details were cleared counts as without, and takes the file's as a new
revision, so a device holding the cleared copy conflicts. It returns what it added (`trackers` counts the trackers added, `ticks`
counts the empty days that gained a mark, `details` the items that gained details; `settings` is true when the file changed the account's
settings, its goals or limits alone included; `conversations` counts the conversations added), in one
transaction. A file's conversation is added only when the account has none with its id, and one
the account has is never changed. A file's library programmes are added where the account has
no programme with the id, up to 100, each with its times; one the format refuses, or over
128 KiB, is passed over, and `programmes` in the result counts those added. A run comes whole,
with its log, sealed days and mark events, and only with a tracker this import adds. It is
stored only when its document passes the format with the tracker's kind, its parameters fit, each
sealed day reads and its log replays; otherwise its tracker comes in as an ordinary one. `runs`
counts the runs added. A programme tracker the account already has takes nothing from a file,
since its plans are its run's and its past days are locked. `programmes` and `runs` are in the
result only when the file has the list. The file's conversations are read as `normalise_conversations`
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

**Read tools.** Each wraps the reader of the same name in `insights.py` (§1.1; `list_trackers`
wraps `trackers`; the programme tools are below) and returns its result unchanged, with `this_week` (the Monday of today's week)
and `today` added, both in the account's timezone, so the agent knows "now". `week_summary` also
adds `tracker`, the id it read. Every read tool has `readOnlyHint`. The server
passes `today` to the reader, since `insights.py` never reads the clock. A week is a Monday
written `YYYY-MM-DD`.

`tracker` names one of the account's trackers: its id, or its name in any case (§1.1). It
defaults to `exercise`, the first Strength tracker. `section`, its old name, stays on every tool
that took it, so older clients keep working: its schema is the enum `exercise`, `cardio`, `diet`,
and it reads as `tracker` does. A call that gives both must give the same string, or it gets
`tracker: give tracker or section, not both`. The server's instructions and `list_trackers`
describe the person's own trackers and their kinds.

| Tool            | Arguments (defaults)                                                      | Returns                                                                                                                            |
| --------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `list_trackers` | none                                                                      | Every tracker, ended ones too: `id`, `name`, `kind`, `daily_target`, `start_week`, `end_week`, `shows_this_week`; and `daily_goal` |
| `week_summary`  | `tracker` (`exercise`), `week` (this week)                                | One week of one tracker: each item's marks against its goal, and the met days; with `tracker`, its id                              |
| `weeks`         | `tracker` (`exercise`), `start` (3 weeks before `end`), `end` (this week) | `week_summary` for each week from `start` to `end` that shows the tracker, 26 at most                                              |
| `item_history`  | `item_id`, `tracker` (`exercise`), `weeks` (8)                            | One item's goal and marks over the last `weeks` weeks, and its whole note                                                          |
| `goals`         | none                                                                      | This week's goals per tracker the week shows, each tracker's daily target, and both notes                                          |
| `consistency`   | `tracker` (`exercise`), `weeks` (8)                                       | Met-day and goal-met rates over the last `weeks` weeks that show the tracker, streaks                                              |

`week_summary`, `weeks` and `goals` cut each item's `notes` at 500 characters, a longer note
ending in "…", and their descriptions say so. `item_history` returns the item's whole note as
`notes`. `NOTE_HELP` and the `note` argument of `add_item` and `update_item` tell the agent to read
it there before writing a note back, since a `note` replaces the whole note.

A refused argument (a `week` that is not a Monday or doesn't show the tracker, an unknown
`tracker`, a `weeks` outside 1 to 26) returns a tool result with `isError: true` whose text names the field, as `week: must be a
Monday, written YYYY-MM-DD`. It is not a JSON-RPC error. A week so near the year 1 or 9999 that
the weeks around it can't be counted gets `date: a week or date is out of range`.

**Write tools.** These change John's plans, marks and daily targets as the app does. Each needs a
`write` token or connection. A `read` one gets a tool error, "this connection is read-only", which
tells the person to create a write token in Settings › Connections or to reconnect and allow changes. The rules live in `edits.py`, over `data.put_plan`'s rules, `data.set_tick`,
`data.patch_tracker` and, for a note, `data.set_notes_locked` (`put_details`' rules), so REST's
endpoints and limits are unchanged.

| Tool                | Arguments (defaults)                                                                                   | Annotations       |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- |
| `add_item`          | `name`, `tracker` (`exercise`), `week` (this week), the item fields below                              | not idempotent    |
| `update_item`       | `item_id`, `tracker` (`exercise`), `week` (this week), the fields to change                            | `idempotentHint`  |
| `remove_item`       | `item_id`, `tracker` (`exercise`), `week` (this week)                                                  | `destructiveHint` |
| `mark_day`          | `item_id`, `mark`, `tracker` (`exercise`), `date` (today)                                              | `idempotentHint`  |
| `set_daily_targets` | `tracker` with `daily_target`; or `exercises_a_day`, `foods_a_day` (each left as it is when not given) | `idempotentHint`  |

Every write tool has `readOnlyHint` false and `openWorldHint` false; only `remove_item` has
`destructiveHint` true.

- **The tracker is the user's own**, by id or name (`edits.find`), and its kind decides the item's
  fields and marks. A week the tracker doesn't show in is refused, naming `week` (`date` for
  `mark_day`), in a plain sentence: `week: Yoga (x…) was deleted from the week of 2026-10-19 on,
  so the week of 2026-10-19 doesn't show it; its earlier weeks still do`. Earlier weeks of an
  ended tracker take changes as before.
- **A change to a week is a change to that week and the weeks that carry it forward**, as in the
  app (architecture.md §2). A week with no plan of its own gets a copy of the plan it shows: its
  source week's, or the defaults when nothing is planned. An item tool creates the week at `rev`
  0 with the change already applied to the copy, in one write, as the app's sync sends `own()`
  and the edit. `mark_day` first creates the plain copy (`edits.own_week`), then sets the day, as
  a tick on the device does. A device creating the same week from the same source does not
  conflict (P7). The source week is never written. `copied_from` in the result names the week
  copied, `defaults` (the `exercise` and `diet` trackers' default items, or none for any other
  tracker), or null when nothing was copied: the week had its own plan, or the call
  changed only the note. `rev` is the week's plan revision, 0 for a week still without its own.
- **Item fields use the app's words.** An exercise (a strength tracker's item) has `name`, `sets` (0 to 20), `reps` (0 to
  9999), `seconds` (0 to 3600), `per_side`, `weight_kg` (0 to 500), `times_a_week` (0 to 7) and
  `note` (up to 20,000 characters). A mobility item (K126) has the same without `weight_kg`;
  its `seconds` is a hold's. A cardio item (K90) has `name`, `seconds` (the whole
  session's, 0 to 86,400), `distance_km` (0 to 1,000), `times_a_week` and `note`. A food has
  `name`, `times_a_week` and `note`. They are stored as `name`, `sets`, `reps`, `duration`,
  `perSide`, `weight`, `distance`, `target` and `notes`; `edits.WORDS` holds that mapping, and
  `edits.TYPE_WORDS` each kind's fields. A field another kind has is refused by name, as
  `reps: a cardio item has no reps; it has name, seconds, distance_km, times_a_week, note`. A 0,
  or an empty `note`, clears the field.
- **A note is the item's, not the week's.** `note` is the item's notes in its details (§3), one
  copy for every week, which the app's row and item page read. It never goes into a plan. The
  plan write and the note are one transaction, so a note refused for the quota or for the 32 KB
  cap leaves the plan as it was. A call that changes only the note writes no plan, so a week
  without its own plan copies nothing and goes on following its source. The note moves the
  details' revision on, so a device holding the older copy gets a 409 on its next write and adopts
  the agent's, as after any details conflict. Setting the same note again writes nothing. An
  exercise (strength or mobility) counts reps or
  seconds, not both: giving `seconds` to an exercise with reps sets its reps to 0, and giving
  `reps` drops its seconds. Names are trimmed, may not be empty, and are capped at 80 characters.
  A new exercise's `times_a_week` is 3, as is a new cardio item's and a new food's.
- **Ids are made by the server**, in the app's shape: `x`, the time in milliseconds in base 36, and
  four random base-36 characters. An id already used in the tracker is never reused.
- **`mark_day`** marks one item on one date. The week is that date's Monday and the day its
  weekday. It may be in the future, as on screen. `mark` is one of the nine marks
  (§2), or null to clear the day. An exercise, a mobility item and a cardio item take any of them. A food takes
  only `great`, `great-solid` or `great-hatch`, the marks the app gives a food. An item the week does not show is refused.
- **`set_daily_targets`** sets a strength, food or mobility tracker's daily target, 1 to 8: `tracker` and
  `daily_target` together. The older form still works: `exercises_a_day` sets the `exercise`
  tracker's, `foods_a_day` the `diet` tracker's, and either can join the new form in one call. A
  cardio tracker has no daily target, and a tracker given twice is refused. Every target is
  checked before any is written. Each goes through `data.patch_tracker`, so the `exercise` and
  `diet` trackers' targets reach `daily_pick` and `food_pick` too (W4), and a stale `rev` is
  replayed up to three times. Nothing else changes. It still saves the numbers while Daily goal is
  off, which only the app can turn on, and its result has `daily_goal`.
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
| the three item tools | `tracker`, `week`, `item` (the item added, updated or removed), `before` and `after` (the week's items, in the app's words, each with its `note`), `rev`, `copied_from` |
| `mark_day`           | `tracker`, `date`, `week`, `day` (0 is Monday), `item_id`, `before` and `after` (the day's mark or null), `days` (the item's seven marks), `rev`, `copied_from`; on a programme tracker also `late` |
| `set_daily_targets`  | `targets`, each `{tracker, name, before, after}` in the order given, and `daily_goal`                                                                                   |

`remove_item` leaves the item's marks in the log, uncounted, as the app does. Adding the item back
gives it a new id, so those marks stay detached; `before` holds the item for reference.

**A programme tracker** (§3.4) has a plan only its programme writes. `add_item` and
`remove_item` refuse it, and so does `update_item` unless it changes the note alone, with
`tracker: Beginner 5×5 is a programme tracker: its plan comes from its programme, so its items
can't be added, changed or removed one week at a time. Use change_programme instead …`. `mark_day`
follows the lock: a day before yesterday gets `date: 2026-11-16 is locked. …`, and yesterday's mark
is recorded as late, with `late` in the result. Its week is never copied, since the engine writes
every week. Every mark and change an agent makes records the connection's name as its `source`:
the token's name, or the OAuth app's ("Claude").

**Programme tools.** Nine tools write, save, start, change, end, restart and re-open programmes.
[mcp.md](mcp.md) §1.1 gives each one's results and refusals, and [programmes.md](programmes.md)
§10 the loop an agent follows.

| Tool                | Scope | Arguments (defaults)                                                                       | Annotations      |
| ------------------- | ----- | ------------------------------------------------------------------------------------------ | ---------------- |
| `programme_format`  | read  | none                                                                                       | `readOnlyHint`   |
| `list_programmes`   | read  | none                                                                                       | `readOnlyHint`   |
| `get_programme`     | read  | `programme` (a library id) or `tracker` (a programme tracker's id or name), one of the two | `readOnlyHint`   |
| `save_programme`    | write | `doc`; `programme` and `rev` to replace one                                                | not idempotent   |
| `start_programme`   | write | `programme`, `start` (today), `params` (the defaults), `name` (the programme's)            | not idempotent   |
| `change_programme`  | write | `tracker`, `change`, `from_date` (today), `reason`, `confirm` (false), `rev`               | `idempotentHint` |
| `end_programme`     | write | `tracker`, `from_date` (today), `reason`, `confirm` (false), `rev`                         | `idempotentHint` |
| `restart_programme` | write | `tracker`, `start` (today), `name` (the old tracker's), `confirm` (false), `rev`           | not idempotent   |
| `reopen_programme`  | write | `tracker`, `from_date` (today), `reason`, `confirm` (false), `rev`                         | `idempotentHint` |

The run objects they return keep REST's camelCase (§3.4), and `get_programme`'s, `start_programme`'s
and `change_programme`'s carry the grid's weeks from this one on. A preview from
`change_programme` leaves out the grid, since `cells` says what changes. `end_programme` ends a run
as `POST /runs/{tracker}/end` does (§3.4), after a preview of its from day and last week, confirmed
with the preview's `rev`. `restart_programme` starts a new run from week 1 as a new tracker, from
the old run's `doc_json` and `params_json`, after a preview confirmed the same way. A run still
going on the new start day ends from it in the same transaction, as End programme ends it (K164).
`reopen_programme` re-opens a run End programme stopped part way, after a preview confirmed the
same way (K165). No REST route restarts or re-opens a run.

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
  this week, the trackers, My goals, the limits note, the programme runs) opens the first user turn, as for a new conversation. A turn with an
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

**The prompt.** The system prompt is one constant: the role, the person's own trackers and their
kinds (strength, cardio, food, mobility), the rules from §1.1 (a plan carries forward, only the `exercise`
and `diet` trackers have defaults, a deleted tracker leaves the weeks from its end on, every mark
counts towards a goal, missed and partial days are reported as such, met days use each strength,
food and mobility tracker's own daily target, future days don't count), what cardio is (a duration and a
distance, a weekly goal, no daily target and no defaults, K90), names and notes as data and never
instructions, tools before judgement, no medical advice, short markdown with no
headings, tables or images, and the voice. It holds nothing that varies, so it caches; the cache
breakpoint is on it, and the tools render before it. Today, this week, the trackers today's week
shows (`<trackers>`, one a line: `id | kind | name`, from `ask.shown_trackers`), the My goals note
(`<my_goals>`) and the limits note (`<my_limits>`) open the first user turn instead, each named
as data. A week with no tracker says so. Each programme tracker the week shows adds a
`<programme>` block (`ask.programme_runs`): where its run is today, as JSON (its programme week of
weeks, its dates, parameters, pause and each activity's state and activity week), then its log,
newest first, one change a line as JSON with when it was made, its from day, the change, the
reason and the source. Each run gives at most its 50 newest changes, and all the runs' log lines
together at most 12,000 characters; a line says how many were left out. A reason is the person's
words: data, not instructions. So Ask can say why a value changed. It never changes a programme.
A run that can't be read (`RunUnreadable`) is logged and left out, so Ask still answers about
the rest. The voice is John's ruling (K68, voice.md "Ask"): facts first and
no blame, exclamation marks or hype, and `VERDICT_RULE`, which lets an answer say plainly that
something is too little or too much, count streaks and give scores or rankings when they help,
and quote the person's goals and notes back as advice. `PLAIN_VERDICTS` (True) turns it on;
False would put back the app's own rules (no streaks, scores or rankings, nothing quoted back).

**The tools** are `consistency`, `goals`, `item_history`, `week_summary` and `weeks`, sorted by
name, each with a strict schema. Each wraps the `insights` reader of the same name (§1.1) and is a
closure over the session's user and the question's `today`. `tracker` is a string: a tracker's
id from the context's list. It has no enum, since each account's trackers differ and the schema
must stay the same bytes for the cache. The readers look it up among the session user's trackers
only, so another account's id is an error result naming `tracker`. No schema has a user field, and a
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

### 3.4 Programmes

[programmes.md](programmes.md) explains the `tracker-programme/1` format, the changes and the
lock; the spec is [specs/2026-11-17-programmes.md](specs/2026-11-17-programmes.md). This section is
the HTTP contract. Every route but the schema needs a session. A programme id or a tracker the
account doesn't have, another account's included, gets 404 `not-found`, and so does a tracker
that isn't a programme tracker on the run routes. JSON keys are camelCase, as elsewhere.

| Status and code        | When                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 400 `invalid`          | A document, start, change or end with problems: `{"error": "invalid", "errors": [{path, message}]}`, every problem at once, in order |
| 404 `not-found`        | No such programme, or no such programme tracker                                                                                        |
| 409 `conflict`         | A stale `rev`: the library's `{programme, rev}` with the server's copy; a change's `{rev, preview}`, the change sent previewed again   |
| 409 `too-many`         | An add past 100 library programmes, or a start past 100 trackers                                                                       |
| 409 `ended`            | A change to a run End programme ended, or a second end                                                                                 |
| 409 `programme-tracker` | A generic plan write (`PUT /plans`) to a programme tracker                                                                            |
| 409 `locked-day`       | A mark on a programme tracker's day before yesterday: `{"error": "locked-day", "date": "2026-11-16"}`                                  |
| 413 `too-large`        | A document over 128 KiB as stored (compact JSON, UTF-8)                                                                                |
| 413 `quota`            | An add, replace, start or change that would take the account over its quota (§3)                                                       |
| 500 `run-unreadable`   | A stored run fails to load, seal or replay: the server's fault, logged with its cause                                                  |

**The library.** A programme's summary is `{id, name, description, kind, weeks, activities, rev,
createdAt, updatedAt}`: `name`, `description` (or null), `kind` and `weeks` from its document,
`activities` how many it has, and the times in Unix seconds. Its record is the summary plus `doc`,
the document as it was sent.

- `GET /programme.schema.json` serves the format's JSON Schema (draft 2020-12) as
  `application/schema+json`, with no sign-in, so an agent can read it before it has a token. It is
  the committed `programme.schema.json`, which `programme.py` builds from the same rules as the
  check; a test keeps the two in step.
- `GET /programmes` returns `{programmes: [summary]}`, the one changed last first.
- `POST /programmes` takes `{doc}` and returns 201 with the record, under an id the server makes
  (`edits.new_id`), at `rev` 1. A document with any problem is never stored.
- `POST /programmes/validate` takes `{doc}` and returns `{errors}`, [] when an add would take it,
  the size included. It stores nothing.
- `GET /programmes/{id}` returns the record.
- `PUT /programmes/{id}` takes `{doc, rev}` and returns the record at the next `rev`; the name
  follows the document. The document's problems come before the revision. A stale `rev` gets 409
  `{"error": "conflict", "programme": p, "rev": n}`, unless the programme already holds the
  document sent, which returns it as it is. A `rev` that isn't a whole number from 0 gets 400.
- `DELETE /programmes/{id}` returns 204. Runs started from it keep their copy, and their
  `programmeId` then names nothing.

At most 100 programmes fit in a library, and a document is at most 128 KiB as stored. Library
documents count towards the quota (§3).

**Starting.** `POST /programmes/{id}/start` takes `{params?, start?, name?}` and returns 201
`{tracker, run}`: the new tracker (§3, Trackers) and its run (below).

- `start` is a date, `YYYY-MM-DD`, today or later in `TIMEZONE`; today when left out. An earlier
  one gets "a programme starts today or later." at `start`.
- `params` maps parameter keys to numbers. Each must lie within its `min` and `max`, and fit every
  field that uses it. A key the programme lacks gets "the programme has no parameter called x." at
  `params.x`.
- `name` is the tracker's, 1 to 60 characters, the programme's when left out.

The start writes every week of the run into `plans`, gives each activity's notes and link to its
item's details, sets the tracker's `startWeek` and `endWeek` to the run's, and seals the start
week's days before today. `POST /programmes/{id}/preview` takes `{params?, start?}`, checks them as
a start does, and returns what a start would write, writing nothing: `{start, end, weeks, params,
endsShort, grid}`.

**The run.** `GET /runs/{tracker}` returns the run object, sealed up to yesterday first:

| Key            | Holds                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `tracker`      | The tracker's id                                                                                                                    |
| `programmeId`  | The library programme it started from, which may be gone                                                                            |
| `name`, `kind` | The programme's                                                                                                                     |
| `doc`          | The run's own copy of the document                                                                                                  |
| `params`       | The parameters in force, after any Set parameter                                                                                    |
| `start`, `end` | The first day, and the last (null while the programme is paused with no end date)                                                   |
| `status`       | `upcoming`, `running`, `paused` or `ended`                                                                                          |
| `today`        | The date in `TIMEZONE`                                                                                                              |
| `week`         | Today's programme week, null unless running or paused; `weeks` is the programme's                                                   |
| `rev`          | The log's revision: 16 hex characters of a SHA-256 over the log. It shows the run changed, and never confirms a change              |
| `openPause`    | `{since, programmeWeek, reason}` while the programme is paused with no end date, else null                                          |
| `endsShort`    | Each activity that ends before its last week: `{key, name, week, of, message}`                                                      |
| `ended`        | `{from, reason, seq}` after End programme, else null; null again after a re-open (K165)                                             |
| `clock`        | Today: `{programmeWeek, status, until, reason, activities}`, each activity `{state, activityWeek, until, reason}`                   |
| `log`          | Every row, newest first: `{seq, madeAt, from, change, reason, source, undoneBy, undoable}`. `change` is a change's body, `{"type": "end-programme"}` or `{"type": "reopen-programme"}`. `undoable` is true while Undo applies |
| `grid`         | The overview: `{activities, weeks, whenResumed}`                                                                                    |

A day's `status` is `before-start`, `running` or `paused`, and an activity's `state` is `running`,
`paused`, `ended` or `not-started`. In `grid`:

- `activities` lists each activity `{key, name, addedOn, addedBy, endedOn}`, `addedBy` being the
  change that added it (null for the programme's own). One deleted outright is left out.
- `weeks` holds a week per calendar week up to the run's last: `{monday, programmeWeeks, label,
  current, locked, days, cells}`. `programmeWeeks` lists two weeks for a week split by a change.
  `locked` is true once the week's Sunday is past. `days` holds its seven days as `{date, status,
  programmeWeek, sealed}`.
- `cells` maps each activity key to `{state, activityWeek, values, target, splits, hand, until,
  reason, marks}`. `values` and `target` are what the week's plan holds: Sunday's values, or the
  last the activity ran with, and the week's goal, which counts its days (K163). `splits` maps a
  field whose value changes during the week to its `[{from, value}]`. `hand` maps a hand-edited
  field to `{change, madeOn, rule}`, `rule` being what the rule gives. `until` and `reason`
  describe a pause. `until` is the day the activity runs again: a resume later in the same week
  ends the pause on its day, though the sealed paused day keeps the date it was planned with.
  `marks` is the item's seven marks.
- `whenResumed` holds the weeks after an open-ended pause, as they will run when resumed:
  `{programmeWeek, label, cells}`, with no dates.

**Changes.** `POST /runs/{tracker}/changes` takes `{change, from, reason?, preview?, rev?}`.
`change` is one of the bodies in [programmes.md](programmes.md) §8. `from` is its first day,
`YYYY-MM-DD`, today or later. `reason` is up to 500 characters. `preview` is a boolean, true when
left out.

- **A preview** writes nothing but the sealing, and returns `{preview: true, rev, change, cells,
  blocking, endsShort, undoes, deletes, grid}`. Its `rev` is the token that confirms this change
  and no other: the first 16 hex characters of a SHA-256 over the log's revision and the change as
  sent, its `change` body (`dropHandEdits` included), `from` and `reason`, written as sorted-key
  compact JSON. It isn't the run's `rev`. `change` is the log entry it would add
  (`{seq, from, change, reason}`). Each of `cells` is `{monday, key, field, before, after, starts,
  programmeWeek}`; `field` is null for a change of state, such as running to paused. Each of
  `blocking` is a hand-edit that keeps its value, `{change, key, field, programmeWeek, value,
  madeOn, message}`, its message such as "Week 6 keeps the 35 kg set on 12 Dec.". `undoes` names
  the change an undo reverses, `deletes` an activity ended before it had a day, and `grid` is the
  overview as the change would leave it.
- **An apply** is the same body with `preview: false` and the preview's `rev`. It returns
  `{preview: false, change, run}`: the new log entry and the run. It appends the change, marks an
  undone change's `undone_by`, deletes an activity ended before it had a day (and its details),
  gives an added activity's notes and link to its item, rewrites today's calendar week and every
  later one from the replay, and moves the tracker's `endWeek` to the run's end. Any other `rev`
  gets 409 `{"error": "conflict", "rev": r, "preview": p}`: the log changed since the preview,
  the change, `from` or `reason` isn't the one previewed, or the `rev` is the run's own. `p` is
  the change as sent, previewed on the log as it is now, and `r` its token.

Problems get 400 `invalid`: the change's own at `change.…` (`change.activity`: "deadlift is
already paused on Wed 7 Oct."), a from day before today at `from` ("a change starts today or
later."), a long reason at `reason`, a confirm without a `rev` at `rev`, and a `preview` that isn't
a boolean at `preview`. A run End programme ended gets 409 `ended`.

**End programme.** `POST /runs/{tracker}/end` takes `{from?, reason?}` and returns
`{tracker, run}`. `from` is today, the default, or a later day. The tracker then shows in no week
after the one holding the day before `from`, so the week holding `from` still shows unless it is a
Monday; an end never brings a week back. Each goal in the weeks up to it counts its days before
`from` only (K163); the weeks after it stay as they are. The end goes into the log as
`{"type": "end-programme"}`, which the replay passes by unless a re-open follows it. No change
follows it until a re-open, Undo no longer shows, and days from it on are never sealed. A second
end gets 409 `ended`. End programme is a route of its own, not a change type (K156). `POST /trackers/{id}/end` on a programme tracker ends the run this way, and on a run
already ended returns the tracker as it is. The MCP's `end_programme` ends a run this way too,
after a preview confirmed with its `rev` (§3.1).

**Re-open.** The MCP's `reopen_programme` lifts an end that stopped a run part way, after a
preview confirmed with its `rev` (§3.1, K165). It goes into the log as
`{"type": "reopen-programme"}` with its from day, reason and source. The replay then reads the end
and the re-open as a pause of the whole programme from the end's day to the re-open's, resumed at
the paused programme week. The run's `ended` is null again, and its status follows the replay.
The re-open seals the days from the end to yesterday as paused, writes the weeks the end had
hidden as paused, rewrites today's week and every later one, and moves `endWeek` to the run's new
last day, later than before. Undo never applies to it. A run with a re-open can be ended again.

**The lock and the evidence** (spec §8):

- **Plans.** Only the engine writes a programme tracker's plans. `PUT /plans` to one gets 409
  `programme-tracker`, whatever the week and `rev`, and so do the MCP's item tools (§3.1).
- **Marks.** `PUT /ticks` on a programme tracker takes today, any later day, and yesterday, which
  is recorded as late. An earlier day gets 409 `locked-day` with its `date`. Each mark, a cleared
  day included, also goes into `mark_events` with when it was entered, its `source` (`app`, or the
  MCP connection's name) and `late`. Ticks stay the fast path every reader uses.
- **Sealing.** Before every start, change, end and restart, and on the first read each day
  (`/state`, `GET /runs/{tracker}`, `/export`, Ask's context, and the MCP's `list_programmes`,
  `get_programme`, `change_programme`, `end_programme` and `restart_programme`), every unsealed
  day up to yesterday is copied into `programme_days`. A read with nothing to seal takes no write
  lock. Sealing never checks the quota.
- **Stored runs.** A stored run loads without checking each week's value against the item's
  limits (K158). A run that still fails to load, seal or replay raises `RunUnreadable`: its own
  routes answer 500 `run-unreadable` and log the cause, `/state` and Ask's context leave it out
  and log it, and `/export` leaves it unsealed and exports its stored rows as they are. The MCP's
  `get_programme`, `change_programme`, `end_programme` and `restart_programme` refuse it in a
  sentence ([mcp.md](mcp.md) §1.1), and `list_programmes` lists the other runs.

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
ending today, on the first three trackers, through the same merge as Settings → Import. That merge adds a week's plan only where
the account has none, fills only empty days and gives details only to items that have none, so a
second run adds nothing, and an existing account keeps its password and every mark and note it
has. The demo uses the default plan's ids, and shows every kind in every drawing, met and unmet
goals, and a day over the pick. Push-ups, Running and Fish get details, so the item page has
something to show.

It also adds a running programme, so the local stack shows one ([programmes.md](programmes.md)).
The library gains the beginner programme of `fixtures/programmes/valid/beginner-5x5.json` under
the id `beginner-5x5`, when it has no programme with that id. Then, when the account has no
tracker `beginner-5x5-run`, it starts a run of it on the Monday three weeks before this week's, so
today falls in programme week 4, a deload. A start and a change take effect today or later, so the
run's past is lived through the same data functions as the API, each with `data.When` set to the
moment it happened: the start at 07:00 on its Monday; the deadlift paused for a week on week 2's
Wednesday ("Sore lower back after Monday."); the squat's increase set to 7.5% on week 3's Monday
("Squats feel easy."), each previewed and then confirmed with its `rev`; and Monday, Wednesday and
Friday marks at 19:00 on each day before today, week 2's Friday plank entered the next morning, so
late. A last seal covers the days up to yesterday. Nothing writes a past day directly. The run
counts in the totals: 8 week plans, its marks, and the squat's and the deadlift's notes as 2
items' details.

The command prints what it added ("Added 17 week plans, `<n>` marks and details for 5 items.",
the marks depending on the day of the week). It then names the programme: "Added the programme
Beginner 5×5 to the library." when the library gained it, and "Started a run of Beginner 5×5 on
the Monday 3 weeks back, as the tracker beginner-5x5-run. Its overview:
http://localhost:5173/#/programme/beginner-5x5-run" when the run is new. It prints "Nothing to
add" when the account already has all of it.

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
| `TIMEZONE`          | `Europe/Amsterdam`    | the IANA zone that decides today and this week for the MCP tools and Ask, and today for programmes: the lock, sealing and a change's from day (§3.4) |
| `ANTHROPIC_API_KEY` | (unset)               | turns Ask on (§3.2). Never logged                                         |
| `ASK_MODEL`         | `claude-sonnet-5-5`   | the Claude model Ask uses                                                 |
| `ASK_PER_DAY`       | `30`                  | questions per account in any rolling 24 hours; 1 or more                  |
| `ASK_PER_DAY_TOTAL` | `300`                 | questions across all accounts in any rolling 24 hours; 1 or more          |
| `OAUTH_CLIENT_HOSTS` | `claude.ai,claude.com,chatgpt.com` | the hosts whose client metadata documents may name an OAuth client (§3.3): host names separated by commas, matched exactly. A bad value stops the API at startup |

**Logging.** The API's own lines go to stderr at info and above (`docker logs fitness-api`), once
each, as `INFO:  tracker_api.<module> …`. They don't also go on to the root logger, which the MCP
SDK sets up with a plain handler of its own (`logging.basicConfig`). The
logs never hold what a person wrote or was told: no question, history, answer, note, goals, limits
or item name, and no email address. For Ask they hold, per request to Anthropic, the request id, the
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
  conversation so far, the person's My goals and limits notes, and whatever the tools read for it: the plans,
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
- Notes, My goals and the limits note are cut in code points, as Python counts a string, so an emoji is one
  character on both sides (`Array.from` in TypeScript).

`tests/test_parity.py` runs every case in `fixtures/transfer/`, the same files the Vitest suite
runs. A rule changed on one side without the other fails one of the two suites. The
`parse/cardio.json` case holds a cardio item to one normaliser (`normalise_cardio`,
`normaliseCardio`): whole seconds capped at 86,400, km rounded and capped at 1,000 like a weight,
and an exercise's fields dropped. The
`parse/goals*.json` and `parse/limits*.json` cases hold My goals and the limits note to one
normaliser each, and `merge-settings.json` holds the import's settings rule, goals and limits
filling only empty ones included. The `parse/daily-goal*.json` and `parse/week-title*.json` cases
keep Daily goal only as a boolean and the week title only as `"dates"` or `"number"`. The `parse/conversations*.json`
cases hold Ask's conversations to one normaliser (`normalise_conversations`,
`normaliseConversations`): the id rule, the cuts at 80, 2,000 and 64,000 code points, the times
as whole numbers from 0 to 2^53 − 1, the five stops, no answer kept without `end_turn` or
`max_tokens`, the first of each id, and the limits of 500 conversations and 200 turns.
`merge-conversations.json` holds the import's rule: only ids the account doesn't have are added.
`tests/test_types.py` and the app's `trackerTypes.spec.ts` both read `fixtures/types/registry.json`,
so the two registries keep the same first three trackers' ids and names, kinds, fields,
daily-target keys, new trackers' daily targets and new-item goals. The `parse/v6-*.json` cases
hold a version 6 file's trackers and data by id to one reader, and `sample/export-v6.json` is a
version 6 export that imports and exports unchanged.

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
  the 26-week bound, Monday keys, item history, goals with both notes and consistency, and cardio's session with
  no daily target. Then the account's trackers: defaults on the `exercise` and `diet` trackers
  only, a new tracker by its kind and its own daily target, a tracker by id or by name, a shared
  name refused, `trackers`, and an ended tracker absent from its end week on.
- `test_api.py`: the HTTP layer: the write guard, error shapes, body limits (chunked too), every
  data endpoint, user isolation, `X-Expected-User`, sign-up and its refusals (closed included),
  the quota on plans, ticks and imports, every mark and the old `done` body, import and export
  (the sample round trip, version 1 files, existing marks winning), and the strength arrangement
  under its old key for a tab on older code.
- `test_trackers.py`: the tracker endpoints (create, the client's id sent again, rename, move, the
  daily target, revisions and conflicts, 400s, 404s and the cap), the weeks a tracker shows in and
  Delete tracker keeping its history, writes checked against the user's trackers and validated by
  kind (a mobility plan by hold time and by reps, its weight dropped), users kept apart, the daily targets moving with the settings both ways, the state's new
  and older keys, and export version 6 into another account, never changing or ending a tracker,
  the cap, version 5 files and the version 6 sample.
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
  and users kept apart, 400s, the quota, export version 6, import keeping existing details, and a
  version 4 file's notes lifting into details.
- `test_types.py`: the registry against `fixtures/types/registry.json`, the `Section` literal,
  `validate.py` reading it, the `strength` kind, cardio having no daily pick or target, and
  mobility as strength without weight (a hold and reps, the weight dropped, reps or seconds not
  both).
- `test_seed.py`: `seed-demo` only on a local stack, a confirmed account, three weeks of every mark
  in each tracker, details for three items, an account's own marks and details kept, a second run
  adding nothing, Cardio added to an account seeded before it, and what the CLI prints. For
  programmes: the library programme and a run started weeks back, a second run adding no run, an
  account from before it getting both, a deleted library programme put back without a second run,
  and the CLI printing the run's overview address.
- `test_programme.py`: the programme format: parsing and validation against the fixtures in
  `fixtures/programmes/` (every error with its path), the committed JSON Schema, the parameters,
  and the expansion of values: rounding, `add` and `rate` steps, the cap, scales, overrides, and
  the golden weeks worked by hand.
- `test_programme_replay.py`: the change log and its replay: the mockup run week by week, each
  change type and its from-day rule, pauses, resumes and going to a week, activities added and
  ended, hand-edits, undo, sealed days, the change checks and the preview, the revision, and the
  week's items.
- `test_programmes_api.py`: the library over REST: the public schema, the session and Origin
  checks, list, add, read, replace with `rev` (a stale one gets 409 with the server's copy),
  delete and validate (every error, nothing stored), another account's programme as 404, and the
  count, size and quota caps.
- `test_runs_api.py`: runs over REST: start and its preview, the run's own copy of the programme,
  the grid, change previews and applies with `rev` (only the change, from day and reason
  previewed, never with the run's own `rev`), what a change rewrites in the plans, pauses, skips
  and undo, the run's tables in the quota (a full account refusing a change but taking marks and
  sealing), the lock on past days and sealing, a stored run loading after an engine change
  and an unreadable one leaving the rest answering, End programme, and export and import of the
  library and the runs.
- `test_ask.py`: Ask with no network. An `httpx2.MockTransport` behind the SDK replays Messages
  API event streams, built in the documented wire format: a plain answer, a tool round, every
  tool, a refusal, `max_tokens`, the last round, 529, 429, 500, a dropped connection, a timeout,
  an error mid-stream, and 400, 401, 403 and 404. It covers the request's settings, the context
  turn, the event order, user isolation against forged tool input, error results, the 20 KB cap,
  every validation refusal (forged tool and thinking blocks included), both caps and their
  `Retry-After`, parallel claims, keep-alives, a disconnect cancelling the answer, the prompt's
  rules and the verdict switch, the trackers the week shows in the context turn, a tracker id
  from another account refused, and that no question, history, answer, goals or limits reach the
  logs.
  For the history: the earlier turn in a follow-up's request, read from the database; a
  `history` or any other key refused; what each stop saves, a client that leaves included; the
  title; the 20-turn and 40,000-character caps; another account's id refused on read, delete and
  ask; listing, deleting one and deleting all; a full account; and a conversation deleted while
  it answers.
- `test_db.py`, `test_config.py`, `test_backup.py`, `test_cli.py`: migrations (including racing
  ones, the WAL switch, old ticks reading as `great` after step 2, every row surviving step 6
  from a populated database, step 7 lifting each item's latest note, rerunning and on an empty
  database, step 8's empty column, step 9's goals and step 15's limits reading as none, and Ask's tables after steps 10
  and 11 holding text only and going with their user, step 14 keeping every plan and tick and
  taking a cardio row, step 16 giving each user the first three trackers with their targets,
  moving the arrangement's key, passing over what it can't read, the trigger for new users, and
  `REVERT_TRACKERS` giving back version 15, and step 18's five programme tables: added empty to
  a dirty version 17 database with every row kept, rerun from a partial state, the spec's columns,
  the checks on a run's rows, and a run's rows going with their user), configuration from the environment (`TIMEZONE`, and the
  week turning over at local midnight), daily copies, `tracker-admin`.
- `test_mcp.py`: the MCP endpoint through `TestClient`: `initialize`, `tools/list` and `whoami`
  with a token, on both protocol kinds, and each refusal (no, bad, revoked or disabled token; a
  cookie alone; a token in the query string; a foreign `Origin` or `Host`; a method other than
  POST; an oversized body; a redirect). Where the endpoint's rule differs from REST's, the same
  test checks a REST route too, so an exemption wider than `/api/mcp` fails. Then every tool:
  the parity cases through `week_summary`, the read tools' defaults and refusals (a week at the
  calendar's end included), a read token refused on writes, and each write's result. For the
  account's trackers: the instructions, `list_trackers`, `add_item` and `mark_day` on a new
  tracker by id and by name, `add_item` on a mobility tracker (a hold, reps, `weight_kg` and
  `distance_km` refused), an ended tracker absent from its end week on, `section` as an alias,
  and goals and daily targets per tracker. For programmes: an agent saving, starting and changing
  one through MCP alone, `programme_format`, `save_programme` (the document as JSON text, replace
  with `rev`, the library and size caps), `list_programmes`, `get_programme` (an unreadable run a
  plain refusal while the rest answer), `start_programme` (every problem listed, a date,
  parameters and a name, the tracker cap), `change_programme` (today by default, an ordinary or
  ended tracker refused), `end_programme` (a preview that changes nothing, a confirm that ends the
  run with the connection as its source, a stale `rev` previewed again, an ordinary or ended
  tracker and a past day refused), the item tools refusing a programme tracker, and `mark_day` following
  the lock.
- `test_oauth.py`, `test_oauth_api.py`, `test_tokens_api.py`: OAuth's storage and rules (clients and
  redirects, codes, rotation and its grace, reuse, expiry, the caps, sweeping, ending credentials
  together), then its routes (discovery, authorize and each of its errors, the consent calls, the
  token and revoke guard, Connections) and the personal-token routes. `test_mcp.py` also covers the
  verifier's prefix dispatch, expiry on the clock, the grant's resource and the 503.
- `test_edits.py`: the plan edits behind the write tools: copying a carried week first, the ids
  the server makes, each field's bounds, replaying a conflict, the quota, marks per tracker,
  cardio's fields and refusals, daily targets on any strength or food tracker (the older form
  too), and the account's trackers: one by id or name, another account's refused, a new tracker
  empty, and an ended tracker's weeks from its end on refused while its earlier ones take
  changes.
- `test_validate.py`: the write checks REST and MCP share: week keys, plan bodies, item ids, days,
  marks, the stricter item shape for MCP writes, and cardio's normaliser.
- `conftest.py` gives each test a temporary database, a controllable clock, a cheap hasher and a
  mailer that records instead of sending (`mail_client`), and puts the package logger back after
  each test;
  `fixtures.py` reads `fixtures/transfer/`.
