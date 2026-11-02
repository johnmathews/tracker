"""Email: the Resend client, the two emails, and the confirm and forgot-password flows."""

import io
import json
import logging
import re
import urllib.error
import urllib.request
from dataclasses import replace
from email.message import Message as Headers
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api import auth, emails
from tracker_api.app import create_app
from tracker_api.config import Config
from tracker_api.db import connect
from tracker_api.mail import MailError, Message, ResendMailer, send_quietly

from .conftest import ORIGIN, Clock, RecordingMailer

PASSWORD = "correct horse battery"
NEW_PASSWORD = "a different horse"
DAY, HOUR = 86_400, 3600
CARD = (
    Path(__file__).resolve().parents[2]
    / "brand/design-system/project/components/EmailLayout/preview.html"
)


def token_in(message: Message, kind: str) -> str:
    found = re.search(rf"#/{kind}/([A-Za-z0-9_-]+)", message.text)
    assert found, message.text
    return found.group(1)


def sign_up(client: TestClient, email: str = "sam@example.com") -> None:
    r = client.post("/api/auth/signup", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text


def message(**changes: Any) -> Message:
    base = Message("sam@example.com", "Subject", "<p>Hi</p>", "Hi", "confirm", "k1")
    return replace(base, **changes)


# --- the Resend client --------------------------------------------------------------------------


class FakeResponse(io.BytesIO):
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def test_resend_request_shape() -> None:
    seen: list[tuple[urllib.request.Request, float]] = []

    def opener(request: urllib.request.Request, timeout: float) -> FakeResponse:
        seen.append((request, timeout))
        return FakeResponse(b'{"id": "abc"}')

    ResendMailer("re_secret", "Tracker <p@example.com>", opener).send(message())
    ((request, timeout),) = seen
    assert request.full_url == "https://api.resend.com/emails"
    assert request.get_method() == "POST"
    assert timeout == 10.0
    headers = {k.lower(): v for k, v in request.header_items()}
    assert headers["authorization"] == "Bearer re_secret"
    assert headers["content-type"] == "application/json"
    assert headers["idempotency-key"] == "k1"
    assert json.loads(request.data) == {  # type: ignore[arg-type]
        "from": "Tracker <p@example.com>",
        "to": ["sam@example.com"],
        "subject": "Subject",
        "html": "<p>Hi</p>",
        "text": "Hi",
        "tags": [{"name": "kind", "value": "confirm"}],
    }


def test_resend_errors_become_mail_errors() -> None:
    def refuses(request: urllib.request.Request, timeout: float) -> FakeResponse:
        raise urllib.error.HTTPError(
            request.full_url,
            422,
            "bad",
            Headers(),
            io.BytesIO(b'{"message": "domain not verified"}'),
        )

    def unreachable(request: urllib.request.Request, timeout: float) -> FakeResponse:
        raise urllib.error.URLError("no route")

    with pytest.raises(MailError, match=r"422.*domain not verified"):
        ResendMailer("k", "f", refuses).send(message())
    with pytest.raises(MailError, match="unreachable"):
        ResendMailer("k", "f", unreachable).send(message())


def test_send_quietly_logs_a_failure_without_the_address(
    caplog: pytest.LogCaptureFixture,
) -> None:
    mailer = RecordingMailer()
    mailer.fail = True
    with caplog.at_level(logging.WARNING):
        send_quietly(mailer, message(kind="reset"))
    assert "reset email not sent" in caplog.text
    assert "sam@example.com" not in caplog.text


# --- the emails ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("seconds", "words"),
    [
        (7 * DAY, "seven days"),
        (DAY, "one day"),
        (HOUR, "one hour"),
        (2 * HOUR, "two hours"),
        (90 * 60, "90 minutes"),
        (12 * DAY, "12 days"),
        (30, "one minute"),
    ],
)
def test_duration_in_words(seconds: int, words: str) -> None:
    assert emails.duration(seconds) == words


def test_confirm_email() -> None:
    e = emails.confirm("https://fitness.example", "tok", 7 * DAY)
    assert e.subject == "Confirm your email for Tracker"
    assert 'href="https://fitness.example/#/confirm/tok"' in e.html
    assert "https://fitness.example/#/confirm/tok" in e.text
    assert "seven days" in e.html and "seven days" in e.text
    assert "fitness.example</td>" in e.html


def test_reset_email_escapes_the_address() -> None:
    e = emails.reset("https://fitness.example", "a<b>@example.com", "tok", HOUR)
    assert e.subject == "Reset your Tracker password"
    assert "a&lt;b&gt;@example.com" in e.html and "a<b>" not in e.html
    assert "a<b>@example.com" in e.text
    assert "#/reset/tok" in e.text and "one hour" in e.text


