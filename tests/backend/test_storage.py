import tempfile
import unittest
import sqlite3
from pathlib import Path

from backend.core import mirror, storage


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original = (
            storage.DATA,
            storage.DB,
            storage.BACKUPS,
            storage.WORLDS,
            storage.ACTIVE_WORLD_ID,
        )
        storage.DATA = root
        storage.DB = root / "test.sqlite3"
        storage.BACKUPS = root / "backups"
        storage.WORLDS = root / "worlds"
        storage.ACTIVE_WORLD_ID = ""

    def tearDown(self):
        storage.DATA, storage.DB, storage.BACKUPS, storage.WORLDS, storage.ACTIVE_WORLD_ID = (
            self.original
        )
        self.temp.cleanup()

    def test_managed_connection_closes_its_file_handle(self):
        storage.initialize()
        with storage.connection() as conn:
            self.assertEqual(conn.execute("SELECT 1").fetchone()[0], 1)

        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")
        storage.DB.unlink()
        self.assertFalse(storage.DB.exists())

    def test_sqlite_round_trips_unknown_fields(self):
        manuscript_input = {
            "chapters": [
                {
                    "id": "c1",
                    "title": "Eins",
                    "body": "Hallo Welt",
                    "note": "N",
                    "mood": "still",
                    "mentions": [
                        {
                            "id": "m1",
                            "elementId": "n1",
                            "from": 0,
                            "to": 5,
                            "surface": "Hallo",
                            "source": "helper",
                            "confidence": 1,
                        }
                    ],
                    "marks": [{"from": 6, "to": 10, "kind": "italic"}],
                }
            ],
            "words": [{"w": "Arcène", "d": "Ort"}],
            "zeichenAktiv": ["…"],
            "future": True,
        }
        figures_input = {
            "nodes": [
                {
                    "id": "n1",
                    "x": 1,
                    "y": 2,
                    "type": "person",
                    "name": "A",
                    "future": 7,
                    "important": True,
                    "pinned": True,
                    "diedMomentId": "t2",
                    "profile": {
                        "rolle": "Held",
                        "extra": [{"k": "Motiv", "v": "Heimkehr"}],
                        "future": "yes",
                    },
                },
                {"id": "n2", "x": 3, "y": 4, "type": "person", "name": "B"},
            ],
            "edges": [
                {
                    "id": "e1",
                    "from": "n1",
                    "to": "n2",
                    "label": "Freunde",
                    "versions": [{"momentId": "t2", "label": "Feinde", "active": True}],
                }
            ],
            "timeline": [
                {"id": "t1", "title": "Vorher"},
                {"id": "t2", "title": "Verrat", "date": "1420-03-12"},
            ],
            "presence": [
                {"id": "p1", "elementId": "n1", "placeId": "n2", "momentId": "t2"},
                {"id": "p0", "elementId": "n1", "placeId": "n2"},
            ],
            "canvasSize": {"w": 900, "h": 700},
            "future": "kept",
        }
        storage.initialize()
        storage.save_manuscript(manuscript_input)
        storage.save_figures(figures_input)
        manuscript = storage.load_manuscript()
        figures = storage.load_figures()
        self.assertEqual(manuscript["chapters"][0]["mood"], "still")
        self.assertEqual(manuscript["chapters"][0]["mentions"][0]["elementId"], "n1")
        mirror_dir = storage.DATA / "manuskript"
        mirror.mirror_text(manuscript["chapters"], mirror_dir)
        exported = next(mirror_dir.glob("*.md")).read_text(encoding="utf-8")
        # Der Kapiteltext bleibt in der Datenbank reine Prosa; erst der Markdown-Spiegel
        # schreibt die Auszeichnungsbereiche als Marker.
        self.assertEqual(manuscript["chapters"][0]["body"], "Hallo Welt")
        self.assertEqual(
            manuscript["chapters"][0]["marks"], [{"from": 6, "to": 10, "kind": "italic"}]
        )
        self.assertIn("Hallo *Welt*", exported)
        self.assertNotIn("elementId", exported)
        self.assertNotIn('"m1"', exported)
        self.assertTrue(manuscript["future"])
        self.assertEqual(manuscript["language"], "de-DE")
        self.assertEqual(manuscript["grammarMode"], "manual")
        self.assertEqual(figures["nodes"][0]["profile"]["extra"][0]["k"], "Motiv")
        self.assertEqual(figures["nodes"][0]["future"], 7)
        self.assertEqual(figures["nodes"][0]["diedMomentId"], "t2")
        self.assertTrue(figures["nodes"][0]["important"])
        self.assertTrue(figures["nodes"][0]["pinned"])
        self.assertEqual(figures["edges"][0]["versions"][0]["label"], "Feinde")
        self.assertEqual(figures["timeline"][1]["date"], "1420-03-12")
        self.assertEqual(figures["future"], "kept")
        presence_by_id = {entry["id"]: entry for entry in figures["presence"]}
        self.assertEqual(presence_by_id["p1"]["momentId"], "t2")
        self.assertNotIn("momentId", presence_by_id["p0"])
        with storage.connection() as conn:
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_rejecting_orphan_is_enforced_by_database(self):
        storage.initialize()
        state = {
            "nodes": [{"id": "n1", "x": 0, "y": 0, "name": "A"}],
            "edges": [{"id": "e1", "from": "missing", "to": "n1"}],
        }
        storage.save_figures(state)
        self.assertEqual(storage.load_figures()["edges"], [])

    def test_presence_entries_without_targets_are_dropped(self):
        storage.initialize()
        state = {
            "nodes": [
                {"id": "n1", "x": 0, "y": 0, "name": "A"},
                {"id": "n2", "x": 0, "y": 0, "name": "Ort"},
            ],
            "edges": [],
            "timeline": [{"id": "t1", "title": "Vorher"}],
            "presence": [
                {"id": "p1", "elementId": "n1", "placeId": "n2", "momentId": "t1"},
                {"id": "p2", "elementId": "missing", "placeId": "n2"},
                {"id": "p3", "elementId": "n1", "placeId": "missing"},
                {"id": "p4", "elementId": "n1", "placeId": "n2", "momentId": "missing-moment"},
            ],
        }
        storage.save_figures(state)
        self.assertEqual([entry["id"] for entry in storage.load_figures()["presence"]], ["p1"])

    def test_revision_conflicts_prevent_lost_updates(self):
        storage.initialize()
        state = {"chapters": [{"id": "c1", "title": "A", "body": "eins", "note": ""}]}
        first = storage.save_with_revision("manuscript", state, 0)
        self.assertEqual(first, 1)
        with self.assertRaises(storage.ConflictError):
            storage.save_with_revision(
                "manuscript",
                {**state, "chapters": [{**state["chapters"][0], "body": "veraltet"}]},
                0,
            )
        self.assertEqual(storage.load_manuscript()["chapters"][0]["body"], "eins")

    def test_backup_can_be_restored(self):
        storage.initialize()
        original = {"chapters": [{"id": "c1", "title": "A", "body": "Original", "note": ""}]}
        storage.save_with_revision("manuscript", original, 0)
        storage.backup_if_due()
        name = storage.list_backups()[0]["name"]
        changed = {"chapters": [{"id": "c1", "title": "A", "body": "Geändert", "note": ""}]}
        storage.save_with_revision("manuscript", changed, 1)
        storage.restore_backup(name)
        self.assertEqual(storage.load_manuscript()["chapters"][0]["body"], "Original")

    def test_worlds_are_created_and_activated_in_separate_databases(self):
        first = storage.create_world("Der letzte Garten", "https://backup.example.com")
        second = storage.create_world("Stadt aus Glas", "https://backup.example.com/glass")
        self.assertEqual(first["title"], "Der letzte Garten")
        storage.activate_world(first["id"])
        storage.save_manuscript(
            {"chapters": [{"id": "c1", "title": "Anfang", "body": "Neu", "note": ""}]}
        )
        self.assertEqual(storage.load_manuscript()["chapters"][0]["body"], "Neu")
        storage.activate_world(second["id"])
        self.assertEqual(len(storage.load_manuscript()["chapters"]), 1)
        self.assertEqual(storage.load_manuscript()["chapters"][0]["body"], "")

    def test_backup_endpoint_is_optional(self):
        local_only = storage.create_world("Nur lokal")
        self.assertEqual(local_only["backupUrl"], "")
        hosted = storage.create_world("Gehostet", "https://backup.example.com")
        self.assertEqual(hosted["backupUrl"], "https://backup.example.com")

    def test_plain_http_backup_endpoints_are_refused_except_on_loopback(self):
        """A backup carries the whole manuscript; a typo must not be what decides
        whether it crosses a network unencrypted."""
        with self.assertRaises(ValueError):
            storage.create_world("Unsicher", "http://backup.example.com")
        local = storage.create_world("Eigener Rechner", "http://127.0.0.1:9000")
        self.assertEqual(local["backupUrl"], "http://127.0.0.1:9000")

    def test_world_deletion_removes_local_data_but_not_other_worlds(self):
        doomed = storage.create_world("Delete me", "https://backup.example.com")
        survivor = storage.create_world("Keep me")
        backup = storage.DATA / "backups" / doomed["id"]
        history = storage.DATA / "history" / doomed["id"]
        backup.mkdir(parents=True)
        history.mkdir(parents=True)
        (backup / "snapshot.sqlite3").write_text("backup")
        (history / "index.jsonl").write_text("{}\n")

        storage.delete_world(doomed["id"])

        self.assertFalse((storage.WORLDS / f"{doomed['id']}.sqlite3").exists())
        self.assertFalse(backup.exists())
        self.assertFalse(history.exists())
        self.assertTrue((storage.WORLDS / f"{survivor['id']}.sqlite3").exists())
        self.assertEqual([world["title"] for world in storage.list_worlds()], ["Keep me"])

    def test_active_world_cannot_be_deleted(self):
        world = storage.create_world("Active")
        storage.activate_world(world["id"])
        with self.assertRaises(ValueError):
            storage.delete_world(world["id"])
        self.assertTrue((storage.WORLDS / f"{world['id']}.sqlite3").exists())

    def test_list_worlds_filters_by_owner_sub(self):
        mine = storage.create_world("Meine Welt", owner_sub="alice")
        storage.create_world("Fremde Welt", owner_sub="bob")
        self.assertEqual([w["id"] for w in storage.list_worlds(owner_sub="alice")], [mine["id"]])
        self.assertEqual(len(storage.list_worlds(owner_sub="carol")), 0)
        self.assertEqual(len(storage.list_worlds()), 2)

    def test_local_owner_is_the_empty_string(self):
        """Not an accident and not a placeholder to be tidied up later.

        Every ownership check in storage.py reads `if owner_sub is not None`, so
        the empty string is a perfectly ordinary owner that filters like any
        other. Rewriting one of those checks as `if owner_sub:` would silently
        turn the local single user into "no filtering at all" -- no error, no
        failing test, just every world visible to everyone. Pinning the value
        here makes the choice deliberate.
        """
        self.assertEqual(storage.LOCAL_OWNER, "")

    def test_local_owner_worlds_are_filtered_like_any_other_owner(self):
        mine = storage.create_world("Lokale Welt", owner_sub=storage.LOCAL_OWNER)
        theirs = storage.create_world("Fremde Welt", owner_sub="alice")
        listed = [w["id"] for w in storage.list_worlds(owner_sub=storage.LOCAL_OWNER)]
        self.assertEqual(listed, [mine["id"]])
        self.assertNotIn(theirs["id"], listed)
        self.assertEqual(storage.get_world_owner(mine["id"]), storage.LOCAL_OWNER)

    def test_create_world_stamps_owner_sub(self):
        world = storage.create_world("Welt", owner_sub="alice")
        self.assertEqual(storage.get_world_owner(world["id"]), "alice")

    def test_get_world_owner_is_empty_for_unowned_world(self):
        world = storage.create_world("Unclaimed")
        self.assertEqual(storage.get_world_owner(world["id"]), "")
        self.assertIsNone(storage.get_world_owner("0" * 32))

    def test_delete_world_rejects_non_owner(self):
        world = storage.create_world("Meine Welt", owner_sub="alice")
        with self.assertRaises(PermissionError):
            storage.delete_world(world["id"], owner_sub="bob")
        self.assertTrue((storage.WORLDS / f"{world['id']}.sqlite3").exists())
        storage.delete_world(world["id"], owner_sub="alice")
        self.assertFalse((storage.WORLDS / f"{world['id']}.sqlite3").exists())

    def test_explicit_db_path_is_isolated_from_the_global_active_world(self):
        world_a = storage.create_world("A")
        world_b = storage.create_world("B")
        path_a = storage.world_db_path(world_a["id"])
        path_b = storage.world_db_path(world_b["id"])
        storage.save_manuscript(
            {"chapters": [{"id": "c1", "title": "A", "body": "von A", "note": ""}]}, db_path=path_a
        )
        storage.save_manuscript(
            {"chapters": [{"id": "c1", "title": "B", "body": "von B", "note": ""}]}, db_path=path_b
        )
        # The global ACTIVE_WORLD_ID/DB never moved — explicit db_path fully bypassed it.
        self.assertEqual(storage.ACTIVE_WORLD_ID, "")
        self.assertEqual(storage.load_manuscript(db_path=path_a)["chapters"][0]["body"], "von A")
        self.assertEqual(storage.load_manuscript(db_path=path_b)["chapters"][0]["body"], "von B")

    def test_explicit_backups_dir_is_isolated_per_world(self):
        world_a = storage.create_world("A")
        world_b = storage.create_world("B")
        path_a, backups_a = (
            storage.world_db_path(world_a["id"]),
            storage.DATA / "backups" / world_a["id"],
        )
        path_b, backups_b = (
            storage.world_db_path(world_b["id"]),
            storage.DATA / "backups" / world_b["id"],
        )
        storage.backup_if_due(force=True, db_path=path_a, backups_dir=backups_a)
        storage.backup_if_due(force=True, db_path=path_b, backups_dir=backups_b)
        self.assertEqual(len(storage.list_backups(backups_dir=backups_a)), 1)
        self.assertEqual(len(storage.list_backups(backups_dir=backups_b)), 1)
        self.assertNotEqual(
            storage.list_backups(backups_dir=backups_a)[0]["name"],
            storage.list_backups(backups_dir=backups_b)[0]["name"],
        )


if __name__ == "__main__":
    unittest.main()
