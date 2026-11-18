"""A user's trackers, plans, ticks, item details, settings and Ask history: reads, writes, import
and export (docs/api.md §3). Also the programme library and its runs: starting a run, its
changes, the weeks it writes, the lock on past days and the evidence (sealed days, mark events)
of docs/specs/2026-11-17-programmes.md §4 to §8."""

import json
import logging
import sqlite3
import time
from collections.abc import Callable, Container, Mapping
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta, tzinfo
from decimal import Decimal
from typing import Any, Literal, NotRequired, TypedDict, cast
from zoneinfo import ZoneInfo

from .config import DEFAULT_TIMEZONE
from .db import transaction
from .item_sections import normalise_item_sections, with_old_keys
from .programme import (
    Activity,
    Programme,
    ProgrammeError,
    ProgrammeInvalid,
    check_programme,
    parse_programme,
    resolve,
)
from .programme_replay import (
    ActivityDay,
    Change,
    DayPlan,
    Preview,
    Replay,
    Run,
    WeekPlan,
    day_from_json,
    day_to_json,
    preview_change,
    replay,
    start_run,
    week_items,
)
from .types import SECTION_TYPES, TYPES, PickKey, TypeId
from .validate import (
    BLANK,
    DEFAULT_WEEK_TITLE,
    EXPORT_FORMAT,
    EXPORT_VERSION,
    MAX_REASON,
    MAX_TRACKER_NAME,
    MAX_TRACKERS,
    SECTIONS,
    Conversation,
    Days,
    Details,
    DetailsMap,
    ExportData,
    ImportData,
    Invalid,
    Item,
    Log,
    Mark,
    MarkEventFile,
    Portable,
    ProgrammeFile,
    RunFile,
    Tracked,
    Tracker,
    TrackerChanges,
    TrackerInfo,
    Turn,
    days_to_masks,
    details_fit,
    encode_details,
    is_date,
    is_week_title,
    masks_to_days,
    merge_conversations,
    merge_settings,
    merge_summary,
    normalise_details,
    normalise_kind_items,
    normalise_portable,
    normalise_reason,
    parse_json,
)

log = logging.getLogger(__name__)

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


#: What a run reads as today: before its start, running, the programme paused, or ended.
type RunStatus = Literal["upcoming", "running", "paused", "ended"]
#: The log row End programme writes. The engine has no such change, so its replay passes it by,
#: but the row is in the log (P5) and in the log's `rev`.
END_PROGRAMME = "end-programme"
#: The source of a change or a mark made in the web app. An agent's connection passes its own.
APP = "app"
_DAY = timedelta(days=1)


class ProgrammeTracker(Exception):
    """A generic plan write names a programme tracker, whose plans only the engine writes
    (§11.1); nothing was changed. REST answers it 409 `programme-tracker`."""


class LockedDay(Exception):
    """A mark on a programme tracker's day before yesterday (§8, S6), or from a caller that gave
    no today, so the lock fails closed; nothing was changed. REST answers it 409 `locked-day`."""

    def __init__(self, day: date) -> None:
        super().__init__(day.isoformat())
        self.day = day


class RunEnded(Exception):
    """A change, or a second end, for a run End programme has ended; nothing was changed."""


class RunUnreadable(Exception):
    """A stored run whose document, log or replay fails to read (an engine change since, or a
    bad row). It never takes another tracker down: the state leaves its summary out and logs it,
    and REST answers its own routes 500 `run-unreadable`."""

    def __init__(self, tracker_id: str) -> None:
        super().__init__(tracker_id)
        self.tracker_id = tracker_id


class StaleRun(Exception):
    """A confirmed change whose `rev` isn't the log's now; nothing was changed. `preview` is the
    same change previewed against the log as it is (§7.3)."""

    def __init__(self, preview: dict[str, Any]) -> None:
        super().__init__("stale")
        self.preview = preview


@dataclass(frozen=True)
class When:
    """Now in Unix seconds, and the server's time zone (`config.timezone`). Today, the lock and
    the hand-edit markers follow them (spec §2)."""

    now: int
    zone: tzinfo

    @property
    def today(self) -> date:
        return self.local(self.now).date()

    def local(self, t: int) -> datetime:
        return datetime.fromtimestamp(t, self.zone)


@dataclass(frozen=True)
class TrackerRun:
    """A programme tracker and its run, as `run_json` gives it."""

    tracker: Tracker
    run: dict[str, Any]


def usage(conn: sqlite3.Connection, user_id: int) -> int:
    """The bytes of the user's plans', item details' and library programmes' JSON, plus
    TICK_BYTES per tick row; and for Ask's history the bytes of each title, question and answer,
    plus CONVERSATION_BYTES and TURN_BYTES for each row."""
    stored = conn.execute(
        "SELECT"
        " (SELECT coalesce(sum(length(CAST(items_json AS BLOB))), 0)"
        "  FROM plans WHERE user_id = :user)"
        " + (SELECT coalesce(sum(length(CAST(details_json AS BLOB))), 0)"
        "  FROM item_details WHERE user_id = :user)"
        " + (SELECT coalesce(sum(length(CAST(doc_json AS BLOB))), 0)"
        "  FROM programmes WHERE user_id = :user)",
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
    #: Library programmes and runs the file added: present only when the file carries a list.
    programmes: NotRequired[int]
    runs: NotRequired[int]


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
    conn: sqlite3.Connection, user_id: int, tracker_id: str, week: str, when: When | None = None
) -> Tracker | None:
    """Delete tracker (K122): end it from the week whose Monday is `week`, so it shows in no week
    from it on. Its plans, marks and details stay, and earlier weeks still show it. An ended
    tracker keeps its earlier end: ending never brings a week back. None when the user has no
    such tracker.

    A programme tracker's run ends instead (`end_run`, spec §4) from that Monday or today,
    whichever is later, so its locked days stay in view; one ended before stays as it is. That
    needs `when`: without it, ProgrammeTracker."""
    if has_run(conn, user_id, tracker_id):
        if when is None:
            raise ProgrammeTracker
        on = max(date.fromisoformat(week), when.today)
        try:
            ended = end_run(conn, user_id, tracker_id, on.isoformat(), when=when)
        except RunEnded:
            return load_tracker(conn, user_id, tracker_id)
        assert ended is not None  # it has a run
        return ended.tracker
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
    return {
        "plans": plans,
        "log": load_log(conn, user_id, section),
        "details": load_details(conn, user_id, section),
    }


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


