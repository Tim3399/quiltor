"""A hosted server is the shared storage; it does not sync with other devices (D-61, T-87).

Every route that syncs a world with another device through a backup endpoint is
marked `device_sync`. In the `hosted` operation profile the dispatch refuses it with
`403 sync.forbidden_hosted` before the route runs and before any body is read;
locally it runs as before. Two routes decide from their body instead: `POST
/api/backup` with `push`, and `POST /api/worlds/create` with a `backupUrl`.
"""

import json
import unittest
from unittest.mock import MagicMock, patch

from quiltor.delivery.http import routes as api_routes
from quiltor.hosts.web import server
from tests.python.test_server_logging import _LiveServer

# Every device-sync route as (table, path).
SYNC_ENDPOINTS = {
    ("GET", "/api/sync"),
    ("GET", "/api/sync/preview"),
    ("SAVE", "/api/sync"),
    ("GET", "/api/sync/target"),
    ("SAVE", "/api/sync/target"),
    ("GET", "/api/backup/remote"),
    ("SAVE", "/api/backup/restore"),
    ("GET", "/api/backup/login"),
    ("SAVE", "/api/backup/login"),
    ("SAVE", "/api/backup/logout"),
    ("GET", "/backup/callback"),
}

# Routes that keep or read versions on this server; they stay open everywhere.
LOCAL_ROUTES = {
    ("GET", "/api/backup"),
    ("SAVE", "/api/backup"),
    ("GET", "/api/backups"),
    ("GET", "/api/backups/location"),
    ("GET", "/api/backups/preview"),
    ("SAVE", "/api/backups/restore"),
}

SYNC_FRAGMENTS = (
    "/backup/login",
    "/backup/logout",
    "/backup/remote",
    "/backup/restore",
    "/backup/callback",
)


def _tables():
    api_routes.load()
    return {"GET": api_routes.GET, "SAVE": api_routes.SAVE}


def _looks_like_sync(path: str) -> bool:
    return path.startswith("/api/sync") or any(fragment in path for fragment in SYNC_FRAGMENTS)


class DeviceSyncTableTest(unittest.TestCase):
    def test_the_marked_routes_are_exactly_the_sync_endpoints(self):
        marked = {
            (name, path)
            for name, table in _tables().items()
            for path, registration in table.items()
            if registration.device_sync
        }
        self.assertEqual(marked, SYNC_ENDPOINTS)

    def test_every_route_that_looks_like_sync_is_marked(self):
        # Catches a new sync route registered without the mark.
        for name, table in _tables().items():
            for path, registration in table.items():
                if _looks_like_sync(path):
                    with self.subTest(table=name, path=path):
                        self.assertTrue(registration.device_sync, f"{path} is not device_sync")

    def test_local_and_reading_routes_are_not_marked(self):
        tables = _tables()
        open_routes = set(LOCAL_ROUTES)
        open_routes |= {
            (name, path)
            for name, table in tables.items()
            for path in table
            if path.startswith("/api/history")
        }
        for name, path in sorted(open_routes):
            with self.subTest(table=name, path=path):
                self.assertFalse(tables[name][path].device_sync)

    def test_no_route_is_both_operator_only_and_device_sync(self):
        for name, table in _tables().items():
            for path, registration in table.items():
                with self.subTest(table=name, path=path):
                    self.assertFalse(registration.operator_only and registration.device_sync)


class _SyncServer(_LiveServer):
    def call(self, table: str, path: str):
        method = "GET" if table == "GET" else "POST"
        separator = "&" if "?" in path else "?"
        # The world goes in the query for both: a `world=True` SAVE route reads it there,
        # and a body-world route ignores it.
        url = f"{path}{separator}world={self.world_id}"
        body = None if method == "GET" else {"worldId": self.world_id}
        return self.request(method, url, body)


