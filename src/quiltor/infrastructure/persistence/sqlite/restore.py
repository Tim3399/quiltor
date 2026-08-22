"""Local SQLite safety backups and restore orchestration."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from quiltor.infrastructure.persistence.sqlite import config, revisions
from quiltor.infrastructure.persistence.sqlite.connection import connect
from quiltor.infrastructure.persistence.sqlite.schema import initialize


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
        raise ValueError("Ungültiger Sicherungsname")
    source_path = source_dir / name
    if not source_path.exists():
        raise FileNotFoundError(name)
    if previous_revisions is None:
        initialize(db_path)
        previous_revisions = {
            kind: revisions.revision(kind, db_path=db_path) for kind in ("manuscript", "figures")
        }
    backup_if_due(force=True, db_path=db_path, backups_dir=source_dir)
    source = sqlite3.connect(source_path)
    destination = connect(db_path)
    try:
        source.backup(destination)
    finally:
        source.close()
        destination.close()
    # Upgrade older snapshots before any current load or revision bookkeeping.
    initialize(db_path)
    revisions.advance_restore_revisions(previous_revisions, db_path=db_path)


__all__ = ["backup_if_due", "list_backups", "restore_backup"]
