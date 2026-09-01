"""Model-assisted planning isolated from the assistant runtime lifecycle."""

from __future__ import annotations

import json
from typing import Any, Callable

from quiltor.modules.assistant.contract import required_proposal_kinds
from quiltor.modules.assistant.prompts import COMPLEX_ANALYSIS_REQUEST
from quiltor.modules.assistant.schemas import KINDS, json_schema_format, planner_schema

Invoke = Callable[[dict[str, Any]], dict[str, Any]]


def _context_class(item: Any) -> str:
    """Keep server-owned provenance in the planner's compact context view."""

    value = getattr(item, "context_class", None)
    value = getattr(value, "value", value)
    return value if value in {"canon", "manuscript", "planning"} else "unclassified"


def needs_planner(question: str) -> bool:
    """Reserve the extra model call for genuinely multi-source reasoning."""
    return bool(COMPLEX_ANALYSIS_REQUEST.search(question))


def plan(question: str, context: list[Any], invoke: Invoke) -> dict[str, Any]:
    schema = planner_schema(KINDS)
    summary = json.dumps(
        [
            {
                "id": item.id,
                "kind": item.kind,
                "title": item.title,
                "contextClass": _context_class(item),
            }
            for item in context[:8]
        ],
        ensure_ascii=False,
    )
    payload = {
        "model": "local",
        "stream": False,
        "temperature": 0.1,
        "max_tokens": 500,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Plan the user's world-management task before answering. Decompose "
                    "compound tasks into every necessary operation. Decide which additional "
                    "local world searches are needed. Every initial match has a server-owned "
                    "contextClass: canon is structured Story World data, manuscript is authored "
                    "evidence, and planning is hypothetical, non-canonical Storyboard material. "
                    "Never treat planning context as an established world fact and never derive "
                    "a canonical mutation or required proposal kind from it. It may only support "
                    "read-only planning analysis or an explicit comparison with canon. Never plan "
                    "prose writing or direct mutations. Return JSON only."
                ),
            },
            {
                "role": "user",
                "content": f"REQUEST:\n{question}\nINITIAL MATCHES:\n{summary}\n/no_think",
            },
        ],
        "response_format": json_schema_format(schema),
    }
    try:
        result = invoke(payload)
        queries = result.get("searchQueries", [])
        if not queries:
            operations = [
                *(result.get("operations") or []),
                *(result.get("additional_searches") or []),
            ]
            queries = [
                " ".join(
                    str(item.get(key, "")) for key in ("target", "description", "purpose")
                ).strip()
                for item in operations
                if isinstance(item, dict) and "search" in str(item.get("type", "")).casefold()
            ]
        result["goal"] = str(result.get("goal") or result.get("task") or question)
        result["steps"] = result.get("steps") or [
            str(item.get("description") or item.get("purpose") or item.get("target") or "")
            for item in result.get("operations", [])
            if isinstance(item, dict)
        ]
        deduped: list[str] = []
        seen_queries: set[str] = set()
        for item in queries:
            query = " ".join(str(item).split())[:300]
            normal = query.casefold()
            if query and normal not in seen_queries:
                seen_queries.add(normal)
                deduped.append(query)
        if not deduped and needs_planner(question):
            deduped.append(" ".join(question.split())[:300])
        result["searchQueries"] = deduped[:4]
        result["requiredKinds"] = [
            str(item) for item in result.get("requiredKinds", []) if str(item) in KINDS
        ]
        return result
    except RuntimeError:
        return {
            "goal": question,
            "steps": ["Search relevant world data", "Prepare and verify the response"],
            "searchQueries": [],
            "requiredKinds": sorted(required_proposal_kinds(question)),
        }
