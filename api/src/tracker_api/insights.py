"""Read-only views of a user's tracking, counted the way the web app's screen counts them.

The pure rules port `planSource` (src/lib/plans.ts), the default plans (src/lib/storage.ts) and
the goal and met-day rules (src/lib/tracker.ts). `tests/test_insights.py` runs the shared
fixtures in `fixtures/insights/`, which src/lib/__tests__/insights-parity.spec.ts runs too, so an
answer about a week never contradicts what the week shows.

The readers above them take a connection, a user id and `today` (the asker's date: the server
cannot know the browser's), and return plain JSON with snake_case keys and Monday `YYYY-MM-DD`
week keys. They read only that user's rows, write nothing, and carry no user or session fields.
Names and notes are cut in their output, since they reach a model as text (docs/api.md §1),
except `item_history`'s note: one item's, given whole so it can be read before it is rewritten.

Each reader takes a tracker (`tracker_of`): its id, or its name without regard to case. A tracker
shows in a week by `data.shows_in` (spec §2), and the readers follow it: a week it doesn't show in
is refused, left out or read as empty, as each reader says.

A tracker keeps its own daily target (W4). While Daily goal is off (K85) the readers give no daily
target and no met days: those fields are None, never False or 0, so nothing reads as a day missed.
A cardio tracker has no daily target at all (K90), so its are None whatever the switch says. The
rules above stay as they are; the switch applies where a reader builds its output. Item goals don't
depend on it.
"""

import copy
import sqlite3
from collections.abc import Mapping, Sequence
from datetime import date, timedelta
from typing import NotRequired, TypedDict, cast

from .data import load_settings, load_tracked, load_trackers, notes_of, shows_in
from .types import CARDIO, TYPES, TypeId
from .validate import (
    MAX_NOTES,
    DetailsMap,
    Item,
    MarkKind,
    Portable,
    Tracked,
    Tracker,
    is_week,
)

#: An item's name in a reader's output, in characters. Names are stored uncapped.
MAX_NAME = 100

type WeekLog = Mapping[str, Sequence[str | None]]


def default_items(tracker_id: str) -> list[Item]:
    """The items a week shows while nothing is planned (spec §4, "Default items"): storage.ts's
    defaultExercises on the `exercise` tracker and defaultFoods on the `diet` tracker. Every
    other tracker starts empty: `cardio` (an account from before Cardio shows an empty section)
    and each tracker the person makes."""
    if tracker_id == "exercise":
        return [
            {"id": "pu", "name": "Push-ups", "reps": 10, "target": 4},
            {"id": "pl", "name": "Pull-ups", "reps": 3, "target": 4},
            {"id": "sq", "name": "Squats", "reps": 15, "target": 4},
            {"id": "be", "name": "Back extensions", "reps": 12, "target": 3},
            {"id": "kh", "name": "Kettlebell halos", "reps": 8, "perSide": True, "target": 3},
        ]
    if tracker_id == "diet":
        return [
            {"id": "veg", "name": "Vegetables", "target": 7},
            {"id": "fruit", "name": "Fruit", "target": 5},
            {"id": "fish", "name": "Fish", "target": 2},
            {"id": "nuts", "name": "Nuts", "target": 3},
        ]
    return []


def plan_source(plans: Mapping[str, object], week: str) -> str | None:
    """The week whose plan `week` shows: its own; else the latest earlier planned week (carry
    forward); else, for weeks before the first plan, the earliest one. None when nothing is
    planned yet. An empty plan is a plan."""
    if week in plans:
        return week
    # `YYYY-MM-DD` keys sort chronologically as strings.
    keys = sorted(plans)
    earlier = [k for k in keys if k < week]
    if earlier:
        return earlier[-1]
    return keys[0] if keys else None


def week_items(tracker_id: str, plans: Mapping[str, list[Item]], week: str) -> list[Item]:
    """The items `week` shows: its plan source's, or the tracker's defaults. A copy, safe to
    change."""
    source = plan_source(plans, week)
    return copy.deepcopy(plans[source]) if source is not None else default_items(tracker_id)


def _mark(week: WeekLog, item_id: str, day: int) -> str | None:
    days = week.get(item_id, ())
    return days[day] if day < len(days) else None


