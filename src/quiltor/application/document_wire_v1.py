"""Strict v1 transport envelopes for Quiltor's revisioned world documents.

Persistence owns the document payload and deliberately stays unaware of this
wire format. HTTP hosts encode after loading and decode before saving, so a
registered contract is the real runtime boundary rather than documentation
around an unchecked dictionary.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from math import isfinite
from typing import Any, Literal, TypeGuard

from quiltor.domain.json_values import JsonObject, as_array, as_object
from quiltor.domain.story_world.profile import normalize_profile
from quiltor.domain.story_world.validation import valid_figures, valid_manuscript
from quiltor.domain.storyboard.validation import valid_storyboards

DocumentKind = Literal["figures", "manuscript", "storyboards"]

_CONTRACTS: dict[DocumentKind, str] = {
    "figures": "quiltor.story-world",
    "manuscript": "quiltor.manuscript",
    "storyboards": "quiltor.storyboards",
}
_ENVELOPE_FIELDS = {"contract", "version", "revision", "payload"}
_REQUIRED_ENVELOPE_FIELDS = {"contract", "version", "payload"}
MAX_SAFE_WIRE_INTEGER = 9_007_199_254_740_991
MAX_SAFE_REVISION = MAX_SAFE_WIRE_INTEGER


WireRejectionReason = Literal[
    "envelope_not_object",
    "envelope_unknown_field",
    "envelope_incomplete",
    "contract_mismatch",
    "version_invalid",
    "revision_invalid",
    "integer_invalid",
    "payload_number_not_finite",
    "payload_invalid",
]


class InvalidDocumentWireV1(ValueError):
    """The value is not a valid document envelope for the requested kind.

    ``reason`` says which rule failed and ``field`` where, as a JSON pointer. The
    pointer is built only from key names this module itself spells out, never from
    a key or value of the document, so a host may log both without carrying any of
    the author's text.
    """

    def __init__(
        self,
        message: str = "document wire is invalid",
        *,
        reason: WireRejectionReason = "payload_invalid",
        field: str | None = None,
    ) -> None:
        super().__init__(message)
        self.reason: WireRejectionReason = reason
        self.field = field


@dataclass(frozen=True)
class DocumentWireV1:
    kind: DocumentKind
    payload: dict[str, Any]
    revision: int | None = None

    @property
    def contract(self) -> str:
        return _CONTRACTS[self.kind]

    def to_mapping(self) -> dict[str, Any]:
        envelope: dict[str, Any] = {
            "contract": self.contract,
            "version": 1,
            "payload": deepcopy(self.payload),
        }
        if self.revision is not None:
            envelope["revision"] = self.revision
        return envelope


def _validated_payload(kind: DocumentKind, payload: object) -> JsonObject | InvalidDocumentWireV1:
    """The payload as an object when it is valid, otherwise the first rule it breaks.

    The domain validators judge the whole document, so their failure points at
    ``/payload``; the wire checks below run per top-level key and name it.
    """

    if not _finite_json_numbers(payload):
        return _payload_invalid(reason="payload_number_not_finite")
    document = as_object(payload)
    if kind == "manuscript":
        if document is None or not valid_manuscript(document):
            return _payload_invalid()
        failed = _manuscript_wire_failure(document)
    elif kind == "figures":
        if document is None or not valid_figures(document):
            return _payload_invalid()
        failed = _story_world_wire_failure(document)
    else:
        if document is None or not valid_storyboards(document):
            return _payload_invalid()
        failed = None
    return document if failed is None else _payload_invalid(failed)


def _payload_invalid(
    key: str = "", *, reason: WireRejectionReason = "payload_invalid"
) -> InvalidDocumentWireV1:
    field = f"/payload/{key}" if key else "/payload"
    return InvalidDocumentWireV1("document payload is invalid", reason=reason, field=field)


def _rows(value: object) -> list[JsonObject]:
    """The object items of a list; the payload was validated, so nothing is dropped."""

    items = as_array(value) or []
    return [row for row in map(as_object, items) if row is not None]


def _valid_place_level(node: Mapping[str, object]) -> bool:
    """A place is also a level; these say where it sits and how it is drawn."""

    for key in ("parentPlaceId", "mapImageId"):
        value = node.get(key)
        if key in node and (not isinstance(value, str) or not value):
            return False
    # Normalised, so a place keeps its spot when the level around it is resized.
    for key in ("mapU", "mapV", "mapImageU", "mapImageV"):
        value = node.get(key)
        if key in node and (not _number(value) or not 0 <= value <= 1):
            return False
    zoom = node.get("mapImageZoom")
    if "mapImageZoom" in node and (not _number(zoom) or not 1 <= zoom <= 8):
        return False
    if "mapExpanded" in node and type(node["mapExpanded"]) is not bool:
        return False
    display = node.get("placeDisplay")
    if "placeDisplay" in node and (not isinstance(display, str) or display not in {"card", "pin"}):
        return False
    for key in ("mapWidth", "mapHeight"):
        value = node.get(key)
        if key in node and (not _number(value) or value <= 0):
            return False
    return not ("mapScale" in node and not _valid_map_scale(node["mapScale"]))


def _valid_map_scale(value: object) -> bool:
    scale = as_object(value)
    if scale is None:
        return False
    units = scale.get("unitsPer100px")
    return _number(units) and units > 0 and isinstance(scale.get("unitLabel"), str)


def _acyclic_place_levels(nodes: Sequence[Mapping[str, object]]) -> bool:
    """Containment must reach a root, or a breadcrumb would never terminate.

    Checked over the whole document because a single node cannot see the loop it
    is part of. JSON Schema cannot express this either, which is why both
    runtimes carry the same walk.
    """

    kinds: dict[object, object] = {node.get("id"): node.get("type", "person") for node in nodes}
    parents: dict[object, object] = {}
    for node in nodes:
        parent = node.get("parentPlaceId")
        if parent is None:
            continue
        if kinds.get(node.get("id")) != "ort" or kinds.get(parent) != "ort":
            return False
        parents[node.get("id")] = parent
    for start in parents:
        seen = {start}
        current = parents.get(start)
        while current is not None:
            if current in seen:
                return False
            seen.add(current)
            current = parents.get(current)
    return True


def _number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def _finite_json_numbers(value: object) -> bool:
    if isinstance(value, float):
        return isfinite(value)
    items = as_array(value)
    if items is not None:
        return all(_finite_json_numbers(item) for item in items)
    entries = as_object(value)
    if entries is not None:
        return all(_finite_json_numbers(item) for item in entries.values())
    return True


def _wire_integer(
    value: object,
    *,
    minimum: int = -MAX_SAFE_WIRE_INTEGER,
    maximum: int = MAX_SAFE_WIRE_INTEGER,
) -> int:
    """Apply JSON Schema's mathematical integer semantics and canonicalize to int."""

    if type(value) is int:
        integer = value
    elif type(value) is float and isfinite(value) and value.is_integer():
        integer = int(value)
    else:
        raise InvalidDocumentWireV1("document wire integer is invalid", reason="integer_invalid")
    if not minimum <= integer <= maximum:
        raise InvalidDocumentWireV1(
            "document wire integer is outside the safe range", reason="integer_invalid"
        )
    return integer


