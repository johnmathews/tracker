"""OAuth over HTTP: discovery, authorize, the consent screen's calls, token, revoke, the
Connections section of Settings, and the MCP verifier's OAuth tokens (oauth_api.py, mcp_server.py).

Two clients share one database, each on its own app as the deployed API and its callers would
be: `browser`, which sends the app's Origin as a browser does, and `claude`, Claude's servers,
which send no Origin and no cookie. Every client document comes from a stub; nothing is fetched."""

import logging
import sqlite3
from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from tracker_api import auth, oauth
from tracker_api.app import MAX_BODY, create_app
from tracker_api.config import Config
from tracker_api.mcp_server import NEEDS_WRITE, build_mcp

from .conftest import ORIGIN, Clock
from .test_mcp import INITIALIZE, call, result, tool, write_error
from .test_oauth import (
    CLAUDE_AI,
    CLAUDE_AI_REDIRECT,
    CLAUDE_CODE,
    StubFetch,
    pkce,
)

EMAIL = "alice@example.com"
BOB = "bob@example.com"
PASSWORD = "correct horse battery"
RESOURCE = f"{ORIGIN}/api/mcp"
PRM = "/.well-known/oauth-protected-resource/api/mcp"
DISCOVERY = [
    PRM,
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
]
PRM_DOCUMENT = {
    "resource": RESOURCE,
    "authorization_servers": [ORIGIN],
    "scopes_supported": ["read", "write"],
    "bearer_methods_supported": ["header"],
}
AS_DOCUMENT = {
    "issuer": ORIGIN,
    "authorization_endpoint": f"{ORIGIN}/api/oauth/authorize",
    "token_endpoint": f"{ORIGIN}/api/oauth/token",
    "revocation_endpoint": f"{ORIGIN}/api/oauth/revoke",
    "response_types_supported": ["code"],
    "grant_types_supported": ["authorization_code", "refresh_token"],
    "code_challenge_methods_supported": ["S256"],
    "token_endpoint_auth_methods_supported": ["none"],
    "revocation_endpoint_auth_methods_supported": ["none"],
    "scopes_supported": ["read", "write"],
    "client_id_metadata_document_supported": True,
    "authorization_response_iss_parameter_supported": True,
}
STATE = "xyz-state_1"
FORM = "application/x-www-form-urlencoded"


@pytest.fixture(autouse=True)
def quiet_wrong_secrets() -> Iterator[None]:
    oauth.reset_wrong_secret_log()
    yield
    oauth.reset_wrong_secret_log()


@pytest.fixture
def stub() -> StubFetch:
    return StubFetch()


@pytest.fixture
def browser(config: Config, stub: StubFetch) -> Iterator[TestClient]:
    app = create_app(config, run_backups=False, fetch=stub)
    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as c:
        yield c


@pytest.fixture
def claude(config: Config, stub: StubFetch) -> Iterator[TestClient]:
    with TestClient(create_app(config, run_backups=False, fetch=stub), base_url=ORIGIN) as c:
        yield c


@pytest.fixture
def uid(conn: sqlite3.Connection, config: Config) -> int:
    return auth.signup(conn, config, EMAIL, PASSWORD)


@pytest.fixture
def bob(conn: sqlite3.Connection, config: Config) -> int:
    return auth.signup(conn, config, BOB, PASSWORD)


# --- helpers -------------------------------------------------------------------------------------


def query_of(url: str) -> dict[str, list[str]]:
    return parse_qs(urlsplit(url).query, keep_blank_values=True)


def authorize(
    browser: TestClient,
    challenge: str,
    *,
    client_id: str = CLAUDE_AI,
    redirect_uri: str = CLAUDE_AI_REDIRECT,
    **change: Any,
) -> Response:
    """GET /api/oauth/authorize as claude.ai sends it, with `change` replacing (None drops) any
    parameter."""
    base: dict[str, str | None] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": STATE,
        "resource": RESOURCE,
        "scope": "read write",
    }
    params = base | change
    sent = {k: v for k, v in params.items() if v is not None}
    return browser.get("/api/oauth/authorize", params=sent, follow_redirects=False)


def request_id(r: Response) -> str:
    assert r.status_code == 302, r.text
    location = r.headers["location"]
    assert location.startswith(f"{ORIGIN}/#/connect/"), location
    return location.rsplit("/", 1)[1]


def approve(
    browser: TestClient,
    rid: str,
    *,
    write: bool = False,
    email: str = EMAIL,
    password: str = PASSWORD,
    headers: dict[str, str] | None = None,
) -> Response:
    body = {"email": email, "password": password, "write": write}
    return browser.post(f"/api/oauth/requests/{rid}/approve", json=body, headers=headers)


def form(client: TestClient, path: str, data: dict[str, str], **kwargs: Any) -> Response:
    return client.post(path, data=data, **kwargs)


def redeem(claude: TestClient, code: str, verifier: str, **change: str) -> Response:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": CLAUDE_AI_REDIRECT,
        "code_verifier": verifier,
        "client_id": CLAUDE_AI,
        "resource": RESOURCE,
    } | change
    return form(claude, "/api/oauth/token", data)


