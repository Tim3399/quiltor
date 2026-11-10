"""Local OpenAI-compatible inference adapter for the assistant port."""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
from pathlib import Path
from typing import Any

from quiltor.application.capabilities import Feature, FeatureAvailability
from quiltor.infrastructure.inference import select
from quiltor.infrastructure.inference.endpoint import resolve_endpoint
from quiltor.infrastructure.inference.model_store import ModelsDirError
from quiltor.infrastructure.inference.shared.contract import (
    check_health,
    check_models,
    count_tokens,
    estimate_tokens,
    invoke_chat,
    json_object_fallback,
    refuses_json_schema,
)
from quiltor.modules.assistant.ports import InferenceUnavailableError


class LocalInferenceEngine:
    def __init__(self, base: Path, data: Path, capabilities: FeatureAvailability) -> None:
        self.base = base
        self.data = data
        self.capabilities = capabilities
        # Raises at start-up on an invalid configuration -- before any key leaves this process.
        self.endpoint = resolve_endpoint()
        self.url = self.endpoint.url
        self.process: subprocess.Popen[str] | None = None
        self.log_path: Path | None = None
        self.models_error: str | None = None
        # Three cases, and only the last one starts anything (T-58 P4, D-37, F-58-10):
        # - an external endpoint (QUILTOR_AI_KEY): the provider is the model, no sidecar, no key;
        # - QUILTOR_AI_URL without a key: it names a runtime that is already running, and
        #   select.start_runtime starts nothing -- there is no sidecar of ours to give a key to;
        # - no QUILTOR_AI_URL: Quiltor starts the sidecar itself, with a fresh random key held in
        #   memory only and never logged, so no local process or browser page reaches it.
        self._sidecar_key: str | None = (
            None if os.environ.get("QUILTOR_AI_URL") else secrets.token_urlsafe(32)
        )
        # A provider that cannot do strict json_schema is asked with json_object from then on;
        # set up front with QUILTOR_AI_JSON_MODE=json_object, or learnt from its first refusal.
        self._json_object_only = (
            self.endpoint.external
            and os.environ.get("QUILTOR_AI_JSON_MODE", "").strip().lower() == "json_object"
        )
        self.reload()

    @property
    def identity(self) -> str:
        return self.url

    def reload(self) -> None:
        if not self.capabilities.is_available(Feature.LOCAL_INFERENCE):
            return
        if self.endpoint.external:
            # An external provider is the model; nothing of ours is started next to it.
            return
        if self.process is not None and self.process.poll() is None:
            return
        try:
            started = select.start_runtime(self.base, self.data, self.url, self._sidecar_key)
        except ModelsDirError as exc:
            self.models_error = str(exc)
            print(f"! {exc}", file=sys.stderr, flush=True)
            self.process = None
            self.log_path = None
            return
        self.models_error = None
        self.process = started[0] if started else None
        self.log_path = started[1] if started else None

    def status(self) -> dict[str, Any]:
        availability = self.capabilities.evaluate(Feature.LOCAL_INFERENCE)
        if not availability.available:
            return {
                "available": False,
                "mode": "local",
                "reason": "; ".join(availability.reasons)
                or "Local inference is unavailable for this build.",
            }
        if self.endpoint.external:
            # Neither the URL nor the key is shown: the status reaches every signed-in browser.
            if check_models(self.url, self.endpoint.api_key):
                return {
                    "available": True,
                    "mode": "external",
                    "reason": "",
                    "backend": "openai-compatible",
                    "model": self.endpoint.model_name,
                }
            return {
                "available": False,
                "mode": "external",
                "reason": "The configured AI endpoint does not answer GET /v1/models.",
            }
        if check_health(self.url):
            backend = "mlx" if self.log_path and "mlx" in self.log_path.name else "llama.cpp"
            return {
                "available": True,
                "mode": "local",
                "reason": "",
                "backend": backend,
                "model": os.environ.get("QUILTOR_AI_MODEL", "bundled"),
            }
        if self.models_error:
            return {"available": False, "mode": "local", "reason": self.models_error}
        exit_code = self.process.poll() if self.process is not None else None
        reason = (
            f"Lokaler Modell-Prozess ist beendet (Exit-Code {exit_code}). "
            f"Details in {self.log_path}."
            if exit_code is not None
            else "Lokales Modell ist noch nicht installiert oder gestartet."
        )
        return {"available": False, "mode": "local", "reason": reason}

    def invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.capabilities.is_available(Feature.LOCAL_INFERENCE):
            raise InferenceUnavailableError("Local inference is unavailable for this build.")
        if not self.endpoint.external:
            # The local server is ours to hold to the contract: a reply without usage is refused.
            return invoke_chat(
                self.url,
                payload,
                include_metadata=True,
                api_key=self._sidecar_key,
                require_usage=True,
            )
        request = {**payload, "model": self.endpoint.model_name}
        if self._json_object_only:
            request = json_object_fallback(request)
            return invoke_chat(
                self.url, request, include_metadata=True, api_key=self.endpoint.api_key
            )
        try:
            return invoke_chat(
                self.url, request, include_metadata=True, api_key=self.endpoint.api_key
            )
        except RuntimeError as exc:
            if not refuses_json_schema(exc):
                raise
        # Exactly one retry, so a refusal never turns into a loop. The provider is remembered
        # as json_object-only only once json_object worked: a 400 that merely names
        # response_format for another reason fails the retry too and must not switch the
        # process for good (T-187). The reply is still checked against the schema upstream.
        answer = invoke_chat(
            self.url,
            json_object_fallback(request),
            include_metadata=True,
            api_key=self.endpoint.api_key,
        )
        self._json_object_only = True
        return answer

    def count_tokens(self, text: str) -> int:
        if not self.capabilities.is_available(Feature.LOCAL_INFERENCE):
            raise InferenceUnavailableError("Local inference is unavailable for this build.")
        if self.endpoint.external:
            return estimate_tokens(text)
        return count_tokens(self.url, text, api_key=self._sidecar_key)

    def close(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()


__all__ = ["LocalInferenceEngine"]
