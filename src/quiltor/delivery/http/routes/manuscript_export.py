"""Authenticated, world-scoped export of a reviewed manuscript snapshot."""

from __future__ import annotations

import re

from quiltor.application.document_wire_v1 import MAX_SAFE_REVISION
from quiltor.application.manuscript_export import (
    DOCX_MEDIA_TYPE,
    WARNING_CODES,
    InvalidExportRequest,
    validate_preset,
)
from quiltor.delivery.http.routes import Request, save


def _payload(handler, *, download: bool = False) -> dict:
    try:
        payload = handler._read_json_body()
    except (TypeError, ValueError) as error:
        raise InvalidExportRequest("Invalid export request.") from error
    keys = (
        {"preset", "revision", "sourceSha256", "acknowledgedWarnings"} if download else {"preset"}
    )
    if not isinstance(payload, dict) or payload.keys() != keys:
        raise InvalidExportRequest("Invalid export request fields.")
    validate_preset(payload["preset"])
    if download:
        revision = payload["revision"]
        digest = payload["sourceSha256"]
        warnings = payload["acknowledgedWarnings"]
        if (
            type(revision) is not int
            or not 0 <= revision <= MAX_SAFE_REVISION
            or not isinstance(digest, str)
            or not re.fullmatch("[0-9a-f]{64}", digest)
            or not isinstance(warnings, list)
            or len(warnings) > len(WARNING_CODES)
            or any(not isinstance(code, str) or code not in WARNING_CODES for code in warnings)
            or len(set(warnings)) != len(warnings)
        ):
            raise InvalidExportRequest("Invalid export preview identity or acknowledgements.")
    return payload


@save("/api/manuscript-export/preview", world=True)
def preview_manuscript_export(handler, request: Request, app) -> None:
    payload = _payload(handler)
    with app.lock:
        preview = app.manuscript_export.preview(request.db_path, payload["preset"])
    handler.send_json({"ok": True, "preview": preview})


@save("/api/manuscript-export/docx", world=True)
def download_manuscript_docx(handler, request: Request, app) -> None:
    payload = _payload(handler, download=True)
    with app.lock:
        file_name, content = app.manuscript_export.export(request.db_path, payload)
    handler.send_response(200)
    handler.send_header("Content-Type", DOCX_MEDIA_TYPE)
    handler.send_header("Content-Disposition", f'attachment; filename="{file_name}"')
    handler.send_header("Content-Length", str(len(content)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.end_headers()
    handler.wfile.write(content)
