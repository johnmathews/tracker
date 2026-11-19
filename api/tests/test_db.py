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
TRACKERS_STEP = "CREATE TABLE trackers"
WEEK_TITLE_STEP = "ADD COLUMN week_title"
PROGRAMMES_STEP = "CREATE TABLE IF NOT EXISTS programmes"
SHARED_STEP = "CREATE TABLE shared_programmes"


def test_steps_are_numbered_as_the_docs_say() -> None:
    """Schema 6 adds API tokens, 7 item details, 8 the item pages' arrangement, 9 My goals,
    10 Ask's caps, 11 Ask's history, 12 OAuth connections, 13 Daily goal, 14 plans and ticks
    without a CHECK on the section, for Cardio, 15 the limits note, 16 the trackers, 17 the
    week title, 18 the programmes and 19 the shared library (docs/api.md §2)."""
    assert SCHEMA_VERSION == 19
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
        TRACKERS_STEP,
        WEEK_TITLE_STEP,
        PROGRAMMES_STEP,
        SHARED_STEP,
    )
    assert [_step_of(m) + 1 for m in steps] == [*range(6, 20)]


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
        "weekTitle": "dates",
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
        "weekTitle": "dates",
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
        "weekTitle": "dates",
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
        "weekTitle": "dates",
    }
    for bad in ("NULL", "2", "'yes'"):
        with pytest.raises(sqlite3.IntegrityError):
            c.execute(f"UPDATE settings SET daily_goal = {bad}")  # noqa: S608
    c.close()


