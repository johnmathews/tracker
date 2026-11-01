"""Shared fixtures: a config on a temp dir, a controllable clock, a cheap password hasher, and a
mailer that records instead of sending."""

import logging
from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from tracker_api import auth
from tracker_api.app import create_app
from tracker_api.config import Config
from tracker_api.db import connect, migrate
from tracker_api.mail import MailError, Message

ORIGIN = "https://testserver"
START = 1_792_742_400  # 2026-10-23 08:00 UTC


@dataclass
class Clock:
    now: int = START

    def __call__(self) -> int:
        return self.now

    def advance(self, seconds: int) -> None:
        self.now += seconds


@pytest.fixture(autouse=True)
def fast_hasher(monkeypatch: pytest.MonkeyPatch) -> None:
    """argon2 at its 64 MiB defaults takes tenths of a second per hash; tests need many."""
    monkeypatch.setattr(auth, "HASHER", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))


@pytest.fixture(autouse=True)
def api_logger() -> Iterator[logging.Logger]:
    """The package logger, put back as it was: `create_app_from_env` gives it a handler."""
    log = logging.getLogger("tracker_api")
    handlers, level = list(log.handlers), log.level
    yield log
    log.handlers[:] = handlers
    log.setLevel(level)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def config(tmp_path: Path, clock: Clock) -> Config:
    return Config(data_dir=tmp_path, public_origin=ORIGIN, clock=clock)


@pytest.fixture
def conn(config: Config) -> Iterator[object]:
    c = connect(config.db_path)
    migrate(c)
    yield c
    c.close()


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    app = create_app(config, run_backups=False)
    # https, so the Secure session cookie is sent back; Origin on every request, as browsers do.
    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as c:
        yield c


class RecordingMailer:
    """Keeps what would have been sent; `fail` makes the next sends raise, as Resend down would."""

    def __init__(self) -> None:
        self.sent: list[Message] = []
        self.fail = False

    def send(self, message: Message) -> None:
        if self.fail:
            raise MailError("Resend unreachable: test")
        self.sent.append(message)


@pytest.fixture
def mailer() -> RecordingMailer:
    return RecordingMailer()


@pytest.fixture
def mail_config(config: Config) -> Config:
    return replace(config, resend_api_key="re_test", mail_from="Tracker <p@example.com>")


@pytest.fixture
def mail_client(mail_config: Config, mailer: RecordingMailer) -> Iterator[TestClient]:
    app = create_app(mail_config, run_backups=False, mailer=mailer)
    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as c:
        yield c
