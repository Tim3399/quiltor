"""The structured log schema: which events exist and which fields each may carry.

A log line is read by an operator looking for a cause, and it must never carry what
an author wrote. Both are decided here, once: an event registered in EVENTS writes
only its listed fields, and every field passes the rule in FIELD_RULES on the way
out. A request value reaches the log only through one of those rules.

Events that predate the schema are listed in LEGACY_EVENTS and keep their old
lines. A new event must be registered here; tests/python/test_server_logging.py
fails for any `logger.event(` literal under src/ that is in neither table.
"""

from __future__ import annotations

import base64
import re
import secrets
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from quiltor.infrastructure.persistence.sqlite.world_catalog import WORLD_ID_RE

INVALID = "<invalid>"
MAX_STRING = 256
MAX_TRACEBACK = 8 * 1024

_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._-]{8,64}")
# Same pattern as the `code` of contracts/application-api/structured-error/v1.
_CODE_RE = re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*")
_SUB_RE = re.compile(r"[A-Za-z0-9._:@-]+")
_ROUTE_RE = re.compile(r"[A-Za-z0-9/_.-]+")
_IDENTIFIER_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*")
_METHODS = frozenset({"GET", "PUT", "POST", "HEAD", "other"})
_LEVELS = frozenset({"debug", "info", "warning", "error"})


def _integer(value: Any) -> int | None:
    return value if type(value) is int else None


def _boolean(value: Any) -> bool | None:
    return value if type(value) is bool else None


def _text(limit: int = MAX_STRING) -> Callable[[Any], str | None]:
    def rule(value: Any) -> str | None:
        return value[:limit] if type(value) is str else None

    return rule


def _matching(pattern: re.Pattern[str], limit: int) -> Callable[[Any], str | None]:
    def rule(value: Any) -> str | None:
        if type(value) is not str or len(value) > limit or not pattern.fullmatch(value):
            return None
        return value

    return rule


def _code(value: Any) -> str:
    if type(value) is str and len(value) <= 128 and _CODE_RE.fullmatch(value):
        return value
    return "invalid_code"


def _sub(value: Any) -> str | None:
    if type(value) is not str:
        return None
    shortened = value[:64]
    return shortened if _SUB_RE.fullmatch(shortened) else None


def _world_id(value: Any) -> str | None:
    return value if type(value) is str and WORLD_ID_RE.fullmatch(value) else None


def _method(value: Any) -> str | None:
    return value if value in _METHODS else None


def _level(value: Any) -> str | None:
    return value if value in _LEVELS else None


FIELD_RULES: dict[str, Callable[[Any], Any | None]] = {
    "request_id": _matching(_REQUEST_ID_RE, 64),
    "request_id_rejected": _boolean,
    "method": _method,
    "route": _matching(_ROUTE_RE, 128),
    "status": _integer,
    "code": _code,
    "duration_ms": _integer,
    "bytes_in": _integer,
    "bytes_out": _integer,
    "sub": _sub,
    "world_id": _world_id,
    "world_id_invalid": _boolean,
    "message": _text(),
    "reason": _matching(_IDENTIFIER_RE, 128),
    "field": _matching(re.compile(r"(/[A-Za-z0-9_]+)+"), 128),
    "document": _matching(_IDENTIFIER_RE, 128),
    "expected": _integer,
    "actual": _integer,
    "error_type": _matching(_IDENTIFIER_RE, 128),
    # A name the code chose (push, worlds, fetch_blob, ...), never an endpoint or a world.
    "operation": _matching(_IDENTIFIER_RE, 64),
    "traceback": _text(MAX_TRACEBACK),
    "sqlite_code": _integer,
    "sqlite_name": _matching(_IDENTIFIER_RE, 128),
    "errno": _integer,
    "errno_name": _matching(_IDENTIFIER_RE, 128),
    "log_level": _level,
    "file": _text(),
    "transfer_encoding_present": _boolean,
    "roles_claim_present": _boolean,
}

_REQUEST = frozenset({"request_id", "method", "route"})
_WHO = frozenset({"sub", "world_id"})

