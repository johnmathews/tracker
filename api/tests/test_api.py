"""The HTTP layer through FastAPI's TestClient, against a real SQLite file."""

import asyncio
import json
from collections.abc import MutableMapping
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api import auth, data
from tracker_api.app import create_app
from tracker_api.config import Config
from tracker_api.db import connect
from tracker_api.validate import MARKS, Mark

from .conftest import ORIGIN, Clock
from .fixtures import read_fixture

PASSWORD = "correct horse battery"
DAY = 86_400
WEEK = "2026-10-19"
PUSHUPS = {"id": "pu", "name": "Push-ups", "reps": 10, "target": 4}
QUOTA = 5 * 1024 * 1024


def invite(config: Config, name: str) -> str:
    conn = connect(config.db_path)
    try:
        return auth.mint_link(conn, config, "invite", name)
    finally:
        conn.close()


def sign_up(client: TestClient, config: Config, name: str = "alice@example.com") -> None:
    r = client.post(
        "/api/invites/redeem", json={"token": invite(config, name), "password": PASSWORD}
    )
    assert r.status_code == 200, r.text


def other_client(config: Config) -> TestClient:
    return TestClient(
        create_app(config, run_backups=False), base_url=ORIGIN, headers={"Origin": ORIGIN}
    )


# --- the write guard and error shapes -----------------------------------------------------------


def test_healthz(client: TestClient) -> None:
    r = client.get("/api/healthz")
    assert r.json() == {"ok": True}
    assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("origin", [None, "https://evil.itsa-pizza.com", "http://testserver"])
def test_writes_need_the_public_origin(client: TestClient, origin: str | None) -> None:
    headers = {} if origin is None else {"Origin": origin}
    client.headers.pop("Origin")
    r = client.post("/api/auth/login", json={"username": "a", "password": "b"}, headers=headers)
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    assert r.headers["cache-control"] == "no-store"


def test_writes_need_a_json_body(client: TestClient) -> None:
    r = client.post("/api/auth/login", content="username=a", headers={"Content-Type": "text/plain"})
    assert (r.status_code, r.json()) == (415, {"error": "content-type"})
    r = client.post(
        "/api/auth/login", content="{oops", headers={"Content-Type": "application/json"}
    )
    assert (r.status_code, r.json()) == (400, {"error": "json"})
    r = client.post(
        "/api/auth/login", content=b"\xff", headers={"Content-Type": "application/json"}
    )
    assert (r.status_code, r.json()) == (400, {"error": "json"})
    r = client.post("/api/auth/login", json=["a", "b"])
    assert (r.status_code, r.json()) == (400, {"error": "json"})
    r = client.post("/api/auth/login", json={"username": 1, "password": "b"})
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})


def test_bodies_over_a_mebibyte_are_refused(client: TestClient) -> None:
    big = json.dumps({"username": "a", "password": "x" * (1 << 20)})
    r = client.post("/api/auth/login", content=big, headers={"Content-Type": "application/json"})
    assert (r.status_code, r.json()) == (413, {"error": "too-large"})


def test_a_chunked_body_over_a_mebibyte_is_refused(client: TestClient) -> None:
    """No Content-Length to check up front, so the body's own size is checked after reading."""

    def chunks() -> Any:
        yield b'{"username": "a", "password": "'
        for _ in range(1100):
            yield b"x" * 1024
        yield b'"}'

    r = client.post(
        "/api/auth/login", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert (r.status_code, r.json()) == (413, {"error": "too-large"})


def test_a_chunked_body_stops_being_read_at_the_limit(config: Config) -> None:
    """Driven at the ASGI level: TestClient drains a streamed body before the app sees it."""
    app = create_app(config, run_backups=False)
    pulled = 0
    sent: list[MutableMapping[str, Any]] = []

    async def receive() -> dict[str, Any]:
        nonlocal pulled
        pulled += 1
        return {"type": "http.request", "body": b"x" * 1024, "more_body": pulled < 64 * 1024}

    async def send(message: MutableMapping[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": "/api/auth/login",
        "raw_path": b"/api/auth/login",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"origin", ORIGIN.encode()), (b"content-type", b"application/json")],
        "client": ("127.0.0.1", 1),
        "server": ("testserver", 443),
    }
    asyncio.run(app(scope, receive, send))
    assert sent[0]["status"] == 413
    assert pulled <= 1025  # stopped just past 1 MiB, not after all 64 MiB


