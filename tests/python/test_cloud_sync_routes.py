"""Cloud synchronization routes over the real threaded web server."""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quiltor.bootstrap import build_identity, build_web_application
from quiltor.hosts.web import server
from quiltor.infrastructure.platform.ports import AppDirectories
from quiltor.modules.identity.service import SESSION_COOKIE
from tests.python.request_timeout import REQUEST_TIMEOUT


def _directories(root: Path) -> AppDirectories:
    return AppDirectories(
        data=root,
        config=root / "config",
        cache=root / "cache",
        models=root / "models",
        logs=root / "logs",
        temp=root / "temp",
    )


def _application(root: Path, *, hosted: bool = False):
    identity = (
        build_identity(
            True,
            issuer="https://identity.example.test/realms/quiltor",
            client_id="quiltor-test",
            client_secret="secret",
        )
        if hosted
        else build_identity(False)
    )
    inference = MagicMock(identity="test-inference")
    inference.status.return_value = {
        "available": False,
        "mode": "local",
        "reason": "test",
    }
    return build_web_application(
        identity=identity,
        ensure_assistant_installed=False,
        inference=inference,
        app_directories=_directories(root),
    )


def _configured_status(**extra) -> dict:
    return {
        "ok": True,
        "configured": True,
        "endpoint": "https://cloud.example.test",
        "mode": "manual",
        "state": "synced",
        "localFingerprint": "a" * 64,
        "baseGeneration": 7,
        "remote": {"generation": 7, "snapshotId": "remote-snapshot-7"},
        "lastSyncedAt": "2026-09-19T12:00:00Z",
        "account": {
            "accountId": "account-1",
            "access": "read-write",
            "usedBytes": 128,
            "limitBytes": 1024,
            "deleteAfter": None,
        },
        **extra,
    }


class _LiveSyncServer(unittest.TestCase):
    hosted = False

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.environment = patch.dict(
            os.environ,
            {
                "QUILTOR_BACKUP_TOKEN": "test-cloud-token",
                "QUILTOR_HOST": "127.0.0.1",
                "QUILTOR_PUBLIC_URL": "https://quiltor.example.test" if self.hosted else "",
            },
        )
        self.environment.start()
        self.application = _application(Path(self.temp.name), hosted=self.hosted)
        self.application.prepare()
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.application)
        self.port = self.httpd.server_address[1]
        self.server_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.server_thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.server_thread.join(timeout=5)
        self.assertFalse(self.server_thread.is_alive(), "the test server did not stop")
        self.application.identity.auth.clear()
        self.application.close()
        self.environment.stop()
        self.temp.cleanup()

    def request(
        self,
        method: str,
        path: str,
        *,
        body: object | None = None,
        headers: dict[str, str] | None = None,
        cookies: dict[str, str] | None = None,
    ) -> tuple[int, dict, bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=REQUEST_TIMEOUT)
        selected_headers = dict(headers or {})
        if cookies:
            selected_headers["Cookie"] = "; ".join(
                f"{name}={value}" for name, value in cookies.items()
            )
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        if payload is not None:
            selected_headers.setdefault("Content-Type", "application/json")
        connection.request(method, path, body=payload, headers=selected_headers)
        response = connection.getresponse()
        raw = response.read()
        result = response.status, dict(response.getheaders()), raw
        connection.close()
        return result

    def json_request(self, method: str, path: str, **kwargs) -> tuple[int, dict]:
        status, _, raw = self.request(method, path, **kwargs)
        return status, json.loads(raw)

    def create_world(self, *, backup_url: str = "") -> str:
        status, payload = self.json_request(
            "POST",
            "/api/worlds/create",
            body={"title": "Cloud route test", "backupUrl": backup_url},
        )
        self.assertEqual(status, 200, payload)
        return payload["world"]["id"]


