"""Backup orchestration stays usable through application ports on a fresh machine."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from quiltor.application.backups import BackupUseCases, WorldBackupContext
from quiltor.application.documents import DocumentLocation
from quiltor.application.telemetry import UseCaseObserver
from quiltor.application.worlds import WorldPaths


class _FreshWorlds:
    def __init__(self, root: Path) -> None:
        self.data_directory = root
        self.worlds_directory = root / "worlds"
        self.finalized: tuple[str, str, dict[str, int]] | None = None

    def is_valid_id(self, world_id: str) -> bool:
        return world_id == "remote-world"

    def open(self, world_id: str, owner_sub: str | None = None):
        raise FileNotFoundError("fresh machine")

    def paths_for(self, world_id: str) -> WorldPaths:
        return WorldPaths(
            DocumentLocation(
                database=self.worlds_directory / f"{world_id}.sqlite3",
                backups=self.data_directory / "backups" / world_id,
                manuscript_mirrors=self.data_directory / "manuscripts" / world_id,
                story_world_mirrors=self.data_directory / "profiles" / world_id,
            )
        )

    def finalize_restore(
        self,
        world_id: str,
        owner_sub: str,
        previous_revisions: dict[str, int],
    ) -> None:
        self.finalized = (world_id, owner_sub, previous_revisions)


class _Snapshots:
    def __init__(self) -> None:
        self.restored: tuple[WorldBackupContext, dict, object] | None = None

    def context(
        self,
        world_id: str,
        endpoint_url: str,
        database: Path,
        manuscripts: Path,
        profiles: Path,
        title: str = "",
    ) -> WorldBackupContext:
        return WorldBackupContext(
            Path("history"), database, manuscripts, profiles, endpoint_url, title
        )

    def restore(self, context: WorldBackupContext, entry: dict, fetch=None) -> dict:
        self.restored = (context, entry, fetch)
        return {"snapshot": entry["id"]}

    def commit(self, context, message, push, authorization=None):
        raise AssertionError("a fresh world must not create a pre-restore snapshot")


class ApplicationBackupOperationTests(unittest.TestCase):
    def test_remote_restore_does_not_require_a_preexisting_local_world(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            worlds = _FreshWorlds(Path(directory))
            snapshots = _Snapshots()
            remote = MagicMock()
            remote.snapshots.return_value = [
                {"id": "snapshot-1", "title": "Remote title", "created": "now"}
            ]
            remote.fetch_blob.return_value = b"blob"
            documents = MagicMock()
            documents.exists.return_value = False
            documents.revision_checkpoint.return_value = {
                "manuscript": 0,
                "figures": 0,
            }
            backups = BackupUseCases(
                worlds,
                documents,
                MagicMock(),
                snapshots,
                remote,
                MagicMock(),
                UseCaseObserver(MagicMock(), MagicMock()),
            )

            result = backups.restore_remote(
                "remote-world",
                "restoring-owner",
                "snapshot",
                "https://backup.test",
                MagicMock(),
            )

            self.assertEqual(
                worlds.finalized,
                (
                    "remote-world",
                    "restoring-owner",
                    {"manuscript": 0, "figures": 0},
                ),
            )
            self.assertEqual(result["snapshot"], "snapshot-1")
            self.assertEqual(result["title"], "Remote title")
            self.assertIsNotNone(snapshots.restored)
            context, _, fetch = snapshots.restored
            self.assertEqual(context.endpoint_url, "https://backup.test")
            self.assertEqual(fetch("digest"), b"blob")


if __name__ == "__main__":
    unittest.main()
