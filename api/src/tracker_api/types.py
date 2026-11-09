"""Tracker types (docs/architecture.md §1): what kind of thing a section tracks.

The port of src/lib/trackerTypes.ts. A section is the stored name (`exercise`, `cardio`, `diet`:
in URLs, the database and exports); its type is an attribute of it. `tests/test_types.py` and the
web app's `trackerTypes.spec.ts` both read `fixtures/types/registry.json`, which keeps the two in
step.
"""

from dataclasses import dataclass
from typing import Literal

type TypeId = Literal["exercise", "cardio", "food"]
#: The settings key that holds how many items a day count as a met day (K30, K57).
type PickKey = Literal["dailyPick", "foodPick"]
#: A section's stored name, in the order the week shows them. `tests/test_types.py` checks it
#: lists SECTION_TYPES' keys.
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
    #: The daily target's setting; None for a type with no daily target (cardio, K90).
    pick_key: PickKey | None
    #: The weekly goal an added item starts with.
    new_target: int


EXERCISE = TrackerType(
    id="exercise",
    fields=(
        ItemField("equipment", "Equipment"),
        ItemField("works", "Works"),
        ItemField("link", "Link"),
    ),
    pick_key="dailyPick",
    new_target=3,
)
#: Cycling, running and the like (K90): a duration and a distance, every kind of mark like an
#: exercise, a weekly goal and no daily target.
CARDIO = TrackerType(
    id="cardio",
    fields=(ItemField("route", "Route"), ItemField("link", "Link")),
    pick_key=None,
    new_target=3,
)
FOOD = TrackerType(
    id="food",
    fields=(ItemField("serving", "A serving"), ItemField("examples", "Examples")),
    pick_key="foodPick",
    new_target=3,
)

TYPES: dict[TypeId, TrackerType] = {t.id: t for t in (EXERCISE, CARDIO, FOOD)}
#: Each section's type, in the order the week shows them. A second tracker of a type would be a
#: new section here.
SECTION_TYPES: dict[Section, TrackerType] = {"exercise": EXERCISE, "cardio": CARDIO, "diet": FOOD}
SECTIONS: tuple[Section, ...] = tuple(SECTION_TYPES)
