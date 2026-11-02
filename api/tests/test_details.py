"""Item details (notes and fields, one copy per item for every week): the document's rules, the
endpoint, the state, the quota, export version 5 and the version 4 lift."""

import json
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api.config import Config
from tracker_api.data import stored_items
from tracker_api.db import connect
from tracker_api.validate import (
    MAX_DETAILS_BYTES,
    MAX_DETAILS_NOTES,
    MAX_FIELD,
    MAX_FIELDS,
    Details,
    Invalid,
    check_details_id,
    details_fit,
    encode_details,
    normalise_details,
    parse_export,
)

from .test_api import PASSWORD, PUSHUPS, WEEK, other_client, post_import, sign_up, usage

NEXT_WEEK = "2026-10-26"
PU = "/api/details/exercise/pu"


def state(client: TestClient) -> Any:
    return client.get("/api/state").json()


# --- F1: notes were a copy per week ---------------------------------------------------------------


def test_a_note_is_one_copy_for_every_week(client: TestClient, config: Config) -> None:
    """F1. A note written on week A's plan stayed on week A: week B, with its own plan, showed
    none. Notes now live in the item's details, which every week reads, and plans drop them."""
    sign_up(client, config)
    with_note = PUSHUPS | {"notes": "Slow on the way down."}
    client.put(f"/api/plans/exercise/{WEEK}", json={"items": [with_note], "rev": 0})
    client.put(f"/api/plans/exercise/{NEXT_WEEK}", json={"items": [PUSHUPS], "rev": 0})
    plans = state(client)["exercise"]["plans"]
    # The old behaviour: week A's copy kept the note, week B's had none.
    assert "notes" not in plans[WEEK][0]
    assert plans[WEEK] == plans[NEXT_WEEK] == [PUSHUPS]
    r = client.put(PU, json={"details": {"notes": "Slow on the way down."}, "rev": 0})
    assert r.json() == {"rev": 1}
    exercise = state(client)["exercise"]
    assert exercise["details"] == {"pu": {"notes": "Slow on the way down."}}
    assert exercise["detailRevs"] == {"pu": 1}


def test_plans_stored_with_notes_read_without_them(client: TestClient, config: Config) -> None:
    """A plan written before details keeps its items' notes in the database until it is next
    written (migration 7 copies them, D3). Nothing reads them from there: not the state, not an
    export, and not the plan write's same-items check (P7) or its conflict copy."""
    sign_up(client, config)
    conn = connect(config.db_path)
    try:
        stored = json.dumps([PUSHUPS | {"notes": "old copy"}])
        conn.execute("INSERT INTO plans VALUES (1, 'exercise', ?, ?, 1)", (WEEK, stored))
    finally:
        conn.close()
    assert state(client)["exercise"]["plans"] == {WEEK: [PUSHUPS]}
    exported = client.get("/api/export").json()
    assert exported["exercise"]["plans"] == {WEEK: [PUSHUPS]}
    url = f"/api/plans/exercise/{WEEK}"
    # A device that missed rev 1 sends the same items: the same plan, not a conflict.
    assert client.put(url, json={"items": [PUSHUPS], "rev": 0}).json() == {"rev": 1}
    r = client.put(url, json={"items": [], "rev": 0})
    assert (r.status_code, r.json()) == (409, {"error": "conflict", "items": [PUSHUPS], "rev": 1})


def test_stored_items_drop_notes_and_pass_anything_else_through() -> None:
    assert stored_items('[{"id": "a", "notes": "x", "target": 2}, 3, "b"]') == [
        {"id": "a", "target": 2},
        3,
        "b",
    ]


# --- the document ---------------------------------------------------------------------------------


