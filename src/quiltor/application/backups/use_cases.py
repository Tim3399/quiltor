"""Backup history, remote synchronization, restore, and login orchestration."""

from __future__ import annotations

from typing import Any

from quiltor.application.backups.ports import (
    BackupLoginGateway,
    BackupRepository,
    RemoteBackupGateway,
    SnapshotHistory,
)
from quiltor.application.backups.errors import BackupSnapshotNotFound
from quiltor.application.backups.types import BackupAuthorization, WorldBackupContext
from quiltor.application.documents.ports import DocumentRepository
from quiltor.application.documents.types import DocumentLocation
from quiltor.application.telemetry import UseCaseObserver
from quiltor.application.worlds.ports import WorldRepository


class BackupUseCases:
    def __init__(
        self,
        worlds: WorldRepository,
        documents: DocumentRepository,
        local_backups: BackupRepository,
        history: SnapshotHistory,
        remote: RemoteBackupGateway,
        login: BackupLoginGateway,
        observer: UseCaseObserver,
    ) -> None:
        self._worlds = worlds
        self._documents = documents
        self._local = local_backups
        self._history = history
        self._remote = remote
        self._login = login
        self._observer = observer

    def list_local(self, backups) -> list[dict[str, Any]]:
        return self._local.list_local(backups)

    def restore_local(self, name: str, location: DocumentLocation) -> None:
        with self._observer.observe("backup", "restore_local"):
            checkpoint = self._documents.revision_checkpoint(location.database)
            self._local.restore_local(name, location.database, location.backups, checkpoint)
            manuscript = self._documents.load("manuscript", location.database)
            story_world = self._documents.load("figures", location.database)
            self._local.mirror_manuscript(manuscript["chapters"], location.manuscript_mirrors)
            self._local.mirror_story_world(story_world, location.story_world_mirrors)

    def context(
        self,
        world_id: str,
        endpoint_url: str,
        location: DocumentLocation,
        *,
        title: str = "",
    ) -> WorldBackupContext:
        return self._history.context(
            world_id,
            endpoint_url,
            location.database,
            location.manuscript_mirrors,
            location.story_world_mirrors,
            title=title,
        )

    def status(self, context: WorldBackupContext) -> dict[str, Any]:
        return self._history.status(context)

    def commit(
        self,
        context: WorldBackupContext,
        message: str,
        push: bool,
        authorization: BackupAuthorization | None = None,
    ) -> dict[str, Any]:
        with self._observer.observe("backup", "commit"):
            return self._history.commit(context, message, push, authorization)

    def default_endpoint(self) -> str:
        return self._remote.default_endpoint()

    def list_remote_worlds(
        self, endpoint: str, authorization: BackupAuthorization
    ) -> list[dict[str, Any]]:
        with self._observer.observe("backup", "list_remote_worlds"):
            return self._remote.worlds(endpoint, authorization)

    def endpoint_for_world(self, world_id: str, owner_sub: str) -> str:
        opened = self._worlds.open(world_id, owner_sub)
        return opened.summary.backup_url or self.default_endpoint()

    def restore_remote(
        self,
        world_id: str,
        owner_sub: str,
        snapshot_id: str,
        endpoint: str,
        authorization: BackupAuthorization,
    ) -> dict[str, Any]:
        with self._observer.observe("backup", "restore_remote"):
            return self._restore_remote(world_id, owner_sub, snapshot_id, endpoint, authorization)

    def _restore_remote(
        self,
        world_id: str,
        owner_sub: str,
        snapshot_id: str,
        endpoint: str,
        authorization: BackupAuthorization,
    ) -> dict[str, Any]:
        try:
            opened = self._worlds.open(world_id, owner_sub)
        except FileNotFoundError:
            opened = None
        paths = opened.paths if opened is not None else self._worlds.paths_for(world_id)
        location = paths.documents
        context = self.context(
            world_id,
            endpoint,
            location,
            title=opened.summary.title if opened is not None else "",
        )
        previous_revisions = self._documents.revision_checkpoint(location.database)
        if self._documents.exists(location.database):
            self._history.commit(context, "Before restore", push=False, authorization=None)
        available = self._remote.snapshots(context, authorization)
        if not available:
            raise BackupSnapshotNotFound(params={"operation": "restore"})
        entry = (
            next(
                (
                    snapshot
                    for snapshot in reversed(available)
                    if snapshot["id"] == snapshot_id or snapshot["id"].startswith(snapshot_id)
                ),
                None,
            )
            if snapshot_id
            else available[-1]
        )
        if entry is None:
            raise BackupSnapshotNotFound(params={"operation": "restore"})
        result = self._history.restore(
            context,
            entry,
            fetch=lambda digest: self._remote.fetch_blob(context, digest, authorization),
        )
        self._worlds.finalize_restore(world_id, owner_sub, previous_revisions)
        return {
            "ok": True,
            **result,
            "title": entry.get("title", ""),
            "created": entry.get("created", ""),
        }

    def login_status(self, endpoint: str) -> dict[str, Any]:
        return self._login.status(endpoint)

    def begin_login(self, endpoint: str, redirect_uri: str) -> str:
        return self._login.begin(endpoint, redirect_uri)

    def end_login(self, endpoint: str) -> None:
        self._login.sign_out(endpoint)

    def complete_login(self, code: str, state: str, redirect_uri: str) -> None:
        self._login.complete(code, state, redirect_uri)

    def access_token(self, endpoint: str) -> str:
        return self._login.access_token(endpoint)


__all__ = ["BackupUseCases"]
