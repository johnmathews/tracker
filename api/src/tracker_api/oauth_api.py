"""OAuth's HTTP surface: discovery, authorize, the consent screen's calls, token, revoke, and
the Connections section of Settings (docs/api.md §4). The storage and every rule about codes,
grants and tokens are `oauth.py`'s; this module checks what arrives and shapes what leaves.

The origin of every URL here is `config.public_origin`, never the request's Host. The issuer is
that origin exactly, with no trailing slash (F8), and the resource is `{origin}/api/mcp`.

Two kinds of caller:

- A browser: `/authorize` (a top-level GET from claude.ai or Claude Code's browser tab), and the
  consent screen at `/#/connect/<id>`, whose approve and deny are REST writes under `guard`'s
  Origin and JSON rules. Approval proves the password through `auth.login`, so the login lockout
  counts it, and creates no web session (D4).
- Claude's servers: `/token` and `/revoke`, form-encoded, with no Origin and no cookie. `guard`
  applies `form_refusal` to them instead of REST's rules, and `form_fields` reads the body with a
  counted cap.

`/authorize` never redirects to a client or redirect it has not checked: those get a 400 page.
Errors after that go back to the client's redirect, with `state` and `iss` (RFC 9207).

Nothing here logs a token, a code or a password. A pending request's id is in the consent
calls' paths, so access logs record it (docs/api.md §8: single use, 10 minutes, password still
needed)."""

import logging
import re
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

from . import auth, oauth
from .config import Config
from .db import connect

log = logging.getLogger(__name__)

AUTHORIZE_PATH = "/api/oauth/authorize"
TOKEN_PATH = "/api/oauth/token"  # noqa: S105 (a path)
REVOKE_PATH = "/api/oauth/revoke"
#: The endpoints Claude's servers call: form bodies, no Origin, no cookie (`form_refusal`).
FORM_PATHS = frozenset({TOKEN_PATH, REVOKE_PATH})
PRM_PATHS = (
    "/.well-known/oauth-protected-resource/api/mcp",
    "/.well-known/oauth-protected-resource",
)
AS_PATH = "/.well-known/oauth-authorization-server"
FORM_TYPE = "application/x-www-form-urlencoded"
#: A token or revoke body: a code, a verifier, a client id and a redirect fit many times over.
MAX_FORM = 8 * 1024
MAX_FIELDS = 16
SCOPES = ("read", "write")
#: A client's `state` we will carry back; longer is refused as `invalid_request`.
MAX_STATE = 1024
_CHALLENGE_RE = re.compile(r"[A-Za-z0-9\-._~]{43,128}")
#: Headers on every token and revoke answer (RFC 6749 §5.1).
NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


class FormRefused(Exception):
    """A token or revoke request refused before its grant is looked at: OAuth's error shape."""

    def __init__(self, status: int, error: str, description: str | None = None) -> None:
        super().__init__(error)
        self.status = status
        self.error = error
        self.description = description


def oauth_error(status: int, error: str, description: str | None = None) -> JSONResponse:
    """RFC 6749 §5.2's error body, with no-store."""
    body = {"error": error} | ({} if description is None else {"error_description": description})
    headers = dict(NO_STORE)
    if status == 401:
        headers["WWW-Authenticate"] = 'Basic realm="oauth"'
    if status == 503:
        headers["Retry-After"] = "1"
    return JSONResponse(body, status_code=status, headers=headers)


def form_refusal(request: Request, origin: str) -> Response | None:
    """`guard`'s rule for `/token` and `/revoke`, instead of REST's. Claude's servers send no
    Origin and no cookie, and a code or refresh token is the credential, so a missing Origin
    passes; a browser's other Origin is refused, since no browser client of ours makes these
    calls and the answers carry no CORS headers anyway. POST only, a form body, nothing in the
    query string (a token in a URL lands in logs), and a declared size within MAX_FORM; the
    body is counted again as it is read (`form_fields`)."""
    if request.method != "POST":
        return oauth_error(405, "invalid_request", "POST only")
    if request.url.query:
        return oauth_error(400, "invalid_request", "parameters go in the body")
    sent_origin = request.headers.get("origin")
    if sent_origin is not None and sent_origin != origin:
        return oauth_error(403, "invalid_request", "origin")
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != FORM_TYPE:
        return oauth_error(400, "invalid_request", f"send {FORM_TYPE}")
    length = request.headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > MAX_FORM):
        return oauth_error(413, "invalid_request", "too large")
    return None


