"""Setting a world's sync target after it was created (T-87 part C).

`GET` and `POST /api/sync/target?world=ID` read and set the address a world syncs
with. Precedence (F-87-4): the world's own address wins; the operator's
`QUILTOR_BACKUP_URL` is only the fallback for a world without one, and the backup
context the sync routes use resolves it the same way.
"""

import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from quiltor.infrastructure.persistence.sqlite import config
from quiltor.modules.identity.auth import SessionData
from tests.python.test_server_logging import _LiveServer

CONTRACT = Path(__file__).resolve().parents[2] / "contracts"
SCHEMA = json.loads(
    (CONTRACT / "application-api/sync-target/v1.schema.json").read_text(encoding="utf-8")
)


class _TargetServer(_LiveServer):
    OPERATOR = ""

    def setUp(self):
        super().setUp()
        environment = patch.dict(os.environ, {"QUILTOR_BACKUP_URL": self.OPERATOR})
        environment.start()
        self.addCleanup(environment.stop)

    def target(self):
        status, _, raw = self.request("GET", f"/api/sync/target?world={self.world_id}")
        self.assertEqual(status, 200, raw[:400])
        return self.conforming(json.loads(raw))

    def set_target(self, value):
        return self.request("POST", f"/api/sync/target?world={self.world_id}", {"backupUrl": value})

    def conforming(self, body):
        # The suite has no JSON-Schema library; the schema is closed and flat, so its
        # key set, required list and enum are what an answer can get wrong.
        self.assertEqual(set(body), set(SCHEMA["properties"]))
        self.assertEqual(set(SCHEMA["required"]), set(body))
        self.assertIn(body["source"], SCHEMA["properties"]["source"]["enum"])
        return body

    def endpoint_the_sync_uses(self):
        # The context every sync route is handed (`request.world.backup`); asking
        # GET /api/sync instead would reach out to the endpoint.
        owner = SessionData(
            sub=config.LOCAL_OWNER, email="", name="", created_at=0.0, expires_at=0.0
        )
        return self.application.resolve_world(owner, self.world_id).backup.endpoint_url


class SyncTargetRouteTest(_TargetServer):
    def test_a_world_without_a_target_has_none(self):
        self.assertEqual(
            self.target(),
            json.loads(
                (CONTRACT / "fixtures/application-api/sync-target/none.v1.json").read_text(
                    encoding="utf-8"
                )
            ),
        )

    def test_setting_a_target_stores_it_normalized_and_the_sync_uses_it(self):
        status, _, raw = self.set_target("  https://sync.example/  ")
        self.assertEqual(status, 200, raw[:400])
        self.assertEqual(self.conforming(json.loads(raw))["worldUrl"], "https://sync.example")
        body = self.target()
        self.assertEqual(body["backupUrl"], "https://sync.example")
        self.assertEqual(body["source"], "world")
        worlds = json.loads(self.request("GET", "/api/worlds")[2])["worlds"]
        stored = next(w for w in worlds if w["id"] == self.world_id)
        self.assertEqual(stored["backupUrl"], "https://sync.example")

    def test_an_empty_target_removes_it(self):
        self.set_target("https://sync.example")
        status, _, raw = self.set_target("")
        self.assertEqual(status, 200, raw[:400])
        self.assertEqual(self.target()["source"], "none")
        _, _, raw = self.request("GET", f"/api/sync?world={self.world_id}")
        self.assertIs(json.loads(raw)["configured"], False)

    def test_an_insecure_or_malformed_target_is_refused_and_nothing_changes(self):
        self.set_target("https://sync.example")
        for value in ("http://sync.example", "ftp://sync.example", "nicht eine adresse"):
            with self.subTest(value=value):
                status, _, raw = self.set_target(value)
                self.assertEqual(status, 400, raw[:400])
                self.assertEqual(json.loads(raw)["error"]["code"], "sync.target_invalid")
                self.assertEqual(self.target()["worldUrl"], "https://sync.example")

    def test_a_loopback_http_target_is_allowed_for_development(self):
        status, _, raw = self.set_target("http://127.0.0.1:8123")
        self.assertEqual(status, 200, raw[:400])

    def test_a_missing_or_non_text_target_is_a_request_error(self):
        for body in ({}, {"backupUrl": 5}, {"backupUrl": "https://a.example/" + "x" * 2048}):
            with self.subTest(body=str(body)[:40]):
                status, _, raw = self.request(
                    "POST", f"/api/sync/target?world={self.world_id}", body
                )
                self.assertEqual(status, 400, raw[:400])
                self.assertEqual(json.loads(raw)["error"]["code"], "sync.request_invalid")

    def test_another_world_is_not_touched(self):
        other = self._create_world()
        self.set_target("https://sync.example")
        _, _, raw = self.request("GET", f"/api/sync/target?world={other}")
        self.assertEqual(json.loads(raw)["source"], "none")


class OperatorPrecedenceTest(_TargetServer):
    """F-87-4: the world's own address wins over the operator's default."""

    OPERATOR = "https://operator.example"

    def test_a_world_without_a_target_falls_back_to_the_operator(self):
        body = self.target()
        self.assertEqual(
            body,
            json.loads(
                (CONTRACT / "fixtures/application-api/sync-target/operator.v1.json").read_text(
                    encoding="utf-8"
                )
            ),
        )
        self.assertEqual(self.endpoint_the_sync_uses(), "https://operator.example")

    def test_a_world_target_overrides_the_operator_and_the_sync_uses_it(self):
        status, _, raw = self.set_target("https://sync.example")
        self.assertEqual(status, 200, raw[:400])
        self.assertEqual(
            self.conforming(json.loads(raw)),
            json.loads(
                (CONTRACT / "fixtures/application-api/sync-target/world.v1.json").read_text(
                    encoding="utf-8"
                )
            ),
        )
        self.assertEqual(self.endpoint_the_sync_uses(), "https://sync.example")

    def test_a_target_given_at_creation_also_overrides_the_operator(self):
        status, _, raw = self.request(
            "POST", "/api/worlds/create", {"title": "Mit Ziel", "backupUrl": "https://sync.example"}
        )
        self.assertEqual(status, 200, raw[:400])
        world = json.loads(raw)["world"]["id"]
        _, _, raw = self.request("GET", f"/api/sync/target?world={world}")
        self.assertEqual(json.loads(raw)["source"], "world")

    def test_removing_the_world_target_returns_to_the_operator(self):
        self.set_target("https://sync.example")
        self.set_target("")
        self.assertEqual(self.target()["source"], "operator")
        self.assertEqual(self.endpoint_the_sync_uses(), "https://operator.example")

    def test_the_operator_value_is_never_written_to_the_world(self):
        self.set_target("")
        self.assertEqual(self.target()["worldUrl"], "")


if __name__ == "__main__":
    unittest.main()
