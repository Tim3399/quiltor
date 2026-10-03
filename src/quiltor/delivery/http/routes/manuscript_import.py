from __future__ import annotations

import base64
import binascii

from quiltor.application.manuscript_import import (
    MAX_DOCX_BYTES,
    InvalidManuscriptFile,
    InvalidManuscriptSelection,
    ManuscriptLimitExceeded,
)
from quiltor.delivery.http.routes import Request, save


@save("/api/manuscript-import/preview")
def preview_manuscript(handler, request: Request, app) -> None:
    payload = _payload(handler, {"fileName", "dataBase64"}, {"selection"})
    content = _content(payload)
    with app.lock:
        preview = app.manuscript_import.preview(
            payload["fileName"], content, payload.get("selection")
        )
    handler.send_json({"ok": True, "preview": preview})


@save("/api/manuscript-import/import")
def import_manuscript(handler, request: Request, app) -> None:
    payload = _payload(
        handler,
        {
            "fileName",
            "dataBase64",
            "sourceSha256",
            "title",
            "chapters",
            "acknowledgedWarnings",
            "requestId",
        },
    )
    content = _content(payload)
    with app.lock:
        world = app.manuscript_import.publish(
            payload["fileName"],
            content,
            payload["sourceSha256"],
            payload["title"],
            payload["chapters"],
            payload["acknowledgedWarnings"],
            payload["requestId"],
            request.session.sub,
        )
    handler.send_json({"ok": True, "world": world}, 201)


@save("/api/manuscript-import/v2/preview")
def preview_manuscript_v2(handler, request: Request, app) -> None:
    payload = _payload(handler, {"fileName", "dataBase64"}, {"selection"})
    content = _content(payload)
    with app.lock:
        preview = app.manuscript_import.preview_v2(
            payload["fileName"], content, payload.get("selection")
        )
    handler.send_json({"ok": True, "preview": preview})


@save("/api/manuscript-import/v2/import")
def import_manuscript_v2(handler, request: Request, app) -> None:
    payload = _payload(
        handler,
        {
            "fileName",
            "dataBase64",
            "sourceSha256",
            "title",
            "chapters",
            "acknowledgedWarnings",
            "requestId",
        },
    )
    content = _content(payload)
    with app.lock:
        world = app.manuscript_import.publish_v2(
            payload["fileName"],
            content,
            payload["sourceSha256"],
            payload["title"],
            payload["chapters"],
            payload["acknowledgedWarnings"],
            payload["requestId"],
            request.session.sub,
        )
    handler.send_json({"ok": True, "world": world}, 201)


def _payload(handler, required: set[str], optional: set[str] | None = None) -> dict:
    try:
        payload = handler._read_json_body()
    except (UnicodeDecodeError, ValueError, TypeError) as error:
        raise InvalidManuscriptFile("The import request is not valid JSON.") from error
    if (
        not isinstance(payload, dict)
        or set(payload) - required - (optional or set())
        or not required.issubset(payload)
    ):
        raise InvalidManuscriptSelection("The import request fields are invalid.")
    file_name = payload.get("fileName")
    if not isinstance(file_name, str) or not file_name.strip() or len(file_name) > 1000:
        raise InvalidManuscriptFile("The source filename is invalid.")
    return payload


def _content(payload: dict) -> bytes:
    encoded = payload.get("dataBase64")
    if not isinstance(encoded, str) or not encoded:
        raise InvalidManuscriptFile("The DOCX data is missing.")
    if len(encoded) > ((MAX_DOCX_BYTES + 2) // 3) * 4:
        raise ManuscriptLimitExceeded("The decoded DOCX exceeds 8 MiB.")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise InvalidManuscriptFile("The DOCX data is not valid base64.") from error
    if len(content) > MAX_DOCX_BYTES:
        raise ManuscriptLimitExceeded("The decoded DOCX exceeds 8 MiB.")
    return content


__all__ = [
    "import_manuscript",
    "import_manuscript_v2",
    "preview_manuscript",
    "preview_manuscript_v2",
]
