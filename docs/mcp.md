# Connecting an agent

> Purpose
>
> How to connect your own Claude to the tracker's MCP server: what the server offers, how to mint
> a token, how to add the server to each Claude client, and what to do when a call fails. The
> endpoint's rules and every tool argument are in [api.md](api.md) §3.1.

## 1. What the server offers

The server lives at `/api/mcp` and lets an agent read the training log and, with a write token,
change it. Each token belongs to one account and acts only as that account.

**Read tools** answer questions about the log. A `read` or a `write` token may call them.

| Tool           | Answers                                                         |
| -------------- | --------------------------------------------------------------- |
| `whoami`       | Which account and scope the token has. Use it to test the link. |
| `week_summary` | How one week went, item by item, against its goals.             |
| `weeks`        | Several weeks side by side, for a trend.                        |
| `item_history` | One exercise or food over the last weeks.                       |
| `goals`        | This week's goals, the daily targets and the "My goals" note.   |
| `consistency`  | The share of days and goals met, and the current streaks.       |

**Write tools** change plans, marks and daily targets as the app does. Only a `write` token may
call them.

| Tool                | Does                                                |
| ------------------- | --------------------------------------------------- |
| `add_item`          | Adds an exercise or a food to a week's plan.        |
| `update_item`       | Changes the fields given on one item.               |
| `remove_item`       | Takes one item out of a week's plan.                |
| `mark_day`          | Marks one item on one date, or clears the day.      |
| `set_daily_targets` | Sets how many exercises and foods make a day count. |

[api.md](api.md) §3.1 lists the arguments and results of every tool.

## 2. Minting a token

Run `tracker-admin` on the server. In production, run it in the API container. Locally, run it
from `api/` with the same environment as the API (`DATA_DIR=./.data`).

```sh
# Production
docker compose exec fitness-api tracker-admin token create <email> --name <name>
docker compose exec fitness-api tracker-admin token create <email> --name <name> --write

# Local
uv run tracker-admin token create <email> --name <name> --write
```

- A token has the `read` scope unless the command has `--write`. A write token also reads.
- `--name` says what the token is for, such as `laptop` or `phone`. Give each client its own token.
- The command prints the token once, so copy it immediately. The server stores only a hash.

```text
A write token for <email>, prefix trk_AbCd1234:
trk_...
It is shown only this once. Send it as Authorization: Bearer <token>.
```

List the account's tokens, then revoke one by its prefix or revoke all of them:

```sh
docker compose exec fitness-api tracker-admin token list <email>
docker compose exec fitness-api tracker-admin token revoke <email> trk_AbCd1234
docker compose exec fitness-api tracker-admin token revoke <email> --all
```

`token list` shows each token's prefix, scope, name, creation time and last use. A password reset,
`disable` or `revoke-sessions` also revokes the account's tokens.

## 3. Which URL

Use the public HTTPS URL: `https://<public host>/api/mcp`. Replace `<public host>` with the host
in `PUBLIC_ORIGIN`.

- **Skip the LAN port.** It serves plain HTTP, so anyone on the network can read the token. The
  server also answers 421 for the LAN address.
- **Send the token in the `Authorization` header only.** A token in the URL gets 400.
- **Locally, use `http://localhost:8000/api/mcp`.** The server accepts a `Host` of `localhost` or
  `127.0.0.1` with any port, whatever `PUBLIC_ORIGIN` says. An agent sends no `Origin` header, so
  the browser guard does not apply.

## 4. Connecting each client

### 4.1 Claude Code

Add the server from a terminal. The command saves the entry without checking the token.

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

### 4.2 Claude Desktop

Claude Desktop reaches the server through the `mcp-remote` bridge. Add this entry to
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

### 4.3 claude.ai (web and phone)

A custom connector can send a fixed header only where the account has the **Request headers**
option, which is a beta for a limited set of organizations. Open **Customize > Connectors > Add
custom connector**. If the dialog shows **Request headers**, choose **No sign-in**, add the header
`authorization` and enter the value `Bearer <token>`, including the word `Bearer` and the space.
Source: <https://claude.com/docs/connectors/custom>.

If the dialog has no **Request headers** section, claude.ai cannot connect until the tracker has an
OAuth server, which is a non-goal for now. The Claude Code and Claude Desktop routes still work.

## 5. Trying it

After connecting, ask a question that needs the log:

- "How is my training going this week?"
- "Compare the last four weeks."
- "How are my squats going?"
- "Am I consistent? What is my streak?"

With a write token, ask for a change:

- "Add 3×10 lunges, twice a week."
- "Mark squats as done today."
- "Set my daily target to 3 exercises."

Every write tool returns what it changed as it was (`before`) and as it is now (`after`): a week's
items, a day's mark, or the two daily targets. To undo a change, ask the agent to restore the
`before` values, or edit the plan in the app.

## 6. Troubleshooting

| Symptom                           | Cause and fix                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 401                               | The token is wrong, revoked or belongs to a disabled account. Run `token list`, then mint a new one.       |
| 400 `token-in-url`                | The URL carries a `token` or `access_token`. Move the token to the `Authorization` header.                 |
| 403 `origin`                      | The request has an `Origin` header, as a browser page sends. Connect from an agent.                        |
| 421                               | The `Host` is not the public host. Change the URL from the LAN address to `https://<public host>/api/mcp`. |
| "this token is read-only"         | A write tool needs a write token. Mint one with `--write`.                                                 |
| 413 `too-large`                   | The request body is over 1 MiB.                                                                            |
| 400 "Invalid Content-Type header" | The `Content-Type` is not `application/json`. MCP clients send it; a hand-made `curl` must too.            |
| `quota` in a tool error           | The account is full (5 MiB). Remove old plans or marks in the app, then retry.                             |
| 405                               | The client sent a GET or a `DELETE`. The server accepts POST only, so use a client that supports it.       |

If a call still fails, run the `whoami` tool first. It separates a bad connection from a bad call.