def total_for(week: WeekLog, item_id: str) -> int:
    """The item's marked days. Any mark counts: a partial day and a missed one too."""
    return sum(1 for m in week.get(item_id, ()) if m is not None)


def day_counts(items: Sequence[Item], week: WeekLog) -> list[int]:
    """How many of `items` are marked on each day. Marks for items not in `items` don't count."""
    return [sum(1 for it in items if _mark(week, it["id"], i) is not None) for i in range(7)]


def goal_met(total: int, target: int) -> bool:
    return target > 0 and total >= target


def goals_met(items: Sequence[Item], week: WeekLog) -> int:
    return sum(1 for it in items if goal_met(total_for(week, it["id"]), it["target"]))


def met_days(counts: Sequence[int], target: int) -> list[bool]:
    """The days whose marked items reach the day's target (exercises or foods a day)."""
    return [n >= target for n in counts]


def is_monday(key: str) -> bool:
    """A week key: `YYYY-MM-DD` in ASCII digits, a real date, and a Monday."""
    if not is_week(key):
        return False
    try:
        return date.fromisoformat(key).weekday() == 0
    except ValueError:
        return False


def monday_of(day: date) -> date:
    return date.fromordinal(day.toordinal() - day.weekday())


# --- The readers ---------------------------------------------------------------------------------

#: The most weeks one reader call covers: half a year.
MAX_WEEKS = 26


class InsightsError(ValueError):
    """An argument a reader refuses; `field` names it (`tracker`, `week`, `start`, `end` or
    `weeks`). Nothing was read."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.field = field


class Day(TypedDict):
    date: str
    #: The shown items marked on the day.
    count: int
    #: `count` reaches the daily target: the day's name is green on screen. None while Daily
    #: goal is off (K85).
    met: bool | None
    #: After `today`. A mark on a future day still counts, as on screen.
    future: bool


class ItemWeek(TypedDict):
    id: str
    name: str
    target: int
    #: A cardio item's session (K90), in the edit tools' words, when it has them: its whole
    #: duration in seconds and its distance in km.
    seconds: NotRequired[int]
    distance_km: NotRequired[int | float]
    #: "" when the item has none.
    notes: str
    #: Each day's mark kind, Monday first; the drawing is left out.
    marks: list[MarkKind | None]
    #: Every marked day, whatever its kind: what the goal counts.
    done: int
    great: int
    partial: int
    missed: int
    goal_met: bool


class WeekSummary(TypedDict):
    week: str
    #: The week whose plan this one shows (§2 of docs/architecture.md); None for the defaults.
    plan_week: str | None
    #: The week has no plan of its own: it shows `plan_week`'s, or the defaults.
    carried: bool
    #: Exercises a day or foods a day; None while Daily goal is off (K85), and always for cardio.
    daily_target: int | None
    days: list[Day]
    items: list[ItemWeek]
    goals_met: int
    #: None while Daily goal is off.
    days_met: int | None


class Weeks(TypedDict):
    #: The tracker's id.
    tracker: str
    start: str
    end: str
    weeks: list[WeekSummary]


class HistoryWeek(TypedDict):
    week: str
    #: The item is in what the week shows. When it isn't, its marks count for nothing on
    #: screen, so here they read as empty and `target` is None.
    in_plan: bool
    target: int | None
    marks: list[MarkKind | None]
    done: int
    great: int
    partial: int
    missed: int
    goal_met: bool


class ItemHistory(TypedDict):
    #: The tracker's id.
    tracker: str
    item_id: str
    #: Its name in the latest week that shows it; None when no week in the range does.
    name: str | None
    #: The item's whole note, uncut (up to 20,000 code points), the same in every week; "" when
    #: it has none. The readers of many items cut theirs at MAX_NOTES; read it here before
    #: writing one back.
    notes: str
    start: str
    end: str
    weeks: list[HistoryWeek]


class GoalItem(TypedDict):
    id: str
    name: str
    target: int
    #: As ItemWeek's: a cardio item's session, when it has them.
    seconds: NotRequired[int]
    distance_km: NotRequired[int | float]
    notes: str


class GoalTracker(TypedDict):
    """One tracker shown in the week, and its items' goals."""

    id: str
    name: str
    kind: TypeId
    #: How many items a day make a met day. None while Daily goal is off (K85), and always for a
    #: cardio tracker (K90).
    daily_target: int | None
    items: list[GoalItem]


