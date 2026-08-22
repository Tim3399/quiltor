"""Stable JSON error envelopes for the HTTP delivery boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from quiltor.application import (
    ApplicationConflict,
    ApplicationError,
    ApplicationForbidden,
    ApplicationGatewayError,
    ApplicationNotFound,
    ApplicationNotSupported,
    ApplicationUnavailable,
    PdfExportUnavailable,
    RevisionConflict,
)


_STATUS_CODES = {
    400: "request.invalid",
    401: "auth.unauthenticated",
    403: "request.forbidden",
    404: "request.not_found",
    405: "request.method_not_allowed",
    409: "application.conflict",
    413: "request.payload_too_large",
    500: "application.internal_error",
    501: "application.not_supported",
    502: "application.gateway_failed",
    503: "application.unavailable",
    504: "application.gateway_timeout",
}


@dataclass(frozen=True, slots=True)
class HttpError:
    status: int
    code: str
    params: Mapping[str, Any]
    retryable: bool

    def payload(self) -> dict[str, Any]:
        error: dict[str, Any] = {
            "code": self.code,
            "retryable": self.retryable,
        }
        if self.params:
            error["params"] = dict(self.params)
        return {"ok": False, "error": error}


def for_status(
    status: int,
    *,
    code: str = "",
    params: Mapping[str, Any] | None = None,
    retryable: bool | None = None,
) -> HttpError:
    selected_status = int(status)
    return HttpError(
        selected_status,
        code or _STATUS_CODES.get(selected_status, "application.failed"),
        dict(params or {}),
        selected_status in {409, 500, 502, 503, 504} if retryable is None else retryable,
    )


def from_exception(error: Exception) -> HttpError:
    if isinstance(error, ApplicationError):
        status = 400
        if isinstance(error, (RevisionConflict, ApplicationConflict)):
            status = 409
        elif isinstance(error, ApplicationGatewayError):
            status = 502
        elif isinstance(error, (PdfExportUnavailable, ApplicationNotSupported)):
            status = 501
        elif isinstance(error, ApplicationNotFound):
            status = 404
        elif isinstance(error, ApplicationForbidden):
            status = 403
        elif isinstance(error, ApplicationUnavailable):
            status = 503
        return for_status(
            status,
            code=error.code,
            params=error.params,
            retryable=error.retryable,
        )
    if isinstance(error, (UnicodeDecodeError, TypeError, ValueError)):
        return for_status(400, code="request.invalid")
    if isinstance(error, PermissionError):
        return for_status(403)
    if isinstance(error, FileNotFoundError):
        return for_status(404)
    if isinstance(error, TimeoutError):
        return for_status(504)
    if isinstance(error, NotImplementedError):
        return for_status(501)
    return for_status(500)


def normalize_payload(payload: Any, status: int) -> Any:
    """Normalize every failed HTTP payload to structured-error v1.

    Domain response data may remain beside ``error`` (for example a capability
    status), but legacy translated prose and duplicate code fields are removed.
    """

    if not isinstance(payload, Mapping) or payload.get("ok") is not False:
        return payload
    current = payload.get("error")
    if (
        isinstance(current, Mapping)
        and isinstance(current.get("code"), str)
        and isinstance(current.get("retryable"), bool)
    ):
        error = {
            "code": current["code"],
            "retryable": current["retryable"],
        }
        if isinstance(current.get("params"), Mapping):
            error["params"] = dict(current["params"])
        retained = {
            key: value
            for key, value in payload.items()
            if key not in {"fehler", "grund", "code", "errorType", "error"}
        }
        return {**retained, "error": error}
    fallback = for_status(status)
    code = payload.get("code") or payload.get("errorType") or fallback.code
    retained = {
        key: value
        for key, value in payload.items()
        if key not in {"fehler", "grund", "code", "errorType", "error"}
    }
    return {
        **retained,
        "error": {
            "code": str(code),
            "retryable": fallback.retryable,
        },
    }


def normalize_response(payload: Any, status: int) -> tuple[Any, int]:
    """Normalize an envelope and fail closed when an error claims HTTP success."""

    selected_status = int(status)
    if isinstance(payload, Mapping) and payload.get("ok") is False and selected_status < 400:
        invalid = for_status(
            500,
            code="application.invalid_error_status",
            retryable=True,
        )
        return invalid.payload(), invalid.status
    return normalize_payload(payload, selected_status), selected_status


__all__ = [
    "HttpError",
    "for_status",
    "from_exception",
    "normalize_payload",
    "normalize_response",
]
