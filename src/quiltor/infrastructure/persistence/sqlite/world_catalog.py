"""SQLite-backed world catalogue and ownership metadata."""

from __future__ import annotations

import re
import shutil
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.persistence.sqlite.connection import connection
from quiltor.infrastructure.persistence.sqlite.schema import initialize

# World ids are uuid.uuid4().hex: lowercase hexadecimal, exactly 32 chars.
WORLD_ID_RE = re.compile(r"[0-9a-f]{32}")


def world_db_path(world_id: str, *, paths: config.SQLitePaths) -> Path:
    return paths.worlds / f"{world_id}.sqlite3"


def get_world_owner(world_id: str, *, paths: config.SQLitePaths) -> str | None:
    path = world_db_path(world_id, paths=paths)
    if not path.exists():
        return None
    try:
        with connection(path) as database:
            row = database.execute("SELECT value FROM meta WHERE key='owner_sub'").fetchone()
        return row[0] if row and row[0] else config.LOCAL_OWNER
    except sqlite3.Error:
        return None


def list_worlds(
    owner_sub: str | None = None,
    *,
    paths: config.SQLitePaths,
    deleted: bool = False,
) -> list[dict[str, str]]:
    paths.worlds.mkdir(parents=True, exist_ok=True)
    candidates = [
        (path.stem, path)
        for path in sorted(paths.worlds.glob("*.sqlite3"))
        if WORLD_ID_RE.fullmatch(path.stem)
    ]
    result = []
    for world_id, path in candidates:
        if not path.exists():
            continue
        try:
            with connection(path) as database:
                row = database.execute("SELECT value FROM meta WHERE key='world_title'").fetchone()
                repository_row = database.execute(
                    "SELECT value FROM meta WHERE key='backup_endpoint'"
                ).fetchone()
                owner_row = database.execute(
                    "SELECT value FROM meta WHERE key='owner_sub'"
                ).fetchone()
                deleted_row = database.execute(
                    "SELECT value FROM meta WHERE key='deleted_at'"
                ).fetchone()
            if (
                owner_sub is not None
                and (owner_row[0] if owner_row and owner_row[0] else config.LOCAL_OWNER)
                != owner_sub
            ):
                continue
            deleted_at = deleted_row[0] if deleted_row and deleted_row[0] else ""
            if bool(deleted_at) != deleted:
                continue
            result.append(
                {
                    "id": world_id,
                    "title": row[0] if row else world_id,
                    "backupUrl": repository_row[0] if repository_row else "",
                    "updated": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
                    **({"deletedAt": deleted_at} if deleted_at else {}),
                }
            )
        except sqlite3.Error:
            continue
    return result


def normalize_backup_url(value: str) -> str:
    """Accept HTTPS endpoints and explicit HTTP loopback development endpoints."""

    url = value.strip().removesuffix("/")
    if not url:
        return ""
    match = re.fullmatch(
        r"(https?)://([A-Za-z0-9.-]+)(?::(\d+))?(/[A-Za-z0-9_./-]*)?",
        url,
    )
    if not match:
        raise ValueError("Enter a valid backup endpoint URL, e.g. https://backup.example.com")
    scheme, host = match.group(1), match.group(2)
    if scheme == "http" and host not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Use https:// for a remote backup endpoint.")
    return url


def create_world(
    title: str,
    backup_url: str = "",
    owner_sub: str | None = None,
    *,
    paths: config.SQLitePaths,
) -> dict[str, str]:
    clean = " ".join(title.split()).strip()
    if not clean or len(clean) > 100:
        raise ValueError("The world title must contain between 1 and 100 characters.")
    repository = normalize_backup_url(backup_url)
    paths.worlds.mkdir(parents=True, exist_ok=True)
    world_id = uuid.uuid4().hex
    path = world_db_path(world_id, paths=paths)
    initialize(path)
    with connection(path) as database:
        database.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('world_title',?)",
            (clean,),
        )
        if repository:
            database.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('backup_endpoint',?)",
                (repository,),
            )
        if owner_sub is not None:
            database.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('owner_sub',?)",
                (owner_sub,),
            )
        chapter_id = uuid.uuid4().hex
        database.execute(
            "INSERT INTO chapters(id,position,title,body,note) VALUES(?,0,'','','')",
            (chapter_id,),
        )
        database.execute(
            """
            INSERT INTO manuscript_tree_items(
              id,parent_folder_id,kind,chapter_id,folder_id,position,extra_json
            ) VALUES(?,NULL,'chapter',?,NULL,0,'{}')
            """,
            (f"chapter:{chapter_id}", chapter_id),
        )
    return {
        "id": world_id,
        "title": clean,
        "backupUrl": repository,
        "updated": datetime.now().isoformat(),
    }


