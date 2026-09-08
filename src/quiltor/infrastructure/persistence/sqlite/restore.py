"""Local SQLite safety backups and restore orchestration."""

from __future__ import annotations

import os
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any

from quiltor.infrastructure.persistence.sqlite import config, revisions
from quiltor.infrastructure.persistence.sqlite.connection import connect
from quiltor.infrastructure.persistence.sqlite.schema import SCHEMA_VERSION, initialize

MAX_BACKUPS = 40
BACKUP_INTERVAL = 300


def backup_if_due(
    force: bool = False,
    db_path: Path | None = None,
    backups_dir: Path | None = None,
) -> None:
    destination_dir = backups_dir or config.BACKUPS
    destination_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(destination_dir.glob("backup-*.sqlite3"))
    if (
        not force
        and files
        and datetime.now().timestamp() - files[-1].stat().st_mtime < BACKUP_INTERVAL
    ):
        return
    target = destination_dir / f"backup-{datetime.now():%Y%m%d-%H%M%S-%f}.sqlite3"
    temp = target.with_suffix(".tmp")
    source = connect(db_path)
    destination = sqlite3.connect(temp)
    try:
        with source, destination:
            source.backup(destination)
    finally:
        source.close()
        destination.close()
    os.replace(temp, target)
    for old in files[: max(0, len(files) - MAX_BACKUPS + 1)]:
        old.unlink(missing_ok=True)


def list_backups(backups_dir: Path | None = None) -> list[dict[str, Any]]:
    source_dir = backups_dir or config.BACKUPS
    return [
        {
            "name": path.name,
            "created": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            "size": path.stat().st_size,
        }
        for path in sorted(source_dir.glob("backup-*.sqlite3"), reverse=True)
    ]


def restore_backup(
    name: str,
    db_path: Path | None = None,
    backups_dir: Path | None = None,
    previous_revisions: dict[str, int] | None = None,
) -> None:
    source_dir = backups_dir or config.BACKUPS
    if Path(name).name != name or not name.startswith("backup-") or not name.endswith(".sqlite3"):
        raise ValueError("Invalid backup name.")
    source_path = source_dir / name
    with source_path.open("rb") as handle:
        if handle.read(16) != b"SQLite format 3\x00":
            raise ValueError("Backup is not a valid SQLite database.")

    # Stage the selected snapshot before the safety backup rotates old files.
    # Keeping the source open through rotation would also prevent deletion on Windows.
    # Read-only mode must never recreate a source that disappears before it is opened.
    with tempfile.TemporaryDirectory(prefix="quiltor-local-restore-") as directory:
        staged = Path(directory) / "world.sqlite3"
        # Safety snapshots are complete standalone databases. Immutable mode also
        # prevents SQLite from creating WAL/SHM sidecars beside a read-only source.
        source_uri = f"{source_path.resolve().as_uri()}?mode=ro&immutable=1"
        with (
            closing(sqlite3.connect(source_uri, uri=True)) as source,
            closing(sqlite3.connect(staged)) as destination,
        ):
            if source.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("Backup database failed its integrity check.")
            version = source.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
            if version is None or not 0 <= int(version[0]) <= SCHEMA_VERSION:
                raise ValueError("Backup database schema version is not supported.")
            # Legacy snapshots may contain only one document family, but metadata
            # alone must not be turned into a newly initialized, empty world.
            if (
                source.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('chapters','figures')"
                ).fetchone()
                is None
            ):
                raise ValueError("Backup database contains no world document tables.")
            source.backup(destination)

        # Migration failures affect only the staged copy, never the active world.
        initialize(staged)
        if previous_revisions is None:
            initialize(db_path)
            previous_revisions = {
                kind: revisions.revision(kind, db_path=db_path)
                for kind in ("manuscript", "figures", "storyboards")
            }
        revisions.advance_restore_revisions(previous_revisions, db_path=staged)
        backup_if_due(force=True, db_path=db_path, backups_dir=source_dir)
        with closing(connect(staged)) as source, closing(connect(db_path)) as destination:
            source.backup(destination)


__all__ = ["backup_if_due", "list_backups", "restore_backup"]
