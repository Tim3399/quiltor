"""Assistant interaction audit and ownership-scoped world access."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quiltor.application.documents.ports import DocumentRepository
from quiltor.application.worlds.ports import WorldRepository


class AssistantAuditUseCases:
    def __init__(self, worlds: WorldRepository, documents: DocumentRepository) -> None:
        self._worlds = worlds
        self._documents = documents

    def world_exists(self, owner_sub: str, world_id: str) -> bool:
        try:
            opened = self._worlds.open(world_id, owner_sub)
        except (FileNotFoundError, PermissionError, ValueError):
            return False
        return self._documents.exists(opened.paths.documents.database)

    def record(
        self,
        owner_sub: str,
        world_id: str,
        question: str,
        response: dict[str, Any] | None = None,
        *,
        error: str = "",
    ) -> str:
        opened = self._worlds.open(world_id, owner_sub)
        return self._documents.log_assistant_interaction(
            question,
            response,
            error,
            opened.paths.documents.database,
        )

    def list(self, database: Path, limit: int = 50) -> list[dict[str, Any]]:
        return self._documents.list_assistant_interactions(database, limit)


__all__ = ["AssistantAuditUseCases"]
