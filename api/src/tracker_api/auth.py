"""Passwords, lockout, sessions, invite and reset links, email confirmation and personal API tokens
(docs/api.md §4)."""

import hashlib
import re
import secrets
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Literal

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import Config
from .db import transaction

#: argon2id at argon2-cffi's defaults (RFC 9106 low-memory: 64 MiB, 3 passes, parallelism 4).
DEFAULT_HASHER = PasswordHasher()
HASHER = DEFAULT_HASHER
# One hash at a time: each takes 64 MiB, and the container's memory limit is sized for one.
_HASHING = threading.Semaphore(1)
# Logins wait for the hasher on a worker thread. Bounding the queue and the wait keeps a flood of
# logins from occupying every thread the API has; the excess gets 503 `busy` instead.
MAX_WAITING = 8
HASH_WAIT = 5.0
_WAITING = threading.BoundedSemaphore(MAX_WAITING)

DAY = 86_400
MIN_PASSWORD, MAX_PASSWORD = 10, 256
# Printable ASCII, since the name travels in the X-Expected-User header; length checked apart.
EMAIL_RE = re.compile(r"[!-?A-~]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
MAX_EMAIL = 254
HOUR = 3600

LinkKind = Literal["invite", "reset"]
TokenScope = Literal["read", "write"]

TOKEN_PREFIX = "trk_"  # noqa: S105 (a marker that says what the string is, not a secret)
#: How many characters after `trk_` the database keeps, to name a token without revealing it.
PREFIX_CHARS = 8
MAX_TOKEN_NAME = 64
#: Live personal tokens one user may hold through the API. The admin CLI mints without a limit.
MAX_TOKENS = 20
# `trk_` and `secrets.token_urlsafe(32)`: 43 characters of the URL-safe alphabet.
_TOKEN_RE = re.compile(r"trk_[A-Za-z0-9_-]{43}")


class AuthError(Exception):
    """A refused auth step. `code` is what the API returns as `{"error": code}`."""

    def __init__(self, code: str, retry_after: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.retry_after = retry_after


@dataclass(frozen=True)
class SessionUser:
    id: int
    username: str
    #: True when this request moved the expiry forward, so the cookie should be sent again.
    refreshed: bool


@dataclass(frozen=True)
class TokenUser:
    """Who a personal API token acts as, and what it may do."""

    user_id: int
    username: str
    scope: TokenScope


@dataclass(frozen=True)
class TokenInfo:
    """A token as `tracker-admin token list` shows it: never its hash."""

    name: str
    #: The 8 characters after `trk_`.
    prefix: str
    scope: TokenScope
    created_at: int
    last_used_at: int | None


@contextmanager
def _hashing() -> Iterator[None]:
    """Hold the hasher, or raise AuthError `busy` when the queue is full or the wait too long."""
    if not _WAITING.acquire(blocking=False):
        raise AuthError("busy", retry_after=1)
    try:
        if not _HASHING.acquire(timeout=HASH_WAIT):
            raise AuthError("busy", retry_after=1)
        try:
            yield
        finally:
            _HASHING.release()
    finally:
        _WAITING.release()


def hash_password(password: str) -> str:
    with _hashing():
        return HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    with _hashing():
        try:
            return HASHER.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            return False


_dummy_hash: str | None = None


def _dummy() -> str:
    """A real hash to verify against for unknown users, so they cost the same time."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password(secrets.token_urlsafe(16))
    return _dummy_hash


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def login(conn: sqlite3.Connection, config: Config, username: str, password: str) -> int:
    """The user's id, or AuthError `invalid` or `locked`."""
    now = config.clock()
    row = conn.execute(
        "SELECT id, password_hash, locked_until FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if row is None:
        verify_password(_dummy(), password)
        raise AuthError("invalid")
    if row["locked_until"] is not None and row["locked_until"] > now:
        raise AuthError("locked", retry_after=row["locked_until"] - now)
    # Verify outside any transaction: a hash takes long enough that holding the lock would block.
    ok = verify_password(row["password_hash"], password)
    window = config.lockout_minutes * 60
    with transaction(conn):
        # Read again under the write lock: a lock set by requests that finished while this one
        # waited for the hasher must hold, or a burst of parallel guesses would get around it.
        fresh = conn.execute(
            "SELECT disabled, failed_logins, failed_since, locked_until FROM users WHERE id = ?",
            (row["id"],),
        ).fetchone()
        if fresh["locked_until"] is not None and fresh["locked_until"] > now:
            raise AuthError("locked", retry_after=fresh["locked_until"] - now)
        if ok and not fresh["disabled"]:
            conn.execute(
                "UPDATE users SET failed_logins = 0, failed_since = NULL, locked_until = NULL"
                " WHERE id = ?",
                (row["id"],),
            )
            return int(row["id"])
        stale = fresh["failed_since"] is None or now - fresh["failed_since"] >= window
        failures = 1 if stale else fresh["failed_logins"] + 1
        since = now if stale else fresh["failed_since"]
        if failures >= config.lockout_attempts:
            conn.execute(
                "UPDATE users SET failed_logins = 0, failed_since = NULL, locked_until = ?"
                " WHERE id = ?",
                (now + window, row["id"]),
            )
        else:
            conn.execute(
                "UPDATE users SET failed_logins = ?, failed_since = ? WHERE id = ?",
                (failures, since, row["id"]),
            )
    raise AuthError("invalid")


def normal_email(email: str) -> str:
    """The email as accounts store it, trimmed and lower-cased; AuthError `email` if not one."""
    email = email.strip().lower()
    if len(email) > MAX_EMAIL or not EMAIL_RE.fullmatch(email):
        raise AuthError("email")
    return email


def _signup_refusal(conn: sqlite3.Connection, config: Config, now: int) -> AuthError | None:
    """Why sign-up is shut right now: the account cap, or the hourly limit with its wait."""
    if conn.execute("SELECT count(*) FROM users").fetchone()[0] >= config.max_users:
        return AuthError("closed")
    # Only sign-ups count towards the hour: an account made from a used invite does not.
    recent = conn.execute(
        "SELECT created_at FROM users u WHERE created_at > ? AND NOT EXISTS"
        " (SELECT 1 FROM invites i WHERE i.kind = 'invite' AND i.used_at IS NOT NULL"
        " AND i.username = u.username) ORDER BY created_at",
        (now - HOUR,),
    ).fetchall()
    if len(recent) >= config.signups_per_hour:
        first = recent[len(recent) - config.signups_per_hour]["created_at"]
        return AuthError("too-many", retry_after=first + HOUR - now)
    return None


def signup(conn: sqlite3.Connection, config: Config, email: str, password: str) -> int:
    """Create an account named by its email, lower-cased; returns the new user's id."""
    email = normal_email(email)
    if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        raise AuthError("password")
    # Checked before the hash so a closed sign-up costs nothing, and again under the write lock.
    if refusal := _signup_refusal(conn, config, config.clock()):
        raise refusal
    password_hash = hash_password(password)
    now = config.clock()
    with transaction(conn):
        if refusal := _signup_refusal(conn, config, now):
            raise refusal
        try:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                (email, password_hash, now),
            )
        except sqlite3.IntegrityError:
            raise AuthError("exists") from None
        return int(cur.lastrowid or 0)


def create_session(conn: sqlite3.Connection, config: Config, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = config.clock()
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (token_hash(token), user_id, now, now, now + config.session_days * DAY),
    )
    return token


def session_user(conn: sqlite3.Connection, config: Config, token: str) -> SessionUser | None:
    """The session's user, sliding its expiry when the last refresh is over a day old."""
    now = config.clock()
    th = token_hash(token)
    row = conn.execute(
        "SELECT s.user_id, s.last_seen, s.expires_at, u.username, u.disabled"
        " FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
        (th,),
    ).fetchone()
    if row is None:
        return None
    if row["expires_at"] <= now or row["disabled"]:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (th,))
        return None
    refreshed = now - row["last_seen"] > DAY
    if refreshed:
        conn.execute(
            "UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?",
            (now, now + config.session_days * DAY, th),
        )
    return SessionUser(int(row["user_id"]), row["username"], refreshed)


def end_session(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))


