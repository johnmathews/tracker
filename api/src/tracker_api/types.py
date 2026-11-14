"""Tracker kinds (docs/architecture.md §1, the spec docs/specs/2026-11-14-account-trackers.md).

The port of src/lib/trackerTypes.ts. A kind is code: what an item records, and whether a tracker
of it has a daily target. A tracker is data: each account's own, with an id, a name and a kind
(`data.py`). Each account's first three trackers keep today's section names as their ids
(`exercise`, `cardio`, `diet`: in URLs, the database and exports). `tests/test_types.py` and the
web app's `trackerTypes.spec.ts` both read `fixtures/types/registry.json`, which keeps the two in
step.
"""

from dataclasses import dataclass
from typing import Literal

#: A kind's id. `strength` was `exercise` before trackers were the account's own (K123).
type TypeId = Literal["strength", "cardio", "food", "mobility"]
#: The settings key that holds how many items a day count as a met day (K30, K57).
type PickKey = Literal["dailyPick", "foodPick"]
#: The ids of each account's first three trackers, in the order the week first showed them.
#: `tests/test_types.py` checks it lists SECTION_TYPES' keys.
Section = Literal["exercise", "cardio", "diet"]


@dataclass(frozen=True)
class ItemField:
    """A text field on the item page, by its stored key and the label it shows."""

    key: str
    label: str


@dataclass(frozen=True)
class TrackerType:
    id: TypeId
    #: The item page's fields, in order.
    fields: tuple[ItemField, ...]
    #: The settings key the first tracker of this kind keeps its daily target in, beside the
    #: tracker; None for cardio, which has no daily target (K90), and for mobility, whose
    #: trackers keep theirs only on the tracker.
    pick_key: PickKey | None
    #: The weekly goal an added item starts with.
    new_target: int
    #: The daily target a new tracker of this kind starts with; None for a kind with none.
    daily_target: int | None


STRENGTH = TrackerType(
    id="strength",
    fields=(
        ItemField("equipment", "Equipment"),
        ItemField("works", "Works"),
        ItemField("link", "Link"),
    ),
    pick_key="dailyPick",
    new_target=3,
    daily_target=3,
)
#: Cycling, running and the like (K90): a duration and a distance, every kind of mark like an
#: exercise, a weekly goal and no daily target.
CARDIO = TrackerType(
    id="cardio",
    fields=(ItemField("route", "Route"), ItemField("link", "Link")),
    pick_key=None,
    new_target=3,
    daily_target=None,
)
FOOD = TrackerType(
    id="food",
    fields=(ItemField("serving", "A serving"), ItemField("examples", "Examples")),
    pick_key="foodPick",
    new_target=3,
    daily_target=2,
)

#: Stretches, holds and drills (K123): an exercise's sets, then reps or a hold time, each side if
#: you like, and no weight (`validate.normalise_mobility`); marked as an exercise is, with a daily
#: target of its own.
MOBILITY = TrackerType(
    id="mobility",
    fields=(
        ItemField("equipment", "Equipment"),
        ItemField("works", "Works"),
        ItemField("link", "Link"),
    ),
    pick_key=None,
    new_target=3,
    daily_target=3,
)

TYPES: dict[TypeId, TrackerType] = {t.id: t for t in (STRENGTH, CARDIO, FOOD, MOBILITY)}
#: The kind of each of the first three trackers, in the order the week first showed them.
SECTION_TYPES: dict[Section, TrackerType] = {"exercise": STRENGTH, "cardio": CARDIO, "diet": FOOD}
SECTIONS: tuple[Section, ...] = tuple(SECTION_TYPES)
#: The names the first three trackers start with (K123: the Exercises tracker reads "Strength").
SECTION_NAMES: dict[Section, str] = {"exercise": "Strength", "cardio": "Cardio", "diet": "Food"}