def test_week_title_migration_gives_saved_settings_dates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Settings saved before the week title (K131) keep every value, and read as dates, the title
    the app showed. The CHECK takes "dates" and "number" only."""
    from tracker_api import db
    from tracker_api.data import load_settings

    c = connect(tmp_path / "f.db")
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(WEEK_TITLE_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 16
    c.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)")
    c.execute(
        "INSERT INTO settings (user_id, accent, daily_pick, food_pick, goals, limits, daily_goal)"
        " VALUES (1, '#bf5af2', 6, 5, 'Run 5 km.', 'Knees.', 0)"
    )
    db.migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert c.execute("SELECT week_title FROM settings").fetchone()[0] == "dates"
    assert load_settings(c, 1) == {
        "accent": "#bf5af2",
        "dailyPick": 6,
        "foodPick": 5,
        "goals": "Run 5 km.",
        "limits": "Knees.",
        "dailyGoal": False,
        "weekTitle": "dates",
    }
    c.execute("UPDATE settings SET week_title = 'number'")
    number = load_settings(c, 1)
    assert number is not None and number["weekTitle"] == "number"
    for bad in ("NULL", "'weeks'", "'Number'", "1"):
        with pytest.raises(sqlite3.IntegrityError):
            c.execute(f"UPDATE settings SET week_title = {bad}")  # noqa: S608
    c.close()


def test_a_fresh_database_gives_new_settings_dates(conn: sqlite3.Connection) -> None:
    """On a fresh schema the column is there, TEXT and NOT NULL, and a settings row written
    without it reads as dates."""
    columns = {r["name"]: r for r in conn.execute("PRAGMA table_info(settings)")}
    assert columns["week_title"]["type"] == "TEXT"
    assert columns["week_title"]["notnull"] == 1
    assert columns["week_title"]["dflt_value"] == "'dates'"
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)"
    )
    conn.execute("INSERT INTO settings (user_id, accent, daily_pick) VALUES (1, '#30d158', 3)")
    assert conn.execute("SELECT week_title FROM settings").fetchone()[0] == "dates"


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


def before_trackers(path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """A database at schema 15, the last one before trackers, holding three users: one with
    settings and an arranged exercise page, one with settings and no arrangement, one with no
    settings at all; and plans, ticks and details in each section."""
    from tracker_api import db

    c = connect(path)
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(TRACKERS_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 15
    arranged = {
        "exercise": {"order": ["history", "plan", "notes", "details"], "hidden": ["details"]},
        "food": {"order": ["notes", "plan", "details", "history"], "hidden": []},
    }
    c.executescript(
        """
        INSERT INTO users (id, username, password_hash, created_at)
            VALUES (1, 'a', 'h', 0), (2, 'b', 'h', 0), (3, 'c', 'h', 0);
        INSERT INTO settings (user_id, accent, daily_pick, food_pick, item_sections)
            VALUES (2, '#0a84ff', 1, 8, NULL);
        INSERT INTO plans VALUES (1, 'exercise', '2026-10-19', '[{"id":"pu"}]', 3),
            (1, 'cardio', '2026-10-19', '[]', 1), (1, 'diet', '2026-10-19', '[]', 2),
            (3, 'diet', '2026-10-26', '[]', 1);
        INSERT INTO ticks (user_id, section, week, item_id, days)
            VALUES (1, 'exercise', '2026-10-19', 'pu', 7), (3, 'diet', '2026-10-26', 'veg', 1);
        INSERT INTO item_details VALUES (1, 'exercise', 'pu', '{"notes":"slow"}', 2);
        """
    )
    c.execute(
        "INSERT INTO settings (user_id, accent, daily_pick, food_pick, item_sections)"
        " VALUES (1, '#30d158', 5, 4, ?)",
        (json.dumps(arranged),),
    )
    return c


def table_rows(c: sqlite3.Connection, *tables: str) -> dict[str, list[tuple[object, ...]]]:
    return {
        t: sorted(tuple(r) for r in c.execute(f"SELECT * FROM {t}"))  # noqa: S608
        for t in tables
    }


def tracker_rows(c: sqlite3.Connection) -> list[tuple[object, ...]]:
    return [
        tuple(r)
        for r in c.execute(
            "SELECT user_id, id, kind, name, position, daily_target, start_week, end_week, rev"
            " FROM trackers ORDER BY user_id, position"
        )
    ]


def test_trackers_migration_gives_each_user_the_first_three(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Step 16 backfills three trackers per user, named and kinded as the spec says, with the
    daily targets from their settings (the defaults without any). Plans, ticks and details stay
    as they were, and an arranged exercise page moves to the `strength` key."""
    c = before_trackers(tmp_path / "f.db", monkeypatch)
    data_tables = ("plans", "ticks", "item_details")
    before = table_rows(c, *data_tables)
    migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert tracker_rows(c) == [
        (1, "exercise", "strength", "Strength", 0, 5, None, None, 1),
        (1, "cardio", "cardio", "Cardio", 1, None, None, None, 1),
        (1, "diet", "food", "Food", 2, 4, None, None, 1),
        (2, "exercise", "strength", "Strength", 0, 1, None, None, 1),
        (2, "cardio", "cardio", "Cardio", 1, None, None, None, 1),
        (2, "diet", "food", "Food", 2, 8, None, None, 1),
        (3, "exercise", "strength", "Strength", 0, 3, None, None, 1),
        (3, "cardio", "cardio", "Cardio", 1, None, None, None, 1),
        (3, "diet", "food", "Food", 2, 2, None, None, 1),
    ]
    assert table_rows(c, *data_tables) == before
    stored = {
        r[0]: None if r[1] is None else json.loads(r[1])
        for r in c.execute("SELECT user_id, item_sections FROM settings")
    }
    assert stored == {
        1: {
            "food": {"order": ["notes", "plan", "details", "history"], "hidden": []},
            "strength": {"order": ["history", "plan", "notes", "details"], "hidden": ["details"]},
        },
        2: None,
    }
    c.close()


