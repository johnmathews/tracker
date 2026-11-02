from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from tracker_api.config import Config


def test_reads_the_environment() -> None:
    cfg = Config.from_env(
        {
            "DATA_DIR": "/srv/x",
            "PUBLIC_ORIGIN": "https://fitness.example",
            "COOKIE_SECURE": "false",
            "BACKUP_KEEP": "3",
            "MAX_USERS": "0",
        }
    )
    assert cfg.data_dir == Path("/srv/x")
    assert cfg.db_path == Path("/srv/x/fitness.db")
    assert cfg.public_origin == "https://fitness.example"
    assert cfg.cookie_secure is False
    assert cfg.cookie_name == "session"
    assert cfg.backup_keep == 3
    assert cfg.max_users == 0


def test_defaults() -> None:
    cfg = Config.from_env({"PUBLIC_ORIGIN": "https://fitness.example"})
    assert cfg.data_dir == Path("/data")
    assert cfg.cookie_secure is True
    assert cfg.cookie_name == "__Host-session"
    assert cfg.backup_keep == 7
    assert (cfg.max_users, cfg.signups_per_hour) == (50, 10)
    assert cfg.user_quota_bytes == 5 * 1024 * 1024
    assert (cfg.session_days, cfg.invite_days, cfg.reset_hours) == (90, 7, 24)
    assert (cfg.lockout_attempts, cfg.lockout_minutes) == (5, 15)
    assert cfg.clock() > 1_700_000_000


@pytest.mark.parametrize(
    "origin",
    [
        None,
        "",
        "fitness.example",
        "https://fitness.example/",
        "https://fitness.example/path",
        "ftp://x",
    ],
)
def test_rejects_a_missing_or_malformed_origin(origin: str | None) -> None:
    env = {} if origin is None else {"PUBLIC_ORIGIN": origin}
    with pytest.raises(ValueError, match="PUBLIC_ORIGIN"):
        Config.from_env(env)


@pytest.mark.parametrize("value", ["yes", "0"])
def test_rejects_an_unclear_boolean(value: str) -> None:
    with pytest.raises(ValueError, match="COOKIE_SECURE"):
        Config.from_env({"PUBLIC_ORIGIN": "https://f.example", "COOKIE_SECURE": value})


@pytest.mark.parametrize("value", ["-1", "many"])
def test_rejects_a_bad_max_users(value: str) -> None:
    with pytest.raises(ValueError, match="MAX_USERS"):
        Config.from_env({"PUBLIC_ORIGIN": "https://f.example", "MAX_USERS": value})


def test_mail_is_off_unless_a_key_is_set() -> None:
    cfg = Config.from_env({"PUBLIC_ORIGIN": "https://f.example", "RESEND_API_KEY": ""})
    assert cfg.mail_enabled is False
    assert (cfg.mail_per_hour, cfg.confirm_days, cfg.mail_reset_minutes) == (30, 7, 60)


def test_reads_mail_settings_and_hides_the_key() -> None:
    cfg = Config.from_env(
        {
            "PUBLIC_ORIGIN": "https://f.example",
            "RESEND_API_KEY": "re_secret",
            "MAIL_FROM": "Tracker <planner@updates.f.example>",
            "MAIL_PER_HOUR": "5",
        }
    )
    assert cfg.mail_enabled is True
    assert cfg.mail_from == "Tracker <planner@updates.f.example>"
    assert cfg.mail_per_hour == 5
    assert "re_secret" not in repr(cfg)
    bare = {"PUBLIC_ORIGIN": "https://f.example", "RESEND_API_KEY": "k", "MAIL_FROM": "p@f.example"}
    assert Config.from_env(bare).mail_from == "p@f.example"


@pytest.mark.parametrize("sender", [None, "", "planner", "Planner <planner>", "<a@b.c>"])
def test_a_key_needs_a_sender(sender: str | None) -> None:
    env = {"PUBLIC_ORIGIN": "https://f.example", "RESEND_API_KEY": "k"}
    if sender is not None:
        env["MAIL_FROM"] = sender
    with pytest.raises(ValueError, match="MAIL_FROM"):
        Config.from_env(env)


def test_mail_per_hour_must_allow_one() -> None:
    env = {"PUBLIC_ORIGIN": "https://f.example", "MAIL_PER_HOUR": "0"}
    with pytest.raises(ValueError, match="MAIL_PER_HOUR"):
        Config.from_env(env)


def test_ask_is_off_unless_a_key_is_set() -> None:
    cfg = Config.from_env({"PUBLIC_ORIGIN": "https://f.example", "ANTHROPIC_API_KEY": ""})
    assert cfg.ask_enabled is False
    assert cfg.anthropic_api_key is None
    assert cfg.ask_model == "claude-sonnet-5-5"
    assert (cfg.ask_per_day, cfg.ask_per_day_total) == (30, 300)


