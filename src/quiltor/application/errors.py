"""Transport-neutral failures exposed by application use cases.

Only stable machine data crosses a delivery boundary.  Exception messages are
kept for logs and local diagnostics; HTTP, MCP, and native hosts serialize the
``code``, ``params`` and ``retryable`` fields instead of translated prose.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class ApplicationError(Exception):
    """Base class for an expected application failure."""

    code = "application.failed"
    retryable = False

    def __init__(
        self,
        message: str = "",
        *,
        params: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message or self.code)
        self.params = dict(params or {})

    def structured(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "retryable": bool(self.retryable),
        }
        if self.params:
            payload["params"] = dict(self.params)
        return payload


class InvalidApplicationInput(ApplicationError):
    code = "request.invalid"


class ApplicationConflict(ApplicationError):
    code = "application.conflict"
    retryable = True


class ApplicationNotFound(ApplicationError):
    code = "application.not_found"


class ApplicationForbidden(ApplicationError):
    code = "application.forbidden"


class ApplicationUnavailable(ApplicationError):
    code = "application.unavailable"
    retryable = True


class ApplicationGatewayError(ApplicationError):
    """A trusted application operation failed at a remote service boundary."""

    code = "application.gateway_failed"
    retryable = True


class ApplicationNotSupported(ApplicationError):
    code = "application.not_supported"


class PdfExportUnavailable(ApplicationNotSupported):
    code = "pdf.unavailable"


__all__ = [
    "ApplicationConflict",
    "ApplicationError",
    "ApplicationForbidden",
    "ApplicationGatewayError",
    "ApplicationNotFound",
    "ApplicationNotSupported",
    "ApplicationUnavailable",
    "InvalidApplicationInput",
    "PdfExportUnavailable",
]