def test_trackers_migration_passes_over_arrangements_it_cannot_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An `item_sections` that isn't JSON, isn't an object or has no object under `exercise` is
    left as it was, and the step still finishes."""
    c = before_trackers(tmp_path / "f.db", monkeypatch)
    odd = ["not json {", "[1, 2]", '"text"', '{"exercise": "x"}', '{"food": {}}']
    for i, text in enumerate(odd, start=10):
        c.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'h', 0)",
            (i, f"u{i}"),
        )
        c.execute(
            "INSERT INTO settings (user_id, accent, daily_pick, item_sections)"
            " VALUES (?, '#30d158', 3, ?)",
            (i, text),
        )
    migrate(c)
    stored = [
        r[0] for r in c.execute("SELECT item_sections FROM settings WHERE user_id >= 10 ORDER BY 1")
    ]
    assert sorted(stored) == sorted(odd)
    assert c.execute("SELECT count(*) FROM trackers").fetchone()[0] == 3 * 8
    c.close()


def test_every_new_user_gets_the_first_three_trackers(conn: sqlite3.Connection) -> None:
    """The trigger: a user added after step 16 has the same three, with the default targets,
    and they go with the user."""
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (7, 'n', 'h', 0)"
    )
    assert tracker_rows(conn) == [
        (7, "exercise", "strength", "Strength", 0, 3, None, None, 1),
        (7, "cardio", "cardio", "Cardio", 1, None, None, None, 1),
        (7, "diet", "food", "Food", 2, 2, None, None, 1),
    ]
    for bad in (
        "INSERT INTO trackers VALUES (7, 'exercise', 'strength', 'Again', 3, 3, NULL, NULL, 1)",
        "INSERT INTO trackers VALUES (7, 'x1', 'strength', 'S', -1, 3, NULL, NULL, 1)",
        "INSERT INTO trackers VALUES (7, 'x2', 'strength', 'S', 3, 3, NULL, NULL, 0)",
        "INSERT INTO trackers VALUES (8, 'x3', 'strength', 'S', 3, 3, NULL, NULL, 1)",
    ):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(bad)
    conn.execute("DELETE FROM users WHERE id = 7")
    assert tracker_rows(conn) == []


def test_revert_trackers_gives_back_version_15(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """REVERT_TRACKERS, run after step 16, gives back the schema and every row of version 15,
    the arranged exercise page under its old key included."""
    from tracker_api import db
    from tracker_api.db import REVERT_TRACKERS

    c = before_trackers(tmp_path / "f.db", monkeypatch)
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    schema = sorted(tuple(r) for r in c.execute("SELECT type, name, sql FROM sqlite_master"))
    before = table_rows(c, *tables)
    # Up to step 16 alone: REVERT_TRACKERS undoes that step, and a later one is undone first.
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(TRACKERS_STEP) + 1])
    migrate(c)
    with transaction(c):
        c.executescript(REVERT_TRACKERS)
    assert c.execute("PRAGMA user_version").fetchone()[0] == 15
    assert sorted(tuple(r) for r in c.execute("SELECT type, name, sql FROM sqlite_master")) == (
        schema
    )
    after = table_rows(c, *tables)
    # json_set writes compact JSON, so the arrangement compares as data.
    for rows in (before, after):
        rows["settings"] = [
            tuple(json.loads(v) if isinstance(v, str) and v.startswith("{") else v for v in row)
            for row in rows["settings"]
        ]
    assert after == before
    # And the step runs again from there.
    migrate(c)
    monkeypatch.undo()
    assert c.execute("SELECT count(*) FROM trackers").fetchone()[0] == 9
    c.close()


# --- step 18: programmes (docs/specs/2026-11-17-programmes.md §11.1) ------------------------------

PROGRAMME_TABLES = ("programmes", "programme_runs", "run_changes", "programme_days", "mark_events")


def before_programmes(path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """A database at schema 17, the last one before programmes, shaped like production and
    dirty: three accounts (one disabled, one without settings), the first three trackers each
    plus made ones, an ended tracker and one that starts later, plans with odd items_json, marks
    of every kind, details, sessions, a token, Ask's history and an OAuth connection."""
    from tracker_api import db

    c = connect(path)
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(PROGRAMMES_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 17
    c.executescript(
        """
        INSERT INTO users (id, username, password_hash, created_at, email_confirmed_at, disabled)
            VALUES (1, 'john@example.com', 'h1', 0, 5, 0), (2, 'ann', 'h2', 1, NULL, 1),
                (7, 'bob@example.com', 'h3', 2, NULL, 0);
        INSERT INTO settings (user_id, accent, daily_pick, food_pick, item_sections, goals,
                limits, daily_goal, week_title)
            VALUES (1, '#30d158', 4, 3, '{"strength":{"order":["plan"],"hidden":[]}}',
                'Squat 100 kg', 'Left knee', 0, 'number'),
            (2, '#0a84ff', 3, 2, NULL, '', '', 1, 'dates');
        INSERT INTO trackers VALUES
            (1, 'xlegs0001', 'strength', 'Legs', 3, 2, '2026-09-07', '2026-10-12', 4),
            (1, 'xhips0002', 'mobility', 'Hips', 4, 3, '2026-10-19', NULL, 1),
            (1, 'xlater003', 'cardio', 'Bike', 5, NULL, '2026-12-07', NULL, 1),
            (7, 'xbobs0004', 'strength', 'Upper', 3, 8, NULL, NULL, 2);
        UPDATE trackers SET end_week = '2026-10-05', rev = 2 WHERE user_id = 2 AND id = 'cardio';
        INSERT INTO plans VALUES
            (1, 'exercise', '2026-10-12', '[{"id":"pu","name":"Push-ups","reps":10}]', 3),
            (1, 'exercise', '2026-10-19', '[{"id":"pu","name":"Push-ups","notes":"old note"}]', 1),
            (1, 'xlegs0001', '2026-09-07', '[{"id":"sq","name":"Squat","weight":40.5}]', 2),
            (1, 'xhips0002', '2026-10-19', '[]', 1),
            (1, 'diet', '2026-10-19', 'not json [', 1),
            (2, 'cardio', '2026-09-28', '[{"id":"run","name":"Run","distance":5}]', 1),
            (7, 'gone-tracker', '2026-10-19', '[{"id":"a","name":"A"}]', 1);
        INSERT INTO ticks (user_id, section, week, item_id, days, partial, missed, solid, hatch)
            VALUES (1, 'exercise', '2026-10-12', 'pu', 127, 2, 4, 1, 8),
            (1, 'xlegs0001', '2026-09-07', 'sq', 5, 0, 0, 0, 0),
            (1, 'diet', '2026-10-19', 'veg', 0, 0, 0, 0, 0),
            (2, 'cardio', '2026-09-28', 'run', 64, 0, 64, 0, 0),
            (7, 'gone-tracker', '2026-10-19', 'a', 1, 1, 0, 0, 1);
        INSERT INTO item_details VALUES (1, 'exercise', 'pu', '{"notes":"slow"}', 2),
            (1, 'xlegs0001', 'sq', '{}', 3), (7, 'xbobs0004', 'x', '{"link":"https://e.x"}', 1);
        INSERT INTO sessions VALUES ('s1', 1, 0, 0, 99), ('s2', 7, 0, 0, 99);
        INSERT INTO invites (token_hash, kind, username, user_id, created_at, expires_at, mailed)
            VALUES ('i1', 'invite', 'new@example.com', NULL, 0, 9, 1);
        INSERT INTO api_tokens VALUES ('t1', 1, 'laptop', 'abcdefgh', 'write', 3, 4);
        INSERT INTO ask_log (user_id, asked_at) VALUES (1, 10), (1, 11);
        INSERT INTO ask_conversations VALUES (1, 'c1', 'How was my week?', 10, 20);
        INSERT INTO ask_turns VALUES (1, 'c1', 0, 'How was it?', 'Fine.', 'end_turn', 10),
            (1, 'c1', 1, 'And?', '', 'cancelled', 11);
        INSERT INTO oauth_grants (id, user_id, client_id, client_name, client_host, scope,
                resource, created_at, expires_at)
            VALUES ('g1', 1, 'https://claude.ai/c', 'Claude', 'claude.ai', 'write', 'r', 0, 99);
        INSERT INTO oauth_access VALUES ('a1', 'g1', 0, 99);
        """
    )
    return c


def all_rows(c: sqlite3.Connection) -> dict[str, list[tuple[object, ...]]]:
    """Every row of every table but the new ones, and the schema of everything already there."""
    names = [
        r[0]
        for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        if r[0] not in PROGRAMME_TABLES
    ]
    rows = table_rows(c, *names)
    rows["sqlite_master"] = sorted(
        tuple(r)
        for r in c.execute("SELECT type, name, tbl_name, sql FROM sqlite_master")
        if r[2] not in PROGRAMME_TABLES
    )
    return rows


def test_programmes_migration_keeps_every_row_of_a_dirty_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Step 18 only adds the five programme tables, empty: every row and every table, index and
    trigger already there stays as it was, and the state still reads."""
    from tracker_api import db
    from tracker_api.data import load_trackers, usage

    c = before_programmes(tmp_path / "f.db", monkeypatch)
    before = all_rows(c)
    assert sum(len(v) for k, v in before.items() if k != "sqlite_master") == 44
    # Up to step 18 alone: step 19 adds a column to `users` (its own test below).
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(PROGRAMMES_STEP) + 1])
    migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 18
    assert all_rows(c) == before
    for table in PROGRAMME_TABLES:
        assert c.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0  # noqa: S608
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    # The new code reads the migrated file: usage counts no programmes yet (plans, details,
    # ticks and Ask's text for account 1), and an ended tracker still reads as ended.
    plans = sum(
        len(r[0].encode()) for r in c.execute("SELECT items_json FROM plans WHERE user_id = 1")
    )
    details = sum(
        len(r[0].encode())
        for r in c.execute("SELECT details_json FROM item_details WHERE user_id = 1")
    )
    ask_text = len(b"How was my week?") + len(b"How was it?Fine.And?")
    assert usage(c, 1) == plans + details + 3 * 64 + ask_text + 64 + 2 * 64
    assert [t["endWeek"] for t in load_trackers(c, 1)][3] == "2026-10-12"
    c.close()


def test_programmes_migration_reruns_from_a_partial_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The step runs inside the version bump's transaction; if it ever ran without one, a second
    run over tables already there keeps their rows (IF NOT EXISTS throughout)."""
    from tracker_api import db

    c = before_programmes(tmp_path / "f.db", monkeypatch)
    step = db.MIGRATIONS[_step_of(PROGRAMMES_STEP)]
    c.executescript(step)  # a first run, without the version bump
    c.execute(
        "INSERT INTO programmes VALUES (1, 'xp1', 'Beginner', '{}', 2, 10, 20)",
    )
    before = all_rows(c)
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(PROGRAMMES_STEP) + 1])
    migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 18
    assert all_rows(c) == before
    assert table_rows(c, "programmes")["programmes"] == [(1, "xp1", "Beginner", "{}", 2, 10, 20)]
    c.executescript(step)  # and once more changes nothing
    assert c.execute("SELECT count(*) FROM programmes").fetchone()[0] == 1
    c.close()


