"""The change log and its replay (spec docs/specs/2026-11-17-programmes.md §5 to §8).

`fixtures/programmes/replays/mockup.json` holds the mockup page's run (spec §10): its log, each
week's values, the bench's split week, the deadlift that ends short and the barbell row preview.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tracker_api import validate
from tracker_api.programme import ProgrammeInvalid, Series, parse_programme
from tracker_api.programme_replay import (
    CHANGE_TYPES,
    END_PROGRAMME,
    REOPEN_PROGRAMME,
    ActivityDay,
    Change,
    DayPlan,
    Replay,
    Run,
    check_change,
    confirm_token,
    day_from_json,
    day_to_json,
    preview_change,
    replay,
    rev_of,
    start_run,
    week_goal,
    week_items,
)

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "programmes"
MOCKUP: dict[str, Any] = json.loads((FIXTURES / "replays" / "mockup.json").read_text("utf-8"))
TODAY = date.fromisoformat(MOCKUP["today"])  # Wed 16 Dec 2026, programme week 4
START = date.fromisoformat(MOCKUP["start"])  # Mon 23 Nov 2026


def d(text: str) -> date:
    return date.fromisoformat(text)


def load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text("utf-8"))


def mockup_run() -> Run:
    return start_run(parse_programme(load(MOCKUP["programme"])), MOCKUP["params"], START)


def to_change(raw: Mapping[str, Any]) -> Change:
    return Change(
        seq=raw["seq"],
        from_date=d(raw["from"]),
        made_at=datetime.fromisoformat(raw["madeAt"]),
        body=raw["change"],
        reason=raw.get("reason"),
    )


def mockup_log() -> list[Change]:
    return [to_change(c) for c in MOCKUP["changes"]]


def change(seq: int, from_date: date, body: Mapping[str, Any], reason: str | None = None) -> Change:
    return Change(
        seq=seq,
        from_date=from_date,
        made_at=datetime.combine(from_date, datetime.min.time()),
        body=body,
        reason=reason,
    )


def plain_run(name: str = "beginner-5x5.json", start: date = START) -> Run:
    return start_run(parse_programme(load(f"valid/{name}")), {}, start)


def weight(rp: Replay, day: date, key: str) -> Any:
    values = rp.day(day).activities[key].values
    assert values is not None
    return values["weight"]


def sunday_weights(rp: Replay, key: str) -> list[Any]:
    out = []
    for week in rp.weeks:
        act = week.days[6].activities[key]
        out.append(act.values["weight"] if act.state == "running" and act.values else act.state)
    return out


# ---- The mockup's run (spec §10): the acceptance criteria ----


def test_the_mockup_replays_to_the_pages_numbers_week_by_week() -> None:
    rp = replay(mockup_run(), mockup_log())
    assert [w.monday.isoformat() for w in rp.weeks] == [w["monday"] for w in MOCKUP["weeks"]]
    assert rp.end == d(MOCKUP["end"])
    for week, expected in zip(rp.weeks, MOCKUP["weeks"], strict=True):
        sunday = week.days[6]
        assert list(week.programme_weeks) == expected["programmeWeeks"]
        assert sunday.label == expected["label"]
        for key, want in expected["activities"].items():
            got = sunday.activities[key]
            where = f"{key} in the week of {week.monday}"
            assert got.state == want["state"], where
            assert got.activity_week == want["activityWeek"], where
            if want["state"] == "running":
                assert got.values == want["values"], where
            else:
                assert got.until == d(want["until"]), where
                assert got.reason == want["reason"], where
            hand = {
                f: {"change": m.seq, "madeOn": m.made_on.isoformat(), "rule": m.rule}
                for f, m in got.hand.items()
            }
            assert hand == want.get("hand", {}), where


def test_squat_is_45_kg_in_week_4() -> None:
    """The increase went to 7.5% on Thu 3 Dec, from week 2's shown 42.5 kg: week 4 is a deload,
    42.5 x 1.075^2 x 0.9 = 44.2, shown as 45."""
    rp = replay(mockup_run(), mockup_log())
    assert weight(rp, d("2026-12-16"), "squat") == 45
    assert rp.day(d("2026-12-16")).programme_week == 4


def test_the_deadlift_is_back_at_75_kg_on_mon_28_dec_and_ends_at_its_week_6_of_8() -> None:
    rp = replay(mockup_run(), mockup_log())
    back = rp.day(d("2026-12-28")).activities["deadlift"]
    assert (back.state, back.activity_week, back.values and back.values["weight"]) == (
        "running",
        4,
        75,
    )
    paused = rp.day(d("2026-12-27")).activities["deadlift"]
    assert (paused.state, paused.until, paused.reason) == ("paused", d("2026-12-28"), "Knee")
    assert paused.values is not None and paused.values["weight"] == 75  # what it comes back at
    assert [(e.key, e.week, e.of, e.message) for e in rp.ends_short] == [
        ("deadlift", 6, 8, "Deadlift ends at its week 6 of 8.")
    ]


def test_the_bench_splits_week_3_from_wed() -> None:
    """ "35 → 32.5 kg from Wed": Monday and Tuesday keep 35 kg."""
    rp = replay(mockup_run(), mockup_log())
    for split in MOCKUP["splits"]:
        week = rp.week(d(split["monday"]))
        expected = [(d(day), value) for day, value in split["runs"]]
        assert list(week.splits(split["activity"], split["field"])) == expected
    assert rp.week(d("2026-12-14")).splits("deadlift", "weight") == ()  # paused all week


@pytest.mark.parametrize("case", MOCKUP["previews"], ids=lambda c: c["note"])
def test_the_barbell_row_preview(case: dict[str, Any]) -> None:
    """40 → 45, 45 → 50 and 42.5 → 47.5, with week 6 kept at 35 kg unless the hand-edit goes."""
    log = mockup_log()
    preview = preview_change(
        mockup_run(),
        log,
        case["change"],
        from_date=d(case["from"]),
        today=TODAY,
        made_at=datetime(2026, 12, 16, 12, 0),
    )
    cells = [
        {
            "monday": c.monday.isoformat(),
            "activity": c.key,
            "field": c.field,
            "before": c.before,
            "after": c.after,
        }
        for c in preview.cells
    ]
    assert cells == case["cells"]
    blocking = [
        {
            "change": b.seq,
            "activity": b.key,
            "field": b.field,
            "week": b.programme_week,
            "message": b.message,
        }
        for b in preview.blocking
    ]
    assert blocking == case["blocking"]
    assert preview.rev == rev_of(log)
    assert preview.change.seq == 5
    assert preview.change.from_date == d(case["from"])
    assert preview.after.end == preview.before.end


# ---- Properties ----

# One change of each kind that applies in the mockup's run, made today with its from day given
# as weeks and days after today.
PROPERTY_CHANGES: list[tuple[str, dict[str, Any]]] = [
    ("pause-programme", {"type": "pause-programme", "weeks": 2}),
    ("pause-programme-open", {"type": "pause-programme"}),
    ("go-to-week-back", {"type": "go-to-week", "week": 2}),
    ("go-to-week-on", {"type": "go-to-week", "week": 7}),
    ("pause-activity", {"type": "pause-activity", "activity": "squat", "weeks": 1}),
    (
        "add-activity",
        {"type": "add-activity", "activity": {"key": "dips", "name": "Dips", "sets": 3, "reps": 8}},
    ),
    ("end-activity", {"type": "end-activity", "activity": "plank"}),
    ("set-value", {"type": "set-value", "activity": "squat", "field": "weight", "value": 50}),
    (
        "set-increase-add",
        {"type": "set-increase", "activity": "bench", "field": "weight", "add": 5},
    ),
    (
        "set-increase-rate",
        {"type": "set-increase", "activity": "squat", "field": "weight", "rate": 2.5},
    ),
    ("set-parameter", {"type": "set-parameter", "param": "rate", "value": 10}),
    (
        "edit-week",
        {"type": "edit-week", "activity": "plank", "week": 7, "field": "duration", "value": 60},
    ),
]
FROM_DAYS = [0, 1, 4, 5, 12]  # Wed 16 Dec, Thu, Sun, Mon 21 Dec, Mon 28 Dec


def day_view(rp: Replay, day: date) -> object:
    plan = rp.day(day)
    return (plan.status, plan.programme_week, plan.label, day_to_json(plan))


@pytest.mark.parametrize(("name", "body"), PROPERTY_CHANGES, ids=[n for n, _ in PROPERTY_CHANGES])
@pytest.mark.parametrize("days", FROM_DAYS)
def test_no_change_alters_a_day_before_its_from_day(
    name: str, body: dict[str, Any], days: int
) -> None:
    run, log = mockup_run(), mockup_log()
    from_date = TODAY + timedelta(days=days)
    assert check_change(run, log, body, from_date=from_date, today=TODAY) == []
    before = replay(run, log)
    preview = preview_change(
        run, log, body, from_date=from_date, today=TODAY, made_at=datetime(2026, 12, 16, 9, 0)
    )
    after = replay(run, [*log, preview.change])
    day = START
    while day < from_date:
        assert day_view(after, day) == day_view(before, day), day
        day += timedelta(days=1)
    assert all(c.starts >= from_date for c in preview.cells)


@pytest.mark.parametrize("week", range(2, 8))
@pytest.mark.parametrize(
    ("body", "next_value"),
    [
        ({"rate": 15}, lambda v: v * Decimal("1.15")),
        ({"add": 5}, lambda v: v + 5),
        ({"rate": -10}, lambda v: v * Decimal("0.9")),
    ],
    ids=["rate", "add", "lower"],
)
def test_a_new_increase_continues_from_the_value_shown(
    week: int, body: dict[str, Any], next_value: Any
) -> None:
    """Set increase keeps this week's value and applies the new increase from the next week,
    from the value shown, rounded (§7.1). Nothing recomputes from week 1."""
    run = plain_run("ten-kg.json") if week < 5 else plain_run()
    key = "lift" if week < 5 else "bench"
    rp0 = replay(run, [])
    monday = rp0.weeks[week - 1].monday
    from_date = monday + timedelta(days=2)
    shown = Decimal(str(weight(rp0, from_date, key)))
    full = {"type": "set-increase", "activity": key, "field": "weight", **body}
    rp = replay(run, [change(1, from_date, full)])
    assert Decimal(str(weight(rp, from_date, key))) == shown
    if week < run.programme.weeks and week + 1 not in (4, 8):
        step = run.resolved.series[key]["weight"].step
        from tracker_api.programme import round_to_step

        expected = round_to_step(next_value(shown), step)
        assert Decimal(str(weight(rp, monday + timedelta(weeks=1), key))) == expected


@pytest.mark.parametrize("week", range(1, 9))
def test_a_new_value_starts_where_it_is_set_and_keeps_the_increase(week: int) -> None:
    run = plain_run()
    monday = START + timedelta(weeks=week - 1)
    body = {"type": "set-value", "activity": "bench", "field": "weight", "value": 50}
    rp = replay(run, [change(1, monday, body)])
    first = rp.day(monday).activities["bench"]
    assert first.base is not None and first.base["weight"] == 50
    if week < 8:
        nxt = rp.day(monday + timedelta(weeks=1)).activities["bench"]
        assert nxt.base is not None and nxt.base["weight"] == 52.5


@pytest.mark.parametrize("weeks", [1, 2, 3])
@pytest.mark.parametrize("pause_week", [2, 3, 5])
def test_a_pause_then_resume_restores_the_activitys_value(weeks: int, pause_week: int) -> None:
    """A paused activity resumes where it stopped (S4): the value it would have had in the week
    it paused."""
    run = plain_run()
    plain = replay(run, [])
    paused_on = START + timedelta(weeks=pause_week - 1)
    expected = plain.day(paused_on).activities["squat"].base
    body = {"type": "pause-activity", "activity": "squat", "weeks": weeks}
    rp = replay(run, [change(1, paused_on, body)])
    back = rp.day(paused_on + timedelta(weeks=weeks)).activities["squat"]
    assert back.state == "running"
    assert back.activity_week == pause_week
    assert back.base == expected


def test_a_manual_resume_restores_the_value_too() -> None:
    run = plain_run()
    log = [
        change(1, d("2026-12-07"), {"type": "pause-activity", "activity": "row"}),
        change(2, d("2026-12-28"), {"type": "resume-activity", "activity": "row"}),
    ]
    rp = replay(run, log)
    assert rp.day(d("2026-12-28")).activities["row"].activity_week == 3
    assert weight(rp, d("2026-12-28"), "row") == 35


def test_replaying_the_same_log_twice_gives_the_same_weeks() -> None:
    run, log = mockup_run(), mockup_log()
    first, second = replay(run, log), replay(run, log)
    assert first == second
    assert replay(run, list(reversed(log))) == first  # the order is the log's, not the list's
    assert [day_to_json(day) for w in first.weeks for day in w.days] == [
        day_to_json(day) for w in second.weeks for day in w.days
    ]


# ---- §6: clocks ----


def test_before_the_start_and_the_first_week() -> None:
    """A run started on a Wednesday: its first calendar week starts as week 1 on Wednesday."""
    rp = replay(plain_run(start=d("2026-11-25")), [])
    first = rp.weeks[0]
    assert first.monday == d("2026-11-23")
    assert [day.status for day in first.days[:3]] == ["before-start", "before-start", "running"]
    assert first.days[0].programme_week is None
    assert first.days[0].activities["squat"].state == "not-started"
    assert rp.end == d("2027-01-17")


def test_a_programme_pause_moves_every_later_week() -> None:
    run = plain_run()
    log = [change(1, d("2026-12-14"), {"type": "pause-programme", "weeks": 2}, "Flu")]
    rp = replay(run, log)
    paused = rp.day(d("2026-12-20"))
    assert (paused.status, paused.programme_week, paused.until, paused.reason) == (
        "paused",
        4,
        d("2026-12-28"),
        "Flu",
    )
    assert paused.activities["squat"].state == "paused"
    resumed = rp.day(d("2026-12-28"))
    assert (resumed.status, resumed.programme_week) == ("running", 4)
    assert rp.end == d("2027-01-31")
    assert weight(rp, d("2026-12-28"), "squat") == 42.5  # week 4, a deload


@pytest.mark.parametrize(("at", "week"), [("paused", 4), ("next", 5)])
def test_resume_at_the_paused_week_or_the_next(at: str, week: int) -> None:
    run = plain_run()
    log = [
        change(1, d("2026-12-16"), {"type": "pause-programme"}),
        change(2, d("2027-01-04"), {"type": "resume-programme", "at": at}),
    ]
    rp = replay(run, log)
    assert rp.day(d("2027-01-04")).programme_week == week
    assert rp.day(d("2027-01-11")).programme_week == week + 1
    assert rp.day(d("2027-01-04")).activities["squat"].activity_week == week


def test_resume_defaults_to_the_paused_week() -> None:
    log = [
        change(1, d("2026-12-16"), {"type": "pause-programme"}),
        change(2, d("2027-01-04"), {"type": "resume-programme"}),
    ]
    assert replay(plain_run(), log).day(d("2027-01-04")).programme_week == 4


def test_going_to_a_week_mid_week_splits_it() -> None:
    """Going to week 5 on a Wednesday makes Wednesday to Sunday week 5 and the next Monday
    week 6 (§6.2)."""
    rp = replay(plain_run(), [change(1, d("2026-12-16"), {"type": "go-to-week", "week": 5})])
    week = rp.week(d("2026-12-14"))
    assert [day.programme_week for day in week.days] == [4, 4, 5, 5, 5, 5, 5]
    assert week.programme_weeks == (4, 5)
    assert rp.day(d("2026-12-21")).programme_week == 6
    assert rp.end == d("2027-01-10")


def test_going_back_moves_running_activities_and_leaves_a_paused_one() -> None:
    log = [
        change(1, d("2026-12-14"), {"type": "pause-activity", "activity": "deadlift"}),
        change(2, d("2026-12-21"), {"type": "go-to-week", "week": 2}),
        change(3, d("2027-01-04"), {"type": "resume-activity", "activity": "deadlift"}),
    ]
    rp = replay(plain_run(), log)
    assert rp.day(d("2026-12-21")).activities["squat"].activity_week == 2
    assert rp.day(d("2026-12-21")).activities["deadlift"].activity_week == 4
    assert rp.day(d("2027-01-04")).activities["deadlift"].activity_week == 4
    assert rp.day(d("2027-01-04")).programme_week == 4


def test_an_activity_added_mid_run_starts_at_its_own_week_1() -> None:
    body = {
        "type": "add-activity",
        "activity": {"key": "dips", "name": "Dips", "sets": 3, "reps": {"start": 6, "add": 1}},
    }
    rp = replay(plain_run(), [change(1, d("2026-12-16"), body)])
    assert "dips" not in rp.day(d("2026-12-15")).activities  # no trace before its day (P1)
    first = rp.day(d("2026-12-16")).activities["dips"]
    assert (first.state, first.activity_week, first.values) == (
        "running",
        1,
        {"target": 3, "sets": 3, "reps": 6},
    )
    assert rp.day(d("2026-12-21")).activities["dips"].values == {"target": 3, "sets": 3, "reps": 7}
    assert [a.key for a in rp.activities][-1] == "dips"
    assert rp.activities[-1].added_by == 1
    assert ("dips", 5, 8) in [(e.key, e.week, e.of) for e in rp.ends_short]


def test_an_added_activity_is_not_in_a_week_before_its_own_week_1() -> None:
    body = {"type": "add-activity", "activity": {"key": "dips", "name": "Dips", "reps": 8}}
    log = [
        change(1, d("2026-12-21"), body),
        change(2, d("2026-12-28"), {"type": "go-to-week", "week": 3}),
    ]
    rp = replay(plain_run(), log)
    assert rp.day(d("2026-12-28")).activities["dips"].state == "not-started"
    assert rp.day(d("2027-01-11")).activities["dips"].activity_week == 1


def test_an_added_activity_uses_the_runs_parameters() -> None:
    body = {
        "type": "add-activity",
        "activity": {
            "key": "front",
            "name": "Front squat",
            "weight": {"start": "$squat", "add": 2.5},
        },
    }
    run = start_run(parse_programme(load("valid/beginner-5x5.json")), {"squat": 50}, START)
    assert weight(replay(run, [change(1, START, body)]), START, "front") == 50


def test_a_mid_week_resume_comes_back_at_the_next_week_too() -> None:
    """Decision: an activity's week counts the programme weeks it ran in, so a Wednesday resume
    gives the value a Monday resume would (75 kg), not the week it last ran (70 kg)."""
    log = [
        change(1, d("2026-12-14"), {"type": "pause-activity", "activity": "deadlift"}),
        change(2, d("2026-12-30"), {"type": "resume-activity", "activity": "deadlift"}),
    ]
    rp = replay(plain_run(), log)
    back = rp.day(d("2026-12-30")).activities["deadlift"]
    assert (back.activity_week, back.values and back.values["weight"]) == (4, 75)
    assert rp.day(d("2027-01-04")).activities["deadlift"].activity_week == 5


def test_a_pause_inside_one_week_keeps_the_week() -> None:
    log = [
        change(1, d("2026-12-15"), {"type": "pause-activity", "activity": "squat"}),
        change(2, d("2026-12-17"), {"type": "resume-activity", "activity": "squat"}),
    ]
    rp = replay(plain_run(), log)
    assert rp.day(d("2026-12-17")).activities["squat"].activity_week == 4
    assert rp.day(d("2026-12-16")).activities["squat"].state == "paused"
    assert rp.day(d("2026-12-21")).activities["squat"].activity_week == 5


def test_a_mid_week_pause_comes_back_at_the_next_week() -> None:
    log = [change(1, d("2026-12-16"), {"type": "pause-activity", "activity": "row", "weeks": 2})]
    rp = replay(plain_run(), log)
    assert rp.day(d("2026-12-30")).activities["row"].activity_week == 5
    assert rp.day(d("2027-01-04")).activities["row"].activity_week == 6


def test_an_open_pause_writes_paused_weeks_to_the_runs_last_week() -> None:
    rp = replay(plain_run(), [change(1, d("2026-12-16"), {"type": "pause-programme"}, "Away")])
    assert rp.end is None
    assert rp.weeks[-1].monday == d("2027-01-11")
    assert rp.day(d("2027-01-17")).status == "paused"
    assert rp.open_pause is not None
    assert (rp.open_pause.since, rp.open_pause.programme_week, rp.open_pause.reason) == (
        d("2026-12-16"),
        4,
        "Away",
    )
    assert rp.week(d("2026-12-21")).programme_weeks == (4,)  # paused all week
    resumed = [(w.programme_week, w.activities["squat"].values) for w in rp.when_resumed]
    assert [n for n, _ in resumed] == [4, 5, 6, 7, 8]
    assert resumed[0][1] == {"target": 3, "sets": 3, "reps": 5, "weight": 42.5}
    assert resumed[1][1] == {"target": 3, "sets": 5, "reps": 5, "weight": 47.5}


def test_an_activity_paused_at_the_end_ends_short() -> None:
    log = [change(1, d("2026-12-21"), {"type": "pause-activity", "activity": "plank"})]
    rp = replay(plain_run(), log)
    assert [(e.key, e.week, e.message) for e in rp.ends_short] == [
        ("plank", 4, "Plank ends at its week 4 of 8.")
    ]


# ---- §7: values, increases and parameters ----


def test_a_new_segment_keeps_the_activitys_increase_weeks() -> None:
    """The lead's call (plan §8.1): with every 2, increases stay on activity weeks 1, 3, 5, 7
    after a change in week 2. The counter doesn't restart at the change."""
    series = Series(start=Decimal(40), add=Decimal(5), every=2, step=Decimal(5), origin=2)
    assert [series.value(n) for n in (2, 3, 4, 5)] == [40, 45, 45, 50]
    body = {"type": "set-value", "activity": "plank", "field": "duration", "value": 50}
    rp = replay(plain_run(), [change(1, d("2026-11-30"), body)])
    durations = [
        w.days[6].activities["plank"].values["duration"]  # type: ignore[index]
        for w in rp.weeks
    ]
    assert durations == [30, 50, 55, 55, 60, 60, 65, 65]


