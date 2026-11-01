# API

> Purpose
>
> The API service in `api/`: accounts, sessions, invites, email, the synced data, the read-only
> insights over it, Ask, the admin CLI and backups. It is the reference for the endpoints the
> client calls and for running the service.

## 1. Overview

A FastAPI app on Python 3.13, served by uvicorn on port 8000 as one process. It stores everything
in SQLite at `$DATA_DIR/fitness.db` (WAL mode, foreign keys on). The web container's nginx forwards
`/api/` to it, so the browser sees one origin and the CSP stays unchanged. Every user's rows are
scoped by `user_id`, and no endpoint reads another user's data.

| Module        | Holds                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `config.py`   | `Config`, read from the environment (§6)                                                                                         |
| `db.py`       | connections, the schema and its migrations                                                                                       |
| `validate.py` | the port of `src/lib/storage.ts` and `src/lib/transfer.ts`                                                                       |
| `auth.py`     | password hashing, lockout, sessions, sign-up and its caps, invite, reset and confirmation tokens                                 |
| `outbox.py`   | which emails go out and when: the limits (§4.1), the links, the message                                                          |
| `emails.py`   | the two emails, built to the EmailLayout card, and that card's preview                                                           |
| `mail.py`     | the Resend client, and sending after the response                                                                                |
| `data.py`     | reading and writing plans, ticks, settings and Ask's history; import, export; the quota (`usage`)                                |
| `insights.py` | read-only views of a user's weeks, counted as the screen counts them (§1.1)                                                      |
| `ask.py`      | Ask (§3.1): the question's checks, the daily caps, the history sent, the prompt, the tools, the Claude loop and saving each turn |
| `app.py`      | the HTTP layer: routes, the write checks, error mapping                                                                          |
| `backup.py`   | the daily `VACUUM INTO` copy                                                                                                     |
| `cli.py`      | `tracker-admin`                                                                                                                  |
| `seed.py`     | `tracker-admin seed-demo`: a demo account and three weeks of marks, on a local stack only                                        |

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
| `goals(conn, user_id, today)`                                 | today's week's items with their goals, `exercises_a_day`, `foods_a_day`, and `note`, the My goals text from settings (`""` when there is none)                                                                                                                      |
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

