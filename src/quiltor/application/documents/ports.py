"""Ports required by document use cases."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal, Protocol

from quiltor.application.errors import ApplicationConflict

DocumentKind = Literal["manuscript", "figures", "storyboards"]


class RevisionConflict(ApplicationConflict):
    """A write was based on an older revision of the document."""

    code = "document.revision_conflict"

    def __init__(
        self,
        document: DocumentKind,
        expected: int,
        actual: int,
        message: str = "",
    ) -> None:
        super().__init__(
            message or f"Document changed between revisions {expected} and {actual}.",
            params={
                "document": document,
                "expected": expected,
                "actual": actual,
            },
        )


class DocumentRepository(Protocol):
    def load(self, kind: DocumentKind, database: Path) -> dict[str, Any]: ...

    def exists(self, database: Path) -> bool: ...

    def revision_checkpoint(self, database: Path) -> dict[DocumentKind, int]: ...

    def revision(self, kind: DocumentKind, database: Path) -> int: ...

    def save(
        self,
        kind: DocumentKind,
        state: dict[str, Any],
        expected_revision: int | None,
        database: Path,
    ) -> int: ...

    def log_assistant_interaction(
        self,
        question: str,
        response: dict[str, Any] | None,
        error: str,
        database: Path | None,
    ) -> str: ...

    def list_assistant_interactions(
        self, database: Path, limit: int = 50
    ) -> list[dict[str, Any]]: ...


__all__ = ["DocumentKind", "DocumentRepository", "RevisionConflict"]
