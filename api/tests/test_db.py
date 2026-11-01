import json
import sqlite3
from pathlib import Path

import pytest

from tracker_api.db import SCHEMA_VERSION, connect, migrate, transaction


def test_migrates_a_fresh_database_once(tmp_path: Path) -> None:
    c = connect(tmp_path / "f.db")
    migrate(c)
    migrate(c)  # a second run is a no-op
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"users", "sessions", "invites", "settings", "plans", "ticks", "item_details"} <= tables
    c.close()


def at_version_5(path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """A database migrated to schema 5, the last one before item details, with two users."""
    from tracker_api import db

    c = connect(path)
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:5])
    db.migrate(c)
    monkeypatch.undo()
    for uid in (1, 2):
        c.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'h', 0)",
            (uid, f"u{uid}"),
        )
    return c


def add_plan(c: sqlite3.Connection, uid: int, section: str, week: str, items: object) -> None:
    text = items if isinstance(items, str) else json.dumps(items)
    c.execute("INSERT INTO plans VALUES (?, ?, ?, ?, 1)", (uid, section, week, text))


def details_rows(c: sqlite3.Connection) -> list[tuple[int, str, str, object, int]]:
    return sorted(
        (r[0], r[1], r[2], json.loads(r[3]), r[4])
        for r in c.execute("SELECT user_id, section, item_id, details_json, rev FROM item_details")
    )


# Shaped like the plans a real database holds, plus everything a hand-edit or an old bug could
# have left in `items_json`: the migration must finish and take each item's latest note.
DIRTY_PLANS: list[tuple[int, str, str, object]] = [
    (
        1,
        "exercise",
        "2026-10-05",
        [
            {"id": "pu", "name": "Push-ups", "reps": 10, "target": 4, "notes": "old"},
            {"id": "sq", "name": "Squats", "reps": 15, "target": 4, "notes": "squat note"},
            {"id": "kh", "name": "Halos", "reps": 8, "target": 2, "notes": "halos"},
        ],
    ),
    (
        1,
        "exercise",
        "2026-10-12",
        [
            {"id": "pu", "name": "Push-ups", "reps": 10, "target": 4, "notes": "  new \n\t"},
            "not an object",
            42,
            None,
            ["pu"],
            {"name": "No id", "notes": "orphan"},
            {"id": 7, "name": "Numeric id", "notes": "numeric"},
            {"id": "", "name": "Empty id", "notes": "empty id"},
            {"id": "x" * 129, "name": "Long id", "notes": "too long"},
            {"id": "nn", "notes": "no name"},
            # Blank, missing and non-string notes give way to an older week's.
            {"id": "sq", "name": "Squats", "reps": 15, "target": 4, "notes": " \n "},
            {"id": "kh", "name": "Halos", "reps": 8, "target": 2},
            {"id": "pl", "name": "Pull-ups", "reps": 3, "target": 3, "notes": 12},
            {"id": "be", "name": "Back", "reps": 3, "target": 3, "notes": {"text": "x"}},
            {"id": "be", "name": "Back", "reps": 3, "target": 3, "notes": None},
            # Duplicate ids in one week: the first with a note wins.
            {"id": "dup", "name": "A", "reps": 1, "target": 1, "notes": ""},
            {"id": "dup", "name": "B", "reps": 1, "target": 1, "notes": "second"},
            {"id": "dup", "name": "C", "reps": 1, "target": 1, "notes": "third"},
        ],
    ),
    # The latest week has no notes at all: the week before still counts.
    (1, "exercise", "2026-10-19", [{"id": "pu", "name": "Push-ups", "reps": 10, "target": 4}]),
    (1, "exercise", "2026-10-26", []),
    (1, "diet", "2026-09-28", [{"id": "veg", "name": "Vegetables", "target": 7, "notes": "Raw"}]),
    # Plans that are not an array of items are passed over, not read as items.
    (1, "diet", "2026-10-05", '{"veg": {"id": "veg", "name": "V", "notes": "an object"}}'),
    (1, "diet", "2026-10-12", '"a string"'),
    (1, "diet", "2026-10-19", "not json ["),
    (1, "diet", "2026-10-26", "null"),
    # Another user's same item id is their own row.
    (2, "exercise", "2026-10-12", [{"id": "pu", "name": "Push-ups", "notes": "bob's"}]),
]


