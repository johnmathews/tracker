"""A user's trackers, plans, ticks, item details, settings and Ask history: reads, writes, import
and export (docs/api.md §3)."""

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, TypedDict

from .db import transaction
from .item_sections import normalise_item_sections, with_old_keys
from .types import SECTION_TYPES, TYPES, PickKey, TypeId
from .validate import (
    DEFAULT_WEEK_TITLE,
    EXPORT_FORMAT,
    EXPORT_VERSION,
    MAX_TRACKERS,
    SECTIONS,
    Conversation,
    Days,
    Details,
    DetailsMap,
    ExportData,
    Invalid,
    Item,
    Log,
    Mark,
    Portable,
    Tracked,
    Tracker,
    TrackerChanges,
    TrackerInfo,
    Turn,
    days_to_masks,
    details_fit,
    encode_details,
    is_week_title,
    masks_to_days,
    merge_conversations,
    merge_settings,
    merge_summary,
    normalise_details,
    normalise_kind_items,
    normalise_portable,
    parse_json,
)

#: What a tick row counts towards the quota: its key and masks, roughly, with the index's share.
TICK_BYTES = 64
#: What an Ask conversation or turn row counts besides its text: its key and times, as for a tick.
CONVERSATION_BYTES = 64
TURN_BYTES = 64


class QuotaExceeded(Exception):
    """A write would take the user over their quota (docs/api.md §3); nothing was changed."""


class DetailsTooLarge(Exception):
    """A details document over MAX_DETAILS_BYTES as stored; nothing was changed."""


class NoTracker(Invalid):
    """A write names a tracker id the user doesn't have; nothing was changed. REST answers it
    `400 invalid`, as it answered a section outside the fixed three."""


class TrackerExists(Exception):
    """A create names an id the user has, for a tracker of another kind; nothing was changed."""


class TooManyTrackers(Exception):
    """A create would take the user past MAX_TRACKERS; nothing was changed."""


def usage(conn: sqlite3.Connection, user_id: int) -> int:
    """The bytes of the user's plans' and item details' JSON, plus TICK_BYTES per tick row; and
    for Ask's history the bytes of each title, question and answer, plus CONVERSATION_BYTES and
    TURN_BYTES for each row."""
    stored = conn.execute(
        "SELECT"
        " (SELECT coalesce(sum(length(CAST(items_json AS BLOB))), 0)"
        "  FROM plans WHERE user_id = :user)"
        " + (SELECT coalesce(sum(length(CAST(details_json AS BLOB))), 0)"
        "  FROM item_details WHERE user_id = :user)",
        {"user": user_id},
    ).fetchone()[0]
    ticks = conn.execute("SELECT count(*) FROM ticks WHERE user_id = ?", (user_id,)).fetchone()[0]
    titles, conversations = conn.execute(
        "SELECT coalesce(sum(length(CAST(title AS BLOB))), 0), count(*)"
        " FROM ask_conversations WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    texts, turns = conn.execute(
        "SELECT coalesce(sum(length(CAST(question AS BLOB)) + length(CAST(answer AS BLOB))), 0),"
        " count(*) FROM ask_turns WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return (
        int(stored)
        + TICK_BYTES * int(ticks)
        + int(titles)
        + CONVERSATION_BYTES * int(conversations)
        + int(texts)
        + TURN_BYTES * int(turns)
    )


def turn_bytes(turn: Turn) -> int:
    return TURN_BYTES + len(turn["question"].encode()) + len(turn["answer"].encode())


def _check_growth(before: int, after: int, quota: int) -> None:
    # Level or shrinking writes always pass, so a full account can still trim itself.
    if after > before and after > quota:
        raise QuotaExceeded


class ImportResult(TypedDict):
    #: Trackers the file added.
    trackers: int
    weeks: int
    ticks: int
    details: int
    settings: bool
    conversations: int


@dataclass(frozen=True)
class PlanSaved:
    rev: int


@dataclass(frozen=True)
class PlanConflict:
    #: The server's copy; None when the server has no plan for the week.
    items: list[Item] | None
    rev: int


@dataclass(frozen=True)
class DetailsSaved:
    rev: int


@dataclass(frozen=True)
class DetailsConflict:
    #: The server's copy (`{}` once cleared); None when the item has never had details.
    details: Details | None
    rev: int


# --- trackers (spec §1 to §3) ---------------------------------------------------------------------

#: The settings column each of the first trackers with a daily target keeps it in step with, so a
#: tab on older code still reads it (spec §3), by the settings key that names it.
TARGET_SETTINGS: dict[str, tuple[PickKey, str]] = {
    "exercise": ("dailyPick", "daily_pick"),
    "diet": ("foodPick", "food_pick"),
}
_TRACKER_COLUMNS = "id, kind, name, position, daily_target, start_week, end_week, rev"


def _tracker(row: sqlite3.Row) -> Tracker:
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "position": row["position"],
        "dailyTarget": row["daily_target"],
        "startWeek": row["start_week"],
        "endWeek": row["end_week"],
        "rev": row["rev"],
    }


