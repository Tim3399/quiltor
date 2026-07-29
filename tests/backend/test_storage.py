import tempfile
import unittest
from pathlib import Path

from backend import storage


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original = (storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID)
        storage.DATA = root
        storage.DB = root / "test.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""

    def tearDown(self):
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = self.original
        self.temp.cleanup()

    def test_sqlite_round_trips_unknown_fields(self):
        manuscript_input = {
            "chapters": [{"id": "c1", "title": "Eins", "body": "Hallo Welt", "note": "N", "mood": "still"}],
            "words": [{"w": "Arcène", "d": "Ort"}], "zeichenAktiv": ["…"], "future": True,
        }
        figures_input = {
            "nodes": [{"id": "n1", "x": 1, "y": 2, "type": "person", "name": "A", "future": 7,
                       "profile": {"rolle": "Held", "extra": [{"k": "Motiv", "v": "Heimkehr"}], "future": "yes"}}],
            "edges": [], "canvasSize": {"w": 900, "h": 700}, "future": "kept",
        }
        storage.initialize()
        storage.save_manuscript(manuscript_input)
        storage.save_figures(figures_input)
        manuscript = storage.load_manuscript(); figures = storage.load_figures()
        self.assertEqual(manuscript["chapters"][0]["mood"], "still")
        self.assertTrue(manuscript["future"])
        self.assertEqual(figures["nodes"][0]["profile"]["extra"][0]["k"], "Motiv")
        self.assertEqual(figures["nodes"][0]["future"], 7)
        self.assertEqual(figures["future"], "kept")
        self.assertEqual(storage.connect().execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_rejecting_orphan_is_enforced_by_database(self):
        storage.initialize()
        state = {"nodes": [{"id": "n1", "x": 0, "y": 0, "name": "A"}],
                 "edges": [{"id": "e1", "from": "missing", "to": "n1"}]}
        storage.save_figures(state)
        self.assertEqual(storage.load_figures()["edges"], [])

    def test_revision_conflicts_prevent_lost_updates(self):
        storage.initialize()
        state = {"chapters": [{"id": "c1", "title": "A", "body": "eins", "note": ""}]}
        first = storage.save_with_revision("manuscript", state, 0)
        self.assertEqual(first, 1)
        with self.assertRaises(storage.ConflictError):
            storage.save_with_revision("manuscript", {**state, "chapters": [{**state["chapters"][0], "body": "veraltet"}]}, 0)
        self.assertEqual(storage.load_manuscript()["chapters"][0]["body"], "eins")

    def test_backup_can_be_restored(self):
        storage.initialize()
        original = {"chapters": [{"id": "c1", "title": "A", "body": "Original", "note": ""}]}
        storage.save_with_revision("manuscript", original, 0)
        storage.backup_if_due(); name = storage.list_backups()[0]["name"]
        changed = {"chapters": [{"id": "c1", "title": "A", "body": "Geändert", "note": ""}]}
        storage.save_with_revision("manuscript", changed, 1)
        storage.restore_backup(name)
        self.assertEqual(storage.load_manuscript()["chapters"][0]["body"], "Original")

    def test_worlds_are_created_and_activated_in_separate_databases(self):
        first = storage.create_world("Der letzte Garten", "https://github.com/example/garden")
        second = storage.create_world("Stadt aus Glas", "https://github.com/example/glass-city.git")
        self.assertEqual(first["title"], "Der letzte Garten")
        storage.activate_world(first["id"])
        storage.save_manuscript({"chapters": [{"id": "c1", "title": "Anfang", "body": "Neu", "note": ""}]})
        self.assertEqual(storage.load_manuscript()["chapters"][0]["body"], "Neu")
        storage.activate_world(second["id"])
        self.assertEqual(len(storage.load_manuscript()["chapters"]), 1)
        self.assertEqual(storage.load_manuscript()["chapters"][0]["body"], "")

    def test_git_remote_is_optional_and_provider_neutral(self):
        local_only = storage.create_world("Nur lokal")
        self.assertEqual(local_only["gitUrl"], "")
        gitlab = storage.create_world("GitLab", "https://gitlab.com/example/world.git")
        gitea = storage.create_world("Gitea", "git@git.example.org:author/world.git")
        self.assertEqual(gitlab["gitUrl"], "https://gitlab.com/example/world.git")
        self.assertEqual(gitea["gitUrl"], "git@git.example.org:author/world.git")

    def test_world_deletion_removes_local_data_but_not_other_worlds(self):
        doomed = storage.create_world("Delete me", "https://gitlab.com/example/remote.git")
        survivor = storage.create_world("Keep me")
        backup = storage.DATA / "backups" / doomed["id"]
        repository = storage.DATA / "repositories" / doomed["id"]
        backup.mkdir(parents=True)
        repository.mkdir(parents=True)
        (backup / "snapshot.sqlite3").write_text("backup")
        (repository / "README.md").write_text("local checkout")

        storage.delete_world(doomed["id"])

        self.assertFalse((storage.WORLDS / f"{doomed['id']}.sqlite3").exists())
        self.assertFalse(backup.exists())
        self.assertFalse(repository.exists())
        self.assertTrue((storage.WORLDS / f"{survivor['id']}.sqlite3").exists())
        self.assertEqual([world["title"] for world in storage.list_worlds()], ["Keep me"])

    def test_active_world_cannot_be_deleted(self):
        world = storage.create_world("Active")
        storage.activate_world(world["id"])
        with self.assertRaises(ValueError):
            storage.delete_world(world["id"])
        self.assertTrue((storage.WORLDS / f"{world['id']}.sqlite3").exists())

if __name__ == "__main__":
    unittest.main()
