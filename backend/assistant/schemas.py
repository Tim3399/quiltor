"""Strict JSON schemas used for constrained local-model decoding."""

from __future__ import annotations

from typing import Any, Iterable

KINDS = (
    "create_element", "update_element", "create_timeline_moment", "create_relationship",
    "set_relationship_at_moment", "mark_deceased", "arrange_elements", "set_presence",
)
STYLES = ["solid", "dashed", "blood", "gold"]
PROFILE_PROPERTIES = {key: {"type": "string", "maxLength": 1000} for key in ("alter", "rolle", "aussehen", "herkunft", "stimme", "notizen")}


def _object(required: list[str], properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "required": required, "additionalProperties": False, "properties": properties}


PROPOSAL_SCHEMAS: dict[str, dict[str, Any]] = {
    "create_element": _object(["kind", "tempId", "element"], {
        "kind": {"const": "create_element"}, "tempId": {"type": "string", "pattern": "^new:.*$"},
        "element": _object(["name"], {"type": {"enum": ["person", "tier", "ort", "organisation", "objekt", "konzept"]}, "name": {"type": "string", "minLength": 1, "maxLength": 160}, "label": {"type": "string", "maxLength": 160}, "sub": {"type": "string", "maxLength": 1000}, "profile": _object([], PROFILE_PROPERTIES)}),
    }),
    "update_element": _object(["kind", "elementId", "patch"], {
        "kind": {"const": "update_element"}, "elementId": {"type": "string"},
        "patch": _object([], {"name": {"type": "string", "maxLength": 160}, "label": {"type": "string", "maxLength": 160}, "sub": {"type": "string", "maxLength": 1000}, "profile": _object([], PROFILE_PROPERTIES)}),
    }),
    "create_timeline_moment": _object(["kind", "tempId", "moment"], {
        "kind": {"const": "create_timeline_moment"}, "tempId": {"type": "string", "pattern": "^new:.*$"},
        "moment": _object(["title"], {"title": {"type": "string", "minLength": 1, "maxLength": 160}, "date": {"type": "string", "maxLength": 20}, "note": {"type": "string", "maxLength": 1000}}),
    }),
    "create_relationship": _object(["kind", "relationship"], {
        "kind": {"const": "create_relationship"}, "relationship": _object(["from", "to", "label", "directed", "style"], {"from": {"type": "string"}, "to": {"type": "string"}, "label": {"type": "string", "maxLength": 160}, "directed": {"type": "boolean"}, "style": {"enum": STYLES}}),
    }),
    "set_relationship_at_moment": _object(["kind", "relationshipId", "momentId", "patch"], {
        "kind": {"const": "set_relationship_at_moment"}, "relationshipId": {"type": "string"}, "momentId": {"type": "string"},
        "patch": _object([], {"label": {"type": "string", "maxLength": 160}, "active": {"type": "boolean"}, "directed": {"type": "boolean"}, "style": {"enum": STYLES}}),
    }),
    "mark_deceased": _object(["kind", "elementId", "momentId"], {"kind": {"const": "mark_deceased"}, "elementId": {"type": "string"}, "momentId": {"type": "string"}}),
    "arrange_elements": _object(["kind", "strategy"], {"kind": {"const": "arrange_elements"}, "strategy": {"enum": ["thematic", "grid"]}}),
    "set_presence": _object(["kind", "elementId", "placeId"], {"kind": {"const": "set_presence"}, "elementId": {"type": "string"}, "placeId": {"type": "string"}, "momentId": {"type": "string"}}),
}


def reply_schema(allowed_kinds: Iterable[str] | None = None) -> dict[str, Any]:
    allowed = [kind for kind in (KINDS if allowed_kinds is None else allowed_kinds) if kind in PROPOSAL_SCHEMAS]
    proposals = ({"type": "array", "maxItems": 20, "items": {"oneOf": [PROPOSAL_SCHEMAS[kind] for kind in allowed]}}
                 if allowed else {"type": "array", "maxItems": 0})
    return _object(["message", "citations", "proposals"], {
        "message": {"type": "string"}, "citations": {"type": "array", "uniqueItems": True, "items": {"type": "string"}},
        "proposals": proposals,
    })


def planner_schema(allowed_kinds: Iterable[str]) -> dict[str, Any]:
    allowed = [kind for kind in allowed_kinds if kind in KINDS]
    return _object(["goal", "steps", "searchQueries", "requiredKinds"], {
        "goal": {"type": "string"}, "steps": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
        "searchQueries": {"type": "array", "maxItems": 4, "uniqueItems": True, "items": {"type": "string", "maxLength": 300}},
        "requiredKinds": {"type": "array", "uniqueItems": True, "items": {"enum": allowed}},
    })
