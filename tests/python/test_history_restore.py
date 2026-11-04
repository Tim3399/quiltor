"""Putting a version from the local history back (T-87 part B).

`POST /api/history/restore?world=ID` with `{id}` keeps the current state as
"Before restore" first, then swaps the world for the chosen version. Local only:
every blob comes from the world's own store, and a missing one fails before the
swap. A hosted server restores its own history like a local one (D-61).
"""

import json
from pathlib import Path

from quiltor.infrastructure.backup.snapshots import _manifest_digests
from quiltor.infrastructure.persistence.sqlite import config
from quiltor.modules.identity.auth import SessionData
from tests.python.test_server_logging import _LiveServer

CONTRACT = Path(__file__).resolve().parents[2] / "contracts"
SCHEMA = json.loads(
    (CONTRACT / "application-api/history/v1.schema.json").read_text(encoding="utf-8")
)
DOCUMENTS = ("/api/manuscript", "/api/state", "/api/storyboards")


class _HistoryServer(_LiveServer):
    def json_of(self, method, path, body=None, headers=None):
        status, _, raw = self.request(method, path, body, headers)
        self.assertEqual(status, 200, raw[:400])
        return json.loads(raw)

    def write_chapter(self, body: str) -> None:
        current = self.json_of("GET", f"/api/manuscript?world={self.world_id}")
        revision = current.get("revision", 0)
        self.json_of(
            "PUT",
            f"/api/manuscript?world={self.world_id}",
            {
                "contract": "quiltor.manuscript",
                "version": 1,
                "revision": revision,
                "payload": {
                    "chapters": [{"id": "chapter-1", "title": "Am Hafen", "body": body, "note": ""}]
                },
            },
            {"If-Match": f'"{revision}"'},
        )

    def keep_version(self, message: str) -> None:
        self.json_of("POST", "/api/backup", {"worldId": self.world_id, "message": message})

    def commits(self) -> list[dict]:
        return self.json_of("GET", f"/api/history?world={self.world_id}")["commits"]

    def documents(self) -> dict:
        # Revisions advance on a restore by design, so compare what the author wrote.
        return {
            route: self.json_of("GET", f"{route}?world={self.world_id}").get("payload")
            for route in DOCUMENTS
        }

    def restore(self, revision_id: str):
        return self.request(
            "POST", f"/api/history/restore?world={self.world_id}", {"id": revision_id}
        )

    def prepare_two_versions(self) -> tuple[str, dict]:
        self.write_chapter("Der Morgen lag still über dem Hafen.")
        self.keep_version("Erste Fassung")
        target = self.documents()
        target_id = self.commits()[0]["hash"]
        self.write_chapter("Am Abend war der Hafen voller Stimmen.")
        return target_id, target