| Table               | Key                                 | Columns                                                                                                                                                                                                            |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`             | `id`                                | `username` (unique, case-insensitive; the lower-cased email for a signed-up account), `password_hash`, `disabled`, lockout counters, `created_at`, `email_confirmed_at`                                            |
| `sessions`          | `token_hash`                        | `user_id`, `created_at`, `last_seen`, `expires_at`                                                                                                                                                                 |
| `invites`           | `token_hash`                        | `kind` (`invite` or `reset`), `username`, `user_id` (resets), `expires_at`, `used_at`, `mailed` (a reset sent by email)                                                                                            |
| `confirmations`     | `token_hash`                        | `user_id`, `created_at`, `expires_at`, `used_at`: confirm-your-email links                                                                                                                                         |
| `mail_log`          | `id`                                | `user_id`, `kind` (`confirm` or `reset`), `sent_at`: one row per email attempted (a failed send still counts), for the limits                                                                                      |
| `ask_log`           | `id`                                | `user_id`, `asked_at`: one row per question claimed (a failed answer still counts), for Ask's caps. It holds nothing of the question or the answer                                                                 |
| `ask_conversations` | `(user_id, id)`                     | `title` (the first question, trimmed and cut to 80 characters), `created_at`, `updated_at`: Ask's history (§3.1). The id is the account's own                                                                      |
| `ask_turns`         | `(user_id, conversation_id, seq)`   | `question`, `answer`, `stop` (`end_turn`, `max_tokens`, `refused`, `error` or `cancelled`), `asked_at`: one question and its answer, text only. Only `end_turn` and `max_tokens` keep an answer; any other is `''` |
| `settings`          | `user_id`                           | `accent`, `daily_pick`, `food_pick` (K57), `goals` (My goals, `''` for none)                                                                                                                                       |
| `plans`             | `(user_id, section, week)`          | `items_json`, `rev`                                                                                                                                                                                                |
| `ticks`             | `(user_id, section, week, item_id)` | `days`, `partial`, `missed`, `solid`, `hatch`: 7-bit masks (bit 0 is Monday); see below                                                                                                                            |

`section` is `exercise` or `diet`. Every row cascades from its user, and an Ask turn from its
conversation. Tokens and session ids are stored only as SHA-256 hashes. A database lookup with a
stolen copy of the file cannot recover a working cookie or link. Times are Unix seconds. The theme
is not stored: it belongs to the device.

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
the zigzag. Version 5 adds `food_pick` to `settings` (default 2), foods a day (K57). Version 6
adds `goals` to `settings` (default `''`), so every saved row reads as having no goals. Version 7
adds `ask_log`, indexed by user and time and by time alone, for Ask's caps (§3.1). Version 8
adds `ask_conversations` and `ask_turns`, Ask's history (§3.1). A conversation is keyed by its
account and its id, so the same id in two accounts, as after one imports the other's file, is two
conversations.

Migrations are a list in `db.py`, and the version is its length. A step is appended, never
inserted, and no code or test names its index: `test_db.py` finds the goals step by its text.
When two branches each append one, the one that merges second puts its step after the other's
and renumbers it in the paragraph above; nothing else changes.

## 3. Endpoints

All paths start with `/api`. Bodies are JSON, and errors are `{"error": "<code>"}`. Every response
carries `Cache-Control: no-store`.

**`X-Expected-User`.** A data request may name the user it expects; if the session belongs to anyone
else, it gets 401 `auth`. The client sends it on every read and write, so a tab left open as one
person can never touch the data of someone who signed in later in another tab.

**Writes** (`POST`, `PUT`, `DELETE`) must send `Content-Type: application/json` and an `Origin`
header equal to `PUBLIC_ORIGIN`; otherwise they get 403 `origin` or 415 `content-type`.
`SameSite=Lax` alone would not stop a request from another `*.itsa-pizza.com` host, because the
browser counts it as same-site. Bodies over 1 MiB get 413 `too-large` (6 MiB for `POST /api/import`,
so a full account's export goes back in whole), counted as they stream in, so
a chunked body is cut off at the limit rather than read whole. A body with nothing to send, such as
logout's, is `{}`. A `DELETE` sends no body at all, but the same `Content-Type` header.

| Method and path                            | Auth    | Does                                                                                             |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| `GET /healthz`                             | no      | `SELECT 1`; `{"ok": true}`                                                                       |
| `POST /auth/login`                         | no      | `{username, password}` → the account and the session cookie                                      |
| `POST /auth/signup`                        | no      | `{email, password}` creates an account → the account and the cookie                              |
| `POST /auth/logout`                        | session | ends this session and clears the cookie; 204                                                     |
| `GET /auth/me`                             | session | the account: `{username}`, plus `confirmed` (below)                                              |
| `GET /auth/options`                        | no      | `{mail, ask}`: whether this API sends email (§4.1) and answers questions (§3.1)                  |
| `POST /auth/forgot`                        | no      | `{email}` → 202 `{}` for any well-formed email; a reset link goes to a matching account (§4.1)   |
| `POST /auth/confirm`                       | no      | `{token}` confirms the email → the account; 410 `gone` otherwise                                 |
| `POST /auth/confirm/resend`                | session | a new confirm link → 202 `{}`; refusals in §4.1                                                  |
| `POST /invites/lookup`                     | no      | `{token}` → `{kind, username}` for a live link; 410 `gone` otherwise                             |
| `POST /invites/redeem`                     | no      | `{token, password}` sets the password, consumes the link, signs in                               |
| `GET /state`                               | session | everything the client renders (below)                                                            |
| `PUT /plans/{section}/{week}`              | session | `{items, rev}` → `{rev}`; 409 `conflict` with the server copy                                    |
| `PUT /ticks/{section}/{week}/{item}/{day}` | session | `{mark}` → `{days}`, the week's seven marks for that item                                        |
| `PUT /settings`                            | session | `{accent, dailyPick, foodPick, goals}` → the stored settings; a key left out keeps the saved one |
| `GET /export`                              | session | the export file (`architecture.md` §4)                                                           |
| `POST /import`                             | session | an export file, merged in; → `{weeks, ticks, settings, conversations}` added                     |
| `GET /ask`                                 | session | `{remaining, limit}`: questions left today, and the per-account cap (§3.1)                       |
| `POST /ask`                                | session | `{question, conversation?, today}` → Claude's answer as a stream of events (§3.1)                |
| `GET /ask/conversations`                   | session | `{conversations: [{id, title, updatedAt, turns}]}`, the one updated last first (§3.1)            |
| `GET /ask/conversations/{id}`              | session | `{id, title, createdAt, updatedAt, turns: [{question, answer, stop, askedAt}]}`                  |
| `DELETE /ask/conversations/{id}`           | session | deletes the conversation and its turns; 204                                                      |
| `DELETE /ask/conversations`                | session | deletes every conversation of the account; 204, also when there are none                         |

**The account** is `{username}`: the account's email (the field keeps its old name, so older
tabs and clients work unchanged). While mail is on it also carries `confirmed`, true once the
address is confirmed. A legacy account still named by a username (below), and every account while
mail is off, has no such key.

`GET /state` returns `{exercise, diet, settings}`. Each section is `{plans, log, revs}`: `plans`
and `log` have the same shape as in `localStorage` (a log row is seven marks or nulls), and `revs`
maps each planned week to its revision. `settings` is `{accent, dailyPick, foodPick, goals}`, or
null before any are saved.

**Settings.** `accent` is any `#rrggbb`, and `dailyPick` and `foodPick` are clamped to 1–8, each
falling back to its default. `goals` is My goals: the person's own words about what they are
aiming for, which only Ask reads (`insights.goals`). It is trimmed of spaces, tabs and line
breaks at its ends and cut to 1,000 characters, counted as code points (`normalise_goals`);
blank goals are `""`. A tab still running older code sends no `foodPick` or no `goals`, and
the saved value stays rather than resetting. Goals that aren't a string count as not sent, so
only a string, `""` included, replaces them. The web app never sends goals it hasn't read
(`architecture.md` §7).

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