def _canonical_integer_field(
    value: JsonObject,
    key: str,
    *,
    minimum: int = -MAX_SAFE_WIRE_INTEGER,
    maximum: int = MAX_SAFE_WIRE_INTEGER,
) -> None:
    if key in value:
        value[key] = _wire_integer(value[key], minimum=minimum, maximum=maximum)


def _canonical_note_reference_integers(owner: JsonObject) -> None:
    references = as_array(owner.get("noteReferences"))
    if references is None:
        return
    for item in references:
        reference = as_object(item)
        if reference is None:
            continue
        _canonical_integer_field(reference, "from", minimum=0)
        _canonical_integer_field(reference, "to", minimum=1)


def _canonical_note_mark_integers(owner: JsonObject) -> None:
    marks = as_array(owner.get("noteMarks"))
    if marks is None:
        return
    for item in marks:
        mark = as_object(item)
        if mark is None:
            continue
        _canonical_integer_field(mark, "from", minimum=0)
        _canonical_integer_field(mark, "to", minimum=1)
        if "level" in mark:
            _canonical_integer_field(mark, "level", minimum=1, maximum=3)
    rows: list[tuple[int, int, str, JsonObject]] = []
    for item in marks:
        mark = as_object(item)
        start, end, kind = (
            (mark.get("from"), mark.get("to"), mark.get("kind"))
            if mark is not None
            else (None,) * 3
        )
        if (
            mark is None
            or type(start) is not int
            or type(end) is not int
            or not isinstance(kind, str)
        ):
            return
        rows.append((start, end, kind, mark))
    marks[:] = [mark for *_, mark in sorted(rows, key=lambda row: row[:3])]


