# Connecting an agent

> Purpose
>
> How to connect your own Claude or ChatGPT to the tracker's MCP server: what the server offers, how
> to sign in from claude.ai, Claude Code and ChatGPT, how to create a token for clients that use
> one, and what to do when a call fails. The endpoint's rules and every tool argument are in
> [api.md](api.md) §3.1, and the sign-in's in §3.3. The programme tools' results and refusals are
> in §1.1 below, and the programme format in [programmes.md](programmes.md).

## 1. What the server offers

The server lives at `/api/mcp` and lets an agent read the training log and, with a write token,
change it. Each token or connection belongs to one account and acts only as that account.

The log holds your trackers. Each has an id, a name and a kind:

- **strength**: exercises, with sets, reps or seconds, each side, and weight;
- **cardio**: sessions such as cycling or running, with a time in seconds and a distance in km,
  either, both or neither, and no daily target;
- **food**: foods eaten, marked only as eaten;
- **mobility**: stretches and holds, with sets, then reps or seconds (a hold), each side, and
  no weight. `weight_kg` is refused for one.

Every account starts with three trackers: `exercise` (named Strength), `cardio` and `diet` (named
Food). Trackers you add in the app get random ids. `list_trackers` gives every tracker's id.

The tools that act on one tracker take `tracker`: its id, or its name in any case. A name that
two trackers share is refused, with their ids. With no `tracker`, a tool acts on `exercise`.
Older clients may still send `section` with `exercise`, `cardio` or `diet`; it works as
`tracker` does.

A tracker shows from the week it was created in. A deleted tracker shows in no week from the week
it was deleted in, but its earlier weeks keep it, with their marks and notes. The tools follow
the same rule: a week that doesn't show the tracker is refused, or left out of a range. Only the
first Strength and Food trackers show default items while nothing is planned. Every other tracker
starts empty.

**Read tools** answer questions about the log. A `read` or a `write` token may call them.

| Tool            | Answers                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `whoami`        | Which account and scope the token has. Use it to test the link.                    |
| `list_trackers` | Every tracker: id, name, kind, daily target, start and end weeks.                  |
| `week_summary`  | How one week of one tracker went, item by item, against its goals.                 |
| `weeks`         | Several weeks of one tracker side by side, for a trend.                            |
| `item_history`  | One item over the last weeks, and its whole note.                                  |
| `goals`         | This week's goals and daily target per tracker, and the My goals and limits notes. |
| `consistency`   | The share of days and goals met in one tracker, and the current streaks.           |

The "My goals" and limits notes are the person's own words: what they are working towards, and
what they have to work around. Any agent connected to the account reads them through `goals`, as
Ask does in the app.

**Write tools** change plans, items' notes, marks and daily targets as the app does. Only a `write` token or a Read and change connection may call them.

| Tool                | Does                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `add_item`          | Adds an item to a week's plan, in any tracker.                              |
| `update_item`       | Changes the fields given on one item, or its note.                          |
| `remove_item`       | Takes one item out of a week's plan.                                        |
| `mark_day`          | Marks one item on one date, or clears the day.                              |
| `set_daily_targets` | Sets how many items a day make a day count, for a strength, food or mobility tracker. |

`set_daily_targets` takes `tracker` and `daily_target`, 1 to 8. Its older form still works:
`exercises_a_day` sets the `exercise` tracker's target and `foods_a_day` the `diet` tracker's.

An item's note belongs to the item, not to a week. It is the note the item's row and its page show
in the app, the same in every week. Changing it changes no week's plan. A note runs to 20,000
characters. `week_summary`, `weeks` and `goals` give the first 500, and a longer note ends in "…"
there. `item_history` gives the whole note. A `note` sent to `add_item` or `update_item` replaces
the whole note, so read it with `item_history` before writing it back.

[api.md](api.md) §3.1 lists the arguments and results of every tool.

### 1.1 Programmes

A programme is a plan of several weeks, written as one JSON document in the
`tracker-programme/1` format ([programmes.md](programmes.md)). An agent can write one, save it to
your library, start it and change it. A started programme is a tracker of its own, a **programme
tracker**, whose weekly plans the server writes from the programme.