**Quota.** Each user may store 5 MiB: the bytes of their plans' JSON plus 64 for each tick row, and
for Ask's history the UTF-8 bytes of each title, question and answer plus 64 for each conversation
and each turn. A plan write, a tick that would add a row, or an import that would take the account
over it gets 413 `quota` and changes nothing. An Ask turn that would is not saved, and its answer
says so (§3.1). Writes that keep usage level or shrink it always succeed, so a full account can
still change existing ticks and trim its plans. Settings do not count and are never refused. The
quota measures what the account holds, not the bytes on disk, which include keys and indexes. The
client drops a refused write with a notice that the account is full (`architecture.md` §7), and an
import says the same.

**Export** writes version 4 of the file: an exercise or a food may carry `notes`, and each log row
is seven marks, drawings included, or nulls. Its settings carry `goals`, which took no new version,
as `foodPick` didn't: a reader from before them drops the key, and a file without them reads as no
goals. The API's export also carries `conversations`, Ask's history, the one updated last first, in
the shape `GET /ask/conversations/{id}` returns; it took no new version either. The browser keeps
no conversations, so Settings → Export writes the device's plans, marks and settings and takes
`conversations` from this export (`architecture.md` §4); with none, the file has no such key.
Import reads
version 4, version 3 (no notes), version 2 (kinds only, which read as the zigzag) and version 1,
whose `true` days read as `great` and `false` days as empty; any other version gets `version`.

**Notes** (K43) live in a plan's items, inside `items_json`, so they took no migration. An item's
`notes` is markdown, trimmed of spaces, tabs and line breaks at its ends and cut to 500 characters
(`normalise_notes`); a blank note, or one that isn't a string, is left out. The API stores the
text as written and never renders it.

