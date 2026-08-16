"""The upload protocol, exercised end to end: backend/backup/remote.py talking to
the reference endpoint in deploy/backup-server/ over a real socket.

Testing the two against each other is the point. Either alone could drift into a
private interpretation of the protocol and still pass; together they pin the thing
a self-hoster actually has to reimplement.
"""
import importlib.util
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.core.backup import SnapshotStore
from backend.core.backup import remote

REFERENCE_SERVER = Path(__file__).resolve().parents[2] / "deploy" / "backup-server" / "server.py"

TOKEN = "test-token"
ACCOUNT = "tester"


def _load_reference_server(root: Path):
    """Imported by path: deploy/ is deliberately not a package, since nothing in
    backend/ may depend on the server implementation."""
    os.environ["QUILTOR_BACKUP_ROOT"] = str(root)
    os.environ["QUILTOR_BACKUP_TOKENS"] = f"{ACCOUNT}:{TOKEN}"
    spec = importlib.util.spec_from_file_location("quiltor_backup_reference", REFERENCE_SERVER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = root
    return module


class BackupProtocolTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.served = self.root / "served"
        self.reference = _load_reference_server(self.served)

        self.httpd = self.reference.Server(("127.0.0.1", 0), self.reference.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f"http://127.0.0.1:{self.port}"

        self.store = SnapshotStore(self.root / "history")
        self._token_patch = patch.dict(os.environ, {"QUILTOR_BACKUP_TOKEN": TOKEN})
        self._token_patch.start()

    def tearDown(self):
        self._token_patch.stop()
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def _world(self, world_id="world-a", endpoint=None):
        database = self.root / f"{world_id}.sqlite3"
        manuscripts = self.root / "manuscripts" / world_id
        profiles = self.root / "profiles" / world_id
        manuscripts.mkdir(parents=True)
        profiles.mkdir(parents=True)
        sqlite3.connect(database).close()
        return self.store.context(world_id, self.endpoint if endpoint is None else endpoint,
                                  database, manuscripts, profiles)

    def _stored(self, world="world-a", kind="blobs"):
        directory = self.served / ACCOUNT / world / kind
        return sorted(p.name for p in directory.iterdir()) if directory.exists() else []

    def test_commit_with_push_uploads_blobs_and_the_manifest(self):
        ctx = self._world()
        (ctx.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nText.\n", encoding="utf-8")
        result = self.store.commit(ctx, "Erster Stand", push=True)

        self.assertTrue(result["ok"], result.get("grund"))
        self.assertIn("Snapshot uploaded to the backup endpoint.", result["log"])

        entry = self.store.entries(ctx)[-1]
        self.assertEqual(set(self._stored()), set(entry["files"].values()))
        self.assertEqual(self._stored(kind="snapshots"), [f"{entry['id']}.json"])

    def test_uploaded_snapshots_are_readable_back(self):
        ctx = self._world()
        (ctx.manuscripts / "01 - Kapitel.md").write_text("Der Sturm.\n", encoding="utf-8")
        self.store.commit(ctx, "Erster Stand", push=True)

        manifests = remote.snapshots(ctx)
        self.assertEqual(len(manifests), 1)
        self.assertEqual(manifests[0]["message"], "Erster Stand")
        digest = manifests[0]["files"]["manuscripts/01 - Kapitel.md"]
        self.assertEqual(remote.fetch_blob(ctx, digest).decode(), "Der Sturm.\n")

    def test_unchanged_blobs_are_not_re_uploaded(self):
        """A second backup must not re-send a multi-megabyte database that has not
        changed -- that is the difference between a usable backup over a slow link
        and an unusable one."""
        ctx = self._world()
        (ctx.manuscripts / "01 - Eins.md").write_text("unveraendert\n", encoding="utf-8")
        (ctx.manuscripts / "02 - Zwei.md").write_text("erste fassung\n", encoding="utf-8")
        self.store.commit(ctx, "eins", push=True)

        (ctx.manuscripts / "02 - Zwei.md").write_text("zweite fassung\n", encoding="utf-8")
        with patch.object(remote, "_request", wraps=remote._request) as spy:
            self.store.commit(ctx, "zwei", push=True)
        uploaded = [call.args[1] for call in spy.call_args_list if call.args[0] == "PUT" and "/blobs/" in call.args[1]]

        unchanged = self.store.entries(ctx)[0]["files"]["manuscripts/01 - Eins.md"]
        self.assertFalse([url for url in uploaded if unchanged in url],
                         "an unchanged file was uploaded a second time")

    def test_a_wrong_token_is_rejected(self):
        ctx = self._world()
        (ctx.manuscripts / "01 - Kapitel.md").write_text("Text.\n", encoding="utf-8")
        with patch.dict(os.environ, {"QUILTOR_BACKUP_TOKEN": "wrong"}):
            result = self.store.commit(ctx, "eins", push=True)
        self.assertFalse(result["ok"])
        self.assertIn("401", result["grund"])
        self.assertEqual(self._stored(), [])

    def test_an_unreachable_endpoint_reports_clearly_and_keeps_local_history(self):
        ctx = self._world(endpoint="http://127.0.0.1:1")
        (ctx.manuscripts / "01 - Kapitel.md").write_text("Text.\n", encoding="utf-8")
        result = self.store.commit(ctx, "eins", push=True)

        self.assertFalse(result["ok"])
        self.assertIn("unreachable", result["grund"])
        self.assertEqual(len(self.store.history(ctx)), 1, "local history must survive a failed upload")

    def test_the_server_refuses_content_that_does_not_match_its_digest(self):
        """Content addressing is only a guarantee if the server enforces it."""
        ctx = self._world()
        fake = "0" * 64
        with self.assertRaises(RuntimeError) as caught:
            remote._request("PUT", f"{self.endpoint}/v1/worlds/world-a/blobs/{fake}",
                            b"not the content that hashes to zeros", "application/octet-stream", 10)
        self.assertIn("400", str(caught.exception))

    def test_the_server_refuses_a_manifest_whose_blobs_are_missing(self):
        """Keeps the store consistent: a manifest is a promise its content can be
        retrieved, so it may only land after the blobs it names."""
        ctx = self._world()
        manifest = json.dumps({"id": "abc", "created": "2026-01-01T00:00:00",
                               "files": {"manuscripts/01 - X.md": "a" * 64}}).encode()
        with self.assertRaises(RuntimeError) as caught:
            remote._request("PUT", f"{self.endpoint}/v1/worlds/world-a/snapshots/abc",
                            manifest, "application/json", 10)
        self.assertIn("409", str(caught.exception))

    def test_worlds_are_stored_separately_at_the_endpoint(self):
        for world_id, text in (("world-a", "Welt A.\n"), ("world-b", "Welt B.\n")):
            ctx = self._world(world_id)
            (ctx.manuscripts / "01 - Kapitel.md").write_text(text, encoding="utf-8")
            self.store.commit(ctx, world_id, push=True)
        self.assertEqual(len(self._stored("world-a", "snapshots")), 1)
        self.assertEqual(len(self._stored("world-b", "snapshots")), 1)


if __name__ == "__main__":
    unittest.main()
