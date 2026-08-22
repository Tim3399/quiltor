from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from quiltor.application.documents import RevisionConflict
from quiltor.bootstrap import (
    build_application_services,
    build_feature_availability,
    build_observability,
)
from quiltor.delivery.http.routes import Request
from quiltor.delivery.http.routes import worlds as world_routes
from quiltor.hosts.mcp import quiltor_server as mcp
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths


class _Handler:
    def __init__(self):
        self.payload = None

    def send_json(self, payload, code=200, headers=None):
        self.payload = payload


class _WorldListSpy:
    def __init__(self):
        self.owners = []

    def list(self, owner=None):
        self.owners.append(owner)
        return [{"id": "w", "title": "World", "backupUrl": "", "updated": "now"}]


class ApplicationDeliveryParityTest(unittest.TestCase):
    def test_http_and_mcp_call_the_same_world_list_operation(self):
        operations = _WorldListSpy()
        handler = _Handler()
        app = SimpleNamespace(worlds=operations, lock=threading.Lock())
        request = Request(path="/api/worlds", session=SimpleNamespace(sub="alice"))

        world_routes.list_worlds(handler, request, app)
        with patch.object(mcp, "WORLDS", operations):
            mcp_result = mcp.call_tool("list_worlds", {})

        self.assertEqual(handler.payload["worlds"], mcp_result["worlds"])
        self.assertEqual(operations.owners, ["alice", None])


class SQLiteApplicationParityTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.services = build_application_services(
            build_feature_availability(),
            build_observability(),
            SQLitePaths.from_data_directory(root),
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_ownership_gate_is_preserved_at_the_use_case_boundary(self):
        created = self.services.worlds.create("Alice's world", "", "alice")
        opened = self.services.worlds.open(created["id"], "alice")

        self.assertEqual(opened.summary.id, created["id"])
        self.assertEqual(opened.summary.title, "Alice's world")
        self.assertEqual(opened.summary.backup_url, "")
        self.assertTrue(opened.summary.updated)
        with self.assertRaises(PermissionError):
            self.services.worlds.open(created["id"], "bob")

    def test_revision_conflict_is_translated_without_changing_its_message(self):
        created = self.services.worlds.create("Revision world", "", "alice")
        location = self.services.worlds.open(created["id"], "alice").paths.documents
        manuscript = self.services.documents.load("manuscript", location.database)
        state = manuscript.state

        first = self.services.documents.save("manuscript", state, 0, location)
        self.assertEqual(first, 1)
        with self.assertRaisesRegex(RevisionConflict, "0 → 1"):
            self.services.documents.save("manuscript", state, 0, location)


if __name__ == "__main__":
    unittest.main()
