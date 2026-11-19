"""The work a run plans and the work done, week by week (spec docs/specs/2026-11-19-work-charts.md,
K179): each activity's measure, planned and done under W1 to W6, the total, rounding, and the
run's `work` over REST. MCP's `get_programme` is in test_mcp.py."""

from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from fractions import Fraction
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api.config import Config
from tracker_api.programme import parse_programme
from tracker_api.programme_replay import Change, Replay, replay, start_run
from tracker_api.validate import Days, Log
from tracker_api.work import UNITS, measure_of, session_amount, work_json

from .test_runs_api import TODAY, apply, run_of, started, tick

#: Mon 2 Nov 2026, the runs' first day here; today is the Wednesday of their week 2.
START = date(2026, 11, 2)
WEEK_1, WEEK_2, WEEK_3 = "2026-11-02", "2026-11-09", "2026-11-16"
WED_2 = date(2026, 11, 11)

SQUAT = {
    "key": "squat",
    "name": "Back squat",
    "target": 3,
    "sets": 5,
    "reps": 5,
    "weight": {"start": 100, "add": 10},
}
PUSH_UP = {"key": "push-up", "name": "Push-up", "target": 2, "sets": 3, "reps": 10}
SIDE_PLANK = {
    "key": "side-plank",
    "name": "Side plank",
    "target": 2,
    "sets": 2,
    "perSide": True,
    "duration": 30,
}
#: A weighted hold: it has no reps, so it counts seconds.
CARRY = {
    "key": "carry",
    "name": "Farmer's hold",
    "target": 1,
    "sets": 2,
    "weight": 40,
    "duration": 45,
}
RUN = {"key": "run", "name": "Easy run", "target": 2, "duration": 1800, "distance": 3.3}
SPIN = {"key": "spin", "name": "Spin", "target": 1, "duration": 2700}


def document(kind: str, *activities: Mapping[str, Any], weeks: int = 3) -> dict[str, Any]:
    return {
        "format": "tracker-programme/1",
        "name": "Work",
        "kind": kind,
        "weeks": weeks,
        "activities": list(activities),
    }


def change(seq: int, on: date, body: Mapping[str, Any]) -> Change:
    return Change(seq=seq, from_date=on, made_at=datetime(2026, 11, 1), body=body)


def run_of_doc(
    doc: Mapping[str, Any], changes: Sequence[Change] = (), today: date = WED_2
) -> Replay:
    return replay(start_run(parse_programme(doc), {}, START), changes, until=today)


def marks(**days: str) -> Days:
    """A week's marks, by the day's first three letters: marks(mon="great", fri="partial")."""
    names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    return [days.get(n) for n in names]  # type: ignore[misc]


def work(
    rp: Replay, log: Log | None = None, today: date = WED_2, last_day: date | None = None
) -> dict[str, Any]:
    return work_json(rp, rp.weeks, today=today, log=log or {}, last_day=last_day)


def activity(out: Mapping[str, Any], key: str) -> dict[str, Any]:
    found: dict[str, Any] = next(a for a in out["activities"] if a["key"] == key)
    return found


def amounts(weeks: Sequence[Mapping[str, Any]]) -> list[tuple[Any, Any]]:
    return [(w["planned"], w["done"]) for w in weeks]


# --- the measures ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "raw", "measure"),
    [
        ("strength", SQUAT, "work"),
        ("strength", PUSH_UP, "reps"),
        ("strength", SIDE_PLANK, "seconds"),
        ("strength", CARRY, "seconds"),
        ("strength", {"key": "x", "name": "Sets only", "sets": 3}, "reps"),
        ("mobility", PUSH_UP, "reps"),
        ("cardio", RUN, "distance"),
        ("cardio", SPIN, "time"),
    ],
)
def test_each_activity_counts_one_measure(kind: str, raw: dict[str, Any], measure: str) -> None:
    programme = parse_programme(document(kind, raw))
    assert measure_of(programme.kind, programme.activities[0]) == measure


def test_the_units() -> None:
    assert UNITS == {"work": "kg", "reps": "reps", "seconds": "s", "distance": "km", "time": "min"}


