"""T-268 audit, package D3: storage, limits, policy, headers and logs (B.6-B.13).

Tests marked @unittest.expectedFailure prove a gap and name the finding in a comment;
the decorator goes away with the fix. In-process, loopback only, fake clock where time
matters, no test waits longer than a couple of seconds.
"""

from __future__ import annotations

import contextlib
import datetime
import hashlib
import io
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Any

from quiltor.application.backup_manifest import build_manifest_files, manifest_identifier
from tests.python.test_audit268_backupserver_support import (
    PUBLIC_URL,
    BackupServerCase,
    FakeClock,
    load_server,
)

ACCOUNT_PATH = "/v1/account"
DIGEST = "0" * 64


def make_directory_link(test: unittest.TestCase, link: Path, target: Path) -> None:
    """A symlink, or a junction on Windows without the symlink privilege; else skip."""
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except (OSError, NotImplementedError):
        pass
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            return
    test.skipTest("cannot create a directory link on this machine")


def raw_exchange(port: int, request: bytes, *, half_close: bool = True) -> bytes:
    with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
        sock.sendall(request)
        if half_close:
            sock.shutdown(socket.SHUT_WR)
        chunks = []
        while True:
            try:
                data = sock.recv(65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
    return b"".join(chunks)


def manifest_for(world: str, marker: bytes = b"marker") -> tuple[str, dict, str]:
    descriptors = build_manifest_files({"world.sqlite3": marker}.items())
    body = {
        "format": 2,
        "encryption": "none",
        "created": "2026-09-19T10:00:00+00:00",
        "world": world,
        "title": "Audit title",
        "message": "m",
        "parent": "",
        "files": descriptors,
    }
    snapshot_id = manifest_identifier(body, 2)
    return snapshot_id, {**body, "id": snapshot_id}, descriptors["world.sqlite3"]["sha256"]


class PathHandlingTest(BackupServerCase):
    """B.6: world, kind and digest from the URL cannot leave the account folder."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")

    def test_hostile_paths_never_route_or_write(self) -> None:
        upper = DIGEST.replace("0", "A")
        paths = [
            "/v1/worlds/%2e%2e/blobs",
            "/v1/worlds/../blobs/" + DIGEST,
            "/v1/worlds/./blobs/" + DIGEST,
            "/v1/worlds/w/blobs/%2e%2e%2f" + DIGEST[:40],
            "/v1/worlds/w/blobs/" + upper,
            f"/v1/worlds/w/blobs/{DIGEST}/extra",
            "/v1/worlds/w/other/" + DIGEST,
            "/v1/worlds/w%5cx/blobs/" + DIGEST,
            "//v1/worlds/w/blobs/" + DIGEST,
            "/v1/worlds/" + "w" * 129 + "/blobs/" + DIGEST,
            "/v1/worlds/w/snapshots/..",
            "/v1/worlds/w/sync/extra",
        ]
        for path in paths:
            for method in ("GET", "PUT"):
                with self.subTest(path=path, method=method):
                    body = b"" if method == "PUT" else None
                    status, _, _ = self.request(method, path, body)
                    self.assertIn(status, {400, 404, 405}, f"{method} {path}")
        self.assertEqual(self.stored_files(), [])

    def test_world_name_cannot_collide_with_internal_names(self) -> None:
        # Worlds named like the lock file, the quarantine or the sync head are legal names
        # but live below the account folder, so they cannot reach the root's own files.
        for world in ("sync.json", "blobs", "snapshots"):
            payload = b"x" + world.encode()
            digest = hashlib.sha256(payload).hexdigest()
            status, _, _ = self.request("PUT", f"/v1/worlds/{world}/blobs/{digest}", payload)
            self.assertEqual(status, 201)
        for path in self.stored_files():
            self.assertEqual(path.relative_to(self.root).parts[0], "account-a")

    def test_linked_world_folder_is_refused_for_write_and_read(self) -> None:
        outside = self.root.parent / "outside"
        outside.mkdir()
        account = self.root / "account-a"
        account.mkdir()
        make_directory_link(self, account / "w", outside)
        payload = b"must not escape"
        digest = hashlib.sha256(payload).hexdigest()
        status, _, _ = self.request("PUT", f"/v1/worlds/w/blobs/{digest}", payload)
        self.assertEqual(status, 400)
        self.assertEqual(list(outside.iterdir()), [])
        status, _, _ = self.request("GET", "/v1/worlds/w/blobs")
        self.assertEqual(status, 400)

    def test_linked_account_folder_is_refused(self) -> None:
        outside = self.root.parent / "outside-account"
        outside.mkdir()
        make_directory_link(self, self.root / "account-a", outside)
        payload = b"must not escape either"
        digest = hashlib.sha256(payload).hexdigest()
        status, _, _ = self.request("PUT", f"/v1/worlds/w/blobs/{digest}", payload)
        self.assertEqual(status, 400)
        self.assertEqual(list(outside.iterdir()), [])

    # S268-209: the account-wide world index globs `<world>/snapshots` without the symlink
    # check every other route applies, so a linked snapshots folder is read through. Only
    # someone with write access to the storage can plant the link, hence hardening.
    @unittest.expectedFailure
    def test_s268_209_world_index_does_not_follow_a_linked_snapshots_folder(self) -> None:
        outside = self.root.parent / "outside-snapshots"
        outside.mkdir()
        snapshot_id, document, _ = manifest_for("w")
        (outside / f"{snapshot_id}.json").write_text(json.dumps(document), encoding="utf-8")
        world = self.root / "account-a" / "w"
        world.mkdir(parents=True)
        make_directory_link(self, world / "snapshots", outside)
        status, _, body = self.request("GET", "/v1/worlds")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["worlds"], [])


class SizeAndQuotaTest(BackupServerCase):
    """B.7: Content-Length handling, quota and the absence of a default quota."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")

    def _blob(self, payload: bytes, token: str = "token-a") -> int:
        digest = hashlib.sha256(payload).hexdigest()
        return self.request("PUT", f"/v1/worlds/w/blobs/{digest}", payload, token=token)[0]

    def _put_head(self, length: str, body: bytes = b"") -> bytes:
        request = (
            f"PUT /v1/worlds/w/blobs/{DIGEST} HTTP/1.1\r\nHost: x\r\n"
            f"Authorization: Bearer token-a\r\nContent-Length: {length}\r\n\r\n"
        ).encode() + body
        return raw_exchange(self.port, request)

    def test_bad_content_length_values_are_refused_before_storage(self) -> None:
        self.server_module.MAX_BLOB_BYTES = 100
        self.assertTrue(self._put_head("-1").startswith(b"HTTP/1.0 413"))
        self.assertTrue(self._put_head("101", b"x" * 101).startswith(b"HTTP/1.0 413"))
        self.assertTrue(self._put_head("abc").startswith(b"HTTP/1.0 400"))
        self.assertEqual(self.stored_files(), [])

    def test_truncated_body_is_refused(self) -> None:
        answer = self._put_head("10", b"abc")
        self.assertTrue(answer.startswith(b"HTTP/1.0 400"))
        self.assertEqual(self.stored_files(), [])

    def test_body_must_hash_to_its_name(self) -> None:
        status, _, _ = self.request("PUT", f"/v1/worlds/w/blobs/{DIGEST}", b"not the preimage")
        self.assertEqual(status, 400)
        self.assertEqual(self.stored_files(), [])

    def test_explicit_quota_is_enforced_and_counts_orphan_blobs(self) -> None:
        self.server_module.POLICIES = {
            "account-a": {"access": "read-write", "limitBytes": 10, "deleteAfter": None}
        }
        self.assertEqual(self._blob(b"12345678"), 201)
        self.assertEqual(self._blob(b"abcdefgh"), 507)
        self.assertEqual(self._blob(b"12345678"), 200, "re-sending a stored blob costs nothing")
        _, _, body = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(json.loads(body)["usedBytes"], 8)

    # S268-202: an account without a policy entry has limitBytes null, i.e. no quota at
    # all. The operator cannot list future accounts (opaque subs), so every holder of the
    # scope can store without limit: 512 MiB per blob, any number of blobs and worlds.
    def test_s268_202_account_without_policy_entry_has_a_quota(self) -> None:
        status, _, body = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(status, 200)
        self.assertIsNotNone(json.loads(body)["limitBytes"])

    def test_s268_202_policy_entry_without_limit_takes_the_default_and_null_is_unlimited(
        self,
    ) -> None:
        policy = Path(self.temporary.name) / "policy.json"
        policy.write_text(
            json.dumps(
                {"accounts": {"account-a": {}, "account-b": {"limitBytes": None}}},
            ),
            encoding="utf-8",
        )
        self.server_module.POLICY_FILE = str(policy)
        self.server_module.load_policy_configuration()
        policies = self.server_module.POLICIES
        self.assertEqual(
            policies["account-a"]["limitBytes"], self.server_module.DEFAULT_LIMIT_BYTES
        )
        self.assertIsNone(policies["account-b"]["limitBytes"])

    def test_s268_202_default_quota_is_enforced_and_overridable(self) -> None:
        self.server_module.DEFAULT_LIMIT_BYTES = 10
        self.assertEqual(self._blob(b"12345678"), 201)
        self.assertEqual(self._blob(b"abcdefgh"), 507)
        self.server_module.POLICIES = {
            "account-a": {"access": "read-write", "limitBytes": None, "deleteAfter": None}
        }
        self.assertEqual(self._blob(b"abcdefgh"), 201, "a policy entry sets the limit itself")

    def test_s268_202_evidence_many_blobs_are_accepted_without_any_policy(self) -> None:
        # Not a gap test: records that nothing stops a policy-less account (see above).
        for index in range(25):
            self.assertEqual(self._blob(f"blob {index}".encode()), 201)

    # S268-203: the quota is judged only after the whole body has been read into memory.
    # A declared 1000 bytes against a 100-byte limit is answered only once the client has
    # sent (or abandoned) them, so a refused upload still costs up to 512 MiB of RAM.
    def test_s268_203_declared_size_beyond_quota_is_refused_without_reading_the_body(self) -> None:
        self.server_module.POLICIES = {
            "account-a": {"access": "read-write", "limitBytes": 100, "deleteAfter": None}
        }
        with socket.create_connection(("127.0.0.1", self.port), timeout=1.5) as sock:
            sock.sendall(
                (
                    f"PUT /v1/worlds/w/blobs/{DIGEST} HTTP/1.1\r\nHost: x\r\n"
                    "Authorization: Bearer token-a\r\nContent-Length: 1000\r\n\r\n"
                ).encode()
            )
            answer = sock.recv(200)  # times out while the server waits for the body
        self.assertTrue(answer.startswith(b"HTTP/1.0 507") or answer.startswith(b"HTTP/1.0 413"))


