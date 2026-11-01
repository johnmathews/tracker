"""Read-only views of a user's tracking, counted the way the web app's screen counts them.

The pure rules port `planSource` (src/lib/plans.ts), the default plans (src/lib/storage.ts) and
the goal and met-day rules (src/lib/tracker.ts). `tests/test_insights.py` runs the shared
fixtures in `fixtures/insights/`, which src/lib/__tests__/insights-parity.spec.ts runs too, so an
answer about a week never contradicts what the week shows.

The readers above them take a connection, a user id and `today` (the asker's date: the server
cannot know the browser's), and return plain JSON with snake_case keys and Monday `YYYY-MM-DD`
week keys. They read only that user's rows, write nothing, and carry no user or session fields.
Names and notes are cut in their output, since they reach a model as text (docs/api.md §1).
"""

import copy
import sqlite3
from collections.abc import Mapping, Sequence
from datetime import date, timedelta
from typing import TypedDict, cast

from .data import load_settings, load_tracked, notes_of
from .types import EXERCISE, SECTION_TYPES
from .validate import (
    DEFAULT_DAILY_PICK,
    DEFAULT_FOOD_PICK,
    MAX_NOTES,
    SECTIONS,
    DetailsMap,
    Item,
    MarkKind,
    Portable,
    Section,
    Tracked,
    is_week,
)

#: An item's name in a reader's output, in characters. Names are stored uncapped.
MAX_NAME = 100

type WeekLog = Mapping[str, Sequence[str | None]]


def default_items(section: Section) -> list[Item]:
    """The items a week shows while nothing is planned: storage.ts's defaultExercises and
    defaultFoods."""
    if SECTION_TYPES[section] is EXERCISE:
        return [
            {"id": "pu", "name": "Push-ups", "reps": 10, "target": 4},
            {"id": "pl", "name": "Pull-ups", "reps": 3, "target": 4},
            {"id": "sq", "name": "Squats", "reps": 15, "target": 4},
            {"id": "be", "name": "Back extensions", "reps": 12, "target": 3},
            {"id": "kh", "name": "Kettlebell halos", "reps": 8, "perSide": True, "target": 3},
        ]
    return [
        {"id": "veg", "name": "Vegetables", "target": 7},
        {"id": "fruit", "name": "Fruit", "target": 5},
        {"id": "fish", "name": "Fish", "target": 2},
        {"id": "nuts", "name": "Nuts", "target": 3},
    ]


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


def week_items(section: Section, plans: Mapping[str, list[Item]], week: str) -> list[Item]:
    """The items `week` shows: its plan source's, or the defaults. A copy, safe to change."""
    source = plan_source(plans, week)
    return copy.deepcopy(plans[source]) if source is not None else default_items(section)


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
    """An argument a reader refuses; `field` names it (`section`, `week`, `start`, `end` or
    `weeks`). Nothing was read."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.field = field


class Day(TypedDict):
    date: str
    #: The shown items marked on the day.
    count: int
    #: `count` reaches the daily target: the day's name is green on screen.
    met: bool
    #: After `today`. A mark on a future day still counts, as on screen.
    future: bool


class ItemWeek(TypedDict):
    id: str
    name: str
    target: int
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
    #: Exercises a day or foods a day.
    daily_target: int
    days: list[Day]
    items: list[ItemWeek]
    goals_met: int
    days_met: int


class Weeks(TypedDict):
    section: Section
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
    section: Section
    item_id: str
    #: Its name in the latest week that shows it; None when no week in the range does.
    name: str | None
    start: str
    end: str
    weeks: list[HistoryWeek]


class GoalItem(TypedDict):
    id: str
    name: str
    target: int
    notes: str


class Goals(TypedDict):
    #: Today's week, whose plan the goals are.
    week: str
    exercise: list[GoalItem]
    diet: list[GoalItem]
    exercises_a_day: int
    foods_a_day: int
    #: The "My goals" note from Settings; "" when there is none.
    note: str


class Consistency(TypedDict):
    section: Section
    start: str
    end: str
    today: str
    daily_target: int
    #: The days up to today, today included.
    days: int
    days_met: int
    #: `days_met / days`, to 2 places.
    met_day_rate: float
    #: The weeks whose Sunday is before today.
    finished_weeks: int
    #: Items with a goal above 0, counted once per finished week.
    goals: int
    goals_met: int
    #: `goals_met / goals`, to 2 places; None when there are no goals.
    goal_met_rate: float | None
    #: Met days in a row back from today. Today counts once met, and doesn't break the run
    #: before then.
    met_day_streak: int
    #: Finished weeks in a row, latest first, that met every goal above 0.
    goal_week_streak: int


def _section(section: object) -> Section:
    if section in SECTIONS:
        return section
    raise InsightsError("section", f"must be {' or '.join(SECTIONS)}")


def _monday(key: object, field: str) -> date:
    if not isinstance(key, str) or not is_monday(key):
        raise InsightsError(field, "must be a Monday, written YYYY-MM-DD")
    return date.fromisoformat(key)


def _week_count(weeks: object) -> int:
    if isinstance(weeks, bool) or not isinstance(weeks, int) or not 1 <= weeks <= MAX_WEEKS:
        raise InsightsError("weeks", f"must be a whole number from 1 to {MAX_WEEKS}")
    return weeks


def _daily_target(settings: Portable | None, section: Section) -> int:
    """Exercises a day or foods a day: the section's type names the setting (K30, K57)."""
    key = SECTION_TYPES[section].pick_key
    if settings is None:
        return DEFAULT_DAILY_PICK if key == "dailyPick" else DEFAULT_FOOD_PICK
    return settings[key]


