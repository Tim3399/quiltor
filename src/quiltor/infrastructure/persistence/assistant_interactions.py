"""Assistant interaction-log adapters backed by the assistant application slice."""

from __future__ import annotations

import threading
from typing import Any

from quiltor.application.assistant import AssistantAuditUseCases


class LockedAssistantInteractionLogger:
    def __init__(self, assistant: AssistantAuditUseCases, lock: threading.Lock) -> None:
        self._assistant = assistant
        self._lock = lock

    def record(
        self,
        question: str,
        response: dict[str, Any] | None = None,
        *,
        error: str = "",
        owner_sub: str,
        world_id: str,
    ) -> str:
        with self._lock:
            return self._assistant.record(owner_sub, world_id, question, response, error=error)


class ApplicationAssistantWorldAccess:
    def __init__(self, assistant: AssistantAuditUseCases) -> None:
        self._assistant = assistant

    def exists(self, owner_sub: str, world_id: str) -> bool:
        return self._assistant.world_exists(owner_sub, world_id)

    def revision(self, owner_sub: str, world_id: str) -> int:
        return self._assistant.world_revision(owner_sub, world_id)

    def revisions(self, owner_sub: str, world_id: str) -> dict[str, int]:
        return self._assistant.world_revisions(owner_sub, world_id)


__all__ = ["ApplicationAssistantWorldAccess", "LockedAssistantInteractionLogger"]
