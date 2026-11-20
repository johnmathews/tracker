"""The programme library over REST (docs/specs/2026-11-17-programmes.md §3.4, §11.2): the public
schema, list, add, read, replace with `rev`, delete and validate, each account's own, and the
quotas."""

import copy
import json
import re
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api import data
from tracker_api.app import create_app
from tracker_api.config import Config
from tracker_api.db import connect
from tracker_api.programme import SCHEMA_PATH, check_programme

from .conftest import ORIGIN, Clock
from .test_api import other_client, sign_up

VALID = Path(__file__).resolve().parents[2] / "fixtures" / "programmes" / "valid"


def doc(name: str = "beginner-5x5") -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((VALID / f"{name}.json").read_text(encoding="utf-8"))
    return loaded


#: A document with three problems at once.
BROKEN: dict[str, Any] = {
    **doc("minimal"),
    "weeks": 0,
    "kind": "yoga",
    "extra": True,
}


def add(client: TestClient, document: object) -> Any:
    return client.post("/api/programmes", json={"doc": document})


def delete(client: TestClient, url: str) -> Any:
    """A DELETE as the app sends it: every write carries the JSON content type."""
    return client.delete(url, headers={"Content-Type": "application/json"})


def stored_count(config: Config) -> int:
    conn = connect(config.db_path)
    try:
        return int(conn.execute("SELECT count(*) FROM programmes").fetchone()[0])
    finally:
        conn.close()


def errors_of(document: object) -> list[dict[str, str]]:
    return [{"path": e.path, "message": e.message} for e in check_programme(document)]


# --- the schema --------------------------------------------------------------------------------


def test_the_schema_is_public_and_is_the_committed_file(client: TestClient) -> None:
    """No sign-in: an agent reads the format before it has an account's token."""
    r = client.get("/api/programme.schema.json")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/schema+json"
    assert r.content == SCHEMA_PATH.read_bytes()
    assert r.json()["$id"] == "https://tracker.itsa-pizza.com/api/programme.schema.json"


def test_the_schema_answers_without_an_origin_or_a_cookie(config: Config) -> None:
    with TestClient(create_app(config, run_backups=False), base_url=ORIGIN) as bare:
        r = bare.get("/api/programme.schema.json")
    assert r.status_code == 200
    assert r.json()["title"] == "Tracker programme"


# --- sign-in ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/programmes", None),
        ("POST", "/api/programmes", {"doc": doc()}),
        ("POST", "/api/programmes/validate", {"doc": doc()}),
        ("POST", "/api/programmes/draft", {"doc": doc()}),
        ("GET", "/api/programmes/xp1", None),
        ("PUT", "/api/programmes/xp1", {"doc": doc(), "rev": 1}),
        ("DELETE", "/api/programmes/xp1", None),
    ],
)
def test_the_library_needs_a_session(
    client: TestClient, method: str, path: str, body: dict[str, Any] | None
) -> None:
    r = client.request(method, path, json=body, headers={"Content-Type": "application/json"})
    assert (r.status_code, r.json()) == (401, {"error": "auth"})


