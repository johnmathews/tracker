"""The MCP write rules in edits.py, over a real database: one item, one mark or the daily targets
at a time, as the app changes them (docs/api.md §3.1)."""

import itertools
import json
import re
import sqlite3
import time
from collections.abc import Callable
from dataclasses import replace
from datetime import date
from typing import Any

import pytest

from tracker_api import data, edits, insights
from tracker_api.config import Config
from tracker_api.data import PlanConflict, PlanSaved, load_settings, load_tracked, put_settings
from tracker_api.validate import MAX_ITEM_ID, Item, Section

from .test_insights import add_user

# The conftest clock is Friday 23 October 2026, in the week of Monday 19 October.
SOURCE = "2026-10-12"
WEEK = "2026-10-19"
LATER = "2026-11-02"
FRIDAY = date(2026, 10, 23)
SQUATS: Item = {"id": "sq", "name": "Squats", "reps": 15, "target": 3}
PLANKS: Item = {"id": "pk", "name": "Plank", "reps": 0, "duration": 60, "target": 2}
SQUATS_WORDS = {"id": "sq", "name": "Squats", "reps": 15, "times_a_week": 3}
PLANKS_WORDS = {"id": "pk", "name": "Plank", "reps": 0, "seconds": 60, "times_a_week": 2}
ID_RE = re.compile(r"x[0-9a-z]+")


@pytest.fixture
def uid(conn: sqlite3.Connection) -> int:
    return add_user(conn)


def plan(conn: sqlite3.Connection, uid: int, week: str, items: list[Item], **kw: Any) -> int:
    """Store a week's plan as a device would, at rev 0; its new rev."""
    section: Section = kw.get("section", "exercise")
    saved = data.put_plan(conn, uid, section, week, items, 0, quota=10**9)
    assert isinstance(saved, PlanSaved)
    return saved.rev


def stored(conn: sqlite3.Connection, uid: int, week: str, section: str = "exercise") -> Any:
    """The week's row exactly as stored: `(items_json, rev)`, or None."""
    row = conn.execute(
        "SELECT items_json, rev FROM plans WHERE user_id = ? AND section = ? AND week = ?",
        (uid, section, week),
    ).fetchone()
    return None if row is None else (row["items_json"], row["rev"])


def plans(conn: sqlite3.Connection, uid: int, section: Section = "exercise") -> dict[str, Any]:
    return load_tracked(conn, uid, section)["plans"]


def set_notes(
    conn: sqlite3.Connection, uid: int, item_id: str, notes: str, section: Section = "exercise"
) -> int:
    """Give an item notes as the app's item page does, keeping its other details; the new rev."""
    current = details_row(conn, uid, item_id, section)
    rev = 0 if current is None else current[1]
    doc = {} if current is None else current[0]
    saved = data.put_details(conn, uid, section, item_id, {**doc, "notes": notes}, rev, quota=10**9)
    assert isinstance(saved, data.DetailsSaved)
    return saved.rev


def details_row(
    conn: sqlite3.Connection, uid: int, item_id: str, section: str = "exercise"
) -> tuple[dict[str, Any], int] | None:
    """An item's details document and rev as stored, or None."""
    row = conn.execute(
        "SELECT details_json, rev FROM item_details"
        " WHERE user_id = ? AND section = ? AND item_id = ?",
        (uid, section, item_id),
    ).fetchone()
    return None if row is None else (json.loads(row["details_json"]), row["rev"])


def add(conn: sqlite3.Connection, config: Config, uid: int, **fields: object) -> edits.PlanEdit:
    week = str(fields.pop("week", WEEK))
    section: Section = fields.pop("section", "exercise")  # type: ignore[assignment]
    return edits.add_item(conn, config, uid, section, week, fields)


def error(exc: pytest.ExceptionInfo[edits.EditError]) -> tuple[str, str]:
    return exc.value.field, str(exc.value)


# --- the app's words ----------------------------------------------------------------------------


def test_words_map_to_the_stored_keys_and_back() -> None:
    assert edits.WORDS == {
        "name": "name",
        "sets": "sets",
        "reps": "reps",
        "seconds": "duration",
        "per_side": "perSide",
        "weight_kg": "weight",
        "times_a_week": "target",
        "note": "notes",
    }
    item = {
        "id": "a",
        "name": "Rows",
        "sets": 3,
        "reps": 0,
        "duration": 30,
        "perSide": True,
        "weight": 12.5,
        "target": 2,
        "notes": "slow",
    }
    assert edits.in_words(item) == {
        "id": "a",
        "name": "Rows",
        "sets": 3,
        "reps": 0,
        "seconds": 30,
        "per_side": True,
        "weight_kg": 12.5,
        "times_a_week": 2,
        "note": "slow",
    }
    assert edits.in_words({"id": "veg", "name": "Veg", "target": 7}) == {
        "id": "veg",
        "name": "Veg",
        "times_a_week": 7,
    }