def columns_of(c: sqlite3.Connection, table: str) -> list[tuple[str, str, int]]:
    """Each column's name, type and NOT NULL flag."""
    return [(r["name"], r["type"], r["notnull"]) for r in c.execute(f"PRAGMA table_info({table})")]


def test_programme_tables_have_the_specs_columns(conn: sqlite3.Connection) -> None:
    """The columns of spec §11.1, keyed for the reads the runs make: runs, changes and sealed
    days by their primary keys, mark events by an index on (user, tracker, date)."""
    assert columns_of(conn, "programmes") == [
        ("user_id", "INTEGER", 1),
        ("id", "TEXT", 1),
        ("name", "TEXT", 1),
        ("doc_json", "TEXT", 1),
        ("rev", "INTEGER", 1),
        ("created_at", "INTEGER", 1),
        ("updated_at", "INTEGER", 1),
    ]
    assert columns_of(conn, "programme_runs") == [
        ("user_id", "INTEGER", 1),
        ("tracker_id", "TEXT", 1),
        ("programme_id", "TEXT", 0),
        ("doc_json", "TEXT", 1),
        ("params_json", "TEXT", 1),
        ("start_date", "TEXT", 1),
        ("status", "TEXT", 1),
        ("rev", "INTEGER", 1),
    ]
    assert columns_of(conn, "run_changes") == [
        ("user_id", "INTEGER", 1),
        ("tracker_id", "TEXT", 1),
        ("seq", "INTEGER", 1),
        ("made_at", "INTEGER", 1),
        ("from_date", "TEXT", 1),
        ("change_json", "TEXT", 1),
        ("reason", "TEXT", 1),
        ("source", "TEXT", 1),
        ("undone_by", "INTEGER", 0),
    ]
    assert columns_of(conn, "programme_days") == [
        ("user_id", "INTEGER", 1),
        ("tracker_id", "TEXT", 1),
        ("date", "TEXT", 1),
        ("programme_week", "INTEGER", 0),
        ("items_json", "TEXT", 1),
        ("sealed_at", "INTEGER", 1),
    ]
    assert columns_of(conn, "mark_events") == [
        ("id", "INTEGER", 0),
        ("user_id", "INTEGER", 1),
        ("tracker_id", "TEXT", 1),
        ("date", "TEXT", 1),
        ("item_id", "TEXT", 1),
        ("mark", "TEXT", 0),
        ("entered_at", "INTEGER", 1),
        ("source", "TEXT", 1),
        ("late", "INTEGER", 1),
    ]

    def primary_key(table: str) -> list[str]:
        cols = [r for r in conn.execute(f"PRAGMA table_info({table})") if r["pk"]]
        return [r["name"] for r in sorted(cols, key=lambda r: r["pk"])]

    assert primary_key("programmes") == ["user_id", "id"]
    assert primary_key("programme_runs") == ["user_id", "tracker_id"]
    assert primary_key("run_changes") == ["user_id", "tracker_id", "seq"]
    assert primary_key("programme_days") == ["user_id", "tracker_id", "date"]
    assert primary_key("mark_events") == ["id"]
    sql = {r[0]: r[1] for r in conn.execute("SELECT name, sql FROM sqlite_master")}
    for table in PROGRAMME_TABLES:
        assert "STRICT" in sql[table]
        assert ("WITHOUT ROWID" in sql[table]) == (table != "mark_events")
    index = [r["name"] for r in conn.execute("PRAGMA index_info(mark_events_by_day)")]
    assert index == ["user_id", "tracker_id", "date"]
    index = [r["name"] for r in conn.execute("PRAGMA index_info(programmes_by_time)")]
    assert index == ["user_id", "updated_at"]


