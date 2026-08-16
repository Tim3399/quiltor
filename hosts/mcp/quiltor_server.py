#!/usr/bin/env python3
"""Read-only and proposal-only MCP interface for local Quiltor worlds."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]  # hosts/mcp/ -> hosts/ -> repository root
sys.path.insert(0, str(ROOT))

from backend.core import storage  # noqa: E402
from backend.assistant import validate_world  # noqa: E402
from backend.core.knowledge import build_knowledge, retrieve  # noqa: E402


TOOLS = [
    {"name": "list_worlds", "description": "List local Quiltor worlds. This never changes data.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "search_world", "description": "Retrieve cited manuscript, note, element, relationship, and timeline context from one world.", "inputSchema": {"type": "object", "required": ["worldId", "query"], "properties": {"worldId": {"type": "string"}, "query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 30}}, "additionalProperties": False}},
    {"name": "get_world_structure", "description": "Read all elements, relationships, and timeline moments without manuscript prose.", "inputSchema": {"type": "object", "required": ["worldId"], "properties": {"worldId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "list_elements", "description": "Read every world element. Use this instead of RAG when completeness matters.", "inputSchema": {"type": "object", "required": ["worldId"], "properties": {"worldId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "list_relationships", "description": "Read every relationship including all timeline versions.", "inputSchema": {"type": "object", "required": ["worldId"], "properties": {"worldId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "get_relationship_history", "description": "Read one relationship and all of its timeline versions.", "inputSchema": {"type": "object", "required": ["worldId", "relationshipId"], "properties": {"worldId": {"type": "string"}, "relationshipId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "list_timeline_moments", "description": "Read every timeline moment in stored order.", "inputSchema": {"type": "object", "required": ["worldId"], "properties": {"worldId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "get_board_layout", "description": "Read element positions, dimensions and importance markers on the board.", "inputSchema": {"type": "object", "required": ["worldId"], "properties": {"worldId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "validate_world", "description": "Deterministically validate all endpoints, relationship duplicates and timeline references.", "inputSchema": {"type": "object", "required": ["worldId"], "properties": {"worldId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "propose_create_element", "description": "Create a non-destructive proposal for a character, animal, place, organization, object, or concept. The proposal must still be confirmed in Quiltor.", "inputSchema": {"type": "object", "required": ["worldId", "name"], "properties": {"worldId": {"type": "string"}, "name": {"type": "string"}, "type": {"enum": ["person", "tier", "ort", "organisation", "objekt", "konzept"]}, "label": {"type": "string"}, "sub": {"type": "string"}, "profile": {"type": "object"}}, "additionalProperties": False}},
    {"name": "propose_update_element", "description": "Create a non-destructive proposal to update an existing element profile or summary.", "inputSchema": {"type": "object", "required": ["worldId", "elementId"], "properties": {"worldId": {"type": "string"}, "elementId": {"type": "string"}, "name": {"type": "string"}, "label": {"type": "string"}, "sub": {"type": "string"}, "profile": {"type": "object"}}, "additionalProperties": False}},
    {"name": "propose_create_relationship", "description": "Create a non-destructive relationship proposal between existing element IDs.", "inputSchema": {"type": "object", "required": ["worldId", "from", "to", "label"], "properties": {"worldId": {"type": "string"}, "from": {"type": "string"}, "to": {"type": "string"}, "label": {"type": "string"}, "directed": {"type": "boolean"}, "style": {"enum": ["solid", "dashed", "blood", "gold"]}}, "additionalProperties": False}},
    {"name": "propose_timeline_moment", "description": "Create a non-destructive timeline moment proposal.", "inputSchema": {"type": "object", "required": ["worldId", "title"], "properties": {"worldId": {"type": "string"}, "title": {"type": "string"}, "date": {"type": "string"}, "note": {"type": "string"}}, "additionalProperties": False}},
    {"name": "propose_relationship_state", "description": "Propose a relationship label or active state at an existing timeline moment.", "inputSchema": {"type": "object", "required": ["worldId", "relationshipId", "momentId"], "properties": {"worldId": {"type": "string"}, "relationshipId": {"type": "string"}, "momentId": {"type": "string"}, "label": {"type": "string"}, "active": {"type": "boolean"}, "directed": {"type": "boolean"}, "style": {"enum": ["solid", "dashed", "blood", "gold"]}}, "additionalProperties": False}},
    {"name": "propose_death_marker", "description": "Propose marking an existing character deceased at an existing timeline moment.", "inputSchema": {"type": "object", "required": ["worldId", "elementId", "momentId"], "properties": {"worldId": {"type": "string"}, "elementId": {"type": "string"}, "momentId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "propose_set_presence", "description": "Propose placing an existing element at an existing place, optionally from a timeline moment onward.", "inputSchema": {"type": "object", "required": ["worldId", "elementId", "placeId"], "properties": {"worldId": {"type": "string"}, "elementId": {"type": "string"}, "placeId": {"type": "string"}, "momentId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "propose_arrange_elements", "description": "Propose arranging the figure board as a grid or by connected thematic groups.", "inputSchema": {"type": "object", "required": ["worldId", "strategy"], "properties": {"worldId": {"type": "string"}, "strategy": {"enum": ["thematic", "grid"]}}, "additionalProperties": False}},
]


def _world(world_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    storage.activate_world(world_id)
    return storage.load_manuscript(), storage.load_figures()


def _proposal(arguments: dict[str, Any], figures: dict[str, Any], kind: str) -> dict[str, Any]:
    nodes = {node["id"] for node in figures.get("nodes", [])}
    edges = {edge["id"] for edge in figures.get("edges", [])}
    moments = {moment["id"] for moment in figures.get("timeline", [])}
    if kind == "create_element":
        return {"kind": kind, "tempId": "new:mcp-element", "element": {key: arguments[key] for key in ("type", "name", "label", "sub", "profile") if key in arguments}}
    if kind == "update_element":
        if arguments["elementId"] not in nodes:
            raise ValueError("The element must already exist.")
        return {"kind": kind, "elementId": arguments["elementId"], "patch": {key: arguments[key] for key in ("name", "label", "sub", "profile") if key in arguments}}
    if kind == "arrange_elements":
        return {"kind": kind, "strategy": arguments.get("strategy", "thematic")}
    if kind == "create_relationship":
        if arguments["from"] not in nodes or arguments["to"] not in nodes or arguments["from"] == arguments["to"]:
            raise ValueError("Both endpoints must be different existing element IDs.")
        return {"kind": kind, "relationship": {key: arguments[key] for key in ("from", "to", "label", "directed", "style") if key in arguments}}
    if kind == "create_timeline_moment":
        return {"kind": kind, "tempId": "new:moment:mcp", "moment": {key: arguments[key] for key in ("title", "date", "note") if key in arguments}}
    if kind == "set_relationship_at_moment":
        if arguments["relationshipId"] not in edges or arguments["momentId"] not in moments:
            raise ValueError("Relationship and moment must already exist.")
        return {"kind": kind, "relationshipId": arguments["relationshipId"], "momentId": arguments["momentId"], "patch": {key: arguments[key] for key in ("label", "active", "directed", "style") if key in arguments}}
    if kind == "set_presence":
        places = {node["id"] for node in figures.get("nodes", []) if node.get("type") == "ort"}
        if arguments["elementId"] not in nodes or arguments["placeId"] not in places or (arguments.get("momentId") and arguments["momentId"] not in moments):
            raise ValueError("Element, place, and optional moment must already exist.")
        return {"kind": kind, "elementId": arguments["elementId"], "placeId": arguments["placeId"], **({"momentId": arguments["momentId"]} if arguments.get("momentId") else {})}
    if arguments["elementId"] not in nodes or arguments["momentId"] not in moments:
        raise ValueError("Element and moment must already exist.")
    return {"kind": "mark_deceased", "elementId": arguments["elementId"], "momentId": arguments["momentId"]}


def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    if name == "list_worlds":
        return {"worlds": storage.list_worlds()}
    manuscript, figures = _world(str(arguments.get("worldId", "")))
    if name == "search_world":
        chunks = retrieve(build_knowledge(manuscript, figures), str(arguments.get("query", "")), int(arguments.get("limit", 14)))
        return {"sources": [chunk.public() for chunk in chunks]}
    if name == "get_world_structure":
        return {"nodes": figures.get("nodes", []), "edges": figures.get("edges", []), "timeline": figures.get("timeline", []), "presence": figures.get("presence", [])}
    if name == "list_elements":
        return {"elements": figures.get("nodes", []), "count": len(figures.get("nodes", []))}
    if name == "list_relationships":
        return {"relationships": figures.get("edges", []), "count": len(figures.get("edges", []))}
    if name == "get_relationship_history":
        relationship = next((edge for edge in figures.get("edges", []) if edge.get("id") == arguments.get("relationshipId")), None)
        if not relationship:
            raise ValueError("The relationship does not exist.")
        return {"relationship": relationship, "versions": relationship.get("versions", [])}
    if name == "list_timeline_moments":
        return {"timeline": figures.get("timeline", []), "count": len(figures.get("timeline", []))}
    if name == "get_board_layout":
        fields = ("id", "x", "y", "width", "height", "important", "pinned")
        return {"elements": [{key: node.get(key) for key in fields if key in node} for node in figures.get("nodes", [])]}
    if name == "validate_world":
        return validate_world(figures)
    mapping = {
        "propose_create_element": "create_element", "propose_create_relationship": "create_relationship",
        "propose_timeline_moment": "create_timeline_moment", "propose_relationship_state": "set_relationship_at_moment",
        "propose_death_marker": "mark_deceased",
        "propose_set_presence": "set_presence",
        "propose_update_element": "update_element", "propose_arrange_elements": "arrange_elements",
    }
    if name not in mapping:
        raise ValueError(f"Unknown tool: {name}")
    return {"proposal": _proposal(arguments, figures, mapping[name]), "requiresConfirmation": True, "applied": False}


def respond(request: dict[str, Any]) -> dict[str, Any] | None:
    request_id, method = request.get("id"), request.get("method")
    if request_id is None:
        return None
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"protocolVersion": "2025-06-18", "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "quiltor", "version": "2.0.0"}, "instructions": "All mutation tools return proposals only. Confirm proposals inside Quiltor; no tool writes story prose or world data."}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        try:
            params = request.get("params") or {}
            result = call_tool(str(params.get("name", "")), params.get("arguments") or {})
            text = json.dumps(result, ensure_ascii=False)
            return {"jsonrpc": "2.0", "id": request_id, "result": {"content": [{"type": "text", "text": text}], "structuredContent": result}}
        except Exception as exc:
            return {"jsonrpc": "2.0", "id": request_id, "result": {"isError": True, "content": [{"type": "text", "text": str(exc)}]}}
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}


def main() -> None:
    for line in sys.stdin:
        try:
            answer = respond(json.loads(line))
            if answer is not None:
                print(json.dumps(answer, ensure_ascii=False), flush=True)
        except Exception as exc:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(exc)}}), flush=True)


if __name__ == "__main__":
    main()
