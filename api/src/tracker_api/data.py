"""A user's plans, ticks, item details and settings: reads, writes, import and export
(docs/api.md §3)."""

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypedDict

from .db import transaction
from .item_sections import normalise_item_sections
from .validate import (
    EXPORT_FORMAT,
    EXPORT_VERSION,
    SECTIONS,
    Days,
    Details,
    DetailsMap,
    ExportData,
    Item,
    Log,
    Mark,
    Portable,
    Section,
    Tracked,
    days_to_masks,
    details_fit,
    encode_details,
    masks_to_days,
    merge_summary,
    normalise_details,
    normalise_items,
    normalise_portable,
    parse_json,
)

#: What a tick row counts towards the quota: its key and masks, roughly, with the index's share.
TICK_BYTES = 64


class QuotaExceeded(Exception):
    """A write would take the user over their quota (docs/api.md §3); nothing was changed."""


class DetailsTooLarge(Exception):
    """A details document over MAX_DETAILS_BYTES as stored; nothing was changed."""


def usage(conn: sqlite3.Connection, user_id: int) -> int:
    """The bytes of the user's plans' and item details' JSON, plus TICK_BYTES per tick row."""
    stored = conn.execute(
        "SELECT"
        " (SELECT coalesce(sum(length(CAST(items_json AS BLOB))), 0)"
        "  FROM plans WHERE user_id = :user)"
        " + (SELECT coalesce(sum(length(CAST(details_json AS BLOB))), 0)"
        "  FROM item_details WHERE user_id = :user)",
        {"user": user_id},
    ).fetchone()[0]
    ticks = conn.execute("SELECT count(*) FROM ticks WHERE user_id = ?", (user_id,)).fetchone()[0]
    return int(stored) + TICK_BYTES * int(ticks)


def _check_growth(before: int, after: int, quota: int) -> None:
    # Level or shrinking writes always pass, so a full account can still trim itself.
    if after > before and after > quota:
        raise QuotaExceeded


class ImportResult(TypedDict):
    weeks: int
    ticks: int
    details: int
    settings: bool


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


def stored_items(items_json: str) -> list[Item]:
    """A stored plan's items. A plan written before item details still holds its items' notes
    until it is next written; they are the item's details now (migration 7, D3), so they are
    left out here and nothing reads them from the plan."""
    items: list[Any] = json.loads(items_json)
    return [
        {k: v for k, v in item.items() if k != "notes"} if isinstance(item, dict) else item
        for item in items
    ]


def load_details(conn: sqlite3.Connection, user_id: int, section: Section) -> DetailsMap:
    """A section's item details, leaving out cleared (empty) documents."""
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


def load_tracked(conn: sqlite3.Connection, user_id: int, section: Section) -> Tracked:
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
        "SELECT accent, daily_pick, food_pick, item_sections FROM settings WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    settings: Portable = {
        "accent": row["accent"],
        "dailyPick": row["daily_pick"],
        "foodPick": row["food_pick"],
    }
    # Normalised on the way out too, so a type this version's registry lacks drops (P29).
    stored = row["item_sections"]
    item_sections = normalise_item_sections(parse_json(stored) if stored is not None else None)
    if item_sections:
        settings["itemSections"] = item_sections
    return settings


def state(conn: sqlite3.Connection, user_id: int) -> dict[str, Any]:
    """Everything the client renders: per section its plans, log and item details, the plans'
    revisions by week (`revs`) and the details' by item id (`detailRevs`, which also lists items
    whose details were cleared); and settings."""
    out: dict[str, Any] = {}
    for section in SECTIONS:
        tracked = load_tracked(conn, user_id, section)
        key = (user_id, section)
        revs = {
            r["week"]: r["rev"]
            for r in conn.execute(
                "SELECT week, rev FROM plans WHERE user_id = ? AND section = ?", key
            )
        }
        detail_revs = {
            r["item_id"]: r["rev"]
            for r in conn.execute(
                "SELECT item_id, rev FROM item_details WHERE user_id = ? AND section = ?", key
            )
        }
        out[section] = {**tracked, "revs": revs, "detailRevs": detail_revs}
    out["settings"] = load_settings(conn, user_id)
    return out


