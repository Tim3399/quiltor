"""Which engine computes an assistant job (T-61).

The server engine is the operator's model and needs the premium role. A client engine is
the user's own: a model in the browser (WebLLM) or a provider called with the user's key.
The server builds the prompt and checks the answer in both cases (D-37); only who
computes differs. The values are a closed list: anything else is refused before the job
is stored, so a job can never sit in the queue under a kind no worker claims.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SERVER = "server"
WEBLLM = "webllm"
CLOUD = "cloud"
ENGINE_KINDS = frozenset({SERVER, WEBLLM, CLOUD})
CLIENT_ENGINE_KINDS = frozenset({WEBLLM, CLOUD})
CLOUD_PROVIDERS = frozenset({"openai", "openrouter", "anthropic"})


class InvalidEngine(ValueError):
    """The request named an engine outside the closed list."""


@dataclass(frozen=True, slots=True)
class EngineChoice:
    kind: str
    provider: str | None = None
    grammar: bool = False

    @property
    def is_client(self) -> bool:
        return self.kind in CLIENT_ENGINE_KINDS

    def public(self) -> dict[str, Any]:
        value: dict[str, Any] = {"kind": self.kind, "grammar": self.grammar}
        if self.provider is not None:
            value["provider"] = self.provider
        return value


def parse_engine(payload: dict[str, Any]) -> EngineChoice:
    """The engine a job request names. A request without the field means the server.

    Only the absent key defaults; `null`, a string, a list or a number is refused, so a
    malformed request never falls back to the paid engine by accident.
    """

    if "engine" not in payload:
        return EngineChoice(SERVER)
    value = payload["engine"]
    if not isinstance(value, dict):
        raise InvalidEngine("engine must be an object.")
    if set(value) - {"kind", "provider", "grammar"}:
        raise InvalidEngine("engine has unknown fields.")
    kind = value.get("kind")
    if not isinstance(kind, str) or kind not in ENGINE_KINDS:
        raise InvalidEngine("engine.kind is not supported.")
    provider = value.get("provider")
    if kind == CLOUD:
        if not isinstance(provider, str) or provider not in CLOUD_PROVIDERS:
            raise InvalidEngine("engine.provider is not supported.")
    elif "provider" in value:
        raise InvalidEngine("engine.provider is only valid for the cloud engine.")
    grammar = value.get("grammar", kind == WEBLLM)
    if not isinstance(grammar, bool):
        raise InvalidEngine("engine.grammar must be a boolean.")
    return EngineChoice(kind, provider if kind == CLOUD else None, grammar)


__all__ = [
    "CLIENT_ENGINE_KINDS",
    "CLOUD",
    "CLOUD_PROVIDERS",
    "ENGINE_KINDS",
    "SERVER",
    "WEBLLM",
    "EngineChoice",
    "InvalidEngine",
    "parse_engine",
]
