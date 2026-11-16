"""T-268 round 2, package A: total deadlines, staging cap and the quota check under the lock.

F-268-15: the per-recv socket timeout does not stop a client that sends a byte now and
then; the connection needs a deadline for the sum, for the headers and for the body.
F-268-22 A7: the quota check under the account lock is what keeps two uploads that were
both admitted by the pre-check from together exceeding the limit.

Loopback only; the deadlines are shortened to about a second.
"""

from __future__ import annotations

import hashlib
import socket
import time

from tests.python.test_audit268_backupserver_support import BackupServerCase

STAGING_PREFIX = ".quiltor-upload-"


def put_head(digest: str, length: int, token: str = "token-a") -> bytes:
    return (
        f"PUT /v1/worlds/w/blobs/{digest} HTTP/1.0\r\n"
        f"Authorization: Bearer {token}\r\nContent-Length: {length}\r\n\r\n"
    ).encode()


def trickle(sock: socket.socket, *, pause: float, limit: float) -> float | None:
    """Send one byte per `pause` seconds; the seconds until the server ended the
    connection, or None if it was still open after `limit`."""
    start = time.monotonic()
    while time.monotonic() - start < limit:
        try:
            sock.sendall(b"a")
            sock.settimeout(pause)
            if sock.recv(100) == b"":
                return time.monotonic() - start
        except TimeoutError:
            continue
        except OSError:
            return time.monotonic() - start
    return None