def test_a_write_needs_the_origin(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    r = client.post("/api/programmes", json={"doc": doc()}, headers={"Origin": "https://evil"})
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    assert stored_count(config) == 0


# --- add, list and read ---------------------------------------------------------------------------


def test_an_added_programme_is_listed_and_read(
    client: TestClient, config: Config, clock: Clock
) -> None:
    sign_up(client, config)
    assert client.get("/api/programmes").json() == {"programmes": []}
    document = {**doc(), "name": "  Beginner 5\u00d75  "}
    r = add(client, document)
    assert r.status_code == 201, r.text
    record = r.json()
    # The app's `newId` shape, made by the server.
    assert re.fullmatch(r"x[0-9a-z]{8,9}[0-9a-z]{4}", record["id"])
    summary = {
        "id": record["id"],
        # From the document, trimmed as the format reads it.
        "name": "Beginner 5\u00d75",
        "description": document["description"],
        "kind": "strength",
        "weeks": 8,
        "activities": len(document["activities"]),
        "rev": 1,
        "createdAt": clock.now,
        "updatedAt": clock.now,
    }
    # The document comes back as it was sent.
    assert record == {**summary, "doc": document}
    assert client.get(f"/api/programmes/{record['id']}").json() == record
    assert client.get("/api/programmes").json() == {"programmes": [summary]}


def test_the_list_puts_the_one_changed_last_first(
    client: TestClient, config: Config, clock: Clock
) -> None:
    sign_up(client, config)
    first = add(client, doc("minimal")).json()
    clock.advance(60)
    second = add(client, doc("cardio")).json()
    clock.advance(60)
    listed = client.get("/api/programmes").json()["programmes"]
    assert [p["id"] for p in listed] == [second["id"], first["id"]]
    assert listed[1]["description"] is None and listed[0]["kind"] == "cardio"
    client.put(f"/api/programmes/{first['id']}", json={"doc": doc("ten-kg"), "rev": 1})
    listed = client.get("/api/programmes").json()["programmes"]
    assert [p["id"] for p in listed] == [first["id"], second["id"]]


@pytest.mark.parametrize("name", ["beginner-5x5", "cardio", "minimal", "mobility", "ten-kg"])
def test_each_valid_fixture_is_added(client: TestClient, config: Config, name: str) -> None:
    sign_up(client, config)
    r = add(client, doc(name))
    assert r.status_code == 201, r.text
    assert r.json()["doc"] == doc(name)


def test_a_document_with_errors_is_never_stored(client: TestClient, config: Config) -> None:
    """Every problem at once, each with its path and a sentence, and nothing written."""
    sign_up(client, config)
    expected = errors_of(BROKEN)
    assert len(expected) >= 3
    r = add(client, BROKEN)
    assert (r.status_code, r.json()) == (400, {"error": "invalid", "errors": expected})
    assert all(set(e) == {"path", "message"} for e in r.json()["errors"])
    assert stored_count(config) == 0
    assert client.get("/api/programmes").json() == {"programmes": []}


@pytest.mark.parametrize("body", [{}, {"doc": None}, {"doc": []}, {"doc": "text"}])
def test_a_body_without_a_document_gets_the_formats_error(
    client: TestClient, config: Config, body: dict[str, Any]
) -> None:
    sign_up(client, config)
    r = client.post("/api/programmes", json=body)
    assert r.status_code == 400
    assert r.json() == {
        "error": "invalid",
        "errors": [{"path": "", "message": "a programme is a JSON object."}],
    }
    assert stored_count(config) == 0


def test_a_body_that_is_not_json_is_refused(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    r = client.post(
        "/api/programmes", content="{nope", headers={"Content-Type": "application/json"}
    )
    assert (r.status_code, r.json()) == (400, {"error": "json"})


# --- validate -----------------------------------------------------------------------------------


def test_validate_returns_every_error_and_stores_nothing(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    r = client.post("/api/programmes/validate", json={"doc": BROKEN})
    assert (r.status_code, r.json()) == (200, {"errors": errors_of(BROKEN)})
    r = client.post("/api/programmes/validate", json={"doc": doc()})
    assert (r.status_code, r.json()) == (200, {"errors": []})
    r = client.post("/api/programmes/validate", json={})
    assert r.json() == {"errors": [{"path": "", "message": "a programme is a JSON object."}]}
    assert stored_count(config) == 0


def test_a_get_of_validate_is_not_a_programme(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    r = client.get("/api/programmes/validate")
    assert (r.status_code, r.json()) == (404, {"error": "not-found"})


# --- draft (docs/specs/2026-11-20-programme-builder.md §7) ----------------------------------------


def row_counts(config: Config) -> dict[str, int]:
    """Every table's row count: a route that stores nothing leaves each one as it was."""
    conn = connect(config.db_path)
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        return {
            t: int(conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0])  # noqa: S608
            for t in tables
        }
    finally:
        conn.close()


def draft(client: TestClient, document: object) -> Any:
    r = client.post("/api/programmes/draft", json={"doc": document})
    assert r.status_code == 200, r.text
    return r.json()


def heavy_deadlift() -> dict[str, Any]:
    """The beginner fixture with the deadlift at +90 kg a week: weeks 6 to 8 are over 500 kg."""
    document = doc()
    document["activities"][3]["weight"]["add"] = 90
    return document


def test_draft_of_a_valid_document_is_the_reference_preview(
    client: TestClient, config: Config
) -> None:
    """S1: no errors, and the plan the shared library's preview shows for the same document."""
    from .test_shared_api import ADMIN, set_admin, shared_programme

    sign_up(client, config, ADMIN)
    set_admin(config, ADMIN)
    _, shared_id = shared_programme(client)
    reference = client.get(f"/api/shared-programmes/{shared_id}/preview").json()["plan"]
    out = draft(client, doc())
    assert out == {"errors": [], "plan": reference}
    assert "limits" not in json.dumps(out)


def test_draft_marks_each_week_over_a_limit(client: TestClient, config: Config) -> None:
    """S2: a document whose only problems are week limits still has its weeks. Each cell over the
    limit names the problem's path under `limits`, keyed by the field."""
    sign_up(client, config)
    document = heavy_deadlift()
    out = draft(client, document)
    assert out["errors"] == [
        {"path": "activities[3].weight", "message": "week 6 comes to 510 kg. The most is 500."}
    ]
    assert out["errors"] == errors_of(document)
    weeks = out["plan"]["grid"]["weeks"]
    assert [w["programmeWeeks"] for w in weeks] == [[n] for n in range(1, 9)]
    marked = {
        (w["programmeWeeks"][0], key): cell["limits"]
        for w in weeks
        for key, cell in w["cells"].items()
        if "limits" in cell
    }
    assert marked == {(n, "deadlift"): {"weight": "activities[3].weight"} for n in (6, 7, 8)}
    deadlift = [w["cells"]["deadlift"]["values"]["weight"] for w in weeks]
    assert deadlift == [60, 150, 240, 297.5, 420, 510, 600, 620]


def test_draft_marks_only_the_weeks_over_the_limit(client: TestClient, config: Config) -> None:
    """A week an exception brings back under the limit is not marked."""
    sign_up(client, config)
    document = heavy_deadlift()
    document["overrides"].append(
        {"weeks": [7], "activities": {"deadlift": {"weight": {"scale": 0.5}}}}
    )
    out = draft(client, document)
    assert [e["path"] for e in out["errors"]] == ["activities[3].weight"]
    marked = [
        w["programmeWeeks"][0]
        for w in out["plan"]["grid"]["weeks"]
        if "limits" in w["cells"]["deadlift"]
    ]
    assert marked == [6, 8]


def test_draft_of_a_rest_week_holds_the_series_and_picks_up_at_the_previous_setting(
    client: TestClient, config: Config
) -> None:
    """K192, John's example: the back squat at 40, 42.5, 45, rest, 45, 47.5, 50. The rest week
    plans no sessions at 45 kg, and a planned rest ends nothing short."""
    from .test_programme import rest, rest_doc

    sign_up(client, config)
    out = draft(client, rest_doc(rest(4)))
    assert out["errors"] == []
    plan = out["plan"]
    assert plan["endsShort"] == []
    cells = [w["cells"]["squat"] for w in plan["grid"]["weeks"]]
    assert [c["values"]["weight"] for c in cells] == [40, 42.5, 45, 45, 45, 47.5, 50]
    assert [c["activityWeek"] for c in cells] == [1, 2, 3, 3, 3, 4, 5]
    assert [c["values"]["target"] for c in cells] == [3, 3, 3, 0, 3, 3, 3]


def test_draft_marks_the_programme_weeks_a_rest_moves_a_limit_to(
    client: TestClient, config: Config
) -> None:
    """The limit names programme weeks: 525 kg comes in week 8, at activity week 6."""
    from .test_programme import rest, rest_doc

    sign_up(client, config)
    document = rest_doc(rest(4), weeks=8, weight={"start": 400, "add": 25})
    out = draft(client, document)
    assert out["errors"] == [
        {"path": "activities[0].weight", "message": "week 8 comes to 525 kg. The most is 500."}
    ]
    marked = [
        (w["programmeWeeks"], w["cells"]["squat"]["activityWeek"])
        for w in out["plan"]["grid"]["weeks"]
        if "limits" in w["cells"]["squat"]
    ]
    assert marked == [([8], 6)]


def test_draft_with_any_other_problem_has_no_plan(
    client: TestClient, config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    """S2: a shape problem, a limit beside a shape problem, a missing document or one over the
    size cap: every problem as validate gives it, and `plan` null."""
    sign_up(client, config)
    assert draft(client, BROKEN) == {"errors": errors_of(BROKEN), "plan": None}
    mixed = {**heavy_deadlift(), "name": ""}
    out = draft(client, mixed)
    assert out == {"errors": errors_of(mixed), "plan": None}
    assert [e["path"] for e in out["errors"]] == ["name", "activities[3].weight"]
    r = client.post("/api/programmes/draft", json={})
    assert r.json() == {
        "errors": [{"path": "", "message": "a programme is a JSON object."}],
        "plan": None,
    }
    size = len(data.encode_programme(doc()).encode())
    monkeypatch.setattr(data, "MAX_PROGRAMME_BYTES", size - 1)
    assert draft(client, doc()) == {
        "errors": [{"path": "", "message": f"the programme is over {size - 1:,} bytes as stored."}],
        "plan": None,
    }


def test_draft_stores_nothing(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    add(client, doc("minimal"))
    before = row_counts(config)
    for document in (doc(), heavy_deadlift(), BROKEN):
        draft(client, document)
    assert row_counts(config) == before


def test_a_get_of_draft_is_not_a_programme(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    r = client.get("/api/programmes/draft")
    assert (r.status_code, r.json()) == (404, {"error": "not-found"})


# --- replace ------------------------------------------------------------------------------------


def test_a_replace_with_the_current_rev_moves_it_on(
    client: TestClient, config: Config, clock: Clock
) -> None:
    sign_up(client, config)
    created = add(client, doc()).json()
    clock.advance(90)
    changed = {**doc(), "name": "Stronger 5\u00d75", "weeks": 10}
    r = client.put(f"/api/programmes/{created['id']}", json={"doc": changed, "rev": 1})
    assert r.status_code == 200, r.text
    assert r.json() == {
        **created,
        "name": "Stronger 5\u00d75",
        "weeks": 10,
        "rev": 2,
        "updatedAt": created["createdAt"] + 90,
        "doc": changed,
    }
    assert client.get(f"/api/programmes/{created['id']}").json() == r.json()


def test_a_stale_rev_gets_409_with_the_server_copy(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    created = add(client, doc()).json()
    url = f"/api/programmes/{created['id']}"
    first = client.put(url, json={"doc": {**doc(), "name": "One"}, "rev": 1}).json()
    r = client.put(url, json={"doc": {**doc(), "name": "Two"}, "rev": 1})
    assert r.status_code == 409
    # The shape of a tracker's conflict: the server's copy, and its rev.
    assert r.json() == {"error": "conflict", "programme": first, "rev": 2}
    assert client.get(url).json() == first


def test_a_stale_rev_that_sends_the_stored_document_is_not_a_conflict(
    client: TestClient, config: Config
) -> None:
    """A replace sent twice (a retry) finds the document already so: it stays at its rev."""
    sign_up(client, config)
    created = add(client, doc()).json()
    url = f"/api/programmes/{created['id']}"
    again = {**doc(), "name": "Again"}
    saved = client.put(url, json={"doc": again, "rev": 1}).json()
    r = client.put(url, json={"doc": again, "rev": 1})
    assert (r.status_code, r.json()) == (200, saved)


def test_a_replace_with_errors_changes_nothing(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    created = add(client, doc()).json()
    url = f"/api/programmes/{created['id']}"
    r = client.put(url, json={"doc": BROKEN, "rev": 1})
    assert (r.status_code, r.json()) == (400, {"error": "invalid", "errors": errors_of(BROKEN)})
    # Errors come first, whatever the rev.
    r = client.put(url, json={"doc": BROKEN, "rev": 7})
    assert r.status_code == 400
    assert client.get(url).json() == created


@pytest.mark.parametrize("rev", [None, -1, True, 1.0, "1"])
def test_a_replace_needs_a_whole_rev(client: TestClient, config: Config, rev: object) -> None:
    sign_up(client, config)
    created = add(client, doc()).json()
    url = f"/api/programmes/{created['id']}"
    body: dict[str, Any] = {"doc": doc("minimal")}
    if rev is not None:
        body["rev"] = rev
    r = client.put(url, json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})
    assert client.get(url).json() == created


def test_a_replace_of_no_programme_is_404(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    r = client.put("/api/programmes/xnone", json={"doc": doc(), "rev": 0})
    assert (r.status_code, r.json()) == (404, {"error": "not-found"})
    assert stored_count(config) == 0


# --- delete ---------------------------------------------------------------------------------------


def test_delete_removes_it(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    kept = add(client, doc("minimal")).json()
    created = add(client, doc()).json()
    url = f"/api/programmes/{created['id']}"
    r = delete(client, url)
    assert (r.status_code, r.content) == (204, b"")
    assert client.get(url).json() == {"error": "not-found"}
    assert delete(client, url).status_code == 404
    assert [p["id"] for p in client.get("/api/programmes").json()["programmes"]] == [kept["id"]]


# --- each account's own ---------------------------------------------------------------------------


def test_another_accounts_programme_is_404(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    mine = add(client, doc()).json()
    url = f"/api/programmes/{mine['id']}"
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        assert bob.get("/api/programmes").json() == {"programmes": []}
        assert bob.get(url).json() == {"error": "not-found"}
        r = bob.put(url, json={"doc": doc("minimal"), "rev": 1})
        assert (r.status_code, r.json()) == (404, {"error": "not-found"})
        r = delete(bob, url)
        assert (r.status_code, r.json()) == (404, {"error": "not-found"})
        # Bob's own programme is his, and Alice never sees it.
        theirs = add(bob, doc("cardio")).json()
    assert client.get(url).json() == mine
    assert client.get(f"/api/programmes/{theirs['id']}").status_code == 404
    assert [p["id"] for p in client.get("/api/programmes").json()["programmes"]] == [mine["id"]]


# --- quotas -------------------------------------------------------------------------------------


def test_the_library_holds_at_most_max_programmes(
    client: TestClient, config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_up(client, config)
    monkeypatch.setattr(data, "MAX_PROGRAMMES", 2)
    first = add(client, doc("minimal")).json()
    add(client, doc("minimal"))
    r = add(client, doc("minimal"))
    assert (r.status_code, r.json()) == (409, {"error": "too-many"})
    assert stored_count(config) == 2
    # A replace isn't an add, and a delete makes room.
    url = f"/api/programmes/{first['id']}"
    assert client.put(url, json={"doc": doc(), "rev": 1}).status_code == 200
    delete(client, url)
    assert add(client, doc()).status_code == 201


def test_a_document_over_the_size_cap_is_refused(
    client: TestClient, config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    """413 `too-large`, as an item's details over their cap; validate names it as a problem."""
    sign_up(client, config)
    small = add(client, doc("minimal")).json()
    size = len(data.encode_programme(doc()).encode())
    monkeypatch.setattr(data, "MAX_PROGRAMME_BYTES", size - 1)
    r = add(client, doc())
    assert (r.status_code, r.json()) == (413, {"error": "too-large"})
    url = f"/api/programmes/{small['id']}"
    r = client.put(url, json={"doc": doc(), "rev": 1})
    assert (r.status_code, r.json()) == (413, {"error": "too-large"})
    assert stored_count(config) == 1
    r = client.post("/api/programmes/validate", json={"doc": doc()})
    assert r.json() == {
        "errors": [{"path": "", "message": f"the programme is over {size - 1:,} bytes as stored."}]
    }
    monkeypatch.setattr(data, "MAX_PROGRAMME_BYTES", size)
    assert add(client, doc()).status_code == 201


def test_programmes_count_towards_the_accounts_quota(client: TestClient, config: Config) -> None:
    """A full account can't add a programme, but can still replace one with a smaller one or
    delete it (a shrinking write always passes)."""
    sign_up(client, config)
    created = add(client, doc()).json()
    conn = connect(config.db_path)
    try:
        size = len(data.encode_programme(doc()).encode())
        assert data.usage(conn, 1) == size
    finally:
        conn.close()
    # The same database and session, served under a quota the account already fills.
    full = replace(config, user_quota_bytes=size)
    with TestClient(
        create_app(full, run_backups=False), base_url=ORIGIN, headers={"Origin": ORIGIN}
    ) as tight:
        tight.cookies.update(client.cookies)
        r = add(tight, doc("minimal"))
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
        url = f"/api/programmes/{created['id']}"
        bigger = copy.deepcopy(doc())
        bigger["description"] = "x" * 1000
        r = tight.put(url, json={"doc": bigger, "rev": 1})
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
        r = tight.put(url, json={"doc": doc("minimal"), "rev": 1})
        assert r.status_code == 200
        assert delete(tight, url).status_code == 204
    assert stored_count(config) == 0
