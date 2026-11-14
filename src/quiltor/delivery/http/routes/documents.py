"""The independently revisioned documents a world holds, plus book export.

Manuscript, canonical story-world state, and non-canon Storyboards all pass
through the same strict document boundary without sharing persistence state.
"""

from __future__ import annotations

from quiltor.application import (
    MAX_SAFE_REVISION,
    InvalidDocumentState,
    InvalidDocumentWireV1,
    PdfRendererError,
    RevisionConflict,
    decode_document_v1,
    encode_document_v1,
)
from quiltor.application.documents import DocumentKind
from quiltor.delivery.http.routes import Request, get, save
from quiltor.delivery.http.world_quota import refuse_growth_over_quota


@get("/api/state", world=True)
def read_figures(handler, request: Request, app) -> None:
    _read(handler, request, app, kind="figures")


@get("/api/manuscript", world=True)
def read_manuscript(handler, request: Request, app) -> None:
    _read(handler, request, app, kind="manuscript")


@get("/api/storyboards", world=True)
def read_storyboards(handler, request: Request, app) -> None:
    _read(handler, request, app, kind="storyboards")


def _read(handler, request: Request, app, *, kind: DocumentKind) -> None:
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


@save("/api/storyboards", world=True)
def write_storyboards(handler, request: Request, app) -> None:
    _write(handler, request, app, kind="storyboards")


def _write(handler, request: Request, app, *, kind: DocumentKind) -> None:
    from datetime import datetime

    # A save adds bytes (the mirrors, the document itself); over the byte limit of a hosted
    # account it is refused before the body is read (F-268-18).
    with app.lock:
        if refuse_growth_over_quota(handler, request):
            return
    try:
        wire = decode_document_v1(kind, handler._read_json_body())
    except (InvalidDocumentWireV1, TypeError, ValueError) as error:
        _log_rejected(handler, kind, "document.invalid_wire", **_wire_rejection(error))
        return handler.send_api_error(400, error_code="document.invalid_wire")

    match = handler.headers.get("If-Match", "").strip('"')
    try:
        header_revision = int(match) if match and match.isdecimal() else None
    except (ValueError, OverflowError):
        header_revision = None
    if match and (header_revision is None or not 0 <= header_revision <= MAX_SAFE_REVISION):
        # The header itself stays out of the log: it is whatever the client sent.
        _log_rejected(handler, kind, "document.invalid_revision", reason="if_match_invalid")
        return handler.send_api_error(400, error_code="document.invalid_revision")
    if (
        header_revision is not None
        and wire.revision is not None
        and header_revision != wire.revision
    ):
        _log_rejected(
            handler,
            kind,
            "document.revision_mismatch",
            reason="revision_mismatch",
            expected=header_revision,
            actual=wire.revision,
        )
        return handler.send_api_error(400, error_code="document.revision_mismatch")
    expected = header_revision if header_revision is not None else wire.revision
    payload = wire.payload

    with app.lock:
        try:
            saved = app.documents.save_with_status(
                kind, payload, expected, request.world.document_location
            )
        except RevisionConflict as conflict:
            handler.log_rejection(
                "document.save_conflict",
                document=kind,
                expected=conflict.params.get("expected"),
                actual=conflict.params.get("actual"),
            )
            raise
        except InvalidDocumentState:
            # Expected application failures are serialized exactly once by the
            # host's central exception mapper.
            raise

    updated_revision = saved.revision
    # The write above already made a preview of the example world real, in its own
    # transaction; this gives it its title "(2)" if needed and tells the client (T-214-5a).
    promoted = None
    if getattr(request.world, "preview", False):
        with app.lock:
            promoted = app.finish_promotion(request.world.id)
    now = datetime.now().strftime("%H:%M:%S")
    if kind == "manuscript":
        chapters = payload["chapters"]
        words = sum(len((c.get("body") or "").split()) for c in chapters)
        print(f"  · {now}  Manuscript saved — {len(chapters)} chapters, {words} words")
    elif kind == "figures":
        print(
            f"  · {now}  Story world saved — "
            f"{len(payload['nodes'])} elements, {len(payload['edges'])} relationships"
        )
    else:
        boards = payload["boards"]
        print(f"  · {now}  Storyboards saved — {len(boards)} boards, {len(payload['nodes'])} cards")
    handler.send_json(
        {
            "ok": True,
            "zeit": now,
            "revision": updated_revision,
            **({"warnings": list(saved.warnings)} if saved.warnings else {}),
            **({"world": promoted} if promoted is not None else {}),
        },
        headers={"ETag": f'"{updated_revision}"'},
    )


def _wire_rejection(error: Exception) -> dict[str, str]:
    """Why the body was refused, in words the log may carry.

    Both the wire decoder and the body reader name a fixed reason; anything else
    gets a fixed bucket, never ``str(error)``.
    """

    if isinstance(error, InvalidDocumentWireV1):
        fields = {"reason": error.reason}
        if error.field:
            fields["field"] = error.field
        return fields
    reason = getattr(error, "reason", None)
    return {"reason": reason if isinstance(reason, str) else "body_invalid"}


def _log_rejected(handler, kind: DocumentKind, code: str, **fields) -> None:
    handler.log_rejection("document.save_rejected", document=kind, code=code, **fields)


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
    target = f"http://127.0.0.1:{port}/?world={world.id}&renderToken={token}&bookRender=1"
    try:
        body = app.render_pdf(target)
    except PdfRendererError as error:
        # Category and exit code only: the renderer's stderr can carry the render URL and
        # its token, and PdfRendererError never holds it.
        handler.application.observability.logger.event(
            "error",
            "pdf.render_failed",
            category=error.category,
            exit_code=error.exit_code,
        )
        raise
    handler.send_pdf(body)