class Goals(TypedDict):
    #: Today's week, whose plan the goals are.
    week: str
    #: The trackers this week shows, in the week's order.
    trackers: list[GoalTracker]
    #: Daily goal's setting: false says why there are no daily targets.
    daily_goal: bool
    #: The "My goals" note; "" when there is none.
    note: str
    #: The limits note (K107): what the person has to work around; "" when there is none.
    limits: str


class Consistency(TypedDict):
    #: The tracker's id.
    tracker: str
    start: str
    end: str
    today: str
    #: None while Daily goal is off (K85), and so are `days_met`, `met_day_rate` and
    #: `met_day_streak`.
    daily_target: int | None
    #: The days up to today, today included, in the weeks the tracker shows.
    days: int
    days_met: int | None
    #: `days_met / days`, to 2 places.
    met_day_rate: float | None
    #: The weeks whose Sunday is before today.
    finished_weeks: int
    #: Items with a goal above 0, counted once per finished week.
    goals: int
    goals_met: int
    #: `goals_met / goals`, to 2 places; None when there are no goals.
    goal_met_rate: float | None
    #: Met days in a row back from today. Today counts once met, and doesn't break the run
    #: before then.
    met_day_streak: int | None
    #: Finished weeks in a row, latest first, that met every goal above 0.
    goal_week_streak: int


class TrackerListed(TypedDict):
    id: str
    name: str
    kind: TypeId
    #: As `GoalTracker`'s: None while Daily goal is off, and always for a cardio tracker.
    daily_target: int | None
    #: The Monday of the week it was created in; None for the first three.
    start_week: str | None
    #: The Monday of the first week it no longer shows in; None while it is live.
    end_week: str | None
    #: It shows in this week.
    shows_this_week: bool


class TrackerList(TypedDict):
    #: Every tracker, ended ones too, in the week's order.
    trackers: list[TrackerListed]
    daily_goal: bool


def _listing(trackers: Sequence[Tracker]) -> str:
    """Trackers as an error names them: `id` (name), with an ended one's end."""
    parts = []
    for t in trackers:
        ended = f", deleted from the week of {t['endWeek']}" if t["endWeek"] else ""
        parts.append(f"{t['id']} ({t['name']}{ended})")
    return ", ".join(parts) if parts else "none"


def find_tracker(trackers: Sequence[Tracker], ref: object) -> Tracker:
    """The tracker `ref` names: its id, or else its name without regard to case or the spaces
    around it. Ended trackers count, since their earlier weeks still show them. InsightsError
    names `tracker` for no match and for a name that more than one tracker has."""
    if not isinstance(ref, str) or not ref.strip():
        raise InsightsError("tracker", "must be a tracker's id or name")
    for t in trackers:
        if t["id"] == ref:
            return t
    key = ref.strip().casefold()
    named = [t for t in trackers if t["name"].strip().casefold() == key]
    if len(named) == 1:
        return named[0]
    if named:
        raise InsightsError(
            "tracker",
            f"{len(named)} trackers are named {ref.strip()!r}: {_listing(named)}; give its id",
        )
    raise InsightsError(
        "tracker", f"no tracker has the id or name {ref!r}; the trackers are {_listing(trackers)}"
    )


def tracker_of(conn: sqlite3.Connection, user_id: int, ref: object) -> Tracker:
    """The user's tracker that `ref` names, by `find_tracker`."""
    return find_tracker(load_trackers(conn, user_id), ref)


def not_shown(tracker: Tracker, week: str) -> str | None:
    """Why the tracker doesn't show in `week`, in a plain sentence; None when it does."""
    if shows_in(tracker, week):
        return None
    name = f"{tracker['name']} ({tracker['id']})"
    end, start = tracker["endWeek"], tracker["startWeek"]
    if end is not None and end <= week:
        return (
            f"{name} was deleted from the week of {end} on, so the week of {week} doesn't show "
            "it; its earlier weeks still do"
        )
    return f"{name} starts in the week of {start}, so the week of {week} doesn't show it"