@pytest.mark.parametrize("kind", ["confirm", "reset"])
def test_emails_follow_the_email_rules(kind: str) -> None:
    e = (
        emails.confirm("https://f.example", "t", DAY)
        if kind == "confirm"
        else emails.reset("https://f.example", "s@example.com", "t", HOUR)
    )
    for banned in ("<style", "<link", "<script", "var(--", "<img", "!"):
        assert banned not in e.html.replace("<!doctype", "") and banned not in e.text
    assert "word-break:break-all" in e.html


def test_the_design_system_card_is_current() -> None:
    assert CARD.read_text(encoding="utf-8") == emails.card(), (
        "Regenerate it: uv run python -m tracker_api.emails " + str(CARD)
    )


# --- options and me -----------------------------------------------------------------------------


def test_options_say_whether_mail_is_on(client: TestClient, mail_client: TestClient) -> None:
    assert client.get("/api/auth/options").json() == {"mail": False, "ask": False}
    assert mail_client.get("/api/auth/options").json() == {"mail": True, "ask": False}


def test_me_has_no_confirmed_flag_without_mail(client: TestClient) -> None:
    sign_up(client)
    assert client.get("/api/auth/me").json() == {"username": "sam@example.com"}


# --- confirming an email ------------------------------------------------------------------------


def test_signup_sends_a_confirmation_and_the_link_confirms(
    mail_client: TestClient, mailer: RecordingMailer
) -> None:
    r = mail_client.post(
        "/api/auth/signup", json={"email": "Sam@Example.com", "password": PASSWORD}
    )
    assert r.json() == {"username": "sam@example.com", "confirmed": False}
    assert mail_client.get("/api/auth/me").json() == {
        "username": "sam@example.com",
        "confirmed": False,
    }
    (sent,) = mailer.sent
    assert (sent.to, sent.kind) == ("sam@example.com", "confirm")
    assert sent.subject == "Confirm your email for Tracker"
    token = token_in(sent, "confirm")
    r = mail_client.post("/api/auth/confirm", json={"token": token})
    assert (r.status_code, r.json()) == (200, {"username": "sam@example.com", "confirmed": True})
    assert mail_client.get("/api/auth/me").json()["confirmed"] is True
    r = mail_client.post("/api/auth/confirm", json={"token": token})
    assert (r.status_code, r.json()) == (410, {"error": "gone"})


def test_confirm_needs_no_session(mail_client: TestClient, mailer: RecordingMailer) -> None:
    sign_up(mail_client)
    mail_client.cookies.clear()
    r = mail_client.post("/api/auth/confirm", json={"token": token_in(mailer.sent[0], "confirm")})
    assert r.status_code == 200


def test_confirm_links_expire(
    mail_client: TestClient, mailer: RecordingMailer, clock: Clock
) -> None:
    sign_up(mail_client)
    clock.advance(7 * DAY)
    r = mail_client.post("/api/auth/confirm", json={"token": token_in(mailer.sent[0], "confirm")})
    assert (r.status_code, r.json()) == (410, {"error": "gone"})
    assert mail_client.post("/api/auth/confirm", json={"token": "nope"}).status_code == 410
    assert mail_client.post("/api/auth/confirm", json={}).status_code == 400


def test_send_it_again(mail_client: TestClient, mailer: RecordingMailer, clock: Clock) -> None:
    sign_up(mail_client)
    first = token_in(mailer.sent[0], "confirm")
    r = mail_client.post("/api/auth/confirm/resend", json={})
    assert (r.status_code, r.json()) == (429, {"error": "too-soon", "retryAfter": 60})
    assert r.headers["retry-after"] == "60"
    clock.advance(60)
    assert mail_client.post("/api/auth/confirm/resend", json={}).status_code == 202
    assert len(mailer.sent) == 2
    # The new link replaces the old one.
    assert mail_client.post("/api/auth/confirm", json={"token": first}).status_code == 410
    second = token_in(mailer.sent[1], "confirm")
    assert mail_client.post("/api/auth/confirm", json={"token": second}).status_code == 200
    clock.advance(60)
    r = mail_client.post("/api/auth/confirm/resend", json={})
    assert (r.status_code, r.json()) == (409, {"error": "confirmed"})


def test_at_most_five_confirmations_a_day(
    mail_client: TestClient, mailer: RecordingMailer, clock: Clock
) -> None:
    sign_up(mail_client)
    for _ in range(4):
        clock.advance(60)
        assert mail_client.post("/api/auth/confirm/resend", json={}).status_code == 202
    clock.advance(60)
    r = mail_client.post("/api/auth/confirm/resend", json={})
    assert r.status_code == 429
    # Counted from the first of the five: the day ends 24 hours after it.
    assert r.json() == {"error": "too-soon", "retryAfter": DAY - 5 * 60}
    assert len(mailer.sent) == 5


