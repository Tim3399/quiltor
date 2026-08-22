"""Frozen manuscript-v1 text-offset semantics.

CodeMirror and JavaScript index strings in UTF-16 code units. The v1 wire contract
uses that same unit so an editor range has one meaning in every runtime. Offsets
inside a surrogate pair are invalid Unicode-scalar boundaries.
"""

from __future__ import annotations

from collections.abc import Iterable


def utf16_length(text: str) -> int:
    """Return the JavaScript ``String.length`` of *text* without encoding it."""
    return sum(2 if ord(character) > 0xFFFF else 1 for character in text)


def utf16_offsets_to_indices(text: str, offsets: Iterable[int]) -> dict[int, int] | None:
    """Map UTF-16 offsets to Python indices in one pass.

    ``None`` means at least one offset is negative, beyond the text, or points
    between the two code units representing one astral Unicode scalar.
    """
    targets = set(offsets)
    if any(type(offset) is not int or offset < 0 for offset in targets):
        return None
    if not targets:
        return {}

    positions: dict[int, int] = {0: 0} if 0 in targets else {}
    units = 0
    for index, character in enumerate(text):
        width = 2 if ord(character) > 0xFFFF else 1
        next_units = units + width
        if width == 2 and units + 1 in targets:
            return None
        if next_units in targets:
            positions[next_units] = index + 1
        units = next_units
        if len(positions) == len(targets):
            break
    return positions if len(positions) == len(targets) else None


def utf16_span(text: str, start: int, end: int) -> tuple[int, int] | None:
    """Translate one valid half-open UTF-16 span to Python string indices."""
    if type(start) is not int or type(end) is not int or start < 0 or end <= start:
        return None
    positions = utf16_offsets_to_indices(text, (start, end))
    if positions is None:
        return None
    return positions[start], positions[end]