def delete_world(
    world_id: str,
    owner_sub: str | None = None,
    *,
    paths: config.SQLitePaths,
) -> None:
    """Move a world to its owner's persistent trash."""

    if not WORLD_ID_RE.fullmatch(world_id):
        raise ValueError("Invalid world identifier.")
    path = world_db_path(world_id, paths=paths)
    if not path.exists():
        raise FileNotFoundError("This world does not exist.")
    if owner_sub is not None and get_world_owner(world_id, paths=paths) != owner_sub:
        raise PermissionError("This world belongs to a different account.")
    with connection(path) as database:
        deleted_row = database.execute("SELECT value FROM meta WHERE key='deleted_at'").fetchone()
        if deleted_row and deleted_row[0]:
            raise FileNotFoundError("This world does not exist.")
        database.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('deleted_at',?)",
            (datetime.now().astimezone().isoformat(),),
        )
        _advance_document_revisions(database)


def restore_world(
    world_id: str,
    owner_sub: str | None = None,
    *,
    paths: config.SQLitePaths,
) -> None:
    """Restore a trashed world without changing its identity or resources."""

    path = _require_trashed_world(world_id, owner_sub, paths=paths)
    with connection(path) as database:
        database.execute("DELETE FROM meta WHERE key='deleted_at'")
        _advance_document_revisions(database)


def purge_world(
    world_id: str,
    owner_sub: str | None = None,
    *,
    paths: config.SQLitePaths,
) -> None:
    """Permanently remove a trashed world and all of its local resources."""

    path = _require_trashed_world(world_id, owner_sub, paths=paths)
    for directory in (
        paths.backups / world_id,
        paths.data / "history" / world_id,
        paths.data / "manuscripts" / world_id,
        paths.data / "profiles" / world_id,
    ):
        try:
            shutil.rmtree(directory)
        except FileNotFoundError:
            pass
    for database_file in (Path(f"{path}-wal"), Path(f"{path}-shm"), path):
        database_file.unlink(missing_ok=True)
    _purge_migration_copies(world_id, paths=paths)


def _advance_document_revisions(database: sqlite3.Connection) -> None:
    for kind in ("manuscript", "figures", "storyboards"):
        key = f"{kind}_revision"
        row = database.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        current = int(row[0]) if row else 0
        database.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
            (key, str(current + 1)),
        )


def _purge_migration_copies(world_id: str, *, paths: config.SQLitePaths) -> None:
    copy_name = re.compile(
        rf"{re.escape(world_id)}\.pre-migration-v[0-9]+-"
        r"[0-9]{8}-[0-9]{6}-[0-9]{6}\.sqlite3(?:-(?:wal|shm))?"
    )
    for candidate in paths.worlds.glob(f"{world_id}.pre-migration-v*.sqlite3*"):
        if copy_name.fullmatch(candidate.name):
            candidate.unlink(missing_ok=True)


def _require_trashed_world(
    world_id: str,
    owner_sub: str | None,
    *,
    paths: config.SQLitePaths,
) -> Path:
    if not WORLD_ID_RE.fullmatch(world_id):
        raise ValueError("Invalid world identifier.")
    path = world_db_path(world_id, paths=paths)
    if not path.exists():
        raise FileNotFoundError("This world does not exist.")
    if owner_sub is not None and get_world_owner(world_id, paths=paths) != owner_sub:
        raise PermissionError("This world belongs to a different account.")
    with connection(path) as database:
        deleted_row = database.execute("SELECT value FROM meta WHERE key='deleted_at'").fetchone()
    if not deleted_row or not deleted_row[0]:
        raise ValueError("Only trashed worlds can be restored or permanently deleted.")
    return path


__all__ = [
    "WORLD_ID_RE",
    "create_world",
    "delete_world",
    "get_world_owner",
    "list_worlds",
    "normalize_backup_url",
    "purge_world",
    "restore_world",
    "world_db_path",
]
