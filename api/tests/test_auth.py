import re
import sqlite3
import threading
import time
from dataclasses import fields, replace
from typing import Any

import pytest
from argon2 import PasswordHasher, profiles

from tracker_api import auth
from tracker_api.auth import AuthError
from tracker_api.config import Config
from tracker_api.db import connect

from .conftest import Clock

PASSWORD = "correct horse battery"
DAY = 86_400


def make_user(conn: sqlite3.Connection, config: Config, name: str = "alice@example.com") -> int:
    token = auth.mint_link(conn, config, "invite", name)
    return auth.redeem(conn, config, token, PASSWORD)


def test_production_hasher_uses_argon2_cffi_defaults() -> None:
    # The conftest swaps in a cheap hasher; the module's own default must be the RFC 9106 profile.
    fresh = PasswordHasher()
    assert fresh.memory_cost == profiles.RFC_9106_LOW_MEMORY.memory_cost == 65536
    assert auth.DEFAULT_HASHER.memory_cost == fresh.memory_cost
    assert auth.DEFAULT_HASHER.time_cost == fresh.time_cost


def test_hashing_runs_one_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    running = 0
    peak = 0
    lock = threading.Lock()

    class Slow:
        def hash(self, password: str) -> str:
            nonlocal running, peak
            with lock:
                running += 1
                peak = max(peak, running)
            time.sleep(0.02)
            with lock:
                running -= 1
            return "h"

    monkeypatch.setattr(auth, "HASHER", Slow())
    threads = [threading.Thread(target=auth.hash_password, args=("pw",)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak == 1


def test_invite_then_login(conn: sqlite3.Connection, config: Config) -> None:
    uid = make_user(conn, config)
    assert auth.login(conn, config, "alice@example.com", PASSWORD) == uid
    assert auth.login(conn, config, "ALICE@example.com", PASSWORD) == uid  # usernames ignore case


@pytest.mark.parametrize(
    ("name", "password"), [("alice@example.com", "wrong password!"), ("nobody", PASSWORD)]
)
def test_wrong_password_and_unknown_user_look_the_same(
    conn: sqlite3.Connection,
    config: Config,
    name: str,
    password: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    make_user(conn, config)
    verified: list[str] = []
    real = auth.verify_password

    def counting(password_hash: str, password: str) -> bool:
        verified.append(password_hash)
        return real(password_hash, password)

    monkeypatch.setattr(auth, "verify_password", counting)
    with pytest.raises(AuthError) as e:
        auth.login(conn, config, name, password)
    assert e.value.code == "invalid"
    assert len(verified) == 1  # an unknown user still costs one hash


def test_five_failures_lock_the_account_for_fifteen_minutes(
    conn: sqlite3.Connection, config: Config, clock: Clock
) -> None:
    make_user(conn, config)
    for _ in range(5):
        with pytest.raises(AuthError, match="invalid"):
            auth.login(conn, config, "alice@example.com", "wrong password!")
    with pytest.raises(AuthError) as e:
        auth.login(conn, config, "alice@example.com", PASSWORD)  # right password, still locked
    assert e.value.code == "locked"
    assert e.value.retry_after == 15 * 60
    clock.advance(15 * 60)
    assert auth.login(conn, config, "alice@example.com", PASSWORD)


def test_failures_older_than_the_window_do_not_count(
    conn: sqlite3.Connection, config: Config, clock: Clock
) -> None:
    make_user(conn, config)
    for _ in range(4):
        with pytest.raises(AuthError):
            auth.login(conn, config, "alice@example.com", "wrong password!")
    clock.advance(15 * 60 + 1)
    with pytest.raises(AuthError, match="invalid"):
        auth.login(conn, config, "alice@example.com", "wrong password!")
    assert auth.login(conn, config, "alice@example.com", PASSWORD)


def test_success_resets_the_failure_count(conn: sqlite3.Connection, config: Config) -> None:
    make_user(conn, config)
    for _ in range(4):
        with pytest.raises(AuthError):
            auth.login(conn, config, "alice@example.com", "wrong password!")
    auth.login(conn, config, "alice@example.com", PASSWORD)
    for _ in range(4):
        with pytest.raises(AuthError, match="invalid"):
            auth.login(conn, config, "alice@example.com", "wrong password!")
    assert auth.login(conn, config, "alice@example.com", PASSWORD)


def test_a_disabled_user_cannot_log_in_and_loses_sessions(
    conn: sqlite3.Connection, config: Config
) -> None:
    uid = make_user(conn, config)
    token = auth.create_session(conn, config, uid)
    auth.set_disabled(conn, "alice@example.com", True)
    assert auth.session_user(conn, config, token) is None
    with pytest.raises(AuthError, match="invalid"):
        auth.login(conn, config, "alice@example.com", PASSWORD)
    auth.set_disabled(conn, "alice@example.com", False)
    assert auth.login(conn, config, "alice@example.com", PASSWORD) == uid


def test_sessions_slide_and_expire(conn: sqlite3.Connection, config: Config, clock: Clock) -> None:
    uid = make_user(conn, config)
    token = auth.create_session(conn, config, uid)
    user = auth.session_user(conn, config, token)
    assert user is not None and (user.id, user.username, user.refreshed) == (
        uid,
        "alice@example.com",
        False,
    )
    clock.advance(DAY + 1)
    user = auth.session_user(conn, config, token)
    assert user is not None and user.refreshed  # more than a day since the last refresh
    clock.advance(89 * DAY)
    assert (
        auth.session_user(conn, config, token) is not None
    )  # 90 days from the refresh, not the start
    clock.advance(90 * DAY)
    assert auth.session_user(conn, config, token) is None
    assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0


def test_sessions_are_stored_hashed(conn: sqlite3.Connection, config: Config) -> None:
    uid = make_user(conn, config)
    token = auth.create_session(conn, config, uid)
    stored = [r[0] for r in conn.execute("SELECT token_hash FROM sessions")]
    assert token not in stored and stored == [auth.token_hash(token)]
    assert auth.session_user(conn, config, "not-a-token") is None


def test_ending_sessions(conn: sqlite3.Connection, config: Config) -> None:
    uid = make_user(conn, config)
    a, b = auth.create_session(conn, config, uid), auth.create_session(conn, config, uid)
    auth.end_session(conn, a)
    assert auth.session_user(conn, config, a) is None
    assert auth.session_user(conn, config, b) is not None
    # (sessions, tokens, connections)
    assert auth.revoke_sessions(conn, "alice@example.com") == (1, 0, 0)
    assert auth.session_user(conn, config, b) is None


def test_invite_links_are_single_use_and_expire(
    conn: sqlite3.Connection, config: Config, clock: Clock
) -> None:
    token = auth.mint_link(conn, config, "invite", "bob@example.com")
    assert auth.link_info(conn, config, token) == ("invite", "bob@example.com")
    auth.redeem(conn, config, token, PASSWORD)
    assert auth.link_info(conn, config, token) is None
    with pytest.raises(AuthError, match="gone"):
        auth.redeem(conn, config, token, PASSWORD)
    late = auth.mint_link(conn, config, "invite", "carol@example.com")
    clock.advance(7 * DAY)
    assert auth.link_info(conn, config, late) is None
    with pytest.raises(AuthError, match="gone"):
        auth.redeem(conn, config, late, PASSWORD)


def test_a_new_link_revokes_the_earlier_one(conn: sqlite3.Connection, config: Config) -> None:
    first = auth.mint_link(conn, config, "invite", "bob@example.com")
    second = auth.mint_link(conn, config, "invite", "Bob@example.com")
    assert auth.link_info(conn, config, first) is None
    assert auth.link_info(conn, config, second) == ("invite", "bob@example.com")


def test_cannot_invite_an_existing_user_or_reset_a_missing_one(
    conn: sqlite3.Connection, config: Config
) -> None:
    make_user(conn, config)
    with pytest.raises(AuthError, match="exists"):
        auth.mint_link(conn, config, "invite", "Alice@example.com")
    with pytest.raises(AuthError, match="no-user"):
        auth.mint_link(conn, config, "reset", "nobody")


@pytest.mark.parametrize(
    "name", ["", "alice", "a b@example.com", "ál@example.com", "x" * 243 + "@example.com"]
)
def test_invites_name_an_email(conn: sqlite3.Connection, config: Config, name: str) -> None:
    with pytest.raises(AuthError, match="email"):
        auth.mint_link(conn, config, "invite", name)


def test_an_invite_is_for_the_email_trimmed_and_lower_cased(
    conn: sqlite3.Connection, config: Config
) -> None:
    token = auth.mint_link(conn, config, "invite", " Dana@Example.COM ")
    assert auth.link_info(conn, config, token) == ("invite", "dana@example.com")
    assert auth.redeem(conn, config, token, PASSWORD)
    assert auth.login(conn, config, "dana@example.com", PASSWORD)


def test_a_legacy_username_account_still_signs_in(conn: sqlite3.Connection, config: Config) -> None:
    """Accounts invited before invites took an email keep their name and their sign-in."""
    conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES ('john', ?, 0)",
        (auth.hash_password(PASSWORD),),
    )
    assert auth.login(conn, config, "john", PASSWORD)
    assert auth.link_info(conn, config, auth.mint_link(conn, config, "reset", "john"))


def test_reset_sets_the_password_ends_sessions_and_unlocks(
    conn: sqlite3.Connection, config: Config, clock: Clock
) -> None:
    uid = make_user(conn, config)
    session = auth.create_session(conn, config, uid)
    for _ in range(5):
        with pytest.raises(AuthError):
            auth.login(conn, config, "alice@example.com", "wrong password!")
    token = auth.mint_link(conn, config, "reset", "alice@example.com")
    assert auth.link_info(conn, config, token) == ("reset", "alice@example.com")
    assert auth.redeem(conn, config, token, "a brand new password") == uid
    assert auth.session_user(conn, config, session) is None
    assert auth.login(conn, config, "alice@example.com", "a brand new password") == uid
    with pytest.raises(AuthError, match="invalid"):
        auth.login(conn, config, "alice@example.com", PASSWORD)


def test_reset_links_last_a_day(conn: sqlite3.Connection, config: Config, clock: Clock) -> None:
    make_user(conn, config)
    token = auth.mint_link(conn, config, "reset", "alice@example.com")
    clock.advance(DAY - 1)
    assert auth.link_info(conn, config, token) is not None
    clock.advance(1)
    assert auth.link_info(conn, config, token) is None


@pytest.mark.parametrize("password", ["short", "x" * 9, "x" * 257])
def test_passwords_are_10_to_256_characters(
    conn: sqlite3.Connection, config: Config, password: str
) -> None:
    token = auth.mint_link(conn, config, "invite", "bob@example.com")
    with pytest.raises(AuthError, match="password"):
        auth.redeem(conn, config, token, password)
    assert auth.link_info(conn, config, token) is not None  # a rejected password keeps the link


def test_a_name_taken_after_the_invite_was_minted(conn: sqlite3.Connection, config: Config) -> None:
    token = auth.mint_link(conn, config, "invite", "bob@example.com")
    conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES ('BOB@example.com', 'h', 0)"
    )
    with pytest.raises(AuthError, match="exists"):
        auth.redeem(conn, config, token, PASSWORD)
    assert auth.link_info(conn, config, token) is not None  # rolled back, link still live


def test_two_redemptions_race_and_only_one_wins(conn: sqlite3.Connection, config: Config) -> None:
    token = auth.mint_link(conn, config, "invite", "bob@example.com")
    second = connect(config.db_path)
    results: list[Any] = []
    barrier = threading.Barrier(2)

    def go(c: sqlite3.Connection) -> None:
        barrier.wait()
        try:
            results.append(auth.redeem(c, config, token, PASSWORD))
        except AuthError as e:
            results.append(e.code)

    threads = [threading.Thread(target=go, args=(c,)) for c in (conn, second)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    second.close()
    assert sorted(map(str, results))[1] == "gone"
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 1


def test_a_lock_set_while_hashing_wins_over_a_correct_password(
    conn: sqlite3.Connection, config: Config, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Requests already waiting for the hasher when a lock lands must not slip past or clear it."""
    make_user(conn, config)
    real = auth.verify_password

    def lock_meanwhile(password_hash: str, password: str) -> bool:
        conn.execute("UPDATE users SET locked_until = ?", (clock() + 900,))
        return real(password_hash, password)

    monkeypatch.setattr(auth, "verify_password", lock_meanwhile)
    with pytest.raises(AuthError) as e:
        auth.login(conn, config, "alice@example.com", PASSWORD)
    assert e.value.code == "locked"
    with pytest.raises(AuthError, match="locked"):
        auth.login(conn, config, "alice@example.com", "wrong password!")
    # Neither attempt cleared the lock or counted towards a new one.
    row = conn.execute("SELECT failed_logins, locked_until FROM users").fetchone()
    assert (row[0], row[1]) == (0, clock() + 900)


def test_logins_beyond_the_queue_are_turned_away(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "_WAITING", threading.BoundedSemaphore(1))
    assert auth._WAITING.acquire(blocking=False)
    try:
        with pytest.raises(AuthError) as e:
            auth.hash_password("pw")
        assert (e.value.code, e.value.retry_after) == ("busy", 1)
    finally:
        auth._WAITING.release()


def test_a_login_that_waits_too_long_for_the_hasher_is_turned_away(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth, "HASH_WAIT", 0.01)
    monkeypatch.setattr(auth, "_HASHING", threading.Semaphore(0))  # someone else is hashing
    with pytest.raises(AuthError, match="busy"):
        auth.verify_password("h", "pw")
    assert auth._WAITING.acquire(blocking=False)  # the queue slot was given back
    auth._WAITING.release()


# --- sign-up ------------------------------------------------------------------------------------


def test_signup_stores_the_email_lower_cased_and_signs_in_by_it(
    conn: sqlite3.Connection, config: Config
) -> None:
    uid = auth.signup(conn, config, "  Bob@Example.COM ", PASSWORD)
    row = conn.execute("SELECT username FROM users WHERE id = ?", (uid,)).fetchone()
    assert row["username"] == "bob@example.com"
    assert auth.login(conn, config, "bob@example.com", PASSWORD) == uid
    assert auth.login(conn, config, "BOB@example.com", PASSWORD) == uid


@pytest.mark.parametrize(
    "email",
    [
        "",
        "bob",
        "bob@",
        "@example.com",
        "bob@example",
        "bob@.com",
        "bob@example..com",
        "b ob@example.com",
        "bob@exa_mple.com",
        "a@b@example.com",
        "jö@example.com",  # Latin-1: a header could carry it, but the rule is ASCII
        "用户@example.com",  # beyond Latin-1: fetch cannot send it in X-Expected-User
        "a" * 243 + "@example.com",  # 255 characters
    ],
)
def test_signup_refuses_what_is_not_an_ascii_email(
    conn: sqlite3.Connection, config: Config, email: str
) -> None:
    with pytest.raises(AuthError) as e:
        auth.signup(conn, config, email, PASSWORD)
    assert e.value.code == "email"


def test_signup_accepts_a_254_character_email(conn: sqlite3.Connection, config: Config) -> None:
    email = "a" * 242 + "@example.com"
    assert len(email) == 254
    auth.signup(conn, config, email, PASSWORD)


@pytest.mark.parametrize("password", ["x" * 9, "x" * 257])
def test_signup_password_length(conn: sqlite3.Connection, config: Config, password: str) -> None:
    with pytest.raises(AuthError) as e:
        auth.signup(conn, config, "bob@example.com", password)
    assert e.value.code == "password"


def test_signup_refuses_a_taken_email_in_any_case(conn: sqlite3.Connection, config: Config) -> None:
    auth.signup(conn, config, "bob@example.com", PASSWORD)
    with pytest.raises(AuthError) as e:
        auth.signup(conn, config, "Bob@Example.com", PASSWORD)
    assert e.value.code == "exists"


@pytest.mark.parametrize("max_users", [0, 1])
def test_signup_closes_at_max_users_counting_invited_accounts(
    conn: sqlite3.Connection, config: Config, max_users: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = replace(config, max_users=max_users)
    if max_users:
        make_user(conn, config)  # an invited account takes the one place
    hashed: list[str] = []

    def counting(password: str) -> str:
        hashed.append(password)
        return "h"

    monkeypatch.setattr(auth, "hash_password", counting)
    with pytest.raises(AuthError) as e:
        auth.signup(conn, config, "bob@example.com", PASSWORD)
    assert e.value.code == "closed"
    assert hashed == []  # refused before paying for a hash


def test_signup_allows_ten_an_hour(conn: sqlite3.Connection, config: Config, clock: Clock) -> None:
    for i in range(10):
        auth.signup(conn, config, f"u{i}@example.com", PASSWORD)
        clock.advance(60)
    with pytest.raises(AuthError) as e:
        auth.signup(conn, config, "late@example.com", PASSWORD)
    assert e.value.code == "too-many"
    assert e.value.retry_after == 3600 - 600  # until the first of the ten leaves the hour
    clock.advance(3600 - 600)
    auth.signup(conn, config, "late@example.com", PASSWORD)


def test_invited_accounts_do_not_count_towards_the_hourly_limit(
    conn: sqlite3.Connection, config: Config
) -> None:
    for i in range(10):
        make_user(conn, config, f"friend{i}@example.com")
    auth.signup(conn, config, "bob@example.com", PASSWORD)


def test_parallel_signups_cannot_pass_the_cap(conn: sqlite3.Connection, config: Config) -> None:
    config = replace(config, max_users=1)
    second = connect(config.db_path)
    results: list[Any] = []
    barrier = threading.Barrier(2)

    def go(c: sqlite3.Connection, email: str) -> None:
        barrier.wait()
        try:
            results.append(auth.signup(c, config, email, PASSWORD))
        except AuthError as e:
            results.append(e.code)

    threads = [
        threading.Thread(target=go, args=(c, e))
        for c, e in ((conn, "a@example.com"), (second, "b@example.com"))
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    second.close()
    assert sorted(map(str, results))[1] == "closed"
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 1


def test_parallel_signups_for_one_email_make_one_account(
    conn: sqlite3.Connection, config: Config
) -> None:
    second = connect(config.db_path)
    results: list[Any] = []
    barrier = threading.Barrier(2)

    def go(c: sqlite3.Connection) -> None:
        barrier.wait()
        try:
            results.append(auth.signup(c, config, "bob@example.com", PASSWORD))
        except AuthError as e:
            results.append(e.code)

    threads = [threading.Thread(target=go, args=(c,)) for c in (conn, second)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    second.close()
    assert sorted(map(str, results))[1] == "exists"
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 1


def test_a_signed_up_account_can_be_reset_but_not_invited(
    conn: sqlite3.Connection, config: Config
) -> None:
    auth.signup(conn, config, "bob@example.com", PASSWORD)
    token = auth.mint_link(conn, config, "reset", "bob@example.com")
    assert auth.link_info(conn, config, token) == ("reset", "bob@example.com")
    with pytest.raises(AuthError) as e:
        auth.mint_link(conn, config, "invite", "BOB@example.com")
    assert e.value.code == "exists"


# --- API tokens ---------------------------------------------------------------------------------

TOKEN_RE = re.compile(r"trk_[A-Za-z0-9_-]{43}")


def _token_rows(conn: sqlite3.Connection, uid: int) -> int:
    return int(
        conn.execute("SELECT count(*) FROM api_tokens WHERE user_id = ?", (uid,)).fetchone()[0]
    )


def test_a_token_names_its_user_and_scope(conn: sqlite3.Connection, config: Config) -> None:
    uid = make_user(conn, config)
    read = auth.create_token(conn, config, "Alice@example.com", "laptop", "read")
    write = auth.create_token(conn, config, "alice@example.com", "agent", "write")
    assert TOKEN_RE.fullmatch(read) and TOKEN_RE.fullmatch(write) and read != write
    assert auth.token_user(conn, config, read) == auth.TokenUser(uid, "alice@example.com", "read")
    assert auth.token_user(conn, config, write) == auth.TokenUser(uid, "alice@example.com", "write")


def test_a_session_token_is_not_an_api_token(conn: sqlite3.Connection, config: Config) -> None:
    uid = make_user(conn, config)
    token = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    session = auth.create_session(conn, config, uid)
    assert auth.token_user(conn, config, session) is None
    assert auth.session_user(conn, config, token) is None


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "trk_",
        "not-a-token",
        "trk_" + "a" * 43,  # well formed, but nobody's
        "trk_" + "é" * 43,
        "trk_" + "\ud800" * 43,  # a lone surrogate cannot even be encoded
        "Bearer trk_" + "a" * 43,
        "x" * 100_000,
        None,
        43,
    ],
)
def test_a_bad_token_finds_nobody_and_never_raises(
    conn: sqlite3.Connection, config: Config, bad: Any
) -> None:
    make_user(conn, config)
    auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    assert auth.token_user(conn, config, bad) is None


def test_a_changed_token_finds_nobody(conn: sqlite3.Connection, config: Config) -> None:
    make_user(conn, config)
    token = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    flipped = token[:-1] + ("A" if token[-1] != "A" else "B")
    assert auth.token_user(conn, config, flipped) is None
    assert auth.token_user(conn, config, token + "x") is None
    assert auth.token_user(conn, config, token[:-1]) is None


def test_the_database_holds_no_plaintext_token(conn: sqlite3.Connection, config: Config) -> None:
    make_user(conn, config)
    token = auth.create_token(conn, config, "alice@example.com", "laptop", "write")
    auth.token_user(conn, config, token)
    secret = token.removeprefix("trk_")[8:]  # all but the stored prefix
    dump = "\n".join(conn.iterdump())
    assert token not in dump and secret not in dump
    row = conn.execute("SELECT token_hash, prefix FROM api_tokens").fetchone()
    assert (row["token_hash"], row["prefix"]) == (auth.token_hash(token), token[4:12])


def test_a_disabled_account_s_tokens_stop_working(conn: sqlite3.Connection, config: Config) -> None:
    uid = make_user(conn, config)
    token = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    # Set the flag alone, as a row edited by hand would: the lookup itself must refuse.
    conn.execute("UPDATE users SET disabled = 1 WHERE id = ?", (uid,))
    assert auth.token_user(conn, config, token) is None
    with pytest.raises(AuthError, match="disabled"):
        auth.create_token(conn, config, "alice@example.com", "another", "read")
    conn.execute("UPDATE users SET disabled = 0 WHERE id = ?", (uid,))
    assert auth.token_user(conn, config, token) is not None


def _reset(conn: sqlite3.Connection, config: Config) -> None:
    link = auth.mint_link(conn, config, "reset", "alice@example.com")
    auth.redeem(conn, config, link, "a brand new password")


def _mailed_reset(conn: sqlite3.Connection, config: Config) -> None:
    link = auth.mint_link(conn, config, "reset", "alice@example.com", mailed=True)
    auth.redeem(conn, config, link, "a brand new password")


def _disable(conn: sqlite3.Connection, config: Config) -> None:
    auth.set_disabled(conn, "alice@example.com", True)
    auth.set_disabled(conn, "alice@example.com", False)  # enabling again brings nothing back


def _revoke_sessions(conn: sqlite3.Connection, config: Config) -> None:
    assert auth.revoke_sessions(conn, "alice@example.com") == (1, 2, 0)


@pytest.mark.parametrize("action", [_reset, _mailed_reset, _disable, _revoke_sessions])
def test_a_reset_disable_or_revoke_sessions_kills_tokens_minted_before(
    conn: sqlite3.Connection, config: Config, action: Any
) -> None:
    uid = make_user(conn, config)
    other = make_user(conn, config, "bob@example.com")
    auth.create_session(conn, config, uid)
    tokens = [
        auth.create_token(conn, config, "alice@example.com", "laptop", "read"),
        auth.create_token(conn, config, "alice@example.com", "agent", "write"),
    ]
    bobs = auth.create_token(conn, config, "bob@example.com", "laptop", "write")
    assert all(auth.token_user(conn, config, t) is not None for t in tokens)
    action(conn, config)
    assert [auth.token_user(conn, config, t) for t in tokens] == [None, None]
    assert _token_rows(conn, uid) == 0
    # Someone else's tokens are not touched.
    assert auth.token_user(conn, config, bobs) == auth.TokenUser(other, "bob@example.com", "write")


def test_last_used_moves_at_most_once_a_day(
    conn: sqlite3.Connection, config: Config, clock: Clock
) -> None:
    make_user(conn, config)
    token = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    created = clock()

    def last_used() -> int | None:
        return auth.list_tokens(conn, "alice@example.com")[0].last_used_at

    assert last_used() is None
    clock.advance(60)
    auth.token_user(conn, config, token)
    assert last_used() == created + 60  # the first use is always written
    clock.advance(DAY)
    auth.token_user(conn, config, token)
    assert last_used() == created + 60  # exactly a day later: not yet
    clock.advance(1)
    auth.token_user(conn, config, token)
    assert last_used() == created + 60 + DAY + 1


def test_listing_tokens_shows_no_hash(
    conn: sqlite3.Connection, config: Config, clock: Clock
) -> None:
    make_user(conn, config)
    make_user(conn, config, "bob@example.com")
    assert auth.list_tokens(conn, "alice@example.com") == []
    first = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    clock.advance(1)
    second = auth.create_token(conn, config, "alice@example.com", "agent", "write")
    auth.create_token(conn, config, "bob@example.com", "bob's", "read")
    listed = auth.list_tokens(conn, "Alice@example.com")
    assert listed == [
        auth.TokenInfo("laptop", first[4:12], "read", clock() - 1, None),
        auth.TokenInfo("agent", second[4:12], "write", clock(), None),
    ]
    assert "token_hash" not in {f.name for f in fields(auth.TokenInfo)}
    with pytest.raises(AuthError, match="no-user"):
        auth.list_tokens(conn, "nobody")


def test_revoking_one_token_by_its_prefix(conn: sqlite3.Connection, config: Config) -> None:
    make_user(conn, config)
    make_user(conn, config, "bob@example.com")
    keep = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    drop = auth.create_token(conn, config, "alice@example.com", "agent", "write")
    bobs = auth.create_token(conn, config, "bob@example.com", "laptop", "read")
    # Another account's prefix, a part of one, the whole token and nothing name none of hers.
    for wrong in (bobs[4:12], drop[4:10], drop, ""):
        with pytest.raises(AuthError, match="no-token"):
            auth.revoke_token(conn, "alice@example.com", wrong)
    revoked = auth.revoke_token(conn, "alice@example.com", drop[4:12])
    assert (revoked.name, revoked.prefix, revoked.scope) == ("agent", drop[4:12], "write")
    assert auth.token_user(conn, config, drop) is None
    assert auth.token_user(conn, config, keep) is not None
    assert auth.token_user(conn, config, bobs) is not None
    # The prefix with `trk_` in front works too.
    auth.revoke_token(conn, "alice@example.com", keep[:12])
    assert auth.token_user(conn, config, keep) is None
    with pytest.raises(AuthError, match="no-user"):
        auth.revoke_token(conn, "nobody", "abcdefgh")


def test_revoking_every_token(conn: sqlite3.Connection, config: Config) -> None:
    uid = make_user(conn, config)
    session = auth.create_session(conn, config, uid)
    for name in ("a", "b", "c"):
        auth.create_token(conn, config, "alice@example.com", name, "read")
    assert auth.revoke_tokens(conn, "alice@example.com") == 3
    assert auth.revoke_tokens(conn, "alice@example.com") == 0
    assert _token_rows(conn, uid) == 0
    assert auth.session_user(conn, config, session) is not None  # sessions are left alone
    with pytest.raises(AuthError, match="no-user"):
        auth.revoke_tokens(conn, "nobody")


def test_a_prefix_the_account_already_has_is_drawn_again(
    conn: sqlite3.Connection, config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    make_user(conn, config)
    draws = iter(["a" * 8 + "x" * 35, "a" * 8 + "y" * 35, "b" * 8 + "z" * 35])
    monkeypatch.setattr("tracker_api.auth.secrets.token_urlsafe", lambda n: next(draws))
    first = auth.create_token(conn, config, "alice@example.com", "one", "read")
    second = auth.create_token(conn, config, "alice@example.com", "two", "read")
    # The second draw had the first's prefix, so it was drawn again: a prefix names one token.
    assert (first, second) == ("trk_" + "a" * 8 + "x" * 35, "trk_" + "b" * 8 + "z" * 35)
    assert [t.prefix for t in auth.list_tokens(conn, "alice@example.com")] == ["a" * 8, "b" * 8]


@pytest.mark.parametrize("name", ["", "   ", "x" * 65, "two\nlines", "bell\a"])
def test_a_token_name_is_1_to_64_printable_characters(
    conn: sqlite3.Connection, config: Config, name: str
) -> None:
    make_user(conn, config)
    with pytest.raises(AuthError, match="token-name"):
        auth.create_token(conn, config, "alice@example.com", name, "read")


def test_a_token_name_is_trimmed_and_needs_an_account(
    conn: sqlite3.Connection, config: Config
) -> None:
    make_user(conn, config)
    auth.create_token(conn, config, "alice@example.com", "  " + "x" * 64 + " ", "read")
    assert auth.list_tokens(conn, "alice@example.com")[0].name == "x" * 64
    with pytest.raises(AuthError, match="no-user"):
        auth.create_token(conn, config, "nobody", "laptop", "read")
