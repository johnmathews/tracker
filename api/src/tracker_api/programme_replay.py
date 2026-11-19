"""A programme run's change log and its replay (spec docs/specs/2026-11-17-programmes.md §5 to §8).

A pure module, beside `programme.py`: no database, no clock. `today` is always an argument.

The run's log is the source of truth (§5). `replay(run, changes)` computes every day of the run
from the programme, its parameters, its start date and the log, in order. Each change takes effect
on its from day; changes on the same day apply in log order (`seq`). A sealed day (§8) given in
`sealed` replaces the replay's output for that date, and a change that continues from the value
shown on a sealed day reads the sealed record, never the replay's own output (P1).

## A change

W3 stores each change as a row: `seq`, `from_date`, `made_at`, the body as JSON, `reason`, `source`
and `undone_by`. The body is a JSON object tagged by `type`, one per row of the spec's §7 table:

| `type`             | Keys                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| `pause-programme`  | `weeks` (1 to 52; left out: until resumed)                                |
| `resume-programme` | `at`: `"paused"` (the default) or `"next"`                                |
| `go-to-week`       | `week` (1 to the programme's weeks)                                       |
| `pause-activity`   | `activity` (its key), `weeks` (as for the programme)                      |
| `resume-activity`  | `activity`, `values` (optional: `{"weight": 70}`, each a Set value)       |
| `add-activity`     | `activity`: an activity as the format writes one (§3.1), with a new key   |
| `end-activity`     | `activity`                                                                |
| `set-value`        | `activity`, `field`, `value`                                              |
| `set-increase`     | `activity`, `field`, and `add` or `rate`                                  |
| `set-parameter`    | `param` (its key), `value`                                                |
| `edit-week`        | `activity`, `week` (a programme week), `field`, `value`: a hand-edit      |
| `undo`             | `change` (the `seq` of the change it reverses)                            |

`set-value`, `set-increase`, `set-parameter` and `resume-activity` also take `dropHandEdits`, a
list of hand-edits (by `seq`) the change drops (§7.2). `check_change` returns every problem with a
body as a JSON path and a sentence, as `check_programme` does.

The log also holds two rows that are no change type: `end-programme` (End programme, K156) and
`reopen-programme` (a re-open, K165). The replay passes an end by, unless a re-open follows it.

## How changes behave

- **The programme week** advances at each Monday while the programme runs (§6.1). A pause stops it;
  a resume goes back to the paused week or the next. Go to week sets it from the from day, so a
  change on a Wednesday splits that calendar week (§6.2).
- **An activity's week** is the programme week less its offset (§6.3). The offset grows at each
  Monday the programme advances while the activity is paused. A resume later in that week takes
  the Monday back, so the activity week counts the programme weeks the activity ran in, and a
  resume on any day of a week gives the same value. A paused activity stays put when the programme
  goes to another week. An added activity starts at its own week 1.
- **A field's series** is the programme's, then one segment per value change (§7.1). Set value
  starts a segment at the activity week in force, at the new value, keeping the increase. Set
  increase starts one at the value the rule shows that week (rounded, before any override or
  hand-edit), with the new increase from the next week. Either keeps the field's step and the
  activity's increase weeks (plan §8.1). For each activity week the latest segment that starts at
  or before it applies, so going back to an earlier week shows that week's values again.
- **Set parameter** acts as Set value for each field whose start uses the parameter and as Set
  increase for each whose add or rate does.
- **A hand-edit** sets one field for one programme week, from its from day. It wins over the rule
  and overrides, and later changes keep it unless they drop it (§7.2).
- **End activity** stops an activity from the from day. One with no day before then is deleted
  outright: `RunActivity.deleted`.
- **Undo** reverses one change whose effect starts today or later; the replay leaves the change
  out. A change that no longer applies because one before it was undone (a resume with nothing
  paused) does nothing.
- **An end a re-open follows** (K165) is a pause of the whole programme from the end's day until
  the re-open's day, which resumes it at the paused programme week. A programme pause already in
  force at the end becomes part of it. The latest end before a re-open is the one it lifts.

## The output

`replay` returns a `Replay`: a `WeekPlan` per calendar week (keyed by its Monday), each with seven
`DayPlan`s. A day has its status, programme week, override label, and per activity an
`ActivityDay`: its state (running, paused, ended or not started), activity week, plan values, the
rule's values (`base`), its hand-edit marks, and for a pause its until date and reason. The run's
last day is `Replay.end`; an open-ended programme pause instead gives `open_pause`, paused weeks
up to the run's last week, and `when_resumed`, the weeks that follow without dates (§5).
`week_items` turns one calendar week into plan items for `plans`: Sunday's values, or the last
the activity ran with, and the week's goal from `week_goal`, which counts its days (§6.2, K163).
`day_to_json`/`day_from_json` store a day for sealing.

`preview_change` replays the log with and without one change: the cells it changes, the
hand-edits that block it, the activities that end short, the log's `rev_of(log)`, and
`confirm_token`, which covers that rev and the change itself: a confirm must send it back (§7.3).
"""

import copy
import hashlib
import json
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from typing import Any, Literal, cast

from . import validate
from .programme import (
    FIELDS,
    KIND_FIELDS,
    MAX_WEEKS,
    RATE_DOMAIN,
    Activity,
    Field,
    FieldRule,
    PlanValues,
    Programme,
    ProgrammeError,
    ProgrammeInvalid,
    Resolved,
    Series,
    as_decimal,
    fits_rate,
    json_path,
    number_text,
    param_problem,
    parse_activity,
    resolve,
    resolve_activity,
    whole_in,
)
from .validate import Item, whole

CHANGE_TYPES = (
    "pause-programme",
    "resume-programme",
    "go-to-week",
    "pause-activity",
    "resume-activity",
    "add-activity",
    "end-activity",
    "set-value",
    "set-increase",
    "set-parameter",
    "edit-week",
    "undo",
)
#: The log rows that are no change: End programme (K156) and a re-open (K165).
END_PROGRAMME = "end-programme"
REOPEN_PROGRAMME = "reopen-programme"
#: The keys each type of change takes, besides `type`.
CHANGE_KEYS: dict[str, tuple[str, ...]] = {
    "pause-programme": ("weeks",),
    "resume-programme": ("at",),
    "go-to-week": ("week",),
    "pause-activity": ("activity", "weeks"),
    "resume-activity": ("activity", "values", "dropHandEdits"),
    "add-activity": ("activity",),
    "end-activity": ("activity",),
    "set-value": ("activity", "field", "value", "dropHandEdits"),
    "set-increase": ("activity", "field", "add", "rate", "dropHandEdits"),
    "set-parameter": ("param", "value", "dropHandEdits"),
    "edit-week": ("activity", "week", "field", "value"),
    "undo": ("change",),
}
#: The body key a range problem is reported at, by type; others report at the root.
_RANGE_PATH: dict[str, str] = {
    "set-value": "value",
    "set-parameter": "value",
    "edit-week": "value",
}
UNKNOWN_KEY = "this key is not part of the change."

