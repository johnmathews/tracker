"""The programme format, `tracker-programme/1` (spec docs/specs/2026-11-17-programmes.md §3).

A pure module: no database, no clock, no I/O. It parses a document and reports every error at once,
each with a JSON path and a plain sentence (§3.4); resolves the parameters a run starts with; and
expands each field for a programme week and an activity week (§3.2, §3.3). The arithmetic is in
decimals under one fixed context, so the same inputs give the same numbers on every machine.

The two weeks stay separate inputs. Overrides follow the programme week. A field's series follows
the activity week, which falls behind the programme week while an activity is paused (§6.3). A
`Series` can start from a later activity week (`origin`), which is how the replay continues a field
from the value shown when its value or increase changes (§7.1).

The JSON Schema (`programme_schema()`, committed as `programme.schema.json` beside this file) is
built from the same rule constants. Rules it can't express are the validator's alone: unique
activity keys, references to defined parameters, a parameter's min, max and default agreeing, a
parameter's value fitting each place that uses it, a weight or distance step in hundredths, every
week's value fitting the item, override weeks within the programme's weeks, at most one override a
week, overrides naming real activities, and overrides changing only fields the activity has.
`tests/test_programme.py` runs the shared fixtures in `fixtures/programmes/` against both.
"""

import json
import math
import re
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import (
    ROUND_HALF_EVEN,
    ROUND_HALF_UP,
    Context,
    Decimal,
    DivisionByZero,
    InvalidOperation,
    Overflow,
    localcontext,
)
from pathlib import Path
from typing import Any, Literal, cast

from .types import TYPES
from .validate import (
    MAX_CARDIO_DURATION,
    MAX_DAILY_PICK,
    MAX_DETAILS_NOTES,
    MAX_DISTANCE,
    MAX_DURATION,
    MAX_FIELD,
    MAX_NAME,
    MAX_SETS,
    MAX_TARGET,
    MAX_TRACKER_NAME,
    MAX_WEIGHT,
    MIN_DAILY_PICK,
    MIN_TARGET,
    whole,
)

FORMAT = "tracker-programme/1"
#: The generated schema, served as `GET /api/programme.schema.json`.
SCHEMA_PATH = Path(__file__).with_name("programme.schema.json")
SCHEMA_ID = "https://tracker.itsa-pizza.com/api/programme.schema.json"

type Kind = Literal["strength", "mobility", "cardio"]
KINDS: tuple[Kind, ...] = ("strength", "mobility", "cardio")
#: The numeric plan fields an activity can have, in the order an item writes them.
type Field = Literal["target", "sets", "reps", "duration", "weight", "distance"]
FIELDS: tuple[Field, ...] = ("target", "sets", "reps", "duration", "weight", "distance")

MAX_WEEKS = 52
MAX_DESCRIPTION = 2000
MAX_PARAMS = 20
MAX_ACTIVITIES = 30
MAX_KEY = 40
MAX_PARAM_LABEL = 60
MAX_UNIT = 20
MAX_OVERRIDE_LABEL = 40
#: validate.py caps no item's reps, so the format sets its own cap.
MAX_REPS = 1000
#: A rate is a percent above -100 (which would reach 0) and at most 1,000 (eleven times a step).
MIN_RATE, MAX_RATE = -100, 1000
#: The key that names every activity in an override.
ALL = "*"

KEY_PATTERN = f"[a-z0-9-]{{1,{MAX_KEY}}}"
KEY_RE = re.compile(KEY_PATTERN)
REF_RE = re.compile(rf"\$({KEY_PATTERN})")
#: Path segments written as `.key`; anything else is written as `["key"]`.
_PLAIN_RE = re.compile(r"[A-Za-z0-9_*-]+")

#: Every computation runs in this context, never the thread's: 28 digits, and an error rather than
#: a silent infinity or NaN.
_CTX = Context(
    prec=28,
    rounding=ROUND_HALF_EVEN,
    Emin=-999_999,
    Emax=999_999,
    traps=[InvalidOperation, DivisionByZero, Overflow],
)
#: No field takes a number this large, and keeping inputs under it keeps every computation far
#: from the context's overflow.
_HUGE = Decimal("1e100")
_HUNDREDTH = Decimal("0.01")
_ONE = Decimal(1)


# ---- Field rules ----


@dataclass(frozen=True)
class FieldRule:
    """What one plan field accepts, from the item caps in validate.py.

    A whole field (target, sets, reps, duration) takes whole numbers from `lo` to `hi`. A decimal
    field (weight, distance) takes numbers above 0 and at most `hi`, kept to hundredths.
    """

    name: Field
    is_whole: bool
    lo: int
    hi: int
    #: What a progression rounds to when it names no step (§3.2).
    step: Decimal
    #: The unit in an error's sentence.
    unit: str

    @property
    def precision(self) -> Decimal:
        """What a bare value rounds to: the item's own precision."""
        return _ONE if self.is_whole else _HUNDREDTH

    def fits(self, n: Decimal) -> bool:
        """Whether `n` is a value the item can hold."""
        if self.is_whole:
            return _is_whole(n) and self.lo <= n <= self.hi
        return 0 < n <= self.hi

    def fits_add(self, n: Decimal) -> bool:
        """A written add: whole for a whole field, and no bigger than the field's cap."""
        return (not self.is_whole or _is_whole(n)) and self.fits_resolved_add(n)

    def fits_resolved_add(self, n: Decimal) -> bool:
        """An add from a parameter needn't be whole: the value is rounded to the step anyway."""
        return -self.hi <= n <= self.hi

    def fits_step(self, n: Decimal) -> bool:
        if self.is_whole:
            return _is_whole(n) and n >= 1
        return n >= _HUNDREDTH and _is_whole(n / _HUNDREDTH)

    @property
    def domain(self) -> str:
        if self.is_whole:
            return f"a whole number from {number_text(self.lo)} to {number_text(self.hi)}"
        return f"a number above 0 and at most {number_text(self.hi)}"

    @property
    def add_range(self) -> str:
        return f"from {number_text(-self.hi)} to {number_text(self.hi)}"

    @property
    def add_domain(self) -> str:
        number = "a whole number" if self.is_whole else "a number"
        return f"{number} {self.add_range}"

    @property
    def step_message(self) -> str:
        if self.is_whole:
            return "give a whole number of 1 or more."
        return "give a number of 0.01 or more, with at most two decimals."

    def out_of_range(self, week: int, value: Decimal) -> str | None:
        """The sentence for a week whose value the item can't hold; None when it can."""
        shown = f"week {week} comes to {number_text(value)} {self.unit}."
        if value > self.hi:
            return f"{shown} The most is {number_text(self.hi)}."
        if self.is_whole and value < self.lo:
            return f"{shown} The least is {number_text(self.lo)}."
        if not self.is_whole and value <= 0:
            return f"{shown} It must be above 0."
        return None


