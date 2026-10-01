from __future__ import annotations

from quiltor.application.project_transfer.ports import ProjectTransferRepository
from quiltor.application.telemetry import UseCaseObserver


class ProjectTransferUseCases:
    def __init__(self, repository: ProjectTransferRepository, observer: UseCaseObserver) -> None:
        self._repository = repository
        self._observer = observer

    def export(self, world_id: str, owner_sub: str) -> tuple[str, bytes]:
        with self._observer.observe("persistence", "export_project"):
            return self._repository.export(world_id, owner_sub)

    def preview(self, archive: bytes) -> dict:
        with self._observer.observe("persistence", "preview_project_import"):
            return self._repository.preview(archive).public()

    def import_archive(self, archive: bytes, owner_sub: str) -> dict[str, str]:
        with self._observer.observe("persistence", "import_project"):
            return self._repository.import_archive(archive, owner_sub).public()


__all__ = ["ProjectTransferUseCases"]