def test_resend_refusals(client: TestClient, mail_client: TestClient, config: Config) -> None:
    assert mail_client.post("/api/auth/confirm/resend", json={}).status_code == 401
    conn = connect(config.db_path)
    conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES ('alice', ?, 0)",
        (auth.hash_password(PASSWORD),),
    )
    conn.close()
    mail_client.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
    # An account from before invites took an email is named, not addressed: nothing to confirm.
    assert mail_client.get("/api/auth/me").json() == {"username": "alice"}
    r = mail_client.post("/api/auth/confirm/resend", json={})
    assert (r.status_code, r.json()) == (409, {"error": "no-email"})
    sign_up(client)
    r = client.post("/api/auth/confirm/resend", json={})
    assert (r.status_code, r.json()) == (503, {"error": "mail-off"})


def test_a_failed_send_still_signs_up(
    mail_client: TestClient, mailer: RecordingMailer, caplog: pytest.LogCaptureFixture
) -> None:
    mailer.fail = True
    with caplog.at_level(logging.WARNING):
        sign_up(mail_client)
    assert "confirm email not sent" in caplog.text
    assert mail_client.get("/api/auth/me").json()["confirmed"] is False


# --- forgot password ----------------------------------------------------------------------------


def forgot(client: TestClient, email: str) -> Any:
    return client.post("/api/auth/forgot", json={"email": email})


def test_forgot_password_resets_and_confirms(
    mail_client: TestClient, mailer: RecordingMailer
) -> None:
    sign_up(mail_client)
    mailer.sent.clear()
    mail_client.cookies.clear()
    r = forgot(mail_client, " SAM@example.com ")
    assert (r.status_code, r.json()) == (202, {})
    (sent,) = mailer.sent
    assert (sent.to, sent.kind) == ("sam@example.com", "reset")
    token = token_in(sent, "reset")
    assert mail_client.post("/api/invites/lookup", json={"token": token}).json() == {
        "kind": "reset",
        "username": "sam@example.com",
    }
    r = mail_client.post("/api/invites/redeem", json={"token": token, "password": NEW_PASSWORD})
    # The reset came by email, so the address is proven.
    assert r.json() == {"username": "sam@example.com", "confirmed": True}
    login = {"username": "sam@example.com", "password": NEW_PASSWORD}
    assert mail_client.post("/api/auth/login", json=login).json()["confirmed"] is True


def test_mailed_reset_links_last_an_hour(
    mail_client: TestClient, mailer: RecordingMailer, clock: Clock
) -> None:
    sign_up(mail_client)
    forgot(mail_client, "sam@example.com")
    clock.advance(HOUR)
    token = token_in(mailer.sent[-1], "reset")
    assert mail_client.post("/api/invites/lookup", json={"token": token}).status_code == 410


def test_an_admin_reset_does_not_confirm(mail_client: TestClient, mail_config: Config) -> None:
    sign_up(mail_client)
    conn = connect(mail_config.db_path)
    token = auth.mint_link(conn, mail_config, "reset", "sam@example.com")
    conn.close()
    mail_client.post("/api/invites/redeem", json={"token": token, "password": NEW_PASSWORD})
    assert mail_client.get("/api/auth/me").json()["confirmed"] is False


def test_forgot_answers_the_same_for_anyone(
    mail_client: TestClient, mailer: RecordingMailer, mail_config: Config
) -> None:
    sign_up(mail_client, "taken@example.com")
    conn = connect(mail_config.db_path)
    auth.set_disabled(conn, "taken@example.com", True)
    auth.mint_link(conn, mail_config, "invite", "alice@example.com")
    conn.close()
    mailer.sent.clear()
    for email in ("nobody@example.com", "taken@example.com"):
        r = forgot(mail_client, email)
        assert (r.status_code, r.json()) == (202, {})
    # Nobody by that email, and a disabled account, get nothing.
    assert mailer.sent == []
    r = forgot(mail_client, "alice")
    assert (r.status_code, r.json()) == (400, {"error": "email"})


def test_forgot_limits_are_silent(
    mail_client: TestClient, mailer: RecordingMailer, clock: Clock
) -> None:
    sign_up(mail_client)
    mailer.sent.clear()
    assert forgot(mail_client, "sam@example.com").status_code == 202
    assert forgot(mail_client, "sam@example.com").status_code == 202
    assert len(mailer.sent) == 1
    clock.advance(60)
    forgot(mail_client, "sam@example.com")
    assert len(mailer.sent) == 2