async def form_fields(request: Request) -> dict[str, str]:
    """The form, read with a counted cap (a chunked body declares no length). A field sent twice
    is refused, as RFC 6749 §3.2 says. FormRefused `invalid_request`."""
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_FORM:
            raise FormRefused(413, "invalid_request", "too large")
    try:
        pairs = parse_qsl(
            raw.decode("utf-8"),
            keep_blank_values=True,
            strict_parsing=False,
            max_num_fields=MAX_FIELDS,
            errors="strict",
        )
    except (UnicodeDecodeError, ValueError):
        raise FormRefused(400, "invalid_request", "an unreadable form") from None
    fields: dict[str, str] = {}
    for name, value in pairs:
        if name in fields:
            raise FormRefused(400, "invalid_request", f"{name} sent twice")
        fields[name] = value
    return fields


def with_query(uri: str, params: list[tuple[str, str]]) -> str:
    """`uri` with `params` added to any query it already has, each part encoded."""
    parts = urlsplit(uri)
    added = urlencode(params)
    return urlunsplit(parts._replace(query=f"{parts.query}&{added}" if parts.query else added))


def scope_text(scope: auth.TokenScope) -> str:
    """A grant's scope as OAuth spells it: a write grant may read too."""
    return "read write" if scope == "write" else "read"


@dataclass(frozen=True)
class Routing:
    """What `app.py` lends the routes here: its dependencies, and its error, so every refusal
    has the API's one shape and status table."""

    #: A database connection for the request.
    conn: Callable[..., Any]
    #: The signed-in user, or 401 `auth`.
    user: Callable[..., auth.SessionUser]
    #: The JSON object body.
    body: Callable[..., Any]
    #: `ApiError(status, code, headers=None, **extra)`.
    fail: Callable[..., Exception]
    #: An AuthError as the API's error, through `AUTH_STATUS`.
    refused: Callable[[auth.AuthError], Exception]


