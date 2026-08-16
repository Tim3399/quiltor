"""Listing, opening, creating and deleting worlds."""
from __future__ import annotations

from backend.api.routes import Request, get, save
from backend.core import storage


@get("/api/worlds")
def list_worlds(handler, request: Request, app) -> None:
    with app._lock:
        owner = request.session.sub if app.AUTH_ENABLED else None
        handler.send_json({"ok": True, "worlds": storage.list_worlds(owner_sub=owner)})


@save("/api/worlds/create")
def create(handler, request: Request, app) -> None:
    _open_or_create(handler, request, app, creating=True)


@save("/api/worlds/open")
def open_world(handler, request: Request, app) -> None:
    _open_or_create(handler, request, app, creating=False)


@save("/api/worlds/delete")
def delete(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
        owner = request.session.sub if app.AUTH_ENABLED else None
        with app._lock:
            try:
                storage.delete_world(str(payload.get("id", "")), owner_sub=owner)
            except PermissionError as exc:
                return handler.send_json({"ok": False, "fehler": str(exc)}, 403)
        handler.send_json({"ok": True})
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)


def _open_or_create(handler, request: Request, app, *, creating: bool) -> None:
    """Opening and creating differ only in how the world is obtained; everything
    after -- activating it locally and giving it a backup context -- is shared.

    Under OIDC nothing is "activated": the process-wide active world is a
    single-user notion, and a hosted deployment resolves the world per request
    instead.
    """
    try:
        payload = handler._read_json_body()
        owner = request.session.sub if app.AUTH_ENABLED else None
        with app._lock:
            if creating:
                world = storage.create_world(str(payload.get("title", "")),
                                             str(payload.get("backupUrl", "")), owner_sub=owner)
                if not app.AUTH_ENABLED:
                    world = storage.activate_world(world["id"])
            else:
                world_id = str(payload.get("id", ""))
                if app.AUTH_ENABLED:
                    existing = storage.get_world_owner(world_id)
                    if existing is None:
                        return handler.send_json({"ok": False, "fehler": "This world does not exist."}, 404)
                    if existing != request.session.sub:
                        return handler.send_json(
                            {"ok": False, "fehler": "This world belongs to a different account."}, 403)
                    world = next((w for w in storage.list_worlds(owner_sub=request.session.sub)
                                  if w["id"] == world_id), None)
                    if world is None:
                        return handler.send_json({"ok": False, "fehler": "This world does not exist."}, 404)
                else:
                    world = storage.activate_world(world_id)

            if not app.AUTH_ENABLED:
                # Every world gets a local backup history, even without a
                # configured endpoint -- history is always local first.
                app.CURRENT_GIT = app.WORLD_BACKUPS.context(
                    world["id"], world.get("backupUrl", ""), storage.DB,
                    app.MANUSCRIPT_DIR, app.PROFILE_DIR, title=world.get("title", ""))
        handler.send_json({"ok": True, "world": world})
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)