def _rule(name: Field, hi: int, *, lo: int = 1, step: str = "1", unit: str) -> FieldRule:
    return FieldRule(name, name not in ("weight", "distance"), lo, hi, Decimal(step), unit)


TARGET = _rule("target", MAX_TARGET, lo=MIN_TARGET, unit="sessions a week")
SETS = _rule("sets", MAX_SETS, unit="sets")
REPS = _rule("reps", MAX_REPS, unit="reps")
DURATION = _rule("duration", MAX_DURATION, step="5", unit="s")
CARDIO_DURATION = _rule("duration", MAX_CARDIO_DURATION, step="5", unit="s")
WEIGHT = _rule("weight", MAX_WEIGHT, step="0.5", unit="kg")
DISTANCE = _rule("distance", MAX_DISTANCE, step="0.1", unit="km")

#: Each kind's plan fields (§3.1), as today's items have them (validate.normalise_*).
KIND_FIELDS: dict[Kind, dict[Field, FieldRule]] = {
    "strength": {r.name: r for r in (TARGET, SETS, REPS, DURATION, WEIGHT)},
    "mobility": {r.name: r for r in (TARGET, SETS, REPS, DURATION)},
    "cardio": {r.name: r for r in (TARGET, CARDIO_DURATION, DISTANCE)},
}
#: The kinds whose activities can be done each side.
PER_SIDE_KINDS: tuple[Kind, ...] = ("strength", "mobility")

_TOP_KEYS = (
    "format",
    "name",
    "description",
    "kind",
    "weeks",
    "dailyTarget",
    "params",
    "activities",
    "overrides",
)
_PARAM_KEYS = ("label", "unit", "default", "min", "max")
_TEXT_KEYS = ("key", "name", "notes", "link")
_PROGRESSION_KEYS = ("start", "add", "rate", "every", "max", "step")
_OVERRIDE_KEYS = ("weeks", "label", "activities")

UNKNOWN = "this key is not part of the format."
RATE_RANGE = f"above {MIN_RATE} and at most {MAX_RATE:,}"
RATE_DOMAIN = f"a number {RATE_RANGE}"


# ---- Errors ----


@dataclass(frozen=True)
class ProgrammeError:
    """One problem: where it is, as a JSON path (`activities[2].weight.rate`), and a sentence."""

    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}" if self.path else self.message


class ProgrammeInvalid(ValueError):
    """Every problem with a document, or with the parameters a run starts with."""

    def __init__(self, errors: Sequence[ProgrammeError]) -> None:
        self.errors = tuple(errors)
        count = len(self.errors)
        noun = "problem" if count == 1 else "problems"
        super().__init__(f"{count} {noun}: " + "; ".join(str(e) for e in self.errors))


# ---- The parsed programme ----

#: A number, or the key of a parameter (written `"$key"` in the document).
type Ref = Decimal | str


@dataclass(frozen=True, kw_only=True)
class Value:
    """A field's rule as the document writes it: a bare value, or a progression (§3.2).

    A bare value is `start` alone, with the item's precision for its step.
    """

    start: Ref
    step: Decimal
    add: Ref | None = None
    rate: Ref | None = None
    every: int = 1
    max: Decimal | None = None


@dataclass(frozen=True)
class Scale:
    """An override that scales the computed value before it is rounded (§3.3)."""

    factor: Decimal


#: An override's value: a number that replaces the computed one, or a scale.
type OverrideValue = Decimal | Scale


@dataclass(frozen=True, kw_only=True)
class Param:
    key: str
    label: str
    unit: str
    default: Decimal
    min: Decimal | None = None
    max: Decimal | None = None


@dataclass(frozen=True, kw_only=True)
class Activity:
    key: str
    name: str
    #: Each plan field the activity has. `target` is always here: the kind's default when the
    #: document leaves it out.
    values: Mapping[Field, Value]
    per_side: bool | None = None
    notes: str | None = None
    link: str | None = None


@dataclass(frozen=True, kw_only=True)
class Override:
    """A one-week exception for named programme weeks (§3.3), per activity key or `*`."""

    weeks: tuple[int, ...]
    label: str | None
    activities: Mapping[str, Mapping[Field, OverrideValue]]


def _override_at(
    overrides: Sequence[Override], week: int, key: str, name: Field
) -> OverrideValue | None:
    """An activity's own override for a field beats `*`'s, field by field."""
    for override in overrides:
        if week in override.weeks:
            own = override.activities.get(key, {})
            return own[name] if name in own else override.activities.get(ALL, {}).get(name)
    return None


@dataclass(frozen=True, kw_only=True)
class Programme:
    name: str
    description: str | None
    kind: Kind
    weeks: int
    #: None for cardio, which has no daily target.
    daily_target: int | None
    params: Mapping[str, Param]
    activities: tuple[Activity, ...]
    overrides: tuple[Override, ...]

    def activity(self, key: str) -> Activity:
        for activity in self.activities:
            if activity.key == key:
                return activity
        raise KeyError(key)

    def override_at(self, programme_week: int, key: str, name: Field) -> OverrideValue | None:
        """The override for one activity's field in a programme week, if any."""
        return _override_at(self.overrides, programme_week, key, name)

    def label_at(self, programme_week: int) -> str | None:
        """The label of the week's override ("Deload"), if it has one."""
        for override in self.overrides:
            if programme_week in override.weeks:
                return override.label
        return None