def _canonical_chapter_wire_integers(chapter: JsonObject) -> None:
    _canonical_note_reference_integers(chapter)
    _canonical_note_mark_integers(chapter)
    for collection in ("mentions", "marks"):
        entries = as_array(chapter.get(collection))
        if entries is None:
            continue
        for item in entries:
            entry = as_object(item)
            if entry is None:
                continue
            _canonical_integer_field(entry, "from", minimum=0)
            _canonical_integer_field(entry, "to", minimum=1)


def _canonical_manuscript_wire_integers(payload: JsonObject) -> None:
    book_layout = as_object(payload.get("bookLayout"))
    if book_layout is not None:
        _canonical_integer_field(book_layout, "version", minimum=1, maximum=1)
        _canonical_integer_field(book_layout, "widows", minimum=1, maximum=5)
        _canonical_integer_field(book_layout, "orphans", minimum=1, maximum=5)
    chapters = as_array(payload.get("chapters"))
    if chapters is not None:
        for item in chapters:
            chapter = as_object(item)
            if chapter is None:
                continue
            _canonical_chapter_wire_integers(chapter)
    trash = as_array(payload.get("trash"))
    if trash is not None:
        for item in trash:
            entry = as_object(item)
            if entry is None:
                continue
            chapter = as_object(entry.get("chapter"))
            if chapter is not None:
                _canonical_chapter_wire_integers(chapter)
            tree_item = as_object(entry.get("treeItem"))
            if tree_item is not None:
                _canonical_integer_field(tree_item, "position", minimum=0)
    import_source = as_object(payload.get("importSource"))
    if import_source is not None:
        _canonical_integer_field(import_source, "version", minimum=1, maximum=2)
        counts = as_object(import_source.get("counts"))
        if counts is not None:
            for key in (
                "sourceWords",
                "sourceParagraphs",
                "importedWords",
                "importedParagraphs",
            ):
                _canonical_integer_field(counts, key, minimum=0)
        warnings = as_array(import_source.get("warnings"))
        if warnings is not None:
            for item in warnings:
                warning = as_object(item)
                if warning is not None:
                    _canonical_integer_field(warning, "count", minimum=1)


def _canonical_storyboard_wire_integers(payload: JsonObject) -> None:
    nodes = as_array(payload.get("nodes"))
    if nodes is None:
        return
    for item in nodes:
        node = as_object(item)
        if node is None:
            continue
        _canonical_integer_field(node, "zIndex")
        _canonical_note_reference_integers(node)
        _canonical_note_mark_integers(node)


