"""The MCP write tools' rules: change one item, one day's mark or the daily targets, as the web
app's stores do (docs/api.md §3.1).

Each operation mirrors a store action in src/stores/planner.ts and src/stores/diet.ts:

- **A week is owned before it changes** (`own_week`, the stores' `own()`). A week with no plan of
  its own first gets a copy of the plan it shows, so the change never reaches the week it was
  carried from. The copy is a create at `rev` 0, which P7 makes safe to repeat.
- **Items are checked strictly** (`validate.strict_item`, plus the ranges the app's forms allow),
  and refused by name rather than clamped or dropped. A refusal changes nothing.
- **Plan writes go through `data.put_plan`.** A newer `rev` on the server means another device
  saved the week since it was read: the operation re-reads the week and runs again, up to
  `MAX_TRIES` times in all.

Tools speak the app's words (`times_a_week`, `seconds`, `note` …); `WORDS` maps them to the stored
keys, and results come back in the same words, so an agent can undo a change by hand from what
the call returned. Every operation raises `EditError`, a `ValueError` whose `field` names what to
fix.
"""

import copy
import json
import math
import secrets
import sqlite3
import time
from collections.abc import Callable, Container, Mapping
from datetime import date
from typing import Any, TypedDict

from . import data
from .config import Config
from .data import PlanSaved, QuotaExceeded, load_settings, load_tracked
from .db import transaction
from .insights import default_items, is_monday, monday_of, plan_source, week_items
from .validate import (
    MAX_DAILY_PICK,
    MAX_DURATION,
    MAX_ITEM_ID,
    MAX_NOTES,
    MAX_SETS,
    MAX_TARGET,
    MAX_WEIGHT,
    MIN_DAILY_PICK,
    MIN_TARGET,
    Days,
    Item,
    Mark,
    Section,
    Tracked,
    is_mark,
    is_week,
    normalise_items,
    normalise_portable,
    strict_item,
)

#: The tools' words for an item's fields, and the key each is stored under.
WORDS: dict[str, str] = {
    "name": "name",
    "sets": "sets",
    "reps": "reps",
    "seconds": "duration",
    "per_side": "perSide",
    "weight_kg": "weight",
    "times_a_week": "target",
    "note": "notes",
}
KEYS: dict[str, str] = {key: word for word, key in WORDS.items()}
#: The fields a food has; the rest are an exercise's.
FOOD_WORDS = ("name", "times_a_week", "note")
#: The app's Reps field takes four digits.
MAX_REPS = 9999
#: Whole-number fields and their bounds: the app's forms allow no more. 0 clears sets and seconds.
WHOLE: dict[str, tuple[int, int]] = {
    "sets": (0, MAX_SETS),
    "reps": (0, MAX_REPS),
    "seconds": (0, MAX_DURATION),
    "times_a_week": (MIN_TARGET, MAX_TARGET),
}
#: A food is eaten or not: the app marks one only `great`, in each drawing (src/lib/tracker.ts).
FOOD_MARKS: tuple[Mark, ...] = ("great", "great-solid", "great-hatch")
#: How many times a plan edit runs before a run of conflicts makes it give up.
MAX_TRIES = 3
_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"

type Words = dict[str, Any]


class EditError(ValueError):
    """A change refused, with `field` naming what to fix; nothing was written. The text reads
    `field: message`, as `insights.InsightsError`'s does."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.field = field


class Owned(TypedDict):
    """A week's own plan, in stored keys, and its `rev`."""

    items: list[Item]
    rev: int
    #: The week whose plan was copied in, `defaults`, or None when the week had its own already.
    copied_from: str | None


class PlanEdit(TypedDict):
    section: Section
    week: str
    #: The item added or updated, as stored now; or the item removed.
    item: Words
    #: The items the week showed before the change, and its items after.
    before: list[Words]
    after: list[Words]
    rev: int
    copied_from: str | None


class MarkEdit(TypedDict):
    section: Section
    date: str
    week: str
    #: 0 is Monday.
    day: int
    item_id: str
    before: Mark | None
    after: Mark | None
    #: The item's seven marks in the week, Monday first.
    days: Days
    rev: int
    copied_from: str | None


class Targets(TypedDict):
    exercises_a_day: int
    foods_a_day: int


class TargetsEdit(TypedDict):
    before: Targets
    after: Targets


