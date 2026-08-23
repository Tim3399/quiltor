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
        return row[0] if row else config.LOCAL_OWNER
    except sqlite3.Error:
        return None


def list_worlds(owner_sub: str | None = None, *, paths: config.SQLitePaths) -> list[dict[str, str]]:
    paths.worlds.mkdir(parents=True, exist_ok=True)
    candidates = [(path.stem, path) for path in sorted(paths.worlds.glob("*.sqlite3"))]
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
            if (
                owner_sub is not None
                and (owner_row[0] if owner_row else config.LOCAL_OWNER) != owner_sub
            ):
                continue
            result.append(
                {
                    "id": world_id,
                    "title": row[0] if row else world_id,
                    "backupUrl": repository_row[0] if repository_row else "",
                    "updated": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
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
        raise ValueError("Der Welttitel muss zwischen 1 und 100 Zeichen lang sein.")
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
    """Delete a local world without touching its configured remote repository."""

    if not WORLD_ID_RE.fullmatch(world_id):
        raise ValueError("Invalid world identifier.")
    if owner_sub is not None and get_world_owner(world_id, paths=paths) != owner_sub:
        raise PermissionError("This world belongs to a different account.")
    path = world_db_path(world_id, paths=paths)
    if not path.exists():
        raise FileNotFoundError("This world does not exist.")
    for database_file in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        database_file.unlink(missing_ok=True)
    shutil.rmtree(paths.data / "backups" / world_id, ignore_errors=True)
    shutil.rmtree(paths.data / "history" / world_id, ignore_errors=True)


__all__ = [
    "WORLD_ID_RE",
    "create_world",
    "delete_world",
    "get_world_owner",
    "list_worlds",
    "normalize_backup_url",
    "world_db_path",
]
