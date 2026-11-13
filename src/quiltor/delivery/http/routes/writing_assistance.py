"""Writing-assistance HTTP transport."""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from quiltor.application.errors import ApplicationError
from quiltor.delivery.http import errors as http_errors
from quiltor.delivery.http.routes import Request, get, save

# The grammar check runs on one LanguageTool that every account of a hosted server shares,
# and a single request may cost it minutes of CPU (S268-103). Each account therefore gets
# a few checks at a time and a rate; past either the route answers 429 with Retry-After.
# Defaults are an assumption about normal typing (a debounced check every few seconds).
GRAMMAR_MAX_CONCURRENT_ENV = "QUILTOR_GRAMMAR_MAX_CONCURRENT"
GRAMMAR_MAX_PER_MINUTE_ENV = "QUILTOR_GRAMMAR_MAX_PER_MINUTE"
DEFAULT_GRAMMAR_MAX_CONCURRENT = 2
DEFAULT_GRAMMAR_MAX_PER_MINUTE = 30
GRAMMAR_RATE_WINDOW_SECONDS = 60.0


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, "") or default)
    except ValueError:
        return default
    return value if value > 0 else default


class GrammarLimiter:
    """Concurrent and per-minute limits per account; `acquire` returns a retry delay."""

    def __init__(self, clock=time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._running: dict[str, int] = defaultdict(int)
        self._starts: dict[str, deque[float]] = defaultdict(deque)

    def acquire(self, sub: str) -> int | None:
        """None when the check may start (call `release` after), else seconds to wait."""
        now = self._clock()
        with self._lock:
            starts = self._starts[sub]
            while starts and now - starts[0] >= GRAMMAR_RATE_WINDOW_SECONDS:
                starts.popleft()
            if self._running[sub] >= _env_int(
                GRAMMAR_MAX_CONCURRENT_ENV, DEFAULT_GRAMMAR_MAX_CONCURRENT
            ):
                return 5
            if len(starts) >= _env_int(GRAMMAR_MAX_PER_MINUTE_ENV, DEFAULT_GRAMMAR_MAX_PER_MINUTE):
                return max(1, int(GRAMMAR_RATE_WINDOW_SECONDS - (now - starts[0])) + 1)
            starts.append(now)
            self._running[sub] += 1
            return None

    def release(self, sub: str) -> None:
        with self._lock:
            self._running[sub] -= 1
            if self._running[sub] <= 0:
                del self._running[sub]


grammar_limiter = GrammarLimiter()


@get("/api/writing-assistance/status")
def status(handler, request: Request, app) -> None:
    # `installable` is False on a hosted server: the operator installs the data and
    # LanguageTool there, and the client shows no install button for either.
    status = app.writing_assistance.status()
    grammar = status.get("grammar")
    if isinstance(grammar, dict):
        status = {**status, "grammar": {**grammar, "installable": app.grammar_installable}}
    handler.send_json({"ok": True, **status, "installable": app.installable})


@save("/api/writing-assistance/install", operator_only=True)
def install(handler, request: Request, app) -> None:
    try:
        handler.send_json(app.writing_assistance.install())
    except Exception as exc:
        handler.send_exception(exc)


@save("/api/writing-assistance/grammar/install", operator_only=True)
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
    # Only a shared (hosted) server has someone to protect; locally the one user is not
    # throttled. Taken before the body is read, so a refused call costs no parsing.
    limited = not getattr(app, "installable", True)
    sub = request.session.sub if limited else ""
    if limited:
        retry_after = grammar_limiter.acquire(sub)
        if retry_after is not None:
            handler._discard_unread_body()
            error = http_errors.for_status(
                429, code="writing_assistance.rate_limited", retryable=True
            )
            return handler.send_json(
                error.payload(), error.status, headers={"Retry-After": retry_after}
            )
    try:
        _check(handler, app)
    finally:
        if limited:
            grammar_limiter.release(sub)


def _check(handler, app) -> None:
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
    except (ApplicationError, ValueError) as exc:
        # ApplicationError carries its own code (Java missing, server would not
        # start); the catch-all below would flatten it to grammar_unavailable.
        handler.send_exception(exc)
    except Exception:
        # 503 rather than 500: the usual cause is the grammar server not being
        # up, which is a temporary condition the frontend retries.
        handler.send_api_error(503, error_code="writing_assistance.grammar_unavailable")