def seed_run(conn: sqlite3.Connection) -> None:
    """User 1 with a library programme and a programme tracker whose run has a change log, a
    sealed day and a mark event."""
    conn.executescript(
        """
        INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0);
        INSERT INTO trackers VALUES (1, 'xrun', 'strength', 'Beginner 5x5', 3, 2,
            '2026-11-16', NULL, 1);
        INSERT INTO programmes VALUES (1, 'xp', 'Beginner 5x5', '{}', 1, 0, 0);
        INSERT INTO programme_runs VALUES (1, 'xrun', 'xp', '{}', '{}', '2026-11-18',
            'running', 1);
        INSERT INTO run_changes VALUES (1, 'xrun', 1, 5, '2026-11-18', '{}', '', 'app', 2),
            (1, 'xrun', 2, 6, '2026-11-18', '{}', 'Knee', 'Claude', NULL);
        INSERT INTO programme_days VALUES (1, 'xrun', '2026-11-18', 1, '[]', 7);
        INSERT INTO mark_events (user_id, tracker_id, date, item_id, mark, entered_at, source,
            late) VALUES (1, 'xrun', '2026-11-18', 'squat', 'great', 8, 'app', 0),
            (1, 'xrun', '2026-11-18', 'squat', NULL, 9, 'app', 1);
        """
    )