def test_normalise_details_trims_cuts_and_drops_blanks() -> None:
    assert normalise_details(
        {
            "notes": " \n **Slow** down.\t ",
            "fields": {"equipment": "  Mat ", "works": " \n ", "link": 3, "colour": "red"},
            "other": "ignored",
        }
    ) == {"notes": "**Slow** down.", "fields": {"equipment": "Mat", "colour": "red"}}
    assert normalise_details({}) == {}
    assert normalise_details({"notes": "   ", "fields": {"works": ""}}) == {}
    assert normalise_details({"notes": 42, "fields": ["equipment"]}) == {}
    bad: object
    for bad in (None, [], "notes", 3, True):
        assert normalise_details(bad) is None


def test_notes_cut_at_twenty_thousand_code_points() -> None:
    emoji = "😀" * (MAX_DETAILS_NOTES + 5)
    out = normalise_details({"notes": emoji})
    assert out is not None
    assert out["notes"] == "😀" * MAX_DETAILS_NOTES
    # Cut, then trimmed again, as plan notes are.
    out = normalise_details({"notes": "a" * (MAX_DETAILS_NOTES - 1) + " b"})
    assert out == {"notes": "a" * (MAX_DETAILS_NOTES - 1)}


def test_field_keys_values_and_their_count() -> None:
    fields = {
        "equipment": "x" * (MAX_FIELD + 3),
        "Equipment": "capital",
        "1st": "digit first",
        "a-b": "hyphen",
        "_a": "underscore first",
        "": "empty",
        "a" * 32: "thirty-two",
        "a" * 33: "thirty-three",
        "z9_": "ok",
    }
    out = normalise_details({"fields": fields})
    assert out == {"fields": {"equipment": "x" * MAX_FIELD, "a" * 32: "thirty-two", "z9_": "ok"}}
    many = {f"f{i}": str(i) for i in range(MAX_FIELDS + 4)}
    out = normalise_details({"fields": {"blank": " ", **many}})
    assert out is not None
    # Blanks do not take a place; the first 32 that count are kept.
    assert list(out["fields"]) == [f"f{i}" for i in range(MAX_FIELDS)]


def test_the_document_size_is_measured_as_stored() -> None:
    doc: Details = {"notes": "é" * MAX_DETAILS_NOTES}
    assert len(encode_details(doc).encode()) > MAX_DETAILS_BYTES
    assert not details_fit(doc)
    assert details_fit({"notes": "a" * MAX_DETAILS_NOTES})
    small: Details = {"notes": "é", "fields": {"a": "b"}}
    assert encode_details(small) == '{"notes":"é","fields":{"a":"b"}}'


# --- the endpoint ---------------------------------------------------------------------------------


