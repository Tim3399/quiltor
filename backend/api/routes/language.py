"""German writing tools: dictionary data and the grammar backend.

Whether a grammar backend exists at all is an edition decision made in
backend/language/grammar/; these routes only pass its answers through.
"""

from __future__ import annotations

from backend.api.routes import Request, get, save


@get("/api/language/status")
def status(handler, request: Request, app) -> None:
    handler.send_json({"ok": True, **app.LANGUAGE.status()})


@save("/api/language/install")
def install(handler, request: Request, app) -> None:
    try:
        handler.send_json(app.LANGUAGE.install())
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 500)


@save("/api/language/grammar/install")
def install_grammar(handler, request: Request, app) -> None:
    try:
        handler.send_json(app.LANGUAGE.install_grammar())
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 500)


@save("/api/language/lookup")
def lookup(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
        handler.send_json(
            app.LANGUAGE.lookup(
                str(payload.get("language", "")),
                str(payload.get("mode", "")),
                str(payload.get("query", "")),
            )
        )
    except FileNotFoundError as exc:
        handler.send_json({"ok": False, "fehler": str(exc), "code": "not_installed"}, 409)
    except ValueError as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)
    except Exception as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 500)


@save("/api/language/check")
def check(handler, request: Request, app) -> None:
    try:
        payload = handler._read_json_body()
        words = payload.get("customWords", [])
        if not isinstance(words, list):
            raise ValueError("invalid project dictionary")
        handler.send_json(
            app.LANGUAGE.check(
                str(payload.get("language", "")), str(payload.get("text", "")), words[:5000]
            )
        )
    except PermissionError as exc:
        handler.send_json(
            {"ok": False, "fehler": str(exc), "code": "external_opt_in_required"}, 403
        )
    except FileNotFoundError as exc:
        handler.send_json({"ok": False, "fehler": str(exc), "code": "not_installed"}, 409)
    except ValueError as exc:
        handler.send_json({"ok": False, "fehler": str(exc)}, 400)
    except Exception as exc:
        # 503 rather than 500: the usual cause is the grammar server not being
        # up, which is a temporary condition the frontend retries.
        handler.send_json({"ok": False, "fehler": str(exc)}, 503)
