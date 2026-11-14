"""The MCP write tools' rules: change one item, one day's mark or the daily targets, as the web
app's stores do (docs/api.md §3.1).

Each operation mirrors a store action in src/stores/planner.ts, src/stores/cardio.ts and
src/stores/diet.ts:

- **A tracker is the user's own** (spec §1, §2). Each operation names one by its id, or its name
  without regard to case (`insights.find_tracker`), and refuses one the user doesn't have. Its
  kind decides the item's fields and marks. A week the tracker doesn't show in is refused: one
  before it started, or one from its end on. Its earlier weeks still take changes.

- **A week is owned before it changes** (`own_week`, the stores' `own()`). A week with no plan of
  its own first gets a copy of the plan it shows, so the change never reaches the week it was
  carried from. The copy is a create at `rev` 0, which P7 makes safe to repeat.
- **Items are checked strictly** (`validate.strict_item`, plus the ranges the app's forms allow),
  and refused by name rather than clamped or dropped. A refusal changes nothing.
- **Plan writes go through `data.put_plan`'s rules** (`put_plan_locked`). A newer `rev` on the
  server means another device saved the week since it was read: the operation re-reads the week
  and runs again, up to `MAX_TRIES` times in all.
- **A note is the item's, not the week's** (D3): its details, one copy for every week, as its row
  and its page in the app read it. `note` goes to `data.set_notes_locked`, in the same
  transaction as the plan write, so a refused note leaves the plan as it was. A note alone
  changes no plan, so it copies no week.

Tools speak the app's words (`times_a_week`, `seconds`, `note` …); `WORDS` maps them to the stored
keys, and results come back in the same words, the items with their notes, so an agent can undo a
change by hand from what the call returned. Every operation raises `EditError`, a `ValueError`
whose `field` names what to fix.
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
from .data import (
    DetailsTooLarge,
    PlanSaved,
    QuotaExceeded,
    load_settings,
    load_tracked,
    notes_of,
)
from .db import transaction
from .insights import (
    InsightsError,
    daily_goal,
    default_items,
    find_tracker,
    is_monday,
    monday_of,
    not_shown,
    plan_source,
    week_items,
)
from .types import CARDIO, FOOD, STRENGTH, TYPES, TypeId
from .validate import (
    BLANK,
    MAX_CARDIO_DURATION,
    MAX_DAILY_PICK,
    MAX_DETAILS_NOTES,
    MAX_DISTANCE,
    MAX_DURATION,
    MAX_ITEM_ID,
    MAX_SETS,
    MAX_TARGET,
    MAX_WEIGHT,
    MIN_DAILY_PICK,
    MIN_TARGET,
    Days,
    Item,
    Mark,
    Tracked,
    Tracker,
    is_mark,
    is_week,
    normalise_kind_items,
    strict_kind_item,
)

#: The tools' words for an item's fields, and the key each is stored under: in the week's plan,
#: but `notes` in the item's details.
WORDS: dict[str, str] = {
    "name": "name",
    "sets": "sets",
    "reps": "reps",
    "seconds": "duration",
    "per_side": "perSide",
    "weight_kg": "weight",
    "distance_km": "distance",
    "times_a_week": "target",
    "note": "notes",
}
KEYS: dict[str, str] = {key: word for word, key in WORDS.items()}
#: The fields a food has.
FOOD_WORDS = ("name", "times_a_week", "note")
#: The fields a cardio item has (K90): `seconds` is the whole session's, not a set's.
CARDIO_WORDS = ("name", "seconds", "distance_km", "times_a_week", "note")
#: Each type's fields, and the words its refusals use for one item of it.
TYPE_WORDS: dict[TypeId, tuple[str, ...]] = {
    STRENGTH.id: tuple(w for w in WORDS if w != "distance_km"),
    CARDIO.id: CARDIO_WORDS,
    FOOD.id: FOOD_WORDS,
}
AN_ITEM: dict[TypeId, str] = {
    STRENGTH.id: "an exercise",
    CARDIO.id: "a cardio item",
    FOOD.id: "a food",
}
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
    #: The tracker's id.
    tracker: str
    week: str
    #: The item added or updated, as stored now; or the item removed.
    item: Words
    #: The items the week showed before the change, and its items after.
    before: list[Words]
    after: list[Words]
    rev: int
    copied_from: str | None


class MarkEdit(TypedDict):
    #: The tracker's id.
    tracker: str
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


class TargetChange(TypedDict):
    """One tracker's daily target, before and after."""

    tracker: str
    name: str
    before: int | None
    after: int