def _user_id(conn: sqlite3.Connection, username: str) -> int:
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        raise AuthError("no-user")
    return int(row["id"])


def end_credentials(conn: sqlite3.Connection, user_id: int) -> tuple[int, int]:
    """Revoke every personal token and end every OAuth connection of the user; returns how many
    of each. A connection's codes, access tokens and retired refresh tokens go with it (the
    tables cascade). Callers run it inside their own transaction, beside what else they change,
    so a failure ends nothing (D7)."""
    tokens = conn.execute("DELETE FROM api_tokens WHERE user_id = ?", (user_id,)).rowcount
    grants = conn.execute("DELETE FROM oauth_grants WHERE user_id = ?", (user_id,)).rowcount
    return tokens, grants


def revoke_sessions(conn: sqlite3.Connection, username: str) -> tuple[int, int, int]:
    """End every session of the user, revoke their API tokens and end their OAuth connections;
    returns how many sessions, tokens and connections."""
    uid = _user_id(conn, username)
    with transaction(conn):
        sessions = conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,)).rowcount
        tokens, connections = end_credentials(conn, uid)
    return sessions, tokens, connections


def set_disabled(conn: sqlite3.Connection, username: str, disabled: bool) -> None:
    uid = _user_id(conn, username)
    with transaction(conn):
        conn.execute("UPDATE users SET disabled = ? WHERE id = ?", (int(disabled), uid))
        if disabled:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
            end_credentials(conn, uid)


