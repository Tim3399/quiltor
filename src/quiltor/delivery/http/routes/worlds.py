"""Listing, opening, creating and deleting worlds.

Every world has an owner, in every deployment: under OIDC the account's sub,
locally the one local user's sub. So ownership is never
branched on here -- `request.session.sub` is simply the owner, and the checks
below are the same lines either way (trivially satisfied when there is one user).
"""

from __future__ import annotations

import os
from pathlib import Path

from quiltor.application.worlds.example import ExampleWorldFailed
from quiltor.delivery.http import errors as http_errors
from quiltor.delivery.http.routes import Request, get, save

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


def _over_quota(app, owner: str) -> bool:
    """Whether a hosted account has no room for another world. Call under `app.lock`."""
    if app.syncable:  # not hosted (the one place that rule lives): one user, their own disk
        return False
    owned = [*app.worlds.list(owner), *app.worlds.list_trash(owner)]
    if len(owned) >= _env_int(MAX_WORLDS_ENV, DEFAULT_MAX_WORLDS):
        return True
    limit = _env_int(MAX_BYTES_ENV, DEFAULT_MAX_BYTES)
    return sum(_world_bytes(app, world["id"]) for world in owned) >= limit


@get("/api/worlds")
def list_worlds(handler, request: Request, app) -> None:
    with app.lock:
        handler.send_json({"ok": True, "worlds": app.worlds.list(request.session.sub)})


@get("/api/worlds/trash")
def list_trash(handler, request: Request, app) -> None:
    with app.lock:
        handler.send_json({"ok": True, "worlds": app.worlds.list_trash(request.session.sub)})


@save("/api/worlds/create")
def create(handler, request: Request, app) -> None:
    _open_or_create(handler, request, app, creating=True)


@save("/api/worlds/open")
def open_world(handler, request: Request, app) -> None:
    _open_or_create(handler, request, app, creating=False)


@save("/api/worlds/open-example")
def open_example(handler, request: Request, app) -> None:
    """A fresh preview of the example world in the given language (T-214-5a, D-127).

    It is not in the world list and becomes a real world with its first saved change. Every
    call makes a new one: two tabs, two previews.
    """
    try:
        payload = handler._read_json_body()
    except (TypeError, ValueError) as exc:
        return handler.send_exception(exc)
    lang = payload.get("lang") if isinstance(payload, dict) else None
    try:
        with app.lock:
            world = app.example_worlds.open(request.session.sub, lang)
    except ExampleWorldFailed:
        return handler.send_api_error(500, error_code="world.example_failed", retryable=True)
    handler.send_json({"ok": True, "world": world})


@save("/api/worlds/discard-preview")
def discard_preview(handler, request: Request, app) -> None:
    """Remove the caller's preview when its tab leaves it unchanged.

    Sent as a beacon too, so it never fails loudly: a world that has become real meanwhile,
    or is already gone, answers `discarded: false` and stays as it is. Only another account's
    world is refused.
    """
    try:
        payload = handler._read_json_body()
    except (TypeError, ValueError) as exc:
        return handler.send_exception(exc)
    world_id = str(payload.get("id", "")) if isinstance(payload, dict) else ""
    discarded = True
    with app.lock:
        try:
            app.worlds.discard_preview(world_id, request.session.sub)
        except PermissionError as exc:
            return handler.send_exception(exc)
        except (FileNotFoundError, ValueError):
            discarded = False
    handler.send_json({"ok": True, "discarded": discarded})


@save("/api/worlds/delete")
def delete(handler, request: Request, app) -> None:
    _world_command(handler, request, app, "delete")


@save("/api/worlds/restore")
def restore(handler, request: Request, app) -> None:
    _world_command(handler, request, app, "restore")


@save("/api/worlds/purge")
def purge(handler, request: Request, app) -> None:
    _world_command(handler, request, app, "purge")


def _world_command(handler, request: Request, app, command: str) -> None:
    try:
        payload = handler._read_json_body()
    except (TypeError, ValueError) as exc:
        return handler.send_exception(exc)
    with app.lock:
        try:
            getattr(app.worlds, command)(str(payload.get("id", "")), request.session.sub)
        except (FileNotFoundError, PermissionError, ValueError) as exc:
            return handler.send_exception(exc)
    handler.send_json({"ok": True})


def _open_or_create(handler, request: Request, app, *, creating: bool) -> None:
    """Creating makes the world, opening looks it up and checks it is the
    caller's; both answer with the same world record.

    Opening activates nothing. There is no process-wide open world -- the
    frontend remembers the id and sends it with every request, and each request
    resolves its own paths (server.resolve_world). So this route only confirms
    that the world exists and belongs to the caller.
    """
    try:
        payload = handler._read_json_body()
        if creating and str(payload.get("backupUrl", "")).strip() and not app.syncable:
            # A sync target is device sync, which a hosted server refuses (D-61).
            return handler.send_api_error(403, error_code="sync.forbidden_hosted", retryable=False)
        owner = request.session.sub
        with app.lock:
            if creating:
                if _over_quota(app, owner):
                    error = http_errors.for_status(403, code="world.quota", retryable=False)
                    return handler.send_json(error.payload(), error.status)
                world = app.worlds.create(
                    str(payload.get("title", "")),
                    str(payload.get("backupUrl", "")),
                    owner,
                )
            else:
                world_id = str(payload.get("id", ""))
                try:
                    world = app.worlds.open(world_id, owner).summary.public()
                except FileNotFoundError as exc:
                    return handler.send_exception(exc)
                except PermissionError as exc:
                    return handler.send_exception(exc)
        handler.send_json({"ok": True, "world": world})
    except Exception as exc:
        handler.send_exception(exc)
