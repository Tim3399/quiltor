"""A failed or rotated restore source must never erase the active manuscript."""

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from quiltor.infrastructure.persistence.sqlite import manuscript, restore, revisions, schema


class LocalBackupRestoreSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.database = self.root / "world.sqlite3"
        self.backups = self.root / "backups"
        self.backups.mkdir()
        schema.initialize(self.database)
        self._save("Original manuscript")

    def tearDown(self):
        self.temporary.cleanup()

    def _save(self, body):
        state = {"chapters": [{"id": "c1", "title": "Chapter", "body": body, "note": ""}]}
        revisions.save_with_revision("manuscript", state, None, db_path=self.database)

    def _restore(self, name):
        restore.restore_backup(name, db_path=self.database, backups_dir=self.backups)

    def test_restoring_the_oldest_backup_at_the_retention_limit_preserves_its_contents(self):
        for _ in range(restore.MAX_BACKUPS):
            restore.backup_if_due(force=True, db_path=self.database, backups_dir=self.backups)
        oldest = restore.list_backups(self.backups)[-1]["name"]
        self._save("Current manuscript")

        self._restore(oldest)

        self.assertEqual(
            manuscript.load(self.database)["chapters"][0]["body"], "Original manuscript"
        )
        backups = restore.list_backups(self.backups)
        self.assertEqual(len(backups), restore.MAX_BACKUPS)
        self.assertEqual(
            manuscript.load(self.backups / backups[0]["name"])["chapters"][0]["body"],
            "Current manuscript",
        )

    def test_invalid_restore_sources_preserve_the_active_database_and_backup_files(self):
        for kind in (
            "empty",
            "not-sqlite",
            "truncated",
            "unrelated-schema",
            "metadata-only",
            "broken-migration",
        ):
            with self.subTest(kind=kind):
                source = self.backups / f"backup-{kind}.sqlite3"
                if kind in {"empty", "not-sqlite"}:
                    source.write_bytes(b"" if kind == "empty" else b"not a SQLite database")
                elif kind == "truncated":
                    source.write_bytes(self.database.read_bytes()[:128])
                else:
                    with closing(sqlite3.connect(source)) as database, database:
                        if kind == "unrelated-schema":
                            database.execute("CREATE TABLE unrelated(value TEXT)")
                        else:
                            database.execute("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)")
                            database.execute(
                                "INSERT INTO meta VALUES('schema_version',?)",
                                (str(schema.SCHEMA_VERSION) if kind == "metadata-only" else "3",),
                            )
                            if kind == "broken-migration":
                                database.execute("CREATE TABLE chapters(unexpected TEXT)")
                before_database = self.database.read_bytes()
                before_backups = {path.name: path.read_bytes() for path in self.backups.iterdir()}

                with self.assertRaises((ValueError, sqlite3.Error)):
                    self._restore(source.name)

                self.assertEqual(self.database.read_bytes(), before_database)
                self.assertEqual(
                    {path.name: path.read_bytes() for path in self.backups.iterdir()},
                    before_backups,
                )

    def test_a_missing_restore_source_is_not_created(self):
        before = self.database.read_bytes()
        with self.assertRaises(FileNotFoundError):
            self._restore("backup-missing.sqlite3")
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(list(self.backups.iterdir()), [])

    def test_a_successful_restore_leaves_the_source_snapshot_unchanged(self):
        restore.backup_if_due(force=True, db_path=self.database, backups_dir=self.backups)
        source = self.backups / restore.list_backups(self.backups)[0]["name"]
        before = source.read_bytes()
        self._save("Current manuscript")

        self._restore(source.name)

        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(
            manuscript.load(self.database)["chapters"][0]["body"], "Original manuscript"
        )