@pytest.mark.parametrize(
    ("measure", "values", "amount"),
    [
        ("work", {"sets": 5, "reps": 5, "weight": 52.5}, Fraction(2625, 2)),
        ("work", {"sets": 3, "reps": 8, "weight": 20, "perSide": True}, 960),
        ("reps", {"sets": 3, "reps": 10}, 30),
        ("reps", {"sets": 3, "reps": 10, "perSide": False}, 30),
        ("reps", {"sets": 2, "reps": 10, "perSide": True}, 40),
        ("reps", {"reps": 12}, 12),
        ("reps", {"sets": 3}, 0),
        ("seconds", {"sets": 2, "duration": 30, "perSide": True}, 120),
        ("distance", {"duration": 1800, "distance": 3.3}, Fraction(33, 10)),
        ("time", {"duration": 2700}, 45),
        ("time", {}, 0),
    ],
)
def test_one_sessions_amount(measure: Any, values: dict[str, Any], amount: Fraction) -> None:
    """Sets left out count one set; each side doubles reps and seconds, and so work."""
    assert session_amount(measure, values) == amount


# --- planned and done ------------------------------------------------------------------------


def test_a_strength_run_plans_each_activity_in_its_measure_and_totals_the_weighted() -> None:
    rp = run_of_doc(document("strength", SQUAT, PUSH_UP, SIDE_PLANK, CARRY))
    out = work(rp)
    assert [(a["key"], a["name"], a["measure"], a["unit"]) for a in out["activities"]] == [
        ("squat", "Back squat", "work", "kg"),
        ("push-up", "Push-up", "reps", "reps"),
        ("side-plank", "Side plank", "seconds", "s"),
        ("carry", "Farmer's hold", "seconds", "s"),
    ]
    squat = activity(out, "squat")["weeks"]
    assert [(w["monday"], w["programmeWeeks"]) for w in squat] == [
        (WEEK_1, [1]),
        (WEEK_2, [2]),
        (WEEK_3, [3]),
    ]
    # 3 a week of 5 x 5 at 100, 110 and 120 kg. Nothing is marked; week 3 is still to come.
    assert amounts(squat) == [(7500, 0), (8250, 0), (9000, None)]
    assert amounts(activity(out, "push-up")["weeks"]) == [(60, 0), (60, 0), (60, None)]
    # 2 a week of 2 x 30 s each side.
    assert amounts(activity(out, "side-plank")["weeks"]) == [(240, 0), (240, 0), (240, None)]
    assert amounts(activity(out, "carry")["weeks"]) == [(90, 0), (90, 0), (90, None)]
    total = out["total"]
    assert (total["unit"], total["leftOut"]) == ("kg", ["Push-up", "Side plank", "Farmer's hold"])
    assert total["weeks"] == squat


def test_any_mark_counts_a_full_session_and_marks_past_the_goal_count() -> None:
    """W1 and W3: four marks of any kind in a "3 a week" week add four sessions, so done passes
    planned. This week counts its marks so far; a week after today has no done at all."""
    rp = run_of_doc(document("strength", SQUAT, PUSH_UP))
    log: Log = {
        WEEK_1: {
            "squat": marks(mon="great", wed="partial", fri="missed-solid", sun="great-hatch"),
            "push-up": marks(tue="great"),
        },
        # A mark on Friday, after today, isn't counted yet.
        WEEK_2: {"squat": marks(mon="great", fri="great")},
        WEEK_3: {"squat": marks(mon="great")},
    }
    out = work(rp, log)
    assert amounts(activity(out, "squat")["weeks"]) == [(7500, 10000), (8250, 2750), (9000, None)]
    assert amounts(activity(out, "push-up")["weeks"]) == [(60, 30), (60, 0), (60, None)]
    assert amounts(out["total"]["weeks"]) == [(7500, 10000), (8250, 2750), (9000, None)]


def test_a_value_changed_mid_week_counts_from_its_day() -> None:
    """W2: 110 kg Monday and Tuesday, 120 kg from Wednesday. Planned is each day's 3/7 of a
    session; a Thursday mark counts the new weight."""
    raise_it = change(
        1, WED_2, {"type": "set-value", "activity": "squat", "field": "weight", "value": 120}
    )
    thursday = WED_2 + timedelta(days=1)
    rp = run_of_doc(document("strength", SQUAT), [raise_it], today=thursday)
    out = work(rp, {WEEK_2: {"squat": marks(mon="great", thu="great")}}, today=thursday)
    week_2 = activity(out, "squat")["weeks"][1]
    # (2 x 2750 + 5 x 3000) x 3/7 = 8785.7.
    assert (week_2["planned"], week_2["done"]) == (8786, 2750 + 3000)


