"""Endpoint-bound backup credential composition.

World documents may name an endpoint, but they never decide where a bearer
credential is sent. This service binds every credential to a canonical endpoint
selected by configuration or an explicit per-endpoint login.
"""

from __future__ import annotations

from collections.abc import Callable

from quiltor.application.backups import BackupAuthorization
from quiltor.infrastructure.backup import remote


class EndpointBoundBackupAuthorizer:
    def __init__(
        self,
        *,
        default_endpoint: str | Callable[[], str],
        environment_token: str | Callable[[], str] = "",
        endpoint_token: Callable[[str], str] | None = None,
    ) -> None:
        self._default_endpoint_source = default_endpoint
        self._environment_token = environment_token
        self._endpoint_token = endpoint_token or (lambda _endpoint: "")

    @property
    def default_endpoint(self) -> str:
        configured = (
            self._default_endpoint_source()
            if callable(self._default_endpoint_source)
            else self._default_endpoint_source
        )
        return remote.canonical_endpoint(configured) if configured else ""

    def authorize_local(self, endpoint: str) -> BackupAuthorization:
        canonical = remote.canonical_endpoint(endpoint)
        endpoint_token = self._endpoint_token(canonical)
        if endpoint_token:
            return BackupAuthorization(canonical, endpoint_token)
        if canonical == self.default_endpoint:
            token = (
                self._environment_token()
                if callable(self._environment_token)
                else self._environment_token
            )
            return BackupAuthorization(canonical, token)
        raise PermissionError("Backup endpoint has not been authorized.")


__all__ = ["EndpointBoundBackupAuthorizer"]