def test_a_new_increase_in_a_deload_week_continues_from_the_rule_not_the_deload() -> None:
    """The value shown is the rule's: an override doesn't bend the series (§3.3)."""
    body = {"type": "set-increase", "activity": "bench", "field": "weight", "add": 5}
    rp = replay(plain_run(), [change(1, d("2026-12-16"), body)])
    assert weight(rp, d("2026-12-16"), "bench") == 35  # the deload's 37.5 x 0.9
    assert weight(rp, d("2026-12-21"), "bench") == 42.5  # 37.5 + 5


def test_a_new_increase_on_a_bare_value_keeps_its_precision() -> None:
    """Decision: the step stays the field's own, so this week's value can't move (P3)."""
    doc = load("valid/minimal.json")
    doc["weeks"] = 3
    doc["activities"][0] |= {"weight": 41.3}
    run = start_run(parse_programme(doc), {}, START)
    body = {"type": "set-increase", "activity": "push-ups", "field": "weight", "rate": 10}
    rp = replay(run, [change(1, d("2026-11-30"), body)])
    weights = [
        w.days[6].activities["push-ups"].values["weight"]  # type: ignore[index]
        for w in rp.weeks
    ]
    assert weights == [41.3, 41.3, 45.43]
    body = {"type": "set-increase", "activity": "push-ups", "field": "reps", "add": 2}
    rp = replay(run, [change(1, d("2026-11-30"), body)])
    assert [
        w.days[6].activities["push-ups"].values["reps"]  # type: ignore[index]
        for w in rp.weeks
    ] == [12, 12, 14]


