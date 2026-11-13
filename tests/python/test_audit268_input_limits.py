"""T-268 phase 4, group C: resource limits of the web server and its routes.

S268-102 (thread cap, relay poll cap, body timeout), S268-103 (grammar check per account),
S268-9 (worlds per account). All run against the hosted harness; no LanguageTool is needed,
the check is stubbed behind the limit.
"""

from __future__ import annotations

import base64
import http.client
import socket
import threading
import time
import unittest
from unittest.mock import patch

from quiltor.delivery.http.routes import writing_assistance
from quiltor.hosts.web import server
from tests.python.test_audit268_identity_support import SESSION_COOKIE, HostedHarness

CHECK = "/api/writing-assistance/check"
OK_RESULT = {"ok": True, "matches": []}


class GrammarLimitTests(HostedHarness):
    def setUp(self) -> None:
        super().setUp()
        # The limiter is process-wide; every test starts with an empty one.
        patcher = patch.object(
            writing_assistance, "grammar_limiter", writing_assistance.GrammarLimiter()
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _check(self, session: str):
        return self.json_request(
            "POST",
            CHECK,
            {"language": "de-DE", "text": "Hallo Welt.", "customWords": []},
            cookies={SESSION_COOKIE: session},
        )

    def test_a_second_concurrent_check_of_one_account_is_refused_with_retry_after(self) -> None:
        alice = self.login("alice")
        bob = self.login("bob")
        entered = threading.Event()
        release = threading.Event()

        def slow_check(language, text, words):
            entered.set()
            release.wait(10)
            return OK_RESULT

        results: list[int] = []
        with (
            patch.dict("os.environ", {"QUILTOR_GRAMMAR_MAX_CONCURRENT": "1"}),
            patch.object(self.application.writing_assistance, "check", slow_check),
        ):
            first = threading.Thread(target=lambda: results.append(self._check(alice)[0]))
            first.start()
            self.assertTrue(entered.wait(5))
            status, document, headers, _ = self._check(alice)
            self.assertEqual(status, 429)
            self.assertEqual(document["error"]["code"], "writing_assistance.rate_limited")
            self.assertTrue(headers["retry-after"].isdigit())
            # Another account is not affected by alice's running check.
            release.set()
            self.assertEqual(self._check(bob)[0], 200)
            first.join(10)
        self.assertEqual(results, [200])
        # Once the first check is done the slot is free again.
        with patch.object(self.application.writing_assistance, "check", lambda *a: OK_RESULT):
            self.assertEqual(self._check(alice)[0], 200)

    def test_checks_over_the_rate_are_refused_until_the_window_has_passed(self) -> None:
        alice = self.login("alice")
        with (
            patch.dict("os.environ", {"QUILTOR_GRAMMAR_MAX_PER_MINUTE": "2"}),
            patch.object(self.application.writing_assistance, "check", lambda *a: OK_RESULT),
        ):
            self.assertEqual([self._check(alice)[0] for _ in range(2)], [200, 200])
            status, _, headers, _ = self._check(alice)
            self.assertEqual(status, 429)
            self.assertGreaterEqual(int(headers["retry-after"]), 1)


class WorldQuotaTests(HostedHarness):
    def _create(self, session: str):
        return self.json_request(
            "POST",
            "/api/worlds/create",
            {"title": "W", "backupUrl": ""},
            cookies={SESSION_COOKIE: session},
        )

    def test_the_number_of_worlds_per_account_is_capped_but_not_for_others(self) -> None:
        alice = self.login("alice")
        bob = self.login("bob")
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLDS_PER_ACCOUNT": "2"}):
            self.assertEqual([self._create(alice)[0] for _ in range(2)], [200, 200])
            status, document, _, _ = self._create(alice)
            self.assertEqual(status, 403)
            self.assertEqual(document["error"]["code"], "world.quota")
            self.assertEqual(self._create(bob)[0], 200)

    def test_the_total_size_of_an_accounts_worlds_is_capped(self) -> None:
        alice = self.login("alice")
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"}):
            self.assertEqual(self._create(alice)[0], 200)
            # The first world's SQLite file alone is more than one byte.
            status, document, _, _ = self._create(alice)
            self.assertEqual(status, 403)
            self.assertEqual(document["error"]["code"], "world.quota")


class ThreadLimitTests(HostedHarness):
    def _second_server(self, limit: int) -> tuple[server.Server, threading.Thread]:
        with patch.object(server, "MAX_HANDLER_THREADS", limit):
            httpd = server.Server(("127.0.0.1", 0), server.Handler, self.application)
        thread = threading.Thread(
            target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        thread.start()
        return httpd, thread

    def test_a_full_handler_pool_answers_503_with_retry_after(self) -> None:
        httpd, thread = self._second_server(1)
        port = httpd.server_address[1]
        holder = socket.create_connection(("127.0.0.1", port), timeout=5)
        try:
            holder.sendall(b"GET /api/version HTTP/1.1\r\nHost: 127.0.0.1\r\n")  # never finished
            time.sleep(0.3)
            probe = socket.create_connection(("127.0.0.1", port), timeout=5)
            try:
                reply = probe.recv(4096)
            finally:
                probe.close()
            self.assertTrue(reply.startswith(b"HTTP/1.0 503"), reply)
            self.assertIn(b"Retry-After: 5", reply)
        finally:
            holder.close()
            httpd.shutdown()
            httpd.server_close()
            thread.join(5)

    def test_a_finished_connection_gives_its_slot_back(self) -> None:
        httpd, thread = self._second_server(1)
        port = httpd.server_address[1]
        try:
            for _ in range(3):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("GET", "/api/version", headers={"Connection": "close"})
                conn.getresponse().read()
                conn.close()
                time.sleep(0.1)
            self.assertTrue(httpd._thread_slots.acquire(blocking=False))
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(5)

    def test_relay_long_polls_cannot_use_more_than_their_own_pool(self) -> None:
        alice = self.login("alice")
        world = self.create_world(alice)
        self.httpd.relay_poll_slots = threading.BoundedSemaphore(0)
        status, document, headers, _ = self.json_request(
            "GET",
            f"/api/assistant/relay/next?world={world}&job=none",
            cookies={SESSION_COOKIE: alice},
        )
        self.assertEqual(status, 503)
        self.assertEqual(document["error"]["code"], "server.busy")
        self.assertEqual(headers["retry-after"], "5")


class BodyTimeoutTests(HostedHarness):
    def test_a_body_that_never_arrives_is_given_up_on(self) -> None:
        alice = self.login("alice")
        world = self.create_world(alice)
        with patch.object(server, "BODY_RECV_TIMEOUT_SECONDS", 0.4):
            sock = socket.create_connection(("127.0.0.1", self.port), timeout=10)
            try:
                sock.sendall(
                    (
                        f"POST /api/state?world={world} HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
                        f"Cookie: {SESSION_COOKIE}={alice}\r\n"
                        "Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"
                    ).encode()
                )
                started = time.monotonic()
                reply = b""
                while chunk := sock.recv(4096):  # the server closes after giving up
                    reply += chunk
            finally:
                sock.close()
        self.assertRegex(reply[:20], rb"HTTP/1\.[01] 400", reply)
        self.assertLess(time.monotonic() - started, 5)


if __name__ == "__main__":
    unittest.main()


class WorldQuotaOnEveryWayTests(HostedHarness):
    """S268-9: every way that makes a world asks the same limit, not only /api/worlds/create."""

    def setUp(self) -> None:
        # Started before the harness and stopped after it: patch.dict restores the snapshot it
        # took, so stopping this one after the harness's own would put the harness's hosted
        # environment back into os.environ for every later test.
        env = patch.dict("os.environ", {"QUILTOR_MAX_WORLDS_PER_ACCOUNT": "1"})
        env.start()
        self.addCleanup(env.stop)
        super().setUp()
        self.alice = self.login("alice")
        self.bob = self.login("bob")
        self.create_world(self.alice)  # alice is now at her limit

    def _worlds(self, session: str) -> list[str]:
        _, document, _, _ = self.json_request(
            "GET", "/api/worlds", cookies={SESSION_COOKIE: session}
        )
        return [world["id"] for world in document["worlds"]]

    def _assert_refused(self, status: int, document) -> None:
        self.assertEqual(status, 403)
        self.assertEqual(document["error"]["code"], "world.quota")

    def _manuscript_import(self, path: str, session: str):
        return self.json_request(
            "POST",
            path,
            {
                "fileName": "x.docx",
                "dataBase64": base64.b64encode(b"x").decode("ascii"),
                "sourceSha256": "0" * 64,
                "title": "T",
                "chapters": [],
                "acknowledgedWarnings": [],
                "requestId": "r" * 16,
            },
            cookies={SESSION_COOKIE: session},
        )

    def _project_import(self, session: str):
        return self.json_request(
            "POST",
            "/api/project-transfer/import",
            raw=b"not an archive",
            headers={"Content-Type": "application/zip"},
            cookies={SESSION_COOKIE: session},
        )

    def test_the_example_world_is_refused_over_the_limit(self) -> None:
        status, document, _, _ = self.json_request(
            "POST", "/api/worlds/open-example", {"lang": "de"}, cookies={SESSION_COOKIE: self.alice}
        )
        self._assert_refused(status, document)
        status, _, _, _ = self.json_request(
            "POST", "/api/worlds/open-example", {"lang": "de"}, cookies={SESSION_COOKIE: self.bob}
        )
        self.assertEqual(status, 200)

    def test_the_manuscript_import_is_refused_over_the_limit(self) -> None:
        for path in ("/api/manuscript-import/import", "/api/manuscript-import/v2/import"):
            with self.subTest(path=path):
                status, document, _, _ = self._manuscript_import(path, self.alice)
                self._assert_refused(status, document)
                # Not the limit: bob gets past it and fails on the invalid file instead.
                status, document, _, _ = self._manuscript_import(path, self.bob)
                self.assertNotEqual(document["error"]["code"], "world.quota")

    def test_the_project_import_is_refused_over_the_limit(self) -> None:
        status, document, _, _ = self._project_import(self.alice)
        self._assert_refused(status, document)
        status, document, _, _ = self._project_import(self.bob)
        self.assertNotEqual(document["error"]["code"], "world.quota")
        self.assertEqual(len(self._worlds(self.alice)), 1)
