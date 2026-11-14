"""The item page's sections, shown or hidden and in order, per tracker type (K66, P29).

The port of src/lib/itemSections.ts. `tests/test_item_sections.py` and the web app's
`itemSections.spec.ts` both run `fixtures/item-sections/normalise.json`, which keeps the two in
step. The arrangement is a setting (`itemSections` in `PUT /api/settings`, the state and exports),
keyed by kind, not tracker, so every page of a kind shares one.
"""

from typing import Any, Literal, TypedDict, TypeIs

from .types import TYPES, TypeId

#: The item page's sections: its notes, its type's fields, the week's plan and recent weeks.
type SectionKey = Literal["notes", "details", "plan", "history"]
#: The order a page shows them in until it is arranged, every one shown: the plan first (K104).
DEFAULT_ORDER: tuple[SectionKey, ...] = ("plan", "notes", "details", "history")


class Arrangement(TypedDict):
    """One type's page: every section once, in the order shown, and those it hides (in the
    default order, so moving a section never reorders them)."""

    order: list[SectionKey]
    hidden: list[SectionKey]


#: Each type's arrangement by type id. A type left out has the default one.
type ItemSections = dict[TypeId, Arrangement]
#: Keys an older tab or file uses for a kind since renamed: `exercise` is `strength` (K123).
OLD_KEYS: dict[str, TypeId] = {"exercise": "strength"}


def is_section_key(v: object) -> TypeIs[SectionKey]:
    return isinstance(v, str) and v in DEFAULT_ORDER


def _known(v: object) -> list[SectionKey]:
    """A list's section keys, each once, in the list's order; anything else is passed over."""
    out: list[SectionKey] = []
    if isinstance(v, list):
        for key in v:
            if is_section_key(key) and key not in out:
                out.append(key)
    return out


def normalise_arrangement(v: object) -> Arrangement:
    """One type's arrangement: known keys once each, the missing ones after them in the default
    order; `hidden` a subset of the keys, in the default order. Anything unusable reads as the
    default."""
    raw: dict[str, Any] = v if isinstance(v, dict) else {}
    order = _known(raw.get("order"))
    order += [k for k in DEFAULT_ORDER if k not in order]
    hidden = set(_known(raw.get("hidden")))
    return {"order": order, "hidden": [k for k in DEFAULT_ORDER if k in hidden]}


def is_default(arrangement: Arrangement) -> bool:
    return tuple(arrangement["order"]) == DEFAULT_ORDER and not arrangement["hidden"]


def _renamed(v: dict[str, Any]) -> dict[str, Any]:
    """`v` with each old key under its kind's id. A current key wins over an old one."""
    out: dict[str, Any] = {OLD_KEYS[k]: raw for k, raw in v.items() if k in OLD_KEYS}
    out.update({k: raw for k, raw in v.items() if k not in OLD_KEYS})
    return out


def normalise_item_sections(v: object) -> ItemSections:
    """Each type's arrangement, in the registry's order, leaving out a type with the default
    one. An old key reads as its kind's id. A type the registry doesn't have is dropped, so a
    stored or exported value from a newer version still reads; anything that isn't an object
    reads as `{}`."""
    out: ItemSections = {}
    if not isinstance(v, dict):
        return out
    current = _renamed(v)
    for type_id in TYPES:
        if type_id in current:
            arrangement = normalise_arrangement(current[type_id])
            if not is_default(arrangement):
                out[type_id] = arrangement
    return out


def with_old_keys(item_sections: ItemSections) -> dict[str, Arrangement]:
    """`item_sections` with each renamed kind's arrangement under its old key too, for a tab on
    older code: it drops the new key, and would otherwise save its pages back as the default."""
    out: dict[str, Arrangement] = {k: v for k, v in item_sections.items()}
    for old, type_id in OLD_KEYS.items():
        if type_id in item_sections:
            out[old] = item_sections[type_id]
    return out


def _strings(v: object) -> bool:
    return isinstance(v, list) and all(isinstance(s, str) for s in v)


def item_sections_valid(v: object) -> bool:
    """Whether `PUT /api/settings` takes `v` as `itemSections`: an object keyed by registry type
    ids (or their old keys), each an object whose `order` and `hidden` are lists of strings.
    Within that shape the rest normalises (unknown or repeated keys drop, missing ones are
    appended), as the other settings do; a shape the app never sends is refused, as a plan that
    isn't a list is."""
    if not isinstance(v, dict):
        return False
    return all(
        (key in TYPES or key in OLD_KEYS)
        and isinstance(raw, dict)
        and _strings(raw.get("order"))
        and _strings(raw.get("hidden"))
        for key, raw in v.items()
    )