def test_reads_ask_settings_and_hides_the_key() -> None:
    cfg = Config.from_env(
        {
            "PUBLIC_ORIGIN": "https://f.example",
            "ANTHROPIC_API_KEY": "sk-ant-secret",
            "ASK_MODEL": "claude-opus-5-5",
            "ASK_PER_DAY": "5",
            "ASK_PER_DAY_TOTAL": "40",
        }
    )
    assert cfg.ask_enabled is True
    assert cfg.anthropic_api_key == "sk-ant-secret"
    assert cfg.ask_model == "claude-opus-5-5"
    assert (cfg.ask_per_day, cfg.ask_per_day_total) == (5, 40)
    assert "sk-ant-secret" not in repr(cfg)


def test_a_blank_ask_model_reads_as_the_default() -> None:
    cfg = Config.from_env({"PUBLIC_ORIGIN": "https://f.example", "ASK_MODEL": ""})
    assert cfg.ask_model == "claude-sonnet-5-5"


@pytest.mark.parametrize("name", ["ASK_PER_DAY", "ASK_PER_DAY_TOTAL"])
@pytest.mark.parametrize("value", ["0", "-1", "many"])
def test_ask_caps_must_allow_one(name: str, value: str) -> None:
    with pytest.raises(ValueError, match=name):
        Config.from_env({"PUBLIC_ORIGIN": "https://f.example", name: value})


def test_the_time_zone_defaults_to_amsterdam() -> None:
    cfg = Config.from_env({"PUBLIC_ORIGIN": "https://f.example"})
    assert cfg.timezone == ZoneInfo("Europe/Amsterdam")
    assert Config(data_dir=Path("/x"), public_origin="https://f.example").timezone == cfg.timezone


@pytest.mark.parametrize("zone", ["UTC", "America/New_York", "Asia/Kolkata"])
def test_reads_the_time_zone(zone: str) -> None:
    cfg = Config.from_env({"PUBLIC_ORIGIN": "https://f.example", "TIMEZONE": zone})
    assert cfg.timezone == ZoneInfo(zone)


@pytest.mark.parametrize(
    "zone", ["", "Mars/Olympus", "Europe/Amsterdam ", "Europe", "zone.tab", "../etc/passwd", "/etc"]
)
def test_rejects_an_unknown_time_zone(zone: str) -> None:
    with pytest.raises(ValueError, match="TIMEZONE"):
        Config.from_env({"PUBLIC_ORIGIN": "https://f.example", "TIMEZONE": zone})


def at(utc: str) -> Callable[[], int]:
    """A clock stopped at an ISO time in UTC."""
    moment = int(datetime.fromisoformat(utc).replace(tzinfo=UTC).timestamp())
    return lambda: moment


@pytest.mark.parametrize(
    ("utc", "today", "week"),
    [
        # Winter (CET, UTC+1): Sunday 23:30 UTC is already Monday 00:30 in Amsterdam.
        ("2026-11-01T22:59:59", date(2026, 11, 1), "2026-10-26"),
        ("2026-11-01T23:00:00", date(2026, 11, 2), "2026-11-02"),
        ("2026-11-01T23:30:00", date(2026, 11, 2), "2026-11-02"),
        # Summer (CEST, UTC+2): the week turns over at 22:00 UTC on Sunday.
        ("2026-10-18T21:59:59", date(2026, 10, 18), "2026-10-12"),
        ("2026-10-18T22:00:00", date(2026, 10, 19), "2026-10-19"),
        # The Sunday the clocks go back: that week lasts until local midnight, 23:00 UTC.
        ("2026-10-25T22:30:00", date(2026, 10, 25), "2026-10-19"),
        ("2026-10-25T23:00:00", date(2026, 10, 26), "2026-10-26"),
        # Midweek: a Wednesday belongs to the Monday before it.
        ("2026-10-28T12:00:00", date(2026, 10, 28), "2026-10-26"),
    ],
)
def test_today_and_this_week_are_local(utc: str, today: date, week: str) -> None:
    cfg = Config(data_dir=Path("/x"), public_origin="https://f.example", clock=at(utc))
    assert cfg.today() == today
    assert cfg.this_week() == week


def test_this_week_follows_the_configured_zone() -> None:
    """Sunday 23:30 UTC: Monday in Amsterdam, still Sunday in UTC and New York."""
    base = Config(
        data_dir=Path("/x"), public_origin="https://f.example", clock=at("2026-11-01T23:30:00")
    )
    assert base.this_week() == "2026-11-02"
    assert replace(base, timezone=ZoneInfo("UTC")).this_week() == "2026-10-26"
    assert replace(base, timezone=ZoneInfo("America/New_York")).today() == date(2026, 11, 1)
