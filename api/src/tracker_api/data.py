"""A user's plans, ticks, settings and Ask history: reads, writes, import and export
(docs/api.md §3)."""

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, TypedDict

from .db import transaction
from .validate import (
    EXPORT_FORMAT,
    EXPORT_VERSION,
    SECTIONS,
    Conversation,
    Days,
    ExportData,
    Item,
    Log,
    Mark,
    Portable,
    Section,
    Tracked,
    Turn,
    days_to_masks,
    masks_to_days,
    merge_conversations,
    merge_settings,
    merge_summary,
    normalise_items,
    normalise_portable,
)

#: What a tick row counts towards the quota: its key and masks, roughly, with the index's share.
TICK_BYTES = 64
#: What an Ask conversation or turn row counts besides its text: its key and times, as for a tick.
CONVERSATION_BYTES = 64
TURN_BYTES = 64


class QuotaExceeded(Exception):
    """A write would take the user over their quota (docs/api.md §3); nothing was changed."""


def usage(conn: sqlite3.Connection, user_id: int) -> int:
    """The bytes of the user's plans' JSON, plus TICK_BYTES for each tick row; and for Ask's
    history the bytes of each title, question and answer, plus CONVERSATION_BYTES and TURN_BYTES
    for each row."""
    plans = conn.execute(
        "SELECT coalesce(sum(length(CAST(items_json AS BLOB))), 0) FROM plans WHERE user_id = ?",
        (user_id,),
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
        int(plans)
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
    weeks: int
    ticks: int
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


def load_tracked(conn: sqlite3.Connection, user_id: int, section: Section) -> Tracked:
    plans = {
        r["week"]: json.loads(r["items_json"])
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
    return {"plans": plans, "log": log}


def load_settings(conn: sqlite3.Connection, user_id: int) -> Portable | None:
    row = conn.execute(
        "SELECT accent, daily_pick, food_pick, goals FROM settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        return None
    return {
        "accent": row["accent"],
        "dailyPick": row["daily_pick"],
        "foodPick": row["food_pick"],
        "goals": row["goals"],
    }


def state(conn: sqlite3.Connection, user_id: int) -> dict[str, Any]:
    """Everything the client renders: each section's plans, log and plan revisions, and settings."""
    out: dict[str, Any] = {}
    for section in SECTIONS:
        tracked = load_tracked(conn, user_id, section)
        revs = {
            r["week"]: r["rev"]
            for r in conn.execute(
                "SELECT week, rev FROM plans WHERE user_id = ? AND section = ?", (user_id, section)
            )
        }
        out[section] = {**tracked, "revs": revs}
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
    items = normalise_items(section, raw_items)
    encoded = json.dumps(items)
    with transaction(conn):
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
        stored = None if row is None else json.loads(row["items_json"])
        # Two devices creating the same carried-forward week send identical items: not a conflict.
        if stored is not None and stored == items:
            return PlanSaved(current)
        return PlanConflict(stored, current)


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
    # before My goals sends no goals; keep the saved ones rather than reset them. Goals that
    # aren't a string count as not sent, and a tab never sends goals it hasn't read (F1).
    saved = load_settings(conn, user_id)
    if saved is not None:
        if "foodPick" not in raw:
            raw = {**raw, "foodPick": saved["foodPick"]}
        if not isinstance(raw.get("goals"), str):
            raw = {**raw, "goals": saved["goals"]}
    settings = normalise_portable(raw)
    conn.execute(
        "INSERT INTO settings (user_id, accent, daily_pick, food_pick, goals)"
        " VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id) DO UPDATE SET accent = excluded.accent,"
        " daily_pick = excluded.daily_pick, food_pick = excluded.food_pick,"
        " goals = excluded.goals",
        (
            user_id,
            settings["accent"],
            settings["dailyPick"],
            settings["foodPick"],
            settings["goals"],
        ),
    )
    return settings


# --- Ask's history (docs/api.md §3.1) -------------------------------------------------------------


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
    """The file Settings → Export writes in the browser, with Ask's conversations as well, which
    only the server holds."""
    settings = load_settings(conn, user_id)
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        # JavaScript's toISOString shape, milliseconds included.
        "exportedAt": datetime.fromtimestamp(now, UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "exercise": load_tracked(conn, user_id, "exercise"),
        "diet": load_tracked(conn, user_id, "diet"),
        "settings": settings,
        "conversations": load_conversations(conn, user_id),
    }


def import_data(
    conn: sqlite3.Connection, user_id: int, data: ExportData, *, quota: int
) -> ImportResult:
    """Merge a parsed export in, never deleting (architecture.md §4); returns what it added."""
    weeks = ticks = 0
    with transaction(conn):
        before = usage(conn, user_id)
        for section in SECTIONS:
            incoming = data[section]
            existing = load_tracked(conn, user_id, section)
            summary = merge_summary(existing, incoming)
            weeks += summary["weeks"]
            ticks += summary["ticks"]
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
        # Saved settings stay, but the file's goals fill empty ones (merge_settings).
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
    return {"weeks": weeks, "ticks": ticks, "settings": applied, "conversations": len(added)}