def test_a_paused_activity_plans_nothing_on_its_paused_days() -> None:
    """W6: the squat pauses from Wednesday of week 1 for a week. Monday and Tuesday plan 3/7 of
    a session each; a mark on a paused day still counts, at the values it comes back at."""
    pause = change(
        1, date(2026, 11, 4), {"type": "pause-activity", "activity": "squat", "weeks": 1}
    )
    rp = run_of_doc(document("strength", SQUAT, PUSH_UP), [pause])
    out = work(rp, {WEEK_1: {"squat": marks(mon="great", thu="great")}})
    week_1, week_2, _ = activity(out, "squat")["weeks"]
    # 2 x 3/7 x 2500 = 2142.9; the paused Thursday's mark is at 110 kg.
    assert (week_1["planned"], week_1["done"]) == (2143, 2500 + 2750)
    # Back from Wednesday of week 2: 5 days of 3/7 x 2750.
    assert week_2["planned"] == round(5 * 3 / 7 * 2750)
    assert activity(out, "push-up")["weeks"][0]["planned"] == 60


def test_an_activity_has_no_weeks_before_it_was_added_or_after_it_ended() -> None:
    """W6: the push-up ends on Thursday of week 1, and a dip is added on Tuesday of week 2. Each
    activity has the weeks it has a day in; the total has every week, a missing week counting 0."""
    dip = {"key": "dip", "name": "Dip", "target": 2, "sets": 3, "reps": 8, "weight": 10}
    changes = [
        change(1, date(2026, 11, 5), {"type": "end-activity", "activity": "push-up"}),
        change(2, date(2026, 11, 10), {"type": "add-activity", "activity": dip}),
    ]
    rp = run_of_doc(document("strength", SQUAT, PUSH_UP), changes)
    out = work(rp, {WEEK_1: {"push-up": marks(mon="great", sat="great")}})
    push_up = activity(out, "push-up")["weeks"]
    # Monday to Wednesday, 3 x 2/7 x 30; the mark after its end isn't counted.
    assert [(w["monday"], w["planned"], w["done"]) for w in push_up] == [(WEEK_1, 26, 30)]
    dips = activity(out, "dip")["weeks"]
    # Tuesday to Sunday of week 2, 6 x 2/7 x 240 kg.
    assert [(w["monday"], w["planned"]) for w in dips] == [(WEEK_2, 411), (WEEK_3, 480)]
    assert [w["planned"] for w in out["total"]["weeks"]] == [7500, 8250 + 411, 9000 + 480]


def test_an_activity_ended_before_it_had_a_day_is_left_out() -> None:
    gone = change(1, START, {"type": "end-activity", "activity": "push-up"})
    rp = run_of_doc(document("strength", SQUAT, PUSH_UP), [gone])
    assert [a["key"] for a in work(rp)["activities"]] == ["squat"]
    assert work(rp)["total"]["leftOut"] == []


def test_days_after_the_runs_last_add_nothing() -> None:
    """After End programme the replay passes the end by: `last_day` cuts each week there."""
    rp = run_of_doc(document("strength", SQUAT))
    out = work(
        rp, {WEEK_2: {"squat": marks(tue="great", wed="great")}}, last_day=date(2026, 11, 10)
    )
    squat = activity(out, "squat")["weeks"]
    # Monday and Tuesday of week 2; week 3 has no day left, so it isn't the activity's.
    assert amounts(squat) == [(7500, 0), (round(2 * 3 / 7 * 2750), 2750)]
    assert [w["monday"] for w in out["total"]["weeks"]] == [WEEK_1, WEEK_2, WEEK_3]
    assert amounts(out["total"]["weeks"])[2] == (0, None)


def test_a_programme_without_weight_has_no_total() -> None:
    """W5: a mobility run counts reps and seconds held, each side twice, and no total."""
    hold = {
        "key": "hip",
        "name": "Hip flexor",
        "target": 5,
        "sets": 2,
        "perSide": True,
        "duration": 30,
    }
    rp = run_of_doc(document("mobility", hold, PUSH_UP))
    out = work(rp, {WEEK_1: {"hip": marks(mon="great", tue="partial")}})
    assert out["total"] is None
    assert amounts(activity(out, "hip")["weeks"]) == [(600, 240), (600, 0), (600, None)]
    assert amounts(activity(out, "push-up")["weeks"]) == [(60, 0), (60, 0), (60, None)]


def test_cardio_counts_distance_to_a_tenth_or_minutes() -> None:
    rp = run_of_doc(document("cardio", RUN, SPIN, {**RUN, "key": "five", "distance": 5}))
    out = work(rp, {WEEK_1: {"run": marks(mon="great"), "spin": marks(sat="great")}})
    assert out["total"] is None
    assert [(a["measure"], a["unit"]) for a in out["activities"]] == [
        ("distance", "km"),
        ("time", "min"),
        ("distance", "km"),
    ]
    assert amounts(activity(out, "run")["weeks"])[0] == (6.6, 3.3)
    assert amounts(activity(out, "spin")["weeks"])[0] == (45, 45)
    # A whole number of km is sent as one.
    five = amounts(activity(out, "five")["weeks"])[0]
    assert five == (10, 0)
    assert isinstance(five[0], int)


