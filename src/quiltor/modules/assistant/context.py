"""Token-based context packing with bounded hash-keyed token counts."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from quiltor.domain.story_world.knowledge import KnowledgeChunk
from quiltor.modules.assistant.ports import TokenCountCache


def _truncate(text: str, budget: int, count: Callable[[str], int]) -> str:
    if budget <= 0:
        return ""
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if count(text[:middle]) <= budget:
            low = middle
        else:
            high = middle - 1
    return text[:low].rstrip()


def pack_chunks(
    chunks: list[KnowledgeChunk],
    url: str,
    budget: int,
    counter: Callable[[str, str], int],
    cache: TokenCountCache,
    trace: list[dict[str, Any]] | None = None,
) -> list[KnowledgeChunk]:
    """Pack in priority order; include a useful excerpt when one chunk is oversized."""

    def count(text):
        return cache.count(url, text, lambda value: counter(url, value))

    # The budget is the budget of the serialized block the prompt carries (T-307, F-307-2):
    # every chunk goes in as its public JSON plus the list separator, half as long again as its
    # text. Serialized exactly as completion.py does: json.dumps of the list.
    def serialized(chunk: KnowledgeChunk) -> str:
        return json.dumps(chunk.public(), ensure_ascii=False) + ", "

    kept: list[KnowledgeChunk] = []
    used = 0
    for chunk in chunks:
        tokens = count(serialized(chunk))
        remaining = budget - used
        if tokens <= remaining:
            kept.append(chunk)
            used += tokens
        elif remaining > 0:
            overhead = count(serialized(replace(chunk, text="")))
            excerpt = _truncate(chunk.text, remaining - overhead, count)
            if excerpt:
                shortened = replace(chunk, text=excerpt)
                kept.append(shortened)
                used += count(serialized(shortened))
            break
        else:
            break
    if trace is not None:
        trace.append(
            {
                "step": "context_pack",
                "budget": budget,
                "used": used,
                "sources": [item.id for item in kept],
            }
        )
    return kept
