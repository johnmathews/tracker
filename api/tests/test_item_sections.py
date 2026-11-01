"""The item page's arrangement: the same normaliser as src/lib/itemSections.ts, through a shared
fixture, and what `PUT /api/settings` refuses."""

import json
from pathlib import Path
from typing import Any

import pytest

from tracker_api.item_sections import (
    DEFAULT_ORDER,
    item_sections_valid,
    normalise_item_sections,
)
from tracker_api.types import TYPES

#: The cases both sides must agree on: src/lib/__tests__/itemSections.spec.ts reads it too.
FIXTURE: dict[str, Any] = json.loads(
    (
        Path(__file__).resolve().parents[2] / "fixtures" / "item-sections" / "normalise.json"
    ).read_text(encoding="utf-8")
)
CASES: list[dict[str, Any]] = FIXTURE["cases"]


def test_the_keys_and_default_order_match_the_web_app() -> None:
    assert list(DEFAULT_ORDER) == FIXTURE["keys"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_normalise(case: dict[str, Any]) -> None:
    assert normalise_item_sections(case["input"]) == case["output"]


def test_normalised_output_is_already_normal_and_in_registry_order() -> None:
    for case in CASES:
        out = normalise_item_sections(case["input"])
        assert normalise_item_sections(out) == out
        assert list(out) == [t for t in TYPES if t in out]


ARRANGED = {"order": ["history", "notes", "details", "plan"], "hidden": ["details"]}


@pytest.mark.parametrize(
    "value",
    [
        {},
        {"exercise": ARRANGED},
        {"exercise": ARRANGED, "food": {"order": [], "hidden": []}},
        # Within the shape, unknown and repeated keys normalise rather than refuse.
        {"food": {"order": ["map", "plan", "plan"], "hidden": ["map"], "extra": 1}},
    ],
)
def test_valid_shapes(value: object) -> None:
    assert item_sections_valid(value)


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        "notes",
        {"cardio": ARRANGED},
        {"diet": ARRANGED},
        {"__proto__": ARRANGED},
        {"exercise": None},
        {"exercise": ["notes"]},
        {"exercise": {"hidden": []}},
        {"exercise": {"order": ARRANGED["order"]}},
        {"exercise": {"order": "notes", "hidden": []}},
        {"exercise": {"order": ["notes", 1], "hidden": []}},
        {"exercise": {"order": [], "hidden": [None]}},
        {"exercise": {"order": [], "hidden": {"details": True}}},
    ],
)
def test_malformed_shapes(value: object) -> None:
    assert not item_sections_valid(value)