def test_a_later_dated_change_still_happens_on_its_day() -> None:
    """Changes take effect on their from days, in order: a change made later but dated earlier
    doesn't cancel one already scheduled."""
    log = [
        change(
            1,
            d("2026-12-28"),
            {"type": "set-value", "activity": "row", "field": "weight", "value": 50},
        ),
        change(
            2,
            d("2026-12-21"),
            {"type": "set-value", "activity": "row", "field": "weight", "value": 45},
        ),
    ]
    rp = replay(plain_run(), log)
    assert weight(rp, d("2026-12-21"), "row") == 45
    assert weight(rp, d("2026-12-28"), "row") == 50


def test_going_back_after_a_new_value_replays_the_earlier_weeks() -> None:
    log = [
        change(
            1,
            d("2026-12-21"),
            {"type": "set-value", "activity": "row", "field": "weight", "value": 50},
        ),
        change(2, d("2026-12-28"), {"type": "go-to-week", "week": 3}),
    ]
    rp = replay(plain_run(), log)
    assert weight(rp, d("2026-12-28"), "row") == 35  # week 3 as the programme had it
    assert weight(rp, d("2027-01-11"), "row") == 50  # week 5 again, at the value set for it


def test_set_parameter_acts_as_set_value_or_set_increase() -> None:
    run = start_run(parse_programme(load("valid/beginner-5x5.json")), {}, START)
    start_change = change(
        1, d("2026-12-16"), {"type": "set-parameter", "param": "squat", "value": 60}
    )
    rp = replay(run, [start_change])
    assert rp.day(d("2026-12-16")).activities["squat"].base == {
        "target": 3,
        "sets": 5,
        "reps": 5,
        "weight": 60,
    }
    assert weight(rp, d("2026-12-21"), "squat") == 62.5  # 63, at 5% a week
    rate = change(1, d("2026-12-16"), {"type": "set-parameter", "param": "rate", "value": 10})
    rp = replay(run, [rate])
    # The rule's week 4 (46.305, shown 47.5) is kept; week 5 is 47.5 x 1.1 = 52.25.
    assert rp.day(d("2026-12-16")).activities["squat"].base == {
        "target": 3,
        "sets": 5,
        "reps": 5,
        "weight": 47.5,
    }
    assert weight(rp, d("2026-12-21"), "squat") == 52.5
    assert rp.params == {"squat": Decimal(40), "rate": Decimal(10)}


