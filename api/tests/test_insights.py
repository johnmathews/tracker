"""The insights module: the shared fixtures in fixtures/insights/ (which
src/lib/__tests__/insights-parity.spec.ts runs too), then the readers over a real database."""

import json
import sqlite3
from collections.abc import Mapping
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from tracker_api import insights
from tracker_api.data import (
    PlanSaved,
    create_tracker,
    end_tracker,
    import_data,
    load_settings,
    patch_tracker,
    put_details,
    put_plan,
    put_settings,
    set_tick,
)
from tracker_api.types import TypeId
from tracker_api.validate import MAX_NOTES, ExportData, Section, Tracked, Tracker

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "insights"
CASES: list[tuple[str, Any]] = [
    (p.name, json.loads(p.read_text(encoding="utf-8"))) for p in sorted(FIXTURES.glob("*.json"))
]
QUOTA = 10**9
# Wednesday 28 October 2026, in the week of Monday 26 October.
TODAY = date(2026, 10, 28)


def add_user(conn: sqlite3.Connection, username: str = "ann") -> int:
    cur = conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, 'h', 0)", (username,)
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def tracked(section: Mapping[str, Any] | None) -> Tracked:
    """A section as an import reads it: `plans`, `log` and `details`, each empty when left out."""
    given = section or {}
    return {
        "plans": given.get("plans", {}),
        "log": given.get("log", {}),
        "details": given.get("details", {}),
    }


def load(
    conn: sqlite3.Connection,
    user_id: int,
    *,
    exercise: Mapping[str, Any] | None = None,
    cardio: Mapping[str, Any] | None = None,
    diet: Mapping[str, Any] | None = None,
    settings: dict[str, Any] | None = None,
) -> None:
    """Store plans, marks and item details the way an import does, and settings when given."""
    data: ExportData = {
        "trackers": [],
        "sections": {
            "exercise": tracked(exercise),
            "cardio": tracked(cardio),
            "diet": tracked(diet),
        },
        "settings": None,
    }
    import_data(conn, user_id, data, quota=QUOTA)
    if settings is not None:
        put_settings(conn, user_id, settings)


def days(*marked: int) -> list[Any]:
    return ["great" if i in marked else None for i in range(7)]


def goal_items(goals: insights.Goals, tracker_id: str) -> list[insights.GoalItem]:
    """One tracker's items in `goals`."""
    (tracker,) = [t for t in goals["trackers"] if t["id"] == tracker_id]
    return tracker["items"]


def daily_targets(goals: insights.Goals) -> dict[str, int | None]:
    """Each tracker's daily target in `goals`, by id."""
    return {t["id"]: t["daily_target"] for t in goals["trackers"]}


def keys(value: object) -> set[str]:
    """Every dict key anywhere in a JSON value."""
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in keys(v)}
    return set()


# --- The shared fixtures -------------------------------------------------------------------------


def test_finds_the_fixture_files() -> None:
    assert len(CASES) >= 11


@pytest.mark.parametrize(("name", "case"), CASES, ids=[n for n, _ in CASES])
def test_fixture_rules(name: str, case: dict[str, Any]) -> None:
    """The pure rules, as src/lib's planSource, defaults and tracker helpers compute them."""
    expected = case["expected"]
    section: Section = case["section"]
    plan_week = insights.plan_source(case["plans"], case["week"])
    assert plan_week == expected["planWeek"]
    items = insights.week_items(section, case["plans"], case["week"])
    week_log = case["log"].get(case["week"], {})

    counts = insights.day_counts(items, week_log)
    assert counts == expected["dayCounts"]
    # A section with no daily target (cardio, K90) meets no day, as its screen shows none green.
    target = case["dailyTarget"]
    met = [False] * 7 if target is None else insights.met_days(counts, target)
    assert met == expected["metDays"]
    assert (None if target is None else sum(met)) == expected["daysMet"]
    assert insights.goals_met(items, week_log) == expected["goalsMet"]
    assert [
        {
            "id": it["id"],
            "name": it["name"],
            "target": it["target"],
            "done": insights.total_for(week_log, it["id"]),
            "goalMet": insights.goal_met(insights.total_for(week_log, it["id"]), it["target"]),
        }
        for it in items
    ] == [
        {k: it[k] for k in ("id", "name", "target", "done", "goalMet")} for it in expected["items"]
    ]


@pytest.mark.parametrize(("name", "case"), CASES, ids=[n for n, _ in CASES])
def test_fixture_week_summary(conn: sqlite3.Connection, name: str, case: dict[str, Any]) -> None:
    """The reader over stored data says what the screen shows for the same week."""
    expected = case["expected"]
    section: Section = case["section"]
    uid = add_user(conn)
    if section == "exercise":
        load(conn, uid, exercise=case, settings={"dailyPick": case["dailyTarget"]})
    elif section == "cardio":
        # Cardio has no daily target, whatever the saved picks say.
        load(conn, uid, cardio=case, settings={"dailyPick": 1, "foodPick": 1})
    else:
        load(conn, uid, diet=case, settings={"foodPick": case["dailyTarget"]})
    out = insights.week_summary(conn, uid, section, case["week"], date.fromisoformat(case["today"]))
    assert out["week"] == case["week"]
    assert out["plan_week"] == expected["planWeek"]
    assert out["carried"] is (expected["planWeek"] != case["week"])
    assert out["daily_target"] == case["dailyTarget"]
    assert [d["count"] for d in out["days"]] == expected["dayCounts"]
    # The reader says None, not False, for a day with no target to meet (K85, K90).
    no_target = case["dailyTarget"] is None
    assert [d["met"] for d in out["days"]] == ([None] * 7 if no_target else expected["metDays"])
    assert [d["future"] for d in out["days"]] == expected["future"]
    assert out["days_met"] == expected["daysMet"]
    assert out["goals_met"] == expected["goalsMet"]
    assert [
        {
            "id": it["id"],
            "name": it["name"],
            "target": it["target"],
            "done": it["done"],
            "great": it["great"],
            "partial": it["partial"],
            "missed": it["missed"],
            "goalMet": it["goal_met"],
            "notes": it["notes"],
        }
        for it in out["items"]
    ] == [{**it, "notes": it.get("notes", "")} for it in expected["items"]]