def _monday(key: object, field: str) -> date:
    if not isinstance(key, str) or not is_monday(key):
        raise InsightsError(field, "must be a Monday, written YYYY-MM-DD")
    return date.fromisoformat(key)


def _week_count(weeks: object) -> int:
    if isinstance(weeks, bool) or not isinstance(weeks, int) or not 1 <= weeks <= MAX_WEEKS:
        raise InsightsError("weeks", f"must be a whole number from 1 to {MAX_WEEKS}")
    return weeks


def _daily_target(settings: Portable | None, tracker: Tracker) -> int | None:
    """The tracker's daily target (W4: the tracker keeps it). None while Daily goal is off
    (K85), and for a kind with no daily target (cardio, K90)."""
    if TYPES[tracker["kind"]].daily_target is None:
        return None
    if settings is not None and not settings["dailyGoal"]:
        return None
    return tracker["dailyTarget"]


def daily_goal(settings: Portable | None) -> bool:
    """Daily goal's setting (K85): on while nothing is saved."""
    return settings is None or settings["dailyGoal"]


def _mondays(end: date, count: int) -> list[date]:
    """`count` Mondays up to `end`, oldest first."""
    return [end - timedelta(weeks=count - 1 - i) for i in range(count)]


def _kind(mark: str | None) -> MarkKind | None:
    return None if mark is None else cast(MarkKind, mark.split("-")[0])


def _cut(text: str, limit: int) -> str:
    # Slicing counts code points, as MAX_NOTES does.
    return text[:limit]


def _cut_note(text: str) -> str:
    """An item's notes in a reader of many items, at most MAX_NOTES code points. A longer note
    (they run to 20,000) ends in "…", so an agent can tell it isn't the whole note: `item_history`
    gives it whole."""
    return text if len(text) <= MAX_NOTES else text[: MAX_NOTES - 1] + "…"


class Session(TypedDict, total=False):
    """A cardio item's session (K90), in the edit tools' words."""

    seconds: int
    distance_km: int | float


def session_of(kind: TypeId, item: Item) -> Session:
    """A cardio item's duration and distance in the edit tools' words, each when it has one
    (K90). Other kinds give nothing: an exercise's sets and reps stay out of the readers."""
    out: Session = {}
    if kind != CARDIO.id:
        return out
    if "duration" in item:
        out["seconds"] = item["duration"]
    if "distance" in item:
        out["distance_km"] = item["distance"]
    return out


def _item_week(kind: TypeId, item: Item, week: WeekLog, details: DetailsMap) -> ItemWeek:
    marks = [_kind(_mark(week, item["id"], i)) for i in range(7)]
    done = total_for(week, item["id"])
    return {
        "id": item["id"],
        "name": _cut(item["name"], MAX_NAME),
        "target": item["target"],
        **session_of(kind, item),
        # The item's notes, one copy for every week (its details), not the week's plan's.
        "notes": _cut_note(notes_of(details, item["id"])),
        "marks": marks,
        "done": done,
        "great": marks.count("great"),
        "partial": marks.count("partial"),
        "missed": marks.count("missed"),
        "goal_met": goal_met(done, item["target"]),
    }


def _summary(
    tracker: Tracker, tracked: Tracked, monday: date, today: date, target: int | None
) -> WeekSummary:
    week = monday.isoformat()
    plan_week = plan_source(tracked["plans"], week)
    items = week_items(tracker["id"], tracked["plans"], week)
    log = tracked["log"].get(week, {})
    counts = day_counts(items, log)
    # No target, no met days: each is None rather than False (K85).
    met: list[bool | None] = [None] * 7 if target is None else list(met_days(counts, target))
    dates = [monday + timedelta(days=i) for i in range(7)]
    return {
        "week": week,
        "plan_week": plan_week,
        "carried": plan_week != week,
        "daily_target": target,
        "days": [
            {"date": d.isoformat(), "count": counts[i], "met": met[i], "future": d > today}
            for i, d in enumerate(dates)
        ],
        "items": [_item_week(tracker["kind"], it, log, tracked["details"]) for it in items],
        "goals_met": goals_met(items, log),
        "days_met": None if target is None else sum(1 for m in met if m),
    }


