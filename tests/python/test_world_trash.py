from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.sqlite import manuscript, revisions, world_catalog
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths
from quiltor.infrastructure.persistence.sqlite.connection import connection


class WorldTrashTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.paths = SQLitePaths.from_data_directory(Path(self.temp.name))
        self.worlds = SQLiteWorldRepository(self.paths)
        self.worlds.prepare()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def create(self, owner: str = "alice"):
        return self.worlds.create("Archive", "", owner)

    def test_trash_is_owner_scoped_persistent_and_hidden_from_open(self):
        mine = self.create()
        theirs = self.create("bob")

        self.worlds.delete(mine.id, "alice")
        reopened_repository = SQLiteWorldRepository(self.paths)

        self.assertEqual(reopened_repository.list("alice"), [])
        self.assertEqual([world.id for world in reopened_repository.list("bob")], [theirs.id])
        trashed = reopened_repository.list_trash("alice")
        self.assertEqual([world.id for world in trashed], [mine.id])
        self.assertTrue(trashed[0].deleted_at)
        self.assertEqual(reopened_repository.list_trash("bob"), [])
        with self.assertRaises(FileNotFoundError):
            reopened_repository.open(mine.id, "alice")
        with self.assertRaises(PermissionError):
            reopened_repository.restore(mine.id, "bob")

    def test_restore_preserves_id_database_history_backups_and_mirrors(self):
        world = self.create()
        database = self.paths.worlds / f"{world.id}.sqlite3"
        resources = [
            self.paths.backups / world.id / "backup.txt",
            self.paths.data / "history" / world.id / "history.txt",
            self.paths.data / "manuscripts" / world.id / "manuscript.txt",
            self.paths.data / "profiles" / world.id / "profile.txt",
        ]
        for resource in resources:
            resource.parent.mkdir(parents=True, exist_ok=True)
            resource.write_text(resource.name, encoding="utf-8")
        with connection(database) as opened:
            opened.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('trash_test_sentinel','present')"
            )
        revisions_before = {
            kind: revisions.revision(kind, db_path=database)
            for kind in ("manuscript", "figures", "storyboards")
        }

        self.worlds.delete(world.id, "alice")
        self.worlds.restore(world.id, "alice")

        restored = self.worlds.open(world.id, "alice")
        self.assertEqual(restored.summary.id, world.id)
        with connection(database) as opened:
            sentinel = opened.execute(
                "SELECT value FROM meta WHERE key='trash_test_sentinel'"
            ).fetchone()
        self.assertEqual(sentinel[0], "present")
        self.assertEqual(
            {
                kind: revisions.revision(kind, db_path=database)
                for kind in ("manuscript", "figures", "storyboards")
            },
            {kind: value + 2 for kind, value in revisions_before.items()},
        )
        with self.assertRaises(revisions.ConflictError):
            revisions.save_with_revision(
                "manuscript",
                manuscript.load(db_path=database),
                revisions_before["manuscript"],
                database,
            )
        self.assertTrue(all(resource.exists() for resource in resources))
        self.assertEqual(self.worlds.list_trash("alice"), [])

    def test_purge_is_permanent_and_only_accepts_trashed_worlds(self):
        world = self.create()
        database = self.paths.worlds / f"{world.id}.sqlite3"
        resources = [
            self.paths.backups / world.id / "backup.txt",
            self.paths.data / "history" / world.id / "history.txt",
            self.paths.data / "manuscripts" / world.id / "manuscript.txt",
            self.paths.data / "profiles" / world.id / "profile.txt",
        ]
        for resource in resources:
            resource.parent.mkdir(parents=True, exist_ok=True)
            resource.write_text("kept until purge", encoding="utf-8")

        with self.assertRaises(ValueError):
            self.worlds.purge(world.id, "alice")
        self.assertTrue(database.exists())

        self.worlds.delete(world.id, "alice")
        self.worlds.purge(world.id, "alice")

        self.assertFalse(database.exists())
        self.assertTrue(all(not resource.exists() for resource in resources))
        with self.assertRaises(FileNotFoundError):
            self.worlds.restore(world.id, "alice")

    def test_lifecycle_and_revision_changes_roll_back_together(self):
        world = self.create()
        database = self.paths.worlds / f"{world.id}.sqlite3"
        kinds = ("manuscript", "figures", "storyboards")
        before_delete = {kind: revisions.revision(kind, db_path=database) for kind in kinds}

        with (
            patch.object(
                world_catalog,
                "_advance_document_revisions",
                side_effect=RuntimeError("injected revision failure"),
            ),
            self.assertRaisesRegex(RuntimeError, "injected revision failure"),
        ):
            self.worlds.delete(world.id, "alice")

        self.assertEqual([listed.id for listed in self.worlds.list("alice")], [world.id])
        self.assertEqual(
            {kind: revisions.revision(kind, db_path=database) for kind in kinds},
            before_delete,
        )

        self.worlds.delete(world.id, "alice")
        before_restore = {kind: revisions.revision(kind, db_path=database) for kind in kinds}
        with (
            patch.object(
                world_catalog,
                "_advance_document_revisions",
                side_effect=RuntimeError("injected revision failure"),
            ),
            self.assertRaisesRegex(RuntimeError, "injected revision failure"),
        ):
            self.worlds.restore(world.id, "alice")

        self.assertEqual([listed.id for listed in self.worlds.list_trash("alice")], [world.id])
        self.assertEqual(
            {kind: revisions.revision(kind, db_path=database) for kind in kinds},
            before_restore,
        )

    def test_purge_removes_only_validated_migration_copies_for_its_world(self):
        world = self.create()
        neighbor = self.create()
        stamp = "20260919-101112-123456"
        own_copy = self.paths.worlds / f"{world.id}.pre-migration-v7-{stamp}.sqlite3"
        own_sidecars = [Path(f"{own_copy}-wal"), Path(f"{own_copy}-shm")]
        preserved = [
            self.paths.worlds / f"{neighbor.id}.pre-migration-v7-{stamp}.sqlite3",
            self.paths.worlds / f"{world.id}.pre-migration-v7-invalid.sqlite3",
            self.paths.worlds / f"{world.id}.pre-migration-v7-{stamp}.sqlite3.notes",
        ]
        for candidate in [own_copy, *own_sidecars, *preserved]:
            candidate.write_text("safety copy", encoding="utf-8")

        self.worlds.delete(world.id, "alice")
        self.worlds.purge(world.id, "alice")

        self.assertFalse(own_copy.exists())
        self.assertTrue(all(not sidecar.exists() for sidecar in own_sidecars))
        self.assertTrue(all(candidate.exists() for candidate in preserved))

    def test_commands_reject_invalid_ids_wrong_owners_and_invalid_states(self):
        world = self.create()
        for command in (self.worlds.delete, self.worlds.restore, self.worlds.purge):
            with self.subTest(command=command.__name__), self.assertRaises(ValueError):
                command("../not-a-world", "alice")

        with self.assertRaises(ValueError):
            self.worlds.restore(world.id, "alice")
        self.worlds.delete(world.id, "alice")
        with self.assertRaises(PermissionError):
            self.worlds.restore(world.id, "bob")
        with self.assertRaises(PermissionError):
            self.worlds.purge(world.id, "bob")


if __name__ == "__main__":
    unittest.main()
