import json
import sqlite3
from dataclasses import replace
from datetime import date, datetime

import pytest

from tracker_api import auth, seed
from tracker_api.cli import main
from tracker_api.config import Config
from tracker_api.data import export_file, put_details, set_tick
from tracker_api.types import SECTION_TYPES, Section
from tracker_api.validate import parse_export

from .conftest import Clock

LOCAL = "http://localhost:5173"


@pytest.fixture
def local(config: Config) -> Config:
    return replace(config, public_origin=LOCAL, cookie_secure=False)


def today(config: Config) -> date:
    return datetime.fromtimestamp(config.clock()).date()


def user_id(conn: sqlite3.Connection, email: str) -> int:
    return int(conn.execute("SELECT id FROM users WHERE username = ?", (email,)).fetchone()["id"])


@pytest.mark.parametrize(
    ("origin", "secure"),
    [
        ("https://fitness.example.com", True),
        ("http://fitness.example.com", False),
        ("http://localhost:5173", True),
        ("https://localhost:5173", False),
    ],
)
def test_refuses_anything_but_a_local_stack(
    config: Config, conn: sqlite3.Connection, origin: str, secure: bool
) -> None:
    deployed = replace(config, public_origin=origin, cookie_secure=secure)
    with pytest.raises(seed.NotLocal):
        seed.seed(conn, deployed, seed.DEMO_EMAIL, None)
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:8000"])
def test_accepts_localhost_and_the_loopback_address(
    config: Config, conn: sqlite3.Connection, origin: str
) -> None:
    seed.require_local(replace(config, public_origin=origin, cookie_secure=False))


def test_creates_a_confirmed_demo_account_that_signs_in(
    local: Config, conn: sqlite3.Connection
) -> None:
    result = seed.seed(conn, local, seed.DEMO_EMAIL, None)
    assert result["created"]
    uid = user_id(conn, seed.DEMO_EMAIL)
    assert auth.login(conn, local, seed.DEMO_EMAIL, seed.DEMO_PASSWORD) == uid
    # No mail on a local stack, so the account starts confirmed.
    assert auth.confirmed(conn, uid) is True


def test_fills_three_weeks_ending_today_with_every_kind_and_drawing(
    local: Config, conn: sqlite3.Connection
) -> None:
    result = seed.seed(conn, local, seed.DEMO_EMAIL, None)
    # Three weeks of plans in each section.
    assert result["weeks"] == 6
    exported = export_file(conn, user_id(conn, seed.DEMO_EMAIL), local.clock())
    data = parse_export(json.dumps(exported))
    weeks = sorted(data["exercise"]["plans"])
    assert len(weeks) == 3
    assert date.fromisoformat(weeks[-1]).weekday() == 0
    marks = {
        m
        for section in ("exercise", "diet")
        for week in data[section]["log"].values()
        for days in week.values()
        for m in days
        if m is not None
    }
    assert {"great", "partial", "missed", "great-solid", "great-hatch"} <= marks
    assert result["ticks"] > 40
    assert exported["settings"] == {
        "accent": "#30d158",
        "dailyPick": 3,
        "foodPick": 2,
        "goals": "",
    }


def test_gives_demo_items_details_for_the_item_page(
    local: Config, conn: sqlite3.Connection
) -> None:
    seed.seed(conn, local, seed.DEMO_EMAIL, None)
    exported = export_file(conn, user_id(conn, seed.DEMO_EMAIL), local.clock())
    demo: tuple[tuple[Section, str], ...] = (("exercise", "pu"), ("diet", "fish"))
    for section, item_id in demo:
        details = exported[section]["details"][item_id]
        assert details["notes"]
        assert details["fields"]
        # Every demo field is one the type lists, so the page shows it.
        keys = {f.key for f in SECTION_TYPES[section].fields}
        assert set(details["fields"]) <= keys


