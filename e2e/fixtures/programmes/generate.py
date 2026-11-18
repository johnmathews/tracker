"""The replies e2e/programmes.spec.ts mocks, saved from the real API.

The story runs on Thu 12 Nov 2026, the day the W7 fixtures in src/lib/__tests__/programmes/ use:
alice adds fixtures/programmes/valid/beginner-5x5.json to her library, previews and starts it
today with its defaults, and previews the bench press at 45 kg from week 3 without confirming it.
She then pauses the back squat for two weeks from today ("Knee"), previewed and then confirmed.
Each reply goes into a file named for its step.

Run it from api/ after a change to a reply's shape, then `npm run format`:

    uv run python ../e2e/fixtures/programmes/generate.py
"""

import json
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tracker_api import auth
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


def save(name: str, reply: Any) -> Any:
    assert reply.status_code in (200, 201), reply.text
    body = reply.json()
    (HERE / f"{name}.json").write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n")
    return body


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        config = Config(data_dir=Path(tmp), public_origin=ORIGIN, clock=lambda: NOW)
        conn = connect(config.db_path)
        migrate(conn)
        token = auth.mint_link(conn, config, "invite", "alice@example.com")
        conn.close()
        app = create_app(config, run_backups=False)
        with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as c:
            r = c.post("/api/invites/redeem", json={"token": token, "password": "a long password"})
            assert r.status_code == 200, r.text
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


if __name__ == "__main__":
    main()