def _canonical_story_world_wire_integers(payload: JsonObject) -> None:
    nodes = as_array(payload.get("nodes"))
    if nodes is not None:
        for item in nodes:
            node = as_object(item)
            if node is None:
                continue
            profile = as_object(node.get("profile"))
            if profile is not None:
                normalized_profile = normalize_profile(profile, str(node.get("id", "")))
                _canonical_note_reference_integers(normalized_profile)
                _canonical_note_mark_integers(normalized_profile)
                node["profile"] = normalized_profile

    timeline = as_array(payload.get("timeline"))
    if timeline is not None:
        for item in timeline:
            moment = as_object(item)
            if moment is None:
                continue
            _canonical_note_reference_integers(moment)
            _canonical_note_mark_integers(moment)
            for key in ("time", "position", "endTime"):
                _canonical_integer_field(moment, key)
    system = as_object(payload.get("timeSystem"))
    if system is not None:
        for key in (
            "epochTime",
            "epochYear",
            "epochMonth",
            "epochDay",
            "epochWeekday",
        ):
            _canonical_integer_field(system, key)
        months = as_array(system.get("months"))
        if months is not None:
            for item in months:
                month = as_object(item)
                if month is not None:
                    _canonical_integer_field(month, "dayCount", minimum=1)


def _canonical_payload_wire_integers(kind: DocumentKind, payload: object) -> object:
    normalized = deepcopy(payload)
    document = as_object(normalized)
    if document is None:
        return normalized
    if kind == "manuscript":
        _canonical_manuscript_wire_integers(document)
    elif kind == "storyboards":
        _canonical_storyboard_wire_integers(document)
    else:
        _canonical_story_world_wire_integers(document)
    return document


def _valid_word(value: object) -> bool:
    if isinstance(value, str):
        return True
    word = as_object(value)
    return (
        word is not None
        and isinstance(word.get("w"), str)
        and ("d" not in word or isinstance(word["d"], str))
    )


def _manuscript_wire_failure(payload: JsonObject) -> str | None:
    """The top-level key whose wire rule fails, or None."""

    if "bookLayout" in payload and not _valid_book_layout(payload.get("bookLayout")):
        return "bookLayout"
    if "importSource" in payload and not _valid_import_source(payload.get("importSource")):
        return "importSource"
    if "words" in payload:
        words = as_array(payload.get("words"))
        if words is None or not all(_valid_word(word) for word in words):
            return "words"
    # The German spellings this document used until v3.16 are gone: the world database
    # migrates them once on startup, so nothing on disk carries them any more and nothing
    # on the wire may either.
    for field in ("activeSymbols", "hiddenElements"):
        if field not in payload:
            continue
        value = as_array(payload.get(field))
        if value is None or not all(isinstance(item, str) for item in value):
            return field
    return None


_IMPORT_WARNING_CODES = {
    "images",
    "hyperlinks",
    "headers_footers",
    "footnotes_endnotes",
    "comments",
    "numbering",
    "fields",
    "formatting",
}
_UTC_IMPORT_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z")


def _valid_import_counts(value: object) -> bool:
    counts = as_object(value)
    count_fields = {
        "sourceWords",
        "sourceParagraphs",
        "importedWords",
        "importedParagraphs",
    }
    if counts is None or not count_fields <= set(counts):
        return False
    for field in count_fields:
        count = counts.get(field)
        if type(count) is not int or not 0 <= count <= MAX_SAFE_WIRE_INTEGER:
            return False
    return True


def _valid_import_warnings(value: object) -> bool:
    warnings = as_array(value)
    if warnings is None:
        return False
    codes: list[str] = []
    for item in warnings:
        warning = as_object(item)
        code = warning.get("code") if warning is not None else None
        count = warning.get("count") if warning is not None else None
        if (
            warning is None
            or not isinstance(code, str)
            or code not in _IMPORT_WARNING_CODES
            or type(count) is not int
            or not 1 <= count <= MAX_SAFE_WIRE_INTEGER
        ):
            return False
        codes.append(code)
    return len(codes) == len(set(codes))


