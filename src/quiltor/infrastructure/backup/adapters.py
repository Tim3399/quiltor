"""Object adapters for the remote-backup and login function modules."""

from __future__ import annotations

import time
from typing import Any, Callable, TypeVar

from quiltor.application.capabilities import Feature, FeatureAvailability
from quiltor.application.backups import BackupAuthorization, WorldBackupContext
from quiltor.application.observability import Metrics, StructuredLogger
from quiltor.infrastructure.backup import remote
from quiltor.infrastructure.backup.login import BackupLoginRuntime

T = TypeVar("T")


class HttpRemoteBackupGateway:
    def __init__(
        self,
        default_endpoint: str | Callable[[], str],
        capabilities: FeatureAvailability,
        *,
        structured_logger: StructuredLogger | None = None,
        metrics: Metrics | None = None,
    ) -> None:
        self._default_endpoint = default_endpoint
        self._capabilities = capabilities
        self._structured_logger = structured_logger
        self._metrics = metrics

    def _require_remote_backup(self) -> None:
        if not self._capabilities.is_available(Feature.REMOTE_BACKUP):
            raise PermissionError("Remote backup is unavailable in this runtime.")

    def default_endpoint(self) -> str:
        configured = (
            self._default_endpoint() if callable(self._default_endpoint) else self._default_endpoint
        )
        return remote.canonical_endpoint(configured) if configured else ""

    def _request(self, operation: str, call: Callable[[], T]) -> T:
        """Observe only bounded operation names, never endpoints or credentials."""

        started = time.monotonic()
        try:
            result = call()
        except Exception as exc:
            if self._metrics is not None:
                self._metrics.increment(
                    "backup_remote_requests_total",
                    operation=operation,
                    outcome="failure",
                    error_type=type(exc).__name__,
                )
            if self._structured_logger is not None:
                self._structured_logger.event(
                    "warning",
                    "backup.remote_request_failed",
                    operation=operation,
                    error_type=type(exc).__name__,
                )
            raise
        else:
            if self._metrics is not None:
                self._metrics.increment(
                    "backup_remote_requests_total",
                    operation=operation,
                    outcome="success",
                )
            return result
        finally:
            if self._metrics is not None:
                self._metrics.observe(
                    "backup_remote_request_duration_seconds",
                    time.monotonic() - started,
                    operation=operation,
                )

    def push(
        self,
        context: WorldBackupContext,
        entry: dict[str, Any],
        read_blob,
        authorization: BackupAuthorization,
    ) -> None:
        self._require_remote_backup()
        self._request("push", lambda: remote.push(context, entry, read_blob, authorization))

    def worlds(self, endpoint: str, authorization: BackupAuthorization) -> list[dict[str, Any]]:
        self._require_remote_backup()
        return self._request("worlds", lambda: remote.worlds(endpoint, authorization))

    def snapshots(
        self, context: WorldBackupContext, authorization: BackupAuthorization
    ) -> list[dict[str, Any]]:
        self._require_remote_backup()
        return self._request("snapshots", lambda: remote.snapshots(context, authorization))

    def fetch_blob(
        self,
        context: WorldBackupContext,
        digest: str,
        authorization: BackupAuthorization,
    ) -> bytes:
        self._require_remote_backup()
        return self._request(
            "fetch_blob", lambda: remote.fetch_blob(context, digest, authorization)
        )


class OidcBackupLoginGateway:
    def __init__(self, runtime: BackupLoginRuntime) -> None:
        self._runtime = runtime

    def status(self, endpoint: str) -> dict[str, Any]:
        return self._runtime.status(endpoint)

    def begin(self, endpoint: str, redirect_uri: str) -> str:
        return self._runtime.begin(endpoint, redirect_uri)

    def sign_out(self, endpoint: str) -> None:
        self._runtime.sign_out(endpoint)

    def complete(self, code: str, state: str, redirect_uri: str) -> None:
        self._runtime.complete(code, state, redirect_uri)

    def access_token(self, endpoint: str) -> str:
        return self._runtime.access_token(endpoint)


__all__ = ["HttpRemoteBackupGateway", "OidcBackupLoginGateway"]
