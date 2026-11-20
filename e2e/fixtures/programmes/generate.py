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

Then the programme builder (docs/specs/2026-11-20-programme-builder.md): carol, a third account,
adds the beginner programme to her library. Her drafts go to `POST /api/programmes/draft` as the
builder sends them: a programme built from empty, a step at a time (`build_steps`), and the
beginner as loaded, with the deadlift at +90 kg a week (week 6 comes to 510 kg) and at +10 kg,
and the beginner with week 3 added as an exception week that rests the legs (`rest_steps`, K191).
Each `draft-<name>.json` holds `{doc, reply}`, so the spec answers a draft by its document. She
saves the built programme to her library, and her +10 kg change meets a 409: the programme was
saved elsewhere since she opened it. Saved over at the server's rev, it goes through.

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
CAROL = "carol@example.com"
FORMAT = "tracker-programme/1"


def build_steps() -> list[tuple[str, dict[str, Any]]]:
    """The documents the builder sends as a programme is built from empty, each after one step:
    open Build a programme, type the name, Add activity, name it, make its weight grow, and start
    the weight at 40 kg. The draft model (src/lib/programmeDraft.ts) makes them: an empty programme
    is `newProgramme()`, a new strength activity `{key, name, sets: 3, reps: 10}` with its key
    following its name, and Grows makes `{start: 20, add: 2.5}`."""
    doc: dict[str, Any] = {
        "format": FORMAT,
        "name": "",
        "kind": "strength",
        "weeks": 8,
        "activities": [],
    }
    steps: list[tuple[str, dict[str, Any]]] = []

    def step(name: str) -> None:
        steps.append((name, json.loads(json.dumps(doc))))

    step("new")
    doc["name"] = "Squat block"
    step("named")
    doc["activities"].append({"key": "activity", "name": "", "sets": 3, "reps": 10})
    step("activity")
    doc["activities"][0].update(key="back-squat", name="Back squat")
    step("squat")
    doc["activities"][0]["weight"] = {"start": 20, "add": 2.5}
    step("squat-grows")
    doc["activities"][0]["weight"]["start"] = 40
    step("squat-40")
    return steps


def deadlift_at(doc: dict[str, Any], add: float) -> dict[str, Any]:
    """The beginner with the deadlift's weekly increase at `add` kg, as the builder edits it."""
    changed: dict[str, Any] = json.loads(json.dumps(doc))
    changed["activities"][3]["weight"]["add"] = add
    return changed


def rest_steps(doc: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """The documents the builder sends as the beginner rests its legs in week 3 (K191): Add
    exception week adds `{weeks: [], activities: {}}`, the weeks are typed as 3, then Back squat
    and Deadlift are ticked under Rest these activities, each a `target` of 0."""
    changed: dict[str, Any] = json.loads(json.dumps(doc))
    steps: list[tuple[str, dict[str, Any]]] = []

    def step(name: str) -> None:
        steps.append((name, json.loads(json.dumps(changed))))

    week: dict[str, Any] = {"weeks": [], "activities": {}}
    changed["overrides"].append(week)
    step("exception-new")
    week["weeks"] = [3]
    step("exception-week-3")
    week["activities"]["squat"] = {"target": 0}
    step("rest-squat")
    week["activities"]["deadlift"] = {"target": 0}
    step("rest-legs")
    return steps


def write(name: str, body: object) -> None:
    (HERE / f"{name}.json").write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n")


def save(name: str, reply: Any, status: tuple[int, ...] = (200, 201)) -> Any:
    assert reply.status_code in status, reply.text
    body = reply.json()
    write(name, body)
    return body


def save_draft(c: TestClient, name: str, doc: dict[str, Any]) -> dict[str, Any]:
    """A draft's `{errors, plan}`, saved with the document it answers."""
    r = c.post("/api/programmes/draft", json={"doc": doc})
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    write(f"draft-{name}", {"doc": doc, "reply": body})
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

            # The programme builder: carol, with the beginner in her library.
            k = sign_in(app, config, CAROL)
            save("builder-me", k.get("/api/auth/me"))
            save("builder-state", k.get("/api/state"))
            beginner = k.post("/api/programmes", json={"doc": doc}).json()["id"]
            save("builder-library", k.get("/api/programmes"))
            save("builder-programme", k.get(f"/api/programmes/{beginner}"))

            # Built from empty, a step at a time, then saved to the library.
            steps = build_steps()
            drafts = [save_draft(k, name, step) for name, step in steps]
            assert drafts[-1]["errors"] == [], drafts[-1]
            built = steps[-1][1]
            save("builder-saved", k.post("/api/programmes", json={"doc": built}))
            save("builder-library-saved", k.get("/api/programmes"))

            # The beginner as loaded, its deadlift over the limit, and fixed.
            assert save_draft(k, "beginner", doc)["errors"] == []
            over = save_draft(k, "deadlift-90", deadlift_at(doc, 90))
            assert [e["message"] for e in over["errors"]] == [
                "week 6 comes to 510 kg. The most is 500."
            ], over
            fixed = deadlift_at(doc, 10)
            assert save_draft(k, "deadlift-10", fixed)["errors"] == []

            # Week 3 rests the legs: its week-3 cells have a goal of 0, which the grid shows as
            # Rest week (K170); the other activities' week 3 keeps its goal.
            rests = [save_draft(k, name, step) for name, step in rest_steps(doc)]
            assert rests[-1]["errors"] == [], rests[-1]
            week_3 = rests[-1]["plan"]["grid"]["weeks"][2]["cells"]
            goals = {key: cell["target"] for key, cell in week_3.items()}
            assert goals == {"squat": 0, "bench": 3, "row": 3, "deadlift": 0, "plank": 3}, goals

            # Saved elsewhere since the builder opened it (rev 1 to 2), so rev 1 meets a 409 with
            # the server's copy; saved over at its rev, the change goes through.
            elsewhere = {**doc, "description": "Changed on another device."}
            path = f"/api/programmes/{beginner}"
            r = k.put(path, json={"doc": elsewhere, "rev": 1})
            assert r.status_code == 200, r.text
            conflict = save(
                "builder-conflict", k.put(path, json={"doc": fixed, "rev": 1}), status=(409,)
            )
            save("builder-replaced", k.put(path, json={"doc": fixed, "rev": conflict["rev"]}))
            save("builder-library-replaced", k.get("/api/programmes"))
            k.close()


if __name__ == "__main__":
    main()