class CloudSyncRouteTests(_LiveSyncServer):
    def test_slow_remote_status_does_not_block_an_independent_manuscript_save(self) -> None:
        world_id = self.create_world(backup_url="https://cloud.example.test")
        remote_entered = threading.Event()
        release_remote = threading.Event()
        cloud_done = threading.Event()
        save_done = threading.Event()
        results: dict[str, tuple[int, dict, bytes]] = {}
        failures: list[BaseException] = []

        def slow_account(_endpoint, _authorization):
            remote_entered.set()
            if not release_remote.wait(timeout=REQUEST_TIMEOUT):
                raise TimeoutError("the test never released the remote account request")
            return {
                "accountId": "account-1",
                "access": "read-write",
                "usedBytes": 0,
                "limitBytes": None,
                "deleteAfter": None,
            }

        def request_in_thread(
            name: str,
            done: threading.Event,
            method: str,
            path: str,
            **kwargs,
        ) -> None:
            try:
                results[name] = self.request(method, path, **kwargs)
            except BaseException as exc:  # noqa: BLE001 - returned to the test thread
                failures.append(exc)
            finally:
                done.set()

        remote = self.application.application.synchronization._remote
        with (
            patch.object(
                type(self.application),
                "backup_authorization",
                return_value=MagicMock(endpoint="https://cloud.example.test"),
            ),
            patch.object(remote, "account", side_effect=slow_account),
            patch.object(
                remote,
                "sync_head",
                return_value={"generation": 0, "snapshotId": None},
            ),
        ):
            cloud_thread = threading.Thread(
                target=request_in_thread,
                args=("cloud", cloud_done, "GET", f"/api/sync?world={world_id}"),
                daemon=True,
            )
            save_thread = threading.Thread(
                target=request_in_thread,
                args=("save", save_done, "PUT", f"/api/manuscript?world={world_id}"),
                kwargs={
                    "body": {
                        "contract": "quiltor.manuscript",
                        "version": 1,
                        "revision": 0,
                        "payload": {
                            "chapters": [
                                {
                                    "id": "chapter-1",
                                    "title": "Während der Störung",
                                    "body": "Dieser lokale Text muss sofort gespeichert werden.",
                                    "note": "",
                                }
                            ]
                        },
                    },
                    "headers": {"If-Match": '"0"'},
                },
                daemon=True,
            )
            cloud_thread.start()
            try:
                self.assertTrue(
                    remote_entered.wait(timeout=5),
                    "the synchronization request never reached controlled remote I/O",
                )
                self.assertFalse(cloud_done.is_set(), "the controlled remote request did not wait")
                save_thread.start()
                saved_before_remote_release = save_done.wait(timeout=5)
            finally:
                release_remote.set()
                cloud_thread.join(timeout=5)
                if save_thread.ident is not None:
                    save_thread.join(timeout=5)

        self.assertTrue(
            saved_before_remote_release,
            "a cloud outage held the application lock and blocked a local manuscript save",
        )
        self.assertFalse(cloud_thread.is_alive(), "the cloud request thread leaked")
        self.assertFalse(save_thread.is_alive(), "the manuscript request thread leaked")
        self.assertEqual(failures, [])
        self.assertEqual(results["save"][0], 200, results["save"][2])
        self.assertEqual(results["cloud"][0], 200, results["cloud"][2])
        cloud_payload = json.loads(results["cloud"][2])
        self.assertEqual(cloud_payload["account"]["accountId"], "account-1")

        status, manuscript = self.json_request("GET", f"/api/manuscript?world={world_id}")
        self.assertEqual(status, 200, manuscript)
        self.assertEqual(
            manuscript["payload"]["chapters"][0]["body"],
            "Dieser lokale Text muss sofort gespeichert werden.",
        )

    def test_unconfigured_status_has_an_explicit_local_only_shape(self) -> None:
        world_id = self.create_world()

        status, payload = self.json_request("GET", f"/api/sync?world={world_id}")

        self.assertEqual(status, 200, payload)
        self.assertEqual(
            payload,
            {
                "ok": True,
                "configured": False,
                "endpoint": "",
                "mode": "manual",
                "state": "unconfigured",
                "localFingerprint": payload["localFingerprint"],
                "baseGeneration": None,
                "remote": {"generation": 0, "snapshotId": None},
                "lastSyncedAt": None,
            },
        )
        self.assertRegex(payload["localFingerprint"], r"^[a-f0-9]{64}$")
        self.assertNotIn("account", payload)

    def test_sync_post_rejects_missing_world_and_invalid_actions(self) -> None:
        world_id = self.create_world(backup_url="https://cloud.example.test")

        missing_status, missing = self.json_request("POST", "/api/sync", body={"action": "sync"})
        unknown_status, unknown = self.json_request(
            "POST",
            "/api/sync",
            body={"worldId": "0" * 32, "action": "sync"},
        )
        with patch.object(
            type(self.application),
            "backup_authorization",
            return_value=MagicMock(endpoint="https://cloud.example.test"),
        ):
            invalid_status, invalid = self.json_request(
                "POST",
                "/api/sync",
                body={"worldId": world_id, "action": "merge"},
            )

        self.assertEqual(missing_status, 400, missing)
        self.assertEqual(missing["error"]["code"], "request.invalid")
        self.assertEqual(unknown_status, 404, unknown)
        self.assertEqual(invalid_status, 400, invalid)
        self.assertEqual(invalid["error"]["code"], "sync.request_invalid")

    def test_successful_remote_pull_wraps_status_and_preserves_action_warnings(self) -> None:
        world_id = self.create_world(backup_url="https://cloud.example.test")
        backend_result = _configured_status(
            reloadRequired=True,
            localSnapshotId="local-safety-snapshot",
            warnings=["sync.state_not_saved"],
        )
        synchronization = self.application.application.synchronization

        with (
            patch.object(
                type(self.application),
                "backup_authorization",
                return_value=MagicMock(endpoint="https://cloud.example.test"),
            ),
            patch.object(
                synchronization, "synchronize", return_value=backend_result
            ) as synchronize,
        ):
            status, payload = self.json_request(
                "POST",
                "/api/sync",
                body={
                    "worldId": world_id,
                    "action": "use-remote",
                    "expectedGeneration": 7,
                    "expectedLocalFingerprint": "b" * 64,
                },
            )

        self.assertEqual(status, 200, payload)
        expected_status = dict(backend_result)
        for action_field in ("reloadRequired", "localSnapshotId", "warnings"):
            expected_status.pop(action_field)
        self.assertEqual(
            payload,
            {
                "ok": True,
                "status": expected_status,
                "reloadRequired": True,
                "localSnapshotId": "local-safety-snapshot",
                "warnings": ["sync.state_not_saved"],
            },
        )
        args, kwargs = synchronize.call_args
        self.assertEqual(args[0].root.name, world_id)
        self.assertEqual(args[1], self.application.identity.master_sub)
        self.assertEqual(args[3], "use-remote")
        self.assertEqual(kwargs["expected_generation"], 7)
        self.assertEqual(kwargs["expected_local_fingerprint"], "b" * 64)

    def test_successful_local_push_wraps_status_without_reload(self) -> None:
        world_id = self.create_world(backup_url="https://cloud.example.test")
        backend_result = _configured_status(
            reloadRequired=False,
            localSnapshotId="local-uploaded-snapshot",
        )
        synchronization = self.application.application.synchronization

        with (
            patch.object(
                type(self.application),
                "backup_authorization",
                return_value=MagicMock(endpoint="https://cloud.example.test"),
            ),
            patch.object(
                synchronization, "synchronize", return_value=backend_result
            ) as synchronize,
        ):
            status, payload = self.json_request(
                "POST",
                "/api/sync",
                body={
                    "worldId": world_id,
                    "action": "keep-local",
                    "expectedGeneration": 7,
                    "expectedLocalFingerprint": "a" * 64,
                },
            )

        self.assertEqual(status, 200, payload)
        expected_status = dict(backend_result)
        expected_status.pop("reloadRequired")
        expected_status.pop("localSnapshotId")
        self.assertEqual(
            payload,
            {
                "ok": True,
                "status": expected_status,
                "reloadRequired": False,
                "localSnapshotId": "local-uploaded-snapshot",
            },
        )
        args, kwargs = synchronize.call_args
        self.assertEqual(args[0].root.name, world_id)
        self.assertEqual(args[1], self.application.identity.master_sub)
        self.assertEqual(args[3], "keep-local")
        self.assertEqual(kwargs["expected_generation"], 7)
        self.assertEqual(kwargs["expected_local_fingerprint"], "a" * 64)


class CloudSyncOwnershipRouteTests(_LiveSyncServer):
    hosted = True

    def test_sync_status_requires_a_session_and_world_ownership(self) -> None:
        world = self.application.application.worlds.create(
            "Alice's project", "https://cloud.example.test", "alice"
        )
        bob_session = self.application.identity.auth.create_session(
            "bob", "bob@example.test", "Bob"
        )

        anonymous_status, anonymous = self.json_request("GET", f"/api/sync?world={world['id']}")
        bob_status, bob = self.json_request(
            "GET",
            f"/api/sync?world={world['id']}",
            cookies={SESSION_COOKIE: bob_session},
        )

        self.assertEqual(anonymous_status, 401, anonymous)
        self.assertEqual(anonymous["error"]["code"], "auth.unauthenticated")
        self.assertIn(bob_status, {403, 404}, bob)


if __name__ == "__main__":
    unittest.main()
