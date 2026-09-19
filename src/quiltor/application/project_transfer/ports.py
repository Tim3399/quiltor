from __future__ import annotations

from typing import Protocol

from quiltor.application.project_transfer.types import ProjectTransferPreview
from quiltor.application.worlds import WorldSummary


class ProjectTransferRepository(Protocol):
    def export(self, world_id: str, owner_sub: str) -> tuple[str, bytes]: ...
    def preview(self, archive: bytes) -> ProjectTransferPreview: ...
    def import_archive(self, archive: bytes, owner_sub: str) -> WorldSummary: ...


__all__ = ["ProjectTransferRepository"]
