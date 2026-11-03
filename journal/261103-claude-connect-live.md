# claude.ai and Claude Code connect for real

> Purpose: the first real connect after #62 (W8 of the OAuth plan), the fourth blocker it found,
> and corrections to [261103-oauth-and-self-service-tokens.md](261103-oauth-and-self-service-tokens.md).
> All times are CET.

## What happened

1. **Deploy.** #62 merged at 19:33; CI on `main` and the image publish passed, and What's Up
   Docker had the new API serving the discovery documents about a minute later.
2. **Cloudflare.** John added a custom rule on `itsa-pizza.com` that skips Browser Integrity Check
   for Anthropic's outbound ranges on the tracker's host and its three paths. Bot Fight Mode is
   off on the zone, so the skip rule is enough ([deployment.md](../docs/deployment.md) §5.1).
3. **First claude.ai attempt.** Claude read the discovery documents and sent the browser to
   `/api/oauth/authorize` with its client metadata URL, so it chose CIMD, not registration. The
   consent page then said "did not come from an app the tracker can check (unreachable)".
4. **Cause (confirmed).** The API's only way out is the home server's Squid proxy,
   `fitness-mail-proxy`, which allowed Resend and Anthropic's API only. Its log showed
   `TCP_DENIED/403 CONNECT claude.ai:443` in the same second as the API's
   `oauth authorize refused a client: unreachable`. No test could have seen it: every test stubs
   the fetch. The fix allows `claude.ai:443` and `claude.com:443` (home-server #333, deployed with
   `make infra t=fitness`). From inside `fitness-api`, the app's own fetch then got 200 for both
   Claude documents.
5. **Both connected.** The API log shows, for claude.ai (client
   `…/mcp-oauth-client-metadata`) and for Claude Code (client `…/claude-code-client-metadata`,
   redirect `http://localhost:49946/callback`): authorize, `oauth grant … approved`, `POST
   /api/oauth/token` 200, then `POST /api/mcp` 200s. John: "its working!"

## Corrections to the earlier entry

- **Anthropic has two outbound ranges**, `160.79.104.0/21` and `153.61.208.0/20` (Anthropic's IP
  addresses page). The earlier entry and the first version of `deployment.md` named only the
  first. The rule in use covers both.
- **"Whether claude.ai uses CIMD" is now confirmed**, and the scope question did not bite: claude.ai
  and Claude Code both asked for `read write`, which the tracker accepts.
- **The Cloudflare advice changed.** The earlier docs preferred an IP access rule. Cloudflare's new
  dashboard offers that option only once a zone has one, and the zone's Bot Fight Mode is off, so a
  custom Skip rule, limited to the tracker's host and paths, is what is in use.

## Also found

- **claude.ai's edge refuses Python's default user agent** (403 to a bare `urlopen`). The app sends
  `tracker-oauth/1`, which it accepts, so a manual check must use `oauth.fetch_document`.
- **Claude Code revokes its old grant on a second sign-in**, through `/api/oauth/revoke`; the API
  logged `ended: revoked by its client`.
- **Home-finances' Cloudflare rule** lists only `160.79.104.0/21`. John was told; it is outside
  this repo.

## What is deliberately not done

- **No IP access rule.** Not needed while Bot Fight Mode is off; the docs say what to do if it is
  turned on.
- **No wildcard hosts in the proxy.** Claude's documents are on the apex hosts.