def test_set_parameter_sets_start_and_increase_together() -> None:
    doc = load("valid/beginner-5x5.json")
    doc["params"]["x"] = {"label": "Both", "unit": "kg", "default": 2.5}
    doc["activities"][1]["weight"] = {"start": "$x", "add": "$x", "step": 2.5}
    run = start_run(parse_programme(doc), {"x": 20}, START)
    rp = replay(
        run, [change(1, d("2026-12-21"), {"type": "set-parameter", "param": "x", "value": 5})]
    )
    assert weight(rp, d("2026-12-21"), "bench") == 5
    assert weight(rp, d("2026-12-28"), "bench") == 10


def test_resume_activity_at_a_new_value() -> None:
    log = [
        change(1, d("2026-12-14"), {"type": "pause-activity", "activity": "deadlift"}),
        change(
            2,
            d("2026-12-28"),
            {"type": "resume-activity", "activity": "deadlift", "values": {"weight": 70}},
        ),
    ]
    rp = replay(plain_run(), log)
    assert weight(rp, d("2026-12-28"), "deadlift") == 70
    assert weight(rp, d("2027-01-04"), "deadlift") == 75


def test_end_activity_keeps_its_past_and_stops_from_the_day() -> None:
    rp = replay(
        plain_run(), [change(1, d("2026-12-16"), {"type": "end-activity", "activity": "plank"})]
    )
    assert rp.day(d("2026-12-15")).activities["plank"].state == "running"
    assert rp.day(d("2026-12-16")).activities["plank"].state == "ended"
    plank = next(a for a in rp.activities if a.key == "plank")
    assert (plank.ended_on, plank.deleted) == (d("2026-12-16"), False)
    assert all(e.key != "plank" for e in rp.ends_short)


@pytest.mark.parametrize("ended_on", ["2026-11-23", "2026-12-21"])
def test_end_activity_with_no_days_before_deletes_it(ended_on: str) -> None:
    add = {"type": "add-activity", "activity": {"key": "dips", "name": "Dips", "reps": 8}}
    log = [change(1, d("2026-12-21"), add)] if ended_on != "2026-11-23" else []
    target = "dips" if log else "plank"
    log.append(change(2, d(ended_on), {"type": "end-activity", "activity": target}))
    rp = replay(plain_run(), log)
    gone = next(a for a in rp.activities if a.key == target)
    assert gone.deleted
    assert all(target not in day.activities for w in rp.weeks for day in w.days)


# ---- §7.2: hand-edits ----


def test_a_hand_edit_moves_with_its_programme_week() -> None:
    log = [
        change(
            1,
            d("2026-12-12"),
            {"type": "edit-week", "activity": "row", "week": 6, "field": "weight", "value": 35},
        ),
        change(2, d("2026-12-14"), {"type": "pause-programme", "weeks": 1}),
    ]
    rp = replay(plain_run(), log)
    assert weight(rp, d("2026-12-28"), "row") == 40  # week 5 now
    assert weight(rp, d("2027-01-04"), "row") == 35  # week 6
    mark = rp.day(d("2027-01-04")).activities["row"].hand["weight"]
    assert (mark.seq, mark.made_on, mark.rule) == (1, d("2026-12-12"), 42.5)


def test_a_hand_edit_of_this_week_changes_today_on() -> None:
    body = {"type": "edit-week", "activity": "squat", "week": 4, "field": "reps", "value": 3}
    rp = replay(plain_run(), [change(1, TODAY, body)])
    assert rp.day(d("2026-12-15")).activities["squat"].values["reps"] == 5  # type: ignore[index]
    assert rp.day(TODAY).activities["squat"].values["reps"] == 3  # type: ignore[index]
    assert rp.day(d("2026-12-21")).activities["squat"].values["reps"] == 5  # type: ignore[index]


def test_a_later_hand_edit_of_the_same_cell_wins() -> None:
    body = {"type": "edit-week", "activity": "row", "week": 6, "field": "weight"}
    log = [change(1, TODAY, body | {"value": 35}), change(2, TODAY, body | {"value": 37.5})]
    assert weight(replay(plain_run(), log), d("2026-12-28"), "row") == 37.5


def test_a_dropped_hand_edit_stops_applying() -> None:
    log = [
        *mockup_log(),
        change(
            5,
            d("2026-12-21"),
            {
                "type": "set-value",
                "activity": "row",
                "field": "weight",
                "value": 45,
                "dropHandEdits": [3],
            },
        ),
    ]
    rp = replay(mockup_run(), log)
    assert weight(rp, d("2026-12-28"), "row") == 47.5
    assert rp.day(d("2026-12-28")).activities["row"].hand == {}
    edit = next(h for h in rp.hand_edits if h.seq == 3)
    assert edit.dropped_on == d("2026-12-21")


# ---- Undo ----


def test_undo_reverses_one_change() -> None:
    log = [*mockup_log(), change(5, TODAY, {"type": "undo", "change": 4})]
    rp = replay(mockup_run(), log)
    assert rp.day(d("2026-12-21")).activities["deadlift"].state == "running"
    assert rp.undone == {4: 5}
    assert rp.ends_short == ()


def test_the_undone_by_marker_alone_also_undoes() -> None:
    log = mockup_log()
    log[3] = Change(
        seq=4, from_date=log[3].from_date, made_at=log[3].made_at, body=log[3].body, undone_by=9
    )
    assert replay(mockup_run(), log).undone == {4: 9}


def test_undo_restores_a_dropped_hand_edit() -> None:
    log = [
        *mockup_log(),
        change(
            5,
            d("2026-12-21"),
            {
                "type": "set-value",
                "activity": "row",
                "field": "weight",
                "value": 45,
                "dropHandEdits": [3],
            },
        ),
        change(6, TODAY, {"type": "undo", "change": 5}),
    ]
    assert weight(replay(mockup_run(), log), d("2026-12-28"), "row") == 35


def test_a_change_that_no_longer_applies_does_nothing() -> None:
    """Undoing a pause leaves its resume with nothing to resume."""
    log = [
        change(1, d("2026-12-21"), {"type": "pause-activity", "activity": "row"}),
        change(
            2,
            d("2027-01-04"),
            {"type": "resume-activity", "activity": "row", "values": {"weight": 20}},
        ),
        change(3, TODAY, {"type": "undo", "change": 1}),
    ]
    rp = replay(plain_run(), log)
    assert rp.weeks == replay(plain_run(), []).weeks
    assert rp.undone == {1: 3}


def test_undo_never_alters_a_day_before_its_target_starts() -> None:
    run = mockup_run()
    target = change(5, d("2026-12-21"), {"type": "go-to-week", "week": 7})
    log = [*mockup_log(), target]
    preview = preview_change(
        run,
        log,
        {"type": "undo", "change": 5},
        from_date=TODAY,
        today=TODAY,
        made_at=datetime(2026, 12, 16),
    )
    before, after = replay(run, log), replay(run, [*log, preview.change])
    day = START
    while day < target.from_date:
        assert day_view(after, day) == day_view(before, day), day
        day += timedelta(days=1)
    assert after.undone == {5: 6}


# ---- §8: sealed days ----


def test_a_sealed_day_is_shown_as_sealed() -> None:
    run, log = mockup_run(), mockup_log()
    plain = replay(run, log)
    sealed_day = plain.day(d("2026-12-14"))
    altered = day_from_json(day_to_json(sealed_day) | {"label": "Recorded"})
    rp = replay(run, log, sealed={altered.date: altered})
    assert rp.day(d("2026-12-14")).label == "Recorded"
    assert rp.day(d("2026-12-14")).sealed
    assert not rp.day(d("2026-12-15")).sealed


def test_a_new_increase_continues_from_the_sealed_value() -> None:
    """The replay never reads its own output for a sealed day (P1): an increase changed on a
    sealed day continues from the value the sealed record shows."""
    run, log = mockup_run(), mockup_log()
    plain = replay(run, log)
    record = day_to_json(plain.day(d("2026-12-03")))
    record["activities"]["squat"]["base"]["weight"] = 50
    sealed = day_from_json(record)
    rp = replay(run, log, sealed={sealed.date: sealed})
    assert weight(rp, d("2026-12-07"), "squat") == 55  # 50 x 1.075 = 53.75, halves up


def test_a_day_round_trips_through_json() -> None:
    rp = replay(mockup_run(), mockup_log())
    for week in rp.weeks:
        for day in week.days:
            assert day_from_json(json.loads(json.dumps(day_to_json(day)))) == day


