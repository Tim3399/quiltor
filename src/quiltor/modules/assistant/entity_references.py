"""Assistant-side adapters for canonical world-entity resolution.

The domain resolver owns identity semantics.  This module only extracts explicit
entity mentions from natural-language assistant requests and turns resolver
results into the existing clarification wire shape.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable

from quiltor.domain.story_world.entity_resolution import ResolutionResult, resolve_entity


@dataclass(frozen=True)
class EntityMention:
    start: int
    end: int
    text: str
    resolution: ResolutionResult


def _aliases(node: dict[str, Any]) -> Iterable[str]:
    for item in node.get("aliases") or []:
        if isinstance(item, dict) and isinstance(item.get("alias"), str):
            yield item["alias"]


def _surfaces(node: dict[str, Any]) -> Iterable[str]:
    for value in (node.get("id"), node.get("name"), *_aliases(node)):
        if isinstance(value, str) and value.strip():
            yield value.strip()


def entity_mentions(
    question: str,
    figures: dict[str, Any],
    *,
    entity_type: str | None = None,
) -> list[EntityMention]:
    """Resolve explicit names/aliases/IDs in text without choosing between collisions.

    Surface discovery is deliberately dumb and side-effect free.  Every identity
    decision still goes through ``resolve_entity``.  Overlapping labels prefer the
    longest complete surface (``Tarek Venn`` over ``Tarek``), while identical
    name/alias surfaces collapse to one resolver call whose result can be ambiguous.
    """

    discovered: dict[tuple[int, int, str], tuple[int, int, str]] = {}
    for node in figures.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        if entity_type is not None and node.get("type", "person") != entity_type:
            continue
        for surface in _surfaces(node):
            pattern = re.compile(rf"(?<!\w){re.escape(surface)}(?!\w)", re.IGNORECASE)
            for match in pattern.finditer(question):
                key = (match.start(), match.end(), match.group(0).casefold())
                discovered[key] = (match.start(), match.end(), match.group(0))

    ordered = sorted(discovered.values(), key=lambda item: (item[0], -(item[1] - item[0])))
    selected: list[tuple[int, int, str]] = []
    for candidate in ordered:
        start, end, _text = candidate
        if any(start < kept_end and kept_start < end for kept_start, kept_end, _ in selected):
            continue
        selected.append(candidate)

    return [
        EntityMention(
            start,
            end,
            text,
            resolve_entity(figures, text, entity_type=entity_type),
        )
        for start, end, text in sorted(selected, key=lambda item: item[0])
    ]


def resolved_entity_id(
    figures: dict[str, Any],
    value: Any,
    *,
    entity_type: str | None = None,
) -> str | None:
    """Return an ID only for the resolver's explicit ``resolved`` outcome."""

    if not isinstance(value, str):
        return None
    resolution = resolve_entity(figures, value, entity_type=entity_type)
    return resolution.resolved_id if resolution.status == "resolved" else None


def mentioned_entity_ids(
    question: str,
    figures: dict[str, Any],
    *,
    entity_type: str | None = None,
) -> list[str] | None:
    """Return ordered unique IDs, or ``None`` when any explicit mention is ambiguous."""

    mentions = entity_mentions(question, figures, entity_type=entity_type)
    if any(mention.resolution.status == "ambiguous" for mention in mentions):
        return None
    return list(
        dict.fromkeys(
            mention.resolution.resolved_id
            for mention in mentions
            if mention.resolution.status == "resolved"
            and mention.resolution.resolved_id is not None
        )
    )


def clarification_candidates(
    figures: dict[str, Any], candidate_ids: Iterable[str]
) -> list[dict[str, str]]:
    """Build the assistant's existing clarification payload for entity IDs only."""

    by_id = {
        str(node.get("id")): node
        for node in figures.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    }
    result: list[dict[str, str]] = []
    for element_id in dict.fromkeys(candidate_ids):
        node = by_id.get(element_id)
        if node is None:
            continue
        result.append(
            {
                "id": element_id,
                "name": str(node.get("name") or element_id),
                "kind": str(node.get("type") or "person"),
            }
        )
    return result[:8]