def refresh(claude: TestClient, refresh_token: str, **change: str) -> Response:
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLAUDE_AI,
        "resource": RESOURCE,
    } | change
    return form(claude, "/api/oauth/token", data)


def connect(browser: TestClient, claude: TestClient, *, write: bool = False) -> dict[str, Any]:
    """The whole flow for EMAIL; the token response."""
    verifier, challenge = pkce()
    rid = request_id(authorize(browser, challenge))
    r = approve(browser, rid, write=write)
    assert r.status_code == 200, r.text
    code = query_of(r.json()["redirectTo"])["code"][0]
    r = redeem(claude, code, verifier)
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def whoami(claude: TestClient, token: str) -> Response:
    return call(claude, "tools/call", {"name": "whoami", "arguments": {}}, token=token)


def sign_in(browser: TestClient, email: str = EMAIL) -> None:
    r = browser.post("/api/auth/login", json={"username": email, "password": PASSWORD})
    assert r.status_code == 200, r.text


def end(browser: TestClient, grant_id: str, **kwargs: Any) -> Response:
    headers = {"Content-Type": "application/json", **kwargs.pop("headers", {})}
    return browser.delete(f"/api/connections/{grant_id}", headers=headers, **kwargs)


# --- discovery (F1, F8) --------------------------------------------------------------------------


@pytest.mark.parametrize("path", DISCOVERY[:2])
def test_the_protected_resource_document_needs_no_sign_in(claude: TestClient, path: str) -> None:
    r = claude.get(path)
    assert r.status_code == 200, r.text
    assert r.json() == PRM_DOCUMENT
    assert r.headers["content-type"] == "application/json"
    assert r.headers["cache-control"] == "no-store"


def test_the_authorization_server_document(claude: TestClient) -> None:
    r = claude.get("/.well-known/oauth-authorization-server")
    assert r.status_code == 200, r.text
    assert r.json() == AS_DOCUMENT
    assert "registration_endpoint" not in r.json()
    assert r.headers["cache-control"] == "no-store"


def test_the_issuer_has_no_trailing_slash(claude: TestClient) -> None:
    issuer = claude.get("/.well-known/oauth-authorization-server").json()["issuer"]
    assert issuer == ORIGIN
    assert not issuer.endswith("/")
    assert claude.get(PRM).json()["authorization_servers"] == [issuer]


def test_discovery_uses_the_public_origin_not_the_host_asked(config: Config) -> None:
    app = create_app(config, run_backups=False, fetch=StubFetch())
    with TestClient(app, base_url="http://localhost:8000") as c:
        assert c.get("/.well-known/oauth-authorization-server").json()["issuer"] == ORIGIN
        assert c.get(PRM).json()["resource"] == RESOURCE


def test_the_401_points_at_the_served_protected_resource_document(
    claude: TestClient, uid: int
) -> None:
    r = call(claude, "initialize", INITIALIZE)
    assert r.status_code == 401
    header = r.headers["www-authenticate"]
    assert f'resource_metadata="{ORIGIN}{PRM}"' in header
    assert claude.get(PRM).json() == PRM_DOCUMENT


@pytest.mark.parametrize("path", ["/.well-known/openid-configuration", "/.well-known/x"])
def test_other_well_known_paths_are_404(claude: TestClient, path: str) -> None:
    assert claude.get(path).status_code == 404


# --- the claude.ai flow, end to end --------------------------------------------------------------


def test_the_claude_ai_flow_end_to_end(
    browser: TestClient, claude: TestClient, uid: int, stub: StubFetch, config: Config
) -> None:
    # Discovery, as claude.ai does it: the 401, its protected resource, its server's metadata.
    header = call(claude, "initialize", INITIALIZE).headers["www-authenticate"]
    prm_url = header.split('resource_metadata="', 1)[1].split('"', 1)[0]
    prm = claude.get(prm_url).json()
    issuer = prm["authorization_servers"][0]
    assert not issuer.endswith("/")
    metadata = claude.get(f"{issuer}/.well-known/oauth-authorization-server").json()
    assert metadata["issuer"] == issuer

    # Authorize: the client is fetched, the request held, the browser sent to the consent screen.
    verifier, challenge = pkce()
    r = authorize(browser, challenge)
    rid = request_id(r)
    assert stub.calls == [CLAUDE_AI]

    # The consent screen reads it, signed out.
    r = browser.get(f"/api/oauth/requests/{rid}")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "clientName": "Claude",
        "clientHost": "claude.ai",
        "redirectHost": "claude.ai",
        "scope": "read write",
        "expiresAt": config.clock() + oauth.REQUEST_LIFETIME,
    }

    # Approve, read only: back to claude.ai with the code, the state and the issuer.
    r = approve(browser, rid)
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"redirectTo"}
    redirect_to = r.json()["redirectTo"]
    assert redirect_to.startswith(CLAUDE_AI_REDIRECT + "?")
    back = query_of(redirect_to)
    assert set(back) == {"code", "state", "iss"}
    assert (back["state"], back["iss"]) == ([STATE], [issuer])
    assert "set-cookie" not in r.headers

    # The token endpoint, as claude.ai's servers call it: a form, no Origin, no cookie.
    r = redeem(claude, back["code"][0], verifier)
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["pragma"] == "no-cache"
    first = r.json()
    assert set(first) == {"access_token", "token_type", "expires_in", "refresh_token", "scope"}
    assert first["token_type"] == "Bearer"
    assert first["expires_in"] == oauth.ACCESS_LIFETIME
    assert first["scope"] == "read"
    assert first["access_token"].startswith("tka_")
    assert first["refresh_token"].startswith("tkr_")

    # The MCP endpoint takes the access token.
    info = result(call(claude, "initialize", INITIALIZE, token=first["access_token"]))
    assert info["serverInfo"]["name"] == "tracker"
    who = result(whoami(claude, first["access_token"]))
    assert who["structuredContent"] == {"email": EMAIL, "scope": "read"}

    # Refresh rotates both; the new access token works.
    r = refresh(claude, first["refresh_token"])
    assert r.status_code == 200, r.text
    second = r.json()
    assert second["access_token"] != first["access_token"]
    assert second["refresh_token"] != first["refresh_token"]
    assert second["scope"] == "read"
    assert result(whoami(claude, second["access_token"]))["structuredContent"]["email"] == EMAIL

    # Revoking the refresh token ends the connection: its access tokens and refresh with it.
    r = form(
        claude, "/api/oauth/revoke", {"token": second["refresh_token"], "client_id": CLAUDE_AI}
    )
    assert (r.status_code, r.json()) == (200, {})
    assert r.headers["cache-control"] == "no-store"
    assert whoami(claude, second["access_token"]).status_code == 401
    assert refresh(claude, second["refresh_token"]).json()["error"] == "invalid_grant"


