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


class GrammarSlot:
    """One running check. `superseded` is set when a newer check of the same session took
    its place; the route then drops the result it computed (F-268-20)."""

    __slots__ = ("key", "sub", "superseded")

    def __init__(self, sub: str, key: str) -> None:
        self.sub = sub
        self.key = key
        self.superseded = False


class GrammarLimiter:
    """Concurrent and per-minute limits per account; `acquire` returns a slot or a retry delay.

    The concurrent limit counts calls running inside LanguageTool, whichever session sent
    them. Per account and session only the newest check's result counts: a newer check marks
    the older one `superseded`, but the older one keeps its place until its call has returned,
    because the server cannot interrupt a thread inside LanguageTool (F-268-24). When the
    limit is full, a newer check of the same session is refused at once like any other.
    """

    def __init__(self, clock=time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._running: dict[str, int] = defaultdict(int)
        self._starts: dict[str, deque[float]] = defaultdict(deque)
        self._latest: dict[tuple[str, str], GrammarSlot] = {}

    def acquire(self, sub: str, key: str = "") -> GrammarSlot | int:
        """A slot when the check may start (pass it to `release`), else seconds to wait."""
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
            older = self._latest.get((sub, key))
            if older is not None:
                older.superseded = True  # still counted until its own release
            starts.append(now)
            self._running[sub] += 1
            slot = GrammarSlot(sub, key)
            self._latest[(sub, key)] = slot
            return slot

    def release(self, slot: GrammarSlot) -> None:
        with self._lock:
            if self._latest.get((slot.sub, slot.key)) is slot:
                del self._latest[(slot.sub, slot.key)]
            self._running[slot.sub] -= 1
            if self._running[slot.sub] <= 0:
                del self._running[slot.sub]


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
    slot = None
    if limited:
        session = request.session
        granted = grammar_limiter.acquire(session.sub, session.session_id or session.sub)
        if isinstance(granted, int):
            handler._discard_unread_body()
            return _rate_limited(handler, granted)
        slot = granted
    try:
        _check(handler, app, slot)
    finally:
        if slot is not None:
            grammar_limiter.release(slot)


def _rate_limited(handler, retry_after: int) -> None:
    error = http_errors.for_status(429, code="writing_assistance.rate_limited", retryable=True)
    handler.send_json(error.payload(), error.status, headers={"Retry-After": retry_after})


def _check(handler, app, slot: GrammarSlot | None = None) -> None:
    try:
        payload = handler._read_json_body()
        words = payload.get("customWords", [])
        if not isinstance(words, list):
            raise ValueError("invalid project dictionary")
        result = app.writing_assistance.check(
            str(payload.get("language", "")), str(payload.get("text", "")), words[:5000]
        )
        if slot is not None and slot.superseded:
            # A newer check of this session took the place; this answer is stale. Say so
            # with the existing 429 rather than hand back text the editor has moved past.
            return _rate_limited(handler, 1)
        handler.send_json(result)
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
