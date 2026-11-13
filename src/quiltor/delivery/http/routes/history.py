"""Routes for a world's local version history: reading it, and putting a version back."""

from __future__ import annotations

from quiltor.application.backup_manifest import BackupContractError
from quiltor.application.errors import ApplicationError
from quiltor.application.history import HistoryRequestInvalid
from quiltor.delivery.http.routes import Request, get, save
from quiltor.delivery.http.world_quota import refuse_growth_over_quota


@get("/api/history", world=True)
def entries(handler, request: Request, app) -> None:
    with app.lock:
        handler.send_json({"ok": True, "commits": app.history.entries(request.world.backup)})


@get("/api/history/diff", world=True)
def diff(handler, request: Request, app) -> None:
    mode = request.param("mode", "word")
    if mode not in {"word", "line"}:
        return handler.send_exception(HistoryRequestInvalid(params={"field": "mode"}))
    include_all = request.param("all", "0")
    if include_all not in {"0", "1"}:
        return handler.send_exception(HistoryRequestInvalid(params={"field": "all"}))
    all_files = include_all == "1"
    with app.lock:
        handler.send_json(
            app.history.diff(
                request.world.backup,
                request.param("ref", "WORK"),
                all_files=all_files,
                mode=mode,
            )
        )


@get("/api/history/chapter-text", world=True)
def chapter_text(handler, request: Request, app) -> None:
    chapter = request.param("chapter")
    if not chapter.isdigit():
        return handler.send_exception(HistoryRequestInvalid(params={"field": "chapter"}))
    title = request.param("title")
    if not title.strip():
        return handler.send_exception(HistoryRequestInvalid(params={"field": "title"}))
    with app.lock:
        handler.send_json(
            app.history.chapter_text(
                request.world.backup,
                request.param("ref", "WORK"),
                int(chapter),
                title,
            )
        )


@get("/api/history/chapter-comparison", world=True)
def chapter_comparison(handler, request: Request, app) -> None:
    chapter_id = request.param("chapterId")
    if not chapter_id.strip() or len(chapter_id) > 200:
        return handler.send_exception(HistoryRequestInvalid(params={"field": "chapterId"}))
    with app.lock:
        handler.send_json(
            app.history.chapter_comparison(
                request.world.backup,
                request.param("ref", "HEAD"),
                chapter_id,
            )
        )


@get("/api/history/chapter-timeline", world=True)
def chapter_timeline(handler, request: Request, app) -> None:
    chapter_id = request.param("chapterId")
    if not chapter_id.strip() or len(chapter_id) > 200:
        return handler.send_exception(HistoryRequestInvalid(params={"field": "chapterId"}))
    limit = request.param("limit", "20")
    if not (limit.isdigit() and 1 <= int(limit) <= 50):
        return handler.send_exception(HistoryRequestInvalid(params={"field": "limit"}))
    before = request.param("before", "")
    if len(before) > 200:
        return handler.send_exception(HistoryRequestInvalid(params={"field": "before"}))
    with app.lock:
        handler.send_json(
            app.history.chapter_timeline(
                request.world.backup, chapter_id, limit=int(limit), before=before
            )
        )


@save("/api/history/restore", world=True)
def restore(handler, request: Request, app) -> None:
    """Put a version from the local history back (T-87 B). Local, so not device_sync:
    a hosted server restores its own history like any other."""
    try:
        payload = handler._read_json_body()
    except Exception:  # an unreadable body names no version
        payload = None
    revision_id = payload.get("id") if isinstance(payload, dict) else None
    if not isinstance(revision_id, str) or not revision_id.strip() or len(revision_id) > 200:
        return handler.send_exception(HistoryRequestInvalid(params={"field": "id"}))
    world = request.world
    try:
        with app.lock:
            if refuse_growth_over_quota(handler, request.session.sub):
                return
            result = app.restore_version(
                world.backup,
                world.document_location,
                world.id,
                request.session.sub,
                revision_id,
            )
            if getattr(world, "preview", False):
                app.finish_promotion(world.id)
    except ApplicationError as exc:
        return handler.send_exception(exc)
    except BackupContractError as exc:
        # A blob of that version is missing or damaged; the world was not touched.
        return handler.send_api_error(409, error_code=exc.code, retryable=False)
    handler.send_json(result)


__all__ = ["chapter_comparison", "chapter_text", "diff", "entries", "restore"]