def test_details_migration_lifts_each_items_latest_note(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tracker_api.data import state

    c = at_version_5(tmp_path / "f.db", monkeypatch)
    for plan in DIRTY_PLANS:
        add_plan(c, *plan)
    migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert details_rows(c) == [
        (1, "diet", "veg", {"notes": "Raw"}, 1),
        (1, "exercise", "dup", {"notes": "second"}, 1),
        (1, "exercise", "kh", {"notes": "halos"}, 1),
        (1, "exercise", "pu", {"notes": "new"}, 1),
        (1, "exercise", "sq", {"notes": "squat note"}, 1),
        (2, "exercise", "pu", {"notes": "bob's"}, 1),
    ]
    # The plans themselves are untouched: their notes stay until each is next written.
    assert c.execute("SELECT count(*) FROM plans").fetchone()[0] == len(DIRTY_PLANS)
    # User 2's plans are clean, so the state reads (user 1's invalid items_json would not).
    s = state(c, 2)
    assert s["exercise"]["details"] == {"pu": {"notes": "bob's"}}
    assert s["exercise"]["detailRevs"] == {"pu": 1}
    c.close()


def test_details_migration_reruns_from_a_partial_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The table may already exist with rows in it: they are kept, and the rest are added."""
    from tracker_api import db

    c = at_version_5(tmp_path / "f.db", monkeypatch)
    add_plan(c, 1, "exercise", "2026-10-19", [{"id": "pu", "name": "P", "notes": "file"}])
    add_plan(c, 1, "exercise", "2026-10-12", [{"id": "sq", "name": "S", "notes": "squats"}])
    step = db.MIGRATIONS[5]
    c.executescript(step)  # a first run, without the version bump
    c.execute('UPDATE item_details SET details_json = \'{"notes":"edited"}\', rev = 4')
    c.execute("DELETE FROM item_details WHERE item_id = 'sq'")
    migrate(c)
    assert details_rows(c) == [
        (1, "exercise", "pu", {"notes": "edited"}, 4),
        (1, "exercise", "sq", {"notes": "squats"}, 1),
    ]
    c.executescript(step)  # and once more changes nothing
    assert len(details_rows(c)) == 2
    c.close()


def test_details_migration_on_an_empty_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = at_version_5(tmp_path / "f.db", monkeypatch)
    migrate(c)
    assert details_rows(c) == []
    c.close()


def test_item_sections_migration_adds_an_empty_column(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Migration 7: saved settings gain `item_sections`, NULL (every page as K65 lays it out)."""
    from tracker_api import db
    from tracker_api.data import load_settings

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:6])
    db.migrate(c)
    monkeypatch.undo()
    c.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)")
    c.execute("INSERT INTO settings VALUES (1, '#30d158', 4, 3)")
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == 7
    columns = {r["name"]: r for r in c.execute("PRAGMA table_info(settings)")}
    assert columns["item_sections"]["type"] == "TEXT"
    assert columns["item_sections"]["notnull"] == 0
    assert c.execute("SELECT item_sections FROM settings").fetchone()[0] is None
    assert load_settings(c, 1) == {"accent": "#30d158", "dailyPick": 4, "foodPick": 3}
    c.close()