def register(
    app: FastAPI, config: Config, resolver: oauth.ClientResolver, routing: Routing
) -> None:
    """Add the OAuth routes to the API."""
    origin = config.public_origin
    resource = origin + "/api/mcp"
    Conn = Annotated[sqlite3.Connection, Depends(routing.conn)]
    User = Annotated[auth.SessionUser, Depends(routing.user)]
    Body = Annotated[dict[str, Any], Depends(routing.body)]
    fail, refused = routing.fail, routing.refused

    @app.exception_handler(FormRefused)
    async def on_form_refused(_: Request, e: FormRefused) -> JSONResponse:
        return oauth_error(e.status, e.error, e.description)

    # ------------------------------------------------------------ discovery

    def protected_resource() -> JSONResponse:
        """RFC 9728, at the path the 401's `resource_metadata` names and at the root."""
        return JSONResponse(
            {
                "resource": resource,
                "authorization_servers": [origin],
                "scopes_supported": list(SCOPES),
                "bearer_methods_supported": ["header"],
            }
        )

    for path in PRM_PATHS:
        app.add_api_route(path, protected_resource, methods=["GET"])

    @app.get(AS_PATH)
    def authorization_server() -> JSONResponse:
        """RFC 8414. Clients are client ID metadata documents; there is no registration."""
        return JSONResponse(
            {
                "issuer": origin,
                "authorization_endpoint": origin + AUTHORIZE_PATH,
                "token_endpoint": origin + TOKEN_PATH,
                "revocation_endpoint": origin + REVOKE_PATH,
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["none"],
                "revocation_endpoint_auth_methods_supported": ["none"],
                "scopes_supported": list(SCOPES),
                "client_id_metadata_document_supported": True,
                "authorization_response_iss_parameter_supported": True,
            }
        )

    # ------------------------------------------------------------ authorize

    def back(redirect_uri: str, state: str | None, **params: str) -> str:
        """The client's redirect with `params`, its `state` and our `iss`."""
        pairs = list(params.items())
        if state is not None:
            pairs.append(("state", state))
        pairs.append(("iss", origin))
        return with_query(redirect_uri, pairs)

    def unknown_client(reason: str) -> PlainTextResponse:
        return PlainTextResponse(
            "This connection request did not come from an app the tracker can check "
            f"({reason}). Start again from the app.",
            status_code=400,
        )

    def request_error(query: dict[str, list[str]]) -> str | None:
        """What is wrong with an authorization request from a known client, if anything."""

        def one(name: str) -> str | None:
            values = query.get(name, [])
            return values[0] if len(values) == 1 else None

        if any(len(values) > 1 for values in query.values()):
            return "invalid_request"
        if one("response_type") != "code":
            return "unsupported_response_type"
        challenge = one("code_challenge")
        if (
            one("code_challenge_method") != "S256"
            or challenge is None
            or not _CHALLENGE_RE.fullmatch(challenge)
        ):
            return "invalid_request"
        state = one("state")
        if state is not None and (len(state) > MAX_STATE or not state.isprintable()):
            return "invalid_request"
        asked = one("resource")
        if asked is not None and asked != resource:
            return "invalid_target"
        scope = one("scope")
        if scope is not None and (not scope.split() or not set(scope.split()) <= set(SCOPES)):
            return "invalid_scope"
        return None

    @app.get(AUTHORIZE_PATH, response_model=None)
    def authorize(request: Request, conn: Conn) -> Response:
        """Check the client and its redirect first: a bad one gets a 400 and is never redirected
        to. Then the request; its errors go back to the redirect. A good one is held for the
        consent screen, which the browser is sent to."""
        query: dict[str, list[str]] = {}
        for name, value in request.query_params.multi_items():
            query.setdefault(name, []).append(value)
        client_ids = query.get("client_id", [])
        redirects = query.get("redirect_uri", [])
        if len(client_ids) != 1 or len(redirects) != 1:
            return unknown_client("client_id and redirect_uri, once each")
        redirect_uri = redirects[0]
        try:
            client = resolver.check(client_ids[0], redirect_uri)
        except oauth.ClientRefused as e:
            log.info("oauth authorize refused a client: %s", e.reason)
            return unknown_client(e.reason)
        states = query.get("state", [])
        state = states[0] if len(states) == 1 and len(states[0]) <= MAX_STATE else None
        error = request_error(query)
        if error is not None:
            log.info("oauth authorize from %s refused: %s", client.host, error)
            return RedirectResponse(back(redirect_uri, state, error=error), status_code=302)
        asked = query.get("scope", [])
        scope = " ".join(s for s in SCOPES if s in asked[0].split()) if asked else None
        try:
            request_id = oauth.create_request(
                conn,
                config,
                client,
                redirect_uri=redirect_uri,
                code_challenge=query["code_challenge"][0],
                resource=resource,
                scope=scope,
                state=state,
            )
        except auth.AuthError:  # `busy`: too many requests pending
            log.warning("oauth authorize from %s refused: too many pending requests", client.host)
            error = "temporarily_unavailable"
            return RedirectResponse(back(redirect_uri, state, error=error), status_code=302)
        log.info("oauth authorize from %s: waiting for consent", client.host)
        return RedirectResponse(f"{origin}/#/connect/{request_id}", status_code=302)

    # ------------------------------------------------------------ the consent screen

    def pending(conn: sqlite3.Connection, request_id: str) -> oauth.PendingRequest:
        found = oauth.get_request(conn, config, request_id)
        if found is None:
            raise refused(auth.AuthError("no-request"))
        return found

    @app.get("/api/oauth/requests/{request_id}")
    def consent_request(request_id: str, conn: Conn) -> dict[str, Any]:
        """What the consent screen shows. No session needed: the screen shows signed out too,
        and the id, which only the browser sent here holds, is the credential."""
        found = pending(conn, request_id)
        return {
            "clientName": found.client_name,
            "clientHost": found.client_host,
            "redirectHost": found.redirect_host,
            "scope": found.scope,
            "expiresAt": found.expires_at,
        }

    @app.post("/api/oauth/requests/{request_id}/approve")
    def approve(request_id: str, body: Body, conn: Conn) -> dict[str, str]:
        """Approve with the account's email and password, even when signed in. The password
        goes through `auth.login`, so the login lockout counts it; no session is made (D4)."""
        email, password, write = body.get("email"), body.get("password"), body.get("write", False)
        if not isinstance(email, str) or not isinstance(password, str):
            raise fail(400, "invalid")
        if not isinstance(write, bool):
            raise fail(400, "invalid")
        pending(conn, request_id)  # before the hash: a dead request costs no guess
        try:
            uid = auth.login(conn, config, email.strip(), password)
            approval = oauth.approve(conn, config, request_id, uid, write=write)
        except auth.AuthError as e:
            if e.code == "too-many-connections":
                raise fail(409, "too-many") from None
            raise refused(e) from None
        redirect = back(approval.redirect_uri, approval.state, code=approval.code)
        return {"redirectTo": redirect}

    @app.post("/api/oauth/requests/{request_id}/deny")
    def deny(request_id: str, conn: Conn) -> dict[str, str]:
        try:
            found = oauth.deny_request(conn, config, request_id)
        except auth.AuthError as e:
            raise refused(e) from None
        log.info("oauth request from %s denied", found.client_host)
        return {"redirectTo": back(found.redirect_uri, found.state, error="access_denied")}

    # ------------------------------------------------------------ token and revoke

    def issued(tokens: oauth.Issued) -> JSONResponse:
        return JSONResponse(
            {
                "access_token": tokens.access_token,
                "token_type": "Bearer",
                "expires_in": tokens.expires_in,
                "refresh_token": tokens.refresh_token,
                "scope": scope_text(tokens.scope),
            },
            headers=NO_STORE,
        )

    def target(fields: dict[str, str]) -> None:
        """A `resource` the client names must be ours (RFC 8707)."""
        if "resource" in fields and fields["resource"] != resource:
            raise FormRefused(400, "invalid_target")

    def needed(fields: dict[str, str], *names: str) -> list[str]:
        values = [fields.get(n) or "" for n in names]
        missing = [n for n, v in zip(names, values, strict=True) if not v]
        if missing:
            raise FormRefused(400, "invalid_request", f"{', '.join(missing)} missing")
        return values

    @app.post(TOKEN_PATH)
    async def token(request: Request) -> JSONResponse:
        fields = await form_fields(request)
        grant_type = fields.get("grant_type")
        if not grant_type:
            return oauth_error(400, "invalid_request", "grant_type missing")
        if grant_type not in ("authorization_code", "refresh_token"):
            return oauth_error(400, "unsupported_grant_type")
        # A public client names itself and proves nothing more; the code or refresh token is
        # bound to it.
        if not fields.get("client_id"):
            return oauth_error(401, "invalid_client", "client_id missing")
        target(fields)
        return await run_in_threadpool(lambda: exchange(grant_type, fields))

    def exchange(grant_type: str, fields: dict[str, str]) -> JSONResponse:
        """The grant, on a worker thread: it may wait for SQLite's write lock."""
        conn = connect(config.db_path)
        try:
            if grant_type == "authorization_code":
                code, redirect_uri, verifier = needed(
                    fields, "code", "redirect_uri", "code_verifier"
                )
                tokens = oauth.redeem_code(
                    conn,
                    config,
                    code=code,
                    client_id=fields["client_id"],
                    redirect_uri=redirect_uri,
                    code_verifier=verifier,
                    resource=fields.get("resource"),
                )
            else:
                (refresh_token,) = needed(fields, "refresh_token")
                tokens = oauth.refresh(
                    conn,
                    config,
                    refresh_token=refresh_token,
                    client_id=fields["client_id"],
                    resource=resource,
                )
        except oauth.InvalidGrant as e:
            if e.reason == "busy":
                return oauth_error(503, "temporarily_unavailable")
            log.info("oauth %s refused: %s", grant_type, e.reason)
            return oauth_error(400, "invalid_grant", str(e) if e.ended else None)
        finally:
            conn.close()
        return issued(tokens)

    @app.post(REVOKE_PATH)
    async def revoke(request: Request) -> JSONResponse:
        """RFC 7009: 200 whatever the token was, once the request itself is well formed."""
        fields = await form_fields(request)
        presented = fields.get("token")
        if not presented:
            return oauth_error(400, "invalid_request", "token missing")
        if not fields.get("client_id"):
            return oauth_error(401, "invalid_client", "client_id missing")

        def end() -> JSONResponse:
            conn = connect(config.db_path)
            try:
                oauth.revoke(conn, config, presented)
            finally:
                conn.close()
            return JSONResponse({}, headers=NO_STORE)

        return await run_in_threadpool(end)

    # ------------------------------------------------------------ Settings, Connections

    @app.get("/api/connections")
    def connections(user: User, conn: Conn) -> dict[str, Any]:
        return {
            "connections": [
                {
                    "id": g.grant_id,
                    "clientName": g.client_name,
                    "clientHost": g.client_host,
                    "scope": g.scope,
                    "createdAt": g.created_at,
                    "lastUsedAt": g.last_used_at,
                    "expiresAt": g.expires_at,
                    "isNew": g.is_new,
                }
                for g in oauth.list_grants(conn, config, user.id)
            ]
        }

    @app.delete("/api/connections/{grant_id}", status_code=204)
    def end_connection(grant_id: str, user: User, conn: Conn) -> None:
        try:
            oauth.remove_grant(conn, user.id, grant_id)
        except auth.AuthError as e:
            raise refused(e) from None
