"""Behavioral tests for manual synchronization over immutable snapshots."""

from __future__ import annotations

import importlib.util
import os
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from quiltor.application.backup_manifest import BackupContractError
from quiltor.application.backups import BackupAuthorization, WorldBackupContext
from quiltor.application.synchronization import (
    SyncConflict,
    SyncGatewayFailure,
    SynchronizationUseCases,
)
from quiltor.infrastructure.backup import remote as remote_transport
from quiltor.infrastructure.backup.adapters import HttpRemoteBackupGateway
from quiltor.infrastructure.backup.snapshots import SnapshotStore
from quiltor.infrastructure.backup.sync_state import JsonSyncStateStore
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.sqlite import revisions, schema
from quiltor.infrastructure.persistence.sqlite.connection import connection
from tests.python.fake_issuer import FakeIssuer

REFERENCE_SERVER = Path(__file__).resolve().parents[2] / "services" / "backup-server" / "server.py"


class _Worlds:
    def open(self, world_id, owner_sub):
        del world_id, owner_sub
        context = self.context
        return SimpleNamespace(
            summary=SimpleNamespace(
                backup_url=context.endpoint_url,
                title=context.title,
            ),
            paths=SimpleNamespace(
                documents=SimpleNamespace(
                    database=context.database,
                    manuscript_mirrors=context.manuscripts,
                    story_world_mirrors=context.profiles,
                )
            ),
        )

    def finalize_restore(self, world_id, owner_sub, previous_revisions):
        del world_id, owner_sub
        revisions.advance_restore_revisions(previous_revisions, db_path=self.database)


class _Remote:
    def __init__(self):
        self.blobs = {}
        self.snapshots_by_world = {}
        self.heads = {}
        self.access = "read-write"
        self.account_id = "account-a"
        self.lose_next_cas_response = False
        self.on_push = None
        self.on_fetch = None

    def default_endpoint(self):
        return "http://127.0.0.1:9911"

    def account(self, endpoint, authorization):
        del endpoint, authorization
        return {
            "accountId": self.account_id,
            "access": self.access,
            "usedBytes": sum(len(value) for value in self.blobs.values()),
            "limitBytes": None,
            "deleteAfter": None,
        }

    def push(self, context, entry, read_blob, authorization):
        del authorization
        for record in entry["files"].values():
            digest = record["sha256"] if isinstance(record, dict) else record
            self.blobs[digest] = read_blob(digest)
        self.snapshots_by_world.setdefault(context.root.name, {})[entry["id"]] = entry
        if self.on_push is not None:
            callback, self.on_push = self.on_push, None
            callback()

    def worlds(self, endpoint, authorization):
        del endpoint, authorization
        return []

    def snapshots(self, context, authorization):
        del authorization
        return list(self.snapshots_by_world.get(context.root.name, {}).values())

    def fetch_blob(self, context, digest, authorization):
        del context, authorization
        if self.on_fetch is not None:
            callback, self.on_fetch = self.on_fetch, None
            callback()
        return self.blobs[digest]

    def sync_head(self, context, authorization):
        del authorization
        return dict(self.heads.get(context.root.name, {"generation": 0, "snapshotId": None}))

    def compare_and_set_head(self, context, expected_generation, snapshot_id, authorization):
        del authorization
        current = self.sync_head(context, None)
        if current["snapshotId"] == snapshot_id:
            return current
        if current["generation"] != expected_generation:
            raise SyncGatewayFailure("sync.conflict", status=409, head=current)
        updated = {"generation": expected_generation + 1, "snapshotId": snapshot_id}
        self.heads[context.root.name] = updated
        if self.lose_next_cas_response:
            self.lose_next_cas_response = False
            raise SyncGatewayFailure("sync.unavailable", status=502)
        return dict(updated)


class _FailingState:
    def load(self, world_id, endpoint, account_id):
        del world_id, endpoint, account_id

    def save(self, world_id, endpoint, account_id, state):
        del world_id, endpoint, account_id, state
        raise OSError("state store unavailable")


