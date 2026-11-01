"""The port of src/lib/storage.ts's normalisers and src/lib/transfer.ts's parse and merge rules.

Each function mirrors its TypeScript namesake. Where Python's defaults differ from JavaScript's,
the code follows JavaScript: halves round up (`Math.round`), `True` is not a number, `NaN` is not
JSON, and week keys need ASCII digits with nothing after them. `tests/test_parity.py` runs the
shared fixtures in `fixtures/transfer/` to keep the two in step.
"""

import copy
import json
import math
import re
import sys
from collections.abc import Callable
from typing import Any, Literal, TypedDict, TypeIs, cast

EXPORT_FORMAT = "tracker-export"
#: Files exported under the app's earlier names (Fitness Planner, and Exercise Planner before it)
#: carry these formats; they import as if current.
OLD_EXPORT_FORMATS = ("fitness-planner-export", "exercise-planner-export")
#: Version 4 files may carry a note on an exercise or a food (K43). Version 3 files carry a mark
#: per day with its drawing (`great`, `partial-solid`, `missed-hatch` … or null). Version 2 files
#: carry the kinds alone, which read as the zigzag; version 1 files a `true` per done day, which
#: reads as `great`. All four import. Settings may carry My goals (`goals`) with no new version, as
#: `foodPick` came: a reader from before them drops the key, and a file without them reads as none.
EXPORT_VERSION = 4
READ_VERSIONS = (1, 2, 3, EXPORT_VERSION)

MIN_TARGET, MAX_TARGET = 0, 7
MIN_DAILY_PICK, MAX_DAILY_PICK = 1, 8
NEW_EXERCISE_TARGET = 3
NEW_FOOD_TARGET = 3
MAX_WEIGHT = 500
MAX_SETS = 20
MAX_DURATION = 3600
#: A note's length, in characters.
MAX_NOTES = 500
#: My goals' length, in characters (code points).
MAX_GOALS = 1000
DEFAULT_ACCENT = "#30d158"
DEFAULT_DAILY_PICK = 3
#: Foods a day (K57), in the same bounds as the daily pick.
DEFAULT_FOOD_PICK = 2

Section = Literal["exercise", "diet"]
SECTIONS: tuple[Section, ...] = ("exercise", "diet")

# `[0-9]` rather than `\d`, which in Python also matches non-ASCII digits; fullmatch rather than
# `$`, which in Python also matches before a trailing newline.
WEEK_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
ACCENT_RE = re.compile(r"#[0-9a-fA-F]{6}")

type Item = dict[str, Any]
type Plans = dict[str, list[Item]]
#: How a marked day went: done well, done in part, or tried and couldn't. Every kind counts.
type MarkKind = Literal["great", "partial", "missed"]
MARK_KINDS: tuple[MarkKind, ...] = ("great", "partial", "missed")
#: A marked day: its kind, and the drawing a press chose for it (K17). The zigzag is the plain
#: kind, as every mark stored before drawings reads; the solid and the hatch add theirs.
type Mark = Literal[
    "great",
    "partial",
    "missed",
    "great-solid",
    "partial-solid",
    "missed-solid",
    "great-hatch",
    "partial-hatch",
    "missed-hatch",
]
#: Every mark, drawing first, as the web app's press steps through them.
MARKS: tuple[Mark, ...] = (
    "great",
    "partial",
    "missed",
    "great-solid",
    "partial-solid",
    "missed-solid",
    "great-hatch",
    "partial-hatch",
    "missed-hatch",
)
#: One item's week: a mark or None for each day, Monday first.
type Days = list[Mark | None]
type Log = dict[str, dict[str, Days]]


class Tracked(TypedDict):
    plans: Plans
    log: Log


class Portable(TypedDict):
    """The settings that belong to the person rather than the device: everything but the theme."""

    accent: str
    dailyPick: int
    foodPick: int
    #: My goals, in the person's words; "" when there are none.
    goals: str


class ExportData(TypedDict):
    exercise: Tracked
    diet: Tracked
    settings: Portable | None


class Summary(TypedDict):
    weeks: int
    ticks: int


class ExportError(ValueError):
    """An export file rejected whole: `code` is `json`, `format` or `version`."""

    def __init__(self, code: Literal["json", "format", "version"]) -> None:
        super().__init__(code)
        self.code = code


def as_number(v: object) -> float | None:
    """What JavaScript's JSON.parse makes of `v`, when that is a finite number; else None.

    JavaScript has one number type: an integer past a double's range parses as Infinity, and a
    large one rounds to the nearest double. `bool` is not a number.
    """
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    if isinstance(v, int):
        if abs(v) > sys.float_info.max:
            return None
        v = float(v)
    return v if math.isfinite(v) else None


def js_round(x: float) -> int:
    """`Math.round`: halves go up (2.5 → 3, -2.5 → -2), not to even as `round()` does."""
    floor = math.floor(x)
    return floor + 1 if x - floor >= 0.5 else floor


def to_int(v: object, fallback: int) -> int:
    n = as_number(v)
    return fallback if n is None else js_round(n)


def clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def whole(x: float) -> int | float:
    """12.0 → 12, so JSON output matches JavaScript's (which has one number type)."""
    return int(x) if x.is_integer() else x


def normalise_weight(v: object) -> int | float | None:
    """A usable weight in kg, rounded to 2 decimals and capped; None means "no weight"."""
    n = as_number(v)
    if n is None:
        return None
    scaled = n * 100
    # Scaling can overflow to ±Infinity, which Math.round passes through and the cap then catches.
    kg = js_round(scaled) / 100 if math.isfinite(scaled) else scaled
    return whole(min(MAX_WEIGHT, kg)) if kg > 0 else None


def normalise_notes(v: object) -> str | None:
    """A usable note: a string with spaces, tabs and line breaks trimmed from its ends, cut to
    MAX_NOTES characters; None for anything else or for nothing left. The web app's
    `normaliseNotes` does the same."""
    return _cut_text(v, MAX_NOTES) or None


def normalise_goals(v: object) -> str:
    """My goals, trimmed and cut as a note is but to MAX_GOALS characters; "" for anything that
    isn't a string or for nothing left. The web app's `normaliseGoals` does the same."""
    return _cut_text(v, MAX_GOALS)


def _cut_text(v: object, limit: int) -> str:
    """A string trimmed of spaces, tabs and line breaks at its ends and cut to `limit` code
    points; "" for anything that isn't a string."""
    if not isinstance(v, str):
        return ""
    return v.strip(" \t\n\r")[:limit].strip(" \t\n\r")


def normalise_exercise(v: object) -> Item | None:
    if (
        not isinstance(v, dict)
        or not isinstance(v.get("id"), str)
        or not isinstance(v.get("name"), str)
    ):
        return None
    out: Item = {"id": v["id"], "name": v["name"]}
    sets = to_int(v.get("sets"), 0)
    if sets > 0:
        out["sets"] = min(MAX_SETS, sets)
    out["reps"] = max(0, to_int(v.get("reps"), 0))
    duration = to_int(v.get("duration"), 0)
    if duration > 0:
        out["duration"] = min(MAX_DURATION, duration)
    if isinstance(v.get("perSide"), bool):
        out["perSide"] = v["perSide"]
    weight = normalise_weight(v.get("weight"))
    if weight is not None:
        out["weight"] = weight
    out["target"] = clamp(to_int(v.get("target"), NEW_EXERCISE_TARGET), MIN_TARGET, MAX_TARGET)
    notes = normalise_notes(v.get("notes"))
    if notes is not None:
        out["notes"] = notes
    return out


def normalise_food(v: object) -> Item | None:
    if (
        not isinstance(v, dict)
        or not isinstance(v.get("id"), str)
        or not isinstance(v.get("name"), str)
    ):
        return None
    target = clamp(to_int(v.get("target"), NEW_FOOD_TARGET), MIN_TARGET, MAX_TARGET)
    out: Item = {"id": v["id"], "name": v["name"], "target": target}
    notes = normalise_notes(v.get("notes"))
    if notes is not None:
        out["notes"] = notes
    return out


NORMALISERS = {"exercise": normalise_exercise, "diet": normalise_food}


def is_week(key: str) -> bool:
    return WEEK_RE.fullmatch(key) is not None


def is_mark(v: object) -> TypeIs[Mark]:
    return isinstance(v, str) and v in MARKS


def normalise_mark(v: object) -> Mark | None:
    """One stored day: a mark as it is, a `true` from before marks had kinds as `great`, else
    None. Nothing else counts: not `1`, `"true"` or `"GREAT"`."""
    if v is True:
        return "great"
    return v if is_mark(v) else None


def normalise_days(v: list[Any]) -> Days:
    """Exactly seven days, each a mark or None."""
    return [normalise_mark(v[i]) if i < len(v) else None for i in range(7)]


def normalise_log(v: object) -> Log:
    log: Log = {}
    if not isinstance(v, dict):
        return log
    for week, entries in v.items():
        if not is_week(week) or not isinstance(entries, dict):
            continue
        # JavaScript drops a `__proto__` entry: assigning it sets the object's prototype instead.
        log[week] = {
            i: normalise_days(d)
            for i, d in entries.items()
            if isinstance(d, list) and i != "__proto__"
        }
    return log


def normalise_items(section: Section, v: list[Any]) -> list[Item]:
    """A plan's items, dropping any that fail validation."""
    normalise = NORMALISERS[section]
    return [it for it in map(normalise, v) if it is not None]


def normalise_plans(section: Section, v: object) -> Plans:
    plans: Plans = {}
    if not isinstance(v, dict):
        return plans
    for week, items in v.items():
        if is_week(week) and isinstance(items, list):
            plans[week] = normalise_items(section, items)
    return plans


def normalise_portable(v: dict[str, Any]) -> Portable:
    accent = v.get("accent")
    return {
        "accent": accent
        if isinstance(accent, str) and ACCENT_RE.fullmatch(accent)
        else DEFAULT_ACCENT,
        "dailyPick": clamp(
            to_int(v.get("dailyPick"), DEFAULT_DAILY_PICK), MIN_DAILY_PICK, MAX_DAILY_PICK
        ),
        "foodPick": clamp(
            to_int(v.get("foodPick"), DEFAULT_FOOD_PICK), MIN_DAILY_PICK, MAX_DAILY_PICK
        ),
        "goals": normalise_goals(v.get("goals")),
    }