| Tool               | Scope | Does                                                                                         |
| ------------------ | ----- | -------------------------------------------------------------------------------------------- |
| `programme_format` | read  | The format's JSON Schema, a worked example, each type of change, and how to use them.        |
| `list_programmes`  | read  | Your library, and every run with its status and week.                                         |
| `get_programme`    | read  | One library programme with its document, or one run with its clock, log and coming weeks.    |
| `save_programme`   | write | Checks a document and adds it to the library, or replaces one. Lists every problem.          |
| `start_programme`  | write | Starts a library programme as a new tracker, from today or a later day.                      |
| `change_programme` | write | Previews one change to a run, then applies it when confirmed with the preview's `rev`.        |

**What each returns:**

- `programme_format()` returns `{format, schema, example, changes, notes}`. `schema` is the one
  `GET /api/programme.schema.json` serves. `changes` lists each change type as
  `{type, keys, does}`.
- `list_programmes()` returns `{programmes, runs, this_week, today}`. Each programme is
  `{id, name, description, kind, weeks, activities, rev, createdAt, updatedAt}`, without its
  document. Each run is `{tracker, trackerName, programmeId, name, status, week, weeks, start, end,
  pausedSince, pausedUntil, pauseReason, rev}`, ended runs included. A run the server can't read
  is left out, and the others still list. `status` is `upcoming`, `running`, `paused` or
  `ended`.
- `get_programme(programme=…)` returns `{programme, run: null}`, the programme with its `doc`.
  `get_programme(tracker=…)` returns `{programme: null, run}`, the run as
  [api.md](api.md) §3.4 describes it, with the grid's weeks from this one on. `tracker` is the
  programme tracker's id, or its name in any case.
- `save_programme(doc, programme?, rev?)` returns `{programme}`, the stored programme with its `id`
  and `rev`. Without `programme` it adds the document; with `programme` and its `rev` it replaces
  that one. Runs already started keep their own copy.
- `start_programme(programme, start?, params?, name?)` returns `{tracker, run}`. `start` is
  `YYYY-MM-DD`, today or later, today by default. `params` sets parameters by key, such as
  `{"squat": 50}`; the others keep their defaults. `name` is the tracker's, up to 60 characters.
- `change_programme(tracker, change, from_date?, reason?, confirm?, rev?)` takes one change body
  ([programmes.md](programmes.md) §8), such as
  `{"type": "pause-activity", "activity": "squat", "weeks": 2}`, from `from_date` (today by
  default) with an optional reason in the person's words. Without `confirm` it returns a preview:
  `{preview: true, stale: false, message, rev, change, cells, blocking, endsShort, undoes,
  deletes}`, and nothing changes. Show the person the preview, then send the same call with
  `confirm: true` and the preview's `rev`. That returns `{preview: false, stale: false, message,
  change, run}`, with `message` "Changed from 2026-11-18.". If the run changed since the preview,
  the result is a fresh preview with `stale: true`, and nothing changed.

**Refusals** come back as tool errors whose first word names the argument:

| Refusal                                                                                                                                  | Means                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `doc: the programme has 3 problems, so nothing was saved. Fix each one and send it again.` then one line each, `- weeks: give a whole number from 1 to 52.` | The document has problems; each line has its JSON path. Nothing was stored.        |
| `doc: is not a JSON object; send the object itself`                                                                                        | The document came as JSON text, not an object.                                                    |
| `rev: give the programme's rev, from list_programmes or get_programme, to replace it`                                                     | A replace needs the programme's `rev`.                                                            |
| `rev: the programme changed since rev 2; it is at rev 3 now. …`                                                                           | Someone saved it since. Read it again with `get_programme`, then send the document with that rev. |
| `doc: the library holds 100 programmes, the most it can; delete one in the app first`                                                    | The library is full.                                                                              |
| `programme: no programme x… in the library; list_programmes lists them`                                                                   | No library programme has that id.                                                                 |
| `programme: give programme (a library id) or tracker (a running one), not both`                                                           | `get_programme` takes exactly one of the two.                                                     |
| `programme: the start has 1 problem, so nothing was started. …` then `- start: a programme starts today or later.`                        | A start date, name or parameter that doesn't fit.                                                 |
| `tracker: the account has 100 trackers, the most it can hold; delete one in the app first`                                                | A start would add a tracker past the cap.                                                         |
| `tracker: Yoga is not a programme tracker; list_programmes lists the runs`                                                                | `get_programme` or `change_programme` named an ordinary tracker.                                  |
| `change: the change has 1 problem, so nothing was changed. …` then `- change.activity: deadlift is already paused on Wed 7 Oct.`          | The change doesn't fit the run on its from day. A from day before today reads `from_date: a change starts today or later.` |
| `tracker: Beginner 5×5 has ended, so its programme takes no more changes. start_programme starts it again as a new run`                   | The run was ended with End programme.                                                             |
| `quota: the account is full, so nothing was saved` (or started, or changed)                                                              | The account's 5 MiB are used.                                                                     |
| `tracker: Beginner 5×5's programme can't be read right now, so nothing was changed. The fault is the server's and is logged; the other trackers still answer. Try again later.` | `get_programme` (without "so nothing was changed") or `change_programme` met a stored run that fails to load or replay. The server logs the cause. |