# ---- Checking a change ----

ROW = {"type": "set-value", "activity": "row", "field": "weight"}
CHECKS: list[tuple[str, object, str, list[tuple[str, str]]]] = [
    ("not-an-object", [], "2026-12-16", [("", "a change is a JSON object.")]),
    ("no-type", {}, "2026-12-16", [("type", "give one of " + ", ".join(CHANGE_TYPES) + ".")]),
    ("yesterday", ROW | {"value": 45}, "2026-12-15", [("from", "a change starts today or later.")]),
    (
        "after-the-end",
        ROW | {"value": 45},
        "2027-01-18",
        [("from", "the programme has ended by then.")],
    ),
    (
        "unknown-key",
        ROW | {"value": 45, "colour": "red"},
        "2026-12-16",
        [("colour", "this key is not part of the change.")],
    ),
    (
        "unknown-activity",
        {"type": "set-value", "activity": "lunge", "field": "weight", "value": 45},
        "2026-12-16",
        [("activity", "there is no activity called lunge.")],
    ),
    (
        "field-the-kind-lacks",
        {"type": "set-value", "activity": "row", "field": "distance", "value": 4},
        "2026-12-16",
        [("field", "a strength activity has no distance.")],
    ),
    (
        "field-the-activity-lacks",
        {"type": "set-value", "activity": "plank", "field": "weight", "value": 4},
        "2026-12-16",
        [("field", "plank has no weight.")],
    ),
    (
        "field-unknown",
        {"type": "set-value", "activity": "plank", "field": "tempo", "value": 4},
        "2026-12-16",
        [("field", "give one of target, sets, reps, duration, weight.")],
    ),
    (
        "value-over-the-cap",
        ROW | {"value": 501},
        "2026-12-16",
        [("value", "give a number above 0 and at most 500.")],
    ),
    ("value-missing", ROW, "2026-12-16", [("value", "give a number above 0 and at most 500.")]),
    (
        "sets-fraction",
        {"type": "set-value", "activity": "row", "field": "sets", "value": 2.5},
        "2026-12-16",
        [("value", "give a whole number from 1 to 20.")],
    ),
    (
        "value-runs-past-the-cap",
        ROW | {"value": 497.5},
        "2026-12-21",
        [("value", "week 7 comes to 502.5 kg. The most is 500.")],
    ),
    (
        "value-off-the-step",
        ROW | {"value": 41},
        "2026-12-21",
        [("value", "the weight goes in steps of 2.5, so give a multiple of 2.5.")],
    ),
    (
        "increase-both",
        {"type": "set-increase", "activity": "row", "field": "weight", "add": 5, "rate": 5},
        "2026-12-16",
        [("rate", "a progression has add or rate, not both.")],
    ),
    (
        "increase-neither",
        {"type": "set-increase", "activity": "row", "field": "weight"},
        "2026-12-16",
        [("add", "give add or rate.")],
    ),
    (
        "increase-add-too-big",
        {"type": "set-increase", "activity": "row", "field": "weight", "add": 600},
        "2026-12-16",
        [("add", "give a number from -500 to 500.")],
    ),
    (
        "increase-rate",
        {"type": "set-increase", "activity": "row", "field": "weight", "rate": -100},
        "2026-12-16",
        [("rate", "give a number above -100 and at most 1,000.")],
    ),
    (
        "increase-runs-past-the-cap",
        {"type": "set-increase", "activity": "squat", "field": "weight", "rate": 200},
        "2026-12-16",
        [("rate", "week 7 comes to 1,350 kg. The most is 500.")],
    ),
    (
        "pause-weeks",
        {"type": "pause-programme", "weeks": 0},
        "2026-12-16",
        [("weeks", "give a whole number of weeks from 1 to 52.")],
    ),
    (
        "go-to-week-range",
        {"type": "go-to-week", "week": 9},
        "2026-12-16",
        [("week", "give a week from 1 to 8.")],
    ),
    (
        "resume-at",
        {"type": "resume-programme", "at": "later"},
        "2026-12-16",
        [("at", 'give "paused" or "next".'), ("", "the programme isn't paused on Wed 16 Dec.")],
    ),
    (
        "resume-not-paused",
        {"type": "resume-programme"},
        "2026-12-16",
        [("", "the programme isn't paused on Wed 16 Dec.")],
    ),
    (
        "pause-activity-paused",
        {"type": "pause-activity", "activity": "deadlift"},
        "2026-12-16",
        [("activity", "deadlift is already paused on Wed 16 Dec.")],
    ),
    (
        "resume-activity-running",
        {"type": "resume-activity", "activity": "squat"},
        "2026-12-16",
        [("activity", "squat isn't paused on Wed 16 Dec.")],
    ),
    (
        "resume-activity-values",
        {"type": "resume-activity", "activity": "deadlift", "values": {"weight": 0, "distance": 3}},
        "2026-12-16",
        [
            ("values.distance", "a strength activity has no distance."),
            ("values.weight", "give a number above 0 and at most 500."),
        ],
    ),
    (
        "resume-activity-values-not-an-object",
        {"type": "resume-activity", "activity": "deadlift", "values": 70},
        "2026-12-16",
        [("values", 'give the fields it resumes at, such as {"weight": 70}.')],
    ),
    (
        "add-activity-key-taken",
        {"type": "add-activity", "activity": {"key": "row", "name": "Row"}},
        "2026-12-16",
        [("activity.key", "row is already an activity of this run.")],
    ),
    (
        "add-activity-invalid",
        {
            "type": "add-activity",
            "activity": {"key": "dips", "name": "Dips", "weight": "$nope", "distance": 3},
        },
        "2026-12-16",
        [
            ("activity.distance", "a strength activity has no distance."),
            ("activity.weight", "there is no parameter called nope."),
        ],
    ),
    (
        "add-activity-not-an-object",
        {"type": "add-activity", "activity": 3},
        "2026-12-16",
        [("activity", "give an activity as an object.")],
    ),
    (
        "end-activity-ended",
        {"type": "end-activity", "activity": "plank"},
        "2026-12-23",
        [("activity", "plank has ended by Wed 23 Dec.")],
    ),
    (
        "activity-not-text",
        {"type": "end-activity", "activity": 3},
        "2026-12-16",
        [("activity", "there is no activity called 3.")],
    ),
    (
        "set-parameter-unknown",
        {"type": "set-parameter", "param": "bench", "value": 3},
        "2026-12-16",
        [("param", "the programme has no parameter called bench.")],
    ),
    (
        "set-parameter-max",
        {"type": "set-parameter", "param": "rate", "value": 30},
        "2026-12-16",
        [("value", "the most it can be is 20.")],
    ),
    (
        "edit-week-past",
        {"type": "edit-week", "activity": "row", "week": 2, "field": "weight", "value": 30},
        "2026-12-16",
        [("week", "week 2 has no days left to change.")],
    ),
    (
        "edit-week-range",
        {"type": "edit-week", "activity": "row", "week": 0, "field": "weight", "value": 30},
        "2026-12-16",
        [("week", "give a week from 1 to 8.")],
    ),
    (
        "undo-unknown",
        {"type": "undo", "change": 99},
        "2026-12-16",
        [("change", "give the number of a change in the log.")],
    ),
    (
        "undo-started-before-today",
        {"type": "undo", "change": 2},
        "2026-12-16",
        [("change", "change 2 started on Wed 9 Dec, before today, so it can't be undone.")],
    ),
    (
        "drop-not-a-hand-edit",
        ROW | {"value": 45, "dropHandEdits": [2]},
        "2026-12-21",
        [("dropHandEdits[0]", "change 2 isn't a hand-edit that still applies.")],
    ),
    (
        "drop-not-a-number",
        ROW | {"value": 45, "dropHandEdits": [[1], {"seq": 1}, True]},
        "2026-12-21",
        [
            ("dropHandEdits[0]", "give a hand-edit by its change number."),
            ("dropHandEdits[1]", "give a hand-edit by its change number."),
            ("dropHandEdits[2]", "give a hand-edit by its change number."),
        ],
    ),
    (
        "drop-on-a-pause",
        {"type": "pause-programme", "dropHandEdits": [3]},
        "2026-12-21",
        [("dropHandEdits", "this key is not part of the change.")],
    ),
    (
        "before-the-start",
        {"type": "go-to-week", "week": 2},
        "2026-11-20",
        [("from", "the programme starts on Mon 23 Nov.")],
    ),
]


