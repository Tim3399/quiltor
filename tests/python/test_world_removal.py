"""Removing a world while something else still holds its files (T-214, D-T-214-5e).

On Windows a file another handle has open cannot be unlinked, and a database that is being
removed can be seen half-way. Both used to come out of the API as 403 "belongs to a different
account": the cleanup after a preview (the page's `discard-preview` beacon racing the test's
`delete`) failed with it, and left an empty database file behind.
"""

from __future__ import annotations

import errno
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quiltor.delivery.http.errors import from_exception
from quiltor.infrastructure.persistence.sqlite import world_catalog
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths

_REAL_UNLINK = Path.unlink


class WorldRemovalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = SQLitePaths.from_data_directory(Path(self.temp.name))
        self.owner = "sub-ada"

    def _preview(self) -> str:
        world = world_catalog.create_world(
            "Atlas", "", owner_sub=self.owner, paths=self.paths, preview=True
        )
        return world["id"]

    def _database(self, world_id: str) -> Path:
        return world_catalog.world_db_path(world_id, paths=self.paths)

    def _files(self, world_id: str) -> list[Path]:
        return sorted(self.paths.worlds.glob(f"{world_id}.sqlite3*"))

    def _held(self, fail_times: int | None):
        """Path.unlink as Windows has it while a handle is open: it refuses `fail_times` times
        per file (always when None), then lets go."""

        refused: dict[Path, int] = {}

        def unlink(path: Path, missing_ok: bool = False) -> None:
            if path.name.endswith((".sqlite3", ".sqlite3-wal", ".sqlite3-shm")):
                count = refused.get(path, 0)
                if fail_times is None or count < fail_times:
                    refused[path] = count + 1
                    raise PermissionError(13, "The process cannot access the file")
            _REAL_UNLINK(path, missing_ok=missing_ok)

        return patch.object(Path, "unlink", unlink)

    def test_a_file_held_for_a_moment_is_removed_after_a_retry(self):
        world_id = self._preview()
        with self._held(2), patch("time.sleep"):
            world_catalog.delete_world(world_id, self.owner, paths=self.paths)
        self.assertEqual(self._files(world_id), [])

    def test_a_file_held_for_good_is_busy_not_a_foreign_owner(self):
        world_id = self._preview()
        with self._held(None), patch("time.sleep"):
            with self.assertRaises(OSError) as raised:
                world_catalog.delete_world(world_id, self.owner, paths=self.paths)
        error = raised.exception
        self.assertNotIsInstance(error, PermissionError)
        self.assertEqual(error.errno, errno.EBUSY)
        mapped = from_exception(error)
        self.assertEqual((mapped.status, mapped.code), (503, "storage.locked"))

    def test_discarding_and_purging_retry_too(self):
        discarded = self._preview()
        with self._held(1), patch("time.sleep"):
            world_catalog.discard_preview_world(discarded, self.owner, paths=self.paths)
        self.assertEqual(self._files(discarded), [])

        trashed = world_catalog.create_world("Nord", "", owner_sub=self.owner, paths=self.paths)
        world_catalog.delete_world(trashed["id"], self.owner, paths=self.paths)
        with self._held(1), patch("time.sleep"):
            world_catalog.purge_world(trashed["id"], self.owner, paths=self.paths)
        self.assertEqual(self._files(trashed["id"]), [])

    def test_a_preview_discarded_meanwhile_is_not_found_rather_than_forbidden(self):
        world_id = self._preview()
        world_catalog.discard_preview_world(world_id, self.owner, paths=self.paths)
        for action in (
            world_catalog.delete_world,
            world_catalog.purge_world,
            world_catalog.discard_preview_world,
        ):
            with self.subTest(action=action.__name__):
                with self.assertRaises(FileNotFoundError):
                    action(world_id, self.owner, paths=self.paths)
        self.assertEqual(self._files(world_id), [])

    def test_a_database_seen_half_removed_is_not_found_and_not_recreated(self):
        # The file was there when `exists()` looked and gone when the owner was read: reading
        # it must not make an empty database in its place (that was the orphan left behind).
        world_id = self._preview()
        path = self._database(world_id)
        world_catalog.discard_preview_world(world_id, self.owner, paths=self.paths)
        with patch.object(Path, "exists", return_value=True):
            self.assertIsNone(world_catalog.get_world_owner(world_id, paths=self.paths))
            for action in (
                world_catalog.delete_world,
                world_catalog.purge_world,
                world_catalog.discard_preview_world,
            ):
                with self.subTest(action=action.__name__):
                    with self.assertRaises(FileNotFoundError):
                        action(world_id, self.owner, paths=self.paths)
        self.assertFalse(_REAL_EXISTS(path))

    def test_a_file_without_a_world_in_it_has_no_owner(self):
        world_id = "a" * 32
        sqlite3.connect(self._database_in_new_dir(world_id)).close()
        self.assertIsNone(world_catalog.get_world_owner(world_id, paths=self.paths))
        with self.assertRaises(FileNotFoundError):
            world_catalog.delete_world(world_id, self.owner, paths=self.paths)

    def test_an_unreadable_world_is_an_error_not_somebody_elses(self):
        world_id = "b" * 32
        self._database_in_new_dir(world_id).write_bytes(b"this is not a database" * 400)
        with self.assertRaises(sqlite3.DatabaseError):
            world_catalog.get_world_owner(world_id, paths=self.paths)
        with self.assertRaises(sqlite3.DatabaseError):
            world_catalog.delete_world(world_id, self.owner, paths=self.paths)

    def test_the_owner_is_still_checked(self):
        world_id = self._preview()
        self.assertEqual(world_catalog.get_world_owner(world_id, paths=self.paths), self.owner)
        with self.assertRaises(PermissionError):
            world_catalog.delete_world(world_id, "sub-bela", paths=self.paths)
        self.assertTrue(self._files(world_id))

    def _database_in_new_dir(self, world_id: str) -> Path:
        self.paths.worlds.mkdir(parents=True, exist_ok=True)
        return self._database(world_id)


_REAL_EXISTS = Path.exists


if __name__ == "__main__":
    unittest.main()