def _reject_constant(name: str) -> None:
    raise ValueError(name)


def parse_json(text: str) -> object:
    """`JSON.parse`, which has no NaN or Infinity; None for anything that is not JSON.

    Two cases differ from JavaScript on purpose. Nesting deep enough to exhaust Python's recursion
    limit, which no export comes near, and strings holding a lone surrogate (`"\\ud800"`), which
    SQLite cannot store as UTF-8, both count as not JSON.
    """
    try:
        parsed = json.loads(text, parse_constant=_reject_constant)
        json.dumps(parsed, ensure_ascii=False).encode("utf-8")
    except (ValueError, RecursionError):
        return None
    return parsed


def section(name: Section, v: object) -> Tracked:
    if not isinstance(v, dict):
        return {"plans": {}, "log": {}}
    return {"plans": normalise_plans(name, v.get("plans")), "log": normalise_log(v.get("log"))}


def parse_export(text: str) -> ExportData:
    """Read an export file, or raise ExportError. Valid files normalise like stored data."""
    parsed = parse_json(text)
    if parsed is None:
        raise ExportError("json")
    if not isinstance(parsed, dict):
        raise ExportError("format")
    if parsed.get("format") not in (EXPORT_FORMAT, *OLD_EXPORT_FORMATS):
        raise ExportError("format")
    if as_number(parsed.get("version")) not in READ_VERSIONS:
        raise ExportError("version")
    settings = parsed.get("settings")
    return {
        "exercise": section("exercise", parsed.get("exercise")),
        "diet": section("diet", parsed.get("diet")),
        "settings": normalise_portable(settings) if isinstance(settings, dict) else None,
    }


NO_DAYS: Days = [None] * 7


def merge_tracked(existing: Tracked, incoming: Tracked) -> Tracked:
    """Merge without deleting: existing weeks keep their plan, and per week, item and day a marked
    day keeps its mark while an empty one takes the file's. Returns new objects."""
    plans = copy.deepcopy(existing["plans"])
    for week, items in incoming["plans"].items():
        if week not in plans:
            plans[week] = copy.deepcopy(items)
    log: Log = {}
    for week in {**existing["log"], **incoming["log"]}:
        mine = existing["log"].get(week, {})
        theirs = incoming["log"].get(week, {})
        log[week] = {
            i: [
                a if a is not None else b
                for a, b in zip(mine.get(i, NO_DAYS), theirs.get(i, NO_DAYS), strict=True)
            ]
            for i in {**mine, **theirs}
        }
    return {"plans": plans, "log": log}


def merge_summary(existing: Tracked, incoming: Tracked) -> Summary:
    """What a merge would add: weeks that gain a plan, and empty days that gain a mark."""
    weeks = sum(1 for w in incoming["plans"] if w not in existing["plans"])
    ticks = 0
    for week, entries in incoming["log"].items():
        for item_id, days in entries.items():
            mine = existing["log"].get(week, {}).get(item_id, NO_DAYS)
            ticks += sum(1 for i, m in enumerate(days) if m is not None and mine[i] is None)
    return {"weeks": weeks, "ticks": ticks}


def merge_settings(existing: Portable | None, incoming: Portable | None) -> Portable | None:
    """Saved settings win; the file's apply only where none are saved. The one exception is My
    goals: the file's fill saved goals that are empty, and never replace ones that aren't."""
    if existing is None:
        return incoming
    if not existing["goals"] and incoming is not None and incoming["goals"]:
        return {**existing, "goals": incoming["goals"]}
    return existing


type Masks = tuple[int, int, int, int, int]


def _mask(days: Days, keep: Callable[[Mark], bool]) -> int:
    return sum(1 << i for i, m in enumerate(days[:7]) if m is not None and keep(m))


def days_to_masks(days: Days) -> Masks:
    """Seven marks as the `ticks` row's 7-bit masks, Monday in bit 0: `days` holds every marked
    day; `partial` and `missed` the days of that kind, and `solid` and `hatch` the days in that
    drawing, all inside `days`."""
    return (
        _mask(days, lambda m: True),
        _mask(days, lambda m: m.startswith("partial")),
        _mask(days, lambda m: m.startswith("missed")),
        _mask(days, lambda m: m.endswith("-solid")),
        _mask(days, lambda m: m.endswith("-hatch")),
    )


def masks_to_days(days: int, partial: int, missed: int, solid: int, hatch: int) -> Days:
    """A `ticks` row's masks as seven marks: a marked day in neither kind's mask is `great`, and
    in neither drawing's mask is the zigzag."""
    out: Days = []
    for i in range(7):
        bit = 1 << i
        if not days & bit:
            out.append(None)
            continue
        kind = "partial" if partial & bit else "missed" if missed & bit else "great"
        drawing = "-solid" if solid & bit else "-hatch" if hatch & bit else ""
        out.append(cast(Mark, kind + drawing))
    return out