def test_new_ids_are_in_the_apps_shape_and_never_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    for _ in range(50):
        new = edits.new_id(set())
        assert ID_RE.fullmatch(new)
        assert len(new) <= MAX_ITEM_ID
    monkeypatch.setattr(time, "time_ns", lambda: 1_000_000 * 36**3)  # base 36: "1000"
    suffixes = iter(["aaaa", "aaaa", "bbbb"])
    monkeypatch.setattr(edits, "_suffix", lambda: next(suffixes))
    assert edits.new_id({"x1000aaaa"}) == "x1000bbbb"


# --- owning a week ------------------------------------------------------------------------------


def test_own_week_keeps_a_weeks_own_plan(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    rev = plan(conn, uid, WEEK, [SQUATS])
    owned = edits.own_week(conn, config, uid, "exercise", WEEK)
    assert owned == {"items": [SQUATS], "rev": rev, "copied_from": None}


def test_own_week_copies_the_carried_plan_and_is_safe_to_repeat(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, SOURCE, [SQUATS])
    source_row = stored(conn, uid, SOURCE)
    owned = edits.own_week(conn, config, uid, "exercise", WEEK)
    assert owned == {"items": [SQUATS], "rev": 1, "copied_from": SOURCE}
    assert stored(conn, uid, SOURCE) == source_row
    again = edits.own_week(conn, config, uid, "exercise", WEEK)
    assert again == {"items": [SQUATS], "rev": 1, "copied_from": None}


def test_own_week_copies_the_defaults_on_an_empty_account(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    owned = edits.own_week(conn, config, uid, "diet", WEEK)
    assert owned["items"] == insights.default_items("diet")
    assert owned["copied_from"] == "defaults"
    assert plans(conn, uid, "diet") == {WEEK: insights.default_items("diet")}


def test_own_week_adopts_a_copy_another_device_made_meanwhile(
    conn: sqlite3.Connection, config: Config, uid: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The phone creates the week between the read and the write: its plan is the week's now."""
    plan(conn, uid, SOURCE, [SQUATS])
    real = data.put_plan_locked

    def phone_first(*args: Any, **kw: Any) -> PlanSaved | PlanConflict:
        if not stored(conn, uid, WEEK):
            real(conn, uid, "exercise", WEEK, [SQUATS, PLANKS], 0, quota=10**9)
        return real(*args, **kw)

    monkeypatch.setattr(data, "put_plan_locked", phone_first)
    owned = edits.own_week(conn, config, uid, "exercise", WEEK)
    assert owned == {"items": [SQUATS, PLANKS], "rev": 1, "copied_from": None}


# --- add, update and remove ---------------------------------------------------------------------


def test_add_to_a_week_with_its_own_plan(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [SQUATS])
    out = add(conn, config, uid, name="  Lunges ", reps=12, per_side=True, times_a_week=2)
    new = out["item"]
    assert ID_RE.fullmatch(new["id"])
    assert new == {
        "id": new["id"],
        "name": "Lunges",
        "reps": 12,
        "per_side": True,
        "times_a_week": 2,
    }
    assert out["before"] == [SQUATS_WORDS]
    assert out["after"] == [SQUATS_WORDS, new]
    assert (out["section"], out["week"], out["rev"], out["copied_from"]) == (
        "exercise",
        WEEK,
        2,
        None,
    )
    assert plans(conn, uid)[WEEK][1] == {
        "id": new["id"],
        "name": "Lunges",
        "reps": 12,
        "perSide": True,
        "target": 2,
    }


def test_add_gives_new_items_the_apps_defaults(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    exercise = add(conn, config, uid, name="Dips")["item"]
    assert (exercise["reps"], exercise["times_a_week"]) == (0, 3)
    food = add(conn, config, uid, section="diet", name="Beans", note="  any kind ")["item"]
    assert food == {"id": food["id"], "name": "Beans", "times_a_week": 3, "note": "any kind"}


def test_add_never_reuses_an_id_the_section_has_used(
    conn: sqlite3.Connection, config: Config, uid: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A removed item's marks stay in the log, so its id stays taken (F16)."""
    conn.execute(
        "INSERT INTO ticks (user_id, section, week, item_id, days) VALUES (?, 'exercise', ?, ?, 1)",
        (uid, SOURCE, "xold1"),
    )
    ids = itertools.cycle(["xold1", "sq", "xnew1"])
    monkeypatch.setattr(edits, "_candidate", lambda: next(ids))
    plan(conn, uid, WEEK, [SQUATS])
    assert add(conn, config, uid, name="Dips")["item"]["id"] == "xnew1"


def test_update_changes_only_the_fields_given(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [{**SQUATS, "weight": 20}, PLANKS])
    set_notes(conn, uid, "sq", "deep")
    out = edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"times_a_week": 5})
    assert out["item"] == {**SQUATS_WORDS, "weight_kg": 20, "note": "deep", "times_a_week": 5}
    assert out["before"][0]["times_a_week"] == 3
    assert out["after"] == [out["item"], PLANKS_WORDS]
    assert out["rev"] == 2


def test_update_switches_between_reps_and_seconds_and_clears_fields(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [{**SQUATS, "sets": 3, "weight": 20, "perSide": True}])
    set_notes(conn, uid, "sq", "deep")

    def update(**fields: object) -> dict[str, Any]:
        return edits.update_item(conn, config, uid, "exercise", WEEK, "sq", fields)["item"]

    timed = update(seconds=45)
    assert (timed["reps"], timed["seconds"]) == (0, 45)
    counted = update(reps=8)
    assert (counted["reps"], "seconds" in counted) == (8, False)
    cleared = update(sets=0, weight_kg=0, note="", per_side=False)
    assert cleared == {
        "id": "sq",
        "name": "Squats",
        "reps": 8,
        "per_side": False,
        "times_a_week": 3,
    }


def test_update_renames_a_food(conn: sqlite3.Connection, config: Config, uid: int) -> None:
    out = edits.update_item(conn, config, uid, "diet", WEEK, "veg", {"name": "Greens"})
    assert out["item"] == {"id": "veg", "name": "Greens", "times_a_week": 7}
    assert out["copied_from"] == "defaults"


def test_remove_returns_the_removed_item_in_before(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [SQUATS, PLANKS])
    out = edits.remove_item(conn, config, uid, "exercise", WEEK, "sq")
    assert out["item"] == SQUATS_WORDS
    assert SQUATS_WORDS in out["before"]
    assert out["before"] == [SQUATS_WORDS, PLANKS_WORDS]
    assert out["after"] == [PLANKS_WORDS]
    assert plans(conn, uid)[WEEK] == [PLANKS]


EDITS: dict[str, Callable[[sqlite3.Connection, Config, int, str], edits.PlanEdit]] = {
    "add": lambda c, cfg, u, week: edits.add_item(c, cfg, u, "exercise", week, {"name": "Dips"}),
    "update": lambda c, cfg, u, week: edits.update_item(
        c, cfg, u, "exercise", week, "sq", {"reps": 20}
    ),
    "remove": lambda c, cfg, u, week: edits.remove_item(c, cfg, u, "exercise", week, "sq"),
}


@pytest.mark.parametrize("name", EDITS)
def test_an_edit_to_a_carried_week_leaves_its_source_byte_identical(
    conn: sqlite3.Connection, config: Config, uid: int, name: str
) -> None:
    """F4: the edit copies the source's plan into the week first, and later unplanned weeks then
    follow the edited week, as in the app."""
    plan(conn, uid, SOURCE, [SQUATS, PLANKS])
    source_before = stored(conn, uid, SOURCE)
    assert insights.plan_source(plans(conn, uid), LATER) == SOURCE

    out = EDITS[name](conn, config, uid, WEEK)

    assert stored(conn, uid, SOURCE) == source_before
    assert out["copied_from"] == SOURCE
    assert out["before"] == [SQUATS_WORDS, PLANKS_WORDS]
    assert out["rev"] == 1  # one create, the copy with the edit applied, as the app sends it
    now = plans(conn, uid)
    assert insights.plan_source(now, LATER) == WEEK
    assert insights.week_items("exercise", now, LATER) == now[WEEK]
    assert [edits.in_words(it) for it in now[WEEK]] == out["after"]


@pytest.mark.parametrize("name", EDITS)
def test_an_edit_on_an_empty_account_copies_the_defaults_first(
    conn: sqlite3.Connection, config: Config, uid: int, name: str
) -> None:
    defaults = insights.default_items("exercise")
    assert defaults[2]["id"] == "sq"  # the defaults' squats, which update and remove change
    out = EDITS[name](conn, config, uid, WEEK)
    assert out["copied_from"] == "defaults"
    assert out["before"] == [edits.in_words(it) for it in defaults]
    assert out["rev"] == 1
    assert set(plans(conn, uid)) == {WEEK}
    assert [edits.in_words(it) for it in plans(conn, uid)[WEEK]] == out["after"]


# --- conflicts and the quota --------------------------------------------------------------------


def test_a_conflict_is_replayed_on_the_newer_plan(
    conn: sqlite3.Connection, config: Config, uid: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The phone saves the week between the tool's read and its write: the tool re-reads and
    applies its change to the phone's plan, keeping both."""
    plan(conn, uid, WEEK, [SQUATS])
    real = data.put_plan_locked
    calls: list[int] = []

    def phone_between(*args: Any, **kw: Any) -> PlanSaved | PlanConflict:
        calls.append(args[5])
        if len(calls) == 1:
            assert real(conn, uid, "exercise", WEEK, [SQUATS, PLANKS], 1, quota=10**9) == PlanSaved(
                2
            )
        return real(*args, **kw)

    monkeypatch.setattr(data, "put_plan_locked", phone_between)
    out = add(conn, config, uid, name="Dips")
    assert calls == [1, 2]
    assert out["before"] == [SQUATS_WORDS, PLANKS_WORDS]
    assert [it["name"] for it in out["after"]] == ["Squats", "Plank", "Dips"]
    assert out["rev"] == 3
    assert stored(conn, uid, WEEK)[1] == 3


def test_three_conflicts_in_a_row_fail_with_a_clear_error(
    conn: sqlite3.Connection, config: Config, uid: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan(conn, uid, WEEK, [SQUATS])
    calls: list[int] = []

    def always_newer(*args: Any, **kw: Any) -> PlanConflict:
        calls.append(1)
        return PlanConflict([SQUATS], 99)

    monkeypatch.setattr(data, "put_plan_locked", always_newer)
    with pytest.raises(edits.EditError) as e:
        add(conn, config, uid, name="Dips")
    assert len(calls) == edits.MAX_TRIES == 3
    field, text = error(e)
    assert field == "week"
    assert "3 times" in text
    assert "try again" in text


def test_a_change_over_the_quota_is_refused_and_changes_nothing(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [SQUATS])
    row = stored(conn, uid, WEEK)
    full = replace(config, user_quota_bytes=data.usage(conn, uid))
    with pytest.raises(edits.EditError) as e:
        edits.add_item(conn, full, uid, "exercise", WEEK, {"name": "Dips", "note": "x" * 400})
    field, text = error(e)
    assert field == "quota"
    assert "full" in text
    assert stored(conn, uid, WEEK) == row
    # A change that shrinks the plan still passes on a full account.
    assert edits.remove_item(conn, full, uid, "exercise", WEEK, "sq")["after"] == []


@pytest.mark.parametrize("cause", ["quota", "conflicts"])
def test_a_refused_edit_to_a_carried_week_leaves_it_following_its_source(
    conn: sqlite3.Connection,
    config: Config,
    uid: int,
    monkeypatch: pytest.MonkeyPatch,
    cause: str,
) -> None:
    """The copy and the change are one write, so a refusal leaves no copy behind: a copy alone
    would stop the week following its source's later edits."""
    plan(conn, uid, SOURCE, [SQUATS])
    room = data.usage(conn, uid) + len(b'{"id": "sq", "name": "Squats", "reps": 15, "target": 3}')
    if cause == "conflicts":
        real = data.put_plan_locked

        def lose_the_edit(*args: Any, **kw: Any) -> PlanSaved | PlanConflict:
            if len(args[4]) == 2:  # the copy with Dips added
                return PlanConflict([SQUATS], 99)
            return real(*args, **kw)

        monkeypatch.setattr(data, "put_plan_locked", lose_the_edit)
    # Room for the copy, but not for the copy with a long note.
    tight = replace(config, user_quota_bytes=room + 100)
    with pytest.raises(edits.EditError):
        edits.add_item(conn, tight, uid, "exercise", WEEK, {"name": "Dips", "note": "x" * 300})
    assert set(plans(conn, uid)) == {SOURCE}


def test_a_mark_refused_for_the_quota_keeps_the_weeks_copy(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    """The one refusal that leaves a write behind, as the app's does: the copy fits, the new
    tick row doesn't. The week shows the same items either way."""
    plan(conn, uid, SOURCE, [SQUATS])
    just_the_copy = replace(config, user_quota_bytes=2 * data.usage(conn, uid))
    with pytest.raises(edits.EditError) as e:
        edits.mark_day(conn, just_the_copy, uid, "exercise", FRIDAY, "sq", "great")
    assert e.value.field == "quota"
    assert plans(conn, uid) == {SOURCE: [SQUATS], WEEK: [SQUATS]}
    assert load_tracked(conn, uid, "exercise")["log"] == {}


def test_copying_a_week_over_the_quota_is_refused(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    tiny = replace(config, user_quota_bytes=10)
    with pytest.raises(edits.EditError) as e:
        edits.own_week(conn, tiny, uid, "exercise", WEEK)
    assert e.value.field == "quota"
    with pytest.raises(edits.EditError):
        edits.mark_day(conn, tiny, uid, "exercise", FRIDAY, "sq", "great")
    assert plans(conn, uid) == {}
    assert load_tracked(conn, uid, "exercise")["log"] == {}


def test_a_new_tick_row_over_the_quota_is_refused(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [SQUATS])
    full = replace(config, user_quota_bytes=data.usage(conn, uid))
    with pytest.raises(edits.EditError) as e:
        edits.mark_day(conn, full, uid, "exercise", FRIDAY, "sq", "great")
    assert e.value.field == "quota"


# --- notes: the item's details, one copy for every week ------------------------------------------


def test_a_note_lands_in_the_items_details_for_every_week(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    """The app reads an item's note from its details (D3), so that is where an agent's goes:
    never into a week's plan, and the same in every week that shows the item."""
    plan(conn, uid, SOURCE, [SQUATS])
    plan(conn, uid, WEEK, [SQUATS, PLANKS])
    out = edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"note": " Knees out. "})
    assert out["item"] == {**SQUATS_WORDS, "note": "Knees out."}
    assert out["before"] == [SQUATS_WORDS, PLANKS_WORDS]
    assert out["after"] == [out["item"], PLANKS_WORDS]
    assert details_row(conn, uid, "sq") == ({"notes": "Knees out."}, 1)
    assert "notes" not in stored(conn, uid, WEEK)[0]
    for week in (SOURCE, WEEK, LATER):
        items = insights.week_summary(conn, uid, "exercise", week, FRIDAY)["items"]
        assert items[0]["notes"] == "Knees out."
    # A note alone changes no plan: the week keeps its rev, and the details theirs.
    assert out["rev"] == 1
    assert stored(conn, uid, WEEK)[1] == 1


def test_a_note_alone_on_a_carried_week_copies_nothing(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, SOURCE, [SQUATS])
    out = edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"note": "Slow."})
    assert (out["rev"], out["copied_from"]) == (0, None)
    assert set(plans(conn, uid)) == {SOURCE}
    assert details_row(conn, uid, "sq") == ({"notes": "Slow."}, 1)


def test_a_note_keeps_the_items_fields_and_clears_alone(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [SQUATS])
    data.put_details(
        conn,
        uid,
        "exercise",
        "sq",
        {"notes": "old", "fields": {"equipment": "Rack"}},
        0,
        quota=10**9,
    )
    edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"note": "new"})
    assert details_row(conn, uid, "sq") == ({"notes": "new", "fields": {"equipment": "Rack"}}, 2)
    out = edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"note": ""})
    assert "note" not in out["item"]
    assert out["before"] == [{**SQUATS_WORDS, "note": "new"}]
    assert details_row(conn, uid, "sq") == ({"fields": {"equipment": "Rack"}}, 3)
    # The same note again writes nothing, so the revision holds.
    edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"note": ""})
    assert details_row(conn, uid, "sq") == ({"fields": {"equipment": "Rack"}}, 3)


