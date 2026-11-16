"""Values crossing the world catalogue boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import NotRequired, TypedDict

from quiltor.application.documents.types import DocumentLocation


class PublicWorld(TypedDict):
    """A world in the catalogue, as the wire carries it."""

    id: str
    title: str
    backupUrl: str
    updated: str
    deletedAt: NotRequired[str]
    origin: NotRequired[str]
    preview: NotRequired[bool]


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

    def public(self) -> PublicWorld:
        result: PublicWorld = {
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


__all__ = ["OpenedWorld", "PublicWorld", "WorldPaths", "WorldSummary"]
