"""Programme runs over REST (docs/specs/2026-11-17-programmes.md §4 to §8, §11.2): start and
preview a run, read it, preview and apply changes with `rev`, the weeks written into `plans`, the
lock on past days, sealing, mark evidence, ending a run, and export and import."""

import copy
import json
import sqlite3
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api import data
from tracker_api.app import create_app
from tracker_api.config import Config
from tracker_api.db import connect
from tracker_api.programme import Series
from tracker_api.validate import parse_export

from .conftest import ORIGIN, START, Clock
from .fixtures import fixture_cases
from .test_api import other_client, post_import, sign_up
from .test_programmes_api import add, doc

#: The conftest clock's day, a Friday, and the Mondays around it.
TODAY = "2026-10-23"
THIS_WEEK = "2026-10-19"
NEXT_MONDAY = "2026-10-26"
SQUAT_50 = {"type": "set-value", "activity": "squat", "field": "weight", "value": 50}
#: The beginner programme's name, which the tracker takes.
NAME = doc()["name"]


def go_to(clock: Clock, day: str) -> None:
    """Move the clock to the same time of day on `day`."""
    clock.now = START + (date.fromisoformat(day) - date.fromisoformat(TODAY)).days * 86_400


def library(client: TestClient, name: str = "beginner-5x5") -> str:
    r = add(client, doc(name))
    assert r.status_code == 201, r.text
    programme_id: str = r.json()["id"]
    return programme_id


def start(client: TestClient, programme_id: str, **body: Any) -> Any:
    return client.post(f"/api/programmes/{programme_id}/start", json=body)


def started(
    client: TestClient,
    config: Config,
    *,
    on: str = NEXT_MONDAY,
    programme: str = "beginner-5x5",
    **body: Any,
) -> dict[str, Any]:
    """Alice, signed up, with `programme` in her library, started on `on`."""
    sign_up(client, config)
    r = start(client, library(client, programme), start=on, **body)
    assert r.status_code == 201, r.text
    made: dict[str, Any] = r.json()
    return made


def change(client: TestClient, tracker: str, body: Any, on: str, **extra: Any) -> Any:
    return client.post(f"/api/runs/{tracker}/changes", json={"change": body, "from": on, **extra})


def apply(client: TestClient, tracker: str, body: Any, on: str, **extra: Any) -> dict[str, Any]:
    """Preview a change, then confirm it with the preview's rev."""
    preview = change(client, tracker, body, on, **extra)
    assert preview.status_code == 200, preview.text
    r = change(client, tracker, body, on, preview=False, rev=preview.json()["rev"], **extra)
    assert r.status_code == 200, r.text
    applied: dict[str, Any] = r.json()
    return applied


def run_of(client: TestClient, tracker: str) -> dict[str, Any]:
    r = client.get(f"/api/runs/{tracker}")
    assert r.status_code == 200, r.text
    run: dict[str, Any] = r.json()
    return run


