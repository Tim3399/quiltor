"""A failed derived mirror never misreports an already committed document."""

from __future__ import annotations

import errno
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from quiltor.application.document_wire_v1 import encode_document_v1
from quiltor.bootstrap import (
    build_application_services,
    build_feature_availability,
    build_observability,
)
from quiltor.delivery.http.routes import Request
from quiltor.delivery.http.routes.documents import write_manuscript
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths


class DocumentSaveStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.services = build_application_services(
            build_feature_availability(),
            build_observability(),
            SQLitePaths.from_data_directory(Path(self.temp.name)),
        )
        world = self.services.worlds.create("Schreibprojekt", "", "author")
        self.location = self.services.worlds.open(world["id"], "author").paths.documents

    def test_success_ack_separates_failed_mirror_and_retry_uses_committed_revision(self):
        document = {"chapters": [{"id": "c", "title": "Anfang", "body": "Neu.", "note": ""}]}
        responses = []
        handler = SimpleNamespace(
            headers={"If-Match": '"0"'},
            _read_json_body=lambda: encode_document_v1("manuscript", document, 0),
            send_json=lambda payload, headers: responses.append((payload, headers)),
        )
        request = Request(
            path="/api/manuscript",
            world=SimpleNamespace(document_location=self.location),
        )
        with patch.object(
            self.services.documents._local_backups,
            "mirror_manuscript",
            side_effect=OSError(errno.ENOSPC, "mirror volume full"),
        ):
            write_manuscript(
                handler,
                request,
                SimpleNamespace(documents=self.services.documents, lock=threading.Lock()),
            )

        payload, headers = responses[0]
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["revision"], 1)
        self.assertEqual(payload["warnings"], ["backup.mirror_failed"])
        self.assertEqual(headers["ETag"], '"1"')
        persisted = self.services.documents.load("manuscript", self.location.database)
        self.assertEqual(persisted.revision, 1)
        self.assertEqual(persisted.state["chapters"][0]["body"], "Neu.")
        saved = self.services.documents.save_with_status("manuscript", document, 1, self.location)
        self.assertEqual(saved.revision, 2)
        self.assertEqual(saved.warnings, ())

    def test_failed_prewrite_safety_copy_keeps_current_document_and_revision(self):
        before = self.services.documents.load("manuscript", self.location.database)
        with (
            patch.object(
                self.services.documents._local_backups,
                "backup_if_due",
                side_effect=OSError(errno.ENOSPC, "backup volume full"),
            ),
            self.assertRaises(OSError),
        ):
            self.services.documents.save_with_status(
                "manuscript", {"chapters": []}, before.revision, self.location
            )
        self.assertEqual(self.services.documents.load("manuscript", self.location.database), before)


if __name__ == "__main__":
    unittest.main()
