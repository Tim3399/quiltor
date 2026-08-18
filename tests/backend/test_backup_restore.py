"""Restoring a world from the backup endpoint, against the reference server.

The case that matters is a machine that has never seen the world: no local
history, no blobs, and no per-world endpoint setting to read. Everything has to
come from QUILTOR_BACKUP_URL and the endpoint itself.
"""

import importlib.util
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.core.backup import SnapshotStore, remote
from fake_issuer import FakeIssuer

REFERENCE_SERVER = Path(__file__).resolve().parents[2] / "deploy" / "backup-server" / "server.py"
# ACCOUNT is the token's subject, which the endpoint reads off the token rather
# than taking from the request -- see deploy/backup-server/server.py::_account.
TOKEN, ACCOUNT = "test-token", "tester"


def _load_reference_server(root: Path, issuer_url: str):
    os.environ["QUILTOR_BACKUP_ROOT"] = str(root)
    spec = importlib.util.spec_from_file_location(
        "quiltor_backup_reference_restore", REFERENCE_SERVER
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = root
    module.ISSUER = issuer_url
    module.CLIENT_ID = "quiltor-backup"
    module.CLIENT_SECRET = "shhh"
    module.PUBLIC_URL = "https://backup.example.test"
    module._discovery.clear()
    module._tokens.clear()
    return module


class RestoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.issuer = FakeIssuer().start()
        self.issuer.issue(TOKEN, sub=ACCOUNT)
        self.reference = _load_reference_server(self.root / "served", self.issuer.url)
        self.httpd = self.reference.Server(("127.0.0.1", 0), self.reference.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self._env = patch.dict(
            os.environ, {"QUILTOR_BACKUP_TOKEN": TOKEN, "QUILTOR_BACKUP_URL": self.endpoint}
        )
        self._env.start()

    def tearDown(self):
        self._env.stop()
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.issuer.stop()
        self.temp.cleanup()

    def _machine(self, name: str):
        """An independent machine: its own history store and world files."""
        home = self.root / name
        store = SnapshotStore(home / "history")
        return store, home

    def _world(self, store, home, world_id="world-a", title="Der Sturm"):
        database = home / "worlds" / f"{world_id}.sqlite3"
        database.parent.mkdir(parents=True, exist_ok=True)
        manuscripts, profiles = home / "manuscripts" / world_id, home / "profiles" / world_id
        manuscripts.mkdir(parents=True, exist_ok=True)
        profiles.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(database)
        conn.execute("CREATE TABLE IF NOT EXISTS note(text TEXT)")
        conn.commit()
        conn.close()
        return store.context(world_id, "", database, manuscripts, profiles, title=title)

    def _seed_and_upload(self):
        """Machine A writes a world and backs it up."""
        store, home = self._machine("machine-a")
        ctx = self._world(store, home)
        (ctx.manuscripts / "01 - Kapitel.md").write_text(
            "Der Sturm kam schnell.\n", encoding="utf-8"
        )
        conn = sqlite3.connect(ctx.database)
        conn.execute("INSERT INTO note VALUES('original')")
        conn.commit()
        conn.close()
        result = store.commit(ctx, "Erster Stand", push=True)
        self.assertTrue(result["ok"], result.get("grund"))
        return store, ctx

    # ------------------------------------------------------------- discovery

    def test_endpoint_lists_worlds_with_their_titles(self):
        """A fresh install has only hex ids to go on unless the manifest carries
        the title, which would make the restore picker unusable."""
        self._seed_and_upload()
        found = remote.worlds(self.endpoint)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["id"], "world-a")
        self.assertEqual(found[0]["title"], "Der Sturm")
        self.assertEqual(found[0]["snapshots"], 1)

    def test_a_world_never_backed_up_is_not_listed(self):
        store, home = self._machine("machine-a")
        ctx = self._world(store, home)
        (ctx.manuscripts / "01 - Kapitel.md").write_text("nur lokal\n", encoding="utf-8")
        store.commit(ctx, "lokal", push=False)
        self.assertEqual(remote.worlds(self.endpoint), [])

    def test_a_world_without_its_own_endpoint_falls_back_to_the_account_one(self):
        store, home = self._machine("machine-a")
        ctx = self._world(store, home)  # created with endpoint_url=""
        self.assertEqual(ctx.endpoint_url, self.endpoint)

    # --------------------------------------------------------------- restore

    def test_restoring_onto_a_machine_that_has_never_seen_the_world(self):
        self._seed_and_upload()

        store_b, home_b = self._machine("machine-b")
        ctx_b = self._world(store_b, home_b)
        self.assertEqual(store_b.entries(ctx_b), [], "machine B starts with no history")

        entry = remote.snapshots(ctx_b)[-1]
        store_b.restore(ctx_b, entry, fetch=lambda digest: remote.fetch_blob(ctx_b, digest))

        self.assertEqual(
            (ctx_b.manuscripts / "01 - Kapitel.md").read_text(encoding="utf-8"),
            "Der Sturm kam schnell.\n",
        )
        conn = sqlite3.connect(ctx_b.database)
        self.assertEqual(conn.execute("SELECT text FROM note").fetchone()[0], "original")
        conn.close()

    def test_a_restored_world_carries_the_snapshot_in_its_local_history(self):
        _, ctx_a = self._seed_and_upload()
        store_b, home_b = self._machine("machine-b")
        ctx_b = self._world(store_b, home_b)
        entry = remote.snapshots(ctx_b)[-1]
        store_b.restore(ctx_b, entry, fetch=lambda digest: remote.fetch_blob(ctx_b, digest))

        history = store_b.history(ctx_b)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["betreff"], "Erster Stand")

    def test_restoring_twice_does_not_duplicate_the_history_entry(self):
        self._seed_and_upload()
        store_b, home_b = self._machine("machine-b")
        ctx_b = self._world(store_b, home_b)
        entry = remote.snapshots(ctx_b)[-1]
        for _ in range(2):
            store_b.restore(ctx_b, entry, fetch=lambda digest: remote.fetch_blob(ctx_b, digest))
        self.assertEqual(len(store_b.history(ctx_b)), 1)

    def test_restore_removes_files_the_snapshot_does_not_contain(self):
        """Otherwise a chapter deleted before the backup would quietly come back."""
        self._seed_and_upload()
        store_b, home_b = self._machine("machine-b")
        ctx_b = self._world(store_b, home_b)
        stray = ctx_b.manuscripts / "02 - Fremd.md"
        stray.write_text("gehoert nicht dazu\n", encoding="utf-8")

        entry = remote.snapshots(ctx_b)[-1]
        store_b.restore(ctx_b, entry, fetch=lambda digest: remote.fetch_blob(ctx_b, digest))
        self.assertFalse(stray.exists())

    def test_restore_clears_a_stale_write_ahead_log(self):
        """A leftover -wal would be replayed on top of the database we just wrote,
        silently reviving the state we were replacing."""
        self._seed_and_upload()
        store_b, home_b = self._machine("machine-b")
        ctx_b = self._world(store_b, home_b)
        wal = Path(f"{ctx_b.database}-wal")
        wal.write_bytes(b"stale")

        entry = remote.snapshots(ctx_b)[-1]
        store_b.restore(ctx_b, entry, fetch=lambda digest: remote.fetch_blob(ctx_b, digest))
        self.assertFalse(wal.exists())

    def test_nothing_is_overwritten_when_a_blob_cannot_be_fetched(self):
        """A restore that dies halfway would otherwise leave the world as a mix of
        two states, which is worse than either one."""
        self._seed_and_upload()
        store_b, home_b = self._machine("machine-b")
        ctx_b = self._world(store_b, home_b)
        (ctx_b.manuscripts / "01 - Kapitel.md").write_text("unangetastet\n", encoding="utf-8")

        entry = remote.snapshots(ctx_b)[-1]
        with self.assertRaises(RuntimeError):
            store_b.restore(
                ctx_b,
                entry,
                fetch=lambda digest: (_ for _ in ()).throw(RuntimeError("network died")),
            )
        self.assertEqual(
            (ctx_b.manuscripts / "01 - Kapitel.md").read_text(encoding="utf-8"), "unangetastet\n"
        )

    def test_local_rollback_needs_no_endpoint_at_all(self):
        """restore() defaults to local blobs, so going back to an earlier snapshot
        on the same machine never touches the network."""
        store, home = self._machine("machine-a")
        ctx = self._world(store, home)
        (ctx.manuscripts / "01 - Kapitel.md").write_text("alt\n", encoding="utf-8")
        store.commit(ctx, "alt", push=False)
        first = store.entries(ctx)[-1]
        (ctx.manuscripts / "01 - Kapitel.md").write_text("neu\n", encoding="utf-8")
        store.commit(ctx, "neu", push=False)

        store.restore(ctx, first)
        self.assertEqual((ctx.manuscripts / "01 - Kapitel.md").read_text(encoding="utf-8"), "alt\n")


if __name__ == "__main__":
    unittest.main()
