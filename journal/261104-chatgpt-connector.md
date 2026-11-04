# ChatGPT connects by URL, as a third CIMD client

John asked for the tracker to work from ChatGPT ("a plugin, then custom MCP server") with OAuth,
as claude.ai does, after family-finances did the same (its ADR-0049, PR #291).

## What OpenAI needs, and what the tracker already had

OpenAI's auth guide (<https://developers.openai.com/plugins/build/auth>, read 2026-11-04) wants
PKCE with S256, the `resource` parameter, refresh tokens, and either CIMD, DCR or a predefined
client. It prefers CIMD. For the stable redirect, `https://chatgpt.com/connector_platform_oauth_redirect`,
the server must meet RFC 9207: the flag in its metadata, the same issuer in the protected
resource document, and `iss` on every authorization response. The tracker had all of it since
PR #62, so no discovery or flow change was needed.

ChatGPT's document, fetched from `https://chatgpt.com/oauth/client.json`, names itself "ChatGPT",
lists that one redirect, and says:

```json
"token_endpoint_auth_method": "private_key_jwt",
"token_endpoint_auth_methods_supported": ["none", "private_key_jwt"]
```

The tracker required the singular field to be `none`, so it would have refused ChatGPT with
`auth`. OpenAI's guide says the singular is a legacy preference during MCP SEP-3149's
transition, the plural is what the client can use, and a server reading the plural "should
accept any method in the intersection". The tracker accepts `none` only, so the intersection is
`none`, and ChatGPT then signs in as a public client with PKCE, like Claude.

## Decisions (P39)

- **Read the plural list.** A document is a public client when its singular is `none` or its
  list holds `none`. A list that is not a list of strings is refused.
- **`chatgpt.com` joins `OAUTH_CLIENT_HOSTS`'s default.** Finances pre-registered ChatGPT
  because it has no CIMD; the tracker already reads documents, so its P32 holds unchanged.
- **No `private_key_jwt`.** Verifying OpenAI's signed assertions would add a fetch of its JWKS
  and a JWT check, for no gain over PKCE on a one-person tracker.
- **No Cloudflare change until measured**, as finances chose. OpenAI's ranges are 288 prefixes
  and change, so if Browser Integrity Check does challenge them, they go in a Cloudflare IP list
  beside the Anthropic ranges (`docs/deployment.md` §5.5).
- **No consent-screen change.** It already names the app from its document: "Connect ChatGPT",
  "ChatGPT, from chatgpt.com". Settings › Connections gains a how-to line for ChatGPT, and its
  design-system card the same copy. OpenAI's training and plan caveats went into `docs/mcp.md`
  §4.4, not the screen.

## The way out

The API reaches the internet only through the home server's Squid proxy, which allowed
`claude.ai` and `claude.com` (home-server #333). It now allows `chatgpt.com:443` too
(home-server PR `tracker-proxy-chatgpt`). Without it, the consent page would say "unreachable",
as claude.ai's did on 2026-11-03.

## Checked

- Tests: ChatGPT's real document resolves; five shapes of method fields that hold `none` are
  accepted and five that don't are refused; a full ChatGPT flow (scope asked `read`, write
  ticked, token `read write`, refresh, Claude refused its refresh token, Settings lists
  "ChatGPT · chatgpt.com").
- Locally, the app's own `ClientResolver` fetched ChatGPT's live document and accepted it, and
  the consent page rendered for a ChatGPT request. John looked at it and at Settings.
- Not yet: a real connect from chatgpt.com. Which plans offer custom MCP servers is OpenAI's
  call (Business and Enterprise with writes, Pro read only, Plus not named, per its help article
  as finances read it on 2026-11-03).
