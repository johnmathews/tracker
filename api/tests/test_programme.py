"""The programme format (spec docs/specs/2026-11-17-programmes.md §3): parsing, validation, the
JSON Schema, parameters and the expansion of values, progressions and overrides.

The cases live in `fixtures/programmes/` so the web app's tests can read them too: `valid/` holds
documents that parse, `invalid.json` each broken document with every error it must report, and
`expansions/` golden weeks worked by hand (the mockup's numbers and the spec's §7.1 table).
"""

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from tracker_api import validate
from tracker_api.programme import (
    FORMAT,
    MAX_REPS,
    SCHEMA_PATH,
    ProgrammeError,
    ProgrammeInvalid,
    Scale,
    Series,
    check_programme,
    expand_activity,
    expand_week,
    parse_programme,
    programme_schema,
    resolve,
    round_to_step,
)

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "programmes"
VALID = sorted((FIXTURES / "valid").glob("*.json"))
EXPANSIONS = sorted((FIXTURES / "expansions").glob("*.json"))
INVALID: list[dict[str, Any]] = json.loads((FIXTURES / "invalid.json").read_text(encoding="utf-8"))
#: The rules the JSON Schema can't express, which the Python validator alone enforces. Each
#: invalid fixture the schema accepts names one of them.
PYTHON_ONLY = {
    "activity keys are unique",
    "a reference names one of the programme's parameters",
    "a parameter's min, max and default agree",
    "a parameter's value fits each place that uses it",
    "a weight or distance step is in hundredths",
    "every week's value fits the item",
    "override weeks are within the programme's weeks",
    "a week has at most one override",
    "an override names the programme's activities",
    "an override changes only fields the activity has",
}


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def spec_example() -> dict[str, Any]:
    doc: dict[str, Any] = load(FIXTURES / "valid" / "spec-example.json")
    return doc


def errors_of(doc: object) -> list[tuple[str, str]]:
    return sorted((e.path, e.message) for e in check_programme(doc))


# ---- §3.1 and §3.4: the document and its validation ----


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.stem)
def test_each_valid_fixture_parses_with_no_errors(path: Path) -> None:
    doc = load(path)
    assert check_programme(doc) == []
    programme = parse_programme(doc)
    assert programme.name == doc["name"]
    assert programme.kind == doc["kind"]
    assert programme.weeks == doc["weeks"]
    assert [a.key for a in programme.activities] == [a["key"] for a in doc["activities"]]


@pytest.mark.parametrize("case", INVALID, ids=lambda c: c["name"])
def test_each_invalid_fixture_reports_every_error_with_its_path(case: dict[str, Any]) -> None:
    expected = sorted((e["path"], e["message"]) for e in case["errors"])
    assert errors_of(case["document"]) == expected
    with pytest.raises(ProgrammeInvalid) as raised:
        parse_programme(case["document"])
    assert sorted((e.path, e.message) for e in raised.value.errors) == expected


def test_invalid_fixtures_have_unique_names_and_cover_every_python_only_rule() -> None:
    names = [c["name"] for c in INVALID]
    assert len(names) == len(set(names))
    assert {c["pythonOnly"] for c in INVALID if not c["schemaRejects"]} == PYTHON_ONLY


def test_a_programme_runs_up_to_156_weeks_and_an_increase_every_52() -> None:
    """K182: three years, with an override in the last week. `every` keeps 1 to 52 (the
    invalid fixtures refuse 157 weeks and an `every` of 53)."""
    doc = spec_example()
    doc["weeks"] = 156
    doc["overrides"][0]["weeks"] = [4, 156]
    doc["activities"][0]["weight"]["max"] = 150
    doc["activities"][1]["duration"]["every"] = 52
    assert check_programme(doc) == []
    assert Draft202012Validator(programme_schema()).is_valid(doc)
    doc["weeks"] = 157
    assert errors_of(doc) == [("weeks", "give a whole number from 1 to 156.")]


def test_an_error_reads_as_its_path_then_its_sentence() -> None:
    """The spec's §3.4 example, word for word."""
    doc = spec_example()
    doc["activities"].append(
        {"key": "row", "name": "Row", "weight": {"start": 30, "add": 2.5, "rate": 5}}
    )
    assert [str(e) for e in check_programme(doc)] == [
        "activities[2].weight.rate: a progression has add or rate, not both."
    ]
    assert str(ProgrammeError("", "a programme is a JSON object.")) == (
        "a programme is a JSON object."
    )


