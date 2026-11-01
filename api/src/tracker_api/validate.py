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
from dataclasses import dataclass, field
from typing import Any, Literal, NotRequired, TypedDict, TypeIs, cast

from .item_sections import ItemSections, normalise_item_sections

# Re-exported: the rest of the API reads the sections from here, beside the normalisers.
from .types import EXERCISE, FOOD, SECTION_TYPES, TypeId
from .types import SECTIONS as SECTIONS
from .types import Section as Section

EXPORT_FORMAT = "tracker-export"
#: Files exported under the app's earlier names (Fitness Planner, and Exercise Planner before it)
#: carry these formats; they import as if current.
OLD_EXPORT_FORMATS = ("fitness-planner-export", "exercise-planner-export")
#: Version 5 files carry each item's details (notes and fields) once per section, beside its plans
#: and log. Version 4 files may carry a note on an exercise or a food in a week's plan (K43); it
#: lifts into the item's details on import, the latest week's winning. Version 3 files carry a mark
#: per day with its drawing (`great`, `partial-solid`, `missed-hatch` … or null). Version 2 files
#: carry the kinds alone, which read as the zigzag; version 1 files a `true` per done day, which
#: reads as `great`. All five import.
EXPORT_VERSION = 5
#: The last version whose notes live in plan items.
LAST_ITEM_NOTES_VERSION = 4
READ_VERSIONS = (1, 2, 3, LAST_ITEM_NOTES_VERSION, EXPORT_VERSION)

MIN_TARGET, MAX_TARGET = 0, 7
MIN_DAILY_PICK, MAX_DAILY_PICK = 1, 8
NEW_EXERCISE_TARGET = EXERCISE.new_target
NEW_FOOD_TARGET = FOOD.new_target
MAX_WEIGHT = 500
MAX_SETS = 20
MAX_DURATION = 3600
#: A plan item's note's length, in characters, from export version 4 (K43).
MAX_NOTES = 500
#: An item's name, in characters, for `strict_item` (MCP writes). REST and the web app set no cap.
MAX_NAME = 80
#: An item's id, in characters: the bounds of the ticks and details paths, and of MCP writes.
MAX_ITEM_ID = 128
#: An item's details: its notes in code points, each field's text in code points, how many fields,
#: and the whole document as stored (compact JSON, UTF-8) in bytes.
MAX_DETAILS_NOTES = 20_000
MAX_FIELD = 500
MAX_FIELDS = 32
MAX_DETAILS_BYTES = 32 * 1024
DEFAULT_ACCENT = "#30d158"
DEFAULT_DAILY_PICK = 3
#: Foods a day (K57), in the same bounds as the daily pick.
DEFAULT_FOOD_PICK = 2

# `[0-9]` rather than `\d`, which in Python also matches non-ASCII digits; fullmatch rather than
# `$`, which in Python also matches before a trailing newline.
WEEK_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
ACCENT_RE = re.compile(r"#[0-9a-fA-F]{6}")
#: A details field's key: lower case, a letter first, at most 32 characters.
FIELD_KEY_RE = re.compile(r"[a-z][a-z0-9_]{0,31}")

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


class Details(TypedDict, total=False):
    """One item's details, the same for every week (D2). A key is left out when blank, so `{}` is
    an item with none."""

    notes: str
    #: Text fields by key. The type's field list (types.py) names the ones the app shows; keys it
    #: does not list are kept, so changing the list never loses text.
    fields: dict[str, str]


#: Each item's details by item id; an item with none (an empty document) is left out.
type DetailsMap = dict[str, Details]


class Tracked(TypedDict):
    plans: Plans
    log: Log
    details: DetailsMap


class Portable(TypedDict):
    """The settings that belong to the person rather than the device: everything but the theme."""

    accent: str
    dailyPick: int
    foodPick: int
    #: Each type's item-page arrangement (K66, P29); left out while every page has the default.
    itemSections: NotRequired[ItemSections]


class ExportData(TypedDict):
    exercise: Tracked
    diet: Tracked
    settings: Portable | None


class Summary(TypedDict):
    weeks: int
    ticks: int
    details: int


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


