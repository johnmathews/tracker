"""`tracker-admin`: invites, resets and account switches, run in the API container, and demo data
for a local stack (docs/api.md §5)."""

import argparse
import os
import sqlite3
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, datetime

from . import auth, seed
from .config import Config
from .db import connect, migrate

MESSAGES = {
    "email": "invites name an email address, like name@example.com",
    "exists": "already exists; use reset to give them a new password",
    "password": "a password is 10 to 256 characters",
    "closed": "sign-up is closed: MAX_USERS accounts exist",
    "too-many": "too many sign-ups in the last hour; try again later",
}


def _when(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d %H:%M UTC")


def _count(n: int, word: str) -> str:
    """A count with its noun, as in 6 week plans or 1 mark; empty for none, which `_listed`
    leaves out."""
    return f"{n} {word}{'' if n == 1 else 's'}" if n else ""


def _listed(parts: list[str]) -> str:
    """The non-empty parts as a sentence lists them: "a, b and c"."""
    kept = [p for p in parts if p]
    return ", ".join(kept[:-1]) + " and " + kept[-1] if len(kept) > 1 else "".join(kept)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tracker-admin", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name, text in [
        ("invite", "print a single-use sign-up link for a new account's email (valid 7 days)"),
        ("reset", "print a password-reset link for an account (valid 24 hours)"),
        ("disable", "block an account's logins and end its sessions"),
        ("enable", "allow a disabled account to log in again"),
        ("revoke-sessions", "sign an account out everywhere"),
    ]:
        # `username`: the account's name, its email (or, for an account from before invites
        # took an email, the username it was invited with).
        commands.add_parser(name, help=text).add_argument("username", metavar="email")
    commands.add_parser("users", help="list users")
    demo = commands.add_parser(
        "seed-demo",
        help="local stacks only: create a demo account (or fill an existing one) with three"
        " weeks of marks, never overwriting any",
    )
    demo.add_argument("username", metavar="email", nargs="?", default=seed.DEMO_EMAIL)
    demo.add_argument(
        "--password",
        help=f"for a new account only (default {seed.DEMO_PASSWORD!r});"
        " an existing one keeps its own",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    env: Mapping[str, str] = os.environ,
    clock: Callable[[], int] | None = None,
) -> int:
    args = _parser().parse_args(argv)
    try:
        config = Config.from_env(env)
    except ValueError as e:
        print(f"tracker-admin: {e}", file=sys.stderr)
        return 1
    if clock is not None:
        config = replace(config, clock=clock)
    conn = connect(config.db_path)
    try:
        migrate(conn)
        return _run(args, config, conn)
    except seed.NotLocal as e:
        print(f"tracker-admin: {e}", file=sys.stderr)
        return 1
    except auth.AuthError as e:
        name = getattr(args, "username", "")
        text = f"no user named {name!r}" if e.code == "no-user" else f"{name}: {MESSAGES[e.code]}"
        print(f"tracker-admin: {text}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def _run(args: argparse.Namespace, config: Config, conn: sqlite3.Connection) -> int:
    match args.command:
        case "invite" | "reset":
            token = auth.mint_link(conn, config, args.command, args.username)
            lifetime = (
                config.invite_days * auth.DAY
                if args.command == "invite"
                else config.reset_hours * 3600
            )
            print(
                f"{args.command.capitalize()} link for {args.username},"
                f" expires {_when(config.clock() + lifetime)}:"
            )
            print(f"{config.public_origin}/#/{args.command}/{token}")
            print("It works once. Minting another revokes this one.")
        case "disable" | "enable":
            auth.set_disabled(conn, args.username, args.command == "disable")
            print(
                f"{args.username} is now {'disabled' if args.command == 'disable' else 'enabled'}."
            )
        case "seed-demo":
            result = seed.seed(conn, config, args.username, args.password)
            if result["created"]:
                password = args.password or seed.DEMO_PASSWORD
                print(f"Created {args.username} with the password {password!r}.")
            else:
                print(f"{args.username} already exists; its password is unchanged.")
            added = _listed(
                [
                    _count(result["weeks"], "week plan"),
                    _count(result["ticks"], "mark"),
                    f"details for {_count(result['details'], 'item')}" if result["details"] else "",
                ]
            )
            if added:
                print(f"Added {added}.")
            else:
                print("Nothing to add: the demo weeks are already there.")
            print(f"Sign in at {config.public_origin}/")
        case "revoke-sessions":
            n = auth.revoke_sessions(conn, args.username)
            print(f"Ended {n} session{'' if n == 1 else 's'} for {args.username}.")
        case _:  # users
            rows = conn.execute(
                "SELECT u.username, u.created_at, u.disabled,"
                " (SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS sessions"
                " FROM users u ORDER BY u.username"
            ).fetchall()
            if not rows:
                print("No users yet.")
            for r in rows:
                state = "disabled" if r["disabled"] else "active"
                n = r["sessions"]
                print(
                    f"{r['username']:<32} {state:<8} since {_when(r['created_at'])},"
                    f" {n} session{'' if n == 1 else 's'}"
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
