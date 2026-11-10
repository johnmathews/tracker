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
    tables_wanted = {"users", "sessions", "invites", "settings", "plans", "ticks"}
    assert tables_wanted | {"api_tokens", "item_details"} <= tables
    c.close()


def _step_of(marker: str) -> int:
    """The index of the one step whose SQL holds `marker`, wherever a merge has put it."""
    from tracker_api import db

    (step,) = [i for i, sql in enumerate(db.MIGRATIONS) if marker in sql]
    return step


TOKENS_STEP = "CREATE TABLE IF NOT EXISTS api_tokens"
DETAILS_STEP = "CREATE TABLE IF NOT EXISTS item_details"
SECTIONS_STEP = "ADD COLUMN item_sections"
GOALS_STEP = "ADD COLUMN goals"
ASK_LOG_STEP = "CREATE TABLE ask_log"
ASK_HISTORY_STEP = "CREATE TABLE ask_conversations"
OAUTH_STEP = "CREATE TABLE oauth_grants"
DAILY_GOAL_STEP = "ADD COLUMN daily_goal"
SECTION_CHECK_STEP = "CREATE TABLE plans_new"
LIMITS_STEP = "ADD COLUMN limits"


def test_steps_are_numbered_as_the_docs_say() -> None:
    """Schema 6 adds API tokens, 7 item details, 8 the item pages' arrangement, 9 My goals,
    10 Ask's caps, 11 Ask's history, 12 OAuth connections, 13 Daily goal, 14 plans and ticks
    without a CHECK on the section, for Cardio, and 15 the limits note (docs/api.md §2)."""
    assert SCHEMA_VERSION == 15
    steps = (
        TOKENS_STEP,
        DETAILS_STEP,
        SECTIONS_STEP,
        GOALS_STEP,
        ASK_LOG_STEP,
        ASK_HISTORY_STEP,
        OAUTH_STEP,
        DAILY_GOAL_STEP,
        SECTION_CHECK_STEP,
        LIMITS_STEP,
    )
    assert [_step_of(m) + 1 for m in steps] == [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]


