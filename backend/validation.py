from __future__ import annotations

from typing import Any


def valid_figures(payload: Any) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("nodes"), list) or not isinstance(payload.get("edges"), list):
        return False
    ids: list[str] = []
    for node in payload["nodes"]:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"]:
            return False
        if not isinstance(node.get("name"), str) or not isinstance(node.get("x"), (int, float)) or not isinstance(node.get("y"), (int, float)):
            return False
        ids.append(node["id"])
    if len(ids) != len(set(ids)):
        return False
    known, edge_ids = set(ids), []
    for edge in payload["edges"]:
        if not isinstance(edge, dict) or not isinstance(edge.get("id"), str) or edge.get("from") not in known or edge.get("to") not in known:
            return False
        edge_ids.append(edge["id"])
    return len(edge_ids) == len(set(edge_ids))


def valid_manuscript(payload: Any) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("chapters"), list):
        return False
    ids: list[str] = []
    for chapter in payload["chapters"]:
        if not isinstance(chapter, dict) or not isinstance(chapter.get("id"), str) or not chapter["id"]:
            return False
        if any(not isinstance(chapter.get(key, ""), str) for key in ("title", "body", "note")):
            return False
        ids.append(chapter["id"])
    return len(ids) == len(set(ids))
