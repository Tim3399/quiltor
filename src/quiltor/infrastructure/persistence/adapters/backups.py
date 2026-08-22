"""Filesystem/SQLite adapter for local safety copies and readable mirrors."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quiltor.infrastructure.persistence import mirror
from quiltor.infrastructure.persistence.sqlite import restore


class SQLiteBackupRepository:
    def backup_if_due(self, database: Path, backups: Path) -> None:
        restore.backup_if_due(db_path=database, backups_dir=backups)

    def list_local(self, backups: Path) -> list[dict[str, Any]]:
        return restore.list_backups(backups)

    def restore_local(
        self,
        name: str,
        database: Path,
        backups: Path,
        previous_revisions: dict[str, int],
    ) -> None:
        restore.restore_backup(
            name,
            db_path=database,
            backups_dir=backups,
            previous_revisions=previous_revisions,
        )

    def mirror_manuscript(self, chapters: list[dict[str, Any]], destination: Path) -> None:
        mirror.mirror_text(chapters, manuscript_dir=destination)

    def mirror_story_world(self, state: dict[str, Any], destination: Path) -> None:
        mirror.mirror_profiles(state, profile_dir=destination)

    def safe_name(self, title: str) -> str:
        return mirror.safe_name(title)


__all__ = ["SQLiteBackupRepository"]