# ---- Series ----


def round_to_step(value: Decimal, step: Decimal) -> Decimal:
    """The nearest multiple of `step`, halves up (S2)."""
    with localcontext(_CTX):
        return (value / step).to_integral_value(rounding=ROUND_HALF_UP) * step


@dataclass(frozen=True, kw_only=True)
class Series:
    """A field's values, week by week, with every parameter resolved (§3.2).

    `start` is the value in activity week `origin` (1 for a document's own series). The replay
    starts a new series at a later activity week when a value or an increase changes (§7.1).
    Increases stay on the activity's own weeks (1, 1 + every, ...), whatever the origin.
    """

    start: Decimal
    step: Decimal
    add: Decimal | None = None
    rate: Decimal | None = None
    every: int = 1
    max: Decimal | None = None
    origin: int = 1

    def raw(self, activity_week: int) -> Decimal:
        """The computed value, capped at `max`, before any override and the rounding."""
        if activity_week < self.origin:
            raise ValueError(
                f"activity week {activity_week} is before its origin, week {self.origin}"
            )
        # Increases fall on activity weeks 1 + m * every, whatever the origin (plan §8.1): a
        # segment counts the increase weeks after its origin, it doesn't restart the count.
        steps = (activity_week - 1) // self.every - (self.origin - 1) // self.every
        with localcontext(_CTX):
            value = self.start
            if self.add is not None:
                value = self.start + self.add * steps
            elif self.rate is not None:
                value = self.start * (1 + self.rate / 100) ** steps
            return value if self.max is None else min(value, self.max)

    def value(self, activity_week: int, override: OverrideValue | None = None) -> Decimal:
        """The value shown: computed, capped, scaled by an override, then rounded to the step. A
        number override replaces it. Either way the next week follows the series."""
        if isinstance(override, Decimal):
            return override
        value = self.raw(activity_week)
        if override is not None:
            with localcontext(_CTX):
                value = value * override.factor
        return round_to_step(value, self.step)


@dataclass(frozen=True, kw_only=True)
class Resolved:
    """A programme with its parameters' values and each field's series."""

    programme: Programme
    params: Mapping[str, Decimal]
    series: Mapping[str, Mapping[Field, Series]]


#: One activity's plan fields for a week, as an item holds them (no id or name).
type PlanValues = dict[str, int | float | bool]


# ---- Helpers ----


def number_text(n: Decimal | int) -> str:
    """A number for a sentence: 2,000, 512.5, -501."""
    return f"{Decimal(n).normalize():,f}"


def _is_whole(n: Decimal) -> bool:
    return n == n.to_integral_value()