def test_programme_rows_are_checked(conn: sqlite3.Connection) -> None:
    """A run hangs off its tracker, and a change, a sealed day and a mark event off their run.
    Revisions are positive, a change is undone only by a later one, a mark is late or not, a
    programme week starts at 1, and every column is strictly typed."""
    seed_run(conn)
    bad = [
        "INSERT INTO programmes VALUES (1, 'xp', 'Again', '{}', 1, 0, 0)",  # the same id
        "INSERT INTO programmes VALUES (1, 'xq', 'P', '{}', 0, 0, 0)",
        "INSERT INTO programmes VALUES (2, 'xq', 'P', '{}', 1, 0, 0)",  # no such user
        "INSERT INTO programmes VALUES (1, 'xq', NULL, '{}', 1, 0, 0)",
        "INSERT INTO programmes VALUES (1, 'xq', 'P', x'7b7d', 1, 0, 0)",  # STRICT
        # A run needs its tracker, and only one run a tracker.
        "INSERT INTO programme_runs VALUES (1, 'nope', NULL, '{}', '{}', 'd', 'running', 1)",
        "INSERT INTO programme_runs VALUES (1, 'xrun', NULL, '{}', '{}', 'd', 'running', 1)",
        "INSERT INTO programme_runs VALUES (1, 'diet', NULL, '{}', '{}', 'd', 'running', 0)",
        # The rest need their run.
        "INSERT INTO run_changes VALUES (1, 'diet', 1, 0, 'd', '{}', '', 'app', NULL)",
        "INSERT INTO run_changes VALUES (1, 'xrun', 1, 0, 'd', '{}', '', 'app', NULL)",
        "INSERT INTO run_changes VALUES (1, 'xrun', -1, 0, 'd', '{}', '', 'app', NULL)",
        "INSERT INTO run_changes VALUES (1, 'xrun', 3, 0, 'd', '{}', '', 'app', 3)",
        "INSERT INTO run_changes VALUES (1, 'xrun', 3, 0, 'd', '{}', NULL, 'app', NULL)",
        "INSERT INTO programme_days VALUES (1, 'diet', '2026-11-19', 1, '[]', 0)",
        "INSERT INTO programme_days VALUES (1, 'xrun', '2026-11-18', 2, '[]', 0)",
        "INSERT INTO programme_days VALUES (1, 'xrun', '2026-11-19', 0, '[]', 0)",
        "INSERT INTO mark_events (user_id, tracker_id, date, item_id, mark, entered_at, source,"
        " late) VALUES (1, 'diet', 'd', 'veg', 'great', 0, 'app', 0)",
        "INSERT INTO mark_events (user_id, tracker_id, date, item_id, mark, entered_at, source,"
        " late) VALUES (1, 'xrun', 'd', 'squat', 'great', 0, 'app', 2)",
    ]
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (3, 'c', 'h', 0)"
    )
    for sql in bad:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(sql)
    # A run's library programme may be gone: deleting it leaves the run and its copy.
    conn.execute("DELETE FROM programmes WHERE id = 'xp'")
    assert conn.execute("SELECT programme_id FROM programme_runs").fetchone()[0] == "xp"
    # A day before the run's start has no programme week.
    conn.execute("INSERT INTO programme_days VALUES (1, 'xrun', '2026-11-16', NULL, '[]', 7)")


