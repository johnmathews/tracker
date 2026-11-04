"""Runtime configuration, read from the environment (docs/api.md §6)."""

import os
import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ORIGIN_RE = re.compile(r"https?://[^/\s]+")
# `planner@example.com`, or a display name before it: `Tracker <planner@example.com>`.
SENDER_RE = re.compile(r"(?:[^<>@]+ <[^<>@\s]+@[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+)")
DEFAULT_TIMEZONE = "Europe/Amsterdam"
#: The hosts whose client metadata documents may name an OAuth client (oauth.py): Claude's.
DEFAULT_OAUTH_CLIENT_HOSTS = ("claude.ai", "claude.com", "chatgpt.com")
HOST_RE = re.compile(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+")


def _now() -> int:
    return int(time.time())


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None:
        return default
    if raw.lower() not in ("true", "false"):
        raise ValueError(f"{name} must be true or false, not {raw!r}")
    return raw.lower() == "true"


def _zone(env: Mapping[str, str]) -> ZoneInfo:
    raw = env.get("TIMEZONE", DEFAULT_TIMEZONE)
    try:
        return ZoneInfo(raw)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(
            f"TIMEZONE must be an IANA time zone such as {DEFAULT_TIMEZONE}, not {raw!r}"
        ) from None


def _hosts(env: Mapping[str, str]) -> tuple[str, ...]:
    """OAUTH_CLIENT_HOSTS: host names, comma-separated, matched exactly (no subdomains)."""
    raw = env.get("OAUTH_CLIENT_HOSTS")
    if raw is None:
        return DEFAULT_OAUTH_CLIENT_HOSTS
    hosts = tuple(h.strip().lower() for h in raw.split(",") if h.strip())
    if not hosts or not all(HOST_RE.fullmatch(h) for h in hosts):
        raise ValueError(
            f"OAUTH_CLIENT_HOSTS must be host names separated by commas, such as claude.ai,"
            f" not {raw!r}"
        )
    return hosts


def _count(env: Mapping[str, str], name: str, default: int, least: int = 0) -> int:
    raw = env.get(name, str(default))
    if not raw.isdigit() or int(raw) < least:
        raise ValueError(f"{name} must be a whole number of {least} or more, not {raw!r}")
    return int(raw)


@dataclass(frozen=True)
class Config:
    data_dir: Path
    #: Scheme, host and port with no path, e.g. https://fitness.itsa-pizza.com.
    public_origin: str
    cookie_secure: bool = True
    backup_keep: int = 7
    session_days: int = 90
    invite_days: int = 7
    reset_hours: int = 24
    lockout_attempts: int = 5
    lockout_minutes: int = 15
    #: Sign-up closes once this many accounts exist (invited ones count too); 0 turns it off.
    max_users: int = 50
    signups_per_hour: int = 10
    #: What each user may store, as `data.usage` measures it.
    user_quota_bytes: int = 5 * 1024 * 1024
    #: Mail is on when this is set. Kept out of repr, so a logged config never shows it.
    resend_api_key: str | None = field(default=None, repr=False)
    #: The From line; required when mail is on.
    mail_from: str = ""
    #: Emails of every kind across all accounts, in any hour.
    mail_per_hour: int = 30
    confirm_days: int = 7
    #: A reset link sent by email; one minted by `tracker-admin reset` lasts `reset_hours`.
    mail_reset_minutes: int = 60
    #: Ask is on when this is set. Kept out of repr, as the Resend key is.
    anthropic_api_key: str | None = field(default=None, repr=False)
    ask_model: str = "claude-sonnet-5-5"
    #: Questions per account in any rolling 24 hours, and across all accounts.
    ask_per_day: int = 30
    ask_per_day_total: int = 300
    #: Where today and this week are counted (`today`, `this_week`).
    timezone: ZoneInfo = field(default_factory=lambda: ZoneInfo(DEFAULT_TIMEZONE))
    #: Where an OAuth client's metadata document may live; exact host names.
    oauth_client_hosts: tuple[str, ...] = DEFAULT_OAUTH_CLIENT_HOSTS
    #: Unix seconds; injectable so tests can move time.
    clock: Callable[[], int] = field(default=_now)

    def today(self) -> date:
        """The date now in `timezone`."""
        return datetime.fromtimestamp(self.clock(), self.timezone).date()

    def this_week(self) -> str:
        """The Monday of today's week in `timezone`, as YYYY-MM-DD: the app's week key."""
        today = self.today()
        return (today - timedelta(days=today.weekday())).isoformat()

    @property
    def mail_enabled(self) -> bool:
        return self.resend_api_key is not None

    @property
    def ask_enabled(self) -> bool:
        return self.anthropic_api_key is not None

    @property
    def db_path(self) -> Path:
        return self.data_dir / "fitness.db"

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / "backup"

    @property
    def cookie_name(self) -> str:
        # The __Host- prefix makes the browser insist on Secure, Path=/ and no Domain.
        return "__Host-session" if self.cookie_secure else "session"

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Config":
        origin = env.get("PUBLIC_ORIGIN", "")
        if not ORIGIN_RE.fullmatch(origin):
            raise ValueError(f"PUBLIC_ORIGIN must look like https://host[:port], not {origin!r}")
        key = env.get("RESEND_API_KEY") or None
        sender = env.get("MAIL_FROM", "")
        if key is not None and not SENDER_RE.fullmatch(sender):
            raise ValueError(
                "MAIL_FROM must look like Name <address@domain> when RESEND_API_KEY is set,"
                f" not {sender!r}"
            )
        return cls(
            data_dir=Path(env.get("DATA_DIR", "/data")),
            public_origin=origin,
            cookie_secure=_flag(env, "COOKIE_SECURE", True),
            backup_keep=int(env.get("BACKUP_KEEP", "7")),
            max_users=_count(env, "MAX_USERS", 50),
            resend_api_key=key,
            mail_from=sender,
            # At least one: the limit is a cap, and 0 would make every reset request fail.
            mail_per_hour=_count(env, "MAIL_PER_HOUR", 30, least=1),
            anthropic_api_key=env.get("ANTHROPIC_API_KEY") or None,
            ask_model=env.get("ASK_MODEL") or "claude-sonnet-5-5",
            # At least one each: the key turns Ask off, and 0 would refuse every question.
            ask_per_day=_count(env, "ASK_PER_DAY", 30, least=1),
            ask_per_day_total=_count(env, "ASK_PER_DAY_TOTAL", 300, least=1),
            timezone=_zone(env),
            oauth_client_hosts=_hosts(env),
        )
