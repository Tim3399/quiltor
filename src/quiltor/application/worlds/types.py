"""Values crossing the world catalogue boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from quiltor.application.documents.types import DocumentLocation


@dataclass(frozen=True)
class WorldSummary:
    id: str
    title: str
    backup_url: str
    updated: str
    deleted_at: str = ""
    # "example" for a world that came from the example world, for good (T-214, D-127).
    origin: str = ""
    # Still an unchanged preview of the example world: hidden from the list until a change.
    preview: bool = False

    def public(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "id": self.id,
            "title": self.title,
            "backupUrl": self.backup_url,
            "updated": self.updated,
        }
        if self.deleted_at:
            result["deletedAt"] = self.deleted_at
        if self.origin:
            result["origin"] = self.origin
        if self.preview:
            result["preview"] = True
        return result


@dataclass(frozen=True)
class WorldPaths:
    documents: DocumentLocation


@dataclass(frozen=True)
class OpenedWorld:
    summary: WorldSummary
    paths: WorldPaths


__all__ = ["OpenedWorld", "WorldPaths", "WorldSummary"]
