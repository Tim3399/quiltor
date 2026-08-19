"""The assistant routes over real HTTP.

Every request names its world -- there is no process-wide active world in any
deployment -- so the fixture creates one and /api/assistant/chat carries its id
in the body, exactly as src/lib/api.ts does once a world is open.
"""

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend import identity
from backend.assistant.jobs import AssistantJobRunner
from backend.core import storage
import server


class _LiveServerTestCase(unittest.TestCase):
    """A real server.Server with the local identity, storage in a temp directory."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original_storage = (
            storage.DATA,
            storage.DB,
            storage.BACKUPS,
            storage.WORLDS,
            storage.ACTIVE_WORLD_ID,
        )
        storage.DATA = root
        storage.DB = root / ".no-active-world.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""

        self.original_server = (
            server.IDENTITY,
            server.BOUND_TO_LOOPBACK,
            server.ASSISTANT_JOBS,
        )
        server.IDENTITY = identity.LocalIdentity()
        server.BOUND_TO_LOOPBACK = True
        server.ASSISTANT_JOBS = AssistantJobRunner(
            server.ASSISTANT,
            root,
            interaction_logger=server._log_assistant_interaction,
        )
        server.ensure_dirs()

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        server.ASSISTANT_JOBS.close()
        server.IDENTITY, server.BOUND_TO_LOOPBACK, server.ASSISTANT_JOBS = self.original_server
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = (
            self.original_storage
        )
        self.temp.cleanup()

    def _request(self, method: str, path: str, body=None):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def _get(self, path: str):
        return self._request("GET", path)


class ServerAssistantRouteTests(_LiveServerTestCase):
    def setUp(self):
        super().setUp()
        # The world the local user owns. Created through the route rather than
        # storage directly, so the owner the session brings is the one that ends
        # up in the database -- the same path the frontend takes.
        status, body = self._request(
            "POST", "/api/worlds/create", {"title": "Testwelt", "backupUrl": ""}
        )
        self.assertEqual(status, 200, body)
        self.world_id = body["world"]["id"]
        self.db_path = storage.world_db_path(self.world_id)

    def _post(self, path: str, body: dict):
        return self._request("POST", path, {**body, "worldId": self.world_id})

    def _interactions(self):
        return storage.list_assistant_interactions(db_path=self.db_path)

    def test_chat_happy_path_persists_and_returns_the_interaction(self):
        mock_reply = {
            "message": "Alles bereit.",
            "citations": [],
            "proposals": [],
            "sources": [],
            "agentTrace": [],
        }
        assistant = MagicMock(complete=MagicMock(return_value=mock_reply))
        with patch.object(server.ASSISTANT_JOBS, "assistant", assistant):
            status, body = self._post(
                "/api/assistant/chat", {"question": "Wie geht es Tarek?", "history": []}
            )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["message"], "Alles bereit.")
        self.assertIn("interactionId", body)
        assistant.complete.assert_called_once()
        logged = self._interactions()
        self.assertEqual(len(logged), 1)
        self.assertEqual(logged[0]["status"], "completed")

    def test_the_interaction_is_logged_in_the_worlds_own_database(self):
        """The world in the body is what decides where the log lands -- not a
        process-global database, which no longer exists."""
        mock_reply = {
            "message": "ok",
            "citations": [],
            "proposals": [],
            "sources": [],
            "agentTrace": [],
        }
        assistant = MagicMock(complete=MagicMock(return_value=mock_reply))
        with patch.object(server.ASSISTANT_JOBS, "assistant", assistant):
            self._post("/api/assistant/chat", {"question": "Wie geht es Tarek?", "history": []})
        self.assertEqual(len(self._interactions()), 1)
        self.assertEqual(storage.list_assistant_interactions(), [])  # the sentinel stays empty

    def test_a_chat_without_a_world_is_refused_before_the_assistant_runs(self):
        assistant = MagicMock()
        with patch.object(server.ASSISTANT_JOBS, "assistant", assistant):
            status, body = self._request(
                "POST", "/api/assistant/chat", {"question": "Wer ist Tarek?"}
            )
        self.assertEqual(status, 400)
        self.assertFalse(body["ok"])
        assistant.complete.assert_not_called()

    def test_a_chat_naming_an_unknown_world_is_refused(self):
        assistant = MagicMock()
        with patch.object(server.ASSISTANT_JOBS, "assistant", assistant):
            status, body = self._request(
                "POST", "/api/assistant/chat", {"question": "Wer ist Tarek?", "worldId": "0" * 32}
            )
        self.assertEqual(status, 404)
        self.assertFalse(body["ok"])
        assistant.complete.assert_not_called()

    def test_empty_question_is_rejected_without_calling_the_assistant(self):
        assistant = MagicMock()
        with patch.object(server.ASSISTANT_JOBS, "assistant", assistant):
            status, body = self._post("/api/assistant/chat", {"question": "   ", "history": []})
        self.assertEqual(status, 400)
        self.assertFalse(body["ok"])
        assistant.complete.assert_not_called()

    def test_oversized_question_is_rejected_without_calling_the_assistant(self):
        assistant = MagicMock()
        with patch.object(server.ASSISTANT_JOBS, "assistant", assistant):
            status, body = self._post(
                "/api/assistant/chat", {"question": "x" * 4001, "history": []}
            )
        self.assertEqual(status, 400)
        self.assertFalse(body["ok"])
        assistant.complete.assert_not_called()

    def test_history_longer_than_forty_entries_is_truncated_before_reaching_the_assistant(self):
        mock_reply = {
            "message": "ok",
            "citations": [],
            "proposals": [],
            "sources": [],
            "agentTrace": [],
        }
        long_history = [{"role": "user", "content": f"turn {i}"} for i in range(60)]
        assistant = MagicMock(complete=MagicMock(return_value=mock_reply))
        with patch.object(server.ASSISTANT_JOBS, "assistant", assistant):
            self._post("/api/assistant/chat", {"question": "Und jetzt?", "history": long_history})
        sent_history = assistant.complete.call_args[0][3]
        self.assertEqual(len(sent_history), 40)
        self.assertEqual(sent_history[0]["content"], "turn 20")
        self.assertEqual(sent_history[-1]["content"], "turn 59")

    def test_assistant_failure_is_logged_with_failed_status_and_returns_503(self):
        assistant = MagicMock(
            complete=MagicMock(side_effect=RuntimeError("Das lokale Modell ist nicht erreichbar."))
        )
        with patch.object(server.ASSISTANT_JOBS, "assistant", assistant):
            status, body = self._post(
                "/api/assistant/chat", {"question": "Wie geht es Tarek?", "history": []}
            )
        self.assertEqual(status, 503)
        self.assertFalse(body["ok"])
        self.assertIn("nicht erreichbar", body["fehler"])
        logged = self._interactions()
        self.assertEqual(len(logged), 1)
        self.assertEqual(logged[0]["status"], "failed")

    def test_status_route_reflects_the_current_worlds_chunk_count(self):
        storage.save_manuscript(
            {"chapters": [{"id": "c1", "title": "Eins", "body": "Text.", "note": ""}]},
            db_path=self.db_path,
        )
        storage.save_figures({"nodes": [], "edges": []}, db_path=self.db_path)
        fake_status = {"available": True, "mode": "local", "reason": ""}
        with patch.object(
            server, "ASSISTANT", MagicMock(status=MagicMock(return_value=fake_status))
        ):
            status, body = self._get(f"/api/assistant/status?world={self.world_id}")
        self.assertEqual(status, 200)
        self.assertTrue(body["available"])
        self.assertGreaterEqual(body["chunks"], 1)


class FreshInstallRouteTests(_LiveServerTestCase):
    """A first launch: server.ensure_dirs() has run and nothing else exists yet.

    There is no active world any more -- not locally either -- so a route that
    reads a world's documents has to be told which one. Both halves are pinned
    here: a request that names no world is refused instead of quietly reading
    whatever database the process happens to hold, and a world created on this
    fresh install reads as empty rather than failing. The second half is the bug
    this class was written for: sqlite3 raised "no such table" on a schema-less
    file, which surfaced as a dropped connection rather than a clean reply.
    """

    def test_world_routes_without_a_world_are_refused(self):
        for route in (
            "/api/state",
            "/api/manuscript",
            "/api/assistant/status",
            "/api/assistant/logs",
        ):
            with self.subTest(route=route):
                status, body = self._get(route)
                self.assertEqual(status, 400)
                self.assertFalse(body["ok"])

    def test_a_world_that_does_not_exist_is_a_404_not_an_empty_read(self):
        status, body = self._get(f"/api/manuscript?world={'0' * 32}")
        self.assertEqual(status, 404)
        self.assertFalse(body["ok"])

    def test_a_freshly_created_world_reads_as_empty_instead_of_failing(self):
        status, body = self._request(
            "POST", "/api/worlds/create", {"title": "Erste Welt", "backupUrl": ""}
        )
        self.assertEqual(status, 200, body)
        world_id = body["world"]["id"]

        fake_status = {"available": False, "mode": "local", "reason": ""}
        with patch.object(
            server, "ASSISTANT", MagicMock(status=MagicMock(return_value=fake_status))
        ):
            status, body = self._get(f"/api/assistant/status?world={world_id}")
        self.assertEqual(status, 200)
        self.assertEqual(body["chunks"], 0)

        status, body = self._get(f"/api/assistant/logs?world={world_id}")
        self.assertEqual(status, 200)
        self.assertEqual(body["interactions"], [])

        for route in ("/api/state", "/api/manuscript"):
            with self.subTest(route=route):
                self.assertEqual(self._get(f"{route}?world={world_id}")[0], 200)

    def test_storage_reads_do_not_raise_without_an_active_world(self):
        """ensure_dirs() gives the .no-active-world sentinel its schema, for the
        callers that still reach storage without a request: the MCP server and
        the seed scripts."""
        self.assertEqual(storage.load_manuscript()["chapters"], [])
        self.assertEqual(storage.list_assistant_interactions(), [])


if __name__ == "__main__":
    unittest.main()
