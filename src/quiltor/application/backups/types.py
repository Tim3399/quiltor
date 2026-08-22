"""Values crossing backup application boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WorldBackupContext:
    root: Path
    database: Path
    manuscripts: Path
    profiles: Path
    endpoint_url: str = ""
    title: str = ""


@dataclass(frozen=True)
class BackupAuthorization:
    """A bearer capability bound to one configured endpoint identity."""

    endpoint: str
    bearer_token: str = ""


__all__ = ["BackupAuthorization", "WorldBackupContext"]