def _mondays(end: date, count: int) -> list[date]:
    """`count` Mondays up to `end`, oldest first."""
    return [end - timedelta(weeks=count - 1 - i) for i in range(count)]


def _kind(mark: str | None) -> MarkKind | None:
    return None if mark is None else cast(MarkKind, mark.split("-")[0])


def _cut(text: str, limit: int) -> str:
    # Slicing counts code points, as MAX_NOTES does.
    return text[:limit]


def _cut_note(text: str) -> str:
    """An item's notes, at most MAX_NOTES code points. A longer note (they run to 20,000) ends in
    "…", so an agent can tell it isn't the whole note before writing one back."""
    return text if len(text) <= MAX_NOTES else text[: MAX_NOTES - 1] + "…"


def _item_week(item: Item, week: WeekLog, details: DetailsMap) -> ItemWeek:
    marks = [_kind(_mark(week, item["id"], i)) for i in range(7)]
    done = total_for(week, item["id"])
    return {
        "id": item["id"],
        "name": _cut(item["name"], MAX_NAME),
        "target": item["target"],
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
    section: Section, tracked: Tracked, monday: date, today: date, target: int
) -> WeekSummary:
    week = monday.isoformat()
    plan_week = plan_source(tracked["plans"], week)
    items = week_items(section, tracked["plans"], week)
    log = tracked["log"].get(week, {})
    counts = day_counts(items, log)
    met = met_days(counts, target)
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
        "items": [_item_week(it, log, tracked["details"]) for it in items],
        "goals_met": goals_met(items, log),
        "days_met": sum(met),
    }


def _load(conn: sqlite3.Connection, user_id: int, section: Section) -> tuple[Tracked, int]:
    """The section's plans and log, and its daily target."""
    tracked = load_tracked(conn, user_id, section)
    return tracked, _daily_target(load_settings(conn, user_id), section)


def week_summary(
    conn: sqlite3.Connection, user_id: int, section: Section, week: str, today: date
) -> WeekSummary:
    """One week of one section as its screen shows it: the items, each day's count and whether
    it met the daily target, and each item's marks against its goal."""
    section = _section(section)
    monday = _monday(week, "week")
    tracked, target = _load(conn, user_id, section)
    return _summary(section, tracked, monday, today, target)


def weeks(
    conn: sqlite3.Connection, user_id: int, section: Section, start: str, end: str, today: date
) -> Weeks:
    """`week_summary` for every week from `start` to `end`, both Mondays and included, oldest
    first; at most MAX_WEEKS of them."""
    section = _section(section)
    first, last = _monday(start, "start"), _monday(end, "end")
    if last < first:
        raise InsightsError("end", "must not be before start")
    count = (last - first).days // 7 + 1
    if count > MAX_WEEKS:
        raise InsightsError("weeks", f"at most {MAX_WEEKS} weeks at a time")
    tracked, target = _load(conn, user_id, section)
    return {
        "section": section,
        "start": start,
        "end": end,
        "weeks": [_summary(section, tracked, m, today, target) for m in _mondays(last, count)],
    }


