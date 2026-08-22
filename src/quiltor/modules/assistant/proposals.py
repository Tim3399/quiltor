"""Deterministic proposal recovery and response-message bookkeeping."""

from __future__ import annotations

import re
from typing import Any

from quiltor.modules.assistant.contract import required_proposal_kinds
from quiltor.modules.assistant.entity_references import mentioned_entity_ids

MISSING_ITEM_KEYS = {
    "create_element": "kindCreateElement",
    "update_element": "kindUpdateElement",
    "create_timeline_moment": "kindCreateTimelineMoment",
    "create_relationship": "kindCreateRelationship",
    "set_relationship_at_moment": "kindSetRelationshipAtMoment",
    "mark_deceased": "kindMarkDeceased",
    "arrange_elements": "kindArrangeElements",
    "set_presence": "kindSetPresence",
    "duplicate element": "duplicateElementIssue",
    "duplicate timeline moment": "duplicateMomentIssue",
}


def missing_items(missing: list[str]) -> list[dict[str, Any]]:
    return [{"key": MISSING_ITEM_KEYS[item]} for item in missing]


def set_deterministic_message(
    parsed: dict[str, Any],
    key: str,
    params: dict[str, Any] | None = None,
    items: list[dict[str, Any]] | None = None,
) -> None:
    """Atomically replace deterministic response copy and its localization metadata."""
    parsed["messageKey"], parsed["messageParams"], parsed["messageItems"] = key, params, items


def forced_proposal(
    question: str, context_json: str, figures: dict[str, Any]
) -> dict[str, Any] | None:
    """Build a safe deterministic fallback for unambiguous mutation requests."""
    folded = question.casefold()
    required = required_proposal_kinds(question)
    nodes = figures.get("nodes") or []
    edges = figures.get("edges") or []
    moments = figures.get("timeline") or []
    nodes_by_id = {str(item.get("id")): item for item in nodes if item.get("id")}
    mentioned_ids = mentioned_entity_ids(question, figures)
    if mentioned_ids is None:
        return None
    mentioned_nodes = [nodes_by_id[item] for item in mentioned_ids if item in nodes_by_id]
    node = mentioned_nodes[0] if len(mentioned_nodes) == 1 else None
    moment = next(
        (
            item
            for item in moments
            if re.search(rf"\b{re.escape(str(item.get('id', '')).casefold())}\b", folded)
            or str(item.get("title", "")).casefold() in folded
        ),
        None,
    )
    if "create_element" in required:
        existing_names = {str(item.get("name", "")).casefold() for item in nodes}
        candidates = re.findall(r"\b[A-ZÄÖÜ][\wÄÖÜäöüß-]*(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]*)*", question)
        generic = {
            "lege",
            "erstelle",
            "figur",
            "ort",
            "tier",
            "konzept",
            "organisation",
            "objekt",
            "kapitel",
            "timeline",
        }
        cleaned_candidates = []
        for value in candidates:
            words = value.strip().split()
            while words and words[0].casefold() in generic:
                words.pop(0)
            cleaned = " ".join(words)
            if (
                cleaned
                and cleaned.casefold() not in generic
                and cleaned.casefold() not in existing_names
            ):
                cleaned_candidates.append(cleaned)
        name = next(reversed(cleaned_candidates), None)
        if name:
            element_type = next(
                (
                    kind
                    for kind in ("tier", "ort", "organisation", "objekt", "konzept")
                    if re.search(rf"\b{kind}\w*\b", folded)
                ),
                "person",
            )
            return {
                "kind": "create_element",
                "tempId": "new:" + re.sub(r"[^\w]+", "-", name.casefold()).strip("-"),
                "element": {"type": element_type, "name": name},
            }
    if required == {"update_element"} and node:
        note = re.search(r"(?:notiz|notes?)\s*:\s*(.+)$", question, re.IGNORECASE)
        patch = {"profile": {"notizen": (note.group(1).strip().rstrip(".") if note else question)}}
        return {"kind": "update_element", "elementId": node["id"], "patch": patch}
    if required == {"set_relationship_at_moment"}:
        edge = next((item for item in edges if str(item.get("id", "")).casefold() in folded), None)
        if edge and moment:
            label = re.search(r"(?:auf|to)\s+['\"]([^'\"]+)['\"]", question, re.IGNORECASE)
            return {
                "kind": "set_relationship_at_moment",
                "relationshipId": edge["id"],
                "momentId": moment["id"],
                "patch": {
                    "label": label.group(1) if label else edge.get("label", ""),
                    "active": "inaktiv" not in folded and "inactive" not in folded,
                    "directed": not ("ungerichtet" in folded or "undirected" in folded),
                    "style": "solid",
                },
            }
    if required == {"mark_deceased"} and node and moment:
        return {"kind": "mark_deceased", "elementId": node["id"], "momentId": moment["id"]}
    if required == {"set_presence"}:
        place_ids = mentioned_entity_ids(question, figures, entity_type="ort")
        if place_ids is None or len(place_ids) != 1:
            return None
        place = nodes_by_id.get(place_ids[0])
        element = next(
            (item for item in mentioned_nodes if item.get("id") != (place or {}).get("id")),
            None,
        )
        if place and element:
            return {
                "kind": "set_presence",
                "elementId": element["id"],
                "placeId": place["id"],
                **({"momentId": moment["id"]} if moment else {}),
            }
    if required == {"arrange_elements"}:
        return {
            "kind": "arrange_elements",
            "strategy": "grid" if "raster" in folded or "grid" in folded else "thematic",
        }
    if "beziehung" in folded or "relationship" in folded:
        matches = mentioned_nodes
        if len(matches) >= 2:
            label = "Besitzt" if re.search(r"\b(besitzt|gehört|owns?)\b", folded) else "Beziehung"
            return {
                "kind": "create_relationship",
                "relationship": {
                    "from": matches[0]["id"],
                    "to": matches[1]["id"],
                    "label": label,
                    "directed": bool(
                        re.search(r"\b(gerichtet|directed|besitzt|gehört|owns?)\b", folded)
                    ),
                    "style": "solid",
                },
            }
        return None
    if "zeitpunkt" in folded or "timeline" in folded:
        title_match = re.search(
            r"(?:für|of|called|namens)\s+(?:den|die|das|einen?|eine)?\s*([^,.]+)",
            question,
            re.IGNORECASE,
        )
        title = (title_match.group(1).strip() if title_match else "Neuer Zeitpunkt")[:160]
        return {
            "kind": "create_timeline_moment",
            "tempId": "new:moment:assistant",
            "moment": {"title": title},
        }
    return None


# Compatibility aliases for names that were module-private in runtime.py.
