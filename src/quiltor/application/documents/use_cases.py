"""Document editing use cases."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quiltor.application.backups.ports import BackupRepository
from quiltor.application.documents.ports import DocumentKind, DocumentRepository
from quiltor.application.documents.types import DocumentLocation, VersionedDocument
from quiltor.application.errors import InvalidApplicationInput
from quiltor.application.telemetry import UseCaseObserver
from quiltor.domain.story_world.validation import valid_figures, valid_manuscript


class InvalidDocumentState(InvalidApplicationInput):
    code = "document.invalid_state"


class DocumentUseCases:
    def __init__(
        self,
        documents: DocumentRepository,
        local_backups: BackupRepository,
        observer: UseCaseObserver,
    ) -> None:
        self._documents = documents
        self._local_backups = local_backups
        self._observer = observer

    def load(self, kind: DocumentKind, database: Path) -> VersionedDocument:
        with self._observer.observe("persistence", f"load_{kind}"):
            return VersionedDocument(
                self._documents.load(kind, database),
                self._documents.revision(kind, database),
            )

    def load_pair(self, database: Path) -> tuple[dict[str, Any], dict[str, Any]]:
        return (
            self._documents.load("manuscript", database),
            self._documents.load("figures", database),
        )

    def save(
        self,
        kind: DocumentKind,
        state: dict[str, Any],
        expected_revision: int | None,
        location: DocumentLocation,
    ) -> int:
        with self._observer.observe("persistence", f"save_{kind}"):
            validator = valid_manuscript if kind == "manuscript" else valid_figures
            if not validator(state):
                raise InvalidDocumentState("kein gültiger Zustand")
            self._local_backups.backup_if_due(location.database, location.backups)
            revision = self._documents.save(kind, state, expected_revision, location.database)
            if kind == "manuscript":
                self._local_backups.mirror_manuscript(
                    state["chapters"], location.manuscript_mirrors
                )
            else:
                self._local_backups.mirror_story_world(state, location.story_world_mirrors)
            return revision


__all__ = ["DocumentUseCases", "InvalidDocumentState"]
