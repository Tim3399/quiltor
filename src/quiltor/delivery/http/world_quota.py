"""The per-account limit on worlds, for every way a hosted server makes a new one (S268-9).

`/api/worlds/create`, the example world, the manuscript import and the project import all
add a world, so all of them ask here before they do. The logic lives in this one place.
"""

from __future__ import annotations

import os
from pathlib import Path

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
    return total


def over_quota(app, owner: str) -> bool:
    """Whether a hosted account has no room for another world. Call under `app.lock`."""
    if app.syncable:  # not hosted (the one place that rule lives): one user, their own disk
        return False
    owned = [*app.worlds.list(owner), *app.worlds.list_trash(owner)]
    if len(owned) >= _env_int(MAX_WORLDS_ENV, DEFAULT_MAX_WORLDS):
        return True
    limit = _env_int(MAX_BYTES_ENV, DEFAULT_MAX_BYTES)
    return sum(_world_bytes(app, world["id"]) for world in owned) >= limit


def refuse_over_quota(handler, app, owner: str) -> bool:
    """Answer 403 `world.quota` and return True when `owner` may not add a world.

    Call under `app.lock`, before anything is created. `app` needs `worlds` and `syncable`.
    """
    if not over_quota(app, owner):
        return False
    error = http_errors.for_status(403, code="world.quota", retryable=False)
    handler.send_json(error.payload(), error.status)
    return True


__all__ = ["over_quota", "refuse_over_quota"]