def in_words(item: Item) -> Words:
    """A stored item in the tools' words, keeping its key order."""
    return {KEYS.get(key, key): value for key, value in item.items()}


def _base36(n: int) -> str:
    out = ""
    while True:
        n, digit = divmod(n, 36)
        out = _BASE36[digit] + out
        if n == 0:
            return out


def _suffix() -> str:
    return "".join(secrets.choice(_BASE36) for _ in range(4))


def _candidate() -> str:
    """The web app's `newId`: `x`, the time in milliseconds in base 36, four random characters."""
    return "x" + _base36(time.time_ns() // 1_000_000) + _suffix()


def new_id(taken: Container[str]) -> str:
    """An id in the app's shape that `taken` does not hold. At most 13 characters until the
    year 5188, well under MAX_ITEM_ID."""
    while (item_id := _candidate()) in taken:
        pass
    return item_id


def _section(section: object) -> Section:
    if section == "exercise" or section == "diet":
        return section
    raise EditError("section", "must be exercise or diet")


def _week(week: object) -> str:
    if not isinstance(week, str) or not is_monday(week):
        raise EditError("week", "must be a Monday, written YYYY-MM-DD")
    return week


def _item_id(item_id: object) -> str:
    if not isinstance(item_id, str) or not 1 <= len(item_id) <= MAX_ITEM_ID:
        raise EditError("item_id", f"must be 1 to {MAX_ITEM_ID} characters")
    return item_id


def parse_date(text: str) -> date:
    """A `YYYY-MM-DD` date, or EditError naming `date`."""
    try:
        if is_week(text):
            return date.fromisoformat(text)
    except ValueError:
        pass
    raise EditError("date", "must be a real date, written YYYY-MM-DD")


def _field(word: str, value: object) -> object:
    """One field in the tools' words, checked; its value as stored."""
    if word in ("name", "note"):
        if not isinstance(value, str):
            raise EditError(word, "must be text")
        if word == "note" and len(value.strip(" \t\n\r")) > MAX_NOTES:
            raise EditError(word, f"is over {MAX_NOTES} characters")
        return value
    if word == "per_side":
        if not isinstance(value, bool):
            raise EditError(word, "must be true or false")
        return value
    if word == "weight_kg":
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise EditError(word, "must be a number of kg")
        if not (math.isfinite(value) and 0 <= value <= MAX_WEIGHT):
            raise EditError(word, f"must be 0 to {MAX_WEIGHT} kg (0 for bodyweight)")
        return value
    lo, hi = WHOLE[word]
    if isinstance(value, bool) or not isinstance(value, int):
        raise EditError(word, f"must be a whole number from {lo} to {hi}")
    if not lo <= value <= hi:
        raise EditError(word, f"must be a whole number from {lo} to {hi}")
    return value


def _changes(section: Section, fields: Mapping[str, object]) -> Item:
    """The fields given, checked and in stored keys. A None is a field not given."""
    out: Item = {}
    for word, value in fields.items():
        if value is None:
            continue
        if word not in WORDS:
            raise EditError(word, f"is not a field; use {', '.join(WORDS)}")
        if section == "diet" and word not in FOOD_WORDS:
            raise EditError(word, f"is for exercises only; a food has {', '.join(FOOD_WORDS)}")
        out[WORDS[word]] = _field(word, value)
    # An exercise counts reps or seconds: giving one sets the other aside, as the app's form does.
    if section == "exercise":
        if out.get("duration", 0) > 0 and "reps" not in out:
            out["reps"] = 0
        if out.get("reps", 0) > 0 and "duration" not in out:
            out["duration"] = 0
    return out


def _strict(section: Section, raw: Item) -> Item:
    checked = strict_item(section, raw)
    if checked.item is None:
        raise EditError("item", "; ".join(checked.problems))
    return checked.item


def _find(items: list[Item], item_id: str, week: str) -> int:
    for i, it in enumerate(items):
        if it["id"] == item_id:
            return i
    raise EditError(
        "item_id", f"no item {item_id} in the week of {week}; week_summary lists its items"
    )


def _put(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    section: Section,
    week: str,
    items: list[Item],
    rev: int,
) -> data.PlanSaved | data.PlanConflict:
    try:
        return data.put_plan(
            conn, user_id, section, week, items, rev, quota=config.user_quota_bytes
        )
    except QuotaExceeded:
        raise EditError("quota", "the account is full, so nothing was changed") from None


def _own_plan(
    conn: sqlite3.Connection, user_id: int, section: Section, week: str
) -> tuple[list[Item], int] | None:
    """The week's own plan and its rev, read in one statement so the two always agree."""
    row = conn.execute(
        "SELECT items_json, rev FROM plans WHERE user_id = ? AND section = ? AND week = ?",
        (user_id, section, week),
    ).fetchone()
    return None if row is None else (normalise_items(section, json.loads(row[0])), row[1])


def _shown(
    conn: sqlite3.Connection, user_id: int, section: Section, week: str
) -> tuple[Owned, Tracked]:
    """What the week shows, writing nothing: its own plan and rev, or for a week without one the
    plan it carries (or the defaults) at rev 0, ready to be created as its own. Also the
    section's tracking, as read."""
    own = _own_plan(conn, user_id, section, week)
    tracked = load_tracked(conn, user_id, section)
    if own is not None:
        return {"items": own[0], "rev": own[1], "copied_from": None}, tracked
    source = plan_source(tracked["plans"], week)
    items = normalise_items(section, week_items(section, tracked["plans"], week))
    return {"items": items, "rev": 0, "copied_from": source or "defaults"}, tracked


def own_week(
    conn: sqlite3.Connection, config: Config, user_id: int, section: Section, week: str
) -> Owned:
    """The week's own plan; a week without one first gets a copy of the plan it shows (its plan
    source's, or the defaults), as the stores' `own()` does. Safe to repeat."""
    section, week = _section(section), _week(week)
    shown, _ = _shown(conn, user_id, section, week)
    if shown["copied_from"] is None:
        return shown
    result = _put(conn, config, user_id, section, week, shown["items"], 0)
    if isinstance(result, PlanSaved):
        return {**shown, "rev": result.rev}
    # Another device created the week since it was read: its copy is the week's own plan now.
    assert result.items is not None  # rev 0 conflicts only with a stored plan
    return {"items": result.items, "rev": result.rev, "copied_from": None}


type Change = Callable[[list[Item], Tracked], tuple[list[Item], Item]]


def _edit_plan(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    section: Section,
    week: str,
    change: Change,
) -> PlanEdit:
    """Run `change` on the week's items and store the result in one write, replaying it on a
    conflict. `change` takes the items and the section's tracking, and returns the new items and
    the item it acted on, or raises EditError.

    A week without its own plan is created with the change already applied to the copy, as the
    app's sync sends `own()` and the edit as one create at rev 0. A refusal therefore writes
    nothing, and the week goes on following its source."""
    section, week = _section(section), _week(week)
    for _ in range(MAX_TRIES):
        owned, tracked = _shown(conn, user_id, section, week)
        before = owned["items"]
        after, item = change(copy.deepcopy(before), tracked)
        after = normalise_items(section, after)
        result = _put(conn, config, user_id, section, week, after, owned["rev"])
        if isinstance(result, PlanSaved):
            return {
                "section": section,
                "week": week,
                "item": in_words(item),
                "before": [in_words(it) for it in before],
                "after": [in_words(it) for it in after],
                "rev": result.rev,
                "copied_from": owned["copied_from"],
            }
    raise EditError(
        "week",
        f"another device changed the week of {week} {MAX_TRIES} times while this edit ran; "
        "nothing was changed, so read the week and try again",
    )


def _ids(tracked: Tracked) -> set[str]:
    """Every id the section has used: in any week's plan, or in the log."""
    ids = {it["id"] for items in tracked["plans"].values() for it in items}
    ids.update(item_id for week in tracked["log"].values() for item_id in week)
    return ids


def add_item(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    section: Section,
    week: str,
    fields: Mapping[str, object],
) -> PlanEdit:
    """Add an item to the end of the week, with a new id: the stores' `addExercise`, `addFood`."""
    changes = _changes(_section(section), fields)

    def add(items: list[Item], tracked: Tracked) -> tuple[list[Item], Item]:
        taken = _ids(tracked) | {it["id"] for it in default_items(section)}
        item = _strict(section, {**changes, "id": new_id(taken)})
        return [*items, item], item

    return _edit_plan(conn, config, user_id, section, week, add)


def update_item(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    section: Section,
    week: str,
    item_id: str,
    fields: Mapping[str, object],
) -> PlanEdit:
    """Change the fields given of one item in the week, keeping its id, its place and the rest:
    the stores' `updateExercise`, `updateFood`."""
    changes = _changes(_section(section), fields)
    if not changes:
        raise EditError("item", f"nothing to change; give one of {', '.join(WORDS)}")
    item_id = _item_id(item_id)

    def update(items: list[Item], _: Tracked) -> tuple[list[Item], Item]:
        i = _find(items, item_id, week)
        items[i] = _strict(section, {**items[i], **changes})
        return items, items[i]

    return _edit_plan(conn, config, user_id, section, week, update)


def remove_item(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    section: Section,
    week: str,
    item_id: str,
) -> PlanEdit:
    """Take one item out of the week; its marks stay in the log, uncounted, as in the app."""
    item_id = _item_id(item_id)

    def remove(items: list[Item], _: Tracked) -> tuple[list[Item], Item]:
        item = items.pop(_find(items, item_id, week))
        return items, item

    return _edit_plan(conn, config, user_id, section, week, remove)


def mark_day(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    section: Section,
    day: date,
    item_id: str,
    mark: Mark | None,
) -> MarkEdit:
    """Set one item's mark on one date, or clear it with None: the stores' `toggle`, landing on
    a chosen mark. The week is the date's Monday. It is owned first, as a tick on the device is,
    and an item the week does not show is refused."""
    section, item_id = _section(section), _item_id(item_id)
    if mark is not None and not is_mark(mark):
        raise EditError(
            "mark",
            "must be one of great, partial, missed, each alone or with "
            "-solid or -hatch, or null to clear the day",
        )
    if section == "diet" and mark is not None and mark not in FOOD_MARKS:
        raise EditError("mark", f"a food is marked {', '.join(FOOD_MARKS)}, or null")
    week, weekday = monday_of(day).isoformat(), day.weekday()
    tracked = load_tracked(conn, user_id, section)
    _find(week_items(section, tracked["plans"], week), item_id, week)
    owned = own_week(conn, config, user_id, section, week)
    before = tracked["log"].get(week, {}).get(item_id, [None] * 7)[weekday]
    try:
        days = data.set_tick(
            conn, user_id, section, week, item_id, weekday, mark, quota=config.user_quota_bytes
        )
    except QuotaExceeded:
        raise EditError("quota", "the account is full, so nothing was changed") from None
    return {
        "section": section,
        "date": day.isoformat(),
        "week": week,
        "day": weekday,
        "item_id": item_id,
        "before": before,
        "after": days[weekday],
        "days": days,
        "rev": owned["rev"],
        "copied_from": owned["copied_from"],
    }


def _daily(name: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise EditError(name, f"must be a whole number from {MIN_DAILY_PICK} to {MAX_DAILY_PICK}")
    if not MIN_DAILY_PICK <= value <= MAX_DAILY_PICK:
        raise EditError(name, f"must be a whole number from {MIN_DAILY_PICK} to {MAX_DAILY_PICK}")
    return value


def set_daily_targets(
    conn: sqlite3.Connection,
    user_id: int,
    *,
    exercises_a_day: int | None = None,
    foods_a_day: int | None = None,
) -> TargetsEdit:
    """Set exercises a day, foods a day or both, keeping the accent and the other target: the
    planner store's `changeDailyPick` and `changeFoodPick`, landing on a chosen number."""
    if exercises_a_day is None and foods_a_day is None:
        raise EditError("exercises_a_day", "give exercises_a_day, foods_a_day or both")
    picks = {
        key: _daily(name, value)
        for key, name, value in (
            ("dailyPick", "exercises_a_day", exercises_a_day),
            ("foodPick", "foods_a_day", foods_a_day),
        )
        if value is not None
    }
    with transaction(conn):
        # The defaults while nothing is saved, as the app shows them.
        saved = load_settings(conn, user_id) or normalise_portable({})
        stored = data.put_settings(conn, user_id, {**saved, **picks})
    return {
        "before": {"exercises_a_day": saved["dailyPick"], "foods_a_day": saved["foodPick"]},
        "after": {"exercises_a_day": stored["dailyPick"], "foods_a_day": stored["foodPick"]},
    }
