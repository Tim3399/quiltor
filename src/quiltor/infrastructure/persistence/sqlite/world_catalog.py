"""SQLite-backed world catalogue and ownership metadata."""

from __future__ import annotations

import contextlib
import errno
import re
import shutil
import sqlite3
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta
from pathlib import Path

from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.persistence.sqlite.connection import connection
from quiltor.infrastructure.persistence.sqlite.schema import initialize

# World ids are uuid.uuid4().hex: lowercase hexadecimal, exactly 32 chars.
WORLD_ID_RE = re.compile(r"[0-9a-f]{32}")
# Where a world came from (T-214, D-127 addendum). Set when a preview of the example world is
# made and never removed; a world without the key is the user's own.
ORIGIN_KEY = "origin"
EXAMPLE_ORIGIN = "example"
# An unchanged preview left behind (a crash, a lost beacon) is removed after this long (F20).
PREVIEW_LIFETIME = timedelta(hours=24)
MAX_TITLE_LENGTH = 100
_LISTED_KEYS = ("world_title", "backup_endpoint", "owner_sub", "deleted_at", ORIGIN_KEY)


def world_db_path(world_id: str, *, paths: config.SQLitePaths) -> Path:
    return paths.worlds / f"{world_id}.sqlite3"


# A file another handle still holds open cannot be removed on Windows; the handle is usually
# a request that is about to finish (the page's own beacon, a read in flight). These waits add
# up to about 1.5 s, which is longer than any such request takes and short enough to answer.
_REMOVE_RETRY_DELAYS = (0.05, 0.1, 0.2, 0.4, 0.8)


@contextlib.contextmanager
def _open_existing(path: Path) -> Iterator[sqlite3.Connection]:
    """A world's database, never made on the way: a missing one, or one that holds no world
    (a file removed or half-removed meanwhile), is FileNotFoundError."""

    try:
        with connection(path, must_exist=True) as database:
            yield database
    except sqlite3.OperationalError as error:
        message = str(error)
        if "unable to open database file" in message or "no such table: meta" in message:
            raise FileNotFoundError("This world does not exist.") from error
        raise


def get_world_owner(world_id: str, *, paths: config.SQLitePaths) -> str | None:
    """The owner of a world, or None when there is no such world (any more).

    A world that exists but cannot be read raises the sqlite error: that is a storage
    failure, and it must not be mistaken for a world that belongs to somebody else.
    """

    path = world_db_path(world_id, paths=paths)
    if not path.exists():
        return None
    try:
        with _open_existing(path) as database:
            row = database.execute("SELECT value FROM meta WHERE key='owner_sub'").fetchone()
    except FileNotFoundError:
        return None
    return row[0] if row and row[0] else config.LOCAL_OWNER


def _require_owner(world_id: str, owner_sub: str | None, *, paths: config.SQLitePaths) -> None:
    owner = get_world_owner(world_id, paths=paths)
    if owner is None:
        raise FileNotFoundError("This world does not exist.")
    if owner_sub is not None and owner != owner_sub:
        raise PermissionError("This world belongs to a different account.")


