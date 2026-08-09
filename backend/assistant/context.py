"""Token-based context packing with bounded hash-keyed token counts."""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import replace
from typing import Any, Callable

from backend.knowledge import KnowledgeChunk


class TokenCountCache:
    def __init__(self, max_bytes: int = 4 * 1024 * 1024):
        self.max_bytes, self.bytes = max_bytes, 0
        self.values: OrderedDict[str, tuple[int, int]] = OrderedDict()
        self.identity = ""

    def count(self, identity: str, text: str, counter: Callable[[str], int]) -> int:
        if identity != self.identity:
            self.values.clear(); self.bytes = 0; self.identity = identity
        digest = hashlib.sha256(text.encode()).hexdigest()
        if digest in self.values:
            value = self.values.pop(digest); self.values[digest] = value
            return value[0]
        tokens, size = counter(text), len(text.encode()) + 96
        self.values[digest] = (tokens, size); self.bytes += size
        while self.bytes > self.max_bytes and self.values:
            _, (_, removed) = self.values.popitem(last=False); self.bytes -= removed
        return tokens


TOKEN_CACHE = TokenCountCache()


def _truncate(text: str, budget: int, count: Callable[[str], int]) -> str:
    if budget <= 0:
        return ""
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if count(text[:middle]) <= budget: low = middle
        else: high = middle - 1
    return text[:low].rstrip()


def pack_chunks(chunks: list[KnowledgeChunk], url: str, budget: int, counter: Callable[[str, str], int], trace: list[dict[str, Any]] | None = None) -> list[KnowledgeChunk]:
    """Pack in priority order; include a useful excerpt when one chunk is oversized."""
    count = lambda text: TOKEN_CACHE.count(url, text, lambda value: counter(url, value))
    kept: list[KnowledgeChunk] = []
    used = 0
    for chunk in chunks:
        tokens = count(chunk.text)
        remaining = budget - used
        if tokens <= remaining:
            kept.append(chunk); used += tokens
        elif remaining > 0:
            excerpt = _truncate(chunk.text, remaining, count)
            if excerpt:
                kept.append(replace(chunk, text=excerpt)); used += count(excerpt)
            break
        else:
            break
    if trace is not None:
        trace.append({"step": "context_pack", "budget": budget, "used": used, "sources": [item.id for item in kept]})
    return kept