def item_history(
    conn: sqlite3.Connection,
    user_id: int,
    section: Section,
    item_id: str,
    weeks: int,
    today: date,
) -> ItemHistory:
    """One item over the last `weeks` weeks, today's included, oldest first: its goal and marks
    in each week that shows it."""
    section = _section(section)
    count = _week_count(weeks)
    tracked = load_tracked(conn, user_id, section)
    mondays = _mondays(monday_of(today), count)
    rows: list[HistoryWeek] = []
    name: str | None = None
    for monday in mondays:
        week = monday.isoformat()
        item = next(
            (it for it in week_items(section, tracked["plans"], week) if it["id"] == item_id), None
        )
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
        shown = _item_week(item, tracked["log"].get(week, {}), tracked["details"])
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
        "section": section,
        "item_id": item_id,
        "name": name,
        "start": mondays[0].isoformat(),
        "end": mondays[-1].isoformat(),
        "weeks": rows,
    }


def goals(conn: sqlite3.Connection, user_id: int, today: date) -> Goals:
    """What today's week asks for: each item's weekly goal, both daily targets, and the
    "My goals" note."""
    week = monday_of(today).isoformat()
    settings = load_settings(conn, user_id)
    tracked = {section: load_tracked(conn, user_id, section) for section in SECTIONS}
    shown = {
        section: [
            {
                "id": it["id"],
                "name": _cut(it["name"], MAX_NAME),
                "target": it["target"],
                "notes": _cut_note(notes_of(tracked[section]["details"], it["id"])),
            }
            for it in week_items(section, tracked[section]["plans"], week)
        ]
        for section in SECTIONS
    }
    return {
        "week": week,
        "exercise": cast(list[GoalItem], shown["exercise"]),
        "diet": cast(list[GoalItem], shown["diet"]),
        "exercises_a_day": _daily_target(settings, "exercise"),
        "foods_a_day": _daily_target(settings, "diet"),
        # The "My goals" field doesn't exist yet; W3 of the /ask plan adds it.
        "note": "",
    }


def _rate(part: int, whole: int) -> float:
    return round(part / whole, 2)


def consistency(
    conn: sqlite3.Connection, user_id: int, section: Section, weeks: int, today: date
) -> Consistency:
    """How steady the last `weeks` weeks were, today's included: the share of days that met the
    daily target, the share of weekly goals met in the finished weeks, and the current runs."""
    section = _section(section)
    count = _week_count(weeks)
    tracked, target = _load(conn, user_id, section)
    mondays = _mondays(monday_of(today), count)
    summaries = [_summary(section, tracked, m, today, target) for m in mondays]
    # Today's week is in the range, so today is always the last of these.
    elapsed = [d for s in summaries for d in s["days"] if not d["future"]]
    finished = [s for s in summaries if date.fromisoformat(s["week"]) + timedelta(days=6) < today]
    goal_count = sum(1 for s in finished for it in s["items"] if it["target"] > 0)
    goals_hit = sum(s["goals_met"] for s in finished)

    run = elapsed if elapsed[-1]["met"] else elapsed[:-1]
    day_streak = 0
    for d in reversed(run):
        if not d["met"]:
            break
        day_streak += 1
    week_streak = 0
    for s in reversed(finished):
        planned = [it for it in s["items"] if it["target"] > 0]
        if not planned or not all(it["goal_met"] for it in planned):
            break
        week_streak += 1

    days_met = sum(d["met"] for d in elapsed)
    return {
        "section": section,
        "start": mondays[0].isoformat(),
        "end": mondays[-1].isoformat(),
        "today": today.isoformat(),
        "daily_target": target,
        "days": len(elapsed),
        "days_met": days_met,
        "met_day_rate": _rate(days_met, len(elapsed)),
        "finished_weeks": len(finished),
        "goals": goal_count,
        "goals_met": goals_hit,
        "goal_met_rate": _rate(goals_hit, goal_count) if goal_count else None,
        "met_day_streak": day_streak,
        "goal_week_streak": week_streak,
    }