def _load(conn: sqlite3.Connection, user_id: int, tracker: Tracker) -> tuple[Tracked, int | None]:
    """The tracker's plans and log, and its daily target (None while Daily goal is off)."""
    tracked = load_tracked(conn, user_id, tracker["id"])
    return tracked, _daily_target(load_settings(conn, user_id), tracker)


def trackers(conn: sqlite3.Connection, user_id: int, today: date) -> TrackerList:
    """Every tracker the user has, ended ones too, in the week's order, and whether each shows
    in today's week."""
    week = monday_of(today).isoformat()
    settings = load_settings(conn, user_id)
    return {
        "trackers": [
            {
                "id": t["id"],
                "name": t["name"],
                "kind": t["kind"],
                "daily_target": _daily_target(settings, t),
                "start_week": t["startWeek"],
                "end_week": t["endWeek"],
                "shows_this_week": shows_in(t, week),
            }
            for t in load_trackers(conn, user_id)
        ],
        "daily_goal": daily_goal(settings),
    }


def week_summary(
    conn: sqlite3.Connection, user_id: int, tracker: str, week: str, today: date
) -> WeekSummary:
    """One week of one tracker as its screen shows it: the items, each day's count and whether
    it met the daily target, and each item's marks against its goal. A week the tracker doesn't
    show in is refused, naming `week`."""
    found = tracker_of(conn, user_id, tracker)
    monday = _monday(week, "week")
    why = not_shown(found, week)
    if why is not None:
        raise InsightsError("week", why)
    tracked, target = _load(conn, user_id, found)
    return _summary(found, tracked, monday, today, target)


def weeks(
    conn: sqlite3.Connection, user_id: int, tracker: str, start: str, end: str, today: date
) -> Weeks:
    """`week_summary` for every week from `start` to `end`, both Mondays and included, oldest
    first; at most MAX_WEEKS of them. Weeks the tracker doesn't show in are left out."""
    found = tracker_of(conn, user_id, tracker)
    first, last = _monday(start, "start"), _monday(end, "end")
    if last < first:
        raise InsightsError("end", "must not be before start")
    count = (last - first).days // 7 + 1
    if count > MAX_WEEKS:
        raise InsightsError("weeks", f"at most {MAX_WEEKS} weeks at a time")
    tracked, target = _load(conn, user_id, found)
    return {
        "tracker": found["id"],
        "start": start,
        "end": end,
        "weeks": [
            _summary(found, tracked, m, today, target)
            for m in _mondays(last, count)
            if shows_in(found, m.isoformat())
        ],
    }


def item_history(
    conn: sqlite3.Connection,
    user_id: int,
    tracker: str,
    item_id: str,
    weeks: int,
    today: date,
) -> ItemHistory:
    """One item over the last `weeks` weeks, today's included, oldest first: its goal and marks
    in each week that shows it, and its whole note (the one reader that doesn't cut it). A week
    the tracker doesn't show in doesn't show the item either."""
    found = tracker_of(conn, user_id, tracker)
    count = _week_count(weeks)
    tracked = load_tracked(conn, user_id, found["id"])
    mondays = _mondays(monday_of(today), count)
    rows: list[HistoryWeek] = []
    name: str | None = None
    for monday in mondays:
        week = monday.isoformat()
        # A week that doesn't show the tracker shows none of its items.
        shown_items = (
            week_items(found["id"], tracked["plans"], week) if shows_in(found, week) else []
        )
        item = next((it for it in shown_items if it["id"] == item_id), None)
        if item is None:
            rows.append(
                {
                    "week": week,
                    "in_plan": False,
                    "target": None,
                    "marks": [None] * 7,
                    "done": 0,
                    "great": 0,
                    "partial": 0,
                    "missed": 0,
                    "goal_met": False,
                }
            )
            continue
        shown = _item_week(found["kind"], item, tracked["log"].get(week, {}), tracked["details"])
        name = shown["name"]
        rows.append(
            {
                "week": week,
                "in_plan": True,
                "target": shown["target"],
                "marks": shown["marks"],
                "done": shown["done"],
                "great": shown["great"],
                "partial": shown["partial"],
                "missed": shown["missed"],
                "goal_met": shown["goal_met"],
            }
        )
    return {
        "tracker": found["id"],
        "item_id": item_id,
        "name": name,
        "notes": notes_of(tracked["details"], item_id),
        "start": mondays[0].isoformat(),
        "end": mondays[-1].isoformat(),
        "weeks": rows,
    }


