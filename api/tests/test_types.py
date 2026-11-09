"""The tracker-type registry: the same as src/lib/trackerTypes.ts, through a shared fixture."""

import json
from pathlib import Path
from typing import Any, get_args

from tracker_api import validate
from tracker_api.types import SECTION_TYPES, SECTIONS, TYPES, Section

#: The registry both sides must match: src/lib/__tests__/trackerTypes.spec.ts reads it too.
EXPECTED: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[2] / "fixtures" / "types" / "registry.json").read_text(
        encoding="utf-8"
    )
)


def test_sections_map_to_types_as_the_web_app_does() -> None:
    assert {s: t.id for s, t in SECTION_TYPES.items()} == EXPECTED["sections"]
    assert SECTIONS == ("exercise", "cardio", "diet")


def test_types_have_the_web_apps_fields_pick_and_goal() -> None:
    types = {
        t.id: {
            "pickKey": t.pick_key,
            "newTarget": t.new_target,
            "fields": [{"key": f.key, "label": f.label} for f in t.fields],
        }
        for t in TYPES.values()
    }
    assert types == EXPECTED["types"]


def test_types_are_keyed_by_id_with_unique_field_keys() -> None:
    for type_id, tracker_type in TYPES.items():
        assert tracker_type.id == type_id
        keys = [f.key for f in tracker_type.fields]
        assert len(set(keys)) == len(keys)


def test_section_literal_matches_the_registry() -> None:
    # A section added to one and not the other would type-check and fail here.
    assert get_args(Section) == SECTIONS


def test_validate_reads_the_registry() -> None:
    assert validate.SECTIONS is SECTIONS
    expected = {
        "exercise": validate.normalise_exercise,
        "cardio": validate.normalise_cardio,
        "diet": validate.normalise_food,
    }
    assert expected == validate.NORMALISERS
    targets = (validate.NEW_EXERCISE_TARGET, validate.NEW_CARDIO_TARGET, validate.NEW_FOOD_TARGET)
    assert targets == tuple(SECTION_TYPES[s].new_target for s in ("exercise", "cardio", "diet"))
    # The export's sections are the registry's, plus settings and Ask's conversations.
    assert set(validate.ExportData.__annotations__) == {*SECTIONS, "settings", "conversations"}


def test_cardio_has_no_daily_pick() -> None:
    """K90: Cardio has weekly goals only, so no setting names a number a day for it."""
    assert SECTION_TYPES["cardio"].pick_key is None
    assert [t.pick_key for t in TYPES.values() if t.pick_key] == ["dailyPick", "foodPick"]
