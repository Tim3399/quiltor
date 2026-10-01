from __future__ import annotations

from quiltor.application.project_transfer import (
    MAX_ARCHIVE_BYTES,
    InvalidProjectArchive,
    ProjectArchiveLimitExceeded,
)
from quiltor.delivery.http.routes import Request, get, save


@get("/api/project-transfer/export")
def export_project(handler, request: Request, app) -> None:
    world_id = request.param("world")
    if not world_id:
        return handler.send_exception(InvalidProjectArchive("A world id is required."))
    with app.lock:
        _title, archive = app.project_transfer.export(world_id, request.session.sub)
    handler.send_response(200)
    handler.send_header("Content-Type", "application/zip")
    handler.send_header("Content-Disposition", 'attachment; filename="Quiltor-Projekt.quiltor"')
    handler.send_header("Content-Length", str(len(archive)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(archive)


@save("/api/project-transfer/preview")
def preview_project(handler, request: Request, app) -> None:
    archive = _read_archive(handler)
    with app.lock:
        preview = app.project_transfer.preview(archive)
    handler.send_json({"ok": True, "preview": preview})


@save("/api/project-transfer/import")
def import_project(handler, request: Request, app) -> None:
    archive = _read_archive(handler)
    with app.lock:
        world = app.project_transfer.import_archive(archive, request.session.sub)
    handler.send_json({"ok": True, "world": world}, 201)


def _read_archive(handler) -> bytes:
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except (TypeError, ValueError) as error:
        raise InvalidProjectArchive("Project archive size is invalid.") from error
    media_type = (handler.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
    if media_type not in {"application/zip", "application/octet-stream"}:
        raise InvalidProjectArchive("Project archive content type is invalid.")
    if length > MAX_ARCHIVE_BYTES:
        raise ProjectArchiveLimitExceeded("Project archive exceeds the transfer limit.")
    if length <= 0:
        raise InvalidProjectArchive("Project archive size is invalid.")
    archive = handler.rfile.read(length)
    if len(archive) != length:
        raise InvalidProjectArchive("Project archive body is incomplete.")
    return archive


__all__ = ["export_project", "import_project", "preview_project"]
