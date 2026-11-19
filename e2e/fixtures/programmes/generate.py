"""The replies the programme e2e specs mock, saved from the real API.

The story runs on Thu 12 Nov 2026, the day the W7 fixtures in src/lib/__tests__/programmes/ use:
alice adds fixtures/programmes/valid/beginner-5x5.json to her library, previews and starts it
today with its defaults, and previews the bench press at 45 kg from week 3 without confirming it.
She then pauses the back squat for two weeks from today ("Knee"), previewed and then confirmed.

Then the run ends early (K167, K168): alice ends it today with End programme, and previews a
re-open from today ("Back at it") and confirms it. She ends it again, and previews and confirms a
restart from week 1. The re-open goes first because a restart leaves the old run one that can't be
re-opened.

Then the shared library (K171, docs/specs/2026-11-19-shared-library.md): alice is made an admin, as
`tracker-admin admin` does, and previews and confirms publishing her programme. bob, a second
account and no admin, reads his empty library and the shared library, and copies it into his.

Each reply goes into a file named for its step. The clock is fixed and new ids come from a counter
(`fixed_ids`), so a run with no change to a reply's shape writes the same files.

Run it from api/ after a change to a reply's shape, then `npm run format`:

    uv run python ../e2e/fixtures/programmes/generate.py
"""

import itertools
import json
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tracker_api import auth, edits
from tracker_api.app import create_app
from tracker_api.config import Config
from tracker_api.db import connect, migrate

HERE = Path(__file__).resolve().parent
DOC = HERE.parents[2] / "fixtures" / "programmes" / "valid" / "beginner-5x5.json"
ORIGIN = "https://testserver"
TODAY = "2026-11-12"
#: 10:00 in Amsterdam on TODAY.
NOW = int(datetime(2026, 11, 12, 9, 0, tzinfo=UTC).timestamp())
PAUSE = {"type": "pause-activity", "activity": "squat", "weeks": 2}
BENCH = {"type": "set-value", "activity": "bench", "field": "weight", "value": 45}
#: Week 3's Monday, where the overview's Change from here starts a change.
WEEK_3 = "2026-11-23"
ALICE = "alice@example.com"
BOB = "bob@example.com"


def save(name: str, reply: Any) -> Any:
    assert reply.status_code in (200, 201), reply.text
    body = reply.json()
    (HERE / f"{name}.json").write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n")
    return body


@contextmanager
def fixed_ids() -> Iterator[None]:
    """New ids in the app's shape (`x`, milliseconds in base 36, four characters), from NOW and a
    counter rather than the wall clock and chance."""
    count = itertools.count()
    stamp = edits._base36(NOW * 1000)

    def candidate() -> str:
        return "x" + stamp + edits._base36(next(count)).rjust(4, "0")

    with mock.patch.object(edits, "_candidate", candidate):
        yield