def rows(config: Config, sql: str, *args: object) -> list[tuple[Any, ...]]:
    conn = connect(config.db_path)
    try:
        return [tuple(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


def plans(client: TestClient, tracker: str) -> dict[str, list[dict[str, Any]]]:
    found: dict[str, list[dict[str, Any]]] = client.get("/api/state").json()["sections"][tracker][
        "plans"
    ]
    return found


def item(items: list[dict[str, Any]], key: str) -> dict[str, Any]:
    return next(i for i in items if i["id"] == key)


def week_of(run: dict[str, Any], monday: str) -> dict[str, Any]:
    found: dict[str, Any] = next(w for w in run["grid"]["weeks"] if w["monday"] == monday)
    return found


def mondays(first: str, count: int) -> list[str]:
    day = date.fromisoformat(first)
    return [(day + timedelta(weeks=i)).isoformat() for i in range(count)]


def tick(client: TestClient, tracker: str, week: str, item_id: str, day: int, mark: Any) -> Any:
    return client.put(f"/api/ticks/{tracker}/{week}/{item_id}/{day}", json={"mark": mark})


def sealed(config: Config) -> list[tuple[Any, ...]]:
    return rows(
        config,
        "SELECT date, programme_week, items_json, sealed_at FROM programme_days ORDER BY date",
    )


# --- start ---------------------------------------------------------------------------------------


def test_start_creates_a_tracker_of_the_programmes_kind_with_every_week(
    client: TestClient, config: Config
) -> None:
    made = started(client, config)
    tracker = made["tracker"]
    # From the start date's Monday; it ends after the last programme week's Sunday.
    assert tracker == {
        "id": tracker["id"],
        "name": NAME,
        "kind": "strength",
        "position": 3,
        "dailyTarget": 3,
        "startWeek": NEXT_MONDAY,
        "endWeek": "2026-12-21",
        "rev": 1,
    }
    written = plans(client, tracker["id"])
    assert sorted(written) == mondays(NEXT_MONDAY, 8)
    # Each activity is an item whose id is its key, with the week's values.
    assert written[NEXT_MONDAY][0] == {
        "id": "squat",
        "name": "Back squat",
        "sets": 5,
        "reps": 5,
        "weight": 40,
        "target": 3,
    }
    assert [i["id"] for i in written[NEXT_MONDAY]] == ["squat", "bench", "row", "deadlift", "plank"]
    assert item(written["2026-11-02"], "squat")["weight"] == 42.5
    # Week 4 is a deload.
    assert item(written["2026-11-16"], "squat") | {} == {
        "id": "squat",
        "name": "Back squat",
        "sets": 3,
        "reps": 5,
        "weight": 42.5,
        "target": 3,
    }
    # The activities' notes become the items' notes.
    state = client.get("/api/state").json()
    assert state["details"][tracker["id"]] == {
        "squat": {"notes": "Belt from week 5."},
        "deadlift": {"notes": doc()["activities"][3]["notes"]},
    }
    run = made["run"]
    assert run["tracker"] == tracker["id"]
    assert (run["status"], run["week"], run["weeks"]) == ("upcoming", None, 8)
    assert (run["start"], run["end"], run["today"]) == (NEXT_MONDAY, "2026-12-20", TODAY)
    assert run["log"] == []
    assert run["ended"] is None
    assert run["openPause"] is None
    assert isinstance(run["rev"], str) and len(run["rev"]) == 16
    assert run["doc"] == doc()
    assert run["params"] == {"squat": 40, "rate": 5}
    assert run_of(client, tracker["id"]) == run


def test_a_run_from_today_is_in_week_1(client: TestClient, config: Config) -> None:
    made = started(client, config, on=TODAY, programme="minimal", params={})
    run, tracker = made["run"], made["tracker"]
    assert (run["status"], run["week"], run["weeks"]) == ("running", 1, 1)
    assert (tracker["startWeek"], tracker["endWeek"], tracker["kind"]) == (
        THIS_WEEK,
        NEXT_MONDAY,
        "strength",
    )
    # No daily target in the document reads as the kind's.
    assert tracker["dailyTarget"] == 3
    assert run["clock"]["activities"]["push-ups"] == {
        "state": "running",
        "activityWeek": 1,
        "until": None,
        "reason": None,
    }
    # The days before the start in its week are sealed at once: the run has no earlier day.
    assert [r[:2] for r in sealed(config)] == [
        ("2026-10-19", None),
        ("2026-10-20", None),
        ("2026-10-21", None),
        ("2026-10-22", None),
    ]


def test_start_takes_parameters_and_a_name(client: TestClient, config: Config) -> None:
    made = started(client, config, params={"squat": 60}, name="  Winter block  ")
    assert made["tracker"]["name"] == "Winter block"
    assert made["run"]["params"] == {"squat": 60, "rate": 5}
    assert item(plans(client, made["tracker"]["id"])[NEXT_MONDAY], "squat")["weight"] == 60


def test_a_cardio_run_has_no_daily_target(client: TestClient, config: Config) -> None:
    made = started(client, config, programme="cardio")
    assert (made["tracker"]["kind"], made["tracker"]["dailyTarget"]) == ("cardio", None)


@pytest.mark.parametrize(
    ("body", "errors"),
    [
        (
            {"start": "2026-10-22"},
            [{"path": "start", "message": "a programme starts today or later."}],
        ),
        (
            {"start": "next week"},
            [{"path": "start", "message": "give a date written YYYY-MM-DD."}],
        ),
        ({"start": 20261026}, [{"path": "start", "message": "give a date written YYYY-MM-DD."}]),
        (
            {"start": NEXT_MONDAY, "name": "  "},
            [{"path": "name", "message": "give a name of 1 to 60 characters."}],
        ),
        (
            {"start": "2026-10-01", "name": 7},
            [
                {"path": "start", "message": "a programme starts today or later."},
                {"path": "name", "message": "give a name of 1 to 60 characters."},
            ],
        ),
        (
            {"start": NEXT_MONDAY, "params": {"squat": 10, "shoe": 1}},
            [
                {"path": "params.squat", "message": "the least it can be is 20."},
                {"path": "params.shoe", "message": "the programme has no parameter called shoe."},
            ],
        ),
        (
            {"start": NEXT_MONDAY, "params": [40]},
            [{"path": "params", "message": "give the parameter values as an object."}],
        ),
    ],
)
def test_a_start_with_problems_is_400_and_writes_nothing(
    client: TestClient, config: Config, body: dict[str, Any], errors: list[dict[str, str]]
) -> None:
    sign_up(client, config)
    programme_id = library(client)
    r = start(client, programme_id, **body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid", "errors": errors})
    assert len(client.get("/api/trackers").json()["trackers"]) == 3
    assert rows(config, "SELECT count(*) FROM programme_runs") == [(0,)]
    # The preview refuses the same start; it takes no name.
    r = client.post(f"/api/programmes/{programme_id}/preview", json=body)
    errors = [e for e in errors if e["path"] != "name"]
    if errors:
        assert (r.status_code, r.json()) == (400, {"error": "invalid", "errors": errors})
    else:
        assert r.status_code == 200


def test_start_and_preview_need_a_programme_of_the_account(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    mine = library(client)
    assert start(client, "nope", start=NEXT_MONDAY).status_code == 404
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        assert start(bob, mine, start=NEXT_MONDAY).json() == {"error": "not-found"}
        r = bob.post(f"/api/programmes/{mine}/preview", json={})
        assert (r.status_code, r.json()) == (404, {"error": "not-found"})


def test_a_start_past_the_tracker_cap_is_409(
    client: TestClient, config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_up(client, config)
    programme_id = library(client)
    monkeypatch.setattr(data, "MAX_TRACKERS", 3)
    r = start(client, programme_id, start=NEXT_MONDAY)
    assert (r.status_code, r.json()) == (409, {"error": "too-many"})
    assert rows(config, "SELECT count(*) FROM programme_runs") == [(0,)]


def test_a_start_past_the_quota_is_413_and_writes_nothing(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    programme_id = library(client)
    tiny = create_app(replace(config, user_quota_bytes=3000), run_backups=False)
    with TestClient(tiny, base_url=ORIGIN, headers={"Origin": ORIGIN}) as small:
        small.cookies = client.cookies
        r = start(small, programme_id, start=NEXT_MONDAY)
    assert (r.status_code, r.json()) == (413, {"error": "quota"})
    assert rows(config, "SELECT count(*) FROM programme_runs") == [(0,)]
    assert rows(
        config, "SELECT count(*) FROM trackers WHERE id NOT IN ('exercise', 'cardio', 'diet')"
    ) == [(0,)]


def test_the_preview_of_a_start_writes_nothing(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    programme_id = library(client)
    r = client.post(
        f"/api/programmes/{programme_id}/preview",
        json={"start": NEXT_MONDAY, "params": {"rate": 10}},
    )
    assert r.status_code == 200, r.text
    preview = r.json()
    assert (preview["start"], preview["end"], preview["weeks"]) == (NEXT_MONDAY, "2026-12-20", 8)
    assert preview["params"] == {"squat": 40, "rate": 10}
    assert preview["endsShort"] == []
    grid = preview["grid"]
    assert [w["monday"] for w in grid["weeks"]] == mondays(NEXT_MONDAY, 8)
    assert [a["key"] for a in grid["activities"]] == ["squat", "bench", "row", "deadlift", "plank"]
    assert grid["weeks"][1]["cells"]["squat"]["values"]["weight"] == 45
    assert grid["weeks"][3]["label"] == "Deload"
    # Without a start date it previews from today.
    today = client.post(f"/api/programmes/{programme_id}/preview", json={}).json()
    assert (today["start"], today["grid"]["weeks"][0]["monday"]) == (TODAY, THIS_WEEK)
    assert len(client.get("/api/trackers").json()["trackers"]) == 3
    assert rows(config, "SELECT count(*) FROM programme_runs") == [(0,)]


def test_the_run_keeps_its_own_copy_of_the_programme(client: TestClient, config: Config) -> None:
    made = started(client, config)
    programme_id = made["run"]["programmeId"]
    record = client.get(f"/api/programmes/{programme_id}").json()
    renamed = {**record["doc"], "name": "Renamed", "dailyTarget": 2}
    assert (
        client.put(
            f"/api/programmes/{programme_id}", json={"doc": renamed, "rev": record["rev"]}
        ).status_code
        == 200
    )
    run = run_of(client, made["tracker"]["id"])
    assert (run["doc"], run["name"]) == (doc(), NAME)
    assert made["tracker"]["dailyTarget"] == 3
    client.delete(f"/api/programmes/{programme_id}", headers={"Content-Type": "application/json"})
    run = run_of(client, made["tracker"]["id"])
    assert (run["programmeId"], run["name"]) == (programme_id, NAME)


# --- reading a run -------------------------------------------------------------------------------


def test_a_run_is_read_only_from_its_own_account(client: TestClient, config: Config) -> None:
    made = started(client, config)
    assert client.get("/api/runs/exercise").json() == {"error": "not-found"}
    assert client.get("/api/runs/nope").status_code == 404
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        assert bob.get(f"/api/runs/{made['tracker']['id']}").status_code == 404
        r = change(bob, made["tracker"]["id"], SQUAT_50, NEXT_MONDAY)
        assert (r.status_code, r.json()) == (404, {"error": "not-found"})


def test_the_runs_routes_need_a_session(client: TestClient) -> None:
    assert client.get("/api/runs/x").status_code == 401
    assert change(client, "x", SQUAT_50, TODAY).status_code == 401
    assert client.post("/api/runs/x/end", json={}).status_code == 401
    assert client.post("/api/programmes/x/start", json={}).status_code == 401
    assert client.post("/api/programmes/x/preview", json={}).status_code == 401


def test_the_grid_has_a_cell_per_activity_and_week(client: TestClient, config: Config) -> None:
    made = started(client, config, on=TODAY)
    run = made["run"]
    first = run["grid"]["weeks"][0]
    assert first["monday"] == THIS_WEEK
    assert first["programmeWeeks"] == [1]
    assert (first["current"], first["locked"]) == (True, False)
    assert [d["status"] for d in first["days"]] == ["before-start"] * 4 + ["running"] * 3
    assert first["days"][0] == {
        "date": THIS_WEEK,
        "status": "before-start",
        "programmeWeek": None,
        "sealed": True,
    }
    assert first["cells"]["squat"] == {
        "state": "running",
        "activityWeek": 1,
        "values": {"target": 3, "sets": 5, "reps": 5, "weight": 40},
        "target": 3,
        "splits": {},
        "hand": {},
        "until": None,
        "reason": None,
        "marks": [None] * 7,
    }
    assert run["grid"]["activities"][0] == {
        "key": "squat",
        "name": "Back squat",
        "addedOn": TODAY,
        "addedBy": None,
        "endedOn": None,
    }
    # The week view's marks come back in the cells.
    tick(client, made["tracker"]["id"], THIS_WEEK, "squat", 4, "great")
    marks = run_of(client, made["tracker"]["id"])["grid"]["weeks"][0]["cells"]["squat"]["marks"]
    assert marks == [None] * 4 + ["great", None, None]


# --- changes -------------------------------------------------------------------------------------


def test_a_preview_writes_nothing_and_an_apply_needs_its_rev(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    before = plans(client, tracker)
    r = change(client, tracker, SQUAT_50, TODAY, reason="Felt easy")
    assert r.status_code == 200, r.text
    preview = r.json()
    assert preview["preview"] is True
    assert preview["rev"] == made["run"]["rev"]
    assert preview["cells"][0] == {
        "monday": THIS_WEEK,
        "key": "squat",
        "field": "weight",
        "before": 40,
        "after": 50,
        "starts": TODAY,
        "programmeWeek": 1,
    }
    assert (preview["blocking"], preview["endsShort"]) == ([], [])
    assert (preview["undoes"], preview["deletes"]) == (None, None)
    assert preview["change"] == {
        "seq": 1,
        "from": TODAY,
        "change": SQUAT_50,
        "reason": "Felt easy",
    }
    # The grid as it would be, for "Show it in the plan".
    assert preview["grid"]["weeks"][0]["cells"]["squat"]["values"]["weight"] == 50
    assert plans(client, tracker) == before
    assert run_of(client, tracker)["log"] == []
    # A confirm needs the rev.
    r = change(client, tracker, SQUAT_50, TODAY, preview=False)
    assert (r.status_code, r.json()) == (
        400,
        {
            "error": "invalid",
            "errors": [{"path": "rev", "message": "give the rev of the preview."}],
        },
    )
    # A stale rev gets the preview as it is now.
    r = change(client, tracker, SQUAT_50, TODAY, preview=False, rev="0000000000000000")
    assert r.status_code == 409
    assert r.json()["error"] == "conflict"
    assert r.json()["rev"] == preview["rev"]
    assert r.json()["preview"]["cells"] == preview["cells"]
    assert plans(client, tracker) == before
    clock.advance(60)
    r = change(
        client, tracker, SQUAT_50, TODAY, preview=False, rev=preview["rev"], reason="Felt easy"
    )
    assert r.status_code == 200, r.text
    applied = r.json()
    assert applied["preview"] is False
    entry = {
        "seq": 1,
        "madeAt": clock.now,
        "from": TODAY,
        "change": SQUAT_50,
        "reason": "Felt easy",
        "source": "app",
        "undoneBy": None,
        "undoable": True,
    }
    assert applied["change"] == entry
    run = applied["run"]
    assert run["log"] == [entry]
    assert run["rev"] != preview["rev"]
    written = plans(client, tracker)
    assert item(written[THIS_WEEK], "squat")["weight"] == 50
    assert item(written[NEXT_MONDAY], "squat")["weight"] == 52.5
    assert run_of(client, tracker) == run
    # The rev the change was confirmed with is stale now.
    r = change(client, tracker, SQUAT_50, TODAY, preview=False, rev=preview["rev"])
    assert r.status_code == 409


def test_a_change_dated_yesterday_is_refused(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = started(client, config)
    tracker = made["tracker"]["id"]
    go_to(clock, "2026-10-28")
    rev = run_of(client, tracker)["rev"]
    expected = {
        "error": "invalid",
        "errors": [{"path": "from", "message": "a change starts today or later."}],
    }
    for extra in ({}, {"preview": False, "rev": rev}):
        r = change(client, tracker, SQUAT_50, "2026-10-27", **extra)
        assert (r.status_code, r.json()) == (400, expected)
    assert run_of(client, tracker)["log"] == []
    assert rows(config, "SELECT count(*) FROM run_changes") == [(0,)]


@pytest.mark.parametrize(
    ("body", "errors"),
    [
        (
            {"change": SQUAT_50, "from": "soon"},
            [{"path": "from", "message": "give a date written YYYY-MM-DD."}],
        ),
        ({"change": SQUAT_50}, [{"path": "from", "message": "give a date written YYYY-MM-DD."}]),
        (
            {"change": SQUAT_50, "from": TODAY, "reason": 3},
            [{"path": "reason", "message": "give the reason as text."}],
        ),
        (
            {"change": SQUAT_50, "from": TODAY, "reason": "x" * 501},
            [{"path": "reason", "message": "a reason is at most 500 characters."}],
        ),
        (
            {"change": SQUAT_50, "from": TODAY, "preview": "no"},
            [{"path": "preview", "message": "give true or false."}],
        ),
        (
            {"change": SQUAT_50, "from": TODAY, "preview": False, "rev": 3},
            [{"path": "rev", "message": "give the rev of the preview."}],
        ),
        (
            {"change": [1], "from": TODAY},
            [{"path": "change", "message": "a change is a JSON object."}],
        ),
        (
            {"change": {**SQUAT_50, "value": 51}, "from": TODAY},
            [
                {
                    "path": "change.value",
                    "message": "the weight goes in steps of 2.5, so give a multiple of 2.5.",
                }
            ],
        ),
        (
            {"change": {"type": "go-to-week", "week": 9}, "from": TODAY},
            [{"path": "change.week", "message": "give a week from 1 to 8."}],
        ),
    ],
)
def test_a_change_with_problems_is_400(
    client: TestClient, config: Config, body: dict[str, Any], errors: list[dict[str, str]]
) -> None:
    made = started(client, config, on=TODAY)
    r = client.post(f"/api/runs/{made['tracker']['id']}/changes", json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid", "errors": errors})
    assert rows(config, "SELECT count(*) FROM run_changes") == [(0,)]


def test_an_apply_rewrites_this_week_and_later_and_never_an_earlier_one(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = started(client, config)
    tracker = made["tracker"]["id"]
    go_to(clock, "2026-11-04")
    earlier = rows(config, "SELECT week, items_json, rev FROM plans WHERE week = ?", NEXT_MONDAY)
    body = {"type": "set-value", "activity": "squat", "field": "weight", "value": 60}
    run = apply(client, tracker, body, "2026-11-04")["run"]
    assert rows(config, "SELECT week, items_json, rev FROM plans WHERE week = ?", NEXT_MONDAY) == (
        earlier
    )
    written = plans(client, tracker)
    # This week's row takes Sunday's values; its first days keep theirs in the grid.
    assert item(written["2026-11-02"], "squat")["weight"] == 60
    assert item(written["2026-11-09"], "squat")["weight"] == 62.5
    this_week = week_of(run, "2026-11-02")
    assert this_week["cells"]["squat"]["splits"] == {
        "weight": [{"from": "2026-11-02", "value": 42.5}, {"from": "2026-11-04", "value": 60}]
    }
    assert [d["sealed"] for d in this_week["days"]] == [True, True] + [False] * 5
    assert (this_week["current"], this_week["locked"]) == (True, False)
    assert (week_of(run, NEXT_MONDAY)["current"], week_of(run, NEXT_MONDAY)["locked"]) == (
        False,
        True,
    )


def test_a_pause_moves_the_end_and_the_state_says_paused(
    client: TestClient, config: Config
) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    assert made["tracker"]["endWeek"] == "2026-12-14"
    run = apply(client, tracker, {"type": "pause-programme", "weeks": 2}, TODAY, reason="Flu")[
        "run"
    ]
    assert (run["status"], run["end"]) == ("paused", "2026-12-27")
    tracker_now = next(
        t for t in client.get("/api/trackers").json()["trackers"] if t["id"] == tracker
    )
    assert (tracker_now["endWeek"], tracker_now["rev"]) == ("2026-12-28", 2)
    state = client.get("/api/state").json()
    assert state["today"] == TODAY
    assert state["runs"] == {
        tracker: {
            "programmeId": made["run"]["programmeId"],
            "name": NAME,
            "status": "paused",
            "week": 1,
            "weeks": 8,
            "start": TODAY,
            "end": "2026-12-27",
            "pausedUntil": "2026-11-06",
            "rev": run["rev"],
        }
    }
    # Paused weeks are written as paused: each item's goal is 0.
    assert {i["target"] for i in plans(client, tracker)[NEXT_MONDAY]} == {0}


def test_an_open_ended_pause_leaves_the_tracker_open(client: TestClient, config: Config) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    run = apply(client, tracker, {"type": "pause-programme"}, TODAY)["run"]
    assert (run["status"], run["end"]) == ("paused", None)
    assert run["openPause"] == {"since": TODAY, "programmeWeek": 1, "reason": None}
    assert len(run["grid"]["whenResumed"]) == 8
    ended = next(t for t in client.get("/api/trackers").json()["trackers"] if t["id"] == tracker)
    assert ended["endWeek"] is None
    # Resumed, it ends again.
    run = apply(client, tracker, {"type": "resume-programme"}, "2026-10-26")["run"]
    assert run["end"] == "2026-12-20"
    resumed = next(t for t in client.get("/api/trackers").json()["trackers"] if t["id"] == tracker)
    assert resumed["endWeek"] == "2026-12-21"


def test_a_skip_forward_drops_the_weeks_past_the_new_end(
    client: TestClient, config: Config
) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    assert len(plans(client, tracker)) == 8
    run = apply(client, tracker, {"type": "go-to-week", "week": 7}, NEXT_MONDAY)["run"]
    assert run["end"] == "2026-11-08"
    assert sorted(plans(client, tracker)) == [THIS_WEEK, NEXT_MONDAY, "2026-11-02"]
    ended = next(t for t in client.get("/api/trackers").json()["trackers"] if t["id"] == tracker)
    assert ended["endWeek"] == "2026-11-09"


def test_undo_reverses_a_change(client: TestClient, config: Config) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    before = plans(client, tracker)
    apply(client, tracker, SQUAT_50, NEXT_MONDAY)
    assert plans(client, tracker) != before
    preview = change(client, tracker, {"type": "undo", "change": 1}, TODAY).json()
    assert preview["undoes"] == 1
    run = apply(client, tracker, {"type": "undo", "change": 1}, TODAY)["run"]
    assert plans(client, tracker) == before
    assert [(e["seq"], e["undoneBy"], e["undoable"]) for e in run["log"]] == [
        (2, None, False),
        (1, 2, False),
    ]


def test_ending_an_activity_with_no_days_deletes_it(client: TestClient, config: Config) -> None:
    made = started(client, config)
    tracker = made["tracker"]["id"]
    body = {"type": "end-activity", "activity": "squat"}
    assert change(client, tracker, body, NEXT_MONDAY).json()["deletes"] == "squat"
    run = apply(client, tracker, body, NEXT_MONDAY)["run"]
    assert all("squat" not in [i["id"] for i in items] for items in plans(client, tracker).values())
    assert "squat" not in client.get("/api/state").json()["details"][tracker]
    assert "squat" not in [a["key"] for a in run["grid"]["activities"]]


def test_an_added_activity_gets_its_item_and_notes(client: TestClient, config: Config) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    curl = {
        "key": "curl",
        "name": "Curl",
        "notes": "Slow.",
        "link": "https://example.com/curl",
        "target": 2,
        "sets": 3,
        "reps": 10,
        "weight": {"start": 10, "add": 1},
    }
    apply(client, tracker, {"type": "add-activity", "activity": curl}, NEXT_MONDAY)
    written = plans(client, tracker)
    assert "curl" not in [i["id"] for i in written[THIS_WEEK]]
    assert item(written[NEXT_MONDAY], "curl") == {
        "id": "curl",
        "name": "Curl",
        "sets": 3,
        "reps": 10,
        "weight": 10,
        "target": 2,
    }
    assert item(written["2026-11-02"], "curl")["weight"] == 11
    assert client.get("/api/state").json()["details"][tracker]["curl"] == {
        "notes": "Slow.",
        "fields": {"link": "https://example.com/curl"},
    }


def test_a_change_past_the_quota_is_413_and_writes_nothing(
    client: TestClient, config: Config
) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    curl = {"key": "curl", "name": "Curl " + "x" * 60, "sets": 3, "reps": 10}
    body = {"type": "add-activity", "activity": curl}
    rev = change(client, tracker, body, TODAY).json()["rev"]
    conn = connect(config.db_path)
    try:
        used = data.usage(conn, rows(config, "SELECT id FROM users")[0][0])
    finally:
        conn.close()
    before = plans(client, tracker)
    tiny = create_app(replace(config, user_quota_bytes=used), run_backups=False)
    with TestClient(tiny, base_url=ORIGIN, headers={"Origin": ORIGIN}) as small:
        small.cookies = client.cookies
        r = change(small, tracker, body, TODAY, preview=False, rev=rev)
    assert (r.status_code, r.json()) == (413, {"error": "quota"})
    assert plans(client, tracker) == before
    assert rows(config, "SELECT count(*) FROM run_changes") == [(0,)]


# --- the lock and the evidence -----------------------------------------------------------------


def test_marks_on_a_programme_tracker_follow_the_lock(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = started(client, config)
    tracker = made["tracker"]["id"]
    go_to(clock, "2026-10-28")
    # Two days back is locked, and so is any earlier day.
    r = tick(client, tracker, NEXT_MONDAY, "squat", 0, "great")
    assert (r.status_code, r.json()) == (409, {"error": "locked-day", "date": NEXT_MONDAY})
    assert tick(client, tracker, THIS_WEEK, "squat", 6, "great").status_code == 409
    # Yesterday is open for one day, and recorded as late.
    r = tick(client, tracker, NEXT_MONDAY, "squat", 1, "great")
    assert r.status_code == 200, r.text
    assert r.json()["days"] == [None, "great", None, None, None, None, None]
    assert tick(client, tracker, NEXT_MONDAY, "bench", 2, "partial-solid").status_code == 200
    assert tick(client, tracker, NEXT_MONDAY, "squat", 1, None).status_code == 200
    assert tick(client, tracker, NEXT_MONDAY, "row", 3, "missed").status_code == 200
    events = rows(
        config,
        "SELECT date, item_id, mark, entered_at, source, late FROM mark_events ORDER BY id",
    )
    assert events == [
        ("2026-10-27", "squat", "great", clock.now, "app", 1),
        ("2026-10-28", "bench", "partial-solid", clock.now, "app", 0),
        ("2026-10-27", "squat", None, clock.now, "app", 1),
        ("2026-10-29", "row", "missed", clock.now, "app", 0),
    ]
    log = client.get("/api/state").json()["sections"][tracker]["log"]
    assert log[NEXT_MONDAY]["squat"][0] is None
    assert log[NEXT_MONDAY]["bench"][2] == "partial-solid"


def test_the_data_layer_refuses_a_mark_on_a_run_without_today(
    client: TestClient, config: Config
) -> None:
    """A caller that doesn't say what day it is can't mark a programme tracker: the lock fails
    closed. An ordinary tracker needs no day."""
    made = started(client, config, on=TODAY)
    uid = rows(config, "SELECT id FROM users")[0][0]
    conn = connect(config.db_path)
    try:
        with pytest.raises(data.LockedDay):
            data.set_tick(
                conn, uid, made["tracker"]["id"], THIS_WEEK, "squat", 4, "great", quota=10**9
            )
        days = data.set_tick(conn, uid, "exercise", "2020-01-06", "pu", 0, "great", quota=10**9)
        assert days[0] == "great"
        # A connection names itself as the source.
        when = data.When(now=START, zone=config.timezone)
        data.set_tick(
            conn,
            uid,
            made["tracker"]["id"],
            THIS_WEEK,
            "squat",
            4,
            "great",
            quota=10**9,
            when=when,
            source="Claude",
        )
    finally:
        conn.close()
    assert rows(config, "SELECT item_id, source, late FROM mark_events") == [("squat", "Claude", 0)]


def test_a_mark_with_a_week_that_is_no_date_is_400(client: TestClient, config: Config) -> None:
    made = started(client, config, on=TODAY)
    r = tick(client, made["tracker"]["id"], "2026-13-45", "squat", 0, "great")
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})


def test_sealing_copies_each_day_up_to_yesterday_once(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = started(client, config)
    assert sealed(config) == []
    go_to(clock, "2026-11-04")
    client.get("/api/state")
    days = sealed(config)
    expected_weeks = [1] * 7 + [2, 2]
    assert [(d, w) for d, w, _, _ in days] == list(
        zip(
            [(date(2026, 10, 26) + timedelta(days=i)).isoformat() for i in range(9)],
            expected_weeks,
            strict=True,
        )
    )
    assert {r[3] for r in days} == {clock.now}
    monday = json.loads(days[0][2])
    assert monday["activities"]["squat"]["values"]["weight"] == 40
    assert monday["activities"]["squat"]["activityWeek"] == 1
    # A second read the same day seals nothing more.
    clock.advance(60)
    run_of(client, made["tracker"]["id"])
    assert sealed(config) == days
    # The next day's first read seals one more.
    go_to(clock, "2026-11-05")
    run_of(client, made["tracker"]["id"])
    assert [r[0] for r in sealed(config)][-1] == "2026-11-04"


def test_a_sealed_day_is_unchanged_by_a_later_change_and_an_engine_edit(
    client: TestClient, config: Config, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """P1: seal, change the run, then change the engine itself; the sealed days read the same."""
    made = started(client, config)
    tracker = made["tracker"]["id"]
    go_to(clock, "2026-11-04")
    before = run_of(client, tracker)
    days = sealed(config)
    first_week = week_of(before, NEXT_MONDAY)
    old_plan = rows(config, "SELECT items_json, rev FROM plans WHERE week = ?", NEXT_MONDAY)
    # A later change.
    body = {"type": "set-value", "activity": "squat", "field": "weight", "value": 60}
    after_change = apply(client, tracker, body, "2026-11-04")["run"]
    assert sealed(config) == days
    assert week_of(after_change, NEXT_MONDAY) == first_week
    # An engine edit: every computed value moves up a step. (It stays within each field's range:
    # loading a run checks its weeks against the item's limits.)
    real = Series.value

    def edited(self: Series, week: int, override: Any = None) -> Decimal:
        return real(self, week, override) + self.step

    monkeypatch.setattr(Series, "value", edited)
    after_edit = run_of(client, tracker)
    assert week_of(after_edit, NEXT_MONDAY) == first_week
    assert sealed(config) == days
    current = week_of(after_edit, "2026-11-02")["cells"]["squat"]["splits"]["weight"]
    # Monday and Tuesday are sealed at 42.5; the edit reaches only the days still to come.
    assert current[0] == {"from": "2026-11-02", "value": 42.5}
    assert current[1] == {"from": "2026-11-04", "value": 62.5}
    assert rows(config, "SELECT items_json, rev FROM plans WHERE week = ?", NEXT_MONDAY) == old_plan


def test_a_stored_run_loads_after_an_engine_edit_past_the_items_limits(
    client: TestClient, config: Config, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A run that was valid when stored always loads: an engine edit that takes its values past
    an item's limits (here every weight past MAX_WEIGHT) breaks neither the state, nor the run,
    nor sealing, nor the export. The range check is for what is about to be stored."""
    made = started(client, config)
    tracker = made["tracker"]["id"]
    go_to(clock, "2026-11-04")
    real = Series.value

    def edited(self: Series, week: int, override: Any = None) -> Decimal:
        return real(self, week, override) + 1000

    monkeypatch.setattr(Series, "value", edited)
    r = client.get("/api/state")
    assert r.status_code == 200, r.text
    state = r.json()
    assert [t["id"] for t in state["trackers"]] == ["exercise", "cardio", "diet", tracker]
    assert state["runs"][tracker]["week"] == 2
    # Sealing ran on that read: the days up to yesterday hold the edited values.
    assert len(sealed(config)) == 9
    run = run_of(client, tracker)
    assert week_of(run, "2026-11-09")["cells"]["squat"]["values"]["weight"] > 500
    assert client.get("/api/export").json()["runs"][0]["tracker"] == tracker


def test_a_run_that_cant_be_replayed_leaves_everything_else_answering(
    client: TestClient,
    config: Config,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    made = started(client, config)
    tracker = made["tracker"]["id"]
    go_to(clock, "2026-11-04")

    def broken(*_: object, **__: object) -> None:
        raise RuntimeError("engine broke")

    monkeypatch.setattr(data, "replay", broken)
    r = client.get("/api/state")
    assert r.status_code == 200, r.text
    state = r.json()
    # Every tracker is there; only the broken run's summary is left out, and the error logged.
    assert [t["id"] for t in state["trackers"]] == ["exercise", "cardio", "diet", tracker]
    assert state["runs"] == {}
    assert tracker in state["sections"]
    assert f"run {tracker}" in caplog.text
    assert "engine broke" in caplog.text
    # The run itself answers 500 with its own code, and so do its writes.
    r = client.get(f"/api/runs/{tracker}")
    assert (r.status_code, r.json()) == (500, {"error": "run-unreadable"})
    r = change(client, tracker, SQUAT_50, "2026-11-04")
    assert (r.status_code, r.json()) == (500, {"error": "run-unreadable"})
    # Nothing was sealed from a replay that failed, and the export still answers.
    assert sealed(config) == []
    assert client.get("/api/export").status_code == 200
    # Marks need no replay: the lock still holds.
    assert tick(client, tracker, "2026-11-02", "squat", 0, "great").status_code == 409
    assert tick(client, tracker, "2026-11-02", "squat", 2, "great").status_code == 200


def test_a_database_error_is_not_taken_for_an_unreadable_run(
    client: TestClient, config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A locked or failing database is the server's to report as it does any other, not the
    run's: it isn't relabelled `run-unreadable`, and the state doesn't hide it."""
    started(client, config)

    def locked(*_: object, **__: object) -> None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(data, "_load_run", locked)
    with pytest.raises(sqlite3.OperationalError):
        client.get("/api/state")


def test_sealing_never_fails_on_the_quota(client: TestClient, config: Config, clock: Clock) -> None:
    made = started(client, config)
    go_to(clock, "2026-11-04")
    tiny = create_app(replace(config, user_quota_bytes=1), run_backups=False)
    with TestClient(tiny, base_url=ORIGIN, headers={"Origin": ORIGIN}) as small:
        small.cookies = client.cookies
        assert small.get(f"/api/runs/{made['tracker']['id']}").status_code == 200
        # Marks still go in as evidence on a full account once the tick row exists.
        assert (
            tick(client, made["tracker"]["id"], "2026-11-02", "squat", 2, "great").status_code
            == 200
        )
        assert tick(small, made["tracker"]["id"], "2026-11-02", "squat", 2, None).status_code == 200
    assert len(sealed(config)) == 9
    assert rows(config, "SELECT count(*) FROM mark_events") == [(2,)]


# --- ending -------------------------------------------------------------------------------------


def test_end_programme_ends_the_run_from_a_day_and_keeps_its_history(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    r = client.post(f"/api/runs/{tracker}/end", json={"from": "2026-10-28", "reason": "Moving"})
    assert r.status_code == 200, r.text
    ended = r.json()
    # The week holding the end day still shows; the tracker shows in no later week.
    assert ended["tracker"]["endWeek"] == "2026-11-02"
    run = ended["run"]
    assert run["ended"] == {"from": "2026-10-28", "reason": "Moving", "seq": 1}
    assert (run["status"], run["end"]) == ("running", "2026-10-27")
    assert run["log"][0] == {
        "seq": 1,
        "madeAt": clock.now,
        "from": "2026-10-28",
        "change": {"type": "end-programme"},
        "reason": "Moving",
        "source": "app",
        "undoneBy": None,
        "undoable": False,
    }
    # Its plans stay.
    assert sorted(plans(client, tracker)) == mondays(THIS_WEEK, 8)
    # No change after an end, and no second end.
    r = change(client, tracker, SQUAT_50, TODAY)
    assert (r.status_code, r.json()) == (409, {"error": "ended"})
    r = client.post(f"/api/runs/{tracker}/end", json={})
    assert (r.status_code, r.json()) == (409, {"error": "ended"})
    # From its end day it is ended, and no day from then on is sealed.
    go_to(clock, "2026-11-05")
    run = run_of(client, tracker)
    assert (run["status"], run["week"]) == ("ended", None)
    assert sealed(config)[-1][0] == "2026-10-27"
    assert client.get("/api/state").json()["runs"][tracker]["status"] == "ended"


@pytest.mark.parametrize(
    ("body", "errors"),
    [
        (
            {"from": "2026-10-22"},
            [{"path": "from", "message": "the programme ends today or later."}],
        ),
        ({"from": "x"}, [{"path": "from", "message": "give a date written YYYY-MM-DD."}]),
        ({"reason": False}, [{"path": "reason", "message": "give the reason as text."}]),
    ],
)
def test_a_bad_end_is_400(
    client: TestClient, config: Config, body: dict[str, Any], errors: list[dict[str, str]]
) -> None:
    made = started(client, config, on=TODAY)
    r = client.post(f"/api/runs/{made['tracker']['id']}/end", json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid", "errors": errors})
    assert run_of(client, made["tracker"]["id"])["ended"] is None


def test_an_end_from_today_on_a_monday_hides_this_week(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = started(client, config)
    go_to(clock, NEXT_MONDAY)
    r = client.post(f"/api/runs/{made['tracker']['id']}/end", json={})
    assert r.json()["tracker"]["endWeek"] == NEXT_MONDAY
    assert r.json()["run"]["status"] == "ended"
    assert client.post("/api/runs/exercise/end", json={}).status_code == 404


def test_a_run_ends_after_its_last_sunday(client: TestClient, config: Config, clock: Clock) -> None:
    made = started(client, config, on=TODAY, programme="minimal")
    tracker = made["tracker"]["id"]
    go_to(clock, "2026-10-28")
    run = run_of(client, tracker)
    assert (run["status"], run["week"], run["end"]) == ("ended", None, "2026-10-25")
    # Its days are sealed to its last, and no further.
    assert sealed(config)[-1][0] == "2026-10-25"
    r = change(client, tracker, {"type": "go-to-week", "week": 1}, "2026-10-28")
    assert r.json()["errors"] == [{"path": "from", "message": "the programme has ended by then."}]
    assert client.get("/api/state").json()["runs"][tracker]["status"] == "ended"


def test_the_data_layer_ends_a_programme_tracker_only_with_today(
    client: TestClient, config: Config
) -> None:
    made = started(client, config, on=TODAY)
    uid = rows(config, "SELECT id FROM users")[0][0]
    conn = connect(config.db_path)
    try:
        with pytest.raises(data.ProgrammeTracker):
            data.end_tracker(conn, uid, made["tracker"]["id"], THIS_WEEK)
    finally:
        conn.close()
    assert run_of(client, made["tracker"]["id"])["ended"] is None


# --- export and import --------------------------------------------------------------------------


def alices_run(client: TestClient, config: Config, clock: Clock) -> dict[str, Any]:
    """Alice's run, two days in, with a change, a late mark and two sealed days."""
    made = started(client, config)
    tracker = made["tracker"]["id"]
    go_to(clock, "2026-10-28")
    apply(client, tracker, SQUAT_50, "2026-10-28", reason="Felt easy")
    tick(client, tracker, NEXT_MONDAY, "squat", 1, "great")
    client.get("/api/state")
    return made


def test_export_carries_the_library_and_the_runs(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = alices_run(client, config, clock)
    tracker = made["tracker"]["id"]
    exported = client.get("/api/export").json()
    assert exported["version"] == 6
    record = client.get(f"/api/programmes/{made['run']['programmeId']}").json()
    assert exported["programmes"] == [
        {
            "id": record["id"],
            "doc": record["doc"],
            "createdAt": record["createdAt"],
            "updatedAt": record["updatedAt"],
        }
    ]
    [run] = exported["runs"]
    assert {k: v for k, v in run.items() if k not in ("changes", "days", "marks")} == {
        "tracker": tracker,
        "programmeId": record["id"],
        "doc": doc(),
        "params": {},
        "start": NEXT_MONDAY,
    }
    assert run["changes"] == [
        {
            "seq": 1,
            "madeAt": clock.now,
            "from": "2026-10-28",
            "change": SQUAT_50,
            "reason": "Felt easy",
            "source": "app",
            "undoneBy": None,
        }
    ]
    assert [(d["date"], d["programmeWeek"], d["sealedAt"]) for d in run["days"]] == [
        (NEXT_MONDAY, 1, clock.now),
        ("2026-10-27", 1, clock.now),
    ]
    assert run["days"][0]["plan"]["activities"]["squat"]["values"]["weight"] == 40
    assert run["marks"] == [
        {
            "date": "2026-10-27",
            "item": "squat",
            "mark": "great",
            "enteredAt": clock.now,
            "source": "app",
            "late": True,
        }
    ]


def test_an_account_without_programmes_exports_as_before(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    exported = client.get("/api/export").json()
    assert "programmes" not in exported
    assert "runs" not in exported


def test_import_brings_the_library_and_a_run_with_its_tracker(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = alices_run(client, config, clock)
    tracker = made["tracker"]["id"]
    exported = client.get("/api/export").json()
    alices = run_of(client, tracker)
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        r = post_import(bob, exported)
        assert r.status_code == 200, r.text
        assert r.json() == {
            "trackers": 1,
            "weeks": 8,
            "ticks": 1,
            "details": 2,
            "settings": False,
            "conversations": 0,
            "programmes": 1,
            "runs": 1,
        }
        assert run_of(bob, tracker) == alices
        assert {**bob.get("/api/export").json(), "exportedAt": ""} == {
            **exported,
            "exportedAt": "",
        }
        # The same file again adds nothing.
        again = post_import(bob, exported).json()
        assert (again["programmes"], again["runs"], again["weeks"]) == (0, 0, 0)
        assert len(rows(config, "SELECT 1 FROM mark_events")) == 2


def test_a_programme_tracker_the_account_has_takes_nothing_from_a_file(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = alices_run(client, config, clock)
    tracker = made["tracker"]["id"]
    file = client.get("/api/export").json()
    before = client.get("/api/export").json()
    changed = copy.deepcopy(file)
    # A mark on a locked day, a week outside the run and a note: none of them come in.
    changed["sections"][tracker]["log"][NEXT_MONDAY]["bench"] = ["great"] + [None] * 6
    changed["sections"][tracker]["plans"]["2027-01-04"] = [{"id": "x", "name": "X"}]
    changed["details"][tracker]["bench"] = {"notes": "Mine."}
    changed["runs"][0]["changes"] = []
    r = post_import(client, changed).json()
    assert (r["weeks"], r["ticks"], r["details"], r["runs"]) == (0, 0, 0, 0)
    assert {**client.get("/api/export").json(), "exportedAt": ""} == {**before, "exportedAt": ""}


def test_a_run_with_a_broken_log_imports_as_an_ordinary_tracker(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = alices_run(client, config, clock)
    tracker = made["tracker"]["id"]
    file = client.get("/api/export").json()
    file["runs"][0]["changes"][0]["from"] = "soon"
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        r = post_import(bob, file).json()
        assert (r["trackers"], r["runs"], r["programmes"]) == (1, 0, 1)
        assert bob.get(f"/api/runs/{tracker}").status_code == 404
        assert len(plans(bob, tracker)) == 8
        # As an ordinary tracker it takes the generic writes.
        week = plans(bob, tracker)[NEXT_MONDAY]
        assert bob.put(
            f"/api/plans/{tracker}/{NEXT_MONDAY}", json={"items": week, "rev": 1}
        ).json() == {"rev": 2}


def test_a_file_run_needs_its_tracker_new_to_the_account(
    client: TestClient, config: Config, clock: Clock
) -> None:
    """A run in a file whose tracker the account already has as an ordinary one is passed
    over; the tracker's data merges as before."""
    made = alices_run(client, config, clock)
    tracker = made["tracker"]["id"]
    file = client.get("/api/export").json()
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        assert (
            bob.post(
                "/api/trackers", json={"name": "Mine", "kind": "strength", "id": tracker}
            ).status_code
            == 201
        )
        r = post_import(bob, file).json()
        assert (r["trackers"], r["runs"]) == (0, 0)
        assert bob.get(f"/api/runs/{tracker}").status_code == 404
        assert r["weeks"] == 8


def test_a_library_programme_the_account_has_stays_and_a_broken_one_is_dropped(
    client: TestClient, config: Config, clock: Clock
) -> None:
    made = alices_run(client, config, clock)
    file = client.get("/api/export").json()
    record = file["programmes"][0]
    broken = {**record, "id": "xbroken", "doc": {**record["doc"], "weeks": 0}}
    other = {**record, "id": "xother", "doc": {**record["doc"], "name": "Other"}}
    changed = {
        **file,
        "programmes": [{**record, "doc": {**record["doc"], "name": "New"}}, broken, other],
    }
    r = post_import(client, changed).json()
    assert r["programmes"] == 1
    names = sorted(p["name"] for p in client.get("/api/programmes").json()["programmes"])
    assert names == [NAME, "Other"]
    assert made


@pytest.mark.parametrize(
    "spoil",
    [
        # The document fails the format.
        lambda run, file: run["doc"].update(weeks=0),
        # Its kind isn't its tracker's.
        lambda run, file: next(t for t in file["trackers"] if t["id"] == run["tracker"]).update(
            kind="mobility"
        ),
        # A parameter the programme lacks.
        lambda run, file: run.update(params={"shoe": 1}),
        # A sealed day that doesn't read as one.
        lambda run, file: run["days"][0].update(plan={"date": NEXT_MONDAY}),
        # A sealed day filed under another date.
        lambda run, file: run["days"][0].update(date="2026-10-29"),
        # A change the replay can't read.
        lambda run, file: run["changes"][0]["change"].update(value="x"),
    ],
)
def test_a_run_that_doesnt_read_is_passed_over(
    client: TestClient, config: Config, clock: Clock, spoil: Any
) -> None:
    made = alices_run(client, config, clock)
    tracker = made["tracker"]["id"]
    file = client.get("/api/export").json()
    spoil(file["runs"][0], file)
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        r = post_import(bob, file).json()
        assert (r["trackers"], r["runs"]) == (1, 0)
        assert bob.get(f"/api/runs/{tracker}").status_code == 404


def test_a_file_brings_at_most_max_trackers_programmes_and_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tracker_api import validate

    monkeypatch.setattr(validate, "MAX_TRACKERS", 1)
    entry = {"doc": {}, "createdAt": 1, "updatedAt": 1}
    two = [{**entry, "id": "a"}, {**entry, "id": "b"}]
    assert [p["id"] for p in validate.normalise_programme_files(two)] == ["a"]
    runs: list[dict[str, Any]] = [{"tracker": t, "doc": {}, "start": TODAY} for t in ("a", "b")]
    assert [r["tracker"] for r in validate.normalise_run_files(runs)] == ["a"]


@pytest.mark.parametrize(("name", "case"), fixture_cases("programmes"), ids=lambda v: str(v)[:40])
def test_the_files_programmes_and_runs_normalise(name: str, case: dict[str, Any]) -> None:
    parsed = parse_export(json.dumps(case["input"]))
    out = {k: v for k, v in parsed.items() if k in ("programmes", "runs")}
    assert out == case["expected"]