def test_section_check_step_keeps_plans_and_ticks_and_takes_cardio(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Step 14 builds plans and ticks again without the CHECK on their section (K90): every row
    and every other constraint stays, and a cardio row, refused before, goes in."""
    from tracker_api import db

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(SECTION_CHECK_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 13
    c.executescript(
        """
        INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0);
        INSERT INTO plans VALUES (1, 'exercise', '2026-10-19', '[{"id":"pu"}]', 3),
            (1, 'diet', '2026-10-19', '[]', 1);
        INSERT INTO ticks (user_id, section, week, item_id, days, partial, missed, solid, hatch)
            VALUES (1, 'exercise', '2026-10-19', 'pu', 7, 2, 4, 1, 2),
            (1, 'diet', '2026-10-26', 'veg', 1, 0, 0, 0, 0);
        """
    )
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("INSERT INTO plans VALUES (1, 'cardio', '2026-10-19', '[]', 1)")

    def rows() -> dict[str, list[tuple[object, ...]]]:
        return {
            t: sorted(tuple(r) for r in c.execute(f"SELECT * FROM {t}"))  # noqa: S608
            for t in ("plans", "ticks")
        }

    before = rows()
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert rows() == before
    c.execute("INSERT INTO plans VALUES (1, 'cardio', '2026-10-19', '[]', 1)")
    c.execute("INSERT INTO ticks VALUES (1, 'cardio', '2026-10-19', 'cy', 1, 0, 0, 0, 0)")
    # The other checks stay: a rev of 0, a mask past seven days, a kind outside the days' range.
    for bad in (
        "INSERT INTO plans VALUES (1, 'cardio', '2026-10-26', '[]', 0)",
        "INSERT INTO ticks VALUES (1, 'cardio', 'w', 'x', 128, 0, 0, 0, 0)",
        "INSERT INTO ticks VALUES (1, 'cardio', 'w', 'y', 1, 0, 0, 0, -1)",
        "INSERT INTO plans VALUES (1, 'cardio', '2026-10-19', '[]', 2)",
    ):
        with pytest.raises(sqlite3.IntegrityError):
            c.execute(bad)
    # They still go with their user, and stay strict and without rowid.
    sql = {
        r[0]: r[1] for r in c.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table'")
    }
    for table in ("plans", "ticks"):
        assert "STRICT" in sql[table] and "WITHOUT ROWID" in sql[table]
        assert "section IN" not in sql[table]
    assert "plans_new" not in sql and "ticks_new" not in sql
    c.execute("DELETE FROM users WHERE id = 1")
    assert rows() == {"plans": [], "ticks": []}
    c.close()


OAUTH_TABLES = ("oauth_requests", "oauth_grants", "oauth_retired", "oauth_codes", "oauth_access")


def test_oauth_migration_keeps_every_row_of_a_populated_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A database at schema 11 with accounts, sessions, tokens, plans and Ask history keeps every
    row through step 12, which only adds the OAuth tables, empty."""
    from tracker_api import db

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(OAUTH_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 11
    c.executescript(
        """
        INSERT INTO users (id, username, password_hash, created_at, email_confirmed_at, disabled)
            VALUES (1, 'a@example.com', 'h', 0, 5, 0), (2, 'john', 'h2', 1, NULL, 1);
        INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at)
            VALUES ('s1', 1, 0, 0, 99), ('s2', 2, 0, 0, 99);
        INSERT INTO api_tokens VALUES ('t1', 1, 'laptop', 'abcdefgh', 'write', 3, 4),
            ('t2', 2, 'agent', 'ijklmnop', 'read', 5, NULL);
        INSERT INTO settings (user_id, accent, daily_pick, food_pick, item_sections, goals)
            VALUES (1, '#30d158', 3, 4, NULL, 'Run a 10k');
        INSERT INTO plans (user_id, section, week, items_json, rev)
            VALUES (1, 'exercise', '2026-10-19', '[{"id":"pu","name":"Push-ups"}]', 3);
        INSERT INTO ticks (user_id, section, week, item_id, days, partial, missed, solid, hatch)
            VALUES (1, 'exercise', '2026-10-19', 'pu', 7, 2, 4, 1, 2);
        INSERT INTO item_details VALUES (1, 'exercise', 'pu', '{"notes":"slow"}', 2);
        INSERT INTO ask_log (user_id, asked_at) VALUES (1, 10);
        INSERT INTO ask_conversations VALUES (1, 'c1', 'How was my week?', 10, 20);
        INSERT INTO ask_turns VALUES (1, 'c1', 0, 'How was it?', 'Fine.', 'end_turn', 10);
        """
    )
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    assert not set(OAUTH_TABLES) & set(tables)

    def snapshot() -> dict[str, list[tuple[object, ...]]]:
        return {
            t: sorted(tuple(r) for r in c.execute(f"SELECT * FROM {t}"))  # noqa: S608
            for t in tables
        }

    before = snapshot()
    assert sum(len(rows) for rows in before.values()) == 13
    # Up to step 12 alone: a later step may add a column to a row (13 does to settings).
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(OAUTH_STEP) + 1])
    db.migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 12
    assert snapshot() == before
    for table in OAUTH_TABLES:
        assert c.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608
    c.close()


def test_oauth_tables_hold_hashes_and_go_with_their_user(conn: sqlite3.Connection) -> None:
    """Every OAuth row but a pending request hangs off a grant, which hangs off a user; deleting
    either takes the rest. A grant's scope is one of two, as a token's is."""
    columns = {
        t: [r["name"] for r in conn.execute(f"PRAGMA table_info({t})")] for t in OAUTH_TABLES
    }
    assert columns == {
        "oauth_requests": [
            "id_hash",
            "client_id",
            "client_name",
            "client_host",
            "redirect_uri",
            "code_challenge",
            "resource",
            "scope",
            "state",
            "created_at",
            "expires_at",
        ],
        "oauth_grants": [
            "id",
            "user_id",
            "client_id",
            "client_name",
            "client_host",
            "scope",
            "resource",
            "created_at",
            "expires_at",
            "last_used_at",
            "refresh_hash",
            "prev_refresh_hash",
            "grace_until",
            "grace_pair",
            "generation",
        ],
        "oauth_retired": ["grant_id", "refresh_hash"],
        "oauth_codes": [
            "code_hash",
            "grant_id",
            "client_id",
            "redirect_uri",
            "code_challenge",
            "resource",
            "expires_at",
            "redeemed_at",
        ],
        "oauth_access": ["token_hash", "grant_id", "created_at", "expires_at"],
    }
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)"
    )
    grant = (
        "INSERT INTO oauth_grants (id, user_id, client_id, client_name, client_host, scope,"
        " resource, created_at, expires_at) VALUES (?, ?, 'c', 'n', 'h', ?, 'r', 0, 9)"
    )
    for bad in [("g", 2, "read"), ("g", 1, "admin")]:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(grant, bad)
    conn.execute(grant, ("g", 1, "read"))
    conn.execute("INSERT INTO oauth_retired VALUES ('g', 'r1')")
    conn.execute("INSERT INTO oauth_codes VALUES ('c', 'g', 'c', 'u', 'x', 'r', 9, NULL)")
    conn.execute("INSERT INTO oauth_access VALUES ('a', 'g', 0, 9)")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO oauth_access VALUES ('b', 'nope', 0, 9)")
    conn.execute("DELETE FROM users WHERE id = 1")
    for table in ("oauth_grants", "oauth_retired", "oauth_codes", "oauth_access"):
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608


