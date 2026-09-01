"""Rich-text ranges shared by every author-owned note surface."""

from __future__ import annotations

from typing import Any

from quiltor.domain.text_offsets import utf16_offsets_to_indices

MAX_NOTE_MARKS = 10_000


def valid_note_marks(owner: dict[str, Any], note_key: str) -> bool:
    """Validate bold/italic spans and canonical single-line headings over plain note text."""

    text = owner.get(note_key, "")
    marks = owner.get("noteMarks", [])
    if not isinstance(text, str) or not isinstance(marks, list) or len(marks) > MAX_NOTE_MARKS:
        return False
    offsets: list[int] = []
    for mark in marks:
        if not isinstance(mark, dict) or mark.get("kind") not in {"bold", "italic", "heading"}:
            return False
        start, end = mark.get("from"), mark.get("to")
        if type(start) is not int or type(end) is not int or start < 0 or end <= start:
            return False
        if mark["kind"] == "heading":
            if type(mark.get("level")) is not int or mark["level"] not in {1, 2, 3}:
                return False
        elif "level" in mark:
            return False
        offsets.extend((start, end))
    indices = utf16_offsets_to_indices(text, offsets)
    if indices is None:
        return False

    previous_inline_end: dict[str, int] = {}
    heading_starts: set[int] = set()
    for mark in sorted(marks, key=lambda item: (item["from"], item["to"], item["kind"])):
        start, end, kind = mark["from"], mark["to"], mark["kind"]
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
