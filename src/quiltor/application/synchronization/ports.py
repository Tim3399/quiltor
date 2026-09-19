"""Ports used by synchronization orchestration."""

from __future__ import annotations

from typing import Any, Protocol

from quiltor.application.backups import BackupAuthorization, WorldBackupContext


class SyncRemoteGateway(Protocol):
    def account(self, endpoint: str, authorization: BackupAuthorization) -> dict[str, Any]: ...
    def sync_head(
        self, context: WorldBackupContext, authorization: BackupAuthorization
    ) -> dict[str, Any]: ...
    def compare_and_set_head(
        self,
        context: WorldBackupContext,
        expected_generation: int,
        snapshot_id: str,
        authorization: BackupAuthorization,
    ) -> dict[str, Any]: ...


class SyncStateStore(Protocol):
    def load(self, world_id: str, endpoint: str, account_id: str) -> dict[str, Any] | None: ...
    def save(
        self, world_id: str, endpoint: str, account_id: str, state: dict[str, Any]
    ) -> None: ...


__all__ = ["SyncRemoteGateway", "SyncStateStore"]
