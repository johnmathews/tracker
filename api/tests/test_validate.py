"""The request-level checks shared by the REST routes and the MCP tools."""

from typing import Any

import pytest

from tracker_api.validate import (
    Invalid,
    check_day,
    check_item_id,
    check_plan_body,
    strict_item,
    tick_mark,
    week_key,
)


def test_week_key_accepts_any_dated_shape_and_rejects_the_rest() -> None:
    # REST keeps the loose shape: old clients may send a non-Monday or a non-date.
    assert week_key("2026-10-19") == "2026-10-19"
    assert week_key("2026-02-31") == "2026-02-31"
    for bad in (
        "not-a-week",
        "2026-10-19\n",
        "\u0662\u0660\u0662\u0666-\u0661\u0660-\u0661\u0669",
        "",
        "2026-1-9",
    ):
        with pytest.raises(Invalid):
            week_key(bad)


def test_check_plan_body() -> None:
    assert check_plan_body({"items": [{"id": "a"}], "rev": 0}) == ([{"id": "a"}], 0)
    bad: list[dict[str, Any]] = [
        {},
        {"items": [], "rev": -1},
        {"items": [], "rev": True},
        {"items": [], "rev": 1.0},
        {"items": [], "rev": "1"},
        {"items": {}, "rev": 0},
        {"items": None, "rev": 0},
        {"rev": 0},
        {"items": []},
    ]
    for body in bad:
        with pytest.raises(Invalid):
            check_plan_body(body)


def test_check_item_id_is_one_to_128_characters() -> None:
    assert check_item_id("a") == "a"
    assert check_item_id("x" * 128) == "x" * 128
    for bad in ("", "x" * 129):
        with pytest.raises(Invalid):
            check_item_id(bad)


def test_check_day_is_zero_to_six() -> None:
    assert [check_day(d) for d in range(7)] == list(range(7))
    for bad in (-1, 7):
        with pytest.raises(Invalid):
            check_day(bad)


def test_tick_mark_reads_mark_or_the_old_done_flag() -> None:
    assert tick_mark({"mark": "partial-hatch"}) == "partial-hatch"
    assert tick_mark({"mark": None}) is None
    assert tick_mark({"done": True}) == "great"
    assert tick_mark({"done": False}) is None
    # `mark` wins over `done`; an invalid `mark` is not rescued by a valid `done`.
    assert tick_mark({"mark": "missed", "done": True}) == "missed"
    bad: list[dict[str, Any]] = [
        {"mark": "GREAT"},
        {"mark": True},
        {"mark": 1},
        {"mark": ["great"]},
        {"mark": "x", "done": True},
        {"done": 1},
        {"done": None},
        {},
    ]
    for body in bad:
        with pytest.raises(Invalid):
            tick_mark(body)


def test_strict_item_returns_a_normalised_exercise() -> None:
    result = strict_item(
        "exercise", {"id": "pu", "name": "  Push-ups ", "reps": 10, "sets": 3, "target": 4}
    )
    assert result.problems == []
    assert result.item == {"id": "pu", "name": "Push-ups", "sets": 3, "reps": 10, "target": 4}


def test_strict_item_returns_a_food_with_a_target_and_no_note() -> None:
    """An item keeps no notes: they are its details, one copy for every week (D3)."""
    result = strict_item("diet", {"id": "v", "name": "Veg", "target": 9, "notes": " raw "})
    assert result.problems == []
    assert result.item == {"id": "v", "name": "Veg", "target": 7}


def test_strict_item_accepts_a_duration_alone() -> None:
    result = strict_item("exercise", {"id": "pl", "name": "Plank", "duration": 60})
    assert result.problems == []
    assert result.item is not None
    assert result.item["duration"] == 60
    assert result.item["reps"] == 0


def test_strict_item_reports_each_problem_instead_of_dropping_the_item() -> None:
    empty = strict_item("exercise", {"id": "a", "name": "   "})
    assert empty.item is None
    assert empty.problems == ["name is empty"]

    long = strict_item("diet", {"id": "a", "name": "x" * 81})
    assert long.item is None
    assert long.problems == ["name is over 80 characters"]
    assert strict_item("diet", {"id": "a", "name": "x" * 80}).problems == []

    both = strict_item("exercise", {"id": "a", "name": "Row", "reps": 5, "duration": 30})
    assert both.item is None
    assert both.problems == ["give reps or seconds, not both"]

    many = strict_item("exercise", {"id": "a", "name": "", "reps": 5, "duration": 30})
    assert many.problems == ["name is empty", "give reps or seconds, not both"]


def test_strict_item_reports_a_missing_id_or_a_non_object() -> None:
    assert strict_item("exercise", "pushups").problems == ["item is not an object"]
    assert strict_item("exercise", {"name": "Row"}).problems == ["id is missing"]
    assert strict_item("exercise", {"id": "a", "name": 5}).problems == ["name is empty"]
    assert strict_item("diet", {"id": "a" * 129, "name": "Row"}).problems == [
        "id must be 1 to 128 characters"
    ]
