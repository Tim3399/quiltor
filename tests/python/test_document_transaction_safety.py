from __future__ import annotations

import copy
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from quiltor.domain.storyboard import default_storyboard_document
from quiltor.infrastructure.persistence.sqlite import (
    manuscript,
    revisions,
    schema,
    story_world,
    storyboards,
)
from quiltor.infrastructure.persistence.sqlite.connection import connection


def manuscript_state(body: str) -> dict:
    return {"chapters": [{"id": "chapter-1", "title": "Opening", "body": body, "note": ""}]}


def figure_state(name: str) -> dict:
    return {
        "nodes": [
            {
                "id": "figure-1",
                "x": 10,
                "y": 20,
                "type": "person",
                "name": name,
            }
        ],
        "edges": [],
    }


def storyboard_state(title: str) -> dict:
    state = default_storyboard_document()
    state["boards"][0]["title"] = title
    return state


class DocumentTransactionSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "world.sqlite3"
        schema.initialize(self.database)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_revision_failure_rolls_back_every_document_family(self):
        cases = (
            ("manuscript", manuscript_state("before"), manuscript_state("after"), manuscript.load),
            ("figures", figure_state("Before"), figure_state("After"), story_world.load),
            (
                "storyboards",
                storyboard_state("Before"),
                storyboard_state("After"),
                storyboards.load,
            ),
        )
        for kind, before, after, load in cases:
            with self.subTest(kind=kind):
                database = Path(self.temp.name) / f"{kind}.sqlite3"
                schema.initialize(database)
                self.assertEqual(revisions.save_with_revision(kind, before, 0, database), 1)
                persisted_before = load(database)
                with connection(database) as opened:
                    opened.execute(
                        f"""
                        CREATE TRIGGER reject_{kind}_revision
                        BEFORE INSERT ON meta
                        WHEN NEW.key='{kind}_revision'
                        BEGIN
                          SELECT RAISE(ABORT, 'injected revision failure');
                        END
                        """
                    )

                with self.assertRaisesRegex(sqlite3.IntegrityError, "injected revision failure"):
                    revisions.save_with_revision(kind, after, 1, database)

                self.assertEqual(load(database), persisted_before)
                self.assertEqual(revisions.revision(kind, db_path=database), 1)

    def test_mid_document_failure_leaves_no_partial_manuscript(self):
        before = manuscript_state("before")
        revisions.save_with_revision("manuscript", before, 0, self.database)
        persisted_before = manuscript.load(self.database)
        after = copy.deepcopy(before)
        after["chapters"].append(
            {"id": "chapter-2", "title": "explode", "body": "partial", "note": ""}
        )
        with connection(self.database) as opened:
            opened.execute(
                """
                CREATE TRIGGER reject_second_chapter
                BEFORE INSERT ON chapters
                WHEN NEW.title='explode'
                BEGIN
                  SELECT RAISE(ABORT, 'injected document failure');
                END
                """
            )

        with self.assertRaisesRegex(sqlite3.IntegrityError, "injected document failure"):
            revisions.save_with_revision("manuscript", after, 1, self.database)

        self.assertEqual(manuscript.load(self.database), persisted_before)
        self.assertEqual(revisions.revision("manuscript", db_path=self.database), 1)

    def test_racing_writers_with_the_same_revision_allow_exactly_one_commit(self):
        barrier = threading.Barrier(2)

        def write(body: str) -> str:
            barrier.wait(timeout=5)
            try:
                revisions.save_with_revision("manuscript", manuscript_state(body), 0, self.database)
                return "saved"
            except revisions.ConflictError:
                return "conflict"

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(write, body) for body in ("first", "second")]
            outcomes = [future.result(timeout=10) for future in futures]

        self.assertCountEqual(outcomes, ["saved", "conflict"])
        self.assertEqual(revisions.revision("manuscript", db_path=self.database), 1)
        self.assertIn(manuscript.load(self.database)["chapters"][0]["body"], {"first", "second"})


if __name__ == "__main__":
    unittest.main()
