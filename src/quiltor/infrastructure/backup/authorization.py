"""Endpoint-bound backup credential composition.

World documents may name an endpoint, but they never decide where a bearer
credential is sent. This service binds every credential to a canonical endpoint
selected by configuration or an explicit per-endpoint login.
"""

from __future__ import annotations

import threading
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
        expected_hosted_issuer: str = "",
    ) -> None:
        self._default_endpoint_source = default_endpoint
        self._environment_token = environment_token
        self._endpoint_token = endpoint_token or (lambda _endpoint: "")
        self._expected_hosted_issuer = expected_hosted_issuer.rstrip("/")
        self._issuer_checks: dict[str, bool] = {}
        self._lock = threading.Lock()

    @property
    def default_endpoint(self) -> str:
        configured = (
            self._default_endpoint_source()
            if callable(self._default_endpoint_source)
            else self._default_endpoint_source
        )
        return remote.canonical_endpoint(configured) if configured else ""

    def _hosted_issuer_matches(self, endpoint: str) -> bool:
        if not self._expected_hosted_issuer:
            return False
        with self._lock:
            cached = self._issuer_checks.get(endpoint)
        if cached is not None:
            return cached
        document = remote.resource_metadata(endpoint)
        servers = document.get("authorization_servers")
        valid = (
            isinstance(servers, list)
            and len(servers) == 1
            and isinstance(servers[0], str)
            and servers[0].rstrip("/") == self._expected_hosted_issuer
        )
        with self._lock:
            self._issuer_checks[endpoint] = valid
        return valid

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

    def authorize_hosted(self, endpoint: str, session_token: str) -> BackupAuthorization:
        canonical = remote.canonical_endpoint(endpoint)
        if canonical != self.default_endpoint:
            raise PermissionError("Backup endpoint is not configured for this host.")
        if not self._hosted_issuer_matches(canonical):
            raise PermissionError("Backup endpoint issuer does not match this host.")
        return BackupAuthorization(canonical, session_token)


__all__ = ["EndpointBoundBackupAuthorizer"]