def list_worlds(
    owner_sub: str | None = None,
    *,
    paths: config.SQLitePaths,
    deleted: bool = False,
    preview: bool | None = False,
) -> list[dict[str, str]]:
    """The caller's worlds, the user's own first and those from the example world after.

    `preview` picks the previews of the example world: False (the world list, the trash, MCP)
    leaves them out, True gives only them (the cleanup), None gives both (opening a world by
    its id, which must find a preview too).
    """
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
                meta = dict(
                    database.execute(
                        "SELECT key,value FROM meta WHERE key IN (?,?,?,?,?,?)",
                        (*_LISTED_KEYS, config.PREVIEW_KEY),
                    ).fetchall()
                )
        except sqlite3.Error:
            continue
        if owner_sub is not None and (meta.get("owner_sub") or config.LOCAL_OWNER) != owner_sub:
            continue
        deleted_at = meta.get("deleted_at") or ""
        if bool(deleted_at) != deleted:
            continue
        preview_created_at = meta.get(config.PREVIEW_KEY) or ""
        if preview is not None and bool(preview_created_at) != preview:
            continue
        origin = meta.get(ORIGIN_KEY) or ""
        result.append(
            {
                "id": world_id,
                "title": meta.get("world_title") or world_id,
                "backupUrl": meta.get("backup_endpoint") or "",
                "updated": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
                **({"deletedAt": deleted_at} if deleted_at else {}),
                **({"origin": origin} if origin else {}),
                **({"previewCreatedAt": preview_created_at} if preview_created_at else {}),
            }
        )
    # Stable: the order within each group stays the one the files have.
    result.sort(key=lambda world: world.get("origin") == EXAMPLE_ORIGIN)
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
    preview: bool = False,
) -> dict[str, str]:
    """Make a world. With `preview` it is a preview of the example world: hidden from the
    list and marked as coming from the example world, both written before anything else so
    the world is never listed unmarked."""
    clean = " ".join(title.split()).strip()
    if not clean or len(clean) > MAX_TITLE_LENGTH:
        raise ValueError("The world title must contain between 1 and 100 characters.")
    repository = normalize_backup_url(backup_url)
    paths.worlds.mkdir(parents=True, exist_ok=True)
    world_id = uuid.uuid4().hex
    path = world_db_path(world_id, paths=paths)
    initialize(path)
    created_at = datetime.now().astimezone().isoformat() if preview else ""
    with connection(path) as database:
        if preview:
            database.executemany(
                "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
                (
                    (config.PREVIEW_KEY, created_at),
                    (ORIGIN_KEY, EXAMPLE_ORIGIN),
                ),
            )
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
        **({"origin": EXAMPLE_ORIGIN, "previewCreatedAt": created_at} if preview else {}),
    }


def set_backup_url(
    world_id: str,
    backup_url: str,
    *,
    paths: config.SQLitePaths,
) -> str:
    """Store a world's own sync target; an empty value removes it.

    Returns the stored, normalized value. The caller has already resolved the
    world for its owner, so no ownership check happens here.
    """

    if not WORLD_ID_RE.fullmatch(world_id):
        raise ValueError("Invalid world identifier.")
    path = world_db_path(world_id, paths=paths)
    if not path.exists():
        raise FileNotFoundError("This world does not exist.")
    repository = normalize_backup_url(backup_url)
    with connection(path) as database:
        if repository:
            database.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('backup_endpoint',?)",
                (repository,),
            )
        else:
            database.execute("DELETE FROM meta WHERE key='backup_endpoint'")
    return repository


def delete_world(
    world_id: str,
    owner_sub: str | None = None,
    *,
    paths: config.SQLitePaths,
) -> None:
    """Move a world to its owner's persistent trash.

    A preview of the example world is discarded instead: it holds none of the author's work,
    and in the trash it would be listed nowhere and never swept.
    """

    if not WORLD_ID_RE.fullmatch(world_id):
        raise ValueError("Invalid world identifier.")
    path = world_db_path(world_id, paths=paths)
    if not path.exists():
        raise FileNotFoundError("This world does not exist.")
    _require_owner(world_id, owner_sub, paths=paths)
    if _preview_created_at(path):
        _remove_world_files(world_id, path, paths=paths)
        return
    with _open_existing(path) as database:
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
    _remove_world_files(world_id, path, paths=paths)


def _retry_while_held(action: Callable[[], None]) -> None:
    """Run a removal again while the file is held open; give up as "busy", not "forbidden".

    Windows answers an unlink of an open file with PermissionError, which the API reports as
    403 "belongs to a different account". Nothing here is about ownership, so what remains
    after the last try is EBUSY (503, storage.locked): the caller may try again.
    """

    for delay in (*_REMOVE_RETRY_DELAYS, None):
        try:
            action()
            return
        except PermissionError as error:
            if delay is None:
                raise OSError(errno.EBUSY, "A file of this world is still in use.") from error
            time.sleep(delay)


def _remove_world_files(world_id: str, path: Path, *, paths: config.SQLitePaths) -> None:
    for directory in (
        paths.backups / world_id,
        paths.data / "history" / world_id,
        paths.data / "manuscripts" / world_id,
        paths.data / "profiles" / world_id,
    ):
        with contextlib.suppress(FileNotFoundError):
            _retry_while_held(lambda directory=directory: shutil.rmtree(directory))
    for database_file in (Path(f"{path}-wal"), Path(f"{path}-shm"), path):
        _retry_while_held(lambda database_file=database_file: database_file.unlink(missing_ok=True))
    _purge_migration_copies(world_id, paths=paths)


def _preview_created_at(path: Path) -> str:
    with _open_existing(path) as database:
        row = database.execute(
            "SELECT value FROM meta WHERE key=?", (config.PREVIEW_KEY,)
        ).fetchone()
    return row[0] if row and row[0] else ""