def _valid_import_source(raw: object) -> bool:
    value = as_object(raw)
    if value is None:
        return False
    required = {
        "version",
        "fileName",
        "format",
        "sourceSha256",
        "importedAt",
        "counts",
        "warnings",
    }
    if not required <= set(value):
        return False
    version = value.get("version")
    file_name = value.get("fileName")
    imported_at = value.get("importedAt")
    format_name = value.get("format")
    sha256 = value.get("sourceSha256")
    if (
        type(version) is not int
        or version not in {1, 2}
        or not isinstance(format_name, str)
        or (version == 1 and format_name != "docx")
        or (version == 2 and format_name not in {"docx", "markdown", "txt"})
        or not isinstance(file_name, str)
        or not file_name.strip()
        or len(file_name) > 1000
        or not isinstance(sha256, str)
        or re.fullmatch(r"[0-9a-f]{64}", sha256) is None
        or not isinstance(imported_at, str)
        or _UTC_IMPORT_TIME.fullmatch(imported_at) is None
    ):
        return False
    try:
        datetime.fromisoformat(imported_at.removesuffix("Z") + "+00:00")
    except ValueError:
        return False
    if not _valid_import_counts(value.get("counts")):
        return False
    return _valid_import_warnings(value.get("warnings"))


_BOOK_LAYOUT_ENUMS = {
    "preset": {"quiltor-novel", "classic-paperback", "a5-manuscript"},
    "pageFormat": {"6x9", "a5", "5.5x8.5", "custom"},
    "fontFamily": {
        "eb-garamond",
        "literata",
        "source-serif-4",
        "crimson-pro",
        "libre-baskerville",
    },
    "alignment": {"justify", "left"},
    "chapterStart": {"next-page", "right-page"},
    "chapterNumberStyle": {"number", "padded", "chapter"},
    "chapterAlignment": {"left", "center"},
    "pageNumberPosition": {"bottom-center", "bottom-outside", "top-outside"},
}
_BOOK_LAYOUT_BOOLEANS = {
    "mirrorMargins",
    "hyphenation",
    "firstLineIndent",
    "chapterNumber",
    "chapterTitle",
    "dropCap",
    "chapterFirstIndent",
    "pageNumbers",
    "hideChapterPageNumbers",
    "hideTitlePageNumber",
    "numberFromFirstChapter",
    "showNovelLabel",
    "showVersion",
    "showDate",
}
_BOOK_LAYOUT_RANGES = {
    "pageWidthMm": (80, 500),
    "pageHeightMm": (80, 500),
    "marginInnerMm": (0, 100),
    "marginOuterMm": (0, 100),
    "marginTopMm": (0, 100),
    "marginBottomMm": (0, 100),
    "gutterMm": (0, 50),
    "fontSizePt": (6, 36),
    "lineHeight": (0.8, 3),
    "firstLineIndentEm": (0, 10),
    "paragraphSpacingEm": (0, 10),
    "chapterTopMm": (0, 150),
    "chapterTitleSizePt": (6, 72),
    "sceneSpaceBeforeMm": (0, 100),
    "sceneSpaceAfterMm": (0, 100),
}
_BOOK_LAYOUT_METADATA = {"bookTitle", "subtitle", "author", "series", "volume"}
_BOOK_LAYOUT_REQUIRED = (
    {"version", "widows", "orphans", "sceneSymbol"}
    | set(_BOOK_LAYOUT_ENUMS)
    | _BOOK_LAYOUT_BOOLEANS
    | set(_BOOK_LAYOUT_RANGES)
    | _BOOK_LAYOUT_METADATA
)


def _valid_book_layout(raw: object) -> bool:
    value = as_object(raw)
    if value is None:
        return False
    if not set(value) >= _BOOK_LAYOUT_REQUIRED:
        return False
    version = value["version"]
    if type(version) is not int or version != 1:
        return False
    for key, choices in _BOOK_LAYOUT_ENUMS.items():
        choice = value.get(key)
        if not isinstance(choice, str) or choice not in choices:
            return False
    if any(type(value.get(key)) is not bool for key in _BOOK_LAYOUT_BOOLEANS):
        return False
    numbers: dict[str, float] = {}
    for key, (minimum, maximum) in _BOOK_LAYOUT_RANGES.items():
        number = value.get(key)
        if not _number(number) or not minimum <= number <= maximum:
            return False
        numbers[key] = number
    for key in ("widows", "orphans"):
        count = value.get(key)
        if type(count) is not int or not 1 <= count <= 5:
            return False
    for key in _BOOK_LAYOUT_METADATA:
        text = value.get(key)
        if not isinstance(text, str) or len(text) > 1000:
            return False
    symbol = value.get("sceneSymbol")
    if not isinstance(symbol, str) or len(symbol) > 32 or (symbol and not symbol.strip()):
        return False
    usable_width = (
        numbers["pageWidthMm"]
        - numbers["marginInnerMm"]
        - numbers["marginOuterMm"]
        - numbers["gutterMm"]
    )
    usable_height = numbers["pageHeightMm"] - numbers["marginTopMm"] - numbers["marginBottomMm"]
    return usable_width >= 30 and usable_height >= 30


