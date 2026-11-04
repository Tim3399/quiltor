"""Reaches every failure, conflict and generation check of manual synchronization (T-19 P11).

Written before `synchronization/use_cases.py` was typed strictly. The ports are mocks, the
documents are small valid ones, and the fingerprint is the real one, so a "local change" is
an actual change of a loaded document. Each test names the error code, the conflict reason
or the response state the caller receives.
"""

from __future__ import annotations

import copy
import unittest
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

from quiltor.application.backups import BackupGatewayError, WorldBackupContext
from quiltor.application.backups.errors import BackupEndpointNotConfigured
from quiltor.application.synchronization import (
    SyncConflict,
    SyncGatewayFailure,
    SynchronizationUseCases,
)
from quiltor.application.synchronization.errors import SyncRequestInvalid
from tests.python.test_storyboard_model import wire_payload

ENDPOINT = "https://cloud.test"
LOCAL_DATABASE = Path("worlds") / "harbour" / "world.sqlite3"
TOKEN: Any = "token"
REMOTE_ENTRY = {"id": "remote-2", "title": "Hafen", "files": {}}
SAFETY_ENTRY = {"id": "safety-1", "title": "Hafen", "files": {}}


def documents(chapter_title: str) -> dict[str, dict[str, Any]]:
    return {
        "manuscript": {"chapters": [{"id": "c1", "title": chapter_title}]},
        "figures": {"nodes": [], "edges": []},
        "storyboards": wire_payload(),
    }


class Harness:
    """Mock ports around one local world and one remote head."""

    def __init__(self, *, endpoint: str = ENDPOINT) -> None:
        self.local = documents("Lokal")
        self.remote_documents = documents("Wolke")
        self.endpoints = [endpoint]
        self.saved: dict[str, Any] | None = None
        self.save_failures: list[bool] = []
        self.head: dict[str, Any] = {"generation": 2, "snapshotId": "remote-2"}
        self.heads_after: list[dict[str, Any]] = []
        self.on_state_load: list[Callable[[], None]] = []
        self.backup: dict[str, dict[str, Any]] | None = None

        self.worlds = MagicMock()
        self.worlds.open.side_effect = self._open
        self.history = MagicMock()
        self.history.context.side_effect = self._context
        self.history.entries.return_value = [SAFETY_ENTRY]
        self.history.restore.side_effect = self._restore
        self.history.upload.return_value = None
        self.docs = MagicMock()
        self.docs.load.side_effect = self._load
        self.docs.image_digests.return_value = []
        self.docs.exists.return_value = True
        self.docs.revision_checkpoint.return_value = {"manuscript": 4}
        self.remote = MagicMock()
        self.remote.account.return_value = {"accountId": "acc", "access": "read-write"}
        self.remote.sync_head.side_effect = self._sync_head
        self.remote.snapshots.return_value = [REMOTE_ENTRY]
        self.remote.fetch_blob.return_value = b""
        self.remote.compare_and_set_head.side_effect = lambda _c, generation, snapshot, _a: {
            "generation": generation + 1,
            "snapshotId": snapshot,
        }
        self.state = MagicMock()
        self.state.load.side_effect = self._state_load
        self.state.save.side_effect = self._state_save
        self.use_cases = SynchronizationUseCases(
            self.worlds, self.docs, self.history, self.remote, self.state
        )
        self.context = self._context(
            "harbour", endpoint, LOCAL_DATABASE, Path("m"), Path("p"), title="Hafen"
        )

    # ports
    def _open(self, world_id: str, owner_sub: str) -> Any:
        endpoint = self.endpoints.pop(0) if len(self.endpoints) > 1 else self.endpoints[0]
        location = SimpleNamespace(
            database=LOCAL_DATABASE, manuscript_mirrors=Path("m"), story_world_mirrors=Path("p")
        )
        return SimpleNamespace(
            summary=SimpleNamespace(backup_url=endpoint, title="Hafen"),
            paths=SimpleNamespace(documents=location),
        )

    @staticmethod
    def _context(
        world_id: str,
        endpoint: str,
        database: Path,
        manuscripts: Path,
        profiles: Path,
        title: str = "",
    ) -> WorldBackupContext:
        return WorldBackupContext(
            root=Path("history") / world_id,
            database=database,
            manuscripts=manuscripts,
            profiles=profiles,
            endpoint_url=endpoint,
            title=title,
        )

    def _load(self, kind: str, database: Path) -> dict[str, Any]:
        source = self.local if database == LOCAL_DATABASE else self.remote_documents
        return copy.deepcopy(source[kind])

    def _restore(
        self, context: WorldBackupContext, entry: dict[str, Any], fetch: Any = None
    ) -> dict[str, Any]:
        if context.database != LOCAL_DATABASE:
            # Staging reads one blob twice; the second read must come from the cache.
            if fetch is not None:
                fetch("d" * 64)
                fetch("d" * 64)
            return {}
        if entry is SAFETY_ENTRY:
            if self.backup is not None:
                self.local = self.backup
            return {}
        self.backup = copy.deepcopy(self.local)
        self.local = copy.deepcopy(self.remote_documents)
        return {}

    def _sync_head(self, context: WorldBackupContext, authorization: Any) -> dict[str, Any]:
        if self.heads_after:
            return self.heads_after.pop(0)
        return dict(self.head)

    def _state_load(self, world_id: str, endpoint: str, account_id: str) -> dict[str, Any] | None:
        if self.on_state_load:
            self.on_state_load.pop(0)()
        return copy.deepcopy(self.saved)

    def _state_save(
        self, world_id: str, endpoint: str, account_id: str, state: dict[str, Any]
    ) -> None:
        if self.save_failures and self.save_failures.pop(0):
            raise OSError("state store unavailable")
        self.saved = copy.deepcopy(state)

    # helpers
    def fingerprint(self) -> str:
        return self.use_cases.fingerprint(self.context)

    def linked(self, *, generation: int = 2, snapshot: str | None = "remote-2") -> None:
        """A saved baseline that matches the current local content and the given head."""

        self.saved = {
            "baseGeneration": generation,
            "baseSnapshotId": snapshot,
            "baseFingerprint": self.fingerprint(),
            "lastSyncedAt": "2026-01-01T00:00:00Z",
        }

    def edit_locally(self) -> None:
        self.local["manuscript"]["chapters"][0]["title"] = "Lokal geändert"

    def sync(self, action: str = "sync", **options: Any) -> dict[str, Any]:
        return self.use_cases.synchronize(self.context, "owner", TOKEN, action, **options)

    def status(self) -> dict[str, Any]:
        return self.use_cases.status(self.context, "owner", TOKEN)

    def preview(self) -> dict[str, Any]:
        return self.use_cases.preview(self.context, "owner", TOKEN)