BLANK = " \t\n\r"


def normalise_text(v: object, limit: int) -> str | None:
    """A usable text: a string with spaces, tabs and line breaks trimmed from its ends, cut to
    `limit` code points and trimmed again; None for anything else or for nothing left."""
    if not isinstance(v, str):
        return None
    text = v.strip(BLANK)[:limit].strip(BLANK)
    return text or None


def normalise_notes(v: object) -> str | None:
    """A plan item's note from export version 4 (K43): text cut to MAX_NOTES characters. The web
    app's `normaliseNotes` does the same."""
    return normalise_text(v, MAX_NOTES)


def normalise_fields(v: object) -> dict[str, str]:
    """Text fields: keys matching FIELD_KEY_RE, any of them (D2), with text cut to MAX_FIELD code
    points; blanks drop out, and the first MAX_FIELDS that remain are kept."""
    fields: dict[str, str] = {}
    if not isinstance(v, dict):
        return fields
    for key, raw in v.items():
        if len(fields) == MAX_FIELDS:
            break
        text = normalise_text(raw, MAX_FIELD)
        if text is not None and FIELD_KEY_RE.fullmatch(key):
            fields[key] = text
    return fields


def normalise_details(v: object) -> Details | None:
    """An item's details document, or None when `v` is not an object. Blank notes and an empty
    `fields` are left out, so an item with no details is `{}`; other keys are dropped. The size
    cap is separate (`details_fit`): normalising never refuses."""
    if not isinstance(v, dict):
        return None
    out: Details = {}
    notes = normalise_text(v.get("notes"), MAX_DETAILS_NOTES)
    if notes is not None:
        out["notes"] = notes
    fields = normalise_fields(v.get("fields"))
    if fields:
        out["fields"] = fields
    return out


def encode_details(details: Details) -> str:
    """The stored form: compact JSON with text as written, so its UTF-8 length is what the
    quota and the size cap count. JavaScript's `JSON.stringify` writes the same text."""
    return json.dumps(details, ensure_ascii=False, separators=(",", ":"))


def details_fit(details: Details) -> bool:
    """Whether a document is within MAX_DETAILS_BYTES as stored."""
    return len(encode_details(details).encode()) <= MAX_DETAILS_BYTES


def is_item_id(v: object) -> TypeIs[str]:
    """An id the ticks and details paths can name: a string of 1 to MAX_ITEM_ID characters."""
    return isinstance(v, str) and 1 <= len(v) <= MAX_ITEM_ID


def normalise_details_map(v: object) -> DetailsMap:
    """A file's details for one section: a usable document per usable item id. Documents that are
    empty or over the size cap drop out, as does a `__proto__` key (JavaScript would set the
    object's prototype instead)."""
    out: DetailsMap = {}
    if not isinstance(v, dict):
        return out
    for item_id, raw in v.items():
        details = normalise_details(raw)
        if is_item_id(item_id) and item_id != "__proto__" and details and details_fit(details):
            out[item_id] = details
    return out


def lift_notes(section: Section, v: object) -> DetailsMap:
    """A version 4 file's plan notes as details (D3): per item, the note from the latest week
    whose copy of the item has one, the first such copy in that week. Only items the plan keeps
    count. Migration 7 (db.py) reads stored plans by the same rule."""
    out: DetailsMap = {}
    if not isinstance(v, dict):
        return out
    normalise = NORMALISERS[section]
    weeks = sorted((w for w, items in v.items() if is_week(w) and isinstance(items, list)))
    for week in reversed(weeks):
        for raw in v[week]:
            if normalise(raw) is None:
                continue
            item_id, notes = raw["id"], normalise_notes(raw.get("notes"))
            if notes is not None and is_item_id(item_id) and item_id != "__proto__":
                out.setdefault(item_id, {"notes": notes})
    return out


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
    # An item keeps no `notes` (D3): they are the item's details, one copy for every week.
    return out


