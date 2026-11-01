"""`tracker-admin seed-demo`: a demo account with three weeks of plausible marks, for a local stack
only (docs/api.md §5). It goes through the same parser and merge as Settings → Import, so it
adds a week's plan only where the account has none, fills only empty days, and gives details only
to items that have none: a second run changes nothing, and nothing the person wrote or marked by
hand is ever overwritten."""

import json
import sqlite3
from datetime import date, datetime, timedelta
from typing import TypedDict
from urllib.parse import urlsplit

from . import auth
from .config import Config
from .data import import_data
from .validate import EXPORT_FORMAT, EXPORT_VERSION, parse_export

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo-password"  # noqa: S105 (a local demo account's, printed on purpose)
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]"})


class NotLocal(Exception):
    """The configuration points at a deployed planner, so seeding is refused."""


class SeedResult(TypedDict):
    created: bool
    weeks: int
    ticks: int
    #: Items that gained details.
    details: int


# The ids match the app's default plan (defaultExercises and defaultFoods in src/lib/storage.ts),
# so seeding an account that already has it marks the same rows.
EXERCISES: list[dict[str, object]] = [
    {"id": "pu", "name": "Push-ups", "sets": 3, "reps": 12, "target": 4},
    {"id": "sq", "name": "Squats", "sets": 3, "reps": 15, "weight": 16, "target": 3},
    {"id": "plank", "name": "Plank", "sets": 3, "reps": 0, "duration": 45, "target": 3},
    {"id": "kh", "name": "Kettlebell halos", "reps": 8, "perSide": True, "weight": 12, "target": 2},
    {"id": "pl", "name": "Pull-ups", "sets": 3, "reps": 5, "target": 3},
]
FOODS: list[dict[str, object]] = [
    {"id": "veg", "name": "Vegetables", "target": 7},
    {"id": "fruit", "name": "Fruit", "target": 5},
    {"id": "fish", "name": "Fish", "target": 2},
    {"id": "nuts", "name": "Nuts", "target": 3},
]

#: Details for one exercise and one food, so the item page has something to show; the fields are
#: ones their type lists (types.py).
EXERCISE_DETAILS: dict[str, dict[str, object]] = {
    "pu": {
        "notes": "Slow on the way down, **three seconds**, and keep the elbows in.\n\n"
        "On a bad day, do them against the kitchen counter.",
        "fields": {"equipment": "None", "works": "Chest, shoulders, triceps"},
    },
}
FOOD_DETAILS: dict[str, dict[str, object]] = {
    "fish": {
        "notes": "Oily fish counts double for the omega-3s.",
        "fields": {"serving": "A palm-sized fillet", "examples": "Salmon, mackerel, sardines"},
    },
}

type Week = dict[str, list[str | None]]

E = None  # an empty day
G, GS, GH = "great", "great-solid", "great-hatch"
P, PS, PH = "partial", "partial-solid", "partial-hatch"
M, MS, MH = "missed", "missed-solid", "missed-hatch"

# Each item's seven days, Monday first, for two weeks ago, last week and this week. Between them
# they show every kind in every drawing, met and unmet goals, and a day over the pick of three
# (last Thursday: four exercises).
EXERCISE_WEEKS: list[Week] = [
    {
        "pu": [G, E, GS, E, G, E, E],
        "sq": [E, G, E, P, E, GH, E],
        "plank": [G, E, M, E, G, E, E],
        "kh": [E, G, E, E, GS, E, E],
        "pl": [P, E, E, G, E, E, E],
    },
    {
        "pu": [G, GS, E, GH, E, G, E],
        "sq": [G, E, PS, G, G, E, E],
        "plank": [E, G, E, MH, E, E, G],
        "kh": [GH, E, E, G, E, E, E],
        "pl": [E, P, G, E, MS, E, E],
    },
    {
        "pu": [G, E, G, P, GS, E, E],
        "sq": [E, G, M, E, G, E, E],
        "plank": [G, PH, E, G, E, G, E],
        "kh": [E, E, GS, E, E, E, E],
        "pl": [M, G, E, E, P, E, E],
    },
]
FOOD_WEEKS: list[Week] = [
    {
        "veg": [G, G, GS, G, G, E, G],
        "fruit": [G, E, G, E, GH, G, E],
        "fish": [E, E, G, E, E, E, G],
        "nuts": [G, E, E, G, E, E, E],
    },
    {
        "veg": [G, GH, G, GS, G, G, G],
        "fruit": [G, G, E, G, GS, G, E],
        "fish": [E, G, E, E, E, E, E],
        "nuts": [E, G, E, GS, E, G, E],
    },
    {
        "veg": [G, GH, G, E, G, G, E],
        "fruit": [E, G, E, G, E, E, E],
        "fish": [E, E, E, G, E, E, E],
        "nuts": [GS, E, E, E, E, E, E],
    },
]


