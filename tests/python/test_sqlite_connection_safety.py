from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from quiltor.infrastructure.persistence.sqlite.connection import connect


class SQLiteConnectionSafetyTests(unittest.TestCase):
    def test_failed_setup_releases_corrupt_database_for_immediate_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "corrupt.sqlite3"
            database.write_bytes(b"this is not a sqlite database")

            with self.assertRaises(sqlite3.DatabaseError):
                connect(database)

            database.unlink()
            replacement = connect(database)
            try:
                replacement.execute("CREATE TABLE recovered(id INTEGER PRIMARY KEY)")
                replacement.commit()
            finally:
                replacement.close()

            self.assertTrue(database.exists())


if __name__ == "__main__":
    unittest.main()