def normalise_food(v: object) -> Item | None:
    if (
        not isinstance(v, dict)
        or not isinstance(v.get("id"), str)
        or not isinstance(v.get("name"), str)
    ):
        return None
    target = clamp(to_int(v.get("target"), NEW_FOOD_TARGET), MIN_TARGET, MAX_TARGET)
    return {"id": v["id"], "name": v["name"], "target": target}


type Normaliser = Callable[[object], Item | None]

#: Each type's item normaliser, and through the registry each section's.
_TYPE_NORMALISERS: dict[TypeId, Normaliser] = {
    EXERCISE.id: normalise_exercise,
    FOOD.id: normalise_food,
}
NORMALISERS: dict[Section, Normaliser] = {
    name: _TYPE_NORMALISERS[tracker_type.id] for name, tracker_type in SECTION_TYPES.items()
}


def is_week(key: str) -> bool:
    return WEEK_RE.fullmatch(key) is not None


class Invalid(ValueError):
    """A request rejected by a shared check. REST answers it `400 invalid`; MCP tools say why."""


def week_key(week: str) -> str:
    """`week` when it has the `yyyy-mm-dd` shape, else `Invalid`. Not checked as a date or a
    Monday: REST keeps this shape-only rule so older clients can't break. MCP tools also check
    `insights.is_monday`."""
    if not is_week(week):
        raise Invalid("week must look like 2026-10-19")
    return week


def check_plan_body(body: dict[str, Any]) -> tuple[list[Any], int]:
    """A plan write's `items` (a list) and `rev` (an int from 0 up, not a bool)."""
    items, rev = body.get("items"), body.get("rev")
    if not isinstance(items, list) or type(rev) is not int or rev < 0:
        raise Invalid("items must be a list and rev a whole number from 0")
    return items, rev


