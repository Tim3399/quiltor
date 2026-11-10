"""Move the text of Storyboard reference cards onto the one note of the element they show.

Up to schema 14 a reference card kept a note of its own, next to the note of the chapter,
figure, place or timeline moment it points at. From schema 15 there is one note per element,
and a reference card shows that note instead of carrying text (T-177, D-97, D-100).

The move happens once, at migration time, and is a pure function of the data: the same input
always yields the same notes, which the cloud pull relies on when it compares fingerprints
(F-177-1). Each card with text becomes one block appended to the element's note:

    <element note>\\n\\n— Aus Storyboard „<board title>“ —\\n<card text>

An empty element note gets the block without the leading blank paragraph. Blocks follow the
board's position, then the card's position, then its id. Every card gets its own block, even
when two carry the same words. Text made only of whitespace appends nothing.

A card's text is dropped, never kept out of sight (D-100), when its element no longer exists
-- a deleted figure or moment, a chapter in the trash -- or when appending it would push the
note past a limit the validators enforce. Dropped cards are counted, never quoted.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict, cast

from quiltor.domain.notes.marks import MAX_NOTE_MARKS
from quiltor.domain.text_offsets import utf16_length

# Limits of the note validators (domain/story_world/validation.py, domain/notes/marks.py).
MAX_CHAPTER_NOTE_LENGTH = 100_000
MAX_NOTE_REFERENCES = 10_000
MAX_NOTE_REFERENCE_ID_LENGTH = 500

ElementFamily = Literal["chapter", "figure", "moment"]
DiscardReason = Literal["missing_element", "limit"]

# Places are figures of kind "ort": both reference kinds share the figure's profile note.
_FAMILY_OF_KIND: dict[str, ElementFamily] = {
    "chapter": "chapter",
    "entity": "figure",
    "place": "figure",
    "timeline": "moment",
}

# Python characters, as `_valid_chapter` counts them. Profile and moment notes have no cap.
_TEXT_LIMITS: dict[ElementFamily, int | None] = {
    "chapter": MAX_CHAPTER_NOTE_LENGTH,
    "figure": None,
    "moment": None,
}

ElementKey = tuple[ElementFamily, str]
Row = dict[str, Any]


def element_key(target_kind: str, target_id: str) -> ElementKey | None:
    """The note a reference target points at, or None for a kind without element notes."""

    family = _FAMILY_OF_KIND.get(target_kind)
    return (family, target_id) if family is not None else None


def separator(board_title: str, *, first: bool) -> str:
    """The line that introduces one card's block; `first` when the element note is empty."""

    line = f"— Aus Storyboard „{board_title}“ —\n"
    return line if first else f"\n\n{line}"


@dataclass(frozen=True, slots=True)
class ElementNote:
    """One element's note: its text and the ranges on it, offsets in UTF-16 units."""

    text: str
    references: tuple[Row, ...] = ()
    marks: tuple[Row, ...] = ()


@dataclass(frozen=True, slots=True)
class ReferenceCardNote:
    """The note a schema-14 reference card carried, with what orders it among the others."""

    board_id: str
    board_title: str
    board_position: int
    card_id: str
    card_position: int
    target_kind: str
    target_id: str
    text: str
    references: tuple[Row, ...] = ()
    marks: tuple[Row, ...] = ()


@dataclass(frozen=True, slots=True)
class DiscardedCards:
    """How many cards of one board lost their text for one element, and why. Never the text."""

    board_id: str
    target_kind: str
    target_id: str
    reason: DiscardReason
    count: int


@dataclass(frozen=True, slots=True)
class AppendedNotes:
    """The element notes that changed, keyed like `element_key`, and the dropped cards."""

    notes: dict[ElementKey, ElementNote] = field(default_factory=dict[ElementKey, ElementNote])
    discarded: tuple[DiscardedCards, ...] = ()


def _shifted(row: Row, offset: int) -> Row:
    return {**row, "from": row["from"] + offset, "to": row["to"] + offset}


def _unique_id(reference_id: str, used: set[str]) -> str:
    if reference_id not in used:
        return reference_id
    suffix = 1
    while f"{reference_id}-sb{suffix}" in used:
        suffix += 1
    return f"{reference_id}-sb{suffix}"


def _appended(note: ElementNote, card: ReferenceCardNote) -> ElementNote:
    prefix = note.text + separator(card.board_title, first=note.text == "")
    # Offsets are UTF-16 code units: a character outside the BMP counts twice (F-177-6).
    offset = utf16_length(prefix)
    used = {str(reference.get("id")) for reference in note.references}
    references = list(note.references)
    for reference in card.references:
        moved = _shifted(reference, offset)
        moved["id"] = _unique_id(str(reference["id"]), used)
        used.add(moved["id"])
        references.append(moved)
    marks = [*note.marks, *(_shifted(mark, offset) for mark in card.marks)]
    return ElementNote(prefix + card.text, tuple(references), tuple(marks))


def _within_limits(note: ElementNote, family: ElementFamily) -> bool:
    text_limit = _TEXT_LIMITS[family]
    return (
        (text_limit is None or len(note.text) <= text_limit)
        and len(note.references) <= MAX_NOTE_REFERENCES
        and len(note.marks) <= MAX_NOTE_MARKS
        and all(
            utf16_length(str(reference["id"])) <= MAX_NOTE_REFERENCE_ID_LENGTH
            for reference in note.references
        )
    )