def load_trackers(conn: sqlite3.Connection, user_id: int) -> list[Tracker]:
    """The user's trackers, ended ones included, in the week's order: by position, then id."""
    return [
        _tracker(r)
        for r in conn.execute(
            f"SELECT {_TRACKER_COLUMNS} FROM trackers WHERE user_id = ?"  # noqa: S608
            " ORDER BY position, id",
            (user_id,),
        )
    ]


def load_tracker(conn: sqlite3.Connection, user_id: int, tracker_id: str) -> Tracker | None:
    row = conn.execute(
        f"SELECT {_TRACKER_COLUMNS} FROM trackers WHERE user_id = ? AND id = ?",  # noqa: S608
        (user_id, tracker_id),
    ).fetchone()
    return None if row is None else _tracker(row)


def shows_in(tracker: TrackerInfo, week: str) -> bool:
    """Whether a tracker shows in the week whose Monday is `week` (spec §2): from its start
    week, or always without one, up to but not including its end week. The week view, Edit
    plan, print, the Claude tools and Ask all follow it."""
    start, end = tracker["startWeek"], tracker["endWeek"]
    return (start is None or start <= week) and (end is None or end > week)


def trackers_in(conn: sqlite3.Connection, user_id: int, week: str) -> list[Tracker]:
    """The user's trackers that show in `week`, in the week's order."""
    return [t for t in load_trackers(conn, user_id) if shows_in(t, week)]


def tracker_kind(conn: sqlite3.Connection, user_id: int, tracker_id: str) -> TypeId:
    """A tracker's kind, or NoTracker when the user has no tracker with that id."""
    row = conn.execute(
        "SELECT kind FROM trackers WHERE user_id = ? AND id = ?", (user_id, tracker_id)
    ).fetchone()
    if row is None:
        raise NoTracker(f"no tracker {tracker_id!r}")
    kind: TypeId = row["kind"]
    return kind


def _next_position(conn: sqlite3.Connection, user_id: int) -> int:
    row = conn.execute(
        "SELECT coalesce(max(position) + 1, 0) FROM trackers WHERE user_id = ?", (user_id,)
    ).fetchone()
    return int(row[0])


def _insert_tracker(conn: sqlite3.Connection, user_id: int, t: TrackerInfo) -> None:
    conn.execute(
        "INSERT INTO trackers"
        " (user_id, id, kind, name, position, daily_target, start_week, end_week, rev)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
        (
            user_id,
            t["id"],
            t["kind"],
            t["name"],
            t["position"],
            t["dailyTarget"],
            t["startWeek"],
            t["endWeek"],
        ),
    )