def test_keeps_an_accounts_own_details(local: Config, conn: sqlite3.Connection) -> None:
    uid = auth.signup(conn, local, "alice@example.com", "her own password")
    mine = {"notes": "My own push-up note."}
    put_details(conn, uid, "exercise", "pu", mine, 0, quota=local.user_quota_bytes)
    seed.seed(conn, local, "alice@example.com", None)
    details = export_file(conn, uid, local.clock())["exercise"]["details"]
    assert details["pu"] == mine


def test_leaves_the_days_after_today_empty(local: Config, conn: sqlite3.Connection) -> None:
    seed.seed(conn, local, seed.DEMO_EMAIL, None)
    data = export_file(conn, user_id(conn, seed.DEMO_EMAIL), local.clock())
    day = today(local)
    this_week = max(data["exercise"]["log"])
    for days in data["exercise"]["log"][this_week].values():
        assert all(m is None for m in days[day.weekday() + 1 :])


def test_a_second_run_changes_nothing(local: Config, conn: sqlite3.Connection) -> None:
    seed.seed(conn, local, seed.DEMO_EMAIL, None)
    before = export_file(conn, user_id(conn, seed.DEMO_EMAIL), local.clock())
    again = seed.seed(conn, local, seed.DEMO_EMAIL, None)
    assert again == {"created": False, "weeks": 0, "ticks": 0, "details": 0}
    assert export_file(conn, user_id(conn, seed.DEMO_EMAIL), local.clock()) == before


def test_an_existing_account_keeps_its_password_and_its_own_marks(
    local: Config, conn: sqlite3.Connection
) -> None:
    uid = auth.signup(conn, local, "alice@example.com", "her own password")
    this_monday = today(local).toordinal() - today(local).weekday()
    week = date.fromordinal(this_monday).isoformat()
    # Push-ups on Monday: the demo marks it great; hers says missed and must stay.
    set_tick(conn, uid, "exercise", week, "pu", 0, "missed", quota=local.user_quota_bytes)
    result = seed.seed(conn, local, "alice@example.com", "ignored password")
    assert not result["created"]
    assert auth.login(conn, local, "alice@example.com", "her own password") == uid
    log = export_file(conn, uid, local.clock())["exercise"]["log"]
    assert log[week]["pu"][0] == "missed"


def test_cli_prints_the_login_and_what_it_added(
    local: Config, capsys: pytest.CaptureFixture[str]
) -> None:
    env = {"DATA_DIR": str(local.data_dir), "PUBLIC_ORIGIN": LOCAL, "COOKIE_SECURE": "false"}
    assert main(["seed-demo"], env, clock=Clock()) == 0
    out = capsys.readouterr().out
    assert f"Created {seed.DEMO_EMAIL} with the password '{seed.DEMO_PASSWORD}'." in out
    assert "Added 6 week plans, " in out
    assert " marks and details for 2 items." in out
    assert f"Sign in at {LOCAL}/" in out
    assert main(["seed-demo"], env, clock=Clock()) == 0
    out = capsys.readouterr().out
    assert "already exists; its password is unchanged." in out
    assert "Nothing to add: the demo weeks are already there." in out


def test_cli_reports_details_added_to_weeks_already_there(
    local: Config, conn: sqlite3.Connection, capsys: pytest.CaptureFixture[str]
) -> None:
    env = {"DATA_DIR": str(local.data_dir), "PUBLIC_ORIGIN": LOCAL, "COOKIE_SECURE": "false"}
    assert main(["seed-demo"], env, clock=Clock()) == 0
    # An account seeded before item details: its weeks and marks are there, its details aren't.
    conn.execute("DELETE FROM item_details")
    capsys.readouterr()
    assert main(["seed-demo"], env, clock=Clock()) == 0
    out = capsys.readouterr().out
    assert "Added details for 2 items." in out
    assert "Nothing to add" not in out


def test_cli_refuses_a_deployed_config(config: Config, capsys: pytest.CaptureFixture[str]) -> None:
    env = {"DATA_DIR": str(config.data_dir), "PUBLIC_ORIGIN": "https://fitness.example.com"}
    assert main(["seed-demo"], env, clock=Clock()) == 1
    assert "runs only on a local stack" in capsys.readouterr().err