**Import** applies the merge rule from `architecture.md` §4: existing weeks keep their plan; per
week, item and day a marked day keeps its mark and an empty one takes the file's; and settings apply
only when the account has none. My goals are the exception: the file's fill the account's goals when
those are empty, and never replace goals already saved. It returns what it added (`ticks` counts the
empty days that gained a mark; `settings` is true when the file changed the account's settings, its
goals alone included; `conversations` counts the conversations added), in one transaction. A file's
conversation is added only when the account has none with its id, and one the account has is never
changed. The file's conversations are read as `normalise_conversations` reads them (§9): an entry
with a bad id, title, time or turns list is dropped, a bad turn drops out of its conversation, the
first of each id is kept, and at most 500 conversations of 200 turns each are read from a file. A
file that fails to parse gets 400 with `json`, `format` or `version`, the same codes the client
shows.

### 3.1 Ask

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
- `today` is the browser's date, `YYYY-MM-DD`. It must be within a day of the server's UTC date,
  since every time zone's date is. The server can't know the browser's date, and "this week"
  depends on it.

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
the first user turn instead. The voice is John's ruling (F7, K65, voice.md "Ask"): facts first and
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
the account has none and fills only empty days, so a second run adds nothing, and an existing
account keeps its password and every mark it has. The demo uses the default plan's ids, and shows
every kind in every drawing, met and unmet goals, and a day over the pick.

## 6. Configuration

| Variable            | Default               | Meaning                                                                   |
| ------------------- | --------------------- | ------------------------------------------------------------------------- |
| `DATA_DIR`          | `/data`               | holds `fitness.db` and `backup/`                                          |
| `PUBLIC_ORIGIN`     | (required)            | e.g. `https://fitness.itsa-pizza.com`; checked on writes, used in links   |
| `COOKIE_SECURE`     | `true`                | `false` for plain-http local runs; the cookie is then `session`           |
| `BACKUP_KEEP`       | `7`                   | daily copies kept in `$DATA_DIR/backup/`                                  |
| `MAX_USERS`         | `50`                  | sign-up closes once this many accounts exist; `0` turns sign-up off       |
| `RESEND_API_KEY`    | (unset)               | turns mail on (§4.1); a key with sending access is enough. Never logged   |
| `MAIL_FROM`         | (required with a key) | the From line, `Name <address>` on a domain verified in Resend            |
| `MAIL_PER_HOUR`     | `30`                  | emails of every kind, across all accounts, in any rolling hour; 1 or more |
| `ANTHROPIC_API_KEY` | (unset)               | turns Ask on (§3.1). Never logged                                         |
| `ASK_MODEL`         | `claude-sonnet-5-5`   | the Claude model Ask uses                                                 |
| `ASK_PER_DAY`       | `30`                  | questions per account in any rolling 24 hours; 1 or more                  |
| `ASK_PER_DAY_TOTAL` | `300`                 | questions across all accounts in any rolling 24 hours; 1 or more          |

**Logging.** The API's own lines go to stderr at info and above (`docker logs fitness-api`). The
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
- A log entry keyed `__proto__` is dropped.
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
  reset for an email account.
- `test_mail.py`: the Resend request's shape and its errors, the two emails (words, escaping,
  the email rules) and the EmailLayout card being current, `GET /auth/options`, confirming
  (links, expiry, resend and its limits, invited accounts, mail off, a failed send), forgot
  password (same answer for anyone, the hour's lifetime, confirming by a mailed reset only, silent
  limits) and `MAIL_PER_HOUR` across kinds.
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
  ones, the WAL switch, and old ticks reading as `great` after step 2), configuration from the environment, daily copies, `tracker-admin`.
- `conftest.py` gives each test a temporary database, a controllable clock, a cheap hasher and a
  mailer that records instead of sending (`mail_client`), and puts the package logger back after
  each test;
  `fixtures.py` reads `fixtures/transfer/`.
