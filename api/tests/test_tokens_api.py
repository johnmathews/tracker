"""Self-service personal tokens over REST: /api/tokens, for the signed-in user only."""

import re
import sqlite3
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api import auth
from tracker_api.app import create_app
from tracker_api.config import Config

from .conftest import ORIGIN, Clock
from .test_api import other_client, sign_up
from .test_mcp import INITIALIZE, call, result

ALICE = "alice@example.com"
BOB = "bob@example.com"
INFO_KEYS = {"name", "prefix", "scope", "createdAt", "lastUsedAt"}


def make(client: TestClient, name: str = "laptop", scope: str = "read") -> Any:
    return client.post("/api/tokens", json={"name": name, "scope": scope})


def drop(client: TestClient, prefix: str, **kwargs: Any) -> Any:
    """DELETE with the JSON content type the REST guard requires of every write."""
    headers = {"Content-Type": "application/json", **kwargs.pop("headers", {})}
    return client.delete(f"/api/tokens/{prefix}", headers=headers, **kwargs)


def listed(client: TestClient) -> list[dict[str, Any]]:
    r = client.get("/api/tokens")
    assert r.status_code == 200, r.text
    return r.json()["tokens"]  # type: ignore[no-any-return]


@pytest.fixture
def alice(client: TestClient, config: Config) -> TestClient:
    sign_up(client, config, ALICE)
    return client


@pytest.fixture
def bob(config: Config) -> TestClient:
    c = other_client(config)
    sign_up(c, config, BOB)
    return c


def test_a_signed_in_user_can_create_a_token(alice: TestClient) -> None:
    # The first test written: before this change no REST route made a token (404/405).
    r = make(alice)
    assert r.status_code == 201, r.text


def test_create_returns_the_plaintext_once_with_its_info(alice: TestClient, config: Config) -> None:
    r = make(alice, "  my laptop ", "write")
    assert r.status_code == 201
    body = r.json()
    assert set(body) == {"token", "info"}
    assert re.fullmatch(r"trk_[A-Za-z0-9_-]{43}", body["token"])
    info = body["info"]
    assert set(info) == INFO_KEYS
    assert info["name"] == "my laptop"
    assert info["scope"] == "write"
    assert info["prefix"] == body["token"][4:12]
    assert info["createdAt"] == config.clock()
    assert info["lastUsedAt"] is None


def test_the_plaintext_appears_only_in_the_create_response(alice: TestClient) -> None:
    token = make(alice).json()["token"]
    r = alice.get("/api/tokens")
    assert r.status_code == 200
    assert token not in r.text
    assert token[12:] not in r.text
    assert auth.token_hash(token) not in r.text
    assert [set(t) for t in r.json()["tokens"]] == [INFO_KEYS]


def test_list_is_oldest_first(alice: TestClient, clock: Clock) -> None:
    for name in ["one", "two", "three"]:
        make(alice, name)
        clock.advance(5)
    assert [t["name"] for t in listed(alice)] == ["one", "two", "three"]


def test_list_is_empty_for_a_new_user(alice: TestClient) -> None:
    assert alice.get("/api/tokens").json() == {"tokens": []}


def test_users_see_and_revoke_only_their_own(alice: TestClient, bob: TestClient) -> None:
    mine = make(alice, "mine").json()["info"]["prefix"]
    theirs = make(bob, "theirs").json()["info"]["prefix"]
    assert [t["name"] for t in listed(alice)] == ["mine"]
    assert [t["name"] for t in listed(bob)] == ["theirs"]

    r = drop(alice, f"{theirs}")
    assert (r.status_code, r.json()) == (404, {"error": "no-token"})
    assert [t["name"] for t in listed(bob)] == ["theirs"]

    assert drop(alice, f"{mine}").status_code == 204
    assert listed(alice) == []
    assert len(listed(bob)) == 1


def test_revoke_takes_the_prefix_bare_or_after_trk(alice: TestClient) -> None:
    first = make(alice, "a").json()["info"]["prefix"]
    second = make(alice, "b").json()["info"]["prefix"]
    assert drop(alice, f"{first}").status_code == 204
    assert drop(alice, f"trk_{second}").status_code == 204
    assert listed(alice) == []


def test_revoking_twice_or_an_unknown_prefix_is_404(alice: TestClient) -> None:
    prefix = make(alice).json()["info"]["prefix"]
    assert drop(alice, f"{prefix}").status_code == 204
    for p in [prefix, "nothing1", "x"]:
        r = drop(alice, f"{p}")
        assert (r.status_code, r.json()) == (404, {"error": "no-token"})


