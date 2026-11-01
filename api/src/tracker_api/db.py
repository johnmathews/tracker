"""SQLite connections, the schema, and its migrations (docs/api.md §2)."""

import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

# One entry per schema version, applied in order; never edit one that has shipped.
MIGRATIONS = [
    """
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
        failed_logins INTEGER NOT NULL DEFAULT 0,
        failed_since INTEGER,
        locked_until INTEGER,
        created_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX sessions_by_user ON sessions (user_id);

    CREATE TABLE invites (
        token_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
        username TEXT NOT NULL COLLATE NOCASE,
        user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        CHECK ((kind = 'reset') = (user_id IS NOT NULL))
    ) STRICT;
    CREATE INDEX invites_by_username ON invites (username);

    CREATE TABLE settings (
        user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        accent TEXT NOT NULL,
        daily_pick INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE plans (
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK (section IN ('exercise', 'diet')),
        week TEXT NOT NULL,
        items_json TEXT NOT NULL,
        rev INTEGER NOT NULL CHECK (rev > 0),
        PRIMARY KEY (user_id, section, week)
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE ticks (
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK (section IN ('exercise', 'diet')),
        week TEXT NOT NULL,
        item_id TEXT NOT NULL,
        days INTEGER NOT NULL CHECK (days BETWEEN 0 AND 127),
        PRIMARY KEY (user_id, section, week, item_id)
    ) STRICT, WITHOUT ROWID;
    """,
    # Marks have kinds. `days` stays the mask of every marked day; `partial` and `missed` are
    # disjoint subsets of it, and a marked day in neither is `great`, as every older tick reads.
    """
    ALTER TABLE ticks ADD COLUMN partial INTEGER NOT NULL DEFAULT 0
        CHECK (partial BETWEEN 0 AND 127);
    ALTER TABLE ticks ADD COLUMN missed INTEGER NOT NULL DEFAULT 0
        CHECK (missed BETWEEN 0 AND 127);
    """,
    # Email: a confirmed address, confirmation links, whether a reset link was mailed (which
    # proves the address too), and a log of sends for the rate limits.
    """
    ALTER TABLE users ADD COLUMN email_confirmed_at INTEGER;
    ALTER TABLE invites ADD COLUMN mailed INTEGER NOT NULL DEFAULT 0 CHECK (mailed IN (0, 1));

    CREATE TABLE confirmations (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
    ) STRICT;
    CREATE INDEX confirmations_by_user ON confirmations (user_id);

    CREATE TABLE mail_log (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('confirm', 'reset')),
        sent_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX mail_log_by_time ON mail_log (sent_at);
    CREATE INDEX mail_log_by_user ON mail_log (user_id, kind, sent_at);
    """,
    # Marks have drawings (K17). `solid` and `hatch` are disjoint subsets of `days`; a marked day
    # in neither is the zigzag, as every older tick reads.
    """
    ALTER TABLE ticks ADD COLUMN solid INTEGER NOT NULL DEFAULT 0
        CHECK (solid BETWEEN 0 AND 127);
    ALTER TABLE ticks ADD COLUMN hatch INTEGER NOT NULL DEFAULT 0
        CHECK (hatch BETWEEN 0 AND 127);
    """,
    # Food has a daily target too (K57). Saved settings take the default, as a file without one
    # reads.
    """
    ALTER TABLE settings ADD COLUMN food_pick INTEGER NOT NULL DEFAULT 2;
    """,
    # My goals: the person's own words about what they are aiming for, which only Ask reads.
    # Saved settings start with none.
    """
    ALTER TABLE settings ADD COLUMN goals TEXT NOT NULL DEFAULT '';
    """,
    # Ask's daily caps: one row per question claimed (a failed answer still counts), holding who
    # asked and when. Nothing of the question or the answer is stored.
    """
    CREATE TABLE ask_log (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        asked_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX ask_log_by_user ON ask_log (user_id, asked_at);
    CREATE INDEX ask_log_by_time ON ask_log (asked_at);
    """,
]
SCHEMA_VERSION = len(MIGRATIONS)


def connect(path: Path) -> sqlite3.Connection:
    """A connection in autocommit mode: writes that must be atomic use `transaction`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5, autocommit=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """BEGIN IMMEDIATE, so a read-check-write sequence holds the write lock from its first read."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def _use_wal(conn: sqlite3.Connection, attempts: int = 50) -> None:
    """Switch the file to WAL. The switch needs an exclusive lock that the busy timeout does not
    wait for, so a connection racing another one at startup retries briefly."""
    for attempt in range(attempts):
        try:
            if conn.execute("PRAGMA journal_mode = WAL").fetchone()[0] == "wal":
                return
        except sqlite3.OperationalError as e:
            if "locked" not in str(e) or attempt == attempts - 1:
                raise
        time.sleep(0.05)
    raise sqlite3.OperationalError("could not switch the database to WAL")


def migrate(conn: sqlite3.Connection) -> None:
    """Bring the schema to SCHEMA_VERSION; each step and its version bump commit together.

    The version is read under the write lock, so the API and `tracker-admin` starting at the same
    time cannot both apply a step.
    """
    _use_wal(conn)
    while True:
        with transaction(conn):
            version: int = conn.execute("PRAGMA user_version").fetchone()[0]
            if version >= len(MIGRATIONS):
                return
            # Outside LEGACY_TRANSACTION_CONTROL, executescript leaves the transaction open.
            conn.executescript(f"{MIGRATIONS[version]}; PRAGMA user_version = {version + 1};")
