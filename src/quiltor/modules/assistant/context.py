"""Token-based context packing with bounded hash-keyed token counts."""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Callable

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
    count = lambda text: cache.count(url, text, lambda value: counter(url, value))
    kept: list[KnowledgeChunk] = []
    used = 0
    for chunk in chunks:
        tokens = count(chunk.text)
        remaining = budget - used
        if tokens <= remaining:
            kept.append(chunk)
            used += tokens
        elif remaining > 0:
            excerpt = _truncate(chunk.text, remaining, count)
            if excerpt:
                kept.append(replace(chunk, text=excerpt))
                used += count(excerpt)
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