def as_decimal(v: object) -> Decimal | None:
    """A JSON number as a decimal; None for anything else (`true` is not a number)."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        n = Decimal(v)
    elif isinstance(v, float):
        if not math.isfinite(v):
            return None
        # The shortest repr reads back as the same float: 0.1 is 0.1, not 0.1000000000000000055...
        n = Decimal(repr(v))
    elif isinstance(v, Decimal):
        if not v.is_finite():
            return None
        n = v
    else:
        return None
    return n if abs(n) < _HUGE else None


def whole_in(v: object, lo: int, hi: int) -> int | None:
    n = as_decimal(v)
    return int(n) if n is not None and _is_whole(n) and lo <= n <= hi else None


def json_path(base: str, key: object) -> str:
    """The path to `key` inside `base`: `params.squat`, `params["Squat start"]`."""
    text = str(key)
    if _PLAIN_RE.fullmatch(text):
        return f"{base}.{text}" if base else text
    return f"{base}[{json.dumps(text, ensure_ascii=False)}]"


def text_in(v: object, lo: int, hi: int) -> str | None:
    """Text of `lo` to `hi` characters; with `lo` 1, it may not be blank. Kept trimmed."""
    if not isinstance(v, str) or len(v) > hi:
        return None
    if lo and not v.strip():
        return None
    return v.strip() if lo else v


# ---- The parser ----


@dataclass
class _Draft:
    """An activity as far as it parsed: enough for the overrides' and the weeks' checks, and
    the `Activity` when nothing is wrong."""

    #: Where it is in the document: `activities[2]`.
    path: str
    key: str | None
    name: str | None
    #: The plan fields the document gives it, whether or not they parsed, and `target`.
    has: set[str]
    #: The plan fields that parsed.
    values: dict[Field, Value]
    per_side: bool | None = None
    notes: str | None = None
    link: str | None = None

    def activity(self) -> Activity:
        assert self.key is not None and self.name is not None
        return Activity(
            key=self.key,
            name=self.name,
            values=self.values,
            per_side=self.per_side,
            notes=self.notes,
            link=self.link,
        )


@dataclass
class _Checker:
    errors: list[ProgrammeError] = field(default_factory=list)
    #: The parameter keys references may name; None when `params` isn't an object, so references
    #: can't be checked.
    known: set[str] | None = None
    #: Whether every week's value must fit the item (`_resolve_series`): off for a stored run.
    check_ranges: bool = True

    def error(self, path: str, message: str) -> None:
        self.errors.append(ProgrammeError(path, message))

    def unknown_keys(self, raw: Mapping[Any, Any], allowed: Sequence[str], path: str) -> None:
        for key in raw:
            if key not in allowed:
                self.error(json_path(path, key), UNKNOWN)

    def operand(
        self, raw: object, path: str, fits: Callable[[Decimal], bool], message: str
    ) -> Ref | None:
        """A number that `fits`, or a reference to a parameter."""
        if isinstance(raw, str) and (match := REF_RE.fullmatch(raw)):
            key = match.group(1)
            if self.known is not None and key not in self.known:
                self.error(path, f"there is no parameter called {key}.")
                return None
            return key
        n = as_decimal(raw)
        if n is None or not fits(n):
            self.error(path, message)
            return None
        return n

    # -- the document --

    def document(self, doc: object) -> Programme | None:
        if not isinstance(doc, Mapping):
            self.error("", "a programme is a JSON object.")
            return None
        self.unknown_keys(doc, _TOP_KEYS, "")
        if doc.get("format") != FORMAT:
            self.error("format", f'give "{FORMAT}".')
        name = text_in(doc.get("name"), 1, MAX_TRACKER_NAME)
        if name is None:
            self.error("name", f"give a name of 1 to {MAX_TRACKER_NAME} characters.")
        description = None
        if "description" in doc:
            description = text_in(doc["description"], 0, MAX_DESCRIPTION)
            if description is None:
                self.error("description", f"give text of up to {MAX_DESCRIPTION:,} characters.")
        raw_kind = doc.get("kind")
        kind: Kind | None = next((k for k in KINDS if k == raw_kind), None)
        if kind is None:
            self.error("kind", "give strength, mobility or cardio.")
        weeks = whole_in(doc.get("weeks"), 1, MAX_WEEKS)
        if weeks is None:
            self.error("weeks", f"give a whole number from 1 to {MAX_WEEKS}.")
        daily_target = self.daily_target(doc, kind)
        params = self.params(doc)
        drafts = self.activities(doc, kind)
        overrides = self.overrides(doc, kind, weeks or MAX_WEEKS, drafts)
        if kind is not None and weeks is not None:
            defaults = {key: p.default for key, p in params.items()}
            fields = [(d.path, d.key, d.values) for d in drafts]
            _resolve_series(
                self, kind, weeks, fields, overrides, defaults, check_ranges=self.check_ranges
            )
        if self.errors:
            return None
        assert name is not None and kind is not None and weeks is not None
        activities = tuple(d.activity() for d in drafts)
        return Programme(
            name=name,
            description=description,
            kind=kind,
            weeks=weeks,
            daily_target=daily_target,
            params=params,
            activities=activities,
            overrides=tuple(overrides),
        )

    def daily_target(self, doc: Mapping[str, Any], kind: Kind | None) -> int | None:
        if kind == "cardio":
            if "dailyTarget" in doc:
                self.error("dailyTarget", "a cardio programme has no daily target.")
            return None
        if "dailyTarget" not in doc:
            return TYPES[kind].daily_target if kind is not None else None
        target = whole_in(doc["dailyTarget"], MIN_DAILY_PICK, MAX_DAILY_PICK)
        if target is None:
            self.error(
                "dailyTarget", f"give a whole number from {MIN_DAILY_PICK} to {MAX_DAILY_PICK}."
            )
        return target

    # -- parameters --

    def params(self, doc: Mapping[str, Any]) -> dict[str, Param]:
        params: dict[str, Param] = {}
        if "params" not in doc:
            self.known = set()
            return params
        raw = doc["params"]
        if not isinstance(raw, Mapping):
            self.error("params", "give the parameters as an object.")
            return params
        self.known = set()
        if len(raw) > MAX_PARAMS:
            self.error("params", f"a programme has at most {MAX_PARAMS} parameters.")
        for key, value in raw.items():
            path = json_path("params", key)
            if not isinstance(key, str) or not KEY_RE.fullmatch(key):
                self.error(
                    path, f"a parameter's name is 1 to {MAX_KEY} characters of a-z, 0-9 and -."
                )
                continue
            self.known.add(key)
            param = self.param(key, value, path)
            if param is not None:
                params[key] = param
        return params

    def param(self, key: str, raw: object, path: str) -> Param | None:
        if not isinstance(raw, Mapping):
            self.error(path, "give a label, a unit and a default.")
            return None
        before = len(self.errors)
        self.unknown_keys(raw, _PARAM_KEYS, path)
        label = text_in(raw.get("label"), 1, MAX_PARAM_LABEL)
        if label is None:
            self.error(f"{path}.label", f"give a label of 1 to {MAX_PARAM_LABEL} characters.")
        unit = text_in(raw.get("unit"), 1, MAX_UNIT)
        if unit is None:
            self.error(f"{path}.unit", f"give a unit of 1 to {MAX_UNIT} characters.")
        bounds: dict[str, Decimal | None] = {}
        for name in ("default", "min", "max"):
            bounds[name] = as_decimal(raw.get(name))
            if bounds[name] is None and (name == "default" or name in raw):
                self.error(f"{path}.{name}", "give a number.")
        default, lo, hi = bounds["default"], bounds["min"], bounds["max"]
        if lo is not None and hi is not None and lo > hi:
            self.error(f"{path}.max", "max is below min.")
        if default is not None and lo is not None and default < lo:
            self.error(f"{path}.default", "the default is below min.")
        elif default is not None and hi is not None and default > hi:
            self.error(f"{path}.default", "the default is above max.")
        if len(self.errors) > before:
            return None
        assert label is not None and unit is not None and default is not None
        return Param(key=key, label=label, unit=unit, default=default, min=lo, max=hi)

    # -- activities --

    def activities(self, doc: Mapping[str, Any], kind: Kind | None) -> list[_Draft]:
        raw = doc.get("activities")
        if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_ACTIVITIES:
            self.error("activities", f"give 1 to {MAX_ACTIVITIES} activities.")
        if not isinstance(raw, list):
            return []
        drafts: list[_Draft] = []
        first: dict[str, int] = {}
        for i, item in enumerate(raw):
            draft = self.activity(item, f"activities[{i}]", kind)
            if draft is None:
                continue
            if draft.key is not None:
                if draft.key in first:
                    self.error(
                        f"activities[{i}].key",
                        f"{draft.key} is already the key of activities[{first[draft.key]}].",
                    )
                else:
                    first[draft.key] = i
            drafts.append(draft)
        return drafts

    def activity(self, raw: object, path: str, kind: Kind | None) -> _Draft | None:
        if not isinstance(raw, Mapping):
            self.error(path, "give an activity as an object.")
            return None
        rules = KIND_FIELDS[kind] if kind is not None else {}
        for name in raw:
            if name in _TEXT_KEYS or name in rules:
                continue
            if name == "perSide" and (kind is None or kind in PER_SIDE_KINDS):
                continue
            if kind is not None and (name in FIELDS or name == "perSide"):
                self.error(json_path(path, name), f"a {kind} activity has no {name}.")
            elif name not in FIELDS and name != "perSide":
                self.error(json_path(path, name), UNKNOWN)
        key = raw.get("key")
        if not isinstance(key, str) or not KEY_RE.fullmatch(key):
            self.error(f"{path}.key", f"give a key of 1 to {MAX_KEY} characters of a-z, 0-9 and -.")
            key = None
        draft = _Draft(path, key, text_in(raw.get("name"), 1, MAX_NAME), {"target"}, {})
        if draft.name is None:
            self.error(f"{path}.name", f"give a name of 1 to {MAX_NAME} characters.")
        if "notes" in raw:
            draft.notes = text_in(raw["notes"], 0, MAX_DETAILS_NOTES)
            if draft.notes is None:
                self.error(f"{path}.notes", f"give text of up to {MAX_DETAILS_NOTES:,} characters.")
        if "link" in raw:
            draft.link = text_in(raw["link"], 0, MAX_FIELD)
            if draft.link is None:
                self.error(f"{path}.link", f"give text of up to {MAX_FIELD:,} characters.")
        if "perSide" in raw and kind in PER_SIDE_KINDS:
            if isinstance(raw["perSide"], bool):
                draft.per_side = raw["perSide"]
            else:
                self.error(f"{path}.perSide", "give true or false.")
        values, has = draft.values, draft.has
        if kind is not None:
            values["target"] = Value(start=Decimal(TYPES[kind].new_target), step=_ONE)
            for name, rule in rules.items():
                if name in raw:
                    has.add(name)
                    value = self.value(raw[name], f"{path}.{name}", rule)
                    if value is not None:
                        values[name] = value
            if kind in PER_SIDE_KINDS and "reps" in raw and "duration" in raw:
                self.error(f"{path}.duration", "give reps or duration, not both.")
        return draft

    def value(self, raw: object, path: str, rule: FieldRule) -> Value | None:
        if isinstance(raw, Mapping):
            return self.progression(raw, path, rule)
        start = self.operand(
            raw, path, rule.fits, f"give {rule.domain}, a parameter or a progression."
        )
        return None if start is None else Value(start=start, step=rule.precision)

    def progression(self, raw: Mapping[str, Any], path: str, rule: FieldRule) -> Value | None:
        before = len(self.errors)
        self.unknown_keys(raw, _PROGRESSION_KEYS, path)
        start: Ref | None = None
        if "start" not in raw:
            self.error(f"{path}.start", "a progression needs a start.")
        else:
            start = self.operand(
                raw["start"], f"{path}.start", rule.fits, f"give {rule.domain}, or a parameter."
            )
        add = rate = None
        if "add" in raw:
            add = self.operand(
                raw["add"], f"{path}.add", rule.fits_add, f"give {rule.add_domain}, or a parameter."
            )
        if "rate" in raw:
            rate = self.operand(
                raw["rate"], f"{path}.rate", fits_rate, f"give {RATE_DOMAIN}, or a parameter."
            )
            if "add" in raw:
                self.error(f"{path}.rate", "a progression has add or rate, not both.")
        every = 1
        if "every" in raw:
            every = whole_in(raw["every"], 1, MAX_WEEKS) or 0
            if not every:
                self.error(f"{path}.every", f"give a whole number of weeks from 1 to {MAX_WEEKS}.")
        top = None
        if "max" in raw:
            top = as_decimal(raw["max"])
            if top is None or not rule.fits(top):
                self.error(f"{path}.max", f"give {rule.domain}.")
        step = rule.step
        if "step" in raw:
            given = as_decimal(raw["step"])
            if given is None or not rule.fits_step(given):
                self.error(f"{path}.step", rule.step_message)
            else:
                step = given
        if len(self.errors) > before:
            return None
        assert start is not None
        return Value(start=start, step=step, add=add, rate=rate, every=every, max=top)

    # -- overrides --

    def overrides(
        self, doc: Mapping[str, Any], kind: Kind | None, last: int, drafts: list[_Draft]
    ) -> list[Override]:
        if "overrides" not in doc:
            return []
        raw = doc["overrides"]
        if not isinstance(raw, list):
            self.error("overrides", "give a list of overrides.")
            return []
        acts = {d.key: d for d in reversed(drafts) if d.key is not None}
        check_keys = isinstance(doc.get("activities"), list)
        owner: dict[int, int] = {}
        parsed: list[Override] = []
        for i, item in enumerate(raw):
            path = f"overrides[{i}]"
            if not isinstance(item, Mapping):
                self.error(path, "give an override as an object.")
                continue
            before = len(self.errors)
            self.unknown_keys(item, _OVERRIDE_KEYS, path)
            weeks = self.override_weeks(item.get("weeks"), path, i, last, owner)
            label = None
            if "label" in item:
                label = text_in(item["label"], 1, MAX_OVERRIDE_LABEL)
                if label is None:
                    self.error(
                        f"{path}.label", f"give a label of 1 to {MAX_OVERRIDE_LABEL} characters."
                    )
            changes = self.override_activities(
                item.get("activities"), f"{path}.activities", kind, acts, check_keys
            )
            if len(self.errors) == before:
                parsed.append(Override(weeks=tuple(weeks), label=label, activities=changes))
        return parsed

    def override_weeks(
        self, raw: object, path: str, index: int, last: int, owner: dict[int, int]
    ) -> list[int]:
        if not isinstance(raw, list) or not raw:
            self.error(f"{path}.weeks", "give a list of programme weeks.")
            return []
        weeks: list[int] = []
        for j, value in enumerate(raw):
            week = whole_in(value, 1, last)
            where = f"{path}.weeks[{j}]"
            if week is None:
                self.error(where, f"give a week from 1 to {last}.")
            elif week in weeks:
                self.error(where, f"week {week} is listed twice.")
            elif week in owner:
                self.error(
                    where, f"week {week} already has an override in overrides[{owner[week]}]."
                )
            else:
                weeks.append(week)
        for week in weeks:
            owner[week] = index
        return weeks

    def override_activities(
        self,
        raw: object,
        path: str,
        kind: Kind | None,
        acts: Mapping[str, _Draft],
        check_keys: bool,
    ) -> dict[str, dict[Field, OverrideValue]]:
        changes: dict[str, dict[Field, OverrideValue]] = {}
        if not isinstance(raw, Mapping) or not raw:
            self.error(path, f'give the activities it changes, by key or "{ALL}".')
            return changes
        for key, fields in raw.items():
            where = json_path(path, key)
            if key != ALL and check_keys and key not in acts:
                self.error(where, f"there is no activity called {key}.")
                continue
            if not isinstance(fields, Mapping) or not fields:
                self.error(where, "give the fields it changes.")
                continue
            if kind is None:
                continue
            draft = acts.get(key)
            changes[key] = {}
            for name, value in fields.items():
                parsed = self.override_value(value, json_path(where, name), name, kind, key, draft)
                if parsed is not None:
                    changes[key][parsed[0]] = parsed[1]
        return changes

    def override_value(
        self, raw: object, path: str, name: str, kind: Kind, key: str, draft: _Draft | None
    ) -> tuple[Field, OverrideValue] | None:
        rule = KIND_FIELDS[kind].get(cast(Field, name))
        if rule is None:
            if name == "perSide" and kind in PER_SIDE_KINDS:
                self.error(path, "an override can't change perSide.")
            elif name in FIELDS or name == "perSide":
                self.error(path, f"a {kind} activity has no {name}.")
            else:
                self.error(path, UNKNOWN)
            return None
        if draft is not None and rule.name not in draft.has:
            self.error(path, f"{key} has no {rule.name} to change.")
            return None
        if isinstance(raw, Mapping):
            self.unknown_keys(raw, ("scale",), path)
            factor = as_decimal(raw.get("scale"))
            if factor is None or factor <= 0:
                self.error(f"{path}.scale", "give a number above 0.")
                return None
            return rule.name, Scale(factor)
        n = as_decimal(raw)
        if n is None or not rule.fits(n):
            self.error(path, f"give {rule.domain}, or a scale.")
            return None
        return rule.name, n


def fits_rate(n: Decimal) -> bool:
    return MIN_RATE < n <= MAX_RATE


# ---- Parameters and series ----


def _resolve_ref(
    checker: _Checker,
    ref: Ref | None,
    path: str,
    params: Mapping[str, Decimal],
    fits: Callable[[Decimal], bool],
    what: str,
) -> tuple[bool, Decimal | None]:
    """A reference's value, checked against where it is used. False when it can't be used: a
    parameter that has no value (an error reported elsewhere) or one out of range here."""
    if ref is None or isinstance(ref, Decimal):
        return True, ref
    if ref not in params:
        return False, None
    value = params[ref]
    if not fits(value):
        checker.error(path, f"${ref} is {number_text(value)}. {what}.")
        return False, None
    return True, value


def _series(
    checker: _Checker, value: Value, path: str, rule: FieldRule, params: Mapping[str, Decimal]
) -> Series | None:
    ok_start, start = _resolve_ref(checker, value.start, f"{path}.start", params, _any, "")
    ok_add, add = _resolve_ref(
        checker,
        value.add,
        f"{path}.add",
        params,
        rule.fits_resolved_add,
        f"An add is {rule.add_range}",
    )
    ok_rate, rate = _resolve_ref(
        checker, value.rate, f"{path}.rate", params, fits_rate, f"A rate is {RATE_RANGE}"
    )
    if not (ok_start and ok_add and ok_rate) or start is None:
        return None
    return Series(
        start=start, step=value.step, add=add, rate=rate, every=value.every, max=value.max
    )


def _any(_: Decimal) -> bool:
    return True


def _resolve_series(
    checker: _Checker,
    kind: Kind,
    weeks: int,
    activities: Sequence[tuple[str, str | None, Mapping[Field, Value]]],
    overrides: Sequence[Override],
    params: Mapping[str, Decimal],
    *,
    check_ranges: bool = True,
) -> dict[str, dict[Field, Series]]:
    """Each activity's series by field, and an error for each field whose value the item can't
    hold in some week (the first such week). `activities` holds each one's path (`activities[2]`),
    key and parsed values. Fields that use a parameter with no usable value are left out.

    The check runs each programme week with its override at the same activity week, as a run
    with no pauses would. Without `check_ranges` it is skipped: a stored run was checked when it
    started, and must load whatever the engine computes now (spec P1)."""
    out: dict[str, dict[Field, Series]] = {}
    rules = KIND_FIELDS[kind]
    for base, activity_key, values in activities:
        key = activity_key if activity_key is not None else ALL
        fields: dict[Field, Series] = {}
        for name, value in values.items():
            path = f"{base}.{name}"
            rule = rules[name]
            series = _series(checker, value, path, rule, params)
            if series is None:
                continue
            fields[name] = series
            for week in range(1, weeks + 1 if check_ranges else 1):
                shown = series.value(week, _override_at(overrides, week, key, name))
                problem = rule.out_of_range(week, shown)
                if problem is not None:
                    checker.error(path, problem)
                    break
        if activity_key is not None:
            out[activity_key] = fields
    return out


# ---- Public API ----


def parse_activity(
    raw: object, kind: Kind, params: Collection[str], path: str
) -> tuple[Activity | None, list[ProgrammeError]]:
    """One activity written as the format's, outside a document (the replay's Add activity):
    the activity, or every problem with paths under `path`. References may name `params`."""
    checker = _Checker(known=set(params))
    draft = checker.activity(raw, path, kind)
    if draft is None or checker.errors:
        return None, checker.errors
    return draft.activity(), []


def resolve_activity(
    activity: Activity, kind: Kind, params: Mapping[str, Decimal], path: str
) -> tuple[dict[Field, Series], list[ProgrammeError]]:
    """Each of an activity's fields as a series with `params`' values, or the problems: a
    parameter whose value doesn't fit where the activity uses it."""
    checker = _Checker()
    fields: dict[Field, Series] = {}
    for name, value in activity.values.items():
        series = _series(checker, value, f"{path}.{name}", KIND_FIELDS[kind][name], params)
        if series is not None:
            fields[name] = series
    return fields, checker.errors