class _FailingFinalSaveState:
    def __init__(self, delegate):
        self.delegate = delegate
        self.saves = 0

    def load(self, world_id, endpoint, account_id):
        return self.delegate.load(world_id, endpoint, account_id)

    def save(self, world_id, endpoint, account_id, state):
        self.saves += 1
        if self.saves == 2:
            raise OSError("final baseline unavailable")
        self.delegate.save(world_id, endpoint, account_id, state)


class _FailingFinalizeWorlds(_Worlds):
    def finalize_restore(self, world_id, owner_sub, previous_revisions):
        del world_id, owner_sub, previous_revisions
        raise OSError("finalize failed")


class CloudSyncApplicationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        # Production data roots are canonical before they reach snapshot safety checks.
        # Match that behavior when macOS places temporary directories below the /var
        # symlink to /private/var.
        self.root = Path(self.temporary.name).resolve()
        self.remote = _Remote()
        self.documents = SQLiteDocumentRepository()
        self.authorization = BackupAuthorization(self.remote.default_endpoint(), "token")
        self.world_id = "0123456789abcdef0123456789abcdef"
        self.devices = {}
        for name in ("a", "b"):
            base = self.root / name
            database = base / "world.sqlite3"
            schema.initialize(database)
            context = WorldBackupContext(
                root=base / "history" / self.world_id,
                database=database,
                manuscripts=base / "manuscripts",
                profiles=base / "profiles",
                endpoint_url=self.remote.default_endpoint(),
                title="Novel",
            )
            worlds = _Worlds()
            worlds.database = database
            worlds.context = context
            history = SnapshotStore(base / "history", self.remote)
            sync = SynchronizationUseCases(
                worlds,
                self.documents,
                history,
                self.remote,
                JsonSyncStateStore(base / "sync"),
            )
            self.devices[name] = (context, sync)
        self._save("a", "Original")

    def tearDown(self):
        self.temporary.cleanup()

    def _save(self, device, body, *, chapters=True):
        context, _ = self.devices[device]
        state = {
            "chapters": (
                [{"id": "chapter-1", "title": "Chapter", "body": body, "note": "Note"}]
                if chapters
                else []
            )
        }
        self.documents.save("manuscript", state, None, context.database)

    def _sync(self, device, action="sync", **kwargs):
        context, service = self.devices[device]
        return service.synchronize(context, "owner", self.authorization, action, **kwargs)

    def test_initial_push_and_explicit_fresh_device_pull_link_both_devices(self):
        pushed = self._sync("a")
        self.assertEqual(pushed["state"], "synced")

        context_b, service_b = self.devices["b"]
        unlinked = service_b.status(context_b, "owner", self.authorization)
        self.assertEqual(unlinked["state"], "unlinked")
        revision_before = self.documents.revision("manuscript", context_b.database)
        pulled = self._sync(
            "b",
            "use-remote",
            expected_generation=unlinked["remote"]["generation"],
            expected_local_fingerprint=unlinked["localFingerprint"],
        )

        self.assertTrue(pulled["reloadRequired"])
        self.assertEqual(pulled["state"], "synced")
        self.assertEqual(
            self.documents.load("manuscript", context_b.database)["chapters"][0]["body"],
            "Original",
        )
        self.assertGreater(
            self.documents.revision("manuscript", context_b.database), revision_before
        )

    def test_remote_validation_canonicalizes_its_trusted_temporary_root(self):
        context, service = self.devices["a"]
        aliased_root = self.root / "staging-parent" / ".." / "staging"
        captured = None

        def stop_after_context(staging, entry, fetch):
            nonlocal captured
            del entry, fetch
            captured = staging
            raise RuntimeError("context captured")

        service._history.restore = stop_after_context
        temporary = MagicMock()
        temporary.__enter__.return_value = str(aliased_root)
        with (
            patch(
                "quiltor.application.synchronization.use_cases.tempfile.TemporaryDirectory",
                return_value=temporary,
            ),
            self.assertRaisesRegex(RuntimeError, "context captured"),
        ):
            service._validated_remote_documents(context, {"title": "Remote"}, self.authorization)

        self.assertIsNotNone(captured)
        self.assertEqual(captured.root.parent.parent, aliased_root.resolve())

    def test_offline_delete_and_edit_conflict_without_resurrecting_or_mutating(self):
        self.test_initial_push_and_explicit_fresh_device_pull_link_both_devices()
        self._save("a", "", chapters=False)
        self._sync("a")
        self._save("b", "Edited offline")
        before = self.documents.load("manuscript", self.devices["b"][0].database)

        status = self.devices["b"][1].status(self.devices["b"][0], "owner", self.authorization)

        self.assertEqual(status["state"], "conflict")
        self.assertEqual(self.documents.load("manuscript", self.devices["b"][0].database), before)
        history = SnapshotStore(self.devices["b"][0].root.parent, self.remote)
        self.assertEqual(
            history.entries(self.devices["b"][0])[-1]["message"],
            "Cloud sync conflict (local)",
        )

    def test_lost_compare_and_set_response_is_acknowledged_safely_on_retry(self):
        self.remote.lose_next_cas_response = True
        with self.assertRaisesRegex(SyncGatewayFailure, "sync.unavailable"):
            self._sync("a")

        context, service = self.devices["a"]
        recovered = service.status(context, "owner", self.authorization)

        self.assertEqual(recovered["state"], "synced")
        self.assertEqual(recovered["remote"]["generation"], 1)

    def test_read_only_account_can_pull_but_cannot_publish(self):
        self.remote.access = "read-only"
        with self.assertRaisesRegex(SyncGatewayFailure, "cloud.read_only"):
            self._sync("a")
        self.assertEqual(self.remote.sync_head(self.devices["a"][0], None)["generation"], 0)

    def test_semantic_fingerprint_ignores_revision_counters(self):
        context, service = self.devices["a"]
        before = service.fingerprint(context)
        current = self.documents.load("manuscript", context.database)
        self.documents.save("manuscript", current, None, context.database)
        self.assertGreater(self.documents.revision("manuscript", context.database), 1)
        self.assertEqual(service.fingerprint(context), before)

    def test_state_storage_failure_happens_before_remote_head_is_advanced(self):
        context, _ = self.devices["a"]
        worlds = _Worlds()
        worlds.database = context.database
        worlds.context = context
        service = SynchronizationUseCases(
            worlds,
            self.documents,
            SnapshotStore(context.root.parent, self.remote),
            self.remote,
            _FailingState(),
        )

        with self.assertRaises(OSError):
            service.synchronize(context, "owner", self.authorization, "sync")

        self.assertEqual(self.remote.sync_head(context, None)["generation"], 0)

    def test_confirmed_publish_survives_final_baseline_write_failure(self):
        context, _ = self.devices["a"]
        worlds = _Worlds()
        worlds.database = context.database
        worlds.context = context
        durable = JsonSyncStateStore(context.database.parent / "publish-final-state")
        service = SynchronizationUseCases(
            worlds,
            self.documents,
            SnapshotStore(context.root.parent, self.remote),
            self.remote,
            _FailingFinalSaveState(durable),
        )

        result = service.synchronize(context, "owner", self.authorization, "sync")

        self.assertEqual(result["remote"]["generation"], 1)
        self.assertEqual(result["state"], "unlinked")
        self.assertEqual(result["warnings"], ["sync.state_not_saved"])
        restarted = SynchronizationUseCases(
            worlds,
            self.documents,
            SnapshotStore(context.root.parent, self.remote),
            self.remote,
            durable,
        )
        self.assertEqual(restarted.status(context, "owner", self.authorization)["state"], "synced")

    def test_publish_transfer_metadata_failure_is_a_confirmed_sync_warning(self):
        context, _ = self.devices["a"]
        worlds = _Worlds()
        worlds.database = context.database
        worlds.context = context
        history = SnapshotStore(context.root.parent, self.remote)
        service = SynchronizationUseCases(
            worlds,
            self.documents,
            history,
            self.remote,
            JsonSyncStateStore(context.database.parent / "transfer-warning-sync"),
        )

        with patch.object(
            history, "_record_successful_transfer", side_effect=OSError("metadata full")
        ):
            result = service.synchronize(context, "owner", self.authorization, "sync")

        self.assertEqual(result["state"], "synced")
        self.assertEqual(result["remote"]["generation"], 1)
        self.assertEqual(result["warnings"], ["sync.state_not_saved"])

    def test_invalid_remote_blob_is_rejected_before_active_world_mutation(self):
        self._sync("a")
        context_b, service_b = self.devices["b"]
        status = service_b.status(context_b, "owner", self.authorization)
        before = context_b.database.read_bytes()
        self.remote.blobs[next(iter(self.remote.blobs))] = b"corrupt"

        with self.assertRaises(BackupContractError):
            service_b.synchronize(
                context_b,
                "owner",
                self.authorization,
                "use-remote",
                expected_generation=status["remote"]["generation"],
                expected_local_fingerprint=status["localFingerprint"],
            )

        self.assertEqual(context_b.database.read_bytes(), before)

    def test_conflict_resolution_rejects_a_stale_displayed_generation(self):
        self.test_initial_push_and_explicit_fresh_device_pull_link_both_devices()
        self._save("a", "Remote version one")
        self._sync("a")
        self._save("b", "Offline local")
        context_b, service_b = self.devices["b"]
        displayed = service_b.status(context_b, "owner", self.authorization)
        self._save("a", "Remote version two")
        self._sync("a")
        before = self.documents.load("manuscript", context_b.database)

        with self.assertRaises(SyncConflict):
            service_b.synchronize(
                context_b,
                "owner",
                self.authorization,
                "use-remote",
                expected_generation=displayed["remote"]["generation"],
                expected_local_fingerprint=displayed["localFingerprint"],
            )

        self.assertEqual(self.documents.load("manuscript", context_b.database), before)

    def test_local_edit_during_download_aborts_pull_without_overwriting_edit(self):
        self._sync("a")
        context_b, service_b = self.devices["b"]
        status = service_b.status(context_b, "owner", self.authorization)
        self.remote.on_fetch = lambda: self._save("b", "Saved during download")

        with self.assertRaises(SyncConflict):
            service_b.synchronize(
                context_b,
                "owner",
                self.authorization,
                "use-remote",
                expected_generation=status["remote"]["generation"],
                expected_local_fingerprint=status["localFingerprint"],
            )

        self.assertEqual(
            self.documents.load("manuscript", context_b.database)["chapters"][0]["body"],
            "Saved during download",
        )

    def test_local_edit_during_upload_is_preserved_and_head_is_not_advanced(self):
        context_a, service_a = self.devices["a"]
        self.remote.on_push = lambda: self._save("a", "Saved during upload")

        with self.assertRaises(SyncConflict):
            service_a.synchronize(context_a, "owner", self.authorization, "sync")

        self.assertEqual(self.remote.sync_head(context_a, None)["generation"], 0)
        self.assertEqual(
            self.documents.load("manuscript", context_a.database)["chapters"][0]["body"],
            "Saved during upload",
        )

    def test_pull_state_write_failure_requires_reload_and_keeps_safety_history(self):
        self.test_initial_push_and_explicit_fresh_device_pull_link_both_devices()
        self._save("a", "Remote after baseline")
        self._sync("a")
        context_b, _ = self.devices["b"]
        worlds = _Worlds()
        worlds.database = context_b.database
        worlds.context = context_b
        history = SnapshotStore(context_b.root.parent, self.remote)
        durable_state = JsonSyncStateStore(context_b.database.parent / "sync")
        service = SynchronizationUseCases(
            worlds,
            self.documents,
            history,
            self.remote,
            _FailingFinalSaveState(durable_state),
        )
        local_before = self.documents.load("manuscript", context_b.database)

        result = service.synchronize(
            context_b,
            "owner",
            self.authorization,
            "sync",
        )

        self.assertTrue(result["reloadRequired"])
        self.assertEqual(result["state"], "unlinked")
        self.assertEqual(result["warnings"], ["sync.state_not_saved"])
        safety = next(
            entry
            for entry in history.entries(context_b)
            if entry["id"] == result["localSnapshotId"]
        )
        history.restore(context_b, safety)
        self.assertEqual(self.documents.load("manuscript", context_b.database), local_before)

        # Put the completed pull back, then simulate a process restart. The
        # durable pendingPull journal is acknowledged only after both the head
        # and the full semantic fingerprint match.
        history.restore(
            context_b,
            next(
                entry
                for entry in history.entries(context_b)
                if entry["id"] == result["remote"]["snapshotId"]
            ),
        )
        worlds.finalize_restore(
            self.world_id,
            "owner",
            self.documents.revision_checkpoint(context_b.database),
        )
        restarted = SynchronizationUseCases(
            worlds, self.documents, history, self.remote, durable_state
        )
        recovered = restarted.status(context_b, "owner", self.authorization)
        self.assertEqual(recovered["state"], "synced")

    def test_finalize_failure_rolls_back_active_world_and_revision(self):
        self._sync("a")
        context_b, _ = self.devices["b"]
        worlds = _FailingFinalizeWorlds()
        worlds.database = context_b.database
        worlds.context = context_b
        service = SynchronizationUseCases(
            worlds,
            self.documents,
            SnapshotStore(context_b.root.parent, self.remote),
            self.remote,
            JsonSyncStateStore(context_b.database.parent / "failed-finalize-sync"),
        )
        before = self.documents.load("manuscript", context_b.database)
        revision_before = self.documents.revision("manuscript", context_b.database)

        with self.assertRaises(OSError):
            service.synchronize(
                context_b,
                "owner",
                self.authorization,
                "use-remote",
                expected_generation=1,
                expected_local_fingerprint=service.fingerprint(context_b),
            )

        self.assertEqual(self.documents.load("manuscript", context_b.database), before)
        self.assertEqual(self.documents.revision("manuscript", context_b.database), revision_before)

    def test_post_swap_history_append_failure_rolls_back_active_world(self):
        self._sync("a")
        context_b, _ = self.devices["b"]
        worlds = _Worlds()
        worlds.database = context_b.database
        worlds.context = context_b
        history = SnapshotStore(context_b.root.parent, self.remote)
        service = SynchronizationUseCases(
            worlds,
            self.documents,
            history,
            self.remote,
            JsonSyncStateStore(context_b.database.parent / "append-failure-sync"),
        )
        before = self.documents.load("manuscript", context_b.database)
        original_append = history._append_entry

        def fail_remote_append(ctx, entry):
            if entry["id"] == self.remote.sync_head(context_b, None)["snapshotId"]:
                raise OSError("append failed after active swap")
            original_append(ctx, entry)

        with (
            patch.object(history, "_append_entry", side_effect=fail_remote_append),
            self.assertRaises(OSError),
        ):
            service.synchronize(
                context_b,
                "owner",
                self.authorization,
                "use-remote",
                expected_generation=1,
                expected_local_fingerprint=service.fingerprint(context_b),
            )

        self.assertEqual(self.documents.load("manuscript", context_b.database), before)

    def test_rollback_failure_with_verified_remote_content_requires_reload(self):
        self._sync("a")
        context_b, _ = self.devices["b"]
        worlds = _Worlds()
        worlds.database = context_b.database
        worlds.context = context_b
        history = SnapshotStore(context_b.root.parent, self.remote)
        service = SynchronizationUseCases(
            worlds,
            self.documents,
            history,
            self.remote,
            JsonSyncStateStore(context_b.database.parent / "partial-rollback-sync"),
        )
        remote_id = self.remote.sync_head(context_b, None)["snapshotId"]
        original_append = history._append_entry
        original_restore = history.restore
        active_root = context_b.root

        def fail_remote_append(ctx, entry):
            if ctx.root == active_root and entry["id"] == remote_id:
                raise OSError("append failed after active swap")
            original_append(ctx, entry)

        def fail_safety_rollback(ctx, entry, fetch=None):
            if ctx.root == active_root and entry["id"] != remote_id:
                raise OSError("safety rollback failed")
            return original_restore(ctx, entry, fetch)

        with (
            patch.object(history, "_append_entry", side_effect=fail_remote_append),
            patch.object(history, "restore", side_effect=fail_safety_rollback),
        ):
            result = service.synchronize(
                context_b,
                "owner",
                self.authorization,
                "use-remote",
                expected_generation=1,
                expected_local_fingerprint=service.fingerprint(context_b),
            )

        self.assertTrue(result["reloadRequired"])
        self.assertEqual(result["state"], "unlinked")
        self.assertEqual(result["warnings"], ["sync.state_not_saved"])
        self.assertEqual(
            self.documents.load("manuscript", context_b.database)["chapters"][0]["body"],
            "Original",
        )

    def test_invalid_image_catalog_is_rejected_in_staging_before_active_swap(self):
        context_a, _ = self.devices["a"]
        with connection(context_a.database) as database:
            database.execute(
                """
                INSERT INTO place_map_images(id,mime,width,height,byte_size,created_at,data)
                VALUES(?,?,?,?,?,?,?)
                """,
                ("0" * 64, "image/png", 1, 1, 7, "2026-01-01T00:00:00", b"payload"),
            )
        history_a = SnapshotStore(context_a.root.parent, self.remote)
        history_a.commit(
            context_a, "corrupt image catalog", push=True, authorization=self.authorization
        )
        snapshot_id = history_a.entries(context_a)[-1]["id"]
        self.remote.compare_and_set_head(context_a, 0, snapshot_id, self.authorization)
        context_b, service_b = self.devices["b"]
        before = context_b.database.read_bytes()

        with self.assertRaisesRegex(ValueError, "image"):
            service_b.synchronize(
                context_b,
                "owner",
                self.authorization,
                "use-remote",
                expected_generation=1,
                expected_local_fingerprint=service_b.fingerprint(context_b),
            )

        self.assertEqual(context_b.database.read_bytes(), before)

    def test_same_endpoint_different_account_does_not_reuse_baseline(self):
        context_a, service_a = self.devices["a"]
        self._sync("a")
        self.remote.account_id = "account-b"

        status = service_a.status(context_a, "owner", self.authorization)

        self.assertEqual(status["account"]["accountId"], "account-b")
        self.assertEqual(status["state"], "unlinked")
        self.assertIsNone(status["baseGeneration"])

    def test_missing_remote_account_identity_is_rejected(self):
        context_a, service_a = self.devices["a"]
        self.remote.account_id = ""
        with self.assertRaisesRegex(SyncGatewayFailure, "sync.invalid_response"):
            service_a.status(context_a, "owner", self.authorization)

    def test_remote_metadata_rejects_unsafe_numbers_and_invalid_dates(self):
        invalid_heads = (
            {"generation": 0, "snapshotId": "a" * 64},
            {"generation": 1, "snapshotId": None},
            {"generation": 9_007_199_254_740_992, "snapshotId": "a" * 64},
        )
        for head in invalid_heads:
            with self.subTest(head=head), self.assertRaises(SyncGatewayFailure):
                remote_transport._validated_head(head)

        authorization = BackupAuthorization("http://127.0.0.1:9911", "token")
        invalid_accounts = (
            {
                "accountId": "account",
                "access": "read-write",
                "usedBytes": 0,
                "deleteAfter": None,
            },
            {
                "accountId": "account",
                "access": "read-write",
                "usedBytes": 0,
                "limitBytes": None,
            },
            {
                "accountId": "account",
                "access": "read-write",
                "usedBytes": 9_007_199_254_740_992,
                "limitBytes": None,
                "deleteAfter": None,
            },
            {
                "accountId": "account",
                "access": "read-write",
                "usedBytes": 0,
                "limitBytes": None,
                "deleteAfter": "tomorrow",
            },
        )
        for account in invalid_accounts:
            with (
                self.subTest(account=account),
                patch.object(remote_transport, "_sync_json_request", return_value=account),
                self.assertRaises(SyncGatewayFailure),
            ):
                remote_transport.account(authorization.endpoint, authorization)