def test_a_device_holding_the_old_notes_conflicts(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    """An agent's note moves the revision on, so the app's next write from the old copy gets a
    409 with the agent's version, as two devices do."""
    plan(conn, uid, WEEK, [SQUATS])
    seen = set_notes(conn, uid, "sq", "from the phone")
    edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"note": "from the agent"})
    result = data.put_details(
        conn, uid, "exercise", "sq", {"notes": "edited offline"}, seen, quota=10**9
    )
    assert result == data.DetailsConflict({"notes": "from the agent"}, seen + 1)


def test_add_with_a_note_gives_the_new_item_details(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    out = add(conn, config, uid, section="diet", name="Beans", note="Any kind.")
    new = out["item"]["id"]
    assert details_row(conn, uid, new, "diet") == ({"notes": "Any kind."}, 1)
    assert "notes" not in plans(conn, uid, "diet")[WEEK][-1]


def test_a_note_over_the_quota_changes_nothing(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    """The plan and the note are written in one transaction: a refused note leaves no item."""
    plan(conn, uid, WEEK, [SQUATS])
    row = stored(conn, uid, WEEK)
    room = data.usage(conn, uid) + 200
    tight = replace(config, user_quota_bytes=room)
    with pytest.raises(edits.EditError) as e:
        add(conn, tight, uid, name="Dips", note="x" * 400)
    assert error(e)[0] == "quota"
    assert stored(conn, uid, WEEK) == row
    with pytest.raises(edits.EditError) as e:
        edits.update_item(conn, tight, uid, "exercise", WEEK, "sq", {"note": "x" * 400})
    assert error(e)[0] == "quota"
    assert details_row(conn, uid, "sq") is None


def test_a_note_too_large_to_store_is_refused(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    """20,000 code points can be over the 32 KB a document may take as stored (D2)."""
    plan(conn, uid, WEEK, [SQUATS])
    with pytest.raises(edits.EditError) as e:
        edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"note": "🥕" * 20_000})
    field, text = error(e)
    assert field == "note"
    assert "too long" in text
    assert details_row(conn, uid, "sq") is None


# --- refusals -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fields", "field", "words"),
    [
        ({"name": "   "}, "item", "name is empty"),
        ({"name": "x" * 81}, "item", "over 80"),
        ({"name": "Burpees", "reps": 10, "seconds": 30}, "item", "reps or seconds"),
        ({"name": 3}, "name", "text"),
        ({"name": "Dips", "colour": "red"}, "colour", "not a field"),
        ({"name": "Dips", "times_a_week": 8}, "times_a_week", "0 to 7"),
        ({"name": "Dips", "times_a_week": -1}, "times_a_week", "0 to 7"),
        ({"name": "Dips", "times_a_week": True}, "times_a_week", "whole number"),
        ({"name": "Dips", "times_a_week": 2.5}, "times_a_week", "whole number"),
        ({"name": "Dips", "sets": 21}, "sets", "0 to 20"),
        ({"name": "Dips", "reps": 10_000}, "reps", "0 to 9999"),
        ({"name": "Dips", "reps": -3}, "reps", "0 to 9999"),
        ({"name": "Dips", "seconds": 3601}, "seconds", "0 to 3600"),
        ({"name": "Dips", "weight_kg": 501}, "weight_kg", "0 to 500"),
        ({"name": "Dips", "weight_kg": float("nan")}, "weight_kg", "0 to 500"),
        ({"name": "Dips", "weight_kg": "heavy"}, "weight_kg", "number"),
        ({"name": "Dips", "weight_kg": False}, "weight_kg", "number"),
        ({"name": "Dips", "per_side": "yes"}, "per_side", "true or false"),
        ({"name": "Dips", "note": 5}, "note", "text"),
        # An item's notes are its details, which take 20,000 code points (D2), as its page does.
        ({"name": "Dips", "note": "🥕" * 20_001}, "note", "20,000"),
    ],
)
def test_add_refuses_a_bad_field_by_name(
    conn: sqlite3.Connection,
    config: Config,
    uid: int,
    fields: dict[str, object],
    field: str,
    words: str,
) -> None:
    plan(conn, uid, SOURCE, [SQUATS])
    with pytest.raises(edits.EditError) as e:
        add(conn, config, uid, **fields)
    assert e.value.field == field
    assert str(e.value).startswith(f"{field}: ")
    assert words in str(e.value)
    # Nothing changed: the week still follows its source.
    assert set(plans(conn, uid)) == {SOURCE}