# --- The pure rules beyond the fixtures ----------------------------------------------------------


def test_week_items_are_copies() -> None:
    plans: dict[str, Any] = {"2026-10-19": [{"id": "pu", "name": "Push-ups", "target": 4}]}
    insights.week_items("exercise", plans, "2026-10-26")[0]["target"] = 7
    assert plans["2026-10-19"][0]["target"] == 4
    insights.week_items("exercise", {}, "2026-10-26")[0]["target"] = 7
    assert insights.week_items("exercise", {}, "2026-10-26")[0]["target"] == 4


def test_default_items_match_the_web_app() -> None:
    """storage.ts's defaultExercises and defaultFoods, field for field."""
    assert insights.default_items("exercise") == [
        {"id": "pu", "name": "Push-ups", "reps": 10, "target": 4},
        {"id": "pl", "name": "Pull-ups", "reps": 3, "target": 4},
        {"id": "sq", "name": "Squats", "reps": 15, "target": 4},
        {"id": "be", "name": "Back extensions", "reps": 12, "target": 3},
        {"id": "kh", "name": "Kettlebell halos", "reps": 8, "perSide": True, "target": 3},
    ]
    assert insights.default_items("diet") == [
        {"id": "veg", "name": "Vegetables", "target": 7},
        {"id": "fruit", "name": "Fruit", "target": 5},
        {"id": "fish", "name": "Fish", "target": 2},
        {"id": "nuts", "name": "Nuts", "target": 3},
    ]


def test_a_short_days_list_counts_its_days_only() -> None:
    items = [{"id": "a", "name": "A", "target": 1}]
    assert insights.day_counts(items, {"a": ["great"]}) == [1, 0, 0, 0, 0, 0, 0]
    assert insights.total_for({}, "a") == 0


@pytest.mark.parametrize(
    ("key", "ok"),
    [
        ("2026-10-26", True),
        ("2026-10-27", False),
        ("2026-02-30", False),
        ("2026-1-05", False),
        ("2026-10-26\n", False),
        ("٢٠٢٦-10-26", False),
        ("", False),
    ],
)
def test_is_monday(key: str, ok: bool) -> None:
    assert insights.is_monday(key) is ok


def test_monday_of() -> None:
    assert insights.monday_of(date(2026, 10, 26)) == date(2026, 10, 26)
    assert insights.monday_of(TODAY) == date(2026, 10, 26)
    assert insights.monday_of(date(2026, 11, 1)) == date(2026, 10, 26)


# --- The readers ---------------------------------------------------------------------------------