class RequestAndConfigurationTests(unittest.TestCase):
    def test_an_unknown_action_is_an_invalid_request(self) -> None:
        with self.assertRaises(SyncRequestInvalid) as caught:
            Harness().sync("merge")
        self.assertEqual(caught.exception.params, {"field": "action"})

    def test_a_resolution_needs_a_non_negative_integer_generation(self) -> None:
        for action in ("keep-local", "use-remote"):
            for generation in (None, -1, True, 2.0, "2"):
                with self.subTest(action=action, generation=generation):
                    harness = Harness()
                    with self.assertRaises(SyncRequestInvalid) as caught:
                        harness.sync(action, expected_generation=generation)
                    self.assertEqual(caught.exception.params, {"field": "expectedGeneration"})

    def test_a_stale_resolution_is_a_conflict(self) -> None:
        harness = Harness()
        with self.assertRaises(SyncConflict) as caught:
            harness.sync(
                "keep-local",
                expected_generation=1,
                expected_local_fingerprint=harness.fingerprint(),
            )
        self.assertEqual(caught.exception.params["reason"], "stale_resolution")
        with self.assertRaises(SyncConflict) as caught:
            harness.sync("keep-local", expected_generation=2, expected_local_fingerprint="other")
        self.assertEqual(caught.exception.params["reason"], "stale_resolution")

    def test_no_endpoint_is_not_configured(self) -> None:
        harness = Harness(endpoint="")
        with self.assertRaises(BackupEndpointNotConfigured):
            harness.status()
        with self.assertRaises(BackupEndpointNotConfigured):
            harness.preview()

    def test_an_endpoint_changed_during_the_request_is_a_conflict(self) -> None:
        harness = Harness()
        harness.endpoints = [ENDPOINT, "https://other.test"]
        with self.assertRaises(SyncConflict) as caught:
            harness.status()
        self.assertEqual(caught.exception.params, {"reason": "configuration_changed"})

    def test_an_account_without_identity_is_an_invalid_response(self) -> None:
        for account in ({}, {"accountId": ""}, {"accountId": 7}):
            with self.subTest(account=account):
                harness = Harness()
                harness.remote.account.return_value = account
                with self.assertRaises(SyncGatewayFailure) as caught:
                    harness.status()
                self.assertEqual(
                    (caught.exception.code, caught.exception.status), ("sync.invalid_response", 502)
                )


