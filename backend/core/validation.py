from __future__ import annotations

from typing import Any


def valid_figures(payload: Any) -> bool:
    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("nodes"), list)
        or not isinstance(payload.get("edges"), list)
    ):
        return False
    ids: list[str] = []
    for node in payload["nodes"]:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"]:
            return False
        if (
            not isinstance(node.get("name"), str)
            or not isinstance(node.get("x"), (int, float))
            or not isinstance(node.get("y"), (int, float))
        ):
            return False
        if node.get("mapX") is not None and not isinstance(node.get("mapX"), (int, float)):
            return False
        if node.get("mapY") is not None and not isinstance(node.get("mapY"), (int, float)):
            return False
        ids.append(node["id"])
    if len(ids) != len(set(ids)):
        return False
    known, edge_ids = set(ids), []
    for edge in payload["edges"]:
        if (
            not isinstance(edge, dict)
            or not isinstance(edge.get("id"), str)
            or edge.get("from") not in known
            or edge.get("to") not in known
        ):
            return False
        edge_ids.append(edge["id"])
    if len(edge_ids) != len(set(edge_ids)):
        return False
    presence = payload.get("presence")
    if presence is None:
        return True
    if not isinstance(presence, list):
        return False
    entry_ids = []
    for entry in presence:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"]:
            return False
        if not isinstance(entry.get("elementId"), str) or not isinstance(entry.get("placeId"), str):
            return False
        if entry.get("momentId") is not None and not isinstance(entry.get("momentId"), str):
            return False
        entry_ids.append(entry["id"])
    return len(entry_ids) == len(set(entry_ids))


def valid_manuscript(payload: Any) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("chapters"), list):
        return False
    if payload.get("language", "de-DE") != "de-DE" or payload.get("grammarMode", "manual") not in {
        "manual",
        "automatic",
    }:
        return False
    ids: list[str] = []
    for chapter in payload["chapters"]:
        if (
            not isinstance(chapter, dict)
            or not isinstance(chapter.get("id"), str)
            or not chapter["id"]
        ):
            return False
        if any(not isinstance(chapter.get(key, ""), str) for key in ("title", "body", "note")):
            return False
        if (
            len(chapter["id"]) > 200
            or len(chapter.get("title", "")) > 1000
            or len(chapter.get("note", "")) > 100_000
            or len(chapter.get("body", "")) > 10_000_000
        ):
            return False
        mentions = chapter.get("mentions", [])
        if not isinstance(mentions, list) or len(mentions) > 10_000:
            return False
        previous_to = -1
        mention_ids: set[str] = set()
        for mention in sorted(
            mentions, key=lambda item: item.get("from", -1) if isinstance(item, dict) else -1
        ):
            if not isinstance(mention, dict):
                return False
            if any(
                not isinstance(mention.get(key), str) or not mention[key] or len(mention[key]) > 500
                for key in ("id", "elementId", "surface", "source")
            ):
                return False
            if mention["source"] not in {"completion", "helper", "deterministic", "llm-assisted"}:
                return False
            start, end, confidence = (
                mention.get("from"),
                mention.get("to"),
                mention.get("confidence"),
            )
            if (
                type(start) is not int
                or type(end) is not int
                or start < 0
                or end <= start
                or end > len(chapter.get("body", ""))
            ):
                return False
            if (
                not isinstance(confidence, (int, float))
                or isinstance(confidence, bool)
                or confidence < 0
                or confidence > 1
            ):
                return False
            if (
                start < previous_to
                or chapter["body"][start:end] != mention["surface"]
                or mention["id"] in mention_ids
            ):
                return False
            previous_to = end
            mention_ids.add(mention["id"])
        if not _valid_marks(chapter):
            return False
        ids.append(chapter["id"])
    return len(ids) == len(set(ids))


def _valid_marks(chapter: dict) -> bool:
    """Bold and italic are ranges over the body, exactly like a mention -- and held to the
    same standard: inside the text, in order, and never overlapping their own kind (the
    editor merges those into one range). Bold over italic is fine, they are separate kinds."""
    marks = chapter.get("marks", [])
    if not isinstance(marks, list) or len(marks) > 10_000:
        return False
    body_length = len(chapter.get("body", ""))
    previous_to: dict[str, int] = {}
    for mark in sorted(
        marks, key=lambda item: item.get("from", -1) if isinstance(item, dict) else -1
    ):
        if not isinstance(mark, dict) or mark.get("kind") not in {"bold", "italic"}:
            return False
        start, end = mark.get("from"), mark.get("to")
        if (
            type(start) is not int
            or type(end) is not int
            or start < 0
            or end <= start
            or end > body_length
        ):
            return False
        if start < previous_to.get(mark["kind"], -1):
            return False
        previous_to[mark["kind"]] = end
    return True
