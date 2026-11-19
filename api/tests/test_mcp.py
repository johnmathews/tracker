"""The MCP endpoint at /api/mcp through TestClient: the handshake and `whoami` with a token, and
every refusal. Each refusal that differs from REST is checked against a REST route as well, so a
guard exemption that widened past /api/mcp fails here (docs/api.md §3.1)."""

import copy
import json
import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from tracker_api import auth, data, mcp_server, oauth
from tracker_api.app import MAX_BODY, create_app
from tracker_api.config import Config
from tracker_api.data import create_tracker, end_tracker, put_settings
from tracker_api.edits import new_id
from tracker_api.mcp_server import MCP_PATH, OUT_OF_RANGE, caller
from tracker_api.programme import FORMAT, check_programme, programme_schema
from tracker_api.programme_replay import CHANGE_KEYS, CHANGE_TYPES

from .conftest import ORIGIN, START, Clock
from .test_insights import CASES
from .test_insights import load as load_tracked
from .test_oauth import StubFetch, approve
from .test_programmes_api import doc

EMAIL = "alice@example.com"
PASSWORD = "correct horse battery"
ACCEPT = "application/json, text/event-stream"
READ_TOOLS = [
    "list_trackers",
    "week_summary",
    "weeks",
    "item_history",
    "goals",
    "consistency",
    "programme_format",
    "list_programmes",
    "get_programme",
    "list_shared_programmes",
]
WRITE_TOOLS = [
    "add_item",
    "update_item",
    "remove_item",
    "mark_day",
    "set_daily_targets",
    "save_programme",
    "copy_programme",
    "start_programme",
    "change_programme",
    "end_programme",
    "restart_programme",
    "reopen_programme",
]
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


def goal_items(goals: dict[str, Any], tracker_id: str) -> list[dict[str, Any]]:
    """One tracker's items in the `goals` result."""
    (tracker,) = [t for t in goals["trackers"] if t["id"] == tracker_id]
    return tracker["items"]  # type: ignore[no-any-return]


def daily_targets(goals: dict[str, Any]) -> dict[str, int | None]:
    return {t["id"]: t["daily_target"] for t in goals["trackers"]}


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
    assert "list_trackers" in props["tracker"]["description"]
    assert "name" in props["tracker"]["description"]
    # `section`, the old name, stays for older clients.
    assert props["section"]["anyOf"][0]["enum"] == ["exercise", "cardio", "diet"]
    assert "older clients" in props["section"]["description"]
    assert "Monday" in props["week"]["description"]
    for name in ("week_summary", "weeks", "item_history", "consistency"):
        assert {"tracker", "section"} <= set(tools[name]["inputSchema"]["properties"]), name


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
    assert out["tracker"] == "exercise"
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
    assert goal_items(tool(agent, token, "goals"), "exercise")[0]["notes"] == cut
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
    exercise = goal_items(out, "exercise")
    assert [(g["id"], g["target"]) for g in exercise][:2] == [("pu", 4), ("pl", 4)]
    assert goal_items(out, "cardio") == []
    assert [g["name"] for g in goal_items(out, "diet")] == ["Vegetables", "Fruit", "Fish", "Nuts"]
    assert [(t["id"], t["name"], t["kind"], t["daily_target"]) for t in out["trackers"]] == [
        ("exercise", "Strength", "strength", 3),
        ("cardio", "Cardio", "cardio", None),
        ("diet", "Food", "food", 2),
    ]
    assert out["daily_goal"] is True
    assert out["note"] == ""
    assert out["limits"] == ""


def test_goals_returns_my_goals_and_the_limits_note(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str
) -> None:
    """K107: a Claude connection reads both notes, and the tool and its result say so."""
    put_settings(conn, uid, {"goals": "Run 5 km.", "limits": "Bad left knee."})
    out = tool(agent, token, "goals")
    assert (out["note"], out["limits"]) == ("Run 5 km.", "Bad left knee.")
    tools = {t["name"]: t for t in result(call(agent, "tools/list", token=token))["tools"]}
    assert "limits note" in tools["goals"]["description"]
    schema = tools["goals"]["outputSchema"]
    assert schema["properties"]["limits"]["type"] == "string"
    assert "limits" in schema["required"]


def test_the_reads_leave_daily_targets_out_while_daily_goal_is_off(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str
) -> None:
    """K85: with Daily goal off an MCP client sees no daily target and no met day, and the tools
    that describe them say so. Item goals stay."""
    plan = [{"id": "sq", "name": "Squats", "reps": 10, "target": 1}]
    load_tracked(
        conn,
        uid,
        exercise={"plans": {THIS_WEEK: plan}, "log": {THIS_WEEK: {"sq": ["great"] + [None] * 6}}},
        settings={"dailyPick": 1, "dailyGoal": False},
    )
    goals = tool(agent, token, "goals")
    assert {t["daily_target"] for t in goals["trackers"]} == {None}
    assert goals["daily_goal"] is False
    assert {t["daily_target"] for t in tool(agent, token, "list_trackers")["trackers"]} == {None}
    week = tool(agent, token, "week_summary")
    assert (week["daily_target"], week["days_met"], week["goals_met"]) == (None, None, 1)
    assert {d["met"] for d in week["days"]} == {None}
    assert {d["met"] for w in tool(agent, token, "weeks")["weeks"] for d in w["days"]} == {None}
    steady = tool(agent, token, "consistency")
    assert (steady["days_met"], steady["met_day_rate"], steady["met_day_streak"]) == (
        None,
        None,
        None,
    )
    tools = {t["name"]: t for t in result(call(agent, "tools/list", token=token))["tools"]}
    for name in ("list_trackers", "week_summary", "goals", "consistency", "set_daily_targets"):
        assert "Daily goal is off" in tools[name]["description"], name
    # The result's schema lets the nulls through.
    assert tools["goals"]["outputSchema"]["properties"]["daily_goal"]["type"] == "boolean"