@pytest.mark.parametrize(("name", "body", "from_day", "errors"), CHECKS, ids=[c[0] for c in CHECKS])
def test_a_change_is_checked_against_the_run(
    name: str, body: object, from_day: str, errors: list[tuple[str, str]]
) -> None:
    run, log = mockup_run(), mockup_log()
    if name == "end-activity-ended":
        log.append(change(5, d("2026-12-21"), {"type": "end-activity", "activity": "plank"}))
    today = d("2026-11-18") if name == "before-the-start" else TODAY
    got = check_change(run, log, body, from_date=d(from_day), today=today)
    assert sorted((e.path, e.message) for e in got) == sorted(errors)
    if errors:
        with pytest.raises(ProgrammeInvalid):
            preview_change(
                run, log, body, from_date=d(from_day), today=today, made_at=datetime(2026, 12, 16)
            )


def test_undo_of_an_undo_or_an_undone_change_is_refused() -> None:
    run = mockup_run()
    log = [
        *mockup_log(),
        change(5, TODAY, {"type": "pause-programme"}),
        change(6, TODAY, {"type": "undo", "change": 5}),
    ]
    assert [
        str(e)
        for e in check_change(run, log, {"type": "undo", "change": 6}, from_date=TODAY, today=TODAY)
    ] == ["change: change 6 is an undo. Make the change again instead."]
    assert [
        str(e)
        for e in check_change(run, log, {"type": "undo", "change": 5}, from_date=TODAY, today=TODAY)
    ] == ["change: change 5 is already undone."]


def test_go_to_week_while_paused_is_refused() -> None:
    log = [*mockup_log(), change(5, TODAY, {"type": "pause-programme"})]
    errors = check_change(
        mockup_run(), log, {"type": "go-to-week", "week": 2}, from_date=TODAY, today=TODAY
    )
    assert [str(e) for e in errors] == ["the programme is paused on Wed 16 Dec. Resume it first."]
    errors = check_change(
        mockup_run(), log, {"type": "pause-programme"}, from_date=TODAY, today=TODAY
    )
    assert [str(e) for e in errors] == ["the programme is already paused on Wed 16 Dec."]
    errors = check_change(
        mockup_run(), log, {"type": "resume-programme", "at": "next"}, from_date=TODAY, today=TODAY
    )
    assert errors == []


def test_resume_next_from_the_last_week_is_refused() -> None:
    log = [change(1, d("2027-01-13"), {"type": "pause-programme"})]
    errors = check_change(
        plain_run(),
        log,
        {"type": "resume-programme", "at": "next"},
        from_date=d("2027-01-20"),
        today=d("2027-01-13"),
    )
    assert [str(e) for e in errors] == ["at: week 8 is the last week."]


def test_set_value_on_an_activity_that_hasnt_started_is_refused() -> None:
    add = {"type": "add-activity", "activity": {"key": "dips", "name": "Dips", "reps": 8}}
    log = [change(1, d("2026-12-28"), add)]
    errors = check_change(
        plain_run(),
        log,
        {"type": "set-value", "activity": "dips", "field": "reps", "value": 10},
        from_date=d("2026-12-21"),
        today=TODAY,
    )
    assert [str(e) for e in errors] == ["activity: there is no activity called dips."]
    log.append(change(2, d("2027-01-04"), {"type": "go-to-week", "week": 2}))
    errors = check_change(
        plain_run(),
        log,
        {"type": "set-value", "activity": "dips", "field": "reps", "value": 10},
        from_date=d("2027-01-05"),
        today=TODAY,
    )
    assert [str(e) for e in errors] == ["activity: dips hasn't started by Tue 5 Jan."]


def test_a_preview_names_an_activity_that_would_be_deleted() -> None:
    add = {"type": "add-activity", "activity": {"key": "dips", "name": "Dips", "reps": 8}}
    log = [change(1, d("2026-12-28"), add)]
    preview = preview_change(
        plain_run(),
        log,
        {"type": "end-activity", "activity": "dips"},
        from_date=d("2026-12-28"),
        today=TODAY,
        made_at=datetime(2026, 12, 16),
    )
    assert preview.deletes == "dips"
    preview = preview_change(
        plain_run(),
        log,
        {"type": "end-activity", "activity": "squat"},
        from_date=d("2026-12-28"),
        today=TODAY,
        made_at=datetime(2026, 12, 16),
    )
    assert preview.deletes is None


def test_a_preview_of_an_undo_names_its_target() -> None:
    log = [*mockup_log(), change(5, d("2026-12-21"), {"type": "pause-programme"})]
    preview = preview_change(
        mockup_run(),
        log,
        {"type": "undo", "change": 5},
        from_date=TODAY,
        today=TODAY,
        made_at=datetime(2026, 12, 16),
        reason="Better",
    )
    assert preview.undoes == 5
    assert preview.change.reason == "Better"
    states = [(c.monday, c.key, c.before, c.after) for c in preview.cells if c.field is None]
    assert (d("2026-12-21"), "squat", "paused", "running") in states
    assert all(c.starts >= d("2026-12-21") for c in preview.cells)


# ---- The revision token ----


def test_the_revision_changes_with_the_log_and_only_with_it() -> None:
    log = mockup_log()
    assert rev_of(log) == rev_of(list(reversed(log)))
    assert rev_of(log) != rev_of(log[:3])
    assert rev_of([]) != rev_of(log)
    assert len(rev_of(log)) == 16
    edited = [
        *log[:3],
        Change(
            seq=4,
            from_date=log[3].from_date,
            made_at=log[3].made_at,
            body={**log[3].body, "weeks": 3},
            reason="Knee",
        ),
    ]
    assert rev_of(edited) != rev_of(log)


def test_the_confirm_token_covers_the_log_and_the_change() -> None:
    """A preview's token is the log's rev and exactly what the confirm appends: its body
    (dropHandEdits included), from day and reason; never seq or made_at."""
    log = mockup_log()
    base = Change(
        seq=5,
        from_date=d("2026-12-21"),
        made_at=datetime(2026, 12, 16, 12, 0),
        body=ROW | {"value": 45},
        reason="Easy",
    )
    token = confirm_token(rev_of(log), base)
    assert len(token) == 16
    assert token != rev_of(log)
    # The same change made later, or with its keys in another order, has the same token.
    later = replace(base, made_at=datetime(2026, 12, 16, 13, 0), seq=6)
    assert confirm_token(rev_of(log), later) == token
    reordered = replace(base, body=dict(reversed(list(base.body.items()))))
    assert confirm_token(rev_of(log), reordered) == token
    for other in (
        replace(base, body=ROW | {"value": 50}),
        replace(base, body=ROW | {"value": 45, "dropHandEdits": [2]}),
        replace(base, from_date=d("2026-12-22")),
        replace(base, reason=None),
        replace(base, reason="Hard"),
    ):
        assert confirm_token(rev_of(log), other) != token
    assert confirm_token(rev_of(log[:3]), base) != token
    preview = preview_change(
        mockup_run(),
        log,
        base.body,
        from_date=base.from_date,
        today=TODAY,
        made_at=base.made_at,
        reason="Easy",
    )
    assert (preview.rev, preview.token) == (rev_of(log), token)


# ---- Plan items for W4 ----


def running_at(target: int) -> ActivityDay:
    return ActivityDay(state="running", activity_week=1, values={"target": target, "reps": 5})


PAUSED = ActivityDay(state="paused", activity_week=2, values={"target": 3, "reps": 5})


@pytest.mark.parametrize(
    ("days", "goal"),
    [
        # John's squat (K163): 3 a week, run Monday and Tuesday, paused from Wednesday.
        ([running_at(3)] * 2 + [PAUSED] * 5, 1),
        # A Thursday start at 3: Monday to Wednesday come before the run.
        ([ActivityDay(state="not-started")] * 3 + [running_at(3)] * 4, 2),
        # One target all week keeps it.
        ([running_at(3)] * 7, 3),
        ([running_at(7)] * 7, 7),
        ([running_at(1)] * 7, 1),
        # A target that changes in the week counts each day's.
        ([running_at(3)] * 2 + [running_at(5)] * 5, 5),
        ([running_at(5)] * 2 + [running_at(2)] * 5, 3),
        # Ended from Wednesday; a day left out (after End programme) counts 0 too.
        ([running_at(3)] * 2 + [ActivityDay(state="ended")] * 5, 1),
        ([running_at(4)] * 2, 2),
        # Not running at all, and a single day at 1.
        ([PAUSED] * 7, 0),
        ([], 0),
        ([running_at(1)] + [PAUSED] * 6, 1),
        # A running day without values (none the replay gives) counts 0.
        ([ActivityDay(state="running")] * 7, 0),
    ],
)
def test_a_weeks_goal_is_its_running_days_targets_over_7_rounded_up(
    days: list[ActivityDay], goal: int
) -> None:
    assert week_goal(days) == goal


