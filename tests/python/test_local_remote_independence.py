"""Remote failures cannot revoke the current local document or recovery paths."""

from __future__ import annotations

import copy
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from quiltor.application.backups import BackupAuthorization, BackupGatewayError
from quiltor.bootstrap import (
    build_application_services,
    build_feature_availability,
    build_observability,
)
from quiltor.infrastructure.persistence.sqlite import restore
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths


class LocalRemoteIndependenceTests(unittest.TestCase):
    def test_remote_transport_failures_preserve_local_save_trash_and_restore(self):
        endpoint = "https://backup.invalid"
        failures = {
            "unreachable": urllib.error.URLError("unreachable"),
            "timeout": TimeoutError("timed out"),
            "expired-token": urllib.error.HTTPError(endpoint, 401, "Unauthorized", {}, None),
            "quota-exhausted": urllib.error.HTTPError(
                endpoint, 507, "Insufficient Storage", {}, None
            ),
        }
        for label, failure in failures.items():
            with self.subTest(failure=label), tempfile.TemporaryDirectory() as directory:
                services = build_application_services(
                    build_feature_availability(),
                    build_observability(),
                    SQLitePaths.from_data_directory(Path(directory)),
                )
                world = services.worlds.create("Lokales Schreiben", endpoint, "author")
                location = services.worlds.open(world["id"], "author").paths.documents
                initial = services.documents.load("manuscript", location.database)
                draft = copy.deepcopy(initial.state)
                draft["chapters"] = [
                    {"id": "opening", "title": "Anfang", "body": "Vor dem Ausfall.", "note": ""}
                ]
                draft.pop("structure", None)
                saved = services.documents.save("manuscript", draft, initial.revision, location)
                restore.backup_if_due(
                    force=True, db_path=location.database, backups_dir=location.backups
                )
                snapshot = services.backups.list_local(location.backups)[0]["name"]
                context = services.backups.context(world["id"], endpoint, location)

                with patch("urllib.request.OpenerDirector.open", side_effect=failure) as transport:
                    with self.assertRaises(BackupGatewayError) as caught:
                        services.backups.commit(
                            context,
                            "Lokaler Stand",
                            push=True,
                            authorization=BackupAuthorization(endpoint, "test-token"),
                        )
                    self.assertTrue(caught.exception.params["snapshotCreated"])
                    self.assertGreater(transport.call_count, 0)
                    remote_calls = transport.call_count

                    exported_title, archive = services.project_transfer.export(
                        world["id"], "author"
                    )
                    self.assertEqual(exported_title, "Lokales Schreiben")
                    self.assertEqual(
                        services.project_transfer.preview(archive)["title"],
                        "Lokales Schreiben",
                    )
                    imported = services.project_transfer.import_archive(archive, "author")
                    self.assertNotEqual(imported["id"], world["id"])
                    imported_location = services.worlds.open(
                        imported["id"], "author"
                    ).paths.documents
                    self.assertEqual(
                        services.documents.load("manuscript", imported_location.database).state,
                        services.documents.load("manuscript", location.database).state,
                    )

                    edited = copy.deepcopy(draft)
                    edited["chapters"][0]["body"] = "Nach dem Ausfall weitergeschrieben."
                    revision = services.documents.save("manuscript", edited, saved, location)
                    current = services.documents.load("manuscript", location.database)
                    self.assertEqual(current.revision, revision)
                    self.assertEqual(
                        current.state["chapters"][0]["body"], edited["chapters"][0]["body"]
                    )

                    services.worlds.delete(world["id"], "author")
                    self.assertEqual(services.worlds.list_trash("author")[0]["id"], world["id"])
                    services.worlds.restore(world["id"], "author")
                    services.backups.restore_local(snapshot, location)
                    restored = services.documents.load("manuscript", location.database)
                    self.assertEqual(restored.state["chapters"][0]["body"], "Vor dem Ausfall.")
                    self.assertGreater(restored.revision, revision)
                    self.assertEqual(transport.call_count, remote_calls)


if __name__ == "__main__":
    unittest.main()
