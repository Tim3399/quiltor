"""The two documents a world holds -- the manuscript and the figure board --
plus the book PDF rendered from them.

Both documents are read and written through the same pair of routes, which is
why the validator is looked up from a table (`app.ROUTES`) rather than branched
on.
"""
from __future__ import annotations

from backend.api.routes import Request, get, save
from backend.core import storage
from backend.core.mirror import mirror_profiles, mirror_text


@get("/api/state", world=True)
def read_figures(handler, request: Request, app) -> None:
    _read(handler, request, app, kind="figures")


@get("/api/manuscript", world=True)
def read_manuscript(handler, request: Request, app) -> None:
    _read(handler, request, app, kind="manuscript")


def _read(handler, request: Request, app, *, kind: str) -> None:
    with app._lock:
        data = (storage.load_figures(request.db_path) if kind == "figures"
                else storage.load_manuscript(request.db_path))
        revision = storage.revision(kind, db_path=request.db_path)
    handler.send_json(data, headers={"ETag": f'"{revision}"'})


@save("/api/state")
def write_figures(handler, request: Request, app) -> None:
    _write(handler, request, app, route="/api/state")


@save("/api/manuscript")
def write_manuscript(handler, request: Request, app) -> None:
    _write(handler, request, app, route="/api/manuscript")


def _write(handler, request: Request, app, *, route: str) -> None:
    from datetime import datetime

    validate = app.ROUTES[route]
    try:
        payload = handler._read_json_body()
    except Exception:
        return handler.send_json({"ok": False, "fehler": "kein gültiger Zustand"}, 400)

    # Resolved here rather than by the dispatch: the id arrives in the body,
    # which only exists once it has been read.
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return

    try:
        # worldId is routing metadata, not document content -- strip it before
        # validation/storage so it never persists into extra_json.
        payload.pop("worldId", None)
        if not validate(payload):
            raise ValueError
    except Exception:
        return handler.send_json({"ok": False, "fehler": "kein gültiger Zustand"}, 400)

    with app._lock:
        try:
            storage.backup_if_due(db_path=world.db_path, backups_dir=world.backups_dir)
            kind = "manuscript" if route == "/api/manuscript" else "figures"
            match = handler.headers.get("If-Match", "").strip('"')
            expected = int(match) if match.isdigit() else None
            updated_revision = storage.save_with_revision(kind, payload, expected, db_path=world.db_path)
            if route == "/api/manuscript":
                mirror_text(payload["chapters"], manuscript_dir=world.manuscripts_dir)
            else:
                mirror_profiles(payload, profile_dir=world.profiles_dir)
        except storage.ConflictError as exc:
            return handler.send_json({"ok": False, "fehler": str(exc), "code": "conflict"}, 409)
        except Exception as exc:
            print(f"  ! Speichern fehlgeschlagen: {exc}")
            return handler.send_json({"ok": False, "fehler": str(exc)}, 500)

    now = datetime.now().strftime("%H:%M:%S")
    if route == "/api/manuscript":
        chapters = payload["chapters"]
        words = sum(len((c.get("body") or "").split()) for c in chapters)
        print(f"  · {now}  Text gespeichert — {len(chapters)} Kapitel, {words} Wörter")
    else:
        print(f"  · {now}  Figuren gespeichert — "
              f"{len(payload['nodes'])} Figuren, {len(payload['edges'])} Verbindungen")
    handler.send_json({"ok": True, "zeit": now, "revision": updated_revision},
                      headers={"ETag": f'"{updated_revision}"'})


@save("/api/book.pdf")
def book_pdf(handler, request: Request, app) -> None:
    port = handler.server.server_address[1]
    try:
        payload = handler._read_json_body()
    except Exception:
        payload = {}
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return
    try:
        # The headless render can't log in for itself -- not interactively at
        # Keycloak, and not by borrowing a loopback session it has no cookie for
        # -- so it gets a short-lived token that redeems into a real session
        # cookie on its first request (see redeem_render_token).
        token = app.issue_render_token(request.session.sub)
        target = f"http://127.0.0.1:{port}/?world={world.id}&renderToken={token}"
        # Read off the module, never bound early: desktop.py replaces this at
        # startup with a renderer its edition is allowed to use.
        handler.send_pdf(app.RENDER_PDF(target))
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": f"PDF konnte nicht erzeugt werden: {exc}"}, 500)