def create_token(
    conn: sqlite3.Connection,
    config: Config,
    username: str,
    name: str,
    scope: TokenScope,
    limit: int | None = None,
) -> str:
    """A new personal API token for the user, returned this once: only its hash is kept.

    AuthError `token-name` for a name that is not 1 to 64 printable characters once trimmed,
    `no-user`, or `disabled`, since a disabled account's tokens would not work. With a `limit`,
    `too-many-tokens` when the user already holds that many; the count and the insert share one
    write transaction, so two requests cannot both take the last place."""
    name = name.strip()
    if not 1 <= len(name) <= MAX_TOKEN_NAME or not name.isprintable():
        raise AuthError("token-name")
    with transaction(conn):
        user = conn.execute(
            "SELECT id, disabled FROM users WHERE username = ?", (username,)
        ).fetchone()
        if user is None:
            raise AuthError("no-user")
        if user["disabled"]:
            raise AuthError("disabled")
        if limit is not None:
            held = conn.execute(
                "SELECT COUNT(*) FROM api_tokens WHERE user_id = ?", (user["id"],)
            ).fetchone()[0]
            if held >= limit:
                raise AuthError("too-many-tokens")
        # Drawn again on the rare prefix the account already has, so a prefix names one token.
        while True:
            token = TOKEN_PREFIX + secrets.token_urlsafe(32)
            prefix = token[len(TOKEN_PREFIX) :][:PREFIX_CHARS]
            taken = conn.execute(
                "SELECT 1 FROM api_tokens WHERE user_id = ? AND prefix = ?", (user["id"], prefix)
            ).fetchone()
            if taken is None:
                break
        conn.execute(
            "INSERT INTO api_tokens (token_hash, user_id, name, prefix, scope, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (token_hash(token), user["id"], name, prefix, scope, config.clock()),
        )
    return token


def token_user(conn: sqlite3.Connection, config: Config, token: str) -> TokenUser | None:
    """The user a personal API token acts as, or None for an unknown, malformed or disabled one.

    It never raises on what a client sends. `last_used_at` moves on the first use, then at most
    once a day, as a session's refresh does."""
    if not isinstance(token, str) or not _TOKEN_RE.fullmatch(token):
        return None
    now = config.clock()
    th = token_hash(token)
    row = conn.execute(
        "SELECT t.user_id, t.scope, t.last_used_at, u.username, u.disabled"
        " FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?",
        (th,),
    ).fetchone()
    if row is None or row["disabled"]:
        return None
    if row["last_used_at"] is None or now - row["last_used_at"] > DAY:
        conn.execute("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?", (now, th))
    return TokenUser(int(row["user_id"]), row["username"], row["scope"])


_LISTING = "SELECT name, prefix, scope, created_at, last_used_at FROM api_tokens"


def _token_info(row: sqlite3.Row) -> TokenInfo:
    return TokenInfo(
        row["name"], row["prefix"], row["scope"], row["created_at"], row["last_used_at"]
    )


def list_tokens(conn: sqlite3.Connection, username: str) -> list[TokenInfo]:
    """The user's tokens, oldest first."""
    rows = conn.execute(
        f"{_LISTING} WHERE user_id = ? ORDER BY created_at, rowid",
        (_user_id(conn, username),),
    ).fetchall()
    return [_token_info(r) for r in rows]


def revoke_token(conn: sqlite3.Connection, username: str, prefix: str) -> TokenInfo:
    """Revoke the user's token with this prefix, given bare or after `trk_`, and return it.

    A prefix is unique per user, so it names one token at most; AuthError `no-token` if none."""
    uid = _user_id(conn, username)
    if len(prefix) == len(TOKEN_PREFIX) + PREFIX_CHARS:
        prefix = prefix.removeprefix(TOKEN_PREFIX)
    with transaction(conn):
        row = conn.execute(
            f"{_LISTING} WHERE user_id = ? AND prefix = ?",
            (uid, prefix),
        ).fetchone()
        if row is None:
            raise AuthError("no-token")
        conn.execute("DELETE FROM api_tokens WHERE user_id = ? AND prefix = ?", (uid, prefix))
    return _token_info(row)


def revoke_tokens(conn: sqlite3.Connection, username: str) -> int:
    """Revoke every token of the user; returns how many there were."""
    cur = conn.execute("DELETE FROM api_tokens WHERE user_id = ?", (_user_id(conn, username),))
    return cur.rowcount