def test_marks_migration_reads_existing_ticks_as_great(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A database at schema 1 keeps its ticks through step 2, and every one of them is `great`."""
    from tracker_api import db
    from tracker_api.data import load_tracked

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:1])
    db.migrate(c)
    c.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)")
    c.execute("INSERT INTO ticks VALUES (1, 'exercise', '2026-10-19', 'pu', 5)")
    c.execute("INSERT INTO ticks VALUES (1, 'exercise', '2026-10-19', 'sq', 0)")
    monkeypatch.undo()
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 7
    rows = [
        tuple(r)
        for r in c.execute("SELECT item_id, days, partial, missed, solid, hatch FROM ticks")
    ]
    assert sorted(rows) == [("pu", 5, 0, 0, 0, 0), ("sq", 0, 0, 0, 0, 0)]
    assert load_tracked(c, 1, "exercise")["log"] == {
        "2026-10-19": {
            "pu": ["great", None, "great", None, None, None, None],
            "sq": [None] * 7,
        }
    }
    c.close()


def test_connections_use_wal_and_foreign_keys(tmp_path: Path) -> None:
    c = connect(tmp_path / "f.db")
    migrate(c)
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    c.close()


def test_deleting_a_user_cascades_to_their_rows(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)"
    )
    conn.execute("INSERT INTO settings VALUES (1, '#30d158', 3, 2, NULL)")
    conn.execute("INSERT INTO plans VALUES (1, 'exercise', '2026-10-19', '[]', 1)")
    conn.execute("INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 5, 0, 0, 0, 0)")
    conn.execute("INSERT INTO sessions VALUES ('t', 1, 0, 0, 0)")
    conn.execute("INSERT INTO confirmations VALUES ('c', 1, 0, 0, NULL)")
    conn.execute("INSERT INTO mail_log (user_id, kind, sent_at) VALUES (1, 'confirm', 0)")
    conn.execute("INSERT INTO item_details VALUES (1, 'exercise', 'pu', '{}', 1)")
    conn.execute("DELETE FROM users WHERE id = 1")
    tables = ("settings", "plans", "ticks", "sessions", "confirmations", "mail_log", "item_details")
    for table in tables:
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608


def test_constraints_reject_bad_rows(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'Ann', 'h', 0)"
    )
    bad = [
        # Usernames are unique regardless of case.
        "INSERT INTO users (username, password_hash, created_at) VALUES ('ann', 'h', 0)",
        "INSERT INTO plans VALUES (1, 'other', '2026-10-19', '[]', 1)",
        "INSERT INTO plans VALUES (1, 'exercise', '2026-10-19', '[]', 0)",
        "INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 128, 0, 0, 0, 0)",
        "INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 1, 128, 0, 0, 0)",
        "INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 1, 0, -1, 0, 0)",
        "INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 1, 0, 0, 128, 0)",
        "INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 1, 0, 0, 0, -1)",
        "INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 1, 'x', 0, 0, 0)",  # STRICT
        "INSERT INTO ticks VALUES (2, 'diet', '2026-10-19', 'veg', 1, 0, 0, 0, 0)",  # no such user
        # A reset link names its user; an invite does not.
        "INSERT INTO invites VALUES ('t', 'reset', 'Ann', NULL, 0, 0, NULL, 0)",
        "INSERT INTO invites VALUES ('t', 'invite', 'bob', 1, 0, 0, NULL, 0)",
        "INSERT INTO invites VALUES ('t', 'reset', 'Ann', 1, 0, 0, NULL, 2)",
        # Mail is logged against a user, as one of the two kinds.
        "INSERT INTO mail_log (user_id, kind, sent_at) VALUES (1, 'report', 0)",
        "INSERT INTO mail_log (user_id, kind, sent_at) VALUES (2, 'reset', 0)",
        "INSERT INTO confirmations VALUES ('c', 2, 0, 0, NULL)",
        # Item details: a positive revision, text JSON, a real user.
        "INSERT INTO item_details VALUES (1, 'exercise', 'pu', '{}', 0)",
        "INSERT INTO item_details VALUES (1, 'exercise', 'pu', x'7b7d', 1)",  # STRICT
        "INSERT INTO item_details VALUES (2, 'exercise', 'pu', '{}', 1)",
    ]
    for sql in bad:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(sql)


def test_item_details_take_any_section(conn: sqlite3.Connection) -> None:
    """F3: no CHECK on the section, so a third tracker needs no table rebuild; the API checks the
    section against the registry instead."""
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)"
    )
    conn.execute("INSERT INTO item_details VALUES (1, 'stretching', 'hip', '{}', 1)")
    assert conn.execute("SELECT section FROM item_details").fetchone()[0] == "stretching"


def test_transaction_commits_or_rolls_back(conn: sqlite3.Connection) -> None:
    with transaction(conn):
        conn.execute("INSERT INTO users (username, password_hash, created_at) VALUES ('a', 'h', 0)")
    with pytest.raises(RuntimeError), transaction(conn):
        conn.execute("INSERT INTO users (username, password_hash, created_at) VALUES ('b', 'h', 0)")
        raise RuntimeError
    assert [r[0] for r in conn.execute("SELECT username FROM users")] == ["a"]


def test_a_failed_migration_leaves_the_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tracker_api import db

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", ["CREATE TABLE a (x); CREATE TABLE a (x);"])
    with pytest.raises(sqlite3.OperationalError):
        db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == 0
    assert c.execute("SELECT count(*) FROM sqlite_master WHERE name = 'a'").fetchone()[0] == 0
    c.close()


def test_concurrent_migrations_apply_each_step_once(tmp_path: Path) -> None:
    import threading

    conns = [connect(tmp_path / "f.db") for _ in range(4)]
    barrier = threading.Barrier(len(conns))
    errors: list[BaseException] = []

    def go(c: sqlite3.Connection) -> None:
        barrier.wait()
        try:
            migrate(c)
        except BaseException as e:
            errors.append(e)

    threads = [threading.Thread(target=go, args=(c,)) for c in conns]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert conns[0].execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    for c in conns:
        c.close()


class FakeConn:
    """Stands in for a connection whose WAL switch keeps meeting another connection's lock."""

    def __init__(self, failures: int, error: str = "database is locked", mode: str = "wal") -> None:
        self.failures = failures
        self.error = error
        self.mode = mode
        self.calls = 0

    def execute(self, sql: str) -> "FakeConn":
        self.calls += 1
        if self.calls <= self.failures:
            raise sqlite3.OperationalError(self.error)
        return self

    def fetchone(self) -> tuple[str]:
        return (self.mode,)


def test_wal_switch_retries_while_locked(monkeypatch: pytest.MonkeyPatch) -> None:
    from tracker_api import db

    monkeypatch.setattr("tracker_api.db.time.sleep", lambda _: None)
    fake = FakeConn(failures=3)
    db._use_wal(fake)  # type: ignore[arg-type]
    assert fake.calls == 4
    with pytest.raises(sqlite3.OperationalError, match="locked"):
        db._use_wal(FakeConn(failures=99), attempts=3)  # type: ignore[arg-type]
    with pytest.raises(sqlite3.OperationalError, match="disk I/O"):
        db._use_wal(FakeConn(failures=1, error="disk I/O error"))  # type: ignore[arg-type]
    with pytest.raises(sqlite3.OperationalError, match="could not switch"):
        db._use_wal(FakeConn(failures=0, mode="memory"), attempts=2)  # type: ignore[arg-type]
