"""Ports required by local and remote backup use cases."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Protocol

from quiltor.application.backups.types import BackupAuthorization, WorldBackupContext


class BackupRepository(Protocol):
    def backup_if_due(self, database: Path, backups: Path) -> None: ...
    def list_local(self, backups: Path) -> list[dict[str, Any]]: ...
    def restore_local(
        self,
        name: str,
        database: Path,
        backups: Path,
        previous_revisions: dict[str, int],
    ) -> None: ...
    def mirror_manuscript(self, chapters: list[dict[str, Any]], destination: Path) -> None: ...
    def mirror_story_world(self, state: dict[str, Any], destination: Path) -> None: ...
    def safe_name(self, title: str) -> str: ...


class SnapshotHistory(Protocol):
    def context(
        self,
        world_id: str,
        endpoint_url: str,
        database: Path,
        manuscripts: Path,
        profiles: Path,
        title: str = "",
    ) -> WorldBackupContext: ...
    def status(self, context: WorldBackupContext) -> dict[str, Any]: ...
    def commit(
        self,
        context: WorldBackupContext,
        message: str,
        push: bool,
        authorization: BackupAuthorization | None = None,
    ) -> dict[str, Any]: ...
    def restore(
        self,
        context: WorldBackupContext,
        entry: dict[str, Any],
        fetch: Callable[[str], bytes] | None = None,
    ) -> dict[str, Any]: ...


class RemoteBackupGateway(Protocol):
    def default_endpoint(self) -> str: ...
    def push(
        self,
        context: WorldBackupContext,
        entry: dict[str, Any],
        read_blob,
        authorization: BackupAuthorization,
    ) -> None: ...
    def worlds(self, endpoint: str, authorization: BackupAuthorization) -> list[dict[str, Any]]: ...
    def snapshots(
        self, context: WorldBackupContext, authorization: BackupAuthorization
    ) -> list[dict[str, Any]]: ...
    def fetch_blob(
        self,
        context: WorldBackupContext,
        digest: str,
        authorization: BackupAuthorization,
    ) -> bytes: ...


class BackupLoginGateway(Protocol):
    def status(self, endpoint: str) -> dict[str, Any]: ...
    def begin(self, endpoint: str, redirect_uri: str) -> str: ...
    def sign_out(self, endpoint: str) -> None: ...
    def complete(self, code: str, state: str, redirect_uri: str) -> None: ...
    def access_token(self, endpoint: str) -> str: ...


__all__ = ["BackupLoginGateway", "BackupRepository", "RemoteBackupGateway", "SnapshotHistory"]
