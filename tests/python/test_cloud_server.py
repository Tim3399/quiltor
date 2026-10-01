"""Hosted-sync behavior of the authenticated reference backup server."""

import concurrent.futures
import datetime
import hashlib
import importlib.util
import json
import os
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from quiltor.application.backup_manifest import build_manifest_files, manifest_identifier
from tests.python.fake_issuer import FakeIssuer

REFERENCE_SERVER = Path(__file__).resolve().parents[2] / "services" / "backup-server" / "server.py"
TOKEN = "cloud-token"
ACCOUNT = "cloud-account"


def _load_server(root: Path, issuer_url: str):
    os.environ["QUILTOR_BACKUP_ROOT"] = str(root)
    spec = importlib.util.spec_from_file_location("quiltor_cloud_reference", REFERENCE_SERVER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = root
    module.ISSUER = issuer_url
    module.CLIENT_ID = "quiltor-backup"
    module.CLIENT_SECRET = "secret"
    module.REQUIRED_SCOPE = "quiltor.backup"
    module.PUBLIC_URL = "https://backup.example.test"
    module.ALLOW_INSECURE_LOOPBACK = True
    module.TRUSTED_ENDPOINT_ORIGINS = ()
    module.POLICY_FILE = ""
    module.POLICIES = {}
    module._discovery.clear()
    module._tokens.clear()
    module._account_locks.clear()
    return module


class CloudServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.issuer = FakeIssuer().start()
        self.issuer.issue(TOKEN, sub=ACCOUNT)
        self.reference = _load_server(self.root / "served", self.issuer.url)
        self.httpd = self.reference.Server(("127.0.0.1", 0), self.reference.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.issuer.stop()
        self.temporary.cleanup()

    def _request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        *,
        token: str = TOKEN,
        content_type: str = "application/json",
    ) -> tuple[int, dict]:
        request = urllib.request.Request(f"{self.endpoint}{path}", data=body, method=method)
        request.add_header("Authorization", f"Bearer {token}")
        if body is not None:
            request.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = response.read()
                return response.status, json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            payload = error.read()
            return error.code, json.loads(payload) if payload else {}

    def _put_json(self, path: str, document: dict, *, token: str = TOKEN) -> tuple[int, dict]:
        return self._request(
            "PUT",
            path,
            json.dumps(document, separators=(",", ":")).encode(),
            token=token,
        )

    def _upload_snapshot(self, marker: bytes, *, world: str = "world-a") -> str:
        files = {"world.sqlite3": marker}
        descriptors = build_manifest_files(files.items())
        body = {
            "format": 2,
            "encryption": "none",
            "created": "2026-09-19T10:00:00+00:00",
            "world": world,
            "title": "Cloud test",
            "message": marker.decode("ascii"),
            "parent": "",
            "files": descriptors,
        }
        snapshot_id = manifest_identifier(body, 2)
        digest = descriptors["world.sqlite3"]["sha256"]
        status, _ = self._request(
            "PUT",
            f"/v1/worlds/{world}/blobs/{digest}",
            marker,
            content_type="application/octet-stream",
        )
        self.assertIn(status, {200, 201})
        status, _ = self._put_json(
            f"/v1/worlds/{world}/snapshots/{snapshot_id}", {**body, "id": snapshot_id}
        )
        self.assertIn(status, {200, 201})
        return snapshot_id

    def test_account_and_initial_sync_head_are_explicit(self) -> None:
        status, account = self._request("GET", "/v1/account")
        self.assertEqual(status, 200)
        self.assertEqual(
            account,
            {
                "accountId": hashlib.sha256(ACCOUNT.encode()).hexdigest(),
                "access": "read-write",
                "usedBytes": 0,
                "limitBytes": None,
                "deleteAfter": None,
            },
        )
        self.assertEqual(
            self._request("GET", "/v1/worlds/world-a/sync"),
            (200, {"generation": 0, "snapshotId": None}),
        )
        self.assertEqual(self._request("GET", "/v1/worlds/world-a/sync/extra")[0], 404)

    def test_invalid_and_expired_tokens_are_unauthorized(self) -> None:
        self.issuer.issue("expired-cloud-token", sub=ACCOUNT)
        self.issuer.tokens["expired-cloud-token"]["exp"] = time.time() - 1
        self.assertEqual(self._request("GET", "/v1/account", token="invalid-token")[0], 401)
        self.assertEqual(self._request("GET", "/v1/account", token="expired-cloud-token")[0], 401)

    def test_concurrent_compare_and_set_has_one_winner_and_replay_is_idempotent(self) -> None:
        first = self._upload_snapshot(b"first")
        second = self._upload_snapshot(b"second")
        barrier = threading.Barrier(2)

        def publish(snapshot_id: str) -> tuple[int, dict]:
            barrier.wait(timeout=5)
            return self._put_json(
                "/v1/worlds/world-a/sync",
                {"expectedGeneration": 0, "snapshotId": snapshot_id},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(publish, (first, second)))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        winner = next(body for status, body in results if status == 200)
        conflict = next(body for status, body in results if status == 409)
        self.assertEqual(conflict, {"code": "sync.conflict", "head": winner})
        self.assertEqual(winner["generation"], 1)

        status, replay = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 0, "snapshotId": winner["snapshotId"]},
        )
        self.assertEqual((status, replay), (200, winner))

    def test_idempotent_replay_rejects_corrupt_current_snapshot(self) -> None:
        snapshot_id = self._upload_snapshot(b"current")
        status, head = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 0, "snapshotId": snapshot_id},
        )
        self.assertEqual(status, 200)
        manifest_path = (
            self.root / "served" / ACCOUNT / "world-a" / "snapshots" / f"{snapshot_id}.json"
        )
        manifest = json.loads(manifest_path.read_bytes())
        digest = manifest["files"]["world.sqlite3"]["sha256"]
        (self.root / "served" / ACCOUNT / "world-a" / "blobs" / digest).write_bytes(b"corrupt")

        status, _ = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 0, "snapshotId": snapshot_id},
        )
        self.assertEqual(status, 400)
        self.assertEqual(self._request("GET", "/v1/worlds/world-a/sync"), (200, head))

    def test_sync_head_rejects_invalid_generation_snapshot_combinations(self) -> None:
        target = self.root / "served" / ACCOUNT / "world-a" / "sync.json"
        target.parent.mkdir(parents=True)
        invalid_heads = (
            {"generation": 0, "snapshotId": "a" * 64},
            {"generation": 1, "snapshotId": None},
            {"generation": 9_007_199_254_740_992, "snapshotId": "a" * 64},
        )
        for document in invalid_heads:
            with self.subTest(head=document):
                target.write_text(json.dumps(document), encoding="utf-8")
                self.assertEqual(self._request("GET", "/v1/worlds/world-a/sync")[0], 500)
        target.unlink()
        status, _ = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 9_007_199_254_740_992, "snapshotId": "a" * 64},
        )
        self.assertEqual(status, 400)

    def test_write_policy_is_rechecked_after_waiting_for_account_lock(self) -> None:
        expires = datetime.datetime.now(datetime.UTC) + datetime.timedelta(seconds=1)
        self.reference.POLICIES = {
            ACCOUNT: {
                "access": "read-write",
                "limitBytes": None,
                "deleteAfter": expires.isoformat(),
            }
        }
        payload = b"crossing-expiry"
        digest = hashlib.sha256(payload).hexdigest()
        account_lock = self.reference._account_lock(ACCOUNT)
        before = self.issuer.introspections
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            with account_lock:
                request = executor.submit(
                    self._request,
                    "PUT",
                    f"/v1/worlds/world-a/blobs/{digest}",
                    payload,
                    content_type="application/octet-stream",
                )
                deadline = time.time() + 5
                while self.issuer.introspections == before and time.time() < deadline:
                    time.sleep(0.01)
                self.assertGreater(self.issuer.introspections, before)
                delay = expires.timestamp() - time.time() + 0.1
                if delay > 0:
                    time.sleep(delay)
            status, body = request.result(timeout=5)
        self.assertEqual((status, body["code"]), (403, "cloud.account_expired"))
        self.assertFalse((self.root / "served" / ACCOUNT / "world-a" / "blobs" / digest).exists())

    def test_missing_or_corrupt_snapshot_never_changes_head(self) -> None:
        missing = "0" * 64
        status, _ = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 0, "snapshotId": missing},
        )
        self.assertEqual(status, 400)
        self.assertEqual(self._request("GET", "/v1/worlds/world-a/sync")[1]["generation"], 0)

        snapshot_id = self._upload_snapshot(b"valid")
        manifest_path = (
            self.root / "served" / ACCOUNT / "world-a" / "snapshots" / f"{snapshot_id}.json"
        )
        manifest_path.write_bytes(b"{}")
        status, _ = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 0, "snapshotId": snapshot_id},
        )
        self.assertEqual(status, 400)
        self.assertEqual(self._request("GET", "/v1/worlds/world-a/sync")[1]["generation"], 0)

    def test_head_write_is_quota_checked_and_accounts_are_isolated(self) -> None:
        snapshot_id = self._upload_snapshot(b"quota-head")
        used = self._request("GET", "/v1/account")[1]["usedBytes"]
        self.reference.POLICIES = {
            ACCOUNT: {"access": "read-write", "limitBytes": used, "deleteAfter": None}
        }
        status, body = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 0, "snapshotId": snapshot_id},
        )
        self.assertEqual((status, body["code"]), (507, "cloud.quota_exceeded"))
        self.assertEqual(self._request("GET", "/v1/worlds/world-a/sync")[1]["generation"], 0)

        self.reference.POLICIES = {}
        status, published = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 0, "snapshotId": snapshot_id},
        )
        self.assertEqual(status, 200)
        self.issuer.issue("other-cloud-token", sub="other-account")
        self.assertEqual(
            self._request("GET", "/v1/worlds/world-a/sync", token="other-cloud-token"),
            (200, {"generation": 0, "snapshotId": None}),
        )
        self.assertEqual(published["generation"], 1)

    def test_quota_serializes_concurrent_uploads_and_reuse_is_free(self) -> None:
        self.reference.POLICIES = {
            ACCOUNT: {"access": "read-write", "limitBytes": 8, "deleteAfter": None}
        }
        payloads = (b"aaaaaaaa", b"bbbbbbbb")
        barrier = threading.Barrier(2)

        def upload(payload: bytes) -> tuple[int, dict]:
            digest = hashlib.sha256(payload).hexdigest()
            barrier.wait(timeout=5)
            return self._request(
                "PUT",
                f"/v1/worlds/world-a/blobs/{digest}",
                payload,
                content_type="application/octet-stream",
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(upload, payloads))
        self.assertEqual(sorted(status for status, _ in results), [201, 507])
        self.assertEqual(
            next(body["code"] for status, body in results if status == 507), "cloud.quota_exceeded"
        )
        stored = next(
            payload for payload, result in zip(payloads, results, strict=True) if result[0] == 201
        )
        status, _ = self._request(
            "PUT",
            f"/v1/worlds/world-a/blobs/{hashlib.sha256(stored).hexdigest()}",
            stored,
            content_type="application/octet-stream",
        )
        self.assertEqual(status, 200)
        self.assertEqual(self._request("GET", "/v1/account")[1]["usedBytes"], 8)

    def test_read_only_preserves_listing_and_download_but_rejects_put(self) -> None:
        snapshot_id = self._upload_snapshot(b"exportable")
        self.reference.POLICIES = {
            ACCOUNT: {"access": "read-only", "limitBytes": None, "deleteAfter": None}
        }
        self.assertEqual(self._request("GET", "/v1/worlds/world-a/snapshots")[0], 200)
        self.assertEqual(
            self._request("GET", f"/v1/worlds/world-a/snapshots/{snapshot_id}")[0], 200
        )
        status, body = self._put_json(
            "/v1/worlds/world-a/sync",
            {"expectedGeneration": 0, "snapshotId": snapshot_id},
        )
        self.assertEqual((status, body["code"]), (403, "cloud.read_only"))

    def test_expiry_never_revives_and_purge_is_account_scoped(self) -> None:
        account_root = self.root / "served" / ACCOUNT
        neighbor = self.root / "served" / "neighbor"
        (account_root / "world-a" / "blobs").mkdir(parents=True)
        (account_root / "world-a" / "blobs" / ("a" * 64)).write_bytes(b"expired")
        neighbor.mkdir(parents=True)
        (neighbor / "keep").write_bytes(b"neighbor")
        self.reference.POLICIES = {
            ACCOUNT: {
                "access": "read-write",
                "limitBytes": None,
                "deleteAfter": "2000-01-01T00:00:00Z",
            }
        }
        for _ in range(2):
            status, body = self._request("GET", "/v1/account")
            self.assertEqual((status, body["code"]), (403, "cloud.account_expired"))
        self.assertEqual(self.reference.purge_expired_accounts(dry_run=True), [ACCOUNT])
        self.assertTrue(account_root.exists())
        self.assertEqual(self.reference.purge_expired_accounts(), [ACCOUNT])
        self.assertFalse(account_root.exists())
        self.assertEqual((neighbor / "keep").read_bytes(), b"neighbor")

    def test_process_lock_excludes_purge_and_retained_quarantine_is_retryable(self) -> None:
        self.reference.ROOT.mkdir(parents=True)
        with (
            self.reference._storage_process_lock(),
            self.assertRaisesRegex(ValueError, "stop the server"),
            self.reference._storage_process_lock(),
        ):
            self.fail("a second process lock unexpectedly succeeded")

        retained = self.reference.ROOT / ".quiltor-expired" / f"{ACCOUNT}-123"
        retained.mkdir(parents=True)
        (retained / "retained").write_bytes(b"delete on retry")
        self.reference.POLICIES = {
            ACCOUNT: {
                "access": "read-write",
                "limitBytes": None,
                "deleteAfter": "2000-01-01T00:00:00Z",
            }
        }
        self.assertEqual(self.reference.purge_expired_accounts(), [ACCOUNT])
        self.assertFalse(retained.exists())

    def test_policy_validation_fails_closed(self) -> None:
        policy = self.root / "policy.json"
        policy.write_text(
            json.dumps({"accounts": {ACCOUNT: {"access": "paid", "limitBytes": -1}}}),
            encoding="utf-8",
        )
        self.reference.POLICY_FILE = str(policy)
        with self.assertRaises(ValueError):
            self.reference.load_policy_configuration()

    def test_truncated_request_is_rejected_without_a_write(self) -> None:
        connection = socket.create_connection(("127.0.0.1", self.httpd.server_address[1]))
        connection.settimeout(5)
        try:
            connection.sendall(
                (
                    "PUT /v1/worlds/world-a/sync HTTP/1.1\r\n"
                    "Host: 127.0.0.1\r\n"
                    f"Authorization: Bearer {TOKEN}\r\n"
                    "Content-Type: application/json\r\n"
                    "Content-Length: 100\r\n"
                    "Connection: close\r\n\r\n{}"
                ).encode("ascii")
            )
            connection.shutdown(socket.SHUT_WR)
            response = b""
            while chunk := connection.recv(4096):
                response += chunk
        finally:
            connection.close()
        self.assertIn(b" 400 ", response.split(b"\r\n", 1)[0])
        self.assertEqual(self._request("GET", "/v1/worlds/world-a/sync")[1]["generation"], 0)

    def test_purge_refuses_an_external_link_and_preserves_its_target(self) -> None:
        account_root = self.root / "served" / ACCOUNT
        account_root.mkdir(parents=True)
        external = self.root / "outside"
        external.mkdir()
        (external / "keep").write_bytes(b"outside")
        link = account_root / "linked"
        try:
            link.symlink_to(external, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"directory symlinks unavailable: {error}")
        self.reference.POLICIES = {
            ACCOUNT: {
                "access": "read-write",
                "limitBytes": None,
                "deleteAfter": "2000-01-01T00:00:00Z",
            }
        }
        with self.assertRaises(ValueError):
            self.reference.purge_expired_accounts()
        self.assertTrue(account_root.exists())
        self.assertEqual((external / "keep").read_bytes(), b"outside")


if __name__ == "__main__":
    unittest.main()
