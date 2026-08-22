"""Stable application failures for backup operations."""

from quiltor.application.errors import (
    ApplicationConflict,
    ApplicationForbidden,
    ApplicationGatewayError,
    ApplicationNotFound,
    InvalidApplicationInput,
)


class BackupRequestInvalid(InvalidApplicationInput):
    code = "backup.request_invalid"


class BackupEndpointNotConfigured(ApplicationConflict):
    code = "backup.endpoint_not_configured"
    retryable = False


class BackupAuthorizationUnavailable(ApplicationForbidden):
    code = "backup.authorization_unavailable"


class BackupGatewayError(ApplicationGatewayError):
    code = "backup.gateway_failed"


class BackupSnapshotNotFound(ApplicationNotFound):
    code = "backup.snapshot_not_found"


class BackupRestoreFailed(InvalidApplicationInput):
    code = "backup.restore_failed"


__all__ = [
    "BackupAuthorizationUnavailable",
    "BackupEndpointNotConfigured",
    "BackupGatewayError",
    "BackupRequestInvalid",
    "BackupRestoreFailed",
    "BackupSnapshotNotFound",
]