def require_local(config: Config) -> None:
    """Refuse anything but a local stack: an http origin on this machine, with plain cookies."""
    url = urlsplit(config.public_origin)
    host = f"[{url.hostname}]" if url.hostname and ":" in url.hostname else url.hostname
    if url.scheme != "http" or host not in LOCAL_HOSTS or config.cookie_secure:
        raise NotLocal(
            "seed-demo runs only on a local stack: PUBLIC_ORIGIN http://localhost:<port>"
            f" (or 127.0.0.1) and COOKIE_SECURE=false, not {config.public_origin!r}"
        )


def demo_file(today: date) -> str:
    """The demo weeks as an export file, ending this week; days after `today` stay empty."""
    monday = today - timedelta(days=today.weekday())
    weeks = [monday - timedelta(weeks=2), monday - timedelta(weeks=1), monday]

    def section(
        items: list[dict[str, object]], marks: list[Week], details: dict[str, dict[str, object]]
    ) -> dict[str, object]:
        log: dict[str, Week] = {}
        for start, days_by_item in zip(weeks, marks, strict=True):
            week = start.isoformat()
            log[week] = {
                item: [
                    m if start + timedelta(days=i) <= today else None for i, m in enumerate(days)
                ]
                for item, days in days_by_item.items()
            }
        return {"plans": {w.isoformat(): items for w in weeks}, "log": log, "details": details}

    return json.dumps(
        {
            "format": EXPORT_FORMAT,
            "version": EXPORT_VERSION,
            "exercise": section(EXERCISES, EXERCISE_WEEKS, EXERCISE_DETAILS),
            "diet": section(FOODS, FOOD_WEEKS, FOOD_DETAILS),
            "settings": {"accent": "#30d158", "dailyPick": 3, "foodPick": 2},
        }
    )


def seed(conn: sqlite3.Connection, config: Config, email: str, password: str | None) -> SeedResult:
    """Fill the account's missing demo weeks, creating it (confirmed) when it doesn't exist.

    An existing account keeps its password and every mark it has; `password` is used only for
    a new one, and defaults to DEMO_PASSWORD.
    """
    require_local(config)
    email = auth.normal_email(email)
    row = conn.execute("SELECT id FROM users WHERE username = ?", (email,)).fetchone()
    created = row is None
    if created:
        user_id = auth.signup(conn, config, email, password or DEMO_PASSWORD)
        # No mail on a local stack, so the confirm-your-email banner would never go away.
        conn.execute(
            "UPDATE users SET email_confirmed_at = ? WHERE id = ?", (config.clock(), user_id)
        )
    else:
        user_id = int(row["id"])
    # The machine's own date, as the browser on it reads "today".
    today = datetime.fromtimestamp(config.clock()).date()
    added = import_data(
        conn, user_id, parse_export(demo_file(today)), quota=config.user_quota_bytes
    )
    return {
        "created": created,
        "weeks": added["weeks"],
        "ticks": added["ticks"],
        "details": added["details"],
    }
