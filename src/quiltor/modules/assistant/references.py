"""Deterministic resolution of conversational world-object references."""

from __future__ import annotations

import re
from typing import Any

from quiltor.modules.assistant.entity_references import (
    clarification_candidates,
    entity_mentions,
    resolved_entity_id,
)

AMBIGUOUS_REFERENCE = re.compile(
    r"\b(er|sie|es|ihn|ihm|ihr|seine|seiner|deren|dies(?:e|er|es)|dort|he|she|it|his|her|there)\b",
    re.I,
)


def resolve_reference(
    question: str, history: list[dict[str, Any]] | None, figures: dict[str, Any]
) -> dict[str, Any] | None:
    nodes = figures.get("nodes", [])
    moments = figures.get("timeline", [])
    objects = [*nodes, *moments]
    by_id = {str(item.get("id")): item for item in objects if item.get("id")}
    moment_ids = {str(item.get("id")) for item in moments if item.get("id")}
    entity_matches = entity_mentions(question, figures)
    ambiguous = next(
        (item.resolution for item in entity_matches if item.resolution.status == "ambiguous"),
        None,
    )
    if ambiguous is not None:
        candidates = clarification_candidates(
            figures, (item.element_id for item in ambiguous.candidates)
        )
        return {"clarification": {"candidates": candidates}} if candidates else None
    if not AMBIGUOUS_REFERENCE.search(question):
        return None

    explicit_entity_ids = list(
        dict.fromkeys(
            item.resolution.resolved_id
            for item in entity_matches
            if item.resolution.status == "resolved" and item.resolution.resolved_id is not None
        )
    )
    # Timeline moments deliberately stay on their existing exact ID/title path.  They
    # are not world entities and therefore never enter the entity resolver.
    folded = question.casefold()
    explicit_moment_ids = [
        str(item["id"])
        for item in moments
        if item.get("id")
        and (
            re.search(rf"(?<!\w){re.escape(str(item['id']))}(?!\w)", question, re.IGNORECASE)
            or bool(str(item.get("title") or "").strip())
            and str(item.get("title") or "").casefold() in folded
        )
    ]
    explicit_ids = list(dict.fromkeys([*explicit_entity_ids, *explicit_moment_ids]))
    explicit = [by_id[item] for item in explicit_ids if item in by_id]
    # Multiple fully named objects (for example both endpoints of a relationship)
    # make accompanying pronouns descriptive, not an unresolved follow-up reference.
    if len(explicit) >= 2:
        return None
    refs: list[str] = []
    for message in reversed(history or []):
        for ref in reversed(message.get("references") or []):
            plain = (
                str(ref).split(":", 1)[-1]
                if str(ref).startswith(("element:", "timeline:"))
                else str(ref)
            )
            if str(ref).startswith("timeline:") or plain in moment_ids:
                resolved = plain if plain in moment_ids else None
            else:
                resolved = resolved_entity_id(figures, plain)
            if resolved in by_id and resolved not in refs:
                refs.append(resolved)
        if refs:
            break
    candidates = [by_id[ref] for ref in refs]
    if not candidates:
        candidates = explicit
    if len(candidates) == 1:
        return {"resolvedId": str(candidates[0]["id"])}
    if len(candidates) > 1:
        # The "which one do you mean?" wrapper text is UI copy, not backend-owned data --
        # AssistantRuntime.complete() attaches messageKey="whichElementDoYouMean" for the
        # frontend to resolve via locales/{de,en}/assistant.ts.
        return {
            "clarification": {
                "candidates": [
                    {
                        "id": str(item["id"]),
                        "name": str(item.get("name") or item.get("title") or item["id"]),
                        "kind": str(
                            item.get("type") or ("moment" if "title" in item else "element")
                        ),
                    }
                    for item in candidates[:8]
                ]
            }
        }
    return None