class TargetsEdit(TypedDict):
    #: Each tracker set, in the order given.
    targets: list[TargetChange]
    #: Daily goal's setting (K85), which this leaves as it is: false says the targets are kept
    #: but apply only once it is back on.
    daily_goal: bool


def in_words(item: Item, notes: str = "") -> Words:
    """A stored item in the tools' words, keeping its key order, with its notes (from its
    details) last as `note` when it has any."""
    words = {KEYS.get(key, key): value for key, value in item.items()}
    if notes:
        words["note"] = notes
    return words


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


def find(conn: sqlite3.Connection, user_id: int, ref: object) -> Tracker:
    """The user's tracker that `ref` names, by its id or its name; EditError naming `tracker`
    when there is none, or more than one by that name."""
    try:
        return find_tracker(data.load_trackers(conn, user_id), ref)
    except InsightsError as e:
        raise EditError(e.field, str(e).removeprefix(f"{e.field}: ")) from None


def _week(week: object) -> str:
    if not isinstance(week, str) or not is_monday(week):
        raise EditError("week", "must be a Monday, written YYYY-MM-DD")
    return week


def _shown_week(tracker: Tracker, week: object, field: str = "week") -> str:
    """`week`, a Monday that shows the tracker; else EditError naming `field`."""
    week = _week(week)
    why = not_shown(tracker, week)
    if why is not None:
        raise EditError(field, why)
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


def _field(kind: TypeId, word: str, value: object) -> object:
    """One field in the tools' words, checked; its value as stored."""
    if word in ("name", "note"):
        if not isinstance(value, str):
            raise EditError(word, "must be text")
        # An item's notes, as its details take them (D2) and its page in the app allows.
        if word == "note" and len(value.strip(BLANK)) > MAX_DETAILS_NOTES:
            raise EditError(word, f"is over {MAX_DETAILS_NOTES:,} characters")
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
    if word == "distance_km":
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise EditError(word, "must be a number of km")
        if not (math.isfinite(value) and 0 <= value <= MAX_DISTANCE):
            raise EditError(word, f"must be 0 to {MAX_DISTANCE} km (0 clears it)")
        return value
    # A cardio session runs longer than an exercise's set: up to a day.
    cardio = word == "seconds" and kind == CARDIO.id
    lo, hi = (0, MAX_CARDIO_DURATION) if cardio else WHOLE[word]
    if isinstance(value, bool) or not isinstance(value, int):
        raise EditError(word, f"must be a whole number from {lo} to {hi}")
    if not lo <= value <= hi:
        raise EditError(word, f"must be a whole number from {lo} to {hi}")
    return value


def _changes(kind: TypeId, fields: Mapping[str, object]) -> Item:
    """The fields given, checked and in stored keys. A None is a field not given."""
    out: Item = {}
    for word, value in fields.items():
        if value is None:
            continue
        if word not in WORDS:
            raise EditError(word, f"is not a field; use {', '.join(WORDS)}")
        if word not in TYPE_WORDS[kind]:
            has = ", ".join(TYPE_WORDS[kind])
            raise EditError(word, f"{AN_ITEM[kind]} has no {word}; it has {has}")
        out[WORDS[word]] = _field(kind, word, value)
    # An exercise counts reps or seconds: giving one sets the other aside, as the app's form does.
    if kind == STRENGTH.id:
        if out.get("duration", 0) > 0 and "reps" not in out:
            out["reps"] = 0
        if out.get("reps", 0) > 0 and "duration" not in out:
            out["duration"] = 0
    return out


def _strict(kind: TypeId, raw: Item) -> Item:
    checked = strict_kind_item(kind, raw)
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
    tracker_id: str,
    week: str,
    items: list[Item],
    rev: int,
) -> data.PlanSaved | data.PlanConflict:
    """A plan write, inside the caller's `transaction`."""
    try:
        return data.put_plan_locked(
            conn, user_id, tracker_id, week, items, rev, quota=config.user_quota_bytes
        )
    except QuotaExceeded:
        raise EditError("quota", "the account is full, so nothing was changed") from None