def test_parse_reports_every_error_in_one_exception() -> None:
    case = next(c for c in INVALID if c["name"] == "every-error-at-once")
    with pytest.raises(ProgrammeInvalid) as raised:
        parse_programme(case["document"])
    assert len(raised.value.errors) == 5
    assert str(raised.value).startswith("5 problems: ")


def test_a_document_with_decimals_parses_as_one_with_floats() -> None:
    """`json.loads(..., parse_float=Decimal)` and plain floats give the same programme."""
    text = (FIXTURES / "valid" / "beginner-5x5.json").read_text(encoding="utf-8")
    assert parse_programme(json.loads(text, parse_float=Decimal)) == parse_programme(
        json.loads(text)
    )


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), Decimal("NaN"), Decimal("Infinity")])
def test_a_number_must_be_finite(bad: object) -> None:
    doc = spec_example()
    doc["activities"][1]["sets"] = bad
    assert errors_of(doc) == [
        ("activities[1].sets", "give a whole number from 1 to 20, a parameter or a progression.")
    ]


def test_the_name_is_trimmed_and_optional_fields_default() -> None:
    doc = load(FIXTURES / "valid" / "minimal.json")
    doc["name"] = "  Push-ups  "
    programme = parse_programme(doc)
    assert programme.name == "Push-ups"
    assert programme.description is None
    assert programme.daily_target == 3  # the kind's default (types.STRENGTH)
    assert programme.params == {}
    assert programme.overrides == ()
    (push_ups,) = programme.activities
    assert push_ups.notes is None
    assert push_ups.link is None
    assert push_ups.per_side is None


def test_a_cardio_programme_has_no_daily_target() -> None:
    assert parse_programme(load(FIXTURES / "valid" / "cardio.json")).daily_target is None


def test_activity_text_fields_are_kept() -> None:
    programme = parse_programme(load(FIXTURES / "valid" / "beginner-5x5.json"))
    assert programme.description is not None
    squat = programme.activity("squat")
    assert squat.name == "Back squat"
    assert squat.notes == "Belt from week 5."
    mobility = parse_programme(load(FIXTURES / "valid" / "mobility.json"))
    hip = mobility.activity("hip-flexor")
    assert hip.link == "https://example.com/hip-flexor"
    assert hip.per_side is True
    with pytest.raises(KeyError):
        programme.activity("bench-press")


def test_the_format_string_is_the_first_version() -> None:
    assert FORMAT == "tracker-programme/1"


# ---- The JSON Schema ----


def test_the_committed_schema_is_the_generated_one() -> None:
    """`programme.schema.json` is written from `programme_schema()`; regenerate it with
    `uv run python -m tracker_api.programme > src/tracker_api/programme.schema.json`."""
    generated = json.dumps(programme_schema(), ensure_ascii=False, indent=2) + "\n"
    assert SCHEMA_PATH.read_text(encoding="utf-8") == generated


def test_the_schema_is_a_valid_2020_12_schema() -> None:
    Draft202012Validator.check_schema(programme_schema())
    assert SCHEMA_PATH.parent.name == "tracker_api"


def test_the_schema_uses_the_item_caps() -> None:
    defs = programme_schema()["$defs"]
    assert defs["strength.weight.literal"]["maximum"] == validate.MAX_WEIGHT
    assert defs["strength.sets.literal"]["maximum"] == validate.MAX_SETS
    assert defs["strength.duration.literal"]["maximum"] == validate.MAX_DURATION
    assert defs["cardio.duration.literal"]["maximum"] == validate.MAX_CARDIO_DURATION
    assert defs["cardio.distance.literal"]["maximum"] == validate.MAX_DISTANCE
    assert defs["strength.reps.literal"]["maximum"] == MAX_REPS


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.stem)
def test_the_schema_accepts_each_valid_fixture(path: Path) -> None:
    assert list(Draft202012Validator(programme_schema()).iter_errors(load(path))) == []


@pytest.mark.parametrize("case", INVALID, ids=lambda c: c["name"])
def test_the_schema_rejects_each_invalid_fixture_it_can_express(case: dict[str, Any]) -> None:
    """A document the schema accepts but the validator rejects breaks a Python-only rule."""
    valid = Draft202012Validator(programme_schema()).is_valid(case["document"])
    assert valid is not case["schemaRejects"]


# ---- §3.2: values and progressions ----


