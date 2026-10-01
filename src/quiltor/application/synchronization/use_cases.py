"""Manual synchronization over immutable backup snapshots and a remote CAS head."""

from __future__ import annotations

import hashlib
import json
import tempfile
import threading
from contextlib import nullcontext
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from quiltor.application.backups import (
    BackupAuthorization,
    BackupEndpointNotConfigured,
    BackupGatewayError,
    RemoteBackupGateway,
    SnapshotHistory,
    WorldBackupContext,
)
from quiltor.application.document_wire_v1 import encode_document_v1
from quiltor.application.documents import DocumentRepository
from quiltor.application.synchronization.errors import (
    SyncConflict,
    SyncGatewayFailure,
    SyncRequestInvalid,
)
from quiltor.application.synchronization.ports import SyncStateStore
from quiltor.application.worlds import WorldRepository


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class SynchronizationUseCases:
    def __init__(
        self,
        worlds: WorldRepository,
        documents: DocumentRepository,
        history: SnapshotHistory,
        remote: RemoteBackupGateway,
        state: SyncStateStore,
    ) -> None:
        self._worlds = worlds
        self._documents = documents
        self._history = history
        self._remote = remote
        self._state = state
        self._sync_locks: dict[str, threading.Lock] = {}
        self._sync_locks_guard = threading.Lock()

    def _sync_lock(self, world_id: str) -> threading.Lock:
        with self._sync_locks_guard:
            return self._sync_locks.setdefault(world_id, threading.Lock())

    @staticmethod
    def _locked(local_lock):
        return local_lock if local_lock is not None else nullcontext()

    def _current_context(self, context: WorldBackupContext, owner_sub: str) -> WorldBackupContext:
        opened = self._worlds.open(context.root.name, owner_sub)
        location = opened.paths.documents
        return self._history.context(
            context.root.name,
            opened.summary.backup_url,
            location.database,
            location.manuscript_mirrors,
            location.story_world_mirrors,
            title=opened.summary.title,
        )

    @staticmethod
    def _same_endpoint(original: WorldBackupContext, current: WorldBackupContext) -> None:
        if original.endpoint_url != current.endpoint_url:
            raise SyncConflict(params={"reason": "configuration_changed"})

    def _preserve_local_conflict(self, context: WorldBackupContext) -> None:
        self._history.commit(context, "Cloud sync conflict (local)", push=False, authorization=None)

    def fingerprint(self, context: WorldBackupContext) -> str:
        material = {
            "title": context.title,
            "manuscript": self._documents.load("manuscript", context.database),
            "figures": self._documents.load("figures", context.database),
            "storyboards": self._documents.load("storyboards", context.database),
            # Image ids are SHA-256 digests of their complete bytes.
            "images": self._documents.image_digests(context.database),
        }
        encoded = json.dumps(
            material, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _account_id(account: dict[str, Any], owner_sub: str) -> str:
        del owner_sub
        value = account.get("accountId")
        if not isinstance(value, str) or not value:
            raise SyncGatewayFailure("sync.invalid_response", status=502)
        return value

    def _remote_context(
        self, context: WorldBackupContext, authorization: BackupAuthorization, owner_sub: str
    ) -> tuple[dict[str, Any], str, dict[str, Any]]:
        if not context.endpoint_url:
            raise BackupEndpointNotConfigured()
        account = self._remote.account(context.endpoint_url, authorization)
        account_id = self._account_id(account, owner_sub)
        head = self._remote.sync_head(context, authorization)
        return account, account_id, head

    def _acknowledge_pending(
        self,
        context: WorldBackupContext,
        account_id: str,
        head: dict[str, Any],
        saved: dict[str, Any] | None,
        owner_sub: str,
        local_lock,
    ) -> dict[str, Any] | None:
        if not saved:
            return saved
        pending_pull = saved.get("pendingPull")
        if isinstance(pending_pull, dict):
            target_head = {
                "generation": pending_pull.get("generation"),
                "snapshotId": pending_pull.get("snapshotId"),
            }
            target_fingerprint = pending_pull.get("targetFingerprint")
            previous_revisions = pending_pull.get("previousRevisions")
            if (
                target_head == head
                and isinstance(target_fingerprint, str)
                and isinstance(previous_revisions, dict)
                and all(type(value) is int and value >= 0 for value in previous_revisions.values())
            ):
                with self._locked(local_lock):
                    current = self._current_context(context, owner_sub)
                    self._same_endpoint(context, current)
                    current_fingerprint = self.fingerprint(current)
                    if current_fingerprint != target_fingerprint:
                        return saved
                    self._worlds.finalize_restore(context.root.name, owner_sub, previous_revisions)
                    completed = self._baseline(head, current_fingerprint, last_synced_at=_now())
                    self._state.save(context.root.name, context.endpoint_url, account_id, completed)
                return completed
        pending = saved.get("pending")
        if isinstance(pending, dict) and head.get("snapshotId") == pending.get("snapshotId"):
            fingerprint = pending.get("fingerprint")
            if isinstance(fingerprint, str):
                with self._locked(local_lock):
                    current = self._current_context(context, owner_sub)
                    self._same_endpoint(context, current)
                    self.fingerprint(current)
                    completed = self._baseline(head, fingerprint, last_synced_at=_now())
                    self._state.save(context.root.name, context.endpoint_url, account_id, completed)
                return completed
        return saved

    def status(
        self,
        context: WorldBackupContext,
        owner_sub: str,
        authorization: BackupAuthorization,
        *,
        local_lock=None,
    ) -> dict[str, Any]:
        with self._sync_lock(context.root.name):
            return self._status(context, owner_sub, authorization, local_lock=local_lock)

    def _status(
        self,
        context: WorldBackupContext,
        owner_sub: str,
        authorization: BackupAuthorization,
        *,
        local_lock,
    ) -> dict[str, Any]:
        with self._locked(local_lock):
            context = self._current_context(context, owner_sub)
            local = self.fingerprint(context)
        account, account_id, head = self._remote_context(context, authorization, owner_sub)
        with self._locked(local_lock):
            current = self._current_context(context, owner_sub)
            self._same_endpoint(context, current)
            context = current
            local = self.fingerprint(context)
        saved = self._state.load(context.root.name, context.endpoint_url, account_id)

        saved = self._acknowledge_pending(context, account_id, head, saved, owner_sub, local_lock)

        state = self._classify(local, head, saved)
        if state == "conflict":
            with self._locked(local_lock):
                current = self._current_context(context, owner_sub)
                self._same_endpoint(context, current)
                self._preserve_local_conflict(current)
                context = current
                local = self.fingerprint(current)
        return self._response(context, local, head, saved, state, account)

    @staticmethod
    def _classify(local: str, head: dict[str, Any], saved: dict[str, Any] | None) -> str:
        if saved is None or type(saved.get("baseGeneration")) is not int:
            return "local-pending" if head["snapshotId"] is None else "unlinked"
        local_changed = local != saved.get("baseFingerprint")
        remote_changed = head["generation"] != saved.get("baseGeneration") or head[
            "snapshotId"
        ] != saved.get("baseSnapshotId")
        if local_changed and remote_changed:
            return "conflict"
        if local_changed:
            return "local-pending"
        if remote_changed:
            return "remote-pending"
        return "synced"

    @staticmethod
    def _response(
        context: WorldBackupContext,
        local: str,
        head: dict[str, Any],
        saved: dict[str, Any] | None,
        state: str,
        account: dict[str, Any],
        *,
        reload_required: bool | None = None,
        local_snapshot_id: str | None = None,
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "ok": True,
            "configured": True,
            "endpoint": context.endpoint_url,
            "mode": "manual",
            "state": state,
            "localFingerprint": local,
            "baseGeneration": saved.get("baseGeneration") if saved else None,
            "remote": head,
            "lastSyncedAt": saved.get("lastSyncedAt") if saved else None,
            "account": account,
        }
        if reload_required is not None:
            result["reloadRequired"] = reload_required
        if local_snapshot_id is not None:
            result["localSnapshotId"] = local_snapshot_id
        return result

    @staticmethod
    def _baseline(head: dict[str, Any], fingerprint: str, *, last_synced_at: str) -> dict[str, Any]:
        return {
            "baseGeneration": head["generation"],
            "baseSnapshotId": head["snapshotId"],
            "baseFingerprint": fingerprint,
            "lastSyncedAt": last_synced_at,
        }

    def synchronize(
        self,
        context: WorldBackupContext,
        owner_sub: str,
        authorization: BackupAuthorization,
        action: str,
        *,
        expected_generation: int | None = None,
        expected_local_fingerprint: str = "",
        local_lock=None,
    ) -> dict[str, Any]:
        with self._sync_lock(context.root.name):
            return self._synchronize(
                context,
                owner_sub,
                authorization,
                action,
                expected_generation=expected_generation,
                expected_local_fingerprint=expected_local_fingerprint,
                local_lock=local_lock,
            )

    def _synchronize(
        self,
        context: WorldBackupContext,
        owner_sub: str,
        authorization: BackupAuthorization,
        action: str,
        *,
        expected_generation: int | None,
        expected_local_fingerprint: str,
        local_lock,
    ) -> dict[str, Any]:
        if action not in {"sync", "keep-local", "use-remote"}:
            raise SyncRequestInvalid(params={"field": "action"})
        with self._locked(local_lock):
            context = self._current_context(context, owner_sub)
            local = self.fingerprint(context)
        account, account_id, head = self._remote_context(context, authorization, owner_sub)
        with self._locked(local_lock):
            current = self._current_context(context, owner_sub)
            self._same_endpoint(context, current)
            context = current
            local = self.fingerprint(context)
        saved = self._state.load(context.root.name, context.endpoint_url, account_id)
        saved = self._acknowledge_pending(context, account_id, head, saved, owner_sub, local_lock)
        state = self._classify(local, head, saved)
        if state == "conflict":
            with self._locked(local_lock):
                current = self._current_context(context, owner_sub)
                self._same_endpoint(context, current)
                self._preserve_local_conflict(current)
                context = current
                local = self.fingerprint(current)

        if action in {"keep-local", "use-remote"}:
            if type(expected_generation) is not int or expected_generation < 0:
                raise SyncRequestInvalid(params={"field": "expectedGeneration"})
            if expected_generation != head["generation"] or expected_local_fingerprint != local:
                raise SyncConflict(
                    params={"head": head, "localFingerprint": local, "reason": "stale_resolution"}
                )

        if action == "sync":
            if state in {"synced", "conflict", "unlinked"}:
                return self._response(
                    context, local, head, saved, state, account, reload_required=False
                )
            if state == "remote-pending":
                return self._pull(
                    context,
                    owner_sub,
                    authorization,
                    account,
                    account_id,
                    head,
                    local,
                    local_lock,
                )
            expected_generation = head["generation"]
        elif action == "use-remote":
            if head["snapshotId"] is None:
                raise SyncConflict(params={"head": head, "reason": "remote_empty"})
            return self._pull(
                context,
                owner_sub,
                authorization,
                account,
                account_id,
                head,
                local,
                local_lock,
            )

        if account["access"] != "read-write":
            raise SyncGatewayFailure("cloud.read_only", status=403)
        try:
            return self._publish(
                context,
                authorization,
                account,
                account_id,
                head,
                local,
                int(expected_generation),
                owner_sub,
                local_lock,
            )
        except SyncGatewayFailure as exc:
            if action != "sync" or exc.code != "sync.conflict" or exc.head is None:
                raise
            current_saved = self._state.load(context.root.name, context.endpoint_url, account_id)
            return self._response(
                context,
                local,
                exc.head,
                current_saved,
                "conflict",
                account,
                reload_required=False,
            )

    def _publish(
        self,
        context: WorldBackupContext,
        authorization: BackupAuthorization,
        account: dict[str, Any],
        account_id: str,
        head: dict[str, Any],
        local: str,
        expected_generation: int,
        owner_sub: str,
        local_lock,
    ) -> dict[str, Any]:
        with self._locked(local_lock):
            current = self._current_context(context, owner_sub)
            self._same_endpoint(context, current)
            if self.fingerprint(current) != local:
                raise SyncConflict(params={"reason": "local_changed"})
            context = current
            self._history.commit(context, "Cloud sync", push=False, authorization=None)
            entries = self._history.entries(context)
            if not entries:
                raise SyncGatewayFailure("sync.snapshot_failed", status=502)
            snapshot_id = entries[-1]["id"]
        try:
            transfer_warning = self._history.upload(context, entries[-1], authorization)
        except BackupGatewayError as exc:
            if isinstance(exc.__cause__, SyncGatewayFailure):
                raise exc.__cause__ from exc
            raise
        pending = {
            "expectedGeneration": expected_generation,
            "snapshotId": snapshot_id,
            "fingerprint": local,
        }
        with self._locked(local_lock):
            current = self._current_context(context, owner_sub)
            self._same_endpoint(context, current)
            if self.fingerprint(current) != local:
                raise SyncConflict(params={"reason": "local_changed"})
            saved = self._state.load(context.root.name, context.endpoint_url, account_id) or {}
            self._state.save(
                context.root.name, context.endpoint_url, account_id, {**saved, "pending": pending}
            )
        updated = self._remote.compare_and_set_head(
            context, expected_generation, snapshot_id, authorization
        )
        baseline = self._baseline(updated, local, last_synced_at=_now())
        warnings: list[str] = []
        if transfer_warning is not None:
            warnings.append("sync.state_not_saved")
        with self._locked(local_lock):
            current = self._current_context(context, owner_sub)
            self._same_endpoint(context, current)
            current_fingerprint = self.fingerprint(current)
            try:
                self._state.save(context.root.name, context.endpoint_url, account_id, baseline)
                baseline_saved = True
            except OSError:
                baseline_saved = False
                if "sync.state_not_saved" not in warnings:
                    warnings.append("sync.state_not_saved")
        state = (
            ("synced" if current_fingerprint == local else "local-pending")
            if baseline_saved
            else "unlinked"
        )
        response = self._response(
            current,
            current_fingerprint,
            updated,
            baseline if baseline_saved else None,
            state,
            account,
            reload_required=False,
            local_snapshot_id=snapshot_id,
        )
        if warnings:
            response["warnings"] = warnings
        return response

    def _pull(
        self,
        context: WorldBackupContext,
        owner_sub: str,
        authorization: BackupAuthorization,
        account: dict[str, Any],
        account_id: str,
        head: dict[str, Any],
        expected_local: str,
        local_lock,
    ) -> dict[str, Any]:
        snapshot_id = head.get("snapshotId")
        if not isinstance(snapshot_id, str):
            raise SyncConflict(params={"head": head, "reason": "remote_empty"})
        snapshots = self._remote.snapshots(context, authorization)
        entry = next((item for item in snapshots if item.get("id") == snapshot_id), None)
        if entry is None:
            raise SyncGatewayFailure("sync.snapshot_unavailable", status=502)
        _documents, cached_blobs, target_fingerprint = self._validated_remote_documents(
            context, entry, authorization
        )
        # Recheck before any local mutation. A newer remote head must be surfaced,
        # while the selected immutable snapshot remains available for preview.
        current_head = self._remote.sync_head(context, authorization)
        if current_head != head:
            raise SyncConflict(params={"head": current_head, "reason": "remote_changed"})
        with self._locked(local_lock):
            current = self._current_context(context, owner_sub)
            self._same_endpoint(context, current)
            if self.fingerprint(current) != expected_local:
                raise SyncConflict(params={"reason": "local_changed"})
            context = current
            previous_revisions = self._documents.revision_checkpoint(context.database)
            safety_entry: dict[str, Any] | None = None
            if self._documents.exists(context.database):
                self._history.commit(context, "Before cloud sync", push=False, authorization=None)
                safety_entries = self._history.entries(context)
                safety_entry = safety_entries[-1] if safety_entries else None
            if safety_entry is None:
                raise SyncGatewayFailure("sync.safety_snapshot_failed", status=502)
            saved_before = (
                self._state.load(context.root.name, context.endpoint_url, account_id) or {}
            )
            pending_state = {
                **saved_before,
                "pendingPull": {
                    "generation": head["generation"],
                    "snapshotId": snapshot_id,
                    "targetFingerprint": target_fingerprint,
                    "safetySnapshotId": safety_entry["id"],
                    "previousRevisions": previous_revisions,
                },
            }
            self._state.save(context.root.name, context.endpoint_url, account_id, pending_state)
            try:
                self._history.restore(
                    context,
                    entry,
                    fetch=lambda digest: cached_blobs[digest],
                )
                self._worlds.finalize_restore(context.root.name, owner_sub, previous_revisions)
                restored_context = replace(context, title=str(entry.get("title", context.title)))
                local = self.fingerprint(restored_context)
                if local != target_fingerprint:
                    raise ValueError("Restored cloud content did not match staged content.")
            except Exception:
                try:
                    self._history.restore(context, safety_entry)
                except Exception as rollback_error:
                    restored_context = replace(
                        context, title=str(entry.get("title", context.title))
                    )
                    try:
                        recovered_fingerprint = self.fingerprint(restored_context)
                    except Exception as verification_error:
                        raise SyncGatewayFailure(
                            "sync.recovery_required", status=503
                        ) from verification_error
                    if recovered_fingerprint == target_fingerprint:
                        response = self._response(
                            restored_context,
                            recovered_fingerprint,
                            head,
                            None,
                            "unlinked",
                            account,
                            reload_required=True,
                            local_snapshot_id=safety_entry["id"],
                        )
                        response["warnings"] = ["sync.state_not_saved"]
                        return response
                    raise SyncGatewayFailure(
                        "sync.recovery_required", status=503
                    ) from rollback_error
                try:
                    self._state.save(
                        context.root.name,
                        context.endpoint_url,
                        account_id,
                        saved_before,
                    )
                except OSError:
                    pass
                raise
        baseline = self._baseline(head, local, last_synced_at=_now())
        warnings: list[str] = []
        try:
            with self._locked(local_lock):
                self._state.save(context.root.name, context.endpoint_url, account_id, baseline)
            response_state = "synced"
            response_saved: dict[str, Any] | None = baseline
        except OSError:
            warnings.append("sync.state_not_saved")
            response_state = "unlinked"
            response_saved = None
        response = self._response(
            restored_context,
            local,
            head,
            response_saved,
            response_state,
            account,
            reload_required=True,
            local_snapshot_id=safety_entry["id"],
        )
        if warnings:
            response["warnings"] = warnings
        return response

    def preview(
        self,
        context: WorldBackupContext,
        owner_sub: str,
        authorization: BackupAuthorization,
    ) -> dict[str, Any]:
        _account, _account_id, head = self._remote_context(context, authorization, owner_sub)
        snapshot_id = head.get("snapshotId")
        if not isinstance(snapshot_id, str):
            raise SyncConflict(params={"head": head, "reason": "remote_empty"})
        snapshots = self._remote.snapshots(context, authorization)
        entry = next((item for item in snapshots if item.get("id") == snapshot_id), None)
        if entry is None:
            raise SyncGatewayFailure("sync.snapshot_unavailable", status=502)
        documents, _cached, _target = self._validated_remote_documents(
            context, entry, authorization
        )
        stable = self._remote.sync_head(context, authorization)
        if stable != head:
            raise SyncConflict(params={"head": stable, "reason": "remote_changed"})
        return {
            "ok": True,
            "generation": head["generation"],
            "snapshotId": snapshot_id,
            "documents": documents,
        }

    def _validated_remote_documents(
        self,
        context: WorldBackupContext,
        entry: dict[str, Any],
        authorization: BackupAuthorization,
    ) -> tuple[dict[str, Any], dict[str, bytes], str]:
        """Materialize and validate an untrusted snapshot away from the active world."""

        cached_blobs: dict[str, bytes] = {}

        def fetch(digest: str) -> bytes:
            if digest not in cached_blobs:
                cached_blobs[digest] = self._remote.fetch_blob(context, digest, authorization)
            return cached_blobs[digest]

        with tempfile.TemporaryDirectory() as raw:
            # macOS commonly returns temporary paths below /var, which is a symlink to
            # /private/var. Resolve this trusted, freshly created root before handing its
            # descendants to the snapshot store's link/reparse safety boundary.
            root = Path(raw).resolve()
            temporary = WorldBackupContext(
                root=root / "history" / context.root.name,
                database=root / "world.sqlite3",
                manuscripts=root / "manuscripts",
                profiles=root / "profiles",
                endpoint_url=context.endpoint_url,
                title=str(entry.get("title", "")),
            )
            self._history.restore(
                temporary,
                entry,
                fetch=fetch,
            )
            documents = {
                kind: self._documents.load(kind, temporary.database)
                for kind in ("manuscript", "figures", "storyboards")
            }
            for kind, document in documents.items():
                encode_document_v1(kind, document)
            target_fingerprint = self.fingerprint(temporary)
            return documents, cached_blobs, target_fingerprint


__all__ = ["SynchronizationUseCases"]