class ClassificationTests(unittest.TestCase):
    def test_states_follow_local_and_remote_changes(self) -> None:
        harness = Harness()
        self.assertEqual(harness.status()["state"], "unlinked")
        harness.head = {"generation": 0, "snapshotId": None}
        self.assertEqual(harness.status()["state"], "local-pending")
        harness.head = {"generation": 2, "snapshotId": "remote-2"}
        harness.linked()
        self.assertEqual(harness.status()["state"], "synced")
        harness.edit_locally()
        self.assertEqual(harness.status()["state"], "local-pending")
        harness.linked(generation=1)
        self.assertEqual(harness.status()["state"], "remote-pending")
        harness.linked(snapshot="remote-1")
        self.assertEqual(harness.status()["state"], "remote-pending")

    def test_a_conflict_preserves_the_local_content_first(self) -> None:
        harness = Harness()
        harness.linked(generation=1)
        harness.edit_locally()
        result = harness.status()
        self.assertEqual(result["state"], "conflict")
        harness.history.commit.assert_called_with(
            harness.context, "Cloud sync conflict (local)", push=False, authorization=None
        )

    def test_a_baseline_without_an_integer_generation_counts_as_unlinked(self) -> None:
        harness = Harness()
        harness.linked()
        assert harness.saved is not None
        harness.saved["baseGeneration"] = "2"
        self.assertEqual(harness.status()["state"], "unlinked")

    def test_sync_answers_without_action_when_nothing_is_to_do(self) -> None:
        for state, prepare in (
            ("synced", lambda harness: harness.linked()),
            ("unlinked", lambda harness: None),
            ("conflict", lambda harness: (harness.linked(generation=1), harness.edit_locally())),
        ):
            with self.subTest(state=state):
                harness = Harness()
                prepare(harness)
                result = harness.sync()
                self.assertEqual((result["state"], result["reloadRequired"]), (state, False))
                harness.remote.compare_and_set_head.assert_not_called()


class PendingAcknowledgementTests(unittest.TestCase):
    def pending_pull(self, harness: Harness, **changes: Any) -> None:
        harness.saved = {
            "pendingPull": {
                "generation": 2,
                "snapshotId": "remote-2",
                "targetFingerprint": harness.fingerprint(),
                "previousRevisions": {"manuscript": 4},
                **changes,
            }
        }

    def test_a_finished_pull_is_acknowledged_once_the_content_matches(self) -> None:
        harness = Harness()
        self.pending_pull(harness)
        self.assertEqual(harness.status()["state"], "synced")
        harness.worlds.finalize_restore.assert_called_once_with(
            "harbour", "owner", {"manuscript": 4}
        )

    def test_a_pull_whose_content_differs_stays_pending(self) -> None:
        harness = Harness()
        self.pending_pull(harness, targetFingerprint="0" * 64)
        self.assertEqual(harness.status()["state"], "unlinked")
        harness.worlds.finalize_restore.assert_not_called()

    def test_a_malformed_pending_pull_is_ignored(self) -> None:
        for changes in (
            {"generation": 1},
            {"targetFingerprint": None},
            {"previousRevisions": []},
            {"previousRevisions": {"manuscript": -1}},
            {"previousRevisions": {"manuscript": True}},
        ):
            with self.subTest(changes=changes):
                harness = Harness()
                self.pending_pull(harness, **changes)
                harness.status()
                harness.worlds.finalize_restore.assert_not_called()

    def test_a_published_snapshot_is_acknowledged_when_the_head_shows_it(self) -> None:
        harness = Harness()
        harness.saved = {
            "pending": {"snapshotId": "remote-2", "fingerprint": harness.fingerprint()}
        }
        self.assertEqual(harness.status()["state"], "synced")
        harness.saved = {"pending": {"snapshotId": "remote-2", "fingerprint": 5}}
        self.assertEqual(harness.status()["state"], "unlinked")
        harness.saved = {
            "pending": {"snapshotId": "remote-1", "fingerprint": harness.fingerprint()}
        }
        self.assertEqual(harness.status()["state"], "unlinked")


