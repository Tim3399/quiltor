"""Stateful lifecycle adapter and orchestrator for the local assistant model."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quiltor.modules.assistant.batch import run_batches
from quiltor.modules.assistant.completion import complete_request
from quiltor.modules.assistant.config import RUNTIME_CONFIG
from quiltor.modules.assistant.planner import plan
from quiltor.modules.assistant.ports import (
    AssistantProgressStore,
    AssistantReadToolExecutor,
    IncompleteInferenceResponse,
    InferenceEngine,
    InferenceValidationError,
    TokenCountCache,
)
from quiltor.modules.assistant.prompts import DEFAULT_ASSISTANT_LANGUAGE, MODEL_CONTEXT_TOKENS
from quiltor.modules.assistant.proposals import forced_proposal
from quiltor.modules.assistant.schema_check import check as check_schema


class AssistantRuntime:
    """Own model lifecycle and wire pure assistant policies to runtime ports."""

    # Set per request by completion.complete_request; declared for CompletionRuntime.
    _invocation_metrics: list[dict[str, Any]]

    def __init__(
        self,
        base: Path,
        data: Path,
        inference: InferenceEngine,
        *,
        progress: AssistantProgressStore,
        read_tools: AssistantReadToolExecutor,
        token_cache: TokenCountCache,
        debug_enabled: bool = False,
    ):
        self.base, self.data = base, data
        self.inference = inference
        self.url = inference.identity
        self.progress = progress
        self.read_tools = read_tools
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
                raise InferenceValidationError(
                    "The local model did not return a valid structured response."
                ) from None
            grown = {**payload, "max_tokens": min(headroom, payload["max_tokens"] * 2)}
            try:
                return self._invoke(grown)
            except IncompleteInferenceResponse as exc:
                raise InferenceValidationError(
                    "The local model did not return a valid structured response."
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
        mode: str = "chat",
        *,
        storyboards: dict[str, Any] | None = None,
        owner_sub: str = "",
        world_id: str = "",
        world_revision: int = 0,
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
            mode,
            storyboards=storyboards,
            owner_sub=owner_sub,
            world_id=world_id,
            world_revision=world_revision,
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
        world_revision: int = 0,
        chapter_ids: list[str] | None = None,
        mode: str = "chat",
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
            world_revision,
            chapter_ids=chapter_ids,
            mode=mode,
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
        # Every engine is checked against the original schema: the json_object fallback
        # works on a copy, so the payload here still carries it. The full schema is the
        # check_schema json_schema_format attached; the wire form lacks lengths and
        # uniqueness, so it is only the fallback for a format built by hand.
        response_format = payload.get("response_format") or {}
        schema = getattr(response_format, "check_schema", None)
        if schema is None:
            schema = (response_format.get("json_schema") or {}).get("schema")
        if isinstance(schema, dict):
            violations = check_schema(result, schema)
            if violations:
                raise InferenceValidationError(f"schema: {violations[0]}")
        return result

    def close(self) -> None:
        self.inference.close()