def _own_plan(
    conn: sqlite3.Connection, user_id: int, tracker: Tracker, week: str
) -> tuple[list[Item], int] | None:
    """The week's own plan and its rev, read in one statement so the two always agree."""
    row = conn.execute(
        "SELECT items_json, rev FROM plans WHERE user_id = ? AND section = ? AND week = ?",
        (user_id, tracker["id"], week),
    ).fetchone()
    return (
        None if row is None else (normalise_kind_items(tracker["kind"], json.loads(row[0])), row[1])
    )


def _shown(
    conn: sqlite3.Connection, user_id: int, tracker: Tracker, week: str
) -> tuple[Owned, Tracked]:
    """What the week shows, writing nothing: its own plan and rev, or for a week without one the
    plan it carries (or the defaults) at rev 0, ready to be created as its own. Also the
    tracker's tracking, as read."""
    own = _own_plan(conn, user_id, tracker, week)
    tracked = load_tracked(conn, user_id, tracker["id"])
    if own is not None:
        return {"items": own[0], "rev": own[1], "copied_from": None}, tracked
    source = plan_source(tracked["plans"], week)
    items = normalise_kind_items(tracker["kind"], week_items(tracker["id"], tracked["plans"], week))
    return {"items": items, "rev": 0, "copied_from": source or "defaults"}, tracked


def own_week(
    conn: sqlite3.Connection, config: Config, user_id: int, tracker: str, week: str
) -> Owned:
    """The week's own plan; a week without one first gets a copy of the plan it shows (its plan
    source's, or the defaults), as the stores' `own()` does. Safe to repeat. `tracker` is an id
    or a name, and the week must show it."""
    found = find(conn, user_id, tracker)
    return _own(conn, config, user_id, found, _shown_week(found, week))


def _own(
    conn: sqlite3.Connection, config: Config, user_id: int, tracker: Tracker, week: str
) -> Owned:
    shown, _ = _shown(conn, user_id, tracker, week)
    if shown["copied_from"] is None:
        return shown
    with transaction(conn):
        result = _put(conn, config, user_id, tracker["id"], week, shown["items"], 0)
    if isinstance(result, PlanSaved):
        return {**shown, "rev": result.rev}
    # Another device created the week since it was read: its copy is the week's own plan now.
    assert result.items is not None  # rev 0 conflicts only with a stored plan
    return {"items": result.items, "rev": result.rev, "copied_from": None}


type Change = Callable[[list[Item], Tracked], tuple[list[Item], Item]]


def _notes(tracked: Tracked) -> dict[str, str]:
    """Each item's notes in the tracker, by id."""
    return {item_id: notes_of(tracked["details"], item_id) for item_id in tracked["details"]}


def _edit_plan(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    tracker: Tracker,
    week: str,
    change: Change,
    *,
    note: str | None = None,
    plan_changes: bool = True,
) -> PlanEdit:
    """Run `change` on the week's items and store the result in one write, replaying it on a
    conflict. `change` takes the items and the tracker's tracking, and returns the new items and
    the item it acted on, or raises EditError. The week must show the tracker.

    A week without its own plan is created with the change already applied to the copy, as the
    app's sync sends `own()` and the edit as one create at rev 0. A refusal therefore writes
    nothing, and the week goes on following its source.

    `note`, when given, becomes the acted-on item's notes in its details, in the same
    transaction. With `plan_changes` false (a note alone) the plan is not written at all: the
    week keeps its rev and, without a plan of its own, follows its source still."""
    week = _shown_week(tracker, week)
    tracker_id = tracker["id"]
    for _ in range(MAX_TRIES):
        owned, tracked = _shown(conn, user_id, tracker, week)
        before = owned["items"]
        after, item = change(copy.deepcopy(before), tracked)
        after = normalise_kind_items(tracker["kind"], after)
        notes_before = _notes(tracked)
        notes_after = dict(notes_before)
        rev, copied_from = owned["rev"], owned["copied_from"]
        try:
            with transaction(conn):
                if plan_changes:
                    result = _put(conn, config, user_id, tracker_id, week, after, owned["rev"])
                    if not isinstance(result, PlanSaved):
                        continue  # nothing written: read the newer week and run again
                    rev = result.rev
                else:
                    copied_from = None
                if note is not None:
                    notes_after[item["id"]] = data.set_notes_locked(
                        conn, user_id, tracker_id, item["id"], note, quota=config.user_quota_bytes
                    ).after
        except QuotaExceeded:
            raise EditError("quota", "the account is full, so nothing was changed") from None
        except DetailsTooLarge:
            raise EditError(
                "note", "is too long to save, over 32 KB as stored; shorten it"
            ) from None
        return {
            "tracker": tracker_id,
            "week": week,
            "item": in_words(item, notes_after.get(item["id"], "")),
            "before": [in_words(it, notes_before.get(it["id"], "")) for it in before],
            "after": [in_words(it, notes_after.get(it["id"], "")) for it in after],
            "rev": rev,
            "copied_from": copied_from,
        }
    raise EditError(
        "week",
        f"another device changed the week of {week} {MAX_TRIES} times while this edit ran; "
        "nothing was changed, so read the week and try again",
    )