def check_details_body(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """A details write's `details` (an object) and `rev` (an int from 0 up, not a bool)."""
    details, rev = body.get("details"), body.get("rev")
    if not isinstance(details, dict) or type(rev) is not int or rev < 0:
        raise Invalid("details must be an object and rev a whole number from 0")
    return details, rev


def check_item_id(item_id: str) -> str:
    if not 1 <= len(item_id) <= MAX_ITEM_ID:
        raise Invalid(f"item id must be 1 to {MAX_ITEM_ID} characters")
    return item_id


def check_day(day: int) -> int:
    if not 0 <= day <= 6:
        raise Invalid("day must be 0 (Monday) to 6 (Sunday)")
    return day


def tick_mark(body: dict[str, Any]) -> Mark | None:
    """`{"mark": ...}`, or `{"done": bool}` from a client (or a queued tick) from before marks
    had kinds: true is `great`, false clears the day."""
    if "mark" in body:
        mark = body["mark"]
        if mark is not None and not is_mark(mark):
            raise Invalid("mark is not one of the nine marks")
        return mark
    done = body.get("done")
    if not isinstance(done, bool):
        raise Invalid("send mark, or done as true or false")
    return "great" if done else None


@dataclass(frozen=True)
class StrictItem:
    """`item` is the normalised item, or None with `problems` saying why in plain English."""

    item: Item | None
    problems: list[str] = field(default_factory=list)


def strict_item(section: Section, raw: object) -> StrictItem:
    """Like the section's normaliser, but names what is wrong rather than dropping the item.

    Follows the web app's rules (`src/stores/planner.ts`): names are trimmed and may not be empty,
    and an exercise counts reps or seconds, not both. It also caps names at `MAX_NAME`.
    """
    if not isinstance(raw, dict):
        return StrictItem(None, ["item is not an object"])
    problems: list[str] = []
    item_id = raw.get("id")
    if not isinstance(item_id, str):
        problems.append("id is missing")
    elif not 1 <= len(item_id) <= MAX_ITEM_ID:
        problems.append(f"id must be 1 to {MAX_ITEM_ID} characters")
    name = raw.get("name")
    name = name.strip() if isinstance(name, str) else ""
    if not name:
        problems.append("name is empty")
    elif len(name) > MAX_NAME:
        problems.append(f"name is over {MAX_NAME} characters")
    if (
        SECTION_TYPES[section] is EXERCISE
        and to_int(raw.get("reps"), 0) > 0
        and to_int(raw.get("duration"), 0) > 0
    ):
        problems.append("give reps or seconds, not both")
    if problems:
        return StrictItem(None, problems)
    item = NORMALISERS[section]({**raw, "name": name})
    # The checks above cover what the normaliser rejects, so it never returns None here.
    assert item is not None
    return StrictItem(item)


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
    out: Portable = {
        "accent": accent
        if isinstance(accent, str) and ACCENT_RE.fullmatch(accent)
        else DEFAULT_ACCENT,
        "dailyPick": clamp(
            to_int(v.get("dailyPick"), DEFAULT_DAILY_PICK), MIN_DAILY_PICK, MAX_DAILY_PICK
        ),
        "foodPick": clamp(
            to_int(v.get("foodPick"), DEFAULT_FOOD_PICK), MIN_DAILY_PICK, MAX_DAILY_PICK
        ),
    }
    item_sections = normalise_item_sections(v.get("itemSections"))
    if item_sections:
        out["itemSections"] = item_sections
    return out


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


def section(name: Section, v: object, *, item_notes: bool) -> Tracked:
    """One section of a file. With `item_notes` (a file of version 4 or older) the details come
    from the plans' notes, and any `details` key is not read."""
    if not isinstance(v, dict):
        return {"plans": {}, "log": {}, "details": {}}
    plans = v.get("plans")
    details = lift_notes(name, plans) if item_notes else normalise_details_map(v.get("details"))
    return {
        "plans": normalise_plans(name, plans),
        "log": normalise_log(v.get("log")),
        "details": details,
    }


def parse_export(text: str) -> ExportData:
    """Read an export file, or raise ExportError. Valid files normalise like stored data."""
    parsed = parse_json(text)
    if parsed is None:
        raise ExportError("json")
    if not isinstance(parsed, dict):
        raise ExportError("format")
    if parsed.get("format") not in (EXPORT_FORMAT, *OLD_EXPORT_FORMATS):
        raise ExportError("format")
    version = as_number(parsed.get("version"))
    if version is None or version not in READ_VERSIONS:
        raise ExportError("version")
    item_notes = version <= LAST_ITEM_NOTES_VERSION
    settings = parsed.get("settings")
    # ExportData's keys are the registry's sections and settings (tests/test_types.py).
    data: dict[str, object] = {
        name: section(name, parsed.get(name), item_notes=item_notes) for name in SECTIONS
    }
    data["settings"] = normalise_portable(settings) if isinstance(settings, dict) else None
    return cast(ExportData, data)


NO_DAYS: Days = [None] * 7


def merge_tracked(existing: Tracked, incoming: Tracked) -> Tracked:
    """Merge without deleting: existing weeks keep their plan, per week, item and day a marked
    day keeps its mark while an empty one takes the file's, and an item with details keeps them
    while one without takes the file's. Returns new objects."""
    plans = copy.deepcopy(existing["plans"])
    for week, items in incoming["plans"].items():
        if week not in plans:
            plans[week] = copy.deepcopy(items)
    details = copy.deepcopy(existing["details"])
    for item_id, doc in incoming["details"].items():
        if item_id not in details:
            details[item_id] = copy.deepcopy(doc)
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
    return {"plans": plans, "log": log, "details": details}


def merge_summary(existing: Tracked, incoming: Tracked) -> Summary:
    """What a merge would add: weeks that gain a plan, empty days that gain a mark, and items
    that gain details."""
    weeks = sum(1 for w in incoming["plans"] if w not in existing["plans"])
    ticks = 0
    for week, entries in incoming["log"].items():
        for item_id, days in entries.items():
            mine = existing["log"].get(week, {}).get(item_id, NO_DAYS)
            ticks += sum(1 for i, m in enumerate(days) if m is not None and mine[i] is None)
    details = sum(1 for i in incoming["details"] if i not in existing["details"])
    return {"weeks": weeks, "ticks": ticks, "details": details}


def merge_settings(existing: Portable | None, incoming: Portable | None) -> Portable | None:
    """Saved settings win; the file's apply only where none are saved."""
    return existing if existing is not None else incoming


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