def test_rounding_goes_to_the_nearest_step_with_halves_up() -> None:
    assert round_to_step(Decimal("33.75"), Decimal("2.5")) == Decimal("35")
    assert round_to_step(Decimal("33.74"), Decimal("2.5")) == Decimal("32.5")
    assert round_to_step(Decimal("12.25"), Decimal("0.5")) == Decimal("12.5")
    assert round_to_step(Decimal("2.5"), Decimal("1")) == Decimal("3")
    assert round_to_step(Decimal("1277.76"), Decimal("60")) == Decimal("1260")


def test_rounding_a_huge_value_does_not_raise() -> None:
    assert round_to_step(Decimal("1E+80"), Decimal("0.01")) == Decimal("1E+80")


def test_add_steps_every_n_weeks() -> None:
    """`start + add * floor((n - 1) / every)`."""
    series = Series(start=Decimal(30), add=Decimal(5), every=2, step=Decimal(5))
    assert [series.value(n) for n in range(1, 7)] == [30, 30, 35, 35, 40, 40]


def test_rate_compounds_every_n_weeks() -> None:
    """`start * (1 + rate / 100) ^ floor((n - 1) / every)`."""
    series = Series(start=Decimal(100), rate=Decimal(10), every=2, step=Decimal("0.01"))
    assert [series.value(n) for n in range(1, 6)] == [100, 100, 110, 110, 121]


def test_the_value_is_capped_at_max_before_it_is_rounded() -> None:
    series = Series(start=Decimal(80), add=Decimal(7), max=Decimal(91), step=Decimal(5))
    assert [series.raw(n) for n in (1, 2, 3)] == [80, 87, 91]
    assert [series.value(n) for n in (1, 2, 3)] == [80, 85, 90]


def test_a_scale_applies_after_the_cap_and_before_the_rounding() -> None:
    series = Series(start=Decimal(100), max=Decimal(90), step=Decimal("2.5"))
    assert series.value(1, Scale(Decimal("0.9"))) == Decimal("80")  # 90 * 0.9 = 81 → 80
    assert series.value(1, Scale(Decimal("1.1"))) == Decimal("100")  # 99 → 100, past max
    assert series.value(1, Decimal("70")) == Decimal("70")


def test_no_increase_is_a_constant() -> None:
    series = Series(start=Decimal("41.3"), step=Decimal("0.5"))
    assert {series.value(n) for n in range(1, 53)} == {Decimal("41.5")}


def test_the_engine_works_in_decimals() -> None:
    """0.1 + 0.2 is 0.3 here, so the rounding never sees float noise at a half."""
    series = Series(start=Decimal("0.1"), add=Decimal("0.2"), step=Decimal("0.01"))
    assert series.raw(2) == Decimal("0.3")
    # 2.675 is a half in decimals (it rounds up to 2.68); as a float it is 2.67499999...
    assert Series(start=Decimal("2.675"), step=Decimal("0.01")).value(1) == Decimal("2.68")


def test_spec_7_1_before_row() -> None:
    """10 kg at 10% a week, rounded to 0.5 kg: 10, 11, 12, 13.5, 14.5."""
    resolved = resolve(parse_programme(load(FIXTURES / "valid" / "ten-kg.json")))
    weights = [
        expand_activity(resolved, "lift", programme_week=n, activity_week=n)["weight"]
        for n in range(1, 6)
    ]
    assert weights == [10, 11, 12, 13.5, 14.5]


def test_a_series_can_continue_from_a_later_week() -> None:
    """The spec's §7.1 After row: from week 3's shown 12 kg at 15%. `origin` is the activity
    week whose value is `start`; the replay (W2) starts a segment this way."""
    after = Series(start=Decimal(12), rate=Decimal(15), step=Decimal("0.5"), origin=3)
    assert [after.value(n) for n in (3, 4, 5)] == [12, 14, 16]
    with pytest.raises(ValueError, match="before its origin"):
        after.value(2)


def test_a_series_keeps_its_rule_for_the_replay() -> None:
    resolved = resolve(parse_programme(spec_example()), {"squat": 50})
    squat = resolved.series["squat"]["weight"]
    assert squat == Series(start=Decimal(50), rate=Decimal(5), step=Decimal("2.5"))
    plank = resolved.series["plank"]["duration"]
    assert plank == Series(
        start=Decimal(30), add=Decimal(5), every=2, max=Decimal(90), step=Decimal(5)
    )
    assert resolved.series["squat"]["sets"] == Series(start=Decimal(5), step=Decimal(1))


