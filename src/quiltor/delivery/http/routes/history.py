"""Read-only routes for a world's local version history."""

from __future__ import annotations

from quiltor.application.history import HistoryRequestInvalid
from quiltor.delivery.http.routes import Request, get


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


__all__ = ["chapter_text", "diff", "entries"]
