"""Stateful lifecycle adapter and orchestrator for the local assistant model."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quiltor.modules.assistant.batch import run_batches
from quiltor.modules.assistant.completion import complete_request
from quiltor.modules.assistant.config import RUNTIME_CONFIG
from quiltor.modules.assistant.conversation import (
    CONVERSATION_HISTORY_TOKEN_BUDGET,
    conversation_messages,
)
from quiltor.modules.assistant.planner import needs_planner, plan
from quiltor.modules.assistant.ports import (
    AssistantProgressStore,
    IncompleteInferenceResponse,
    InferenceEngine,
    TokenCountCache,
)
from quiltor.modules.assistant.prompts import (
    ASSISTANT_REPLY_LANGUAGES,
    CONTEXT_SAFETY_MARGIN,
    DEFAULT_ASSISTANT_LANGUAGE,
    MODEL_CONTEXT_TOKENS,
    MUTATION_REQUEST,
    PROSE_REQUEST,
    SYSTEM_PROMPT,
    SYSTEM_PROMPT_TEMPLATE,
    UNTITLED_CHAPTER,
    system_prompt,
)
from quiltor.modules.assistant.proposals import (
    forced_proposal,
)


class AssistantRuntime:
    """Own model lifecycle and wire pure assistant policies to runtime ports."""

    def __init__(
        self,
        base: Path,
        data: Path,
        inference: InferenceEngine,
        *,
        progress: AssistantProgressStore,
        token_cache: TokenCountCache,
        debug_enabled: bool = False,
    ):
        self.base, self.data = base, data
        self.inference = inference
        self.url = inference.identity
        self.progress = progress
        self.token_cache = token_cache
        self.debug_enabled = debug_enabled

    def reload(self) -> None:
        """Retry a runtime installed after application startup."""
        self.inference.reload()

    def status(self) -> dict[str, Any]:
        return {**self.inference.status(), "contextTokens": MODEL_CONTEXT_TOKENS}

    def _invoke_with_growth(self, payload: dict[str, Any], prompt_tokens: int) -> dict[str, Any]:
        """Retry only truncated structured responses with bounded output headroom."""
        try:
            return self._invoke(payload)
        except IncompleteInferenceResponse:
            headroom = MODEL_CONTEXT_TOKENS - prompt_tokens - RUNTIME_CONFIG.template_reserve
            if headroom <= payload["max_tokens"]:
                raise RuntimeError(
                    "Das lokale Modell hat keine gültige strukturierte Antwort geliefert."
                ) from None
            grown = {**payload, "max_tokens": min(headroom, payload["max_tokens"] * 2)}
            try:
                return self._invoke(grown)
            except IncompleteInferenceResponse as exc:
                raise RuntimeError(
                    "Das lokale Modell hat keine gültige strukturierte Antwort geliefert."
                ) from exc

    def complete(
        self,
        question: str,
        manuscript: dict[str, Any],
        figures: dict[str, Any],
        history: list[dict[str, Any]] | None = None,
        chapter_ids: list[str] | None = None,
        run_batches: bool = False,
        progress_id: str | None = None,
        language: str = DEFAULT_ASSISTANT_LANGUAGE,
        *,
        owner_sub: str = "",
        world_id: str = "",
    ) -> dict[str, Any]:
        return complete_request(
            self,
            question,
            manuscript,
            figures,
            history,
            chapter_ids,
            run_batches,
            progress_id,
            language,
            owner_sub=owner_sub,
            world_id=world_id,
        )

    def _run_batches(
        self,
        question: str,
        manuscript: dict[str, Any],
        figures: dict[str, Any],
        history: list[dict[str, Any]] | None,
        progress_id: str | None,
        language: str = DEFAULT_ASSISTANT_LANGUAGE,
        owner_sub: str = "",
        world_id: str = "",
    ) -> dict[str, Any]:
        return run_batches(
            question,
            manuscript,
            figures,
            history,
            progress_id,
            language,
            owner_sub,
            world_id,
            complete=self.complete,
            progress=self.progress,
            identity=self.url,
            count_tokens=self.inference.count_tokens,
        )

    def _plan(self, question: str, context: list[Any]) -> dict[str, Any]:
        return plan(question, context, self._invoke)

    def _forced_proposal(
        self, question: str, context_json: str, figures: dict[str, Any]
    ) -> dict[str, Any] | None:
        return forced_proposal(question, context_json, figures)

    def _invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.inference.invoke(payload)
        metadata = result.pop("_runtime", {})
        if isinstance(metadata, dict):
            getattr(self, "_invocation_metrics", []).append(metadata)
        return result

    def close(self) -> None:
        self.inference.close()
