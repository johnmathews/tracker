"""The MCP endpoint at /api/mcp through TestClient: the handshake and `whoami` with a token, and
every refusal. Each refusal that differs from REST is checked against a REST route as well, so a
guard exemption that widened past /api/mcp fails here (docs/api.md §3.1)."""

import json
import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from tracker_api import auth
from tracker_api.app import MAX_BODY, create_app
from tracker_api.config import Config
from tracker_api.mcp_server import MCP_PATH, OUT_OF_RANGE, caller

from .conftest import ORIGIN, Clock
from .test_insights import CASES
from .test_insights import load as load_tracked

EMAIL = "alice@example.com"
PASSWORD = "correct horse battery"
ACCEPT = "application/json, text/event-stream"
READ_TOOLS = ["week_summary", "weeks", "item_history", "goals", "consistency"]
WRITE_TOOLS = ["add_item", "update_item", "remove_item", "mark_day", "set_daily_targets"]
INITIALIZE = {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {"name": "test", "version": "0"},
}


@pytest.fixture
def agent(config: Config) -> Iterator[TestClient]:
    """A client as an agent is one: no Origin, no cookie."""
    with TestClient(create_app(config, run_backups=False), base_url=ORIGIN) as c:
        yield c


@pytest.fixture
def uid(conn: sqlite3.Connection, config: Config) -> int:
    return auth.signup(conn, config, EMAIL, PASSWORD)


@pytest.fixture
def token(conn: sqlite3.Connection, config: Config, uid: int) -> str:
    return auth.create_token(conn, config, EMAIL, "laptop", "read")


def call(
    client: TestClient,
    method: str,
    params: dict[str, Any] | None = None,
    *,
    token: str | None = None,
    headers: dict[str, str] | None = None,
    path: str = MCP_PATH,
) -> Response:
    """One JSON-RPC request, as an MCP client sends it."""
    sent = {"Accept": ACCEPT, **(headers or {})}
    if token is not None:
        sent["Authorization"] = f"Bearer {token}"
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    return client.post(path, json=body, headers=sent, follow_redirects=False)


def result(r: Response) -> dict[str, Any]:
    assert r.status_code == 200, r.text
    reply = r.json()
    assert "error" not in reply, reply
    return reply["result"]  # type: ignore[no-any-return]


# --- a working connection -----------------------------------------------------------------------


def test_initialize_list_and_whoami_with_a_token_and_no_origin(
    agent: TestClient, token: str
) -> None:
    info = result(call(agent, "initialize", INITIALIZE, token=token))
    assert info["serverInfo"]["name"] == "tracker"
    assert "tools" in info["capabilities"]
    tools = result(call(agent, "tools/list", token=token))["tools"]
    assert [t["name"] for t in tools] == ["whoami", *READ_TOOLS, *WRITE_TOOLS]
    assert tools[0]["annotations"]["readOnlyHint"] is True
    who = result(call(agent, "tools/call", {"name": "whoami", "arguments": {}}, token=token))
    assert who["isError"] is False
    assert who["structuredContent"] == {"email": EMAIL, "scope": "read"}
    assert json.loads(who["content"][0]["text"]) == {"email": EMAIL, "scope": "read"}


