"""Listing, opening, creating and deleting worlds.

Every world has an owner, in every deployment: under OIDC the account's sub,
locally storage.LOCAL_OWNER, which is the one user's sub. So ownership is never
branched on here -- `request.session.sub` is simply the owner, and the checks
below are the same lines either way (trivially satisfied when there is one user).
"""

from __future__ import annotations

from backend.api.routes import Request, get, save
from backend.core import storage


@get("/api/worlds")
def list_worlds(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json(
            {"ok": True, "worlds": storage.list_worlds(owner_sub=request.session.sub)}
        )


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
        with app._lock:
            try:
                storage.delete_world(str(payload.get("id", "")), owner_sub=request.session.sub)
            except PermissionError as exc:
                return handler.send_json({"ok": False, "fehler": str(exc)}, 403)
        handler.send_json({"ok": True})
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)


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
        owner = request.session.sub
        with app._lock:
            if creating:
                world = storage.create_world(
                    str(payload.get("title", "")),
                    str(payload.get("backupUrl", "")),
                    owner_sub=owner,
                )
            else:
                world_id = str(payload.get("id", ""))
                existing = storage.get_world_owner(world_id)
                if existing is None:
                    return handler.send_json(
                        {"ok": False, "fehler": "This world does not exist."}, 404
                    )
                if existing != owner:
                    return handler.send_json(
                        {"ok": False, "fehler": "This world belongs to a different account."}, 403
                    )
                world = next(
                    (w for w in storage.list_worlds(owner_sub=owner) if w["id"] == world_id), None
                )
                if world is None:
                    return handler.send_json(
                        {"ok": False, "fehler": "This world does not exist."}, 404
                    )
        handler.send_json({"ok": True, "world": world})
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)
