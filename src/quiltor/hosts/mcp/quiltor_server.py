#!/usr/bin/env python3
"""Read-only and proposal-only MCP interface for local Quiltor worlds."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

SOURCE_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(SOURCE_ROOT))

from quiltor import resources
from quiltor.application.story_world.read_tools import (
    READ_TOOL_NAMES,
    execute_read_tool,
    read_tool_catalog,
)
from quiltor.bootstrap import (
    build_mcp_application_services,
    build_observability,
)

OBSERVABILITY = build_observability()
_APPLICATION = build_mcp_application_services(OBSERVABILITY)
WORLDS = _APPLICATION.worlds
DOCUMENTS = _APPLICATION.documents
STORY_WORLD = _APPLICATION.story_world
del _APPLICATION


def _mcp_read_input_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return {
        **schema,
        "required": ["worldId", *schema.get("required", [])],
        "properties": {
            "worldId": {"type": "string"},
            **schema.get("properties", {}),
        },
    }


_SHARED_READ_TOOL_CATALOG = read_tool_catalog()
_SHARED_READ_TOOL_NAMES = frozenset(READ_TOOL_NAMES)
_SHARED_READ_TOOL_DOCUMENTATION = [
    {
        "name": spec["name"],
        "description": spec["description"],
        "inputSchema": _mcp_read_input_schema(spec["inputSchema"]),
    }
    for spec in _SHARED_READ_TOOL_CATALOG
]


_TOOL_DOCUMENTATION = [
    {
        "name": "list_worlds",
        "description": "List local Quiltor worlds. This never changes data.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "search_world",
        "description": "Retrieve cited manuscript, note, element, relationship, and timeline context from one world.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "query"],
            "properties": {
                "worldId": {"type": "string"},
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30},
            },
            "additionalProperties": False,
        },
    },
    *_SHARED_READ_TOOL_DOCUMENTATION,
    {
        "name": "get_world_structure",
        "description": "Read all elements, relationships, and timeline moments without manuscript prose.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId"],
            "properties": {"worldId": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "list_elements",
        "description": "Read every world element. Use this instead of RAG when completeness matters.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId"],
            "properties": {"worldId": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "list_relationships",
        "description": "Read every relationship including all timeline versions.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId"],
            "properties": {"worldId": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_relationship_history",
        "description": "Read one relationship and all of its timeline versions.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "relationshipId"],
            "properties": {"worldId": {"type": "string"}, "relationshipId": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "list_timeline_moments",
        "description": "Read every timeline moment in stored order.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId"],
            "properties": {"worldId": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_board_layout",
        "description": "Read element positions, dimensions and importance markers on the board.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId"],
            "properties": {"worldId": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "validate_world",
        "description": "Deterministically validate all endpoints, relationship duplicates and timeline references.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId"],
            "properties": {"worldId": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_create_element",
        "description": "Create a non-destructive proposal for a character, animal, place, organization, object, or concept. The proposal must still be confirmed in Quiltor.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "name"],
            "properties": {
                "worldId": {"type": "string"},
                "name": {"type": "string"},
                "type": {"enum": ["person", "tier", "ort", "organisation", "objekt", "konzept"]},
                "label": {"type": "string"},
                "sub": {"type": "string"},
                "profile": {"type": "object"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_update_element",
        "description": "Create a non-destructive proposal to update an existing element profile or summary.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "elementId"],
            "properties": {
                "worldId": {"type": "string"},
                "elementId": {"type": "string"},
                "name": {"type": "string"},
                "label": {"type": "string"},
                "sub": {"type": "string"},
                "profile": {"type": "object"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_create_relationship",
        "description": "Create a non-destructive relationship proposal between existing element IDs.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "from", "to", "label"],
            "properties": {
                "worldId": {"type": "string"},
                "from": {"type": "string"},
                "to": {"type": "string"},
                "label": {"type": "string"},
                "directed": {"type": "boolean"},
                "style": {"enum": ["solid", "dashed", "blood", "gold"]},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_timeline_moment",
        "description": "Create a non-destructive timeline moment proposal.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "title"],
            "properties": {
                "worldId": {"type": "string"},
                "title": {"type": "string"},
                "date": {"type": "string"},
                "note": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_relationship_state",
        "description": "Propose a relationship label or active state at an existing timeline moment.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "relationshipId", "momentId"],
            "properties": {
                "worldId": {"type": "string"},
                "relationshipId": {"type": "string"},
                "momentId": {"type": "string"},
                "label": {"type": "string"},
                "active": {"type": "boolean"},
                "directed": {"type": "boolean"},
                "style": {"enum": ["solid", "dashed", "blood", "gold"]},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_death_marker",
        "description": "Propose marking an existing character deceased at an existing timeline moment.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "elementId", "momentId"],
            "properties": {
                "worldId": {"type": "string"},
                "elementId": {"type": "string"},
                "momentId": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_set_presence",
        "description": "Propose placing an existing element at an existing place, optionally from a timeline moment onward.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "elementId", "placeId"],
            "properties": {
                "worldId": {"type": "string"},
                "elementId": {"type": "string"},
                "placeId": {"type": "string"},
                "momentId": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_arrange_elements",
        "description": "Propose arranging the figure board as a grid or by connected thematic groups.",
        "inputSchema": {
            "type": "object",
            "required": ["worldId", "strategy"],
            "properties": {
                "worldId": {"type": "string"},
                "strategy": {"enum": ["thematic", "grid"]},
            },
            "additionalProperties": False,
        },
    },
]


def _contract_tools() -> list[dict[str, Any]]:
    """Build the wire catalog from the versioned MCP contract fixture.

    Human-facing descriptions stay beside this host. Names and input schemas,
    which clients execute against, have exactly one source of truth.
    """
    descriptions = {tool["name"]: tool["description"] for tool in _TOOL_DOCUMENTATION}
    fixture = resources.mcp_tools_contract()
    document = json.loads(fixture.read_text(encoding="utf-8"))
    names = [tool.get("name") for tool in document.get("tools", [])]
    if set(names) != set(descriptions) or len(names) != len(set(names)):
        raise RuntimeError("MCP tool documentation and contract catalogue have drifted.")
    fixture_by_name = {tool["name"]: tool for tool in document["tools"]}
    for spec in _SHARED_READ_TOOL_CATALOG:
        fixture = fixture_by_name.get(spec["name"])
        if (
            fixture is None
            or fixture.get("effect") != "read"
            or fixture.get("inputSchema") != _mcp_read_input_schema(spec["inputSchema"])
        ):
            raise RuntimeError("Shared read-tool and MCP schemas have drifted.")
    return [
        {
            "name": tool["name"],
            "description": descriptions[tool["name"]],
            "inputSchema": tool["inputSchema"],
            "annotations": {
                "readOnlyHint": tool["effect"] == "read",
                "destructiveHint": False,
            },
        }
        for tool in document["tools"]
    ]


TOOLS = _contract_tools()


def _world(world_id: str) -> tuple[dict[str, Any], dict[str, Any], int]:
    opened = WORLDS.open(world_id)
    manuscript = DOCUMENTS.load("manuscript", opened.paths.documents.database)
    figures = DOCUMENTS.load("figures", opened.paths.documents.database)
    return manuscript.state, figures.state, figures.revision


def _stable_temp_id(prefix: str, canonical: dict[str, Any]) -> str:
    encoded = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:20]
    return f"new:{prefix}:mcp:{digest}"


def _decision_error(decision: dict[str, Any]) -> ValueError:
    proof = decision.get("proof") or {}
    candidates = proof.get("candidateIds") or []
    detail = f" Candidates: {', '.join(candidates)}." if candidates else ""
    return ValueError(
        f"{decision.get('operation', 'Mutation')} resolution failed: "
        f"{decision.get('outcome', 'invalid')}.{detail}"
    )


def _checked_decision(decision: dict[str, Any]) -> dict[str, Any]:
    if decision.get("outcome") in {"ambiguous", "invalid"}:
        raise _decision_error(decision)
    return decision


def _mutation_result(
    decision: dict[str, Any], proposal: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "proposal": proposal,
        "requiresConfirmation": proposal is not None,
        "applied": False,
        "operationSatisfied": bool(decision.get("operationSatisfied")),
        "resolution": decision,
    }


def _local_decision(
    operation: str,
    outcome: str,
    mention: str,
    world_revision: int,
    *,
    resolved_id: str | None = None,
    canonical: dict[str, Any] | None = None,
    candidate_ids: list[str] | None = None,
    status: str = "resolved",
) -> dict[str, Any]:
    return {
        "operation": operation,
        "outcome": outcome,
        "operationSatisfied": outcome in {"existing", "unchanged"},
        "resolvedId": resolved_id,
        "canonical": canonical,
        "proof": {
            "checked": True,
            "status": status,
            "mention": mention,
            "candidateIds": sorted(set(candidate_ids or [])),
            "worldRevision": world_revision,
        },
    }


def _resolved_element(
    figures: dict[str, Any], mention: str, *, entity_type: str | None = None
) -> tuple[str, list[str]]:
    resolution = STORY_WORLD.resolve_entity(figures, mention, entity_type=entity_type)
    candidate_ids = [candidate["elementId"] for candidate in resolution["candidates"]]
    if resolution["status"] != "resolved" or not resolution["resolvedId"]:
        outcome = "ambiguous" if resolution["status"] == "ambiguous" else "invalid"
        raise _decision_error(
            {
                "operation": "element",
                "outcome": outcome,
                "proof": {"candidateIds": candidate_ids},
            }
        )
    return resolution["resolvedId"], candidate_ids


def _relationship_state_at(
    edge: dict[str, Any], timeline: list[dict[str, Any]], moment_id: str
) -> dict[str, Any]:
    state = {
        "label": edge.get("label", ""),
        "active": edge.get("active", True),
        "directed": edge.get("gerichtet", edge.get("directed", False)),
        "style": edge.get("style", "solid"),
    }
    active_index = next(
        index for index, moment in enumerate(timeline) if moment.get("id") == moment_id
    )
    moment_indexes = {
        moment.get("id"): index
        for index, moment in enumerate(timeline)
        if isinstance(moment.get("id"), str)
    }
    versions = sorted(
        (
            version
            for version in edge.get("versions") or []
            if isinstance(version, dict)
            and moment_indexes.get(version.get("momentId"), active_index + 1) <= active_index
        ),
        key=lambda version: moment_indexes.get(version.get("momentId"), active_index + 1),
    )
    for version in versions:
        for key in ("label", "active", "style"):
            if key in version:
                state[key] = version[key]
        if "gerichtet" in version or "directed" in version:
            state["directed"] = version.get("gerichtet", version.get("directed"))
    return state


def _proposal(
    arguments: dict[str, Any],
    figures: dict[str, Any],
    kind: str,
    world_revision: int,
) -> dict[str, Any]:
    if kind == "create_element":
        candidate = {
            key: arguments[key]
            for key in ("type", "name", "label", "sub", "profile")
            if key in arguments
        }
        decision = _checked_decision(
            STORY_WORLD.ensure_element(figures, candidate, world_revision=world_revision)
        )
        if decision["outcome"] in {"existing", "unchanged"}:
            return _mutation_result(decision)
        canonical = decision["canonical"] or {}
        if decision["outcome"] == "update":
            patch = {
                key: canonical[key]
                for key in ("label", "sub", "profile")
                if key in arguments and key in canonical
            }
            return _mutation_result(
                decision,
                {"kind": "update_element", "elementId": decision["resolvedId"], "patch": patch},
            )
        element = {
            key: canonical[key]
            for key in ("type", "name", "label", "sub", "profile")
            if key in canonical
        }
        return _mutation_result(
            decision,
            {
                "kind": kind,
                "tempId": _stable_temp_id("element", element),
                "element": element,
            },
        )

    if kind == "update_element":
        resolved_id, _candidate_ids = _resolved_element(figures, arguments["elementId"])
        existing = next(node for node in figures.get("nodes", []) if node.get("id") == resolved_id)
        if "name" in arguments and arguments["name"] != existing.get("name"):
            raise ValueError("Element names cannot be changed safely through MCP.")
        candidate = {
            "name": resolved_id,
            **({"type": existing["type"]} if "type" in existing else {}),
            **{key: arguments[key] for key in ("label", "sub", "profile") if key in arguments},
        }
        decision = _checked_decision(
            STORY_WORLD.ensure_element(figures, candidate, world_revision=world_revision)
        )
        if decision["outcome"] in {"existing", "unchanged"}:
            return _mutation_result(decision)
        if decision["outcome"] != "update":
            raise ValueError("The resolved element cannot be updated safely.")
        canonical = decision["canonical"] or {}
        patch = {
            key: canonical[key]
            for key in ("label", "sub", "profile")
            if key in arguments and key in canonical
        }
        return _mutation_result(
            decision,
            {"kind": kind, "elementId": resolved_id, "patch": patch},
        )

    if kind == "create_relationship":
        candidate = {
            key: arguments[key]
            for key in ("from", "to", "label", "directed", "style")
            if key in arguments
        }
        decision = _checked_decision(
            STORY_WORLD.ensure_relationship(figures, candidate, world_revision=world_revision)
        )
        if decision["outcome"] in {"existing", "unchanged"}:
            return _mutation_result(decision)
        if decision["outcome"] != "create":
            raise ValueError("The relationship already exists and cannot be updated by this tool.")
        canonical = decision["canonical"] or {}
        relationship = {
            key: canonical[key]
            for key in ("from", "to", "label", "directed", "style")
            if key in canonical
        }
        return _mutation_result(decision, {"kind": kind, "relationship": relationship})

    if kind == "create_timeline_moment":
        candidate = {key: arguments[key] for key in ("title", "date", "note") if key in arguments}
        decision = _checked_decision(
            STORY_WORLD.ensure_timeline_moment(figures, candidate, world_revision=world_revision)
        )
        if decision["outcome"] in {"existing", "unchanged"}:
            return _mutation_result(decision)
        if decision["outcome"] != "create":
            raise ValueError(
                "The timeline moment already exists and cannot be updated by this tool."
            )
        canonical = decision["canonical"] or {}
        moment = {key: canonical[key] for key in ("title", "date", "note") if key in canonical}
        return _mutation_result(
            decision,
            {
                "kind": kind,
                "tempId": _stable_temp_id("moment", moment),
                "moment": moment,
            },
        )

    if kind == "set_presence":
        candidate = {
            key: arguments[key] for key in ("elementId", "placeId", "momentId") if key in arguments
        }
        decision = _checked_decision(
            STORY_WORLD.ensure_presence(figures, candidate, world_revision=world_revision)
        )
        if decision["outcome"] in {"existing", "unchanged"}:
            return _mutation_result(decision)
        canonical = decision["canonical"] or {}
        proposal = {
            "kind": kind,
            "elementId": canonical["elementId"],
            "placeId": canonical["placeId"],
            **({"momentId": canonical["momentId"]} if canonical.get("momentId") else {}),
        }
        return _mutation_result(decision, proposal)

    timeline = [moment for moment in figures.get("timeline", []) if isinstance(moment, dict)]
    moments = {moment.get("id") for moment in timeline}
    if kind == "set_relationship_at_moment":
        relationship = next(
            (
                edge
                for edge in figures.get("edges", [])
                if isinstance(edge, dict) and edge.get("id") == arguments["relationshipId"]
            ),
            None,
        )
        if relationship is None or arguments["momentId"] not in moments:
            raise ValueError("Relationship and moment must already exist by exact ID.")
        patch = {
            key: arguments[key]
            for key in ("label", "active", "directed", "style")
            if key in arguments
        }
        current = _relationship_state_at(relationship, timeline, arguments["momentId"])
        satisfied = all(current.get(key) == value for key, value in patch.items())
        decision = _local_decision(
            "relationship_state",
            "unchanged" if satisfied else "update",
            f"{arguments['relationshipId']} @ {arguments['momentId']}",
            world_revision,
            resolved_id=arguments["relationshipId"],
            canonical={**current, **patch, "momentId": arguments["momentId"]},
            candidate_ids=[arguments["relationshipId"]],
        )
        if satisfied:
            return _mutation_result(decision)
        return _mutation_result(
            decision,
            {
                "kind": kind,
                "relationshipId": arguments["relationshipId"],
                "momentId": arguments["momentId"],
                "patch": patch,
            },
        )

    if kind == "mark_deceased":
        resolved_id, candidate_ids = _resolved_element(figures, arguments["elementId"])
        if arguments["momentId"] not in moments:
            raise ValueError("The timeline moment must already exist by exact ID.")
        element = next(node for node in figures.get("nodes", []) if node.get("id") == resolved_id)
        satisfied = element.get("diedMomentId") == arguments["momentId"]
        decision = _local_decision(
            "death_marker",
            "unchanged" if satisfied else "update",
            arguments["elementId"],
            world_revision,
            resolved_id=resolved_id,
            canonical={"elementId": resolved_id, "momentId": arguments["momentId"]},
            candidate_ids=candidate_ids,
        )
        if satisfied:
            return _mutation_result(decision)
        return _mutation_result(
            decision,
            {"kind": kind, "elementId": resolved_id, "momentId": arguments["momentId"]},
        )

    if kind == "arrange_elements":
        strategy = arguments.get("strategy", "thematic")
        decision = _local_decision(
            "arrange_elements",
            "update",
            strategy,
            world_revision,
            canonical={"strategy": strategy},
        )
        return _mutation_result(decision, {"kind": kind, "strategy": strategy})

    raise ValueError(f"Unknown proposal kind: {kind}")


def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    if name == "list_worlds":
        return {"worlds": WORLDS.list()}
    manuscript, figures, world_revision = _world(str(arguments.get("worldId", "")))
    if name in _SHARED_READ_TOOL_NAMES:
        return execute_read_tool(
            name,
            {key: value for key, value in arguments.items() if key != "worldId"},
            manuscript=manuscript,
            figures=figures,
            world_revision=world_revision,
        )
    if name == "search_world":
        return {
            "sources": STORY_WORLD.search(
                manuscript,
                figures,
                str(arguments.get("query", "")),
                int(arguments.get("limit", 14)),
            )
        }
    if name == "get_world_structure":
        return STORY_WORLD.structure(figures)
    if name == "list_elements":
        return {"elements": figures.get("nodes", []), "count": len(figures.get("nodes", []))}
    if name == "list_relationships":
        return {"relationships": figures.get("edges", []), "count": len(figures.get("edges", []))}
    if name == "get_relationship_history":
        relationship = next(
            (
                edge
                for edge in figures.get("edges", [])
                if edge.get("id") == arguments.get("relationshipId")
            ),
            None,
        )
        if not relationship:
            raise ValueError("The relationship does not exist.")
        return {"relationship": relationship, "versions": relationship.get("versions", [])}
    if name == "list_timeline_moments":
        return {"timeline": figures.get("timeline", []), "count": len(figures.get("timeline", []))}
    if name == "get_board_layout":
        fields = ("id", "x", "y", "width", "height", "important", "pinned")
        return {
            "elements": [
                {key: node.get(key) for key in fields if key in node}
                for node in figures.get("nodes", [])
            ]
        }
    if name == "validate_world":
        return STORY_WORLD.validate(figures)
    mapping = {
        "propose_create_element": "create_element",
        "propose_create_relationship": "create_relationship",
        "propose_timeline_moment": "create_timeline_moment",
        "propose_relationship_state": "set_relationship_at_moment",
        "propose_death_marker": "mark_deceased",
        "propose_set_presence": "set_presence",
        "propose_update_element": "update_element",
        "propose_arrange_elements": "arrange_elements",
    }
    if name not in mapping:
        raise ValueError(f"Unknown tool: {name}")
    return _proposal(arguments, figures, mapping[name], world_revision)


def respond(request: dict[str, Any]) -> dict[str, Any] | None:
    request_id, method = request.get("id"), request.get("method")
    if request_id is None:
        return None
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "quiltor", "version": product_version()},
                "instructions": "All mutation tools return proposals only. Confirm proposals inside Quiltor; no tool writes story prose or world data.",
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        try:
            params = request.get("params") or {}
            result = call_tool(str(params.get("name", "")), params.get("arguments") or {})
            text = json.dumps(result, ensure_ascii=False)
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "content": [{"type": "text", "text": text}],
                    "structuredContent": result,
                },
            }
        except Exception as exc:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"isError": True, "content": [{"type": "text", "text": str(exc)}]},
            }
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": "Method not found"},
    }


def product_version() -> str:
    path = resources.version_file()
    return path.read_text(encoding="utf-8").strip() if path.is_file() else "dev"


def main() -> None:
    for line in sys.stdin:
        try:
            answer = respond(json.loads(line))
            if answer is not None:
                print(json.dumps(answer, ensure_ascii=False), flush=True)
        except Exception as exc:
            print(
                json.dumps(
                    {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(exc)}}
                ),
                flush=True,
            )


if __name__ == "__main__":
    main()