def test_no_plans_reads_as_the_defaults(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    out = insights.week_summary(conn, uid, "exercise", "2026-10-26", TODAY)
    assert out["plan_week"] is None
    assert out["carried"] is True
    assert [it["id"] for it in out["items"]] == ["pu", "pl", "sq", "be", "kh"]
    assert out["daily_target"] == 3
    diet = insights.week_summary(conn, uid, "diet", "2026-10-26", TODAY)
    assert [it["id"] for it in diet["items"]] == ["veg", "fruit", "fish", "nuts"]
    assert diet["daily_target"] == 2
    g = insights.goals(conn, uid, TODAY)
    assert [it["id"] for it in goal_items(g, "exercise")] == ["pu", "pl", "sq", "be", "kh"]
    assert goal_items(g, "cardio") == []
    assert [it["id"] for it in goal_items(g, "diet")] == ["veg", "fruit", "fish", "nuts"]


def test_goals_returns_both_notes(conn: sqlite3.Connection) -> None:
    """`goals` carries My goals as `note` and the limits note (K107) as `limits`, each "" when
    there is none, and with no settings at all."""
    uid = add_user(conn)
    g = insights.goals(conn, uid, TODAY)
    assert (g["note"], g["limits"]) == ("", "")
    put_settings(conn, uid, {"limits": "Bad left knee: no running."})
    g = insights.goals(conn, uid, TODAY)
    assert (g["note"], g["limits"]) == ("", "Bad left knee: no running.")
    put_settings(conn, uid, {"goals": "Run 5 km by March."})
    g = insights.goals(conn, uid, TODAY)
    assert (g["note"], g["limits"]) == ("Run 5 km by March.", "Bad left knee: no running.")


def test_a_missed_day_counts_as_done_and_shows_as_missed(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    plan = [{"id": "sq", "name": "Squats", "reps": 15, "target": 2}]
    marks: list[Any] = ["missed", "missed-solid", None, None, None, None, None]
    load(conn, uid, exercise={"plans": {"2026-10-26": plan}, "log": {"2026-10-26": {"sq": marks}}})
    item = insights.week_summary(conn, uid, "exercise", "2026-10-26", TODAY)["items"][0]
    assert item["done"] == 2
    assert item["missed"] == 2
    assert item["great"] == 0
    assert item["goal_met"] is True
    assert item["marks"] == ["missed", "missed", None, None, None, None, None]


def test_week_summary_shape(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    plan = [{"id": "pu", "name": "Push-ups", "reps": 10, "target": 2}]
    load(
        conn,
        uid,
        exercise={
            "plans": {"2026-10-19": plan},
            "log": {"2026-10-26": {"pu": days(0, 3)}},
            "details": {"pu": {"notes": "Slow.", "fields": {"equipment": "Mat"}}},
        },
        settings={"dailyPick": 1},
    )
    out = insights.week_summary(conn, uid, "exercise", "2026-10-26", TODAY)
    assert out == {
        "week": "2026-10-26",
        "plan_week": "2026-10-19",
        "carried": True,
        "daily_target": 1,
        "days": [
            {"date": "2026-10-26", "count": 1, "met": True, "future": False},
            {"date": "2026-10-27", "count": 0, "met": False, "future": False},
            {"date": "2026-10-28", "count": 0, "met": False, "future": False},
            {"date": "2026-10-29", "count": 1, "met": True, "future": True},
            {"date": "2026-10-30", "count": 0, "met": False, "future": True},
            {"date": "2026-10-31", "count": 0, "met": False, "future": True},
            {"date": "2026-11-01", "count": 0, "met": False, "future": True},
        ],
        "items": [
            {
                "id": "pu",
                "name": "Push-ups",
                "target": 2,
                "notes": "Slow.",
                "marks": ["great", None, None, "great", None, None, None],
                "done": 2,
                "great": 2,
                "partial": 0,
                "missed": 0,
                "goal_met": True,
            }
        ],
        "goals_met": 1,
        "days_met": 2,
    }
    # Plain JSON, with no user or session in it.
    assert json.loads(json.dumps(out)) == out
    assert not {"user", "user_id", "username", "session"} & keys(out)


def test_names_and_notes_are_cut_in_output(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    # Code points, as the API counts a note's length: an emoji is one.
    plan = [{"id": "f", "name": "🥦" * 150, "target": 1}]
    # An item's notes may run to 20,000 code points; a reader gives the first 500, and a cut note
    # ends in "…" so an agent can tell it isn't the whole note before writing one back.
    notes = "🥕" * 600
    load(conn, uid, diet={"plans": {"2026-10-26": plan}, "details": {"f": {"notes": notes}}})
    item = insights.week_summary(conn, uid, "diet", "2026-10-26", TODAY)["items"][0]
    assert item["name"] == "🥦" * insights.MAX_NAME
    assert item["notes"] == "🥕" * (MAX_NOTES - 1) + "…"
    assert MAX_NOTES == 500
    goal = goal_items(insights.goals(conn, uid, TODAY), "diet")[0]
    assert goal["name"] == "🥦" * insights.MAX_NAME
    assert goal["notes"] == "🥕" * (MAX_NOTES - 1) + "…"
    history = insights.item_history(conn, uid, "diet", "f", 1, TODAY)
    assert history["name"] == "🥦" * 100
    # One item's reader gives its whole note, to read before writing one back.
    assert history["notes"] == notes


def test_item_history_gives_the_whole_note_in_any_week(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    note = ("Slow on the way down. " * 900).strip()  # 19,799 code points
    plan = {"2026-10-05": [{"id": "pu", "name": "Push-ups", "reps": 10, "target": 2}]}
    load(conn, uid, exercise={"plans": plan, "details": {"pu": {"notes": note}}})
    assert insights.item_history(conn, uid, "exercise", "pu", 2, TODAY)["notes"] == note
    # An item no week shows still has its note; one without a note reads "".
    load(conn, uid, diet={"details": {"gone": {"notes": "Still here."}}})
    assert insights.item_history(conn, uid, "diet", "gone", 1, TODAY)["notes"] == "Still here."
    assert insights.item_history(conn, uid, "diet", "veg", 1, TODAY)["notes"] == ""


def test_an_item_without_notes_reads_an_empty_note(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    assert insights.week_summary(conn, uid, "diet", "2026-10-26", TODAY)["items"][0]["notes"] == ""


def test_notes_are_the_items_details_in_every_week(conn: sqlite3.Connection) -> None:
    """An item's notes are its details, one copy for every week (D3), as its row and page show
    them. A plan stored before migration 7 still holds a note per week until it is next written;
    a reader never shows those."""
    uid = add_user(conn)
    for week, note in (("2026-10-19", "the old week's copy"), ("2026-10-26", "this week's copy")):
        stale = [
            {"id": "pu", "name": "Push-ups", "reps": 10, "target": 2, "notes": note},
            {"id": "sq", "name": "Squats", "reps": 15, "target": 2, "notes": note},
        ]
        conn.execute(
            "INSERT INTO plans VALUES (?, 'exercise', ?, ?, 1)", (uid, week, json.dumps(stale))
        )
    put_details(conn, uid, "exercise", "pu", {"notes": "Elbows in."}, 0, quota=QUOTA)
    for week in ("2026-10-19", "2026-10-26"):
        items = insights.week_summary(conn, uid, "exercise", week, TODAY)["items"]
        assert [(it["id"], it["notes"]) for it in items] == [("pu", "Elbows in."), ("sq", "")]
    goals = goal_items(insights.goals(conn, uid, TODAY), "exercise")
    assert [(it["id"], it["notes"]) for it in goals] == [("pu", "Elbows in."), ("sq", "")]
    # Another tracker's details for the same id are another item's.
    put_details(conn, uid, "diet", "sq", {"notes": "Not squats."}, 0, quota=QUOTA)
    assert goal_items(insights.goals(conn, uid, TODAY), "exercise")[1]["notes"] == ""


def test_readers_see_only_their_users_data(conn: sqlite3.Connection) -> None:
    ann, bob = add_user(conn, "ann"), add_user(conn, "bob")
    plan = [{"id": "pu", "name": "Push-ups", "reps": 10, "target": 1}]
    load(
        conn,
        bob,
        exercise={"plans": {"2026-10-26": plan}, "log": {"2026-10-26": {"pu": days(0)}}},
        settings={"dailyPick": 8, "foodPick": 8},
    )
    out = insights.week_summary(conn, ann, "exercise", "2026-10-26", TODAY)
    assert out["plan_week"] is None
    assert out["daily_target"] == 3
    assert out["days_met"] == 0
    assert daily_targets(insights.goals(conn, ann, TODAY))["exercise"] == 3


def test_readers_write_nothing(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    load(conn, uid, exercise={"plans": {}, "log": {"2026-10-26": {"pu": days(0)}}})
    before = conn.total_changes
    insights.week_summary(conn, uid, "exercise", "2026-10-26", TODAY)
    insights.weeks(conn, uid, "exercise", "2026-10-05", "2026-10-26", TODAY)
    insights.item_history(conn, uid, "exercise", "pu", 4, TODAY)
    insights.goals(conn, uid, TODAY)
    insights.consistency(conn, uid, "exercise", 4, TODAY)
    assert conn.total_changes == before


def test_weeks_lists_each_monday_oldest_first(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    plan = [{"id": "pu", "name": "Push-ups", "reps": 10, "target": 1}]
    load(conn, uid, exercise={"plans": {"2026-10-12": plan}, "log": {}})
    out = insights.weeks(conn, uid, "exercise", "2026-10-05", "2026-10-26", TODAY)
    assert out["tracker"] == "exercise"
    assert (out["start"], out["end"]) == ("2026-10-05", "2026-10-26")
    assert [w["week"] for w in out["weeks"]] == [
        "2026-10-05",
        "2026-10-12",
        "2026-10-19",
        "2026-10-26",
    ]
    assert [w["plan_week"] for w in out["weeks"]] == ["2026-10-12"] * 4
    assert out["weeks"][1] == insights.week_summary(conn, uid, "exercise", "2026-10-12", TODAY)
    one = insights.weeks(conn, uid, "exercise", "2026-10-26", "2026-10-26", TODAY)
    assert len(one["weeks"]) == 1


def test_weeks_holds_at_most_26(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    out = insights.weeks(conn, uid, "diet", "2026-05-04", "2026-10-26", TODAY)
    assert len(out["weeks"]) == insights.MAX_WEEKS == 26
    with pytest.raises(insights.InsightsError, match="weeks") as e:
        insights.weeks(conn, uid, "diet", "2026-04-27", "2026-10-26", TODAY)
    assert e.value.field == "weeks"
    with pytest.raises(insights.InsightsError, match="end") as e:
        insights.weeks(conn, uid, "diet", "2026-10-26", "2026-10-19", TODAY)
    assert e.value.field == "end"


def test_item_history(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    old = [{"id": "pu", "name": "Push ups", "reps": 10, "target": 2}]
    new = [
        {"id": "pu", "name": "Push-ups", "reps": 12, "target": 3},
        {"id": "sq", "name": "Squats", "reps": 15, "target": 2},
    ]
    load(
        conn,
        uid,
        exercise={
            # The week of 12 October has no push-ups, so its marks for them count for nothing.
            "plans": {"2026-10-05": old, "2026-10-12": new[1:], "2026-10-19": new},
            "log": {
                "2026-10-05": {"pu": days(0, 1)},
                "2026-10-12": {"pu": days(0, 1, 2)},
                "2026-10-26": {"pu": ["great", "partial", "missed-hatch", None, None, None, None]},
            },
        },
    )
    out = insights.item_history(conn, uid, "exercise", "pu", 4, TODAY)
    assert out["tracker"] == "exercise"
    assert out["item_id"] == "pu"
    assert out["name"] == "Push-ups"
    assert out["notes"] == ""
    assert (out["start"], out["end"]) == ("2026-10-05", "2026-10-26")
    assert out["weeks"] == [
        {
            "week": "2026-10-05",
            "in_plan": True,
            "target": 2,
            "marks": ["great", "great", None, None, None, None, None],
            "done": 2,
            "great": 2,
            "partial": 0,
            "missed": 0,
            "goal_met": True,
        },
        {
            "week": "2026-10-12",
            "in_plan": False,
            "target": None,
            "marks": [None] * 7,
            "done": 0,
            "great": 0,
            "partial": 0,
            "missed": 0,
            "goal_met": False,
        },
        {
            "week": "2026-10-19",
            "in_plan": True,
            "target": 3,
            "marks": [None] * 7,
            "done": 0,
            "great": 0,
            "partial": 0,
            "missed": 0,
            "goal_met": False,
        },
        {
            "week": "2026-10-26",
            "in_plan": True,
            "target": 3,
            "marks": ["great", "partial", "missed", None, None, None, None],
            "done": 3,
            "great": 1,
            "partial": 1,
            "missed": 1,
            "goal_met": True,
        },
    ]


def test_item_history_of_an_unknown_item(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    out = insights.item_history(conn, uid, "diet", "nope", 2, TODAY)
    assert out["name"] is None
    assert [w["in_plan"] for w in out["weeks"]] == [False, False]


def test_goals(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    load(
        conn,
        uid,
        exercise={
            "plans": {
                "2026-10-19": [{"id": "pu", "name": "Push-ups", "reps": 10, "target": 4}],
                # A later week's plan is not this week's goals.
                "2026-11-02": [{"id": "sq", "name": "Squats", "reps": 10, "target": 2}],
            },
            "log": {},
        },
        cardio={
            "plans": {
                "2026-10-19": [{"id": "cy", "name": "Cycling", "duration": 1800, "target": 2}]
            },
            "log": {},
        },
        diet={"plans": {"2026-10-26": [{"id": "fish", "name": "Fish", "target": 2}]}, "log": {}},
        settings={"dailyPick": 4, "foodPick": 3, "goals": " Run 5 km by March.\n"},
    )
    assert insights.goals(conn, uid, TODAY) == {
        "week": "2026-10-26",
        "trackers": [
            {
                "id": "exercise",
                "name": "Strength",
                "kind": "strength",
                "daily_target": 4,
                "items": [{"id": "pu", "name": "Push-ups", "target": 4, "notes": ""}],
            },
            {
                "id": "cardio",
                "name": "Cardio",
                "kind": "cardio",
                "daily_target": None,
                # A cardio item's session comes in the edit tools' words (K90).
                "items": [
                    {"id": "cy", "name": "Cycling", "target": 2, "seconds": 1800, "notes": ""}
                ],
            },
            {
                "id": "diet",
                "name": "Food",
                "kind": "food",
                "daily_target": 3,
                "items": [{"id": "fish", "name": "Fish", "target": 2, "notes": ""}],
            },
        ],
        "daily_goal": True,
        "note": "Run 5 km by March.",
        "limits": "",
    }


# --- Daily goal off (K85) -------------------------------------------------------------------------

#: Two finished weeks and this one, as in test_consistency, with the daily targets kept but off.
OFF_PLAN = [
    {"id": "a", "name": "A", "reps": 1, "target": 2},
    {"id": "b", "name": "B", "reps": 1, "target": 0},
]
OFF_LOG = {
    "2026-10-12": {"a": days(0, 1), "b": days(0)},
    "2026-10-19": {"a": days(5), "b": days(5, 6)},
    "2026-10-26": {"a": days(0, 1), "b": days(0, 1, 4)},
}


def load_off(conn: sqlite3.Connection) -> int:
    uid = add_user(conn)
    load(
        conn,
        uid,
        exercise={"plans": {"2026-10-12": OFF_PLAN}, "log": OFF_LOG},
        diet={"plans": {"2026-10-12": [{"id": "fish", "name": "Fish", "target": 2}]}, "log": {}},
        settings={"dailyPick": 2, "foodPick": 3, "dailyGoal": False},
    )
    return uid


def turn_on(conn: sqlite3.Connection, user_id: int) -> None:
    """Daily goal back on, as the app saves it: every setting sent, the targets as they were."""
    saved = load_settings(conn, user_id)
    assert saved is not None
    put_settings(conn, user_id, {**saved, "dailyGoal": True})


def test_goals_give_no_daily_targets_while_daily_goal_is_off(conn: sqlite3.Connection) -> None:
    """The targets are kept (they come back when it is on) but no reader gives them, so neither
    Ask nor an MCP client can talk about a number a day. Each item's weekly goal stays."""
    uid = load_off(conn)
    assert insights.goals(conn, uid, TODAY) == {
        "week": "2026-10-26",
        "trackers": [
            {
                "id": "exercise",
                "name": "Strength",
                "kind": "strength",
                "daily_target": None,
                "items": [
                    {"id": "a", "name": "A", "target": 2, "notes": ""},
                    {"id": "b", "name": "B", "target": 0, "notes": ""},
                ],
            },
            # No cardio planned: an empty list, not defaults (K90).
            {"id": "cardio", "name": "Cardio", "kind": "cardio", "daily_target": None, "items": []},
            {
                "id": "diet",
                "name": "Food",
                "kind": "food",
                "daily_target": None,
                "items": [{"id": "fish", "name": "Fish", "target": 2, "notes": ""}],
            },
        ],
        "daily_goal": False,
        "note": "",
        "limits": "",
    }
    turn_on(conn, uid)
    back = insights.goals(conn, uid, TODAY)
    assert daily_targets(back) == {"exercise": 2, "cardio": None, "diet": 3}
    assert back["daily_goal"] is True


def test_week_summaries_have_no_met_days_while_daily_goal_is_off(conn: sqlite3.Connection) -> None:
    """Each day keeps its count, but `met` and `days_met` are null, not false and 0: the person
    met no day because they asked for none. Item goals count as before."""
    uid = load_off(conn)
    out = insights.week_summary(conn, uid, "exercise", "2026-10-26", TODAY)
    assert out["daily_target"] is None
    assert [d["met"] for d in out["days"]] == [None] * 7
    assert [d["count"] for d in out["days"]] == [2, 2, 0, 0, 1, 0, 0]
    assert out["days_met"] is None
    assert (out["goals_met"], [it["goal_met"] for it in out["items"]]) == (1, [True, False])
    for summary in insights.weeks(conn, uid, "exercise", "2026-10-12", "2026-10-26", TODAY)[
        "weeks"
    ]:
        assert (summary["daily_target"], summary["days_met"]) == (None, None)
        assert {d["met"] for d in summary["days"]} == {None}
    assert [
        s["goals_met"]
        for s in insights.weeks(conn, uid, "exercise", "2026-10-12", "2026-10-26", TODAY)["weeks"]
    ] == [1, 0, 1]
    # On again, the same week has its met days back.
    turn_on(conn, uid)
    on = insights.week_summary(conn, uid, "exercise", "2026-10-26", TODAY)
    assert (on["daily_target"], on["days_met"]) == (2, 2)


def test_consistency_has_no_met_days_while_daily_goal_is_off(conn: sqlite3.Connection) -> None:
    uid = load_off(conn)
    assert insights.consistency(conn, uid, "exercise", 3, TODAY) == {
        "tracker": "exercise",
        "start": "2026-10-12",
        "end": "2026-10-26",
        "today": "2026-10-28",
        "daily_target": None,
        "days": 17,
        "days_met": None,
        "met_day_rate": None,
        "finished_weeks": 2,
        "goals": 2,
        "goals_met": 1,
        "goal_met_rate": 0.5,
        "met_day_streak": None,
        "goal_week_streak": 0,
    }


def test_goals_without_settings_have_an_empty_note(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    assert insights.goals(conn, uid, TODAY)["note"] == ""


def test_consistency(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    plan = [
        {"id": "a", "name": "A", "reps": 1, "target": 2},
        {"id": "b", "name": "B", "reps": 1, "target": 0},
    ]
    load(
        conn,
        uid,
        exercise={
            "plans": {"2026-10-12": plan},
            "log": {
                # Finished weeks: 12 Oct meets a's goal, 19 Oct doesn't.
                "2026-10-12": {"a": days(0, 1), "b": days(0)},
                "2026-10-19": {"a": days(5), "b": days(5, 6)},
                # Today's week: Monday, Tuesday met; today (Wednesday) not yet.
                "2026-10-26": {"a": days(0, 1), "b": days(0, 1, 4)},
            },
        },
        settings={"dailyPick": 2},
    )
    out = insights.consistency(conn, uid, "exercise", 3, TODAY)
    assert out == {
        "tracker": "exercise",
        "start": "2026-10-12",
        "end": "2026-10-26",
        "today": "2026-10-28",
        "daily_target": 2,
        # 14 days of the finished weeks and 3 of this one; Friday's marks are still to come.
        "days": 17,
        "days_met": 4,
        "met_day_rate": 0.24,
        "finished_weeks": 2,
        "goals": 2,
        "goals_met": 1,
        "goal_met_rate": 0.5,
        # Today isn't over, so it doesn't break the run: Tuesday and Monday.
        "met_day_streak": 2,
        "goal_week_streak": 0,
    }
    # Once today is met it counts.
    load(conn, uid, exercise={"plans": {}, "log": {"2026-10-26": {"a": days(2), "b": days(2)}}})
    assert insights.consistency(conn, uid, "exercise", 3, TODAY)["met_day_streak"] == 3


def test_consistency_streaks_run_back_across_weeks(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    plan = [{"id": "a", "name": "A", "reps": 1, "target": 1}]
    load(
        conn,
        uid,
        diet={
            "plans": {"2026-10-12": plan},
            "log": {
                "2026-10-12": {"a": days(3)},
                "2026-10-19": {"a": days(0, 1, 2, 3, 4, 5, 6)},
                "2026-10-26": {"a": days(0, 1)},
            },
        },
        settings={"foodPick": 1},
    )
    out = insights.consistency(conn, uid, "diet", 3, TODAY)
    assert out["met_day_streak"] == 9
    assert out["goal_week_streak"] == 2
    assert out["goal_met_rate"] == 1.0
    # The run stops at the first week asked about.
    assert insights.consistency(conn, uid, "diet", 1, TODAY)["met_day_streak"] == 2


def test_consistency_of_nothing(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    load(conn, uid, diet={"plans": {"2026-10-26": []}, "log": {}})
    # A Monday: today's week has one day so far, none finished, and nothing planned.
    out = insights.consistency(conn, uid, "diet", 1, date(2026, 10, 26))
    assert out["days"] == 1
    assert out["met_day_rate"] == 0.0
    assert out["finished_weeks"] == 0
    assert out["goal_met_rate"] is None
    # A week with no goal above 0 breaks the run of weeks.
    out = insights.consistency(conn, uid, "diet", 2, date(2026, 11, 2))
    assert out["finished_weeks"] == 1
    assert (out["goals"], out["goal_week_streak"]) == (0, 0)


@pytest.mark.parametrize("count", [0, 27, -1])
def test_week_counts_are_bounded(conn: sqlite3.Connection, count: int) -> None:
    uid = add_user(conn)
    with pytest.raises(insights.InsightsError, match="weeks"):
        insights.consistency(conn, uid, "exercise", count, TODAY)
    with pytest.raises(insights.InsightsError, match="weeks"):
        insights.item_history(conn, uid, "exercise", "pu", count, TODAY)


@pytest.mark.parametrize("week", ["2026-10-27", "26-10-2026", "2026-13-02"])
def test_weeks_must_be_mondays(conn: sqlite3.Connection, week: str) -> None:
    uid = add_user(conn)
    with pytest.raises(insights.InsightsError) as e:
        insights.week_summary(conn, uid, "exercise", week, TODAY)
    assert e.value.field == "week"
    assert isinstance(e.value, ValueError)
    with pytest.raises(insights.InsightsError, match="start"):
        insights.weeks(conn, uid, "exercise", week, "2026-10-26", TODAY)
    with pytest.raises(insights.InsightsError, match="end"):
        insights.weeks(conn, uid, "exercise", "2026-10-26", week, TODAY)


def test_a_tracker_is_one_of_the_users_own(conn: sqlite3.Connection) -> None:
    """The readers name `tracker` for an id or a name the user lacks, and list theirs."""
    uid = add_user(conn)
    with pytest.raises(insights.InsightsError, match="tracker") as e:
        insights.week_summary(conn, uid, "sleep", "2026-10-26", TODAY)
    assert e.value.field == "tracker"
    assert "the trackers are exercise (Strength), cardio (Cardio), diet (Food)" in str(e.value)
    for bad in ("", " ", 7, None):
        with pytest.raises(insights.InsightsError, match="tracker"):
            insights.consistency(conn, uid, bad, 1, TODAY)  # type: ignore[arg-type]
    # Another user's tracker is not this one's.
    bob = add_user(conn, "bob")
    yoga, _ = create_tracker(conn, bob, "xyoga1", "Yoga", "strength", "2026-10-26")
    with pytest.raises(insights.InsightsError, match="tracker"):
        insights.week_summary(conn, uid, yoga["id"], "2026-10-26", TODAY)


# --- Cardio (K90) ---------------------------------------------------------------------------------

CARDIO_PLAN = [
    {"id": "cy", "name": "Cycling", "duration": 1800, "target": 2},
    {"id": "ru", "name": "Running", "distance": 5, "target": 1},
]


def test_cardio_has_no_items_until_one_is_planned(conn: sqlite3.Connection) -> None:
    """An account from before Cardio has an empty section, not defaults; nothing to add to it."""
    assert insights.default_items("cardio") == []
    uid = add_user(conn)
    out = insights.week_summary(conn, uid, "cardio", "2026-10-26", TODAY)
    assert (out["items"], out["plan_week"], out["daily_target"]) == ([], None, None)


def test_cardio_has_no_daily_target_whatever_daily_goal_says(conn: sqlite3.Connection) -> None:
    """Every kind of mark counts towards a cardio item's weekly goal, as an exercise's; no day is
    met or missed, on or off, so the met-day fields are None."""
    uid = add_user(conn)
    load(
        conn,
        uid,
        cardio={
            "plans": {"2026-10-12": CARDIO_PLAN},
            "log": {
                "2026-10-12": {"cy": ["great", None, "missed", *[None] * 4], "ru": days(3)},
                "2026-10-19": {"cy": ["partial-hatch", *[None] * 6]},
                "2026-10-26": {"ru": days(0, 1)},
            },
        },
        settings={"dailyPick": 1, "foodPick": 1, "dailyGoal": True},
    )
    out = insights.week_summary(conn, uid, "cardio", "2026-10-12", TODAY)
    assert (out["daily_target"], out["days_met"]) == (None, None)
    assert {d["met"] for d in out["days"]} == {None}
    assert [d["count"] for d in out["days"]] == [1, 0, 1, 1, 0, 0, 0]
    assert [(it["done"], it["missed"], it["goal_met"]) for it in out["items"]] == [
        (2, 1, True),
        (1, 0, True),
    ]
    steady = insights.consistency(conn, uid, "cardio", 3, TODAY)
    assert (steady["daily_target"], steady["days_met"], steady["met_day_rate"]) == (
        None,
        None,
        None,
    )
    assert steady["met_day_streak"] is None
    assert (steady["goals"], steady["goals_met"], steady["goal_week_streak"]) == (4, 2, 0)
    history = insights.item_history(conn, uid, "cardio", "cy", 3, TODAY)
    assert [w["done"] for w in history["weeks"]] == [2, 1, 0]
    # Each item's session, in the edit tools' words, only where it has one.
    assert [{k: it.get(k) for k in ("seconds", "distance_km")} for it in out["items"]] == [
        {"seconds": 1800, "distance_km": None},
        {"seconds": None, "distance_km": 5},
    ]
    goals = insights.goals(conn, uid, TODAY)
    cardio = goal_items(goals, "cardio")
    assert [it["id"] for it in cardio] == ["cy", "ru"]
    assert cardio[1]["distance_km"] == 5
    # An exercise's timed set is not a session: the readers leave it out, as its reps.
    plank = {"id": "pl", "name": "Plank", "reps": 0, "duration": 45, "target": 3}
    assert insights.session_of("strength", plank) == {}

    assert daily_targets(goals) == {"exercise": 1, "cardio": None, "diet": 1}


# --- The account's own trackers (spec §1, §2, §4) ------------------------------------------------

THIS_WEEK = "2026-10-26"
LAST_WEEK = "2026-10-19"


def new_tracker(
    conn: sqlite3.Connection,
    uid: int,
    name: str = "Yoga",
    kind: TypeId = "strength",
    week: str = LAST_WEEK,
    tracker_id: str = "xyoga1",
) -> Tracker:
    tracker, added = create_tracker(conn, uid, tracker_id, name, kind, week)
    assert added
    return tracker


def plan_in(conn: sqlite3.Connection, uid: int, tracker_id: str, week: str, items: Any) -> None:
    assert isinstance(put_plan(conn, uid, tracker_id, week, items, 0, quota=QUOTA), PlanSaved)


def test_default_items_are_for_the_first_strength_and_food_trackers_only() -> None:
    """Spec §4: an account with no plan gets the default exercises and foods on the `exercise`
    and `diet` trackers; any other tracker starts empty, whatever its kind."""
    assert len(insights.default_items("exercise")) == 5
    assert len(insights.default_items("diet")) == 4
    assert insights.default_items("cardio") == []
    assert insights.default_items("x123abcd") == []
    assert insights.week_items("x123abcd", {}, THIS_WEEK) == []


def test_a_new_tracker_starts_empty_and_reads_by_its_kind(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    snacks = new_tracker(conn, uid, "Snacks", "food", tracker_id="xsnack1")
    out = insights.week_summary(conn, uid, snacks["id"], THIS_WEEK, TODAY)
    assert (out["items"], out["plan_week"], out["daily_target"]) == ([], None, 2)
    plan_in(conn, uid, snacks["id"], LAST_WEEK, [{"id": "nut", "name": "Nuts", "target": 2}])
    set_tick(conn, uid, snacks["id"], THIS_WEEK, "nut", 0, "great", quota=QUOTA)
    set_tick(conn, uid, snacks["id"], THIS_WEEK, "nut", 1, "great", quota=QUOTA)
    # Its daily target is its own, not foods a day.
    patch = patch_tracker(conn, uid, snacks["id"], {"dailyTarget": 1}, snacks["rev"])
    assert patch is not None
    out = insights.week_summary(conn, uid, snacks["id"], THIS_WEEK, TODAY)
    assert (out["plan_week"], out["daily_target"], out["days_met"], out["goals_met"]) == (
        LAST_WEEK,
        1,
        2,
        1,
    )
    assert insights.week_summary(conn, uid, "diet", THIS_WEEK, TODAY)["daily_target"] == 2
    # A cardio tracker's items have their session, and no daily target.
    rides = new_tracker(conn, uid, "Rides", "cardio", tracker_id="xride1")
    plan_in(conn, uid, rides["id"], THIS_WEEK, [{"id": "r", "name": "Ride", "distance": 30}])
    ride = insights.week_summary(conn, uid, rides["id"], THIS_WEEK, TODAY)
    assert (ride["daily_target"], ride["items"][0]["distance_km"]) == (None, 30)


def test_a_tracker_is_found_by_its_name_in_any_case(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    yoga = new_tracker(conn, uid)
    for ref in ("xyoga1", "Yoga", "yoga", " YOGA "):
        assert insights.tracker_of(conn, uid, ref)["id"] == yoga["id"]
    assert insights.tracker_of(conn, uid, "strength")["id"] == "exercise"
    assert insights.item_history(conn, uid, "food", "veg", 1, TODAY)["tracker"] == "diet"


def test_an_id_wins_over_a_name_and_a_shared_name_is_refused(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    # A tracker named like another's id: the id names that other one.
    new_tracker(conn, uid, "cardio", tracker_id="xnamed1")
    assert insights.tracker_of(conn, uid, "cardio")["id"] == "cardio"
    new_tracker(conn, uid, "Yoga", tracker_id="xyoga1")
    new_tracker(conn, uid, "yoga", tracker_id="xyoga2", week=THIS_WEEK)
    end_tracker(conn, uid, "xyoga1", THIS_WEEK)
    with pytest.raises(insights.InsightsError) as e:
        insights.tracker_of(conn, uid, "YOGA")
    assert e.value.field == "tracker"
    assert str(e.value) == (
        "tracker: 2 trackers are named 'YOGA': xyoga1 (Yoga, deleted from the week of "
        "2026-10-26), xyoga2 (yoga); give its id"
    )
    assert insights.tracker_of(conn, uid, "xyoga2")["name"] == "yoga"


def test_trackers_lists_every_tracker_and_the_weeks_it_shows(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    new_tracker(conn, uid)
    new_tracker(conn, uid, "Snacks", "food", week=THIS_WEEK, tracker_id="xsnack1")
    end_tracker(conn, uid, "xyoga1", THIS_WEEK)
    out = insights.trackers(conn, uid, TODAY)
    assert out["daily_goal"] is True
    assert [(t["id"], t["shows_this_week"]) for t in out["trackers"]] == [
        ("exercise", True),
        ("cardio", True),
        ("diet", True),
        ("xyoga1", False),
        ("xsnack1", True),
    ]
    assert out["trackers"][3] == {
        "id": "xyoga1",
        "name": "Yoga",
        "kind": "strength",
        "daily_target": 3,
        "start_week": LAST_WEEK,
        "end_week": THIS_WEEK,
        "shows_this_week": False,
    }
    assert [t["daily_target"] for t in out["trackers"]] == [3, None, 2, 3, 2]
    put_settings(conn, uid, {"dailyGoal": False})
    off = insights.trackers(conn, uid, TODAY)
    assert off["daily_goal"] is False
    assert {t["daily_target"] for t in off["trackers"]} == {None}


def test_an_ended_tracker_is_absent_from_its_end_week_on(conn: sqlite3.Connection) -> None:
    """Spec §2: a tracker deleted this week shows in no week from this one on. Its earlier
    weeks still read as they were."""
    uid = add_user(conn)
    yoga = new_tracker(conn, uid, week="2026-10-12")
    plan = [{"id": "sun", "name": "Sun salute", "reps": 5, "target": 1}]
    plan_in(conn, uid, yoga["id"], "2026-10-12", plan)
    for week in ("2026-10-12", LAST_WEEK, THIS_WEEK):
        set_tick(conn, uid, yoga["id"], week, "sun", 0, "great", quota=QUOTA)
    assert patch_tracker(conn, uid, yoga["id"], {"dailyTarget": 1}, yoga["rev"]) is not None
    end_tracker(conn, uid, yoga["id"], THIS_WEEK)
    # Earlier weeks keep it.
    assert insights.week_summary(conn, uid, "Yoga", LAST_WEEK, TODAY)["goals_met"] == 1
    # From its end on, the week doesn't show it.
    for week in (THIS_WEEK, "2026-11-02"):
        with pytest.raises(insights.InsightsError) as e:
            insights.week_summary(conn, uid, "Yoga", week, TODAY)
        assert e.value.field == "week"
        assert "Yoga (xyoga1) was deleted from the week of 2026-10-26 on" in str(e.value)
    # Nor a week before it started.
    with pytest.raises(insights.InsightsError, match="starts in the week of 2026-10-12"):
        insights.week_summary(conn, uid, "Yoga", "2026-10-05", TODAY)
    out = insights.weeks(conn, uid, "Yoga", "2026-10-05", "2026-11-02", TODAY)
    assert [w["week"] for w in out["weeks"]] == ["2026-10-12", LAST_WEEK]
    history = insights.item_history(conn, uid, "Yoga", "sun", 4, TODAY)
    assert [(w["week"], w["in_plan"], w["done"]) for w in history["weeks"]] == [
        ("2026-10-05", False, 0),
        ("2026-10-12", True, 1),
        (LAST_WEEK, True, 1),
        (THIS_WEEK, False, 0),
    ]
    steady = insights.consistency(conn, uid, "Yoga", 4, TODAY)
    assert (steady["days"], steady["finished_weeks"], steady["goals"]) == (14, 2, 2)
    assert (steady["goals_met"], steady["goal_week_streak"]) == (2, 2)
    # This week's Monday doesn't count: the week doesn't show it. Its last shown day, a Sunday,
    # was not met, so the run is 0.
    assert (steady["days_met"], steady["met_day_streak"]) == (2, 0)
    assert [t["id"] for t in insights.goals(conn, uid, TODAY)["trackers"]] == [
        "exercise",
        "cardio",
        "diet",
    ]


def test_consistency_of_a_tracker_no_week_shows(conn: sqlite3.Connection) -> None:
    """A tracker created and deleted in the same week shows nowhere (spec §2)."""
    uid = add_user(conn)
    new_tracker(conn, uid, week=THIS_WEEK)
    end_tracker(conn, uid, "xyoga1", THIS_WEEK)
    out = insights.consistency(conn, uid, "xyoga1", 2, TODAY)
    assert (out["days"], out["days_met"], out["met_day_rate"], out["met_day_streak"]) == (
        0,
        0,
        None,
        0,
    )
    assert insights.weeks(conn, uid, "xyoga1", LAST_WEEK, THIS_WEEK, TODAY)["weeks"] == []
    assert "xyoga1" not in daily_targets(insights.goals(conn, uid, TODAY))


def test_goals_report_a_tracker_from_the_week_it_starts(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    new_tracker(conn, uid, "Next", week="2026-11-02", tracker_id="xnext1")
    new_tracker(conn, uid, "Snacks", "food", week=THIS_WEEK, tracker_id="xsnack1")
    plan_in(conn, uid, "xsnack1", THIS_WEEK, [{"id": "nut", "name": "Nuts", "target": 3}])
    out = insights.goals(conn, uid, TODAY)
    assert [t["id"] for t in out["trackers"]] == ["exercise", "cardio", "diet", "xsnack1"]
    assert out["trackers"][3] == {
        "id": "xsnack1",
        "name": "Snacks",
        "kind": "food",
        "daily_target": 2,
        "items": [{"id": "nut", "name": "Nuts", "target": 3, "notes": ""}],
    }
