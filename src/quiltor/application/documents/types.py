"""Values crossing the document application boundary."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DocumentLocation:
    database: Path
    backups: Path
    manuscript_mirrors: Path
    story_world_mirrors: Path


@dataclass(frozen=True)
class VersionedDocument:
    state: dict
    revision: int


__all__ = ["DocumentLocation", "VersionedDocument"]