**A programme tracker's own rules:**

- `add_item`, `update_item` and `remove_item` refuse it and name `change_programme`, since its plan
  comes from its programme: `tracker: Beginner 5×5 is a programme tracker: its plan comes from its
  programme, so its items can't be added, changed or removed one week at a time. Use
  change_programme instead …`. `update_item` still sets an item's note alone, since a note is no
  part of a plan.
- `mark_day` follows the lock. Days before today are a record: today's and yesterday's marks can
  be set or cleared, and an earlier day's can't (`date: 2026-11-16 is locked. …`). A mark for
  yesterday is recorded as late, and the result has `late`. A later day can be marked, as on any
  tracker.
- Every mark and change an agent makes records the connection as its source: the token's name, or
  the app's name for an OAuth connection ("Claude"). The run's log keeps it with each change.
- The read tools (`week_summary`, `weeks`, `item_history`, `goals`, `consistency`) read a programme
  tracker as any other, since its weeks are ordinary plans.
- **End programme has no tool yet** (follow-up F1). Ask the person to end a run in the app.

## 2. Two ways to connect

**Sign in with OAuth** (claude.ai, Claude Code and ChatGPT). You paste the address and the app opens
a tracker page where you sign in and choose what the app may do. Nothing is copied by hand. The
connection lasts 90 days, then you connect again. You can remove it earlier in Settings.

**Use a token** (Claude Code, Claude Desktop and scripts). You create a token in Settings and give
it to the client in a header. A token works until you remove it.

Both act only as your account, and either can be read only or read and change.

### 2.1 Creating a token

Open the tracker, then **Settings › Connections**. Under **Tokens**:

1. Choose **Create token**.
2. Give the token a name, such as `laptop` or `phone`. Give each client its own.
3. Choose **Read only** or **Read and change**. A write token also reads.
4. Choose **Create token** again. The page shows the token once, with a Copy button. Copy it now.
   The server stores only a hash, so nobody can show it to you again.

The list shows each token's first characters (`trk_AbCd1234…`), its access, when it was created
and when it was last used. **Remove** ends a token at once, after you confirm. An account can hold
20 tokens. A password reset, `disable` or `revoke-sessions` ends all of them.

An admin can do the same from the server, which also works for an account that cannot sign in.
Run `tracker-admin` in the API container. Locally, run it from `api/` with the same environment
as the API (`DATA_DIR=./.data`).

```sh
# Production
docker compose exec fitness-api tracker-admin token create <email> --name <name> [--write]
docker compose exec fitness-api tracker-admin token list <email>
docker compose exec fitness-api tracker-admin token revoke <email> trk_AbCd1234
docker compose exec fitness-api tracker-admin token revoke <email> --all

# Local
uv run tracker-admin token create <email> --name <name> --write
```

The CLI prints the token once and has no limit on how many it makes. On John's home server, the API
runs on the `infra` VM, in the compose project in `/srv/infra` (home-server
`documentation/infra_vm.md`, "Tracker"):

```sh
ssh infra 'cd /srv/infra && docker compose exec fitness-api tracker-admin token create <email> --name laptop --write'
```

## 3. Which URL