def test_default_steps() -> None:
    """Defaults: weight 0.5 kg, distance 0.1 km, duration 5 s, others 1. A bare value keeps the
    item's own precision (whole numbers, or hundredths for weight and distance)."""
    doc = spec_example()
    doc["activities"] = [
        {"key": "a", "name": "A", "sets": {"start": 3}, "reps": {"start": 5}},
        {"key": "b", "name": "B", "duration": {"start": 30}, "weight": {"start": 40}},
        {"key": "c", "name": "C", "target": 2, "weight": 41.25, "duration": 33},
    ]
    doc["overrides"] = []
    resolved = resolve(parse_programme(doc))
    steps = {k: {f: s.step for f, s in fields.items()} for k, fields in resolved.series.items()}
    assert steps == {
        "a": {"target": 1, "sets": 1, "reps": 1},
        "b": {"target": 1, "duration": 5, "weight": Decimal("0.5")},
        "c": {"target": 1, "weight": Decimal("0.01"), "duration": 1},
    }
    assert expand_activity(resolved, "c", programme_week=1, activity_week=1) == {
        "target": 2,
        "weight": 41.25,
        "duration": 33,
    }
    cardio = resolve(parse_programme(load(FIXTURES / "valid" / "cardio.json")))
    assert cardio.series["run"]["distance"].step == Decimal("0.1")


def test_output_values_have_the_item_shapes() -> None:
    resolved = resolve(parse_programme(load(FIXTURES / "valid" / "cardio.json")))
    week = expand_week(resolved, 3)
    run = week["run"]
    assert type(run["target"]) is int
    assert type(run["duration"]) is int
    assert type(run["distance"]) is int  # 4 km: whole, as validate.whole() writes it
    assert type(week["long-ride"]["distance"]) is float  # 24.2
    item = validate.normalise_cardio({"id": "x", "name": "Run", **run})
    assert item == {"id": "x", "name": "Run", **run}


# ---- §3.3: overrides ----


def test_an_override_does_not_change_the_series() -> None:
    """The week after a deload continues as if the deload hadn't happened."""
    resolved = resolve(parse_programme(spec_example()))
    weights = [expand_week(resolved, n)["squat"]["weight"] for n in (3, 4, 5)]
    assert weights == [45, 42.5, 47.5]  # 46.305 * 0.9 in week 4; 48.62 in week 5


def test_an_activity_override_beats_star_field_by_field() -> None:
    programme = parse_programme(load(FIXTURES / "valid" / "beginner-5x5.json"))
    assert programme.override_at(4, "deadlift", "sets") == Decimal(1)
    assert programme.override_at(4, "deadlift", "weight") == Scale(Decimal("0.9"))
    assert programme.override_at(4, "squat", "sets") == Decimal(3)
    assert programme.override_at(5, "squat", "sets") is None
    assert programme.label_at(4) == "Deload"
    assert programme.label_at(5) is None


def test_a_star_override_skips_activities_without_the_field() -> None:
    resolved = resolve(parse_programme(spec_example()))
    assert "weight" not in expand_week(resolved, 4)["plank"]


def test_an_override_without_a_label() -> None:
    doc = spec_example()
    del doc["overrides"][0]["label"]
    programme = parse_programme(doc)
    assert programme.label_at(4) is None
    assert programme.override_at(4, "squat", "sets") == Decimal(3)


# ---- Parameters ----


def test_parameters_default_to_the_programmes() -> None:
    resolved = resolve(parse_programme(spec_example()))
    assert resolved.params == {"squat": Decimal(40), "rate": Decimal(5)}


def test_given_parameters_replace_the_defaults() -> None:
    resolved = resolve(parse_programme(spec_example()), {"squat": 60, "rate": 2.5})
    assert resolved.params == {"squat": Decimal(60), "rate": Decimal("2.5")}
    assert expand_week(resolved, 2)["squat"]["weight"] == 62.5  # 61.5 → 62.5


