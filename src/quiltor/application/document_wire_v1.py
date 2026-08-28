"""Strict v1 transport envelopes for Quiltor's revisioned world documents.

Persistence owns the document payload and deliberately stays unaware of this
wire format. HTTP hosts encode after loading and decode before saving, so a
registered contract is the real runtime boundary rather than documentation
around an unchecked dictionary.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from math import isfinite
from typing import Any, Literal

from quiltor.domain.story_world.validation import valid_figures, valid_manuscript

DocumentKind = Literal["figures", "manuscript"]

_CONTRACTS: dict[DocumentKind, str] = {
    "figures": "quiltor.story-world",
    "manuscript": "quiltor.manuscript",
}
_ENVELOPE_FIELDS = {"contract", "version", "revision", "payload"}
MAX_SAFE_WIRE_INTEGER = 9_007_199_254_740_991
MAX_SAFE_REVISION = MAX_SAFE_WIRE_INTEGER


class InvalidDocumentWireV1(ValueError):
    """The value is not a valid document envelope for the requested kind."""


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


def _valid_payload(kind: DocumentKind, payload: Any) -> bool:
    if not _finite_json_numbers(payload):
        return False
    return (
        valid_manuscript(payload) and _valid_manuscript_wire_fields(payload)
        if kind == "manuscript"
        else valid_figures(payload) and _valid_story_world_wire_fields(payload)
    )


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def _finite_json_numbers(value: Any) -> bool:
    if isinstance(value, float):
        return isfinite(value)
    if isinstance(value, list):
        return all(_finite_json_numbers(item) for item in value)
    if isinstance(value, dict):
        return all(_finite_json_numbers(item) for item in value.values())
    return True


def _wire_integer(
    value: Any,
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
        raise InvalidDocumentWireV1("document wire integer is invalid")
    if not minimum <= integer <= maximum:
        raise InvalidDocumentWireV1("document wire integer is outside the safe range")
    return integer


def _canonical_integer_field(
    value: dict[str, Any],
    key: str,
    *,
    minimum: int = -MAX_SAFE_WIRE_INTEGER,
    maximum: int = MAX_SAFE_WIRE_INTEGER,
) -> None:
    if key in value:
        value[key] = _wire_integer(value[key], minimum=minimum, maximum=maximum)


def _canonical_note_reference_integers(owner: dict[str, Any]) -> None:
    references = owner.get("noteReferences")
    if not isinstance(references, list):
        return
    for reference in references:
        if not isinstance(reference, dict):
            continue
        _canonical_integer_field(reference, "from", minimum=0)
        _canonical_integer_field(reference, "to", minimum=1)


def _canonical_payload_wire_integers(kind: DocumentKind, payload: Any) -> Any:
    normalized = deepcopy(payload)
    if not isinstance(normalized, dict):
        return normalized
    if kind == "manuscript":
        chapters = normalized.get("chapters")
        if isinstance(chapters, list):
            for chapter in chapters:
                if not isinstance(chapter, dict):
                    continue
                _canonical_note_reference_integers(chapter)
                for collection in ("mentions", "marks"):
                    entries = chapter.get(collection)
                    if not isinstance(entries, list):
                        continue
                    for entry in entries:
                        if not isinstance(entry, dict):
                            continue
                        _canonical_integer_field(entry, "from", minimum=0)
                        _canonical_integer_field(entry, "to", minimum=1)
        return normalized

    nodes = normalized.get("nodes")
    if isinstance(nodes, list):
        for node in nodes:
            if not isinstance(node, dict):
                continue
            profile = node.get("profile")
            if isinstance(profile, dict):
                _canonical_note_reference_integers(profile)

    timeline = normalized.get("timeline")
    if isinstance(timeline, list):
        for moment in timeline:
            if not isinstance(moment, dict):
                continue
            _canonical_note_reference_integers(moment)
            for key in ("time", "position", "endTime"):
                _canonical_integer_field(moment, key)
    system = normalized.get("timeSystem")
    if isinstance(system, dict):
        for key in (
            "epochTime",
            "epochYear",
            "epochMonth",
            "epochDay",
            "epochWeekday",
        ):
            _canonical_integer_field(system, key)
        months = system.get("months")
        if isinstance(months, list):
            for month in months:
                if isinstance(month, dict):
                    _canonical_integer_field(month, "dayCount", minimum=1)
    return normalized


def _valid_manuscript_wire_fields(payload: dict[str, Any]) -> bool:
    words = payload.get("words")
    if "words" in payload and (
        not isinstance(words, list)
        or any(
            not isinstance(word, str)
            and (
                not isinstance(word, dict)
                or not isinstance(word.get("w"), str)
                or ("d" in word and not isinstance(word["d"], str))
            )
            for word in words
        )
    ):
        return False
    characters = payload.get("zeichenAktiv")
    return "zeichenAktiv" not in payload or (
        isinstance(characters, list) and all(isinstance(item, str) for item in characters)
    )


def _valid_story_world_wire_fields(payload: dict[str, Any]) -> bool:
    figure_kinds = {"person", "tier", "ort", "organisation", "objekt", "konzept"}
    accents = {"ink", "gold", "rose", "moss"}
    edge_styles = {"solid", "dashed", "blood", "gold"}
    for node in payload["nodes"]:
        if (
            node.get("type", "person") not in figure_kinds
            or node.get("accent", "ink") not in accents
        ):
            return False
        if any(key in node and not isinstance(node[key], str) for key in ("label", "sub")):
            return False
        if any(
            key in node and type(node[key]) is not bool for key in ("dash", "pinned", "important")
        ):
            return False
        if any(key in node and not _number(node[key]) for key in ("x", "y", "mapX", "mapY")):
            return False
        if "profile" in node:
            profile = node["profile"]
            if not isinstance(profile, dict) or any(
                key in profile and not isinstance(profile[key], str)
                for key in (
                    "alter",
                    "rolle",
                    "aussehen",
                    "herkunft",
                    "stimme",
                    "notizen",
                )
            ):
                return False
            extra = profile.get("extra")
            if "extra" in profile and (
                not isinstance(extra, list)
                or any(
                    not isinstance(item, dict)
                    or not isinstance(item.get("k"), str)
                    or not isinstance(item.get("v"), str)
                    for item in extra
                )
            ):
                return False

    for edge in payload["edges"]:
        if edge.get("style", "solid") not in edge_styles:
            return False
        if any(
            key in edge and not isinstance(edge[key], str)
            for key in ("label", "fromHandle", "toHandle")
        ):
            return False
        if any(key in edge and type(edge[key]) is not bool for key in ("gerichtet", "active")):
            return False
        if any(
            version.get("style", "solid") not in edge_styles for version in edge.get("versions", [])
        ):
            return False

    if any(
        "position" in moment
        and (type(moment["position"]) is not int or abs(moment["position"]) > 9_007_199_254_740_991)
        for moment in payload.get("timeline", [])
    ):
        return False

    canvas = payload.get("canvasSize")
    if "canvasSize" in payload and (
        not isinstance(canvas, dict)
        or not _number(canvas.get("w"))
        or not _number(canvas.get("h"))
        or canvas["w"] <= 0
        or canvas["h"] <= 0
    ):
        return False
    scale = payload.get("mapScale")
    return "mapScale" not in payload or (
        isinstance(scale, dict)
        and _number(scale.get("unitsPer100px"))
        and scale["unitsPer100px"] > 0
        and isinstance(scale.get("unitLabel"), str)
    )


def decode_document_v1(kind: DocumentKind, value: Any) -> DocumentWireV1:
    """Validate and detach an untrusted runtime value from its transport object."""

    if not isinstance(value, dict):
        raise InvalidDocumentWireV1("document envelope must be an object")
    if set(value) - _ENVELOPE_FIELDS:
        raise InvalidDocumentWireV1("document envelope contains unknown fields")
    if set(value) < {"contract", "version", "payload"}:
        raise InvalidDocumentWireV1("document envelope is incomplete")
    if value.get("contract") != _CONTRACTS[kind]:
        raise InvalidDocumentWireV1("document contract or version does not match")
    if _wire_integer(value["version"], minimum=1, maximum=1) != 1:
        raise InvalidDocumentWireV1("unsupported document contract version")

    revision = None if "revision" not in value else _wire_integer(value["revision"], minimum=0)
    payload = _canonical_payload_wire_integers(kind, value.get("payload"))
    if not _valid_payload(kind, payload):
        raise InvalidDocumentWireV1("document payload is invalid")
    return DocumentWireV1(kind=kind, payload=deepcopy(payload), revision=revision)


def encode_document_v1(
    kind: DocumentKind, payload: dict[str, Any], revision: int | None = None
) -> dict[str, Any]:
    """Create the canonical v1 envelope and validate the producer output too."""

    wire = DocumentWireV1(kind=kind, payload=deepcopy(payload), revision=revision)
    envelope = wire.to_mapping()
    # Keeping producer and consumer on the same path prevents a server response
    # from becoming more permissive than the request it accepts.
    return decode_document_v1(kind, envelope).to_mapping()