def append_reference_notes(
    cards: Iterable[ReferenceCardNote],
    notes: Mapping[ElementKey, ElementNote],
) -> AppendedNotes:
    """Append every card's text to its element's note; see the module docstring for the rules.

    `notes` holds the note of every element that exists. A card whose element is missing from
    it, or whose block would break a limit, is dropped and counted. Cards with blank text are
    neither appended nor counted: there is nothing to lose. The input is left unchanged.
    """

    ordered = sorted(
        cards,
        key=lambda card: (card.board_position, card.board_id, card.card_position, card.card_id),
    )
    changed: dict[ElementKey, ElementNote] = {}
    dropped: dict[tuple[str, str, str, DiscardReason], int] = {}
    for card in ordered:
        if not card.text.strip():
            continue
        key = element_key(card.target_kind, card.target_id)
        current = changed.get(key) or notes.get(key) if key is not None else None
        reason: DiscardReason | None = None
        if key is None or current is None:
            reason = "missing_element"
        else:
            candidate = _appended(current, card)
            if _within_limits(candidate, key[0]):
                changed[key] = candidate
            else:
                reason = "limit"
        if reason is not None:
            slot = (card.board_id, card.target_kind, card.target_id, reason)
            dropped[slot] = dropped.get(slot, 0) + 1
    return AppendedNotes(
        notes=changed,
        discarded=tuple(
            DiscardedCards(board_id, target_kind, target_id, reason, count)
            for (board_id, target_kind, target_id, reason), count in dropped.items()
        ),
    )


def _objects(value: object) -> list[Row]:
    if not isinstance(value, list):
        return []
    items = cast(list[object], value)
    return [cast(Row, item) for item in items if isinstance(item, dict)]


def _note_of(owner: Row, text_key: str) -> ElementNote:
    text = owner.get(text_key)
    return ElementNote(
        text if isinstance(text, str) else "",
        tuple(_objects(owner.get("noteReferences"))),
        tuple(_objects(owner.get("noteMarks"))),
    )


def _write_note(owner: Row, text_key: str, note: ElementNote) -> None:
    owner[text_key] = note.text
    for key, rows in (("noteReferences", note.references), ("noteMarks", note.marks)):
        if rows or key in owner:
            owner[key] = [dict(row) for row in rows]


def move_reference_notes(
    manuscript: Row, figures: Row, storyboards: Row
) -> tuple[Row, Row, Row, tuple[DiscardedCards, ...]]:
    """The same move as the schema-15 migration, on three document payloads.

    For documents that never passed through a database of this version -- a project archive
    written by 3.25 or earlier. Returns new payloads; the arguments are left as they were.
    Board and card positions are their places in the lists, as the database stores them.
    """

    manuscript = deepcopy(manuscript)
    figures = deepcopy(figures)
    storyboards = deepcopy(storyboards)
    boards = {
        board["id"]: (position, str(board.get("title", "")))
        for position, board in enumerate(_objects(storyboards.get("boards")))
        if isinstance(board.get("id"), str)
    }
    cards: list[ReferenceCardNote] = []
    for position, node in enumerate(_objects(storyboards.get("nodes"))):
        raw_target = node.get("target")
        if node.get("kind") != "reference" or not isinstance(raw_target, dict):
            continue
        target = cast(Row, raw_target)
        board_position, title = boards.get(str(node.get("boardId")), (0, ""))
        note = _note_of(node, "text")
        cards.append(
            ReferenceCardNote(
                board_id=str(node.get("boardId")),
                board_title=title,
                board_position=board_position,
                card_id=str(node.get("id")),
                card_position=position,
                target_kind=str(target.get("kind")),
                target_id=str(target.get("id")),
                text=note.text,
                references=note.references,
                marks=note.marks,
            )
        )
        # Only what holds something goes; an empty note is what the client writes anyway.
        for key in ("text", "noteReferences", "noteMarks"):
            if node.get(key):
                node.pop(key)

    owners: dict[ElementKey, tuple[Row, str]] = {}
    created: list[Row] = []
    for chapter in _objects(manuscript.get("chapters")):
        owners[("chapter", str(chapter.get("id")))] = (chapter, "note")
    for node in _objects(figures.get("nodes")):
        profile = node.get("profile")
        if not isinstance(profile, dict):
            profile = {}
            node["profile"] = profile
            created.append(node)
        owners[("figure", str(node.get("id")))] = (profile, "notes")
    for moment in _objects(figures.get("timeline")):
        owners[("moment", str(moment.get("id")))] = (moment, "note")

    result = append_reference_notes(
        cards, {key: _note_of(owner, text_key) for key, (owner, text_key) in owners.items()}
    )
    for key, note in result.notes.items():
        owner, text_key = owners[key]
        _write_note(owner, text_key, note)
    # A figure that got an empty profile only to be looked at keeps none.
    for node in created:
        if node.get("profile") == {}:
            del node["profile"]
    return manuscript, figures, storyboards, result.discarded


class DiscardedProtocolEntry(TypedDict):
    storyboard: str
    targetKind: str
    targetId: str
    reason: DiscardReason
    count: int


def discarded_protocol(discarded: tuple[DiscardedCards, ...]) -> list[DiscardedProtocolEntry]:
    """The record of dropped card texts that a migration or an import keeps: where and how many.

    Never the words themselves (D-100); the pre-migration safety copy is the way back.
    """

    return [
        {
            "storyboard": entry.board_id,
            "targetKind": entry.target_kind,
            "targetId": entry.target_id,
            "reason": entry.reason,
            "count": entry.count,
        }
        for entry in discarded
    ]


__all__ = [
    "MAX_CHAPTER_NOTE_LENGTH",
    "MAX_NOTE_REFERENCES",
    "AppendedNotes",
    "DiscardedCards",
    "DiscardedProtocolEntry",
    "ElementNote",
    "ReferenceCardNote",
    "append_reference_notes",
    "discarded_protocol",
    "element_key",
    "move_reference_notes",
    "separator",
]