class StreamedUploadTest(BackupServerCase):
    """S268-203: a blob is staged on disk in chunks and renamed, not held in memory."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")

    def _staged(self) -> list[Path]:
        return [p for p in self.stored_files() if p.name.startswith(".quiltor-upload-")]

    def test_s268_203_half_sent_blob_is_on_disk_in_a_temporary_file_and_not_yet_stored(
        self,
    ) -> None:
        payload = b"x" * 300_000
        digest = hashlib.sha256(payload).hexdigest()
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as sock:
            sock.sendall(
                (
                    f"PUT /v1/worlds/w/blobs/{digest} HTTP/1.0\r\n"
                    f"Authorization: Bearer token-a\r\nContent-Length: {len(payload)}\r\n\r\n"
                ).encode()
                + payload[:150_000]
            )
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline and not any(p.stat().st_size for p in self._staged()):
                time.sleep(0.05)
            staged = self._staged()
            self.assertEqual(len(staged), 1, "the received part is already staged on disk")
            self.assertGreater(staged[0].stat().st_size, 0, "chunks are written as they arrive")
            self.assertEqual([p for p in self.stored_files() if p.name == digest], [])
            sock.sendall(payload[150_000:])
            answer = sock.recv(100)
        self.assertTrue(answer.startswith(b"HTTP/1.0 201"), answer)
        self.assertEqual(self._staged(), [])
        self.assertEqual([p.name for p in self.stored_files()], [digest])

    def test_s268_203_failed_uploads_leave_no_temporary_file(self) -> None:
        status, _, _ = self.request("PUT", f"/v1/worlds/w/blobs/{DIGEST}", b"not the preimage")
        self.assertEqual(status, 400)
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as sock:
            sock.sendall(
                (
                    f"PUT /v1/worlds/w/blobs/{DIGEST} HTTP/1.0\r\n"
                    "Authorization: Bearer token-a\r\nContent-Length: 100\r\n\r\nshort"
                ).encode()
            )
            sock.shutdown(socket.SHUT_WR)
            self.assertTrue(sock.recv(100).startswith(b"HTTP/1.0 400"))
        self.assertEqual(self.stored_files(), [])


class SocketTimeoutTest(BackupServerCase):
    """B.8: no read timeout on the client socket, no cap on handler threads."""

    def _spy_server(self):
        module = self.server_module
        seen: dict[str, Any] = {}
        started = threading.Event()

        class SpyHandler(module.Handler):
            def handle(self) -> None:
                seen["timeout"] = self.connection.gettimeout()
                started.set()
                super().handle()

        class SpyServer(module.Server):
            def handle_error(self, request, client_address) -> None:
                pass

        httpd = SpyServer(("127.0.0.1", 0), SpyHandler)
        thread = threading.Thread(
            target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        thread.start()

        def stop() -> None:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

        self.addCleanup(stop)
        return httpd, seen, started

    # S268-201: neither Handler.timeout nor the Server sets a socket timeout (server.py
    # :880-883, :689). A client that connects and says nothing, or sends headers and half
    # a body, holds its thread for as long as it likes, without any token for the first.
    def test_s268_201_client_sockets_get_a_finite_timeout(self) -> None:
        httpd, seen, started = self._spy_server()
        with socket.create_connection(("127.0.0.1", httpd.server_address[1]), timeout=2):
            self.assertTrue(started.wait(2))
            timeout = seen["timeout"]
        self.assertIsNotNone(timeout)
        self.assertLessEqual(float(timeout), 300.0)

    def test_s268_201_full_thread_cap_answers_503_instead_of_a_new_thread(self) -> None:
        self.server_module.MAX_HANDLER_THREADS = 2
        httpd, _, _ = self._spy_server()
        port = httpd.server_address[1]
        held = [socket.create_connection(("127.0.0.1", port), timeout=2) for _ in range(2)]
        self.addCleanup(lambda: [s.close() for s in held])
        time.sleep(0.3)  # let both handler threads start and park on the silent sockets
        with socket.create_connection(("127.0.0.1", port), timeout=2) as third:
            answer = third.recv(100)
        self.assertTrue(answer.startswith(b"HTTP/1.0 503"), answer)
        held[0].close()
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            with socket.create_connection(("127.0.0.1", port), timeout=2) as again:
                again.sendall(b"GET /nowhere HTTP/1.0\r\n\r\n")
                if not again.recv(100).startswith(b"HTTP/1.0 503"):
                    return
            time.sleep(0.1)
        self.fail("a freed slot was never handed out again")

    def test_s268_201_evidence_silent_connections_each_hold_a_thread(self) -> None:
        # Not a gap test: records the missing cap. Thirty anonymous, silent connections
        # become thirty parked handler threads, and nothing ends them.
        base = threading.active_count()
        sockets = [socket.create_connection(("127.0.0.1", self.port), timeout=2) for _ in range(30)]
        self.addCleanup(lambda: [s.close() for s in sockets])
        deadline = time.monotonic() + 3
        while threading.active_count() < base + 30 and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertGreaterEqual(threading.active_count(), base + 30)
        time.sleep(0.5)
        self.assertGreaterEqual(threading.active_count(), base + 30, "still parked")

    def test_protocol_is_http_1_0_so_no_keep_alive_desync(self) -> None:
        self.issuer.grant("token-a")
        answer = raw_exchange(
            self.port,
            b"GET /v1/account HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer token-a\r\n\r\n",
        )
        self.assertTrue(answer.startswith(b"HTTP/1.0 200"))


class PolicyTest(BackupServerCase):
    """B.9: policy file format, expiry, read-only and the re-check under the lock."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")
        self.clock = FakeClock()
        self.server_module.time = self.clock

    def _iso(self, offset: float) -> str:
        moment = datetime.datetime.fromtimestamp(self.clock.now + offset, datetime.UTC)
        return moment.isoformat()

    def _policy(self, **fields) -> None:
        entry = {"access": "read-write", "limitBytes": None, "deleteAfter": None, **fields}
        self.server_module.POLICIES = {"account-a": entry}

    def test_malformed_policy_files_are_rejected_at_load(self) -> None:
        good = {"accounts": {"account-a": {"access": "read-only", "limitBytes": 5}}}
        bad = [
            {"accounts": {"account-a": {"access": "admin"}}},
            {"accounts": {"account-a": {"limitBytes": -1}}},
            {"accounts": {"account-a": {"limitBytes": True}}},
            {"accounts": {"account-a": {"deleteAfter": "2030-01-01T00:00:00"}}},
            {"accounts": {"account-a": {"deleteAfter": "2030-01-01T00:00:00+02:00"}}},
            {"accounts": {"account-a": {"extra": 1}}},
            {"accounts": {"..": {}}},
            {"accounts": {"a/b": {}}},
            {"accounts": [], "other": 1},
            {"accounts": []},
            {"other": {}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            self.server_module.POLICY_FILE = str(path)
            path.write_text(json.dumps(good), encoding="utf-8")
            self.server_module.load_policy_configuration()
            self.assertEqual(self.server_module.POLICIES["account-a"]["access"], "read-only")
            for document in bad:
                with self.subTest(document=document):
                    path.write_text(json.dumps(document), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        self.server_module.load_policy_configuration()
            path.write_text('{"accounts":{"a":{}},"accounts":{}}', encoding="utf-8")
            with self.assertRaises(ValueError):
                self.server_module.load_policy_configuration()

    def test_expired_account_is_refused_everywhere(self) -> None:
        self._policy(deleteAfter=self._iso(-1))
        for method, path in (
            ("GET", ACCOUNT_PATH),
            ("GET", "/v1/worlds"),
            ("PUT", f"/v1/worlds/w/blobs/{DIGEST}"),
        ):
            with self.subTest(method=method, path=path):
                body = b"" if method == "PUT" else None
                status, _, answer = self.request(method, path, body)
                self.assertEqual(status, 403)
                self.assertEqual(json.loads(answer)["code"], "cloud.account_expired")

    def test_read_only_account_can_read_but_not_write(self) -> None:
        self._policy(access="read-only")
        self.assertEqual(self.request("GET", ACCOUNT_PATH)[0], 200)
        status, _, answer = self.request("PUT", f"/v1/worlds/w/blobs/{DIGEST}", b"")
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(answer)["code"], "cloud.read_only")
        self.assertEqual(self.stored_files(), [])

    def test_expiry_during_a_slow_upload_is_caught_under_the_account_lock(self) -> None:
        self._policy(deleteAfter=self._iso(100))
        module = self.server_module
        original = module._account_lock
        clock = self.clock

        def lock_after_the_clock_ran_out(account):
            clock.now += 200  # the body took long enough for the policy to lapse
            return original(account)

        module._account_lock = lock_after_the_clock_ran_out
        payload = b"late"
        digest = hashlib.sha256(payload).hexdigest()
        status, _, answer = self.request("PUT", f"/v1/worlds/w/blobs/{digest}", payload)
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(answer)["code"], "cloud.account_expired")
        self.assertEqual(self.stored_files(), [])


class ResponseHygieneTest(BackupServerCase):
    """B.10 and B.11: error bodies, challenge, headers and the access log."""

    def setUp(self) -> None:
        super().setUp()
        self.issuer.grant("token-a")

    def test_error_bodies_leak_no_paths_tokens_or_traces(self) -> None:
        cases = [
            ("GET", "/v1/nothing", "token-a", None),
            ("GET", "/v1/worlds/w/blobs/" + DIGEST, "token-a", None),
            ("PUT", "/v1/worlds/w/blobs", "token-a", b""),
            ("PUT", f"/v1/worlds/w/blobs/{DIGEST}", "token-a", b"wrong"),
            ("GET", ACCOUNT_PATH, "token-unknown", None),
            ("GET", ACCOUNT_PATH, None, None),
        ]
        for method, path, token, body in cases:
            with self.subTest(method=method, path=path, token=token):
                status, _, answer = self.request(method, path, body, token=token)
                self.assertGreaterEqual(status, 400)
                text = answer.decode("utf-8", "replace")
                for forbidden in (
                    str(self.root),
                    self.root.name,
                    "Traceback",
                    "token-a",
                    "token-unknown",
                    ".py",
                ):
                    self.assertNotIn(forbidden, text)

    def test_challenge_points_only_at_the_configured_public_url(self) -> None:
        status, headers, _ = self.request(
            "GET", ACCOUNT_PATH, token=None, headers={"Host": "evil.example.test"}
        )
        self.assertEqual(status, 401)
        self.assertEqual(
            headers["WWW-Authenticate"],
            f'Bearer resource_metadata="{PUBLIC_URL}/.well-known/oauth-protected-resource"',
        )

    def test_anonymous_metadata_names_only_issuer_and_scope(self) -> None:
        status, _, body = self.request("GET", "/.well-known/oauth-protected-resource", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(
            set(json.loads(body)),
            {"resource", "authorization_servers", "scopes_supported", "bearer_methods_supported"},
        )
        self.assertNotIn("not-a-real-secret", body.decode())

    def test_unsupported_methods_answer_501_without_touching_storage(self) -> None:
        for method in ("POST", "DELETE", "HEAD", "OPTIONS", "PATCH"):
            with self.subTest(method=method):
                status, _, _ = self.request(method, f"/v1/worlds/w/blobs/{DIGEST}", None)
                self.assertEqual(status, 501)
        self.assertEqual(self.stored_files(), [])

    def test_access_log_never_contains_the_token_or_the_body(self) -> None:
        payload = b"Der Morgen lag still ueber dem Hafen."
        digest = hashlib.sha256(payload).hexdigest()
        log = io.StringIO()
        with contextlib.redirect_stdout(log):
            self.request("PUT", f"/v1/worlds/w/blobs/{digest}", payload)
            self.request("GET", ACCOUNT_PATH, token="token-a")
        text = log.getvalue()
        self.assertIn("/v1/worlds/w/blobs/", text, "the request line is logged")
        self.assertNotIn("token-a", text)
        self.assertNotIn("Hafen", text)

    # S268-206: log_message is overridden and prints the request line raw, bypassing the
    # control-character escaping of http.server's own implementation. An anonymous caller
    # can put terminal escape sequences into the operator's log.
    @unittest.expectedFailure
    def test_s268_206_control_characters_in_the_request_line_are_escaped_in_the_log(self) -> None:
        log = io.StringIO()
        with contextlib.redirect_stdout(log):
            raw_exchange(self.port, b"GET /\x1b[31mred\x07 HTTP/1.1\r\nHost: x\r\n\r\n")
        text = log.getvalue()
        self.assertIn("red", text)
        self.assertNotIn("\x1b", text)
        self.assertNotIn("\x07", text)

    # S268-207: responses carrying backups have no Cache-Control and no nosniff, and the
    # Server header names the exact Python version.
    @unittest.expectedFailure
    def test_s268_207_data_responses_forbid_caching(self) -> None:
        _, headers, _ = self.request("GET", ACCOUNT_PATH)
        self.assertIn("no-store", headers.get("Cache-Control", ""))

    @unittest.expectedFailure
    def test_s268_207_responses_carry_nosniff(self) -> None:
        _, headers, _ = self.request("GET", ACCOUNT_PATH)
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")

    @unittest.expectedFailure
    def test_s268_207_server_header_does_not_name_the_python_version(self) -> None:
        _, headers, _ = self.request("GET", ACCOUNT_PATH, token=None)
        self.assertNotIn("Python", headers.get("Server", ""))


class PurgeTest(unittest.TestCase):
    """B.13: the expiry purge never deletes through a link and never leaves ROOT."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name).resolve()
        self.root = base / "served"
        self.root.mkdir()
        self.outside = base / "outside"
        self.outside.mkdir()
        self.sentinel = self.outside / "keep-me.txt"
        self.sentinel.write_text("outside ROOT", encoding="utf-8")
        self.module = load_server(self.root, "http://127.0.0.1:1")
        self.module.POLICIES = {
            "account-gone": {
                "access": "read-write",
                "limitBytes": None,
                "deleteAfter": "2000-01-01T00:00:00Z",
            },
            "account-fresh": {
                "access": "read-write",
                "limitBytes": None,
                "deleteAfter": "2999-01-01T00:00:00Z",
            },
        }
        for name in ("account-gone", "account-fresh"):
            blobs = self.root / name / "w" / "blobs"
            blobs.mkdir(parents=True)
            (blobs / DIGEST).write_bytes(b"data")

    def test_control_expired_account_is_removed_and_fresh_one_kept(self) -> None:
        self.assertEqual(self.module.purge_expired_accounts(dry_run=True), ["account-gone"])
        self.assertTrue((self.root / "account-gone").exists())
        self.assertEqual(self.module.purge_expired_accounts(), ["account-gone"])
        self.assertFalse((self.root / "account-gone").exists())
        self.assertTrue((self.root / "account-fresh" / "w" / "blobs" / DIGEST).exists())
        self.assertEqual(list((self.root / ".quiltor-expired").iterdir()), [])

    def test_link_inside_an_expired_account_stops_the_purge(self) -> None:
        make_directory_link(self, self.root / "account-gone" / "w" / "snapshots", self.outside)
        for dry_run in (True, False):
            with self.subTest(dry_run=dry_run), self.assertRaises(ValueError):
                self.module.purge_expired_accounts(dry_run=dry_run)
        self.assertTrue(self.sentinel.exists())
        self.assertTrue((self.root / "account-gone" / "w" / "blobs" / DIGEST).exists())

    def test_linked_account_folder_itself_stops_the_purge(self) -> None:
        for child in (self.root / "account-gone").rglob("*"):
            if child.is_file():
                child.unlink()
        import shutil

        shutil.rmtree(self.root / "account-gone")
        make_directory_link(self, self.root / "account-gone", self.outside)
        with self.assertRaises((ValueError, Exception)):
            self.module.purge_expired_accounts()
        self.assertTrue(self.sentinel.exists())

    def test_overly_deep_tree_is_refused(self) -> None:
        deep = self.root / "account-gone" / "a" / "b" / "c" / "d" / "e"
        deep.mkdir(parents=True)
        with self.assertRaises(ValueError):
            self.module.purge_expired_accounts()
        self.assertTrue(deep.exists())


class ImageContractTest(unittest.TestCase):
    """B.12: the container runs unprivileged and carries no secret in its layers."""

    def setUp(self) -> None:
        path = Path(__file__).resolve().parents[2] / "services" / "backup-server" / "Dockerfile"
        self.text = path.read_text(encoding="utf-8")
        self.lines = [
            line.strip() for line in self.text.splitlines() if not line.strip().startswith("#")
        ]

    def test_runs_as_a_non_root_user_set_before_the_command(self) -> None:
        users = [i for i, line in enumerate(self.lines) if line.startswith("USER ")]
        command = [i for i, line in enumerate(self.lines) if line.startswith("CMD ")]
        self.assertTrue(users and command)
        self.assertEqual(self.lines[users[-1]], "USER quiltor")
        self.assertLess(users[-1], command[0])

    def test_no_secret_is_baked_into_the_image(self) -> None:
        for line in self.lines:
            if line.startswith(("ENV ", "ARG ")):
                self.assertNotRegex(line.upper(), r"SECRET|PASSWORD|TOKEN|KEY=")

    def test_base_image_is_pinned_by_digest(self) -> None:
        self.assertRegex(
            self.text, r"BACKUP_BASE_IMAGE=python:[0-9.]+-slim-[a-z]+@sha256:[0-9a-f]{64}"
        )


if __name__ == "__main__":
    unittest.main()