def test_the_21st_token_is_409_too_many(alice: TestClient) -> None:
    assert auth.MAX_TOKENS == 20
    for i in range(20):
        assert make(alice, f"t{i}").status_code == 201
    r = make(alice, "one too many")
    assert (r.status_code, r.json()) == (409, {"error": "too-many"})
    assert len(listed(alice)) == 20


def test_the_cap_is_per_user_and_frees_on_revoke(alice: TestClient, bob: TestClient) -> None:
    for i in range(auth.MAX_TOKENS):
        make(alice, f"t{i}")
    assert make(bob).status_code == 201
    drop(alice, f"{listed(alice)[0]['prefix']}")
    assert make(alice, "again").status_code == 201


def test_the_cli_path_is_not_capped(conn: sqlite3.Connection, config: Config) -> None:
    auth.signup(conn, config, ALICE, "correct horse battery")
    for i in range(auth.MAX_TOKENS + 1):
        auth.create_token(conn, config, ALICE, f"t{i}", "read")
    with pytest.raises(auth.AuthError) as e:
        auth.create_token(conn, config, ALICE, "x", "read", limit=auth.MAX_TOKENS)
    assert e.value.code == "too-many-tokens"


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "scope": "read"},
        {"name": "   ", "scope": "read"},
        {"name": "x" * 65, "scope": "read"},
        {"name": "tab\there", "scope": "read"},
    ],
)
def test_a_bad_name_is_400_token_name(alice: TestClient, body: dict[str, str]) -> None:
    r = alice.post("/api/tokens", json=body)
    assert (r.status_code, r.json()) == (400, {"error": "token-name"})


@pytest.mark.parametrize(
    "body",
    [
        {"name": "x"},
        {"scope": "read"},
        {"name": "x", "scope": "admin"},
        {"name": "x", "scope": None},
        {"name": 5, "scope": "read"},
        {"name": "x", "scope": "READ"},
    ],
)
def test_a_malformed_body_is_400_invalid(alice: TestClient, body: dict[str, Any]) -> None:
    r = alice.post("/api/tokens", json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})


def test_routes_need_a_session(client: TestClient) -> None:
    assert client.get("/api/tokens").status_code == 401
    assert make(client).status_code == 401
    assert drop(client, "abcd1234").status_code == 401


def test_a_token_cannot_stand_in_for_a_session(alice: TestClient, config: Config) -> None:
    token = make(alice).json()["token"]
    with TestClient(
        create_app(config, run_backups=False),
        base_url=ORIGIN,
        headers={"Origin": ORIGIN, "Authorization": f"Bearer {token}"},
    ) as bare:
        assert bare.get("/api/tokens").status_code == 401
        assert make(bare).status_code == 401


def test_x_expected_user_must_match(alice: TestClient) -> None:
    other = {"X-Expected-User": BOB}
    assert alice.get("/api/tokens", headers=other).status_code == 401
    r = alice.post("/api/tokens", json={"name": "x", "scope": "read"}, headers=other)
    assert r.status_code == 401
    assert alice.get("/api/tokens", headers={"X-Expected-User": ALICE.upper()}).status_code == 200


@pytest.mark.parametrize("origin", [None, "https://evil.example.com", "http://testserver"])
def test_writes_need_the_public_origin(alice: TestClient, origin: str | None) -> None:
    prefix = make(alice).json()["info"]["prefix"]
    alice.headers.pop("Origin")
    headers = {} if origin is None else {"Origin": origin}
    r = alice.post("/api/tokens", json={"name": "x", "scope": "read"}, headers=headers)
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    r = drop(alice, prefix, headers=headers)
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    alice.headers["Origin"] = ORIGIN
    assert len(listed(alice)) == 1


def test_create_needs_a_json_body(alice: TestClient) -> None:
    r = alice.post("/api/tokens", content="name=x&scope=read")
    assert r.status_code == 415


def test_a_created_token_calls_whoami_over_mcp(alice: TestClient, config: Config) -> None:
    token = make(alice, "agent", "write").json()["token"]
    with TestClient(create_app(config, run_backups=False), base_url=ORIGIN) as agent:
        assert result(call(agent, "initialize", INITIALIZE, token=token))
        who = result(call(agent, "tools/call", {"name": "whoami", "arguments": {}}, token=token))
        assert who["structuredContent"] == {"email": ALICE, "scope": "write"}
    # Its use shows in the list.
    assert listed(alice)[0]["lastUsedAt"] == config.clock()


def test_a_revoked_token_stops_working(alice: TestClient, config: Config) -> None:
    made = make(alice).json()
    drop(alice, f"{made['info']['prefix']}")
    with TestClient(create_app(config, run_backups=False), base_url=ORIGIN) as agent:
        assert call(agent, "initialize", INITIALIZE, token=made["token"]).status_code == 401
