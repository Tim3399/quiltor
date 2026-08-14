import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend import storage
import server


class ServerAssistantRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original_storage = (storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID)
        storage.DATA = root
        storage.DB = root / "test.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""
        storage.initialize()

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = self.original_storage
        self.temp.cleanup()

    def _post(self, path: str, body: dict):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_chat_happy_path_persists_and_returns_the_interaction(self):
        mock_reply = {"message": "Alles bereit.", "citations": [], "proposals": [], "sources": [], "agentTrace": []}
        with patch.object(server, "ASSISTANT", MagicMock(complete=MagicMock(return_value=mock_reply))) as assistant:
            status, body = self._post("/api/assistant/chat", {"question": "Wie geht es Tarek?", "history": []})
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["message"], "Alles bereit.")
        self.assertIn("interactionId", body)
        assistant.complete.assert_called_once()
        logged = storage.list_assistant_interactions()
        self.assertEqual(len(logged), 1)
        self.assertEqual(logged[0]["status"], "completed")

    def test_empty_question_is_rejected_without_calling_the_assistant(self):
        with patch.object(server, "ASSISTANT", MagicMock()) as assistant:
            status, body = self._post("/api/assistant/chat", {"question": "   ", "history": []})
        self.assertEqual(status, 503)
        self.assertFalse(body["ok"])
        assistant.complete.assert_not_called()

    def test_oversized_question_is_rejected_without_calling_the_assistant(self):
        with patch.object(server, "ASSISTANT", MagicMock()) as assistant:
            status, body = self._post("/api/assistant/chat", {"question": "x" * 4001, "history": []})
        self.assertEqual(status, 503)
        self.assertFalse(body["ok"])
        assistant.complete.assert_not_called()

    def test_history_longer_than_forty_entries_is_truncated_before_reaching_the_assistant(self):
        mock_reply = {"message": "ok", "citations": [], "proposals": [], "sources": [], "agentTrace": []}
        long_history = [{"role": "user", "content": f"turn {i}"} for i in range(60)]
        with patch.object(server, "ASSISTANT", MagicMock(complete=MagicMock(return_value=mock_reply))) as assistant:
            self._post("/api/assistant/chat", {"question": "Und jetzt?", "history": long_history})
        sent_history = assistant.complete.call_args[0][3]
        self.assertEqual(len(sent_history), 40)
        self.assertEqual(sent_history[0]["content"], "turn 20")
        self.assertEqual(sent_history[-1]["content"], "turn 59")

    def test_assistant_failure_is_logged_with_failed_status_and_returns_503(self):
        with patch.object(server, "ASSISTANT", MagicMock(complete=MagicMock(side_effect=RuntimeError("Das lokale Modell ist nicht erreichbar.")))):
            status, body = self._post("/api/assistant/chat", {"question": "Wie geht es Tarek?", "history": []})
        self.assertEqual(status, 503)
        self.assertFalse(body["ok"])
        self.assertIn("nicht erreichbar", body["fehler"])
        logged = storage.list_assistant_interactions()
        self.assertEqual(len(logged), 1)
        self.assertEqual(logged[0]["status"], "failed")

    def test_status_route_reflects_the_current_worlds_chunk_count(self):
        storage.save_manuscript({"chapters": [{"id": "c1", "title": "Eins", "body": "Text.", "note": ""}]})
        storage.save_figures({"nodes": [], "edges": []})
        fake_status = {"available": True, "mode": "local", "reason": ""}
        with patch.object(server, "ASSISTANT", MagicMock(status=MagicMock(return_value=fake_status))):
            request = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/assistant/status")
            with urllib.request.urlopen(request, timeout=5) as response:
                body = json.loads(response.read())
        self.assertTrue(body["available"])
        self.assertGreaterEqual(body["chunks"], 1)


class FreshInstallRouteTests(unittest.TestCase):
    """A first launch, before any world has been created or opened.

    storage.DB is still the .no-active-world sentinel here, and -- unlike every
    other test in this file -- setUp deliberately does NOT call
    storage.initialize(), because that is exactly what masked the bug this class
    covers: server.ensure_dirs() is the only thing that runs on a real first
    launch, and the routes below are polled by the frontend before a world exists.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original_storage = (storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID)
        storage.DATA = root
        storage.DB = root / ".no-active-world.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""
        server.ensure_dirs()

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = self.original_storage
        self.temp.cleanup()

    def _get(self, path: str):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}")
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())

    def test_assistant_status_reads_as_empty_instead_of_failing(self):
        fake_status = {"available": False, "mode": "local", "reason": ""}
        with patch.object(server, "ASSISTANT", MagicMock(status=MagicMock(return_value=fake_status))):
            status, body = self._get("/api/assistant/status")
        self.assertEqual(status, 200)
        self.assertEqual(body["chunks"], 0)

    def test_assistant_logs_reads_as_empty_instead_of_failing(self):
        status, body = self._get("/api/assistant/logs")
        self.assertEqual(status, 200)
        self.assertEqual(body["interactions"], [])

    def test_world_data_routes_read_as_empty_instead_of_failing(self):
        for route in ("/api/state", "/api/manuscript"):
            with self.subTest(route=route):
                status, _ = self._get(route)
                self.assertEqual(status, 200)

    def test_storage_reads_do_not_raise_without_an_active_world(self):
        """The underlying cause: sqlite3 raised "no such table" on the schema-less
        sentinel, which surfaced as a dropped connection rather than a clean reply."""
        self.assertEqual(storage.load_manuscript()["chapters"], [])
        self.assertEqual(storage.list_assistant_interactions(), [])


if __name__ == "__main__":
    unittest.main()
