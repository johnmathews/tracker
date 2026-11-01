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
    assert {"users", "sessions", "invites", "settings", "plans", "ticks", "api_tokens"} <= tables
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


def _api_tokens_step() -> int:
    """The index of the step that adds `api_tokens`, wherever a rebase has put it."""
    from tracker_api import db

    return next(i for i, sql in enumerate(db.MIGRATIONS) if "api_tokens" in sql)


def _snapshot(c: sqlite3.Connection) -> dict[str, list[tuple[object, ...]]]:
    tables = [
        r[0]
        for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'api_tokens'"
        )
    ]
    return {
        t: sorted(tuple(r) for r in c.execute(f"SELECT * FROM {t}"))  # noqa: S608
        for t in tables
    }


def test_api_tokens_step_keeps_every_row(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A populated database at the step before `api_tokens` keeps every row through it, and the
    step can run a second time."""
    from tracker_api import db

    step = _api_tokens_step()
    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:step])
    db.migrate(c)
    c.executescript(
        """
        INSERT INTO users (id, username, password_hash, created_at, email_confirmed_at)
            VALUES (1, 'a@example.com', 'h', 0, 5), (2, 'john', 'h2', 1, NULL);
        INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at)
            VALUES ('s1', 1, 0, 0, 99), ('s2', 2, 0, 0, 99);
        INSERT INTO invites (token_hash, kind, username, user_id, created_at, expires_at, mailed)
            VALUES ('i1', 'reset', 'john', 2, 0, 9, 1),
                   ('i2', 'invite', 'b@example.com', NULL, 0, 9, 0);
        INSERT INTO confirmations (token_hash, user_id, created_at, expires_at)
            VALUES ('c1', 1, 0, 9);
        INSERT INTO mail_log (user_id, kind, sent_at) VALUES (1, 'confirm', 3);
        INSERT INTO settings (user_id, accent, daily_pick, food_pick) VALUES (1, '#30d158', 3, 4);
        INSERT INTO plans (user_id, section, week, items_json, rev)
            VALUES (1, 'exercise', '2026-10-19', '[{"id":"pu","name":"Push-ups"}]', 3);
        INSERT INTO ticks (user_id, section, week, item_id, days, partial, missed, solid, hatch)
            VALUES (1, 'exercise', '2026-10-19', 'pu', 7, 2, 4, 1, 2);
        """
    )
    before = _snapshot(c)
    assert sum(len(rows) for rows in before.values()) == 11
    assert "api_tokens" not in {r[0] for r in c.execute("SELECT name FROM sqlite_master")}
    monkeypatch.undo()
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert _snapshot(c) == before
    assert c.execute("SELECT count(*) FROM api_tokens").fetchone()[0] == 0
    c.executescript(db.MIGRATIONS[step])  # re-runnable: IF NOT EXISTS throughout
    assert _snapshot(c) == before
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
    conn.execute("INSERT INTO settings VALUES (1, '#30d158', 3, 2)")
    conn.execute("INSERT INTO plans VALUES (1, 'exercise', '2026-10-19', '[]', 1)")
    conn.execute("INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 5, 0, 0, 0, 0)")
    conn.execute("INSERT INTO sessions VALUES ('t', 1, 0, 0, 0)")
    conn.execute("INSERT INTO confirmations VALUES ('c', 1, 0, 0, NULL)")
    conn.execute("INSERT INTO mail_log (user_id, kind, sent_at) VALUES (1, 'confirm', 0)")
    conn.execute("INSERT INTO api_tokens VALUES ('t', 1, 'laptop', 'abcdefgh', 'read', 0, NULL)")
    conn.execute("DELETE FROM users WHERE id = 1")
    tables = ("settings", "plans", "ticks", "sessions", "confirmations", "mail_log", "api_tokens")
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
        # A token has one of two scopes and a name, belongs to a user, and its prefix is unique
        # per user.
        "INSERT INTO api_tokens VALUES ('t2', 1, 'n', 'p2', 'admin', 0, NULL)",
        "INSERT INTO api_tokens VALUES ('t2', 2, 'n', 'p2', 'read', 0, NULL)",
        "INSERT INTO api_tokens VALUES ('t2', 1, 'n', 'p1', 'write', 0, NULL)",
        "INSERT INTO api_tokens VALUES ('t2', 1, NULL, 'p2', 'read', 0, NULL)",
    ]
    conn.execute("INSERT INTO api_tokens VALUES ('t1', 1, 'n', 'p1', 'read', 0, NULL)")
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
