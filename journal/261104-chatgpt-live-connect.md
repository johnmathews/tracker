# ChatGPT's live connect, and the scope it asks for

ChatGPT connected to the production tracker on 2026-11-04, the same morning the connector shipped
(#64, home-server #334). John first chose Read only and then wanted Read and change.

## What the log showed

- 10:29 CET: `oauth authorize from chatgpt.com`, with `scope=read+write`, then the grant was
  approved and `POST /api/oauth/token` answered 200. No Cloudflare change was needed.
- 11:32 CET: John removed the plugin in ChatGPT. ChatGPT called `/api/oauth/revoke`, and the API
  logged `oauth grant 856c5f00… ended: revoked by its client`.
- 11:34 CET: John added it again. A new grant (`222952d3…`) was approved, again asking for
  `read write`, and ChatGPT's first `POST /api/mcp` calls answered 200.

## What changed

- `docs/mcp.md` §4.4 said ChatGPT asks for `read` only. It asks for every scope in
  `scopes_supported`, so the consent page alone decides the access. The section now says so, and
  it says how to change the access: remove the plugin in ChatGPT and add it again.
- `docs/deployment.md` §5.5 records the first connect, as §5.4 does for Claude.
- The ChatGPT flow test in `api/tests/test_oauth_api.py` now asks for `read write`, as ChatGPT
  does, and covers both consent choices: Read and change gives `read write`, Read only gives
  `read`.

The access John chose the second time is not in the log. Settings › Connections shows it under
Apps.
