"""OAuth storage, lifetimes and revocation (oauth.py): codes, refresh rotation with its grace and
reuse detection, the 90-day connection, CIMD clients, and how connections end."""

import base64
import hashlib
import http.server
import json
import logging
import secrets
import sqlite3
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest

from tracker_api import auth, oauth
from tracker_api.auth import AuthError
from tracker_api.cli import main
from tracker_api.config import Config
from tracker_api.db import connect
from tracker_api.oauth import ClientRefused, Fetched, InvalidGrant

from .conftest import ORIGIN, Clock

PASSWORD = "correct horse battery"
DAY = 86_400
RESOURCE = f"{ORIGIN}/api/mcp"
#: What a form field may hold when a client sends JSON instead: never a crash.
NOT_A_STRING: Any = None

# The two documents Claude publishes, as fetched on 2026-11-03.
CLAUDE_AI = "https://claude.ai/oauth/mcp-oauth-client-metadata"
CLAUDE_AI_REDIRECT = "https://claude.ai/api/mcp/auth_callback"
CLAUDE_AI_DOC: dict[str, Any] = {
    "client_id": CLAUDE_AI,
    "client_name": "Claude",
    "client_uri": "https://claude.ai",
    "redirect_uris": [CLAUDE_AI_REDIRECT],
    "grant_types": [
        "authorization_code",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
    ],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
}
CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata"
CLAUDE_CODE_DOC: dict[str, Any] = {
    "client_id": CLAUDE_CODE,
    "client_name": "Claude Code",
    "client_uri": "https://claude.ai",
    "redirect_uris": ["http://localhost/callback", "http://127.0.0.1/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
}
# The document ChatGPT publishes, as fetched on 2026-11-04. Its singular method is a preference;
# the plural list is what it can use (OpenAI's auth guide, "Client registration").
CHATGPT = "https://chatgpt.com/oauth/client.json"
CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"
CHATGPT_DOC: dict[str, Any] = {
    "client_id": CHATGPT,
    "client_uri": "https://chatgpt.com/",
    "redirect_uris": [CHATGPT_REDIRECT],
    "token_endpoint_auth_method": "private_key_jwt",
    "token_endpoint_auth_methods_supported": ["none", "private_key_jwt"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "client_name": "ChatGPT",
    "logo_uri": "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
    "token_endpoint_auth_signing_alg": "RS256",
    "jwks_uri": "https://chatgpt.com/oauth/jwks.json",
}

#: Claude's document with ChatGPT's preference: whether it is a public client rests on its list.
CLAUDE_AI_PREFERS_JWT = CLAUDE_AI_DOC | {"token_endpoint_auth_method": "private_key_jwt"}


def doc(body: dict[str, Any], status: int = 200) -> Fetched:
    return Fetched(status, json.dumps(body).encode())


class StubFetch:
    """Answers from a dict, 404 otherwise, and records each URL asked for: tests never fetch."""

    def __init__(self) -> None:
        self.docs: dict[str, Fetched] = {CLAUDE_AI: doc(CLAUDE_AI_DOC)}
        self.docs[CLAUDE_CODE] = doc(CLAUDE_CODE_DOC)
        self.docs[CHATGPT] = doc(CHATGPT_DOC)
        self.calls: list[str] = []

    def __call__(self, url: str) -> Fetched:
        self.calls.append(url)
        return self.docs.get(url, Fetched(404, b""))


@pytest.fixture(autouse=True)
def quiet_log() -> Iterator[None]:
    oauth.reset_wrong_secret_log()
    yield
    oauth.reset_wrong_secret_log()


@pytest.fixture
def stub() -> StubFetch:
    return StubFetch()


@pytest.fixture
def resolver(config: Config, stub: StubFetch) -> oauth.ClientResolver:
    return oauth.ClientResolver(config.oauth_client_hosts, config.clock, stub)


def make_user(conn: sqlite3.Connection, config: Config, name: str = "alice@example.com") -> int:
    token = auth.mint_link(conn, config, "invite", name)
    return auth.redeem(conn, config, token, PASSWORD)


@pytest.fixture
def alice(conn: sqlite3.Connection, config: Config) -> int:
    return make_user(conn, config)


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@dataclass
class Flow:
    approval: oauth.Approval
    verifier: str
    client_id: str
    redirect_uri: str

    def redeem(self, conn: sqlite3.Connection, config: Config, **change: Any) -> oauth.Issued:
        args: dict[str, Any] = {
            "code": self.approval.code,
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "code_verifier": self.verifier,
            "resource": RESOURCE,
        }
        return oauth.redeem_code(conn, config, **(args | change))


def approve(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    uid: int,
    *,
    write: bool = False,
    client_id: str = CLAUDE_AI,
    redirect_uri: str = CLAUDE_AI_REDIRECT,
) -> Flow:
    verifier, challenge = pkce()
    client = resolver.check(client_id, redirect_uri)
    rid = oauth.create_request(
        conn,
        config,
        client,
        redirect_uri=redirect_uri,
        code_challenge=challenge,
        resource=RESOURCE,
        scope="read write",
        state="st-1",
    )
    approval = oauth.approve(conn, config, rid, uid, write=write)
    return Flow(approval, verifier, client_id, redirect_uri)


def connect_claude(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    uid: int,
    **kw: Any,
) -> oauth.Issued:
    return approve(conn, config, resolver, uid, **kw).redeem(conn, config)


def refresh(conn: sqlite3.Connection, config: Config, token: str, **change: Any) -> oauth.Issued:
    args: dict[str, Any] = {"refresh_token": token, "client_id": CLAUDE_AI, "resource": RESOURCE}
    return oauth.refresh(conn, config, **(args | change))


def grant_of(issued: oauth.Issued) -> str:
    return issued.refresh_token.removeprefix("tkr_").split(".")[0]


def grants(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT count(*) FROM oauth_grants").fetchone()[0])


def alive(conn: sqlite3.Connection, config: Config, issued: oauth.Issued) -> bool:
    return oauth.access_user(conn, config, issued.access_token) is not None


# ------------------------------------------------------------ codes


def test_a_code_redeems_for_an_access_and_a_refresh_token(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    flow = approve(conn, config, resolver, alice, write=True)
    assert flow.approval.redirect_uri == CLAUDE_AI_REDIRECT
    assert flow.approval.state == "st-1"
    assert flow.approval.code.startswith("tkc_")
    issued = flow.redeem(conn, config)
    assert issued.access_token.startswith("tka_") and issued.refresh_token.startswith("tkr_")
    assert (issued.expires_in, issued.scope) == (3600, "write")
    who = oauth.access_user(conn, config, issued.access_token)
    assert who is not None
    assert (who.user_id, who.username, who.scope, who.resource) == (
        alice,
        "alice@example.com",
        "write",
        RESOURCE,
    )
    assert who.expires_at == config.clock() + 3600
    assert who.grant_id == flow.approval.grant_id == grant_of(issued)


def test_the_write_box_decides_the_scope(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    issued = connect_claude(conn, config, resolver, alice)  # asked for "read write", box unticked
    assert issued.scope == "read"
    who = oauth.access_user(conn, config, issued.access_token)
    assert who is not None and who.scope == "read"


def test_the_database_holds_no_plaintext_secret(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    flow = approve(conn, config, resolver, alice)
    first = flow.redeem(conn, config)
    second = refresh(conn, config, first.refresh_token)
    dump = "\n".join(conn.iterdump())
    tokens = [flow.approval.code, first.access_token, first.refresh_token]
    for token in [*tokens, second.access_token, second.refresh_token]:
        assert token not in dump
        assert token[4:].split(".")[-1] not in dump  # nor the secret without its prefix


@pytest.mark.parametrize(
    "change",
    [
        {"code_verifier": "x" * 43},
        {"code_verifier": "short"},
        {"code_verifier": ""},
        {"client_id": CLAUDE_CODE},
        {"redirect_uri": "https://claude.ai/api/mcp/other"},
        {"resource": "https://elsewhere.example/api/mcp"},
    ],
)
def test_a_wrong_verifier_client_redirect_or_resource_is_refused_and_ends_nothing(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    alice: int,
    change: dict[str, str],
) -> None:
    flow = approve(conn, config, resolver, alice)
    with pytest.raises(InvalidGrant) as refused:
        flow.redeem(conn, config, **change)
    assert (refused.value.reason, refused.value.ended) == ("code_mismatch", False)
    issued = flow.redeem(conn, config)  # the right one still works
    assert alive(conn, config, issued)


def test_a_code_without_a_resource_takes_its_own(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    issued = approve(conn, config, resolver, alice).redeem(conn, config, resource=None)
    who = oauth.access_user(conn, config, issued.access_token)
    assert who is not None and who.resource == RESOURCE


def test_a_reused_code_ends_its_grant(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    flow = approve(conn, config, resolver, alice)
    issued = flow.redeem(conn, config)
    refreshed = refresh(conn, config, issued.refresh_token)
    with pytest.raises(InvalidGrant) as refused:
        flow.redeem(conn, config)
    assert (refused.value.reason, refused.value.ended) == ("reuse", True)
    assert not alive(conn, config, issued) and not alive(conn, config, refreshed)
    with pytest.raises(InvalidGrant, match="invalid grant"):
        refresh(conn, config, refreshed.refresh_token)
    assert grants(conn) == 0
    with pytest.raises(InvalidGrant) as again:  # and the code is gone with it
        flow.redeem(conn, config)
    assert again.value.reason == "unknown"


def test_a_reused_code_with_a_wrong_verifier_ends_nothing(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    """As finances: only a second use that passes every binding proves the code leaked with its
    verifier. Anything less is a plain refusal."""
    flow = approve(conn, config, resolver, alice)
    issued = flow.redeem(conn, config)
    with pytest.raises(InvalidGrant) as refused:
        flow.redeem(conn, config, code_verifier="y" * 43)
    assert (refused.value.reason, refused.value.ended) == ("code_mismatch", False)
    assert alive(conn, config, issued)


def test_a_code_lasts_60_seconds(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    fresh = approve(conn, config, resolver, alice)
    clock.advance(59)
    assert alive(conn, config, fresh.redeem(conn, config))
    stale = approve(conn, config, resolver, alice)
    clock.advance(60)
    with pytest.raises(InvalidGrant) as refused:
        stale.redeem(conn, config)
    assert (refused.value.reason, refused.value.ended) == ("unknown", False)
    # A grant whose code was never redeemed is never listed, and the sweep removes it.
    assert [g.grant_id for g in oauth.list_grants(conn, config, alice)] == [fresh.approval.grant_id]
    assert grants(conn) == 1


@pytest.mark.parametrize("code", ["", "tkc_nothing", "tka_" + "a" * 43, "x" * 2000])
def test_an_unknown_code_is_refused(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int, code: str
) -> None:
    flow = approve(conn, config, resolver, alice)
    with pytest.raises(InvalidGrant) as refused:
        flow.redeem(conn, config, code=code)
    assert (refused.value.reason, refused.value.ended) == ("unknown", False)


def test_a_code_whose_grant_already_started_is_refused(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    """The first pair is a compare-and-swap too: a grant already holding a refresh token (a row
    edited by hand) is refused, and the code stays unredeemed."""
    flow = approve(conn, config, resolver, alice)
    conn.execute("UPDATE oauth_grants SET generation = 4")
    with pytest.raises(InvalidGrant) as refused:
        flow.redeem(conn, config)
    assert (refused.value.reason, refused.value.ended) == ("unknown", False)
    assert conn.execute("SELECT redeemed_at FROM oauth_codes").fetchone()[0] is None


def test_a_disabled_account_cannot_redeem(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    flow = approve(conn, config, resolver, alice)
    conn.execute("UPDATE users SET disabled = 1 WHERE id = ?", (alice,))  # by hand: no cleanup
    with pytest.raises(InvalidGrant) as refused:
        flow.redeem(conn, config)
    assert refused.value.reason == "disabled"


# ------------------------------------------------------------ refresh


def test_refresh_rotates_both_tokens(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    first = connect_claude(conn, config, resolver, alice, write=True)
    clock.advance(1800)
    second = refresh(conn, config, first.refresh_token)
    assert second.access_token != first.access_token
    assert second.refresh_token != first.refresh_token
    assert grant_of(second) == grant_of(first)
    assert (second.expires_in, second.scope) == (3600, "write")
    assert alive(conn, config, second)
    assert alive(conn, config, first)  # an access token lives out its hour
    third = refresh(conn, config, second.refresh_token)
    assert alive(conn, config, third)
    row = conn.execute("SELECT generation, last_used_at FROM oauth_grants").fetchone()
    assert (row["generation"], row["last_used_at"]) == (3, clock())


def test_a_race_inside_the_grace_gets_the_same_pair(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    winner = refresh(conn, config, first.refresh_token)
    clock.advance(60)  # the grace includes its last second
    twin = refresh(conn, config, first.refresh_token)
    assert (twin.access_token, twin.refresh_token) == (winner.access_token, winner.refresh_token)
    assert twin.expires_in == 3600 - 60
    assert grants(conn) == 1
    assert alive(conn, config, refresh(conn, config, twin.refresh_token))


def test_a_lost_compare_and_swap_takes_the_winners_pair(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    alice: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A refresh that read the row before its twin rotated it loses the swap (rowcount 0), reads
    again, and finds the twin's pair in the grace."""
    first = connect_claude(conn, config, resolver, alice)
    real = oauth._grant
    stale = real(conn, grant_of(first))
    winner = refresh(conn, config, first.refresh_token)
    reads = iter([stale])
    monkeypatch.setattr(oauth, "_grant", lambda c, g: next(reads, None) or real(c, g))
    twin = refresh(conn, config, first.refresh_token)
    assert (twin.access_token, twin.refresh_token) == (winner.access_token, winner.refresh_token)
    gen = conn.execute("SELECT generation FROM oauth_grants").fetchone()[0]
    assert gen == 2  # one rotation by the redeem, one by the winner; the loser swapped nothing


def test_a_swap_lost_twice_is_refused_and_ends_nothing(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    alice: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    stale = oauth._grant(conn, grant_of(first))
    winner = refresh(conn, config, first.refresh_token)
    monkeypatch.setattr(oauth, "_grant", lambda c, g: stale)
    with pytest.raises(InvalidGrant) as refused:
        refresh(conn, config, first.refresh_token)
    assert (refused.value.reason, refused.value.ended) == ("busy", False)
    monkeypatch.undo()
    assert alive(conn, config, refresh(conn, config, winner.refresh_token))


def test_two_threads_refreshing_at_once_get_one_pair(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    results: list[oauth.Issued] = []
    start = threading.Barrier(4)

    def twin() -> None:
        c = connect(config.db_path)
        try:
            start.wait()
            results.append(refresh(c, config, first.refresh_token))
        finally:
            c.close()

    threads = [threading.Thread(target=twin) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 4
    assert len({(r.access_token, r.refresh_token) for r in results}) == 1
    assert conn.execute("SELECT generation FROM oauth_grants").fetchone()[0] == 2


def test_a_retired_refresh_token_after_the_grace_ends_the_grant(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
    caplog: pytest.LogCaptureFixture,
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    second = refresh(conn, config, first.refresh_token)
    clock.advance(61)
    with (
        caplog.at_level(logging.WARNING, logger="tracker_api.oauth"),
        pytest.raises(InvalidGrant) as refused,
    ):
        refresh(conn, config, first.refresh_token)
    assert (refused.value.reason, refused.value.ended) == ("reuse", True)
    assert "retired refresh token was reused" in caplog.text
    assert first.refresh_token.split(".")[1] not in caplog.text
    assert not alive(conn, config, second)
    with pytest.raises(InvalidGrant):
        refresh(conn, config, second.refresh_token)
    assert grants(conn) == 0
    for table in ("oauth_access", "oauth_codes", "oauth_retired"):
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608


def test_the_sweep_clears_the_grace_copy_once_the_grace_is_over(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    """The sealed copy of the live pair opens with the replaced token; past the grace, a database
    copy plus that old token must not yield the live pair, so the copy goes."""
    first = connect_claude(conn, config, resolver, alice)
    second = refresh(conn, config, first.refresh_token)
    oauth.sweep(conn, config)
    held = conn.execute("SELECT grace_pair FROM oauth_grants").fetchone()[0]
    assert held is not None  # still inside the grace: a racing twin needs it
    clock.advance(61)
    oauth.sweep(conn, config)
    row = conn.execute(
        "SELECT grace_pair, prev_refresh_hash, grace_until FROM oauth_grants"
    ).fetchone()
    assert tuple(row) == (None, None, None)
    # The live pair still works, and the old token still ends the grant as a reuse.
    third = refresh(conn, config, second.refresh_token)
    assert alive(conn, config, third)
    with pytest.raises(InvalidGrant) as refused:
        refresh(conn, config, first.refresh_token)
    assert (refused.value.reason, refused.value.ended) == ("reuse", True)


def test_an_older_retired_token_ends_the_grant_even_inside_a_later_grace(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    second = refresh(conn, config, first.refresh_token)
    refresh(conn, config, second.refresh_token)  # the grace now belongs to `second`
    with pytest.raises(InvalidGrant) as refused:
        refresh(conn, config, first.refresh_token)
    assert (refused.value.reason, refused.value.ended) == ("reuse", True)


def test_a_guessed_refresh_token_ends_nothing(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    issued = connect_claude(conn, config, resolver, alice)
    grant = grant_of(issued)
    guesses = [
        f"tkr_{grant}.{secrets.token_urlsafe(32)}",  # a real grant, a wrong secret
        f"tkr_{secrets.token_hex(16)}.{secrets.token_urlsafe(32)}",  # no such grant
        f"tkr_{grant}",
        f"tkr_{grant}.short",
        issued.access_token,
        "trk_" + issued.refresh_token[4:],
        "",
        NOT_A_STRING,
    ]
    for guess in guesses * 5:  # no throttle: guesses cost the real client nothing
        with pytest.raises(InvalidGrant) as refused:
            refresh(conn, config, guess)
        assert not refused.value.ended
    assert alive(conn, config, refresh(conn, config, issued.refresh_token))


def test_wrong_secrets_are_logged_at_most_once_a_minute_per_grant(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
    caplog: pytest.LogCaptureFixture,
) -> None:
    issued = connect_claude(conn, config, resolver, alice)
    grant = grant_of(issued)
    guess = f"tkr_{grant}.{secrets.token_urlsafe(32)}"
    with caplog.at_level(logging.WARNING, logger="tracker_api.oauth"):
        for _ in range(3):
            with pytest.raises(InvalidGrant, match="invalid grant"):
                refresh(conn, config, guess)
        warnings = [r.getMessage() for r in caplog.records]
        assert warnings == [f"oauth grant {grant}: a refresh presented a wrong secret"]
        # An unknown grant id is noise anyone can make: never logged.
        with pytest.raises(InvalidGrant):
            refresh(conn, config, f"tkr_{secrets.token_hex(16)}.{secrets.token_urlsafe(32)}")
        assert len(caplog.records) == 1
        clock.advance(60)
        oauth.sweep(conn, config)  # reports the stopped burst's count
        assert caplog.records[-1].getMessage() == (
            f"oauth grant {grant}: a refresh presented a wrong secret"
            " (2 more since the last report)"
        )
        clock.advance(60)
        oauth.sweep(conn, config)  # quiet now: forgotten, nothing more said
        assert len(caplog.records) == 2
    assert guess.split(".")[1] not in caplog.text


@pytest.mark.parametrize(
    "change",
    [{"client_id": CLAUDE_CODE}, {"resource": "https://elsewhere.example/api/mcp"}],
)
def test_a_refresh_for_another_client_or_resource_is_refused_and_ends_nothing(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    alice: int,
    change: dict[str, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    second = refresh(conn, config, first.refresh_token)
    for token in (second.refresh_token, first.refresh_token):  # current, and retired in grace
        with pytest.raises(InvalidGrant) as refused:
            refresh(conn, config, token, **change)
        assert not refused.value.ended
        assert refused.value.reason in ("client", "resource")
    if "resource" in change:
        assert change["resource"] in caplog.text and RESOURCE in caplog.text
    assert alive(conn, config, refresh(conn, config, second.refresh_token))


def test_a_refresh_with_its_access_token_revoked_inside_the_grace_is_refused(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    winner = refresh(conn, config, first.refresh_token)
    oauth.revoke(conn, config, winner.access_token)
    with pytest.raises(InvalidGrant) as refused:  # never hands back a revoked token
        refresh(conn, config, first.refresh_token)
    assert (refused.value.reason, refused.value.ended) == ("unknown", False)
    assert alive(conn, config, refresh(conn, config, winner.refresh_token))


@pytest.mark.parametrize("blob", [b"\x00" * 64, b"short", None])
def test_an_edited_grace_copy_is_refused_and_logged(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    alice: int,
    blob: bytes | None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    second = refresh(conn, config, first.refresh_token)
    conn.execute("UPDATE oauth_grants SET grace_pair = ?", (blob,))
    with pytest.raises(InvalidGrant) as refused:
        refresh(conn, config, first.refresh_token)
    assert (refused.value.reason, refused.value.ended) == ("tamper", False)
    assert "integrity check" in caplog.text
    assert alive(conn, config, refresh(conn, config, second.refresh_token))


def test_a_disabled_account_cannot_refresh(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    issued = connect_claude(conn, config, resolver, alice)
    conn.execute("UPDATE users SET disabled = 1 WHERE id = ?", (alice,))
    with pytest.raises(InvalidGrant) as refused:
        refresh(conn, config, issued.refresh_token)
    assert refused.value.reason == "disabled"
    assert oauth.access_user(conn, config, issued.access_token) is None


# ------------------------------------------------------------ lifetimes


def test_a_connection_ends_90_days_after_approval_however_used(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    approved = clock()
    issued = connect_claude(conn, config, resolver, alice)
    for _ in range(89):
        clock.advance(DAY)
        issued = refresh(conn, config, issued.refresh_token)
    assert clock() == approved + 89 * DAY
    assert oauth.list_grants(conn, config, alice)[0].expires_at == approved + 90 * DAY
    clock.advance(DAY)
    with pytest.raises(InvalidGrant) as refused:
        refresh(conn, config, issued.refresh_token)
    assert (refused.value.reason, refused.value.ended) == ("expired", True)
    assert grants(conn) == 0


def test_an_access_token_never_outlives_its_grant(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    approved = clock()
    issued = connect_claude(conn, config, resolver, alice)
    clock.now = approved + 90 * DAY - 600
    last = refresh(conn, config, issued.refresh_token)
    assert last.expires_in == 600
    who = oauth.access_user(conn, config, last.access_token)
    assert who is not None and who.expires_at == approved + 90 * DAY
    clock.advance(599)
    assert alive(conn, config, last)
    clock.advance(1)
    assert not alive(conn, config, last)


def test_an_access_token_lasts_an_hour_on_the_configured_clock(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    issued = connect_claude(conn, config, resolver, alice)
    clock.advance(3599)
    assert alive(conn, config, issued)
    clock.advance(1)
    assert not alive(conn, config, issued)


@pytest.mark.parametrize(
    "token", ["", "tka_", "tka_" + "a" * 42, "tka_" + "a" * 44, "trk_" + "a" * 43, None, 7]
)
def test_access_lookup_never_raises_on_what_a_client_sends(
    conn: sqlite3.Connection, config: Config, token: Any
) -> None:
    assert oauth.access_user(conn, config, token) is None
    assert oauth.access_user(conn, config, "tka_" + "a" * 43) is None


def test_last_used_moves_at_most_once_a_minute(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    issued = connect_claude(conn, config, resolver, alice)
    redeemed = clock()

    def last_used() -> int | None:
        return oauth.list_grants(conn, config, alice)[0].last_used_at

    assert last_used() == redeemed
    clock.advance(60)
    oauth.access_user(conn, config, issued.access_token)
    assert last_used() == redeemed
    clock.advance(1)
    oauth.access_user(conn, config, issued.access_token)
    assert last_used() == redeemed + 61


# ------------------------------------------------------------ requests and approval


def test_a_request_holds_what_the_consent_screen_shows_for_10_minutes(
    conn: sqlite3.Connection, config: Config, clock: Clock, resolver: oauth.ClientResolver
) -> None:
    _, challenge = pkce()
    client = resolver.check(CLAUDE_CODE, "http://127.0.0.1:53123/callback")
    rid = oauth.create_request(
        conn,
        config,
        client,
        redirect_uri="http://127.0.0.1:53123/callback",
        code_challenge=challenge,
        resource=RESOURCE,
        scope=None,
        state=None,
    )
    pending = oauth.get_request(conn, config, rid)
    assert pending == oauth.PendingRequest(
        client_id=CLAUDE_CODE,
        client_name="Claude Code",
        client_host="claude.ai",
        redirect_uri="http://127.0.0.1:53123/callback",
        redirect_host="127.0.0.1",
        scope=None,
        state=None,
        resource=RESOURCE,
        expires_at=clock() + 600,
    )
    assert rid not in "\n".join(conn.iterdump())  # stored hashed
    clock.advance(599)
    assert oauth.get_request(conn, config, rid) is not None
    clock.advance(1)
    assert oauth.get_request(conn, config, rid) is None
    assert oauth.get_request(conn, config, "nonsense") is None
    assert oauth.get_request(conn, config, NOT_A_STRING) is None


def test_a_request_refuses_a_redirect_its_client_did_not_register(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver
) -> None:
    client = resolver.resolve(CLAUDE_AI)
    with pytest.raises(ClientRefused) as refused:
        oauth.create_request(
            conn,
            config,
            client,
            redirect_uri="https://evil.example/cb",
            code_challenge=pkce()[1],
            resource=RESOURCE,
            scope=None,
            state=None,
        )
    assert refused.value.reason == "redirect"


def test_pending_requests_are_capped(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`/authorize` needs no sign-in, so the table of pending requests is bounded."""
    monkeypatch.setattr(oauth, "MAX_REQUESTS", 2)
    client = resolver.resolve(CLAUDE_AI)

    def request() -> str:
        return oauth.create_request(
            conn,
            config,
            client,
            redirect_uri=CLAUDE_AI_REDIRECT,
            code_challenge=pkce()[1],
            resource=RESOURCE,
            scope=None,
            state=None,
        )

    request(), request()
    with pytest.raises(AuthError, match="busy") as refused:
        request()
    assert refused.value.retry_after == 60
    clock.advance(600)  # the old ones lapse and are swept
    assert oauth.get_request(conn, config, request()) is not None


def test_approving_or_denying_uses_the_request_up(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    def request() -> str:
        client = resolver.resolve(CLAUDE_AI)
        return oauth.create_request(
            conn,
            config,
            client,
            redirect_uri=CLAUDE_AI_REDIRECT,
            code_challenge=pkce()[1],
            resource=RESOURCE,
            scope="read",
            state="s",
        )

    rid = request()
    oauth.approve(conn, config, rid, alice, write=False)
    with pytest.raises(AuthError, match="no-request"):
        oauth.approve(conn, config, rid, alice, write=False)
    rid = request()
    denied = oauth.deny_request(conn, config, rid)
    assert (denied.redirect_uri, denied.state) == (CLAUDE_AI_REDIRECT, "s")
    for act in (
        lambda: oauth.deny_request(conn, config, rid),
        lambda: oauth.approve(conn, config, rid, alice, write=True),
    ):
        with pytest.raises(AuthError, match="no-request"):
            act()


def test_approval_refuses_a_disabled_or_missing_account(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    auth.set_disabled(conn, "alice@example.com", True)
    with pytest.raises(AuthError, match="disabled"):
        approve(conn, config, resolver, alice)
    with pytest.raises(AuthError, match="no-user"):
        approve(conn, config, resolver, alice + 99)


def test_approval_needs_no_password_hash_under_the_write_lock(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    alice: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The password is checked by `auth.login` before `approve` (W4), outside any transaction:
    approve itself never touches the hasher."""

    def no_hashing() -> None:
        raise AssertionError("approve hashed a password")

    monkeypatch.setattr(auth, "_hashing", no_hashing)
    assert alive(conn, config, connect_claude(conn, config, resolver, alice))


# ------------------------------------------------------------ the CIMD client


def test_claude_ai_and_claude_code_resolve(resolver: oauth.ClientResolver) -> None:
    web = resolver.resolve(CLAUDE_AI)
    assert (web.client_id, web.name, web.host) == (CLAUDE_AI, "Claude", "claude.ai")
    assert web.redirect_uris == (CLAUDE_AI_REDIRECT,)
    code = resolver.resolve(CLAUDE_CODE)
    assert (code.name, code.host) == ("Claude Code", "claude.ai")


def test_chatgpt_resolves_as_a_public_client(resolver: oauth.ClientResolver) -> None:
    """Its singular method is `private_key_jwt`, but its list holds `none`, the one method this
    server accepts, so it signs in without a secret like Claude does."""
    chatgpt = resolver.resolve(CHATGPT)
    assert (chatgpt.client_id, chatgpt.name, chatgpt.host) == (CHATGPT, "ChatGPT", "chatgpt.com")
    assert chatgpt.redirect_uris == (CHATGPT_REDIRECT,)
    assert oauth.redirect_allowed(chatgpt, CHATGPT_REDIRECT)
    assert not oauth.redirect_allowed(chatgpt, "https://chatgpt.com/connector/oauth/abc")


@pytest.mark.parametrize(
    "methods",
    [
        {"token_endpoint_auth_method": "none"},
        {"token_endpoint_auth_method": "none", "token_endpoint_auth_methods_supported": ["none"]},
        {"token_endpoint_auth_methods_supported": ["none"]},
        {"token_endpoint_auth_methods_supported": ["private_key_jwt", "none"]},
        {
            "token_endpoint_auth_method": "client_secret_basic",
            "token_endpoint_auth_methods_supported": ["client_secret_basic", "none"],
        },
    ],
)
def test_a_document_that_can_use_none_is_a_public_client(
    resolver: oauth.ClientResolver, stub: StubFetch, methods: dict[str, Any]
) -> None:
    body = {k: v for k, v in CHATGPT_DOC.items() if not k.startswith("token_endpoint_auth_method")}
    stub.docs[CHATGPT] = doc(body | methods)
    assert resolver.resolve(CHATGPT).name == "ChatGPT"


@pytest.mark.parametrize(
    "client_id",
    [
        "http://claude.ai/oauth/mcp-oauth-client-metadata",
        "https://evil.example/oauth/mcp-oauth-client-metadata",
        "https://claude.ai.evil.example/oauth/x",
        "https://evil.claude.ai/oauth/x",
        "https://claude.ai:8443/oauth/x",
        "https://user@claude.ai/oauth/x",
        "https://claude.ai/oauth/x?a=1",
        "https://claude.ai/oauth/x#frag",
        "https://claude.ai",
        "https://claude.ai/",
        "https://claude.ai/oauth/../x",
        "https://claude.ai/oauth/./x",
        "https://claude.ai/oauth/x ",
        "https://claude.ai/oauth/\nx",
        "https://claude.ai/" + "a" * 300,
        "family-finances-claude",
        "",
    ],
)
def test_a_client_off_the_allow_list_is_refused_without_a_fetch(
    resolver: oauth.ClientResolver, stub: StubFetch, client_id: str
) -> None:
    with pytest.raises(ClientRefused) as refused:
        resolver.resolve(client_id)
    assert refused.value.reason == "client-id"
    assert stub.calls == []


def test_the_allowed_hosts_are_a_setting(config: Config, stub: StubFetch) -> None:
    other = "https://claude.com/oauth/mcp-oauth-client-metadata"
    stub.docs[other] = doc(CLAUDE_AI_DOC | {"client_id": other})
    assert oauth.ClientResolver(("claude.com",), config.clock, stub).resolve(other).host == (
        "claude.com"
    )
    only_com = oauth.ClientResolver(("claude.com",), config.clock, stub)
    with pytest.raises(ClientRefused):
        only_com.resolve(CLAUDE_AI)


def test_config_reads_the_allowed_hosts(config: Config) -> None:
    assert config.oauth_client_hosts == ("claude.ai", "claude.com", "chatgpt.com")
    env = {"PUBLIC_ORIGIN": ORIGIN}
    assert Config.from_env(env).oauth_client_hosts == ("claude.ai", "claude.com", "chatgpt.com")
    parsed = Config.from_env(env | {"OAUTH_CLIENT_HOSTS": " Claude.ai , example.org ,"})
    assert parsed.oauth_client_hosts == ("claude.ai", "example.org")
    for bad in ("claude.ai/x", "https://claude.ai", "*.claude.ai", " , "):
        with pytest.raises(ValueError, match="OAUTH_CLIENT_HOSTS"):
            Config.from_env(env | {"OAUTH_CLIENT_HOSTS": bad})


@pytest.mark.parametrize(
    ("answer", "reason"),
    [
        (Fetched(404, b""), "status"),
        (Fetched(302, b""), "status"),
        (doc(CLAUDE_AI_DOC, status=500), "status"),
        (Fetched(200, b"{" + b" " * 5120 + b"}"), "too-large"),
        (Fetched(200, b"<html>"), "document"),
        (Fetched(200, b"[1, 2]"), "document"),
        (Fetched(200, b"\xff\xfe"), "document"),
        (doc(CLAUDE_AI_DOC | {"client_id": CLAUDE_CODE}), "client-id-mismatch"),
        (doc({k: v for k, v in CLAUDE_AI_DOC.items() if k != "client_id"}), "client-id-mismatch"),
        (doc(CLAUDE_AI_DOC | {"token_endpoint_auth_method": "client_secret_basic"}), "auth"),
        (
            doc({k: v for k, v in CLAUDE_AI_DOC.items() if k != "token_endpoint_auth_method"}),
            "auth",
        ),
        (
            doc(
                CLAUDE_AI_DOC
                | {"token_endpoint_auth_methods": ["none"]}
                | {"token_endpoint_auth_method": None}
            ),
            "auth",
        ),
        (doc(CLAUDE_AI_DOC | {"token_endpoint_auth_method": "private_key_jwt"}), "auth"),
        (
            doc(
                CLAUDE_AI_DOC
                | {"token_endpoint_auth_method": "private_key_jwt"}
                | {"token_endpoint_auth_methods_supported": ["private_key_jwt"]}
            ),
            "auth",
        ),
        (doc(CLAUDE_AI_PREFERS_JWT | {"token_endpoint_auth_methods_supported": []}), "auth"),
        (doc(CLAUDE_AI_PREFERS_JWT | {"token_endpoint_auth_methods_supported": "none"}), "auth"),
        (
            doc(CLAUDE_AI_PREFERS_JWT | {"token_endpoint_auth_methods_supported": [None, "none"]}),
            "auth",
        ),
        (doc(CLAUDE_AI_DOC | {"redirect_uris": []}), "redirect-uris"),
        (doc(CLAUDE_AI_DOC | {"redirect_uris": "https://claude.ai/cb"}), "redirect-uris"),
        (doc(CLAUDE_AI_DOC | {"redirect_uris": [7]}), "redirect-uris"),
        (doc({k: v for k, v in CLAUDE_AI_DOC.items() if k != "redirect_uris"}), "redirect-uris"),
        (doc(CLAUDE_AI_DOC | {"grant_types": ["client_credentials"]}), "grant-types"),
        (doc(CLAUDE_AI_DOC | {"grant_types": "authorization_code"}), "grant-types"),
        (doc(CLAUDE_AI_DOC | {"response_types": ["token"]}), "response-types"),
    ],
)
def test_a_bad_document_is_refused_and_never_cached(
    resolver: oauth.ClientResolver,
    stub: StubFetch,
    answer: Fetched,
    reason: str,
) -> None:
    stub.docs[CLAUDE_AI] = answer
    for _ in range(2):
        with pytest.raises(ClientRefused) as refused:
            resolver.resolve(CLAUDE_AI)
        assert refused.value.reason == reason
    assert stub.calls == [CLAUDE_AI, CLAUDE_AI]
    stub.docs[CLAUDE_AI] = doc(CLAUDE_AI_DOC)
    assert resolver.resolve(CLAUDE_AI).name == "Claude"


def test_only_https_and_loopback_redirects_are_kept_from_a_document(
    resolver: oauth.ClientResolver, stub: StubFetch
) -> None:
    """The consent screen sends the browser to the redirect, so a document's `javascript:` or
    `data:` entry must never become one, even on an allowed host."""
    odd = [
        "javascript:alert(1)",
        "data:text/html,hi",
        "http://example.com/cb",
        "myapp:/cb",
        "https://[::1/cb",  # malformed: urlsplit raises
        "https:///cb",  # no host
    ]
    stub.docs[CLAUDE_AI] = doc(CLAUDE_AI_DOC | {"redirect_uris": [*odd, CLAUDE_AI_REDIRECT]})
    client = resolver.resolve(CLAUDE_AI)
    assert client.redirect_uris == (CLAUDE_AI_REDIRECT,)
    for uri in odd:
        assert not oauth.redirect_allowed(client, uri)


def test_a_document_with_no_safe_redirect_is_refused(
    resolver: oauth.ClientResolver, stub: StubFetch
) -> None:
    stub.docs[CLAUDE_AI] = doc(CLAUDE_AI_DOC | {"redirect_uris": ["javascript:alert(1)"]})
    with pytest.raises(ClientRefused) as refused:
        resolver.resolve(CLAUDE_AI)
    assert refused.value.reason == "redirect-uris"


def test_a_document_without_optional_lists_is_accepted(
    resolver: oauth.ClientResolver, stub: StubFetch
) -> None:
    bare = {k: v for k, v in CLAUDE_AI_DOC.items() if k not in ("grant_types", "response_types")}
    stub.docs[CLAUDE_AI] = doc(bare)
    assert resolver.resolve(CLAUDE_AI).redirect_uris == (CLAUDE_AI_REDIRECT,)


@pytest.mark.parametrize("name", [None, "", "   ", 7, "a" * 65, "Claude\x00", "Bad\nName"])
def test_a_client_without_a_fit_name_is_named_by_its_host(
    resolver: oauth.ClientResolver, stub: StubFetch, name: Any
) -> None:
    stub.docs[CLAUDE_AI] = doc(CLAUDE_AI_DOC | {"client_name": name})
    assert resolver.resolve(CLAUDE_AI).name == "claude.ai"


def test_an_unreachable_client_is_refused(config: Config) -> None:
    def down(url: str) -> Fetched:
        raise ClientRefused("unreachable")

    with pytest.raises(ClientRefused, match="unreachable"):
        oauth.ClientResolver(config.oauth_client_hosts, config.clock, down).resolve(CLAUDE_AI)


def test_a_good_document_is_cached_for_an_hour(
    resolver: oauth.ClientResolver, stub: StubFetch, clock: Clock
) -> None:
    resolver.resolve(CLAUDE_AI)
    clock.advance(3599)
    resolver.resolve(CLAUDE_AI)
    assert stub.calls == [CLAUDE_AI]
    clock.advance(1)
    resolver.resolve(CLAUDE_AI)
    assert stub.calls == [CLAUDE_AI, CLAUDE_AI]


def test_the_cache_is_bounded(config: Config, stub: StubFetch) -> None:
    resolver = oauth.ClientResolver(config.oauth_client_hosts, config.clock, stub)
    urls = [f"https://claude.ai/oauth/c{i}" for i in range(oauth.CACHE_SIZE + 1)]
    for url in urls:
        stub.docs[url] = doc(CLAUDE_AI_DOC | {"client_id": url})
        resolver.resolve(url)
    resolver.resolve(urls[-1])
    resolver.resolve(urls[0])  # the oldest went to make room
    assert stub.calls.count(urls[0]) == 2 and stub.calls.count(urls[-1]) == 1


@pytest.mark.parametrize(
    ("client_id", "redirect", "ok"),
    [
        (CLAUDE_AI, CLAUDE_AI_REDIRECT, True),
        (CLAUDE_AI, CLAUDE_AI_REDIRECT + "/", False),
        (CLAUDE_AI, CLAUDE_AI_REDIRECT + "?x=1", False),
        (CLAUDE_AI, "https://claude.ai:443/api/mcp/auth_callback", False),
        (CLAUDE_AI, "https://evil.example/api/mcp/auth_callback", False),
        (CLAUDE_AI, "http://localhost/callback", False),
        (CLAUDE_CODE, "http://localhost/callback", True),
        (CLAUDE_CODE, "http://localhost:53123/callback", True),
        (CLAUDE_CODE, "http://127.0.0.1:1/callback", True),
        (CLAUDE_CODE, "http://127.0.0.1:65535/callback", True),
        (CLAUDE_CODE, "http://LOCALHOST:8080/callback", True),
        (CLAUDE_CODE, "http://localhost:8080/other", False),
        (CLAUDE_CODE, "http://localhost:8080/callback?x=1", False),
        (CLAUDE_CODE, "http://localhost:8080/callback#x", False),
        (CLAUDE_CODE, "https://localhost:8080/callback", False),
        (CLAUDE_CODE, "http://localhost.evil.example:8080/callback", False),
        (CLAUDE_CODE, "http://localhost@evil.example:8080/callback", False),
        (CLAUDE_CODE, "http://user@localhost:8080/callback", False),
        (CLAUDE_CODE, "http://localhost:99999/callback", False),
        (CLAUDE_CODE, "http://localhost:x/callback", False),
        (CLAUDE_CODE, "http://[::1]:8080/callback", False),  # not registered
        (CLAUDE_CODE, "http://192.168.1.2:8080/callback", False),
        (CLAUDE_CODE, "http://[bad/callback", False),
        (CLAUDE_CODE, "http://localhost:8080/call\nback", False),  # urlsplit drops the \n
        (CLAUDE_CODE, "http://localhost:8080/call\tback", False),
        (CLAUDE_CODE, "http://localhost:8080/callback ", False),
        (CLAUDE_AI, CLAUDE_AI_REDIRECT + "#", False),
    ],
)
def test_a_redirect_is_an_exact_member_or_loopback_on_any_port(
    resolver: oauth.ClientResolver, client_id: str, redirect: str, ok: bool
) -> None:
    client = resolver.resolve(client_id)
    assert oauth.redirect_allowed(client, redirect) is ok
    if ok:
        assert resolver.check(client_id, redirect) == client
    else:
        with pytest.raises(ClientRefused) as refused:
            resolver.check(client_id, redirect)
        assert refused.value.reason == "redirect"


# ------------------------------------------------ the real fetch, against a local server


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/doc":
            body = json.dumps(CLAUDE_AI_DOC).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/moved":
            self.send_response(302)
            self.send_header("Location", "/doc")
            self.end_headers()
        elif self.path == "/huge":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"x" * 100_000)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        pass


@pytest.fixture
def local_server() -> Iterator[str]:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join()


def test_the_fetch_reads_a_document(local_server: str) -> None:
    fetched = oauth.fetch_document(f"{local_server}/doc")
    assert fetched.status == 200 and json.loads(fetched.body) == CLAUDE_AI_DOC


def test_the_fetch_follows_no_redirect(local_server: str) -> None:
    assert oauth.fetch_document(f"{local_server}/moved").status == 302
    assert oauth.fetch_document(f"{local_server}/missing").status == 404


def test_the_fetch_reads_no_more_than_the_cap(local_server: str) -> None:
    fetched = oauth.fetch_document(f"{local_server}/huge")
    assert fetched.status == 200 and len(fetched.body) == oauth.MAX_DOCUMENT + 1


def test_the_fetch_gives_up_on_a_slow_server(monkeypatch: pytest.MonkeyPatch) -> None:
    """A server that drips bytes is cut off at the deadline, not each read's timeout."""
    stop = threading.Event()

    class Drip(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.end_headers()
            while not stop.is_set():
                self.wfile.write(b" ")
                self.wfile.flush()
                stop.wait(0.05)

        def log_message(self, format: str, *args: Any) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Drip)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(oauth, "FETCH_TIMEOUT", 0.3)
    try:
        with pytest.raises(ClientRefused, match="unreachable"):
            oauth.fetch_document(f"http://127.0.0.1:{server.server_address[1]}/")
    finally:
        stop.set()
        server.shutdown()
        server.server_close()
        thread.join()


def test_the_fetch_refuses_an_unreachable_host() -> None:
    with pytest.raises(ClientRefused, match="unreachable"):
        oauth.fetch_document("http://127.0.0.1:9/nothing-listens-here")


# ------------------------------------------------------------ revocation (RFC 7009)


def test_revoking_a_refresh_token_ends_its_grant(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    issued = connect_claude(conn, config, resolver, alice)
    oauth.revoke(conn, config, issued.refresh_token)
    assert not alive(conn, config, issued) and grants(conn) == 0


def test_revoking_a_refresh_token_inside_its_grace_ends_the_grant(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    second = refresh(conn, config, first.refresh_token)
    oauth.revoke(conn, config, first.refresh_token)
    assert not alive(conn, config, second) and grants(conn) == 0


def test_revoking_a_retired_refresh_token_ends_the_grant(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
    caplog: pytest.LogCaptureFixture,
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    second = refresh(conn, config, first.refresh_token)
    clock.advance(61)
    with caplog.at_level(logging.WARNING, logger="tracker_api.oauth"):
        oauth.revoke(conn, config, first.refresh_token)
    assert "retired refresh token was revoked" in caplog.text
    assert not alive(conn, config, second) and grants(conn) == 0


def test_revoking_an_access_token_ends_only_that_token(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    """As finances: an access token is one session; its refresh token still renews."""
    first = connect_claude(conn, config, resolver, alice)
    second = refresh(conn, config, first.refresh_token)
    oauth.revoke(conn, config, first.access_token)
    assert not alive(conn, config, first) and alive(conn, config, second)
    assert alive(conn, config, refresh(conn, config, second.refresh_token))


def test_revoking_a_guess_or_garbage_changes_nothing(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    alice: int,
    caplog: pytest.LogCaptureFixture,
) -> None:
    issued = connect_claude(conn, config, resolver, alice)
    grant = grant_of(issued)
    with caplog.at_level(logging.WARNING, logger="tracker_api.oauth"):
        for token in (
            f"tkr_{grant}.{secrets.token_urlsafe(32)}",
            f"tkr_{secrets.token_hex(16)}.{secrets.token_urlsafe(32)}",
            "tka_" + "a" * 43,
            "trk_" + "a" * 43,
            "nonsense",
            "",
            NOT_A_STRING,
        ):
            oauth.revoke(conn, config, token)
    assert "wrong secret" in caplog.text  # the guess at a real grant is seen
    assert alive(conn, config, issued)
    assert alive(conn, config, refresh(conn, config, issued.refresh_token))


# ------------------------------------------------------------ Settings, caps and the sweep


def test_listing_shows_a_users_live_connections(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    bob = make_user(conn, config, "bob@example.com")
    first_at = clock()
    web = connect_claude(conn, config, resolver, alice, write=True)
    clock.advance(DAY)
    code = connect_claude(
        conn,
        config,
        resolver,
        alice,
        client_id=CLAUDE_CODE,
        redirect_uri="http://localhost:4242/callback",
    )
    connect_claude(conn, config, resolver, bob)
    approve(conn, config, resolver, alice)  # approved, never redeemed: not a connection yet
    listed = oauth.list_grants(conn, config, alice)
    assert listed == [
        oauth.GrantInfo(
            grant_id=grant_of(code),
            client_id=CLAUDE_CODE,
            client_name="Claude Code",
            client_host="claude.ai",
            scope="read",
            created_at=first_at + DAY,
            last_used_at=first_at + DAY,
            expires_at=first_at + DAY + 90 * DAY,
            is_new=True,
        ),
        oauth.GrantInfo(
            grant_id=grant_of(web),
            client_id=CLAUDE_AI,
            client_name="Claude",
            client_host="claude.ai",
            scope="write",
            created_at=first_at,
            last_used_at=first_at,
            expires_at=first_at + 90 * DAY,
            is_new=False,  # exactly 24 hours old
        ),
    ]


def test_a_user_removes_their_own_connection_only(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    bob = make_user(conn, config, "bob@example.com")
    mine = connect_claude(conn, config, resolver, alice)
    bobs = connect_claude(conn, config, resolver, bob)
    with pytest.raises(AuthError, match="no-connection"):
        oauth.remove_grant(conn, alice, grant_of(bobs))
    with pytest.raises(AuthError, match="no-connection"):
        oauth.remove_grant(conn, alice, "nonsense")
    assert alive(conn, config, bobs)
    oauth.remove_grant(conn, alice, grant_of(mine))
    assert not alive(conn, config, mine)
    with pytest.raises(InvalidGrant):
        refresh(conn, config, mine.refresh_token)
    assert oauth.list_grants(conn, config, alice) == []


def test_a_user_holds_at_most_10_connections(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    bob = make_user(conn, config, "bob@example.com")
    held = [connect_claude(conn, config, resolver, alice) for _ in range(9)]
    pending = approve(conn, config, resolver, alice)  # an approval waiting on its code counts
    with pytest.raises(AuthError, match="too-many-connections"):
        approve(conn, config, resolver, alice)
    assert alive(conn, config, connect_claude(conn, config, resolver, bob))  # others unaffected
    clock.advance(60)  # the unredeemed approval is dead now, so it frees its place
    assert alive(conn, config, connect_claude(conn, config, resolver, alice))
    with pytest.raises(AuthError, match="too-many-connections"):
        approve(conn, config, resolver, alice)
    oauth.remove_grant(conn, alice, grant_of(held[0]))
    approve(conn, config, resolver, alice)
    listed = {g.grant_id for g in oauth.list_grants(conn, config, alice)}
    assert len(listed) == 9 and pending.approval.grant_id not in listed


def test_a_limit_of_none_is_uncapped(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    for _ in range(oauth.MAX_GRANTS + 1):
        client = resolver.resolve(CLAUDE_AI)
        rid = oauth.create_request(
            conn,
            config,
            client,
            redirect_uri=CLAUDE_AI_REDIRECT,
            code_challenge=pkce()[1],
            resource=RESOURCE,
            scope=None,
            state=None,
        )
        oauth.approve(conn, config, rid, alice, write=False, limit=None)
    assert grants(conn) == oauth.MAX_GRANTS + 1


def test_the_sweep_removes_what_has_expired(
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    resolver: oauth.ClientResolver,
    alice: int,
) -> None:
    kept = connect_claude(conn, config, resolver, alice)
    old = connect_claude(conn, config, resolver, alice)
    approve(conn, config, resolver, alice)  # its code will lapse
    client = resolver.resolve(CLAUDE_AI)
    oauth.create_request(
        conn,
        config,
        client,
        redirect_uri=CLAUDE_AI_REDIRECT,
        code_challenge=pkce()[1],
        resource=RESOURCE,
        scope=None,
        state=None,
    )
    oauth.remove_grant(conn, alice, grant_of(old))
    clock.advance(3600)
    kept = refresh(conn, config, kept.refresh_token)
    assert oauth.sweep(conn, config) == 1  # the unredeemed grant
    counts = {
        t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]  # noqa: S608
        for t in ("oauth_requests", "oauth_grants", "oauth_codes", "oauth_access")
    }
    # The lapsed request and codes, and the access token from before the refresh, went too.
    assert counts == {"oauth_requests": 0, "oauth_grants": 1, "oauth_codes": 0, "oauth_access": 1}
    clock.advance(90 * DAY)
    assert oauth.sweep(conn, config) == 1
    assert grants(conn) == 0


# ------------------------------------------------------------ ending every credential (D7)


def _reset(conn: sqlite3.Connection, config: Config) -> None:
    link = auth.mint_link(conn, config, "reset", "alice@example.com")
    auth.redeem(conn, config, link, "a brand new password")


def _mailed_reset(conn: sqlite3.Connection, config: Config) -> None:
    link = auth.mint_link(conn, config, "reset", "alice@example.com", mailed=True)
    auth.redeem(conn, config, link, "a brand new password")


def _disable(conn: sqlite3.Connection, config: Config) -> None:
    auth.set_disabled(conn, "alice@example.com", True)
    auth.set_disabled(conn, "alice@example.com", False)  # enabling again brings nothing back


def _revoke_sessions(conn: sqlite3.Connection, config: Config) -> None:
    assert auth.revoke_sessions(conn, "alice@example.com") == (1, 1, 2)


@pytest.mark.parametrize("action", [_reset, _mailed_reset, _disable, _revoke_sessions])
def test_a_reset_disable_or_revoke_sessions_ends_every_connection(
    conn: sqlite3.Connection,
    config: Config,
    resolver: oauth.ClientResolver,
    alice: int,
    action: Any,
) -> None:
    bob = make_user(conn, config, "bob@example.com")
    auth.create_session(conn, config, alice)
    token = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    mine = [
        connect_claude(conn, config, resolver, alice),
        connect_claude(conn, config, resolver, alice, write=True),
    ]
    bobs = connect_claude(conn, config, resolver, bob)
    action(conn, config)
    assert auth.token_user(conn, config, token) is None
    for issued in mine:
        assert not alive(conn, config, issued)
        with pytest.raises(InvalidGrant):
            refresh(conn, config, issued.refresh_token)
    assert oauth.list_grants(conn, config, alice) == []
    assert alive(conn, config, bobs)  # someone else's connection is not touched


def test_end_credentials_counts_what_it_ended(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    connect_claude(conn, config, resolver, alice)
    assert auth.end_credentials(conn, alice) == (1, 1)
    assert auth.end_credentials(conn, alice) == (0, 0)


def test_revoke_sessions_on_the_command_line_names_connections(
    config: Config,
    conn: sqlite3.Connection,
    resolver: oauth.ClientResolver,
    alice: int,
    capsys: pytest.CaptureFixture[str],
) -> None:
    connect_claude(conn, config, resolver, alice)
    connect_claude(conn, config, resolver, alice)
    env = {"DATA_DIR": str(config.data_dir), "PUBLIC_ORIGIN": ORIGIN}
    assert main(["revoke-sessions", "alice@example.com"], env, clock=Clock()) == 0
    assert capsys.readouterr().out.strip() == (
        "Ended 0 sessions and revoked 0 tokens and 2 connections for alice@example.com."
    )


def test_deleting_a_user_takes_every_oauth_row(
    conn: sqlite3.Connection, config: Config, resolver: oauth.ClientResolver, alice: int
) -> None:
    first = connect_claude(conn, config, resolver, alice)
    refresh(conn, config, first.refresh_token)
    approve(conn, config, resolver, alice)
    conn.execute("DELETE FROM users WHERE id = ?", (alice,))
    for table in ("oauth_grants", "oauth_codes", "oauth_access", "oauth_retired"):
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608