def test_add_refuses_exercise_fields_on_a_food(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    with pytest.raises(edits.EditError) as e:
        add(conn, config, uid, section="diet", name="Beans", reps=3)
    assert e.value.field == "reps"
    assert "exercises only" in str(e.value)
    # An exercise field left out (None) is no field at all, as the tools send it.
    out = add(conn, config, uid, section="diet", name="Beans", reps=None, seconds=None)
    assert out["item"]["name"] == "Beans"


def test_add_needs_a_name(conn: sqlite3.Connection, config: Config, uid: int) -> None:
    with pytest.raises(edits.EditError) as e:
        add(conn, config, uid, times_a_week=2)
    assert e.value.field == "item"
    assert "name is empty" in str(e.value)


def test_none_means_not_given(conn: sqlite3.Connection, config: Config, uid: int) -> None:
    out = add(conn, config, uid, name="Dips", sets=None, note=None)
    assert "sets" not in out["item"]
    with pytest.raises(edits.EditError) as e:
        edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"name": None})
    assert "nothing to change" in str(e.value)


@pytest.mark.parametrize("name", ["update", "remove"])
def test_an_unknown_item_is_refused_and_changes_nothing(
    conn: sqlite3.Connection, config: Config, uid: int, name: str
) -> None:
    plan(conn, uid, SOURCE, [PLANKS])
    with pytest.raises(edits.EditError) as e:
        EDITS[name](conn, config, uid, WEEK)
    assert e.value.field == "item_id"
    assert f"no item sq in the week of {WEEK}" in str(e.value)
    assert "week_summary" in str(e.value)
    assert set(plans(conn, uid)) == {SOURCE}


