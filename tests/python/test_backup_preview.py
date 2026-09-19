"""Local backup inspection and restoration remain distinct, restart-safe operations."""

from __future__ import annotations

import errno
import hashlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from quiltor.bootstrap import (
    build_application_services,
    build_feature_availability,
    build_observability,
)
from quiltor.infrastructure.persistence.sqlite import restore
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths


class BackupPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = SQLitePaths.from_data_directory(Path(self.temp.name))
        self.services = self.build_services()
        self.world = self.services.worlds.create("Sicherungen", "", "author")
        self.location = self.services.worlds.open(self.world["id"], "author").paths.documents
        self.original = {
            "chapters": [
                {
                    "id": "opening",
                    "title": "Anfang",
                    "body": "Erste Fassung.",
                    "note": "Notiz.",
                    "marks": [{"kind": "bold", "from": 0, "to": 5}],
                }
            ]
        }
        self.services.documents.save("manuscript", self.original, 0, self.location)
        restore.backup_if_due(
            force=True, db_path=self.location.database, backups_dir=self.location.backups
        )
        self.snapshot = self.services.backups.list_local(self.location.backups)[0]["name"]
        self.services.documents.save("manuscript", {"chapters": []}, 1, self.location)

    def build_services(self):
        return build_application_services(
            build_feature_availability(), build_observability(), self.paths
        )

    def test_preview_does_not_change_source_or_current_project_and_restore_keeps_latest_copy(self):
        source = self.location.backups / self.snapshot
        source_hash = hashlib.sha256(source.read_bytes()).digest()
        source_mtime = source.stat().st_mtime_ns
        current = self.services.documents.load("manuscript", self.location.database)
        files = sorted(path.name for path in self.location.backups.iterdir())
        reopened = self.build_services()
        preview = reopened.backups.preview_local(self.snapshot, self.location)
        self.assertEqual(preview["manuscript"]["chapters"], self.original["chapters"])
        self.assertEqual(reopened.documents.load("manuscript", self.location.database), current)
        self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), source_hash)
        self.assertEqual(source.stat().st_mtime_ns, source_mtime)
        self.assertEqual(sorted(path.name for path in self.location.backups.iterdir()), files)

        reopened.backups.restore_local(self.snapshot, self.location)
        restored = reopened.documents.load("manuscript", self.location.database)
        self.assertEqual(restored.state["chapters"], self.original["chapters"])
        self.assertGreater(restored.revision, current.revision)
        safety = reopened.backups.list_local(self.location.backups)[0]["name"]
        self.assertEqual(
            reopened.backups.preview_local(safety, self.location)["manuscript"]["chapters"], []
        )

    def test_invalid_or_changed_backup_never_changes_the_current_project(self):
        current = self.services.documents.load("manuscript", self.location.database)
        source = self.location.backups / self.snapshot
        self.services.backups.preview_local(self.snapshot, self.location)
        source.write_bytes(b"corrupt after preview")
        for operation in (self.services.backups.preview_local, self.services.backups.restore_local):
            with self.subTest(operation=operation.__name__), self.assertRaises(ValueError):
                operation(self.snapshot, self.location)
            self.assertEqual(
                self.services.documents.load("manuscript", self.location.database), current
            )
        with self.assertRaises(ValueError):
            self.services.backups.preview_local("../backup-other.sqlite3", self.location)

    def test_logically_invalid_backup_never_changes_current_project_or_revisions(self):
        current = self.services.documents.load("manuscript", self.location.database)
        source = self.location.backups / self.snapshot
        with closing(sqlite3.connect(source)) as database, database:
            database.execute("PRAGMA journal_mode=DELETE")
            database.execute(
                "UPDATE chapters SET extra_json=? WHERE id='opening'",
                ('{"storyTime":{"startMomentId":"missing-moment"}}',),
            )
        active_bytes = self.location.database.read_bytes()
        backup_names = sorted(path.name for path in self.location.backups.iterdir())

        for operation in (self.services.backups.preview_local, self.services.backups.restore_local):
            with self.subTest(operation=operation.__name__), self.assertRaises(ValueError):
                operation(self.snapshot, self.location)
            self.assertEqual(self.location.database.read_bytes(), active_bytes)
            self.assertEqual(
                self.services.documents.load("manuscript", self.location.database), current
            )
            self.assertEqual(
                sorted(path.name for path in self.location.backups.iterdir()), backup_names
            )

    def test_storage_location_uses_actual_project_paths_and_successful_copy_timestamp(self):
        storage = self.services.backups.storage_location(self.location)
        self.assertEqual(storage["databasePath"], str(self.location.database))
        self.assertEqual(storage["backupDirectory"], str(self.location.backups))
        self.assertEqual(
            storage["lastSuccessfulBackup"],
            self.services.backups.list_local(self.location.backups)[0]["created"],
        )
        self.assertEqual(storage["scope"], "application-host")
        self.assertFalse(storage["canOpenFolder"])

    def test_committed_restore_reports_mirror_failure_as_a_warning(self):
        with patch.object(
            self.services.backups._local,
            "mirror_manuscript",
            side_effect=OSError(errno.ENOSPC, "mirror volume full"),
        ):
            result = self.services.backups.restore_local(self.snapshot, self.location)

        self.assertEqual(result, {"ok": True, "warnings": ["backup.mirror_failed"]})
        restored = self.services.documents.load("manuscript", self.location.database)
        self.assertEqual(restored.state["chapters"], self.original["chapters"])


if __name__ == "__main__":
    unittest.main()