EVENTS: dict[str, frozenset[str]] = {
    "http.access": _REQUEST
    | _WHO
    | {"status", "duration_ms", "bytes_in", "bytes_out", "request_id_rejected"},
    "http.error": _REQUEST | _WHO | {"status", "code", "message"},
    "http.unhandled": _REQUEST
    | {
        "status",
        "error_type",
        "message",
        "traceback",
        "reason",
        "transfer_encoding_present",
    },
    "document.save_rejected": frozenset(
        {"request_id", "document", "code", "reason", "field", "expected", "actual"}
    ),
    "document.save_conflict": frozenset({"request_id", "document", "expected", "actual"}),
    "world.resolve_failed": frozenset({"request_id", "world_id", "world_id_invalid", "reason"}),
    "storage.failed": frozenset(
        {"request_id", "code", "sqlite_code", "sqlite_name", "errno", "errno_name"}
    ),
    "logging.configured": frozenset({"log_level", "file"}),
    "install.forbidden_hosted": frozenset({"request_id", "route"}),
    "sync.forbidden_hosted": frozenset({"request_id", "route"}),
    # routes/backup.py reports these through _observe_failure: the exception's type only,
    # never its text, which can carry a path, an endpoint's answer or a world's name (T-122).
    **dict.fromkeys(
        (
            "backup.preview_failed",
            "backup.remote_worlds_failed",
            "backup.snapshot_failed",
            "backup.remote_restore_failed",
            "backup.local_restore_request_invalid",
            "backup.local_restore_failed",
            "backup.login_start_failed",
            "backup.login_callback_rejected",
            "backup.login_callback_failed",
        ),
        frozenset({"request_id", "error_type"}),
    ),
    # infrastructure/backup/adapters.py, when a call to the backup endpoint fails: which
    # call and the exception's type. The endpoint, the credentials and the exception's
    # text stay out (T-123).
    "backup.remote_request_failed": frozenset({"request_id", "operation", "error_type"}),
    # infrastructure/backup/snapshots.py, when the kind of a snapshot that was written
    # could not be recorded: the exception's type only, never its text or path (T-165).
    "backup.label_failed": frozenset({"request_id", "error_type"}),
    # Never email or name: `sub` is the one identifier an operator needs (D-49).
    "identity.login_without_roles": frozenset({"request_id", "sub", "roles_claim_present"}),
    # modules/assistant/jobs.py, when the job queue itself fails under a worker: which
    # worker (server or client) and the exception's type; the worker keeps running (T-61).
    "assistant.claim_failed": frozenset({"operation", "error_type"}),
}

# Events written before the schema existed. Their fields are not filtered, so their
# lines stay what they were. Moving one into EVENTS is welcome; adding one here is not.
LEGACY_EVENTS: frozenset[str] = frozenset(
    {
        "identity.token_exchange_failed",
        "place_map.upload_rejected",
        "assistant.worker_failed",
        "assistant.job_completed",
        "assistant.interaction_log_failed",
        "assistant.job_failed",
    }
)

# Routes a client polls. Their successful access lines are DEBUG, so the INFO log is
# not a list of polls; their errors are logged like any other. /api/capabilities is
# re-read while the assistant drawer is open (T-102, F-102-7).
QUIET_ROUTES: frozenset[str] = frozenset(
    {"/api/assistant/progress", "/api/assistant/status", "/api/capabilities"}
)

for _event, _fields in EVENTS.items():
    _unknown = _fields - FIELD_RULES.keys()
    if _unknown:
        raise RuntimeError(f"{_event} names fields without a rule: {sorted(_unknown)}")


# ------------------------------------------------------------- Request context


@dataclass(slots=True)
class RequestContext:
    """What every line written during one request may say about that request.

    `sub` and `world_id` stay empty until they are resolved: a world id that is
    only claimed by the query string is not yet the world this request acts on.
    """

    request_id: str
    method: str
    route: str
    sub: str | None = None
    world_id: str | None = None


current_request: ContextVar[RequestContext | None] = ContextVar("current_request", default=None)


@contextmanager
def request_scope(context: RequestContext) -> Iterator[RequestContext]:
    """Install `context` for one request. A keep-alive connection serves several
    requests on one thread, so the scope is reset after each, never left behind."""
    token = current_request.set(context)
    try:
        yield context
    finally:
        current_request.reset(token)


def new_request_id() -> str:
    """16 characters from [a-z2-7]: short enough to read out over the phone."""
    return base64.b32encode(secrets.token_bytes(10)).decode("ascii").lower()


def accept_request_id(header: str | None) -> tuple[str, bool]:
    """The id this request runs under, and whether a supplied one was refused.

    A proxy's id is kept when it is plausible -- UUIDs and 32 hex characters both
    are -- so one id follows the request through every log. Anything else is
    replaced, and the refused value is never written anywhere.
    """
    if header is None:
        return new_request_id(), False
    if _REQUEST_ID_RE.fullmatch(header):
        return header, False
    return new_request_id(), True


def method_bucket(command: str | None) -> str:
    return command if command in _METHODS else "other"


__all__ = [
    "EVENTS",
    "FIELD_RULES",
    "INVALID",
    "LEGACY_EVENTS",
    "MAX_STRING",
    "MAX_TRACEBACK",
    "QUIET_ROUTES",
    "RequestContext",
    "accept_request_id",
    "current_request",
    "method_bucket",
    "new_request_id",
    "request_scope",
]