def test_week_items_use_sundays_values_and_the_ids_given() -> None:
    rp = replay(mockup_run(), mockup_log())
    ids = {a.key: f"id-{a.key}" for a in rp.activities}
    items = week_items(rp, rp.week(d("2026-12-07")), ids)
    bench = next(i for i in items if i["id"] == "id-bench")
    # A pin: the bench's weight changed on Wednesday, but its target was 3 all week, so it stays 3.
    assert bench == {
        "id": "id-bench",
        "name": "Bench press",
        "sets": 5,
        "reps": 5,
        "weight": 32.5,
        "target": 3,
    }
    assert [i["id"] for i in items] == [
        f"id-{k}" for k in ("squat", "bench", "row", "deadlift", "plank")
    ]
    assert {i["target"] for i in items} == {3}
    paused = next(
        i for i in week_items(rp, rp.week(d("2026-12-14")), ids) if i["id"] == "id-deadlift"
    )
    assert paused["target"] == 0
    assert validate.normalise_exercise(bench) == bench


def test_a_split_weeks_goal_counts_the_days_the_activity_ran() -> None:
    """John's squat (K163): 3 a week, paused from Wednesday. Its goal is 3 x 2 / 7, rounded up:
    1. Its values stay the last it ran with, as before."""
    pause = {"type": "pause-activity", "activity": "squat", "weeks": 1}
    rp = replay(plain_run(), [change(1, d("2026-12-09"), pause)])
    ids = {a.key: a.key for a in rp.activities}
    items = {i["id"]: i for i in week_items(rp, rp.week(d("2026-12-07")), ids)}
    assert items["squat"]["target"] == 1
    assert items["squat"]["weight"] == weight(rp, d("2026-12-08"), "squat")
    assert {k: i["target"] for k, i in items.items() if k != "squat"} == {
        "bench": 3,
        "row": 3,
        "deadlift": 3,
        "plank": 3,
    }
    # The next week, paused Monday and Tuesday and back on Wednesday: 3 x 5 / 7, rounded up.
    later = {i["id"]: i for i in week_items(rp, rp.week(d("2026-12-14")), ids)}
    assert later["squat"]["target"] == 3


def test_a_start_after_monday_has_a_goal_for_the_days_it_runs() -> None:
    """A Thursday start: Monday to Wednesday are before the run, so 3 x 4 / 7, rounded up: 2.
    The weeks after it keep 3."""
    rp = replay(plain_run(start=d("2026-11-26")), [])
    ids = {a.key: a.key for a in rp.activities}
    assert {i["target"] for i in week_items(rp, rp.weeks[0], ids)} == {2}
    assert {i["target"] for i in week_items(rp, rp.weeks[1], ids)} == {3}


def test_a_week_cut_by_end_programme_counts_its_days_before_the_end() -> None:
    """The replay passes End programme by, so its days from the end read as running: `last` cuts
    them. Ended from Wednesday: Monday and Tuesday at 3, so 1."""
    rp = replay(plain_run(), [])
    week = rp.week(d("2026-12-07"))
    assert rp.day(d("2026-12-09")).activities["squat"].state == "running"
    ids = {a.key: a.key for a in rp.activities}
    assert {i["target"] for i in week_items(rp, week, ids, last=d("2026-12-08"))} == {1}
    assert {i["target"] for i in week_items(rp, week, ids, last=d("2026-12-13"))} == {3}
    assert {i["target"] for i in week_items(rp, week, ids, last=d("2026-12-06"))} == {0}


def test_week_items_leave_out_what_isnt_in_the_week() -> None:
    add = {"type": "add-activity", "activity": {"key": "dips", "name": "Dips", "reps": 8}}
    log = [
        change(1, d("2026-12-28"), add),
        change(2, d("2026-12-16"), {"type": "end-activity", "activity": "plank"}),
    ]
    rp = replay(plain_run(), log)
    ids = {a.key: a.key for a in rp.activities}
    keys = [[i["id"] for i in week_items(rp, w, ids)] for w in rp.weeks[3:6]]
    assert keys == [
        ["squat", "bench", "row", "deadlift", "plank"],  # plank ended Wed: kept
        ["squat", "bench", "row", "deadlift"],
        ["squat", "bench", "row", "deadlift", "dips"],
    ]
    # It ran Monday and Tuesday at 3, so its goal is 1 (K163); its values are Tuesday's.
    plank = week_items(rp, rp.weeks[3], ids)[-1]
    assert plank["target"] == 1 and plank["duration"] == 35


def test_week_items_for_a_cardio_run() -> None:
    rp = replay(plain_run("cardio.json"), [])
    items = week_items(rp, rp.weeks[3], {"run": "a", "long-ride": "b"})
    assert items == [
        {"id": "a", "name": "Easy run", "duration": 1260, "distance": 4.5, "target": 2},
        {"id": "b", "name": "Long ride", "duration": 3360, "distance": 15, "target": 1},
    ]


def test_check_run_types() -> None:
    """`replay` returns plain dataclasses with dates, ready for W4 to store."""
    rp = replay(mockup_run(), mockup_log())
    assert isinstance(rp.weeks[0].days[0], DayPlan)
    assert rp.run.start == START
    assert isinstance(rp.hand_edits, Sequence)


def test_changes_that_no_longer_apply_do_nothing() -> None:
    """The replay applies what it can: `check_change` refuses these, but a log can still hold
    one whose ground went with an undo. Each is skipped."""
    hand = change(
        1,
        START,
        {"type": "edit-week", "activity": "row", "week": 8, "field": "weight", "value": 20},
    )
    noise = [
        change(
            2,
            d("2026-12-21"),
            {
                "type": "set-value",
                "activity": "squat",
                "field": "tempo",
                "value": 3,
                "dropHandEdits": [99],
            },
        ),
        change(
            3,
            d("2026-12-21"),
            {"type": "add-activity", "activity": {"key": "squat", "name": "Again", "reps": 5}},
        ),
        change(4, d("2027-02-01"), {"type": "go-to-week", "week": 1}),
        change(5, d("2026-11-20"), {"type": "go-to-week", "week": 3}),
    ]
    rp = replay(plain_run(), [hand, *noise])
    assert rp.weeks == replay(plain_run(), [hand]).weeks
    assert weight(rp, d("2027-01-11"), "row") == 20


def test_an_added_activity_whose_parameter_no_longer_fits_is_skipped() -> None:
    log = [
        change(1, d("2026-12-21"), {"type": "set-parameter", "param": "rate", "value": 2000}),
        change(
            2,
            d("2026-12-21"),
            {
                "type": "add-activity",
                "activity": {
                    "key": "front",
                    "name": "Front squat",
                    "weight": {"start": 10, "rate": "$rate"},
                },
            },
        ),
    ]
    rp = replay(plain_run(), log)
    assert "front" not in rp.day(d("2026-12-21")).activities


def test_changes_to_an_activity_before_its_own_week_1_do_nothing() -> None:
    log = [
        change(
            1,
            d("2026-12-21"),
            {"type": "add-activity", "activity": {"key": "dips", "name": "Dips", "reps": 8}},
        ),
        change(2, d("2026-12-28"), {"type": "go-to-week", "week": 3}),
        change(
            3,
            d("2026-12-28"),
            {"type": "set-increase", "activity": "dips", "field": "reps", "add": 1},
        ),
        change(
            4,
            d("2026-12-28"),
            {"type": "set-value", "activity": "dips", "field": "reps", "value": 10},
        ),
        change(5, d("2026-12-28"), {"type": "pause-programme"}),
        change(6, d("2027-01-04"), {"type": "resume-programme"}),
    ]
    rp = replay(plain_run(), log)
    assert rp.day(d("2026-12-30")).activities["dips"].state == "not-started"  # in the pause
    first = rp.day(d("2027-01-18")).activities["dips"]
    assert (first.activity_week, first.values) == (1, {"target": 3, "reps": 8})


def test_set_parameter_leaves_an_ended_activity_alone() -> None:
    log = [
        change(1, d("2026-12-21"), {"type": "end-activity", "activity": "squat"}),
        change(2, d("2026-12-28"), {"type": "set-parameter", "param": "rate", "value": 10}),
    ]
    rp = replay(plain_run(), log)
    assert rp.day(d("2026-12-28")).activities["squat"].state == "ended"


def test_each_side_is_in_the_values() -> None:
    rp = replay(plain_run("mobility.json"), [])
    assert rp.day(START).activities["hip-flexor"].values == {
        "target": 5,
        "sets": 2,
        "duration": 30,
        "perSide": True,
    }


def test_a_preview_leaves_an_activity_ended_on_both_sides_out() -> None:
    log = [change(1, d("2026-12-21"), {"type": "end-activity", "activity": "plank"})]
    preview = preview_change(
        plain_run(),
        log,
        ROW | {"value": 45},
        from_date=d("2026-12-28"),
        today=TODAY,
        made_at=datetime(2026, 12, 16),
    )
    assert {c.key for c in preview.cells} == {"row"}


