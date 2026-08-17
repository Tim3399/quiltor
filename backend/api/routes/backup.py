"""Snapshot history, the local SQLite backups, and the remote endpoint."""
from __future__ import annotations

from datetime import datetime

from backend.api.routes import Request, get, save
from backend.core import storage
from backend.core.backup import remote as backup_remote
from backend.core.mirror import mirror_profiles, mirror_text, safe_name


# Every route registered `world=True` has its world resolved by the dispatch, so
# `request.world` is never None below and its snapshot context is the only
# context there is -- no process-wide "currently open world" exists any more.


@get("/api/backup", world=True)
def status(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json(app.WORLD_BACKUPS.status(request.world.backup))


@get("/api/log", world=True)
def history(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json({"ok": True, "commits": app.WORLD_BACKUPS.history(request.world.backup)})


@get("/api/backups", world=True)
def local_backups(handler, request: Request, app) -> None:
    with app._lock:
        handler.send_json({"ok": True, "backups": storage.list_backups(request.world.backups_dir)})


@get("/api/diff", world=True)
def diff(handler, request: Request, app) -> None:
    ref = request.param("ref", "WORK")
    text_only = request.param("alles", "0") != "1"
    by_word = request.param("modus", "wort") == "wort"
    with app._lock:
        handler.send_json(app.WORLD_BACKUPS.diff(request.world.backup, ref, text_only, by_word))


@get("/api/textfassung", world=True)
def chapter_version(handler, request: Request, app) -> None:
    ref = request.param("ref", "WORK")
    title = request.param("titel")
    chapter = request.param("kapitel")
    if not chapter.isdigit():
        return handler.send_json({"ok": False, "grund": "Kapitel fehlt."})
    with app._lock:
        handler.send_json(app.WORLD_BACKUPS.chapter_version(
            request.world.backup, ref, int(chapter), safe_name(title)))


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
    # Before reading the rest of the body: a payload that names no world of the
    # caller's is answered here and nothing else about it matters.
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return
    message = (payload.get("message") or "").strip()
    push = bool(payload.get("push"))

    with app._lock:
        result = app.WORLD_BACKUPS.commit(world.backup, message, push)

    for line in result.get("log", []):
        print(f"  · {datetime.now():%H:%M:%S}  {line}")
    if not result.get("ok"):
        print(f"  ! Sicherung: {result.get('grund', '')}".replace("\n", " "))
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
    except Exception as exc:
        return handler.send_json({"ok": False, "fehler": str(exc)}, 400)
    world = handler.world_from_body(request.session, payload)
    if world is None:
        return
    try:
        with app._lock:
            storage.restore_backup(str(payload.get("name", "")),
                                   db_path=world.db_path, backups_dir=world.backups_dir)
            manuscript = storage.load_manuscript(world.db_path)
            figures = storage.load_figures(world.db_path)
            mirror_text(manuscript["chapters"], manuscript_dir=world.manuscripts_dir)
            mirror_profiles(figures, profile_dir=world.profiles_dir)
        handler.send_json({"ok": True})
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)