def test_claude_code_connects_with_a_loopback_redirect_on_any_port(
    browser: TestClient, claude: TestClient, uid: int
) -> None:
    redirect = "http://localhost:54321/callback"
    verifier, challenge = pkce()
    rid = request_id(authorize(browser, challenge, client_id=CLAUDE_CODE, redirect_uri=redirect))
    assert browser.get(f"/api/oauth/requests/{rid}").json()["clientName"] == "Claude Code"
    redirect_to = approve(browser, rid).json()["redirectTo"]
    assert redirect_to.startswith(redirect + "?")
    code = query_of(redirect_to)["code"][0]
    r = redeem(claude, code, verifier, client_id=CLAUDE_CODE, redirect_uri=redirect)
    assert r.status_code == 200, r.text
    assert result(whoami(claude, r.json()["access_token"]))["isError"] is False


def test_a_read_grant_is_refused_a_write_tool(
    browser: TestClient, claude: TestClient, uid: int
) -> None:
    access = connect(browser, claude)["access_token"]
    assert NEEDS_WRITE in write_error(claude, access, "add_item", {"name": "Dips"})


def test_a_write_grant_may_write(browser: TestClient, claude: TestClient, uid: int) -> None:
    tokens = connect(browser, claude, write=True)
    assert tokens["scope"] == "read write"
    assert tool(claude, tokens["access_token"], "whoami") == {"email": EMAIL, "scope": "write"}
    added = result(
        call(
            claude,
            "tools/call",
            {"name": "add_item", "arguments": {"name": "Dips"}},
            token=tokens["access_token"],
        )
    )
    assert added["isError"] is False, added
    assert added["structuredContent"]["item"]["name"] == "Dips"


def test_a_token_for_another_resource_gets_401(
    conn: sqlite3.Connection, config: Config, claude: TestClient, uid: int
) -> None:
    """F5: the grant's own resource reaches the SDK, which compares it with this server's."""
    resolver = oauth.ClientResolver(config.oauth_client_hosts, config.clock, StubFetch())
    client = resolver.check(CLAUDE_AI, CLAUDE_AI_REDIRECT)
    verifier, challenge = pkce()
    elsewhere = "https://elsewhere.example/api/mcp"
    rid = oauth.create_request(
        conn,
        config,
        client,
        redirect_uri=CLAUDE_AI_REDIRECT,
        code_challenge=challenge,
        resource=elsewhere,
        scope=None,
        state=None,
    )
    approval = oauth.approve(conn, config, rid, uid, write=True)
    tokens = oauth.redeem_code(
        conn,
        config,
        code=approval.code,
        client_id=CLAUDE_AI,
        redirect_uri=CLAUDE_AI_REDIRECT,
        code_verifier=verifier,
        resource=None,
    )
    assert oauth.access_user(conn, config, tokens.access_token) is not None  # a live token
    r = whoami(claude, tokens.access_token)
    assert r.status_code == 401
    assert 'error="invalid_token"' in r.headers["www-authenticate"]


# --- the MCP verifier (D8, F9) -------------------------------------------------------------------


def test_an_access_token_ends_on_the_configs_clock(
    browser: TestClient, claude: TestClient, uid: int, clock: Clock
) -> None:
    tokens = connect(browser, claude)
    clock.advance(oauth.ACCESS_LIFETIME - 1)
    assert whoami(claude, tokens["access_token"]).status_code == 200
    clock.advance(1)
    assert whoami(claude, tokens["access_token"]).status_code == 401
    # The refresh token still renews it.
    renewed = refresh(claude, tokens["refresh_token"]).json()["access_token"]
    assert whoami(claude, renewed).status_code == 200