def before_details(path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """A database migrated to schema 6, the last one before item details, with two users."""
    from tracker_api import db

    c = connect(path)
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(DETAILS_STEP)])
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

    c = before_details(tmp_path / "f.db", monkeypatch)
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

    c = before_details(tmp_path / "f.db", monkeypatch)
    add_plan(c, 1, "exercise", "2026-10-19", [{"id": "pu", "name": "P", "notes": "file"}])
    add_plan(c, 1, "exercise", "2026-10-12", [{"id": "sq", "name": "S", "notes": "squats"}])
    step = db.MIGRATIONS[_step_of(DETAILS_STEP)]
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
    c = before_details(tmp_path / "f.db", monkeypatch)
    migrate(c)
    assert details_rows(c) == []
    c.close()


def test_item_sections_migration_adds_an_empty_column(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Migration 8: saved settings gain `item_sections`, NULL (every page as K65 lays it out)."""
    from tracker_api import db
    from tracker_api.data import load_settings

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(SECTIONS_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    c.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)")
    c.execute("INSERT INTO settings VALUES (1, '#30d158', 4, 3)")
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    columns = {r["name"]: r for r in c.execute("PRAGMA table_info(settings)")}
    assert columns["item_sections"]["type"] == "TEXT"
    assert columns["item_sections"]["notnull"] == 0
    assert c.execute("SELECT item_sections FROM settings").fetchone()[0] is None
    assert load_settings(c, 1) == {
        "accent": "#30d158",
        "dailyPick": 4,
        "foodPick": 3,
        "goals": "",
        "limits": "",
        "dailyGoal": True,
    }
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
    assert load_settings(c, 1) == {
        "accent": "#0a84ff",
        "dailyPick": 5,
        "foodPick": 4,
        "goals": "",
        "limits": "",
        "dailyGoal": True,
    }
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("UPDATE settings SET goals = NULL")
    c.close()


def test_limits_migration_gives_saved_settings_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Settings saved before the limits note (K107) keep every value, My goals included, and read
    as having no limits note."""
    from tracker_api import db
    from tracker_api.data import load_settings

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(LIMITS_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    c.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)")
    c.execute(
        "INSERT INTO settings (user_id, accent, daily_pick, food_pick, goals, daily_goal)"
        " VALUES (1, '#bf5af2', 6, 5, 'Run 5 km.', 0)"
    )
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    columns = {r["name"]: r for r in c.execute("PRAGMA table_info(settings)")}
    assert columns["limits"]["type"] == "TEXT"
    assert columns["limits"]["notnull"] == 1
    assert load_settings(c, 1) == {
        "accent": "#bf5af2",
        "dailyPick": 6,
        "foodPick": 5,
        "goals": "Run 5 km.",
        "limits": "",
        "dailyGoal": False,
    }
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("UPDATE settings SET limits = NULL")
    c.close()


def test_daily_goal_migration_turns_it_on_for_saved_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Settings saved before Daily goal (K85) keep every value, and read with it on, as the app
    showed them: the targets and the met days."""
    from tracker_api import db
    from tracker_api.data import load_settings

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(DAILY_GOAL_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    c.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)")
    c.execute(
        "INSERT INTO settings (user_id, accent, daily_pick, food_pick, goals)"
        " VALUES (1, '#bf5af2', 6, 5, 'Run 5 km.')"
    )
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert c.execute("SELECT daily_goal FROM settings").fetchone()[0] == 1
    assert load_settings(c, 1) == {
        "accent": "#bf5af2",
        "dailyPick": 6,
        "foodPick": 5,
        "goals": "Run 5 km.",
        "limits": "",
        "dailyGoal": True,
    }
    for bad in ("NULL", "2", "'yes'"):
        with pytest.raises(sqlite3.IntegrityError):
            c.execute(f"UPDATE settings SET daily_goal = {bad}")  # noqa: S608
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


def test_ask_history_is_text_per_account_and_goes_with_its_user(tmp_path: Path) -> None:
    """Ask's history: conversations keyed by account and id, and text-only turns that go with
    their conversation, which goes with its user."""
    c = connect(tmp_path / "f.db")
    migrate(c)
    conversation = [r["name"] for r in c.execute("PRAGMA table_info(ask_conversations)")]
    assert conversation == ["user_id", "id", "title", "created_at", "updated_at"]
    turn = [r["name"] for r in c.execute("PRAGMA table_info(ask_turns)")]
    assert turn == ["user_id", "conversation_id", "seq", "question", "answer", "stop", "asked_at"]
    for uid in (1, 2):
        c.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'h', 0)",
            (uid, f"u{uid}"),
        )
    # The same id in two accounts is two conversations: an import never meets another's.
    for uid in (1, 2):
        c.execute(
            "INSERT INTO ask_conversations VALUES (?, 'c1', 'How was my week?', 10, 20)", (uid,)
        )
        c.execute(
            "INSERT INTO ask_turns VALUES (?, 'c1', 0, 'How was it?', 'Fine.', 'end_turn', 10)",
            (uid,),
        )
    bad = [
        # No answer is kept with a turn that didn't end with one.
        "INSERT INTO ask_turns VALUES (1, 'c1', 1, 'q', 'Half an answer', 'cancelled', 11)",
        "INSERT INTO ask_turns VALUES (1, 'c1', 1, 'q', '', 'thinking', 11)",
        "INSERT INTO ask_turns VALUES (1, 'c1', 0, 'q', '', 'error', 11)",  # the same seq
        "INSERT INTO ask_turns VALUES (1, 'c2', 0, 'q', '', 'error', 11)",  # no such conversation
        "INSERT INTO ask_turns VALUES (1, 'c1', -1, 'q', '', 'error', 11)",
        "INSERT INTO ask_conversations VALUES (3, 'c1', 't', 0, 0)",  # no such user
    ]
    for sql in bad:
        with pytest.raises(sqlite3.IntegrityError):
            c.execute(sql)
    c.execute("INSERT INTO ask_turns VALUES (1, 'c1', 1, 'q', '', 'refused', 11)")
    c.execute("DELETE FROM ask_conversations WHERE user_id = 1")
    assert [tuple(r) for r in c.execute("SELECT user_id FROM ask_turns")] == [(2,)]
    c.execute("DELETE FROM users WHERE id = 2")
    for table in ("ask_conversations", "ask_turns"):
        assert c.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608
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
    # Up to the token step only: later steps add tables and columns of their own.
    monkeypatch.undo()
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: step + 1])
    db.migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == step + 1
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
    conn.execute("INSERT INTO settings (user_id, accent, daily_pick) VALUES (1, '#30d158', 3)")
    conn.execute("INSERT INTO plans VALUES (1, 'exercise', '2026-10-19', '[]', 1)")
    conn.execute("INSERT INTO ticks VALUES (1, 'diet', '2026-10-19', 'veg', 5, 0, 0, 0, 0)")
    conn.execute("INSERT INTO sessions VALUES ('t', 1, 0, 0, 0)")
    conn.execute("INSERT INTO confirmations VALUES ('c', 1, 0, 0, NULL)")
    conn.execute("INSERT INTO mail_log (user_id, kind, sent_at) VALUES (1, 'confirm', 0)")
    conn.execute("INSERT INTO item_details VALUES (1, 'exercise', 'pu', '{}', 1)")
    conn.execute("INSERT INTO api_tokens VALUES ('t', 1, 'laptop', 'abcdefgh', 'read', 0, NULL)")
    conn.execute("DELETE FROM users WHERE id = 1")
    tables = ("settings", "plans", "ticks", "sessions", "confirmations", "mail_log")
    tables_too = ("item_details", "api_tokens")
    for table in tables_too:
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608
    for table in tables:
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608


def test_constraints_reject_bad_rows(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'Ann', 'h', 0)"
    )
    bad = [
        # Usernames are unique regardless of case.
        "INSERT INTO users (username, password_hash, created_at) VALUES ('ann', 'h', 0)",
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


def test_item_details_take_any_section(conn: sqlite3.Connection) -> None:
    """F3: no CHECK on the section, so a fourth tracker needs no table rebuild; the API checks the
    section against the registry instead. Plans and ticks have none since step 14 either."""
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)"
    )
    conn.execute("INSERT INTO item_details VALUES (1, 'stretching', 'hip', '{}', 1)")
    assert conn.execute("SELECT section FROM item_details").fetchone()[0] == "stretching"
    conn.execute("INSERT INTO plans VALUES (1, 'stretching', '2026-10-19', '[]', 1)")
    conn.execute("INSERT INTO ticks VALUES (1, 'stretching', '2026-10-19', 'hip', 1, 0, 0, 0, 0)")


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
