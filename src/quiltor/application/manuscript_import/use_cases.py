from __future__ import annotations

from typing import Any

from quiltor.application.manuscript_import.types import ManuscriptImportRepository
from quiltor.application.telemetry import UseCaseObserver


class ManuscriptImportUseCases:
    def __init__(self, repository: ManuscriptImportRepository, observer: UseCaseObserver) -> None:
        self._repository = repository
        self._observer = observer

    def preview(self, file_name: str, content: bytes, selection: Any = None) -> dict:
        with self._observer.observe("persistence", "preview_manuscript_import"):
            return self._repository.preview(file_name, content, selection)

    def publish(
        self,
        file_name: str,
        content: bytes,
        source_sha256: str,
        title: str,
        chapters: Any,
        acknowledged_warnings: Any,
        request_id: str,
        owner_sub: str,
    ) -> dict[str, str]:
        with self._observer.observe("persistence", "import_manuscript"):
            return self._repository.publish(
                file_name,
                content,
                source_sha256,
                title,
                chapters,
                acknowledged_warnings,
                request_id,
                owner_sub,
            )

    def preview_v2(self, file_name: str, content: bytes, selection: Any = None) -> dict:
        with self._observer.observe("persistence", "preview_manuscript_import_v2"):
            return self._repository.preview_v2(file_name, content, selection)

    def publish_v2(
        self,
        file_name: str,
        content: bytes,
        source_sha256: str,
        title: str,
        chapters: Any,
        acknowledged_warnings: Any,
        request_id: str,
        owner_sub: str,
    ) -> dict[str, str]:
        with self._observer.observe("persistence", "import_manuscript_v2"):
            return self._repository.publish_v2(
                file_name,
                content,
                source_sha256,
                title,
                chapters,
                acknowledged_warnings,
                request_id,
                owner_sub,
            )


__all__ = ["ManuscriptImportUseCases"]