def create_tracker(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, name: str, kind: TypeId, week: str
) -> tuple[Tracker, bool]:
    """Add a tracker after the user's others, empty, starting in `week` with its kind's default
    daily target; and whether it was added. An id the user already has for a tracker of the same
    kind is a create sent again (an outbox replaying it): the stored tracker comes back as it is.
    Raises TrackerExists for another kind, and TooManyTrackers past MAX_TRACKERS."""
    with transaction(conn):
        existing = load_tracker(conn, user_id, tracker_id)
        if existing is not None:
            if existing["kind"] != kind:
                raise TrackerExists
            return existing, False
        count = conn.execute(
            "SELECT count(*) FROM trackers WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        if count >= MAX_TRACKERS:
            raise TooManyTrackers
        tracker: Tracker = {
            "id": tracker_id,
            "name": name,
            "kind": kind,
            "position": _next_position(conn, user_id),
            "dailyTarget": TYPES[kind].daily_target,
            "startWeek": week,
            "endWeek": None,
            "rev": 1,
        }
        _insert_tracker(conn, user_id, tracker)
    return tracker, True


@dataclass(frozen=True)
class TrackerSaved:
    tracker: Tracker


@dataclass(frozen=True)
class TrackerConflict:
    #: The server's copy, its revision in `rev`.
    tracker: Tracker


def _sync_setting(conn: sqlite3.Connection, user_id: int, tracker_id: str, target: int) -> None:
    """Write a first tracker's daily target to the settings column kept in step with it. With no
    settings saved there is nothing to keep in step: the tracker holds it alone."""
    if tracker_id in TARGET_SETTINGS:
        column = TARGET_SETTINGS[tracker_id][1]
        conn.execute(
            f"UPDATE settings SET {column} = ? WHERE user_id = ?",  # noqa: S608
            (target, user_id),
        )


def patch_tracker(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, changes: TrackerChanges, rev: int
) -> TrackerSaved | TrackerConflict | None:
    """Change a tracker's name, position or daily target if `rev` is current, by put_plan's
    rules: a stale `rev` conflicts unless the tracker already reads so. None when the user has
    no such tracker. The `exercise` and `diet` trackers' targets go to the settings too."""
    with transaction(conn):
        stored = load_tracker(conn, user_id, tracker_id)
        if stored is None:
            return None
        merged: Tracker = {**stored, **changes}
        if merged == stored:
            return TrackerSaved(stored)
        if rev != stored["rev"]:
            return TrackerConflict(stored)
        merged["rev"] = stored["rev"] + 1
        conn.execute(
            "UPDATE trackers SET name = ?, position = ?, daily_target = ?, rev = ?"
            " WHERE user_id = ? AND id = ?",
            (
                merged["name"],
                merged["position"],
                merged["dailyTarget"],
                merged["rev"],
                user_id,
                tracker_id,
            ),
        )
        target = merged["dailyTarget"]
        if target is not None and target != stored["dailyTarget"]:
            _sync_setting(conn, user_id, tracker_id, target)
    return TrackerSaved(merged)


def end_tracker(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, week: str
) -> Tracker | None:
    """Delete tracker (K122): end it from the week whose Monday is `week`, so it shows in no week
    from it on. Its plans, marks and details stay, and earlier weeks still show it. An ended
    tracker keeps its earlier end: ending never brings a week back. None when the user has no
    such tracker."""
    with transaction(conn):
        stored = load_tracker(conn, user_id, tracker_id)
        if stored is None:
            return None
        end = stored["endWeek"]
        if end is not None and end <= week:
            return stored
        conn.execute(
            "UPDATE trackers SET end_week = ?, rev = rev + 1 WHERE user_id = ? AND id = ?",
            (week, user_id, tracker_id),
        )
    return {**stored, "endWeek": week, "rev": stored["rev"] + 1}


def stored_items(items_json: str) -> list[Item]:
    """A stored plan's items. A plan written before item details still holds its items' notes
    until it is next written; they are the item's details now (migration 7, D3), so they are
    left out here and nothing reads them from the plan."""
    items: list[Any] = json.loads(items_json)
    return [
        {k: v for k, v in item.items() if k != "notes"} if isinstance(item, dict) else item
        for item in items
    ]


def load_details(conn: sqlite3.Connection, user_id: int, section: str) -> DetailsMap:
    """A tracker's item details, leaving out cleared (empty) documents."""
    out: DetailsMap = {}
    for r in conn.execute(
        "SELECT item_id, details_json FROM item_details"
        " WHERE user_id = ? AND section = ? ORDER BY item_id",
        (user_id, section),
    ):
        details: Details = json.loads(r["details_json"])
        if details:
            out[r["item_id"]] = details
    return out


def notes_of(details: DetailsMap, item_id: str) -> str:
    """An item's notes from its section's details, one copy for every week (D3); "" for none."""
    return details.get(item_id, {}).get("notes", "")


def load_tracked(conn: sqlite3.Connection, user_id: int, section: str) -> Tracked:
    """A tracker's plans, log and item details, by its id (the stored `section`)."""
    plans = {
        r["week"]: stored_items(r["items_json"])
        for r in conn.execute(
            "SELECT week, items_json FROM plans WHERE user_id = ? AND section = ? ORDER BY week",
            (user_id, section),
        )
    }
    log: Log = {}
    for r in conn.execute(
        "SELECT week, item_id, days, partial, missed, solid, hatch FROM ticks"
        " WHERE user_id = ? AND section = ? ORDER BY week",
        (user_id, section),
    ):
        log.setdefault(r["week"], {})[r["item_id"]] = masks_to_days(
            r["days"], r["partial"], r["missed"], r["solid"], r["hatch"]
        )
    return {"plans": plans, "log": log, "details": load_details(conn, user_id, section)}


def load_settings(conn: sqlite3.Connection, user_id: int) -> Portable | None:
    row = conn.execute(
        "SELECT accent, daily_pick, food_pick, goals, limits, daily_goal, week_title,"
        " item_sections FROM settings WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    settings: Portable = {
        "accent": row["accent"],
        "dailyPick": row["daily_pick"],
        "foodPick": row["food_pick"],
        "goals": row["goals"],
        "limits": row["limits"],
        "dailyGoal": bool(row["daily_goal"]),
        "weekTitle": row["week_title"],
    }
    # Normalised on the way out too, so a type this version's registry lacks drops (P29).
    stored = row["item_sections"]
    item_sections = normalise_item_sections(parse_json(stored) if stored is not None else None)
    if item_sections:
        settings["itemSections"] = item_sections
    return settings


def _revs(conn: sqlite3.Connection, user_id: int, section: str) -> tuple[Any, Any]:
    """A tracker's plans' revisions by week, and its details' by item id (cleared ones too)."""
    key = (user_id, section)
    revs = {
        r["week"]: r["rev"]
        for r in conn.execute("SELECT week, rev FROM plans WHERE user_id = ? AND section = ?", key)
    }
    detail_revs = {
        r["item_id"]: r["rev"]
        for r in conn.execute(
            "SELECT item_id, rev FROM item_details WHERE user_id = ? AND section = ?", key
        )
    }
    return revs, detail_revs


def state(conn: sqlite3.Connection, user_id: int) -> dict[str, Any]:
    """Everything the client renders: the trackers, ended ones included; per tracker id its plans,
    log and plan revisions by week (`sections`), its item details (`details`) and their revisions
    by item id (`detailRevs`, which also lists items whose details were cleared); and settings.

    The first three trackers' data also goes under the keys of version 5 (`exercise`, `cardio`,
    `diet`, each `{plans, log, details, revs, detailRevs}`), and an arrangement of the strength
    kind's pages under its old key too, so a tab still running that code keeps working."""
    trackers = load_trackers(conn, user_id)
    ids = [t["id"] for t in trackers]
    out: dict[str, Any] = {"trackers": trackers, "sections": {}, "details": {}, "detailRevs": {}}
    for tracker_id in ids + [s for s in SECTIONS if s not in ids]:
        tracked = load_tracked(conn, user_id, tracker_id)
        revs, detail_revs = _revs(conn, user_id, tracker_id)
        out["sections"][tracker_id] = {
            "plans": tracked["plans"],
            "log": tracked["log"],
            "revs": revs,
        }
        out["details"][tracker_id] = tracked["details"]
        out["detailRevs"][tracker_id] = detail_revs
    for section in SECTIONS:
        out[section] = {
            **out["sections"][section],
            "details": out["details"][section],
            "detailRevs": out["detailRevs"][section],
        }
    out["settings"] = for_older_tabs(load_settings(conn, user_id))
    return out


def for_older_tabs(settings: Portable | None) -> dict[str, Any] | None:
    """Settings as the state and `PUT /api/settings` send them: an arrangement of a renamed kind
    goes under its old key too (`item_sections.with_old_keys`)."""
    if settings is None:
        return None
    out: dict[str, Any] = dict(settings)
    if "itemSections" in settings:
        out["itemSections"] = with_old_keys(settings["itemSections"])
    return out


def put_plan(
    conn: sqlite3.Connection,
    user_id: int,
    section: str,
    week: str,
    raw_items: list[Any],
    rev: int,
    *,
    quota: int,
) -> PlanSaved | PlanConflict:
    """Store a week's plan if `rev` is current. A stale `rev` conflicts unless the items match."""
    with transaction(conn):
        return put_plan_locked(conn, user_id, section, week, raw_items, rev, quota=quota)


def put_plan_locked(
    conn: sqlite3.Connection,
    user_id: int,
    section: str,
    week: str,
    raw_items: list[Any],
    rev: int,
    *,
    quota: int,
) -> PlanSaved | PlanConflict:
    """`put_plan` for a caller already inside `transaction`, so that one transaction can hold
    more writes (edits.py: a plan and an item's notes). The items are validated by the tracker's
    kind; NoTracker when the user has no tracker `section`."""
    items = normalise_kind_items(tracker_kind(conn, user_id, section), raw_items)
    encoded = json.dumps(items)
    row = conn.execute(
        "SELECT items_json, rev FROM plans WHERE user_id = ? AND section = ? AND week = ?",
        (user_id, section, week),
    ).fetchone()
    current = 0 if row is None else int(row["rev"])
    if rev == current:
        before = usage(conn, user_id)
        old_size = 0 if row is None else len(row["items_json"].encode())
        _check_growth(before, before - old_size + len(encoded.encode()), quota)
        conn.execute(
            "INSERT INTO plans (user_id, section, week, items_json, rev) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT (user_id, section, week)"
            " DO UPDATE SET items_json = excluded.items_json, rev = excluded.rev",
            (user_id, section, week, encoded, current + 1),
        )
        return PlanSaved(current + 1)
    stored = None if row is None else stored_items(row["items_json"])
    # Two devices creating the same carried-forward week send identical items: not a conflict.
    if stored is not None and stored == items:
        return PlanSaved(current)
    return PlanConflict(stored, current)


def put_details(
    conn: sqlite3.Connection,
    user_id: int,
    section: str,
    item_id: str,
    raw: dict[str, Any],
    rev: int,
    *,
    quota: int,
) -> DetailsSaved | DetailsConflict:
    """Store an item's details if `rev` is current, by put_plan's rules: a stale `rev` conflicts
    unless the stored document already equals the sent one after validation. An empty document
    is stored too, so the revision keeps counting and a device holding an older one conflicts.
    Raises DetailsTooLarge for a document over MAX_DETAILS_BYTES, and NoTracker when the user
    has no tracker `section`."""
    details = normalise_details(raw)
    assert details is not None  # `raw` is an object
    if not details_fit(details):
        raise DetailsTooLarge
    with transaction(conn):
        tracker_kind(conn, user_id, section)
        row = _details_row(conn, user_id, section, item_id)
        current = 0 if row is None else int(row["rev"])
        if rev == current:
            saved = _write_details(conn, user_id, section, item_id, details, row, quota)
            return DetailsSaved(saved)
        stored: Details | None = None if row is None else json.loads(row["details_json"])
        if stored is not None and stored == details:
            return DetailsSaved(current)
        return DetailsConflict(stored, current)


@dataclass(frozen=True)
class NotesSet:
    #: The item's notes before and after; "" for none.
    before: str
    after: str
    #: The details' revision now: unchanged when the notes already read so.
    rev: int


def set_notes_locked(
    conn: sqlite3.Connection,
    user_id: int,
    section: str,
    item_id: str,
    text: str,
    *,
    quota: int,
) -> NotesSet:
    """Set an item's notes, or clear them with blank text, keeping its fields: the details
    store's `setNotes` (src/stores/details.ts), for a caller already inside `transaction`.

    The document is validated as `put_details` validates it, at the stored revision, so the
    write never conflicts; it moves the revision on, so a device holding the older copy gets a
    409 on its next write and adopts this one. Raises DetailsTooLarge or QuotaExceeded."""
    row = _details_row(conn, user_id, section, item_id)
    stored: Details = {} if row is None else json.loads(row["details_json"])
    details = normalise_details({**stored, "notes": text})
    assert details is not None  # an object
    before, after = stored.get("notes", ""), details.get("notes", "")
    current = 0 if row is None else int(row["rev"])
    if details == stored:
        return NotesSet(before, after, current)
    if not details_fit(details):
        raise DetailsTooLarge
    return NotesSet(
        before, after, _write_details(conn, user_id, section, item_id, details, row, quota)
    )


def _details_row(
    conn: sqlite3.Connection, user_id: int, section: str, item_id: str
) -> sqlite3.Row | None:
    row: sqlite3.Row | None = conn.execute(
        "SELECT details_json, rev FROM item_details"
        " WHERE user_id = ? AND section = ? AND item_id = ?",
        (user_id, section, item_id),
    ).fetchone()
    return row


def _write_details(
    conn: sqlite3.Connection,
    user_id: int,
    section: str,
    item_id: str,
    details: Details,
    row: sqlite3.Row | None,
    quota: int,
) -> int:
    """Store a validated document over `row` (read in this transaction) at the next revision,
    within the quota; the new revision."""
    encoded = encode_details(details)
    current = 0 if row is None else int(row["rev"])
    before = usage(conn, user_id)
    old_size = 0 if row is None else len(row["details_json"].encode())
    _check_growth(before, before - old_size + len(encoded.encode()), quota)
    conn.execute(
        "INSERT INTO item_details (user_id, section, item_id, details_json, rev)"
        " VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, section, item_id)"
        " DO UPDATE SET details_json = excluded.details_json, rev = excluded.rev",
        (user_id, section, item_id, encoded, current + 1),
    )
    return current + 1


def set_tick(
    conn: sqlite3.Connection,
    user_id: int,
    section: str,
    week: str,
    item_id: str,
    day: int,
    mark: Mark | None,
    *,
    quota: int,
) -> Days:
    """Set or clear one day's mark for one item in one upsert; returns the item's seven marks.

    Only a tick that adds a row can exceed the quota, so only that case pays for the check.
    NoTracker when the user has no tracker `section`.
    """
    bit = 1 << day
    days, partial, missed, solid, hatch = days_to_masks(
        [mark if i == day else None for i in range(7)]
    )
    key = (user_id, section, week, item_id)
    with transaction(conn):
        tracker_kind(conn, user_id, section)
        exists = conn.execute(
            "SELECT 1 FROM ticks WHERE user_id = ? AND section = ? AND week = ? AND item_id = ?",
            key,
        ).fetchone()
        if exists is None:
            before = usage(conn, user_id)
            _check_growth(before, before + TICK_BYTES, quota)
        # The day's bit is cleared in every mask, then set in the ones its new mark belongs to.
        row = conn.execute(
            "INSERT INTO ticks"
            " (user_id, section, week, item_id, days, partial, missed, solid, hatch)"
            " VALUES (:user, :section, :week, :item, :days, :partial, :missed, :solid, :hatch)"
            " ON CONFLICT (user_id, section, week, item_id) DO UPDATE SET"
            " days = (days & ~:bit) | excluded.days,"
            " partial = (partial & ~:bit) | excluded.partial,"
            " missed = (missed & ~:bit) | excluded.missed,"
            " solid = (solid & ~:bit) | excluded.solid,"
            " hatch = (hatch & ~:bit) | excluded.hatch"
            " RETURNING days, partial, missed, solid, hatch",
            {
                "user": user_id,
                "section": section,
                "week": week,
                "item": item_id,
                "days": days,
                "partial": partial,
                "missed": missed,
                "solid": solid,
                "hatch": hatch,
                "bit": bit,
            },
        ).fetchone()
    return masks_to_days(
        int(row["days"]),
        int(row["partial"]),
        int(row["missed"]),
        int(row["solid"]),
        int(row["hatch"]),
    )


def put_settings(conn: sqlite3.Connection, user_id: int, raw: dict[str, Any]) -> Portable:
    """Store the settings, and the daily targets on the `exercise` and `diet` trackers with them:
    two writes, so the caller holds a transaction."""
    # A tab still running the app from before foods a day (K57) sends no foodPick, and one from
    # before arranging the item page (K66) no itemSections, one from before My goals no goals, one
    # from before Daily goal (K85) no dailyGoal, one from before the limits note (K107) no limits,
    # and one from before the week title (K131) no weekTitle; keep the saved ones rather than
    # reset them. The app sends `itemSections: {}` for the default arrangement. Goals or limits
    # that aren't a string count as not sent, and a tab never sends a note it hasn't read (F1); a
    # dailyGoal that isn't a boolean likewise (F2), and a weekTitle that isn't "dates" or
    # "number". The result always has dailyGoal, on when nothing gave one, and weekTitle, dates
    # when nothing gave one.
    saved = load_settings(conn, user_id)
    if saved is not None:
        if "foodPick" not in raw:
            raw = {**raw, "foodPick": saved["foodPick"]}
        if not isinstance(raw.get("dailyGoal"), bool):
            raw = {**raw, "dailyGoal": saved["dailyGoal"]}
        if not is_week_title(raw.get("weekTitle")):
            raw = {**raw, "weekTitle": saved["weekTitle"]}
        if "itemSections" not in raw:
            raw = {**raw, "itemSections": saved.get("itemSections", {})}
        if not isinstance(raw.get("goals"), str):
            raw = {**raw, "goals": saved["goals"]}
        if not isinstance(raw.get("limits"), str):
            raw = {**raw, "limits": saved["limits"]}
    settings = normalise_portable(raw)
    settings.setdefault("dailyGoal", True)
    settings.setdefault("weekTitle", DEFAULT_WEEK_TITLE)
    item_sections = settings.get("itemSections")
    conn.execute(
        "INSERT INTO settings"
        " (user_id, accent, daily_pick, food_pick, goals, limits, daily_goal, week_title,"
        " item_sections) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id) DO UPDATE SET accent = excluded.accent,"
        " daily_pick = excluded.daily_pick, food_pick = excluded.food_pick,"
        " goals = excluded.goals, limits = excluded.limits, daily_goal = excluded.daily_goal,"
        " week_title = excluded.week_title, item_sections = excluded.item_sections",
        (
            user_id,
            settings["accent"],
            settings["dailyPick"],
            settings["foodPick"],
            settings["goals"],
            settings["limits"],
            int(settings["dailyGoal"]),
            settings["weekTitle"],
            json.dumps(item_sections, separators=(",", ":")) if item_sections else None,
        ),
    )
    # The `exercise` and `diet` trackers hold the daily targets now; a tab on older code still
    # sends them here, so they move in step (spec §3). A change moves the revision on.
    for tracker_id, (key, _) in TARGET_SETTINGS.items():
        conn.execute(
            "UPDATE trackers SET daily_target = :target, rev = rev + 1"
            " WHERE user_id = :user AND id = :id AND daily_target IS NOT :target",
            {"target": settings[key], "user": user_id, "id": tracker_id},
        )
    return settings


# --- Ask's history (docs/api.md §3.2) -------------------------------------------------------------


class ConversationSummary(TypedDict):
    id: str
    title: str
    updatedAt: int
    #: How many turns it has.
    turns: int


#: What became of a turn: kept, refused by the quota, or its conversation was deleted meanwhile.
type Saved = Literal["saved", "full", "gone"]


def create_conversation(
    conn: sqlite3.Connection, user_id: int, conversation_id: str, title: str, now: int
) -> None:
    conn.execute(
        "INSERT INTO ask_conversations (user_id, id, title, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (user_id, conversation_id, title, now, now),
    )


def has_conversation(conn: sqlite3.Connection, user_id: int, conversation_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM ask_conversations WHERE user_id = ? AND id = ?", (user_id, conversation_id)
    ).fetchone()
    return row is not None


def load_turns(conn: sqlite3.Connection, user_id: int, conversation_id: str) -> list[Turn]:
    """A conversation's turns, oldest first."""
    return [
        {
            "question": r["question"],
            "answer": r["answer"],
            "stop": r["stop"],
            "askedAt": r["asked_at"],
        }
        for r in conn.execute(
            "SELECT question, answer, stop, asked_at FROM ask_turns"
            " WHERE user_id = ? AND conversation_id = ? ORDER BY seq",
            (user_id, conversation_id),
        )
    ]


def save_turn(
    conn: sqlite3.Connection,
    user_id: int,
    conversation_id: str,
    turn: Turn,
    now: int,
    *,
    quota: int,
) -> Saved:
    """Add a turn at the end of a conversation and mark it updated, unless the conversation is
    gone or the turn would take the account over its quota. A conversation refused its first turn
    is removed too, so a full account keeps nothing of the question."""
    with transaction(conn):
        if not has_conversation(conn, user_id, conversation_id):
            return "gone"
        key = (user_id, conversation_id)
        seq = conn.execute(
            "SELECT count(*), coalesce(max(seq) + 1, 0) FROM ask_turns"
            " WHERE user_id = ? AND conversation_id = ?",
            key,
        ).fetchone()
        before = usage(conn, user_id)
        try:
            _check_growth(before, before + turn_bytes(turn), quota)
        except QuotaExceeded:
            if seq[0] == 0:
                conn.execute("DELETE FROM ask_conversations WHERE user_id = ? AND id = ?", key)
            return "full"
        conn.execute(
            "INSERT INTO ask_turns"
            " (user_id, conversation_id, seq, question, answer, stop, asked_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (*key, seq[1], turn["question"], turn["answer"], turn["stop"], turn["askedAt"]),
        )
        conn.execute(
            "UPDATE ask_conversations SET updated_at = ? WHERE user_id = ? AND id = ?",
            (now, *key),
        )
    return "saved"


def list_conversations(conn: sqlite3.Connection, user_id: int) -> list[ConversationSummary]:
    """The account's conversations, the one updated last first."""
    return [
        {"id": r["id"], "title": r["title"], "updatedAt": r["updated_at"], "turns": r["turns"]}
        for r in conn.execute(
            "SELECT c.id, c.title, c.updated_at,"
            " (SELECT count(*) FROM ask_turns t WHERE t.user_id = c.user_id"
            " AND t.conversation_id = c.id) AS turns"
            " FROM ask_conversations c WHERE c.user_id = ?"
            " ORDER BY c.updated_at DESC, c.created_at DESC, c.id",
            (user_id,),
        )
    ]


def load_conversations(conn: sqlite3.Connection, user_id: int) -> list[Conversation]:
    """Every conversation with its turns, as an export carries them: the one updated last first."""
    turns: dict[str, list[Turn]] = {}
    for r in conn.execute(
        "SELECT conversation_id, question, answer, stop, asked_at FROM ask_turns"
        " WHERE user_id = ? ORDER BY conversation_id, seq",
        (user_id,),
    ):
        turns.setdefault(r["conversation_id"], []).append(
            {
                "question": r["question"],
                "answer": r["answer"],
                "stop": r["stop"],
                "askedAt": r["asked_at"],
            }
        )
    return [
        {
            "id": r["id"],
            "title": r["title"],
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
            "turns": turns.get(r["id"], []),
        }
        for r in conn.execute(
            "SELECT id, title, created_at, updated_at FROM ask_conversations WHERE user_id = ?"
            " ORDER BY updated_at DESC, created_at DESC, id",
            (user_id,),
        )
    ]


def load_conversation(
    conn: sqlite3.Connection, user_id: int, conversation_id: str
) -> Conversation | None:
    row = conn.execute(
        "SELECT id, title, created_at, updated_at FROM ask_conversations"
        " WHERE user_id = ? AND id = ?",
        (user_id, conversation_id),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "title": row["title"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "turns": load_turns(conn, user_id, conversation_id),
    }


def delete_conversation(conn: sqlite3.Connection, user_id: int, conversation_id: str) -> bool:
    """Delete a conversation and its turns; False when the account has no such conversation."""
    cur = conn.execute(
        "DELETE FROM ask_conversations WHERE user_id = ? AND id = ?", (user_id, conversation_id)
    )
    return cur.rowcount > 0


def delete_conversations(conn: sqlite3.Connection, user_id: int) -> None:
    """Delete every conversation of the account, and with them every turn."""
    conn.execute("DELETE FROM ask_conversations WHERE user_id = ?", (user_id,))


def _insert_conversation(conn: sqlite3.Connection, user_id: int, c: Conversation) -> None:
    conn.execute(
        "INSERT INTO ask_conversations (user_id, id, title, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (user_id, c["id"], c["title"], c["createdAt"], c["updatedAt"]),
    )
    conn.executemany(
        "INSERT INTO ask_turns (user_id, conversation_id, seq, question, answer, stop, asked_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (user_id, c["id"], seq, t["question"], t["answer"], t["stop"], t["askedAt"])
            for seq, t in enumerate(c["turns"])
        ],
    )


# --- export and import ---------------------------------------------------------------------------


def export_file(conn: sqlite3.Connection, user_id: int, now: int) -> dict[str, Any]:
    """The file Settings → Export writes, version 6: the trackers, ended ones included, each
    tracker's plans and log under `sections` and its items' details under `details`, both by
    tracker id; the settings; and Ask's conversations, which only the server holds."""
    trackers: list[TrackerInfo] = []
    sections: dict[str, Any] = {}
    details: dict[str, DetailsMap] = {}
    for t in load_trackers(conn, user_id):
        info: dict[str, Any] = {k: v for k, v in t.items() if k != "rev"}
        trackers.append(info)  # type: ignore[arg-type]
        tracked = load_tracked(conn, user_id, t["id"])
        sections[t["id"]] = {"plans": tracked["plans"], "log": tracked["log"]}
        details[t["id"]] = tracked["details"]
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        # JavaScript's toISOString shape, milliseconds included.
        "exportedAt": datetime.fromtimestamp(now, UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "trackers": trackers,
        "sections": sections,
        "details": details,
        "settings": load_settings(conn, user_id),
        "conversations": load_conversations(conn, user_id),
    }


def _add_trackers(conn: sqlite3.Connection, user_id: int, data: ExportData) -> dict[str, TypeId]:
    """Add the file's trackers the user has no id for, after the user's own in the file's order,
    up to MAX_TRACKERS; each keeps its name, kind, daily target and weeks. A tracker the user has
    is never changed, and never ended. Returns the kind of every tracker the user now has."""
    have = {t["id"]: t["kind"] for t in load_trackers(conn, user_id)}
    position = _next_position(conn, user_id)
    for t in sorted(data["trackers"], key=lambda t: t["position"]):
        if t["id"] in have or len(have) >= MAX_TRACKERS:
            continue
        _insert_tracker(conn, user_id, {**t, "position": position})
        have[t["id"]] = t["kind"]
        position += 1
    return have


def import_data(
    conn: sqlite3.Connection, user_id: int, data: ExportData, *, quota: int
) -> ImportResult:
    """Merge a parsed export in, never deleting (architecture.md §4); returns what it added.

    The file's trackers the user lacks come first (`_add_trackers`). Then each tracker's data
    merges by id: a file from before version 6 has only the first three. Data for a tracker the
    user doesn't have, or has with another kind, is passed over."""
    weeks = ticks = details = 0
    kinds: dict[str, TypeId] = {s: t.id for s, t in SECTION_TYPES.items()}
    kinds.update({t["id"]: t["kind"] for t in data["trackers"]})
    with transaction(conn):
        before = usage(conn, user_id)
        trackers_before = len(load_trackers(conn, user_id))
        have = _add_trackers(conn, user_id, data)
        for section, incoming in data["sections"].items():
            if have.get(section) != kinds.get(section):
                continue
            existing = load_tracked(conn, user_id, section)
            summary = merge_summary(existing, incoming)
            weeks += summary["weeks"]
            ticks += summary["ticks"]
            details += summary["details"]
            for item_id, doc in incoming["details"].items():
                # An item with details keeps them. One whose details were cleared takes the
                # file's as a new revision, so a device holding the cleared one conflicts.
                if item_id not in existing["details"]:
                    conn.execute(
                        "INSERT INTO item_details (user_id, section, item_id, details_json, rev)"
                        " VALUES (?, ?, ?, ?, 1) ON CONFLICT (user_id, section, item_id)"
                        " DO UPDATE SET details_json = excluded.details_json, rev = rev + 1",
                        (user_id, section, item_id, encode_details(doc)),
                    )
            for week, items in incoming["plans"].items():
                if week not in existing["plans"]:
                    conn.execute(
                        "INSERT INTO plans (user_id, section, week, items_json, rev)"
                        " VALUES (?, ?, ?, ?, 1)",
                        (user_id, section, week, json.dumps(items)),
                    )
            for week, entries in incoming["log"].items():
                for item_id, days in entries.items():
                    # An all-empty row is kept too, so an export of the result matches the file.
                    # A marked day keeps its mark: SET reads the old row, so `~days` masks off
                    # the days already marked before the file's are OR-ed in.
                    conn.execute(
                        "INSERT INTO ticks"
                        " (user_id, section, week, item_id, days, partial, missed, solid, hatch)"
                        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                        " ON CONFLICT (user_id, section, week, item_id) DO UPDATE SET"
                        " days = days | excluded.days,"
                        " partial = partial | (excluded.partial & ~days),"
                        " missed = missed | (excluded.missed & ~days),"
                        " solid = solid | (excluded.solid & ~days),"
                        " hatch = hatch | (excluded.hatch & ~days)",
                        (user_id, section, week, item_id, *days_to_masks(days)),
                    )
        # Saved settings stay, but the file's goals and limits fill empty ones (merge_settings).
        saved = load_settings(conn, user_id)
        merged = merge_settings(saved, data["settings"])
        applied = False
        if merged is not None and merged != saved:
            put_settings(conn, user_id, dict(merged))
            applied = True
        # Conversations the account has stay as they are; the file's others are added.
        kept = load_conversations(conn, user_id)
        added = merge_conversations(kept, data.get("conversations", []))[len(kept) :]
        for conversation in added:
            _insert_conversation(conn, user_id, conversation)
        # Raising inside the transaction rolls the whole merge back.
        _check_growth(before, usage(conn, user_id), quota)
    return {
        "trackers": len(have) - trackers_before,
        "weeks": weeks,
        "ticks": ticks,
        "details": details,
        "settings": applied,
        "conversations": len(added),
    }