def test_deeply_nested_json_is_a_400(client: TestClient) -> None:
    deep = "[" * 100_000 + "]" * 100_000
    r = client.post("/api/auth/login", content=deep, headers={"Content-Type": "application/json"})
    assert (r.status_code, r.json()) == (400, {"error": "json"})
    assert r.headers["cache-control"] == "no-store"


def test_a_busy_hasher_is_a_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def busy(*_: object) -> bool:
        raise auth.AuthError("busy", retry_after=1)

    monkeypatch.setattr(auth, "verify_password", busy)
    r = client.post("/api/auth/login", json={"username": "a", "password": PASSWORD})
    assert (r.status_code, r.json(), r.headers["retry-after"]) == (
        503,
        {"error": "busy", "retryAfter": 1},
        "1",
    )


def test_unknown_routes_and_methods(client: TestClient) -> None:
    assert client.get("/api/nope").json() == {"error": "not-found"}
    r = client.delete("/api/state", headers={"Content-Type": "application/json"})
    assert (r.status_code, r.json()) == (405, {"error": "method"})


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/auth/me"),
        ("GET", "/api/state"),
        ("GET", "/api/export"),
        ("PUT", f"/api/plans/exercise/{WEEK}"),
        ("PUT", f"/api/ticks/exercise/{WEEK}/pu/0"),
        ("PUT", "/api/settings"),
        ("POST", "/api/import"),
    ],
)
def test_data_endpoints_need_a_session(client: TestClient, method: str, path: str) -> None:
    r = client.request(method, path, json={})
    assert (r.status_code, r.json()) == (401, {"error": "auth"})


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/state"),
        ("GET", "/api/auth/me"),
        ("PUT", f"/api/plans/exercise/{WEEK}"),
        ("PUT", "/api/settings"),
    ],
)
def test_rest_refuses_a_bearer_token(
    client: TestClient, config: Config, method: str, path: str
) -> None:
    """A personal API token is for /api/mcp only (§3.1): REST reads the session cookie alone."""
    conn = connect(config.db_path)
    try:
        auth.signup(conn, config, "alice@example.com", PASSWORD)
        for scope in ("read", "write"):
            token = auth.create_token(conn, config, "alice@example.com", scope, scope)
            headers = {"Authorization": f"Bearer {token}"}
            r = client.request(method, path, json={"items": [], "rev": 0}, headers=headers)
            assert (r.status_code, r.json()) == (401, {"error": "auth"})
    finally:
        conn.close()


# --- accounts -----------------------------------------------------------------------------------


def test_invite_lookup_redeem_and_cookie(client: TestClient, config: Config) -> None:
    token = invite(config, "alice@example.com")
    assert client.post("/api/invites/lookup", json={"token": token}).json() == {
        "kind": "invite",
        "username": "alice@example.com",
    }
    r = client.post("/api/invites/redeem", json={"token": token, "password": PASSWORD})
    assert r.json() == {"username": "alice@example.com"}
    cookie = r.headers["set-cookie"]
    for part in (
        "__Host-session=",
        "HttpOnly",
        "Secure",
        "SameSite=lax",
        "Path=/",
        f"Max-Age={90 * DAY}",
    ):
        assert part in cookie
    assert "Domain" not in cookie
    assert client.get("/api/auth/me").json() == {"username": "alice@example.com"}
    r = client.post("/api/invites/lookup", json={"token": token})
    assert (r.status_code, r.json()) == (410, {"error": "gone"})


def test_redeem_refusals(client: TestClient, config: Config) -> None:
    token = invite(config, "alice@example.com")
    r = client.post("/api/invites/redeem", json={"token": token, "password": "short"})
    assert (r.status_code, r.json()) == (400, {"error": "password"})
    r = client.post("/api/invites/redeem", json={"token": "nope", "password": PASSWORD})
    assert (r.status_code, r.json()) == (410, {"error": "gone"})


