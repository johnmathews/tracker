# OAuth for claude.ai, and tokens anyone can create

> Purpose: why the tracker now runs its own OAuth authorization server, what was built and checked
> before it shipped, and what is still unproven until the first real connect. The connection guide
> is [docs/mcp.md](../docs/mcp.md); the routes are in [docs/api.md](../docs/api.md) §3.3.

## 1. Why

The MCP endpoint worked from Claude Code with a token minted by `tracker-admin`. John asked how to
add it to claude.ai, then: "yes, build the oauth like home-finances. and we need any user to be
able to generate the tokens they might need to." He answered four questions before the build:

1. claude.ai connects by **URL only**: no client ID to type.
2. A connection lasts **90 days** (finances uses 30).
3. A personal token is a **name plus read or write, with no expiry**.
4. Tokens and connections share **one Connections section** in Settings.

The run evaluated first and found claude.ai could not connect for three separate reasons: the
discovery URLs returned the app's HTML, the REST write guard refused form posts without `Origin`,
and Cloudflare answers non-browser clients on the tracker's host with error 1010.

## 2. What was built

- **An authorization server in the API** (`oauth.py`, `oauth_api.py`), hand-written because the
  `mcp` SDK's own has no client ID metadata documents (CIMD) and no `none` client auth. The SDK
  stays the resource server (P31).
- **CIMD clients only** (P32). A `client_id` is an `https://` URL on an allow-list,
  `OAUTH_CLIENT_HOSTS` (default `claude.ai,claude.com`). The document is fetched with no
  redirects, a 5 s deadline and a 5 KiB cap, and cached for an hour when good. Redirects must be
  listed exactly, except loopback ones (Claude Code), which match on any port. There is no
  registration endpoint.
- **Lifetimes** (P33): connections 90 days absolute, access tokens 1 h, codes 60 s, a 60 s grace
  that gives a retrying client the same new pair, and reuse of a retired refresh token or a spent
  code ends the connection. Every time check uses `config.clock`, not the wall clock.
- **Discovery** (RFC 9728 and RFC 8414) at the three `/.well-known/` paths, proxied by nginx and
  Vite, with the issuer free of a trailing slash.
- **A consent screen** at `#/connect/<id>`, a link route that works signed out. It asks for the
  password even when signed in, shares the login lockout, creates no session, and starts at Read
  only (P34, P35, K73).
- **Self-service tokens** (`GET/POST /api/tokens`, `DELETE /api/tokens/{prefix}`) and
  **connections** (`GET /api/connections`, `DELETE /api/connections/{id}`), capped at 20 and 10
  per account (P36).
- **Settings › Connections** (K74–K78): the address with Copy, how to connect each Claude, Apps
  and Tokens as two lists, a token shown once, a New mark and banner for a connection under a
  day old, and a monospace face for tokens and the address.
- **One helper ends every credential** (`auth.end_credentials`, P37): a password reset, `disable`
  and `revoke-sessions` now end tokens and connections in one transaction.
- **The MCP verifier** picks its lookup by prefix (`trk_`, `tka_`), returns the grant's stored
  resource so the SDK's audience check means something, and answers 503 when its own lookup
  fails, because a 401 tells Claude the connection is gone (P38).
- **Migration 12** adds five tables and changes no existing one.

## 3. How it was checked

- **Tests:** API 1178 tests at 99% (0 lines missed, `oauth.py` and `oauth_api.py` fully
  covered); web 1202 unit tests at the project's floors (100% lines and functions); 80 browser
  tests, 8 of them new, including axe in both themes and phone width.
- **Red first:** each unit's first test was seen failing before its code, for example discovery
  `404 not-found` and a token form post `403 origin` before W4. W3 and W4 were also checked by
  breaking 11 and 9 key properties by hand (the grace, the swap's rowcount, the resource check,
  the 503 middleware and others); a test caught every one.
- **Against the real client documents** (confirmed): `/authorize` on a scratch server fetched
  claude.ai's and Claude Code's published metadata and answered 302 to the consent screen for
  both.
- **John tried it locally** on his own data (migrated to v12, copied first) and said "Looks
  good."
- **Wrap-up review:** a separate code review found no critical or high issue. Two of its findings
  were fixed with tests seen red first: the sweep now clears the sealed grace copy once the grace
  is over, and a client document's redirects are kept only when `https://` or `http` loopback
  (the app checks the same before leaving). A docs audit found a section W7 had deleted by
  accident (`api.md` §4.1 Email, with 11 references to it) and ten smaller drifts; all fixed.
- **Coverage floors:** the first wrap-up run of the web suite failed the 100% line and function
  floors; nine tests were added (failure paths of Cancel, Copy, create and remove). These pin
  existing behaviour, so they passed on first run and were not seen red.

## 4. What is not yet known

- **Whether claude.ai connects for real** (suspected yes, unproven). Every test stubs Claude and
  Cloudflare. It needs John's Cloudflare change for `160.79.104.0/21` ([deployment.md](../docs/deployment.md)
  §5) and then a real connect: W8 of the plan.
- **Whether claude.ai uses CIMD here** rather than trying registration (strongly supported: it
  picks CIMD when the metadata advertises it and lists `none`). If it tries registration, the
  connect fails visibly and the API log shows no `/api/oauth/authorize`.
- **Whether claude.ai sends a scope the tracker does not know** (for example `offline_access`).
  The tracker refuses unknown scopes; W8 shows whether that bites.

## 5. What is deliberately not done

- **No Dynamic Client Registration** and no pre-registered client ID: the MCP spec deprecates
  registration, and it needs an open endpoint.
- **No OAuth for REST**: a token, of either kind, opens only `/api/mcp`.
- **No rate limit on `/api/oauth/authorize`**: anyone can fill the 1,000 pending requests for ten
  minutes. With a handful of users it is an accepted risk ([api.md](../docs/api.md) §8), as is the
  request id appearing in access logs (single use, 10 minutes, password still needed).
- **No change of scope on a live connection**: to go from read only to read and change, remove it
  and connect again.
- **The three nginx discovery blocks stay separate** rather than one regex location, so the spec
  can pin each path.
- **The Cloudflare change is John's**, not made from the session.
