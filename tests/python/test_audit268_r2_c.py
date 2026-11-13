"""T-268 fix round 2, group C: byte limit on every write, grammar slot, three missing tests.

F-268-18 (the byte limit counts the version history and holds on every route that adds bytes),
F-268-20 (an aborted grammar check does not keep its place), F-268-22 C1 (a body that trickles
in), C7 (a local server is not limited) and D2 (a queued server job after the role is gone,
through the real wiring of `build_web_application`).
"""

from __future__ import annotations

import base64
import os
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from quiltor.bootstrap import build_identity, build_web_application
from quiltor.delivery.http import world_quota
from quiltor.delivery.http.routes import writing_assistance
from quiltor.hosts.web import server
from tests.python.test_assistant_jobs import JOB_WAIT_SECONDS, execution, intent
from tests.python.test_audit268_identity_support import (
    ISSUER,
    SESSION_COOKIE,
    FakeProvider,
    HostedHarness,
    make_directories,
)
from tests.python.test_server_logging import _LiveServer

CHECK = "/api/writing-assistance/check"
OK_RESULT = {"ok": True, "matches": []}


def _raw_post(port: int, path: str, cookie: str, body: bytes) -> socket.socket:
    """Send a whole request on a fresh connection and leave it open for the caller."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=10)
    sock.sendall(
        (
            f"POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
            f"Cookie: {SESSION_COOKIE}={cookie}\r\n"
            f"Content-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n"
        ).encode()
        + body
    )
    return sock


class GrammarAbortTests(HostedHarness):
    """F-268-20: the client aborts its old check; the server thread stays in LanguageTool."""

    def setUp(self) -> None:
        super().setUp()
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

    def _first_check_is_slow(self):
        entered = threading.Event()
        release = threading.Event()
        calls: list[int] = []

        def check(language, text, words):
            calls.append(1)
            if len(calls) == 1:
                entered.set()
                release.wait(10)
            return OK_RESULT

        return entered, release, check

    def test_an_aborted_check_does_not_keep_the_place_of_the_next_one(self) -> None:
        alice = self.login("alice")
        entered, release, check = self._first_check_is_slow()
        body = b'{"language": "de-DE", "text": "Hallo Welt.", "customWords": []}'
        with (
            patch.dict("os.environ", {"QUILTOR_GRAMMAR_MAX_CONCURRENT": "1"}),
            patch.object(self.application.writing_assistance, "check", check),
        ):
            old = _raw_post(self.port, CHECK, alice, body)
            self.assertTrue(entered.wait(5))
            old.close()  # the client gave up on it
            status, document, _, _ = self._check(alice)
            release.set()
        self.assertEqual(status, 200, document)

    def test_the_older_check_of_a_session_loses_its_result(self) -> None:
        alice = self.login("alice")
        entered, release, check = self._first_check_is_slow()
        results: list[tuple[int, object]] = []

        def first() -> None:
            status, document, _, _ = self._check(alice)
            results.append((status, document))

        with (
            patch.dict("os.environ", {"QUILTOR_GRAMMAR_MAX_CONCURRENT": "1"}),
            patch.object(self.application.writing_assistance, "check", check),
        ):
            thread = threading.Thread(target=first)
            thread.start()
            self.assertTrue(entered.wait(5))
            self.assertEqual(self._check(alice)[0], 200)  # the newer check
            release.set()
            thread.join(10)
        ((status, document),) = results
        self.assertEqual(status, 429)
        self.assertEqual(document["error"]["code"], "writing_assistance.rate_limited")

    def test_another_session_of_the_account_is_still_held_to_the_limit(self) -> None:
        first_session = self.login("alice")
        second_session = self.login("alice")
        self.assertNotEqual(first_session, second_session)
        entered, release, check = self._first_check_is_slow()
        results: list[int] = []
        with (
            patch.dict("os.environ", {"QUILTOR_GRAMMAR_MAX_CONCURRENT": "1"}),
            patch.object(self.application.writing_assistance, "check", check),
        ):
            thread = threading.Thread(target=lambda: results.append(self._check(first_session)[0]))
            thread.start()
            self.assertTrue(entered.wait(5))
            status, document, _, _ = self._check(second_session)
            release.set()
            thread.join(10)
        self.assertEqual(status, 429)
        self.assertEqual(document["error"]["code"], "writing_assistance.rate_limited")
        self.assertEqual(results, [200])  # the first session's check was not displaced


class WorldBytesOnEveryWriteTests(HostedHarness):
    """F-268-18: the byte limit counts the history and holds on every route that adds bytes."""

    def setUp(self) -> None:
        super().setUp()
        # Every answer is counted afresh; the cache is exercised on its own below.
        patcher = patch.object(world_quota, "BYTES_CACHE_SECONDS", 0.0)
        patcher.start()
        self.addCleanup(patcher.stop)
        world_quota._room_until.clear()
        self.alice = self.login("alice")
        self.cookies = {SESSION_COOKIE: self.alice}
        self.world = self.create_world(self.alice)

    def _services(self):
        return self.application.route_services("/api/worlds")

    def _on_disk(self) -> int:
        """Every byte of the world, counted without the code under test."""
        total = 0
        for directory, _names, files in os.walk(self.root):
            for name in files:
                path = Path(directory) / name
                if self.world in str(path):
                    total += path.stat().st_size
        return total

    def _backup(self, message: str):
        return self.json_request(
            "POST", "/api/backup", {"worldId": self.world, "message": message}, cookies=self.cookies
        )

    def _assert_refused(self, status, document) -> None:
        self.assertEqual(status, 403, document)
        self.assertEqual(document["error"]["code"], "world.quota")

    def test_the_version_history_counts_against_the_limit(self) -> None:
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": str(10**9)}):
            self.assertEqual(self._backup("one")[0], 200)
        history = self.root / "history" / self.world
        history_bytes = sum(p.stat().st_size for p in history.rglob("*") if p.is_file())
        self.assertGreater(history_bytes, 2)
        total = self._on_disk()
        # One byte under what the world holds: only a count that includes the history reaches it.
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": str(total - 1)}):
            self.assertGreaterEqual(
                world_quota._world_bytes(self._services(), self.world), history_bytes
            )
            self._assert_refused(*self._backup("two")[:2])

    def test_keeping_a_version_is_refused_over_the_limit(self) -> None:
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"}):
            for round_number in range(3):
                self._assert_refused(*self._backup(f"probe {round_number}")[:2])
        history = self.root / "history" / self.world
        self.assertFalse(history.exists() and any(history.rglob("*.*")), "nothing was written")

    def test_saving_the_manuscript_is_refused_over_the_limit(self) -> None:
        # What each document answers with is a body it accepts back.
        bodies = {}
        for kind in ("manuscript", "state", "storyboards"):
            status, document, _, _ = self.json_request(
                "GET", f"/api/{kind}?world={self.world}", cookies=self.cookies
            )
            self.assertEqual(status, 200, document)
            bodies[kind] = document
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"}):
            for kind, body in bodies.items():
                with self.subTest(kind=kind):
                    status, document, _, _ = self.json_request(
                        "POST", f"/api/{kind}?world={self.world}", body, cookies=self.cookies
                    )
                    self._assert_refused(status, document)
        # Under the limit the same body is saved.
        status, document, _, _ = self.json_request(
            "POST",
            f"/api/manuscript?world={self.world}",
            bodies["manuscript"],
            cookies=self.cookies,
        )
        self.assertEqual(status, 200, document)

    def test_uploading_a_map_is_refused_over_the_limit(self) -> None:
        data = base64.b64encode(b"not an image").decode("ascii")
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"}):
            status, document, _, _ = self.json_request(
                "POST", f"/api/place-maps?world={self.world}", {"data": data}, cookies=self.cookies
            )
        self._assert_refused(status, document)
        # Under the limit the same upload gets as far as the image check.
        status, document, _, _ = self.json_request(
            "POST", f"/api/place-maps?world={self.world}", {"data": data}, cookies=self.cookies
        )
        self.assertNotEqual((document or {}).get("error", {}).get("code"), "world.quota")

    def test_putting_a_version_back_is_refused_over_the_limit(self) -> None:
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"}):
            status, document, _, _ = self.json_request(
                "POST",
                f"/api/history/restore?world={self.world}",
                {"id": "x"},
                cookies=self.cookies,
            )
        self._assert_refused(status, document)

    def test_reading_and_deleting_stay_open_over_the_limit(self) -> None:
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"}):
            status, _, _, _ = self.json_request(
                "GET", f"/api/manuscript?world={self.world}", cookies=self.cookies
            )
            self.assertEqual(status, 200)
            status, document, _, _ = self.json_request(
                "GET", f"/api/history?world={self.world}", cookies=self.cookies
            )
            self.assertEqual(status, 200, document)
            status, document, _, _ = self.json_request(
                "POST", "/api/worlds/delete", {"id": self.world}, cookies=self.cookies
            )
            self.assertEqual(status, 200, document)

    def test_another_account_is_not_held_to_the_limit_of_alice(self) -> None:
        bob = self.login("bob")
        bobs_world = self.create_world(bob)
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"}):
            status, document, _, _ = self.json_request(
                "POST",
                "/api/backup",
                {"worldId": bobs_world, "message": "x"},
                cookies={SESSION_COOKIE: bob},
            )
        self._assert_refused(status, document)  # bob has his own world over the 1 byte limit
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": str(10**9)}):
            status, document, _, _ = self.json_request(
                "POST",
                "/api/backup",
                {"worldId": bobs_world, "message": "x"},
                cookies={SESSION_COOKIE: bob},
            )
        self.assertEqual(status, 200, document)


class WorldBytesCacheTests(unittest.TestCase):
    """The count is not repeated on every save, and an "over" answer is never remembered."""

    def setUp(self) -> None:
        world_quota._room_until.clear()
        self.addCleanup(world_quota._room_until.clear)
        self.counted = 0
        self.size = 0

        def world_bytes(app, world_id):
            self.counted += 1
            return self.size

        patcher = patch.object(world_quota, "_world_bytes", world_bytes)
        patcher.start()
        self.addCleanup(patcher.stop)
        worlds = SimpleNamespace(
            data_directory=Path("cache-test"),
            list=lambda owner: [{"id": "w"}],
            list_trash=lambda owner: [],
        )
        self.app = SimpleNamespace(syncable=False, worlds=worlds)

    def test_room_left_is_remembered_for_a_while(self) -> None:
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "100"}):
            self.assertFalse(world_quota.over_bytes(self.app, "alice"))
            self.size = 1000  # grown past the limit, but the answer is still fresh
            self.assertFalse(world_quota.over_bytes(self.app, "alice"))
            self.assertEqual(self.counted, 1)

    def test_room_left_is_counted_again_once_it_has_expired(self) -> None:
        with (
            patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "100"}),
            patch.object(world_quota, "BYTES_CACHE_SECONDS", 0.05),
        ):
            self.assertFalse(world_quota.over_bytes(self.app, "alice"))
            self.size = 1000
            time.sleep(0.1)
            self.assertTrue(world_quota.over_bytes(self.app, "alice"))

    def test_over_the_limit_is_never_remembered(self) -> None:
        self.size = 1000
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "100"}):
            self.assertTrue(world_quota.over_bytes(self.app, "alice"))
            self.size = 0  # the account deleted something
            self.assertFalse(world_quota.over_bytes(self.app, "alice"))

    def test_a_local_server_is_never_counted(self) -> None:
        self.app.syncable = True
        self.size = 10**12
        self.assertFalse(world_quota.over_bytes(self.app, "alice"))
        self.assertEqual(self.counted, 0)


class TrickledBodyTests(HostedHarness):
    """F-268-22 C1: one deadline for the whole body, not one per read."""

    def test_a_body_that_trickles_in_is_given_up_on_at_the_deadline(self) -> None:
        alice = self.login("alice")
        world = self.create_world(alice)
        # Each byte arrives well inside the per-read timeout; only the deadline can stop it.
        with (
            patch.object(server, "BODY_READ_DEADLINE_SECONDS", 0.5),
            patch.object(server, "BODY_RECV_TIMEOUT_SECONDS", 5.0),
        ):
            sock = socket.create_connection(("127.0.0.1", self.port), timeout=10)
            reply = b""
            closed_after = None
            try:
                sock.sendall(
                    (
                        f"POST /api/state?world={world} HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
                        f"Cookie: {SESSION_COOKIE}={alice}\r\n"
                        "Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"
                    ).encode()
                )
                started = time.monotonic()
                sock.settimeout(0.1)
                while time.monotonic() - started < 4:
                    try:
                        chunk = sock.recv(4096)
                    except TimeoutError:
                        chunk = None
                    except OSError:
                        closed_after = time.monotonic() - started
                        break
                    if chunk == b"":
                        closed_after = time.monotonic() - started
                        break
                    if chunk:
                        reply += chunk
                    try:
                        sock.sendall(b" ")
                    except OSError:
                        closed_after = time.monotonic() - started
                        break
            finally:
                sock.close()
        self.assertIsNotNone(closed_after, "the server kept reading a body that trickles")
        self.assertLess(closed_after, 3)
        if reply:
            self.assertRegex(reply[:20], rb"HTTP/1\.[01] 400", reply)


class LocalServerIsNotLimitedTests(_LiveServer):
    """F-268-22 C7: the limits protect a shared disk; one user's own disk is not limited."""

    def test_a_local_server_makes_a_second_world_over_a_limit_of_one(self) -> None:
        with patch.dict(
            "os.environ",
            {"QUILTOR_MAX_WORLDS_PER_ACCOUNT": "1", "QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"},
        ):
            status, _, raw = self.request(
                "POST", "/api/worlds/create", {"title": "Zweite", "backupUrl": ""}
            )
        self.assertEqual(status, 200, raw)

    def test_a_local_server_keeps_a_version_over_a_limit_of_one(self) -> None:
        with patch.dict("os.environ", {"QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT": "1"}):
            status, _, raw = self.request(
                "POST", "/api/backup", {"worldId": self.world_id, "message": "x"}
            )
        self.assertEqual(status, 200, raw)


