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

    def public(self) -> dict[str, str]:
        return {
            "id": self.id,
            "title": self.title,
            "backupUrl": self.backup_url,
            "updated": self.updated,
        }


@dataclass(frozen=True)
class WorldPaths:
    documents: DocumentLocation


@dataclass(frozen=True)
class OpenedWorld:
    summary: WorldSummary
    paths: WorldPaths


__all__ = ["OpenedWorld", "WorldPaths", "WorldSummary"]
