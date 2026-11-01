"""Tracker types (docs/architecture.md §1): what kind of thing a section tracks.

The port of src/lib/trackerTypes.ts. A section is the stored name (`exercise`, `diet`: in URLs, the
database and exports); its type is an attribute of it. `tests/test_types.py` and the web app's
`trackerTypes.spec.ts` both read `fixtures/types/registry.json`, which keeps the two in step.
"""

from dataclasses import dataclass
from typing import Literal

type TypeId = Literal["exercise", "food"]
#: The settings key that holds how many items a day count as a met day (K30, K57).
type PickKey = Literal["dailyPick", "foodPick"]
#: A section's stored name. `tests/test_types.py` checks it lists SECTION_TYPES' keys.
Section = Literal["exercise", "diet"]


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
    pick_key: PickKey
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
FOOD = TrackerType(
    id="food",
    fields=(ItemField("serving", "A serving"), ItemField("examples", "Examples")),
    pick_key="foodPick",
    new_target=3,
)

TYPES: dict[TypeId, TrackerType] = {t.id: t for t in (EXERCISE, FOOD)}
#: Each section's type, in the order the week shows them. A second tracker of a type would be a
#: new section here.
SECTION_TYPES: dict[Section, TrackerType] = {"exercise": EXERCISE, "diet": FOOD}
SECTIONS: tuple[Section, ...] = tuple(SECTION_TYPES)
