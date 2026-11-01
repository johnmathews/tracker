# The MCP server

> Purpose: why the API now has an MCP endpoint, what it can do, how it is guarded, and what was
> measured before it shipped. The connection guide is [docs/mcp.md](../docs/mcp.md).

## 1. Why

John asked for "an mcp server to the tracker app so that an agent can ask the app how my workouts
and training are going". At the start he chose four things: a remote HTTP endpoint, personal API
tokens, reads plus plan edits, and to start now and rebase on the parallel tracker-types run later.
The /ask run was building the same read-only view of the data at the same time. So that view,
`insights.py`, landed first in its own PR (#53), and this branch builds on it.

## 2. What was built

- **`POST /api/mcp`**, on the official `mcp` SDK (2.3). It is stateless, answers in JSON and
  accepts POST only, so nginx never holds a stream open and a deploy loses no session. It is
  mounted at the exact path, so there is no 307.
- **Personal API tokens** (`api_tokens`, migration 6). A token is `trk_` plus 43 URL-safe
  characters. The database keeps only its SHA-256. Each token is `read` or `write`, and
  `tracker-admin token create | list | revoke` manages them. A password reset, `disable` and
  `revoke-sessions` delete an account's tokens.
- **Read tools** over `insights.py`: `whoami`, `week_summary`, `weeks`, `item_history`, `goals`
  and `consistency`. A test runs every `fixtures/insights/` case through `week_summary`, so the
  tool reports a week as the screen shows it.
- **Write tools** in `edits.py`: `add_item`, `update_item`, `remove_item`, `mark_day` and
  `set_daily_targets`. A carried week gets its own copy first, in the same write. A conflict is
  replayed up to three times. Each result has `before` and `after`.
- **Shared write checks** in `validate.py`, used by both REST and MCP.
- **`TIMEZONE`** (default `Europe/Amsterdam`), so "today" and "this week" match the app while the
  container clock stays in UTC.

## 3. Decisions

These are P20 to P24 in [decisions.md](../docs/decisions.md):

- **The two kinds of credential stay apart.** `/api/mcp` takes a bearer token only and never reads
  the cookie. No REST route takes a bearer token. A token in the query string gets 400
  `token-in-url`. A missing `Origin` passes on `/api/mcp`, because agents send none. A wrong one
  gets 403.
- **Narrow writes.** A tool changes one item or one mark at a time, and the server makes the ids.
  A model can't overwrite a whole plan in one call.
- **The SDK hides crashes.** Only `ToolError` text reaches the agent. Every refusal reads
  `field: message`.

## 4. What was observed

- **W6, on 2026-11-01, through nginx in `docker compose`:** `initialize`, `tools/list` and ten
  `whoami` calls returned 200 in 2.6 to 10 ms with no redirect. `GET` got 405, no token got 401, a
  foreign `Origin` got 403, and REST with a bearer token got 401. The token appeared 0 times in
  the API and web logs. (confirmed)
- **Memory:** `memory.peak` was 126 MiB in three runs on this branch, against 108 to 111 MiB on
  main. One first start after a build read 140 MiB. The limit is 160 MiB. (confirmed) The headroom
  is thin, so John was told to consider 192m in the home-server repo.
- **The wrap-up review** found that `week_summary` and `weeks` crashed on the last week of the
  year 9999 (`OverflowError`), so the agent saw only "Error executing tool". The read wrapper now
  turns that into `date: a week or date is out of range`. Writes in that week don't crash, because
  none of them counts past it.
- **The coverage number was stale for most of the run.** pytest here doesn't collect coverage.
  CI runs `coverage run -m pytest`. A bare `coverage report` read a 13:30 `.coverage` file. The
  real figure, measured at wrap-up, is 99% over 606 tests.
- **The arm64 smoke test** now also loads the `Europe/Amsterdam` zone, so an image without zone
  files fails the build rather than stopping at startup.

## 5. What is deliberately not done

- **No OAuth.** Claude Code sends a bearer header, and Claude Desktop does so through the
  `mcp-remote` bridge, which is enough for one person. `resource_metadata` answers 404.
- **No GET or SSE stream.** Stateless JSON over POST needs neither.
- **The production `mem_limit`** lives in the home-server repo, so it is John's change to make.
- **A removed item that is added back gets a new id**, so its old marks don't reattach.
- **A settings change queued in the app can overwrite `set_daily_targets`.** The last writer
  wins, as between two devices.
- **Making CI required for a merge** (finding F17) is John's call on the repository's settings.