def test_login_logout(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401
    r = client.post("/api/auth/login", json={"username": "ALICE@example.com", "password": PASSWORD})
    assert r.json() == {"username": "alice@example.com"}
    assert client.get("/api/auth/me").status_code == 200
    r = client.post("/api/auth/logout", json={})
    assert r.status_code == 204
    assert "Max-Age=0" in r.headers["set-cookie"] or "expires=" in r.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").status_code == 401


def test_signup_signs_in_by_email(client: TestClient) -> None:
    r = client.post("/api/auth/signup", json={"email": "Bob@Example.com", "password": PASSWORD})
    assert (r.status_code, r.json()) == (200, {"username": "bob@example.com"})
    assert client.get("/api/auth/me").json() == {"username": "bob@example.com"}
    headers = {"X-Expected-User": "bob@example.com"}
    assert client.get("/api/state", headers=headers).status_code == 200
    client.post("/api/auth/logout", json={})
    r = client.post("/api/auth/login", json={"username": "BOB@example.com", "password": PASSWORD})
    assert r.json() == {"username": "bob@example.com"}


def test_signup_refusals(client: TestClient, config: Config, clock: Clock) -> None:
    def signup(email: str, password: str = PASSWORD) -> Any:
        return client.post("/api/auth/signup", json={"email": email, "password": password})

    r = signup("bob")
    assert (r.status_code, r.json()) == (400, {"error": "email"})
    r = signup("bob@example.com", "short")
    assert (r.status_code, r.json()) == (400, {"error": "password"})
    assert client.post("/api/auth/signup", json={"email": "b@example.com"}).status_code == 400
    assert signup("bob@example.com").status_code == 200
    r = signup("BOB@example.com")
    assert (r.status_code, r.json()) == (409, {"error": "exists"})
    for i in range(9):
        assert signup(f"u{i}@example.com").status_code == 200
    r = signup("late@example.com")
    assert (r.status_code, r.json()) == (429, {"error": "too-many", "retryAfter": 3600})
    assert r.headers["retry-after"] == "3600"


def test_signup_closed(config: Config) -> None:
    app = create_app(replace(config, max_users=0), run_backups=False)
    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as c:
        r = c.post("/api/auth/signup", json={"email": "bob@example.com", "password": PASSWORD})
    assert (r.status_code, r.json()) == (403, {"error": "closed"})


def test_logout_without_a_session_is_harmless(client: TestClient) -> None:
    assert client.post("/api/auth/logout", json={}).status_code == 204


def test_login_lockout_over_http(client: TestClient, config: Config, clock: Clock) -> None:
    sign_up(client, config)
    for _ in range(5):
        r = client.post(
            "/api/auth/login", json={"username": "alice@example.com", "password": "wrong password!"}
        )
        assert (r.status_code, r.json()) == (401, {"error": "invalid"})
    r = client.post("/api/auth/login", json={"username": "alice@example.com", "password": PASSWORD})
    assert (r.status_code, r.json()) == (423, {"error": "locked", "retryAfter": 900})
    assert r.headers["retry-after"] == "900"
    clock.advance(900)
    assert (
        client.post(
            "/api/auth/login", json={"username": "alice@example.com", "password": PASSWORD}
        ).status_code
        == 200
    )


def test_unknown_user_gets_the_same_answer(client: TestClient) -> None:
    r = client.post("/api/auth/login", json={"username": "nobody", "password": PASSWORD})
    assert (r.status_code, r.json()) == (401, {"error": "invalid"})


def test_session_cookie_is_resent_when_it_slides(
    client: TestClient, config: Config, clock: Clock
) -> None:
    sign_up(client, config)
    assert "set-cookie" not in client.get("/api/auth/me").headers
    clock.advance(DAY + 1)
    assert "__Host-session=" in client.get("/api/auth/me").headers["set-cookie"]


def test_plain_http_config_uses_an_unprefixed_cookie(config: Config, tmp_path: Any) -> None:
    plain = Config(
        data_dir=tmp_path / "p",
        public_origin="http://testserver",
        cookie_secure=False,
        clock=config.clock,
    )
    with TestClient(
        create_app(plain, run_backups=False), headers={"Origin": "http://testserver"}
    ) as c:
        r = c.post(
            "/api/invites/redeem",
            json={"token": invite(plain, "alice@example.com"), "password": PASSWORD},
        )
        cookie = r.headers["set-cookie"]
        assert cookie.startswith("session=") and "Secure" not in cookie
        assert c.get("/api/auth/me").status_code == 200


# --- data ---------------------------------------------------------------------------------------


def test_empty_state(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    empty: dict[str, dict[str, Any]] = {"plans": {}, "log": {}, "revs": {}}
    assert client.get("/api/state").json() == {"exercise": empty, "diet": empty, "settings": None}


def test_plan_revisions_and_conflicts(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    url = f"/api/plans/exercise/{WEEK}"
    assert client.put(url, json={"items": [PUSHUPS], "rev": 0}).json() == {"rev": 1}
    assert client.put(url, json={"items": [PUSHUPS, PUSHUPS | {"id": "sq"}], "rev": 1}).json() == {
        "rev": 2
    }
    r = client.put(url, json={"items": [], "rev": 1})  # stale
    assert r.status_code == 409
    assert r.json() == {"error": "conflict", "items": [PUSHUPS, PUSHUPS | {"id": "sq"}], "rev": 2}
    state = client.get("/api/state").json()["exercise"]
    assert state["revs"] == {WEEK: 2}
    assert [i["id"] for i in state["plans"][WEEK]] == ["pu", "sq"]


def test_a_stale_create_with_identical_items_succeeds(client: TestClient, config: Config) -> None:
    """Two devices ticking the same carried-forward week both create its plan from one source."""
    sign_up(client, config)
    url = f"/api/plans/diet/{WEEK}"
    veg = [{"id": "veg", "name": "Vegetables", "target": 7}]
    assert client.put(url, json={"items": veg, "rev": 0}).json() == {"rev": 1}
    assert client.put(url, json={"items": veg, "rev": 0}).json() == {"rev": 1}
    r = client.put(url, json={"items": [], "rev": 0})
    assert (r.status_code, r.json()["rev"]) == (409, 1)


def test_a_stale_rev_for_a_missing_plan_conflicts_with_none(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    r = client.put(f"/api/plans/exercise/{WEEK}", json={"items": [], "rev": 3})
    assert (r.status_code, r.json()) == (409, {"error": "conflict", "items": None, "rev": 0})


def test_plan_items_are_validated_like_stored_data(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    items = [{"id": "a", "name": "A", "reps": 2.5, "target": 9, "weight": 0.125}, {"name": "no id"}]
    client.put(f"/api/plans/exercise/{WEEK}", json={"items": items, "rev": 0})
    assert client.get("/api/state").json()["exercise"]["plans"][WEEK] == [
        {"id": "a", "name": "A", "reps": 3, "weight": 0.13, "target": 7}
    ]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/plans/other/2026-10-19", {"items": [], "rev": 0}),
        ("/api/plans/exercise/2026-1-19", {"items": [], "rev": 0}),
        ("/api/plans/exercise/2026-10-19", {"items": {}, "rev": 0}),
        ("/api/plans/exercise/2026-10-19", {"items": [], "rev": -1}),
        ("/api/plans/exercise/2026-10-19", {"items": [], "rev": True}),
        ("/api/plans/exercise/2026-10-19", {"items": [], "rev": 1.0}),
        ("/api/ticks/exercise/2026-10-19/pu/7", {"mark": "great"}),
        ("/api/ticks/exercise/2026-10-19/pu/x", {"mark": "great"}),
        ("/api/ticks/diet/not-a-week/veg/0", {"mark": "great"}),
        (f"/api/ticks/exercise/2026-10-19/{'x' * 129}/0", {"mark": "great"}),
        ("/api/ticks/exercise/2026-10-19/pu/0", {"mark": "GREAT"}),
        ("/api/ticks/exercise/2026-10-19/pu/0", {"mark": "done"}),
        ("/api/ticks/exercise/2026-10-19/pu/0", {"mark": True}),
        ("/api/ticks/exercise/2026-10-19/pu/0", {"mark": 1}),
        ("/api/ticks/exercise/2026-10-19/pu/0", {"mark": ["great"]}),
        # A `mark` key is read first, so a valid `done` beside a bad one does not rescue it.
        ("/api/ticks/exercise/2026-10-19/pu/0", {"mark": "x", "done": True}),
        ("/api/ticks/exercise/2026-10-19/pu/0", {"done": 1}),
        ("/api/ticks/exercise/2026-10-19/pu/0", {"done": None}),
        ("/api/ticks/exercise/2026-10-19/pu/0", {}),
    ],
)
def test_bad_writes_are_400(
    client: TestClient, config: Config, path: str, body: dict[str, Any]
) -> None:
    sign_up(client, config)
    r = client.put(path, json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})


def test_ticks_set_and_clear_single_days(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    url = f"/api/ticks/exercise/{WEEK}/pu"
    _ = None
    assert client.put(f"{url}/0", json={"mark": "great"}).json() == {
        "days": ["great", _, _, _, _, _, _]
    }
    # Another device marking a different day does not undo the first.
    assert client.put(f"{url}/4", json={"mark": "missed"}).json()["days"] == [
        "great", _, _, _, "missed", _, _
    ]  # fmt: skip
    # Day 0 cycles through every mark and back to empty; day 4 keeps its own throughout.
    for mark in ("partial", "missed", "great", "partial"):
        assert client.put(f"{url}/0", json={"mark": mark}).json()["days"] == [
            mark, _, _, _, "missed", _, _
        ]  # fmt: skip
    for _repeat in range(2):  # clearing an empty day is a no-op
        assert client.put(f"{url}/0", json={"mark": None}).json()["days"] == [
            _, _, _, _, "missed", _, _
        ]  # fmt: skip
    assert client.get("/api/state").json()["exercise"]["log"] == {
        WEEK: {"pu": [_, _, _, _, "missed", _, _]}
    }
    assert ticks_row(config, "pu") == (0b10000, 0, 0b10000)


def test_ticks_keep_each_marks_drawing(client: TestClient, config: Config) -> None:
    """A press steps through every kind in every drawing (K17); the row's masks keep both, and a
    day that changes drawing or kind leaves the other days alone."""
    sign_up(client, config)
    url = f"/api/ticks/exercise/{WEEK}/pu"
    _ = None
    client.put(f"{url}/6", json={"mark": "missed-hatch"})
    for mark in MARKS:
        assert client.put(f"{url}/0", json={"mark": mark}).json()["days"] == [
            mark, _, _, _, _, _, "missed-hatch"
        ]  # fmt: skip
    conn = connect(config.db_path)
    try:
        row = conn.execute("SELECT days, partial, missed, solid, hatch FROM ticks").fetchone()
    finally:
        conn.close()
    # Day 0 ended on missed-hatch too.
    assert tuple(row) == (0b1000001, 0, 0b1000001, 0, 0b1000001)
    for bad in ("great-zigzag", "solid", "Great-solid", "great-solid "):
        assert client.put(f"{url}/0", json={"mark": bad}).status_code == 400


def test_ticks_accept_the_old_done_body(client: TestClient, config: Config) -> None:
    """A tab or a queued tick from before marks had kinds sends `{done}`: true is great."""
    sign_up(client, config)
    url = f"/api/ticks/exercise/{WEEK}/pu"
    client.put(f"{url}/1", json={"mark": "partial"})
    assert client.put(f"{url}/0", json={"done": True}).json()["days"][:2] == ["great", "partial"]
    # done: true over a partial day makes it great; done: false clears whatever mark it had.
    assert client.put(f"{url}/1", json={"done": True}).json()["days"][:2] == ["great", "great"]
    assert client.put(f"{url}/0", json={"done": False}).json()["days"][:2] == [None, "great"]
    assert ticks_row(config, "pu") == (0b10, 0, 0)


def test_ticks_read_mark_before_done(client: TestClient, config: Config) -> None:
    """The app sends both keys, so an older API still saves the day; this one reads `mark`."""
    sign_up(client, config)
    url = f"/api/ticks/exercise/{WEEK}/pu"
    assert client.put(f"{url}/0", json={"mark": "partial", "done": True}).json()["days"][0] == (
        "partial"
    )
    assert client.put(f"{url}/0", json={"mark": None, "done": False}).json()["days"][0] is None


def ticks_row(config: Config, item_id: str, uid: int = 1) -> tuple[int, int, int]:
    """The (days, partial, missed) masks stored for one item in WEEK's exercise ticks."""
    conn = connect(config.db_path)
    try:
        row = conn.execute(
            "SELECT days, partial, missed FROM ticks"
            " WHERE user_id = ? AND section = 'exercise' AND week = ? AND item_id = ?",
            (uid, WEEK, item_id),
        ).fetchone()
        return (row["days"], row["partial"], row["missed"])
    finally:
        conn.close()


def usage(config: Config, uid: int = 1) -> int:
    conn = connect(config.db_path)
    try:
        return data.usage(conn, uid)
    finally:
        conn.close()


def test_the_quota_refuses_growth_but_never_level_or_shrinking_writes(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    plan = f"/api/plans/exercise/{WEEK}"
    assert client.put(plan, json={"items": [PUSHUPS], "rev": 0}).status_code == 200
    room = usage(config) + 64  # room for exactly one more tick row
    with other_client(replace(config, user_quota_bytes=room)) as c:
        c.post("/api/auth/login", json={"username": "alice@example.com", "password": PASSWORD})
        ticks = f"/api/ticks/exercise/{WEEK}"
        assert c.put(f"{ticks}/pu/0", json={"mark": "great"}).status_code == 200
        assert usage(config) == room
        r = c.put(f"{ticks}/sq/0", json={"mark": "partial"})
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
        # A full account still changes the rows it has and keeps or trims its plans.
        assert c.put(f"{ticks}/pu/3", json={"mark": "missed"}).status_code == 200
        assert c.put(f"{ticks}/pu/0", json={"mark": None}).status_code == 200
        r = c.put("/api/plans/exercise/2026-10-26", json={"items": [PUSHUPS], "rev": 0})
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
        assert c.put(plan, json={"items": [PUSHUPS], "rev": 1}).json() == {"rev": 2}
        assert c.put(plan, json={"items": [], "rev": 2}).json() == {"rev": 3}
        assert usage(config) < room
        state = c.get("/api/state").json()["exercise"]
    assert "2026-10-26" not in state["plans"]
    assert state["log"] == {WEEK: {"pu": [None, None, None, "missed", None, None, None]}}


def test_an_import_over_the_quota_adds_nothing(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    sample = read_fixture("sample/export.json")
    with other_client(replace(config, user_quota_bytes=len(json.dumps(sample)) // 4)) as c:
        c.post("/api/auth/login", json={"username": "alice@example.com", "password": PASSWORD})
        r = post_import(c, sample)
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
    assert usage(config) == 0


def test_the_quota_is_per_user(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    plan = f"/api/plans/exercise/{WEEK}"
    assert client.put(plan, json={"items": [PUSHUPS], "rev": 0}).status_code == 200
    room = usage(config)
    with other_client(replace(config, user_quota_bytes=room)) as c:
        sign_up(c, config, "bob@example.com")
        assert c.put(plan, json={"items": [PUSHUPS], "rev": 0}).status_code == 200
    assert usage(config, 2) == room


def test_settings_are_normalised(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    assert client.put(
        "/api/settings", json={"accent": "red", "dailyPick": 20, "foodPick": 0, "theme": "dark"}
    ).json() == {
        "accent": "#30d158",
        "dailyPick": 8,
        "foodPick": 1,
    }
    assert client.get("/api/state").json()["settings"] == {
        "accent": "#30d158",
        "dailyPick": 8,
        "foodPick": 1,
    }


def test_settings_without_a_food_pick_keep_the_saved_one(
    client: TestClient, config: Config
) -> None:
    """A tab still running the app from before foods a day (K57) sends no foodPick."""
    sign_up(client, config)
    assert client.put("/api/settings", json={"accent": "#bf5af2", "dailyPick": 4}).json() == {
        "accent": "#bf5af2",
        "dailyPick": 4,
        "foodPick": 2,
    }
    client.put("/api/settings", json={"accent": "#bf5af2", "dailyPick": 4, "foodPick": 6})
    assert client.put("/api/settings", json={"accent": "#bf5af2", "dailyPick": 3}).json() == {
        "accent": "#bf5af2",
        "dailyPick": 3,
        "foodPick": 6,
    }


def test_users_cannot_see_or_change_each_others_data(client: TestClient, config: Config) -> None:
    sign_up(client, config, "alice@example.com")
    client.put(f"/api/plans/exercise/{WEEK}", json={"items": [PUSHUPS], "rev": 0})
    client.put(f"/api/ticks/exercise/{WEEK}/pu/0", json={"mark": "partial"})
    client.put("/api/settings", json={"accent": "#0a84ff", "dailyPick": 5, "foodPick": 4})
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        empty: dict[str, dict[str, Any]] = {"plans": {}, "log": {}, "revs": {}}
        assert bob.get("/api/state").json() == {"exercise": empty, "diet": empty, "settings": None}
        assert bob.get("/api/export").json()["exercise"] == {"plans": {}, "log": {}}
        # Bob's writes to the same week create his own rows, not edits of Alice's.
        assert bob.put(f"/api/plans/exercise/{WEEK}", json={"items": [], "rev": 0}).json() == {
            "rev": 1
        }
        assert (
            bob.put(f"/api/ticks/exercise/{WEEK}/pu/1", json={"mark": "great"}).json()["days"][0]
            is None
        )
        bob.put("/api/settings", json={"accent": "#bf5af2", "dailyPick": 2})
        bob.post(
            "/api/import",
            content=json.dumps(read_fixture("sample/export.json")),
            headers={"Content-Type": "application/json"},
        )
    alice = client.get("/api/state").json()
    assert alice["exercise"]["plans"] == {WEEK: [PUSHUPS]}
    assert alice["exercise"]["log"] == {WEEK: {"pu": ["partial"] + [None] * 6}}
    assert alice["diet"] == {"plans": {}, "log": {}, "revs": {}}
    assert alice["settings"] == {"accent": "#0a84ff", "dailyPick": 5, "foodPick": 4}


# --- import and export --------------------------------------------------------------------------


def post_import(client: TestClient, payload: Any) -> Any:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return client.post("/api/import", content=text, headers={"Content-Type": "application/json"})


def test_sample_import_then_export_round_trips(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    sample = read_fixture("sample/export.json")
    r = post_import(client, sample)
    # The same counts the browser's confirm step shows for this file (App.spec.ts).
    assert r.json() == {"weeks": 6, "ticks": 102, "settings": True}
    exported = client.get("/api/export")
    assert sample["version"] == exported.json()["version"] == 4
    assert (
        exported.headers["content-disposition"] == 'attachment; filename="tracker-2026-10-23.json"'
    )
    assert exported.json() == {**sample, "exportedAt": "2026-10-23T08:00:00.000Z"}
    assert post_import(client, sample).json() == {"weeks": 0, "ticks": 0, "settings": False}
    assert client.get("/api/export").json() == {**sample, "exportedAt": "2026-10-23T08:00:00.000Z"}


def test_import_merges_without_deleting(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    client.put(f"/api/plans/exercise/{WEEK}", json={"items": [PUSHUPS], "rev": 0})
    client.put(f"/api/ticks/exercise/{WEEK}/pu/0", json={"mark": "missed"})
    client.put("/api/settings", json={"accent": "#ff9f0a", "dailyPick": 2})
    squats = {"id": "sq", "name": "Squats", "reps": 15, "target": 4}
    r = post_import(
        client,
        {
            "format": "fitness-planner-export",
            "version": 1,
            "exercise": {
                "plans": {WEEK: [squats], "2026-10-12": [squats]},
                "log": {WEEK: {"pu": [False, True, False, False, False, False, False]}},
            },
            "settings": {"accent": "#0a84ff", "dailyPick": 4},
        },
    )
    assert r.json() == {"weeks": 1, "ticks": 1, "settings": False}
    state = client.get("/api/state").json()
    assert state["exercise"]["plans"] == {"2026-10-12": [squats], WEEK: [PUSHUPS]}
    assert state["exercise"]["revs"] == {"2026-10-12": 1, WEEK: 1}
    # A version 1 file's true day reads as great; the day already marked keeps its mark.
    assert state["exercise"]["log"][WEEK]["pu"][:2] == ["missed", "great"]
    assert state["settings"] == {"accent": "#ff9f0a", "dailyPick": 2, "foodPick": 2}


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ("{oops", "json"),
        ("null", "json"),
        ('{"format": "fitness-planner-export", "version": 1, "x": NaN}', "json"),
        ({"plans": {}}, "format"),
        ({"format": "fitness-planner-export", "version": 5}, "version"),
        ({"format": "fitness-planner-export", "version": 0}, "version"),
    ],
)
def test_import_rejects_bad_files_and_changes_nothing(
    client: TestClient, config: Config, payload: Any, code: str
) -> None:
    sign_up(client, config)
    r = post_import(client, payload)
    assert (r.status_code, r.json()) == (400, {"error": code})
    empty: dict[str, dict[str, Any]] = {"plans": {}, "log": {}, "revs": {}}
    assert client.get("/api/state").json() == {"exercise": empty, "diet": empty, "settings": None}


def test_import_keeps_existing_marks_and_fills_empty_days(
    client: TestClient, config: Config
) -> None:
    """Per day, a stored mark beats the file's and an empty day takes it, in one upsert."""
    sign_up(client, config)
    url = f"/api/ticks/exercise/{WEEK}/pu"
    client.put(f"{url}/0", json={"mark": "partial"})
    client.put(f"{url}/1", json={"mark": "missed"})
    client.put(f"{url}/2", json={"mark": "great"})
    _ = None
    incoming = ["great", "partial", "missed", "partial", "missed", "great", _]
    r = post_import(
        client,
        {
            "format": "fitness-planner-export",
            "version": 2,
            "exercise": {"log": {WEEK: {"pu": incoming, "sq": ["missed", _, _, _, _, _, _]}}},
        },
    )
    assert r.json() == {"weeks": 0, "ticks": 4, "settings": False}
    log = client.get("/api/state").json()["exercise"]["log"]
    assert log == {
        WEEK: {
            "pu": ["partial", "missed", "great", "partial", "missed", "great", _],
            "sq": ["missed", _, _, _, _, _, _],
        }
    }
    # partial and missed stay disjoint subsets of days.
    assert ticks_row(config, "pu") == (0b0111111, 0b0001001, 0b0010010)
    # The same file again adds nothing.
    assert post_import(
        client, {"format": "fitness-planner-export", "version": 2, "exercise": {"log": log}}
    ).json() == {"weeks": 0, "ticks": 0, "settings": False}


def test_a_version_1_import_exports_as_version_4(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    old = {
        "format": "fitness-planner-export",
        "version": 1,
        "exercise": {"log": {WEEK: {"pu": [True, False, True, False, False, False, False]}}},
        "diet": {"log": {WEEK: {"veg": [False] * 7}}},
    }
    assert post_import(client, old).json() == {"weeks": 0, "ticks": 2, "settings": False}
    exported = client.get("/api/export").json()
    assert exported["version"] == 4
    assert exported["exercise"]["log"] == {
        WEEK: {"pu": ["great", None, "great", None, None, None, None]}
    }
    # An all-empty row is kept, so the export matches the file.
    assert exported["diet"]["log"] == {WEEK: {"veg": [None] * 7}}


def test_import_accepts_a_byte_order_mark(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    body = "\ufeff" + json.dumps({"format": "fitness-planner-export", "version": 1})
    r = client.post(
        "/api/import", content=body.encode(), headers={"Content-Type": "application/json"}
    )
    assert r.json() == {"weeks": 0, "ticks": 0, "settings": False}


def test_ticks_on_different_days_from_many_connections_all_land(
    config: Config, client: TestClient
) -> None:
    """Seven writers, one per day, at once: a read-modify-write tick would lose some of them."""
    import threading

    sign_up(client, config)
    uid = 1
    conns = [connect(config.db_path) for _ in range(7)]
    barrier = threading.Barrier(7)

    marks: list[Mark] = ["great", "partial", "missed", "great", "partial", "missed", "great"]

    def tick(day: int) -> None:
        barrier.wait()
        for _ in range(20):
            data.set_tick(conns[day], uid, "exercise", WEEK, "pu", day, marks[day], quota=QUOTA)

    threads = [threading.Thread(target=tick, args=(d,)) for d in range(7)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for c in conns:
        c.close()
    assert client.get("/api/state").json()["exercise"]["log"] == {WEEK: {"pu": marks}}


def test_import_rejects_invalid_utf8(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    r = client.post(
        "/api/import", content=b"\xff\xfe", headers={"Content-Type": "application/json"}
    )
    assert (r.status_code, r.json()) == (400, {"error": "json"})


def test_create_app_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    from tracker_api.app import create_app_from_env

    monkeypatch.setenv("PUBLIC_ORIGIN", ORIGIN)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    app = create_app_from_env()
    with TestClient(app, base_url=ORIGIN) as c:
        assert c.get("/api/healthz").json() == {"ok": True}
    assert (tmp_path / "fitness.db").exists()
    assert (tmp_path / "backup").is_dir()  # the backup thread ran once at startup


def test_a_request_for_another_user_is_refused(client: TestClient, config: Config) -> None:
    """A tab still showing alice must not read or write bob's data with bob's cookie."""
    sign_up(client, config, "bob@example.com")
    alice = {"X-Expected-User": "alice@example.com"}
    assert client.get("/api/state", headers=alice).json() == {"error": "auth"}
    r = client.put(f"/api/ticks/exercise/{WEEK}/pu/0", json={"mark": "great"}, headers=alice)
    assert (r.status_code, r.json()) == (401, {"error": "auth"})
    assert client.get("/api/state").json()["exercise"]["log"] == {}
    # The right user, in any case, is fine; so is no header at all.
    assert (
        client.get("/api/state", headers={"X-Expected-User": "BOB@example.com"}).status_code == 200
    )
    assert client.get("/api/auth/me").json() == {"username": "bob@example.com"}