class PublishTests(unittest.TestCase):
    def test_a_first_publish_links_the_world(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        result = harness.sync()
        self.assertEqual((result["state"], result["localSnapshotId"]), ("synced", "safety-1"))
        harness.remote.compare_and_set_head.assert_called_once_with(
            harness.context, 0, "safety-1", TOKEN
        )

    def test_a_read_only_account_cannot_publish(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        harness.remote.account.return_value = {"accountId": "acc", "access": "read"}
        with self.assertRaises(SyncGatewayFailure) as caught:
            harness.sync()
        self.assertEqual((caught.exception.code, caught.exception.status), ("cloud.read_only", 403))

    def test_keep_local_publishes_over_the_shown_generation(self) -> None:
        harness = Harness()
        result = harness.sync(
            "keep-local", expected_generation=2, expected_local_fingerprint=harness.fingerprint()
        )
        self.assertEqual(result["remote"], {"generation": 3, "snapshotId": "safety-1"})

    def test_a_compare_and_set_conflict_during_sync_answers_conflict(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        newer = {"generation": 5, "snapshotId": "remote-5"}
        harness.remote.compare_and_set_head.side_effect = SyncGatewayFailure(
            "sync.conflict", status=409, head=newer
        )
        result = harness.sync()
        self.assertEqual(
            (result["state"], result["remote"], result["reloadRequired"]),
            ("conflict", newer, False),
        )

    def test_a_compare_and_set_conflict_during_keep_local_is_raised(self) -> None:
        harness = Harness()
        newer = {"generation": 5, "snapshotId": "remote-5"}
        harness.remote.compare_and_set_head.side_effect = SyncGatewayFailure(
            "sync.conflict", status=409, head=newer
        )
        with self.assertRaises(SyncGatewayFailure):
            harness.sync(
                "keep-local",
                expected_generation=2,
                expected_local_fingerprint=harness.fingerprint(),
            )

    def test_other_gateway_failures_and_headless_conflicts_are_raised(self) -> None:
        for failure in (
            SyncGatewayFailure("sync.unavailable"),
            SyncGatewayFailure("sync.conflict", status=409),
        ):
            with self.subTest(code=failure.code, head=failure.head):
                harness = Harness()
                harness.head = {"generation": 0, "snapshotId": None}
                harness.remote.compare_and_set_head.side_effect = failure
                with self.assertRaises(SyncGatewayFailure) as caught:
                    harness.sync()
                self.assertIs(caught.exception, failure)

    def test_a_local_change_before_the_snapshot_is_a_conflict(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        harness.on_state_load = [harness.edit_locally]
        with self.assertRaises(SyncConflict) as caught:
            harness.sync()
        self.assertEqual(caught.exception.params, {"reason": "local_changed"})
        harness.history.commit.assert_not_called()

    def test_a_local_change_during_the_upload_is_a_conflict(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        harness.history.upload.side_effect = lambda *_: harness.edit_locally()
        with self.assertRaises(SyncConflict) as caught:
            harness.sync()
        self.assertEqual(caught.exception.params, {"reason": "local_changed"})
        harness.remote.compare_and_set_head.assert_not_called()

    def test_no_snapshot_after_the_commit_is_a_gateway_failure(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        harness.history.entries.return_value = []
        with self.assertRaises(SyncGatewayFailure) as caught:
            harness.sync()
        self.assertEqual(
            (caught.exception.code, caught.exception.status), ("sync.snapshot_failed", 502)
        )

    def test_an_upload_failure_surfaces_its_sync_cause(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        cause = SyncGatewayFailure("cloud.quota_exceeded", status=507)
        error = BackupGatewayError()
        error.__cause__ = cause
        harness.history.upload.side_effect = error
        with self.assertRaises(SyncGatewayFailure) as caught:
            harness.sync()
        self.assertIs(caught.exception, cause)
        plain = BackupGatewayError()
        harness.history.upload.side_effect = plain
        with self.assertRaises(BackupGatewayError) as caught_plain:
            harness.sync()
        self.assertIs(caught_plain.exception, plain)

    def test_a_transfer_warning_and_a_lost_baseline_are_reported(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        harness.history.upload.return_value = "metadata"
        result = harness.sync()
        self.assertEqual(
            (result["state"], result["warnings"]), ("synced", ["sync.state_not_saved"])
        )
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        harness.save_failures = [False, True]
        result = harness.sync()
        self.assertEqual(
            (result["state"], result["warnings"]), ("unlinked", ["sync.state_not_saved"])
        )
        self.assertIsNone(result["baseGeneration"])


class PullTests(unittest.TestCase):
    def remote_pending(self) -> Harness:
        harness = Harness()
        harness.linked(generation=1)
        return harness

    def test_a_remote_change_is_pulled(self) -> None:
        harness = self.remote_pending()
        result = harness.sync()
        self.assertEqual(
            (result["state"], result["reloadRequired"], result["localSnapshotId"]),
            ("synced", True, "safety-1"),
        )
        self.assertEqual(harness.local, harness.remote_documents)

    def test_use_remote_on_an_empty_remote_is_a_conflict(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        with self.assertRaises(SyncConflict) as caught:
            harness.sync(
                "use-remote",
                expected_generation=0,
                expected_local_fingerprint=harness.fingerprint(),
            )
        self.assertEqual(caught.exception.params["reason"], "remote_empty")

    def test_a_head_without_a_string_snapshot_is_empty(self) -> None:
        harness = Harness()
        harness.head = {"generation": 2, "snapshotId": 7}
        with self.assertRaises(SyncConflict) as caught:
            harness.sync(
                "use-remote",
                expected_generation=2,
                expected_local_fingerprint=harness.fingerprint(),
            )
        self.assertEqual(caught.exception.params, {"head": harness.head, "reason": "remote_empty"})

    def test_a_snapshot_missing_from_the_remote_is_unavailable(self) -> None:
        harness = self.remote_pending()
        harness.remote.snapshots.return_value = [{"id": "remote-1"}]
        with self.assertRaises(SyncGatewayFailure) as caught:
            harness.sync()
        self.assertEqual(
            (caught.exception.code, caught.exception.status), ("sync.snapshot_unavailable", 502)
        )

    def test_a_head_that_moved_during_validation_is_a_conflict(self) -> None:
        harness = self.remote_pending()
        newer = {"generation": 3, "snapshotId": "remote-3"}
        harness.heads_after = [dict(harness.head), newer]
        with self.assertRaises(SyncConflict) as caught:
            harness.sync()
        self.assertEqual(caught.exception.params, {"head": newer, "reason": "remote_changed"})
        harness.history.commit.assert_not_called()

    def test_a_local_change_during_the_download_is_a_conflict(self) -> None:
        harness = self.remote_pending()
        harness.remote.snapshots.side_effect = lambda *_: (harness.edit_locally(), [REMOTE_ENTRY])[
            1
        ]
        with self.assertRaises(SyncConflict) as caught:
            harness.sync()
        self.assertEqual(caught.exception.params, {"reason": "local_changed"})

    def test_an_invalid_remote_document_is_refused_before_any_change(self) -> None:
        harness = self.remote_pending()
        harness.remote_documents["figures"] = {"nodes": "not a list", "edges": []}
        with self.assertRaises(ValueError):
            harness.sync()
        harness.history.commit.assert_not_called()

    def test_no_safety_snapshot_is_a_gateway_failure(self) -> None:
        for prepare in (
            lambda harness: setattr(harness.docs.exists, "return_value", False),
            lambda harness: setattr(harness.history.entries, "return_value", []),
        ):
            harness = self.remote_pending()
            prepare(harness)
            with self.subTest(), self.assertRaises(SyncGatewayFailure) as caught:
                harness.sync()
            self.assertEqual(
                (caught.exception.code, caught.exception.status),
                ("sync.safety_snapshot_failed", 502),
            )

    def test_restored_content_that_differs_is_rolled_back(self) -> None:
        harness = self.remote_pending()
        before = copy.deepcopy(harness.local)
        harness.history.restore.side_effect = lambda context, entry, fetch=None: (
            harness._restore(context, entry, fetch),
            context.database == LOCAL_DATABASE
            and entry is REMOTE_ENTRY
            and harness.local["manuscript"]["chapters"][0].update(title="Halb"),
        )
        saved_before = copy.deepcopy(harness.saved)
        with self.assertRaises(ValueError):
            harness.sync()
        self.assertEqual(harness.local, before)
        self.assertEqual(harness.saved, saved_before)

    def test_a_failed_rollback_with_the_target_content_needs_a_reload(self) -> None:
        harness = self.remote_pending()
        harness.worlds.finalize_restore.side_effect = RuntimeError("finalize")

        def restore(
            context: WorldBackupContext, entry: dict[str, Any], fetch: Any = None
        ) -> dict[str, Any]:
            if context.database == LOCAL_DATABASE and entry is SAFETY_ENTRY:
                raise RuntimeError("rollback")
            return harness._restore(context, entry, fetch)

        harness.history.restore.side_effect = restore
        result = harness.sync()
        self.assertEqual(
            (result["state"], result["reloadRequired"], result["warnings"]),
            ("unlinked", True, ["sync.state_not_saved"]),
        )

    def test_a_failed_rollback_with_other_content_requires_recovery(self) -> None:
        harness = self.remote_pending()
        harness.worlds.finalize_restore.side_effect = lambda *_: (
            harness.edit_locally() or (_ for _ in ()).throw(RuntimeError("finalize"))
        )

        def restore(
            context: WorldBackupContext, entry: dict[str, Any], fetch: Any = None
        ) -> dict[str, Any]:
            if context.database == LOCAL_DATABASE and entry is SAFETY_ENTRY:
                raise RuntimeError("rollback")
            return harness._restore(context, entry, fetch)

        harness.history.restore.side_effect = restore
        with self.assertRaises(SyncGatewayFailure) as caught:
            harness.sync()
        self.assertEqual(
            (caught.exception.code, caught.exception.status), ("sync.recovery_required", 503)
        )

    def test_a_failed_rollback_that_cannot_be_verified_requires_recovery(self) -> None:
        harness = self.remote_pending()
        harness.worlds.finalize_restore.side_effect = RuntimeError("finalize")

        def restore(
            context: WorldBackupContext, entry: dict[str, Any], fetch: Any = None
        ) -> dict[str, Any]:
            if context.database == LOCAL_DATABASE and entry is SAFETY_ENTRY:
                harness.docs.load.side_effect = OSError("database gone")
                raise RuntimeError("rollback")
            return harness._restore(context, entry, fetch)

        harness.history.restore.side_effect = restore
        with self.assertRaises(SyncGatewayFailure) as caught:
            harness.sync()
        self.assertEqual(
            (caught.exception.code, caught.exception.status), ("sync.recovery_required", 503)
        )

    def test_a_lost_baseline_after_the_pull_is_reported(self) -> None:
        harness = self.remote_pending()
        harness.save_failures = [False, True]
        result = harness.sync()
        self.assertEqual(
            (result["state"], result["reloadRequired"], result["warnings"]),
            ("unlinked", True, ["sync.state_not_saved"]),
        )


class PreviewTests(unittest.TestCase):
    def test_the_remote_documents_are_shown_without_touching_the_world(self) -> None:
        harness = Harness()
        result = harness.preview()
        self.assertEqual((result["generation"], result["snapshotId"]), (2, "remote-2"))
        self.assertEqual(result["documents"]["manuscript"], harness.remote_documents["manuscript"])
        harness.history.commit.assert_not_called()
        harness.remote.fetch_blob.assert_called_once_with(harness.context, "d" * 64, TOKEN)

    def test_preview_failures(self) -> None:
        harness = Harness()
        harness.head = {"generation": 0, "snapshotId": None}
        with self.assertRaises(SyncConflict) as caught:
            harness.preview()
        self.assertEqual(caught.exception.params["reason"], "remote_empty")
        harness = Harness()
        harness.remote.snapshots.return_value = []
        with self.assertRaises(SyncGatewayFailure) as failure:
            harness.preview()
        self.assertEqual(failure.exception.code, "sync.snapshot_unavailable")
        harness = Harness()
        newer = {"generation": 3, "snapshotId": "remote-3"}
        harness.heads_after = [dict(harness.head), newer]
        with self.assertRaises(SyncConflict) as caught:
            harness.preview()
        self.assertEqual(caught.exception.params, {"head": newer, "reason": "remote_changed"})


if __name__ == "__main__":
    unittest.main()
