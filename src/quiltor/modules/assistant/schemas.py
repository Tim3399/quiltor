"""Strict JSON schemas used for constrained local-model decoding."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from quiltor.modules.assistant.relationship_appearance import (
    EDGE_COLORS,
    LINE_STYLES,
    RELATIONSHIP_KINDS,
)
from quiltor.modules.assistant.schema_lint import assert_clean

# The tool step's two alternatives sit under this key: lac-schema-v1 wants an object at the
# root, never a union. tool_loop unwraps it.
STEP_KEY = "step"


# Kept in the check schema, dropped from what goes over the wire: lac-schema-v1 forbids them
# (llama.cpp ignores string lengths silently, OpenAI does not list them), so the validator
# behind the engine is the one place they are enforced.
CHECK_ONLY_KEYWORDS = frozenset({"maxLength", "minLength", "uniqueItems"})


class SchemaFormat(dict[str, Any]):
    """A ``response_format`` that also remembers the full schema to check the reply against.

    The dict is what is sent; ``check_schema`` is an attribute, so JSON serialisation never
    sees it, while shallow copies of the payload (``{**payload}``) keep the same object.
    """

    check_schema: dict[str, Any]


def wire_schema(schema: Any) -> Any:
    """``schema`` without the keywords only the validator enforces."""

    if isinstance(schema, dict):
        return {
            key: wire_schema(value)
            for key, value in schema.items()
            if key not in CHECK_ONLY_KEYWORDS
        }
    if isinstance(schema, list):
        return [wire_schema(item) for item in schema]
    return schema


def json_schema_format(schema: dict[str, Any], name: str = "quiltor_reply") -> SchemaFormat:
    """OpenAI-compatible constrained-decoding envelope (transport neutral).

    ``schema`` is the full schema. The envelope carries its lac-schema-v1 wire form, linted
    here; the full schema rides along as ``check_schema`` for the reply check.
    """

    wire = wire_schema(schema)
    assert_clean(wire, name)
    envelope = SchemaFormat(
        {
            "type": "json_schema",
            "json_schema": {"name": name, "strict": True, "schema": wire},
        }
    )
    envelope.check_schema = schema
    return envelope


KINDS = (
    "create_element",
    "update_element",
    "create_timeline_moment",
    "create_relationship",
    "set_relationship_at_moment",
    "mark_deceased",
    "arrange_elements",
    "set_presence",
)
PROFILE_PROPERTIES = {
    key: {"type": "string", "maxLength": 1000}
    for key in ("alter", "rolle", "aussehen", "herkunft", "stimme", "notes")
}


def _object(required: list[str], properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "required": required,
        "additionalProperties": False,
        "properties": properties,
    }


PROPOSAL_SCHEMAS: dict[str, dict[str, Any]] = {
    "create_element": _object(
        ["kind", "tempId", "element"],
        {
            "kind": {"enum": ["create_element"]},
            "tempId": {"type": "string", "pattern": "^new:.*$"},
            "element": _object(
                ["name"],
                {
                    "type": {
                        "enum": ["person", "tier", "ort", "organisation", "objekt", "konzept"]
                    },
                    "name": {"type": "string", "minLength": 1, "maxLength": 160},
                    "label": {"type": "string", "maxLength": 160},
                    "sub": {"type": "string", "maxLength": 1000},
                    "profile": _object([], PROFILE_PROPERTIES),
                    "aliases": {
                        "type": "array",
                        "maxItems": 16,
                        "uniqueItems": True,
                        "items": {"type": "string", "minLength": 1, "maxLength": 160},
                    },
                },
            ),
        },
    ),
    "update_element": _object(
        ["kind", "elementId", "patch"],
        {
            "kind": {"enum": ["update_element"]},
            "elementId": {"type": "string"},
            "patch": _object(
                [],
                {
                    "name": {"type": "string", "maxLength": 160},
                    "label": {"type": "string", "maxLength": 160},
                    "sub": {"type": "string", "maxLength": 1000},
                    "profile": _object([], PROFILE_PROPERTIES),
                    "aliases": {
                        "type": "array",
                        "maxItems": 16,
                        "uniqueItems": True,
                        "items": {"type": "string", "minLength": 1, "maxLength": 160},
                    },
                },
            ),
        },
    ),
    "create_timeline_moment": _object(
        ["kind", "tempId", "moment"],
        {
            "kind": {"enum": ["create_timeline_moment"]},
            "tempId": {"type": "string", "pattern": "^new:.*$"},
            "moment": _object(
                ["title"],
                {
                    "title": {"type": "string", "minLength": 1, "maxLength": 160},
                    "date": {"type": "string", "maxLength": 20},
                    "note": {"type": "string", "maxLength": 1000},
                },
            ),
        },
    ),
    "create_relationship": _object(
        ["kind", "relationship"],
        {
            "kind": {"enum": ["create_relationship"]},
            "relationship": _object(
                [
                    "from",
                    "to",
                    "label",
                    "directed",
                    "lineStyle",
                    "relationshipKind",
                    "color",
                ],
                {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "label": {"type": "string", "maxLength": 160},
                    "directed": {"type": "boolean"},
                    "lineStyle": {"enum": list(LINE_STYLES)},
                    "relationshipKind": {"enum": list(RELATIONSHIP_KINDS)},
                    "color": {"enum": list(EDGE_COLORS)},
                },
            ),
        },
    ),
    "set_relationship_at_moment": _object(
        ["kind", "relationshipId", "momentId", "patch"],
        {
            "kind": {"enum": ["set_relationship_at_moment"]},
            "relationshipId": {"type": "string"},
            "momentId": {"type": "string"},
            "patch": _object(
                [],
                {
                    "label": {"type": "string", "maxLength": 160},
                    "active": {"type": "boolean"},
                    "directed": {"type": "boolean"},
                    "lineStyle": {"enum": list(LINE_STYLES)},
                    "relationshipKind": {"enum": list(RELATIONSHIP_KINDS)},
                    "color": {"enum": list(EDGE_COLORS)},
                },
            ),
        },
    ),
    "mark_deceased": _object(
        ["kind", "elementId", "momentId"],
        {
            "kind": {"enum": ["mark_deceased"]},
            "elementId": {"type": "string"},
            "momentId": {"type": "string"},
        },
    ),
    "arrange_elements": _object(
        ["kind", "strategy"],
        {"kind": {"enum": ["arrange_elements"]}, "strategy": {"enum": ["thematic", "grid"]}},
    ),
    "set_presence": _object(
        ["kind", "elementId", "placeId"],
        {
            "kind": {"enum": ["set_presence"]},
            "elementId": {"type": "string"},
            "placeId": {"type": "string"},
            "momentId": {"type": "string"},
        },
    ),
}


def reply_schema(allowed_kinds: Iterable[str] | None = None) -> dict[str, Any]:
    allowed = [
        kind
        for kind in (KINDS if allowed_kinds is None else allowed_kinds)
        if kind in PROPOSAL_SCHEMAS
    ]
    proposals = (
        {
            "type": "array",
            "maxItems": 20,
            "items": {"anyOf": [PROPOSAL_SCHEMAS[kind] for kind in allowed]},
        }
        if allowed
        else {"type": "array", "maxItems": 0}
    )
    return _object(
        ["message", "citations", "proposals"],
        {
            "message": {"type": "string"},
            "citations": {"type": "array", "uniqueItems": True, "items": {"type": "string"}},
            "proposals": proposals,
        },
    )


def tool_step_schema(
    tool_catalog: Iterable[Mapping[str, Any]],
    allowed_kinds: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Strict JSON step contract for runtimes without native function calling."""

    calls = []
    for spec in tool_catalog:
        name, arguments = spec.get("name"), spec.get("inputSchema")
        if not isinstance(name, str) or not isinstance(arguments, dict):
            continue
        calls.append(
            _object(
                ["name", "arguments"],
                {
                    "name": {"enum": [name]},
                    "arguments": arguments,
                },
            )
        )
    step = {
        "anyOf": [
            _object(
                ["action", "toolCalls"],
                {
                    "action": {"enum": ["tool_calls"]},
                    "toolCalls": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 6,
                        "items": {"anyOf": calls},
                    },
                },
            ),
            _object(
                ["action", "final"],
                {
                    "action": {"enum": ["final"]},
                    "final": reply_schema(allowed_kinds),
                },
            ),
        ]
    }
    return _object([STEP_KEY], {STEP_KEY: step})


def planner_schema(allowed_kinds: Iterable[str]) -> dict[str, Any]:
    allowed = [kind for kind in allowed_kinds if kind in KINDS]
    return _object(
        ["goal", "steps", "searchQueries", "requiredKinds"],
        {
            "goal": {"type": "string"},
            "steps": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
            "searchQueries": {
                "type": "array",
                "maxItems": 4,
                "uniqueItems": True,
                "items": {"type": "string", "maxLength": 300},
            },
            "requiredKinds": {"type": "array", "uniqueItems": True, "items": {"enum": allowed}},
        },
    )