def test_programme_rows_go_with_their_user(conn: sqlite3.Connection) -> None:
    """Deleting an account takes its library, its runs (through their trackers) and every
    change, sealed day and mark event, and leaves another account's alone."""
    seed_run(conn)
    conn.executescript(
        """
        INSERT INTO users (id, username, password_hash, created_at) VALUES (2, 'b', 'h', 0);
        INSERT INTO trackers VALUES (2, 'xrun', 'cardio', 'C25K', 3, NULL, NULL, NULL, 1);
        INSERT INTO programmes VALUES (2, 'xp', 'C25K', '{}', 1, 0, 0);
        INSERT INTO programme_runs VALUES (2, 'xrun', 'xp', '{}', '{}', 'd', 'paused', 1);
        INSERT INTO run_changes VALUES (2, 'xrun', 1, 5, 'd', '{}', '', 'app', NULL);
        INSERT INTO mark_events (user_id, tracker_id, date, item_id, mark, entered_at, source,
            late) VALUES (2, 'xrun', 'd', 'run', 'great', 8, 'app', 0);
        """
    )
    conn.execute("DELETE FROM users WHERE id = 1")
    counts = {
        t: conn.execute(f"SELECT user_id, count(*) FROM {t} GROUP BY user_id").fetchall()  # noqa: S608
        for t in PROGRAMME_TABLES
    }
    assert {t: [tuple(r) for r in rows] for t, rows in counts.items()} == {
        "programmes": [(2, 1)],
        "programme_runs": [(2, 1)],
        "run_changes": [(2, 1)],
        "programme_days": [],
        "mark_events": [(2, 1)],
    }


# --- step 19: the shared library (docs/specs/2026-11-19-shared-library.md §3, §4) ---------------


def before_shared(path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """`before_programmes`' dirty database brought to schema 18, with a library programme."""
    from tracker_api import db

    c = before_programmes(path, monkeypatch)
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[: _step_of(SHARED_STEP)])
    db.migrate(c)
    monkeypatch.undo()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 18
    c.execute("INSERT INTO programmes VALUES (1, 'xp1', 'Beginner', '{}', 2, 10, 20)")
    return c


def schema_but(c: sqlite3.Connection, *tables: str) -> list[tuple[object, ...]]:
    """Every table, index and trigger's SQL but those of `tables`."""
    return sorted(
        tuple(r)
        for r in c.execute("SELECT type, name, tbl_name, sql FROM sqlite_master")
        if r[2] not in tables
    )