def test_whoami_reports_a_write_token(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    write = auth.create_token(conn, config, EMAIL, "agent", "write")
    who = result(call(agent, "tools/call", {"name": "whoami", "arguments": {}}, token=write))
    assert who["structuredContent"] == {"email": EMAIL, "scope": "write"}


def test_each_user_sees_their_own_account(
    agent: TestClient, conn: sqlite3.Connection, config: Config, token: str
) -> None:
    auth.signup(conn, config, "bob@example.com", PASSWORD)
    bobs = auth.create_token(conn, config, "bob@example.com", "phone", "write")
    for t, email in [(token, EMAIL), (bobs, "bob@example.com"), (token, EMAIL)]:
        who = result(call(agent, "tools/call", {"name": "whoami", "arguments": {}}, token=t))
        assert who["structuredContent"]["email"] == email


def test_the_app_origin_is_accepted(agent: TestClient, token: str) -> None:
    result(call(agent, "initialize", INITIALIZE, token=token, headers={"Origin": ORIGIN}))


def test_the_exact_path_answers_without_a_redirect(agent: TestClient, token: str) -> None:
    r = call(agent, "initialize", INITIALIZE, token=token)
    assert not r.is_redirect
    assert r.status_code == 200
    assert "location" not in r.headers
    assert r.headers["cache-control"] == "no-store"


def test_the_exemption_is_for_the_exact_path_only(agent: TestClient, token: str) -> None:
    """`/api/mcp/` is not the endpoint: it gets REST's guard, then the router's slash redirect."""
    r = call(agent, "initialize", INITIALIZE, token=token, path=MCP_PATH + "/")
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    r = call(agent, "initialize", INITIALIZE, token=token, path="/api/mcpx")
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    r = call(
        agent,
        "initialize",
        INITIALIZE,
        token=token,
        path=MCP_PATH + "/",
        headers={"Origin": ORIGIN},
    )
    assert r.status_code == 307
    assert r.headers["location"].endswith(MCP_PATH)


def test_responses_are_json_with_no_session(agent: TestClient, token: str) -> None:
    r = call(agent, "initialize", INITIALIZE, token=token)
    assert r.headers["content-type"].startswith("application/json")
    assert "mcp-session-id" not in r.headers


def modern_whoami(client: TestClient, token: str | None) -> Response:
    """`whoami` on the 2026-07-28 revision: no handshake, the envelope in `_meta` and headers."""
    meta = {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
    }
    headers = {
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "whoami",
    }
    params = {"name": "whoami", "arguments": {}, "_meta": meta}
    return call(client, "tools/call", params, token=token, headers=headers)


def test_whoami_on_the_stateless_revision(agent: TestClient, token: str) -> None:
    who = result(modern_whoami(agent, token))
    assert who["structuredContent"] == {"email": EMAIL, "scope": "read"}
    unauthorised(modern_whoami(agent, None))


def test_the_session_manager_runs_with_the_app(config: Config, token: str) -> None:
    """The manager starts and stops with the app's lifespan, so a second app gets its own."""
    for _ in range(2):
        with TestClient(create_app(config, run_backups=False), base_url=ORIGIN) as c:
            result(call(c, "initialize", INITIALIZE, token=token))


# --- the token ----------------------------------------------------------------------------------


def unauthorised(r: Response) -> None:
    assert r.status_code == 401, r.text
    assert r.json()["error"] == "invalid_token"
    assert r.headers["www-authenticate"].startswith('Bearer error="invalid_token"')


def test_no_token_gets_401(agent: TestClient, uid: int) -> None:
    unauthorised(call(agent, "initialize", INITIALIZE))


@pytest.mark.parametrize(
    "bad",
    [
        "trk_" + "A" * 43,  # well-formed, unknown
        "trk_short",
        "",
        "not-a-token",
    ],
)
def test_a_bad_token_gets_401(agent: TestClient, token: str, bad: str) -> None:
    unauthorised(call(agent, "initialize", INITIALIZE, token=bad))


def test_a_token_in_another_scheme_gets_401(agent: TestClient, token: str) -> None:
    r = call(agent, "initialize", INITIALIZE, headers={"Authorization": f"Basic {token}"})
    unauthorised(r)


def test_a_revoked_token_gets_401(agent: TestClient, conn: sqlite3.Connection, token: str) -> None:
    result(call(agent, "initialize", INITIALIZE, token=token))
    auth.revoke_token(conn, EMAIL, token[: len(auth.TOKEN_PREFIX) + auth.PREFIX_CHARS])
    unauthorised(call(agent, "initialize", INITIALIZE, token=token))


def test_a_disabled_users_token_gets_401(
    agent: TestClient, conn: sqlite3.Connection, token: str
) -> None:
    result(call(agent, "initialize", INITIALIZE, token=token))
    # Revoking tokens is part of `disable`; flip the flag alone so the lookup's own check shows.
    conn.execute("UPDATE users SET disabled = 1 WHERE username = ?", (EMAIL,))
    unauthorised(call(agent, "initialize", INITIALIZE, token=token))
    conn.execute("UPDATE users SET disabled = 0 WHERE username = ?", (EMAIL,))
    auth.set_disabled(conn, EMAIL, True)
    unauthorised(call(agent, "initialize", INITIALIZE, token=token))


def test_a_session_cookie_alone_gets_401(client: TestClient, uid: int) -> None:
    r = client.post("/api/auth/login", json={"username": EMAIL, "password": PASSWORD})
    assert r.status_code == 200
    assert client.get("/api/state").status_code == 200  # the cookie works on REST
    client.headers.pop("Origin")
    unauthorised(call(client, "initialize", INITIALIZE))


@pytest.mark.parametrize("name", ["token", "access_token", "Token"])
def test_a_token_in_the_query_string_gets_400(agent: TestClient, token: str, name: str) -> None:
    sent = {"Accept": ACCEPT, "Authorization": f"Bearer {token}"}
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": INITIALIZE}
    r = agent.post(MCP_PATH, params={name: token}, json=body, headers=sent)
    assert (r.status_code, r.json()) == (400, {"error": "token-in-url"})
    r = agent.get(MCP_PATH, params={name: token})
    assert (r.status_code, r.json()) == (400, {"error": "token-in-url"})


def test_rest_ignores_a_token_in_the_query_string(client: TestClient, token: str) -> None:
    """The query check is the MCP route's own: REST still answers as before."""
    assert client.get("/api/healthz", params={"token": token}).status_code == 200


# --- the guard, which differs from REST on this path only ---------------------------------------


def test_no_origin_passes_on_mcp_but_not_on_rest(agent: TestClient, token: str) -> None:
    result(call(agent, "initialize", INITIALIZE, token=token))
    r = agent.put(
        "/api/plans/exercise/2026-10-19",
        json={"items": [], "rev": 0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert (r.status_code, r.json()) == (403, {"error": "origin"})


@pytest.mark.parametrize(
    "origin", ["https://evil.itsa-pizza.com", "http://testserver", "null", ORIGIN + ":444"]
)
def test_a_foreign_origin_gets_403(agent: TestClient, token: str, origin: str) -> None:
    r = call(agent, "initialize", INITIALIZE, token=token, headers={"Origin": origin})
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    r = agent.get(MCP_PATH, headers={"Origin": origin})
    assert (r.status_code, r.json()) == (403, {"error": "origin"})


def test_content_type_is_left_to_the_sdk(agent: TestClient, token: str) -> None:
    sent = {"Accept": ACCEPT, "Authorization": f"Bearer {token}", "Content-Type": "text/plain"}
    r = agent.post(MCP_PATH, content=b"{}", headers=sent)
    assert r.status_code == 400  # the SDK's refusal, where REST's guard answers 415
    assert r.text == "Invalid Content-Type header"
    r = agent.post(
        "/api/auth/login", content=b"{}", headers={**sent, "Origin": ORIGIN}, follow_redirects=False
    )
    assert (r.status_code, r.json()) == (415, {"error": "content-type"})


def test_a_body_over_a_mebibyte_gets_413(agent: TestClient, token: str) -> None:
    padding = "x" * MAX_BODY
    body = {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"pad": padding}}
    sent = {"Accept": ACCEPT, "Authorization": f"Bearer {token}"}
    r = agent.post(MCP_PATH, json=body, headers=sent)
    assert (r.status_code, r.json()) == (413, {"error": "too-large"})


def test_a_chunked_body_over_a_mebibyte_is_cut_off(agent: TestClient, token: str) -> None:
    """No Content-Length for the guard, so the SDK's own limit, set to the same size, stops it."""

    def chunks() -> Iterator[bytes]:
        yield b'{"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"pad": "'
        for _ in range(1100):
            yield b"x" * 1024
        yield b'"}}'

    sent = {
        "Accept": ACCEPT,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    r = agent.post(MCP_PATH, content=chunks(), headers=sent)
    assert r.status_code == 413


@pytest.mark.parametrize("method", ["GET", "DELETE", "PUT", "HEAD"])
def test_only_post_is_served(agent: TestClient, token: str, method: str) -> None:
    """Stateless mode has no stream to open with GET and no session to end with DELETE."""
    bearer = {"Authorization": f"Bearer {token}", "Accept": ACCEPT}
    r = agent.request(method, MCP_PATH, headers=bearer)
    assert r.status_code == 405
    if method != "HEAD":
        assert r.json() == {"error": "method"}


# --- the Host check -----------------------------------------------------------------------------


def test_the_production_host_is_accepted(config: Config, token: str) -> None:
    public = "https://fitness.itsa-pizza.com"
    app = create_app(replace(config, public_origin=public), run_backups=False)
    with TestClient(app, base_url=public) as c:
        result(call(c, "initialize", INITIALIZE, token=token))
        result(call(c, "initialize", INITIALIZE, token=token, headers={"Origin": public}))
        r = call(c, "initialize", INITIALIZE, token=token, headers={"Host": "testserver"})
        assert r.status_code == 421


@pytest.mark.parametrize("host", ["localhost:8000", "127.0.0.1:8000", "testserver"])
def test_local_hosts_are_accepted(agent: TestClient, token: str, host: str) -> None:
    result(call(agent, "initialize", INITIALIZE, token=token, headers={"Host": host}))


@pytest.mark.parametrize("host", ["evil.example", "192.168.1.20:8083", "testserver.evil.example"])
def test_a_foreign_host_gets_421(agent: TestClient, token: str, host: str) -> None:
    r = call(agent, "initialize", INITIALIZE, token=token, headers={"Host": host})
    assert r.status_code == 421


# --- the helper the tools use -------------------------------------------------------------------


def test_caller_outside_a_request_refuses() -> None:
    with pytest.raises(PermissionError):
        caller()


# --- the read tools -----------------------------------------------------------------------------

# Friday 23 October 2026 (the conftest clock), in the week of Monday 19 October.
THIS_WEEK = "2026-10-19"
TODAY = "2026-10-23"


def tool(client: TestClient, token: str, name: str, **arguments: Any) -> dict[str, Any]:
    """`tools/call` for a tool the call is expected to succeed on; its structured result."""
    out = result(call(client, "tools/call", {"name": name, "arguments": arguments}, token=token))
    assert out["isError"] is False, out
    return out["structuredContent"]  # type: ignore[no-any-return]


def tool_error(client: TestClient, token: str, name: str, **arguments: Any) -> str:
    """`tools/call` for a call the tool refuses: the error text the agent reads."""
    out = result(call(client, "tools/call", {"name": name, "arguments": arguments}, token=token))
    assert out["isError"] is True, out
    return out["content"][0]["text"]  # type: ignore[no-any-return]


def plans(*items: tuple[str, str, int]) -> dict[str, Any]:
    return {
        "plans": {THIS_WEEK: [{"id": i, "name": n, "target": t} for i, n, t in items]},
        "log": {},
    }


def test_every_read_tool_is_listed_read_only_with_a_description(
    agent: TestClient, token: str
) -> None:
    tools = {t["name"]: t for t in result(call(agent, "tools/list", token=token))["tools"]}
    assert set(READ_TOOLS) <= set(tools)
    for name in READ_TOOLS:
        assert tools[name]["annotations"]["readOnlyHint"] is True
        assert tools[name]["annotations"]["destructiveHint"] is False
        assert len(tools[name]["description"]) > 40
        assert tools[name]["outputSchema"]
    props = tools["week_summary"]["inputSchema"]["properties"]
    assert props["section"]["enum"] == ["exercise", "diet"]
    assert "Monday" in props["week"]["description"]
    assert "food" in props["section"]["description"]


def test_week_summary_defaults_to_this_weeks_exercises(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str
) -> None:
    out = tool(agent, token, "week_summary")
    assert (out["this_week"], out["today"]) == (THIS_WEEK, TODAY)
    assert out["week"] == THIS_WEEK
    assert out["plan_week"] is None  # no plans: the defaults
    assert out["carried"] is True
    assert [it["name"] for it in out["items"]] == [
        "Push-ups",
        "Pull-ups",
        "Squats",
        "Back extensions",
        "Kettlebell halos",
    ]
    assert out["goals_met"] == 0
    assert [d["future"] for d in out["days"]] == [False] * 5 + [True] * 2


def test_week_summary_for_food_with_marks(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str
) -> None:
    diet = {
        "plans": {THIS_WEEK: [{"id": "veg", "name": "Vegetables", "target": 2}]},
        "log": {THIS_WEEK: {"veg": ["great", "partial-x", None, None, None, None, None]}},
    }
    load_tracked(conn, uid, diet=diet)
    out = tool(agent, token, "week_summary", section="diet", week=THIS_WEEK)
    [veg] = out["items"]
    assert (veg["done"], veg["great"], veg["partial"], veg["goal_met"]) == (2, 1, 1, True)
    assert out["goals_met"] == 1


def test_a_carried_week_reports_the_source_weeks_items(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str
) -> None:
    load_tracked(conn, uid, exercise=plans(("sq", "Squats", 3)))
    out = tool(agent, token, "week_summary", week="2026-11-02")
    assert (out["plan_week"], out["carried"]) == (THIS_WEEK, True)
    assert [it["id"] for it in out["items"]] == ["sq"]
    assert out["this_week"] == THIS_WEEK  # still now, not the week asked about


def test_weeks_defaults_to_the_last_four_weeks(agent: TestClient, uid: int, token: str) -> None:
    out = tool(agent, token, "weeks")
    assert out["section"] == "exercise"
    assert (out["start"], out["end"]) == ("2026-09-28", THIS_WEEK)
    assert [w["week"] for w in out["weeks"]] == [
        "2026-09-28",
        "2026-10-05",
        "2026-10-12",
        THIS_WEEK,
    ]
    assert out["today"] == TODAY


def test_weeks_with_a_range(agent: TestClient, uid: int, token: str) -> None:
    out = tool(agent, token, "weeks", section="diet", start="2026-10-05", end="2026-10-12")
    assert [w["week"] for w in out["weeks"]] == ["2026-10-05", "2026-10-12"]
    assert out["weeks"][0]["items"][0]["name"] == "Vegetables"


def test_item_history_defaults_to_eight_weeks(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str
) -> None:
    load_tracked(conn, uid, exercise=plans(("sq", "Squats", 3)))
    out = tool(agent, token, "item_history", item_id="sq")
    assert out["name"] == "Squats"
    assert len(out["weeks"]) == 8
    assert out["end"] == THIS_WEEK
    assert (out["this_week"], out["today"]) == (THIS_WEEK, TODAY)
    assert tool(agent, token, "item_history", item_id="sq", weeks=2)["start"] == "2026-10-12"
    assert tool(agent, token, "item_history", item_id="nope")["name"] is None


def test_item_history_gives_the_whole_note_the_other_reads_cut(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str
) -> None:
    """A note runs to 20,000 characters; the reads of many items cut it at 500, ending in "…".
    `item_history` gives it whole, so an agent can read it there before writing one back."""
    whole = ("Knees out. " * 100).strip()
    details = {"details": {"sq": {"notes": whole}}}
    load_tracked(conn, uid, exercise=plans(("sq", "Squats", 3)) | details)
    assert tool(agent, token, "item_history", item_id="sq")["notes"] == whole
    cut = whole[:499] + "…"
    assert tool(agent, token, "week_summary")["items"][0]["notes"] == cut
    assert tool(agent, token, "goals")["exercise"][0]["notes"] == cut
    tools = {t["name"]: t for t in result(call(agent, "tools/list", token=token))["tools"]}
    for name in ("week_summary", "weeks", "goals"):
        assert "cut at 500" in tools[name]["description"], name
    assert "whole note" in tools["item_history"]["description"]
    for name in ("add_item", "update_item"):
        assert "item_history" in tools[name]["description"], name
        assert "item_history" in tools[name]["inputSchema"]["properties"]["note"]["description"]


def test_goals_reports_the_defaults_for_an_account_with_no_plans(
    agent: TestClient, uid: int, token: str
) -> None:
    out = tool(agent, token, "goals")
    assert (out["week"], out["this_week"], out["today"]) == (THIS_WEEK, THIS_WEEK, TODAY)
    assert [(g["id"], g["target"]) for g in out["exercise"]][:2] == [("pu", 4), ("pl", 4)]
    assert [g["name"] for g in out["diet"]] == ["Vegetables", "Fruit", "Fish", "Nuts"]
    assert out["exercises_a_day"] >= 1
    assert out["foods_a_day"] >= 1
    assert out["note"] == ""


def test_consistency_defaults_to_eight_weeks(agent: TestClient, uid: int, token: str) -> None:
    out = tool(agent, token, "consistency")
    assert out["section"] == "exercise"
    assert out["end"] == THIS_WEEK
    assert out["start"] == "2026-08-31"
    assert out["days"] == 8 * 7 - 2  # up to Friday
    assert out["this_week"] == THIS_WEEK
    assert out["today"] == TODAY
    assert tool(agent, token, "consistency", section="diet", weeks=1)["days"] == 5


@pytest.mark.parametrize(
    ("name", "arguments", "field"),
    [
        ("week_summary", {"week": "2026-10-20"}, "week"),
        ("week_summary", {"week": "2026-02-30"}, "week"),
        ("week_summary", {"week": "soon"}, "week"),
        ("weeks", {"start": "2026-10-20"}, "start"),
        ("weeks", {"end": "2026-10-21"}, "end"),
        ("weeks", {"start": "2026-10-26", "end": "2026-10-19"}, "end"),
        ("weeks", {"start": "2025-01-06"}, "weeks"),
        ("item_history", {"item_id": "sq", "weeks": 0}, "weeks"),
        ("item_history", {"item_id": "sq", "weeks": 27}, "weeks"),
        ("consistency", {"weeks": 99}, "weeks"),
    ],
)
def test_a_refused_argument_is_a_tool_error_naming_the_field(
    agent: TestClient, uid: int, token: str, name: str, arguments: dict[str, Any], field: str
) -> None:
    text = tool_error(agent, token, name, **arguments)
    assert text.startswith(f"{field}: ") or f"{field}: " in text


@pytest.mark.parametrize("name", ["week_summary", "weeks", "item_history", "consistency"])
def test_an_unknown_section_is_a_tool_error_naming_the_field(
    agent: TestClient, uid: int, token: str, name: str
) -> None:
    extra = {"item_id": "sq"} if name == "item_history" else {}
    assert "section" in tool_error(agent, token, name, section="sleep", **extra)


def test_a_missing_item_id_is_a_tool_error(agent: TestClient, uid: int, token: str) -> None:
    assert "item_id" in tool_error(agent, token, "item_history")


@pytest.mark.parametrize(("name", "case"), CASES, ids=[n for n, _ in CASES])
def test_week_summary_matches_the_shared_fixtures(
    agent: TestClient,
    conn: sqlite3.Connection,
    clock: Clock,
    uid: int,
    token: str,
    name: str,
    case: dict[str, Any],
) -> None:
    """The tool passes insights' answer through: the goal-met items and met days are the ones
    the app's screen shows for the fixture's week."""
    expected = case["expected"]
    if case["section"] == "exercise":
        load_tracked(conn, uid, exercise=case, settings={"dailyPick": case["dailyTarget"]})
    else:
        load_tracked(conn, uid, diet=case, settings={"foodPick": case["dailyTarget"]})
    day = datetime.fromisoformat(case["today"]).replace(hour=12, tzinfo=UTC)
    clock.now = int(day.timestamp())
    out = tool(agent, token, "week_summary", section=case["section"], week=case["week"])
    assert out["today"] == case["today"]
    assert out["plan_week"] == expected["planWeek"]
    assert [d["met"] for d in out["days"]] == expected["metDays"]
    assert [d["count"] for d in out["days"]] == expected["dayCounts"]
    assert out["days_met"] == expected["daysMet"]
    assert out["goals_met"] == expected["goalsMet"]
    assert [(it["id"], it["done"], it["goal_met"], it["notes"]) for it in out["items"]] == [
        (it["id"], it["done"], it["goalMet"], it.get("notes", "")) for it in expected["items"]
    ]


# --- the write tools ----------------------------------------------------------------------------

WRITE_HINTS = {
    "add_item": {"destructiveHint": False, "idempotentHint": False},
    "update_item": {"destructiveHint": False, "idempotentHint": True},
    "remove_item": {"destructiveHint": True, "idempotentHint": False},
    "mark_day": {"destructiveHint": False, "idempotentHint": True},
    "set_daily_targets": {"destructiveHint": False, "idempotentHint": True},
}
WRITE_CALLS: dict[str, dict[str, Any]] = {
    "add_item": {"name": "Dips"},
    "update_item": {"item_id": "sq", "times_a_week": 5},
    "remove_item": {"item_id": "sq"},
    "mark_day": {"item_id": "sq", "mark": "great"},
    "set_daily_targets": {"exercises_a_day": 4},
}


def write(client: TestClient, token: str, tool_name: str, arguments: dict[str, Any]) -> Any:
    """`tool` with the arguments as a dict, since a write tool has an argument called `name`."""
    out = result(
        call(client, "tools/call", {"name": tool_name, "arguments": arguments}, token=token)
    )
    assert out["isError"] is False, out
    return out["structuredContent"]


def write_error(client: TestClient, token: str, tool_name: str, arguments: dict[str, Any]) -> str:
    out = result(
        call(client, "tools/call", {"name": tool_name, "arguments": arguments}, token=token)
    )
    assert out["isError"] is True, out
    return out["content"][0]["text"]  # type: ignore[no-any-return]


@pytest.fixture
def writer(conn: sqlite3.Connection, config: Config, uid: int) -> str:
    return auth.create_token(conn, config, EMAIL, "agent", "write")


def rows(conn: sqlite3.Connection) -> tuple[int, int, int]:
    """How many plan, tick and settings rows the database holds."""
    return tuple(
        conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]  # noqa: S608
        for t in ("plans", "ticks", "settings")
    )


def test_tools_list_shows_the_write_tools_annotations(agent: TestClient, token: str) -> None:
    tools = {t["name"]: t for t in result(call(agent, "tools/list", token=token))["tools"]}
    for name, hints in WRITE_HINTS.items():
        annotations = tools[name]["annotations"]
        assert annotations["readOnlyHint"] is False, name
        assert annotations["openWorldHint"] is False, name
        for hint, value in hints.items():
            assert annotations[hint] is value, (name, hint)
    for name in ["add_item", "update_item", "remove_item", "mark_day"]:
        assert "later weeks" in tools[name]["description"], name
    props = tools["add_item"]["inputSchema"]["properties"]
    words = {"name", "sets", "reps", "seconds", "per_side", "weight_kg", "times_a_week", "note"}
    assert words <= set(props)
    assert "Monday" in props["week"]["description"]
    assert tools["add_item"]["inputSchema"]["required"] == ["name"]
    assert "great" in tools["mark_day"]["inputSchema"]["properties"]["mark"]["description"]


@pytest.mark.parametrize("name", WRITE_TOOLS)
def test_a_read_token_cannot_write(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str, name: str
) -> None:
    text = write_error(agent, token, name, WRITE_CALLS[name])
    assert "read-only" in text
    assert "Settings › Connections" in text  # noqa: RUF001
    assert "tracker-admin" not in text
    assert rows(conn) == (0, 0, 0)


def test_add_item_shows_in_the_apps_state(
    agent: TestClient, client: TestClient, uid: int, writer: str
) -> None:
    """The app reads `GET /api/state` on focus, so an item added over MCP shows there."""
    out = write(
        agent, writer, "add_item", {"name": "Dips", "reps": 8, "weight_kg": 10, "times_a_week": 2}
    )
    assert out["week"] == THIS_WEEK
    assert out["copied_from"] == "defaults"
    assert out["rev"] == 1
    new = out["item"]
    assert new == {"id": new["id"], "name": "Dips", "reps": 8, "weight_kg": 10, "times_a_week": 2}
    assert [it["id"] for it in out["before"]] == ["pu", "pl", "sq", "be", "kh"]
    assert out["after"][-1] == new
    login = client.post("/api/auth/login", json={"username": EMAIL, "password": PASSWORD})
    assert login.status_code == 200
    state = client.get("/api/state").json()
    week = state["exercise"]["plans"][THIS_WEEK]
    assert week[-1] == {"id": new["id"], "name": "Dips", "reps": 8, "weight": 10, "target": 2}
    assert state["exercise"]["revs"][THIS_WEEK] == 1


def test_update_and_remove_item_on_a_given_week(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    load_tracked(conn, uid, diet=plans(("veg", "Vegetables", 7), ("nuts", "Nuts", 3)))
    out = tool(
        agent, writer, "update_item", section="diet", week=THIS_WEEK, item_id="veg", note="greens"
    )
    assert out["item"] == {"id": "veg", "name": "Vegetables", "times_a_week": 7, "note": "greens"}
    assert out["before"][0] == {"id": "veg", "name": "Vegetables", "times_a_week": 7}
    out = tool(agent, writer, "remove_item", section="diet", item_id="nuts")
    assert out["item"] == {"id": "nuts", "name": "Nuts", "times_a_week": 3}
    assert out["item"] in out["before"]
    assert [it["id"] for it in out["after"]] == ["veg"]


def test_a_note_through_the_tool_shows_in_the_apps_state(
    agent: TestClient, client: TestClient, uid: int, writer: str
) -> None:
    """The app reads an item's note from its details, one copy for every week (D3), so an
    agent's note lands there, and a note alone copies no week."""
    out = tool(agent, writer, "update_item", item_id="sq", note="Knees out.")
    assert out["item"]["note"] == "Knees out."
    assert (out["copied_from"], out["rev"]) == (None, 0)
    login = client.post("/api/auth/login", json={"username": EMAIL, "password": PASSWORD})
    assert login.status_code == 200
    state = client.get("/api/state").json()["exercise"]
    assert state["details"] == {"sq": {"notes": "Knees out."}}
    assert state["detailRevs"] == {"sq": 1}
    assert state["plans"] == {}
    assert tool(agent, writer, "week_summary", week="2026-11-02")["items"][2]["notes"] == (
        "Knees out."
    )


def test_mark_day_defaults_to_today(agent: TestClient, uid: int, writer: str) -> None:
    out = tool(agent, writer, "mark_day", item_id="sq", mark="partial")
    assert (out["date"], out["week"], out["day"]) == (TODAY, THIS_WEEK, 4)
    assert (out["before"], out["after"]) == (None, "partial")
    summary = tool(agent, writer, "week_summary")
    assert summary["plan_week"] == THIS_WEEK
    assert [it["marks"][4] for it in summary["items"] if it["id"] == "sq"] == ["partial"]
    out = tool(agent, writer, "mark_day", item_id="sq", mark=None, date="2026-10-23")
    assert (out["before"], out["after"]) == ("partial", None)


def test_set_daily_targets_through_the_tool(agent: TestClient, uid: int, writer: str) -> None:
    out = tool(agent, writer, "set_daily_targets", foods_a_day=4)
    assert out == {
        "before": {"exercises_a_day": 3, "foods_a_day": 2},
        "after": {"exercises_a_day": 3, "foods_a_day": 4},
    }
    assert tool(agent, writer, "goals")["foods_a_day"] == 4


@pytest.mark.parametrize(
    ("name", "arguments", "words"),
    [
        ("add_item", {"name": "Dips", "week": "2026-10-20"}, "week: "),
        ("add_item", {"name": "Dips", "times_a_week": 9}, "times_a_week: "),
        ("add_item", {"name": " "}, "name is empty"),
        ("add_item", {"name": "Beans", "section": "diet", "sets": 3}, "sets: "),
        ("update_item", {"item_id": "nope", "name": "Dips"}, "item_id: no item nope"),
        ("update_item", {"item_id": "sq"}, "nothing to change"),
        ("remove_item", {"item_id": "nope"}, "item_id: "),
        ("mark_day", {"item_id": "sq", "mark": "great", "date": "23 October"}, "date: "),
        ("mark_day", {"item_id": "nope", "mark": "great"}, "item_id: "),
        ("mark_day", {"item_id": "veg", "mark": "partial", "section": "diet"}, "mark: "),
        ("mark_day", {"item_id": "sq", "mark": "done"}, "mark\n"),
        ("set_daily_targets", {"exercises_a_day": 0}, "exercises_a_day: "),
        ("set_daily_targets", {}, "give"),
    ],
)
def test_a_refused_write_is_a_tool_error_the_agent_can_act_on(
    agent: TestClient,
    conn: sqlite3.Connection,
    uid: int,
    writer: str,
    name: str,
    arguments: dict[str, Any],
    words: str,
) -> None:
    assert words in write_error(agent, writer, name, arguments)
    assert rows(conn) == (0, 0, 0)


@pytest.mark.parametrize(
    "arguments",
    [
        {"name": "week_summary", "arguments": {"week": "9999-12-27"}},
        {"name": "weeks", "arguments": {"end": "9999-12-27"}},
        {"name": "weeks", "arguments": {"start": "9999-12-20", "end": "9999-12-27"}},
        {"name": "weeks", "arguments": {"end": "0001-01-01"}},
    ],
)
def test_a_week_at_the_calendars_end_is_refused_by_name(
    agent: TestClient, token: str, arguments: dict[str, Any]
) -> None:
    assert OUT_OF_RANGE in tool_error(agent, token, arguments["name"], **arguments["arguments"])


def test_the_resource_metadata_url_answers_the_protected_resource_document(
    agent: TestClient, uid: int
) -> None:
    """It answered 404 before OAuth (F1); now it is the document claude.ai starts sign-in from."""
    header = call(agent, "initialize", INITIALIZE).headers["www-authenticate"]
    url = header.split('resource_metadata="', 1)[1].split('"', 1)[0]
    assert url == f"{ORIGIN}/.well-known/oauth-protected-resource/api/mcp"
    r = agent.get(url)
    assert r.status_code == 200
    assert r.json() == {
        "resource": f"{ORIGIN}{MCP_PATH}",
        "authorization_servers": [ORIGIN],
        "scopes_supported": ["read", "write"],
        "bearer_methods_supported": ["header"],
    }