@pytest.mark.parametrize(
    "token",
    ["tka_" + "A" * 43, "tka_short", "tkr_" + "0" * 32 + "." + "A" * 43, "tkc_" + "A" * 43, "x"],
)
def test_an_unknown_or_other_kind_of_token_gets_401(
    claude: TestClient, uid: int, token: str
) -> None:
    assert whoami(claude, token).status_code == 401


def test_a_personal_token_still_works(
    conn: sqlite3.Connection, config: Config, claude: TestClient, uid: int
) -> None:
    token = auth.create_token(conn, config, EMAIL, "laptop", "read")
    assert result(whoami(claude, token))["structuredContent"] == {"email": EMAIL, "scope": "read"}


@pytest.mark.parametrize("prefix", ["trk_", "tka_"])
def test_a_failed_token_check_is_503_not_401(
    claude: TestClient,
    uid: int,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    prefix: str,
) -> None:
    """A 401 tells Claude the connection is gone; a database that fails is not that."""

    def broken(*_: object) -> None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(auth, "token_user", broken)
    monkeypatch.setattr(oauth, "access_user", broken)
    token = prefix + "A" * 43
    with caplog.at_level(logging.ERROR):
        r = whoami(claude, token)
    assert (r.status_code, r.json()) == (503, {"error": "busy"})
    assert r.headers["retry-after"] == "5"
    assert "the MCP token check failed" in caplog.text
    assert token not in caplog.text


# --- authorize: the client first, never an open redirect -----------------------------------------


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"client_id": "https://evil.example/oauth/client"}, "client-id"),
        ({"client_id": "http://claude.ai/oauth/mcp-oauth-client-metadata"}, "client-id"),
        ({"client_id": "https://claude.ai/oauth/unknown"}, "status"),
        ({"redirect_uri": "https://evil.example/callback"}, "redirect"),
        ({"redirect_uri": CLAUDE_AI_REDIRECT + "/x"}, "redirect"),
        ({"redirect_uri": None}, "client_id and redirect_uri"),
        ({"client_id": None}, "client_id and redirect_uri"),
    ],
)
def test_an_unknown_client_or_redirect_is_400_and_never_redirected(
    browser: TestClient, change: dict[str, Any], reason: str
) -> None:
    r = authorize(browser, pkce()[1], **change)
    assert r.status_code == 400
    assert "location" not in r.headers
    assert r.headers["content-type"].startswith("text/plain")
    assert reason in r.text
    assert "evil" not in r.text


def test_a_client_or_redirect_sent_twice_is_400(browser: TestClient) -> None:
    challenge = pkce()[1]
    url = (
        f"/api/oauth/authorize?response_type=code&client_id={CLAUDE_AI}&client_id={CLAUDE_AI}"
        f"&redirect_uri={CLAUDE_AI_REDIRECT}&code_challenge={challenge}"
        "&code_challenge_method=S256"
    )
    r = browser.get(url, follow_redirects=False)
    assert r.status_code == 400
    assert "location" not in r.headers


@pytest.mark.parametrize(
    ("change", "error"),
    [
        ({"response_type": "token"}, "unsupported_response_type"),
        ({"response_type": None}, "unsupported_response_type"),
        ({"code_challenge_method": "plain"}, "invalid_request"),
        ({"code_challenge_method": None}, "invalid_request"),
        ({"code_challenge": None}, "invalid_request"),
        ({"code_challenge": "short"}, "invalid_request"),
        ({"code_challenge": "A" * 129}, "invalid_request"),
        ({"code_challenge": "A" * 42 + "="}, "invalid_request"),
        ({"resource": "https://elsewhere.example/api/mcp"}, "invalid_target"),
        ({"resource": RESOURCE + "/"}, "invalid_target"),
        ({"scope": "admin"}, "invalid_scope"),
        ({"scope": "read admin"}, "invalid_scope"),
        ({"scope": ""}, "invalid_scope"),
        ({"state": "a\nb"}, "invalid_request"),
    ],
)
def test_a_bad_request_from_a_known_client_goes_back_with_state_and_iss(
    browser: TestClient, change: dict[str, Any], error: str
) -> None:
    r = authorize(browser, pkce()[1], **change)
    assert r.status_code == 302
    location = r.headers["location"]
    assert location.startswith(CLAUDE_AI_REDIRECT + "?")
    back = query_of(location)
    assert back["error"] == [error]
    assert back["iss"] == [ORIGIN]
    assert back["state"] == [change.get("state", STATE)]


def test_a_parameter_sent_twice_is_invalid_request(browser: TestClient) -> None:
    challenge = pkce()[1]
    url = (
        f"/api/oauth/authorize?response_type=code&client_id={CLAUDE_AI}"
        f"&redirect_uri={CLAUDE_AI_REDIRECT}&code_challenge={challenge}"
        "&code_challenge_method=S256&scope=read&scope=write&state=s"
    )
    r = browser.get(url, follow_redirects=False)
    assert query_of(r.headers["location"])["error"] == ["invalid_request"]