class HistoryRestoreTest(_HistoryServer):
    def test_restoring_keeps_the_current_state_and_brings_the_version_back(self):
        target_id, target = self.prepare_two_versions()
        before = self.documents()

        status, _, raw = self.restore(target_id)

        self.assertEqual(status, 200, raw[:400])
        answer = json.loads(raw)
        self.assertEqual(answer["restored"], target_id)
        self.assertEqual(
            set(answer) - {"warnings"}, set(SCHEMA["$defs"]["restoreResponse"]["required"])
        )
        self.assertEqual(self.documents(), target)
        newest = self.commits()[0]
        self.assertEqual(newest["subject"], "Before restore")
        # The state the restore replaced is in that version, so the author can go back.
        self.assertEqual(self.restore(newest["hash"])[0], 200)
        self.assertEqual(self.documents(), before)

    def test_after_a_restore_an_editor_holding_the_old_revision_cannot_overwrite_it(self):
        target_id, target = self.prepare_two_versions()
        stale = {
            route: self.json_of("GET", f"{route}?world={self.world_id}")["revision"]
            for route in DOCUMENTS
        }

        self.assertEqual(self.restore(target_id)[0], 200)

        for route, revision in stale.items():
            with self.subTest(route=route):
                current = self.json_of("GET", f"{route}?world={self.world_id}")["revision"]
                self.assertGreater(current, revision)
        status, _, raw = self.request(
            "PUT",
            f"/api/manuscript?world={self.world_id}",
            {
                "contract": "quiltor.manuscript",
                "version": 1,
                "revision": stale["/api/manuscript"],
                "payload": {
                    "chapters": [
                        {"id": "chapter-1", "title": "Am Hafen", "body": "Veraltet.", "note": ""}
                    ]
                },
            },
            {"If-Match": f'"{stale["/api/manuscript"]}"'},
        )
        self.assertEqual(status, 409, raw[:400])
        self.assertEqual(self.documents(), target)

    def test_the_state_a_restore_replaced_is_kept_as_before_restore(self):
        target_id, _ = self.prepare_two_versions()
        self.assertEqual(self.restore(target_id)[0], 200)
        newest = self.commits()[0]
        self.assertEqual(newest["subject"], "Before restore")
        self.assertEqual(newest["kind"], "before-restore")
        # Labelled by the restore itself, not read back from its English name: the
        # fallback would report the same kind for an unlabelled entry.
        owner = SessionData(
            sub=config.LOCAL_OWNER, email="", name="", created_at=0.0, expires_at=0.0
        )
        context = self.application.resolve_world(owner, self.world_id).backup
        labels = [
            json.loads(line)
            for line in (context.root / "labels.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertIn({"id": newest["hash"], "kind": "before-restore"}, labels)

    def test_every_reported_kind_is_one_the_contract_knows(self):
        self.write_chapter("Der Morgen lag still über dem Hafen.")
        self.keep_version("Erste Fassung")
        kinds = {commit["subject"]: commit["kind"] for commit in self.commits()}
        self.assertEqual(kinds["Erste Fassung"], "manual")
        for kind in kinds.values():
            self.assertIn(kind, SCHEMA["$defs"]["commit"]["properties"]["kind"]["enum"])

    def test_an_unknown_id_is_a_404_and_changes_nothing(self):
        self.prepare_two_versions()
        before, count = self.documents(), len(self.commits())

        status, _, raw = self.restore("0" * 64)

        self.assertEqual(status, 404, raw[:400])
        self.assertEqual(json.loads(raw)["error"]["code"], "backup.snapshot_not_found")
        self.assertEqual(self.documents(), before)
        self.assertEqual(len(self.commits()), count)

    def test_a_request_without_an_id_is_refused(self):
        for body in ({}, {"id": ""}, {"id": 7}, []):
            with self.subTest(body=body):
                status, _, raw = self.request(
                    "POST", f"/api/history/restore?world={self.world_id}", body
                )
                self.assertEqual(status, 400, raw[:400])

    def test_a_missing_blob_leaves_the_world_as_it_was(self):
        target_id, _ = self.prepare_two_versions()
        before = self.documents()
        owner = SessionData(
            sub=config.LOCAL_OWNER, email="", name="", created_at=0.0, expires_at=0.0
        )
        context = self.application.resolve_world(owner, self.world_id).backup
        history = self.application.application.backups._history
        entries = {entry["id"]: entry for entry in history.entries(context)}
        # The restore's own "Before restore" commit writes back what the current
        # world needs; what only the old version held stays missing.
        removed = 0
        for digest in _manifest_digests(entries[target_id], context.root.name).values():
            blob = context.root / "blobs" / digest[:2] / digest[2:]
            if blob.exists():
                blob.unlink()
                removed += 1
        self.assertGreater(removed, 0)

        status, _, raw = self.restore(target_id)

        self.assertEqual(status, 409, raw[:400])
        self.assertEqual(json.loads(raw)["error"]["code"], "backup_content_integrity")
        self.assertEqual(self.documents(), before)


class HostedHistoryRestoreTest(_HistoryServer):
    def setUp(self):
        super().setUp()
        self.application.operation_profile = "hosted"

    def test_a_hosted_server_restores_its_own_history(self):
        target_id, target = self.prepare_two_versions()

        status, _, raw = self.restore(target_id)

        self.assertEqual(status, 200, raw[:400])
        self.assertEqual(self.documents(), target)
