"""`tracker-admin seed-demo`: a demo account with three weeks of plausible marks, for a local stack
only (docs/api.md §5). It goes through the same parser and merge as Settings → Import, so it
adds a week's plan only where the account has none, fills only empty days, and gives details only
to items that have none: a second run changes nothing, and nothing the person wrote or marked by
hand is ever overwritten.

It also gives the account a running programme (docs/programmes.md): the beginner programme of
`fixtures/programmes/valid/beginner-5x5.json` in the library, and a run of it that started three
weeks before this week's Monday, so today falls in its week 4. A run starts today or later, and a
change takes effect today or later, so the run's past is written as it would have been lived:
each step goes through the same data functions as the API, with `data.When` set to the moment it
happened. The start, a pause, a change and each mark happen on their own day; each change seals
the days before it, and a last seal covers the days up to yesterday. Nothing writes a past day
directly. The run is added whole, only while
the account has no tracker with its id; the library programme only while the library has no
programme with its id.

When the shared library is empty, it gains one programme, `fixtures/programmes/valid/cardio.json`
(docs/specs/2026-11-19-shared-library.md §9), so its section has something to show. A shared
library with any programme is left as it is."""

import json
import sqlite3
from collections.abc import Callable, Container
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, TypedDict, cast
from urllib.parse import urlsplit

from . import auth
from .config import Config
from .data import (
    When,
    add_programme,
    change_run,
    encode_programme,
    import_data,
    load_programme,
    load_tracker,
    seal_runs,
    set_tick,
    start_programme,
)
from .db import transaction
from .validate import EXPORT_FORMAT, EXPORT_VERSION, Mark, parse_export

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
    #: Library programmes added, and programme runs started.
    programmes: int
    runs: int
    #: Shared programmes added: 1 into an empty shared library, else 0.
    shared: int