Use the public HTTPS URL: `https://<public host>/api/mcp`. Replace `<public host>` with the host
in `PUBLIC_ORIGIN`. On John's home server that is `https://tracker.itsa-pizza.com/api/mcp`.
Settings › Connections shows the address for your site, with a Copy button. Without a token the
endpoint answers 401, which shows it is up.

- **Skip the LAN port.** It serves plain HTTP, so anyone on the network can read the token. The
  server also answers 421 for the LAN address.
- **Send a token in the `Authorization` header only.** A token in the URL gets 400.
- **Locally, use `http://localhost:8000/api/mcp`.** The server accepts a `Host` of `localhost` or
  `127.0.0.1` with any port, whatever `PUBLIC_ORIGIN` says. An agent sends no `Origin` header, so
  the browser guard does not apply. A token is the simple way to use a local server. claude.ai
  cannot reach it at all. Claude Code can sign in to it only when you use the address in
  `PUBLIC_ORIGIN` and the server can fetch Claude's client document from `claude.ai`.

## 4. Connecting each client

### 4.1 claude.ai (web, desktop and phone)

claude.ai connects by URL and asks you to sign in. You need no token.

1. In claude.ai, open **Settings › Connectors** and choose **Add custom connector**.
2. Enter a name, such as `Tracker`, and paste `https://<public host>/api/mcp`. Leave the advanced
   settings empty: the tracker needs no client ID or secret. Choose **Add**.
3. Choose **Connect**. claude.ai opens the tracker in your browser.
4. On the tracker's page, check that the app is Claude, enter your email and password, and choose
   what Claude may do. **Read only** is picked. Choose **Read and change** only if you want Claude
   to mark days and edit plans. Choose **Connect**.
5. The browser returns to claude.ai, and the connector shows as connected. In a conversation, turn
   the Tracker tools on from the tools menu and ask a question (§5).

The page asks for your password even when you are signed in to the tracker. It does not sign you
in to the tracker in that browser. Choose **Cancel** to refuse.

The connection appears in Settings › Connections under **Apps**, with its access, when it was
approved, when it was last used and when it ends (90 days after approval). A connection from the
last 24 hours is marked **New**. **Remove** ends it at once, and claude.ai then asks you to
connect again. To change a connection from read only to read and change, remove it and connect
again.

If claude.ai says it cannot connect, see §6. The usual cause is Cloudflare blocking Anthropic's
servers before they reach the tracker ([deployment.md](deployment.md) §5).

### 4.2 Claude Code

**By URL, with OAuth sign-in.** Add the server, then sign in from Claude Code:

```sh
claude mcp add --transport http tracker https://<public host>/api/mcp
```

Start `claude`, run `/mcp`, choose **tracker** and choose **Authenticate**. Claude Code opens your
browser on the tracker's page. Sign in and choose what Claude may do, as in §4.1. The browser
sends the result back to Claude Code on your own computer, so the browser and Claude Code must run
on the same machine. Run `/mcp` again to see the server as connected.

**With a token.** Create a token (§2.1), then add the server with a header. The command saves the
entry without checking the token.

```sh
claude mcp add --transport http tracker https://<public host>/api/mcp \
  --header "Authorization: Bearer <token>"
```

To keep the token out of a file, put it in an environment variable and reference it from
`.mcp.json`. Claude Code expands `${TRACKER_MCP_TOKEN}` when it loads the file.

```json
{
  "mcpServers": {
    "tracker": {
      "type": "http",
      "url": "https://<public host>/api/mcp",
      "headers": {
        "Authorization": "Bearer ${TRACKER_MCP_TOKEN}"
      }
    }
  }
}
```

Set `TRACKER_MCP_TOKEN` in the shell that starts `claude`. An entry with a `url` and no `type`
counts as a stdio server, so keep `"type": "http"`. Source: <https://code.claude.com/docs/en/mcp>.

### 4.3 Claude Desktop

Claude Desktop reaches the server through the `mcp-remote` bridge with a token. Add this entry to
`claude_desktop_config.json`, then restart Claude Desktop.

```json
{
  "mcpServers": {
    "tracker": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<public host>/api/mcp",
        "--header",
        "Authorization: Bearer ${TRACKER_MCP_TOKEN}"
      ],
      "env": { "TRACKER_MCP_TOKEN": "<token>" }
    }
  }
}
```

