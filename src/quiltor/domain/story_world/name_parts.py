"""The parts of a figure's name, and which figure a part names (T-344, D-243, D-244).

Novels call their figures by first name, by last name, or by a form of address and a last
name ("Oda", "Brandt", "Frau Brandt" for "Oda Brandt"). Only figures (person, animal) are
named so; a place or an organisation is only found by its full name or an alias -- "Gilde"
alone is not "Vereinigte Gilde der Kartographen" (F-344-7).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any, cast

#: Types whose names are matched by their parts as well.
NAME_PART_TYPES = frozenset({"person", "tier"})
#: Words of a name that never stand for it on their own. German, because they read German text.
NAME_PART_STOPWORDS = frozenset(
    {
        "der",
        "die",
        "das",
        "den",
        "dem",
        "des",
        "von",
        "vom",
        "zu",
        "zum",
        "zur",
        "am",
        "im",
        "an",
        "auf",
        "und",
        "van",
        "de",
        "la",
        "le",
    }
)
#: Forms of address before a name part ("Frau Brandt", "Kapitänin Estrand"). German, like the
#: manuscripts they read; a first or last name alone works in any language.
HONORIFICS = frozenset(
    {
        "frau",
        "herr",
        "fräulein",
        "kapitän",
        "kapitänin",
        "meister",
        "meisterin",
        "doktor",
        "dr.",
        "dr",
        "mutter",
        "vater",
    }
)
_WORD = re.compile(r"[^\W\d_][\w'\u2019-]*")


def name_parts(name: str) -> list[str]:
    """The words of a name that may stand for it alone: three letters or more and not a
    function word ("Oda", "Brandt" for "Oda Brandt"). A hyphenated name is one word."""
    return [
        word
        for word in _WORD.findall(name)
        if len(word) >= 3 and word.casefold() not in NAME_PART_STOPWORDS
    ]


def without_address(mention: str) -> str:
    """``mention`` without forms of address in front ("Frau Brandt" → "Brandt")."""
    words = mention.split()
    while len(words) > 1 and words[0].casefold() in HONORIFICS:
        words = words[1:]
    return " ".join(words)


def _surfaces(node: Mapping[str, Any]) -> Iterable[str]:
    name = node.get("name")
    if isinstance(name, str) and name.strip():
        yield name
    aliases: object = node.get("aliases")
    if not isinstance(aliases, list):
        return
    for item in cast(list[object], aliases):
        if isinstance(item, Mapping):
            alias = cast(Mapping[str, object], item).get("alias")
            if isinstance(alias, str):
                yield alias


def name_part_owners(
    nodes: Iterable[Mapping[str, Any]], mention: str, entity_type: str | None = None
) -> list[str]:
    """The ids of the figures whose name has ``mention`` (after any form of address) as one of
    its parts. Empty for a mention of more than one word or a type that is not a figure."""
    if (entity_type or "person") not in NAME_PART_TYPES:
        return []
    part = without_address(mention.strip())
    if not part or len(part.split()) != 1:
        return []
    folded = part.casefold()
    owners: list[str] = []
    for node in nodes:
        ident = node.get("id")
        if not isinstance(ident, str) or str(node.get("type") or "person") not in NAME_PART_TYPES:
            continue
        if any(
            folded == word.casefold() for surface in _surfaces(node) for word in name_parts(surface)
        ):
            owners.append(ident)
    return owners


__all__ = [
    "HONORIFICS",
    "NAME_PART_STOPWORDS",
    "NAME_PART_TYPES",
    "name_part_owners",
    "name_parts",
    "without_address",
]