class CloudSyncRealServerTest(unittest.TestCase):
    """The application protocol and reference service must agree over HTTP."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.issuer = FakeIssuer().start()
        self.issuer.issue("sync-token", sub="sync-account")
        os.environ["QUILTOR_BACKUP_ROOT"] = str(self.root / "served")
        spec = importlib.util.spec_from_file_location("sync_reference_server", REFERENCE_SERVER)
        self.reference = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.reference)
        self.reference.ROOT = self.root / "served"
        self.reference.ISSUER = self.issuer.url
        self.reference.CLIENT_ID = "quiltor-backup"
        self.reference.CLIENT_SECRET = "secret"
        self.reference.REQUIRED_SCOPE = "quiltor.backup"
        self.reference.PUBLIC_URL = "https://backup.example.test"
        self.reference.ALLOW_INSECURE_LOOPBACK = True
        self.reference.TRUSTED_ENDPOINT_ORIGINS = ()
        self.reference.POLICY_FILE = ""
        self.reference.POLICIES = {}
        self.reference._discovery.clear()
        self.reference._tokens.clear()
        self.reference._account_locks.clear()
        self.httpd = self.reference.Server(("127.0.0.1", 0), self.reference.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        available = MagicMock()
        available.is_available.return_value = True
        self.remote = HttpRemoteBackupGateway(self.endpoint, available)
        self.authorization = BackupAuthorization(self.endpoint, "sync-token")
        self.documents = SQLiteDocumentRepository()
        self.world_id = "abcdef0123456789abcdef0123456789"
        self.devices = {}
        for name in ("a", "b"):
            base = self.root / name
            database = base / "world.sqlite3"
            schema.initialize(database)
            context = WorldBackupContext(
                root=base / "history" / self.world_id,
                database=database,
                manuscripts=base / "manuscripts",
                profiles=base / "profiles",
                endpoint_url=self.endpoint,
                title="Network novel",
            )
            worlds = _Worlds()
            worlds.database = database
            worlds.context = context
            history = SnapshotStore(base / "history", self.remote)
            self.devices[name] = (
                context,
                SynchronizationUseCases(
                    worlds,
                    self.documents,
                    history,
                    self.remote,
                    JsonSyncStateStore(base / "sync"),
                ),
            )
        self.documents.save(
            "manuscript",
            {
                "chapters": [
                    {
                        "id": "chapter-1",
                        "title": "Chapter",
                        "body": "Across the network",
                        "note": "",
                    }
                ]
            },
            None,
            self.devices["a"][0].database,
        )

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.issuer.stop()
        self.temporary.cleanup()

    def test_initial_push_and_pull_across_two_local_roots(self):
        context_a, sync_a = self.devices["a"]
        pushed = sync_a.synchronize(context_a, "owner", self.authorization, "sync")
        self.assertEqual(pushed["remote"]["generation"], 1)

        context_b, sync_b = self.devices["b"]
        status = sync_b.status(context_b, "owner", self.authorization)
        self.assertEqual(status["state"], "unlinked")
        pulled = sync_b.synchronize(
            context_b,
            "owner",
            self.authorization,
            "use-remote",
            expected_generation=status["remote"]["generation"],
            expected_local_fingerprint=status["localFingerprint"],
        )

        self.assertEqual(pulled["state"], "synced")
        self.assertEqual(
            self.documents.load("manuscript", context_b.database)["chapters"][0]["body"],
            "Across the network",
        )

    def test_mid_upload_quota_failure_keeps_local_content_and_head_unchanged(self):
        self.reference.POLICIES = {
            "sync-account": {
                "access": "read-write",
                "limitBytes": 1,
                "deleteAfter": None,
            }
        }
        context_a, sync_a = self.devices["a"]
        before = self.documents.load("manuscript", context_a.database)

        with self.assertRaises(SyncGatewayFailure) as caught:
            sync_a.synchronize(context_a, "owner", self.authorization, "sync")

        self.assertEqual(caught.exception.code, "cloud.quota_exceeded")
        self.assertEqual(caught.exception.status, 507)
        self.assertEqual(
            self.remote.sync_head(context_a, self.authorization),
            {"generation": 0, "snapshotId": None},
        )
        self.assertEqual(self.documents.load("manuscript", context_a.database), before)


if __name__ == "__main__":
    unittest.main()
