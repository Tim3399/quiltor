"""Map images round-trip through the world database and are swept when dropped."""

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from quiltor.application.place_maps import (
    MapImageMissing,
    MapImageRejected,
    PlaceMapUseCases,
)
from quiltor.infrastructure.persistence.adapters.place_maps import SQLitePlaceMapRepository
from quiltor.infrastructure.persistence.sqlite import place_map_images, schema

REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_PNG = REPO_ROOT / "distribution/assets/icons/icon.iconset/icon_128x128.png"
REAL_WEBP = REPO_ROOT / "packages/client/src/modules/manuscript/assets/paper-fiber-texture.webp"


class PlaceMapStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "world.sqlite3"
        schema.initialize(self.database)
        self.use_cases = PlaceMapUseCases(SQLitePlaceMapRepository())
        self.png = REAL_PNG.read_bytes()

    def tearDown(self):
        self.temp.cleanup()

    def test_an_image_comes_back_byte_for_byte(self):
        stored = self.use_cases.store(self.png, self.database)
        self.assertEqual((stored.mime, stored.width, stored.height), ("image/png", 128, 128))
        self.assertEqual(stored.byte_size, len(self.png))

        content = self.use_cases.content(stored.id, self.database)
        self.assertEqual(content.data, self.png)
        self.assertEqual(content.mime, "image/png")

    def test_the_id_is_the_digest_so_the_same_map_is_stored_once(self):
        first = self.use_cases.store(self.png, self.database)
        second = self.use_cases.store(self.png, self.database)
        self.assertEqual(first.id, second.id)
        self.assertEqual(first.id, place_map_images.digest(self.png))
        self.assertEqual(len(place_map_images.catalog(db_path=self.database)), 1)

    def test_two_different_maps_are_kept_apart(self):
        png = self.use_cases.store(self.png, self.database)
        webp = self.use_cases.store(REAL_WEBP.read_bytes(), self.database)
        self.assertNotEqual(png.id, webp.id)
        self.assertEqual(len(place_map_images.catalog(db_path=self.database)), 2)

    def test_bytes_that_are_not_a_supported_image_never_reach_the_database(self):
        with self.assertRaises(MapImageRejected):
            self.use_cases.store(b'<svg xmlns="http://www.w3.org/2000/svg"/>', self.database)
        self.assertEqual(place_map_images.catalog(db_path=self.database), [])

    def test_asking_for_an_unknown_id_is_a_miss_not_an_empty_image(self):
        with self.assertRaises(MapImageMissing):
            self.use_cases.content("0" * 64, self.database)

    def test_an_image_no_frame_references_is_swept_once_it_is_old_enough(self):
        stored = self.use_cases.store(self.png, self.database)

        # Still within the grace window: a document saved between the upload and
        # the frame that describes it must not collect the upload.
        self.assertEqual(self.use_cases.forget_unreferenced(set(), self.database), 0)
        self.assertIsNotNone(place_map_images.content(stored.id, db_path=self.database))

        later = datetime.now() + timedelta(days=1)
        self.assertEqual(self.use_cases.forget_unreferenced(set(), self.database, now=later), 1)
        self.assertIsNone(place_map_images.content(stored.id, db_path=self.database))

    def test_a_referenced_image_survives_the_sweep_however_old(self):
        stored = self.use_cases.store(self.png, self.database)
        later = datetime.now() + timedelta(days=365)
        self.assertEqual(
            self.use_cases.forget_unreferenced({stored.id}, self.database, now=later), 0
        )
        self.assertIsNotNone(place_map_images.content(stored.id, db_path=self.database))


class PlaceMapSchemaTests(unittest.TestCase):
    def test_the_migration_chain_tip_matches_the_schema_constant(self):
        self.assertEqual(schema.SCHEMA_VERSION, 12)

    def test_an_existing_world_gains_the_table_without_losing_its_version(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "world.sqlite3"
            schema.initialize(database)
            schema.initialize(database)
            from quiltor.infrastructure.persistence.sqlite.connection import connect

            handle = connect(database)
            try:
                version = handle.execute(
                    "SELECT value FROM meta WHERE key='schema_version'"
                ).fetchone()[0]
                tables = {
                    row[0]
                    for row in handle.execute("SELECT name FROM sqlite_master WHERE type='table'")
                }
            finally:
                handle.close()
        self.assertEqual(int(version), 12)
        self.assertIn("place_map_images", tables)


if __name__ == "__main__":
    unittest.main()