def check_programme(doc: object) -> list[ProgrammeError]:
    """Every problem with a document, in document order; [] when it is a valid programme."""
    checker = _Checker()
    checker.document(doc)
    return checker.errors


def parse_programme(doc: object, *, check_ranges: bool = True) -> Programme:
    """The programme a document describes. Raises `ProgrammeInvalid` with every problem.

    `check_ranges=False` skips checking each week's value against the item's limits, for a
    document a run already holds: it was checked when the run started, and an engine change
    since must not stop the run from loading (spec P1). Saving and starting keep the check."""
    checker = _Checker(check_ranges=check_ranges)
    programme = checker.document(doc)
    if programme is None:
        raise ProgrammeInvalid(checker.errors)
    return programme


def resolve(
    programme: Programme,
    given: Mapping[str, object] | None = None,
    *,
    check_ranges: bool = True,
) -> Resolved:
    """The programme with its parameters: each given value, else the default.

    Raises `ProgrammeInvalid` with every problem: a parameter the programme doesn't have, one that
    isn't a number or is outside its min and max, and any week whose value the item can't hold
    with these values. `check_ranges=False` skips that last check, for a stored run
    (`parse_programme`); the parameters are still checked.
    """
    checker = _Checker()
    values = {key: param.default for key, param in programme.params.items()}
    if given is not None and not isinstance(given, Mapping):
        checker.error("params", "give the parameter values as an object.")
        raise ProgrammeInvalid(checker.errors)
    for key, raw in (given or {}).items():
        path = json_path("params", key)
        param = programme.params.get(key) if isinstance(key, str) else None
        if param is None:
            checker.error(path, f"the programme has no parameter called {key}.")
            continue
        n = as_decimal(raw)
        problem = param_problem(param, n)
        if problem is not None:
            checker.error(path, problem)
            # The fields that use it go unchecked, rather than checked with the default.
            del values[key]
            continue
        assert n is not None
        values[key] = n
    activities = [(f"activities[{i}]", a.key, a.values) for i, a in enumerate(programme.activities)]
    series = _resolve_series(
        checker,
        programme.kind,
        programme.weeks,
        activities,
        programme.overrides,
        values,
        check_ranges=check_ranges,
    )
    if checker.errors:
        raise ProgrammeInvalid(checker.errors)
    return Resolved(programme=programme, params=values, series=series)