MORE_CHECKS: list[tuple[str, dict[str, Any], list[tuple[str, str]]]] = [
    (
        "resume-unknown-activity",
        {"type": "resume-activity", "activity": "lunge", "values": {"weight": 40}},
        [("activity", "there is no activity called lunge.")],
    ),
    (
        "increase-unknown-field",
        {"type": "set-increase", "activity": "row", "field": "tempo", "add": 5},
        [("field", "give one of target, sets, reps, duration, weight.")],
    ),
    (
        "edit-unknown-activity",
        {"type": "edit-week", "activity": "lunge", "week": 6, "field": "weight", "value": 30},
        [("activity", "there is no activity called lunge.")],
    ),
    (
        "drops-not-a-list",
        ROW | {"value": 45, "dropHandEdits": 3},
        [("dropHandEdits", "give a list of hand-edits by change number.")],
    ),
    (
        "add-activity-runs-past-the-cap",
        {
            "type": "add-activity",
            "activity": {"key": "heavy", "name": "Heavy", "weight": {"start": 400, "rate": 20}},
        },
        [("activity.weight", "week 6 comes to 576 kg. The most is 500.")],
    ),
    (
        "resume-at-a-value-that-runs-past-the-cap",
        {"type": "resume-activity", "activity": "deadlift", "values": {"weight": 497.5}},
        [("values.weight", "week 5 comes to 502.5 kg. The most is 500.")],
    ),
]


@pytest.mark.parametrize(("name", "body", "errors"), MORE_CHECKS, ids=[c[0] for c in MORE_CHECKS])
def test_more_changes_are_checked(
    name: str, body: dict[str, Any], errors: list[tuple[str, str]]
) -> None:
    got = check_change(mockup_run(), mockup_log(), body, from_date=TODAY, today=TODAY)
    assert sorted((e.path, e.message) for e in got) == errors


def test_a_programme_change_that_runs_a_value_past_the_cap_names_the_activity() -> None:
    """Going back can pair an override with a later activity week than the programme was
    checked with: 460 kg x 1.1 in week 2."""
    doc = {
        "format": "tracker-programme/1",
        "name": "Heavy",
        "kind": "strength",
        "weeks": 6,
        "activities": [
            {"key": "a", "name": "Heavy pull", "weight": {"start": 400, "add": 20, "step": 0.5}}
        ],
        "overrides": [{"weeks": [2], "activities": {"*": {"weight": {"scale": 1.1}}}}],
    }
    run = start_run(parse_programme(doc), {}, START)
    log = [change(1, d("2026-12-14"), {"type": "pause-activity", "activity": "a", "weeks": 2})]
    errors = check_change(
        run,
        log,
        {"type": "go-to-week", "week": 1},
        from_date=d("2026-12-21"),
        today=d("2026-12-21"),
    )
    assert [str(e) for e in errors] == ["Heavy pull: week 2 comes to 506 kg. The most is 500."]


# ---- K165: an end a re-open follows reads as a programme pause ----

END = {"type": END_PROGRAMME}
REOPEN = {"type": REOPEN_PROGRAMME}


def days_json(rp: Replay) -> list[dict[str, Any]]:
    return [day_to_json(day) for week in rp.weeks for day in week.days]


def test_an_end_a_reopen_follows_reads_as_a_pause_resumed_at_the_paused_week() -> None:
    """Ended on Wed 9 Dec in programme week 3, re-opened on Wed 16 Dec: the days between are a
    pause of the whole programme, and the run carries on at week 3, a week later than planned."""
    run = plain_run()
    rp = replay(run, [change(1, d("2026-12-09"), END, "Knee"), change(2, d("2026-12-16"), REOPEN)])
    gap = rp.day(d("2026-12-12"))
    assert (gap.status, gap.programme_week, gap.until, gap.reason) == (
        "paused",
        3,
        d("2026-12-16"),
        "Knee",
    )
    assert {a.state for a in gap.activities.values()} == {"paused"}
    assert [day.status for day in rp.week(d("2026-12-07")).days] == ["running"] * 2 + ["paused"] * 5
    back = rp.day(d("2026-12-16"))
    assert (back.status, back.programme_week) == ("running", 3)
    assert back.activities["squat"].activity_week == 3
    assert rp.day(d("2026-12-21")).programme_week == 4
    assert rp.end == d("2027-01-24")
    # The same days as a programme pause from the end's day, resumed at the paused week.
    paused = replay(
        run,
        [
            change(1, d("2026-12-09"), {"type": "pause-programme"}, "Knee"),
            change(2, d("2026-12-16"), {"type": "resume-programme"}),
        ],
    )
    for day in (d("2026-12-08"), d("2026-12-16"), d("2026-12-21"), d("2027-01-24")):
        assert day_to_json(rp.day(day)) == day_to_json(paused.day(day)), day


def test_an_activity_paused_before_the_end_moves_as_across_a_programme_pause() -> None:
    run = plain_run()
    deadlift = change(1, d("2026-12-01"), {"type": "pause-activity", "activity": "deadlift"})
    resume = change(4, d("2026-12-30"), {"type": "resume-activity", "activity": "deadlift"})
    reopened = replay(
        run,
        [deadlift, change(2, d("2026-12-09"), END), change(3, d("2026-12-16"), REOPEN), resume],
    )
    paused = replay(
        run,
        [
            deadlift,
            change(2, d("2026-12-09"), {"type": "pause-programme", "weeks": 1}),
            resume,
        ],
    )
    assert days_json(reopened) == days_json(paused)
    # Paused on the Tuesday of week 2, it comes back at its week 3 (K151), whatever the gap.
    assert reopened.day(d("2026-12-30")).activities["deadlift"].activity_week == 3


def test_an_end_no_reopen_follows_is_passed_by() -> None:
    run = plain_run()
    plain = replay(run, [])
    ended = replay(run, [change(1, d("2026-12-09"), END)])
    assert days_json(ended) == days_json(plain)
    assert ended.end == plain.end
    # The latest end before a re-open is the one it lifts; one after it stands.
    log = [
        change(1, d("2026-12-09"), END),
        change(2, d("2026-12-16"), REOPEN),
        change(3, d("2026-12-23"), END),
    ]
    assert days_json(replay(run, log)) == days_json(replay(run, log[:2]))


def test_a_reopen_on_the_ends_own_day_pauses_nothing() -> None:
    run = plain_run()
    rp = replay(run, [change(1, d("2026-12-09"), END), change(2, d("2026-12-09"), REOPEN)])
    assert days_json(rp) == days_json(replay(run, []))


def test_a_reopen_resumes_a_programme_paused_when_it_ended_on_the_reopens_day() -> None:
    """A programme pause in force at the end becomes part of the gap: it holds the paused week,
    and the re-open resumes it on its day."""
    run = plain_run()
    log = [
        change(1, d("2026-12-02"), {"type": "pause-programme", "weeks": 4}, "Flu"),
        change(2, d("2026-12-09"), END),
        change(3, d("2026-12-16"), REOPEN),
    ]
    rp = replay(run, log)
    gap = rp.day(d("2026-12-12"))
    assert (gap.status, gap.programme_week, gap.until, gap.reason) == (
        "paused",
        2,
        d("2026-12-16"),
        "Flu",
    )
    assert (rp.day(d("2026-12-16")).status, rp.day(d("2026-12-16")).programme_week) == (
        "running",
        2,
    )
    # On the end's own day too.
    same_day = [*log[:2], change(3, d("2026-12-09"), REOPEN)]
    assert rp_day_status(replay(run, same_day), d("2026-12-09")) == ("running", 2)


def rp_day_status(rp: Replay, day: date) -> tuple[str, int | None]:
    plan = rp.day(day)
    return plan.status, plan.programme_week


def test_a_run_ended_and_reopened_twice_has_two_gaps() -> None:
    run = plain_run()
    log = [
        change(1, d("2026-12-09"), END),
        change(2, d("2026-12-16"), REOPEN),
        change(3, d("2026-12-30"), END),
        change(4, d("2027-01-06"), REOPEN),
    ]
    rp = replay(run, log)
    assert rp_day_status(rp, d("2026-12-30")) == ("paused", 5)
    assert rp_day_status(rp, d("2027-01-06")) == ("running", 5)
    assert rp.end == d("2027-01-31")


def test_a_reopen_with_no_end_before_it_does_nothing() -> None:
    run = plain_run()
    rp = replay(run, [change(1, d("2026-12-09"), REOPEN)])
    assert days_json(rp) == days_json(replay(run, []))