#: `date`, for the classes with a field named `date`.
type Day = date
type ActivityState = Literal["running", "paused", "ended", "not-started"]
type DayStatus = Literal["before-start", "running", "paused"]


def _day(when: date) -> str:
    """A day for a sentence: Wed 16 Dec."""
    return f"{when:%a} {when.day} {when:%b}"


def _plain(rule: FieldRule, n: Decimal) -> int | float:
    """A decimal as an item holds it: whole for a whole field, else a number to hundredths."""
    return int(n) if rule.is_whole else whole(float(n))


def _monday(when: date) -> date:
    return when - timedelta(days=when.weekday())


# ---- Inputs ----


@dataclass(frozen=True, kw_only=True)
class Run:
    """A started programme: the run's own copy of the document, its parameters and start date."""

    resolved: Resolved
    start: date

    @property
    def programme(self) -> Programme:
        return self.resolved.programme


def start_run(programme: Programme, params: Mapping[str, object] | None, start: date) -> Run:
    """A run of `programme` from `start` (any day: its calendar week is week 1). Raises
    `ProgrammeInvalid` for parameters that don't fit (`programme.resolve`)."""
    return Run(resolved=resolve(programme, params), start=start)


@dataclass(frozen=True, kw_only=True)
class Change:
    """One entry in a run's log (§7)."""

    seq: int
    from_date: date
    made_at: datetime
    body: Mapping[str, Any]
    reason: str | None = None
    #: The undo that reversed it. The replay also reads each undo's body, so either is enough.
    undone_by: int | None = None


# ---- Output ----


@dataclass(frozen=True, kw_only=True)
class HandMark:
    """A hand-edited value's marker: the change that set it, the day it was made, and what the
    rule gives for that week."""

    seq: int
    made_on: date
    rule: int | float


@dataclass(frozen=True, kw_only=True)
class ActivityDay:
    state: ActivityState
    #: Running: the activity week. Paused: the week it comes back at.
    activity_week: int | None = None
    #: Running: the plan's values. Paused: the values it comes back at.
    values: PlanValues | None = None
    #: The rule's values, before any override or hand-edit: what a new increase continues from.
    base: PlanValues | None = None
    hand: Mapping[str, HandMark] = field(default_factory=dict)
    until: date | None = None
    reason: str | None = None


@dataclass(frozen=True, kw_only=True)
class DayPlan:
    date: Day
    status: DayStatus
    programme_week: int | None = None
    #: The week's override label ("Deload"), on a day the programme runs.
    label: str | None = None
    #: A programme pause's resume day and reason.
    until: Day | None = None
    reason: str | None = None
    #: Each activity of the run that exists on the day, in the run's order.
    activities: Mapping[str, ActivityDay]
    #: Read from a sealed record rather than computed (§8).
    sealed: bool = False


@dataclass(frozen=True, kw_only=True)
class WeekPlan:
    """One calendar week, Monday to Sunday."""

    monday: date
    days: tuple[DayPlan, ...]

    @property
    def programme_weeks(self) -> tuple[int, ...]:
        """The programme weeks the week runs, in order: two for a week split by a change."""
        weeks = [day.programme_week for day in self.days if day.status == "running"]
        weeks = weeks or [day.programme_week for day in self.days if day.status == "paused"]
        return tuple(dict.fromkeys(n for n in weeks if n is not None))

    def splits(self, key: str, name: str) -> tuple[tuple[date, int | float | bool], ...]:
        """A field's value on the days the activity runs, as (first day, value) for each run of
        equal values: two entries for "35 → 32.5 kg from Wed"."""
        out: list[tuple[date, int | float | bool]] = []
        for day in self.days:
            act = day.activities.get(key)
            if act is None or act.state != "running" or act.values is None:
                continue
            value = act.values.get(name)
            if value is not None and (not out or out[-1][1] != value):
                out.append((day.date, value))
        return tuple(out)


@dataclass(frozen=True, kw_only=True)
class ProjectedWeek:
    """A programme week after an open-ended pause, as it will run when resumed: no dates."""

    programme_week: int
    label: str | None
    activities: Mapping[str, ActivityDay]


@dataclass(frozen=True, kw_only=True)
class OpenPause:
    since: date
    programme_week: int
    reason: str | None


@dataclass(frozen=True, kw_only=True)
class EndsShort:
    """An activity that ends with the programme before its last week (§6.3, Q2)."""

    key: str
    name: str
    week: int
    of: int

    @property
    def message(self) -> str:
        return f"{self.name} ends at its week {self.week} of {self.of}."


@dataclass(frozen=True, kw_only=True)
class HandEdit:
    seq: int
    key: str
    programme_week: int
    field: Field
    value: Decimal
    from_date: date
    made_on: date
    dropped_on: date | None = None


@dataclass(frozen=True, kw_only=True)
class RunActivity:
    key: str
    name: str
    activity: Activity
    added_on: date
    #: The add-activity change, or None for the programme's own.
    added_by: int | None
    ended_on: date | None
    #: Ended before it had a day: W4 deletes the item outright (§7).
    deleted: bool


