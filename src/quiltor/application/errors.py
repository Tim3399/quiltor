"""Transport-neutral failures exposed by application use cases.

Only stable machine data crosses a delivery boundary.  Exception messages are
kept for logs and local diagnostics; HTTP, MCP, and native hosts serialize the
``code``, ``params`` and ``retryable`` fields instead of translated prose.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, NotRequired, TypedDict


class StructuredError(TypedDict):
    """An application failure as every host serializes it."""

    code: str
    retryable: bool
    params: NotRequired[dict[str, Any]]


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

    def structured(self) -> StructuredError:
        payload: StructuredError = {
            "code": self.code,
            "retryable": bool(self.retryable),
        }
        if self.params:
            payload["params"] = dict(self.params)
        return payload


class InvalidApplicationInput(ApplicationError):
    code = "request.invalid"


class SchemaNewerThanSupported(ApplicationError, ValueError):
    """Stored data was written by a newer version than this one can read.

    Raised for a world database, a restored version or a pulled snapshot whose schema is
    ahead of this build. The author is told to update, instead of getting a generic
    "invalid request". Still a ValueError: callers that already caught the old error keep
    working.
    """

    code = "storage.schema_newer"

    def __init__(self, found: int, supported: int) -> None:
        super().__init__(
            f"Database schema version {found} is newer than supported version {supported}.",
            params={"found": found, "supported": supported},
        )


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


#: The only things a failed PDF render may say about itself. Chosen by the renderer from
#: stderr, never copied from it: stderr can carry the render URL with its one-shot token.
PDF_FAILURE_CATEGORIES = (
    "sandbox_unavailable",
    "browser_launch_failed",
    "timeout",
    "page_error",
    "unknown",
)


class PdfRendererError(ApplicationGatewayError):
    """The PDF renderer ran and failed. Carries a category and an exit code, no text."""

    code = "pdf.render_failed"

    def __init__(self, category: str, exit_code: int | None = None) -> None:
        if category not in PDF_FAILURE_CATEGORIES:
            category = "unknown"
        if category == "sandbox_unavailable":
            # The operator has to change the profile or set the switch; asking again helps nothing.
            self.code = "pdf.sandbox_unavailable"
            self.retryable = False
        super().__init__(params={"category": category})
        self.category = category
        self.exit_code = exit_code


__all__ = [
    "PDF_FAILURE_CATEGORIES",
    "ApplicationConflict",
    "ApplicationError",
    "ApplicationForbidden",
    "ApplicationGatewayError",
    "ApplicationNotFound",
    "ApplicationNotSupported",
    "ApplicationUnavailable",
    "InvalidApplicationInput",
    "PdfExportUnavailable",
    "PdfRendererError",
    "SchemaNewerThanSupported",
]