def param_problem(param: Param, n: Decimal | None) -> str | None:
    if n is None:
        return "give a number."
    if param.min is not None and n < param.min:
        return f"the least it can be is {number_text(param.min)}."
    if param.max is not None and n > param.max:
        return f"the most it can be is {number_text(param.max)}."
    return None


def _check_week(what: str, week: int, last: int) -> None:
    if not 1 <= week <= last:
        raise ValueError(f"{what} {week} is outside weeks 1 to {last}")


def expand_activity(
    resolved: Resolved, key: str, *, programme_week: int, activity_week: int
) -> PlanValues:
    """One activity's plan fields for a programme week (which picks the override) and an
    activity week (which picks the series' value)."""
    programme = resolved.programme
    _check_week("programme week", programme_week, programme.weeks)
    _check_week("activity week", activity_week, programme.weeks)
    activity = programme.activity(key)
    rules = KIND_FIELDS[programme.kind]
    out: PlanValues = {}
    for name, series in resolved.series[key].items():
        shown = series.value(activity_week, programme.override_at(programme_week, key, name))
        out[name] = int(shown) if rules[name].is_whole else whole(float(shown))
    if activity.per_side is not None:
        out["perSide"] = activity.per_side
    return out


def expand_week(
    resolved: Resolved, programme_week: int, activity_weeks: Mapping[str, int] | None = None
) -> dict[str, PlanValues]:
    """Every activity's plan fields for a programme week, keyed by activity, in the programme's
    order. An activity's week defaults to the programme week."""
    weeks = activity_weeks or {}
    return {
        a.key: expand_activity(
            resolved,
            a.key,
            programme_week=programme_week,
            activity_week=weeks.get(a.key, programme_week),
        )
        for a in resolved.programme.activities
    }


