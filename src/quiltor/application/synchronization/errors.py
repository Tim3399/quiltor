"""Stable failures for manual cloud synchronization."""

from __future__ import annotations

from typing import Any

from quiltor.application.errors import (
    ApplicationConflict,
    ApplicationGatewayError,
    InvalidApplicationInput,
)


class SyncRequestInvalid(InvalidApplicationInput):
    code = "sync.request_invalid"


class SyncConflict(ApplicationConflict):
    code = "sync.conflict"


class SyncGatewayFailure(ApplicationGatewayError):
    """A structured failure returned by the configured cloud endpoint."""

    def __init__(
        self,
        code: str = "sync.unavailable",
        *,
        status: int = 502,
        head: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(code, params={"status": status, **({"head": head} if head else {})})
        self.code = code
        self.status = status
        self.head = head


__all__ = ["SyncConflict", "SyncGatewayFailure", "SyncRequestInvalid"]
