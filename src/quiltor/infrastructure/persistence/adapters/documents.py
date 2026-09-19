"""SQLite adapter for revisioned manuscript and story-world documents."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from quiltor.application.documents import DocumentKind, RevisionConflict
from quiltor.infrastructure.persistence.sqlite import (
    assistant_history,
    manuscript,
    place_map_images,
    revisions,
    story_world,
    storyboards,
)


class SQLiteDocumentRepository:
    def exists(self, database: Path) -> bool:
        return database.is_file()

    def revision_checkpoint(self, database: Path) -> dict[DocumentKind, int]:
        if not database.is_file():
            return {"manuscript": 0, "figures": 0, "storyboards": 0}
        return {
            "manuscript": revisions.revision("manuscript", db_path=database),
            "figures": revisions.revision("figures", db_path=database),
            "storyboards": revisions.revision("storyboards", db_path=database),
        }

    def load(self, kind: DocumentKind, database: Path) -> dict[str, Any]:
        if kind == "manuscript":
            return manuscript.load(database)
        if kind == "figures":
            return story_world.load(database)
        return storyboards.load(database)

    def revision(self, kind: DocumentKind, database: Path) -> int:
        return revisions.revision(kind, db_path=database)

    def image_digests(self, database: Path) -> list[str]:
        digests: list[str] = []
        for image in place_map_images.catalog(database):
            content = place_map_images.content(image.id, database)
            if content is None or hashlib.sha256(content.data).hexdigest() != image.id:
                raise ValueError("Stored map image failed content verification.")
            digests.append(image.id)
        return sorted(digests)

    def save(
        self,
        kind: DocumentKind,
        state: dict[str, Any],
        expected_revision: int | None,
        database: Path,
    ) -> int:
        try:
            return revisions.save_with_revision(kind, state, expected_revision, db_path=database)
        except revisions.ConflictError as exc:
            raise RevisionConflict(kind, exc.expected, exc.actual, str(exc)) from exc

    def log_assistant_interaction(
        self,
        question: str,
        response: dict[str, Any] | None,
        error: str,
        database: Path | None,
    ) -> str:
        return assistant_history.log_interaction(question, response, error=error, db_path=database)

    def list_assistant_interactions(self, database: Path, limit: int = 50) -> list[dict[str, Any]]:
        return assistant_history.list_interactions(limit=limit, db_path=database)


__all__ = ["SQLiteDocumentRepository"]