_FIGURE_KINDS = {"person", "tier", "ort", "organisation", "objekt", "konzept"}
_ACCENTS = {"ink", "gold", "rose", "moss"}
_EDGE_STYLES = {"solid", "dashed", "blood", "gold"}
_EDGE_LINE_STYLES = {"solid", "dashed", "dotted"}
_RELATIONSHIP_KINDS = {"general", "kinship"}
_EDGE_COLORS = {"auto", "ink", "gold", "rose", "moss", "blue"}
_LEGACY_PROFILE_KEYS = ("alter", "rolle", "aussehen", "herkunft", "stimme", "notes")


def _choice(row: JsonObject, key: str, default: str, allowed: set[str]) -> bool:
    value = row.get(key, default)
    return isinstance(value, str) and value in allowed


def _valid_wire_profile(value: object) -> bool:
    profile = as_object(value)
    if profile is None or any(
        key in profile and not isinstance(profile[key], str) for key in _LEGACY_PROFILE_KEYS
    ):
        return False
    if "extra" in profile:
        extra = as_array(profile.get("extra"))
        if extra is None:
            return False
        for item in extra:
            row = as_object(item)
            if (
                row is None
                or not isinstance(row.get("k"), str)
                or not isinstance(row.get("v"), str)
            ):
                return False
    if "fields" in profile:
        fields = as_array(profile.get("fields"))
        if fields is None:
            return False
        field_ids: set[str] = set()
        for item in fields:
            field = as_object(item)
            field_id = field.get("id") if field is not None else None
            if (
                field is None
                or not isinstance(field_id, str)
                or not field_id
                or field_id in field_ids
                or not isinstance(field.get("key"), str)
                or not isinstance(field.get("value"), str)
            ):
                return False
            field_ids.add(field_id)
    return True


def _valid_wire_node(node: JsonObject) -> bool:
    if not (
        _choice(node, "type", "person", _FIGURE_KINDS) and _choice(node, "accent", "ink", _ACCENTS)
    ):
        return False
    if any(key in node and not isinstance(node[key], str) for key in ("label", "sub")):
        return False
    if any(key in node and type(node[key]) is not bool for key in ("dash", "pinned", "important")):
        return False
    if any(key in node and not _number(node[key]) for key in ("x", "y", "mapX", "mapY")):
        return False
    if not _valid_place_level(node):
        return False
    return not ("profile" in node and not _valid_wire_profile(node["profile"]))


def _valid_wire_edge(edge: JsonObject) -> bool:
    if not (
        _choice(edge, "style", "solid", _EDGE_STYLES)
        and _choice(edge, "lineStyle", "solid", _EDGE_LINE_STYLES)
        and _choice(edge, "relationshipKind", "general", _RELATIONSHIP_KINDS)
        and _choice(edge, "color", "auto", _EDGE_COLORS)
    ):
        return False
    if any(
        key in edge and not isinstance(edge[key], str)
        for key in ("label", "fromHandle", "toHandle")
    ):
        return False
    if any(key in edge and type(edge[key]) is not bool for key in ("directed", "active")):
        return False
    versions = _rows(edge.get("versions", []))
    if any(not _choice(version, "style", "solid", _EDGE_STYLES) for version in versions):
        return False
    if any(
        not _choice(version, "lineStyle", "solid", _EDGE_LINE_STYLES)
        or not _choice(version, "relationshipKind", "general", _RELATIONSHIP_KINDS)
        for version in versions
    ):
        return False
    return all(_choice(version, "color", "auto", _EDGE_COLORS) for version in versions)


