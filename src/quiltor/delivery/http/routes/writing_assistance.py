"""Writing-assistance HTTP transport."""

from __future__ import annotations

from quiltor.delivery.http.routes import Request, get, save


@get("/api/writing-assistance/status")
def status(handler, request: Request, app) -> None:
    handler.send_json({"ok": True, **app.writing_assistance.status()})


@save("/api/writing-assistance/install")
def install(handler, request: Request, app) -> None:
    try:
        handler.send_json(app.writing_assistance.install())
    except Exception as exc:
        handler.send_exception(exc)


@save("/api/writing-assistance/grammar/install")
def install_grammar(handler, request: Request, app) -> None:
    try:
        handler.send_json(app.writing_assistance.install_grammar())
    except Exception as exc:
        handler.send_exception(exc)


@save("/api/writing-assistance/lookup")
def lookup(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
        handler.send_json(
            app.writing_assistance.lookup(
                str(payload.get("language", "")),
                str(payload.get("mode", "")),
                str(payload.get("query", "")),
            )
        )
    except FileNotFoundError:
        handler.send_api_error(
            409,
            error_code="writing_assistance.not_installed",
            retryable=False,
        )
    except ValueError as exc:
        handler.send_exception(exc)
    except Exception as exc:
        handler.send_exception(exc)


@save("/api/writing-assistance/check")
def check(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
        words = payload.get("customWords", [])
        if not isinstance(words, list):
            raise ValueError("invalid project dictionary")
        handler.send_json(
            app.writing_assistance.check(
                str(payload.get("language", "")), str(payload.get("text", "")), words[:5000]
            )
        )
    except PermissionError:
        handler.send_api_error(
            403,
            error_code="writing_assistance.external_opt_in_required",
            retryable=False,
        )
    except FileNotFoundError:
        handler.send_api_error(
            409,
            error_code="writing_assistance.not_installed",
            retryable=False,
        )
    except ValueError as exc:
        handler.send_exception(exc)
    except Exception:
        # 503 rather than 500: the usual cause is the grammar server not being
        # up, which is a temporary condition the frontend retries.
        handler.send_api_error(503, error_code="writing_assistance.grammar_unavailable")
