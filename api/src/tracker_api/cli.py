"""`tracker-admin`: invites, resets, account switches and API tokens, run in the API container, and
demo data for a local stack (docs/api.md §5)."""

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
    "token-name": "a token name is 1 to 64 printable characters",
    "disabled": "is disabled; enable it before minting a token",
    "no-token": "no token with that prefix; `tracker-admin token list <email>` shows them",
}


def _when(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d %H:%M UTC")


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _shown(prefix: str) -> str:
    """A prefix as the CLI shows it: with `trk_`, so it never starts with `-`."""
    return auth.TOKEN_PREFIX + prefix


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tracker-admin", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name, text in [
        ("invite", "print a single-use sign-up link for a new account's email (valid 7 days)"),
        ("reset", "print a password-reset link for an account (valid 24 hours)"),
        ("disable", "block an account's logins and end its sessions and API tokens"),
        ("enable", "allow a disabled account to log in again"),
        ("revoke-sessions", "sign an account out everywhere and revoke its API tokens"),
    ]:
        # `username`: the account's name, its email (or, for an account from before invites
        # took an email, the username it was invited with).
        commands.add_parser(name, help=text).add_argument("username", metavar="email")
    commands.add_parser("users", help="list users")
    token = commands.add_parser("token", help="personal API tokens, for the MCP endpoint")
    tokens = token.add_subparsers(dest="token_command", required=True)
    create = tokens.add_parser("create", help="mint a token and print it, this once only")
    create.add_argument("username", metavar="email")
    create.add_argument("--name", required=True, help="what the token is for, e.g. the client")
    create.add_argument(
        "--write", action="store_true", help="let it edit plans and marks too (default: read)"
    )
    tokens.add_parser("list", help="an account's tokens, never the tokens themselves").add_argument(
        "username", metavar="email"
    )
    revoke = tokens.add_parser("revoke", help="revoke one token by its prefix, or --all")
    revoke.add_argument("username", metavar="email")
    which = revoke.add_mutually_exclusive_group(required=True)
    which.add_argument("prefix", nargs="?", help="as `token list` shows it, e.g. trk_AbCd1234")
    which.add_argument("--all", action="store_true", help="every token of the account")
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
            if result["weeks"] or result["ticks"]:
                print(f"Added {result['weeks']} week plans and {result['ticks']} marks.")
            else:
                print("Nothing to add: the demo weeks are already there.")
            print(f"Sign in at {config.public_origin}/")
        case "revoke-sessions":
            sessions, tokens = auth.revoke_sessions(conn, args.username)
            print(
                f"Ended {_plural(sessions, 'session')} and revoked {_plural(tokens, 'token')}"
                f" for {args.username}."
            )
        case "token":
            _token(args, config, conn)
        case _:  # users
            rows = conn.execute(
                "SELECT u.username, u.created_at, u.disabled,"
                " (SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,"
                " (SELECT count(*) FROM api_tokens t WHERE t.user_id = u.id) AS tokens"
                " FROM users u ORDER BY u.username"
            ).fetchall()
            if not rows:
                print("No users yet.")
            for r in rows:
                state = "disabled" if r["disabled"] else "active"
                print(
                    f"{r['username']:<32} {state:<8} since {_when(r['created_at'])},"
                    f" {_plural(r['sessions'], 'session')}, {_plural(r['tokens'], 'token')}"
                )
    return 0


def _token(args: argparse.Namespace, config: Config, conn: sqlite3.Connection) -> None:
    # The token itself is printed once, by `create`, to this process's output and nowhere else:
    # never to a log (docs/api.md §4).
    match args.token_command:
        case "create":
            scope: auth.TokenScope = "write" if args.write else "read"
            token = auth.create_token(conn, config, args.username, args.name, scope)
            prefix = _shown(token[len(auth.TOKEN_PREFIX) :][: auth.PREFIX_CHARS])
            print(f"A {scope} token for {args.username}, prefix {prefix}:")
            print(token)
            print("It is shown only this once. Send it as Authorization: Bearer <token>.")
        case "list":
            infos = auth.list_tokens(conn, args.username)
            if not infos:
                print(f"No tokens for {args.username}.")
            for t in infos:
                used = "never" if t.last_used_at is None else _when(t.last_used_at)
                print(
                    f"{_shown(t.prefix)}  {t.scope:<5}  {t.name}"
                    f"  (created {_when(t.created_at)}, last used {used})"
                )
        case _:  # revoke
            if args.all:
                n = auth.revoke_tokens(conn, args.username)
                print(f"Revoked {_plural(n, 'token')} for {args.username}.")
            else:
                info = auth.revoke_token(conn, args.username, args.prefix)
                print(f"Revoked the token {_shown(info.prefix)} ({info.name}) for {args.username}.")


if __name__ == "__main__":
    raise SystemExit(main())