def put_plan(
    conn: sqlite3.Connection,
    user_id: int,
    section: Section,
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
    section: Section,
    week: str,
    raw_items: list[Any],
    rev: int,
    *,
    quota: int,
) -> PlanSaved | PlanConflict:
    """`put_plan` for a caller already inside `transaction`, so that one transaction can hold
    more writes (edits.py: a plan and an item's notes)."""
    items = normalise_items(section, raw_items)
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
    section: Section,
    item_id: str,
    raw: dict[str, Any],
    rev: int,
    *,
    quota: int,
) -> DetailsSaved | DetailsConflict:
    """Store an item's details if `rev` is current, by put_plan's rules: a stale `rev` conflicts
    unless the stored document already equals the sent one after validation. An empty document
    is stored too, so the revision keeps counting and a device holding an older one conflicts.
    Raises DetailsTooLarge for a document over MAX_DETAILS_BYTES."""
    details = normalise_details(raw)
    assert details is not None  # `raw` is an object
    if not details_fit(details):
        raise DetailsTooLarge
    with transaction(conn):
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
    section: Section,
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
    conn: sqlite3.Connection, user_id: int, section: Section, item_id: str
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
    section: Section,
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
    section: Section,
    week: str,
    item_id: str,
    day: int,
    mark: Mark | None,
    *,
    quota: int,
) -> Days:
    """Set or clear one day's mark for one item in one upsert; returns the item's seven marks.

    Only a tick that adds a row can exceed the quota, so only that case pays for the check.
    """
    bit = 1 << day
    days, partial, missed, solid, hatch = days_to_masks(
        [mark if i == day else None for i in range(7)]
    )
    key = (user_id, section, week, item_id)
    with transaction(conn):
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
    # A tab still running the app from before foods a day (K57) sends no foodPick, and one from
    # before arranging the item page (K66) no itemSections; keep the saved ones rather than reset
    # them to the defaults. The app sends `itemSections: {}` for the default arrangement.
    saved = load_settings(conn, user_id)
    if saved is not None:
        if "foodPick" not in raw:
            raw = {**raw, "foodPick": saved["foodPick"]}
        if "itemSections" not in raw:
            raw = {**raw, "itemSections": saved.get("itemSections", {})}
    settings = normalise_portable(raw)
    item_sections = settings.get("itemSections")
    conn.execute(
        "INSERT INTO settings (user_id, accent, daily_pick, food_pick, item_sections)"
        " VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id) DO UPDATE SET accent = excluded.accent,"
        " daily_pick = excluded.daily_pick, food_pick = excluded.food_pick,"
        " item_sections = excluded.item_sections",
        (
            user_id,
            settings["accent"],
            settings["dailyPick"],
            settings["foodPick"],
            json.dumps(item_sections, separators=(",", ":")) if item_sections else None,
        ),
    )
    return settings


def export_file(conn: sqlite3.Connection, user_id: int, now: int) -> dict[str, Any]:
    """The same file Settings → Export writes in the browser."""
    settings = load_settings(conn, user_id)
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        # JavaScript's toISOString shape, milliseconds included.
        "exportedAt": datetime.fromtimestamp(now, UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        **{section: load_tracked(conn, user_id, section) for section in SECTIONS},
        "settings": settings,
    }


def import_data(
    conn: sqlite3.Connection, user_id: int, data: ExportData, *, quota: int
) -> ImportResult:
    """Merge a parsed export in, never deleting (architecture.md §4); returns what it added."""
    weeks = ticks = details = 0
    with transaction(conn):
        before = usage(conn, user_id)
        for section in SECTIONS:
            incoming = data[section]
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
        applied = False
        if data["settings"] is not None and load_settings(conn, user_id) is None:
            put_settings(conn, user_id, dict(data["settings"]))
            applied = True
        # Raising inside the transaction rolls the whole merge back.
        _check_growth(before, usage(conn, user_id), quota)
    return {"weeks": weeks, "ticks": ticks, "details": details, "settings": applied}
