"""Listing, opening, creating and deleting worlds.

Every world has an owner, in every deployment: under OIDC the account's sub,
locally the one local user's sub. So ownership is never
branched on here -- `request.session.sub` is simply the owner, and the checks
below are the same lines either way (trivially satisfied when there is one user).
"""

from __future__ import annotations

from quiltor.delivery.http.routes import Request, get, save


@get("/api/worlds")
def list_worlds(handler, request: Request, app) -> None:
    with app.lock:
        handler.send_json({"ok": True, "worlds": app.worlds.list(request.session.sub)})


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
        with app.lock:
            try:
                app.worlds.delete(str(payload.get("id", "")), request.session.sub)
            except PermissionError as exc:
                return handler.send_exception(exc)
        handler.send_json({"ok": True})
    except Exception as exc:
        handler.send_exception(exc)


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
        with app.lock:
            if creating:
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
