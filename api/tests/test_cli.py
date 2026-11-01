import re
import sqlite3

import pytest

from tracker_api import auth
from tracker_api.cli import main
from tracker_api.config import Config

from .conftest import ORIGIN, Clock

PASSWORD = "correct horse battery"


@pytest.fixture
def env(config: Config) -> dict[str, str]:
    return {"DATA_DIR": str(config.data_dir), "PUBLIC_ORIGIN": ORIGIN}


def run(
    env: dict[str, str], capsys: pytest.CaptureFixture[str], *argv: str
) -> tuple[int, str, str]:
    code = main(list(argv), env, clock=Clock())
    out, err = capsys.readouterr()
    return code, out, err


def link_token(out: str, kind: str) -> str:
    line = next(line for line in out.splitlines() if line.startswith(ORIGIN))
    prefix = f"{ORIGIN}/#/{kind}/"
    assert line.startswith(prefix)
    return line.removeprefix(prefix)


def test_invite_prints_a_link_that_works(
    env: dict[str, str],
    config: Config,
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
) -> None:
    code, out, _ = run(env, capsys, "invite", "alice@example.com")
    assert code == 0
    assert "expires 2026-10-30 08:00 UTC" in out  # 7 days from the pinned clock
    assert auth.link_info(conn, config, link_token(out, "invite")) == (
        "invite",
        "alice@example.com",
    )


def test_reset_disable_enable_and_revoke(
    env: dict[str, str],
    config: Config,
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
) -> None:
    token = auth.mint_link(conn, config, "invite", "alice@example.com")
    uid = auth.redeem(conn, config, token, PASSWORD)
    auth.create_session(conn, config, uid)
    code, out, _ = run(env, capsys, "users")
    assert code == 0
    assert "alice@example.com" in out and "1 session" in out and "active" in out
    code, out, _ = run(env, capsys, "reset", "alice@example.com")
    assert code == 0 and link_token(out, "reset")
    assert (
        run(env, capsys, "revoke-sessions", "alice@example.com")[1].strip()
        == "Ended 1 session and revoked 0 tokens for alice@example.com."
    )
    assert run(env, capsys, "disable", "alice@example.com")[0] == 0
    assert "disabled" in run(env, capsys, "users")[1]
    assert run(env, capsys, "enable", "alice@example.com")[0] == 0
    assert "active" in run(env, capsys, "users")[1]


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["reset", "nobody"], "no user named 'nobody'"),
        (["disable", "nobody"], "no user named 'nobody'"),
        (["invite", "alice"], "invites name an email address, like name@example.com"),
    ],
)
def test_errors_go_to_stderr_with_status_1(
    env: dict[str, str], capsys: pytest.CaptureFixture[str], argv: list[str], message: str
) -> None:
    code, out, err = run(env, capsys, *argv)
    assert (code, out) == (1, "")
    assert message in err


def test_inviting_an_existing_user(
    env: dict[str, str],
    config: Config,
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
) -> None:
    auth.redeem(conn, config, auth.mint_link(conn, config, "invite", "alice@example.com"), PASSWORD)
    code, _, err = run(env, capsys, "invite", "Alice@example.com")
    assert code == 1 and "already exists; use reset" in err