def test_amounts_round_half_up() -> None:
    """4 x 3/7 x 87.5 kg is 150, exactly; 2 x 3/7 x 2.5 km is 2.142..., so 2.1; 3/7 of 7 x 3.5 min
    is 10.5, so 11."""
    light = {**SQUAT, "sets": 1, "reps": 1, "weight": 87.5}
    pause = change(
        1, date(2026, 11, 6), {"type": "pause-activity", "activity": "squat", "weeks": 1}
    )
    rp = run_of_doc(document("strength", light), [pause])
    assert activity(work(rp), "squat")["weeks"][0]["planned"] == 150
    short = {**RUN, "target": 3, "distance": 2.5}
    pause = change(1, date(2026, 11, 4), {"type": "pause-activity", "activity": "run", "weeks": 1})
    rp = run_of_doc(document("cardio", short), [pause])
    assert activity(work(rp), "run")["weeks"][0]["planned"] == 2.1
    seven = {**SPIN, "target": 7, "duration": 210}
    pause = change(1, date(2026, 11, 5), {"type": "pause-activity", "activity": "spin", "weeks": 1})
    rp = run_of_doc(document("cardio", seven), [pause])
    # Monday to Wednesday: 3 x 7/7 x 3.5 = 10.5 min.
    assert activity(work(rp), "spin")["weeks"][0]["planned"] == 11


def test_a_three_year_programme_has_a_week_each() -> None:
    """K181, K182: 156 weeks, never grouped."""
    doc = document("strength", {**SQUAT, "weight": {"start": 100, "add": 1, "max": 200}}, weeks=156)
    out = work(run_of_doc(doc))
    weeks = out["total"]["weeks"]
    assert len(weeks) == 156
    assert (weeks[-1]["programmeWeeks"], weeks[-1]["planned"]) == ([156], 3 * 25 * 200)


# --- the run over REST -----------------------------------------------------------------------


def test_the_run_carries_its_work(client: TestClient, config: Config) -> None:
    """The beginner 5x5 from today (Fri 23 Oct): this week's three days plan 3/7 of each
    session, and the days before the start nothing; a squat marked today counts in full."""
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    assert tick(client, tracker, "2026-10-19", "squat", 4, "great").status_code == 200
    run = run_of(client, tracker)
    out = run["work"]
    grid = run["grid"]
    assert [a["key"] for a in out["activities"]] == [a["key"] for a in grid["activities"]]
    assert [(a["key"], a["measure"]) for a in out["activities"]] == [
        ("squat", "work"),
        ("bench", "work"),
        ("row", "work"),
        ("deadlift", "work"),
        ("plank", "seconds"),
    ]
    mondays = [w["monday"] for w in grid["weeks"]]
    assert [w["monday"] for w in out["total"]["weeks"]] == mondays
    assert [w["programmeWeeks"] for w in out["total"]["weeks"]] == [
        w["programmeWeeks"] for w in grid["weeks"]
    ]
    assert out["total"]["leftOut"] == ["Plank"]
    squat = activity(out, "squat")["weeks"]
    # Friday to Sunday of week 1 at 40 kg: 3 x 3/7 x 1000. Next week 3 x 25 x 42.5 = 3187.5,
    # rounded half up.
    assert squat[0] == {
        "monday": "2026-10-19",
        "programmeWeeks": [1],
        "planned": 1286,
        "done": 1000,
    }
    assert (squat[1]["planned"], squat[1]["done"]) == (3188, None)
    assert all(w["done"] is None for w in out["total"]["weeks"][1:])


def test_an_open_pause_leaves_the_weeks_when_resumed_out(
    client: TestClient, config: Config
) -> None:
    made = started(client, config, on=TODAY)
    tracker = made["tracker"]["id"]
    run = apply(client, tracker, {"type": "pause-programme"}, "2026-10-26")["run"]
    assert run["end"] is None
    assert len(run["grid"]["whenResumed"]) > 0
    mondays = [w["monday"] for w in run["grid"]["weeks"]]
    out = run["work"]
    assert [w["monday"] for w in out["total"]["weeks"]] == mondays
    for a in out["activities"]:
        assert [w["monday"] for w in a["weeks"]] == mondays
        # Paused from next Monday on, the weeks after this one plan nothing.
        assert [w["planned"] for w in a["weeks"][1:]] == [0] * (len(mondays) - 1)
