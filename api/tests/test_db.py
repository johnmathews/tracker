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
    assert {"users", "sessions", "invites", "settings", "plans", "ticks"} <= tables
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
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
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


def test_goals_migration_gives_saved_settings_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Settings saved before My goals keep every value, and read as having no goals."""
    from tracker_api import db
    from tracker_api.data import load_settings

    c = connect(tmp_path / "f.db")
    # Found by its text, not its index, so a rebase that renumbers it needs no edit here.
    before = next(i for i, m in enumerate(db.MIGRATIONS) if "ADD COLUMN goals" in m)
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:before])
    db.migrate(c)
    c.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)")
    c.execute(
        "INSERT INTO settings (user_id, accent, daily_pick, food_pick) VALUES (1, '#0a84ff', 5, 4)"
    )
    monkeypatch.undo()
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert load_settings(c, 1) == {"accent": "#0a84ff", "dailyPick": 5, "foodPick": 4, "goals": ""}
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("UPDATE settings SET goals = NULL")
    c.close()


def test_ask_log_holds_times_only_and_goes_with_its_user(tmp_path: Path) -> None:
    """The Ask cap's log: who asked and when, and nothing of what was asked."""
    c = connect(tmp_path / "f.db")
    migrate(c)
    columns = [r["name"] for r in c.execute("PRAGMA table_info(ask_log)")]
    assert columns == ["id", "user_id", "asked_at"]
    indexes = {r["name"] for r in c.execute("PRAGMA index_list(ask_log)")}
    assert {"ask_log_by_user", "ask_log_by_time"} <= indexes
    c.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)")
    c.execute("INSERT INTO ask_log (user_id, asked_at) VALUES (1, 100)")
    c.execute("DELETE FROM users WHERE id = 1")
    assert c.execute("SELECT COUNT(*) FROM ask_log").fetchone()[0] == 0
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
    conn.execute("INSERT INTO settings (user_id, accent, daily_pick) VALUES (1, '#30d158', 3)")
    conn.execute("INSERT INTO plans VALUES (1, 'exercise', '2026-10-19', '[]', 1)")
    conn.execute("INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 5, 0, 0, 0, 0)")
    conn.execute("INSERT INTO sessions VALUES ('t', 1, 0, 0, 0)")
    conn.execute("INSERT INTO confirmations VALUES ('c', 1, 0, 0, NULL)")
    conn.execute("INSERT INTO mail_log (user_id, kind, sent_at) VALUES (1, 'confirm', 0)")
    conn.execute("DELETE FROM users WHERE id = 1")
    for table in ("settings", "plans", "ticks", "sessions", "confirmations", "mail_log"):
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
    ]
    for sql in bad:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(sql)


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
