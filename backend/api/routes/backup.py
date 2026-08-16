"""Snapshot history, the local SQLite backups, and the remote endpoint."""
from __future__ import annotations

from datetime import datetime

from backend.api.routes import Request, get, save
from backend.core import storage
from backend.core.backup import remote as backup_remote
from backend.core.mirror import mirror_profiles, mirror_text, safe_name


def _context(request: Request, app):
    """The snapshot context for this request: per-world under OIDC, the single
    process-wide open world otherwise."""
    return request.world.git if request.world else app.CURRENT_GIT


@get("/api/backup", world=True)
def status(handler, request: Request, app) -> None:
    with app._lock:
        context = _context(request, app)
        if context is None:
            return handler.send_json({"ok": False, "grund": "No world is open."})
        handler.send_json(app.WORLD_BACKUPS.status(context))


@get("/api/log", world=True)
def history(handler, request: Request, app) -> None:
    with app._lock:
        context = _context(request, app)
        handler.send_json({"ok": True, "commits": app.WORLD_BACKUPS.history(context) if context else []})


@get("/api/backups", world=True)
def local_backups(handler, request: Request, app) -> None:
    with app._lock:
        backups_dir = request.world.backups_dir if request.world else None
        handler.send_json({"ok": True, "backups": storage.list_backups(backups_dir)})


@get("/api/diff", world=True)
def diff(handler, request: Request, app) -> None:
    ref = request.param("ref", "WORK")
    text_only = request.param("alles", "0") != "1"
    by_word = request.param("modus", "wort") == "wort"
    with app._lock:
        context = _context(request, app)
        if context is None:
            return handler.send_json({"ok": False, "grund": "No world is open."})
        handler.send_json(app.WORLD_BACKUPS.diff(context, ref, text_only, by_word))


@get("/api/textfassung", world=True)
def chapter_version(handler, request: Request, app) -> None:
    ref = request.param("ref", "WORK")
    title = request.param("titel")
    chapter = request.param("kapitel")
    if not chapter.isdigit():
        return handler.send_json({"ok": False, "grund": "Kapitel fehlt."})
    with app._lock:
        context = _context(request, app)
        if context is None:
            return handler.send_json({"ok": False, "grund": "No world is open."})
        handler.send_json(app.WORLD_BACKUPS.chapter_version(context, ref, int(chapter), safe_name(title)))


@get("/api/backup/remote")
def remote_worlds(handler, request: Request, app) -> None:
    """Deliberately not world-scoped: this is what a fresh install calls before
    it has any world at all, to find out what can be restored."""
    endpoint = backup_remote.default_endpoint()
    if not endpoint:
        return handler.send_json(
            {"ok": False, "grund": "No backup endpoint is configured (QUILTOR_BACKUP_URL)."})
    try:
        handler.send_json({"ok": True, "endpoint": endpoint, "worlds": backup_remote.worlds(endpoint)})
    except Exception as exc:
        handler.send_json({"ok": False, "grund": str(exc)})


@save("/api/backup")
def snapshot(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
    except Exception:
        payload = {}
    message = (payload.get("message") or "").strip()
    push = bool(payload.get("push"))

    context = None
    if app.AUTH_ENABLED:
        world_ctx = handler._resolve_world_or_respond(request.session, str(payload.get("worldId", "")))
        if world_ctx is None:
            return
        context = world_ctx.git

    with app._lock:
        # CURRENT_GIT is read inside the lock: /api/worlds/open|create can
        # reassign it concurrently, and reading it earlier would race that.
        if not app.AUTH_ENABLED:
            context = app.CURRENT_GIT
        if context is None:
            result = {"ok": False, "grund": "No world is open.", "log": []}
        else:
            result = app.WORLD_BACKUPS.commit(context, message, push)

    for line in result.get("log", []):
        print(f"  · {datetime.now():%H:%M:%S}  {line}")
    if not result.get("ok"):
        print(f"  ! git: {result.get('grund', '')}".replace("\n", " "))
    handler.send_json(result)


@save("/api/backup/restore")
def restore_from_endpoint(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
    except Exception:
        payload = {}
    world_id = str(payload.get("worldId", ""))
    snapshot_id = str(payload.get("snapshotId", ""))
    if not storage.WORLD_ID_RE.fullmatch(world_id):
        return handler.send_json({"ok": False, "grund": "Invalid world id."}, 400)
    endpoint = backup_remote.default_endpoint()
    if not endpoint:
        return handler.send_json(
            {"ok": False, "grund": "No backup endpoint is configured (QUILTOR_BACKUP_URL)."})
    try:
        with app._lock:
            handler.send_json(
                app.restore_world_from_endpoint(request.session, world_id, snapshot_id, endpoint))
    except Exception as exc:
        handler.send_json({"ok": False, "grund": str(exc)}, 400)


@save("/api/backups/restore")
def restore_local(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
        db_path = backups_dir = manuscripts_dir = profiles_dir = None
        if app.AUTH_ENABLED:
            world_ctx = handler._resolve_world_or_respond(request.session, str(payload.get("worldId", "")))
            if world_ctx is None:
                return
            db_path, backups_dir = world_ctx.db_path, world_ctx.backups_dir
            manuscripts_dir, profiles_dir = world_ctx.manuscripts_dir, world_ctx.profiles_dir
        with app._lock:
            storage.restore_backup(str(payload.get("name", "")), db_path=db_path, backups_dir=backups_dir)
            manuscript = storage.load_manuscript(db_path)
            figures = storage.load_figures(db_path)
            mirror_text(manuscript["chapters"], manuscript_dir=manuscripts_dir)
            mirror_profiles(figures, profile_dir=profiles_dir)
        handler.send_json({"ok": True})
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)