def test_consistency_defaults_to_eight_weeks(agent: TestClient, uid: int, token: str) -> None:
    out = tool(agent, token, "consistency")
    assert out["tracker"] == "exercise"
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
def test_an_unknown_tracker_is_a_tool_error_naming_the_field(
    agent: TestClient, uid: int, token: str, name: str
) -> None:
    extra = {"item_id": "sq"} if name == "item_history" else {}
    text = tool_error(agent, token, name, tracker="sleep", **extra)
    assert text.endswith(
        ": tracker: no tracker has the id or name 'sleep'; the trackers are exercise (Strength), "
        "cardio (Cardio), diet (Food)"
    )
    # `section` is checked against its three ids, by the schema.
    assert "section" in tool_error(agent, token, name, section="sleep", **extra)
    # Both given must agree.
    text = tool_error(agent, token, name, tracker="Food", section="cardio", **extra)
    assert text.endswith(": tracker: give tracker or section, not both")


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
    elif case["section"] == "cardio":
        load_tracked(conn, uid, cardio=case)
    else:
        load_tracked(conn, uid, diet=case, settings={"foodPick": case["dailyTarget"]})
    day = datetime.fromisoformat(case["today"]).replace(hour=12, tzinfo=UTC)
    clock.now = int(day.timestamp())
    out = tool(agent, token, "week_summary", section=case["section"], week=case["week"])
    assert out["today"] == case["today"]
    assert out["plan_week"] == expected["planWeek"]
    # No daily target (cardio, K90): each day's `met` is null, as with Daily goal off.
    no_target = case["dailyTarget"] is None
    assert [d["met"] for d in out["days"]] == ([None] * 7 if no_target else expected["metDays"])
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
    "save_programme": {"destructiveHint": False, "idempotentHint": False},
    # Adds a library programme, as save_programme does: a second call adds a second copy.
    "copy_programme": {"destructiveHint": False, "idempotentHint": False},
    "start_programme": {"destructiveHint": False, "idempotentHint": False},
    # A confirm moves the log's rev on, so the same confirm again only previews.
    "change_programme": {"destructiveHint": False, "idempotentHint": True},
    # Deletes nothing, and a second confirm is refused as ended.
    "end_programme": {"destructiveHint": False, "idempotentHint": True},
    # Adds a tracker, as start_programme does; the end it may write deletes nothing.
    "restart_programme": {"destructiveHint": False, "idempotentHint": False},
    # Like end_programme: deletes nothing, and a second confirm is refused as not ended.
    "reopen_programme": {"destructiveHint": False, "idempotentHint": True},
}
WRITE_CALLS: dict[str, dict[str, Any]] = {
    "add_item": {"name": "Dips"},
    "update_item": {"item_id": "sq", "times_a_week": 5},
    "remove_item": {"item_id": "sq"},
    "mark_day": {"item_id": "sq", "mark": "great"},
    "set_daily_targets": {"exercises_a_day": 4},
    "save_programme": {"doc": {"format": "tracker-programme/1"}},
    "copy_programme": {"programme": "xs1"},
    "start_programme": {"programme": "x1"},
    "change_programme": {"tracker": "exercise", "change": {"type": "go-to-week", "week": 2}},
    "end_programme": {"tracker": "exercise"},
    "restart_programme": {"tracker": "exercise"},
    "reopen_programme": {"tracker": "exercise"},
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


def test_cardio_through_the_tools(
    agent: TestClient, client: TestClient, uid: int, writer: str
) -> None:
    """K90: a cardio item takes a whole session's seconds and a distance in km, any mark, and
    shows in the app's state; the reads give its session and no daily target."""
    out = write(
        agent,
        writer,
        "add_item",
        {"section": "cardio", "name": "Cycling", "seconds": 5400, "times_a_week": 2},
    )
    cycling = out["item"]
    assert cycling == {"id": cycling["id"], "name": "Cycling", "seconds": 5400, "times_a_week": 2}
    assert (out["before"], out["copied_from"]) == ([], "defaults")
    out = tool(
        agent, writer, "update_item", section="cardio", item_id=cycling["id"], distance_km=21.1
    )
    assert out["item"]["distance_km"] == 21.1
    out = tool(agent, writer, "mark_day", section="cardio", item_id=cycling["id"], mark="missed")
    assert out["after"] == "missed"
    summary = tool(agent, writer, "week_summary", section="cardio")
    assert (summary["daily_target"], summary["days_met"]) == (None, None)
    (item,) = summary["items"]
    assert (item["seconds"], item["distance_km"], item["missed"]) == (5400, 21.1, 1)
    assert goal_items(tool(agent, writer, "goals"), "cardio")[0]["seconds"] == 5400
    login = client.post("/api/auth/login", json={"username": EMAIL, "password": PASSWORD})
    assert login.status_code == 200
    state = client.get("/api/state").json()["cardio"]
    assert state["plans"][THIS_WEEK] == [
        {
            "id": cycling["id"],
            "name": "Cycling",
            "duration": 5400,
            "distance": 21.1,
            "target": 2,
        }
    ]
    # An exercise's fields are refused by name, as a food's are.
    arguments = {"section": "cardio", "item_id": "x", "reps": 3}
    assert "reps: a cardio item has no reps" in write_error(agent, writer, "update_item", arguments)


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
    """The older form still works: `foods_a_day` is the `diet` tracker's target."""
    out = tool(agent, writer, "set_daily_targets", foods_a_day=4)
    assert out == {
        "targets": [{"tracker": "diet", "name": "Food", "before": 2, "after": 4}],
        "daily_goal": True,
    }
    assert daily_targets(tool(agent, writer, "goals"))["diet"] == 4


def test_set_daily_targets_keeps_working_while_daily_goal_is_off(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    """The numbers are kept for when Daily goal is back on; the result says it is off."""
    put_settings(conn, uid, {"accent": "#30d158", "dailyPick": 3, "dailyGoal": False})
    out = tool(agent, writer, "set_daily_targets", tracker="strength", daily_target=5)
    assert out == {
        "targets": [{"tracker": "exercise", "name": "Strength", "before": 3, "after": 5}],
        "daily_goal": False,
    }
    assert daily_targets(tool(agent, writer, "goals"))["exercise"] is None
    put_settings(conn, uid, {"accent": "#30d158", "dailyPick": 5, "dailyGoal": True})
    assert daily_targets(tool(agent, writer, "goals"))["exercise"] == 5


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
        ("set_daily_targets", {"tracker": "diet"}, "daily_target: "),
        ("set_daily_targets", {"daily_target": 3}, "tracker: "),
        ("set_daily_targets", {"tracker": "cardio", "daily_target": 3}, "no daily target"),
        ("add_item", {"name": "Dips", "tracker": "sleep"}, "tracker: no tracker"),
        ("add_item", {"name": "Dips", "tracker": "diet", "section": "exercise"}, "not both"),
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


# --- the account's own trackers (spec §4, "Claude tools") -----------------------------------------


def test_the_instructions_describe_the_persons_own_trackers(agent: TestClient, token: str) -> None:
    info = result(call(agent, "initialize", INITIALIZE, token=token))
    text = info["instructions"]
    assert "the person's own trackers" in text
    assert "list_trackers" in text
    assert "exercise, cardio and food plans" not in text


def test_list_trackers_lists_a_created_tracker(
    agent: TestClient, conn: sqlite3.Connection, uid: int, token: str
) -> None:
    create_tracker(conn, uid, "xyoga1", "Yoga", "strength", THIS_WEEK)
    create_tracker(conn, uid, "xold1", "Old", "food", "2026-10-05")
    end_tracker(conn, uid, "xold1", THIS_WEEK)
    out = tool(agent, token, "list_trackers")
    assert (out["this_week"], out["today"], out["daily_goal"]) == (THIS_WEEK, TODAY, True)
    assert [(t["id"], t["name"], t["kind"], t["shows_this_week"]) for t in out["trackers"]] == [
        ("exercise", "Strength", "strength", True),
        ("cardio", "Cardio", "cardio", True),
        ("diet", "Food", "food", True),
        ("xyoga1", "Yoga", "strength", True),
        ("xold1", "Old", "food", False),
    ]
    assert out["trackers"][3] == {
        "id": "xyoga1",
        "name": "Yoga",
        "kind": "strength",
        "daily_target": 3,
        "start_week": THIS_WEEK,
        "end_week": None,
        "shows_this_week": True,
    }
    assert (out["trackers"][4]["start_week"], out["trackers"][4]["end_week"]) == (
        "2026-10-05",
        THIS_WEEK,
    )


@pytest.mark.parametrize("ref", ["xyoga1", "Yoga", "yoga"])
def test_add_item_and_mark_day_on_a_new_tracker(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str, ref: str
) -> None:
    """A tracker the person made, named by its id or its name in any case."""
    create_tracker(conn, uid, "xyoga1", "Yoga", "strength", THIS_WEEK)
    out = write(agent, writer, "add_item", {"tracker": ref, "name": "Plank", "seconds": 60})
    assert (out["tracker"], out["before"], out["copied_from"]) == ("xyoga1", [], "defaults")
    plank = out["item"]
    out = tool(agent, writer, "mark_day", tracker=ref, item_id=plank["id"], mark="partial")
    assert (out["tracker"], out["after"]) == ("xyoga1", "partial")
    summary = tool(agent, writer, "week_summary", tracker=ref)
    assert summary["tracker"] == "xyoga1"
    assert [(it["name"], it["partial"]) for it in summary["items"]] == [("Plank", 1)]
    assert [it["name"] for it in goal_items(tool(agent, writer, "goals"), "xyoga1")] == ["Plank"]
    history = tool(agent, writer, "item_history", tracker=ref, item_id=plank["id"], weeks=2)
    assert [w["in_plan"] for w in history["weeks"]] == [False, True]
    # The first Strength tracker's defaults are its own.
    assert tool(agent, writer, "week_summary")["items"][0]["id"] == "pu"


def test_add_item_on_a_mobility_tracker_takes_holds_and_reps_and_no_weight(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    """W8: a mobility item has sets, then reps or seconds, each side, and no weight."""
    create_tracker(conn, uid, "xmob1", "Mobility", "mobility", THIS_WEEK)
    hold = {"tracker": "Mobility", "name": "Hip hold", "sets": 2, "seconds": 45, "per_side": True}
    out = write(agent, writer, "add_item", hold)
    assert out["tracker"] == "xmob1"
    assert {k: v for k, v in out["item"].items() if k != "id"} == {
        "name": "Hip hold",
        "sets": 2,
        "reps": 0,
        "seconds": 45,
        "per_side": True,
        "times_a_week": 3,
    }
    reps = write(agent, writer, "add_item", {"tracker": "xmob1", "name": "Cat-cow", "reps": 10})
    assert (reps["item"]["reps"], "seconds" in reps["item"]) == (10, False)
    for field, value in (("weight_kg", 8), ("distance_km", 2)):
        text = write_error(
            agent, writer, "add_item", {"tracker": "xmob1", "name": "Dips", field: value}
        )
        assert f"{field}: a mobility item has no {field}" in text
    both = {"tracker": "xmob1", "name": "Both", "reps": 5, "seconds": 30}
    assert "give reps or seconds, not both" in write_error(agent, writer, "add_item", both)
    summary = tool(agent, writer, "week_summary", tracker="xmob1")
    assert [it["name"] for it in summary["items"]] == ["Hip hold", "Cat-cow"]
    assert daily_targets(tool(agent, writer, "goals"))["xmob1"] == 3


def test_an_ended_tracker_is_absent_from_its_end_week_on(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    create_tracker(conn, uid, "xyoga1", "Yoga", "strength", "2026-10-12")
    write(agent, writer, "add_item", {"tracker": "Yoga", "name": "Plank", "week": "2026-10-12"})
    end_tracker(conn, uid, "xyoga1", THIS_WEEK)
    text = write_error(agent, writer, "add_item", {"tracker": "Yoga", "name": "Dips"})
    assert text.endswith(
        "week: Yoga (xyoga1) was deleted from the week of 2026-10-19 on, so the week of "
        "2026-10-19 doesn't show it; its earlier weeks still do"
    )
    assert "doesn't show it" in tool_error(agent, writer, "week_summary", tracker="Yoga")
    assert "xyoga1" not in daily_targets(tool(agent, writer, "goals"))
    weeks = tool(agent, writer, "weeks", tracker="Yoga")
    assert [w["week"] for w in weeks["weeks"]] == ["2026-10-12"]
    # Its earlier weeks still read and take changes.
    earlier = tool(agent, writer, "week_summary", tracker="Yoga", week="2026-10-12")
    assert [it["name"] for it in earlier["items"]] == ["Plank"]
    out = write(
        agent, writer, "add_item", {"tracker": "Yoga", "name": "Dips", "week": "2026-10-12"}
    )
    assert [it["name"] for it in out["after"]] == ["Plank", "Dips"]


def test_section_still_names_the_first_three_trackers(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    """Older clients send `section`; it reads and writes as `tracker` does."""
    out = write(agent, writer, "add_item", {"section": "diet", "name": "Beans"})
    assert out["tracker"] == "diet"
    by_section = tool(agent, writer, "week_summary", section="diet")
    assert by_section == tool(agent, writer, "week_summary", tracker="diet")
    assert by_section == tool(agent, writer, "week_summary", tracker="diet", section="diet")
    assert by_section["items"][-1]["name"] == "Beans"
    beans = out["item"]["id"]
    assert tool(agent, writer, "mark_day", section="diet", item_id=beans, mark="great")["after"]
    assert tool(agent, writer, "consistency", section="diet", weeks=1)["tracker"] == "diet"


def test_goals_and_daily_targets_per_tracker(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    create_tracker(conn, uid, "xsnack1", "Snacks", "food", THIS_WEEK)
    out = tool(agent, writer, "set_daily_targets", tracker="snacks", daily_target=1)
    assert out == {
        "targets": [{"tracker": "xsnack1", "name": "Snacks", "before": 2, "after": 1}],
        "daily_goal": True,
    }
    goals = tool(agent, writer, "goals")
    assert daily_targets(goals) == {"exercise": 3, "cardio": None, "diet": 2, "xsnack1": 1}
    assert goal_items(goals, "xsnack1") == []
    # The older form sets the first trackers', beside a new one's.
    out = tool(
        agent, writer, "set_daily_targets", tracker="xsnack1", daily_target=4, exercises_a_day=5
    )
    assert [(t["tracker"], t["after"]) for t in out["targets"]] == [("xsnack1", 4), ("exercise", 5)]
    assert daily_targets(tool(agent, writer, "goals"))["exercise"] == 5
    assert tool(agent, writer, "week_summary", tracker="Snacks")["daily_target"] == 4


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


# --- programmes (docs/specs/2026-11-17-programmes.md §11.3) ---------------------------------------

NEXT_MONDAY = "2026-10-26"
YESTERDAY = "2026-10-22"
#: The worked example `programme_format` gives: the spec's §3.1 document, from the fixtures.
EXAMPLE = doc("spec-example")
NAME = EXAMPLE["name"]
PAUSE_SQUAT = {"type": "pause-activity", "activity": "squat", "weeks": 2}
LONGER_PLANK = {"type": "set-value", "activity": "plank", "field": "duration", "value": 45}


def refused(client: TestClient, token: str, tool_name: str, arguments: dict[str, Any]) -> str:
    """`write_error` without the SDK's prefix: the refusal as the tool words it."""
    text = write_error(client, token, tool_name, arguments)
    prefix = f"Error executing tool {tool_name}: "
    assert text.startswith(prefix), text
    return text.removeprefix(prefix)


def go_to(clock: Clock, day: str) -> None:
    """Move the clock to the same time of day on `day`."""
    clock.now = START + (date.fromisoformat(day) - date.fromisoformat(TODAY)).days * 86_400


def save(client: TestClient, token: str, document: object = None) -> dict[str, Any]:
    """`save_programme` for a document it takes: the stored programme."""
    out = write(client, token, "save_programme", {"doc": EXAMPLE if document is None else document})
    return out["programme"]  # type: ignore[no-any-return]


def running(client: TestClient, token: str, **start: Any) -> dict[str, Any]:
    """The example saved and started (today, unless `start` says): `start_programme`'s result."""
    programme_id = save(client, token)["id"]
    return write(client, token, "start_programme", {"programme": programme_id, **start})  # type: ignore[no-any-return]


def change(client: TestClient, token: str, tracker: str, body: Any, **extra: Any) -> Any:
    return write(client, token, "change_programme", {"tracker": tracker, "change": body, **extra})


def confirmed(client: TestClient, token: str, tracker: str, body: Any, **extra: Any) -> Any:
    """Preview a change, then confirm it with the preview's rev."""
    preview = change(client, token, tracker, body, **extra)
    return change(client, token, tracker, body, confirm=True, rev=preview["rev"], **extra)


def targets(summary: dict[str, Any]) -> dict[str, int]:
    return {it["id"]: it["target"] for it in summary["items"]}


def test_an_agent_saves_starts_and_changes_a_programme_through_mcp_alone(
    agent: TestClient, uid: int, writer: str
) -> None:
    """The plan's W5 acceptance: the whole loop through MCP calls and nothing else."""
    fmt = tool(agent, writer, "programme_format")
    document = copy.deepcopy(fmt["example"])
    broken = copy.deepcopy(document)
    broken["weeks"] = 0
    broken["activities"][0]["weight"]["add"] = 2.5
    text = refused(agent, writer, "save_programme", {"doc": broken})
    assert text.startswith("doc: the programme has 2 problems, so nothing was saved.")
    assert "\n- weeks: give a whole number from 1 to 52." in text
    assert "\n- activities[0].weight.rate: a progression has add or rate, not both." in text
    assert tool(agent, writer, "list_programmes")["programmes"] == []

    saved = save(agent, writer, document)
    assert (saved["name"], saved["rev"], saved["weeks"]) == (NAME, 1, 8)
    started = write(agent, writer, "start_programme", {"programme": saved["id"]})
    tracker = started["tracker"]["id"]
    assert (started["tracker"]["name"], started["tracker"]["kind"]) == (NAME, "strength")
    assert (started["run"]["status"], started["run"]["week"], started["run"]["start"]) == (
        "running",
        1,
        TODAY,
    )

    preview = change(agent, writer, tracker, PAUSE_SQUAT, from_date=NEXT_MONDAY, reason="Knee.")
    assert (preview["preview"], preview["stale"]) == (True, False)
    assert "confirm" in preview["message"]
    assert {(c["key"], c["monday"]) for c in preview["cells"]} >= {("squat", NEXT_MONDAY)}
    assert targets(tool(agent, writer, "week_summary", tracker=tracker, week=NEXT_MONDAY)) == {
        "squat": 3,
        "plank": 3,
    }
    applied = change(
        agent,
        writer,
        tracker,
        PAUSE_SQUAT,
        from_date=NEXT_MONDAY,
        reason="Knee.",
        confirm=True,
        rev=preview["rev"],
    )
    assert (applied["preview"], applied["stale"]) == (False, False)
    entry = applied["change"]
    assert (entry["from"], entry["change"], entry["reason"], entry["source"]) == (
        NEXT_MONDAY,
        PAUSE_SQUAT,
        "Knee.",
        "agent",
    )

    week = tool(agent, writer, "week_summary", tracker=tracker, week=NEXT_MONDAY)
    assert week["tracker"] == tracker
    assert targets(week) == {"squat": 0, "plank": 3}
    # This week, before the change's from day, is as it was: started on a Friday, so each goal
    # at 3 counts Friday to Sunday, 3 x 3 / 7 rounded up (K163).
    assert targets(tool(agent, writer, "week_summary", tracker=tracker)) == {"squat": 2, "plank": 2}


#: Wednesday of the week of NEXT_MONDAY.
WEDNESDAY = "2026-10-28"


@pytest.mark.parametrize(
    ("marked", "done", "met"),
    [
        ([NEXT_MONDAY, "2026-10-27"], 2, True),  # on pace before the pause: "2 of 1", met
        ([], 0, False),  # behind before the pause: "0 of 1", missed
    ],
)
def test_every_read_tool_counts_a_split_weeks_goal_by_its_days(
    agent: TestClient,
    uid: int,
    writer: str,
    clock: Clock,
    marked: list[str],
    done: int,
    met: bool,
) -> None:
    """John's squat (#86, K163): 3 a week, paused from Wednesday. Its goal for the week is 3 x 2 /
    7, rounded up: 1, and every read tool says so, this week and once it is past."""
    tracker = running(agent, writer, start=NEXT_MONDAY)["tracker"]["id"]
    go_to(clock, "2026-10-27")
    for day in marked:
        write(
            agent,
            writer,
            "mark_day",
            {"tracker": tracker, "item_id": "squat", "date": day, "mark": "great"},
        )
    pause = {"type": "pause-activity", "activity": "squat"}
    confirmed(agent, writer, tracker, pause, from_date=WEDNESDAY, reason="Knee.")

    def squat_of(items: list[dict[str, Any]]) -> dict[str, Any]:
        return next(it for it in items if it["id"] == "squat")

    week = tool(agent, writer, "week_summary", tracker=tracker)
    squat = squat_of(week["items"])
    assert (squat["done"], squat["target"], squat["goal_met"]) == (done, 1, met)
    assert targets(week) == {"squat": 1, "plank": 3}
    assert squat_of(goal_items(tool(agent, writer, "goals"), tracker))["target"] == 1

    # The week past: the record says the same.
    go_to(clock, "2026-11-03")
    (past,) = tool(agent, writer, "weeks", tracker=tracker, start=NEXT_MONDAY, end=NEXT_MONDAY)[
        "weeks"
    ]
    squat = squat_of(past["items"])
    assert (squat["done"], squat["target"], squat["goal_met"]) == (done, 1, met)
    assert past["goals_met"] == (1 if met else 0)
    history = tool(agent, writer, "item_history", tracker=tracker, item_id="squat", weeks=2)
    first, now = history["weeks"]
    assert first["week"] == NEXT_MONDAY
    assert (first["in_plan"], first["done"], first["target"], first["goal_met"]) == (
        True,
        done,
        1,
        met,
    )
    # Paused all of this week: no goal.
    assert (now["in_plan"], now["target"], now["goal_met"]) == (True, 0, False)
    steady = tool(agent, writer, "consistency", tracker=tracker, weeks=2)
    # One finished week, with two goals: the squat's 1 and the plank's 3, not done.
    assert (steady["finished_weeks"], steady["goals"], steady["goals_met"]) == (
        1,
        2,
        1 if met else 0,
    )
    # The goals tool reads this week: paused, so 0.
    assert squat_of(goal_items(tool(agent, writer, "goals"), tracker))["target"] == 0


def test_programme_format_gives_the_schema_a_worked_example_and_the_changes(
    agent: TestClient, token: str
) -> None:
    """A read token may read the format; the example is the spec's, kept in the package."""
    out = tool(agent, token, "programme_format")
    assert out["format"] == FORMAT
    assert out["schema"] == programme_schema()
    assert out["example"] == EXAMPLE == mcp_server.EXAMPLE
    assert check_programme(out["example"]) == []
    assert [c["type"] for c in out["changes"]] == list(CHANGE_TYPES)
    for c in out["changes"]:
        assert c["keys"] == list(CHANGE_KEYS[c["type"]]), c["type"]
        assert len(c["does"]) > 20, c["type"]
    notes = " ".join(out["notes"])
    for words in ("save_programme", "start_programme", "change_programme", "today or later"):
        assert words in notes, words


def test_save_programme_takes_the_document_as_json_text(
    agent: TestClient, uid: int, writer: str
) -> None:
    """Some agents send a nested object as a string: the tool reads it as the JSON it holds."""
    assert save(agent, writer, json.dumps(EXAMPLE))["name"] == NAME
    text = refused(agent, writer, "save_programme", {"doc": "{not json"})
    assert text == "doc: is not a JSON object; send the object itself"


def test_save_programme_replaces_a_programme_with_its_rev(
    agent: TestClient, uid: int, writer: str
) -> None:
    first = save(agent, writer)
    slower = {**EXAMPLE, "name": f"{NAME}, slower"}
    out = write(
        agent, writer, "save_programme", {"programme": first["id"], "rev": 1, "doc": slower}
    )
    assert (out["programme"]["id"], out["programme"]["rev"]) == (first["id"], 2)
    assert out["programme"]["name"] == slower["name"]
    stale = refused(
        agent, writer, "save_programme", {"programme": first["id"], "rev": 1, "doc": EXAMPLE}
    )
    assert stale.startswith("rev: the programme changed since rev 1; it is at rev 2 now.")
    missing = refused(agent, writer, "save_programme", {"programme": first["id"], "doc": EXAMPLE})
    assert missing.startswith("rev: give the programme's rev")
    unknown = refused(
        agent, writer, "save_programme", {"programme": "nope", "rev": 1, "doc": EXAMPLE}
    )
    assert unknown.startswith("programme: no programme nope in the library")
    assert [p["rev"] for p in tool(agent, writer, "list_programmes")["programmes"]] == [2]


def test_save_programme_refuses_past_the_library_and_size_caps(
    agent: TestClient, uid: int, writer: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(data, "MAX_PROGRAMME_BYTES", 100)
    text = refused(agent, writer, "save_programme", {"doc": EXAMPLE})
    assert text.startswith("doc: the programme has 1 problem, so nothing was saved.")
    assert "\n- doc: the programme is over 100 bytes as stored." in text
    monkeypatch.undo()
    monkeypatch.setattr(data, "MAX_PROGRAMMES", 1)
    save(agent, writer)
    text = refused(agent, writer, "save_programme", {"doc": EXAMPLE})
    assert text.startswith("doc: the library holds 1 programme")
    assert len(tool(agent, writer, "list_programmes")["programmes"]) == 1


@pytest.fixture
def full(config: Config, conn: sqlite3.Connection, uid: int) -> Iterator[tuple[TestClient, str]]:
    """An agent on a server whose quota a fresh account already fills, with its write token."""
    token = auth.create_token(conn, config, EMAIL, "agent", "write")
    small = replace(config, user_quota_bytes=1)
    with TestClient(create_app(small, run_backups=False), base_url=ORIGIN) as c:
        yield c, token


def test_a_full_account_saves_and_starts_nothing(
    full: tuple[TestClient, str], conn: sqlite3.Connection, uid: int
) -> None:
    client, token = full
    assert refused(client, token, "save_programme", {"doc": EXAMPLE}).startswith(
        "quota: the account is full"
    )
    stored = data.add_programme(conn, uid, EXAMPLE, START, quota=10**9, make_id=lambda _: "p1")
    text = refused(client, token, "start_programme", {"programme": stored["id"]})
    assert text.startswith("quota: the account is full")
    assert [t["id"] for t in data.load_trackers(conn, uid)] == ["exercise", "cardio", "diet"]


def test_a_full_account_previews_a_change_but_applies_nothing(
    full: tuple[TestClient, str], conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    """A change that would store more (an activity with its notes) past the quota."""
    client, token = full
    stored = data.add_programme(conn, uid, EXAMPLE, START, quota=10**9, make_id=lambda _: "p1")
    when = data.When(START, config.timezone)
    started = data.start_programme(
        conn, uid, stored["id"], when=when, quota=10**9, make_id=lambda _: "x1"
    )
    assert started is not None
    lunge = {"key": "lunge", "name": "Lunge", "notes": "Slow. " * 200, "target": 2, "reps": 10}
    body = {"type": "add-activity", "activity": lunge}
    preview = change(client, token, "x1", body)
    arguments = {"tracker": "x1", "change": body, "confirm": True, "rev": preview["rev"]}
    text = refused(client, token, "change_programme", arguments)
    assert text == "quota: the account is full, so nothing was changed"
    run = data.read_run(conn, uid, "x1", when)
    assert run is not None
    assert run["log"] == []


def test_list_programmes_gives_the_library_and_the_runs(
    agent: TestClient, uid: int, writer: str, token: str
) -> None:
    started = running(agent, writer, name="Autumn squats")
    out = tool(agent, token, "list_programmes")
    (listed,) = out["programmes"]
    assert (listed["name"], listed["kind"], listed["weeks"], listed["activities"]) == (
        NAME,
        "strength",
        8,
        2,
    )
    assert "doc" not in listed
    (run,) = out["runs"]
    assert run == {
        "tracker": started["tracker"]["id"],
        "trackerName": "Autumn squats",
        "programmeId": listed["id"],
        "name": NAME,
        "status": "running",
        "week": 1,
        "weeks": 8,
        "start": TODAY,
        "end": started["run"]["end"],
        "pausedUntil": None,
        "pausedSince": None,
        "pauseReason": None,
        "rev": started["run"]["rev"],
    }
    assert (out["today"], out["this_week"]) == (TODAY, THIS_WEEK)


def test_get_programme_reads_a_library_programme_or_a_run(
    agent: TestClient, uid: int, writer: str, clock: Clock
) -> None:
    started = running(agent, writer)
    tracker = started["tracker"]["id"]
    programme_id = started["run"]["programmeId"]
    out = tool(agent, writer, "get_programme", programme=programme_id)
    assert (out["programme"]["doc"], out["programme"]["rev"], out["run"]) == (EXAMPLE, 1, None)
    confirmed(agent, writer, tracker, PAUSE_SQUAT, from_date=NEXT_MONDAY, reason="Knee.")
    go_to(clock, "2026-10-28")
    out = tool(agent, writer, "get_programme", tracker=NAME.upper())
    run = out["run"]
    assert out["programme"] is None
    assert (run["tracker"], run["status"], run["week"], run["today"]) == (
        tracker,
        "running",
        2,
        "2026-10-28",
    )
    assert run["clock"]["activities"]["squat"]["state"] == "paused"
    (entry,) = run["log"]
    assert (entry["from"], entry["reason"], entry["source"]) == (NEXT_MONDAY, "Knee.", "agent")
    # The upcoming weeks, from this one: the weeks before are in `weeks` and `week_summary`.
    mondays = [w["monday"] for w in run["grid"]["weeks"]]
    assert mondays[0] == NEXT_MONDAY
    assert len(mondays) == 7


def broken_run(monkeypatch: pytest.MonkeyPatch, tracker: str) -> None:
    """Make one run's replay fail, as an engine change since or a bad row would."""
    real = data._seal_and_replay

    def seal_and_replay(conn: sqlite3.Connection, user_id: int, tracker_id: str, when: Any) -> Any:
        if tracker_id == tracker:
            raise RuntimeError("engine broke")
        return real(conn, user_id, tracker_id, when)

    monkeypatch.setattr(data, "_seal_and_replay", seal_and_replay)


def test_a_run_that_cant_be_read_is_a_plain_refusal_and_the_rest_still_answer(
    agent: TestClient,
    uid: int,
    writer: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A run whose replay fails names itself in a sentence the agent can pass on; the other
    runs still list, and nothing changes."""
    first = running(agent, writer, name="Autumn block")["tracker"]["id"]
    programme_id = tool(agent, writer, "list_programmes")["programmes"][0]["id"]
    other = write(agent, writer, "start_programme", {"programme": programme_id, "name": "Spring"})
    broken_run(monkeypatch, first)
    listed = tool(agent, writer, "list_programmes")
    assert [r["trackerName"] for r in listed["runs"]] == ["Spring"]
    assert refused(agent, writer, "get_programme", {"tracker": first}) == (
        "tracker: Autumn block's programme can't be read right now. The fault is the "
        "server's and is logged; the other trackers still answer. Try again later."
    )
    for arguments in ({}, {"confirm": True, "rev": "0"}):
        text = refused(
            agent,
            writer,
            "change_programme",
            {"tracker": first, "change": PAUSE_SQUAT, **arguments},
        )
        assert text == (
            "tracker: Autumn block's programme can't be read right now, so nothing was "
            "changed. The fault is the server's and is logged; the other trackers still "
            "answer. Try again later."
        )
    assert f"run {first}" in caplog.text
    assert "engine broke" in caplog.text
    # The other run reads and changes as before.
    other_id = other["tracker"]["id"]
    assert tool(agent, writer, "get_programme", tracker=other_id)["run"]["tracker"] == other_id
    assert change(agent, writer, other_id, PAUSE_SQUAT)["preview"] is True


@pytest.mark.parametrize(
    ("arguments", "words"),
    [
        ({}, "programme: give programme (a library id) or tracker (a running one), not both"),
        (
            {"programme": "p1", "tracker": "exercise"},
            "programme: give programme (a library id) or tracker (a running one), not both",
        ),
        ({"programme": "nope"}, "programme: no programme nope in the library"),
        ({"tracker": "Strength"}, "tracker: Strength is not a programme tracker"),
        ({"tracker": "sleep"}, "tracker: no tracker"),
    ],
)
def test_get_programme_refusals(
    agent: TestClient, uid: int, token: str, arguments: dict[str, Any], words: str
) -> None:
    assert refused(agent, token, "get_programme", arguments).startswith(words)


def test_start_programme_lists_every_problem_and_starts_nothing(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    programme_id = save(agent, writer)["id"]
    text = refused(
        agent,
        writer,
        "start_programme",
        {
            "programme": programme_id,
            "start": YESTERDAY,
            "params": {"squat": "heavy", "nope": 3},
            "name": " ",
        },
    )
    assert text.startswith("programme: the start has 4 problems, so nothing was started.")
    for line in (
        "- start: a programme starts today or later.",
        "- name: give a name of 1 to 60 characters.",
        "- params.squat: give a number.",
        "- params.nope: the programme has no parameter called nope.",
    ):
        assert f"\n{line}" in text, line
    unknown = refused(agent, writer, "start_programme", {"programme": "nope"})
    assert unknown.startswith("programme: no programme nope in the library")
    assert [t["id"] for t in data.load_trackers(conn, uid)] == ["exercise", "cardio", "diet"]


def test_start_programme_takes_a_date_parameters_and_a_name(
    agent: TestClient, uid: int, writer: str
) -> None:
    out = running(agent, writer, start=NEXT_MONDAY, params={"squat": 50}, name="Squats")
    run = out["run"]
    assert (out["tracker"]["name"], out["tracker"]["startWeek"]) == ("Squats", NEXT_MONDAY)
    assert (run["status"], run["start"], run["params"]["squat"]) == ("upcoming", NEXT_MONDAY, 50)


def test_start_programme_refuses_past_the_tracker_cap(
    agent: TestClient, uid: int, writer: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    programme_id = save(agent, writer)["id"]
    monkeypatch.setattr(data, "MAX_TRACKERS", 3)
    text = refused(agent, writer, "start_programme", {"programme": programme_id})
    assert text.startswith("tracker: the account has 3 trackers, the most it can hold")


def test_a_stale_confirm_previews_the_change_again_and_says_so(
    agent: TestClient, uid: int, writer: str
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    first = change(agent, writer, tracker, PAUSE_SQUAT, from_date=NEXT_MONDAY)
    confirmed(agent, writer, tracker, LONGER_PLANK, from_date=NEXT_MONDAY)
    out = change(
        agent, writer, tracker, PAUSE_SQUAT, from_date=NEXT_MONDAY, confirm=True, rev=first["rev"]
    )
    assert (out["preview"], out["stale"]) == (True, True)
    assert out["rev"] != first["rev"]
    assert out["message"].startswith("That rev doesn't confirm this change: the programme changed")
    assert (
        targets(tool(agent, writer, "week_summary", tracker=tracker, week=NEXT_MONDAY))["squat"]
        == 3
    )
    out = change(
        agent, writer, tracker, PAUSE_SQUAT, from_date=NEXT_MONDAY, confirm=True, rev=out["rev"]
    )
    assert (out["preview"], out["stale"]) == (False, False)
    assert [e["seq"] for e in out["run"]["log"]] == [2, 1]


def test_a_confirm_with_the_runs_rev_or_another_change_is_previewed_again(
    agent: TestClient, uid: int, writer: str
) -> None:
    """get_programme's rev is the log's: it confirms nothing. Nor does a preview's rev confirm
    any change but the one it previewed (P2)."""
    tracker = running(agent, writer)["tracker"]["id"]
    rev = tool(agent, writer, "get_programme", tracker=tracker)["run"]["rev"]
    out = change(agent, writer, tracker, PAUSE_SQUAT, from_date=NEXT_MONDAY, confirm=True, rev=rev)
    assert (out["preview"], out["stale"], out["change"]["change"]) == (True, True, PAUSE_SQUAT)
    assert out["rev"] != rev
    first = change(agent, writer, tracker, PAUSE_SQUAT, from_date=NEXT_MONDAY)
    out = change(
        agent, writer, tracker, LONGER_PLANK, from_date=NEXT_MONDAY, confirm=True, rev=first["rev"]
    )
    assert (out["preview"], out["stale"], out["change"]["change"]) == (True, True, LONGER_PLANK)
    out = change(
        agent,
        writer,
        tracker,
        PAUSE_SQUAT,
        from_date=NEXT_MONDAY,
        reason="Knee.",
        confirm=True,
        rev=first["rev"],
    )
    assert (out["preview"], out["stale"], out["change"]["reason"]) == (True, True, "Knee.")
    assert tool(agent, writer, "get_programme", tracker=tracker)["run"]["log"] == []
    out = change(
        agent, writer, tracker, PAUSE_SQUAT, from_date=NEXT_MONDAY, confirm=True, rev=first["rev"]
    )
    assert (out["preview"], out["stale"]) == (False, False)


def test_change_programme_defaults_to_today(agent: TestClient, uid: int, writer: str) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    out = confirmed(agent, writer, tracker, LONGER_PLANK)
    assert out["change"]["from"] == TODAY
    assert out["message"].startswith(f"Changed from {TODAY}.")


@pytest.mark.parametrize(
    ("arguments", "words"),
    [
        (
            {"change": PAUSE_SQUAT, "from_date": YESTERDAY},
            "change: the change has 2 problems, so nothing was changed. Fix each one and send it "
            "again.\n"
            "- from_date: a change starts today or later.\n"
            "- from_date: the programme starts on Fri 23 Oct.",
        ),
        ({"change": PAUSE_SQUAT, "confirm": True}, "- rev: give the rev of the preview."),
        ({"change": {"type": "stop"}}, "- change.type: give one of pause-programme"),
        ({"change": PAUSE_SQUAT, "from_date": "next week"}, "- from_date: give a date"),
        ({"change": PAUSE_SQUAT, "reason": "x" * 501}, "- reason: a reason is at most 500"),
    ],
)
def test_a_refused_change_lists_its_problems_and_changes_nothing(
    agent: TestClient, uid: int, writer: str, arguments: dict[str, Any], words: str
) -> None:
    started = running(agent, writer)
    tracker = started["tracker"]["id"]
    text = refused(agent, writer, "change_programme", {"tracker": tracker, **arguments})
    assert words in text
    assert tool(agent, writer, "get_programme", tracker=tracker)["run"]["log"] == []


def test_change_programme_refuses_an_ordinary_or_an_ended_tracker(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int, writer: str
) -> None:
    text = refused(
        agent, writer, "change_programme", {"tracker": "exercise", "change": PAUSE_SQUAT}
    )
    assert text.startswith("tracker: Strength is not a programme tracker")
    tracker = running(agent, writer)["tracker"]["id"]
    data.end_run(conn, uid, tracker, when=data.When(START, config.timezone))
    text = refused(agent, writer, "change_programme", {"tracker": tracker, "change": PAUSE_SQUAT})
    assert text == (
        f"tracker: {NAME} has ended, so its programme takes no more changes. restart_programme "
        "starts it again as a new run from week 1, and reopen_programme carries it on where it "
        "stopped"
    )


@pytest.mark.parametrize(
    ("name", "arguments"),
    [
        ("add_item", {"name": "Dips"}),
        ("update_item", {"item_id": "squat", "weight_kg": 50}),
        ("update_item", {"item_id": "squat", "weight_kg": 50, "note": "Knees out."}),
        ("remove_item", {"item_id": "squat"}),
    ],
)
def test_the_item_tools_refuse_a_programme_tracker_and_name_change_programme(
    agent: TestClient, uid: int, writer: str, name: str, arguments: dict[str, Any]
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    before = tool(agent, writer, "week_summary", tracker=tracker)
    text = refused(agent, writer, name, {"tracker": tracker, **arguments})
    assert text.startswith(f"tracker: {NAME} is a programme tracker: its plan comes from")
    assert "change_programme" in text
    assert tool(agent, writer, "week_summary", tracker=tracker) == before


def test_a_note_alone_on_a_programme_item_changes_no_plan(
    agent: TestClient, uid: int, writer: str
) -> None:
    """An item's note is the item's, not the plan's (D3), so it is open as in the app."""
    tracker = running(agent, writer)["tracker"]["id"]
    out = write(
        agent, writer, "update_item", {"tracker": tracker, "item_id": "plank", "note": "Flat back."}
    )
    assert out["item"]["note"] == "Flat back."

    def plan(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{k: v for k, v in it.items() if k != "note"} for it in items]

    assert plan(out["after"]) == plan(out["before"])
    assert out["copied_from"] is None
    summary = tool(agent, writer, "week_summary", tracker=tracker)
    assert {it["id"]: it["notes"] for it in summary["items"]}["plank"] == "Flat back."


def mark_events(conn: sqlite3.Connection) -> list[tuple[Any, ...]]:
    return [
        tuple(r)
        for r in conn.execute(
            "SELECT date, item_id, mark, source, late FROM mark_events ORDER BY rowid"
        )
    ]


def test_mark_day_on_a_programme_tracker_follows_the_lock(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str, clock: Clock
) -> None:
    """Spec §8, S6: today and yesterday are open, yesterday's mark is late, and an earlier day
    is refused by its date. Each mark is evidence, with the connection as its source."""
    go_to(clock, THIS_WEEK)
    tracker = running(agent, writer)["tracker"]["id"]
    go_to(clock, TODAY)
    out = tool(agent, writer, "mark_day", tracker=tracker, item_id="squat", mark="great")
    assert (out["date"], out["after"], out["late"]) == (TODAY, "great", False)
    out = tool(
        agent, writer, "mark_day", tracker=tracker, item_id="squat", mark="partial", date=YESTERDAY
    )
    assert (out["date"], out["after"], out["late"]) == (YESTERDAY, "partial", True)
    text = refused(
        agent,
        writer,
        "mark_day",
        {"tracker": tracker, "item_id": "squat", "mark": "great", "date": "2026-10-21"},
    )
    assert text.startswith("date: 2026-10-21 is locked.")
    assert "today's and yesterday's" in text
    assert mark_events(conn) == [
        (TODAY, "squat", "great", "agent", 0),
        (YESTERDAY, "squat", "partial", "agent", 1),
    ]
    # An ordinary tracker keeps no lock and no evidence.
    out = tool(agent, writer, "mark_day", item_id="sq", mark="great", date="2026-10-19")
    assert out["after"] == "great"
    assert "late" not in out
    assert len(mark_events(conn)) == 2


def test_an_oauth_connection_is_the_source_by_its_apps_name(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int, writer: str
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    resolver = oauth.ClientResolver(config.oauth_client_hosts, config.clock, StubFetch())
    claude = approve(conn, config, resolver, uid, write=True).redeem(conn, config).access_token
    confirmed(agent, claude, tracker, LONGER_PLANK, reason="Stronger core.")
    tool(agent, claude, "mark_day", tracker=tracker, item_id="plank", mark="great")
    log = tool(agent, writer, "get_programme", tracker=tracker)["run"]["log"]
    assert [e["source"] for e in log] == ["Claude"]
    assert mark_events(conn) == [(TODAY, "plank", "great", "Claude", 0)]


def test_the_instructions_tell_an_agent_how_to_add_a_programme(
    agent: TestClient, token: str
) -> None:
    text = result(call(agent, "initialize", INITIALIZE, token=token))["instructions"]
    for words in ("programme_format", "save_programme", "start_programme", "change_programme"):
        assert words in text, words
    assert "add_item, update_item or remove_item" in text.replace("`", "")


# --- end_programme (#83) ------------------------------------------------------------------------


def end(client: TestClient, token: str, tracker: str, **extra: Any) -> Any:
    return write(client, token, "end_programme", {"tracker": tracker, **extra})


def ended(client: TestClient, token: str, tracker: str, **extra: Any) -> Any:
    """Preview an end, then confirm it with the preview's rev."""
    preview = end(client, token, tracker, **extra)
    return end(client, token, tracker, confirm=True, rev=preview["rev"], **extra)


def test_end_programme_previews_then_ends_with_the_previews_rev(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str, clock: Clock
) -> None:
    """The plan's W3 acceptance: a preview changes nothing, and its rev ends the run."""
    started = running(agent, writer)
    tracker = started["tracker"]["id"]
    before = tool(agent, writer, "get_programme", tracker=tracker)["run"]
    preview = end(agent, writer, tracker, from_date=NEXT_MONDAY, reason="Moving house.")
    assert (preview["preview"], preview["stale"]) == (True, False)
    assert preview["end"] == {"from": NEXT_MONDAY, "reason": "Moving house.", "lastWeek": THIS_WEEK}
    message = preview["message"]
    assert message.startswith(f"Nothing has changed yet. {NAME} ends from {NEXT_MONDAY}.")
    for words in (
        f"Its last week is the week of {THIS_WEEK}.",
        "Its marks, weeks, notes and log stay.",
        f"Days from {NEXT_MONDAY} on aren't sealed, and the run takes no more changes.",
        f"confirm true and rev {preview['rev']}.",
    ):
        assert words in message, words
    # Nothing changed: the run, its log and the tracker's weeks are as they were.
    assert tool(agent, writer, "get_programme", tracker=tracker)["run"] == before
    assert data.load_tracker(conn, uid, tracker) == started["tracker"]

    out = end(
        agent,
        writer,
        tracker,
        from_date=NEXT_MONDAY,
        reason="Moving house.",
        confirm=True,
        rev=preview["rev"],
    )
    assert (out["preview"], out["stale"], out["message"]) == (
        False,
        False,
        f"Ended from {NEXT_MONDAY}.",
    )
    assert out["tracker"]["endWeek"] == NEXT_MONDAY
    run = out["run"]
    assert run["ended"] == {
        "from": NEXT_MONDAY,
        "reason": "Moving house.",
        "seq": 1,
        "restarted": False,
    }
    (entry,) = run["log"]
    assert (entry["change"], entry["from"], entry["source"]) == (
        {"type": "end-programme"},
        NEXT_MONDAY,
        "agent",
    )
    assert data.load_tracker(conn, uid, tracker)["endWeek"] == NEXT_MONDAY  # type: ignore[index]
    go_to(clock, NEXT_MONDAY)
    assert tool(agent, writer, "get_programme", tracker=tracker)["run"]["status"] == "ended"


def test_end_programme_defaults_to_today(agent: TestClient, uid: int, writer: str) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    preview = end(agent, writer, tracker)
    assert preview["end"] == {"from": TODAY, "reason": None, "lastWeek": THIS_WEEK}
    out = ended(agent, writer, tracker)
    assert out["message"] == f"Ended from {TODAY}."
    assert out["run"]["status"] == "ended"


def test_end_programme_says_a_run_not_yet_started_shows_in_no_week(
    agent: TestClient, uid: int, writer: str
) -> None:
    tracker = running(agent, writer, start="2026-11-02")["tracker"]["id"]
    preview = end(agent, writer, tracker)
    assert preview["end"]["lastWeek"] is None
    assert f"{NAME} then shows in no week." in preview["message"]
    assert ended(agent, writer, tracker)["tracker"]["endWeek"] == NEXT_MONDAY


def test_end_programme_on_a_run_paused_until_resumed_keeps_the_week_before_its_day(
    agent: TestClient, uid: int, writer: str
) -> None:
    """A programme paused with no end has no last day of its own: the end's day sets it."""
    tracker = running(agent, writer)["tracker"]["id"]
    confirmed(agent, writer, tracker, {"type": "pause-programme"})
    preview = end(agent, writer, tracker, from_date="2026-11-04")
    assert preview["end"]["lastWeek"] == "2026-11-02"


@pytest.mark.parametrize(
    "confirm",
    [
        {"rev": "0123456789abcdef"},
        {"reason": "Another reason."},
        {"from_date": "2026-10-27"},
    ],
)
def test_end_programme_with_another_rev_day_or_reason_previews_again(
    agent: TestClient, uid: int, writer: str, confirm: dict[str, Any]
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    first = end(agent, writer, tracker, from_date=NEXT_MONDAY)
    arguments = {"from_date": NEXT_MONDAY, "rev": first["rev"], **confirm}
    out = end(agent, writer, tracker, confirm=True, **arguments)
    assert (out["preview"], out["stale"]) == (True, True)
    assert out["rev"] != arguments["rev"]
    assert out["message"].startswith("That rev doesn't confirm this end:")
    run = tool(agent, writer, "get_programme", tracker=tracker)["run"]
    assert (run["ended"], run["log"]) == (None, [])


def test_end_programme_after_a_change_since_its_preview_previews_again(
    agent: TestClient, uid: int, writer: str
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    first = end(agent, writer, tracker, from_date=NEXT_MONDAY)
    confirmed(agent, writer, tracker, LONGER_PLANK, from_date=NEXT_MONDAY)
    out = end(agent, writer, tracker, from_date=NEXT_MONDAY, confirm=True, rev=first["rev"])
    assert (out["preview"], out["stale"]) == (True, True)
    assert out["end"] == {"from": NEXT_MONDAY, "reason": None, "lastWeek": THIS_WEEK}
    assert tool(agent, writer, "get_programme", tracker=tracker)["run"]["ended"] is None
    out = end(agent, writer, tracker, from_date=NEXT_MONDAY, confirm=True, rev=out["rev"])
    assert (out["preview"], out["stale"]) == (False, False)
    assert [e["seq"] for e in out["run"]["log"]] == [2, 1]


@pytest.mark.parametrize("confirm", [{}, {"confirm": True, "rev": "0123456789abcdef"}])
def test_end_programme_refuses_an_ended_or_a_finished_run(
    agent: TestClient,
    conn: sqlite3.Connection,
    config: Config,
    uid: int,
    writer: str,
    clock: Clock,
    confirm: dict[str, Any],
) -> None:
    """Ended with End programme, from today or a later day, or run to its last Sunday: there is
    nothing to end, and the refusal names the tools that carry a run on."""
    tracker = running(agent, writer)["tracker"]["id"]
    data.end_run(conn, uid, tracker, NEXT_MONDAY, when=data.When(START, config.timezone))
    finished = running(agent, writer, name="Finished")["tracker"]["id"]
    go_to(clock, "2026-12-14")  # the Monday after the run's last week
    for found, name in ((tracker, NAME), (finished, "Finished")):
        text = refused(agent, writer, "end_programme", {"tracker": found, **confirm})
        assert text == (
            f"tracker: {name} has ended, or already has an end day, so there is nothing to end. "
            "restart_programme starts it again as a new run from week 1. reopen_programme "
            "carries on a run that End programme ended."
        )
    run = tool(agent, writer, "get_programme", tracker=finished)["run"]
    assert (run["ended"], run["log"]) == (None, [])


@pytest.mark.parametrize("confirm", [{}, {"confirm": True, "rev": "0123456789abcdef"}])
def test_end_programme_refuses_an_ordinary_tracker(
    agent: TestClient, uid: int, writer: str, confirm: dict[str, Any]
) -> None:
    text = refused(agent, writer, "end_programme", {"tracker": "exercise", **confirm})
    assert text == "tracker: Strength is not a programme tracker; list_programmes lists the runs"


@pytest.mark.parametrize(
    ("arguments", "line"),
    [
        ({"from_date": YESTERDAY}, "- from_date: the programme ends today or later."),
        ({"from_date": "next week"}, "- from_date: give a date written YYYY-MM-DD."),
        ({"reason": "x" * 501}, "- reason: a reason is at most 500 characters."),
        ({"confirm": True}, "- rev: give the rev of the preview."),
    ],
)
def test_a_refused_end_lists_its_problems_and_ends_nothing(
    agent: TestClient, uid: int, writer: str, arguments: dict[str, Any], line: str
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    text = refused(agent, writer, "end_programme", {"tracker": tracker, **arguments})
    assert text == (
        "tracker: the end has 1 problem, so nothing was ended. Fix each one and send it again.\n"
        + line
    )
    run = tool(agent, writer, "get_programme", tracker=tracker)["run"]
    assert (run["ended"], run["log"]) == (None, [])


def test_a_past_day_is_refused_on_a_confirm_too(agent: TestClient, uid: int, writer: str) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    preview = end(agent, writer, tracker)
    arguments = {"tracker": tracker, "from_date": YESTERDAY, "confirm": True, "rev": preview["rev"]}
    text = refused(agent, writer, "end_programme", arguments)
    assert text.endswith("\n- from_date: the programme ends today or later.")
    assert tool(agent, writer, "get_programme", tracker=tracker)["run"]["ended"] is None


def test_end_programme_on_a_run_that_cant_be_read_ends_nothing(
    agent: TestClient, uid: int, writer: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    tracker = running(agent, writer, name="Autumn block")["tracker"]["id"]
    broken_run(monkeypatch, tracker)
    for confirm in ({}, {"confirm": True, "rev": "0123456789abcdef"}):
        text = refused(agent, writer, "end_programme", {"tracker": tracker, **confirm})
        assert text.startswith(
            "tracker: Autumn block's programme can't be read right now, so nothing was changed."
        )


def test_the_instructions_name_end_programme(agent: TestClient, token: str) -> None:
    text = result(call(agent, "initialize", INITIALIZE, token=token))["instructions"]
    assert "`end_programme`, which previews the end first" in text


# --- restart_programme (#83, K164) ----------------------------------------------------------------

RESTARTED = "Restarted from week 1."


def restart(client: TestClient, token: str, tracker: str, **extra: Any) -> Any:
    return write(client, token, "restart_programme", {"tracker": tracker, **extra})


def restarted(client: TestClient, token: str, tracker: str, **extra: Any) -> Any:
    """Preview a restart, then confirm it with the preview's rev."""
    preview = restart(client, token, tracker, **extra)
    return restart(client, token, tracker, confirm=True, rev=preview["rev"], **extra)


def sealed_days(conn: sqlite3.Connection, tracker: str) -> list[tuple[Any, ...]]:
    return [
        tuple(r)
        for r in conn.execute(
            "SELECT date, programme_week, items_json, sealed_at FROM programme_days"
            " WHERE tracker_id = ? ORDER BY date",
            (tracker,),
        )
    ]


def past_weeks(conn: sqlite3.Connection, uid: int, config: Config, tracker: str) -> Any:
    """The run's grid weeks before this one, and their plans rows: its history."""
    run = data.read_run(conn, uid, tracker, data.When(config.clock(), config.timezone))
    assert run is not None
    this_week = insights_monday(config)
    grid = [w for w in run["grid"]["weeks"] if w["monday"] < this_week]
    stored = conn.execute(
        "SELECT week, items_json, rev FROM plans WHERE section = ? AND week < ? ORDER BY week",
        (tracker, this_week),
    ).fetchall()
    return grid, [tuple(r) for r in stored]


def insights_monday(config: Config) -> str:
    today = data.When(config.clock(), config.timezone).today
    return date.fromordinal(today.toordinal() - today.weekday()).isoformat()


def test_restart_programme_previews_then_starts_week_1_and_ends_the_running_run(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int, writer: str, clock: Clock
) -> None:
    """The plan's W4 acceptance: after a confirm, a new tracker runs week 1 from the start day,
    and the old run ends the day before it with its history intact."""
    started = running(agent, writer, name="Autumn squats", params={"squat": 50})
    old = started["tracker"]["id"]
    go_to(clock, "2026-11-04")  # a Wednesday, in programme week 3
    before = tool(agent, writer, "get_programme", tracker=old)["run"]
    days, history = sealed_days(conn, old), past_weeks(conn, uid, config, old)
    assert days[-1][0] == "2026-11-03"
    trackers = data.load_trackers(conn, uid)

    preview = restart(agent, writer, old, start="2026-11-09")
    assert (preview["preview"], preview["stale"]) == (True, False)
    assert preview["restart"] == {
        "name": "Autumn squats",
        "start": "2026-11-09",
        "firstWeek": {"from": "2026-11-09", "to": "2026-11-15"},
        "weeks": 8,
        "end": "2027-01-03",
        "oldEndsFrom": "2026-11-09",
    }
    message = preview["message"]
    assert message.startswith(
        "Nothing has changed yet. Autumn squats starts again from week 1 on 2026-11-09, as a new "
        "tracker."
    )
    for words in (
        "Week 1 runs 2026-11-09 to 2026-11-15, and the run has 8 weeks, to 2027-01-03.",
        "Autumn squats, the run now, ends from 2026-11-09, so its last day is 2026-11-08.",
        "Its marks, weeks, notes and log stay.",
        f"confirm true and rev {preview['rev']}.",
    ):
        assert words in message, words
    # A preview changes nothing.
    assert tool(agent, writer, "get_programme", tracker=old)["run"] == before
    assert data.load_trackers(conn, uid) == trackers

    out = restart(agent, writer, old, start="2026-11-09", confirm=True, rev=preview["rev"])
    assert (out["preview"], out["stale"], out["message"]) == (
        False,
        False,
        "Restarted from 2026-11-09.",
    )
    new = out["tracker"]
    assert new["id"] not in {t["id"] for t in trackers}
    assert (new["name"], new["kind"], new["startWeek"], new["endWeek"]) == (
        "Autumn squats",
        "strength",
        "2026-11-09",
        "2027-01-04",
    )
    run = out["run"]
    assert (run["status"], run["start"], run["end"], run["log"]) == (
        "upcoming",
        "2026-11-09",
        "2027-01-03",
        [],
    )
    assert run["params"] == before["params"] == {"squat": 50, "rate": 5}
    assert run["doc"] == before["doc"]
    # The old run ends the day before the new one's first, in the same confirm.
    assert (out["old"]["id"], out["old"]["endWeek"]) == (old, "2026-11-09")
    after = tool(agent, writer, "get_programme", tracker=old)["run"]
    assert after["ended"] == {
        "from": "2026-11-09",
        "reason": RESTARTED,
        "seq": 1,
        "restarted": True,
    }
    assert after["end"] == "2026-11-08"
    (entry,) = after["log"]
    assert (entry["change"], entry["source"], entry["undoable"]) == (
        {"type": "end-programme", "restarted": True},
        "agent",
        False,
    )
    # A restart replaces the run, so it can't be re-opened (K167).
    assert after["canReopen"] is False
    # Its history is as it was: the sealed days, the past weeks and their plans.
    assert sealed_days(conn, old) == days
    assert past_weeks(conn, uid, config, old) == history

    go_to(clock, "2026-11-09")
    now = tool(agent, writer, "get_programme", tracker=new["id"])["run"]
    assert (now["status"], now["week"]) == ("running", 1)
    assert tool(agent, writer, "get_programme", tracker=old)["run"]["status"] == "ended"
    assert sealed_days(conn, old)[-1][0] == "2026-11-08"


@pytest.mark.parametrize("how", ["ended", "finished"])
def test_restart_programme_of_a_run_that_has_ended_ends_nothing_more(
    agent: TestClient,
    conn: sqlite3.Connection,
    config: Config,
    uid: int,
    writer: str,
    clock: Clock,
    how: str,
) -> None:
    """Ended with End programme, or run to its last Sunday: the old run's days stay as they are,
    and the new one runs week 1 from today. A run End programme ended gains the restart's marker
    in its log, from its end's own day, so it can't be re-opened (K167)."""
    old = running(agent, writer)["tracker"]["id"]
    if how == "ended":
        data.end_run(conn, uid, old, when=data.When(START, config.timezone))
    today = "2026-11-04" if how == "ended" else "2026-12-16"
    go_to(clock, today)
    before = tool(agent, writer, "get_programme", tracker=old)["run"]
    days, history = sealed_days(conn, old), past_weeks(conn, uid, config, old)
    preview = restart(agent, writer, old)
    assert preview["restart"]["start"] == today
    assert preview["restart"]["oldEndsFrom"] is None
    assert (
        f"{NAME}, the run now, has ended. Its marks, weeks, notes and log stay, and the new run "
        "replaces it, so it can't be re-opened."
    ) in preview["message"]
    out = restart(agent, writer, old, confirm=True, rev=preview["rev"])
    assert (out["run"]["status"], out["run"]["week"], out["run"]["start"]) == (
        "running",
        1,
        today,
    )
    assert out["tracker"]["name"] == NAME
    after = tool(agent, writer, "get_programme", tracker=old)["run"]
    assert (sealed_days(conn, old), past_weeks(conn, uid, config, old)) == (days, history)
    assert (after["status"], after["end"], after["grid"]) == (
        "ended",
        before["end"],
        before["grid"],
    )
    assert after["canReopen"] is False
    if how == "finished":
        assert after["log"] == before["log"]
        return
    marker, *log = after["log"]
    assert log == before["log"]
    assert (marker["from"], marker["change"], marker["reason"], marker["source"]) == (
        TODAY,
        {"type": "end-programme", "restarted": True},
        RESTARTED,
        "agent",
    )
    assert after["ended"] == {"from": TODAY, "reason": RESTARTED, "seq": 2, "restarted": True}


def test_restart_programme_starts_from_the_runs_own_copy_when_the_library_one_is_gone(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    """F5: the library programme may have been deleted since the run started."""
    started = running(agent, writer)
    programme_id = started["run"]["programmeId"]
    assert data.delete_programme(conn, uid, programme_id)
    assert tool(agent, writer, "list_programmes")["programmes"] == []
    out = restarted(agent, writer, started["tracker"]["id"], start=NEXT_MONDAY)
    run = out["run"]
    assert (run["programmeId"], run["doc"], run["start"]) == (
        programme_id,
        started["run"]["doc"],
        NEXT_MONDAY,
    )
    assert run["grid"]["weeks"][0]["cells"]["squat"]["values"]["weight"] == 40


def test_restart_programme_refuses_past_the_tracker_cap(
    agent: TestClient, uid: int, writer: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    old = running(agent, writer)["tracker"]["id"]
    preview = restart(agent, writer, old, start=NEXT_MONDAY)
    monkeypatch.setattr(data, "MAX_TRACKERS", 4)
    arguments = {"tracker": old, "start": NEXT_MONDAY, "confirm": True, "rev": preview["rev"]}
    text = refused(agent, writer, "restart_programme", arguments)
    assert text == (
        "tracker: the account has 4 trackers, the most it can hold; delete one in the app first"
    )
    # Nothing was written: the old run isn't ended.
    run = tool(agent, writer, "get_programme", tracker=old)["run"]
    assert (run["ended"], run["log"]) == (None, [])
    assert len(tool(agent, writer, "list_trackers")["trackers"]) == 4


def test_a_full_account_restarts_nothing(
    full: tuple[TestClient, str], conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    """The quota refuses the restart, and the end it would write goes with it."""
    client, token = full
    stored = data.add_programme(conn, uid, EXAMPLE, START, quota=10**9, make_id=lambda _: "p1")
    when = data.When(START, config.timezone)
    data.start_programme(conn, uid, stored["id"], when=when, quota=10**9, make_id=lambda _: "x1")
    preview = restart(client, token, "x1", start=NEXT_MONDAY)
    assert preview["restart"]["oldEndsFrom"] == NEXT_MONDAY
    arguments = {"tracker": "x1", "start": NEXT_MONDAY, "confirm": True, "rev": preview["rev"]}
    text = refused(client, token, "restart_programme", arguments)
    assert text == "quota: the account is full, so nothing was restarted"
    run = data.read_run(conn, uid, "x1", when)
    assert run is not None
    assert (run["ended"], run["log"]) == (None, [])
    assert [t["id"] for t in data.load_trackers(conn, uid)] == ["exercise", "cardio", "diet", "x1"]


@pytest.mark.parametrize(
    "confirm",
    [
        {"rev": "0123456789abcdef"},
        {"name": "Winter squats"},
        {"start": "2026-11-02"},
    ],
)
def test_restart_programme_with_another_rev_start_or_name_previews_again(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str, confirm: dict[str, Any]
) -> None:
    old = running(agent, writer)["tracker"]["id"]
    first = restart(agent, writer, old, start=NEXT_MONDAY)
    arguments = {"start": NEXT_MONDAY, "rev": first["rev"], **confirm}
    out = restart(agent, writer, old, confirm=True, **arguments)
    assert (out["preview"], out["stale"]) == (True, True)
    assert out["rev"] != arguments["rev"]
    assert out["restart"]["start"] == arguments["start"]
    assert out["message"].startswith(
        "That rev doesn't confirm this restart: the programme or the account's trackers changed "
        "since its preview, or its start or its name isn't the one previewed. Nothing was "
        "changed. This is the restart sent, previewed as things are now."
    )
    run = tool(agent, writer, "get_programme", tracker=old)["run"]
    assert (run["ended"], run["log"]) == (None, [])
    assert len(data.load_trackers(conn, uid)) == 4


def test_a_restart_confirmed_twice_or_after_a_change_previews_again(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int, writer: str
) -> None:
    old = running(agent, writer)["tracker"]["id"]
    first = restart(agent, writer, old, start=NEXT_MONDAY)
    confirmed(agent, writer, old, LONGER_PLANK, from_date=NEXT_MONDAY)
    out = restart(agent, writer, old, start=NEXT_MONDAY, confirm=True, rev=first["rev"])
    assert (out["preview"], out["stale"]) == (True, True)
    assert len(data.load_trackers(conn, uid)) == 4
    # An ended run's log doesn't move with a restart; the new tracker still makes a second
    # confirm a fresh preview.
    data.end_run(conn, uid, old, when=data.When(config.clock(), config.timezone))
    preview = restart(agent, writer, old)
    done = restart(agent, writer, old, confirm=True, rev=preview["rev"])
    assert done["preview"] is False
    again = restart(agent, writer, old, confirm=True, rev=preview["rev"])
    assert (again["preview"], again["stale"]) == (True, True)
    assert len(data.load_trackers(conn, uid)) == 5


@pytest.mark.parametrize("confirm", [{}, {"confirm": True, "rev": "0123456789abcdef"}])
def test_restart_programme_refuses_an_ordinary_tracker(
    agent: TestClient, uid: int, writer: str, confirm: dict[str, Any]
) -> None:
    text = refused(agent, writer, "restart_programme", {"tracker": "exercise", **confirm})
    assert text == "tracker: Strength is not a programme tracker; list_programmes lists the runs"


@pytest.mark.parametrize(
    ("arguments", "line"),
    [
        ({"start": YESTERDAY}, "- start: a programme starts today or later."),
        ({"start": "next week"}, "- start: give a date written YYYY-MM-DD."),
        ({"name": "x" * 61}, "- name: give a name of 1 to 60 characters."),
        ({"confirm": True}, "- rev: give the rev of the preview."),
    ],
)
def test_a_refused_restart_lists_its_problems_and_restarts_nothing(
    agent: TestClient,
    conn: sqlite3.Connection,
    uid: int,
    writer: str,
    arguments: dict[str, Any],
    line: str,
) -> None:
    old = running(agent, writer)["tracker"]["id"]
    text = refused(agent, writer, "restart_programme", {"tracker": old, **arguments})
    assert text == (
        "tracker: the restart has 1 problem, so nothing was restarted. Fix each one and send it "
        "again.\n" + line
    )
    run = tool(agent, writer, "get_programme", tracker=old)["run"]
    assert (run["ended"], run["log"]) == (None, [])
    assert len(data.load_trackers(conn, uid)) == 4


def test_restart_programme_on_a_run_that_cant_be_read_restarts_nothing(
    agent: TestClient,
    conn: sqlite3.Connection,
    uid: int,
    writer: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tracker = running(agent, writer, name="Autumn block")["tracker"]["id"]
    broken_run(monkeypatch, tracker)
    for confirm in ({}, {"confirm": True, "rev": "0123456789abcdef"}):
        text = refused(agent, writer, "restart_programme", {"tracker": tracker, **confirm})
        assert text.startswith(
            "tracker: Autumn block's programme can't be read right now, so nothing was changed."
        )
    assert len(data.load_trackers(conn, uid)) == 4


def test_the_instructions_name_restart_programme(agent: TestClient, token: str) -> None:
    text = result(call(agent, "initialize", INITIALIZE, token=token))["instructions"]
    assert "`restart_programme` starts a run again from week 1" in text
    notes = " ".join(tool(agent, token, "programme_format")["notes"])
    assert "restart_programme" in notes


def test_restart_programme_ends_a_run_not_yet_started_from_the_new_start(
    agent: TestClient, uid: int, writer: str
) -> None:
    """An upcoming run ends from the restart's day, as End programme ends one: it then shows in
    no week."""
    old = running(agent, writer, start=NEXT_MONDAY)["tracker"]["id"]
    preview = restart(agent, writer, old)
    assert preview["restart"]["oldEndsFrom"] == TODAY
    out = restart(agent, writer, old, confirm=True, rev=preview["rev"])
    assert (out["old"]["startWeek"], out["old"]["endWeek"]) == (NEXT_MONDAY, NEXT_MONDAY)
    assert (out["run"]["status"], out["run"]["start"]) == ("running", TODAY)
    run = tool(agent, writer, "get_programme", tracker=old)["run"]
    assert (run["status"], run["ended"]["from"]) == ("ended", TODAY)


def test_restart_programme_brings_a_later_end_day_forward_to_the_new_start(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int, writer: str
) -> None:
    """A run already set to end after the new start ends from the new start instead: a second
    end row, which the run now reads as its end."""
    old = running(agent, writer)["tracker"]["id"]
    data.end_run(conn, uid, old, "2026-12-07", when=data.When(START, config.timezone))
    out = restarted(agent, writer, old, start="2026-11-02")
    assert out["old"]["endWeek"] == "2026-11-02"
    run = tool(agent, writer, "get_programme", tracker=old)["run"]
    assert run["ended"] == {"from": "2026-11-02", "reason": RESTARTED, "seq": 2, "restarted": True}
    assert [e["from"] for e in run["log"]] == ["2026-11-02", "2026-12-07"]
    assert run["end"] == "2026-11-01"


# --- reopen_programme (#83, K165) -----------------------------------------------------------------


def reopen(client: TestClient, token: str, tracker: str, **extra: Any) -> Any:
    return write(client, token, "reopen_programme", {"tracker": tracker, **extra})


def reopened(client: TestClient, token: str, tracker: str, **extra: Any) -> Any:
    """Preview a re-open, then confirm it with the preview's rev."""
    preview = reopen(client, token, tracker, **extra)
    return reopen(client, token, tracker, confirm=True, rev=preview["rev"], **extra)


def plan_row(conn: sqlite3.Connection, tracker: str, week: str) -> tuple[Any, ...]:
    row = conn.execute(
        "SELECT items_json, rev FROM plans WHERE section = ? AND week = ?", (tracker, week)
    ).fetchone()
    return tuple(row)


def full_run(conn: sqlite3.Connection, uid: int, config: Config, tracker: str) -> dict[str, Any]:
    run = data.read_run(conn, uid, tracker, data.When(config.clock(), config.timezone))
    assert run is not None
    return run


def grid_week(run: dict[str, Any], monday: str) -> dict[str, Any]:
    found: dict[str, Any] = next(w for w in run["grid"]["weeks"] if w["monday"] == monday)
    return found


def test_reopen_programme_carries_a_run_on_at_the_week_it_stopped_in(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int, writer: str, clock: Clock
) -> None:
    """The plan's W5 acceptance: ended in its week 3 and re-opened a week later, the run is
    running at week 3 from the re-open day, and its days before the end are unchanged."""
    tracker = running(agent, writer)["tracker"]["id"]
    go_to(clock, "2026-11-04")  # a Wednesday, in programme week 3
    ended(agent, writer, tracker, reason="Knee")
    go_to(clock, "2026-11-11")  # a week later
    before = tool(agent, writer, "get_programme", tracker=tracker)["run"]
    assert (before["status"], before["end"]) == ("ended", "2026-11-03")
    days = sealed_days(conn, tracker)
    assert days[-1][0] == "2026-11-03"
    end_week = plan_row(conn, tracker, "2026-11-02")
    stored = data.load_tracker(conn, uid, tracker)
    assert stored is not None
    assert stored["endWeek"] == "2026-11-09"

    preview = reopen(agent, writer, tracker, reason="Knee is better")
    assert (preview["preview"], preview["stale"]) == (True, False)
    assert preview["reopen"] == {
        "from": "2026-11-11",
        "reason": "Knee is better",
        "week": 3,
        "paused": {"from": "2026-11-04", "to": "2026-11-10"},
        "end": "2026-12-20",
        "lastWeek": "2026-12-14",
    }
    message = preview["message"]
    assert message.startswith(
        f"Nothing has changed yet. {NAME} re-opens from 2026-11-11, at programme week 3."
    )
    for words in (
        "The days from 2026-11-04 to 2026-11-10 count as a pause of the whole programme.",
        "Its last week is now the week of 2026-12-14.",
        "Days before 2026-11-04 stay as they are, and the run takes changes again.",
        f"confirm true and rev {preview['rev']}.",
    ):
        assert words in message, words
    # A preview changes nothing.
    assert tool(agent, writer, "get_programme", tracker=tracker)["run"] == before
    assert sealed_days(conn, tracker) == days
    assert data.load_tracker(conn, uid, tracker) == stored

    out = reopen(agent, writer, tracker, reason="Knee is better", confirm=True, rev=preview["rev"])
    assert (out["preview"], out["stale"], out["message"]) == (
        False,
        False,
        "Re-opened from 2026-11-11.",
    )
    assert out["tracker"]["endWeek"] == "2026-12-21"
    run = out["run"]
    assert (run["status"], run["week"], run["ended"], run["end"]) == (
        "running",
        3,
        None,
        "2026-12-20",
    )
    entry, end_entry = run["log"]
    assert (entry["change"], entry["from"], entry["reason"], entry["source"]) == (
        {"type": "reopen-programme"},
        "2026-11-11",
        "Knee is better",
        "agent",
    )
    assert (entry["undoable"], end_entry["undoable"]) == (False, False)
    assert (
        data.run_summaries(conn, uid, data.When(clock.now, config.timezone))[tracker]["status"]
        == "running"
    )
    # P1: the days before the end are as they were sealed.
    after = sealed_days(conn, tracker)
    assert [r for r in after if r[0] < "2026-11-04"] == days
    # The days from the end to yesterday are sealed now, paused at programme week 3.
    gap = [r for r in after if r[0] >= "2026-11-04"]
    assert [r[0] for r in gap] == [f"2026-11-{n:02}" for n in range(4, 11)]
    assert {(r[1], json.loads(r[2])["status"], json.loads(r[2])["reason"]) for r in gap} == {
        (3, "paused", "Knee")
    }
    # The end's week is past and keeps its plan.
    assert plan_row(conn, tracker, "2026-11-02") == end_week
    week = grid_week(full_run(conn, uid, config, tracker), "2026-11-09")
    assert [d["status"] for d in week["days"]] == ["paused"] * 2 + ["running"] * 5
    assert week["programmeWeeks"] == [3]
    # A re-opened run takes changes again.
    assert confirmed(agent, writer, tracker, LONGER_PLANK)["preview"] is False


def test_a_reopen_writes_the_weeks_the_end_hid_as_paused(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int, writer: str, clock: Clock
) -> None:
    """Re-opened two weeks after the end: the week between, which the end hid and no reader
    showed, is written as paused, with goals of 0."""
    tracker = running(agent, writer)["tracker"]["id"]
    go_to(clock, "2026-11-04")
    ended(agent, writer, tracker)
    go_to(clock, "2026-11-18")
    stale_items, stale_rev = plan_row(conn, tracker, "2026-11-09")
    assert {i["target"] for i in json.loads(stale_items)} == {3}
    out = reopened(agent, writer, tracker)
    assert out["run"]["end"] == "2026-12-27"
    items, rev = plan_row(conn, tracker, "2026-11-09")
    assert ({i["target"] for i in json.loads(items)}, rev) == ({0}, stale_rev + 1)
    run = full_run(conn, uid, config, tracker)
    assert {d["status"] for d in grid_week(run, "2026-11-09")["days"]} == {"paused"}
    this_week = grid_week(run, "2026-11-16")
    squat = item_of(json.loads(plan_row(conn, tracker, "2026-11-16")[0]), "squat")
    assert squat["target"] == this_week["cells"]["squat"]["target"] == 3  # 3 x 5 / 7, rounded up
    assert data.shows_in(out["tracker"], "2026-11-09")


def item_of(items: list[dict[str, Any]], key: str) -> dict[str, Any]:
    return next(i for i in items if i["id"] == key)


def test_a_run_ended_and_reopened_twice_has_two_paused_gaps(
    agent: TestClient, uid: int, writer: str, clock: Clock
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    go_to(clock, "2026-11-04")
    ended(agent, writer, tracker)
    go_to(clock, "2026-11-11")
    reopened(agent, writer, tracker)
    go_to(clock, "2026-11-18")
    assert ended(agent, writer, tracker)["run"]["status"] == "ended"
    go_to(clock, "2026-11-25")
    run = reopened(agent, writer, tracker)["run"]
    assert (run["status"], run["week"], run["ended"], run["end"]) == (
        "running",
        4,
        None,
        "2026-12-27",
    )
    assert [e["change"]["type"] for e in run["log"]] == [
        "reopen-programme",
        "end-programme",
        "reopen-programme",
        "end-programme",
    ]


def test_reopen_programme_on_a_future_ends_own_day_lifts_it(
    agent: TestClient, uid: int, writer: str
) -> None:
    """An end set for a later day can be lifted from that day: nothing is paused, and the
    tracker shows to the run's own last week again. A day before the end's is refused."""
    tracker = running(agent, writer)["tracker"]["id"]
    assert ended(agent, writer, tracker, from_date=NEXT_MONDAY)["tracker"]["endWeek"] == NEXT_MONDAY
    text = refused(agent, writer, "reopen_programme", {"tracker": tracker})
    assert text.endswith(
        f"\n- from_date: the programme ends from {NEXT_MONDAY}, so it re-opens from that day or "
        "later."
    )
    preview = reopen(agent, writer, tracker, from_date=NEXT_MONDAY)
    assert (preview["reopen"]["paused"], preview["reopen"]["week"]) == (None, 2)
    assert "It re-opens on the day it was to end, so no day is paused." in preview["message"]
    out = reopen(agent, writer, tracker, from_date=NEXT_MONDAY, confirm=True, rev=preview["rev"])
    assert out["tracker"]["endWeek"] == "2026-12-14"
    assert (out["run"]["status"], out["run"]["ended"], out["run"]["end"]) == (
        "running",
        None,
        "2026-12-13",
    )


def test_reopen_programme_refuses_a_run_not_ended(agent: TestClient, uid: int, writer: str) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    for confirm in ({}, {"confirm": True, "rev": "0123456789abcdef"}):
        text = refused(agent, writer, "reopen_programme", {"tracker": tracker, **confirm})
        assert text == f"tracker: {NAME} hasn't been ended, so there is nothing to re-open"


@pytest.mark.parametrize(
    "how", ["finished", "ended after its last week", "ended before it started"]
)
def test_reopen_programme_refuses_a_run_end_programme_didnt_stop_part_way(
    agent: TestClient,
    conn: sqlite3.Connection,
    config: Config,
    uid: int,
    writer: str,
    clock: Clock,
    how: str,
) -> None:
    when = data.When(START, config.timezone)
    if how == "ended before it started":
        tracker = running(agent, writer, start=NEXT_MONDAY)["tracker"]["id"]
        data.end_run(conn, uid, tracker, when=when)
    else:
        tracker = running(agent, writer)["tracker"]["id"]
        if how == "ended after its last week":
            data.end_run(conn, uid, tracker, "2026-12-14", when=when)
        go_to(clock, "2026-12-16")
    for confirm in ({}, {"confirm": True, "rev": "0123456789abcdef"}):
        text = refused(agent, writer, "reopen_programme", {"tracker": tracker, **confirm})
        assert text == (
            f"tracker: {NAME} ran to its end, or was ended before it started, so there is "
            "nothing to re-open. restart_programme starts it again from week 1"
        )


#: What `reopen_programme` answers for a run a restart ended (K167).
REPLACED = (
    f"tracker: {NAME} was restarted from week 1 as a new tracker, which replaces this run, so "
    "there is nothing to re-open"
)


def test_reopen_programme_refuses_a_run_a_restart_ended(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    """A restart replaces the run (K164): re-opening the old one would leave two runs of the
    programme planning the same days. Its end row carries the marker, and the run says so."""
    old = running(agent, writer)["tracker"]["id"]
    out = restarted(agent, writer, old, start=NEXT_MONDAY)
    (entry,) = tool(agent, writer, "get_programme", tracker=old)["run"]["log"]
    assert entry["change"] == {"type": "end-programme", "restarted": True}
    for confirm in ({}, {"confirm": True, "rev": "0123456789abcdef"}):
        args = {"tracker": old, "from_date": NEXT_MONDAY, **confirm}
        assert refused(agent, writer, "reopen_programme", args) == REPLACED
    assert len(tool(agent, writer, "get_programme", tracker=old)["run"]["log"]) == 1
    assert tool(agent, writer, "get_programme", tracker=out["tracker"]["id"])["run"]["log"] == []


def test_reopen_programme_refuses_a_restart_written_before_the_marker(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    """An end a restart wrote before the marker (K167) has the restart's reason, and the new run
    beside it: the same document and parameters, starting on the end's day."""
    old = running(agent, writer)["tracker"]["id"]
    restarted(agent, writer, old, start=NEXT_MONDAY)
    conn.execute('UPDATE run_changes SET change_json = \'{"type":"end-programme"}\'')
    conn.commit()
    args = {"tracker": old, "from_date": NEXT_MONDAY}
    assert refused(agent, writer, "reopen_programme", args) == REPLACED


def test_reopen_programme_takes_an_end_whose_reason_only_reads_like_a_restart(
    agent: TestClient, writer: str
) -> None:
    """The reason alone is something a person can type: with no new run beside it, the end is
    End programme's, and the run re-opens."""
    tracker = running(agent, writer)["tracker"]["id"]
    ended(agent, writer, tracker, from_date=NEXT_MONDAY, reason=RESTARTED)
    run = tool(agent, writer, "get_programme", tracker=tracker)["run"]
    assert (run["ended"]["reason"], run["canReopen"]) == (RESTARTED, True)
    out = reopened(agent, writer, tracker, from_date=NEXT_MONDAY)
    assert out["run"]["ended"] is None


@pytest.mark.parametrize("confirm", [{}, {"confirm": True, "rev": "0123456789abcdef"}])
def test_reopen_programme_refuses_an_ordinary_tracker(
    agent: TestClient, uid: int, writer: str, confirm: dict[str, Any]
) -> None:
    text = refused(agent, writer, "reopen_programme", {"tracker": "exercise", **confirm})
    assert text == "tracker: Strength is not a programme tracker; list_programmes lists the runs"


@pytest.mark.parametrize(
    ("arguments", "line"),
    [
        ({"from_date": YESTERDAY}, "- from_date: the programme re-opens today or later."),
        ({"from_date": "next week"}, "- from_date: give a date written YYYY-MM-DD."),
        ({"reason": "x" * 501}, "- reason: a reason is at most 500 characters."),
        ({"confirm": True}, "- rev: give the rev of the preview."),
    ],
)
def test_a_refused_reopen_lists_its_problems_and_reopens_nothing(
    agent: TestClient,
    conn: sqlite3.Connection,
    config: Config,
    uid: int,
    writer: str,
    arguments: dict[str, Any],
    line: str,
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    data.end_run(conn, uid, tracker, when=data.When(START, config.timezone))
    text = refused(agent, writer, "reopen_programme", {"tracker": tracker, **arguments})
    assert text == (
        "tracker: the re-open has 1 problem, so nothing was re-opened. Fix each one and send it "
        "again.\n" + line
    )
    assert tool(agent, writer, "get_programme", tracker=tracker)["run"]["ended"] is not None


@pytest.mark.parametrize(
    "confirm",
    [
        {"rev": "0123456789abcdef"},
        {"reason": "Another reason."},
        {"from_date": "2026-11-12"},
    ],
)
def test_reopen_programme_with_another_rev_day_or_reason_previews_again(
    agent: TestClient, uid: int, writer: str, clock: Clock, confirm: dict[str, Any]
) -> None:
    tracker = running(agent, writer)["tracker"]["id"]
    go_to(clock, "2026-11-04")
    ended(agent, writer, tracker)
    go_to(clock, "2026-11-11")
    first = reopen(agent, writer, tracker)
    arguments = {"from_date": "2026-11-11", "rev": first["rev"], **confirm}
    out = reopen(agent, writer, tracker, confirm=True, **arguments)
    assert (out["preview"], out["stale"]) == (True, True)
    assert out["rev"] != arguments["rev"]
    assert out["reopen"]["from"] == arguments["from_date"]
    assert out["message"].startswith(
        "That rev doesn't confirm this re-open: the programme changed since its preview, or its "
        "day or its reason isn't the one previewed. Nothing was changed. This is the re-open "
        "sent, previewed on the programme as it is now."
    )
    run = tool(agent, writer, "get_programme", tracker=tracker)["run"]
    assert (run["status"], len(run["log"])) == ("ended", 1)
    # The fresh preview's rev confirms the re-open sent; the same confirm again is refused, since
    # the run isn't ended any more.
    sent = {**arguments, "rev": out["rev"]}
    assert reopen(agent, writer, tracker, confirm=True, **sent)["preview"] is False
    text = refused(agent, writer, "reopen_programme", {"tracker": tracker, "confirm": True, **sent})
    assert text == f"tracker: {NAME} hasn't been ended, so there is nothing to re-open"


def test_a_full_account_reopens_nothing(
    full: tuple[TestClient, str], conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    client, token = full
    stored = data.add_programme(conn, uid, EXAMPLE, START, quota=10**9, make_id=lambda _: "p1")
    when = data.When(START, config.timezone)
    data.start_programme(conn, uid, stored["id"], when=when, quota=10**9, make_id=lambda _: "x1")
    data.end_run(conn, uid, "x1", when=when)
    preview = reopen(client, token, "x1")
    arguments = {"tracker": "x1", "confirm": True, "rev": preview["rev"]}
    text = refused(client, token, "reopen_programme", arguments)
    assert text == "quota: the account is full, so nothing was re-opened"
    run = data.read_run(conn, uid, "x1", when)
    assert run is not None
    assert (run["status"], len(run["log"])) == ("ended", 1)


def test_reopen_programme_on_a_run_that_cant_be_read_reopens_nothing(
    agent: TestClient, uid: int, writer: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    tracker = running(agent, writer, name="Autumn block")["tracker"]["id"]
    broken_run(monkeypatch, tracker)
    for confirm in ({}, {"confirm": True, "rev": "0123456789abcdef"}):
        text = refused(agent, writer, "reopen_programme", {"tracker": tracker, **confirm})
        assert text.startswith(
            "tracker: Autumn block's programme can't be read right now, so nothing was changed."
        )


def test_the_instructions_name_reopen_programme(agent: TestClient, token: str) -> None:
    text = result(call(agent, "initialize", INITIALIZE, token=token))["instructions"]
    assert "`reopen_programme` carries on a run End programme stopped" in text
    notes = " ".join(tool(agent, token, "programme_format")["notes"])
    assert "reopen_programme" in notes


# --- the shared library (docs/specs/2026-11-19-shared-library.md §6) ----------------------------

ADMIN = "john@example.com"


def share(conn: sqlite3.Connection, config: Config, document: dict[str, Any]) -> str:
    """Publish `document` from an admin's library, as the app does: its shared id."""
    row = conn.execute("SELECT id FROM users WHERE username = ?", (ADMIN,)).fetchone()
    admin = int(row["id"]) if row else auth.signup(conn, config, ADMIN, PASSWORD)
    auth.set_admin(conn, ADMIN, True)
    record = data.add_programme(conn, admin, document, config.clock(), quota=10**9, make_id=new_id)
    args: dict[str, Any] = {"now": config.clock(), "make_id": new_id}
    preview = data.publish_programme(conn, admin, record["id"], confirm=False, rev=None, **args)
    assert preview is not None
    out = data.publish_programme(
        conn, admin, record["id"], confirm=True, rev=preview["rev"], **args
    )
    assert out is not None
    return out["shared"]["id"]  # type: ignore[no-any-return]


def test_list_shared_programmes_lists_the_shared_library_and_reads_one(
    agent: TestClient,
    conn: sqlite3.Connection,
    config: Config,
    clock: Clock,
    uid: int,
    token: str,
) -> None:
    """A read token browses it. Nothing names the admin who published it (S2)."""
    assert tool(agent, token, "list_shared_programmes") == {"programmes": [], "programme": None}
    first = share(conn, config, EXAMPLE)
    clock.advance(60)
    cardio = doc("cardio")
    second = share(conn, config, cardio)
    out = tool(agent, token, "list_shared_programmes")
    assert out["programme"] is None
    # The newest publish first.
    assert [(p["id"], p["name"], p["kind"]) for p in out["programmes"]] == [
        (second, cardio["name"], "cardio"),
        (first, EXAMPLE["name"], "strength"),
    ]
    assert set(out["programmes"][0]) == {
        "id",
        "name",
        "description",
        "kind",
        "weeks",
        "activities",
        "updatedAt",
    }
    one = tool(agent, token, "list_shared_programmes", programme=first)
    assert one["programmes"] is None
    assert one["programme"]["doc"] == EXAMPLE
    assert one["programme"]["id"] == first
    assert ADMIN not in json.dumps(out) + json.dumps(one)
    text = tool_error(agent, token, "list_shared_programmes", programme="nope")
    assert text.endswith(
        "programme: no programme nope in the shared library; list_shared_programmes lists them"
    )


def test_copy_programme_copies_into_the_library_to_start_like_any_other(
    agent: TestClient, conn: sqlite3.Connection, config: Config, uid: int, writer: str
) -> None:
    """The agent's loop of §6: browse, copy, adjust with save_programme, start."""
    shared_id = share(conn, config, EXAMPLE)
    out = write(agent, writer, "copy_programme", {"programme": shared_id})
    record = out["programme"]
    assert set(out) == {"programme"}
    assert record["id"] != shared_id
    assert (record["name"], record["rev"], record["doc"]) == (EXAMPLE["name"], 1, EXAMPLE)
    listed = tool(agent, writer, "list_programmes")["programmes"]
    assert [p["id"] for p in listed] == [record["id"]]
    assert "shared" not in listed[0]
    adjusted = {**EXAMPLE, "weeks": 10}
    saved = write(
        agent, writer, "save_programme", {"programme": record["id"], "rev": 1, "doc": adjusted}
    )
    assert saved["programme"]["rev"] == 2
    started = write(agent, writer, "start_programme", {"programme": record["id"]})
    assert started["run"]["weeks"] == 10
    # The shared programme is as it was.
    assert data.load_shared(conn, shared_id)["doc"] == EXAMPLE  # type: ignore[index]
    text = refused(agent, writer, "copy_programme", {"programme": "nope"})
    assert text == (
        "programme: no programme nope in the shared library; list_shared_programmes lists them"
    )


def test_copy_programme_refuses_past_the_library_cap_and_the_quota(
    agent: TestClient,
    conn: sqlite3.Connection,
    config: Config,
    uid: int,
    writer: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shared_id = share(conn, config, EXAMPLE)
    monkeypatch.setattr(data, "MAX_PROGRAMMES", 1)
    save(agent, writer)
    text = refused(agent, writer, "copy_programme", {"programme": shared_id})
    assert text == (
        "programme: the library holds 1 programme, the most it can; delete one in the app first"
    )
    monkeypatch.undo()
    small = replace(config, user_quota_bytes=1)
    with TestClient(create_app(small, run_backups=False), base_url=ORIGIN) as tight:
        text = refused(tight, writer, "copy_programme", {"programme": shared_id})
    assert text == "quota: the account is full, so nothing was copied"
    assert len(data.list_programmes(conn, uid)) == 1


def test_copy_programme_names_the_problems_of_a_document_the_format_no_longer_takes(
    agent: TestClient, conn: sqlite3.Connection, uid: int, writer: str
) -> None:
    """A snapshot stored under an older format: the copy is refused with every problem."""
    conn.execute(
        "INSERT INTO shared_programmes VALUES ('xs1', 'Old', ?, 1, NULL, NULL, 5, 5)",
        (json.dumps({**EXAMPLE, "weeks": 0}),),
    )
    text = refused(agent, writer, "copy_programme", {"programme": "xs1"})
    assert text.startswith("programme: the programme has 1 problem, so nothing was copied.")
    assert data.list_programmes(conn, uid) == []


def test_the_instructions_name_the_shared_library(agent: TestClient, token: str) -> None:
    text = result(call(agent, "initialize", INITIALIZE, token=token))["instructions"]
    assert "`list_shared_programmes`" in text and "`copy_programme`" in text