On Windows, Claude Desktop does not escape a space inside `args`. Move the scheme into the
environment instead: set the header argument to `Authorization:${TRACKER_MCP_AUTH}` and `env` to
`{ "TRACKER_MCP_AUTH": "Bearer <token>" }`. Source: the `mcp-remote` README,
<https://github.com/geelen/mcp-remote>. The npm page, <https://www.npmjs.com/package/mcp-remote>,
returned 403 when checked.

### 4.4 ChatGPT (web)

ChatGPT connects by URL and asks you to sign in, as claude.ai does. You need no token, client ID
or secret: the tracker reads ChatGPT's own client document from `chatgpt.com`.

1. In ChatGPT on the web, open **Plugins** (`https://chatgpt.com/plugins`), choose **+** and then
   **Add custom MCP server**.
2. Enter a name, such as `Tracker`, and paste `https://<public host>/api/mcp` as the URL.
3. For authentication, choose **OAuth**. Leave the advanced OAuth settings as ChatGPT finds them:
   the client registration is the client ID metadata document, and the callback URL is
   `https://chatgpt.com/connector_platform_oauth_redirect`. Leave the scopes as discovered.
   ChatGPT asks for both, `read write`; the access is chosen on the tracker's page.
4. Accept the risk warning and choose **Create as a plugin**. Connecting opens the tracker's page,
   which names ChatGPT, from chatgpt.com. Sign in and choose what ChatGPT may do, as in §4.1.
5. Start a new chat, type `@`, choose the tracker and ask a question (§5).

The connection appears under **Apps** in Settings › Connections as "ChatGPT · chatgpt.com" and
ends, lasts and is removed as in §4.1.

To change ChatGPT from read only to read and change, remove the plugin in ChatGPT, add it again
(steps 1 to 4), and choose **Read and change** on the tracker's page. Removing the plugin also
ends its connection in the tracker: ChatGPT revokes it, so it leaves the **Apps** list. If it is
still listed, choose **Remove** there.

