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
    with_old_keys,
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
        {"strength": ARRANGED},
        {"strength": ARRANGED, "food": {"order": [], "hidden": []}},
        # The kind's old key, from a tab on older code (K123).
        {"exercise": ARRANGED},
        # Cardio is a type (K90), so it has an arrangement of its own.
        {"cardio": ARRANGED},
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
        {"swimming": ARRANGED},
        {"diet": ARRANGED},
        {"__proto__": ARRANGED},
        {"strength": None},
        {"exercise": None},
        {"strength": ["notes"]},
        {"strength": {"hidden": []}},
        {"strength": {"order": ARRANGED["order"]}},
        {"strength": {"order": "notes", "hidden": []}},
        {"strength": {"order": ["notes", 1], "hidden": []}},
        {"strength": {"order": [], "hidden": [None]}},
        {"strength": {"order": [], "hidden": {"details": True}}},
    ],
)
def test_malformed_shapes(value: object) -> None:
    assert not item_sections_valid(value)


def test_with_old_keys_copies_strength_to_exercise() -> None:
    """The state sends the strength kind's arrangement under its old key too (K123)."""
    assert with_old_keys({"strength": ARRANGED, "food": ARRANGED}) == {  # type: ignore[dict-item]
        "strength": ARRANGED,
        "food": ARRANGED,
        "exercise": ARRANGED,
    }
    assert with_old_keys({"food": ARRANGED}) == {"food": ARRANGED}  # type: ignore[dict-item]
