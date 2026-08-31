"""Document editing use cases."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quiltor.application.backups.ports import BackupRepository
from quiltor.application.documents.ports import DocumentKind, DocumentRepository
from quiltor.application.documents.types import DocumentLocation, VersionedDocument
from quiltor.application.errors import InvalidApplicationInput
from quiltor.application.telemetry import UseCaseObserver
from quiltor.domain.manuscript import flatten_tree, story_time_anchor_issue, structure_or_flat
from quiltor.domain.storyboard.validation import valid_storyboards
from quiltor.domain.story_world.validation import valid_figures, valid_manuscript


class InvalidDocumentState(InvalidApplicationInput):
    code = "document.invalid_state"


class InvalidChapterStoryTime(InvalidDocumentState):
    """A chapter anchor is malformed or conflicts with the canonical timeline."""

    code = "manuscript.story_time_invalid"


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
            validators = {
                "manuscript": valid_manuscript,
                "figures": valid_figures,
                "storyboards": valid_storyboards,
            }
            validator = validators[kind]
            if not validator(state):
                raise InvalidDocumentState("kein gültiger Zustand")
            if kind != "storyboards":
                counterpart = self._documents.load(
                    "figures" if kind == "manuscript" else "manuscript",
                    location.database,
                )
                issue = story_time_anchor_issue(
                    state if kind == "manuscript" else counterpart,
                    counterpart if kind == "manuscript" else state,
                )
                if issue is not None:
                    params = {"document": kind, "reason": issue.reason}
                    if issue.chapter_id:
                        params["chapterId"] = issue.chapter_id
                    if issue.moment_id:
                        params["momentId"] = issue.moment_id
                    raise InvalidChapterStoryTime(
                        "invalid chapter story-time reference",
                        params=params,
                    )
            self._local_backups.backup_if_due(location.database, location.backups)
            revision = self._documents.save(kind, state, expected_revision, location.database)
            if kind == "manuscript":
                chapters_by_id = {chapter["id"]: chapter for chapter in state["chapters"]}
                structure = structure_or_flat(chapters_by_id, state.get("structure"))
                ordered_chapters = [
                    chapters_by_id[chapter_id]
                    for chapter_id in flatten_tree(chapters_by_id, structure)
                ]
                self._local_backups.mirror_manuscript(ordered_chapters, location.manuscript_mirrors)
            elif kind == "figures":
                self._local_backups.mirror_story_world(state, location.story_world_mirrors)
            return revision


__all__ = ["DocumentUseCases", "InvalidChapterStoryTime", "InvalidDocumentState"]