def mint_link(
    conn: sqlite3.Connection,
    config: Config,
    kind: LinkKind,
    username: str,
    *,
    mailed: bool = False,
) -> str:
    """A new invite or reset token. Earlier unused `tracker-admin` links of that kind for the name
    stop working; a mailed reset leaves every other link alone, since anyone can ask for one and
    must not be able to cancel a link already sent.

    A `mailed` reset went to the account's email, so it lasts `mail_reset_minutes` and using it
    confirms the address."""
    # An invite names a new account by its email. A reset names an existing account, which may
    # still have a username from before invites took an email.
    username = normal_email(username) if kind == "invite" else username.strip()
    now = config.clock()
    with transaction(conn):
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if kind == "invite" and existing is not None:
            raise AuthError("exists")
        if kind == "reset" and existing is None:
            raise AuthError("no-user")
        if not mailed:
            conn.execute(
                "DELETE FROM invites"
                " WHERE username = ? AND kind = ? AND used_at IS NULL AND mailed = 0",
                (username, kind),
            )
        token = secrets.token_urlsafe(32)
        if kind == "invite":
            lifetime = config.invite_days * DAY
        else:
            lifetime = config.mail_reset_minutes * 60 if mailed else config.reset_hours * 3600
        conn.execute(
            "INSERT INTO invites"
            " (token_hash, kind, username, user_id, created_at, expires_at, mailed)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                token_hash(token),
                kind,
                username,
                existing["id"] if existing else None,
                now,
                now + lifetime,
                int(mailed),
            ),
        )
    return token


_LIVE_LINK = (
    "SELECT kind, username, user_id, mailed FROM invites"
    " WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?"
)


def link_info(conn: sqlite3.Connection, config: Config, token: str) -> tuple[LinkKind, str] | None:
    row = conn.execute(_LIVE_LINK, (token_hash(token), config.clock())).fetchone()
    return None if row is None else (row["kind"], row["username"])


def redeem(conn: sqlite3.Connection, config: Config, token: str, password: str) -> int:
    """Set the password for an invite or reset link, consuming it; returns the user's id."""
    if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        raise AuthError("password")
    if link_info(conn, config, token) is None:
        raise AuthError("gone")
    password_hash = hash_password(password)
    now = config.clock()
    th = token_hash(token)
    with transaction(conn):
        # Checked again under the write lock: two redemptions of one link must not both succeed.
        row = conn.execute(_LIVE_LINK, (th, now)).fetchone()
        if row is None:
            raise AuthError("gone")
        conn.execute("UPDATE invites SET used_at = ? WHERE token_hash = ?", (now, th))
        if row["kind"] == "invite":
            try:
                cur = conn.execute(
                    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                    (row["username"], password_hash, now),
                )
            except sqlite3.IntegrityError:
                raise AuthError("exists") from None
            return int(cur.lastrowid or 0)
        uid = int(row["user_id"])
        conn.execute(
            "UPDATE users SET password_hash = ?, failed_logins = 0, failed_since = NULL,"
            " locked_until = NULL WHERE id = ?",
            (password_hash, uid),
        )
        if row["mailed"]:
            conn.execute(
                "UPDATE users SET email_confirmed_at = coalesce(email_confirmed_at, ?)"
                " WHERE id = ?",
                (now, uid),
            )
        # A reset is how an owner takes a stolen account back, so it ends every credential.
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        end_credentials(conn, uid)
        return uid


def confirmed(conn: sqlite3.Connection, user_id: int) -> bool | None:
    """Whether the account's email is confirmed; None for an invited account, which has none."""
    row = conn.execute(
        "SELECT username, email_confirmed_at FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if "@" not in row["username"]:
        return None
    return row["email_confirmed_at"] is not None


def mint_confirmation(conn: sqlite3.Connection, config: Config, user_id: int) -> str:
    """A new confirmation token for the user; their earlier unused ones stop working."""
    token = secrets.token_urlsafe(32)
    now = config.clock()
    with transaction(conn):
        conn.execute("DELETE FROM confirmations WHERE user_id = ? AND used_at IS NULL", (user_id,))
        conn.execute(
            "INSERT INTO confirmations (token_hash, user_id, created_at, expires_at)"
            " VALUES (?, ?, ?, ?)",
            (token_hash(token), user_id, now, now + config.confirm_days * DAY),
        )
    return token


def confirm(conn: sqlite3.Connection, config: Config, token: str) -> int:
    """Use a confirmation link: the address is confirmed; returns the user's id, or `gone`."""
    now = config.clock()
    th = token_hash(token)
    with transaction(conn):
        row = conn.execute(
            "SELECT user_id FROM confirmations"
            " WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
            (th, now),
        ).fetchone()
        if row is None:
            raise AuthError("gone")
        conn.execute("UPDATE confirmations SET used_at = ? WHERE token_hash = ?", (now, th))
        conn.execute(
            "UPDATE users SET email_confirmed_at = coalesce(email_confirmed_at, ?) WHERE id = ?",
            (now, row["user_id"]),
        )
        return int(row["user_id"])