@dataclass(frozen=True, kw_only=True)
class Replay:
    run: Run
    weeks: tuple[WeekPlan, ...]
    activities: tuple[RunActivity, ...]
    #: The parameters in force at the end, after any Set parameter.
    params: Mapping[str, Decimal]
    #: The run's last day (a Sunday); None while it is paused with no resume date.
    end: date | None
    open_pause: OpenPause | None
    when_resumed: tuple[ProjectedWeek, ...]
    ends_short: tuple[EndsShort, ...]
    hand_edits: tuple[HandEdit, ...]
    #: Each undone change's seq, with the undo's.
    undone: Mapping[int, int]
    rev: str

    def day(self, when: date) -> DayPlan:
        index = (when - self.weeks[0].monday).days
        if not 0 <= index < 7 * len(self.weeks):
            raise KeyError(when)
        return self.weeks[index // 7].days[index % 7]

    def week(self, when: date) -> WeekPlan:
        """The calendar week holding `when`."""
        self.day(when)
        return self.weeks[(when - self.weeks[0].monday).days // 7]


# ---- The engine ----


@dataclass
class _Act:
    key: str
    activity: Activity
    #: Each field's series: the programme's first, then one per value change, in order.
    segments: dict[Field, list[Series]]
    offset: int
    added_on: date
    added_by: int | None
    status: Literal["running", "paused", "ended"] = "running"
    until: date | None = None
    reason: str | None = None
    #: This week's Monday grew the offset while the activity was paused.
    bumped: bool = False
    appeared: bool = False
    last_week: int | None = None
    ended_on: date | None = None
    deleted: bool = False


@dataclass
class _Pause:
    since: date
    programme_week: int
    until: date | None
    reason: str | None


@dataclass
class _Hand:
    seq: int
    key: str
    programme_week: int
    field: Field
    value: Decimal
    from_date: date
    made_on: date
    dropped_on: date | None = None


def _reopened(changes: Sequence[Change]) -> dict[int, date]:
    """Each End programme a re-open lifts, by its seq, with the re-open's day (K165): the latest
    end before each re-open in the log."""
    out: dict[int, date] = {}
    end: Change | None = None
    for c in sorted(changes, key=lambda c: c.seq):
        kind = c.body.get("type")
        if kind == END_PROGRAMME:
            end = c
        elif kind == REOPEN_PROGRAMME and end is not None:
            out[end.seq], end = c.from_date, None
    return out


def _undone(changes: Sequence[Change]) -> dict[int, int]:
    undone = {c.seq: c.undone_by for c in changes if c.undone_by is not None}
    for c in sorted(changes, key=lambda c: c.seq):
        target = c.body.get("change")
        if c.body.get("type") == "undo" and c.seq not in undone and isinstance(target, int):
            undone.setdefault(target, c.seq)
    return undone


class _Sim:
    """The day-by-day simulation behind `replay`."""

    def __init__(self, run: Run, changes: Sequence[Change], sealed: Mapping[date, DayPlan]) -> None:
        self.run = run
        self.programme = run.programme
        self.rules = KIND_FIELDS[self.programme.kind]
        self.params = dict(run.resolved.params)
        self.sealed = sealed
        self.undone = _undone(changes)
        self.reopened = _reopened(changes)
        self.queue = sorted(
            (c for c in changes if c.seq not in self.undone and c.body.get("type") != "undo"),
            key=lambda c: (c.from_date, c.seq),
        )
        self.next = 0
        self.status: Literal["before", "running", "paused", "ended"] = "before"
        self.pw = 0
        self.pause: _Pause | None = None
        self.end: date | None = None
        self.horizon: date | None = None
        self.hands: list[_Hand] = []
        self.days: list[DayPlan] = []
        self.first = _monday(run.start)
        self.acts: dict[str, _Act] = {
            a.key: _Act(
                key=a.key,
                activity=a,
                segments={f: [s] for f, s in run.resolved.series[a.key].items()},
                offset=0,
                added_on=run.start,
                added_by=None,
            )
            for a in self.programme.activities
        }

    # -- running --

    def run_days(self, *, until: date | None = None, stop: date | None = None) -> date:
        """Step day by day to the run's end, or to the run's last week while it is paused with
        no resume date (at least to `until`). With `stop`, return after that day. Returns the
        first day not stepped."""
        day = self.first
        while True:
            if day.weekday() == 0 and day > self.first and self._done(day, until):
                return day
            self._step(day)
            if self.status == "ended":
                return day
            self.days.append(self._emit(day))
            if stop is not None and day >= stop:
                return day + timedelta(days=1)
            day += timedelta(days=1)

    def _done(self, day: date, until: date | None) -> bool:
        return (
            self.status == "paused"
            and self.pause is not None
            and self.pause.until is None
            and self.next >= len(self.queue)
            and self.horizon is not None
            and day >= self.horizon
            and (until is None or day > until)
        )

    def _step(self, day: date) -> None:
        advanced = False
        if self.status == "before":
            if day == self.run.start:
                self.status, self.pw = "running", 1
        elif day.weekday() == 0:
            for act in self.acts.values():
                act.bumped = False
            if self.status == "running":
                if self.pw >= self.programme.weeks:
                    self.status, self.end = "ended", day - timedelta(days=1)
                    return
                self.pw += 1
                advanced = True
        if self.status == "paused" and self.pause is not None and self.pause.until == day:
            self._resume_programme("paused")
        for act in self.acts.values():
            if act.status == "paused" and act.until == day:
                self._resume_activity(act, day)
        while self.next < len(self.queue) and self.queue[self.next].from_date <= day:
            change = self.queue[self.next]
            self.next += 1
            if change.from_date == day and self.status in ("running", "paused"):
                self._apply(change, day)
        if advanced:
            for act in self.acts.values():
                if act.status == "paused":
                    act.offset += 1
                    act.bumped = True

    # -- state changes --

    def _pause_programme(self, day: date, until: date | None, reason: str | None) -> None:
        self.pause = _Pause(day, self.pw, until, reason)
        self.status = "paused"
        if until is None:
            remaining = self.programme.weeks - self.pw + 1
            self.horizon = _monday(day) + timedelta(weeks=remaining)

    def _resume_programme(self, at: str) -> None:
        assert self.pause is not None
        if at == "next" and self.pause.programme_week < self.programme.weeks:
            self.pw = self.pause.programme_week + 1
            for act in self.acts.values():
                if act.status == "paused":
                    act.offset += 1
        self.status, self.pause = "running", None

    def _resume_activity(self, act: _Act, day: date) -> None:
        act.status, act.until, act.reason = "running", None, None
        if day.weekday() != 0 and act.bumped:
            act.offset -= 1
            act.bumped = False

    def week_now(self, act: _Act) -> int:
        """The activity week a change on an activity lands on: the one it is in, or for a
        paused activity the one it comes back at."""
        if act.status == "paused":
            return (act.last_week or 0) + 1
        return self.pw - act.offset

    def series_at(self, act: _Act, name: Field, week: int) -> Series:
        """The latest segment that starts at or before `week`: the programme's own series starts
        at week 1, so there is always one."""
        return next(s for s in reversed(act.segments[name]) if s.origin <= week)

    def base_value(self, act: _Act, name: Field, week: int, day: date) -> Decimal:
        """The value the rule shows: from the sealed record when the day is sealed (P1)."""
        record = self.sealed.get(day)
        held = record.activities.get(act.key) if record is not None else None
        if held is not None and held.base is not None and name in held.base:
            return Decimal(str(held.base[name]))
        return self.series_at(act, name, week).value(week)

    def _set_value(self, act: _Act, name: Field, value: Decimal) -> None:
        week = self.week_now(act)
        if week >= 1 and name in act.segments:
            current = self.series_at(act, name, week)
            act.segments[name].append(replace(current, start=value, origin=week))

    def _set_series(
        self,
        act: _Act,
        name: Field,
        day: date,
        *,
        start: Decimal | None = None,
        add: Decimal | None = None,
        rate: Decimal | None = None,
    ) -> None:
        """A new segment from this week: at `start`, else the value shown; with `add` or `rate`,
        else the current increase."""
        week = self.week_now(act)
        if week < 1 or name not in act.segments:
            return
        current = self.series_at(act, name, week)
        if add is None and rate is None:
            add, rate = current.add, current.rate
        act.segments[name].append(
            Series(
                start=start if start is not None else self.base_value(act, name, week, day),
                step=current.step,
                add=add,
                rate=rate,
                every=current.every,
                max=current.max,
                origin=week,
            )
        )

    def _apply(self, change: Change, day: date) -> None:
        body = change.body
        kind = body.get("type")
        key = body.get("activity")
        act = self.acts.get(key) if isinstance(key, str) else None
        live = act is not None and act.status != "ended"
        name = cast(Field, body.get("field"))
        if kind == "pause-programme" and self.status == "running":
            weeks = body.get("weeks")
            until = day + timedelta(weeks=weeks) if isinstance(weeks, int) else None
            self._pause_programme(day, until, change.reason)
        elif kind == "resume-programme" and self.status == "paused":
            self._resume_programme(str(body.get("at", "paused")))
        elif kind == END_PROGRAMME and change.seq in self.reopened:
            # Paused until the re-open's day; a pause already in force runs to it (K165).
            until = self.reopened[change.seq]
            if self.pause is None:
                self._pause_programme(day, until, change.reason)
            else:
                self.pause.until = until
        elif kind == REOPEN_PROGRAMME and self.pause is not None and self.pause.until == day:
            # Re-opened on the end's own day: `_step` resumes a pause due on any later one.
            self._resume_programme("paused")
        elif kind == "go-to-week" and self.status == "running":
            delta = int(body["week"]) - self.pw
            self.pw += delta
            for other in self.acts.values():
                if other.status == "paused":
                    other.offset += delta
        elif kind == "pause-activity" and act is not None and act.status == "running":
            weeks = body.get("weeks")
            act.status = "paused"
            act.until = day + timedelta(weeks=weeks) if isinstance(weeks, int) else None
            act.reason = change.reason
        elif kind == "resume-activity" and act is not None and act.status == "paused":
            self._resume_activity(act, day)
            for key, value in (body.get("values") or {}).items():
                self._set_value(act, cast(Field, key), Decimal(str(value)))
        elif kind == "add-activity":
            self._add(change, day)
        elif kind == "end-activity" and act is not None and live:
            act.status, act.ended_on = "ended", day
            act.deleted = not act.appeared
        elif kind == "set-value" and act is not None and live:
            self._set_value(act, name, Decimal(str(body["value"])))
        elif kind == "set-increase" and act is not None and live:
            add, rate = body.get("add"), body.get("rate")
            self._set_series(
                act,
                name,
                day,
                add=None if add is None else Decimal(str(add)),
                rate=None if rate is None else Decimal(str(rate)),
            )
        elif kind == "set-parameter" and body.get("param") in self.params:
            self._set_parameter(str(body["param"]), Decimal(str(body["value"])), day)
        elif kind == "edit-week" and act is not None:
            self.hands.append(
                _Hand(
                    change.seq,
                    act.key,
                    int(body["week"]),
                    name,
                    Decimal(str(body["value"])),
                    day,
                    change.made_at.date(),
                )
            )
        for seq in body.get("dropHandEdits") or ():
            for hand in self.hands:
                if hand.seq == seq and hand.dropped_on is None:
                    hand.dropped_on = day

    def _add(self, change: Change, day: date) -> None:
        kind = self.programme.kind
        activity, _ = parse_activity(change.body.get("activity"), kind, self.params, "activity")
        if activity is None or activity.key in self.acts:
            return
        series, problems = resolve_activity(activity, kind, self.params, "activity")
        if problems:
            return
        self.acts[activity.key] = _Act(
            key=activity.key,
            activity=activity,
            segments={f: [s] for f, s in series.items()},
            offset=self.pw - 1,
            added_on=day,
            added_by=change.seq,
        )

    def _set_parameter(self, key: str, value: Decimal, day: date) -> None:
        self.params[key] = value
        for act in self.acts.values():
            if act.status == "ended":
                continue
            for name, rule in act.activity.values.items():
                start = value if rule.start == key else None
                add = value if rule.add == key else None
                rate = value if rule.rate == key else None
                if start is None and add is None and rate is None:
                    continue
                if start is not None and add is None and rate is None:
                    self._set_series(act, name, day, start=start)
                else:
                    self._set_series(act, name, day, start=start, add=add, rate=rate)

    # -- a day --

    def _hand_at(self, act: _Act, name: Field, day: date) -> _Hand | None:
        for hand in reversed(self.hands):
            if (
                hand.key == act.key
                and hand.field == name
                and hand.programme_week == self.pw
                and (hand.dropped_on is None or day < hand.dropped_on)
            ):
                return hand
        return None

    def _values(self, act: _Act, week: int) -> PlanValues:
        """The rule's values for an activity week: no override, no hand-edit."""
        return {
            name: _plain(self.rules[name], self.series_at(act, name, week).value(week))
            for name in act.segments
        }

    def _running(self, act: _Act, week: int, day: date) -> ActivityDay:
        values: PlanValues = {}
        hand: dict[str, HandMark] = {}
        base = self._values(act, week)
        for name in act.segments:
            rule = self.rules[name]
            edit = self._hand_at(act, name, day)
            if edit is not None:
                values[name] = _plain(rule, edit.value)
                hand[name] = HandMark(seq=edit.seq, made_on=edit.made_on, rule=base[name])
                continue
            override = self.programme.override_at(self.pw, act.key, name)
            values[name] = _plain(rule, self.series_at(act, name, week).value(week, override))
        if act.activity.per_side is not None:
            values["perSide"] = act.activity.per_side
        return ActivityDay(state="running", activity_week=week, values=values, base=base, hand=hand)

    def _emit(self, day: date) -> DayPlan:
        if self.status == "before":
            return DayPlan(
                date=day,
                status="before-start",
                activities={k: ActivityDay(state="not-started") for k in self.acts},
            )
        acts: dict[str, ActivityDay] = {}
        for key, act in self.acts.items():
            week = self.pw - act.offset
            if act.status == "ended":
                acts[key] = ActivityDay(state="ended")
            elif act.status == "paused" or self.status == "paused":
                if act.status == "paused":
                    week = (act.last_week or 0) + 1
                    until, reason = act.until, act.reason
                else:
                    assert self.pause is not None
                    until, reason = self.pause.until, self.pause.reason
                if week < 1:
                    acts[key] = ActivityDay(state="not-started")
                    continue
                values = self._values(act, week)
                act.appeared = True
                acts[key] = ActivityDay(
                    state="paused",
                    activity_week=week,
                    values=values,
                    base=values,
                    until=until,
                    reason=reason,
                )
            elif week < 1:
                acts[key] = ActivityDay(state="not-started")
            else:
                acts[key] = self._running(act, week, day)
                act.appeared, act.last_week = True, week
        paused = self.status == "paused" and self.pause is not None
        return DayPlan(
            date=day,
            status="paused" if paused else "running",
            programme_week=self.pw,
            label=None if paused else self.programme.label_at(self.pw),
            until=self.pause.until if self.pause is not None else None,
            reason=self.pause.reason if self.pause is not None else None,
            activities=acts,
        )

    def project(self, monday: date) -> list[ProjectedWeek]:
        """The weeks after an open-ended pause, resumed at the paused week on `monday`."""
        self.queue, self.next = [], 0
        self._resume_programme("paused")
        out: list[ProjectedWeek] = []
        day = monday
        while True:
            if day > monday:
                self._step(day)
                if self.status == "ended":
                    return out
            plan = self._emit(day)
            if day.weekday() == 6:
                out.append(
                    ProjectedWeek(
                        programme_week=self.pw, label=plan.label, activities=plan.activities
                    )
                )
            day += timedelta(days=1)


def rev_of(changes: Sequence[Change]) -> str:
    """The log's revision token: a hash of every change, in `seq` order (§7.3). A confirm sends
    back the preview's; a different one means the log changed since. `undone_by` is left out:
    it follows from the undo rows, which are in the hash."""
    rows = [
        [c.seq, c.from_date.isoformat(), c.made_at.isoformat(), c.body, c.reason]
        for c in sorted(changes, key=lambda c: c.seq)
    ]
    return _hash(rows)


def confirm_token(rev: str, change: Change) -> str:
    """The token a preview gives and its confirm sends back (§7.3, P2): a hash of the log's `rev`
    and of exactly what the confirm appends, the change's body (`dropHandEdits` included), its
    from day and its reason. The log's rev alone, another change, or the log changed since gives
    another token. `seq` follows from the log and `made_at` from the clock, so neither is in it."""
    return _hash(
        {
            "rev": rev,
            "change": change.body,
            "from": change.from_date.isoformat(),
            "reason": change.reason,
        }
    )


def _hash(value: object) -> str:
    """The first 16 hex digits of the SHA-256 of `value` as sorted-key compact JSON."""
    text = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _simulate(
    run: Run,
    changes: Sequence[Change],
    sealed: Mapping[date, DayPlan] | None,
    *,
    until: date | None = None,
) -> tuple[_Sim, Replay]:
    sim = _Sim(run, changes, sealed or {})
    after = sim.run_days(until=until)
    final = sim
    projected: list[ProjectedWeek] = []
    open_pause = None
    if sim.status == "paused" and sim.pause is not None and sim.pause.until is None:
        open_pause = OpenPause(
            since=sim.pause.since,
            programme_week=sim.pause.programme_week,
            reason=sim.pause.reason,
        )
        final = copy.deepcopy(sim)
        projected = final.project(after)
    gone = {k for k, a in sim.acts.items() if a.deleted}
    days = []
    for plan in sim.days:
        record = sim.sealed.get(plan.date)
        if record is not None:
            plan = replace(record, sealed=True)
        elif gone:
            acts = {k: v for k, v in plan.activities.items() if k not in gone}
            plan = replace(plan, activities=acts)
        days.append(plan)
    weeks = tuple(
        WeekPlan(monday=days[i].date, days=tuple(days[i : i + 7])) for i in range(0, len(days), 7)
    )
    weeks_n = run.programme.weeks
    ends_short = tuple(
        EndsShort(key=a.key, name=a.activity.name, week=a.last_week, of=weeks_n)
        for a in final.acts.values()
        if a.status != "ended" and a.last_week is not None and a.last_week < weeks_n
    )
    rp = Replay(
        run=run,
        weeks=weeks,
        activities=tuple(
            RunActivity(
                key=a.key,
                name=a.activity.name,
                activity=a.activity,
                added_on=a.added_on,
                added_by=a.added_by,
                ended_on=a.ended_on,
                deleted=a.deleted,
            )
            for a in sim.acts.values()
        ),
        params=dict(sim.params),
        end=sim.end,
        open_pause=open_pause,
        when_resumed=tuple(projected),
        ends_short=ends_short,
        hand_edits=tuple(
            HandEdit(
                seq=h.seq,
                key=h.key,
                programme_week=h.programme_week,
                field=h.field,
                value=h.value,
                from_date=h.from_date,
                made_on=h.made_on,
                dropped_on=h.dropped_on,
            )
            for h in sim.hands
        ),
        undone=dict(sim.undone),
        rev=rev_of(changes),
    )
    return sim, rp


def replay(
    run: Run,
    changes: Sequence[Change],
    *,
    sealed: Mapping[date, DayPlan] | None = None,
    until: date | None = None,
) -> Replay:
    """Every day of the run from its log (§5). `sealed` holds the sealed days by date, which
    replace the computed ones. `until` keeps an open-ended pause's paused weeks going to at
    least that day."""
    return _simulate(run, changes, sealed, until=until)[1]


# ---- Checking a change ----


@dataclass
class _Check:
    run: Run
    changes: Sequence[Change]
    body: Mapping[str, Any]
    from_date: date
    today: date
    sealed: Mapping[date, DayPlan] | None
    errors: list[ProgrammeError] = field(default_factory=list)

    def error(self, path: str, message: str) -> None:
        self.errors.append(ProgrammeError(path, message))

    @property
    def kind(self) -> str:
        return str(self.body["type"])

    def check(self) -> None:
        for key in self.body:
            if key != "type" and key not in CHANGE_KEYS[self.kind]:
                self.error(json_path("", key), UNKNOWN_KEY)
        if self.from_date < self.today:
            self.error("from", "a change starts today or later.")
        if self.from_date < self.run.start:
            self.error("from", f"the programme starts on {_day(self.run.start)}.")
            return
        _, current = _simulate(self.run, self.changes, self.sealed, until=self.from_date)
        if current.end is not None and self.from_date > current.end:
            self.error("from", "the programme has ended by then.")
            return
        sim = _Sim(self.run, self.changes, self.sealed or {})
        sim.run_days(until=self.from_date, stop=self.from_date)
        before = len(self.errors)
        getattr(self, "_" + self.kind.replace("-", "_"))(sim, current)
        self._drops(current)
        if len(self.errors) == before:
            self._ranges()

    # -- pieces --

    def _weeks(self, path: str) -> None:
        if path in self.body and whole_in(self.body[path], 1, MAX_WEEKS) is None:
            self.error(path, f"give a whole number of weeks from 1 to {MAX_WEEKS}.")

    def _activity(self, sim: _Sim, current: Replay) -> _Act | None:
        key = self.body.get("activity")
        act = sim.acts.get(key) if isinstance(key, str) else None
        if act is None or act.deleted:
            self.error("activity", f"there is no activity called {key}.")
            return None
        on = _day(self.from_date)
        if act.status == "ended":
            self.error("activity", f"{key} has ended by {on}.")
            return None
        if act.status == "running" and sim.week_now(act) < 1:
            self.error("activity", f"{key} hasn't started by {on}.")
            return None
        return act

    def _field(self, act: _Act, name: object, path: str) -> FieldRule | None:
        rules = KIND_FIELDS[self.run.programme.kind]
        if not isinstance(name, str) or name not in FIELDS:
            self.error(path, f"give one of {', '.join(rules)}.")
            return None
        rule = rules.get(name)
        if rule is None:
            self.error(path, f"a {self.run.programme.kind} activity has no {name}.")
            return None
        if rule.name not in act.segments:
            self.error(path, f"{act.key} has no {name}.")
            return None
        return rule

    def _value(
        self, raw: object, path: str, rule: FieldRule, step: Decimal | None
    ) -> Decimal | None:
        value = as_decimal(raw)
        if value is None or not rule.fits(value):
            self.error(path, f"give {rule.domain}.")
            return None
        if step is not None and not _is_multiple(value, step):
            text = number_text(step)
            self.error(
                path, f"the {rule.name} goes in steps of {text}, so give a multiple of {text}."
            )
            return None
        return value

    def _set_field(self, sim: _Sim, act: _Act, name: object, path: str, raw: object) -> None:
        rule = self._field(act, name, "field" if path == "value" else path)
        if rule is not None:
            step = sim.series_at(act, rule.name, sim.week_now(act)).step
            self._value(raw, path, rule, step)

    # -- one method per type --

    def _pause_programme(self, sim: _Sim, current: Replay) -> None:
        self._weeks("weeks")
        if sim.status == "paused":
            self.error("", f"the programme is already paused on {_day(self.from_date)}.")

    def _resume_programme(self, sim: _Sim, current: Replay) -> None:
        at = self.body.get("at", "paused")
        if at not in ("paused", "next"):
            self.error("at", 'give "paused" or "next".')
        if sim.status != "paused" or sim.pause is None:
            self.error("", f"the programme isn't paused on {_day(self.from_date)}.")
        elif at == "next" and sim.pause.programme_week >= self.run.programme.weeks:
            self.error("at", f"week {self.run.programme.weeks} is the last week.")

    def _go_to_week(self, sim: _Sim, current: Replay) -> None:
        weeks = self.run.programme.weeks
        if whole_in(self.body.get("week"), 1, weeks) is None:
            self.error("week", f"give a week from 1 to {weeks}.")
        if sim.status == "paused":
            self.error("", f"the programme is paused on {_day(self.from_date)}. Resume it first.")

    def _pause_activity(self, sim: _Sim, current: Replay) -> None:
        self._weeks("weeks")
        act = self._activity(sim, current)
        if act is not None and act.status == "paused":
            self.error("activity", f"{act.key} is already paused on {_day(self.from_date)}.")

    def _resume_activity(self, sim: _Sim, current: Replay) -> None:
        act = self._activity(sim, current)
        if act is not None and act.status != "paused":
            self.error("activity", f"{act.key} isn't paused on {_day(self.from_date)}.")
        values = self.body.get("values")
        if values is None:
            return
        if not isinstance(values, Mapping) or not values:
            self.error("values", 'give the fields it resumes at, such as {"weight": 70}.')
            return
        if act is not None:
            for name, raw in values.items():
                self._set_field(sim, act, name, json_path("values", name), raw)

    def _add_activity(self, sim: _Sim, current: Replay) -> None:
        kind = self.run.programme.kind
        activity, problems = parse_activity(self.body.get("activity"), kind, sim.params, "activity")
        self.errors.extend(problems)
        if activity is None:
            return
        if activity.key in sim.acts:
            self.error("activity.key", f"{activity.key} is already an activity of this run.")
        self.errors.extend(resolve_activity(activity, kind, sim.params, "activity")[1])

    def _end_activity(self, sim: _Sim, current: Replay) -> None:
        self._activity(sim, current)

    def _set_value(self, sim: _Sim, current: Replay) -> None:
        act = self._activity(sim, current)
        if act is not None:
            self._set_field(sim, act, self.body.get("field"), "value", self.body.get("value"))

    def _set_increase(self, sim: _Sim, current: Replay) -> None:
        act = self._activity(sim, current)
        rule = self._field(act, self.body.get("field"), "field") if act is not None else None
        add, rate = self.body.get("add"), self.body.get("rate")
        if "add" in self.body and "rate" in self.body:
            self.error("rate", "a progression has add or rate, not both.")
        elif "add" not in self.body and "rate" not in self.body:
            self.error("add", "give add or rate.")
        elif "rate" in self.body:
            value = as_decimal(rate)
            if value is None or not fits_rate(value):
                self.error("rate", f"give {RATE_DOMAIN}.")
        elif rule is not None:
            value = as_decimal(add)
            if value is None or not rule.fits_add(value):
                self.error("add", f"give {rule.add_domain}.")

    def _set_parameter(self, sim: _Sim, current: Replay) -> None:
        key = self.body.get("param")
        param = self.run.programme.params.get(key) if isinstance(key, str) else None
        if param is None:
            self.error("param", f"the programme has no parameter called {key}.")
            return
        problem = param_problem(param, as_decimal(self.body.get("value")))
        if problem is not None:
            self.error("value", problem)

    def _edit_week(self, sim: _Sim, current: Replay) -> None:
        weeks = self.run.programme.weeks
        week = whole_in(self.body.get("week"), 1, weeks)
        if week is None:
            self.error("week", f"give a week from 1 to {weeks}.")
        act = self._activity(sim, current)
        rule = self._field(act, self.body.get("field"), "field") if act is not None else None
        if rule is not None:
            self._value(self.body.get("value"), "value", rule, None)
        if week is not None and not _week_ahead(current, week, self.from_date):
            self.error("week", f"week {week} has no days left to change.")

    def _undo(self, sim: _Sim, current: Replay) -> None:
        seq = self.body.get("change")
        target = next((c for c in self.changes if c.seq == seq and type(seq) is int), None)
        if target is None:
            self.error("change", "give the number of a change in the log.")
        elif target.body.get("type") == "undo":
            self.error("change", f"change {seq} is an undo. Make the change again instead.")
        elif target.seq in current.undone:
            self.error("change", f"change {seq} is already undone.")
        elif target.from_date < self.today:
            self.error(
                "change",
                f"change {seq} started on {_day(target.from_date)}, before today, so it can't be "
                "undone.",
            )

    def _drops(self, current: Replay) -> None:
        drops = self.body.get("dropHandEdits")
        if drops is None:
            return
        if not isinstance(drops, list):
            self.error("dropHandEdits", "give a list of hand-edits by change number.")
            return
        live = {h.seq for h in current.hand_edits if h.dropped_on is None}
        for i, seq in enumerate(drops):
            # The type first: a list or an object can't be looked up in a set.
            if type(seq) is not int:
                self.error(f"dropHandEdits[{i}]", "give a hand-edit by its change number.")
            elif seq not in live:
                self.error(
                    f"dropHandEdits[{i}]", f"change {seq} isn't a hand-edit that still applies."
                )

    # -- every week's value --

    def _ranges(self) -> None:
        new = _next_change(self.changes, self.body, self.from_date, self.today, None)
        after = replay(self.run, [*self.changes, new], sealed=self.sealed)
        rules = KIND_FIELDS[self.run.programme.kind]
        names = {a.key: a.name for a in after.activities}
        seen: set[tuple[str, str]] = set()
        days = [
            (day.programme_week, day.activities)
            for w in after.weeks
            for day in w.days
            if day.date >= self.from_date and day.status == "running"
        ]
        days += [(w.programme_week, w.activities) for w in after.when_resumed]
        path = _RANGE_PATH.get(self.kind)
        if self.kind == "set-increase":
            path = "add" if "add" in self.body else "rate"
        for week, acts in days:
            for key, act in acts.items():
                if act.state != "running" or act.values is None or week is None:
                    continue
                for name, value in act.values.items():
                    rule = rules.get(cast(Field, name))
                    if rule is None or (key, name) in seen or isinstance(value, bool):
                        continue
                    problem = rule.out_of_range(week, Decimal(str(value)))
                    if problem is None:
                        continue
                    seen.add((key, name))
                    if self.kind == "add-activity":
                        self.error(f"activity.{name}", problem)
                    elif self.kind == "resume-activity":
                        self.error(json_path("values", name), problem)
                    elif path is not None:
                        self.error(path, problem)
                    else:
                        self.error("", f"{names[key]}: {problem}")


def _is_multiple(value: Decimal, step: Decimal) -> bool:
    return (value / step) == (value / step).to_integral_value()


def _week_ahead(current: Replay, week: int, from_date: date) -> bool:
    """Whether programme week `week` has a day on or after `from_date` to change."""
    for plan in current.weeks:
        for day in plan.days:
            if (
                day.date >= from_date
                and day.programme_week == week
                and day.status != "before-start"
            ):
                return True
    return any(w.programme_week == week for w in current.when_resumed)


def _next_change(
    changes: Sequence[Change],
    body: Mapping[str, Any],
    from_date: date,
    today: date,
    made_at: datetime | None,
    reason: str | None = None,
) -> Change:
    return Change(
        seq=max((c.seq for c in changes), default=0) + 1,
        from_date=from_date,
        made_at=made_at or datetime.combine(today, datetime.min.time()),
        body=body,
        reason=reason,
    )


def check_change(
    run: Run,
    changes: Sequence[Change],
    body: object,
    *,
    from_date: date,
    today: date,
    sealed: Mapping[date, DayPlan] | None = None,
) -> list[ProgrammeError]:
    """Every problem with a change to the run, as paths into the body and sentences: [] when it
    can be made. Checked against the run as it stands on the from day, and every week after it
    against the item's limits."""
    if not isinstance(body, Mapping):
        return [ProgrammeError("", "a change is a JSON object.")]
    if body.get("type") not in CHANGE_TYPES:
        return [ProgrammeError("type", f"give one of {', '.join(CHANGE_TYPES)}.")]
    check = _Check(run, changes, body, from_date, today, sealed)
    check.check()
    return check.errors


# ---- The preview ----


@dataclass(frozen=True, kw_only=True)
class CellChange:
    """One cell a change alters: an activity's field in a calendar week, or (with `field`
    None) its state. `before` and `after` are from the last day in the week that differs."""

    monday: date
    key: str
    field: str | None
    before: int | float | bool | str | None
    after: int | float | bool | str | None
    #: The first day in the week that differs.
    starts: date
    programme_week: int | None


@dataclass(frozen=True, kw_only=True)
class Blocking:
    """A hand-edit that keeps its value though the change alters its week's rule (§7.2)."""

    seq: int
    key: str
    field: Field
    programme_week: int
    value: Decimal
    made_on: date
    unit: str

    @property
    def message(self) -> str:
        return (
            f"Week {self.programme_week} keeps the {number_text(self.value)} {self.unit} set on "
            f"{self.made_on.day} {self.made_on:%b}."
        )


@dataclass(frozen=True, kw_only=True)
class Preview:
    before: Replay
    after: Replay
    cells: tuple[CellChange, ...]
    blocking: tuple[Blocking, ...]
    ends_short: tuple[EndsShort, ...]
    #: The log's revision now.
    rev: str
    #: What a confirm sends back (`confirm_token`): a different one means another change, or a
    #: stale preview.
    token: str
    #: The change to append when confirmed.
    change: Change
    #: For an undo, the change it reverses (W4 sets that row's `undone_by`).
    undoes: int | None
    #: For an end-activity on an activity with no days yet, its key: W4 deletes it outright.
    deletes: str | None


def _day_or_none(rp: Replay, when: date) -> DayPlan | None:
    try:
        return rp.day(when)
    except KeyError:
        return None


def _cells(before: Replay, after: Replay, from_date: date) -> list[CellChange]:
    out: list[CellChange] = []
    mondays = sorted(
        {w.monday for w in (*before.weeks, *after.weeks) if w.monday >= _monday(from_date)}
    )
    keys = [a.key for a in after.activities]
    keys += [a.key for a in before.activities if a.key not in keys]
    for monday in mondays:
        days = [monday + timedelta(days=i) for i in range(7)]
        days = [day for day in days if day >= from_date]
        for key in keys:
            found: dict[str | None, tuple[date, date, Any, Any, int | None]] = {}
            for day in days:
                b_day, a_day = _day_or_none(before, day), _day_or_none(after, day)
                b = b_day.activities.get(key) if b_day else None
                a = a_day.activities.get(key) if a_day else None
                week = a_day.programme_week if a_day else None
                diffs: dict[str | None, tuple[Any, Any]] = {}
                if (b and b.state) != (a and a.state):
                    diffs[None] = (b.state if b else None, a.state if a else None)
                elif b is not None and a is not None and b.values and a.values:
                    for value_key in dict.fromkeys([*b.values, *a.values]):
                        if b.values.get(value_key) != a.values.get(value_key):
                            diffs[value_key] = (b.values.get(value_key), a.values.get(value_key))
                for cell, (old, new) in diffs.items():
                    first = found[cell][0] if cell in found else day
                    found[cell] = (first, day, old, new, week)
            for cell, (first, _, old, new, week) in found.items():
                out.append(
                    CellChange(
                        monday=monday,
                        key=key,
                        field=cell,
                        before=old,
                        after=new,
                        starts=first,
                        programme_week=week,
                    )
                )
    return out


def _rules_by_week(rp: Replay, from_date: date) -> dict[tuple[str, int, str], int | float]:
    """Each hand-edited cell's rule value, by activity, programme week and field."""
    out: dict[tuple[str, int, str], int | float] = {}
    for week in rp.weeks:
        for day in week.days:
            if day.date < from_date or day.programme_week is None:
                continue
            for key, act in day.activities.items():
                for name, mark in act.hand.items():
                    out.setdefault((key, day.programme_week, name), mark.rule)
    return out


def _blocking(before: Replay, after: Replay, from_date: date) -> list[Blocking]:
    rules = KIND_FIELDS[after.run.programme.kind]
    old, new = _rules_by_week(before, from_date), _rules_by_week(after, from_date)
    out: list[Blocking] = []
    for edit in after.hand_edits:
        cell = (edit.key, edit.programme_week, edit.field)
        if edit.dropped_on is None and cell in new and old.get(cell, new[cell]) != new[cell]:
            out.append(
                Blocking(
                    seq=edit.seq,
                    key=edit.key,
                    field=edit.field,
                    programme_week=edit.programme_week,
                    value=edit.value,
                    made_on=edit.made_on,
                    unit=rules[edit.field].unit,
                )
            )
    return out


def preview_change(
    run: Run,
    changes: Sequence[Change],
    body: object,
    *,
    from_date: date,
    today: date,
    made_at: datetime,
    reason: str | None = None,
    sealed: Mapping[date, DayPlan] | None = None,
) -> Preview:
    """What a change does, before it is made (§7.3). Raises `ProgrammeInvalid` with every
    problem when it can't be made."""
    errors = check_change(run, changes, body, from_date=from_date, today=today, sealed=sealed)
    if errors:
        raise ProgrammeInvalid(errors)
    assert isinstance(body, Mapping)
    new = _next_change(changes, body, from_date, today, made_at, reason)
    before = replay(run, changes, sealed=sealed)
    after = replay(run, [*changes, new], sealed=sealed)
    deletes = None
    if body["type"] == "end-activity":
        ended = next(a for a in after.activities if a.key == body["activity"])
        deletes = ended.key if ended.deleted else None
    return Preview(
        before=before,
        after=after,
        cells=tuple(_cells(before, after, from_date)),
        blocking=tuple(_blocking(before, after, from_date)),
        ends_short=after.ends_short,
        rev=before.rev,
        token=confirm_token(before.rev, new),
        change=new,
        undoes=body["change"] if body["type"] == "undo" else None,
        deletes=deletes,
    )


# ---- For W4: plan items and sealed days ----


def week_goal(days: Iterable[ActivityDay]) -> int:
    """An item's goal for a calendar week (§6.2, K163): the sum of each day's target over 7,
    rounded up. A day the activity isn't running counts 0: paused, not started, ended, or left
    out (a day after the run's last). A week with one target all week keeps it: John's squat at
    3, run Monday and Tuesday and paused from Wednesday, has a goal of 1. Exact: a Fraction, never
    a float."""
    total = sum(
        (
            Fraction(a.values.get("target", 0))
            for a in days
            if a.state == "running" and a.values is not None
        ),
        Fraction(0),
    )
    return math.ceil(total / 7)


def week_days(week: WeekPlan, key: str, last: date | None = None) -> list[ActivityDay]:
    """An activity's days in a calendar week, as its goal counts them: the days it exists on, up
    to `last` (the run's last day after End programme, which the replay passes by)."""
    return [
        day.activities[key]
        for day in week.days
        if key in day.activities and (last is None or day.date <= last)
    ]


def week_items(
    rp: Replay, week: WeekPlan, ids: Mapping[str, str], *, last: date | None = None
) -> list[Item]:
    """One calendar week as `plans` items, given each activity's item id. An activity is in the
    week when it runs or is paused on one of its days. The item has Sunday's values, or the last
    values it had in the week when it isn't running on Sunday, and the week's goal (`week_goal`,
    K163). Days after `last` count 0 in the goal: End programme's day on."""
    normalise = validate.KIND_NORMALISERS[rp.run.programme.kind]
    items: list[Item] = []
    for activity in rp.activities:
        days = [day.activities[activity.key] for day in week.days if activity.key in day.activities]
        present = [a for a in days if a.state in ("running", "paused") and a.values is not None]
        if not present:
            continue
        sunday = days[-1]
        running = [a for a in days if a.state == "running"]
        values = (sunday if sunday.state == "running" else (running or present)[-1]).values or {}
        target = week_goal(week_days(week, activity.key, last))
        item = normalise(
            {"id": ids[activity.key], "name": activity.name, **values, "target": target}
        )
        assert item is not None
        items.append(item)
    return items


def _date_or_none(text: object) -> date | None:
    return date.fromisoformat(str(text)) if text is not None else None


def day_to_json(day: DayPlan) -> dict[str, Any]:
    """A day as JSON, for `programme_days.items_json` (§8)."""
    return {
        "date": day.date.isoformat(),
        "status": day.status,
        "programmeWeek": day.programme_week,
        "label": day.label,
        "until": day.until.isoformat() if day.until else None,
        "reason": day.reason,
        "sealed": day.sealed,
        "activities": {
            key: {
                "state": act.state,
                "activityWeek": act.activity_week,
                "values": act.values,
                "base": act.base,
                "hand": {
                    name: {"change": m.seq, "madeOn": m.made_on.isoformat(), "rule": m.rule}
                    for name, m in act.hand.items()
                },
                "until": act.until.isoformat() if act.until else None,
                "reason": act.reason,
            }
            for key, act in day.activities.items()
        },
    }


def day_from_json(raw: Mapping[str, Any]) -> DayPlan:
    """A day stored by `day_to_json`."""
    acts: dict[str, ActivityDay] = {}
    for key, act in raw["activities"].items():
        acts[key] = ActivityDay(
            state=act["state"],
            activity_week=act["activityWeek"],
            values=act["values"],
            base=act["base"],
            hand={
                name: HandMark(
                    seq=m["change"], made_on=date.fromisoformat(m["madeOn"]), rule=m["rule"]
                )
                for name, m in act["hand"].items()
            },
            until=_date_or_none(act["until"]),
            reason=act["reason"],
        )
    return DayPlan(
        date=date.fromisoformat(raw["date"]),
        status=raw["status"],
        programme_week=raw["programmeWeek"],
        label=raw["label"],
        until=_date_or_none(raw["until"]),
        reason=raw["reason"],
        activities=acts,
        sealed=raw["sealed"],
    )