def test_shared_migration_keeps_every_row_and_makes_nobody_an_admin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Step 19 adds `users.admin` (0 for every account there) and an empty `shared_programmes`;
    every other row, table, index and trigger stays as it was."""
    c = before_shared(tmp_path / "f.db", monkeypatch)
    names = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    rows = table_rows(c, *names)
    schema = schema_but(c, "users")
    migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 19
    after = table_rows(c, *names)
    # Each account's row gains admin = 0 at its end; nothing else in it changes.
    assert after.pop("users") == [(*row, 0) for row in rows.pop("users")]
    assert after == rows
    assert schema_but(c, "users", "shared_programmes") == schema
    assert c.execute("SELECT count(*) FROM shared_programmes").fetchone()[0] == 0
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    c.close()


def test_shared_table_has_the_specs_columns(conn: sqlite3.Connection) -> None:
    assert columns_of(conn, "users")[-1] == ("admin", "INTEGER", 1)
    assert columns_of(conn, "shared_programmes") == [
        # A STRICT table's primary key is NOT NULL.
        ("id", "TEXT", 1),
        ("name", "TEXT", 1),
        ("doc_json", "TEXT", 1),
        ("rev", "INTEGER", 1),
        ("published_by", "INTEGER", 0),
        ("source_id", "TEXT", 0),
        ("published_at", "INTEGER", 1),
        ("updated_at", "INTEGER", 1),
    ]

    def columns(index: str) -> list[str]:
        return [i["name"] for i in conn.execute(f"PRAGMA index_info({index})")]

    indexes = {
        r["name"]: (r["unique"], columns(r["name"]))
        for r in conn.execute("PRAGMA index_list(shared_programmes)")
        if not r["name"].startswith("sqlite_autoindex")
    }
    assert indexes == {
        "shared_programmes_by_source": (1, ["published_by", "source_id"]),
        "shared_programmes_by_time": (0, ["updated_at"]),
    }


def test_shared_rows_are_checked(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'a', 'h', 0)"
    )
    assert conn.execute("SELECT admin FROM users").fetchone()[0] == 0
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE users SET admin = 2")
    conn.execute("INSERT INTO shared_programmes VALUES ('xs1', 'B', '{}', 1, 1, 'xp1', 5, 5)")
    for bad in [
        "('xs2', 'B', '{}', 1, 1, 'xp1', 5, 5)",  # the same library programme twice
        "('xs2', 'B', '{}', 0, 1, 'xp2', 5, 5)",  # rev 0
        "('xs2', 'B', '{}', 1, 9, 'xp2', 5, 5)",  # no such user
        "('xs1', 'B', '{}', 1, 1, 'xp2', 5, 5)",  # the id taken
    ]:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(f"INSERT INTO shared_programmes VALUES {bad}")  # noqa: S608
    # Rows whose admin is gone may share a source: NULLs are distinct in a unique index.
    conn.execute("INSERT INTO shared_programmes VALUES ('xs3', 'B', '{}', 1, NULL, 'xp1', 5, 5)")
    conn.execute("INSERT INTO shared_programmes VALUES ('xs4', 'B', '{}', 1, NULL, 'xp1', 5, 5)")


def test_deleting_the_admins_account_keeps_the_shared_library(conn: sqlite3.Connection) -> None:
    """`ON DELETE SET NULL` fires with the connection's foreign keys on: the snapshot stays,
    named by no one, and the admin's own library goes."""
    conn.executescript(
        """
        INSERT INTO users (id, username, password_hash, created_at, admin)
            VALUES (1, 'a', 'h', 0, 1), (2, 'b', 'h', 0, 0);
        INSERT INTO programmes VALUES (1, 'xp1', 'Beginner', '{}', 1, 0, 0);
        INSERT INTO shared_programmes VALUES ('xs1', 'Beginner', '{}', 3, 1, 'xp1', 5, 9);
        """
    )
    conn.execute("DELETE FROM users WHERE id = 1")
    assert table_rows(conn, "shared_programmes")["shared_programmes"] == [
        ("xs1", "Beginner", "{}", 3, None, "xp1", 5, 9)
    ]
    assert conn.execute("SELECT count(*) FROM programmes").fetchone()[0] == 0
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