def test_no_users_yet(env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    assert run(env, capsys, "users")[1].strip() == "No users yet."


def test_needs_a_public_origin(capsys: pytest.CaptureFixture[str], config: Config) -> None:
    code, _, err = run({"DATA_DIR": str(config.data_dir)}, capsys, "users")
    assert code == 1 and "PUBLIC_ORIGIN" in err


def test_reset_works_for_a_signed_up_email(
    env: dict[str, str],
    config: Config,
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
) -> None:
    auth.signup(conn, config, "bob@example.com", PASSWORD)
    code, out, _ = run(env, capsys, "reset", "bob@example.com")
    assert code == 0
    assert auth.link_info(conn, config, link_token(out, "reset")) == ("reset", "bob@example.com")


# --- token --------------------------------------------------------------------------------------


def api_token(out: str) -> str:
    """The one line of the output that is a token."""
    (line,) = [line for line in out.splitlines() if re.fullmatch(r"trk_[A-Za-z0-9_-]{43}", line)]
    return line


@pytest.fixture
def alice(config: Config, conn: sqlite3.Connection) -> int:
    return auth.redeem(
        conn, config, auth.mint_link(conn, config, "invite", "alice@example.com"), PASSWORD
    )


def test_token_create_prints_a_working_token_once(
    env: dict[str, str],
    config: Config,
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
    alice: int,
) -> None:
    code, out, err = run(env, capsys, "token", "create", "alice@example.com", "--name", "laptop")
    assert (code, err) == (0, "")
    token = api_token(out)
    assert out.count(token) == 1
    # Shown with `trk_`, so a prefix that starts with `-` still reads as an argument to revoke.
    assert f"prefix {token[:12]}" in out and "read" in out
    assert auth.token_user(conn, config, token) == auth.TokenUser(
        alice, "alice@example.com", "read"
    )
    code, out, _ = run(
        env, capsys, "token", "create", "alice@example.com", "--name", "agent", "--write"
    )
    assert code == 0
    write = auth.token_user(conn, config, api_token(out))
    assert write is not None and write.scope == "write"


def test_token_list_and_users_show_the_tokens(
    env: dict[str, str],
    config: Config,
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
    alice: int,
) -> None:
    assert run(env, capsys, "token", "list", "alice@example.com")[1].strip() == (
        "No tokens for alice@example.com."
    )
    assert "0 tokens" in run(env, capsys, "users")[1]
    token = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    auth.create_token(conn, config, "alice@example.com", "agent", "write")
    auth.token_user(conn, config, token)
    code, out, _ = run(env, capsys, "token", "list", "alice@example.com")
    assert code == 0
    lines = out.splitlines()
    assert len(lines) == 2
    assert lines[0].startswith(token[:12]) and "read" in lines[0] and "laptop" in lines[0]
    assert "created 2026-10-23 08:00 UTC, last used 2026-10-23 08:00 UTC" in lines[0]
    assert "write" in lines[1] and "agent" in lines[1] and "last used never" in lines[1]
    assert token not in out and auth.token_hash(token) not in out
    assert "0 sessions, 2 tokens" in run(env, capsys, "users")[1]


def test_token_revoke_one_or_all(
    env: dict[str, str],
    config: Config,
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
    alice: int,
) -> None:
    one = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    two = auth.create_token(conn, config, "alice@example.com", "agent", "write")
    three = auth.create_token(conn, config, "alice@example.com", "phone", "read")
    code, out, _ = run(env, capsys, "token", "revoke", "alice@example.com", one[:12])
    assert code == 0
    assert out.strip() == f"Revoked the token {one[:12]} (laptop) for alice@example.com."
    assert auth.token_user(conn, config, one) is None
    assert auth.token_user(conn, config, two) is not None
    code, out, _ = run(env, capsys, "token", "revoke", "alice@example.com", "--all")
    assert (code, out.strip()) == (0, "Revoked 2 tokens for alice@example.com.")
    assert (
        auth.token_user(conn, config, two) is None and auth.token_user(conn, config, three) is None
    )


def test_revoke_sessions_ends_tokens_too(
    env: dict[str, str],
    config: Config,
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
    alice: int,
) -> None:
    token = auth.create_token(conn, config, "alice@example.com", "laptop", "read")
    out = run(env, capsys, "revoke-sessions", "alice@example.com")[1]
    assert out.strip() == "Ended 0 sessions and revoked 1 token for alice@example.com."
    assert auth.token_user(conn, config, token) is None


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["token", "list", "nobody"], "no user named 'nobody'"),
        (["token", "create", "nobody", "--name", "x"], "no user named 'nobody'"),
        (["token", "revoke", "nobody", "--all"], "no user named 'nobody'"),
        (
            ["token", "revoke", "alice@example.com", "abcdefgh"],
            "alice@example.com: no token with that prefix",
        ),
        (
            ["token", "create", "alice@example.com", "--name", " "],
            "alice@example.com: a token name is 1 to 64 printable characters",
        ),
    ],
)
def test_token_errors_go_to_stderr_with_status_1(
    env: dict[str, str],
    capsys: pytest.CaptureFixture[str],
    alice: int,
    argv: list[str],
    message: str,
) -> None:
    code, out, err = run(env, capsys, *argv)
    assert (code, out) == (1, "")
    assert message in err


def test_a_disabled_account_gets_no_token(
    env: dict[str, str],
    conn: sqlite3.Connection,
    capsys: pytest.CaptureFixture[str],
    alice: int,
) -> None:
    auth.set_disabled(conn, "alice@example.com", True)
    code, out, err = run(env, capsys, "token", "create", "alice@example.com", "--name", "laptop")
    assert (code, out) == (1, "")
    assert "alice@example.com: is disabled; enable it before minting a token" in err
    assert conn.execute("SELECT count(*) FROM api_tokens").fetchone()[0] == 0


@pytest.mark.parametrize(
    "argv",
    [
        ["token", "revoke", "alice@example.com"],  # neither a prefix nor --all
        ["token", "revoke", "alice@example.com", "abcdefgh", "--all"],  # both
        ["token", "create", "alice@example.com"],  # no --name
    ],
)
def test_token_usage_errors(
    env: dict[str, str], capsys: pytest.CaptureFixture[str], argv: list[str]
) -> None:
    with pytest.raises(SystemExit) as e:
        run(env, capsys, *argv)
    assert e.value.code == 2