def test_a_state_too_long_is_refused_and_not_carried_back(browser: TestClient) -> None:
    r = authorize(browser, pkce()[1], state="s" * 1025)
    back = query_of(r.headers["location"])
    assert back["error"] == ["invalid_request"]
    assert "state" not in back


def test_a_redirect_keeps_its_own_query(browser: TestClient, stub: StubFetch) -> None:
    from .test_oauth import CLAUDE_AI_DOC, doc

    with_query = CLAUDE_AI_REDIRECT + "?tenant=a%26b"
    stub.docs[CLAUDE_AI] = doc(CLAUDE_AI_DOC | {"redirect_uris": [with_query]})
    r = authorize(browser, pkce()[1], redirect_uri=with_query, response_type="token")
    back = query_of(r.headers["location"])
    assert back["tenant"] == ["a&b"]
    assert back["error"] == ["unsupported_response_type"]


@pytest.mark.parametrize(
    ("scope", "held"),
    [(None, None), ("read", "read"), ("write", "write"), ("write read", "read write")],
)
def test_the_scope_asked_is_held_for_the_consent_screen(
    browser: TestClient, scope: str | None, held: str | None
) -> None:
    rid = request_id(authorize(browser, pkce()[1], scope=scope))
    assert browser.get(f"/api/oauth/requests/{rid}").json()["scope"] == held


def test_no_resource_means_this_one(browser: TestClient, claude: TestClient, uid: int) -> None:
    verifier, challenge = pkce()
    rid = request_id(authorize(browser, challenge, resource=None))
    code = query_of(approve(browser, rid).json()["redirectTo"])["code"][0]
    access = redeem(claude, code, verifier).json()["access_token"]
    assert whoami(claude, access).status_code == 200


def test_too_many_pending_requests_go_back_as_temporarily_unavailable(
    browser: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(oauth, "MAX_REQUESTS", 1)
    request_id(authorize(browser, pkce()[1]))
    r = authorize(browser, pkce()[1])
    back = query_of(r.headers["location"])
    assert (back["error"], back["state"]) == (["temporarily_unavailable"], [STATE])


# --- the consent screen's calls ------------------------------------------------------------------


def test_an_unknown_or_expired_request_is_404(browser: TestClient, clock: Clock) -> None:
    r = browser.get("/api/oauth/requests/nope")
    assert (r.status_code, r.json()) == (404, {"error": "no-request"})
    rid = request_id(authorize(browser, pkce()[1]))
    clock.advance(oauth.REQUEST_LIFETIME)
    assert browser.get(f"/api/oauth/requests/{rid}").status_code == 404


def test_approve_creates_no_session(browser: TestClient, uid: int) -> None:
    rid = request_id(authorize(browser, pkce()[1]))
    r = approve(browser, rid)
    assert r.status_code == 200
    assert "set-cookie" not in r.headers
    assert browser.get("/api/auth/me").status_code == 401


def test_approve_needs_the_password_even_when_signed_in(browser: TestClient, uid: int) -> None:
    sign_in(browser)
    rid = request_id(authorize(browser, pkce()[1]))
    r = browser.post(f"/api/oauth/requests/{rid}/approve", json={"email": EMAIL, "write": False})
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})
    r = approve(browser, rid, password="wrong password!")
    assert (r.status_code, r.json()) == (401, {"error": "invalid"})
    assert approve(browser, rid).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"email": EMAIL, "password": PASSWORD, "write": "yes"},
        {"email": EMAIL, "password": 1},
        {"password": PASSWORD},
    ],
)
def test_approve_refuses_a_malformed_body(
    browser: TestClient, uid: int, body: dict[str, Any]
) -> None:
    rid = request_id(authorize(browser, pkce()[1]))
    r = browser.post(f"/api/oauth/requests/{rid}/approve", json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})


def test_write_defaults_to_read(browser: TestClient, claude: TestClient, uid: int) -> None:
    verifier, challenge = pkce()
    rid = request_id(authorize(browser, challenge))
    body = {"email": EMAIL, "password": PASSWORD}
    r = browser.post(f"/api/oauth/requests/{rid}/approve", json=body)
    code = query_of(r.json()["redirectTo"])["code"][0]
    assert redeem(claude, code, verifier).json()["scope"] == "read"