# ---- The JSON Schema ----


def _json_number(n: Decimal | int) -> int | float:
    return whole(float(n))


def _text_schema(lo: int, hi: int) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "string", "maxLength": hi}
    if lo:
        schema |= {"minLength": lo, "pattern": r"\S"}
    return schema


def _literal_schema(rule: FieldRule) -> dict[str, Any]:
    if rule.is_whole:
        return {"type": "integer", "minimum": rule.lo, "maximum": rule.hi}
    return {"type": "number", "exclusiveMinimum": 0, "maximum": rule.hi}


def _value_schemas(kind: Kind, rule: FieldRule) -> dict[str, Any]:
    """A field's bare value, literal and progression, as `$defs` entries."""
    name = f"{kind}.{rule.name}"
    literal = {"$ref": f"#/$defs/{name}.literal"}
    reference = {"$ref": "#/$defs/reference"}
    number = "integer" if rule.is_whole else "number"
    step: dict[str, Any] = (
        {"type": "integer", "minimum": 1}
        if rule.is_whole
        else {"type": "number", "minimum": float(_HUNDREDTH)}
    )
    progression = {
        "type": "object",
        "required": ["start"],
        "additionalProperties": False,
        "properties": {
            "start": {"anyOf": [literal, reference]},
            "add": {
                "anyOf": [{"type": number, "minimum": -rule.hi, "maximum": rule.hi}, reference]
            },
            "rate": {
                "anyOf": [
                    {"type": "number", "exclusiveMinimum": MIN_RATE, "maximum": MAX_RATE},
                    reference,
                ]
            },
            "every": {"type": "integer", "minimum": 1, "maximum": MAX_WEEKS, "default": 1},
            "max": literal,
            "step": step | {"default": _json_number(rule.step)},
        },
        "not": {"required": ["add", "rate"]},
    }
    return {
        f"{name}.literal": _literal_schema(rule),
        f"{name}.progression": progression,
        f"{name}.value": {"anyOf": [literal, reference, {"$ref": f"#/$defs/{name}.progression"}]},
    }