def _story_world_wire_failure(payload: JsonObject) -> str | None:
    """The top-level key whose wire rule fails, or None."""

    nodes = _rows(payload["nodes"])
    if not _acyclic_place_levels(nodes):
        return "nodes"
    if not all(_valid_wire_node(node) for node in nodes):
        return "nodes"
    if not all(_valid_wire_edge(edge) for edge in _rows(payload["edges"])):
        return "edges"

    for moment in _rows(payload.get("timeline", [])):
        position = moment.get("position")
        if "position" in moment and (
            type(position) is not int or abs(position) > MAX_SAFE_WIRE_INTEGER
        ):
            return "timeline"

    canvas = as_object(payload.get("canvasSize"))
    if "canvasSize" in payload:
        width = canvas.get("w") if canvas is not None else None
        height = canvas.get("h") if canvas is not None else None
        if not _number(width) or not _number(height) or width <= 0 or height <= 0:
            return "canvasSize"
    if "mapScale" in payload and not _valid_map_scale(payload.get("mapScale")):
        return "mapScale"
    return None


def decode_document_v1(kind: DocumentKind, value: object) -> DocumentWireV1:
    """Validate and detach an untrusted runtime value from its transport object."""

    envelope = as_object(value)
    if envelope is None:
        raise InvalidDocumentWireV1(
            "document envelope must be an object", reason="envelope_not_object"
        )
    if set(envelope) - _ENVELOPE_FIELDS:
        # No field: the only thing to point at would be the sender's own key.
        raise InvalidDocumentWireV1(
            "document envelope contains unknown fields", reason="envelope_unknown_field"
        )
    missing = sorted(_REQUIRED_ENVELOPE_FIELDS - set(envelope))
    if missing:
        raise InvalidDocumentWireV1(
            "document envelope is incomplete", reason="envelope_incomplete", field=f"/{missing[0]}"
        )
    if envelope.get("contract") != _CONTRACTS[kind]:
        raise InvalidDocumentWireV1(
            "document contract or version does not match",
            reason="contract_mismatch",
            field="/contract",
        )
    version = _envelope_integer(envelope["version"], "version", minimum=1, maximum=1)
    if version != 1:
        raise InvalidDocumentWireV1(
            "unsupported document contract version", reason="version_invalid", field="/version"
        )

    revision = (
        None
        if "revision" not in envelope
        else _envelope_integer(envelope["revision"], "revision", minimum=0)
    )
    try:
        payload = _canonical_payload_wire_integers(kind, envelope.get("payload"))
    except InvalidDocumentWireV1 as error:
        raise InvalidDocumentWireV1(
            str(error), reason="integer_invalid", field="/payload"
        ) from None
    validated = _validated_payload(kind, payload)
    if isinstance(validated, InvalidDocumentWireV1):
        raise validated
    return DocumentWireV1(kind=kind, payload=deepcopy(validated), revision=revision)


def _envelope_integer(
    value: object,
    key: Literal["version", "revision"],
    *,
    minimum: int,
    maximum: int = MAX_SAFE_WIRE_INTEGER,
) -> int:
    try:
        return _wire_integer(value, minimum=minimum, maximum=maximum)
    except InvalidDocumentWireV1 as error:
        raise InvalidDocumentWireV1(
            str(error),
            reason="version_invalid" if key == "version" else "revision_invalid",
            field=f"/{key}",
        ) from None


def encode_document_v1(
    kind: DocumentKind, payload: dict[str, Any], revision: int | None = None
) -> dict[str, Any]:
    """Create the canonical v1 envelope and validate the producer output too."""

    wire = DocumentWireV1(kind=kind, payload=deepcopy(payload), revision=revision)
    envelope = wire.to_mapping()
    # Keeping producer and consumer on the same path prevents a server response
    # from becoming more permissive than the request it accepts.
    return decode_document_v1(kind, envelope).to_mapping()