def test_a_wrong_password_keeps_the_lockout_count(
    browser: TestClient, conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    rid = request_id(authorize(browser, pkce()[1]))
    for n in range(1, config.lockout_attempts):
        r = approve(browser, rid, password="wrong password!")
        assert (r.status_code, r.json()) == (401, {"error": "invalid"})
        row = conn.execute("SELECT failed_logins FROM users WHERE id = ?", (uid,)).fetchone()
        assert row[0] == n
    # The last guess locks the account for approve and for sign-in alike.
    assert approve(browser, rid, password="wrong password!").status_code == 401
    r = approve(browser, rid)
    assert r.status_code == 423
    assert r.json() == {"error": "locked", "retryAfter": config.lockout_minutes * 60}
    assert r.headers["retry-after"] == str(config.lockout_minutes * 60)
    login = browser.post("/api/auth/login", json={"username": EMAIL, "password": PASSWORD})
    assert login.status_code == 423


def test_approve_shares_the_lockout_with_sign_in(
    browser: TestClient, conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    for _ in range(config.lockout_attempts - 1):
        browser.post("/api/auth/login", json={"username": EMAIL, "password": "nope nope nope"})
    rid = request_id(authorize(browser, pkce()[1]))
    assert approve(browser, rid, password="wrong password!").status_code == 401
    assert approve(browser, rid).status_code == 423


def test_a_dead_request_costs_no_guess(
    browser: TestClient, conn: sqlite3.Connection, uid: int
) -> None:
    r = approve(browser, "nope", password="wrong password!")
    assert (r.status_code, r.json()) == (404, {"error": "no-request"})
    row = conn.execute("SELECT failed_logins FROM users WHERE id = ?", (uid,)).fetchone()
    assert row[0] == 0


def test_an_unknown_email_is_invalid(browser: TestClient, uid: int) -> None:
    rid = request_id(authorize(browser, pkce()[1]))
    r = approve(browser, rid, email="nobody@example.com")
    assert (r.status_code, r.json()) == (401, {"error": "invalid"})


def test_a_busy_hasher_is_503(
    browser: TestClient, uid: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    rid = request_id(authorize(browser, pkce()[1]))

    def busy(*_: object) -> int:
        raise auth.AuthError("busy", retry_after=1)

    monkeypatch.setattr(auth, "login", busy)
    r = approve(browser, rid)
    assert (r.status_code, r.json()) == (503, {"error": "busy", "retryAfter": 1})


def test_a_disabled_account_cannot_approve(
    browser: TestClient, conn: sqlite3.Connection, uid: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    rid = request_id(authorize(browser, pkce()[1]))
    # Disabled between the password check and the approval.
    real_login = auth.login

    def then_disabled(*args: Any) -> int:
        found = real_login(*args)
        auth.set_disabled(conn, EMAIL, True)
        return found

    monkeypatch.setattr(auth, "login", then_disabled)
    r = approve(browser, rid)
    assert (r.status_code, r.json()) == (403, {"error": "disabled"})


def test_the_eleventh_connection_is_409_too_many(
    browser: TestClient, claude: TestClient, uid: int
) -> None:
    for _ in range(oauth.MAX_GRANTS):
        connect(browser, claude)
    rid = request_id(authorize(browser, pkce()[1]))
    r = approve(browser, rid)
    assert (r.status_code, r.json()) == (409, {"error": "too-many"})
    # The request waits for another try once a connection is removed.
    assert browser.get(f"/api/oauth/requests/{rid}").status_code == 200


@pytest.mark.parametrize(
    ("headers", "status", "error"),
    [
        ({"Origin": ""}, 403, "origin"),
        ({"Origin": "https://evil.example"}, 403, "origin"),
        ({"Content-Type": "text/plain"}, 415, "content-type"),
        ({"Content-Type": FORM}, 415, "content-type"),
    ],
)
@pytest.mark.parametrize("action", ["approve", "deny"])
def test_origin_and_json_stay_required_on_approve_and_deny(
    browser: TestClient,
    conn: sqlite3.Connection,
    uid: int,
    headers: dict[str, str],
    status: int,
    error: str,
    action: str,
) -> None:
    rid = request_id(authorize(browser, pkce()[1]))
    if headers.get("Origin") == "":
        browser.headers.pop("Origin")
        headers = {}
    body = f'{{"email": "{EMAIL}", "password": "{PASSWORD}", "write": true}}'
    sent = {"Content-Type": "application/json"} | headers
    r = browser.post(f"/api/oauth/requests/{rid}/{action}", content=body, headers=sent)
    assert (r.status_code, r.json()) == (status, {"error": error})
    assert browser.get(f"/api/oauth/requests/{rid}").status_code == 200
    assert conn.execute("SELECT count(*) FROM oauth_grants").fetchone()[0] == 0


def test_deny_goes_back_with_access_denied(browser: TestClient) -> None:
    rid = request_id(authorize(browser, pkce()[1]))
    r = browser.post(f"/api/oauth/requests/{rid}/deny", json={})
    assert r.status_code == 200, r.text
    back = query_of(r.json()["redirectTo"])
    assert back == {"error": ["access_denied"], "state": [STATE], "iss": [ORIGIN]}
    assert browser.get(f"/api/oauth/requests/{rid}").status_code == 404
    r = browser.post(f"/api/oauth/requests/{rid}/deny", json={})
    assert (r.status_code, r.json()) == (404, {"error": "no-request"})


def test_deny_without_a_state_carries_none(browser: TestClient) -> None:
    rid = request_id(authorize(browser, pkce()[1], state=None))
    back = query_of(browser.post(f"/api/oauth/requests/{rid}/deny", json={}).json()["redirectTo"])
    assert back == {"error": ["access_denied"], "iss": [ORIGIN]}


# --- token and revoke ----------------------------------------------------------------------------


def test_the_token_endpoint_takes_no_origin_and_no_cookie(claude: TestClient) -> None:
    """F3: before, the REST guard answered 403 `origin` here."""
    r = refresh(claude, "tkr_nothing")
    assert (r.status_code, r.json()) == (400, {"error": "invalid_grant"})


@pytest.mark.parametrize(
    ("kwargs", "status", "description"),
    [
        ({"json": {"grant_type": "refresh_token"}}, 400, f"send {FORM}"),
        ({"content": b"grant_type=x", "headers": {"Content-Type": "text/plain"}}, 400, None),
        ({"data": {"a": "b"}, "headers": {"Origin": "https://evil.example"}}, 403, "origin"),
        ({"data": {"a": "b"}, "params": {"code": "x"}}, 400, "parameters go in the body"),
        ({"content": b"a=" + b"b" * 9000, "headers": {"Content-Type": FORM}}, 413, "too large"),
    ],
)
@pytest.mark.parametrize("path", ["/api/oauth/token", "/api/oauth/revoke"])
def test_the_form_endpoints_own_rules(
    claude: TestClient,
    path: str,
    kwargs: dict[str, Any],
    status: int,
    description: str | None,
) -> None:
    r = claude.post(path, **kwargs)
    assert r.status_code == status, r.text
    assert r.json()["error"] == "invalid_request"
    if description is not None:
        assert r.json()["error_description"] == description
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["pragma"] == "no-cache"


def test_the_app_origin_may_call_the_token_endpoint(claude: TestClient) -> None:
    r = claude.post(
        "/api/oauth/token",
        data={"grant_type": "refresh_token", "refresh_token": "x", "client_id": CLAUDE_AI},
        headers={"Origin": ORIGIN},
    )
    assert r.json()["error"] == "invalid_grant"


@pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
def test_the_form_endpoints_are_post_only(claude: TestClient, method: str) -> None:
    r = claude.request(method, "/api/oauth/token")
    assert (r.status_code, r.json()["error"]) == (405, "invalid_request")


def test_a_chunked_body_is_counted(claude: TestClient) -> None:
    def chunks() -> Iterator[bytes]:
        yield b"grant_type=refresh_token&a="
        for _ in range(10):
            yield b"b" * 1024

    r = claude.post("/api/oauth/token", content=chunks(), headers={"Content-Type": FORM})
    assert (r.status_code, r.json()["error"]) == (413, "invalid_request")


@pytest.mark.parametrize(
    ("body", "error", "status"),
    [
        (b"grant_type=refresh_token&grant_type=refresh_token", "invalid_request", 400),
        (b"grant_type=%ff", "invalid_request", 400),
        (b"&".join(b"f%d=1" % i for i in range(20)), "invalid_request", 400),
        (b"client_id=x", "invalid_request", 400),
        (b"grant_type=password&client_id=x", "unsupported_grant_type", 400),
        (b"grant_type=client_credentials", "unsupported_grant_type", 400),
        (b"grant_type=refresh_token&refresh_token=x", "invalid_client", 401),
        (b"grant_type=refresh_token&client_id=x", "invalid_request", 400),
        (b"grant_type=authorization_code&client_id=x&code=y", "invalid_request", 400),
        (
            b"grant_type=refresh_token&client_id=x&refresh_token=y&resource=https://e.example",
            "invalid_target",
            400,
        ),
    ],
)
def test_token_refusals_are_oauth_shaped(
    claude: TestClient, body: bytes, error: str, status: int
) -> None:
    r = claude.post("/api/oauth/token", content=body, headers={"Content-Type": FORM})
    assert (r.status_code, r.json()["error"]) == (status, error), r.text
    if status == 401:
        assert r.headers["www-authenticate"] == 'Basic realm="oauth"'


def test_a_wrong_verifier_or_client_is_invalid_grant_and_ends_nothing(
    browser: TestClient, claude: TestClient, uid: int
) -> None:
    verifier, challenge = pkce()
    rid = request_id(authorize(browser, challenge))
    code = query_of(approve(browser, rid).json()["redirectTo"])["code"][0]
    r = redeem(claude, code, pkce()[0])
    assert (r.status_code, r.json()) == (400, {"error": "invalid_grant"})
    r = redeem(claude, code, verifier, client_id=CLAUDE_CODE)
    assert r.json() == {"error": "invalid_grant"}
    r = redeem(claude, code, verifier, resource="https://e.example/api/mcp")
    assert r.json() == {"error": "invalid_target"}
    assert redeem(claude, code, verifier).status_code == 200


def test_a_code_used_twice_ends_the_connection(
    browser: TestClient, claude: TestClient, uid: int
) -> None:
    verifier, challenge = pkce()
    rid = request_id(authorize(browser, challenge))
    code = query_of(approve(browser, rid).json()["redirectTo"])["code"][0]
    tokens = redeem(claude, code, verifier).json()
    r = redeem(claude, code, verifier)
    assert r.status_code == 400
    assert r.json() == {
        "error": "invalid_grant",
        "error_description": "the authorization code was used twice",
    }
    assert whoami(claude, tokens["access_token"]).status_code == 401


def test_a_busy_refresh_is_503(claude: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def busy(*_: object, **__: object) -> oauth.Issued:
        raise oauth.InvalidGrant(reason="busy")

    monkeypatch.setattr(oauth, "refresh", busy)
    r = refresh(claude, "tkr_x")
    assert (r.status_code, r.json()) == (503, {"error": "temporarily_unavailable"})
    assert r.headers["retry-after"] == "1"


def test_revoke_an_access_token_ends_it_alone(
    browser: TestClient, claude: TestClient, uid: int
) -> None:
    tokens = connect(browser, claude)
    data = {"token": tokens["access_token"], "client_id": CLAUDE_AI}
    assert form(claude, "/api/oauth/revoke", data).status_code == 200
    assert whoami(claude, tokens["access_token"]).status_code == 401
    assert refresh(claude, tokens["refresh_token"]).status_code == 200


@pytest.mark.parametrize(
    ("data", "status", "error"),
    [
        ({"token": "anything", "client_id": CLAUDE_AI}, 200, None),
        ({"token": "tkr_" + "0" * 32 + "." + "A" * 43, "client_id": CLAUDE_AI}, 200, None),
        ({"client_id": CLAUDE_AI}, 400, "invalid_request"),
        ({"token": "anything"}, 401, "invalid_client"),
    ],
)
def test_revoke_answers(
    claude: TestClient, data: dict[str, str], status: int, error: str | None
) -> None:
    r = form(claude, "/api/oauth/revoke", data)
    assert r.status_code == status
    if error is None:
        assert r.json() == {}
    else:
        assert r.json()["error"] == error


# --- Settings, Connections ----------------------------------------------------------------------


def test_connections_lists_the_users_own(
    browser: TestClient, claude: TestClient, uid: int, bob: int, clock: Clock
) -> None:
    connect(browser, claude, write=True)
    sign_in(browser)
    r = browser.get("/api/connections")
    assert r.status_code == 200, r.text
    (row,) = r.json()["connections"]
    assert set(row) == {
        "id",
        "clientName",
        "clientHost",
        "scope",
        "createdAt",
        "lastUsedAt",
        "expiresAt",
        "isNew",
    }
    assert (row["clientName"], row["clientHost"], row["scope"]) == ("Claude", "claude.ai", "write")
    assert row["createdAt"] == clock.now
    assert row["expiresAt"] == clock.now + oauth.GRANT_LIFETIME
    assert row["isNew"] is True
    clock.advance(oauth.NEW_FOR)
    assert browser.get("/api/connections").json()["connections"][0]["isNew"] is False
    sign_in(browser, BOB)
    assert browser.get("/api/connections").json() == {"connections": []}


def test_connections_needs_a_session(browser: TestClient) -> None:
    r = browser.get("/api/connections")
    assert (r.status_code, r.json()) == (401, {"error": "auth"})


def test_removing_a_connection_ends_its_tokens(
    browser: TestClient, claude: TestClient, uid: int, bob: int
) -> None:
    tokens = connect(browser, claude)
    sign_in(browser)
    grant_id = browser.get("/api/connections").json()["connections"][0]["id"]
    sign_in(browser, BOB)
    r = end(browser, grant_id)
    assert (r.status_code, r.json()) == (404, {"error": "no-connection"})
    sign_in(browser)
    r = end(browser, grant_id, headers={"Origin": "https://evil.example"})
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    assert end(browser, grant_id).status_code == 204
    assert browser.get("/api/connections").json() == {"connections": []}
    assert whoami(claude, tokens["access_token"]).status_code == 401
    assert refresh(claude, tokens["refresh_token"]).json()["error"] == "invalid_grant"
    r = end(browser, grant_id)
    assert (r.status_code, r.json()) == (404, {"error": "no-connection"})


# --- logs ----------------------------------------------------------------------------------------


def test_no_secret_reaches_the_log(
    browser: TestClient, claude: TestClient, uid: int, caplog: pytest.LogCaptureFixture
) -> None:
    verifier, challenge = pkce()
    with caplog.at_level(logging.DEBUG):
        rid = request_id(authorize(browser, challenge))
        approve(browser, rid, password="wrong password!")
        code = query_of(approve(browser, rid).json()["redirectTo"])["code"][0]
        tokens = redeem(claude, code, verifier).json()
        redeem(claude, code, verifier)
        whoami(claude, tokens["access_token"])
        refresh(claude, tokens["refresh_token"])
    # The server's own lines: the test client logs each URL it asks for, as uvicorn's access log
    # would (the consent screen's calls carry the request id in their path).
    logged = "\n".join(
        r.getMessage() for r in caplog.records if r.name.split(".")[0] in ("tracker_api", "mcp")
    )
    assert "waiting for consent" in logged
    for secret in [rid, code, verifier, PASSWORD, tokens["access_token"], tokens["refresh_token"]]:
        assert secret not in logged
    assert tokens["refresh_token"].split(".")[1] not in logged


def test_the_sdk_is_given_the_issuer_and_resource_without_a_slash(config: Config) -> None:
    """F8: `AnyHttpUrl(origin)` would add one; the SDK's settings hold what the metadata says."""
    settings = build_mcp(config, MAX_BODY).server.settings.auth
    assert settings is not None
    assert str(settings.issuer_url) == ORIGIN
    assert str(settings.resource_server_url) == RESOURCE