class TotalDeadlineTest(BackupServerCase):
    """F-268-15: a trickling connection ends after the deadline, whatever its pauses."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")
        # Every recv may wait 0.5 s, the sum 1.2 s; the client pauses 0.2 s, well inside.
        self.server_module.CLIENT_SOCKET_TIMEOUT = 0.5
        self.server_module.HEADER_DEADLINE_SECONDS = 1.2
        self.server_module.BODY_BASE_DEADLINE_SECONDS = 1.2

    def _assert_served_again(self) -> None:
        self.assertEqual(self.request("GET", "/v1/account")[0], 200)

    def test_f268_15_a_header_trickle_ends_after_the_header_deadline(self) -> None:
        with socket.create_connection(("127.0.0.1", self.port)) as sock:
            sock.sendall(b"GET /v1/account HTTP/1.0\r\nX-Slow: ")
            ended = trickle(sock, pause=0.2, limit=4)
        self.assertIsNotNone(ended, "the connection outlived the header deadline")
        assert ended is not None
        self.assertLess(ended, 2.5)
        self._assert_served_again()

    def test_f268_15_a_small_blob_trickle_ends_after_the_base_deadline_not_a_large_one(
        self,
    ) -> None:
        payload = b"x" * 100
        digest = hashlib.sha256(payload).hexdigest()
        with socket.create_connection(("127.0.0.1", self.port)) as sock:
            sock.sendall(put_head(digest, len(payload)))
            ended = trickle(sock, pause=0.2, limit=4)
        self.assertIsNotNone(ended, "the connection outlived the body deadline")
        assert ended is not None
        self.assertLess(ended, 2.5)
        deadline = time.monotonic() + 3
        while self.stored_files() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual(self.stored_files(), [], "the abandoned staging file is removed")
        self._assert_served_again()

    def test_f268_15_the_body_deadline_grows_with_the_announced_length(self) -> None:
        self.server_module.BODY_MIN_RATE_BYTES_PER_SECOND = 1  # 100 bytes: 1.2 s + 100 s
        payload = b"x" * 100
        digest = hashlib.sha256(payload).hexdigest()
        with socket.create_connection(("127.0.0.1", self.port)) as sock:
            sock.sendall(put_head(digest, len(payload)))
            self.assertIsNone(trickle(sock, pause=0.2, limit=2.5), "cut off at the base alone")

    def test_f268_15_a_prompt_upload_is_not_cut_off_by_the_deadlines(self) -> None:
        payload = b"x" * 100
        digest = hashlib.sha256(payload).hexdigest()
        status, _, _ = self.request("PUT", f"/v1/worlds/w/blobs/{digest}", payload)
        self.assertEqual(status, 201)

    def test_f268_15_deadlines_are_read_from_the_environment(self) -> None:
        module = self.server_module
        with self.subTest("default"):
            self.assertEqual(module._positive_number_from_environment("X_UNSET_R2A", 7.0), 7.0)
        with self.subTest("invalid"):
            import os
            import unittest.mock

            with unittest.mock.patch.dict(os.environ, {"X_BAD_R2A": "0"}):
                with self.assertRaises(SystemExit):
                    module._positive_number_from_environment("X_BAD_R2A", 7.0)
            with unittest.mock.patch.dict(os.environ, {"X_OK_R2A": "2.5"}):
                self.assertEqual(module._positive_number_from_environment("X_OK_R2A", 7.0), 2.5)


class StagedUploadsTest(BackupServerCase):
    """Uploads that were admitted but are still empty, and the quota under the lock."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")

    def _staged(self) -> list:
        return [p for p in self.stored_files() if p.name.startswith(STAGING_PREFIX)]

    def _wait_for_staged(self, count: int) -> None:
        deadline = time.monotonic() + 5
        while len(self._staged()) < count and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertEqual(len(self._staged()), count)

    def _open_upload(self, payload: bytes) -> socket.socket:
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        self.addCleanup(sock.close)
        sock.sendall(put_head(hashlib.sha256(payload).hexdigest(), len(payload)))
        return sock

    def test_f268_15_one_account_cannot_stage_more_uploads_than_the_cap(self) -> None:
        self.server_module.MAX_CONCURRENT_UPLOADS_PER_ACCOUNT = 2
        first = self._open_upload(b"a" * 50)
        self._open_upload(b"b" * 50)
        self._wait_for_staged(2)
        payload = b"c" * 50
        status, headers, _ = self.request(
            "PUT", f"/v1/worlds/w/blobs/{hashlib.sha256(payload).hexdigest()}", payload
        )
        self.assertEqual(status, 429)
        self.assertEqual(headers.get("Retry-After"), "5")
        self.assertEqual(len(self._staged()), 2, "the refused upload staged nothing")
        first.close()  # a slot frees up once its upload ends
        deadline = time.monotonic() + 5
        status = 429
        while status == 429 and time.monotonic() < deadline:
            status = self.request(
                "PUT", f"/v1/worlds/w/blobs/{hashlib.sha256(payload).hexdigest()}", payload
            )[0]
            time.sleep(0.05)
        self.assertEqual(status, 201)

    def test_f268_22_a7_quota_is_rechecked_under_the_lock_after_both_uploads_staged(self) -> None:
        self.server_module.POLICIES = {
            "account-a": {"access": "read-write", "limitBytes": 8, "deleteAfter": None}
        }
        payloads = (b"aaaaaaaa", b"bbbbbbbb")
        socks = [self._open_upload(payload) for payload in payloads]
        # Both passed the pre-check (the account was empty) and sit staged, still empty.
        self._wait_for_staged(2)
        answers = []
        for sock, payload in zip(socks, payloads, strict=True):
            sock.sendall(payload)
            answers.append(sock.recv(100).split(b"\r\n", 1)[0])
        self.assertEqual(
            [a.split(b" ")[1] for a in answers],
            [b"201", b"507"],
            "the second upload no longer fits once the first is stored",
        )
        # The refused upload removes its staging file in a finally after the 507 is sent, so
        # the answer can reach the client a moment before the file is gone (CI 43603899533).
        expected = [hashlib.sha256(payloads[0]).hexdigest()]
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and [p.name for p in self.stored_files()] != expected:
            time.sleep(0.05)
        self.assertEqual([p.name for p in self.stored_files()], expected)