def state(conn: sqlite3.Connection, user_id: int, when: When | None = None) -> dict[str, Any]:
    """Everything the client renders: the trackers, ended ones included; per tracker id its plans,
    log and plan revisions by week (`sections`), its item details (`details`) and their revisions
    by item id (`detailRevs`, which also lists items whose details were cleared); settings;
    `today` in the server's time zone, which the app locks past days by (programmes spec §8); and
    each programme run's summary by its tracker's id (`runs`, `run_summaries`), every run sealed
    up to yesterday first. `when` defaults to the system clock in the default time zone; the
    API passes its own.

    The first three trackers' data also goes under the keys of version 5 (`exercise`, `cardio`,
    `diet`, each `{plans, log, details, revs, detailRevs}`), and an arrangement of the strength
    kind's pages under its old key too, so a tab still running that code keeps working."""
    when = when or When(int(time.time()), ZoneInfo(DEFAULT_TIMEZONE))
    runs = run_summaries(conn, user_id, when)
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
    out["today"] = when.today.isoformat()
    out["runs"] = runs
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
    kind; NoTracker when the user has no tracker `section`, and ProgrammeTracker for a programme
    tracker, whose plans only its run writes (programmes spec §11.1), at any week and any rev.
    Every generic plan write comes through here: REST's PUT, and the MCP's edits."""
    kind = tracker_kind(conn, user_id, section)
    if has_run(conn, user_id, section):
        raise ProgrammeTracker
    items = normalise_kind_items(kind, raw_items)
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
    when: When | None = None,
    source: str = APP,
) -> Days:
    """Set or clear one day's mark for one item in one upsert; returns the item's seven marks.

    Only a tick that adds a row can exceed the quota, so only that case pays for the check.
    NoTracker when the user has no tracker `section`.

    On a programme tracker the day must be today or later, or yesterday, which is recorded as
    late (programmes spec §8, S6); an earlier one raises LockedDay, as does any day when `when`
    is None, so a caller that doesn't say what today is can't get past the lock. Each mark there
    also goes into `mark_events`, with `source` (`app`, or an agent's connection), whatever the
    quota. Invalid for a week that is no date. An ordinary tracker takes any day, as before.
    """
    bit = 1 << day
    days, partial, missed, solid, hatch = days_to_masks(
        [mark if i == day else None for i in range(7)]
    )
    key = (user_id, section, week, item_id)
    with transaction(conn):
        tracker_kind(conn, user_id, section)
        on = _locked_day_check(conn, user_id, section, week, day, when)
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
        if on is not None:
            assert when is not None  # checked by the lock
            late = on == when.today - timedelta(days=1)
            _insert_mark_events(
                conn,
                user_id,
                section,
                [
                    {
                        "date": on.isoformat(),
                        "item": item_id,
                        "mark": mark,
                        "enteredAt": when.now,
                        "source": source,
                        "late": late,
                    }
                ],
            )
    return masks_to_days(
        int(row["days"]),
        int(row["partial"]),
        int(row["missed"]),
        int(row["solid"]),
        int(row["hatch"]),
    )


def _locked_day_check(
    conn: sqlite3.Connection, user_id: int, section: str, week: str, day: int, when: When | None
) -> date | None:
    """The date a mark on a programme tracker is for, once the lock lets it through; None for an
    ordinary tracker, which has no lock."""
    if not has_run(conn, user_id, section):
        return None
    try:
        on = date.fromisoformat(week) + timedelta(days=day)
    except ValueError:
        raise Invalid("week must be a date such as 2026-10-19") from None
    if when is None or on < when.today - timedelta(days=1):
        raise LockedDay(on)
    return on


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


# --- the programme library (docs/specs/2026-11-17-programmes.md §3.4, §11) -----------------------

#: The most programmes one account's library holds: as many as its trackers.
MAX_PROGRAMMES = MAX_TRACKERS
#: The largest programme document as stored (`encode_programme`, UTF-8). The biggest worked
#: example is under 2 KB; this leaves room for long notes on every activity.
MAX_PROGRAMME_BYTES = 128 * 1024


class ProgrammeTooLarge(Exception):
    """A programme document over MAX_PROGRAMME_BYTES as stored; nothing was changed."""


class TooManyProgrammes(Exception):
    """An add would take the library past MAX_PROGRAMMES; nothing was changed."""


class ProgrammeSummary(TypedDict):
    """A library programme as the list shows it, read from its stored document."""

    id: str
    #: The document's name, trimmed as the format reads it.
    name: str
    description: str | None
    kind: str
    weeks: int
    #: How many activities it has.
    activities: int
    rev: int
    #: Unix seconds.
    createdAt: int
    updatedAt: int


class ProgrammeRecord(ProgrammeSummary):
    """One library programme: its summary and the document as it was sent."""

    doc: dict[str, Any]


@dataclass(frozen=True)
class ProgrammeSaved:
    programme: ProgrammeRecord


@dataclass(frozen=True)
class ProgrammeConflict:
    #: The server's copy, its revision in `rev`.
    programme: ProgrammeRecord


def encode_programme(doc: object) -> str:
    """A document as stored: compact JSON, its keys in the order sent."""
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"))


def _too_large(encoded: str) -> bool:
    return len(encoded.encode()) > MAX_PROGRAMME_BYTES


def programme_problems(doc: object) -> list[ProgrammeError]:
    """Every reason a document can't be stored: each problem `check_programme` finds, then its
    size. [] when an add would take it (the count and the account's quota aside)."""
    errors = check_programme(doc)
    if _too_large(encode_programme(doc)):
        errors.append(
            ProgrammeError("", f"the programme is over {MAX_PROGRAMME_BYTES:,} bytes as stored.")
        )
    return errors


def _checked(doc: object) -> tuple[Programme, str]:
    """A document's programme and its stored text. Raises ProgrammeInvalid with every problem,
    then ProgrammeTooLarge."""
    programme = parse_programme(doc)
    encoded = encode_programme(doc)
    if _too_large(encoded):
        raise ProgrammeTooLarge
    return programme, encoded


_PROGRAMME_COLUMNS = "id, name, doc_json, rev, created_at, updated_at"


def _programme(row: sqlite3.Row) -> ProgrammeRecord:
    # Every stored document passed the format's check, so its kind, weeks and activities are
    # there. `weeks` may have been sent as 8.0.
    doc: dict[str, Any] = json.loads(row["doc_json"])
    return {
        "id": row["id"],
        "name": row["name"],
        "description": doc.get("description"),
        "kind": doc["kind"],
        "weeks": int(doc["weeks"]),
        "activities": len(doc["activities"]),
        "rev": row["rev"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "doc": doc,
    }


def _summary(record: ProgrammeRecord) -> ProgrammeSummary:
    summary: dict[str, Any] = {k: v for k, v in record.items() if k != "doc"}
    return summary  # type: ignore[return-value]


def _programme_row(conn: sqlite3.Connection, user_id: int, programme_id: str) -> sqlite3.Row | None:
    row: sqlite3.Row | None = conn.execute(
        f"SELECT {_PROGRAMME_COLUMNS} FROM programmes WHERE user_id = ? AND id = ?",  # noqa: S608
        (user_id, programme_id),
    ).fetchone()
    return row


def list_programmes(conn: sqlite3.Connection, user_id: int) -> list[ProgrammeSummary]:
    """The account's library, the programme changed last first."""
    return [
        _summary(_programme(r))
        for r in conn.execute(
            f"SELECT {_PROGRAMME_COLUMNS} FROM programmes WHERE user_id = ?"  # noqa: S608
            " ORDER BY updated_at DESC, created_at DESC, id",
            (user_id,),
        )
    ]


def load_programme(
    conn: sqlite3.Connection, user_id: int, programme_id: str
) -> ProgrammeRecord | None:
    """One of the account's programmes; None for an id it doesn't have, another account's
    included."""
    row = _programme_row(conn, user_id, programme_id)
    return None if row is None else _programme(row)


def add_programme(
    conn: sqlite3.Connection,
    user_id: int,
    doc: object,
    now: int,
    *,
    quota: int,
    make_id: Callable[[Container[str]], str],
) -> ProgrammeRecord:
    """Add a document to the library under an id `make_id` picks from those the account hasn't
    taken (`edits.new_id`), at revision 1. A document with any problem is never stored.

    Raises ProgrammeInvalid with every problem, ProgrammeTooLarge, TooManyProgrammes past
    MAX_PROGRAMMES, or QuotaExceeded."""
    programme, encoded = _checked(doc)
    with transaction(conn):
        taken = {
            r["id"] for r in conn.execute("SELECT id FROM programmes WHERE user_id = ?", (user_id,))
        }
        if len(taken) >= MAX_PROGRAMMES:
            raise TooManyProgrammes
        before = usage(conn, user_id)
        _check_growth(before, before + len(encoded.encode()), quota)
        programme_id = make_id(taken)
        conn.execute(
            "INSERT INTO programmes (user_id, id, name, doc_json, rev, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, 1, ?, ?)",
            (user_id, programme_id, programme.name, encoded, now, now),
        )
        row = _programme_row(conn, user_id, programme_id)
    assert row is not None  # written in this transaction
    return _programme(row)


def replace_programme(
    conn: sqlite3.Connection,
    user_id: int,
    programme_id: str,
    doc: object,
    rev: int,
    now: int,
    *,
    quota: int,
) -> ProgrammeSaved | ProgrammeConflict | None:
    """Replace a programme's document if `rev` is current, by patch_tracker's rules: a stale
    `rev` conflicts unless the programme already holds this document, which is then returned as
    it is. The name follows the document. None when the account has no such programme. Runs
    started from it keep their own copy (spec §4).

    Raises ProgrammeInvalid, ProgrammeTooLarge or QuotaExceeded, checked in that order before
    the revision, so a document with problems is never stored."""
    programme, encoded = _checked(doc)
    with transaction(conn):
        row = _programme_row(conn, user_id, programme_id)
        if row is None:
            return None
        stored = _programme(row)
        if stored["doc"] == json.loads(encoded):
            return ProgrammeSaved(stored)
        if rev != stored["rev"]:
            return ProgrammeConflict(stored)
        before = usage(conn, user_id)
        _check_growth(before, before - len(row["doc_json"].encode()) + len(encoded.encode()), quota)
        conn.execute(
            "UPDATE programmes SET name = ?, doc_json = ?, rev = ?, updated_at = ?"
            " WHERE user_id = ? AND id = ?",
            (programme.name, encoded, stored["rev"] + 1, now, user_id, programme_id),
        )
        row = _programme_row(conn, user_id, programme_id)
    assert row is not None  # written in this transaction
    return ProgrammeSaved(_programme(row))


def delete_programme(conn: sqlite3.Connection, user_id: int, programme_id: str) -> bool:
    """Delete a library programme; False when the account has no such programme. Runs started
    from it keep their copy, and their `programme_id` then names nothing."""
    cur = conn.execute(
        "DELETE FROM programmes WHERE user_id = ? AND id = ?", (user_id, programme_id)
    )
    return cur.rowcount > 0


# --- programme runs (docs/specs/2026-11-17-programmes.md §4 to §8, §11) --------------------------
#
# A run is a tracker of its programme's kind with a row in `programme_runs`: the run's own copy of
# the document, the parameters it started with and its start date. Its log (`run_changes`) is the
# source of truth (§5). Every write replays the log (`programme_replay`) and rewrites today's
# calendar week and every later one into `plans`, never an earlier one. Days up to yesterday are
# copied into `programme_days` before any write and on the first read each day (§8), and the
# replay reads those sealed days rather than its own output, so no later change or engine fix can
# rewrite what a past day planned (P1). Each activity's item id is its key, unique within the run.
#
# A week of plans holds one value per item, so the current week's row carries Sunday's values (§6.2,
# Q1). Its days before today keep theirs in `programme_days`, which the run's grid reads.


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _week_after(day: date) -> str:
    """The first Monday after `day`: the week a tracker whose last day is `day` no longer shows
    in (K122)."""
    return (_monday(day) + timedelta(weeks=1)).isoformat()


def _number(n: Decimal) -> int | float:
    return int(n) if n == n.to_integral_value() else float(n)


def _iso(day: date | None) -> str | None:
    return None if day is None else day.isoformat()


def _parse_day(v: object, path: str, errors: list[ProgrammeError]) -> date | None:
    if not is_date(v):
        errors.append(ProgrammeError(path, "give a date written YYYY-MM-DD."))
        return None
    return date.fromisoformat(v)


def _parse_reason(v: object, errors: list[ProgrammeError]) -> str | None:
    if v is not None and not isinstance(v, str):
        errors.append(ProgrammeError("reason", "give the reason as text."))
        return None
    if isinstance(v, str) and len(v.strip(BLANK)) > MAX_REASON:
        errors.append(ProgrammeError("reason", f"a reason is at most {MAX_REASON} characters."))
        return None
    return normalise_reason(v)


@dataclass(frozen=True)
class _Ending:
    """End programme: the change that ended the run, its first day without the programme, and
    why."""

    seq: int
    from_date: date
    reason: str | None


@dataclass(frozen=True)
class _Loaded:
    """A run as stored: its row, its log and its sealed days, ready to replay."""

    tracker_id: str
    programme_id: str | None
    doc: dict[str, Any]
    params: dict[str, Any]
    run: Run
    changes: tuple[Change, ...]
    #: Each change's source and its time in Unix seconds, by seq.
    sources: Mapping[int, str]
    made: Mapping[int, int]
    sealed: Mapping[date, DayPlan]
    ending: _Ending | None
    #: The status last stored: what the run read as at its last write or seal.
    stored_status: str

    def replay(self, until: date | None = None) -> Replay:
        return replay(self.run, self.changes, sealed=self.sealed, until=until)

    def last_day(self, rp: Replay) -> date | None:
        """The run's last day: the replay's, or the day before End programme's."""
        if self.ending is None:
            return rp.end
        cut = self.ending.from_date - _DAY
        return cut if rp.end is None else min(rp.end, cut)

    def status(self, rp: Replay, today: date) -> RunStatus:
        if self.ending is not None and self.ending.from_date <= today:
            return "ended"
        if today < self.run.start:
            return "upcoming"
        if rp.end is not None and today > rp.end:
            return "ended"
        day = _day_of(rp, today)
        return "paused" if day is not None and day.status == "paused" else "running"


def _day_of(rp: Replay, day: date) -> DayPlan | None:
    try:
        return rp.day(day)
    except KeyError:
        return None


def has_run(conn: sqlite3.Connection, user_id: int, tracker_id: str) -> bool:
    """Whether the tracker is a programme tracker: one with a run."""
    row = conn.execute(
        "SELECT 1 FROM programme_runs WHERE user_id = ? AND tracker_id = ?", (user_id, tracker_id)
    ).fetchone()
    return row is not None


def _stored_run(doc: object, params: Mapping[str, object], start: str) -> Run:
    """A run as stored, without checking each week's value against the item's limits: it was
    checked when it started, and an engine change since must not stop it loading (P1). Its
    parameters are still read as the document says."""
    programme = parse_programme(doc, check_ranges=False)
    return Run(
        resolved=resolve(programme, params, check_ranges=False), start=date.fromisoformat(start)
    )


def _load_run(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, when: When
) -> _Loaded | None:
    key = (user_id, tracker_id)
    row = conn.execute(
        "SELECT programme_id, doc_json, params_json, start_date, status FROM programme_runs"
        " WHERE user_id = ? AND tracker_id = ?",
        key,
    ).fetchone()
    if row is None:
        return None
    doc: dict[str, Any] = json.loads(row["doc_json"])
    params: dict[str, Any] = json.loads(row["params_json"])
    run = _stored_run(doc, params, row["start_date"])
    changes: list[Change] = []
    sources: dict[int, str] = {}
    made: dict[int, int] = {}
    ending = None
    for r in conn.execute(
        "SELECT seq, made_at, from_date, change_json, reason, source, undone_by FROM run_changes"
        " WHERE user_id = ? AND tracker_id = ? ORDER BY seq",
        key,
    ):
        body: dict[str, Any] = json.loads(r["change_json"])
        reason = r["reason"] or None
        from_date = date.fromisoformat(r["from_date"])
        changes.append(
            Change(
                seq=r["seq"],
                from_date=from_date,
                made_at=when.local(r["made_at"]),
                body=body,
                reason=reason,
                undone_by=r["undone_by"],
            )
        )
        sources[r["seq"]], made[r["seq"]] = r["source"], r["made_at"]
        if body.get("type") == END_PROGRAMME:
            ending = _Ending(r["seq"], from_date, reason)
    sealed = {
        date.fromisoformat(r["date"]): day_from_json(json.loads(r["items_json"]))
        for r in conn.execute(
            "SELECT date, items_json FROM programme_days WHERE user_id = ? AND tracker_id = ?"
            " ORDER BY date",
            key,
        )
    }
    return _Loaded(
        tracker_id=tracker_id,
        programme_id=row["programme_id"],
        doc=doc,
        params=params,
        run=run,
        changes=tuple(changes),
        sources=sources,
        made=made,
        sealed=sealed,
        ending=ending,
        stored_status=row["status"],
    )


def _seal_span(loaded: _Loaded, when: When) -> tuple[date, date]:
    """The days a seal would copy: from the first unsealed day to yesterday, or to the day
    before End programme's."""
    stop = when.today - _DAY
    if loaded.ending is not None:
        stop = min(stop, loaded.ending.from_date - _DAY)
    first = max(loaded.sealed) + _DAY if loaded.sealed else _monday(loaded.run.start)
    return first, stop


def _seal(conn: sqlite3.Connection, user_id: int, loaded: _Loaded, when: When) -> _Loaded:
    """Copy every unsealed day of the run up to yesterday into `programme_days` (§8): the plan
    in force that day with its programme and activity weeks, from the replay with the days sealed
    before it. Days after the run's last, and from End programme's on, are no longer the run's and
    stay unsealed. Inside the caller's transaction. It never checks the quota (P1). Returns the
    run with the new days."""
    first, stop = _seal_span(loaded, when)
    if first > stop:
        return loaded
    rp = loaded.replay(until=stop)
    added: dict[date, DayPlan] = {}
    day = first
    while day <= stop and (plan := _day_of(rp, day)) is not None:
        text = json.dumps(day_to_json(plan), ensure_ascii=False, separators=(",", ":"))
        conn.execute(
            "INSERT INTO programme_days"
            " (user_id, tracker_id, date, programme_week, items_json, sealed_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, loaded.tracker_id, day.isoformat(), plan.programme_week, text, when.now),
        )
        # Read back as a later read will, so what the replay sees now is what it sees then.
        added[day] = day_from_json(json.loads(text))
        day += _DAY
    return replace(loaded, sealed={**loaded.sealed, **added})


def _store_status(
    conn: sqlite3.Connection, user_id: int, loaded: _Loaded, rp: Replay, today: date
) -> None:
    conn.execute(
        "UPDATE programme_runs SET status = ? WHERE user_id = ? AND tracker_id = ?",
        (loaded.status(rp, today), user_id, loaded.tracker_id),
    )


def _sealed_run(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, when: When
) -> tuple[_Loaded, Replay] | None:
    """The run with every day up to yesterday sealed first, and its replay to today; None when
    the tracker has no run. Raises RunUnreadable when the run fails to load, seal or replay, for
    any reason but the database's own: nothing is sealed from a failed replay."""
    try:
        return _seal_and_replay(conn, user_id, tracker_id, when)
    except sqlite3.Error:
        raise
    except Exception as e:
        raise RunUnreadable(tracker_id) from e


def _seal_and_replay(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, when: When
) -> tuple[_Loaded, Replay] | None:
    """`_sealed_run`'s work. Only a read with a day to seal, or a status to store, takes the
    write lock: the first read each day, not every read."""
    loaded = _load_run(conn, user_id, tracker_id, when)
    if loaded is None:
        return None
    rp = loaded.replay(until=when.today)
    first, stop = _seal_span(loaded, when)
    due = first <= stop and _day_of(rp, first) is not None
    if not due and loaded.stored_status == loaded.status(rp, when.today):
        return loaded, rp
    with transaction(conn):
        fresh = _load_run(conn, user_id, tracker_id, when)
        assert fresh is not None  # runs are never deleted
        loaded = _seal(conn, user_id, fresh, when)
        rp = loaded.replay(until=when.today)
        _store_status(conn, user_id, loaded, rp, when.today)
    return loaded, rp


def seal_runs(conn: sqlite3.Connection, user_id: int, when: When) -> None:
    """Seal every run of the account up to yesterday: the first read each day does it. A run
    that can't be read is logged and passed over."""
    for tracker_id in _run_ids(conn, user_id):
        try:
            _sealed_run(conn, user_id, tracker_id, when)
        except RunUnreadable:
            log.exception("run %s can't be read, so it isn't sealed", tracker_id)


def _run_ids(conn: sqlite3.Connection, user_id: int) -> list[str]:
    return [
        r["tracker_id"]
        for r in conn.execute(
            "SELECT tracker_id FROM programme_runs WHERE user_id = ? ORDER BY tracker_id",
            (user_id,),
        )
    ]


def _write_weeks(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, rp: Replay, today: date
) -> None:
    """Write today's calendar week and every later week of the run into `plans` from the replay
    (§5), never an earlier one. A week whose items read as stored keeps its rev. A later week the
    run no longer has (it now ends sooner) is deleted. Inside the caller's transaction."""
    first = _monday(today).isoformat()
    ids = {a.key: a.key for a in rp.activities}
    wanted = {
        w.monday.isoformat(): week_items(rp, w, ids)
        for w in rp.weeks
        if w.monday.isoformat() >= first
    }
    stored: dict[str, tuple[Any, int]] = {
        r["week"]: (json.loads(r["items_json"]), int(r["rev"]))
        for r in conn.execute(
            "SELECT week, items_json, rev FROM plans WHERE user_id = ? AND section = ?"
            " AND week >= ?",
            (user_id, tracker_id, first),
        )
    }
    for week, items in wanted.items():
        old = stored.get(week)
        if old is not None and old[0] == items:
            continue
        conn.execute(
            "INSERT INTO plans (user_id, section, week, items_json, rev) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT (user_id, section, week)"
            " DO UPDATE SET items_json = excluded.items_json, rev = excluded.rev",
            (user_id, tracker_id, week, json.dumps(items), 1 if old is None else old[1] + 1),
        )
    for week in stored.keys() - wanted.keys():
        conn.execute(
            "DELETE FROM plans WHERE user_id = ? AND section = ? AND week = ?",
            (user_id, tracker_id, week),
        )


def _write_activity_details(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, activity: Activity
) -> None:
    """An activity's notes and link as its item's details (§3.1), unless the item has some."""
    raw: dict[str, Any] = {}
    if activity.notes:
        raw["notes"] = activity.notes
    if activity.link:
        raw["fields"] = {"link": activity.link}
    details = normalise_details(raw)
    if details:
        conn.execute(
            "INSERT INTO item_details (user_id, section, item_id, details_json, rev)"
            " VALUES (?, ?, ?, ?, 1) ON CONFLICT (user_id, section, item_id) DO NOTHING",
            (user_id, tracker_id, activity.key, encode_details(details)),
        )


def _set_end_week(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, last_day: date | None
) -> None:
    """The tracker shows in no week after the run's last day (§4); with no last day (an
    open-ended pause), in every week. A change moves the tracker's rev on."""
    week = None if last_day is None else _week_after(last_day)
    conn.execute(
        "UPDATE trackers SET end_week = ?, rev = rev + 1"
        " WHERE user_id = ? AND id = ? AND end_week IS NOT ?",
        (week, user_id, tracker_id, week),
    )


# -- the run as JSON --


def _marks_of(log: Log, monday: date, key: str) -> Days:
    return list(log.get(monday.isoformat(), {}).get(key, [None] * 7))


def _hand_json(act: ActivityDay) -> dict[str, Any]:
    return {
        name: {"change": m.seq, "madeOn": m.made_on.isoformat(), "rule": m.rule}
        for name, m in act.hand.items()
    }


def _cell_json(
    days: list[ActivityDay], splits: dict[str, list[dict[str, Any]]], marks: Days | None
) -> dict[str, Any]:
    """One activity's cell for a week, as `week_items` writes its item: Sunday's values and
    target when it runs on Sunday, else the last values it had with a target of 0."""
    running = [a for a in days if a.state == "running"]
    present = [a for a in days if a.state in ("running", "paused") and a.values is not None]
    sunday = days[-1]
    if sunday.state == "running":
        source, target = sunday, (sunday.values or {}).get("target", 0)
    else:
        source, target = (running or present or [sunday])[-1], 0
    state = "running" if running else "paused" if present else sunday.state
    paused = [a for a in days if a.state == "paused"]
    hand: dict[str, Any] = {}
    for act in days:
        hand.update(_hand_json(act))
    cell: dict[str, Any] = {
        "state": state,
        "activityWeek": source.activity_week,
        "values": source.values,
        "target": target,
        "splits": splits,
        "hand": hand,
        "until": _iso(paused[-1].until) if paused else None,
        "reason": paused[-1].reason if paused else None,
    }
    if marks is not None:
        cell["marks"] = marks
    return cell


def _week_json(rp: Replay, week: WeekPlan, today: date, log: Log) -> dict[str, Any]:
    sunday = week.monday + timedelta(days=6)
    cells: dict[str, Any] = {}
    for activity in rp.activities:
        days = [d.activities[activity.key] for d in week.days if activity.key in d.activities]
        if not days:
            continue
        fields = dict.fromkeys(name for a in days if a.values for name in a.values)
        splits = {
            name: [{"from": d.isoformat(), "value": v} for d, v in found]
            for name in fields
            if len(found := week.splits(activity.key, name)) > 1
        }
        cells[activity.key] = _cell_json(days, splits, _marks_of(log, week.monday, activity.key))
    labels = [d.label for d in week.days if d.label is not None]
    return {
        "monday": week.monday.isoformat(),
        "programmeWeeks": list(week.programme_weeks),
        "label": labels[-1] if labels else None,
        "current": week.monday <= today <= sunday,
        "locked": sunday < today,
        "days": [
            {
                "date": d.date.isoformat(),
                "status": d.status,
                "programmeWeek": d.programme_week,
                "sealed": d.sealed,
            }
            for d in week.days
        ],
        "cells": cells,
    }


def _grid_json(rp: Replay, today: date, log: Log, last_day: date | None) -> dict[str, Any]:
    """The overview grid (§9.2): a column per calendar week up to the run's last day, a cell per
    activity, and the weeks after an open-ended pause as they will run when resumed."""
    cut = None if last_day is None else _week_after(last_day)
    return {
        "activities": [
            {
                "key": a.key,
                "name": a.name,
                "addedOn": a.added_on.isoformat(),
                "addedBy": a.added_by,
                "endedOn": _iso(a.ended_on),
            }
            for a in rp.activities
            if not a.deleted
        ],
        "weeks": [
            _week_json(rp, w, today, log)
            for w in rp.weeks
            if cut is None or w.monday.isoformat() < cut
        ],
        "whenResumed": [
            {
                "programmeWeek": w.programme_week,
                "label": w.label,
                "cells": {key: _cell_json([act], {}, None) for key, act in w.activities.items()},
            }
            for w in rp.when_resumed
        ],
    }


def _ends_short_json(rp: Replay) -> list[dict[str, Any]]:
    return [
        {"key": e.key, "name": e.name, "week": e.week, "of": e.of, "message": e.message}
        for e in rp.ends_short
    ]


def _change_json(loaded: _Loaded, c: Change, rp: Replay, today: date) -> dict[str, Any]:
    """A log entry. Undo shows on a change whose effect starts today or later (§9.2) while the
    run hasn't been ended; never on an undo or on End programme."""
    undone_by = rp.undone.get(c.seq, c.undone_by)
    undoable = (
        loaded.ending is None
        and c.body.get("type") not in ("undo", END_PROGRAMME)
        and undone_by is None
        and c.from_date >= today
    )
    return {
        "seq": c.seq,
        "madeAt": loaded.made[c.seq],
        "from": c.from_date.isoformat(),
        "change": dict(c.body),
        "reason": c.reason,
        "source": loaded.sources[c.seq],
        "undoneBy": undone_by,
        "undoable": undoable,
    }


def _clock_json(day: DayPlan | None) -> dict[str, Any]:
    if day is None:
        return {
            "programmeWeek": None,
            "status": None,
            "until": None,
            "reason": None,
            "activities": {},
        }
    return {
        "programmeWeek": day.programme_week,
        "status": day.status,
        "until": _iso(day.until),
        "reason": day.reason,
        "activities": {
            key: {
                "state": act.state,
                "activityWeek": act.activity_week,
                "until": _iso(act.until),
                "reason": act.reason,
            }
            for key, act in day.activities.items()
        },
    }


def load_log(conn: sqlite3.Connection, user_id: int, section: str) -> Log:
    """A tracker's marks by week and item id."""
    log: Log = {}
    for r in conn.execute(
        "SELECT week, item_id, days, partial, missed, solid, hatch FROM ticks"
        " WHERE user_id = ? AND section = ? ORDER BY week",
        (user_id, section),
    ):
        log.setdefault(r["week"], {})[r["item_id"]] = masks_to_days(
            r["days"], r["partial"], r["missed"], r["solid"], r["hatch"]
        )
    return log


def _run_json(
    conn: sqlite3.Connection, user_id: int, loaded: _Loaded, rp: Replay, when: When
) -> dict[str, Any]:
    """The run (`GET /api/runs/{tracker}`): its programme, parameters in force, dates, status and
    clocks today, the log newest first, what ends short, and the grid."""
    today = when.today
    programme = loaded.run.programme
    status = loaded.status(rp, today)
    day = _day_of(rp, today) if status in ("running", "paused") else None
    last = loaded.last_day(rp)
    pause = rp.open_pause
    ending = loaded.ending
    return {
        "tracker": loaded.tracker_id,
        "programmeId": loaded.programme_id,
        "name": programme.name,
        "kind": programme.kind,
        "doc": loaded.doc,
        "params": {key: _number(value) for key, value in rp.params.items()},
        "start": loaded.run.start.isoformat(),
        "end": _iso(last),
        "status": status,
        "today": today.isoformat(),
        "week": None if day is None else day.programme_week,
        "weeks": programme.weeks,
        "rev": rp.rev,
        "openPause": None
        if pause is None
        else {
            "since": pause.since.isoformat(),
            "programmeWeek": pause.programme_week,
            "reason": pause.reason,
        },
        "endsShort": _ends_short_json(rp),
        "ended": None
        if ending is None
        else {"from": ending.from_date.isoformat(), "reason": ending.reason, "seq": ending.seq},
        "clock": _clock_json(day),
        "log": [_change_json(loaded, c, rp, today) for c in reversed(loaded.changes)],
        "grid": _grid_json(rp, today, load_log(conn, user_id, loaded.tracker_id), last),
    }


def _summary_json(loaded: _Loaded, rp: Replay, today: date) -> dict[str, Any]:
    """A run as the state lists it (§9.1): "Week 4 of 8", and paused or running."""
    status = loaded.status(rp, today)
    day = _day_of(rp, today) if status in ("running", "paused") else None
    return {
        "programmeId": loaded.programme_id,
        "name": loaded.run.programme.name,
        "status": status,
        "week": None if day is None else day.programme_week,
        "weeks": loaded.run.programme.weeks,
        "start": loaded.run.start.isoformat(),
        "end": _iso(loaded.last_day(rp)),
        "pausedUntil": _iso(day.until) if day is not None and status == "paused" else None,
        "rev": rp.rev,
    }


def run_summaries(conn: sqlite3.Connection, user_id: int, when: When) -> dict[str, Any]:
    """Each run's summary by its tracker's id, every day up to yesterday sealed first. A run that
    can't be read is logged and left out, so the state still answers with every tracker."""
    out: dict[str, Any] = {}
    for tracker_id in _run_ids(conn, user_id):
        try:
            found = _sealed_run(conn, user_id, tracker_id, when)
        except RunUnreadable:
            log.exception("run %s can't be read, so its summary is left out", tracker_id)
            continue
        assert found is not None  # listed just now; runs are never deleted
        out[tracker_id] = _summary_json(*found, when.today)
    return out


def read_run(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, when: When
) -> dict[str, Any] | None:
    """The run, sealed up to yesterday first; None when the tracker has no run."""
    found = _sealed_run(conn, user_id, tracker_id, when)
    return None if found is None else _run_json(conn, user_id, *found, when)


# -- starting a run (§4) --


def _start_inputs(
    programme: Programme, *, start: object, params: object, name: object, today: date
) -> tuple[Run, str]:
    """The run a start makes and the tracker's name. Raises ProgrammeInvalid with every problem:
    the start (today or later, default today), the name (default the programme's) and each
    parameter."""
    errors: list[ProgrammeError] = []
    day = today if start is None else _parse_day(start, "start", errors)
    if day is not None and day < today:
        errors.append(ProgrammeError("start", "a programme starts today or later."))
    title = programme.name if name is None else name.strip(BLANK) if isinstance(name, str) else ""
    if not 1 <= len(title) <= MAX_TRACKER_NAME:
        errors.append(ProgrammeError("name", f"give a name of 1 to {MAX_TRACKER_NAME} characters."))
    try:
        run = start_run(programme, params, day or today)  # type: ignore[arg-type]
    except ProgrammeInvalid as e:
        errors.extend(e.errors)
    if errors:
        raise ProgrammeInvalid(errors)
    return run, title


def preview_programme(
    conn: sqlite3.Connection,
    user_id: int,
    programme_id: str,
    *,
    start: object = None,
    params: object = None,
    when: When,
) -> dict[str, Any] | None:
    """What starting the programme would write (`POST /api/programmes/{id}/preview`), writing
    nothing: the dates, the parameters, what ends short and the grid. None when the account has
    no such programme. Raises ProgrammeInvalid as a start does."""
    record = load_programme(conn, user_id, programme_id)
    if record is None:
        return None
    run, _ = _start_inputs(
        parse_programme(record["doc"]), start=start, params=params, name=None, today=when.today
    )
    rp = replay(run, [], until=when.today)
    return {
        "start": run.start.isoformat(),
        "end": _iso(rp.end),
        "weeks": run.programme.weeks,
        "params": {key: _number(value) for key, value in rp.params.items()},
        "endsShort": _ends_short_json(rp),
        "grid": _grid_json(rp, when.today, {}, rp.end),
    }


def start_programme(
    conn: sqlite3.Connection,
    user_id: int,
    programme_id: str,
    *,
    start: object = None,
    params: object = None,
    name: object = None,
    when: When,
    quota: int,
    make_id: Callable[[Container[str]], str],
) -> TrackerRun | None:
    """Start a library programme (§4): a new tracker of its kind, last in the week, from the
    start date's Monday, with the document's daily target, ending after the run's last Sunday.
    The run keeps its own copy of the document. Every week of the run is written, each
    activity's notes and link become its item's details, and the start week's days before
    today are sealed. None when the account has no such programme.

    Raises ProgrammeInvalid with every problem, TooManyTrackers past MAX_TRACKERS, or
    QuotaExceeded; any of them writes nothing."""
    record = load_programme(conn, user_id, programme_id)
    if record is None:
        return None
    programme = parse_programme(record["doc"])
    run, title = _start_inputs(programme, start=start, params=params, name=name, today=when.today)
    rp = replay(run, [], until=when.today)
    with transaction(conn):
        trackers = load_trackers(conn, user_id)
        if len(trackers) >= MAX_TRACKERS:
            raise TooManyTrackers
        before = usage(conn, user_id)
        tracker_id = make_id({t["id"] for t in trackers})
        daily = programme.daily_target
        tracker: Tracker = {
            "id": tracker_id,
            "name": title,
            "kind": programme.kind,
            "position": _next_position(conn, user_id),
            "dailyTarget": TYPES[programme.kind].daily_target if daily is None else daily,
            "startWeek": _monday(run.start).isoformat(),
            "endWeek": None if rp.end is None else _week_after(rp.end),
            "rev": 1,
        }
        _insert_tracker(conn, user_id, tracker)
        conn.execute(
            "INSERT INTO programme_runs"
            " (user_id, tracker_id, programme_id, doc_json, params_json, start_date, status, rev)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
            (
                user_id,
                tracker_id,
                programme_id,
                encode_programme(record["doc"]),
                json.dumps(params or {}),
                run.start.isoformat(),
                "upcoming" if when.today < run.start else "running",
            ),
        )
        for activity in programme.activities:
            _write_activity_details(conn, user_id, tracker_id, activity)
        _write_weeks(conn, user_id, tracker_id, rp, when.today)
        loaded = _load_run(conn, user_id, tracker_id, when)
        assert loaded is not None  # written just now
        loaded = _seal(conn, user_id, loaded, when)
        _check_growth(before, usage(conn, user_id), quota)
    return TrackerRun(tracker, _run_json(conn, user_id, loaded, loaded.replay(when.today), when))


# -- changes (§7) --


def _in_change(error: ProgrammeError) -> ProgrammeError:
    """An engine problem at its path in the request: the change's own keys under `change`, the
    from day at `from`."""
    path = error.path
    if path == "from":
        return error
    if not path:
        return ProgrammeError("change", error.message)
    return ProgrammeError("change" + (path if path.startswith("[") else "." + path), error.message)


def _preview(loaded: _Loaded, body: object, on: date, reason: str | None, when: When) -> Preview:
    try:
        return preview_change(
            loaded.run,
            loaded.changes,
            body,
            from_date=on,
            today=when.today,
            made_at=when.local(when.now),
            reason=reason,
            sealed=loaded.sealed,
        )
    except ProgrammeInvalid as e:
        raise ProgrammeInvalid([_in_change(error) for error in e.errors]) from None


def _preview_json(
    conn: sqlite3.Connection, user_id: int, loaded: _Loaded, p: Preview, when: When
) -> dict[str, Any]:
    """A change's preview (§7.3): each cell it changes, before and after; the hand-edits that
    block it; what ends short; the log's rev to confirm with; and the grid as it would be."""
    log = load_log(conn, user_id, loaded.tracker_id)
    return {
        "preview": True,
        "rev": p.rev,
        "change": {
            "seq": p.change.seq,
            "from": p.change.from_date.isoformat(),
            "change": dict(p.change.body),
            "reason": p.change.reason,
        },
        "cells": [
            {
                "monday": c.monday.isoformat(),
                "key": c.key,
                "field": c.field,
                "before": c.before,
                "after": c.after,
                "starts": c.starts.isoformat(),
                "programmeWeek": c.programme_week,
            }
            for c in p.cells
        ],
        "blocking": [
            {
                "change": b.seq,
                "key": b.key,
                "field": b.field,
                "programmeWeek": b.programme_week,
                "value": _number(b.value),
                "madeOn": b.made_on.isoformat(),
                "message": b.message,
            }
            for b in p.blocking
        ],
        "endsShort": [
            {"key": e.key, "name": e.name, "week": e.week, "of": e.of, "message": e.message}
            for e in p.ends_short
        ],
        "undoes": p.undoes,
        "deletes": p.deletes,
        "grid": _grid_json(p.after, when.today, log, loaded.last_day(p.after)),
    }


def change_run(
    conn: sqlite3.Connection,
    user_id: int,
    tracker_id: str,
    body: object,
    from_day: object,
    *,
    reason: object = None,
    confirm: bool = False,
    rev: object = None,
    when: When,
    quota: int,
    source: str = APP,
) -> dict[str, Any] | None:
    """Preview a change to a run, or with `confirm` apply it (§7, §7.3). `body` is the change
    (`programme_replay`'s format), `from_day` its first day (today or later), `source` who made
    it: `app`, or an agent's connection.

    A preview writes nothing beyond sealing. An apply needs the preview's `rev`: it appends the
    change to the log, marks an undone change, deletes an activity ended before it had a day,
    writes an added activity's details, rewrites today's week and every later one, and moves the
    tracker's end. None when the tracker has no run.

    Raises ProgrammeInvalid with every problem (the change's own at `change.…`), RunEnded after
    End programme, StaleRun for a `rev` that isn't the log's, or QuotaExceeded."""
    errors: list[ProgrammeError] = []
    on = _parse_day(from_day, "from", errors)
    why = _parse_reason(reason, errors)
    if confirm and not isinstance(rev, str):
        errors.append(ProgrammeError("rev", "give the rev of the preview."))
    found = _sealed_run(conn, user_id, tracker_id, when)
    if found is None:
        return None
    if found[0].ending is not None:
        raise RunEnded
    if errors:
        raise ProgrammeInvalid(errors)
    assert on is not None
    if not confirm:
        return _preview_json(conn, user_id, found[0], _preview(found[0], body, on, why, when), when)
    with transaction(conn):
        loaded = _load_run(conn, user_id, tracker_id, when)
        assert loaded is not None  # runs are never deleted
        if loaded.ending is not None:  # pragma: no cover (ended since the check above)
            raise RunEnded
        loaded = _seal(conn, user_id, loaded, when)
        p = _preview(loaded, body, on, why, when)
        if rev != p.rev:
            raise StaleRun(_preview_json(conn, user_id, loaded, p, when))
        before = usage(conn, user_id)
        new = p.change
        key = (user_id, tracker_id)
        conn.execute(
            "INSERT INTO run_changes"
            " (user_id, tracker_id, seq, made_at, from_date, change_json, reason, source)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                *key,
                new.seq,
                when.now,
                new.from_date.isoformat(),
                json.dumps(new.body, ensure_ascii=False),
                new.reason or "",
                source,
            ),
        )
        if p.undoes is not None:
            conn.execute(
                "UPDATE run_changes SET undone_by = ? WHERE user_id = ? AND tracker_id = ?"
                " AND seq = ?",
                (new.seq, *key, p.undoes),
            )
        if p.deletes is not None:
            conn.execute(
                "DELETE FROM item_details WHERE user_id = ? AND section = ? AND item_id = ?",
                (*key, p.deletes),
            )
        for added in p.after.activities:
            if added.added_by == new.seq:
                _write_activity_details(conn, user_id, tracker_id, added.activity)
        loaded = _load_run(conn, user_id, tracker_id, when)
        assert loaded is not None
        rp = loaded.replay(until=when.today)
        _write_weeks(conn, user_id, tracker_id, rp, when.today)
        _set_end_week(conn, user_id, tracker_id, loaded.last_day(rp))
        _store_status(conn, user_id, loaded, rp, when.today)
        conn.execute(
            "UPDATE programme_runs SET rev = rev + 1 WHERE user_id = ? AND tracker_id = ?", key
        )
        _check_growth(before, usage(conn, user_id), quota)
    entry = next(c for c in loaded.changes if c.seq == new.seq)
    return {
        "preview": False,
        "change": _change_json(loaded, entry, rp, when.today),
        "run": _run_json(conn, user_id, loaded, rp, when),
    }


def end_run(
    conn: sqlite3.Connection,
    user_id: int,
    tracker_id: str,
    from_day: object = None,
    *,
    reason: object = None,
    when: When,
    source: str = APP,
) -> TrackerRun | None:
    """End programme (§4): end the run from a day, today (the default) or later, as Delete
    tracker does (K122). The tracker shows in no week after the one before that day, so the week
    holding it still shows unless the day is a Monday; its weeks, marks, notes and log stay. The
    end goes into the log; no change follows it, and days from it on are never sealed. None when
    the tracker has no run.

    Raises ProgrammeInvalid, or RunEnded for a run ended before."""
    errors: list[ProgrammeError] = []
    on = when.today if from_day is None else _parse_day(from_day, "from", errors)
    if on is not None and on < when.today:
        errors.append(ProgrammeError("from", "the programme ends today or later."))
    why = _parse_reason(reason, errors)
    found = _sealed_run(conn, user_id, tracker_id, when)
    if found is None:
        return None
    if found[0].ending is not None:
        raise RunEnded
    if errors:
        raise ProgrammeInvalid(errors)
    assert on is not None
    week = _week_after(on - _DAY)
    with transaction(conn):
        loaded = _load_run(conn, user_id, tracker_id, when)
        assert loaded is not None  # runs are never deleted
        if loaded.ending is not None:  # pragma: no cover (ended since the check above)
            raise RunEnded
        conn.execute(
            "INSERT INTO run_changes"
            " (user_id, tracker_id, seq, made_at, from_date, change_json, reason, source)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                tracker_id,
                max((c.seq for c in loaded.changes), default=0) + 1,
                when.now,
                on.isoformat(),
                json.dumps({"type": END_PROGRAMME}),
                why or "",
                source,
            ),
        )
        # An end never brings a week back (K122).
        conn.execute(
            "UPDATE trackers SET end_week = ?, rev = rev + 1"
            " WHERE user_id = ? AND id = ? AND (end_week IS NULL OR end_week > ?)",
            (week, user_id, tracker_id, week),
        )
        loaded = _load_run(conn, user_id, tracker_id, when)
        assert loaded is not None
        rp = loaded.replay(until=when.today)
        _store_status(conn, user_id, loaded, rp, when.today)
        conn.execute(
            "UPDATE programme_runs SET rev = rev + 1 WHERE user_id = ? AND tracker_id = ?",
            (user_id, tracker_id),
        )
    tracker = load_tracker(conn, user_id, tracker_id)
    assert tracker is not None
    return TrackerRun(tracker, _run_json(conn, user_id, loaded, rp, when))


# -- export and import --


def _export_programmes(conn: sqlite3.Connection, user_id: int) -> list[dict[str, Any]]:
    return [
        {
            "id": r["id"],
            "doc": json.loads(r["doc_json"]),
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        }
        for r in conn.execute(
            "SELECT id, doc_json, created_at, updated_at FROM programmes WHERE user_id = ?"
            " ORDER BY created_at, id",
            (user_id,),
        )
    ]


def _export_runs(conn: sqlite3.Connection, user_id: int) -> list[RunFile]:
    runs: list[RunFile] = []
    for row in conn.execute(
        "SELECT tracker_id, programme_id, doc_json, params_json, start_date FROM programme_runs"
        " WHERE user_id = ? ORDER BY tracker_id",
        (user_id,),
    ).fetchall():
        key = (user_id, row["tracker_id"])
        runs.append(
            {
                "tracker": row["tracker_id"],
                "programmeId": row["programme_id"],
                "doc": json.loads(row["doc_json"]),
                "params": json.loads(row["params_json"]),
                "start": row["start_date"],
                "changes": [
                    {
                        "seq": r["seq"],
                        "madeAt": r["made_at"],
                        "from": r["from_date"],
                        "change": json.loads(r["change_json"]),
                        "reason": r["reason"] or None,
                        "source": r["source"],
                        "undoneBy": r["undone_by"],
                    }
                    for r in conn.execute(
                        "SELECT seq, made_at, from_date, change_json, reason, source, undone_by"
                        " FROM run_changes WHERE user_id = ? AND tracker_id = ? ORDER BY seq",
                        key,
                    )
                ],
                "days": [
                    {
                        "date": r["date"],
                        "programmeWeek": r["programme_week"],
                        "plan": json.loads(r["items_json"]),
                        "sealedAt": r["sealed_at"],
                    }
                    for r in conn.execute(
                        "SELECT date, programme_week, items_json, sealed_at FROM programme_days"
                        " WHERE user_id = ? AND tracker_id = ? ORDER BY date",
                        key,
                    )
                ],
                "marks": [
                    {
                        "date": r["date"],
                        "item": r["item_id"],
                        "mark": r["mark"],
                        "enteredAt": r["entered_at"],
                        "source": r["source"],
                        "late": bool(r["late"]),
                    }
                    for r in conn.execute(
                        "SELECT date, item_id, mark, entered_at, source, late FROM mark_events"
                        " WHERE user_id = ? AND tracker_id = ? ORDER BY id",
                        key,
                    )
                ],
            }
        )
    return runs


def _import_programmes(
    conn: sqlite3.Connection, user_id: int, programmes: list[ProgrammeFile]
) -> int:
    """Add the file's library programmes the account has no id for, up to MAX_PROGRAMMES, each
    with its times. One the format refuses, or over the size cap, is passed over."""
    taken = {
        r["id"] for r in conn.execute("SELECT id FROM programmes WHERE user_id = ?", (user_id,))
    }
    added = 0
    for p in programmes:
        if p["id"] in taken or len(taken) >= MAX_PROGRAMMES or programme_problems(p["doc"]):
            continue
        conn.execute(
            "INSERT INTO programmes (user_id, id, name, doc_json, rev, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, 1, ?, ?)",
            (
                user_id,
                p["id"],
                parse_programme(p["doc"]).name,
                encode_programme(p["doc"]),
                p["createdAt"],
                p["updatedAt"],
            ),
        )
        taken.add(p["id"])
        added += 1
    return added


def _usable_run(run: RunFile, kind: str, zone: tzinfo) -> bool:
    """Whether a file's run can be stored as it is: its document passes the format and has the
    tracker's kind, its parameters fit, every sealed day reads, and its log replays."""
    try:
        started = _stored_run(run["doc"], run["params"], run["start"])
        programme = started.programme
        sealed = {date.fromisoformat(d["date"]): day_from_json(d["plan"]) for d in run["days"]}
        changes = [
            Change(
                seq=c["seq"],
                from_date=date.fromisoformat(c["from"]),
                made_at=datetime.fromtimestamp(c["madeAt"], zone),
                body=c["change"],
                reason=c["reason"],
                undone_by=c["undoneBy"],
            )
            for c in run["changes"]
        ]
        replay(started, changes, sealed=sealed)
    except (ProgrammeInvalid, ArithmeticError, KeyError, TypeError, ValueError, AttributeError):
        return False
    return programme.kind == kind and all(
        sealed[date.fromisoformat(d["date"])].programme_week == d["programmeWeek"]
        and sealed[date.fromisoformat(d["date"])].date.isoformat() == d["date"]
        for d in run["days"]
    )


def _import_run(conn: sqlite3.Connection, user_id: int, run: RunFile) -> None:
    key = (user_id, run["tracker"])
    conn.execute(
        "INSERT INTO programme_runs"
        " (user_id, tracker_id, programme_id, doc_json, params_json, start_date, status, rev)"
        " VALUES (?, ?, ?, ?, ?, ?, 'running', 1)",
        (
            *key,
            run["programmeId"],
            encode_programme(run["doc"]),
            json.dumps(run["params"]),
            run["start"],
        ),
    )
    conn.executemany(
        "INSERT INTO run_changes (user_id, tracker_id, seq, made_at, from_date, change_json,"
        " reason, source, undone_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                *key,
                c["seq"],
                c["madeAt"],
                c["from"],
                json.dumps(c["change"], ensure_ascii=False),
                c["reason"] or "",
                c["source"],
                c["undoneBy"],
            )
            for c in run["changes"]
        ],
    )
    conn.executemany(
        "INSERT INTO programme_days (user_id, tracker_id, date, programme_week, items_json,"
        " sealed_at) VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                *key,
                d["date"],
                d["programmeWeek"],
                json.dumps(d["plan"], ensure_ascii=False, separators=(",", ":")),
                d["sealedAt"],
            )
            for d in run["days"]
        ],
    )
    _insert_mark_events(conn, user_id, run["tracker"], run["marks"])