def _ids(tracked: Tracked) -> set[str]:
    """Every id the tracker has used: in any week's plan, or in the log."""
    ids = {it["id"] for items in tracked["plans"].values() for it in items}
    ids.update(item_id for week in tracked["log"].values() for item_id in week)
    return ids


def add_item(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    tracker: str,
    week: str,
    fields: Mapping[str, object],
) -> PlanEdit:
    """Add an item to the end of the week, with a new id: the stores' `addExercise`,
    `addCardio`, `addFood`.
    A `note` becomes the new item's notes, in its details."""
    found = find(conn, user_id, tracker)
    kind = found["kind"]
    changes = _changes(kind, fields)
    note = changes.pop("notes", None)

    def add(items: list[Item], tracked: Tracked) -> tuple[list[Item], Item]:
        taken = _ids(tracked) | {it["id"] for it in default_items(found["id"])}
        item = _strict(kind, {**changes, "id": new_id(taken)})
        return [*items, item], item

    return _edit_plan(conn, config, user_id, found, week, add, note=note)


def update_item(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    tracker: str,
    week: str,
    item_id: str,
    fields: Mapping[str, object],
) -> PlanEdit:
    """Change the fields given of one item in the week, keeping its id, its place and the rest:
    the stores' `updateExercise`, `updateCardio`, `updateFood`. A `note` is the item's notes in
    its details,
    the same in every week; given alone, it writes no plan."""
    found = find(conn, user_id, tracker)
    kind = found["kind"]
    changes = _changes(kind, fields)
    note = changes.pop("notes", None)
    if not changes and note is None:
        raise EditError("item", f"nothing to change; give one of {', '.join(TYPE_WORDS[kind])}")
    item_id = _item_id(item_id)

    def update(items: list[Item], _: Tracked) -> tuple[list[Item], Item]:
        i = _find(items, item_id, week)
        items[i] = _strict(kind, {**items[i], **changes})
        return items, items[i]

    return _edit_plan(
        conn, config, user_id, found, week, update, note=note, plan_changes=bool(changes)
    )


def remove_item(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    tracker: str,
    week: str,
    item_id: str,
) -> PlanEdit:
    """Take one item out of the week; its marks stay in the log, uncounted, as in the app."""
    found = find(conn, user_id, tracker)
    item_id = _item_id(item_id)

    def remove(items: list[Item], _: Tracked) -> tuple[list[Item], Item]:
        item = items.pop(_find(items, item_id, week))
        return items, item

    return _edit_plan(conn, config, user_id, found, week, remove)


