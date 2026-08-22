"""The two documents a world holds -- the manuscript and the figure board --
plus the book PDF rendered from them.

Both documents are read and written through the same pair of routes, which is
so both are coordinated by the same revisioned application operation.
"""

from __future__ import annotations

from quiltor.application import (
    InvalidDocumentState,
    InvalidDocumentWireV1,
    MAX_SAFE_REVISION,
    RevisionConflict,
    decode_document_v1,
    encode_document_v1,
)
from quiltor.delivery.http.routes import Request, get, save


@get("/api/state", world=True)
def read_figures(handler, request: Request, app) -> None:
    _read(handler, request, app, kind="figures")


@get("/api/manuscript", world=True)
def read_manuscript(handler, request: Request, app) -> None:
    _read(handler, request, app, kind="manuscript")


def _read(handler, request: Request, app, *, kind: str) -> None:
    with app.lock:
        document = app.documents.load(kind, request.db_path)
    try:
        envelope = encode_document_v1(kind, document.state, document.revision)
    except InvalidDocumentWireV1:
        return handler.send_api_error(
            500,
            error_code="document.invalid_persisted_state",
            retryable=False,
        )
    handler.send_json(envelope, headers={"ETag": f'"{document.revision}"'})


@save("/api/state", world=True)
def write_figures(handler, request: Request, app) -> None:
    _write(handler, request, app, kind="figures")


@save("/api/manuscript", world=True)
def write_manuscript(handler, request: Request, app) -> None:
    _write(handler, request, app, kind="manuscript")


def _write(handler, request: Request, app, *, kind: str) -> None:
    from datetime import datetime

    try:
        wire = decode_document_v1(kind, handler._read_json_body())
    except (InvalidDocumentWireV1, TypeError, ValueError):
        return handler.send_api_error(400, error_code="document.invalid_wire")

    match = handler.headers.get("If-Match", "").strip('"')
    try:
        header_revision = int(match) if match and match.isdecimal() else None
    except (ValueError, OverflowError):
        header_revision = None
    if match and (header_revision is None or not 0 <= header_revision <= MAX_SAFE_REVISION):
        return handler.send_api_error(400, error_code="document.invalid_revision")
    if (
        header_revision is not None
        and wire.revision is not None
        and header_revision != wire.revision
    ):
        return handler.send_api_error(400, error_code="document.revision_mismatch")
    expected = header_revision if header_revision is not None else wire.revision
    payload = wire.payload

    with app.lock:
        try:
            updated_revision = app.documents.save(
                kind, payload, expected, request.world.document_location
            )
        except (RevisionConflict, InvalidDocumentState):
            # Expected application failures are serialized exactly once by the
            # host's central exception mapper.
            raise

    now = datetime.now().strftime("%H:%M:%S")
    if kind == "manuscript":
        chapters = payload["chapters"]
        words = sum(len((c.get("body") or "").split()) for c in chapters)
        print(f"  · {now}  Text gespeichert — {len(chapters)} Kapitel, {words} Wörter")
    else:
        print(
            f"  · {now}  Figuren gespeichert — "
            f"{len(payload['nodes'])} Figuren, {len(payload['edges'])} Verbindungen"
        )
    handler.send_json(
        {"ok": True, "zeit": now, "revision": updated_revision},
        headers={"ETag": f'"{updated_revision}"'},
    )


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
    # The headless render can't log in for itself -- not interactively at
    # Keycloak, and not by borrowing a loopback session it has no cookie for
    # -- so it gets a short-lived token that redeems into a real session cookie
    # on its first request (see redeem_render_token).
    token = app.issue_render_token(request.session.sub)
    target = f"http://127.0.0.1:{port}/?world={world.id}&renderToken={token}"
    handler.send_pdf(app.render_pdf(target))