def test_mail_per_hour_caps_every_kind(
    mail_config: Config, mailer: RecordingMailer, clock: Clock
) -> None:
    app = create_app(replace(mail_config, mail_per_hour=2), run_backups=False, mailer=mailer)
    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as c:
        sign_up(c, "a@example.com")
        sign_up(c, "b@example.com")
        sign_up(c, "c@example.com")
        assert [m.to for m in mailer.sent] == ["a@example.com", "b@example.com"]
        clock.advance(60)
        r = c.post("/api/auth/confirm/resend", json={})
        assert (r.status_code, r.json()["error"]) == (429, "too-soon")
        assert r.json()["retryAfter"] == HOUR - 60
        assert forgot(c, "a@example.com").status_code == 202
        assert len(mailer.sent) == 2
        clock.advance(HOUR)
        assert c.post("/api/auth/confirm/resend", json={}).status_code == 202


def test_forgot_without_mail(client: TestClient) -> None:
    r = forgot(client, "sam@example.com")
    assert (r.status_code, r.json()) == (503, {"error": "mail-off"})


def test_every_send_has_its_own_key(
    mail_client: TestClient, mailer: RecordingMailer, clock: Clock
) -> None:
    sign_up(mail_client)
    clock.advance(60)
    mail_client.post("/api/auth/confirm/resend", json={})
    forgot(mail_client, "sam@example.com")
    keys = [m.key for m in mailer.sent]
    assert len(keys) == len(set(keys)) == 3


def test_the_app_builds_a_resend_mailer_from_config(mail_config: Config) -> None:
    app = create_app(mail_config, run_backups=False)
    assert isinstance(app.state.mailer, ResendMailer)
    assert (
        create_app(replace(mail_config, resend_api_key=None), run_backups=False).state.mailer
        is None
    )


def test_a_new_reset_request_leaves_earlier_links_working(
    mail_client: TestClient, mailer: RecordingMailer, mail_config: Config, clock: Clock
) -> None:
    """Anyone can ask for a reset for any address; that must not cancel a link already sent,
    nor one `tracker-admin` handed over."""
    sign_up(mail_client)
    conn = connect(mail_config.db_path)
    admin = auth.mint_link(conn, mail_config, "reset", "sam@example.com")
    conn.close()
    forgot(mail_client, "sam@example.com")
    clock.advance(60)
    forgot(mail_client, "sam@example.com")
    first, second = (token_in(m, "reset") for m in mailer.sent if m.kind == "reset")
    for token in (admin, first, second):
        assert mail_client.post("/api/invites/lookup", json={"token": token}).status_code == 200


def test_redeeming_an_invite_sends_a_confirmation(
    mail_client: TestClient, mailer: RecordingMailer, mail_config: Config
) -> None:
    conn = connect(mail_config.db_path)
    token = auth.mint_link(conn, mail_config, "invite", "dana@example.com")
    conn.close()
    r = mail_client.post("/api/invites/redeem", json={"token": token, "password": PASSWORD})
    assert r.json() == {"username": "dana@example.com", "confirmed": False}
    (sent,) = mailer.sent
    assert (sent.to, sent.kind) == ("dana@example.com", "confirm")


def test_signing_in_sends_a_first_confirmation_once(
    mail_client: TestClient, mailer: RecordingMailer, mail_config: Config, clock: Clock
) -> None:
    """An account from before mail was on (or renamed to its email) has never been sent a link,
    so its first sign-in sends one, and the banner's "the link is in the email" is true."""
    conn = connect(mail_config.db_path)
    auth.signup(conn, mail_config, "sam@example.com", PASSWORD)
    conn.close()
    login = {"username": "sam@example.com", "password": PASSWORD}
    assert mail_client.post("/api/auth/login", json=login).json()["confirmed"] is False
    assert [m.kind for m in mailer.sent] == ["confirm"]
    clock.advance(DAY)
    mail_client.post("/api/auth/login", json=login)
    assert len(mailer.sent) == 1


def test_signing_in_confirmed_sends_nothing(
    mail_client: TestClient, mailer: RecordingMailer, mail_config: Config
) -> None:
    conn = connect(mail_config.db_path)
    uid = auth.signup(conn, mail_config, "sam@example.com", PASSWORD)
    conn.execute("UPDATE users SET email_confirmed_at = 1 WHERE id = ?", (uid,))
    conn.close()
    mail_client.post("/api/auth/login", json={"username": "sam@example.com", "password": PASSWORD})
    assert mailer.sent == []
