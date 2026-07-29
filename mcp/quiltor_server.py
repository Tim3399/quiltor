#!/usr/bin/env python3
"""Read-only and proposal-only MCP interface for local Quiltor worlds."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import storage  # noqa: E402
from backend.knowledge import build_knowledge, retrieve  # noqa: E402


TOOLS = [
    {"name": "list_worlds", "description": "List local Quiltor worlds. This never changes data.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "search_world", "description": "Retrieve cited manuscript, note, element, relationship, and timeline context from one world.", "inputSchema": {"type": "object", "required": ["worldId", "query"], "properties": {"worldId": {"type": "string"}, "query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 30}}, "additionalProperties": False}},
    {"name": "get_world_structure", "description": "Read all elements, relationships, and timeline moments without manuscript prose.", "inputSchema": {"type": "object", "required": ["worldId"], "properties": {"worldId": {"type": "string"}}, "additionalProperties": False}},
    {"name": "propose_create_element", "description": "Create a non-destructive proposal for a character, place, or concept. The proposal must still be confirmed in Quiltor.", "inputSchema": {"type": "object", "required": ["worldId", "name"], "properties": {"worldId": {"type": "string"}, "name": {"type": "string"}, "type": {"enum": ["person", "ort", "konzept"]}, "label": {"type": "string"}, "sub": {"type": "string"}, "profile": {"type": "object"}}, "additionalProperties": False}},
    {"name": "propose_create_relationship", "description": "Create a non-destructive relationship proposal between existing element IDs.", "inputSchema": {"type": "object", "required": ["worldId", "from", "to", "label"], "properties": {"worldId": {"type": "string"}, "from": {"type": "string"}, "to": {"type": "string"}, "label": {"type": "string"}, "directed": {"type": "boolean"}, "style": {"enum": ["solid", "dashed", "blood", "gold"]}}, "additionalProperties": False}},
    {"name": "propose_timeline_moment", "description": "Create a non-destructive timeline moment proposal.", "inputSchema": {"type": "object", "required": ["worldId", "title"], "properties": {"worldId": {"type": "string"}, "title": {"type": "string"}, "date": {"type": "string"}, "note": {"type": "string"}}, "additionalProperties": False}},
    {"name": "propose_relationship_state", "description": "Propose a relationship label or active state at an existing timeline moment.", "inputSchema": {"type": "object", "required": ["worldId", "relationshipId", "momentId"], "properties": {"worldId": {"type": "string"}, "relationshipId": {"type": "string"}, "momentId": {"type": "string"}, "label": {"type": "string"}, "active": {"type": "boolean"}, "directed": {"type": "boolean"}, "style": {"enum": ["solid", "dashed", "blood", "gold"]}}, "additionalProperties": False}},
    {"name": "propose_death_marker", "description": "Propose marking an existing character deceased at an existing timeline moment.", "inputSchema": {"type": "object", "required": ["worldId", "elementId", "momentId"], "properties": {"worldId": {"type": "string"}, "elementId": {"type": "string"}, "momentId": {"type": "string"}}, "additionalProperties": False}},
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
        return {"nodes": figures.get("nodes", []), "edges": figures.get("edges", []), "timeline": figures.get("timeline", [])}
    mapping = {
        "propose_create_element": "create_element", "propose_create_relationship": "create_relationship",
        "propose_timeline_moment": "create_timeline_moment", "propose_relationship_state": "set_relationship_at_moment",
        "propose_death_marker": "mark_deceased",
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