What OpenAI says about it, from its auth guide
(<https://developers.openai.com/plugins/build/auth>, read 2026-11-04) and its connect guide
(<https://developers.openai.com/plugins/deploy/connect-chatgpt>):

- Custom MCP servers work in ChatGPT on the web, not in the phone app. The desktop app's **MCPs**
  tab is for the coding agent and is a different thing.
- Which plans can add one is set by OpenAI and by a workspace's admins. OpenAI's help article
  (<https://help.openai.com/en/articles/12584461>, as read on 2026-11-03 for family-finances)
  names Business and Enterprise/Edu with write tools and Pro with read tools only, and does not
  name Plus. If **Add custom MCP server** is missing, the account's plan or workspace does not
  offer it.
- Everything a tool returns goes to OpenAI. On Free, Plus and Pro, OpenAI may train on the
  conversation unless **Improve the model for everyone** is off in ChatGPT's data controls.

If ChatGPT says it cannot connect, see §6.

## 5. Trying it

After connecting, ask a question that needs the log:

- "Which trackers do I have?"
- "How is my training going this week?"
- "Compare the last four weeks of Yoga."
- "How are my squats going?"
- "Am I consistent? What is my streak?"

With a write token or a Read and change connection, ask for a change:

- "Add 3×10 lunges, twice a week."
- "Mark squats as done today."
- "Set my daily target to 3 exercises."
- "Add a note to squats: knees out."
- "Add a 5 km run to cardio, twice a week."
- "Set my Snacks tracker to two a day."
- "Write me an eight-week beginner strength programme and save it to my library."
- "Start Beginner 5×5 next Monday with the squat at 50 kg."
- "Pause the deadlift for two weeks: my back is sore." (The agent shows the preview first.)

Every write tool returns what it changed as it was (`before`) and as it is now (`after`): a week's
items with their notes, a day's mark, or each daily target it set. To undo a change, ask the agent
to restore the `before` values, or edit the plan in the app.

## 6. Troubleshooting

| Symptom                                                                              | Cause and fix                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401                                                                                  | The token is wrong, revoked or belongs to a disabled account, or the OAuth connection has ended or passed its 90 days. Remove the token or connection in Settings and make a new one.                                                                                                                                     |
| 400 `token-in-url`                                                                   | The URL carries a `token` or `access_token`. Move the token to the `Authorization` header.                                                                                                                                                                                                                                |
| 403 `origin`                                                                         | The request has an `Origin` header, as a browser page sends. Connect from an agent.                                                                                                                                                                                                                                       |
| 421                                                                                  | The `Host` is not the public host. Change the URL from the LAN address to `https://<public host>/api/mcp`.                                                                                                                                                                                                                |
| "this connection is read-only"                                                       | A write tool needs a write token or a Read and change connection. Create a write token in Settings › Connections, or remove the connection and connect again with Read and change.                                                                                                                                        |
| 413 `too-large`                                                                      | The request body is over 1 MiB.                                                                                                                                                                                                                                                                                           |
| 400 "Invalid Content-Type header"                                                    | The `Content-Type` is not `application/json`. MCP clients send it; a hand-made `curl` must too.                                                                                                                                                                                                                           |
| "doesn't show it" in a tool error                                                    | The tracker was deleted from that week on, or starts after it. Its earlier weeks still take reads and changes. `list_trackers` gives each tracker's `start_week` and `end_week`.                                                                                                                                          |
| `tracker` in a tool error                                                            | No tracker has that id or name, or two trackers share the name. The error lists the ids; send one.                                                                                                                                                                                                                        |
| "is locked" in a `mark_day` error                                                    | The tracker follows a programme, and its days before yesterday are a record. Only today's, yesterday's and later days take a mark.                                                                                         |
| "is a programme tracker" in an item tool's error                                     | Its plan comes from its programme. Change it with `change_programme`, which previews the change first.                                                                                                                     |
| `stale: true` from `change_programme`                                                | The programme changed since the preview, so nothing changed. Show the fresh preview, then confirm with its `rev`.                                                                                                         |
| `quota` in a tool error                                                              | The account is full (5 MiB). Remove old plans or marks in the app, then retry.                                                                                                                                                                                                                                            |
| 405                                                                                  | The client sent a GET or a `DELETE`. The server accepts POST only, so use a client that supports it.                                                                                                                                                                                                                      |
| 503 `busy`                                                                           | The server could not check the token because its database was busy or failing. This is not a bad token. Retry in a few seconds; the API log has the error.                                                                                                                                                                |
| claude.ai, Claude Code or ChatGPT cannot connect                                     | Cloudflare may block the sign-in requests before the tracker sees them. From outside your network, `curl -i https://<public host>/.well-known/oauth-authorization-server` must answer JSON, not a Cloudflare error page ([deployment.md](deployment.md) §5). claude.ai keeps its copy of these documents about 5 minutes. |
| "error code: 1010" from `curl`                                                       | Cloudflare refused a client that is not a browser. Anthropic's servers need the custom rule in [deployment.md](deployment.md) §5.1, and OpenAI's need it too if Cloudflare's Security Events show them challenged (§5.2).                                                                                                 |
| The consent page says "did not come from an app the tracker can check (unreachable)" | The API could not fetch the asking app's document: its egress proxy must allow `claude.ai:443`, `claude.com:443` and `chatgpt.com:443` ([deployment.md](deployment.md) §5.3).                                                                                                                                             |
| A page says the app can't be checked                                                 | The sign-in link did not come from Claude or ChatGPT: the app's host is not on the tracker's list (`OAUTH_CLIENT_HOSTS`, default `claude.ai`, `claude.com` and `chatgpt.com`), its metadata could not be fetched, or its redirect is not one it registered. Start again from the app.                                     |
| "This link has expired"                                                              | The page was open more than 10 minutes, or was already used. Start the connection again from the app.                                                                                                                                                                                                                     |
| The page says the password is wrong                                                  | Enter the account's email and password. Five wrong passwords in 15 minutes lock the account for 15 minutes, as at sign-in.                                                                                                                                                                                                |
| "You have ten connections"                                                           | An account can hold 10 connections. Remove one in Settings › Connections, then connect again.                                                                                                                                                                                                                             |
| "You have 20 tokens"                                                                 | An account can hold 20 tokens. Remove one in Settings › Connections, then create the new one.                                                                                                                                                                                                                             |

If a call still fails, run the `whoami` tool first. It separates a bad connection from a bad call.
