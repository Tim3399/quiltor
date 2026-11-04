"""Rich-text ranges shared by every author-owned note surface."""

from __future__ import annotations

from collections.abc import Mapping

from quiltor.domain.json_values import as_array, as_object
from quiltor.domain.text_offsets import utf16_offsets_to_indices

MAX_NOTE_MARKS = 10_000

_KINDS = {"bold", "italic", "heading"}


def valid_note_marks(owner: Mapping[str, object], note_key: str) -> bool:
    """Validate bold/italic spans and canonical single-line headings over plain note text."""

    text = owner.get(note_key, "")
    marks = as_array(owner.get("noteMarks", []))
    if not isinstance(text, str) or marks is None or len(marks) > MAX_NOTE_MARKS:
        return False
    rows: list[tuple[int, int, str]] = []
    offsets: list[int] = []
    for item in marks:
        mark = as_object(item)
        if mark is None:
            return False
        kind = mark.get("kind")
        if not isinstance(kind, str) or kind not in _KINDS:
            return False
        start, end = mark.get("from"), mark.get("to")
        if type(start) is not int or type(end) is not int or start < 0 or end <= start:
            return False
        if kind == "heading":
            level = mark.get("level")
            if type(level) is not int or level not in {1, 2, 3}:
                return False
        elif "level" in mark:
            return False
        rows.append((start, end, kind))
        offsets.extend((start, end))
    indices = utf16_offsets_to_indices(text, offsets)
    if indices is None:
        return False

    previous_inline_end: dict[str, int] = {}
    heading_starts: set[int] = set()
    for start, end, kind in sorted(rows):
        if kind == "heading":
            python_start, python_end = indices[start], indices[end]
            if (
                start in heading_starts
                or (python_start > 0 and text[python_start - 1] != "\n")
                or (python_end < len(text) and text[python_end] != "\n")
                or "\n" in text[python_start:python_end]
            ):
                return False
            heading_starts.add(start)
        else:
            if start < previous_inline_end.get(kind, -1):
                return False
            previous_inline_end[kind] = end
    return True


__all__ = ["MAX_NOTE_MARKS", "valid_note_marks"]