class QueuedJobAfterRoleWithdrawnThroughTheWiringTests(unittest.TestCase):
    """F-268-22 D2: `build_web_application` hands the gate to the job runner for a hosted
    server. The runner's own test builds its gate by hand and cannot see this wiring."""

    def test_a_queued_server_job_is_not_computed_once_the_role_is_gone(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        env = patch.dict(
            os.environ,
            {
                "QUILTOR_HOST": "127.0.0.1",
                "QUILTOR_PUBLIC_URL": "https://quiltor.audit.test",
            },
        )
        env.start()
        self.addCleanup(env.stop)
        from quiltor.infrastructure.identity.runtime import StdlibIdentityGateway
        from quiltor.modules.identity.auth import IdentityConfiguration

        gateway = StdlibIdentityGateway(
            IdentityConfiguration(issuer=ISSUER, client_id="c", client_secret="s"),
            transport=FakeProvider(),
            sleep=lambda _seconds: None,
        )
        application = build_web_application(
            identity=build_identity(True, gateway=gateway),
            ensure_assistant_installed=False,
            # One level down: the runtime home is the data directory's parent, and a test must
            # not look for (and start) a llama-server in the machine's real temp folder.
            app_directories=make_directories(root / "data"),
        )
        self.addCleanup(application.close)
        application.prepare()
        # The role is gone: the identity port no longer confirms it.
        with patch.object(type(gateway), "premium_confirmed", return_value=False):
            job, created = application.assistant_jobs.submit(
                owner_sub="user-premium",
                world_id="a" * 32,
                idempotency_key="r2c-d2-queued",
                intent=intent("queued"),
                execution=execution("queued"),
            )
            self.assertTrue(created)
            finished = application.assistant_jobs.wait(
                job["id"], "user-premium", "a" * 32, timeout=JOB_WAIT_SECONDS
            )
        self.assertIsNotNone(finished)
        self.assertEqual(finished["status"], "failed")
        self.assertEqual(finished["errorType"], "premium_required")


if __name__ == "__main__":
    unittest.main()
