"""The work a programme run plans and the work done, week by week (spec
docs/specs/2026-11-19-work-charts.md, K179).

A pure module, beside `programme_replay.py`: no database, no clock. `work_json` reads a run's
calendar weeks, as the grid shows them, and its marks, and gives the run's `work`:

- Each activity counts one **measure** (§1): `work` (kg, weight x reps x sets) when it has a
  weight and reps; else `reps` (reps x sets) when it has reps, or `seconds` (seconds held x sets)
  for a hold. A cardio activity counts `distance` (km), or `time` (min) when it has no distance.
  An activity done on each side (`perSide`) doubles its reps and seconds.
- A week's **planned** is the sum over its days of (the day's goal / 7) x the day's amount for one
  session, on the days the activity runs (W2, W6). A day after the run's last adds nothing.
- A week's **done** is the sum over its marked days of the day's amount for one session (W1, W3):
  any mark, on a day the activity runs or is paused. A week wholly after today has none (null).
- The **total** adds the `work` activities only (W5); it is null when none has weight, and
  `leftOut` names the others in the grid's order.

Amounts are exact (Fractions) until the end, then rounded half up to whole kg, reps, seconds and
minutes, and to 0.1 km.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from fractions import Fraction
from typing import Any, Literal

from .programme import Activity, Kind, PlanValues
from .programme_replay import Replay, WeekPlan
from .validate import Log

type Measure = Literal["work", "reps", "seconds", "distance", "time"]
#: Each measure's unit, as the reply names it.
UNITS: dict[Measure, str] = {
    "work": "kg",
    "reps": "reps",
    "seconds": "s",
    "distance": "km",
    "time": "min",
}
_HALF = Fraction(1, 2)


def measure_of(kind: Kind, activity: Activity) -> Measure:
    """What an activity's chart counts, from the fields it has. A weighted hold has no reps, so
    it counts its seconds."""
    fields = activity.values.keys()
    if kind == "cardio":
        return "distance" if "distance" in fields else "time"
    if "weight" in fields and "reps" in fields:
        return "work"
    return "seconds" if "duration" in fields else "reps"


def _exact(value: int | float | bool | None) -> Fraction:
    """A plan value as an exact number: 52.5 is 105/2, 0.1 km is 1/10. None counts 0."""
    if value is None:
        return Fraction(0)
    return Fraction(str(value)) if isinstance(value, float) else Fraction(value)


def session_amount(measure: Measure, values: PlanValues) -> Fraction:
    """One session's amount on a day with these values. A field the day hasn't counts 0, but
    for sets, where none means one set."""
    if measure == "distance":
        return _exact(values.get("distance"))
    if measure == "time":
        return _exact(values.get("duration")) / 60
    sets = _exact(values.get("sets")) or Fraction(1)
    sides = 2 if values.get("perSide") is True else 1
    if measure == "seconds":
        return _exact(values.get("duration")) * sides * sets
    reps = _exact(values.get("reps")) * sides * sets
    return reps * _exact(values.get("weight")) if measure == "work" else reps


@dataclass(frozen=True)
class _Week:
    """One calendar week of one activity, exact: `done` is None for a week after today."""

    week: WeekPlan
    planned: Fraction
    done: Fraction | None


def _activity_week(
    week: WeekPlan,
    key: str,
    measure: Measure,
    marks: Sequence[object],
    today: date,
    last_day: date | None,
) -> _Week | None:
    """An activity's week, or None for a week it has no day in but ended ones (W6): before it
    was added, or after it ended."""
    planned = Fraction(0)
    done = Fraction(0)
    present = False
    for day, mark in zip(week.days, marks, strict=True):
        act = day.activities.get(key)
        if act is None or (last_day is not None and day.date > last_day):
            continue
        present = present or act.state != "ended"
        if act.values is None:
            continue
        amount = session_amount(measure, act.values)
        if act.state == "running":
            planned += _exact(act.values.get("target")) / 7 * amount
        if mark is not None and act.state in ("running", "paused") and day.date <= today:
            done += amount
    if not present:
        return None
    return _Week(week, planned, None if week.monday > today else done)


def _rounded(value: Fraction, measure: Measure) -> int | float:
    """Half up: whole kg, reps, seconds and minutes, and km to 0.1."""
    if measure != "distance":
        return math.floor(value + _HALF)
    tenths = math.floor(value * 10 + _HALF)
    return tenths // 10 if tenths % 10 == 0 else tenths / 10


def _weeks_json(amounts: Sequence[_Week], measure: Measure) -> list[dict[str, Any]]:
    return [
        {
            "monday": a.week.monday.isoformat(),
            "programmeWeeks": list(a.week.programme_weeks),
            "planned": _rounded(a.planned, measure),
            "done": None if a.done is None else _rounded(a.done, measure),
        }
        for a in amounts
    ]


def _total(
    weeks: Sequence[WeekPlan], weighted: Sequence[Sequence[_Week | None]], today: date
) -> list[_Week]:
    """The `work` activities added up week by week, exactly: every week, each activity's
    counting 0 in a week it is left out of."""
    out: list[_Week] = []
    for i, week in enumerate(weeks):
        found = [a for amounts in weighted if (a := amounts[i]) is not None]
        planned = sum((a.planned for a in found), Fraction(0))
        done = sum((a.done for a in found if a.done is not None), Fraction(0))
        out.append(_Week(week, planned, None if week.monday > today else done))
    return out


def work_json(
    rp: Replay,
    weeks: Sequence[WeekPlan],
    *,
    today: date,
    log: Log,
    last_day: date | None,
) -> dict[str, Any]:
    """The run's `work` (spec §3): `total`, or None with no weighted activity, and `activities`
    in the grid's order, each with its measure and unit. `weeks` are the grid's calendar weeks,
    so none after an open pause. The total has an entry for each; an activity, for each it has a
    day in but ended ones (W6). A day after `last_day` (End programme's day on) adds nothing."""
    kind = rp.run.programme.kind
    activities: list[dict[str, Any]] = []
    weighted: list[list[_Week | None]] = []
    left_out: list[str] = []
    for activity in rp.activities:
        if activity.deleted:
            continue
        measure = measure_of(kind, activity.activity)
        amounts = [
            _activity_week(
                week, activity.key, measure, _marks(log, week, activity.key), today, last_day
            )
            for week in weeks
        ]
        activities.append(
            {
                "key": activity.key,
                "name": activity.name,
                "measure": measure,
                "unit": UNITS[measure],
                "weeks": _weeks_json([a for a in amounts if a is not None], measure),
            }
        )
        if measure == "work":
            weighted.append(amounts)
        else:
            left_out.append(activity.name)
    total = None
    if weighted:
        total = {
            "unit": UNITS["work"],
            "leftOut": left_out,
            "weeks": _weeks_json(_total(weeks, weighted, today), "work"),
        }
    return {"total": total, "activities": activities}


def _marks(log: Log, week: WeekPlan, key: str) -> Sequence[object]:
    """An activity's marks in a week, a day each: None for a day without one."""
    return log.get(week.monday.isoformat(), {}).get(key, [None] * 7)