# The ids match the app's default plan (defaultExercises and defaultFoods in src/lib/storage.ts),
# so seeding an account that already has it marks the same rows.
EXERCISES: list[dict[str, object]] = [
    {"id": "pu", "name": "Push-ups", "sets": 3, "reps": 12, "target": 4},
    {"id": "sq", "name": "Squats", "sets": 3, "reps": 15, "weight": 16, "target": 3},
    {"id": "plank", "name": "Plank", "sets": 3, "reps": 0, "duration": 45, "target": 3},
    {"id": "kh", "name": "Kettlebell halos", "reps": 8, "perSide": True, "weight": 12, "target": 2},
    {"id": "pl", "name": "Pull-ups", "sets": 3, "reps": 5, "target": 3},
]
#: Cardio (K90): one item timed, one measured, as the sample export has them.
CARDIO: list[dict[str, object]] = [
    {"id": "cy", "name": "Cycling", "duration": 1800, "target": 2},
    {"id": "ru", "name": "Running", "distance": 5, "target": 2},
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
CARDIO_DETAILS: dict[str, dict[str, object]] = {
    "ru": {"fields": {"route": "Round the park and back along the river"}},
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
# Cardio takes every kind, as an exercise does; its goals are met in the first and last weeks.
CARDIO_WEEKS: list[Week] = [
    {"cy": [E, G, E, E, E, GS, E], "ru": [G, E, E, P, E, E, E]},
    {"cy": [E, E, G, E, E, E, E], "ru": [E, MH, E, E, G, E, E]},
    {"cy": [G, E, E, PS, E, E, E], "ru": [E, E, G, E, E, GH, E]},
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


#: The demo programme's id in the library, and its run's tracker id.
DEMO_PROGRAMME = "beginner-5x5"
DEMO_RUN = "beginner-5x5-run"
#: The run starts on the Monday this many weeks before this week's.
RUN_WEEKS_BACK = 3

#: fixtures/programmes/valid/beginner-5x5.json, kept here so the package needs no repo file;
#: tests/test_seed.py checks the two match.
PROGRAMME: dict[str, Any] = {
    "format": "tracker-programme/1",
    "name": "Beginner 5\u00d75",
    "description": "Three full-body sessions a week, adding weight each week, with a deload in "
    "weeks 4 and 8.",
    "kind": "strength",
    "weeks": 8,
    "dailyTarget": 3,
    "params": {
        "squat": {"label": "Squat start", "unit": "kg", "default": 40, "min": 20, "max": 200},
        "rate": {"label": "Weekly increase", "unit": "%", "default": 5, "min": 0, "max": 20},
    },
    "activities": [
        {
            "key": "squat",
            "name": "Back squat",
            "notes": "Belt from week 5.",
            "target": 3,
            "sets": 5,
            "reps": 5,
            "weight": {"start": "$squat", "rate": "$rate", "step": 2.5},
        },
        {
            "key": "bench",
            "name": "Bench press",
            "target": 3,
            "sets": 5,
            "reps": 5,
            "weight": {"start": 30, "add": 2.5, "step": 2.5},
        },
        {
            "key": "row",
            "name": "Barbell row",
            "target": 3,
            "sets": 5,
            "reps": 5,
            "weight": {"start": 30, "add": 2.5, "step": 2.5},
        },
        {
            "key": "deadlift",
            "name": "Deadlift",
            "notes": "Hinge, don\u2019t squat. Bar close to the shins.",
            "target": 3,
            "sets": 1,
            "reps": 5,
            "weight": {"start": 60, "add": 5, "step": 2.5},
        },
        {
            "key": "plank",
            "name": "Plank",
            "target": 3,
            "sets": 3,
            "duration": {"start": 30, "add": 5, "every": 2, "max": 90},
        },
    ],
    "overrides": [
        {
            "weeks": [4, 8],
            "label": "Deload",
            "activities": {
                "*": {"sets": 3, "weight": {"scale": 0.9}},
                "deadlift": {"sets": 1},
            },
        }
    ],
}

#: The shared library's demo programme (shared library spec §9), and its id there.
DEMO_SHARED = "base-miles"
#: fixtures/programmes/valid/cardio.json, kept here as PROGRAMME is; tests/test_seed.py checks
#: the two match.
SHARED_PROGRAMME: dict[str, Any] = {
    "format": "tracker-programme/1",
    "name": "Base miles",
    "description": "Two runs and a long ride, with an easy week.",
    "kind": "cardio",
    "weeks": 6,
    "params": {"ride": {"label": "Long ride", "unit": "km", "default": 20, "min": 5}},
    "activities": [
        {
            "key": "run",
            "name": "Easy run",
            "target": 2,
            "duration": {"start": 1200, "rate": 10, "step": 60, "max": 1800},
            "distance": {"start": 3, "add": 0.5, "max": 6},
        },
        {
            "key": "long-ride",
            "name": "Long ride",
            "target": 1,
            "duration": {"start": 3600, "add": 600, "every": 2},
            "distance": {"start": "$ride", "rate": 10},
        },
    ],
    "overrides": [
        {
            "weeks": [4],
            "label": "Easy week",
            "activities": {
                "*": {"duration": {"scale": 0.8}},
                "long-ride": {"distance": 15},
            },
        }
    ],
}

#: The run's changes, each made at 07:00 on its own day: (days after the start, the change, the
#: reason). The deadlift pauses on week 2's Wednesday for a week, so it comes back on week 3's;
#: the squat's increase goes up on week 3's Monday.
RUN_CHANGES: list[tuple[int, dict[str, Any], str]] = [
    (
        9,
        {"type": "pause-activity", "activity": "deadlift", "weeks": 1},
        "Sore lower back after Monday.",
    ),
    (
        14,
        {"type": "set-increase", "activity": "squat", "field": "weight", "rate": 7.5},
        "Squats feel easy.",
    ),
]

#: The run's sessions, Monday, Wednesday and Friday of its first four weeks: each activity's mark
#: on each of the three days (E for none: the deadlift while it is paused). Each mark is entered
#: at 19:00 that day, but week 2's Friday plank is entered the next morning, so it is late (S6).
RUN_MARKS: list[Week] = [
    {
        "squat": [G, G, G],
        "bench": [G, G, G],
        "row": [G, G, G],
        "deadlift": [G, G, G],
        "plank": [G, G, P],
    },
    {
        "squat": [G, G, G],
        "bench": [G, G, P],
        "row": [G, G, G],
        "deadlift": [G, E, E],
        "plank": [G, M, G],
    },
    {
        "squat": [G, G, G],
        "bench": [G, P, G],
        "row": [G, G, GS],
        "deadlift": [E, G, G],
        "plank": [G, E, G],
    },
    {
        "squat": [G, G, G],
        "bench": [G, G, G],
        "row": [G, G, G],
        "deadlift": [G, G, G],
        "plank": [G, G, G],
    },
]
#: The run's day (week index, weekday) whose plank mark is entered the next morning.
LATE_MARK = (1, 4)


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
    """The demo weeks as an export file of the current version, ending this week; days after
    `today` stay empty. It fills the first three trackers, which every account has."""
    monday = today - timedelta(days=today.weekday())
    weeks = [monday - timedelta(weeks=2), monday - timedelta(weeks=1), monday]

    def section(items: list[dict[str, object]], marks: list[Week]) -> dict[str, object]:
        log: dict[str, Week] = {}
        for start, days_by_item in zip(weeks, marks, strict=True):
            week = start.isoformat()
            log[week] = {
                item: [
                    m if start + timedelta(days=i) <= today else None for i, m in enumerate(days)
                ]
                for item, days in days_by_item.items()
            }
        return {"plans": {w.isoformat(): items for w in weeks}, "log": log}

    return json.dumps(
        {
            "format": EXPORT_FORMAT,
            "version": EXPORT_VERSION,
            "sections": {
                "exercise": section(EXERCISES, EXERCISE_WEEKS),
                "cardio": section(CARDIO, CARDIO_WEEKS),
                "diet": section(FOODS, FOOD_WEEKS),
            },
            "details": {
                "exercise": EXERCISE_DETAILS,
                "cardio": CARDIO_DETAILS,
                "diet": FOOD_DETAILS,
            },
            "settings": {"accent": "#30d158", "dailyPick": 3, "foodPick": 2, "dailyGoal": True},
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
    result: SeedResult = {
        "created": created,
        "weeks": added["weeks"],
        "ticks": added["ticks"],
        "details": added["details"],
        "programmes": 0,
        "runs": 0,
        "shared": 0,
    }
    _seed_programme(conn, config, user_id, result)
    result["shared"] = _seed_shared(conn, config)
    return result


def _seed_shared(conn: sqlite3.Connection, config: Config) -> int:
    """Add SHARED_PROGRAMME to the shared library when it has none; how many were added. It
    names no publisher and no source, as a programme whose admin's account is gone."""
    with transaction(conn):
        if conn.execute("SELECT 1 FROM shared_programmes LIMIT 1").fetchone() is not None:
            return 0
        now = config.clock()
        conn.execute(
            "INSERT INTO shared_programmes (id, name, doc_json, rev, published_by, source_id,"
            " published_at, updated_at) VALUES (?, ?, ?, 1, NULL, NULL, ?, ?)",
            (
                DEMO_SHARED,
                SHARED_PROGRAMME["name"],
                encode_programme(SHARED_PROGRAMME),
                now,
                now,
            ),
        )
    return 1


def _fixed(new: str) -> Callable[[Container[str]], str]:
    """A `make_id` that gives `new`, which the caller has checked is free."""

    def make_id(taken: Container[str]) -> str:
        assert new not in taken
        return new

    return make_id


def _at(config: Config, day: date, hour: int) -> When:
    """`When` at `hour` o'clock on `day` in the server's time zone: the run's past, as lived."""
    moment = datetime.combine(day, time(hour), tzinfo=config.timezone)
    return When(int(moment.timestamp()), config.timezone)


def _count(conn: sqlite3.Connection, table: str, user_id: int, section: str) -> int:
    row = conn.execute(
        f"SELECT count(*) FROM {table} WHERE user_id = ? AND section = ?",  # noqa: S608
        (user_id, section),
    ).fetchone()
    return int(row[0])


@dataclass(frozen=True)
class _Change:
    body: dict[str, Any]
    reason: str


@dataclass(frozen=True)
class _Tick:
    day: date
    item: str
    #: One of RUN_MARKS' marks: G, P, M or GS.
    mark: Mark


def _run_steps(config: Config, start: date, today: date) -> list[tuple[When, _Change | _Tick]]:
    """The run's changes and marks after its start, each at the time it happened, in order. A
    session on or after today is left for the person to mark."""
    steps: list[tuple[When, _Change | _Tick]] = [
        (_at(config, start + timedelta(days=d), 7), _Change(body, why))
        for d, body, why in RUN_CHANGES
    ]
    for w, week in enumerate(RUN_MARKS):
        for item, marks in week.items():
            for i, mark in enumerate(marks):
                day = start + timedelta(weeks=w, days=2 * i)
                if mark is None or day >= today:
                    continue
                late = item == "plank" and (w, 2 * i) == LATE_MARK
                when = _at(config, day + timedelta(days=1), 8) if late else _at(config, day, 19)
                steps.append((when, _Tick(day, item, cast(Mark, mark))))
    return sorted(steps, key=lambda step: step[0].now)


def _seed_programme(
    conn: sqlite3.Connection, config: Config, user_id: int, result: SeedResult
) -> None:
    """Add the demo programme to the library and start its run, each only when it is missing.
    The run's weeks, marks and details count in `result` with the rest."""
    now = When(config.clock(), config.timezone)
    quota = config.user_quota_bytes
    if load_programme(conn, user_id, DEMO_PROGRAMME) is None:
        add_programme(
            conn, user_id, PROGRAMME, now.now, quota=quota, make_id=_fixed(DEMO_PROGRAMME)
        )
        result["programmes"] += 1
    if load_tracker(conn, user_id, DEMO_RUN) is not None:
        return
    start = now.today - timedelta(days=now.today.weekday(), weeks=RUN_WEEKS_BACK)
    start_programme(
        conn,
        user_id,
        DEMO_PROGRAMME,
        start=start.isoformat(),
        when=_at(config, start, 7),
        quota=quota,
        make_id=_fixed(DEMO_RUN),
    )
    ticks = 0
    for when, step in _run_steps(config, start, now.today):
        if isinstance(step, _Tick):
            monday = step.day - timedelta(days=step.day.weekday())
            set_tick(
                conn,
                user_id,
                DEMO_RUN,
                monday.isoformat(),
                step.item,
                step.day.weekday(),
                step.mark,
                quota=quota,
                when=when,
            )
            ticks += 1
            continue
        # A change is previewed, then confirmed with the preview's rev, as the app does.
        on = when.today.isoformat()
        args: dict[str, Any] = {"reason": step.reason, "when": when, "quota": quota}
        preview = change_run(conn, user_id, DEMO_RUN, step.body, on, **args)
        assert preview is not None  # the run was started above
        change_run(conn, user_id, DEMO_RUN, step.body, on, confirm=True, rev=preview["rev"], **args)
    # The first read today would seal the days up to yesterday; seal them now.
    seal_runs(conn, user_id, now)
    result["runs"] += 1
    result["weeks"] += _count(conn, "plans", user_id, DEMO_RUN)
    result["details"] += _count(conn, "item_details", user_id, DEMO_RUN)
    result["ticks"] += ticks
