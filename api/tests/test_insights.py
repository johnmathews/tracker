"""The insights module: the shared fixtures in fixtures/insights/ (which
src/lib/__tests__/insights-parity.spec.ts runs too), then the readers over a real database."""

import json
import sqlite3
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from tracker_api import insights
from tracker_api.data import import_data, put_settings
from tracker_api.validate import MAX_NOTES, Section, Tracked

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "insights"
CASES: list[tuple[str, Any]] = [
    (p.name, json.loads(p.read_text(encoding="utf-8"))) for p in sorted(FIXTURES.glob("*.json"))
]
NO_LOG: Tracked = {"plans": {}, "log": {}}
QUOTA = 10**9
# Wednesday 28 October 2026, in the week of Monday 26 October.
TODAY = date(2026, 10, 28)


def add_user(conn: sqlite3.Connection, username: str = "ann") -> int:
    cur = conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, 'h', 0)", (username,)
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def load(
    conn: sqlite3.Connection,
    user_id: int,
    *,
    exercise: Tracked = NO_LOG,
    diet: Tracked = NO_LOG,
    settings: dict[str, Any] | None = None,
) -> None:
    """Store plans and marks the way an import does, and settings when given."""
    import_data(conn, user_id, {"exercise": exercise, "diet": diet, "settings": None}, quota=QUOTA)
    if settings is not None:
        put_settings(conn, user_id, settings)


def days(*marked: int) -> list[Any]:
    return ["great" if i in marked else None for i in range(7)]


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
    met = insights.met_days(counts, case["dailyTarget"])
    assert met == expected["metDays"]
    assert sum(met) == expected["daysMet"]
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
    tracked: Tracked = {"plans": case["plans"], "log": case["log"]}
    if section == "exercise":
        load(conn, uid, exercise=tracked, settings={"dailyPick": case["dailyTarget"]})
    else:
        load(conn, uid, diet=tracked, settings={"foodPick": case["dailyTarget"]})
    out = insights.week_summary(conn, uid, section, case["week"], date.fromisoformat(case["today"]))
    assert out["week"] == case["week"]
    assert out["plan_week"] == expected["planWeek"]
    assert out["carried"] is (expected["planWeek"] != case["week"])
    assert out["daily_target"] == case["dailyTarget"]
    assert [d["count"] for d in out["days"]] == expected["dayCounts"]
    assert [d["met"] for d in out["days"]] == expected["metDays"]
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
        }
        for it in out["items"]
    ] == expected["items"]


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
    assert [it["id"] for it in g["exercise"]] == ["pu", "pl", "sq", "be", "kh"]
    assert [it["id"] for it in g["diet"]] == ["veg", "fruit", "fish", "nuts"]


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
    plan = [{"id": "pu", "name": "Push-ups", "reps": 10, "target": 2, "notes": "Slow."}]
    load(
        conn,
        uid,
        exercise={"plans": {"2026-10-19": plan}, "log": {"2026-10-26": {"pu": days(0, 3)}}},
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
    plan = [{"id": "f", "name": "🥦" * 150, "target": 1, "notes": "n" * 600}]
    load(conn, uid, diet={"plans": {"2026-10-26": plan}, "log": {}})
    item = insights.week_summary(conn, uid, "diet", "2026-10-26", TODAY)["items"][0]
    assert item["name"] == "🥦" * insights.MAX_NAME
    assert len(item["notes"]) == MAX_NOTES == 500
    assert insights.goals(conn, uid, TODAY)["diet"][0]["name"] == "🥦" * insights.MAX_NAME
    assert insights.item_history(conn, uid, "diet", "f", 1, TODAY)["name"] == "🥦" * 100


def test_an_item_without_notes_reads_an_empty_note(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    assert insights.week_summary(conn, uid, "diet", "2026-10-26", TODAY)["items"][0]["notes"] == ""


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
    assert insights.goals(conn, ann, TODAY)["exercises_a_day"] == 3


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
    assert out["section"] == "exercise"
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
    assert out["section"] == "exercise"
    assert out["item_id"] == "pu"
    assert out["name"] == "Push-ups"
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
        diet={"plans": {"2026-10-26": [{"id": "fish", "name": "Fish", "target": 2}]}, "log": {}},
        settings={"dailyPick": 4, "foodPick": 3},
    )
    assert insights.goals(conn, uid, TODAY) == {
        "week": "2026-10-26",
        "exercise": [{"id": "pu", "name": "Push-ups", "target": 4, "notes": ""}],
        "diet": [{"id": "fish", "name": "Fish", "target": 2, "notes": ""}],
        "exercises_a_day": 4,
        "foods_a_day": 3,
        "note": "",
    }


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
        "section": "exercise",
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


def test_sections_are_exercise_or_diet(conn: sqlite3.Connection) -> None:
    uid = add_user(conn)
    bad: Any = "food"
    with pytest.raises(insights.InsightsError, match="section") as e:
        insights.week_summary(conn, uid, bad, "2026-10-26", TODAY)
    assert e.value.field == "section"
    with pytest.raises(insights.InsightsError, match="section"):
        insights.consistency(conn, uid, bad, 1, TODAY)
