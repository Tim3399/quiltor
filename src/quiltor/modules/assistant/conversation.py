"""Conversation retention and exact-token context budgeting."""

from __future__ import annotations

from typing import Any, Callable

from quiltor.modules.assistant.config import RUNTIME_CONFIG
from quiltor.modules.assistant.context import pack_chunks
from quiltor.modules.assistant.ports import TokenCountCache

CONVERSATION_HISTORY_TOKEN_BUDGET = RUNTIME_CONFIG.history_tokens


def conversation_messages(
    history: list[dict[str, Any]] | None,
    identity: str,
    count_tokens: Callable[[str], int],
    token_cache: TokenCountCache,
) -> list[dict[str, str]]:
    """Keep recent history, oldest-first, within the model's exact token budget."""
    candidates = []
    for item in history or []:
        role, content = item.get("role"), str(item.get("content", ""))[:8000]
        if role in {"user", "assistant"} and content:
            candidates.append({"role": role, "content": content})
    result: list[dict[str, str]] = []
    budget = CONVERSATION_HISTORY_TOKEN_BUDGET
    for message in reversed(candidates):
        tokens = token_cache.count(identity, message["content"], count_tokens)
        if tokens > budget:
            break
        budget -= tokens
        result.append(message)
    result.reverse()
    return result


def fit_to_budget(
    chunks: list[Any],
    identity: str,
    budget: int,
    trace: list[dict[str, Any]],
    count_tokens: Callable[[str], int],
    token_cache: TokenCountCache,
) -> list[Any]:
    """Keep forced chapter chunks in order while respecting an exact token budget."""
    kept = pack_chunks(
        chunks,
        identity,
        budget,
        lambda _identity, text: count_tokens(text),
        token_cache,
        trace,
    )
    if len(kept) < len(chunks):
        trace.append(
            {
                "step": "context_budget",
                "truncatedForced": True,
                "keptChunks": len(kept),
                "droppedChunks": len(chunks) - len(kept),
            }
        )
    return kept


# Compatibility for the previously module-private runtime helper.
