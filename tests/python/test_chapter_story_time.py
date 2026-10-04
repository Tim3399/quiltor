from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path

from quiltor.application.documents import (
    DocumentLocation,
    DocumentUseCases,
    InvalidChapterStoryTime,
)
from quiltor.domain.manuscript import story_time_anchor_issue, valid_story_time_reference
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.sqlite import manuscript, revisions, schema, story_world
from quiltor.infrastructure.persistence.sqlite.connection import connect, connection


class _Observer:
    def observe(self, *_args):
        return nullcontext()


class _Backups:
    def backup_if_due(self, *_args):
        return False

    def mirror_manuscript(self, *_args):
        return None

    def mirror_story_world(self, *_args):
        return None


class _CoordinatedRepository(SQLiteDocumentRepository):
    def __init__(self, first: str):
        self._first = first
        self._ready = threading.Barrier(2)
        self._first_committed = threading.Event()

    def save(self, kind, state, expected_revision, database):
        self._ready.wait(timeout=5)
        if kind == self._first:
            try:
                return super().save(kind, state, expected_revision, database)
            finally:
                self._first_committed.set()
        if not self._first_committed.wait(timeout=5):
            raise TimeoutError("The first concurrent document save did not finish.")
        return super().save(kind, state, expected_revision, database)


def _timeline() -> dict:
    return {
        "nodes": [],
        "edges": [],
        "timeline": [
            {"id": "past", "title": "Früher", "time": -10, "position": 0},
            {"id": "future", "title": "Später", "time": 10, "position": 1},
        ],
    }


def _manuscript() -> dict:
    return {
        "chapters": [
            {
                "id": "opening",
                "title": "Vorausblende",
                "body": "",
                "note": "",
                "storyTime": {"startMomentId": "future"},
            },
            {
                "id": "flashback",
                "title": "Rückblende",
                "body": "",
                "note": "",
                "storyTime": {"startMomentId": "past"},
            },
            {
                "id": "range",
                "title": "Zeitraum",
                "body": "",
                "note": "",
                "storyTime": {
                    "startMomentId": "past",
                    "endMomentId": "future",
                    "futureField": {"preserved": True},
                },
            },
            {"id": "unanchored", "title": "Offen", "body": "", "note": ""},
        ]
    }


class ChapterStoryTimeDomainTests(unittest.TestCase):
    def test_point_and_range_shapes_are_valid_but_equal_ends_are_not(self):
        self.assertTrue(valid_story_time_reference({"startMomentId": "past"}))
        self.assertTrue(
            valid_story_time_reference({"startMomentId": "past", "endMomentId": "future"})
        )
        self.assertFalse(
            valid_story_time_reference({"startMomentId": "past", "endMomentId": "past"})
        )

    def test_ids_are_bounded_nonempty_and_canonically_trimmed(self):
        for value in (
            None,
            {},
            {"startMomentId": ""},
            {"startMomentId": " past"},
            {"startMomentId": "past "},
            {"startMomentId": "x" * 201},
            {"startMomentId": "past", "endMomentId": None},
        ):
            with self.subTest(value=value):
                self.assertFalse(valid_story_time_reference(value))

    def test_flashbacks_do_not_require_chapter_order_to_follow_world_time(self):
        self.assertIsNone(story_time_anchor_issue(_manuscript(), _timeline()))

    def test_range_order_and_references_are_checked_per_chapter(self):
        reversed_range = {
            "chapters": [
                {
                    "id": "reverse",
                    "storyTime": {
                        "startMomentId": "future",
                        "endMomentId": "past",
                    },
                }
            ]
        }
        self.assertEqual(
            story_time_anchor_issue(reversed_range, _timeline()).reason,
            "reversed_range",
        )
        unknown = {"chapters": [{"id": "lost", "storyTime": {"startMomentId": "missing"}}]}
        self.assertEqual(story_time_anchor_issue(unknown, _timeline()).reason, "unknown_moment")

    def test_equal_times_follow_incoming_array_order_not_stale_positions(self):
        world = {
            "timeline": [
                {"id": "first", "time": 5, "position": 99},
                {"id": "second", "time": 5, "position": -12},
            ]
        }
        forward = {
            "chapters": [
                {
                    "id": "range",
                    "storyTime": {
                        "startMomentId": "first",
                        "endMomentId": "second",
                    },
                }
            ]
        }
        reverse = {
            "chapters": [
                {
                    "id": "range",
                    "storyTime": {
                        "startMomentId": "second",
                        "endMomentId": "first",
                    },
                }
            ]
        }
        self.assertIsNone(story_time_anchor_issue(forward, world))
        self.assertEqual(story_time_anchor_issue(reverse, world).reason, "reversed_range")


class ChapterStoryTimePersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.database = root / "world.sqlite3"
        self.location = DocumentLocation(
            database=self.database,
            backups=root / "backups",
            manuscript_mirrors=root / "manuscript",
            story_world_mirrors=root / "story-world",
        )
        schema.initialize(self.database)
        story_world.save(_timeline(), db_path=self.database)
        self.documents = DocumentUseCases(
            SQLiteDocumentRepository(),
            _Backups(),
            _Observer(),
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_anchors_round_trip_in_normalized_columns_without_reordering_chapters(self):
        state = _manuscript()
        self.assertEqual(self.documents.save("manuscript", state, 0, self.location), 1)
        loaded = manuscript.load(self.database)

        self.assertEqual(
            [chapter["id"] for chapter in loaded["chapters"]],
            ["opening", "flashback", "range", "unanchored"],
        )
        self.assertEqual(loaded["chapters"][0]["storyTime"], state["chapters"][0]["storyTime"])
        self.assertEqual(loaded["chapters"][2]["storyTime"], state["chapters"][2]["storyTime"])
        self.assertNotIn("storyTime", loaded["chapters"][3])

        with connection(self.database) as database:
            row = database.execute(
                "SELECT story_time_start_moment_id,story_time_end_moment_id,"
                "story_time_extra_json,extra_json FROM chapters WHERE id='range'"
            ).fetchone()
        self.assertEqual((row[0], row[1]), ("past", "future"))
        self.assertEqual(json.loads(row[2]), {"futureField": {"preserved": True}})
        self.assertNotIn("storyTime", json.loads(row[3]))

    def test_removing_a_referenced_moment_has_a_specific_application_error(self):
        self.documents.save("manuscript", _manuscript(), 0, self.location)
        without_past = {
            **_timeline(),
            "timeline": [moment for moment in _timeline()["timeline"] if moment["id"] != "past"],
        }

        with self.assertRaises(InvalidChapterStoryTime) as raised:
            self.documents.save("figures", without_past, 0, self.location)

        self.assertEqual(raised.exception.code, "manuscript.story_time_invalid")
        self.assertEqual(
            raised.exception.params,
            {
                "document": "figures",
                "reason": "unknown_moment",
                "chapterId": "flashback",
                "momentId": "past",
            },
        )
        self.assertEqual(revisions.revision("figures", db_path=self.database), 0)
        self.assertEqual(
            {moment["id"] for moment in story_world.load(self.database)["timeline"]},
            {"past", "future"},
        )

    def test_database_foreign_keys_defend_direct_persistence_bypasses(self):
        self.documents.save("manuscript", _manuscript(), 0, self.location)
        with self.assertRaises(sqlite3.IntegrityError), connection(self.database) as database:
            database.execute("DELETE FROM timeline_moments WHERE id='past'")

    def test_restore_revision_timestamp_is_explicit_utc(self):
        revisions.advance_restore_revisions({}, db_path=self.database)
        with connection(self.database) as database:
            stored = database.execute(
                "SELECT value FROM meta WHERE key='last_restore_at'"
            ).fetchone()[0]

        restored_at = datetime.fromisoformat(stored)
        self.assertEqual(restored_at.tzinfo, UTC)

    def test_cross_document_validation_and_save_share_one_transaction(self):
        for first in ("figures", "manuscript"):
            with self.subTest(first=first), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                database = root / "world.sqlite3"
                location = DocumentLocation(
                    database=database,
                    backups=root / "backups",
                    manuscript_mirrors=root / "manuscript",
                    story_world_mirrors=root / "story-world",
                )
                schema.initialize(database)
                story_world.save(_timeline(), db_path=database)
                unanchored = copy.deepcopy(_manuscript())
                for chapter in unanchored["chapters"]:
                    chapter.pop("storyTime", None)
                manuscript.save(unanchored, db_path=database)
                swapped = copy.deepcopy(_timeline())
                for moment in swapped["timeline"]:
                    moment["time"] *= -1

                documents = DocumentUseCases(
                    _CoordinatedRepository(first),
                    _Backups(),
                    _Observer(),
                )
                with ThreadPoolExecutor(max_workers=2) as pool:
                    futures = {
                        "figures": pool.submit(documents.save, "figures", swapped, 0, location),
                        "manuscript": pool.submit(
                            documents.save, "manuscript", _manuscript(), 0, location
                        ),
                    }
                    winner = futures[first].result(timeout=10)
                    with self.assertRaises(InvalidChapterStoryTime) as raised:
                        futures["manuscript" if first == "figures" else "figures"].result(
                            timeout=10
                        )

                losing_kind = "manuscript" if first == "figures" else "figures"
                self.assertEqual(winner, 1)
                self.assertEqual(raised.exception.params["document"], losing_kind)
                self.assertEqual(raised.exception.params["reason"], "reversed_range")
                self.assertEqual(revisions.revision(first, db_path=database), 1)
                self.assertEqual(revisions.revision(losing_kind, db_path=database), 0)
                persisted_manuscript = manuscript.load(database)
                persisted_figures = story_world.load(database)
                self.assertIsNone(story_time_anchor_issue(persisted_manuscript, persisted_figures))
                if first == "figures":
                    self.assertTrue(
                        all(
                            "storyTime" not in chapter
                            for chapter in persisted_manuscript["chapters"]
                        )
                    )
                else:
                    self.assertEqual(
                        [moment["time"] for moment in persisted_figures["timeline"]],
                        [-10, 10],
                    )

    def test_transaction_loaders_use_and_preserve_the_caller_connection(self):
        database = connect(self.database)
        try:
            database.execute("BEGIN IMMEDIATE")
            database.execute("UPDATE timeline_moments SET time=42 WHERE id='past'")
            self.assertEqual(
                next(
                    moment
                    for moment in story_world.load(conn=database)["timeline"]
                    if moment["id"] == "past"
                )["time"],
                42,
            )
            self.assertEqual(manuscript.load(conn=database)["chapters"], [])
            database.rollback()
            self.assertEqual(database.execute("SELECT 1").fetchone()[0], 1)
        finally:
            database.close()

    def test_unknown_document_kind_retains_the_existing_value_error(self):
        with self.assertRaisesRegex(ValueError, "Unknown document type"):
            revisions.save_with_revision("unknown", {}, None, db_path=self.database)


class ChapterStoryTimeMigrationTests(unittest.TestCase):
    def test_v7_chapters_gain_anchor_columns_without_revision_or_order_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "legacy.sqlite3"
            database = sqlite3.connect(database_path)
            try:
                database.executescript(
                    """
                    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    INSERT INTO meta(key,value) VALUES('schema_version','7');
                    INSERT INTO meta(key,value) VALUES('manuscript_revision','12');
                    INSERT INTO meta(key,value) VALUES('figures_revision','9');
                    CREATE TABLE chapters(
                      id TEXT PRIMARY KEY,
                      position INTEGER NOT NULL UNIQUE,
                      title TEXT NOT NULL DEFAULT '',
                      body TEXT NOT NULL DEFAULT '',
                      note TEXT NOT NULL DEFAULT '',
                      extra_json TEXT NOT NULL DEFAULT '{}'
                    );
                    INSERT INTO chapters(id,position,title,body,note,extra_json)
                    VALUES('legacy',0,'Alt','','','{"legacyField":true}');
                    """
                )
                database.commit()
            finally:
                database.close()

            schema.initialize(database_path)

            with connection(database_path) as upgraded:
                columns = {row[1] for row in upgraded.execute("PRAGMA table_info(chapters)")}
                row = upgraded.execute(
                    "SELECT id,position,extra_json,story_time_start_moment_id,"
                    "story_time_end_moment_id,story_time_extra_json FROM chapters"
                ).fetchone()
                indexes = {row[1] for row in upgraded.execute("PRAGMA index_list(chapters)")}
                metadata = dict(upgraded.execute("SELECT key,value FROM meta"))

            self.assertTrue(
                {
                    "story_time_start_moment_id",
                    "story_time_end_moment_id",
                    "story_time_extra_json",
                }
                <= columns
            )
            self.assertEqual(tuple(row), ("legacy", 0, '{"legacyField":true}', None, None, "{}"))
            self.assertEqual(
                indexes,
                {
                    "sqlite_autoindex_chapters_1",
                    "sqlite_autoindex_chapters_2",
                    "chapters_story_time_start",
                    "chapters_story_time_end",
                },
            )
            self.assertEqual(metadata["schema_version"], str(schema.SCHEMA_VERSION))
            self.assertEqual(metadata["manuscript_revision"], "12")
            self.assertEqual(metadata["figures_revision"], "9")


if __name__ == "__main__":
    unittest.main()
