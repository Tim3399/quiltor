"""Optimistic document revisions and restore invalidation."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from quiltor.domain.manuscript import StoryTimeAnchorIssue, story_time_anchor_issue
from quiltor.infrastructure.persistence.sqlite import manuscript, story_world, storyboards
from quiltor.infrastructure.persistence.sqlite.connection import connect, connection


class ConflictError(RuntimeError):
    def __init__(self, expected: int, actual: int) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(f"The document revision has changed ({expected} → {actual}).")


class StoryTimeConflictError(RuntimeError):
    def __init__(self, document: str, issue: StoryTimeAnchorIssue) -> None:
        self.document = document
        self.issue = issue
        super().__init__(f"The {document} document conflicts with the story timeline.")


def revision(
    kind: str,
    conn: sqlite3.Connection | None = None,
    db_path: Path | None = None,
) -> int:
    own = conn is None
    database = conn or connect(db_path)
    try:
        row = database.execute(
            "SELECT value FROM meta WHERE key=?", (f"{kind}_revision",)
        ).fetchone()
        return int(row[0]) if row else 0
    finally:
        if own:
            database.close()


def save_with_revision(
    kind: str,
    state: dict[str, Any],
    expected: int | None,
    db_path: Path | None = None,
) -> int:
    with connection(db_path) as database:
        database.execute("BEGIN IMMEDIATE")
        current = revision(kind, database)
        if expected is not None and expected != current:
            raise ConflictError(expected, current)
        if kind in {"manuscript", "figures"}:
            counterpart = (
                story_world.load(conn=database)
                if kind == "manuscript"
                else manuscript.load(conn=database)
            )
            issue = story_time_anchor_issue(
                state if kind == "manuscript" else counterpart,
                counterpart if kind == "manuscript" else state,
            )
            if issue is not None:
                raise StoryTimeConflictError(kind, issue)
        if kind == "manuscript":
            manuscript.save(state, database)
        elif kind == "figures":
            story_world.save(state, database)
        elif kind == "storyboards":
            storyboards.save(state, database)
        else:
            raise ValueError("Unknown document type")
        updated = current + 1
        database.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
            (f"{kind}_revision", str(updated)),
        )
        return updated


def advance_restore_revisions(
    previous_revisions: dict[str, int],
    *,
    db_path: Path | None = None,
) -> dict[str, int]:
    """Invalidate every ETag that could have existed before or in a backup."""

    updated: dict[str, int] = {}
    with connection(db_path) as destination:
        destination.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('last_restore_at',?)",
            (datetime.now(UTC).isoformat(),),
        )
        for kind in ("manuscript", "figures", "storyboards"):
            before = previous_revisions.get(kind, 0)
            if type(before) is not int or before < 0:
                raise ValueError("Invalid restore revision checkpoint.")
            value = max(before, revision(kind, destination)) + 1
            destination.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
                (f"{kind}_revision", str(value)),
            )
            updated[kind] = value
    return updated


__all__ = [
    "ConflictError",
    "StoryTimeConflictError",
    "advance_restore_revisions",
    "revision",
    "save_with_revision",
]
