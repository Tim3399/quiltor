"""Deterministic resolution of conversational world-object references."""

from __future__ import annotations

import re
from typing import Any

AMBIGUOUS_REFERENCE = re.compile(
    r"\b(er|sie|es|ihn|ihm|ihr|seine|seiner|deren|dies(?:e|er|es)|dort|he|she|it|his|her|there)\b",
    re.I,
)


def resolve_reference(
    question: str, history: list[dict[str, Any]] | None, figures: dict[str, Any]
) -> dict[str, Any] | None:
    if not AMBIGUOUS_REFERENCE.search(question):
        return None
    objects = [*figures.get("nodes", []), *figures.get("timeline", [])]
    by_id = {str(item.get("id")): item for item in objects if item.get("id")}
    explicit = [
        item
        for item in objects
        if str(item.get("name") or item.get("title") or "").casefold() in question.casefold()
    ]
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
            if plain in by_id and plain not in refs:
                refs.append(plain)
        if refs:
            break
    candidates = [by_id[ref] for ref in refs]
    if not candidates:
        folded = question.casefold()
        candidates = explicit or [
            item
            for item in objects
            if str(item.get("name") or item.get("title") or "").casefold() in folded
        ]
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