def test_update_refuses_a_change_that_breaks_the_item(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [SQUATS])
    with pytest.raises(edits.EditError) as e:
        edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"reps": 5, "seconds": 5})
    assert "reps or seconds" in str(e.value)
    with pytest.raises(edits.EditError) as e:
        edits.update_item(conn, config, uid, "exercise", WEEK, "sq", {"name": ""})
    assert "name is empty" in str(e.value)
    assert plans(conn, uid)[WEEK] == [SQUATS]


@pytest.mark.parametrize("week", ["2026-10-20", "2026-02-30", "soon", "2026-10-19\n"])
def test_a_week_that_is_not_a_monday_is_refused(
    conn: sqlite3.Connection, config: Config, uid: int, week: str
) -> None:
    for run in EDITS.values():
        with pytest.raises(edits.EditError) as e:
            run(conn, config, uid, week)
        assert e.value.field == "week"
    with pytest.raises(edits.EditError):
        edits.own_week(conn, config, uid, "exercise", week)
    assert plans(conn, uid) == {}


def test_an_unknown_section_is_refused(conn: sqlite3.Connection, config: Config, uid: int) -> None:
    with pytest.raises(edits.EditError) as e:
        edits.add_item(conn, config, uid, "sleep", WEEK, {"name": "Nap"})  # type: ignore[arg-type]
    assert e.value.field == "section"


