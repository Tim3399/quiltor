"""Local OpenAI-compatible inference adapter for the assistant port."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from quiltor.application.capabilities import Feature, FeatureAvailability
from quiltor.infrastructure.inference import select
from quiltor.infrastructure.inference.shared.contract import (
    check_health,
    count_tokens,
    invoke_chat,
)
from quiltor.modules.assistant.ports import InferenceUnavailableError


class LocalInferenceEngine:
    def __init__(self, base: Path, data: Path, capabilities: FeatureAvailability) -> None:
        self.base = base
        self.data = data
        self.capabilities = capabilities
        self.url = os.environ.get("QUILTOR_AI_URL", "http://127.0.0.1:11435").rstrip("/")
        self.process: subprocess.Popen[str] | None = None
        self.log_path: Path | None = None
        self.reload()

    @property
    def identity(self) -> str:
        return self.url

    def reload(self) -> None:
        if not self.capabilities.is_available(Feature.LOCAL_INFERENCE):
            return
        if self.process is not None and self.process.poll() is None:
            return
        started = select.start_runtime(self.base, self.data, self.url)
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
        if check_health(self.url):
            backend = "mlx" if self.log_path and "mlx" in self.log_path.name else "llama.cpp"
            return {
                "available": True,
                "mode": "local",
                "reason": "",
                "backend": backend,
                "model": os.environ.get("QUILTOR_AI_MODEL", "bundled"),
            }
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
        return invoke_chat(self.url, payload, include_metadata=True)

    def count_tokens(self, text: str) -> int:
        if not self.capabilities.is_available(Feature.LOCAL_INFERENCE):
            raise InferenceUnavailableError("Local inference is unavailable for this build.")
        return count_tokens(self.url, text)

    def close(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()


__all__ = ["LocalInferenceEngine"]