def sign_in(app: FastAPI, config: Config, username: str) -> TestClient:
    """A client signed in as a new account, from an invite as `tracker-admin invite` mints it."""
    conn = connect(config.db_path)
    token = auth.mint_link(conn, config, "invite", username)
    conn.close()
    c = TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN})
    r = c.post("/api/invites/redeem", json={"token": token, "password": "a long password"})
    assert r.status_code == 200, r.text
    return c


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp, fixed_ids():
        config = Config(data_dir=Path(tmp), public_origin=ORIGIN, clock=lambda: NOW)
        conn = connect(config.db_path)
        migrate(conn)
        conn.close()
        app = create_app(config, run_backups=False)
        # The outer client runs the app's lifespan; each account signs in on a client of its own.
        with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}):
            c = sign_in(app, config, ALICE)
            save("me", c.get("/api/auth/me"))
            save("state-before", c.get("/api/state"))
            doc = json.loads(DOC.read_text())
            programme = c.post("/api/programmes", json={"doc": doc}).json()["id"]
            save("library", c.get("/api/programmes"))
            save("programme", c.get(f"/api/programmes/{programme}"))
            params = {"squat": 40, "rate": 5}
            body = {"start": TODAY, "params": params}
            save("start-preview", c.post(f"/api/programmes/{programme}/preview", json=body))
            started = save(
                "started",
                c.post(f"/api/programmes/{programme}/start", json={"name": doc["name"], **body}),
            )
            tracker = started["tracker"]["id"]
            save("state-started", c.get("/api/state"))
            save("run-started", c.get(f"/api/runs/{tracker}"))
            bench = {"change": BENCH, "from": WEEK_3, "preview": True}
            save("value-preview", c.post(f"/api/runs/{tracker}/changes", json=bench))
            change = {"change": PAUSE, "from": TODAY, "reason": "Knee"}
            preview = save(
                "pause-preview",
                c.post(f"/api/runs/{tracker}/changes", json={**change, "preview": True}),
            )
            confirm = {**change, "preview": False, "rev": preview["rev"]}
            save("pause-applied", c.post(f"/api/runs/{tracker}/changes", json=confirm))
            save("state-paused", c.get("/api/state"))
            save("run-paused", c.get(f"/api/runs/{tracker}"))

            # Ended early, then re-opened (K167, K168).
            save("ended", c.post(f"/api/runs/{tracker}/end", json={}))
            save("state-ended", c.get("/api/state"))
            run = save("run-ended", c.get(f"/api/runs/{tracker}"))
            assert run["status"] == "ended" and run["canReopen"], run
            reopen = {"from": TODAY, "reason": "Back at it"}
            preview = save(
                "reopen-preview",
                c.post(f"/api/runs/{tracker}/reopen", json={**reopen, "preview": True}),
            )
            confirm = {**reopen, "preview": False, "rev": preview["rev"]}
            save("reopened", c.post(f"/api/runs/{tracker}/reopen", json=confirm))

            # Ended again, then restarted from week 1 as a new tracker.
            r = c.post(f"/api/runs/{tracker}/end", json={})
            assert r.status_code == 200, r.text
            restart = {"name": doc["name"], "start": TODAY}
            preview = save(
                "restart-preview",
                c.post(f"/api/runs/{tracker}/restart", json={**restart, "preview": True}),
            )
            confirm = {**restart, "preview": False, "rev": preview["rev"]}
            save("restarted", c.post(f"/api/runs/{tracker}/restart", json=confirm))

            # The shared library (K171): alice is an admin and publishes her programme.
            conn = connect(config.db_path)
            auth.set_admin(conn, ALICE, True)
            conn.close()
            save("me-admin", c.get("/api/auth/me"))
            save("shared-before", c.get("/api/shared-programmes"))
            save("library-admin", c.get("/api/programmes"))
            publish = f"/api/programmes/{programme}/publish"
            preview = save("publish-preview", c.post(publish, json={"preview": True}))
            confirm = {"preview": False, "rev": preview["rev"]}
            save("published", c.post(publish, json=confirm))
            save("library-published", c.get("/api/programmes"))
            shared = save("shared", c.get("/api/shared-programmes"))
            c.close()

            # bob, no admin: his empty library, the shared library, and a copy into his.
            b = sign_in(app, config, BOB)
            save("bob-me", b.get("/api/auth/me"))
            save("bob-state", b.get("/api/state"))
            save("bob-library", b.get("/api/programmes"))
            # Preview on a shared row (K173): the document and its plan, nothing written.
            shared_id = shared["programmes"][0]["id"]
            save("bob-shared-preview", b.get(f"/api/shared-programmes/{shared_id}/preview"))
            copy = f"/api/shared-programmes/{shared_id}/copy"
            # A write needs a JSON Content-Type (app.py's rest_refusal), so the copy sends `{}`.
            save("bob-copied", b.post(copy, json={}))
            save("bob-library-copied", b.get("/api/programmes"))
            b.close()


if __name__ == "__main__":
    main()
