"""The shared fixtures through the Python port: what src/lib/__tests__/transfer.spec.ts runs."""

import json
from typing import Any

import pytest

from tracker_api.validate import (
    MARKS,
    Days,
    ExportError,
    days_to_masks,
    masks_to_days,
    merge_settings,
    merge_summary,
    merge_tracked,
    normalise_mark,
    parse_export,
)

from .fixtures import fixture_cases, read_fixture

PARSE = fixture_cases("parse")
MERGE = fixture_cases("merge")
SETTINGS = read_fixture("merge-settings.json")["cases"]


def run_parse(text: str) -> dict[str, Any]:
    try:
        return {"ok": True, "data": parse_export(text)}
    except ExportError as e:
        return {"ok": False, "error": e.code}


def test_finds_the_fixture_files() -> None:
    assert len(PARSE) >= 14
    assert len(MERGE) >= 6
    assert len(SETTINGS) >= 3


@pytest.mark.parametrize(("name", "case"), PARSE, ids=[n for n, _ in PARSE])
def test_parse(name: str, case: dict[str, Any]) -> None:
    text = case["inputText"] if "inputText" in case else json.dumps(case["input"])
    assert run_parse(text) == case["expected"]


@pytest.mark.parametrize(("name", "case"), MERGE, ids=[n for n, _ in MERGE])
def test_merge(name: str, case: dict[str, Any]) -> None:
    assert merge_tracked(case["existing"], case["incoming"]) == case["expected"]
    assert merge_summary(case["existing"], case["incoming"]) == case["summary"]


@pytest.mark.parametrize("case", SETTINGS, ids=[c["description"] for c in SETTINGS])
def test_merge_settings(case: dict[str, Any]) -> None:
    assert merge_settings(case["existing"], case["incoming"]) == case["expected"]


def test_sample_export_parses_to_itself() -> None:
    sample = read_fixture("sample/export.json")
    data = parse_export(json.dumps(sample))
    assert data == {k: sample[k] for k in ("exercise", "diet", "settings")}


def test_json_numbers_keep_their_type() -> None:
    """Whole numbers come back as int, so the API's JSON reads 12 rather than 12.0."""
    data = parse_export(json.dumps(read_fixture("sample/export.json")))
    squats = data["exercise"]["plans"]["2026-10-12"][2]
    assert squats["weight"] == 16
    assert type(squats["weight"]) is int


def test_merge_does_not_alias_its_inputs() -> None:
    incoming: Any = {
        "plans": {"2026-10-19": [{"id": "pu", "name": "Push-ups", "reps": 10, "target": 4}]},
        "log": {"2026-10-19": {"pu": ["great", None, None, None, None, None, None]}},
        "details": {"pu": {"notes": "Slow.", "fields": {"equipment": "Mat"}}},
    }
    existing: Any = {"plans": {}, "log": {}, "details": {"sq": {"notes": "Mine."}}}
    merged = merge_tracked(existing, incoming)
    merged["plans"]["2026-10-19"][0]["reps"] = 99
    merged["log"]["2026-10-19"]["pu"][1] = "partial"
    merged["details"]["pu"]["fields"]["equipment"] = "Bench"
    merged["details"]["sq"]["notes"] = "Changed."
    assert incoming["plans"]["2026-10-19"][0]["reps"] == 10
    assert incoming["log"]["2026-10-19"]["pu"][1] is None
    assert incoming["details"]["pu"]["fields"]["equipment"] == "Mat"
    assert existing["details"]["sq"]["notes"] == "Mine."


@pytest.mark.parametrize(
    ("value", "mark"),
    [
        (True, "great"),
        ("great", "great"),
        ("partial", "partial"),
        ("missed", "missed"),
        (None, None),
        (False, None),
        (1, None),
        (1.0, None),
        ("true", None),
        ("GREAT", None),
        ("", None),
        ({}, None),
        (["great"], None),
    ],
)
def test_normalise_mark(value: object, mark: str | None) -> None:
    """Only a literal `True` stands for a mark from before marks had kinds; `1 == True` is not."""
    assert normalise_mark(value) == mark


def test_masks_round_trip_every_mark() -> None:
    days: Days = ["great", "partial", "missed", None, "missed", "partial", "great"]
    assert days_to_masks(days) == (0b1110111, 0b0100010, 0b0010100, 0, 0)
    assert masks_to_days(*days_to_masks(days)) == days
    assert days_to_masks([None] * 7) == (0, 0, 0, 0, 0)
    # A row from before marks had kinds has only `days`: every marked day is a great zigzag.
    assert masks_to_days(0b0000101, 0, 0, 0, 0) == ["great", None, "great", None, None, None, None]


def test_masks_round_trip_every_drawing() -> None:
    days: Days = [
        "great-solid",
        "partial-hatch",
        "missed-solid",
        None,
        "great-hatch",
        "partial-solid",
        "missed-hatch",
    ]
    assert days_to_masks(days) == (0b1110111, 0b0100010, 0b1000100, 0b0100101, 0b1010010)
    assert masks_to_days(*days_to_masks(days)) == days
    for mark in MARKS:
        assert masks_to_days(*days_to_masks([mark] + [None] * 6))[0] == mark


def test_deliberate_divergences_from_javascript() -> None:
    """Inputs JavaScript accepts that the API refuses as `json`; neither can come from the app."""
    deep = (
        '{"format": "fitness-planner-export", "version": 1, "x": '
        + "[" * 100_000
        + "]" * 100_000
        + "}"
    )
    surrogate = (
        '{"format": "fitness-planner-export", "version": 1,'
        ' "exercise": {"log": {"2026-10-19": {"\\ud800": [true]}}}}'
    )
    for text in (deep, surrogate):
        with pytest.raises(ExportError, match="json"):
            parse_export(text)