def discard_preview_world(
    world_id: str,
    owner_sub: str | None = None,
    *,
    paths: config.SQLitePaths,
) -> None:
    """Remove a preview of the example world and everything it left on disk.

    Only a preview: a world that has become real raises ValueError and stays, whoever asks.
    Unlike purge_world it needs no trash, because a preview never passes through it.
    """

    if not WORLD_ID_RE.fullmatch(world_id):
        raise ValueError("Invalid world identifier.")
    path = world_db_path(world_id, paths=paths)
    if not path.exists():
        raise FileNotFoundError("This world does not exist.")
    _require_owner(world_id, owner_sub, paths=paths)
    if not _preview_created_at(path):
        raise ValueError("Only a preview of the example world can be discarded.")
    _remove_world_files(world_id, path, paths=paths)


def discard_expired_previews(
    *,
    paths: config.SQLitePaths,
    now: datetime | None = None,
    lifetime: timedelta = PREVIEW_LIFETIME,
) -> list[str]:
    """Remove every unchanged preview older than `lifetime`, of every owner. Returns the ids."""

    moment = now or datetime.now().astimezone()
    removed = []
    for world in list_worlds(None, paths=paths, preview=True):
        try:
            created = datetime.fromisoformat(world["previewCreatedAt"])
            expired = moment - created >= lifetime
        except (TypeError, ValueError):
            expired = True  # a mark nobody can read is no reason to keep a preview forever
        if not expired:
            continue
        # A file another process holds open (Windows) or one already gone is skipped; the
        # next sweep tries again. Opening a new preview must not fail over an old one.
        with contextlib.suppress(OSError, ValueError):
            discard_preview_world(world["id"], paths=paths)
            removed.append(world["id"])
    return removed


def finish_promotion(world_id: str, *, paths: config.SQLitePaths) -> dict[str, str]:
    """Make a former preview a real world with a name of its own; returns its record.

    The route write that changed it has usually deleted the mark already, in its own
    transaction; deleting it again here is harmless. The title gets the first free number
    "(2)", "(3)" ... when another world of the same owner already has it, trashed ones
    included, so restoring one never yields two of a name (F21). Callers hold the
    application lock, so two previews becoming real at once are numbered one after the other.
    """

    path = world_db_path(world_id, paths=paths)
    owner = get_world_owner(world_id, paths=paths)
    if owner is None:
        raise FileNotFoundError("This world does not exist.")
    with connection(path) as database:
        database.execute("DELETE FROM meta WHERE key=?", (config.PREVIEW_KEY,))
        row = database.execute("SELECT value FROM meta WHERE key='world_title'").fetchone()
    current = row[0] if row and row[0] else world_id
    taken = {
        world["title"]
        for deleted in (False, True)
        for world in list_worlds(owner, paths=paths, deleted=deleted)
        if world["id"] != world_id
    }
    title = free_title(current, taken)
    if title != current:
        with connection(path) as database:
            database.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('world_title',?)", (title,)
            )
    record = next(
        world for world in list_worlds(owner, paths=paths, preview=None) if world["id"] == world_id
    )
    return record


def free_title(title: str, taken: set[str]) -> str:
    """`title`, or `title (n)` with the smallest n >= 2 no other world has."""

    if title not in taken:
        return title
    number = 2
    while True:
        suffix = f" ({number})"
        candidate = title[: MAX_TITLE_LENGTH - len(suffix)].rstrip() + suffix
        if candidate not in taken:
            return candidate
        number += 1


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
            _retry_while_held(lambda candidate=candidate: candidate.unlink(missing_ok=True))


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
    _require_owner(world_id, owner_sub, paths=paths)
    with _open_existing(path) as database:
        deleted_row = database.execute("SELECT value FROM meta WHERE key='deleted_at'").fetchone()
    if not deleted_row or not deleted_row[0]:
        raise ValueError("Only trashed worlds can be restored or permanently deleted.")
    return path


__all__ = [
    "EXAMPLE_ORIGIN",
    "ORIGIN_KEY",
    "PREVIEW_LIFETIME",
    "WORLD_ID_RE",
    "create_world",
    "delete_world",
    "discard_expired_previews",
    "discard_preview_world",
    "finish_promotion",
    "free_title",
    "get_world_owner",
    "list_worlds",
    "normalize_backup_url",
    "purge_world",
    "restore_world",
    "set_backup_url",
    "world_db_path",
]