def _activity_schema(kind: Kind) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "key": {"type": "string", "pattern": f"^{KEY_PATTERN}$"},
        "name": _text_schema(1, MAX_NAME),
        "notes": _text_schema(0, MAX_DETAILS_NOTES),
        "link": _text_schema(0, MAX_FIELD),
    }
    if kind in PER_SIDE_KINDS:
        properties["perSide"] = {"type": "boolean"}
    for name in KIND_FIELDS[kind]:
        properties[name] = {"$ref": f"#/$defs/{kind}.{name}.value"}
    schema: dict[str, Any] = {
        "type": "object",
        "required": ["key", "name"],
        "additionalProperties": False,
        "properties": properties,
    }
    if kind in PER_SIDE_KINDS:
        schema["not"] = {"required": ["reps", "duration"]}
    return schema


def _override_schema(kind: Kind) -> dict[str, Any]:
    fields = {
        "type": "object",
        "minProperties": 1,
        "additionalProperties": False,
        "properties": {
            name: {"anyOf": [{"$ref": f"#/$defs/{kind}.{name}.literal"}, {"$ref": "#/$defs/scale"}]}
            for name in KIND_FIELDS[kind]
        },
    }
    return {
        "type": "object",
        "required": ["weeks", "activities"],
        "additionalProperties": False,
        "properties": {
            "weeks": {
                "type": "array",
                "minItems": 1,
                "uniqueItems": True,
                "items": {"type": "integer", "minimum": 1, "maximum": MAX_WEEKS},
            },
            "label": _text_schema(1, MAX_OVERRIDE_LABEL),
            "activities": {
                "type": "object",
                "minProperties": 1,
                "propertyNames": {"pattern": rf"^(\{ALL}|{KEY_PATTERN})$"},
                "additionalProperties": fields,
            },
        },
    }


def programme_schema() -> dict[str, Any]:
    """The format's JSON Schema (draft 2020-12), built from the same rules as the validator.

    It can't express the rules listed in this module's docstring; `check_programme` is the
    authority, and the schema is for agents and editors.
    """
    defs: dict[str, Any] = {
        "reference": {
            "description": 'A parameter, by its key: "$squat".',
            "type": "string",
            "pattern": rf"^\${KEY_PATTERN}$",
        },
        "scale": {
            "description": "Scales the computed value before it is rounded.",
            "type": "object",
            "required": ["scale"],
            "additionalProperties": False,
            "properties": {"scale": {"type": "number", "exclusiveMinimum": 0}},
        },
        "param": {
            "type": "object",
            "required": ["label", "unit", "default"],
            "additionalProperties": False,
            "properties": {
                "label": _text_schema(1, MAX_PARAM_LABEL),
                "unit": _text_schema(1, MAX_UNIT),
                "default": {"type": "number"},
                "min": {"type": "number"},
                "max": {"type": "number"},
            },
        },
    }
    for kind in KINDS:
        for rule in KIND_FIELDS[kind].values():
            defs |= _value_schemas(kind, rule)
        defs[f"{kind}.activity"] = _activity_schema(kind)
        defs[f"{kind}.override"] = _override_schema(kind)
    by_kind: list[dict[str, Any]] = []
    for kind in KINDS:
        then: dict[str, Any] = {
            "properties": {
                "activities": {"items": {"$ref": f"#/$defs/{kind}.activity"}},
                "overrides": {"items": {"$ref": f"#/$defs/{kind}.override"}},
            }
        }
        if TYPES[kind].daily_target is None:
            then["not"] = {"required": ["dailyTarget"]}
        by_kind.append(
            {"if": {"properties": {"kind": {"const": kind}}, "required": ["kind"]}, "then": then}
        )
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": SCHEMA_ID,
        "title": "Tracker programme",
        "description": (
            f"A multi-week exercise programme in the {FORMAT} format. The server's validator "
            "also checks what a schema can't: unique activity keys, parameter references, each "
            "week's value against the item's limits, and overrides against the activities."
        ),
        "type": "object",
        "required": ["format", "name", "kind", "weeks", "activities"],
        "additionalProperties": False,
        "properties": {
            "format": {"const": FORMAT},
            "name": _text_schema(1, MAX_TRACKER_NAME),
            "description": _text_schema(0, MAX_DESCRIPTION),
            "kind": {"enum": list(KINDS)},
            "weeks": {"type": "integer", "minimum": 1, "maximum": MAX_WEEKS},
            "dailyTarget": {
                "type": "integer",
                "minimum": MIN_DAILY_PICK,
                "maximum": MAX_DAILY_PICK,
            },
            "params": {
                "type": "object",
                "maxProperties": MAX_PARAMS,
                "propertyNames": {"pattern": f"^{KEY_PATTERN}$"},
                "additionalProperties": {"$ref": "#/$defs/param"},
            },
            "activities": {"type": "array", "minItems": 1, "maxItems": MAX_ACTIVITIES},
            "overrides": {"type": "array"},
        },
        "allOf": by_kind,
        "$defs": defs,
    }


if __name__ == "__main__":
    print(json.dumps(programme_schema(), ensure_ascii=False, indent=2))
