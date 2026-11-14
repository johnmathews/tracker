"""Trackers each account owns (K123, docs/specs/2026-11-14-account-trackers.md): the REST
endpoints, the weeks a tracker shows in, the daily targets kept in step with settings, the state
and export version 6."""

import copy
import json
import re
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api import data
from tracker_api.config import Config
from tracker_api.db import connect
from tracker_api.validate import MAX_TRACKER_NAME, TrackerInfo

from .test_api import (
    EMPTY,
    EMPTY_STATE,
    FIRST_TRACKERS,
    PUSHUPS,
    WEEK,
    other_client,
    post_import,
    sign_up,
)

#: The conftest clock's day, 2026-10-23, is a Friday: its week starts on this Monday.
THIS_WEEK = "2026-10-19"
NEXT_WEEK = "2026-10-26"


def create(client: TestClient, **body: Any) -> Any:
    return client.post("/api/trackers", json={"name": "Upper body", "kind": "strength", **body})


def ids(client: TestClient) -> list[str]:
    return [t["id"] for t in client.get("/api/trackers").json()["trackers"]]


# --- create ----------------------------------------------------------------------------------


def test_an_account_starts_with_the_first_three(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    trackers = client.get("/api/trackers").json()["trackers"]
    assert trackers == [{**t, "rev": 1} for t in FIRST_TRACKERS]


def test_a_new_tracker_goes_last_empty_from_this_week(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    r = create(client, name="  Upper body  ")
    assert r.status_code == 201
    tracker = r.json()
    # The app's `newId` shape: `x`, the time in base 36, four random characters.
    assert re.fullmatch(r"x[0-9a-z]{8,9}[0-9a-z]{4}", tracker["id"])
    assert tracker == {
        "id": tracker["id"],
        "name": "Upper body",
        "kind": "strength",
        "position": 3,
        "dailyTarget": 3,
        "startWeek": THIS_WEEK,
        "endWeek": None,
        "rev": 1,
    }
    assert ids(client) == ["exercise", "cardio", "diet", tracker["id"]]
    state = client.get("/api/state").json()
    assert state["sections"][tracker["id"]] == {"plans": {}, "log": {}, "revs": {}}
    assert (state["details"][tracker["id"]], state["detailRevs"][tracker["id"]]) == ({}, {})
    # A second goes after it, and each kind starts with its own daily target.
    food = create(client, name="Supplements", kind="food").json()
    cardio = create(client, name="Swimming", kind="cardio").json()
    assert (food["position"], food["dailyTarget"]) == (4, 2)
    assert (cardio["position"], cardio["dailyTarget"]) == (5, None)


def test_a_create_may_name_its_week_and_its_id(client: TestClient, config: Config) -> None:
    """The week is any day of it, and the id is the client's own, so an outbox can send the
    create again and get the same tracker back."""
    sign_up(client, config)
    r = create(client, id="xmine1234", week="2026-10-29")
    assert (r.status_code, r.json()["id"], r.json()["startWeek"]) == (201, "xmine1234", NEXT_WEEK)
    again = create(client, id="xmine1234", name="Another name", week="2026-11-02")
    assert (again.status_code, again.json()) == (200, r.json())
    # The first three's ids are taken too: a create of the same kind gets the tracker back.
    first = create(client, id="exercise")
    assert (first.status_code, first.json()["name"]) == (200, "Strength")
    for tracker_id in ("xmine1234", "diet"):
        r = create(client, id=tracker_id, kind="cardio")
        assert (r.status_code, r.json()) == (409, {"error": "exists"})
    assert len(ids(client)) == 4


@pytest.mark.parametrize(
    "body",
    [
        {"name": None},
        {"name": 3},
        {"name": " \n\t "},
        {"name": "x" * (MAX_TRACKER_NAME + 1)},
        {"kind": "exercise"},
        {"kind": "yoga"},
        {"kind": None},
        {"id": "has space"},
        {"id": "x" * 65},
        {"id": "__proto__"},
        {"id": ""},
        {"id": 7},
        {"week": "2026-13-01"},
        {"week": "2026-02-30"},
        {"week": "soon"},
        {"week": 20261019},
    ],
)
def test_a_bad_create_is_400(client: TestClient, config: Config, body: dict[str, Any]) -> None:
    sign_up(client, config)
    r = create(client, **body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})
    assert len(ids(client)) == 3


def test_a_name_of_60_characters_is_kept(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    name = "é" * MAX_TRACKER_NAME
    assert create(client, name=name).json()["name"] == name


def test_an_account_holds_at_most_max_trackers(
    client: TestClient, config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(data, "MAX_TRACKERS", 5)
    sign_up(client, config)
    assert create(client).status_code == 201
    end = create(client).json()["id"]
    client.post(f"/api/trackers/{end}/end", json={})
    # An ended tracker still counts: its row stays.
    r = create(client)
    assert (r.status_code, r.json()) == (409, {"error": "too-many"})


def test_trackers_need_a_session(client: TestClient) -> None:
    assert client.get("/api/trackers").status_code == 401
    assert create(client).status_code == 401
    assert client.patch("/api/trackers/exercise", json={"rev": 1, "name": "x"}).status_code == 401
    assert client.post("/api/trackers/exercise/end", json={}).status_code == 401


# --- rename, move and the daily target --------------------------------------------------------


def test_a_patch_renames_moves_and_sets_the_target(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    tracker = create(client).json()
    url = f"/api/trackers/{tracker['id']}"
    r = client.patch(url, json={"rev": 1, "name": " Push day ", "position": 0, "dailyTarget": 5})
    assert r.status_code == 200
    assert r.json() == {**tracker, "name": "Push day", "position": 0, "dailyTarget": 5, "rev": 2}
    # Position is a sort key: ties fall back to the id.
    assert ids(client) == ["exercise", tracker["id"], "cardio", "diet"]


def test_a_stale_patch_conflicts_unless_it_changes_nothing(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    url = "/api/trackers/cardio"
    assert client.patch(url, json={"rev": 1, "name": "Runs"}).json()["rev"] == 2
    stored = client.get("/api/trackers").json()["trackers"][1]
    r = client.patch(url, json={"rev": 1, "name": "Rides"})
    assert (r.status_code, r.json()) == (409, {"error": "conflict", "tracker": stored, "rev": 2})
    # The same change from a device that missed it: not a conflict.
    assert client.patch(url, json={"rev": 1, "name": "Runs"}).json() == stored
    assert client.patch(url, json={"rev": 2, "dailyTarget": None}).json() == stored


def test_a_patch_to_an_unknown_tracker_is_404(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    for url in ("/api/trackers/nope", "/api/trackers/nope/end"):
        method = client.patch if url.endswith("nope") else client.post
        r = method(url, json={"rev": 1, "name": "x"})
        assert (r.status_code, r.json()) == (404, {"error": "not-found"})


@pytest.mark.parametrize(
    ("tracker_id", "body"),
    [
        ("exercise", {"name": "x"}),
        ("exercise", {"rev": -1, "name": "x"}),
        ("exercise", {"rev": True, "name": "x"}),
        ("exercise", {"rev": 1.0, "name": "x"}),
        ("exercise", {"rev": 1}),
        ("exercise", {"rev": 1, "kind": "food"}),
        ("exercise", {"rev": 1, "name": "  "}),
        ("exercise", {"rev": 1, "name": "x" * 61}),
        ("exercise", {"rev": 1, "position": -1}),
        ("exercise", {"rev": 1, "position": 10_001}),
        ("exercise", {"rev": 1, "position": "1"}),
        ("exercise", {"rev": 1, "position": True}),
        ("exercise", {"rev": 1, "dailyTarget": 0}),
        ("exercise", {"rev": 1, "dailyTarget": 9}),
        ("exercise", {"rev": 1, "dailyTarget": 2.5}),
        ("exercise", {"rev": 1, "dailyTarget": None}),
        ("diet", {"rev": 1, "dailyTarget": "3"}),
        ("cardio", {"rev": 1, "dailyTarget": 3}),
    ],
)
def test_a_bad_patch_is_400(
    client: TestClient, config: Config, tracker_id: str, body: dict[str, Any]
) -> None:
    sign_up(client, config)
    r = client.patch(f"/api/trackers/{tracker_id}", json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})
    assert client.get("/api/trackers").json()["trackers"] == EMPTY_STATE["trackers"]


def test_the_first_trackers_targets_move_with_the_settings(
    client: TestClient, config: Config
) -> None:
    """The `exercise` and `diet` trackers hold the daily targets; `dailyPick` and `foodPick`
    are kept in step both ways, so a tab on older code reads and writes them as before."""
    sign_up(client, config)
    # With no settings saved, the tracker holds its target alone.
    client.patch("/api/trackers/exercise", json={"rev": 1, "dailyTarget": 5})
    assert client.get("/api/state").json()["settings"] is None
    settings = {"accent": "#0a84ff", "dailyPick": 6, "foodPick": 4}
    client.put("/api/settings", json=settings)
    trackers = {t["id"]: t for t in client.get("/api/trackers").json()["trackers"]}
    assert (trackers["exercise"]["dailyTarget"], trackers["exercise"]["rev"]) == (6, 3)
    assert (trackers["diet"]["dailyTarget"], trackers["diet"]["rev"]) == (4, 2)
    # The same numbers again move no revision.
    client.put("/api/settings", json=settings)
    again = {t["id"]: t["rev"] for t in client.get("/api/trackers").json()["trackers"]}
    assert again == {"exercise": 3, "cardio": 1, "diet": 2}
    # And a tracker's target reaches the settings.
    client.patch("/api/trackers/exercise", json={"rev": 3, "dailyTarget": 2})
    client.patch("/api/trackers/diet", json={"rev": 2, "dailyTarget": 7})
    saved = client.get("/api/state").json()["settings"]
    assert (saved["dailyPick"], saved["foodPick"]) == (2, 7)
    # A new tracker's target is its own.
    extra = create(client, kind="food").json()
    client.patch(f"/api/trackers/{extra['id']}", json={"rev": 1, "dailyTarget": 1})
    assert client.get("/api/state").json()["settings"]["foodPick"] == 7


def test_the_mcp_daily_targets_reach_the_trackers(client: TestClient, config: Config) -> None:
    """`set_daily_targets` writes the settings (edits.py), which carry the trackers along."""
    from tracker_api import edits

    sign_up(client, config)
    conn = connect(config.db_path)
    try:
        edits.set_daily_targets(conn, 1, exercises_a_day=4, foods_a_day=5)
    finally:
        conn.close()
    trackers = {t["id"]: t["dailyTarget"] for t in client.get("/api/trackers").json()["trackers"]}
    assert trackers == {"exercise": 4, "cardio": None, "diet": 5}


# --- delete tracker: the weeks it shows in --------------------------------------------------


def test_delete_ends_the_tracker_from_the_week_given(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    tracker = create(client, week="2026-10-05").json()
    url = f"/api/trackers/{tracker['id']}/end"
    r = client.post(url, json={"week": "2026-10-31"})
    assert r.json() == {**tracker, "endWeek": NEXT_WEEK, "rev": 2}
    # A later week never brings a week back; an earlier one moves the end.
    assert client.post(url, json={"week": "2026-11-09"}).json()["endWeek"] == NEXT_WEEK
    assert client.post(url, json={}).json() == {**tracker, "endWeek": THIS_WEEK, "rev": 3}
    # Still listed, so its earlier weeks keep it.
    assert tracker["id"] in ids(client)


@pytest.mark.parametrize("week", ["2026-10-32", "next", 5, ""])
def test_a_bad_end_week_is_400(client: TestClient, config: Config, week: object) -> None:
    sign_up(client, config)
    r = client.post("/api/trackers/exercise/end", json={"week": week})
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})


def info(start: str | None, end: str | None) -> TrackerInfo:
    return {
        "id": "t",
        "name": "T",
        "kind": "food",
        "position": 0,
        "dailyTarget": 2,
        "startWeek": start,
        "endWeek": end,
    }


@pytest.mark.parametrize(
    ("start", "end", "week", "shows"),
    [
        (None, None, "2020-01-06", True),
        ("2026-10-12", None, "2026-10-05", False),
        ("2026-10-12", None, "2026-10-12", True),
        ("2026-10-12", None, "2030-01-07", True),
        (None, "2026-10-19", "2026-10-12", True),
        (None, "2026-10-19", "2026-10-19", False),
        (None, "2026-10-19", "2026-10-26", False),
        ("2026-10-12", "2026-10-19", "2026-10-12", True),
        # Created and deleted in the same week: it shows nowhere.
        ("2026-10-19", "2026-10-19", "2026-10-19", False),
    ],
)
def test_shows_in(start: str | None, end: str | None, week: str, shows: bool) -> None:
    assert data.shows_in(info(start, end), week) is shows


def test_a_deleted_tracker_leaves_its_week_on_and_keeps_its_history(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    plan = f"/api/plans/diet/{WEEK}"
    client.put(plan, json={"items": [{"id": "veg", "name": "Veg", "target": 7}], "rev": 0})
    client.put(f"/api/ticks/diet/{WEEK}/veg/1", json={"mark": "great"})
    client.post("/api/trackers/diet/end", json={"week": NEXT_WEEK})
    conn = connect(config.db_path)
    try:
        before = [t["id"] for t in data.trackers_in(conn, 1, WEEK)]
        after = [t["id"] for t in data.trackers_in(conn, 1, NEXT_WEEK)]
        later = [t["id"] for t in data.trackers_in(conn, 1, "2026-11-02")]
    finally:
        conn.close()
    assert before == ["exercise", "cardio", "diet"]
    assert after == later == ["exercise", "cardio"]
    # Its plans and marks stay, and a past week can still be marked.
    diet = client.get("/api/state").json()["sections"]["diet"]
    assert diet["plans"][WEEK] == [{"id": "veg", "name": "Veg", "target": 7}]
    assert client.put(f"/api/ticks/diet/{WEEK}/veg/2", json={"mark": "great"}).status_code == 200


# --- writes check the tracker -------------------------------------------------------------------


def test_writes_go_to_a_new_tracker_by_its_kind(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    supplements = create(client, name="Supplements", kind="food").json()["id"]
    items = [{"id": "d3", "name": "Vitamin D", "sets": 3, "reps": 10, "target": 7}]
    assert client.put(
        f"/api/plans/{supplements}/{WEEK}", json={"items": items, "rev": 0}
    ).json() == {"rev": 1}
    client.put(f"/api/ticks/{supplements}/{WEEK}/d3/0", json={"mark": "great"})
    client.put(f"/api/details/{supplements}/d3", json={"details": {"notes": "Pill."}, "rev": 0})
    state = client.get("/api/state").json()
    assert state["sections"][supplements] == {
        "plans": {WEEK: [{"id": "d3", "name": "Vitamin D", "target": 7}]},
        "log": {WEEK: {"d3": ["great"] + [None] * 6}},
        "revs": {WEEK: 1},
    }
    assert state["details"][supplements] == {"d3": {"notes": "Pill."}}
    assert state["detailRevs"][supplements] == {"d3": 1}
    # Only the first three go under the keys a tab on older code reads.
    assert supplements not in state
    assert state["diet"] == EMPTY


def test_a_mobility_tracker_plans_holds_and_reps_without_weight(
    client: TestClient, config: Config
) -> None:
    """W8: mobility has strength's sets, then reps or a hold time, each side, and no weight; a
    weight sent anyway drops out, as a field another kind lacks does."""
    sign_up(client, config)
    r = create(client, name="Mobility", kind="mobility")
    assert r.status_code == 201
    tracker = r.json()
    assert (tracker["kind"], tracker["dailyTarget"], tracker["position"]) == ("mobility", 3, 3)
    mobility = tracker["id"]
    items = [
        {"id": "hip", "name": "Hip hold", "sets": 2, "duration": 45, "perSide": True, "target": 4},
        {"id": "cat", "name": "Cat-cow", "sets": 3, "reps": 10, "weight": 8, "target": 3},
    ]
    assert client.put(f"/api/plans/{mobility}/{WEEK}", json={"items": items, "rev": 0}).json() == {
        "rev": 1
    }
    assert client.get("/api/state").json()["sections"][mobility]["plans"][WEEK] == [
        {**items[0], "reps": 0},
        {"id": "cat", "name": "Cat-cow", "sets": 3, "reps": 10, "target": 3},
    ]
    patched = client.patch(f"/api/trackers/{mobility}", json={"rev": 1, "dailyTarget": 5})
    assert patched.json()["dailyTarget"] == 5


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (f"/api/plans/nope/{WEEK}", {"items": [], "rev": 0}),
        (f"/api/ticks/nope/{WEEK}/pu/0", {"mark": "great"}),
        ("/api/details/nope/pu", {"details": {}, "rev": 0}),
    ],
)
def test_writes_to_a_tracker_the_user_lacks_are_400(
    client: TestClient, config: Config, path: str, body: dict[str, Any]
) -> None:
    sign_up(client, config)
    r = client.put(path, json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})
    assert client.get("/api/state").json() == EMPTY_STATE


def test_users_keep_their_own_trackers(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    mine = create(client).json()["id"]
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        assert ids(bob) == ["exercise", "cardio", "diet"]
        r = bob.patch(f"/api/trackers/{mine}", json={"rev": 1, "name": "Taken"})
        assert (r.status_code, r.json()) == (404, {"error": "not-found"})
        assert bob.post(f"/api/trackers/{mine}/end", json={}).status_code == 404
        r = bob.put(f"/api/plans/{mine}/{WEEK}", json={"items": [], "rev": 0})
        assert (r.status_code, r.json()) == (400, {"error": "invalid"})
        # The same id in Bob's account is a tracker of his own.
        assert create(bob, id=mine, name="Bob's").status_code == 201
        bob.post("/api/trackers/exercise/end", json={})
    alice = client.get("/api/trackers").json()["trackers"]
    assert [(t["id"], t["name"], t["endWeek"]) for t in alice] == [
        ("exercise", "Strength", None),
        ("cardio", "Cardio", None),
        ("diet", "Food", None),
        (mine, "Upper body", None),
    ]


# --- the state and export version 6 -----------------------------------------------------------


def test_the_state_carries_trackers_and_the_older_keys(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    client.put(f"/api/plans/exercise/{WEEK}", json={"items": [PUSHUPS], "rev": 0})
    client.put(f"/api/ticks/exercise/{WEEK}/pu/0", json={"mark": "partial"})
    client.put("/api/details/exercise/pu", json={"details": {"notes": "Slow."}, "rev": 0})
    state = client.get("/api/state").json()
    assert set(state) == {
        "trackers",
        "sections",
        "details",
        "detailRevs",
        "exercise",
        "cardio",
        "diet",
        "settings",
    }
    exercise = {
        "plans": {WEEK: [PUSHUPS]},
        "log": {WEEK: {"pu": ["partial"] + [None] * 6}},
        "revs": {WEEK: 1},
    }
    assert state["sections"]["exercise"] == exercise
    assert state["details"]["exercise"] == {"pu": {"notes": "Slow."}}
    assert state["detailRevs"]["exercise"] == {"pu": 1}
    assert state["exercise"] == {
        **exercise,
        "details": {"pu": {"notes": "Slow."}},
        "detailRevs": {"pu": 1},
    }


def alices_account(client: TestClient, config: Config) -> dict[str, str]:
    """Alice with a strength tracker of her own, with a plan, a mark and a note, and a cardio
    tracker she made and deleted."""
    sign_up(client, config)
    upper = create(client, week="2026-10-12").json()["id"]
    swim = create(client, name="Swimming", kind="cardio", week="2026-10-05").json()["id"]
    client.put(f"/api/plans/{upper}/{WEEK}", json={"items": [PUSHUPS], "rev": 0})
    client.put(f"/api/ticks/{upper}/{WEEK}/pu/2", json={"mark": "great-solid"})
    client.put(f"/api/details/{upper}/pu", json={"details": {"notes": "Slow."}, "rev": 0})
    pool = {"id": "pool", "name": "Pool", "duration": 2700, "target": 2}
    client.put(f"/api/plans/{swim}/2026-10-05", json={"items": [pool], "rev": 0})
    client.post(f"/api/trackers/{swim}/end", json={"week": "2026-10-12"})
    return {"upper": upper, "swim": swim}


def test_export_is_version_6_and_imports_into_another_account(
    client: TestClient, config: Config
) -> None:
    made = alices_account(client, config)
    exported = client.get("/api/export").json()
    assert exported["version"] == 6
    assert [t["id"] for t in exported["trackers"]] == [
        "exercise",
        "cardio",
        "diet",
        made["upper"],
        made["swim"],
    ]
    # The file carries no revisions; it does carry the weeks.
    assert "rev" not in exported["trackers"][3]
    assert (exported["trackers"][4]["startWeek"], exported["trackers"][4]["endWeek"]) == (
        "2026-10-05",
        "2026-10-12",
    )
    assert exported["sections"][made["upper"]] == {
        "plans": {WEEK: [PUSHUPS]},
        "log": {WEEK: {"pu": [None, None, "great-solid", None, None, None, None]}},
    }
    assert exported["details"][made["upper"]] == {"pu": {"notes": "Slow."}}
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        r = post_import(bob, exported)
        assert r.json() == {
            "trackers": 2,
            "weeks": 2,
            "ticks": 1,
            "details": 1,
            "settings": False,
            "conversations": 0,
        }
        assert {**bob.get("/api/export").json(), "exportedAt": ""} == {
            **exported,
            "exportedAt": "",
        }
        # The same file again adds nothing.
        assert post_import(bob, exported).json()["trackers"] == 0
        assert post_import(bob, exported).json()["weeks"] == 0


def test_an_import_never_changes_or_ends_a_tracker_the_account_has(
    client: TestClient, config: Config
) -> None:
    made = alices_account(client, config)
    file = client.get("/api/export").json()
    changed = copy.deepcopy(file)
    for t in changed["trackers"]:
        t.update(name="Renamed", endWeek="2026-10-05", dailyTarget=t["dailyTarget"] and 1)
    before = client.get("/api/trackers").json()
    assert post_import(client, changed).json()["trackers"] == 0
    assert client.get("/api/trackers").json() == before
    # A file's tracker with an id the account has for another kind brings no data.
    clash = copy.deepcopy(file)
    clash["trackers"][3]["kind"] = "food"
    clash["sections"][made["upper"]]["plans"] = {"2026-10-26": [{"id": "x", "name": "X"}]}
    assert post_import(client, clash).json()["weeks"] == 0


def test_an_import_adds_trackers_after_the_accounts_own_up_to_the_cap(
    client: TestClient, config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    made = alices_account(client, config)
    file = client.get("/api/export").json()
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        own = create(bob, name="Bob's own").json()["id"]
        monkeypatch.setattr(data, "MAX_TRACKERS", 5)
        assert post_import(bob, file).json()["trackers"] == 1
        trackers = bob.get("/api/trackers").json()["trackers"]
        assert [(t["id"], t["position"]) for t in trackers[3:]] == [(own, 3), (made["upper"], 4)]
        # The tracker left out brings none of its data.
        assert made["swim"] not in bob.get("/api/state").json()["sections"]


def test_a_version_5_file_imports_onto_the_first_three(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    v5 = {
        "format": "tracker-export",
        "version": 5,
        "exercise": {"plans": {WEEK: [PUSHUPS]}, "details": {"pu": {"notes": "Old."}}},
        "cardio": {"log": {WEEK: {"cy": ["great", None, None, None, None, None, None]}}},
        "diet": {"plans": {WEEK: []}},
    }
    r = post_import(client, v5)
    assert r.json() == {
        "trackers": 0,
        "weeks": 2,
        "ticks": 1,
        "details": 1,
        "settings": False,
        "conversations": 0,
    }
    exported = client.get("/api/export").json()
    assert exported["sections"]["exercise"]["plans"] == {WEEK: [PUSHUPS]}
    assert exported["details"]["exercise"] == {"pu": {"notes": "Old."}}
    assert exported["sections"]["cardio"]["log"] == {WEEK: {"cy": ["great"] + [None] * 6}}
    assert exported["sections"]["diet"]["plans"] == {WEEK: []}


def test_the_v6_sample_imports_and_exports_as_it_was(client: TestClient, config: Config) -> None:
    from .fixtures import read_fixture

    sample = read_fixture("sample/export-v6.json")
    sign_up(client, config)
    r = post_import(client, sample)
    assert r.json()["trackers"] == 2
    exported = client.get("/api/export").json()
    assert {**exported, "exportedAt": ""} == {**sample, "exportedAt": ""}
    assert json.loads(json.dumps(exported)) == exported


def test_a_file_brings_at_most_max_trackers(monkeypatch: pytest.MonkeyPatch) -> None:
    from tracker_api import validate

    monkeypatch.setattr(validate, "MAX_TRACKERS", 2)
    raw = [{"id": f"t{i}", "name": f"T{i}", "kind": "food"} for i in range(4)]
    assert [t["id"] for t in validate.normalise_trackers(raw)] == ["t0", "t1"]


def test_the_data_layer_answers_none_for_a_tracker_the_user_lacks(config: Config) -> None:
    conn = connect(config.db_path)
    try:
        from tracker_api.db import migrate

        migrate(conn)
        assert data.patch_tracker(conn, 1, "nope", {"name": "x"}, 1) is None
        assert data.end_tracker(conn, 1, "nope", THIS_WEEK) is None
        assert data.load_tracker(conn, 1, "nope") is None
    finally:
        conn.close()
