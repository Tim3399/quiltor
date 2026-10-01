"""Values crossing the world catalogue boundary."""

from __future__ import annotations

from dataclasses import dataclass

from quiltor.application.documents.types import DocumentLocation


@dataclass(frozen=True)
class WorldSummary:
    id: str
    title: str
    backup_url: str
    updated: str
    deleted_at: str = ""

    def public(self) -> dict[str, str]:
        result = {
            "id": self.id,
            "title": self.title,
            "backupUrl": self.backup_url,
            "updated": self.updated,
        }
        if self.deleted_at:
            result["deletedAt"] = self.deleted_at
        return result


@dataclass(frozen=True)
class WorldPaths:
    documents: DocumentLocation


@dataclass(frozen=True)
class OpenedWorld:
    summary: WorldSummary
    paths: WorldPaths


__all__ = ["OpenedWorld", "WorldPaths", "WorldSummary"]
