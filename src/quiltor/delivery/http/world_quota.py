"""The per-account limits on worlds and bytes, for every way a hosted server adds either (S268-9).

`/api/worlds/create`, the example world, the manuscript import and the project import all
add a world, so all of them ask here before they do. The routes that only grow an existing
world (saving a document, keeping a version, putting one back, uploading a map) ask for the
bytes alone (F-268-18). Reading, deleting and the trash never ask, so an account over its
limit can always get back under it. The logic lives in this one place.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from types import SimpleNamespace

from quiltor.delivery.http import errors as http_errors

# A hosted server shares one disk between all accounts, and every world is a SQLite file
# plus mirror and backup folders (S268-9). One account may hold this many worlds (trash
# included, it still takes space) and this many bytes in all of them. The values are an
# assumption about a writer's real use; an operator overrides them in the environment.
# A local server is not limited.
MAX_WORLDS_ENV = "QUILTOR_MAX_WORLDS_PER_ACCOUNT"
MAX_BYTES_ENV = "QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT"
DEFAULT_MAX_WORLDS = 50
DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024


# Counting the bytes walks every mirror, backup and history file of every world, which a save
# on every pause in typing must not pay. A "room left" answer is therefore remembered for a
# short while per account; an "over the limit" answer never is, so deleting something frees
# the account at once. A save may overshoot the limit by what fits into this window.
BYTES_CACHE_SECONDS = 15.0
_room_until: dict[tuple[str, str], float] = {}
_room_lock = threading.Lock()


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, "") or default)
    except ValueError:
        return default
    return value if value > 0 else default


def _tree_bytes(root: Path) -> int:
    total = 0
    for entry in root.rglob("*") if root.is_dir() else ():
        try:
            if entry.is_file():
                total += entry.stat().st_size
        except OSError:
            continue
    return total


def _world_bytes(app, world_id: str) -> int:
    documents = app.worlds.paths_for(world_id).documents
    database = documents.database
    total = 0
    for sibling in database.parent.glob(database.name + "*"):  # the -wal and -shm files too
        try:
            total += sibling.stat().st_size
        except OSError:
            continue
    for folder in (documents.backups, documents.manuscript_mirrors, documents.story_world_mirrors):
        total += _tree_bytes(folder)
    # "Keep version" writes its blobs here, outside the three folders above (F-268-18).
    total += _tree_bytes(app.worlds.data_directory / "history" / world_id)
    return total


def _over_bytes(app, owned: list) -> bool:
    limit = _env_int(MAX_BYTES_ENV, DEFAULT_MAX_BYTES)
    return sum(_world_bytes(app, world["id"]) for world in owned) >= limit


def over_quota(app, owner: str) -> bool:
    """Whether a hosted account has no room for another world. Call under `app.lock`."""
    if app.syncable:  # not hosted (the one place that rule lives): one user, their own disk
        return False
    owned = [*app.worlds.list(owner), *app.worlds.list_trash(owner)]
    if len(owned) >= _env_int(MAX_WORLDS_ENV, DEFAULT_MAX_WORLDS):
        return True
    return _over_bytes(app, owned)


def over_bytes(app, owner: str) -> bool:
    """Whether a hosted account has no room for more bytes in the worlds it has.

    Call under `app.lock`. Only a "room left" answer is remembered (see BYTES_CACHE_SECONDS).
    """
    if app.syncable:
        return False
    key = (str(app.worlds.data_directory), owner)
    now = time.monotonic()
    with _room_lock:
        if _room_until.get(key, 0.0) > now:
            return False
    owned = [*app.worlds.list(owner), *app.worlds.list_trash(owner)]
    if _over_bytes(app, owned):
        with _room_lock:
            _room_until.pop(key, None)
        return True
    with _room_lock:
        _room_until[key] = now + BYTES_CACHE_SECONDS
    return False


def refuse_over_quota(handler, app, owner: str) -> bool:
    """Answer 403 `world.quota` and return True when `owner` may not add a world.

    Call under `app.lock`, before anything is created. `app` needs `worlds` and `syncable`.
    """
    if not over_quota(app, owner):
        return False
    error = http_errors.for_status(403, code="world.quota", retryable=False)
    handler.send_json(error.payload(), error.status)
    return True


def refuse_growth_over_quota(handler, owner: str) -> bool:
    """Answer 403 `world.quota` and return True when `owner` may not add bytes to a world.

    For the write routes whose services do not carry the world store (documents, history,
    maps, versions): they reach the same facts through the handler's application. Call
    under `app.lock`, before anything is written.
    """
    web = handler.application
    view = SimpleNamespace(syncable=web.syncable, worlds=web.application.worlds)
    if not over_bytes(view, owner):
        return False
    error = http_errors.for_status(403, code="world.quota", retryable=False)
    handler.send_json(error.payload(), error.status)
    return True


__all__ = ["over_bytes", "over_quota", "refuse_growth_over_quota", "refuse_over_quota"]