@pytest.mark.parametrize(
    ("given", "errors"),
    [
        ({"bench": 50}, [("params.bench", "the programme has no parameter called bench.")]),
        ({"squat": "60"}, [("params.squat", "give a number.")]),
        ({"squat": True}, [("params.squat", "give a number.")]),
        ({"squat": None}, [("params.squat", "give a number.")]),
        (
            {"Squat start": 1},
            [('params["Squat start"]', "the programme has no parameter called Squat start.")],
        ),
        ({"squat": 600}, [("activities[0].weight", "week 1 comes to 600 kg. The most is 500.")]),
        (
            {"rate": 1500},
            [
                (
                    "activities[0].weight.rate",
                    "$rate is 1,500. A rate is above -100 and at most 1,000.",
                )
            ],
        ),
        (
            {"squat": 0.5},
            [("activities[0].weight", "week 1 comes to 0 kg. It must be above 0.")],
        ),
    ],
)
def test_given_parameters_are_checked(
    given: dict[str, object], errors: list[tuple[str, str]]
) -> None:
    with pytest.raises(ProgrammeInvalid) as raised:
        resolve(parse_programme(spec_example()), given)
    assert sorted((e.path, e.message) for e in raised.value.errors) == errors


def test_given_parameters_are_held_to_min_and_max() -> None:
    programme = parse_programme(load(FIXTURES / "valid" / "beginner-5x5.json"))
    with pytest.raises(ProgrammeInvalid) as raised:
        resolve(programme, {"squat": 10, "rate": 25})
    assert sorted((e.path, e.message) for e in raised.value.errors) == [
        ("params.rate", "the most it can be is 20."),
        ("params.squat", "the least it can be is 20."),
    ]


def test_given_parameters_must_be_an_object() -> None:
    with pytest.raises(ProgrammeInvalid) as raised:
        resolve(parse_programme(spec_example()), [40])  # type: ignore[arg-type]
    assert [str(e) for e in raised.value.errors] == [
        "params: give the parameter values as an object."
    ]


def test_a_parameter_used_by_an_add_is_checked_as_an_add() -> None:
    doc = spec_example()
    doc["params"]["inc"] = {"label": "Increase", "unit": "kg", "default": 2.5}
    doc["activities"][0]["weight"] = {"start": "$squat", "add": "$inc", "step": 2.5}
    with pytest.raises(ProgrammeInvalid) as raised:
        resolve(parse_programme(doc), {"inc": -501})
    assert [str(e) for e in raised.value.errors] == [
        "activities[0].weight.add: $inc is -501. An add is from -500 to 500."
    ]


def test_a_bare_parameter_rounds_to_the_items_precision() -> None:
    doc = spec_example()
    doc["params"]["sets"] = {"label": "Sets", "unit": "sets", "default": 4.5}
    doc["activities"][0]["sets"] = "$sets"
    resolved = resolve(parse_programme(doc))
    assert expand_week(resolved, 1)["squat"]["sets"] == 5  # 4.5, halves up


# ---- Expansion ----


@pytest.mark.parametrize("path", EXPANSIONS, ids=lambda p: p.stem)
def test_golden_expansions(path: Path) -> None:
    golden = load(path)
    doc = golden["document"] if "document" in golden else load(FIXTURES / golden["programme"])
    resolved = resolve(parse_programme(doc), golden["params"])
    for week in golden["weeks"]:
        n = week["programmeWeek"]
        assert resolved.programme.label_at(n) == week["label"], f"week {n}"
        for key, expected in week["activities"].items():
            activity_week = week.get("activityWeeks", {}).get(key, n)
            got = expand_activity(resolved, key, programme_week=n, activity_week=activity_week)
            assert got == expected, f"{key}, programme week {n}, activity week {activity_week}"


def test_a_whole_week_defaults_activity_weeks_to_the_programme_week() -> None:
    resolved = resolve(parse_programme(load(FIXTURES / "valid" / "beginner-5x5.json")))
    week = expand_week(resolved, 6, {"deadlift": 4})
    assert list(week) == ["squat", "bench", "row", "deadlift", "plank"]
    assert week["deadlift"]["weight"] == 75
    assert week["squat"]["weight"] == 50


@pytest.mark.parametrize(("programme_week", "activity_week"), [(0, 1), (9, 1), (3, 0), (3, 9)])
def test_weeks_outside_the_programme_are_refused(programme_week: int, activity_week: int) -> None:
    """Both weeks run from 1 to the programme's last. An activity week may be ahead of the
    programme week (a paused activity stays put when the programme goes back, spec §6.3)."""
    resolved = resolve(parse_programme(spec_example()))
    with pytest.raises(ValueError, match="week"):
        expand_activity(
            resolved, "squat", programme_week=programme_week, activity_week=activity_week
        )


def test_rep_cap_is_the_formats_own() -> None:
    """validate.py has no cap on reps, so the format sets one."""
    assert MAX_REPS == 1000
