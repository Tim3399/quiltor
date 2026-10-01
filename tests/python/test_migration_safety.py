"""Safety boundaries for SQLite migration and local restore."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from quiltor.application.document_wire_v1 import decode_document_v1, encode_document_v1
from quiltor.domain.story_world.knowledge import build_knowledge, retrieve
from quiltor.infrastructure.persistence import mirror
from quiltor.infrastructure.persistence.sqlite import (
    manuscript,
    restore,
    revisions,
    schema,
    story_world,
)
from quiltor.infrastructure.persistence.sqlite.connection import connect, connection
from tests.python.test_storage import LEGACY_V3_FIGURE_SCHEMA

LEGACY_V7_MANUSCRIPT_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE manuscript_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  words_json TEXT NOT NULL DEFAULT '[]',
  characters_json TEXT NOT NULL DEFAULT '[]',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE chapter_folders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE manuscript_tree_items (
  id TEXT PRIMARY KEY,
  parent_folder_id TEXT,
  kind TEXT NOT NULL,
  chapter_id TEXT,
  folder_id TEXT,
  position INTEGER NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
"""


class MigrationSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.database = self.root / "world.sqlite3"
        self.backups = self.root / "backups"
        self.backups.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def _save(self, body: str, expected: int | None = None) -> int:
        state = {"chapters": [{"id": "chapter-1", "title": "Anfang", "body": body, "note": ""}]}
        return revisions.save_with_revision("manuscript", state, expected, db_path=self.database)

    def _migration_backups(self) -> list[Path]:
        return sorted(self.root.glob("world.pre-migration-v*.sqlite3"))

    def test_legacy_world_keeps_a_standalone_copy_and_migrates_only_once(self):
        with closing(sqlite3.connect(self.database)) as database, database:
            database.executescript(LEGACY_V7_MANUSCRIPT_SCHEMA)
            database.executemany(
                "INSERT INTO meta(key,value) VALUES(?,?)",
                (("schema_version", "7"), ("manuscript_revision", "4")),
            )
            database.execute(
                "INSERT INTO chapters(id,position,title,body,note,extra_json) "
                "VALUES('chapter-1',0,'Anfang','Der alte Text','','{}')"
            )
            database.execute(
                "INSERT INTO manuscript_tree_items(id,kind,chapter_id,position) "
                "VALUES('tree-1','chapter','chapter-1',0)"
            )

        schema.initialize(self.database)

        safety_copies = self._migration_backups()
        self.assertEqual(len(safety_copies), 1)
        with connection(safety_copies[0]) as safety:
            self.assertEqual(
                safety.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                "7",
            )
            self.assertEqual(
                safety.execute("SELECT body FROM chapters WHERE id='chapter-1'").fetchone()[0],
                "Der alte Text",
            )

        loaded = decode_document_v1(
            "manuscript",
            encode_document_v1(
                "manuscript",
                manuscript.load(self.database),
                revisions.revision("manuscript", db_path=self.database),
            ),
        ).payload
        self.assertEqual(loaded["chapters"][0]["body"], "Der alte Text")
        loaded["chapters"][0]["body"] = "Der editierte Text"
        manuscript.save(loaded, db_path=self.database)
        search_results = retrieve(
            build_knowledge(manuscript.load(self.database), {"nodes": [], "edges": []}),
            "editierte",
            fallback=False,
        )
        self.assertEqual(search_results[0].target["id"], "chapter-1")
        self.assertEqual(search_results[0].text, "Der editierte Text")
        export_dir = self.root / "export"
        mirror.mirror_text(manuscript.load(self.database)["chapters"], export_dir)
        self.assertIn(
            "Der editierte Text",
            next(export_dir.glob("*.md")).read_text(encoding="utf-8"),
        )

        schema.initialize(self.database)
        self.assertEqual(self._migration_backups(), safety_copies)
        self.assertEqual(
            manuscript.load(self.database)["chapters"][0]["body"], "Der editierte Text"
        )

    def test_real_v3_world_round_trips_through_the_document_boundary(self):
        with closing(sqlite3.connect(self.database)) as database, database:
            database.executescript(LEGACY_V3_FIGURE_SCHEMA)
            database.executemany(
                "INSERT INTO meta(key,value) VALUES(?,?)",
                (("schema_version", "3"), ("figures_revision", "8")),
            )
            database.executemany(
                "INSERT INTO figures(id,position,x,y,kind,name,extra_json) VALUES(?,?,?,?,?,?,?)",
                (
                    ("person-1", 0, 10, 20, "person", "Mara", "{}"),
                    ("place-1", 1, 30, 40, "ort", "Archiv", "{}"),
                ),
            )
            database.execute(
                "INSERT INTO connections(id,source_id,target_id,label) "
                "VALUES('edge-1','person-1','place-1','arbeitet in')"
            )

        schema.initialize(self.database)
        revision = revisions.revision("figures", db_path=self.database)
        decoded = decode_document_v1(
            "figures",
            encode_document_v1("figures", story_world.load(db_path=self.database), revision),
        )
        self.assertEqual(decoded.payload["edges"][0]["to"], "place-1")
        decoded.payload["nodes"][0]["name"] = "Mara Neu"
        story_world.save(decoded.payload, db_path=self.database)
        reloaded = story_world.load(db_path=self.database)
        self.assertEqual(reloaded["nodes"][0]["name"], "Mara Neu")
        self.assertEqual(reloaded["edges"][0]["to"], "place-1")
        profile_dir = self.root / "profiles"
        mirror.mirror_profiles(reloaded, profile_dir)
        self.assertIn("Mara Neu", next(profile_dir.glob("*.md")).read_text(encoding="utf-8"))

    def test_live_wal_reader_does_not_lose_committed_changes_during_migration(self):
        schema.initialize(self.database)
        self._save("Vor dem WAL", 0)
        reader = sqlite3.connect(self.database)
        try:
            reader.execute("BEGIN")
            reader.execute("SELECT body FROM chapters").fetchone()
            writer = connect(self.database)
            try:
                with writer:
                    writer.execute("UPDATE chapters SET body='Im WAL gesichert'")
                    writer.execute("UPDATE meta SET value='12' WHERE key='manuscript_revision'")
                    writer.execute("UPDATE meta SET value='7' WHERE key='schema_version'")
            finally:
                writer.close()
            self.assertTrue(Path(f"{self.database}-wal").exists())

            schema.initialize(self.database)
        finally:
            reader.close()

        self.assertEqual(manuscript.load(self.database)["chapters"][0]["body"], "Im WAL gesichert")
        self.assertEqual(revisions.revision("manuscript", db_path=self.database), 12)
        safety = self._migration_backups()[0]
        with connection(safety) as database:
            self.assertEqual(
                database.execute("SELECT body FROM chapters").fetchone()[0],
                "Im WAL gesichert",
            )

    def test_failed_migration_leaves_active_contents_and_revision_unchanged(self):
        schema.initialize(self.database)
        self._save("Unverändert", 0)
        with connection(self.database) as database:
            database.execute("UPDATE meta SET value='7' WHERE key='schema_version'")

        def fail_after_write(database: sqlite3.Connection, _version: int) -> None:
            database.execute("UPDATE chapters SET body='Beschädigt'")
            database.execute("UPDATE meta SET value='999' WHERE key='manuscript_revision'")
            raise RuntimeError("injected migration failure")

        with (
            patch(
                "quiltor.infrastructure.persistence.sqlite.migrations.migrate",
                side_effect=fail_after_write,
            ),
            self.assertRaisesRegex(RuntimeError, "injected migration failure"),
        ):
            schema.initialize(self.database)

        self.assertEqual(manuscript.load(self.database)["chapters"][0]["body"], "Unverändert")
        self.assertEqual(revisions.revision("manuscript", db_path=self.database), 1)
        with connection(self.database) as database:
            self.assertEqual(
                database.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0],
                "7",
            )
        self.assertEqual(len(self._migration_backups()), 1)

    def test_future_schema_is_rejected_without_writes_or_safety_copy(self):
        schema.initialize(self.database)
        self._save("Aus der Zukunft", 0)
        future_version = schema.SCHEMA_VERSION + 1
        with connection(self.database) as database:
            database.execute(
                "UPDATE meta SET value=? WHERE key='schema_version'", (str(future_version),)
            )
        before = self.database.read_bytes()

        with self.assertRaisesRegex(ValueError, "newer than supported"):
            schema.initialize(self.database)

        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(manuscript.load(self.database)["chapters"][0]["body"], "Aus der Zukunft")
        self.assertEqual(revisions.revision("manuscript", db_path=self.database), 1)
        self.assertEqual(self._migration_backups(), [])

    def test_negative_schema_is_rejected_without_writes_or_safety_copy(self):
        schema.initialize(self.database)
        self._save("Unverändert", 0)
        with connection(self.database) as database:
            database.execute("UPDATE meta SET value='-1' WHERE key='schema_version'")
        before = self.database.read_bytes()

        with self.assertRaisesRegex(ValueError, "invalid"):
            schema.initialize(self.database)

        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(self._migration_backups(), [])

    def test_damaged_restore_source_leaves_current_world_intact(self):
        schema.initialize(self.database)
        self._save("Aktueller Text", 0)
        damaged = self.backups / "backup-damaged.sqlite3"
        damaged.write_bytes(b"SQLite format 3\x00damaged")
        before = self.database.read_bytes()

        with self.assertRaises(sqlite3.Error):
            restore.restore_backup(damaged.name, db_path=self.database, backups_dir=self.backups)

        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(manuscript.load(self.database)["chapters"][0]["body"], "Aktueller Text")
        self.assertEqual(revisions.revision("manuscript", db_path=self.database), 1)

    def test_restore_invalidates_revisions_issued_before_restore(self):
        schema.initialize(self.database)
        old_revision = self._save("Gesicherter Text", 0)
        restore.backup_if_due(force=True, db_path=self.database, backups_dir=self.backups)
        backup_name = restore.list_backups(self.backups)[0]["name"]
        current_revision = self._save("Neuer Text", old_revision)

        restore.restore_backup(backup_name, db_path=self.database, backups_dir=self.backups)

        self.assertGreater(
            revisions.revision("manuscript", db_path=self.database), current_revision
        )
        with self.assertRaises(revisions.ConflictError):
            revisions.save_with_revision(
                "manuscript",
                manuscript.load(self.database),
                current_revision,
                db_path=self.database,
            )


if __name__ == "__main__":
    unittest.main()