def _goal_tracker(
    conn: sqlite3.Connection, user_id: int, tracker: Tracker, week: str, settings: Portable | None
) -> GoalTracker:
    tracked = load_tracked(conn, user_id, tracker["id"])
    items: list[GoalItem] = [
        {
            "id": it["id"],
            "name": _cut(it["name"], MAX_NAME),
            "target": it["target"],
            **session_of(tracker["kind"], it),
            "notes": _cut_note(notes_of(tracked["details"], it["id"])),
        }
        for it in week_items(tracker["id"], tracked["plans"], week)
    ]
    return {
        "id": tracker["id"],
        "name": tracker["name"],
        "kind": tracker["kind"],
        "daily_target": _daily_target(settings, tracker),
        "items": items,
    }


def goals(conn: sqlite3.Connection, user_id: int, today: date) -> Goals:
    """What today's week asks for, per tracker the week shows: each item's weekly goal and the
    tracker's daily target (None while Daily goal is off; cardio has none). Then the "My goals"
    note and the limits note."""
    week = monday_of(today).isoformat()
    settings = load_settings(conn, user_id)
    return {
        "week": week,
        "trackers": [
            _goal_tracker(conn, user_id, t, week, settings)
            for t in load_trackers(conn, user_id)
            if shows_in(t, week)
        ],
        "daily_goal": daily_goal(settings),
        "note": "" if settings is None else settings["goals"],
        "limits": "" if settings is None else settings["limits"],
    }


def _rate(part: int, whole: int) -> float:
    return round(part / whole, 2)


def consistency(
    conn: sqlite3.Connection, user_id: int, tracker: str, weeks: int, today: date
) -> Consistency:
    """How steady the last `weeks` weeks were, today's included: the share of days that met the
    daily target, the share of weekly goals met in the finished weeks, and the current runs.
    While Daily goal is off there is no target, so the met-day fields are None. Only the weeks
    the tracker shows in count."""
    found = tracker_of(conn, user_id, tracker)
    count = _week_count(weeks)
    tracked, target = _load(conn, user_id, found)
    mondays = _mondays(monday_of(today), count)
    summaries = [
        _summary(found, tracked, m, today, target)
        for m in mondays
        if shows_in(found, m.isoformat())
    ]
    elapsed = [d for s in summaries for d in s["days"] if not d["future"]]
    finished = [s for s in summaries if date.fromisoformat(s["week"]) + timedelta(days=6) < today]
    goal_count = sum(1 for s in finished for it in s["items"] if it["target"] > 0)
    goals_hit = sum(s["goals_met"] for s in finished)

    day_streak: int | None = None
    days_met: int | None = None
    if target is not None:
        # Today doesn't break the run before it is met.
        ends_today = bool(elapsed) and elapsed[-1]["date"] == today.isoformat()
        run = elapsed[:-1] if ends_today and not elapsed[-1]["met"] else elapsed
        day_streak = 0
        for d in reversed(run):
            if not d["met"]:
                break
            day_streak += 1
        days_met = sum(1 for d in elapsed if d["met"])
    week_streak = 0
    for s in reversed(finished):
        planned = [it for it in s["items"] if it["target"] > 0]
        if not planned or not all(it["goal_met"] for it in planned):
            break
        week_streak += 1

    return {
        "tracker": found["id"],
        "start": mondays[0].isoformat(),
        "end": mondays[-1].isoformat(),
        "today": today.isoformat(),
        "daily_target": target,
        "days": len(elapsed),
        "days_met": days_met,
        "met_day_rate": None if days_met is None or not elapsed else _rate(days_met, len(elapsed)),
        "finished_weeks": len(finished),
        "goals": goal_count,
        "goals_met": goals_hit,
        "goal_met_rate": _rate(goals_hit, goal_count) if goal_count else None,
        "met_day_streak": day_streak,
        "goal_week_streak": week_streak,
    }