def test_details_revisions_and_conflicts(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    first = {"notes": "Slow.", "fields": {"equipment": "Mat"}}
    assert client.put(PU, json={"details": first, "rev": 0}).json() == {"rev": 1}
    second = {"notes": "Slower.", "fields": {"equipment": "Mat", "colour": "red"}}
    assert client.put(PU, json={"details": second, "rev": 1}).json() == {"rev": 2}
    r = client.put(PU, json={"details": {"notes": "stale"}, "rev": 1})
    assert (r.status_code, r.json()) == (409, {"error": "conflict", "details": second, "rev": 2})
    # A stale write of what the server already holds is not a conflict (P7).
    assert client.put(PU, json={"details": second, "rev": 1}).json() == {"rev": 2}
    assert client.put(PU, json={"details": second, "rev": 0}).json() == {"rev": 2}
    exercise = state(client)["exercise"]
    assert exercise["details"] == {"pu": second}
    assert exercise["detailRevs"] == {"pu": 2}


def test_a_stale_rev_for_missing_details_conflicts_with_none(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    r = client.put(PU, json={"details": {"notes": "x"}, "rev": 3})
    assert (r.status_code, r.json()) == (409, {"error": "conflict", "details": None, "rev": 0})


def test_an_empty_document_clears_but_keeps_the_revision(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    client.put(PU, json={"details": {"notes": "x"}, "rev": 0})
    assert client.put(PU, json={"details": {"notes": "  "}, "rev": 1}).json() == {"rev": 2}
    exercise = state(client)["exercise"]
    assert exercise["details"] == {}
    assert exercise["detailRevs"] == {"pu": 2}
    # A device that still holds rev 1 conflicts with the cleared copy, not with nothing.
    r = client.put(PU, json={"details": {"notes": "old"}, "rev": 1})
    assert (r.status_code, r.json()) == (409, {"error": "conflict", "details": {}, "rev": 2})
    assert client.get("/api/export").json()["exercise"]["details"] == {}


def test_sections_and_users_keep_their_own_details(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    client.put(PU, json={"details": {"notes": "exercise"}, "rev": 0})
    client.put("/api/details/diet/pu", json={"details": {"notes": "food"}, "rev": 0})
    alice = state(client)
    assert alice["exercise"]["details"] == {"pu": {"notes": "exercise"}}
    assert alice["diet"]["details"] == {"pu": {"notes": "food"}}
    with other_client(config) as bob:
        sign_up(bob, config, "bob@example.com")
        assert state(bob)["exercise"]["details"] == {}
        assert bob.put(PU, json={"details": {"notes": "bob"}, "rev": 0}).json() == {"rev": 1}
    assert state(client)["exercise"]["details"] == {"pu": {"notes": "exercise"}}


def test_details_are_validated_like_stored_data(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    sent = {
        "notes": "  Keep the elbows in.  ",
        "fields": {"equipment": " Mat ", "colour": "red", "Bad Key": "x", "works": 3},
        "extra": True,
    }
    client.put(PU, json={"details": sent, "rev": 0})
    assert state(client)["exercise"]["details"]["pu"] == {
        "notes": "Keep the elbows in.",
        "fields": {"equipment": "Mat", "colour": "red"},
    }


def test_unknown_field_keys_survive_a_round_trip(client: TestClient, config: Config) -> None:
    """D2: the field list will change as John iterates, so text in a field the registry does not
    list yet (or any more) is kept."""
    sign_up(client, config)
    doc = {"fields": {"tempo": "3-1-1", "equipment": "Bench"}}
    client.put(PU, json={"details": doc, "rev": 0})
    assert state(client)["exercise"]["details"]["pu"] == doc
    assert client.get("/api/export").json()["exercise"]["details"]["pu"] == doc


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/details/other/pu", {"details": {}, "rev": 0}),
        ("/api/details/food/pu", {"details": {}, "rev": 0}),
        (f"/api/details/exercise/{'x' * 129}", {"details": {}, "rev": 0}),
        (PU, {"details": [], "rev": 0}),
        (PU, {"details": "notes", "rev": 0}),
        (PU, {"details": None, "rev": 0}),
        (PU, {"rev": 0}),
        (PU, {"details": {}}),
        (PU, {"details": {}, "rev": -1}),
        (PU, {"details": {}, "rev": True}),
        (PU, {"details": {}, "rev": 1.0}),
    ],
)
def test_bad_details_writes_are_400(
    client: TestClient, config: Config, path: str, body: dict[str, Any]
) -> None:
    sign_up(client, config)
    r = client.put(path, json=body)
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})


def test_a_document_over_32_kb_is_refused(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    big = {"notes": "é" * MAX_DETAILS_NOTES}
    r = client.put(PU, json={"details": big, "rev": 0})
    assert (r.status_code, r.json()) == (413, {"error": "too-large"})
    assert state(client)["exercise"]["detailRevs"] == {}
    # 32 fields of 500 three-byte characters pass each cap but not the document's.
    fields = {f"f{i}": "€" * MAX_FIELD for i in range(MAX_FIELDS)}
    r = client.put(PU, json={"details": {"fields": fields}, "rev": 0})
    assert (r.status_code, r.json()) == (413, {"error": "too-large"})


@pytest.mark.parametrize("item_id", ["a/b", "/", ".", ".."])
def test_details_ids_the_path_cant_name_are_invalid(item_id: str) -> None:
    """A browser folds `.` and `..` out of a path, and Starlette decodes `%2F` before routing, so
    a details write for such an id never reaches its item. The app never queues one
    (`isDetailsId`); the route refuses them by the same rule."""
    with pytest.raises(Invalid):
        check_details_id(item_id)


@pytest.mark.parametrize("encoded", ["%2E", "%2E%2E"])
def test_the_details_route_refuses_dot_ids(
    client: TestClient, config: Config, encoded: str
) -> None:
    sign_up(client, config)
    r = client.put(f"/api/details/exercise/{encoded}", json={"details": {"notes": "x"}, "rev": 0})
    assert (r.status_code, r.json()) == (400, {"error": "invalid"})
    assert state(client)["exercise"]["detailRevs"] == {}


def test_details_ids_with_dots_or_other_characters_are_fine(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    for item_id in ("a.b", "...", "a%20b%3F"):
        r = client.put(f"/api/details/diet/{item_id}", json={"details": {"notes": "x"}, "rev": 0})
        assert r.json() == {"rev": 1}
    assert set(state(client)["diet"]["detailRevs"]) == {"a.b", "...", "a b?"}


def test_an_item_id_of_128_characters_is_fine(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    r = client.put(f"/api/details/diet/{'v' * 128}", json={"details": {"notes": "x"}, "rev": 0})
    assert r.json() == {"rev": 1}


# --- the quota ------------------------------------------------------------------------------------


def test_details_count_towards_the_quota(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    assert usage(config) == 0
    client.put(PU, json={"details": {"notes": "é"}, "rev": 0})
    # The stored JSON's bytes, as UTF-8: {"notes":"é"} is 14.
    assert usage(config) == len('{"notes":"é"}'.encode()) == 14
    client.put(f"/api/plans/exercise/{WEEK}", json={"items": [PUSHUPS], "rev": 0})
    assert usage(config) == 14 + len(json.dumps([PUSHUPS]))


def test_the_quota_refuses_details_growth_but_not_shrinking(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    assert client.put(PU, json={"details": {"notes": "x" * 100}, "rev": 0}).json() == {"rev": 1}
    room = usage(config) + 10
    with other_client(replace(config, user_quota_bytes=room)) as c:
        c.post("/api/auth/login", json={"username": "alice@example.com", "password": PASSWORD})
        r = c.put(PU, json={"details": {"notes": "x" * 120}, "rev": 1})
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
        r = c.put("/api/details/exercise/sq", json={"details": {"notes": "x" * 20}, "rev": 0})
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
        assert c.put(PU, json={"details": {"notes": "x" * 105}, "rev": 1}).json() == {"rev": 2}
        assert c.put(PU, json={"details": {"notes": "x"}, "rev": 2}).json() == {"rev": 3}
        # The plan quota sees the details' bytes too.
        assert usage(config) == len('{"notes":"x"}')


# --- export and import ----------------------------------------------------------------------------


def test_export_is_version_5_with_details_per_section(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    client.put(PU, json={"details": {"notes": "Slow.", "fields": {"tempo": "3-1-1"}}, "rev": 0})
    client.put("/api/details/diet/veg", json={"details": {"fields": {"serving": "80 g"}}, "rev": 0})
    exported = client.get("/api/export").json()
    assert exported["version"] == 5
    assert exported["exercise"] == {
        "plans": {},
        "log": {},
        "details": {"pu": {"notes": "Slow.", "fields": {"tempo": "3-1-1"}}},
    }
    assert exported["diet"]["details"] == {"veg": {"fields": {"serving": "80 g"}}}


def v5(exercise_details: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "format": "tracker-export",
        "version": 5,
        "exercise": {"details": exercise_details, **extra},
    }


def test_import_keeps_existing_details_and_adds_missing_ones(
    client: TestClient, config: Config
) -> None:
    sign_up(client, config)
    client.put(PU, json={"details": {"notes": "mine"}, "rev": 0})
    client.put("/api/details/exercise/sq", json={"details": {}, "rev": 0})  # cleared, rev 1
    r = post_import(
        client,
        v5({"pu": {"notes": "theirs"}, "sq": {"notes": "squats"}, "pl": {"fields": {"a": "b"}}}),
    )
    assert r.json() == {"weeks": 0, "ticks": 0, "details": 2, "settings": False, "conversations": 0}
    exercise = state(client)["exercise"]
    assert exercise["details"] == {
        "pu": {"notes": "mine"},
        "sq": {"notes": "squats"},
        "pl": {"fields": {"a": "b"}},
    }
    # The cleared row took the file's copy as a new revision, so devices holding rev 1 conflict.
    assert exercise["detailRevs"] == {"pu": 1, "sq": 2, "pl": 1}
    # The same file again adds nothing.
    again = post_import(client, v5({"pu": {"notes": "theirs"}, "sq": {"notes": "squats"}}))
    assert again.json() == {
        "weeks": 0,
        "ticks": 0,
        "details": 0,
        "settings": False,
        "conversations": 0,
    }


def test_a_files_document_over_32_kb_drops_out(client: TestClient, config: Config) -> None:
    """A write over the cap is refused; in a file, that one document is left out (normalisers
    drop rather than refuse) and the rest imports."""
    big = {"notes": "é" * MAX_DETAILS_NOTES}
    data = parse_export(json.dumps(v5({"pu": big, "sq": {"notes": "fine"}})))
    assert data["exercise"]["details"] == {"sq": {"notes": "fine"}}
    sign_up(client, config)
    r = post_import(client, v5({"pu": big, "sq": {"notes": "fine"}}))
    assert r.json() == {"weeks": 0, "ticks": 0, "details": 1, "settings": False, "conversations": 0}


def test_a_version_4_import_lifts_notes_into_details(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    client.put("/api/details/exercise/kh", json={"details": {"notes": "my halos"}, "rev": 0})
    squats = {"id": "sq", "name": "Squats", "reps": 15, "target": 4}
    r = post_import(
        client,
        {
            "format": "tracker-export",
            "version": 4,
            "exercise": {
                "plans": {
                    "2026-10-12": [
                        PUSHUPS | {"notes": "older"},
                        squats | {"notes": "squat note"},
                        {"id": "kh", "name": "Halos", "reps": 8, "target": 2, "notes": "theirs"},
                    ],
                    WEEK: [PUSHUPS | {"notes": " newest \n"}, squats | {"notes": "  "}],
                },
                # A version 4 file has no details; any found are not read.
                "details": {"be": {"notes": "ignored"}},
            },
            "diet": {"plans": {WEEK: [{"id": "veg", "name": "Veg", "notes": "Not juice"}]}},
        },
    )
    assert r.json() == {"weeks": 3, "ticks": 0, "details": 3, "settings": False, "conversations": 0}
    s = state(client)
    assert s["exercise"]["details"] == {
        "kh": {"notes": "my halos"},
        "pu": {"notes": "newest"},
        "sq": {"notes": "squat note"},
    }
    assert s["diet"]["details"] == {"veg": {"notes": "Not juice"}}
    # The plans keep no notes.
    for items in s["exercise"]["plans"].values():
        assert all("notes" not in item for item in items)


def test_import_counts_details_towards_the_quota(client: TestClient, config: Config) -> None:
    sign_up(client, config)
    with other_client(replace(config, user_quota_bytes=50)) as c:
        c.post("/api/auth/login", json={"username": "alice@example.com", "password": PASSWORD})
        r = post_import(c, v5({"pu": {"notes": "x" * 100}}))
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
    assert usage(config) == 0
    assert state(client)["exercise"]["detailRevs"] == {}