class HostedDeviceSyncTest(_SyncServer):
    def setUp(self):
        super().setUp()
        self.application.operation_profile = "hosted"

    def test_hosted_refuses_every_sync_endpoint_before_the_route_runs(self):
        tables = _tables()
        for name, path in sorted(SYNC_ENDPOINTS):
            with self.subTest(table=name, path=path):
                self.fresh()
                route = MagicMock()
                with (
                    patch.object(tables[name][path], "handler", route),
                    patch.object(
                        server.Handler, "_read_json_body", side_effect=AssertionError("body read")
                    ) as read_body,
                ):
                    status, _, raw = self.call(name, path)
                self.assertEqual(status, 403)
                error = json.loads(raw)["error"]
                self.assertEqual(error["code"], "sync.forbidden_hosted")
                self.assertFalse(error["retryable"])
                read_body.assert_not_called()
                route.assert_not_called()
                line = self.only("sync.forbidden_hosted")
                self.assertEqual(line["level"], "warning")
                self.assertEqual(line["route"], path)

    def test_hosted_keeps_a_version_but_refuses_to_push_it(self):
        status, _, raw = self.request("POST", "/api/backup", {"worldId": self.world_id})
        self.assertEqual(status, 200, raw[:400])

        backups = type(self.application.application.backups)
        with patch.object(backups, "commit") as commit:
            status, _, raw = self.request(
                "POST", "/api/backup", {"worldId": self.world_id, "push": True}
            )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(raw)["error"]["code"], "sync.forbidden_hosted")
        self.assertFalse(json.loads(raw)["error"]["retryable"])
        commit.assert_not_called()

    def test_hosted_creates_a_world_only_without_a_sync_target(self):
        status, _, raw = self.request(
            "POST", "/api/worlds/create", {"title": "Mit Ziel", "backupUrl": "https://sync.example"}
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(raw)["error"]["code"], "sync.forbidden_hosted")
        titles = [w["title"] for w in json.loads(self.request("GET", "/api/worlds")[2])["worlds"]]
        self.assertNotIn("Mit Ziel", titles)

        status, _, raw = self.request(
            "POST", "/api/worlds/create", {"title": "Ohne Ziel", "backupUrl": ""}
        )
        self.assertEqual(status, 200, raw[:400])

    def test_whoami_says_sync_is_not_available(self):
        _, _, raw = self.request("GET", "/api/whoami")
        self.assertIs(json.loads(raw)["syncAvailable"], False)


class LocalDeviceSyncTest(_SyncServer):
    def test_local_and_desktop_answer_every_sync_endpoint(self):
        for profile in ("local", "desktop"):
            self.application.operation_profile = profile
            for name, path in sorted(SYNC_ENDPOINTS):
                with self.subTest(profile=profile, table=name, path=path):
                    self.fresh()
                    status, _, raw = self.call(name, path)
                    self.assertNotEqual(status, 403, raw[:400])
                    self.assertEqual(self.lines("sync.forbidden_hosted"), [])

    def test_local_sync_status_without_a_target_is_unconfigured(self):
        status, _, raw = self.call("GET", "/api/sync")
        self.assertEqual(status, 200)
        self.assertIs(json.loads(raw)["configured"], False)

    def test_local_push_is_not_refused_as_hosted(self):
        status, _, raw = self.request(
            "POST", "/api/backup", {"worldId": self.world_id, "push": True}
        )
        # Without a target the upload fails for its own reason
        # (backup.authorization_unavailable), never as a hosted refusal.
        self.assertNotEqual(json.loads(raw).get("error", {}).get("code"), "sync.forbidden_hosted")
        self.assertNotEqual(status, 200, raw[:400])

    def test_local_stores_the_sync_target_of_a_new_world(self):
        status, _, raw = self.request(
            "POST", "/api/worlds/create", {"title": "Mit Ziel", "backupUrl": "https://sync.example"}
        )
        self.assertEqual(status, 200, raw[:400])
        self.assertEqual(json.loads(raw)["world"]["backupUrl"], "https://sync.example")

    def test_whoami_says_sync_is_available(self):
        for profile in ("local", "desktop"):
            self.application.operation_profile = profile
            with self.subTest(profile=profile):
                _, _, raw = self.request("GET", "/api/whoami")
                self.assertIs(json.loads(raw)["syncAvailable"], True)


if __name__ == "__main__":
    unittest.main()