def _insert_mark_events(
    conn: sqlite3.Connection, user_id: int, tracker_id: str, marks: list[MarkEventFile]
) -> None:
    conn.executemany(
        "INSERT INTO mark_events"
        " (user_id, tracker_id, date, item_id, mark, entered_at, source, late)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                user_id,
                tracker_id,
                m["date"],
                m["item"],
                m["mark"],
                m["enteredAt"],
                m["source"],
                int(m["late"]),
            )
            for m in marks
        ],
    )


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
    tracker id; the settings; Ask's conversations, which only the server holds; and, when the
    account has any, the programme library (`programmes`) and the runs (`runs`), each with its
    log, sealed days and mark events. Seal the runs first (`seal_runs`): an export is a read."""
    trackers: list[TrackerInfo] = []
    sections: dict[str, Any] = {}
    details: dict[str, DetailsMap] = {}
    for t in load_trackers(conn, user_id):
        info: dict[str, Any] = {k: v for k, v in t.items() if k != "rev"}
        trackers.append(info)  # type: ignore[arg-type]
        tracked = load_tracked(conn, user_id, t["id"])
        sections[t["id"]] = {"plans": tracked["plans"], "log": tracked["log"]}
        details[t["id"]] = tracked["details"]
    file: dict[str, Any] = {
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
    # The library and the runs come with no new version, and only when the account has any, so
    # a file without them reads as it did.
    programmes, runs = _export_programmes(conn, user_id), _export_runs(conn, user_id)
    if programmes:
        file["programmes"] = programmes
    if runs:
        file["runs"] = runs
    return file


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
    conn: sqlite3.Connection,
    user_id: int,
    data: ExportData,
    *,
    quota: int,
    zone: tzinfo = UTC,
) -> ImportResult:
    """Merge a parsed export in, never deleting (architecture.md §4); returns what it added.

    The file's trackers the user lacks come first (`_add_trackers`). Then each tracker's data
    merges by id: a file from before version 6 has only the first three. Data for a tracker the
    user doesn't have, or has with another kind, is passed over.

    Programmes (docs/specs/2026-11-17-programmes.md §11.2): the file's library programmes the
    account has no id for are added. A run comes whole, with its log, sealed days and mark
    events, and only with a tracker this import adds; one whose document, parameters, days or log
    don't read is passed over, and its tracker comes in as an ordinary one. A programme tracker
    the account already has takes nothing from a file: its plans are its run's, and its past
    days are locked. `zone` reads the log's times, as the server's time zone does."""
    weeks = ticks = details = 0
    kinds: dict[str, TypeId] = {s: t.id for s, t in SECTION_TYPES.items()}
    kinds.update({t["id"]: t["kind"] for t in data["trackers"]})
    with transaction(conn):
        before = usage(conn, user_id)
        had = {t["id"] for t in load_trackers(conn, user_id)}
        locked = set(_run_ids(conn, user_id))
        have = _add_trackers(conn, user_id, data)
        for section, incoming in data["sections"].items():
            if have.get(section) != kinds.get(section) or section in locked:
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
        result: ImportResult = {
            "trackers": len(have) - len(had),
            "weeks": weeks,
            "ticks": ticks,
            "details": details,
            "settings": applied,
            "conversations": len(added),
        }
        full = cast(ImportData, data)
        if "programmes" in full:
            result["programmes"] = _import_programmes(conn, user_id, full["programmes"])
        if "runs" in full:
            result["runs"] = 0
            for run in full["runs"]:
                tracker = run["tracker"]
                if tracker in had or tracker not in have:
                    continue
                if _usable_run(run, have[tracker], zone):
                    _import_run(conn, user_id, run)
                    result["runs"] += 1
        # Raising inside the transaction rolls the whole merge back.
        _check_growth(before, usage(conn, user_id), quota)
    return result