# --- marks --------------------------------------------------------------------------------------


def test_mark_day_on_an_unplanned_week_creates_its_plan_first(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, SOURCE, [SQUATS])
    source_row = stored(conn, uid, SOURCE)
    out = edits.mark_day(conn, config, uid, "exercise", FRIDAY, "sq", "great")
    assert out == {
        "section": "exercise",
        "date": "2026-10-23",
        "week": WEEK,
        "day": 4,
        "item_id": "sq",
        "before": None,
        "after": "great",
        "days": [None, None, None, None, "great", None, None],
        "rev": 1,
        "copied_from": SOURCE,
    }
    assert plans(conn, uid)[WEEK] == [SQUATS]
    assert stored(conn, uid, SOURCE) == source_row
    assert load_tracked(conn, uid, "exercise")["log"][WEEK]["sq"][4] == "great"


def test_mark_day_on_an_empty_account_copies_the_defaults(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    out = edits.mark_day(conn, config, uid, "diet", date(2026, 10, 25), "veg", "great-solid")
    assert (out["week"], out["day"], out["copied_from"]) == (WEEK, 6, "defaults")
    assert plans(conn, uid, "diet")[WEEK] == insights.default_items("diet")


def test_mark_day_changes_and_clears_a_mark(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [SQUATS])
    edits.mark_day(conn, config, uid, "exercise", FRIDAY, "sq", "great")
    again = edits.mark_day(conn, config, uid, "exercise", FRIDAY, "sq", "partial-hatch")
    assert (again["before"], again["after"], again["copied_from"]) == (
        "great",
        "partial-hatch",
        None,
    )
    cleared = edits.mark_day(conn, config, uid, "exercise", FRIDAY, "sq", None)
    assert (cleared["before"], cleared["after"]) == ("partial-hatch", None)
    assert cleared["days"] == [None] * 7
    repeat = edits.mark_day(conn, config, uid, "exercise", FRIDAY, "sq", None)
    assert (repeat["before"], repeat["after"]) == (None, None)


def test_a_mark_on_a_removed_item_is_refused(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, WEEK, [SQUATS, PLANKS])
    edits.remove_item(conn, config, uid, "exercise", WEEK, "sq")
    with pytest.raises(edits.EditError) as e:
        edits.mark_day(conn, config, uid, "exercise", FRIDAY, "sq", "great")
    assert e.value.field == "item_id"
    assert "no item sq" in str(e.value)
    assert load_tracked(conn, uid, "exercise")["log"] == {}


def test_a_refused_mark_does_not_copy_the_week(
    conn: sqlite3.Connection, config: Config, uid: int
) -> None:
    plan(conn, uid, SOURCE, [SQUATS])
    with pytest.raises(edits.EditError):
        edits.mark_day(conn, config, uid, "exercise", FRIDAY, "nope", "great")
    assert set(plans(conn, uid)) == {SOURCE}


@pytest.mark.parametrize(
    ("section", "item_id", "mark", "field"),
    [
        ("exercise", "sq", "done", "mark"),
        ("exercise", "sq", "GREAT", "mark"),
        ("diet", "veg", "partial", "mark"),
        ("diet", "veg", "missed-solid", "mark"),
        ("exercise", "", "great", "item_id"),
        ("exercise", "x" * 129, "great", "item_id"),
    ],
)
def test_mark_day_refuses_a_bad_mark_or_id(
    conn: sqlite3.Connection,
    config: Config,
    uid: int,
    section: Section,
    item_id: str,
    mark: Any,
    field: str,
) -> None:
    with pytest.raises(edits.EditError) as e:
        edits.mark_day(conn, config, uid, section, FRIDAY, item_id, mark)
    assert e.value.field == field
    assert plans(conn, uid, section) == {}


def test_a_food_takes_the_great_marks(conn: sqlite3.Connection, config: Config, uid: int) -> None:
    for mark in ("great", "great-solid", "great-hatch"):
        assert edits.mark_day(conn, config, uid, "diet", FRIDAY, "veg", mark)["after"] == mark


@pytest.mark.parametrize(
    ("text", "ok"),
    [("2026-10-23", True), ("2026-02-30", False), ("23/10/2026", False), ("2026-10-23\n", False)],
)
def test_parse_date(text: str, ok: bool) -> None:
    if ok:
        assert edits.parse_date(text) == FRIDAY
    else:
        with pytest.raises(edits.EditError) as e:
            edits.parse_date(text)
        assert e.value.field == "date"


# --- daily targets ------------------------------------------------------------------------------


def test_set_daily_targets_keeps_the_accent_and_the_other_target(
    conn: sqlite3.Connection, uid: int
) -> None:
    put_settings(
        conn, uid, {"accent": "#123456", "dailyPick": 3, "foodPick": 4, "goals": "Run 5 km."}
    )
    out = edits.set_daily_targets(conn, uid, exercises_a_day=5)
    assert out == {
        "before": {"exercises_a_day": 3, "foods_a_day": 4},
        "after": {"exercises_a_day": 5, "foods_a_day": 4},
        "daily_goal": True,
    }
    assert load_settings(conn, uid) == {
        "accent": "#123456",
        "dailyPick": 5,
        "foodPick": 4,
        "goals": "Run 5 km.",
        "dailyGoal": True,
    }
    out = edits.set_daily_targets(conn, uid, foods_a_day=1)
    assert out["after"] == {"exercises_a_day": 5, "foods_a_day": 1}
    assert load_settings(conn, uid) == {
        "accent": "#123456",
        "dailyPick": 5,
        "foodPick": 1,
        "goals": "Run 5 km.",
        "dailyGoal": True,
    }


def test_set_daily_targets_keeps_daily_goal_off(conn: sqlite3.Connection, uid: int) -> None:
    """K85: the targets change while Daily goal is off, which stays off; the result says so."""
    put_settings(conn, uid, {"dailyPick": 3, "foodPick": 4, "dailyGoal": False})
    out = edits.set_daily_targets(conn, uid, foods_a_day=6)
    assert out == {
        "before": {"exercises_a_day": 3, "foods_a_day": 4},
        "after": {"exercises_a_day": 3, "foods_a_day": 6},
        "daily_goal": False,
    }
    stored = load_settings(conn, uid)
    assert stored is not None and (stored["foodPick"], stored["dailyGoal"]) == (6, False)


def test_set_daily_targets_starts_from_the_defaults(conn: sqlite3.Connection, uid: int) -> None:
    out = edits.set_daily_targets(conn, uid, exercises_a_day=8, foods_a_day=1)
    assert out["before"] == {"exercises_a_day": 3, "foods_a_day": 2}
    assert load_settings(conn, uid) == {
        "accent": "#30d158",
        "dailyPick": 8,
        "foodPick": 1,
        "goals": "",
        "dailyGoal": True,
    }


@pytest.mark.parametrize(
    ("kw", "field"),
    [
        ({"exercises_a_day": 0}, "exercises_a_day"),
        ({"exercises_a_day": 9}, "exercises_a_day"),
        ({"foods_a_day": -1}, "foods_a_day"),
        ({"foods_a_day": True}, "foods_a_day"),
        ({"exercises_a_day": 3, "foods_a_day": 9}, "foods_a_day"),
        ({}, "exercises_a_day"),
    ],
)
def test_set_daily_targets_refuses_out_of_range_values(
    conn: sqlite3.Connection, uid: int, kw: dict[str, Any], field: str
) -> None:
    put_settings(conn, uid, {"accent": "#123456", "dailyPick": 3, "foodPick": 2})
    with pytest.raises(edits.EditError) as e:
        edits.set_daily_targets(conn, uid, **kw)
    assert e.value.field == field
    assert ("1 to 8" in str(e.value)) or ("give" in str(e.value))
    assert load_settings(conn, uid) == {
        "accent": "#123456",
        "dailyPick": 3,
        "foodPick": 2,
        "goals": "",
        "dailyGoal": True,
    }