def mark_day(
    conn: sqlite3.Connection,
    config: Config,
    user_id: int,
    tracker: str,
    day: date,
    item_id: str,
    mark: Mark | None,
) -> MarkEdit:
    """Set one item's mark on one date, or clear it with None: the stores' `toggle`, landing on
    a chosen mark. The week is the date's Monday, and must show the tracker. It is owned first,
    as a tick on the device is, and an item the week does not show is refused."""
    found = find(conn, user_id, tracker)
    tracker_id, item_id = found["id"], _item_id(item_id)
    if mark is not None and not is_mark(mark):
        raise EditError(
            "mark",
            "must be one of great, partial, missed, each alone or with "
            "-solid or -hatch, or null to clear the day",
        )
    if found["kind"] == FOOD.id and mark is not None and mark not in FOOD_MARKS:
        raise EditError("mark", f"a food is marked {', '.join(FOOD_MARKS)}, or null")
    week = _shown_week(found, monday_of(day).isoformat(), "date")
    weekday = day.weekday()
    tracked = load_tracked(conn, user_id, tracker_id)
    _find(week_items(tracker_id, tracked["plans"], week), item_id, week)
    owned = _own(conn, config, user_id, found, week)
    before = tracked["log"].get(week, {}).get(item_id, [None] * 7)[weekday]
    try:
        days = data.set_tick(
            conn, user_id, tracker_id, week, item_id, weekday, mark, quota=config.user_quota_bytes
        )
    except QuotaExceeded:
        raise EditError("quota", "the account is full, so nothing was changed") from None
    return {
        "tracker": tracker_id,
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


def _patch_target(conn: sqlite3.Connection, user_id: int, tracker: Tracker, target: int) -> Tracker:
    """Set one tracker's daily target at its stored rev, replaying it on a conflict. The
    `exercise` and `diet` trackers' targets go to the settings too (`data.patch_tracker`)."""
    for _ in range(MAX_TRIES):
        result = data.patch_tracker(
            conn, user_id, tracker["id"], {"dailyTarget": target}, tracker["rev"]
        )
        if isinstance(result, data.TrackerSaved):
            return result.tracker
        if result is None:  # pragma: no cover (trackers are never removed, only ended)
            break
        tracker = result.tracker
    raise EditError(
        "tracker",
        f"another device changed {tracker['name']} {MAX_TRIES} times while this edit ran; "
        "nothing was changed, so try again",
    )


def set_daily_targets(
    conn: sqlite3.Connection,
    user_id: int,
    targets: Mapping[str, object] | None = None,
    *,
    exercises_a_day: object = None,
    foods_a_day: object = None,
) -> TargetsEdit:
    """Set the daily targets given, keeping everything else and Daily goal: the planner store's
    `changeDailyPick` and `changeFoodPick`, landing on a chosen number (1 to 8). `targets` maps
    a tracker's id or name to its number, and a refusal of a number names `daily_target`. The
    older form, `exercises_a_day` and `foods_a_day`, sets the `exercise` and `diet` trackers'.
    Every target is checked before any is written. While Daily goal is off (K85) the numbers
    are saved for when it is back on."""
    given: list[tuple[str, str, object]] = [
        (ref, "daily_target", value) for ref, value in (targets or {}).items()
    ]
    for ref, name, value in (
        ("exercise", "exercises_a_day", exercises_a_day),
        ("diet", "foods_a_day", foods_a_day),
    ):
        if value is not None:
            given.append((ref, name, value))
    if not given:
        raise EditError(
            "daily_target", "give a tracker and its daily_target, or exercises_a_day or foods_a_day"
        )
    trackers = data.load_trackers(conn, user_id)
    checked: list[tuple[Tracker, int]] = []
    for ref, name, value in given:
        try:
            tracker = find_tracker(trackers, ref)
        except InsightsError as e:
            raise EditError(e.field, str(e).removeprefix(f"{e.field}: ")) from None
        if TYPES[tracker["kind"]].daily_target is None:
            raise EditError(
                "tracker",
                f"{tracker['name']} is a {tracker['kind']} tracker: it has no daily target",
            )
        if any(t["id"] == tracker["id"] for t, _ in checked):
            raise EditError(name, f"{tracker['name']} is given twice; give its target once")
        checked.append((tracker, _daily(name, value)))
    changes: list[TargetChange] = []
    for tracker, target in checked:
        saved = _patch_target(conn, user_id, tracker, target)
        after = saved["dailyTarget"]
        assert after is not None  # a kind with a daily target, just set
        changes.append(
            {
                "tracker": tracker["id"],
                "name": tracker["name"],
                "before": tracker["dailyTarget"],
                "after": after,
            }
        )
    return {"targets": changes, "daily_goal": daily_goal(load_settings(conn, user_id))}
